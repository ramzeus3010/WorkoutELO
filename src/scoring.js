/**
 * Chetamba scoring — the numbers that are comparable BETWEEN people.
 *
 * WHY THIS IS A SEPARATE MODULE
 * Two consumers need identical answers: the Mini App (renders your score) and the bot Worker
 * (answers /score in the group without any client running). If each had its own copy of this
 * maths they would drift, and the group leaderboard would quietly disagree with the app.
 * So: plain ESM, no React, no DOM, no imports. Importable by esbuild, by node for tests, and
 * by a Cloudflare Worker.
 *
 * WHY IT DOESN'T REPLACE THE EXISTING RATING
 * app.jsx's computeEloTrajectory stays exactly as it is. That rating is program-relative and
 * deliberately forgiving — it answers "am I getting stronger than I was", which is the right
 * question for one person and the wrong one for a leaderboard. Three properties make it
 * non-comparable between people:
 *
 *   1. Your program is the denominator, so deleting a lift you're bad at raises your rating.
 *      Fine as a self-honesty tool; a cheat button once friends can see it.
 *   2. Untouched slots pull toward neutral, so a 6-lift program suffers less drag than an
 *      18-lift one. Smaller program, higher number, for free.
 *   3. load/bodyweight is linear, and strength doesn't scale linearly with bodyweight. The
 *      lightest person in any group wins by arithmetic.
 *
 * This module fixes all three for the ranked number, and leaves the personal one alone.
 */

// ---------- Movement patterns ----------
// The single source of truth. app.jsx imports this rather than keeping its own copy.
// multiplier / type / avg keep the meaning they had in app.jsx: importance weight, how the
// exercise is measured, and the benchmark value for an "average person" at REFERENCE_BW_KG.
export const MOVEMENT_PATTERNS = [
  { id: "push-horizontal", label: "Horizontal push", hint: "bench, chest press, dips", multiplier: 1.5, type: "weight", avg: 0.18 },
  { id: "push-vertical", label: "Overhead push", hint: "shoulder press, OHP", multiplier: 1.5, type: "weight", avg: 0.12 },
  { id: "pull-horizontal", label: "Row", hint: "any rowing movement", multiplier: 1.5, type: "weight", avg: 0.21 },
  { id: "pull-vertical", label: "Pulldown / pull-up", hint: "lats", multiplier: 1.5, type: "weight", avg: 0.46 },
  { id: "squat", label: "Squat / leg press", hint: "loaded knee bend", multiplier: 1.5, type: "weight", avg: 0.60 },
  { id: "hinge", label: "Hinge", hint: "glutes and hamstrings", multiplier: 1.4, type: "weight", avg: 0.30 },
  { id: "lunge", label: "Lunge / split squat", hint: "one leg at a time", multiplier: 1.3, type: "weight", avg: 0.15 },
  { id: "isolation-upper", label: "Arm / shoulder isolation", hint: "curls, raises, extensions", multiplier: 0.75, type: "weight", avg: 0.10 },
  { id: "isolation-lower", label: "Leg isolation", hint: "extensions, curls", multiplier: 0.8, type: "weight", avg: 0.40 },
  { id: "calves", label: "Calves", hint: "counted in reps", multiplier: 0.55, type: "reps", avg: 20 },
  { id: "bodyweight-reps", label: "Bodyweight reps", hint: "push-ups, back extensions", multiplier: 0.75, type: "reps", avg: 15 },
  { id: "core", label: "Core hold", hint: "planks — logged in seconds", multiplier: 0.5, type: "duration", avg: 45 },
  { id: "conditioning", label: "Conditioning", hint: "rowing, bike — logged in seconds", multiplier: 0.6, type: "duration", avg: 480 },
];

export function patternById(id) {
  return MOVEMENT_PATTERNS.find((p) => p.id === id) || null;
}

