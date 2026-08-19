/**
 * Chetamba bot — a Telegram webhook handler that runs on Cloudflare Workers.
 *
 * WHY THIS EXISTS
 * BotFather registers a bot and its Mini App, but it does not answer messages. Telegram
 * posts every /start to whatever URL you register as the webhook; if nothing is listening,
 * the bot appears dead even though the Mini App link works fine. That was the bug.
 *
 * WHY A WORKER
 * There is no server in this project on purpose (§2 of workout_tracker.md) and this doesn't
 * really add one: a webhook is stateless, runs only when someone messages the bot, and fits
 * inside Cloudflare's free tier. It is also the natural place to put a server-side API proxy
 * later if the AI-generated-program idea happens, so the API key never ships to the client.
 *
 * CONFIG (set with wrangler, see bot/README.md — never commit these)
 *   BOT_TOKEN       secret. From BotFather. Full control of the bot; treat like a password.
 *   WEBHOOK_SECRET  secret. Echoed by Telegram in a header so randoms can't POST fake updates.
 *   MINI_APP_URL    var.    https URL the Mini App is served from.
 *   DIRECT_LINK     var.    https://t.me/<bot>/<app> — used where web_app buttons aren't allowed.
 *   PREVIEW_IMAGE_URL var.  optional; if set, /start sends a photo card instead of plain text.
 */

import {
  verifyInitData, readUser, writeUser, emptyUser, applyPublish, applySync,
  standingFor, groupStandings, makeJoinCode,
  codeKey, memberKey, groupKey, groupLangKey, leagueTodayISO, weekStartISO,
} from "./relay.js";
// The same dictionary the Mini App renders from. Shared for the same reason scoring.js is:
// the bot and the app describe the same events to the same people, and two copies of the
// wording would drift until the group chat and the app disagreed.
import { t, plural, detectLang, isLang, LANGS, DEFAULT_LANG } from "../src/i18n.js";
import { generateProgram } from "./program-ai.js";

// Cron expressions are UTC; the league runs on UTC+5 (Almaty). Monday 08:00 and Sunday 19:00
// local. These must match wrangler.toml exactly — runCron() compares the string, so a typo
// means the trigger fires and silently does nothing.
// Cloudflare's day-of-week is 1-7 (Mon-Sun), not the standard cron 0-6.
const MONDAY_CRON = "0 3 * * 1";
const SUNDAY_CRON = "0 14 * * 7";

// ---------- Language resolution ----------
// Three separate questions, deliberately answered from three different places:
//
//   userLang(env, id, fallbackCode)  what a DM to one person is written in. Stored per user,
//                                    seeded from their Telegram locale, overridden by the
//                                    app's switch or the /language buttons.
//   groupLang(env, groupId)          what the shared board posts in. One value per chat,
//                                    chosen at /register — a group post has many readers and
//                                    can only be in one language.
//
// Falling back to the Telegram-reported locale rather than to English matters: a brand new
// user's very first /start should already be readable, since that message is the one asking
// them which language they want.
async function userLang(env, id, fallbackCode) {
  if (id) {
    const stored = await readUser(env, String(id));
    if (stored && isLang(stored.lang)) return stored.lang;
  }
  return detectLang(fallbackCode);
}

async function groupLang(env, groupId) {
  const stored = await env.CHETAMBA.get(groupLangKey(String(groupId)));
  return isLang(stored) ? stored : DEFAULT_LANG;
}

// Two buttons, each labelled in its own language, so whichever one the reader understands is
// legible. `prefix` picks whether the answer sets the personal or the group language.
function langKeyboard(prefix) {
  return {
    inline_keyboard: [LANGS.map((l) => ({ text: l.label, callback_data: `${prefix}:${l.id}` }))],
  };
}

// The Mini App is served from GitHub Pages, a different origin, so the browser preflights
// every POST to /api/*. Restricted to the known origin rather than "*" — this endpoint
// accepts writes, so it shouldn't be callable from any page that fancies it.
function corsHeaders(env) {
  return {
    "access-control-allow-origin": env.APP_ORIGIN || "https://ramzeus3010.github.io",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
  };
}

