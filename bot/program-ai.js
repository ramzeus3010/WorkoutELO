/**
 * AI program generation.
 *
 * WHY THIS RUNS ON THE WORKER AND NOT IN THE APP
 * An API key cannot ship in the client. The Mini App bundle is public — anyone can open
 * dist/app.js and read it — and an earlier attempt at client-side AI had to be torn out for
 * exactly this reason. Cost was never the blocker; a generation is a fraction of a cent.
 * Abuse is. So the key lives as a Worker secret, the client is identified by Telegram's
 * signed initData, and every caller is rate limited.
 *
 * WHY THE OUTPUT IS SCHEMA-CONSTRAINED
 * A program is a data structure, not prose: days, exercises, and a movement pattern per
 * exercise that has to be one of thirteen exact ids or the scoring engine can't score it.
 * Structured outputs make the model emit JSON that validates against that schema, which
 * removes the entire class of "parse the model's markdown" failures. The schema cannot
 * express everything we care about, though — see validateProgram below for the rest.
 *
 * WHY RAW FETCH RATHER THAN THE OPENAI SDK
 * This is one POST to one endpoint. The SDK would add a bundled dependency to a Worker that
 * has never actually been deployed yet, and a bundling or edge-runtime problem would surface
 * as a broken deploy rather than as a local test failure. `fetch` is native to Workers and
 * has nothing to go wrong. If this grows past a single call, revisit.
 *
 * SWAPPING PROVIDERS
 * Everything provider-specific is in callModel() below — roughly thirty lines. The schema,
 * the validation, the exclusion check, the prompts and the entire app-side UI are neutral.
 * This started on Anthropic and moved to OpenAI in one edit to that function.
 */

import { MOVEMENT_PATTERNS } from "../src/scoring.js";

const API_URL = "https://api.openai.com/v1/chat/completions";

// Overridable with an OPENAI_MODEL var in wrangler.toml, so pointing this at a different or
// newer model is a config change rather than a code change. The default has to support
// structured outputs (`response_format: json_schema`); not every model does.
const DEFAULT_MODEL = "gpt-4o";


// Bounds, enforced after generation. These are product limits, not model limits: a 12-day
// "program" is not a program, and a day whose JSON exceeds ~4000 characters cannot be written
// to Telegram CloudStorage at all (see the storage notes in workout_tracker.md).
const MAX_DAYS = 7;
const MAX_EXERCISES_PER_DAY = 12;
const MAX_DAY_PAYLOAD_CHARS = 3500;
const MAX_PROMPT_CHARS = 2000;

// Per-user, per-day cap. The point is bounding abuse, not billing — a real user describing a
// program and iterating on it a few times stays well under this.
const DAILY_LIMIT = 15;

const PATTERN_IDS = MOVEMENT_PATTERNS.map((p) => p.id);

/**
 * The response schema.
 *
 * `pattern` is an enum of the thirteen real ids, which is the single most valuable constraint
 * here — a hallucinated pattern name would leave the exercise unscoreable, and that failure is
 * silent (the lift logs fine and simply never counts).
 *
 * `exclusions` is the model reporting back what it understood the user to have ruled out. It
 * exists so the server can hold the model to its own reading — see validateProgram.
 */
export const PROGRAM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short name for the program, 2-4 words." },
    summary: {
      type: "string",
      description: "One sentence explaining the structure and who it suits. Shown to the user for review.",
    },
    exclusions: {
      type: "array",
      description:
        "Every exercise, movement or equipment the user asked to avoid, in the user's own words. Empty array if they excluded nothing. Be literal: if they said 'no deadlifts', put 'deadlift' here.",
      items: { type: "string" },
    },
    days: {
      type: "array",
      description: "Training days, in the order they should be performed.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short day name, e.g. 'Upper A' or 'Push'." },
          subtitle: { type: "string", description: "Short description of the day's focus." },
          exercises: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "The exercise name as the user should see it." },
                pattern: {
                  type: "string",
                  enum: PATTERN_IDS,
                  description: "Which movement pattern this exercise trains. Determines how it is scored.",
                },
                target: { type: "string", description: "Sets and reps, e.g. '3 x 8-12' or '3 x 45s'." },
                rest: { type: "integer", description: "Rest between sets in seconds, 30-300." },
              },
              required: ["name", "pattern", "target", "rest"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "subtitle", "exercises"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "summary", "exclusions", "days"],
  additionalProperties: false,
};