// ---------- The ranked slot set ----------
// Every pattern except conditioning. Conditioning is time spent, not strength — it earns on
// the effort axis instead, and letting it into the strength denominator would mean someone
// who only rows reads as "strong".
//
// This list is FIXED and identical for everyone. That is the entire point: your program
// decides how you FILL these slots, not which slots exist, so editing your program can no
// longer move your ranked score in either direction.
export const RANKED_SLOTS = MOVEMENT_PATTERNS.filter((p) => p.id !== "conditioning").map((p) => ({
  id: p.id,
  label: p.label,
  weight: p.multiplier,
  type: p.type,
  avg: p.avg,
}));

const RANKED_SLOT_IDS = new Set(RANKED_SLOTS.map((s) => s.id));
export const isRankedSlot = (patternId) => RANKED_SLOT_IDS.has(patternId);

// ---------- Bodyweight normalisation ----------
// Strength scales roughly with bodyweight^(2/3) (surface-area law — it's why powerlifting
// uses Wilks/DOTS rather than a straight load/bodyweight ratio). Dividing by bodyweight
// linearly, as the personal rating does, systematically favours the lightest person in the
// group. Invisible when you only compare yourself to yourself; decisive on a leaderboard
// containing a 62 kg friend and a 95 kg friend.
export const ALLOMETRIC_EXP = 0.67;
export const REFERENCE_BW_KG = 80;

// The avg benchmarks were calibrated as plain load/bodyweight ratios, so scale them into
// allometric space. The two formulas agree exactly at REFERENCE_BW_KG, which keeps the
// existing benchmark numbers meaningful instead of silently re-tuning every one of them.
function allometricBenchmark(avg) {
  return avg * Math.pow(REFERENCE_BW_KG, 1 - ALLOMETRIC_EXP);
}

/**
 * How well one logged exercise performed against its pattern's benchmark.
 * 1.0 = average person at your bodyweight, 2.0 = the "top 5%" end of the estimate.
 * Returns null when the entry can't be scored (no sets, no bodyweight, unknown pattern).
 */
export function patternPerformance(entry, bodyweightKg, slot) {
  if (!entry || !slot || !bodyweightKg) return null;
  const sets = entry.sets || [];
  if (sets.length === 0) return null;

  // Top set by load, matching how the Progress tab and the personal rating already read a
  // session. Drop-set weights are deliberately ignored.
  const top = sets.reduce((best, s) => ((s.weight || 0) > (best.weight || 0) ? s : best), sets[0]);

  if (slot.type === "weight") {
    if (!top.weight || !top.reps) return null;
    const adjusted = top.weight / Math.pow(bodyweightKg, ALLOMETRIC_EXP);
    // reps/10 keeps the existing shape: the benchmark describes a set of ~10.
    return (adjusted * (top.reps / 10)) / allometricBenchmark(slot.avg);
  }
  // reps and duration are already bodyweight-independent (a plank is a plank).
  if (slot.type === "reps" || slot.type === "duration") {
    if (!top.reps) return null;
    return top.reps / slot.avg;
  }
  return null;
}

// ---------- Strength score ----------
// Same decay shape as the personal rating: an untouched slot fades toward neutral 1.0 rather
// than to zero, so neglecting a lift slows your climb but never reverses it (§6 — that was an
// explicit product requirement and it survives here).
export const STRENGTH_HALF_LIFE_DAYS = 21;
export const STRENGTH_NEUTRAL = 1.0;
// A slot you have NEVER logged is different from one you logged and let fade, and the two
// need different values or the scale breaks. Contribution 1.0 means "average person", which
// maps to 1200 — so if never-trained slots counted as neutral, a brand new user with an empty
// log would open the app already rated average. Untrained is 0.5, which puts a completely
// empty log at exactly STRENGTH_BASELINE. Decay still fades TOWARD 1.0, never toward this,
// so neglecting a lift you have trained can't drag you below average (§6).
export const STRENGTH_UNTRAINED = 0.5;
export const STRENGTH_BASELINE = 800;
export const STRENGTH_CEILING = 2600;
export const STRENGTH_FLOOR = 400;