const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(env) },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // A plain GET is how you check the worker is up without going through Telegram.
    if (request.method === "GET") {
      return new Response("chetamba bot: alive. POST here from Telegram's webhook.", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(url.pathname, request, env);
      } catch (err) {
        console.error("api failed", err && err.stack ? err.stack : err);
        return json(env, { ok: false, error: "server error" }, 500);
      }
    }

    // Telegram echoes the secret we registered with setWebhook. Without this check the
    // endpoint is a public URL that anyone can post fabricated updates to.
    if (env.WEBHOOK_SECRET) {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("ok"); // malformed body: swallow, don't make Telegram retry
    }

    try {
      await handleUpdate(update, env);
    } catch (err) {
      // Deliberately not rethrown. A non-2xx makes Telegram redeliver the same update on a
      // backoff, so one bad message would turn into a retry storm.
      console.error("handleUpdate failed", err && err.stack ? err.stack : err);
    }

    return new Response("ok");
  },

  // Two fixed beats a week, both in league time (UTC+5). Monday opens the new week, Sunday
  // evening is the nudge that actually gets someone off the couch while it still counts.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(event.cron, env));
  },
};

// ---------- The Mini App's API ----------
async function handleApi(pathname, request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json(env, { ok: false, error: "bad json" }, 400); }

  // Identity comes from Telegram's signature, never from the request body. A client that
  // simply claims to be user 12345 gets nowhere.
  const caller = await verifyInitData(body.initData, env.BOT_TOKEN);
  if (!caller) return json(env, { ok: false, error: "unverified" }, 401);

  const today = leagueTodayISO();
  const existing = (await readUser(env, caller.id)) || emptyUser(caller.id, caller.firstName);

  // Errors returned to the app are written in the CALLER's language: the app shows them
  // verbatim, because only the Worker knows why the request failed.
  const lang = isLang(body.lang) ? body.lang : await userLang(env, caller.id, null);

  if (pathname === "/api/join") {
    const code = String(body.code || "").trim().toUpperCase();
    const groupId = code ? await env.CHETAMBA.get(codeKey(code)) : null;
    if (!groupId) return json(env, { ok: false, error: t(lang, "bot.badCode") }, 400);

    // Leaving an old group shouldn't strand a membership key pointing at this user.
    if (existing.groupId && existing.groupId !== groupId) {
      await env.CHETAMBA.delete(memberKey(existing.groupId, caller.id));
    }
    // Sync first, so someone who joins mid-season appears at their real score rather than at
    // a blank 800 until their next workout.
    const synced = applySync(existing, body, today);
    const joined = { ...synced, groupId, name: body.name || synced.name || caller.firstName, lang };
    await writeUser(env, joined);
    await env.CHETAMBA.put(memberKey(groupId, caller.id), "1");

    const title = (await env.CHETAMBA.get(groupKey(groupId))) || t(lang, "bot.groupFallback");
    // Announced in the GROUP's language, not the joiner's — everyone in the chat reads it.
    const gl = await groupLang(env, groupId);
    await say(env, groupId, t(gl, "bot.joinedBoard", { name: escapeMd(joined.name) }), { lang: gl });
    return json(env, { ok: true, groupTitle: title });
  }

  if (pathname === "/api/publish") {
    const updated = applyPublish(existing, body, today);
    await writeUser(env, updated);

    // No group yet is fine — the score is still recorded, there's just nowhere to announce it.
    if (!updated.groupId) return json(env, { ok: true, posted: false, standing: standingFor(updated, today) });

    const after = await groupStandings(env, updated.groupId, today);
    const gl = await groupLang(env, updated.groupId);
    await say(env, updated.groupId, finishedMessage(updated, body, after, today, gl), { lang: gl });
    return json(env, { ok: true, posted: true, standing: standingFor(updated, today) });
  }

  // Reconcile the Worker's copy with the client's. Called on app open, so the board is
  // correct even for someone who hasn't finished a workout since joining. Deliberately does
  // NOT announce anything to the group — this is a correction, not an event.
  if (pathname === "/api/sync") {
    const updated = applySync(existing, body, today);
    await writeUser(env, updated);
    return json(env, { ok: true, standing: standingFor(updated, today) });
  }

  // AI program generation. The only endpoint that costs real money per call, which is why
  // identity is verified above and the generator rate-limits per user.
  if (pathname === "/api/program") {
    const result = await generateProgram(env, {
      prompt: body.prompt,
      lang,
      profile: body.profile,
      userId: caller.id,
      todayIso: today,
    });
    // A failed generation is a 200 with ok:false — the client renders `reason` as a
    // translated message. A non-2xx here would be indistinguishable from the network errors
    // relay() already swallows.
    return json(env, result);
  }

  if (pathname === "/api/me") {
    const standings = existing.groupId ? await groupStandings(env, existing.groupId, today) : [];
    return json(env, { ok: true, standing: standingFor(existing, today), groupId: existing.groupId, standings });
  }

  return json(env, { ok: false, error: "unknown endpoint" }, 404);
}