function patternReference() {
  return MOVEMENT_PATTERNS.map((p) => `- ${p.id}: ${p.label} (${p.hint})`).join("\n");
}

function systemPrompt(lang) {
  const language = lang === "ru" ? "Russian" : "English";
  return [
    "You design weightlifting programs for a training-log app called Chetamba.",
    "",
    "The app scores every logged exercise against a fixed set of thirteen movement patterns.",
    "You must tag each exercise with the pattern it trains, chosen from exactly these ids:",
    "",
    patternReference(),
    "",
    "Rules:",
    `- Write every user-visible string (program name, summary, day names, subtitles, exercise names) in ${language}. The pattern ids stay in English — they are internal identifiers.`,
    "- Honour every exclusion the user states, and list what you excluded in the `exclusions` field. If they rule out an exercise, do not include it, a close variant of it, or the same movement under another name.",
    "- Prefer movements that are safe to perform unsupervised. Do not program anything requiring a spotter to be safe.",
    "- Cover the patterns the user's goal actually needs. A balanced program beats a long one.",
    "- Use rest times that match the effort: 90-150s for heavy compounds, 45-75s for isolation.",
    "- `target` is sets x reps for weighted work, or sets x seconds for holds and conditioning.",
    "- Keep it to what the user asked for. If they asked for three days, give three days.",
    "",
    "The user's request follows. If it is vague, make reasonable choices rather than asking questions —",
    "the program is editable afterwards and they will see it before it is saved.",
  ].join("\n");
}

function userPrompt(prompt, profile) {
  const facts = [];
  if (profile && profile.weightKg) facts.push(`Bodyweight: ${profile.weightKg} kg`);
  if (profile && profile.heightCm) facts.push(`Height: ${profile.heightCm} cm`);
  const context = facts.length ? `\n\nKnown about this person:\n${facts.join("\n")}` : "";
  return `${String(prompt).slice(0, MAX_PROMPT_CHARS)}${context}`;
}

/**
 * Checks the schema cannot express.
 *
 * The enum guarantees a valid pattern id and the shape guarantees the fields exist. What it
 * cannot guarantee is that the model actually respected the user's exclusions — and that is
 * the one failure that matters here, because the person excluding an exercise is usually
 * doing it because of an injury. It WILL produce a Romanian deadlift for someone who said no
 * Romanian deadlifts, so we check rather than trust.
 *
 * Returns { ok: true, program } or { ok: false, reason } — reason is a key, not prose, because
 * the client renders it in the user's language.
 */
export function validateProgram(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "ai.errShape" };
  const days = Array.isArray(raw.days) ? raw.days : [];
  if (days.length === 0) return { ok: false, reason: "ai.errNoDays" };
  if (days.length > MAX_DAYS) return { ok: false, reason: "ai.errTooManyDays" };

  const exclusions = (Array.isArray(raw.exclusions) ? raw.exclusions : [])
    .map((e) => String(e || "").toLowerCase().trim())
    .filter((e) => e.length >= 3); // "no" / "ab" match everything; ignore fragments

  for (const day of days) {
    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    if (exercises.length === 0) return { ok: false, reason: "ai.errEmptyDay" };
    if (exercises.length > MAX_EXERCISES_PER_DAY) return { ok: false, reason: "ai.errTooManyExercises" };

    for (const ex of exercises) {
      if (!PATTERN_IDS.includes(ex.pattern)) return { ok: false, reason: "ai.errPattern" };

      // The exclusion check. Substring rather than word matching, because the violation we
      // care about is "Romanian deadlift" appearing when "deadlift" was excluded.
      const name = String(ex.name || "").toLowerCase();
      if (exclusions.some((term) => name.includes(term))) {
        return { ok: false, reason: "ai.errExcluded" };
      }
    }

    // CloudStorage caps each value at 4096 characters and a program day is one value. A day
    // that doesn't fit cannot be saved at all, so reject here rather than at save time.
    if (JSON.stringify(exercises).length > MAX_DAY_PAYLOAD_CHARS) {
      return { ok: false, reason: "ai.errTooBig" };
    }
  }

  return { ok: true, program: raw };
}