function daysBetween(aIso, bIso) {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((a - b) / 86400000));
}

/**
 * Best recent performance per ranked slot, decayed by how long ago it was set.
 * Sessions may be lifting sessions or activities; activities contribute nothing here.
 */
export function slotStateFrom(sessions, bodyweightKg, asOfIso) {
  const best = {}; // slotId -> { p, date }
  (sessions || []).forEach((session) => {
    if (session.kind === "activity") return; // basketball does not make you stronger, measurably
    (session.exercises || []).forEach((entry) => {
      const slot = RANKED_SLOTS.find((s) => s.id === entry.pattern);
      if (!slot) return;
      const p = patternPerformance(entry, bodyweightKg, slot);
      if (p === null || !isFinite(p)) return;
      // Two separate facts, deliberately not conflated:
      //   p    — your BEST performance in this pattern. Not your most recent: taking the most
      //          recent would mean a deload week or one bad day lowers your score, i.e. it
      //          would pay you not to log them. Honest logging must never cost points.
      //   date — the LAST time you trained the pattern at all, which is what decay measures.
      // Dating the decay from the best instead would punish consistency: bench the same
      // weight every week and your "best" date never moves, so you would go stale while
      // actually training the lift weekly.
      const prev = best[slot.id];
      best[slot.id] = {
        p: prev ? Math.max(prev.p, p) : p,
        date: prev && prev.date > session.date ? prev.date : session.date,
      };
    });
  });

  return RANKED_SLOTS.map((slot) => {
    const st = best[slot.id];
    if (!st) return { id: slot.id, label: slot.label, weight: slot.weight, contribution: STRENGTH_UNTRAINED, daysSince: null, raw: null };
    const daysSince = daysBetween(asOfIso, st.date);
    const decay = Math.pow(0.5, daysSince / STRENGTH_HALF_LIFE_DAYS);
    return {
      id: slot.id,
      label: slot.label,
      weight: slot.weight,
      contribution: STRENGTH_NEUTRAL + (st.p - STRENGTH_NEUTRAL) * decay,
      daysSince,
      raw: st.p,
    };
  });
}

/**
 * The ranked strength number. Note what it does NOT take: the user's program. It cannot,
 * by construction, be moved by editing your split.
 */
export function strengthScore(sessions, bodyweightKg, asOfIso) {
  // Without a bodyweight nothing here is computable — every load-based benchmark divides by
  // it. This is why onboarding has to collect it before anything else.
  if (!bodyweightKg) return { score: STRENGTH_BASELINE, slots: [], covered: 0 };
  const slots = slotStateFrom(sessions, bodyweightKg, asOfIso);
  let sumW = 0;
  let sumWP = 0;
  slots.forEach((s) => {
    sumW += s.weight;
    sumWP += s.weight * s.contribution;
  });
  const pRolling = sumW > 0 ? sumWP / sumW : STRENGTH_NEUTRAL;

  // Same mapping the personal rating converges on (expected p = (rating-400)/800), applied
  // directly rather than iteratively. An Elo update loop only matters when you're scoring
  // against an opponent whose rating also moves; here the benchmark is fixed, so the closed
  // form is both simpler and stable — two people with identical logs always get identical
  // scores regardless of the ORDER their sessions happened to be replayed in.
  const score = STRENGTH_FLOOR + 800 * pRolling;
  return {
    score: Math.round(Math.max(STRENGTH_FLOOR, Math.min(STRENGTH_CEILING, score))),
    slots,
    covered: slots.filter((s) => s.daysSince !== null).length,
  };
}