// ---------- Message rendering ----------
// Telegram's legacy Markdown treats these as syntax; a name containing one breaks the whole
// message, and Telegram rejects it rather than sending it plain.
function escapeMd(s) {
  return String(s == null ? "" : s).replace(/([*_`\[\]])/g, "\\$1");
}

/**
 * Resolve the label the client sent for a finished session.
 *
 * The app publishes a translation KEY ("day.upper-a", "act.hiking") rather than finished
 * text, because the publisher's language and the board's language are different settings and
 * the board's is the one that wins here. A custom day the user named themselves has no key —
 * it arrives as `labelText` and is used verbatim, since translating what someone typed is not
 * ours to do.
 */
function sessionLabel(payload, lang) {
  const key = String(payload.label || "");
  if (key) {
    const translated = t(lang, key);
    if (translated !== key) return translated;
  }
  if (payload.labelText) return payload.labelText;
  return t(lang, payload.kind === "activity" ? "bot.anActivity" : "bot.aWorkout");
}

/**
 * The standings, as an aligned table.
 *
 * Telegram has no table syntax, so the columns are held in place by a fenced code block —
 * monospace is the only alignment guarantee across iOS, Android and desktop. Two consequences
 * shape everything below:
 *
 *   1. **No emoji inside the block.** Medals render at variable width in a monospace face and
 *      knock every following column out of line, which is worse than having no medals. They
 *      go in the title instead.
 *   2. **No markdown inside the block**, so names can't be bolded — but they also can't break
 *      the message, since a `*` in a name is literal here rather than syntax. Backticks still
 *      have to go, because they would close the fence.
 *
 * Columns are Rating and this week's effort — the same two numbers the app shows, under the
 * same names. The board is RANKED on the 40/60 combination of them, which is why the footer
 * says so: a ranking you can't derive from the visible columns otherwise looks arbitrary.
 */
const stripFence = (s) => String(s == null ? "" : s).replace(/[`\n]/g, "");

function truncName(name, width) {
  const clean = stripFence(name).trim() || "—";
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
}

// Column widths, in monospace characters. The row prefix is marker(1) + rank(2) + space(1),
// so the header is indented by exactly RANK_W to line up — an off-by-one here shifts every
// heading one column left of its numbers, which looks like a bug in the scores rather than in
// the padding. The rank is padded to two digits so a group of ten or more doesn't drift.
// Total width is 29 characters, which fits a narrow phone without wrapping; widening the name
// column is what breaks that first.
const RANK_W = 4;
const NAME_W = 10;
const RATING_W = 8;
const WEEK_W = 7;

function standingsTable(standings, lang, highlightId) {
  const head =
    " ".repeat(RANK_W) +
    t(lang, "bot.colName").padEnd(NAME_W) +
    t(lang, "bot.colRating").padStart(RATING_W) +
    t(lang, "bot.colWeek").padStart(WEEK_W);

  const rows = standings.map((s, i) => {
    // A marker rather than bold, since markdown is inert inside the fence.
    const mark = s.id === highlightId ? "▸" : " ";
    return (
      mark +
      String(i + 1).padStart(2) +
      " " +
      truncName(s.name, NAME_W).padEnd(NAME_W) +
      String(s.strength).padStart(RATING_W) +
      s.effort.toFixed(1).padStart(WEEK_W)
    );
  });

  return ["```", head, ...rows, "```"].join("\n");
}

function boardMessage(standings, asOfIso, title, lang, highlightId) {
  if (standings.length === 0) return t(lang, "bot.emptyBoard");
  return [
    `*${title}*`,
    t(lang, "bot.weekOf", { date: weekStartISO(asOfIso) }),
    standingsTable(standings, lang, highlightId),
    t(lang, "bot.rankedBy"),
  ].join("\n");
}

/**
 * Posted when someone finishes a workout: one headline line, then the standings.
 *
 * This replaced a prose summary that narrated movement ("Up to #2, past Daniyar") — which
 * read oddly in a group chat, and buried the numbers people actually wanted. The table shows
 * the same movement without anyone having to parse a sentence, and it shows it for everyone
 * rather than only for whoever just finished.
 */
function finishedMessage(user, payload, standings, asOfIso, lang) {
  const lines = [];
  const label = escapeMd(sessionLabel(payload, lang));
  if (payload.kind === "activity") {
    lines.push(t(lang, "bot.finishedActivity", { name: escapeMd(user.name), label, minutes: payload.minutes || 0 }));
  } else {
    lines.push(t(lang, "bot.finishedLift", { name: escapeMd(user.name), label }));
    // Exercise names are whatever the publisher's app displayed them as. Not re-translated:
    // the client already resolved built-ins, and a custom name is the user's own words.
    const names = (payload.exercises || []).slice(0, 6).map(escapeMd);
    if (names.length) lines.push(`_${names.join(" · ")}_`);
  }
  lines.push(standingsTable(standings, lang, user.id));
  lines.push(t(lang, "bot.rankedBy"));
  return lines.join("\n");
}

// ---------- Cron ----------
async function runCron(cron, env) {
  // Explicit rather than "anything that isn't Sunday is Monday" — otherwise adding a third
  // trigger later would quietly start announcing weekly winners at the wrong time.
  if (cron !== MONDAY_CRON && cron !== SUNDAY_CRON) {
    console.error("unrecognised cron, ignoring:", cron);
    return;
  }
  const listed = await env.CHETAMBA.list({ prefix: "group:" });
  const today = leagueTodayISO();

  for (const key of listed.keys) {
    const groupId = key.name.split(":")[1];
    const standings = await groupStandings(env, groupId, today);
    if (standings.length === 0) continue;
    const lang = await groupLang(env, groupId);

    // Sunday evening: the deadline nudge, while there's still time to act on it.
    if (cron === SUNDAY_CRON) {
      await say(env, groupId, boardMessage(standings, today, t(lang, "bot.finalHours"), lang), { lang });
      continue;
    }

    // Monday: last week's final table, then everyone's effort is back to zero. The table is
    // included because this is the last moment the finished week is visible — after this post
    // the effort column resets and the standings people were racing are gone.
    const winner = standings[0];
    await say(env, groupId, [
      t(lang, "bot.newWeek"),
      t(lang, "bot.lastWeekWinner", { name: escapeMd(winner.name), total: winner.total.toFixed(1) }),
      standingsTable(standings, lang, null),
    ].join("\n"), { lang });
  }
}

async function handleUpdate(update, env) {
  // The language buttons come back as callback queries, not messages.
  if (update.callback_query) {
    await handleLangChoice(update.callback_query, env);
    return;
  }

  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;
  const isPrivate = msg.chat.type === "private";
  const text = (msg.text || "").trim();
  const fromId = msg.from && msg.from.id;
  const fromLocale = msg.from && msg.from.language_code;

  // "/start@somebot arg" -> "start"
  const command = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;

  // In a group, everything is written in the board's language; in a DM, in the reader's own.
  const lang = isPrivate ? await userLang(env, fromId, fromLocale) : await groupLang(env, chatId);

  if (command === "start" || command === "app") {
    await sendOpenCard(chatId, isPrivate, t(lang, "bot.welcome"), env, lang);
    // Only in a DM, and only on a first /start: the guess from Telegram's locale is usually
    // right, so this confirms rather than interrogates. Asking in a group would be asking
    // everyone at once, and the group's language belongs to /register instead.
    if (isPrivate && command === "start") {
      const known = fromId ? await readUser(env, String(fromId)) : null;
      if (!known || !isLang(known.lang)) await askLanguage(chatId, lang, "lang", env);
    }
    return;
  }
  if (command === "help") {
    await sendOpenCard(chatId, isPrivate, t(lang, "bot.help"), env, lang);
    return;
  }

  // Changing your mind later, without hunting through the app.
  if (command === "language" || command === "lang") {
    await askLanguage(chatId, lang, isPrivate ? "lang" : "glang", env);
    return;
  }

  // Turns this chat into a leaderboard and hands back a code to paste into the app. Issuing a
  // fresh code each time is deliberate: it's how you re-invite people without any admin UI.
  if (command === "register") {
    if (isPrivate) {
      await say(env, chatId, t(lang, "bot.registerInGroup"), { isPrivate, lang });
      return;
    }
    const code = makeJoinCode();
    // Codes expire so a screenshot in an old chat can't be used to join months later.
    await env.CHETAMBA.put(codeKey(code), String(chatId), { expirationTtl: 7 * 24 * 60 * 60 });
    await env.CHETAMBA.put(groupKey(String(chatId)), msg.chat.title || t(lang, "bot.thisGroup"));

    // Seed the board's language from whoever ran /register, then immediately offer the choice.
    // A default beats a prompt nobody answers — without one the board would post in English
    // to a room that just registered it in Russian.
    const seeded = await groupLang(env, chatId);
    const boardLang = isLang(seeded) && (await env.CHETAMBA.get(groupLangKey(String(chatId))))
      ? seeded
      : detectLang(fromLocale);
    await env.CHETAMBA.put(groupLangKey(String(chatId)), boardLang);

    await say(env, chatId, t(boardLang, "bot.registered", { code }), { lang: boardLang });
    await askLanguage(chatId, boardLang, "glang", env);
    return;
  }

  if (command === "score" || command === "top") {
    const today = leagueTodayISO();
    // In a group, show that group. In a DM, show the board you belong to.
    let groupId = isPrivate ? null : String(chatId);
    if (isPrivate) {
      const me = fromId && (await readUser(env, String(fromId)));
      groupId = me && me.groupId;
    }
    if (!groupId) {
      await say(env, chatId, t(lang, "bot.notOnBoard"), { isPrivate, lang });
      return;
    }
    // A DM shows the board in the reader's own language; the group's own posts use the
    // board language. Same numbers either way — only the wording differs.
    const standings = await groupStandings(env, groupId, today);
    await say(env, chatId, boardMessage(standings, today, t(lang, "bot.standingsTitle"), lang, isPrivate ? String(fromId) : null), { isPrivate, lang });
    return;
  }

  // Anything else. Keep it short — this fires on stray messages, so don't be chatty.
  await sendOpenCard(chatId, isPrivate, t(lang, "bot.unknownCommand"), env, lang);
}

async function askLanguage(chatId, lang, prefix, env) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: t(lang, prefix === "glang" ? "bot.groupLangAsk" : "bot.langAsk"),
    reply_markup: langKeyboard(prefix),
  });
}

