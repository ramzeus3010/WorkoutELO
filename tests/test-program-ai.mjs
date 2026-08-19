// AI program generation — the validation layer.
//
// The model call itself isn't tested (it costs money and isn't deterministic). What IS tested
// is everything that runs on its output, because that's where the dangerous failures live: a
// hallucinated movement pattern makes an exercise silently unscoreable, and a program that
// ignores a stated exclusion hands someone the exact lift their back can't take.

import { validateProgram, PROGRAM_SCHEMA } from "../bot/program-ai.js";
import { MOVEMENT_PATTERNS } from "../src/scoring.js";
import { check, finish } from "./dom.mjs";

console.log("program-ai\n");

// ---------- The schema itself ----------
// Structured outputs only bind the model when the request is accepted, and OpenAI's strict
// mode rejects the whole call — with a 400, at runtime, in production — if any object in the
// schema omits `additionalProperties: false` or leaves a property out of `required`. Optional
// fields are simply not expressible. Adding a field and forgetting one of those is easy and
// invisible locally, so it's checked here.
{
  const problems = [];
  (function walk(node, path) {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") {
      if (node.additionalProperties !== false) problems.push(`${path}: needs additionalProperties:false`);
      const props = Object.keys(node.properties || {});
      const required = node.required || [];
      const missing = props.filter((p) => !required.includes(p));
      if (missing.length) problems.push(`${path}: not in required -> ${missing.join(", ")}`);
      props.forEach((p) => walk(node.properties[p], `${path}.${p}`));
    }
    if (node.type === "array") walk(node.items, `${path}[]`);
  })(PROGRAM_SCHEMA, "root");

  check("the schema satisfies strict-mode structured outputs", problems.length === 0, problems.join("\n       "));

  // The enum is the single most valuable constraint in the schema: an invented pattern id
  // makes an exercise silently unscoreable. It has to track scoring.js exactly.
  const enumIds = PROGRAM_SCHEMA.properties.days.items.properties.exercises.items.properties.pattern.enum;
  check(
    "the pattern enum matches scoring.js exactly",
    JSON.stringify(enumIds) === JSON.stringify(MOVEMENT_PATTERNS.map((p) => p.id)),
    JSON.stringify(enumIds)
  );
}

const day = (exercises) => ({ name: "Day A", subtitle: "", exercises });
const ex = (name, pattern = "push-horizontal") => ({ name, pattern, target: "3 x 8-12", rest: 90 });

const good = {
  name: "Upper / lower",
  summary: "Four days.",
  exclusions: [],
  days: [day([ex("Bench press"), ex("Row", "pull-horizontal")])],
};

// ---------- The happy path ----------
{
  const res = validateProgram(good);
  check("a well-formed program passes", res.ok, JSON.stringify(res));
}

// ---------- Shape ----------
check("null is rejected", !validateProgram(null).ok);
check("a program with no days is rejected", !validateProgram({ ...good, days: [] }).ok);
check("a day with no exercises is rejected", !validateProgram({ ...good, days: [day([])] }).ok);

{
  const tooMany = { ...good, days: Array.from({ length: 9 }, () => day([ex("Bench press")])) };
  check("too many days is rejected", !validateProgram(tooMany).ok, validateProgram(tooMany).reason);
}
{
  const fat = { ...good, days: [day(Array.from({ length: 20 }, (_, i) => ex(`Lift ${i}`)))] };
  check("too many exercises in one day is rejected", !validateProgram(fat).ok);
}

// ---------- Movement patterns ----------
// The schema's enum should prevent this, but the check is cheap and the failure is silent:
// an unknown pattern logs fine and simply never counts toward the score.
{
  const bogus = { ...good, days: [day([ex("Bench press", "chest-day")])] };
  const res = validateProgram(bogus);
  check("an invented movement pattern is rejected", !res.ok && res.reason === "ai.errPattern", res.reason);
}
{
  // Every real id must pass, or the validator would reject legitimate output. Split across
  // two days because there are thirteen patterns and the per-day ceiling is twelve.
  const half = Math.ceil(MOVEMENT_PATTERNS.length / 2);
  const all = {
    ...good,
    days: [
      day(MOVEMENT_PATTERNS.slice(0, half).map((p, i) => ex(`Lift ${i}`, p.id))),
      day(MOVEMENT_PATTERNS.slice(half).map((p, i) => ex(`Lift b${i}`, p.id))),
    ],
  };
  check("every real pattern id is accepted", validateProgram(all).ok, JSON.stringify(validateProgram(all)));
}

// ---------- Exclusions — the one that matters ----------
// The state doc is explicit that the model WILL produce an RDL for someone who said no RDLs.
// The model reports what it understood to be excluded; this holds it to its own reading.
{
  const violated = {
    ...good,
    exclusions: ["deadlift"],
    days: [day([ex("Romanian deadlift", "hinge")])],
  };
  const res = validateProgram(violated);
  check(
    "an excluded movement appearing as a variant is caught",
    !res.ok && res.reason === "ai.errExcluded",
    res.reason
  );
}
{
  const cased = {
    ...good,
    exclusions: ["Hip Thrust"],
    days: [day([ex("Barbell hip thrust", "hinge")])],
  };
  check("the exclusion check ignores case", !validateProgram(cased).ok);
}
{
  const russian = {
    ...good,
    exclusions: ["становая тяга"],
    days: [day([ex("Румынская становая тяга", "hinge")])],
  };
  check("exclusions work in Russian too", !validateProgram(russian).ok, validateProgram(russian).reason);
}
{
  // A clean program that merely mentions an unrelated word must not trip the check.
  const fine = {
    ...good,
    exclusions: ["deadlift"],
    days: [day([ex("Bench press"), ex("Leg press", "squat")])],
  };
  check("an unrelated program with exclusions still passes", validateProgram(fine).ok);
}
{
  // Two-character fragments would match nearly every exercise name and reject everything.
  const fragment = { ...good, exclusions: ["no", "a"], days: [day([ex("Bench press")])] };
  check("short exclusion fragments are ignored rather than matching everything",
    validateProgram(fragment).ok, JSON.stringify(validateProgram(fragment)));
}

// ---------- Storage ceiling ----------
// CloudStorage caps a value at 4096 chars and one program day is one value, so a day that
// doesn't fit can't be saved at all. Better to reject here than at save time.
{
  const huge = {
    ...good,
    days: [day(Array.from({ length: 11 }, (_, i) => ({
      name: `Exercise with a very long descriptive name number ${i} `.repeat(6),
      pattern: "push-horizontal",
      target: "3 x 8-12",
      rest: 90,
    })))],
  };
  const res = validateProgram(huge);
  check("a day too large for CloudStorage is rejected", !res.ok, res.reason);
}

// ---------- Reasons are keys, not prose ----------
{
  const res = validateProgram({ ...good, days: [] });
  check("failure reasons are translation keys", /^ai\.err/.test(res.reason), res.reason);
}

finish("program-ai");
