// Cross-user scoring: the maths that has to be comparable BETWEEN people.
//
// Imports src/scoring.js directly rather than driving the UI, because this is pure maths and
// the properties worth protecting are numeric, not visual. It also means this suite needs no
// build — deliberate, so a broken bundle can't hide a broken score.
//
// The load-bearing assertion is "honest logging never costs points" (the monotonic-curve
// block). Every number in this app is self-reported, so a duration curve that declines after
// a peak would pay people to under-report: hike 9 hours, type 7, score better. That failure
// is invisible — the score still looks plausible — so it gets an exhaustive test.

import {
  ACTIVITY_TYPES, activityEffort, activityTypeById,
  RANKED_SLOTS, isRankedSlot,
  strengthScore, patternPerformance,
  liftingEffort, sessionEffort, weeklyEffort, weekStartISO,
  scoreboardEntry, strengthPoints, effortPoints,
  STRENGTH_BASELINE, SESSIONS_PER_DAY_CAP,
} from "../src/scoring.js";

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`); }
}

const set = (weight, reps) => ({ weight, reps });
const lift = (pattern, sets) => ({ name: pattern, pattern, sets });
const liftSession = (date, exercises) => ({ id: date + exercises.length, date, kind: "lift", exercises });
const activity = (date, activityType, minutes) => ({ id: date + activityType, date, kind: "activity", activityType, minutes });

// ------------------------------------------------- duration curves never punish honesty
console.log("activity duration curves");
{
  let allMonotonic = true;
  let allUnderCeiling = true;
  let worstDrop = 0;
  ACTIVITY_TYPES.forEach((t) => {
    let prev = -1;
    for (let m = 0; m <= 900; m += 1) {
      const v = activityEffort(t.id, m);
      if (v < prev - 1e-12) { allMonotonic = false; worstDrop = Math.max(worstDrop, prev - v); }
      if (v > t.ceiling + 1e-9) allUnderCeiling = false;
      prev = v;
    }
  });
  check("logging MORE time never scores less, for every activity, 0-900 min", allMonotonic,
    `largest decrease seen: ${worstDrop}`);
  check("no activity can exceed its ceiling however long you log", allUnderCeiling);

  // The specific shape asked for: hiking should flatten out around 7-8h, not fall off it.
  const h7 = activityEffort("hiking", 7 * 60);
  const h8 = activityEffort("hiking", 8 * 60);
  const h9 = activityEffort("hiking", 9 * 60);
  check("a 9h hike still beats a 7h hike", h9 > h7, `7h=${h7.toFixed(3)} 9h=${h9.toFixed(3)}`);
  check("but only barely — the 8th hour adds under 3% of the ceiling",
    (h8 - h7) / activityTypeById("hiking").ceiling < 0.03,
    `delta=${(h8 - h7).toFixed(4)}`);

  // Cross-activity sanity: a long hike is worth more than a basketball game, not 3x more.
  const b2 = activityEffort("basketball", 120);
  check("2h basketball lands near 1.5 solid sessions", b2 > 1.4 && b2 < 1.6, `${b2.toFixed(3)}`);
  check("a 5h hike beats 2h basketball", activityEffort("hiking", 300) > b2);
  check("but a 5h hike is worth under 2x a basketball game", activityEffort("hiking", 300) < b2 * 2);
  check("walking has a low ceiling so it can't rival training",
    activityEffort("walking", 600) < activityEffort("basketball", 60));
  check("zero minutes earns zero", activityEffort("basketball", 0) === 0);
  check("an unknown activity type falls back rather than throwing", activityEffort("quidditch", 60) > 0);
}

// ------------------------------------------------- one exercise must not equal six
console.log("\nlifting effort counts patterns, not exercises");
{
  const four = [set(40, 10), set(40, 10), set(40, 10), set(40, 10)];
  const onePattern = liftSession("2026-08-17", [lift("push-horizontal", four)]);
  const sixPatterns = liftSession("2026-08-17", [
    lift("push-horizontal", four), lift("pull-horizontal", four), lift("squat", four),
    lift("hinge", four), lift("push-vertical", four), lift("core", four),
  ]);

  const one = liftingEffort(onePattern);
  const six = liftingEffort(sixPatterns);
  check("six patterns clearly beat one", six > one * 2, `one=${one.toFixed(3)} six=${six.toFixed(3)}`);
  check("but not six times over — junk volume shouldn't pay linearly", six < one * 6);

  // The reason it's patterns and not exercise count: six curl variations is one pattern.
  const sixCurls = liftSession("2026-08-17", [
    lift("isolation-upper", four), lift("isolation-upper", four), lift("isolation-upper", four),
    lift("isolation-upper", four), lift("isolation-upper", four), lift("isolation-upper", four),
  ]);
  const oneCurl = liftSession("2026-08-17", [lift("isolation-upper", four)]);
  check("six exercises hitting the SAME pattern score like one",
    Math.abs(liftingEffort(sixCurls) - liftingEffort(oneCurl)) < 1e-9);

  check("empty sets earn nothing", liftingEffort(liftSession("2026-08-17", [lift("squat", [])])) === 0);
  check("an exercise with no recognised pattern earns nothing",
    liftingEffort(liftSession("2026-08-17", [lift("nonsense", four)])) === 0);
}

// ------------------------------------------------- basketball: zero strength, real effort
console.log("\nactivities count for showing up, not for strength");
{
  const bball = activity("2026-08-17", "basketball", 120);
  const before = strengthScore([], 80, "2026-08-17").score;
  const after = strengthScore([bball], 80, "2026-08-17").score;
  check("a 2h basketball game moves the strength score not at all", before === after,
    `${before} -> ${after}`);
  check("but it earns real effort", sessionEffort(bball) > 1);
  check("an untrained log sits exactly at baseline", before === STRENGTH_BASELINE, `${before}`);
}

// ------------------------------------------------- comparability between people
console.log("\nthe ranked score is comparable between people");
{
  const four = [set(40, 10), set(40, 10), set(40, 10), set(40, 10)];
  const logs = [liftSession("2026-08-17", [lift("push-horizontal", four), lift("squat", four)])];

  // The point of the fixed slot set: the function has no program argument at all, so there is
  // no way for one athlete's split to be scored on a different denominator from another's.
  check("strengthScore takes no program — the denominator cannot vary per user",
    strengthScore.length === 3);

  const a = strengthScore(logs, 80, "2026-08-17").score;
  const b = strengthScore([...logs], 80, "2026-08-17").score;
  check("identical logs give identical scores", a === b);

  // Adding an off-program / unrankable exercise must not dilute anything.
  const withExtra = [liftSession("2026-08-17", [
    lift("push-horizontal", four), lift("squat", four), lift("conditioning", [set(0, 600)]),
  ])];
  check("logging extra unranked work never lowers the strength score",
    strengthScore(withExtra, 80, "2026-08-17").score >= a);

  // Allometric scaling: same load-to-bodyweight RATIO, heavier athlete is relatively stronger.
  const light = strengthScore([liftSession("2026-08-17", [lift("push-horizontal", [set(30, 10)])])], 60, "2026-08-17").score;
  const heavy = strengthScore([liftSession("2026-08-17", [lift("push-horizontal", [set(47.5, 10)])])], 95, "2026-08-17").score;
  check("equal bodyweight ratios do NOT tie — the heavier athlete rates higher", heavy > light,
    `60kg=${light} 95kg=${heavy}`);

  // Scale anchors, straight from the brief: 1200 = average, 2000 = top 5%.
  const avgAll = [liftSession("2026-08-17", RANKED_SLOTS.map((s) =>
    lift(s.id, [s.type === "weight" ? set(s.avg * 80 * (80 / 80), 10) : set(0, s.avg)])))];
  const avgScore = strengthScore(avgAll, 80, "2026-08-17").score;
  check("average performance across every slot lands near 1200", Math.abs(avgScore - 1200) <= 25, `${avgScore}`);
}

// ------------------------------------------------- decay
console.log("\ndecay slows you down but never reverses past average");
{
  const strong = [liftSession("2026-06-01", RANKED_SLOTS.map((s) =>
    lift(s.id, [s.type === "weight" ? set(s.avg * 80 * 2, 10) : set(0, s.avg * 2)])))];
  const fresh = strengthScore(strong, 80, "2026-06-02").score;
  const stale = strengthScore(strong, 80, "2026-12-01").score;
  check("a fresh elite log rates near the top", fresh >= 1950, `${fresh}`);
  check("six months later it has decayed", stale < fresh);
  check("but never below the 1200 average it decays toward", stale >= 1195, `${stale}`);
}

// ------------------------------------------------- logging an easy day must be free
console.log("\nhonest logging of light sessions costs nothing");
{
  const heavy = liftSession("2026-08-17", [lift("push-horizontal", [set(60, 10)])]);
  const deload = liftSession("2026-08-19", [lift("push-horizontal", [set(25, 8)])]);

  const afterHeavy = strengthScore([heavy], 80, "2026-08-19").score;
  const afterDeload = strengthScore([heavy, deload], 80, "2026-08-19").score;
  // Not equality: the light day also refreshes how recently the pattern was trained, so it
  // nudges the score UP. What must never happen is it going down.
  check("a light session logged after a heavy one does not lower the score",
    afterDeload >= afterHeavy, `${afterHeavy} -> ${afterDeload}`);

  // ...and the reverse must still work: a genuine PR raises it immediately.
  const pr = liftSession("2026-08-19", [lift("push-horizontal", [set(80, 10)])]);
  check("but a new personal best raises it straight away",
    strengthScore([heavy, pr], 80, "2026-08-19").score > afterHeavy);

  // The best must still fade with age, or one lucky session would rate you forever.
  check("a personal best decays as it ages",
    strengthScore([heavy], 80, "2027-02-17").score < afterHeavy);

  // Decay measures when you last TRAINED the pattern, not when you set the best. Otherwise
  // benching the same weight every week goes stale while you're actively training it.
  const weekly = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"]
    .map((d, i) => ({ ...liftSession(d, [lift("push-horizontal", [set(60, 10)])]), id: "w" + i }));
  check("training the same weight weekly does NOT decay",
    strengthScore(weekly, 80, "2026-09-14").score === strengthScore([weekly[0]], 80, "2026-08-17").score,
    `${strengthScore(weekly, 80, "2026-09-14").score} vs ${strengthScore([weekly[0]], 80, "2026-08-17").score}`);

  // ...but abandoning the pattern entirely still fades, or nothing would ever go stale.
  check("abandoning a pattern still decays it",
    strengthScore(weekly, 80, "2026-12-14").score < strengthScore(weekly, 80, "2026-09-14").score);
}

// ------------------------------------------------- the week
console.log("\nweekly effort resets on Monday");
{
  check("weekStartISO of a Monday is itself", weekStartISO("2026-08-17") === "2026-08-17");
  check("weekStartISO of a Sunday is the Monday before", weekStartISO("2026-08-23") === "2026-08-17");
  check("weekStartISO of a Wednesday is the Monday before", weekStartISO("2026-08-19") === "2026-08-17");

  const four = [set(40, 10), set(40, 10), set(40, 10), set(40, 10)];
  const lastWeek = liftSession("2026-08-14", [lift("squat", four)]);
  const thisWeek = liftSession("2026-08-19", [lift("squat", four)]);
  const w = weeklyEffort([lastWeek, thisWeek], "2026-08-19");
  check("last week's session doesn't count toward this week", w.sessions === 1);
  check("the week starts on the right Monday", w.weekStart === "2026-08-17");
  check("future-dated sessions are excluded",
    weeklyEffort([liftSession("2026-08-21", [lift("squat", four)])], "2026-08-19").sessions === 0);

  // Dumping a backlog into one day must not pay out.
  const many = Array.from({ length: 6 }, (_, i) => ({
    ...liftSession("2026-08-19", [lift("squat", four)]), id: "s" + i,
  }));
  const capped = weeklyEffort(many, "2026-08-19");
  check(`at most ${SESSIONS_PER_DAY_CAP} sessions a day are counted`, capped.sessions === SESSIONS_PER_DAY_CAP);
  check("spreading the same work across days beats dumping it in one",
    weeklyEffort(
      ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"].map((d, i) => ({
        ...liftSession(d, [lift("squat", four)]), id: "d" + i,
      })), "2026-08-20").effort > capped.effort);
}

// ------------------------------------------------- the combined number
console.log("\nthe combined score is 40 strength / 60 effort");
{
  check("baseline strength is worth zero points", strengthPoints(800) === 0);
  check("2000 strength is worth full points", strengthPoints(2000) === 100);
  check("strength points are clamped, not negative", strengthPoints(400) === 0);
  check("effort points are clamped at 100", effortPoints(99) === 100);

  const four = [set(40, 10), set(40, 10), set(40, 10), set(40, 10)];
  const e = scoreboardEntry([liftSession("2026-08-19", [lift("squat", four), lift("push-horizontal", four)])], 80, "2026-08-19");
  check("a scoreboard entry reports both columns, not just a total",
    typeof e.strength === "number" && typeof e.weeklyEffort === "number" && typeof e.total === "number");
  check("the total is the 40/60 mix of the two",
    Math.abs(e.total - (0.4 * e.strengthPoints + 0.6 * e.effortPoints)) < 0.15,
    `total=${e.total} s=${e.strengthPoints} e=${e.effortPoints}`);

  // Effort must be the axis you can actually move week to week.
  const oneSession = scoreboardEntry([liftSession("2026-08-19", [lift("squat", four)])], 80, "2026-08-19");
  const fourSessions = scoreboardEntry(
    ["2026-08-17", "2026-08-18", "2026-08-19"].map((d, i) => ({
      ...liftSession(d, [lift("squat", four), lift("push-horizontal", four), lift("pull-horizontal", four)]), id: "x" + i,
    })), 80, "2026-08-19");
  check("training three times outscores training once, on the same strength",
    fourSessions.total > oneSession.total,
    `${oneSession.total} -> ${fourSessions.total}`);

  const noBodyweight = scoreboardEntry([liftSession("2026-08-19", [lift("squat", four)])], 0, "2026-08-19");
  check("a missing bodyweight yields baseline strength rather than NaN",
    noBodyweight.strength === STRENGTH_BASELINE && !Number.isNaN(noBodyweight.total));
}

// ------------------------------------------------- slot set integrity
console.log("\nranked slot set");
{
  check("conditioning is not a strength slot", !isRankedSlot("conditioning"));
  check("every other movement pattern is", RANKED_SLOTS.length === 12);
  check("slot ids are unique", new Set(RANKED_SLOTS.map((s) => s.id)).size === RANKED_SLOTS.length);
  check("every slot carries a positive weight", RANKED_SLOTS.every((s) => s.weight > 0));
  check("patternPerformance returns null rather than throwing on junk",
    patternPerformance(null, 80, RANKED_SLOTS[0]) === null &&
    patternPerformance({ sets: [] }, 80, RANKED_SLOTS[0]) === null);
}

if (failures > 0) {
  console.log(`\ntest-scoring: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\ntest-scoring: all checks passed");