/**
 * A tap on one of the language buttons.
 *
 * Telegram spins the button forever until answerCallbackQuery is called, so that goes out
 * first and unconditionally — before any KV write that could fail and leave the tap hanging.
 */
async function handleLangChoice(cq, env) {
  const data = String(cq.data || "");
  const [prefix, choice] = data.split(":");
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;

  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  if (!chatId || !isLang(choice) || (prefix !== "lang" && prefix !== "glang")) return;

  if (prefix === "glang") {
    await env.CHETAMBA.put(groupLangKey(String(chatId)), choice);
    await say(env, chatId, t(choice, "bot.groupLangSet"), { lang: choice });
    return;
  }

  const id = String(cq.from && cq.from.id);
  if (!id) return;
  const existing = (await readUser(env, id)) || emptyUser(id, cq.from.first_name);
  await writeUser(env, { ...existing, lang: choice });
  await say(env, chatId, t(choice, "bot.langSet"), { isPrivate: true, lang: choice });
}

function openMarkup(isPrivate, env, lang = DEFAULT_LANG) {
  // web_app buttons only work in private chats. In groups Telegram rejects them, so fall
  // back to the plain direct link, which opens the same Mini App.
  const text = t(lang, "bot.openButton");
  const button = isPrivate
    ? { text, web_app: { url: env.MINI_APP_URL } }
    : { text, url: env.DIRECT_LINK };
  return { inline_keyboard: [[button]] };
}