// ---------- Activity types and their duration curves ----------
// Saturating, never declining. A curve that falls after a peak pays people to under-report:
// hike 9 hours, type "7", score better. Everything here is self-reported, so honest logging
// must never cost points. Saturation expresses "past this point you earn nothing more"
// without creating that incentive.
//
//   credit(minutes) = ceiling * (1 - 2^(-minutes/halfMin))
//
//   halfMin — minutes to reach half the ceiling. Sets how fast credit accrues (intensity).
//   ceiling — the most a single session of this type can ever be worth. This is what stops
//             "I logged a 14-hour hike", with no decline required.
//
// 1.0 ≈ one solid lifting session, so these are directly comparable to liftingEffort below.
export const ACTIVITY_TYPES = [
  { id: "basketball", label: "Basketball", halfMin: 45, ceiling: 1.8 },
  { id: "football", label: "Football", halfMin: 45, ceiling: 1.8 },
  { id: "running", label: "Running", halfMin: 25, ceiling: 1.8 },
  { id: "cycling", label: "Cycling", halfMin: 50, ceiling: 1.9 },
  { id: "swimming", label: "Swimming", halfMin: 30, ceiling: 1.8 },
  { id: "hiking", label: "Hiking", halfMin: 100, ceiling: 2.2 },
  { id: "climbing", label: "Climbing", halfMin: 55, ceiling: 1.9 },
  { id: "tennis", label: "Tennis / padel", halfMin: 50, ceiling: 1.8 },
  { id: "martial-arts", label: "Martial arts", halfMin: 40, ceiling: 2.0 },
  { id: "walking", label: "Walking", halfMin: 80, ceiling: 1.0 },
  { id: "other", label: "Other activity", halfMin: 55, ceiling: 1.5 },
];

export function activityTypeById(id) {
  return ACTIVITY_TYPES.find((a) => a.id === id) || ACTIVITY_TYPES[ACTIVITY_TYPES.length - 1];
}

export function activityEffort(typeId, minutes) {
  const t = activityTypeById(typeId);
  const m = Math.max(0, Number(minutes) || 0);
  if (m === 0) return 0;
  return t.ceiling * (1 - Math.pow(2, -m / t.halfMin));
}

// ---------- Lifting effort ----------
// Credits DISTINCT movement patterns, not exercise count. Six variations of a curl is one
// pattern and scores like one; six covering push/pull/squat/hinge/core is real training.
// This is what makes "one exercise shouldn't equal six" true without rewarding junk volume.
export const SETS_FOR_FULL_PATTERN = 4;  // sets of one pattern beyond this add nothing
export const LIFT_EFFORT_HALF = 2.2;     // pattern-units to reach half the ceiling
export const LIFT_EFFORT_CEILING = 1.6;

export function liftingEffort(session) {
  if (!session || session.kind === "activity") return 0;
  const setsByPattern = {};
  (session.exercises || []).forEach((e) => {
    if (!isRankedSlot(e.pattern)) return;
    const worked = (e.sets || []).filter((s) => (s.weight || 0) > 0 || (s.reps || 0) > 0).length;
    setsByPattern[e.pattern] = (setsByPattern[e.pattern] || 0) + worked;
  });

  // Each pattern contributes at most 1.0, reached at SETS_FOR_FULL_PATTERN sets.
  let raw = 0;
  Object.keys(setsByPattern).forEach((pid) => {
    raw += Math.min(setsByPattern[pid], SETS_FOR_FULL_PATTERN) / SETS_FOR_FULL_PATTERN;
  });
  if (raw === 0) return 0;

  // Saturating again, for the same reason: the 6th pattern should add less than the 2nd, so
  // a marathon session can't outscore several normal ones.
  return LIFT_EFFORT_CEILING * (1 - Math.pow(2, -raw / LIFT_EFFORT_HALF));
}

export function sessionEffort(session) {
  if (!session) return 0;
  if (session.kind === "activity") return activityEffort(session.activityType, session.minutes);
  return liftingEffort(session);
}