/** Per-user daily counter. Keyed by league day so it resets on the same clock as the league. */
async function underRateLimit(env, userId, todayIso) {
  const key = `aiquota:${userId}:${todayIso}`;
  const used = Number((await env.CHETAMBA.get(key)) || 0);
  if (used >= DAILY_LIMIT) return false;
  // TTL just past a day, so the key expires on its own rather than accumulating per user.
  await env.CHETAMBA.put(key, String(used + 1), { expirationTtl: 36 * 60 * 60 });
  return true;
}

/**
 * The only provider-specific code in this file.
 *
 * Returns { ok: true, json } with the parsed program object, or { ok: false, reason }.
 *
 * `strict: true` is what makes the schema binding rather than advisory. It comes with two
 * requirements the schema above already satisfies, and which will reject the request loudly
 * if they're ever broken: every object needs `additionalProperties: false`, and every
 * property must be listed in `required`. Optional fields are not expressible under strict
 * mode — model them as a field that can be an empty array or empty string instead.
 */
async function callModel(env, { system, user }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
      // No output ceiling is sent on purpose. The parameter that sets one was renamed
      // (`max_tokens` → `max_completion_tokens`) and newer models reject the old name with a
      // 400 — so hard-coding either one silently restricts which models OPENAI_MODEL can be
      // pointed at. The schema already bounds the output: a program is a fixed shape, and
      // anything oversized is rejected by validateProgram regardless.
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "training_program", strict: true, schema: PROGRAM_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    // Log the body — an unusable model name or a schema the API rejects both surface here,
    // and without the body the failure is indistinguishable from a network blip.
    const detail = await res.text().catch(() => "");
    console.error(`program generation HTTP ${res.status}:`, detail.slice(0, 800));
    return { ok: false, reason: res.status === 429 ? "ai.errBusy" : "ai.errUpstream" };
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, reason: "ai.errShape" };
  }

  const message = body && body.choices && body.choices[0] && body.choices[0].message;
  if (!message) return { ok: false, reason: "ai.errShape" };

  // A refused request returns 200 with `refusal` set and `content` null, so this has to be
  // checked before reading content or the parse below throws on null.
  if (message.refusal) return { ok: false, reason: "ai.errRefused" };

  // Hitting the model's own output limit truncates the JSON mid-structure, which parses as
  // malformed rather than as anything meaningful. Worth its own branch so the log says what
  // actually happened instead of just "unreadable".
  if (body.choices[0].finish_reason === "length") {
    console.error("program generation truncated by the model's output limit — ask for a shorter program");
    return { ok: false, reason: "ai.errTooBig" };
  }

  try {
    return { ok: true, json: JSON.parse(message.content) };
  } catch (e) {
    return { ok: false, reason: "ai.errShape" };
  }
}

export async function generateProgram(env, { prompt, lang, profile, userId, todayIso }) {
  if (!env.OPENAI_API_KEY) return { ok: false, reason: "ai.errNotConfigured" };

  const text = String(prompt || "").trim();
  if (text.length < 10) return { ok: false, reason: "ai.errTooShort" };

  if (!(await underRateLimit(env, userId, todayIso))) {
    return { ok: false, reason: "ai.errRateLimited" };
  }

  let called;
  try {
    called = await callModel(env, {
      system: systemPrompt(lang),
      user: userPrompt(text, profile),
    });
  } catch (err) {
    console.error("program generation failed", err && err.stack ? err.stack : err);
    return { ok: false, reason: "ai.errUpstream" };
  }

  if (!called.ok) return called;
  return validateProgram(called.json);
}