async function sendOpenCard(chatId, isPrivate, body, env, lang = DEFAULT_LANG) {
  const reply_markup = openMarkup(isPrivate, env, lang);

  if (env.PREVIEW_IMAGE_URL) {
    const res = await tg(env, "sendPhoto", {
      chat_id: chatId,
      photo: env.PREVIEW_IMAGE_URL,
      caption: body,
      parse_mode: "Markdown",
      reply_markup,
    });
    if (res.ok) return;
    // A bad or unreachable image URL shouldn't mean the user gets nothing back.
    console.error("sendPhoto failed, falling back to text:", res.description);
  }

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: body,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup,
  });
}

/**
 * Send a message with the Open Chetamba button attached.
 *
 * Every outbound message goes through here rather than calling `tg("sendMessage")` directly,
 * because "attach the button" is the kind of rule that decays one forgotten call site at a
 * time. The one deliberate exception is the language prompt, which carries its own keyboard —
 * Telegram allows only one `reply_markup` per message.
 *
 * `isPrivate` picks the button variant: `web_app` buttons are rejected outside private chats,
 * and a rejected button fails the whole message rather than degrading, so a group must get the
 * plain-link form.
 */
async function say(env, chatId, text, { isPrivate = false, lang = DEFAULT_LANG, markdown = true } = {}) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...(markdown ? { parse_mode: "Markdown" } : {}),
    disable_web_page_preview: true,
    reply_markup: openMarkup(isPrivate, env, lang),
  });
}

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch (e) {
    json = { ok: false, description: `non-JSON response (${res.status})` };
  }
  if (!json.ok) console.error(`${method} failed:`, json.description);
  return json;
}