// ---------- The week ----------
// A single fixed offset for everyone, not per-user local time. A shared deadline is the whole
// point — the Sunday-evening "two hours left" nudge only works if everyone is racing the same
// clock. Fixed offset rather than an IANA zone because Kazakhstan has no DST, and it keeps
// this module dependency-free so the Worker can use it unchanged.
export const WEEK_TZ_OFFSET_MIN = 5 * 60; // UTC+5 (Almaty)
export const SESSIONS_PER_DAY_CAP = 2;    // logging ten sessions on Sunday shouldn't pay ten times

/** ISO date (YYYY-MM-DD) of the Monday that starts the week containing `iso`. */
export function weekStartISO(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** The ISO date it currently is, in the league's fixed timezone. */
export function leagueTodayISO(now = Date.now()) {
  return new Date(now + WEEK_TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/**
 * Effort earned in the week containing `asOfIso`. Resets every Monday — this is the axis
 * that stays winnable, and the reason a group board is still interesting in week five.
 */
// `effortOf` exists so the Worker can run this over its stored ledger of {date, effort}
// summaries — it never holds full sessions. Passing an accessor rather than duplicating the
// week window and the per-day cap keeps exactly one implementation of the weekly rule, which
// is the reason this module is shared in the first place.
export function weeklyEffort(sessions, asOfIso, effortOf = sessionEffort) {
  const start = weekStartISO(asOfIso);
  const inWeek = (sessions || []).filter((s) => s.date >= start && s.date <= asOfIso);

  // Cap sessions per day before summing, so a backlog dumped into one day doesn't pay out.
  const byDay = {};
  inWeek.forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });

  let total = 0;
  const counted = [];
  Object.keys(byDay).forEach((day) => {
    byDay[day]
      .map((s) => ({ session: s, effort: effortOf(s) }))
      .sort((a, b) => b.effort - a.effort) // if capped, keep the best ones
      .slice(0, SESSIONS_PER_DAY_CAP)
      .forEach((x) => { total += x.effort; counted.push(x); });
  });

  return { effort: total, weekStart: start, sessions: counted.length };
}

// ---------- The combined number ----------
// Strength and effort are different units, so both are mapped onto 0..100 before mixing.
// 40/60 favouring effort: strength is the prestige column you show off, effort is the one
// that's actually winnable each week.
export const STRENGTH_WEIGHT = 0.4;
export const EFFORT_WEIGHT = 0.6;
export const EFFORT_FULL_WEEK = 4.0; // ~4 solid sessions in a week = full marks

export function strengthPoints(score) {
  // 800 (baseline/untrained) -> 0, 2000 ("top 5%") -> 100.
  return Math.max(0, Math.min(100, ((score - STRENGTH_BASELINE) / 12)));
}

export function effortPoints(effort) {
  return Math.max(0, Math.min(100, (effort / EFFORT_FULL_WEEK) * 100));
}

/**
 * Everything the leaderboard and the bot need for one athlete.
 * Deliberately returns the parts as well as the total — the group board shows both columns,
 * because a single number gives people no idea why they're losing.
 */
export function scoreboardEntry(sessions, bodyweightKg, asOfIso) {
  const asOf = asOfIso || leagueTodayISO();
  const strength = strengthScore(sessions, bodyweightKg, asOf);
  const week = weeklyEffort(sessions, asOf);
  const sPts = strengthPoints(strength.score);
  const ePts = effortPoints(week.effort);
  return {
    strength: strength.score,
    strengthPoints: Math.round(sPts * 10) / 10,
    slots: strength.slots,
    covered: strength.covered,
    weeklyEffort: Math.round(week.effort * 100) / 100,
    effortPoints: Math.round(ePts * 10) / 10,
    weekStart: week.weekStart,
    weekSessions: week.sessions,
    total: Math.round((STRENGTH_WEIGHT * sPts + EFFORT_WEIGHT * ePts) * 10) / 10,
  };
}
