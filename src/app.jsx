import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Save, ChevronDown, ChevronUp, Trash2, TrendingUp, Dumbbell, History, LineChart as LineChartIcon, Loader2, Play, Pause, RotateCcw, SkipForward, ExternalLink, NotebookPen, Sparkles, ArrowDown, User, Award, Users, Share2, Check, Copy, FileText, Info } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
// The cross-user scoring maths lives in its own module because the bot Worker needs the
// identical implementation to answer /score with no client running — see src/scoring.js.
// MOVEMENT_PATTERNS is imported rather than redeclared here so the two can never drift.
import {
  MOVEMENT_PATTERNS, patternById, strengthScore,
  ACTIVITY_TYPES, activityEffort, activityTypeById,
  sessionEffort, weeklyEffort, leagueTodayISO,
  STRENGTH_BASELINE, STRENGTH_FLOOR, STRENGTH_HALF_LIFE_DAYS,
} from "./scoring.js";
// Strings, language detection and slugId — shared with the Worker for the same reason
// scoring.js is: the bot posts standings into the group chat and must word them identically.
import {
  LANGS, DEFAULT_LANG, isLang, detectLang, slugId,
  t, translator, plural, exerciseDisplayName, dayDisplayName,
} from "./i18n.js";

// ---------- The built-in 4-day upper/lower split ----------
// This is the DEFAULT a new user starts from, not the program itself — since §13 the live
// program is editable and lives in CloudStorage. Editing this constant changes what new
// users get and what "restore the built-in split" restores; it does not touch anyone who
// has already edited theirs.
// rest = default rest timer length in seconds for that exercise
const PROGRAM = {
  "Upper A": {
    subtitle: "Push focus — chest, shoulders, triceps, back, biceps",
    exercises: [
      { name: "Dumbbell Bench Press", muscle: "Chest / front delts / triceps", target: "3 x 8-12", rest: 90, link: "https://musclewiki.com/exercise/dumbbell-bench-press" },
      { name: "Dumbbell Single-Arm Row", muscle: "Lats / mid-back / biceps", target: "3 x 10-12/arm", rest: 90, link: "https://musclewiki.com/exercise/dumbbell-single-arm-row" },
      { name: "Dumbbell Overhead Press", muscle: "Shoulders / triceps", target: "3 x 8-12", rest: 90, link: "https://musclewiki.com/exercise/dumbbell-overhead-press" },
      { name: "Dumbbell Lateral Raise", muscle: "Side shoulders", target: "3 x 12-15", rest: 60, link: "https://musclewiki.com/exercise/dumbbell-lateral-raise" },
      { name: "Dumbbell Curl", muscle: "Biceps", target: "2 x 10-12", rest: 60, link: "https://musclewiki.com/exercise/dumbbell-curl" },
      { name: "Triceps Extension", muscle: "Triceps", target: "2 x 10-12", rest: 60, link: "https://musclewiki.com/exercise/dumbbell-overhead-tricep-extension" },
    ],
  },
  "Lower A": {
    subtitle: "Legs + conditioning — quads, glutes, hamstrings, calves, core",
    exercises: [
      { name: "Machine Leg Press", muscle: "Quads / glutes / hamstrings", target: "3 x 10-12", rest: 90, link: "https://musclewiki.com/exercise/machine-leg-press" },
      { name: "Dumbbell Walking Lunge", muscle: "Quads / glutes / hamstrings", target: "3 x 10-12/leg", rest: 90, link: "https://otfworkouttoday.com/exercises/dumbbell-walking-lunges/" },
      { name: "Machine Leg Extension", muscle: "Quads (isolation)", target: "3 x 12-15", rest: 60, link: "https://musclewiki.com/exercise/machine-leg-extension" },
      { name: "Standing Calf Raise", muscle: "Calves", target: "3 x 15-20", rest: 45, link: "https://en.wikipedia.org/wiki/Calf_raises" },
      { name: "Rowing Machine (Erg)", muscle: "Full body conditioning — legs, back, arms", target: "5-10 min steady", rest: 60, link: "https://www.youtube.com/watch?v=4zWu1yuJ0_g" },
      { name: "Forearm Plank", muscle: "Core", target: "3 x 30-45s", rest: 45, link: "https://musclewiki.com/exercise/forearm-plank" },
    ],
  },
  "Upper B": {
    subtitle: "Pull focus — upper chest, back, rear delts, arms",
    exercises: [
      { name: "Dumbbell Incline Bench Press", muscle: "Upper chest / front delts", target: "3 x 8-12", rest: 90, link: "https://musclewiki.com/exercise/dumbbell-incline-bench-press" },
      { name: "Lat Pulldown / Pull-Up", muscle: "Lats / biceps", target: "3 x 8-12", rest: 90, link: "https://musclewiki.com/exercise/machine-pulldown" },
      { name: "Dumbbell Rear Delt Fly", muscle: "Rear shoulders / upper back", target: "3 x 12-15", rest: 60, link: "https://musclewiki.com/exercise/dumbbell-rear-delt-fly" },
      { name: "Dumbbell Hammer Curl", muscle: "Biceps / forearms", target: "2 x 10-12", rest: 60, link: "https://musclewiki.com/exercise/dumbbell-hammer-curl" },
      { name: "Single-Arm Overhead Triceps Ext.", muscle: "Triceps", target: "2 x 10-12/arm", rest: 60, link: "https://musclewiki.com/exercise/dumbbell-single-arm-overhead-tricep-extension" },
    ],
  },
  "Lower B": {
    subtitle: "Legs + posterior chain — quads, glutes, lower back, calves",
    exercises: [
      { name: "Dumbbell Goblet Split Squat", muscle: "Quads / glutes / balance", target: "3 x 10-12/leg", rest: 90, link: "https://musclewiki.com/exercise/dumbbell-goblet-split-squat" },
      { name: "Dumbbell Hip Thrust", muscle: "Glutes / hamstrings", target: "3 x 8-10", rest: 90, link: "https://musclewiki.com/exercise/dumbbell-hip-thrust" },
      { name: "Back Extension", muscle: "Lower back / glutes / hamstrings", target: "3 x 12-15", rest: 60, link: "https://www.tomsguide.com/wellness/fitness/forget-deadlifts-back-extensions-strengthen-your-back-glutes-and-hamstrings-without-weights" },
      { name: "Calf Raise", muscle: "Calves", target: "3 x 15-20", rest: 45, link: "https://en.wikipedia.org/wiki/Calf_raises" },
      { name: "Side Plank", muscle: "Obliques / core", target: "3 x 20-30s/side", rest: 45, link: "https://musclewiki.com/exercise/forearm-plank" },
    ],
  },
};

const PROFILE_KEY = "profile";
const DEFAULT_REST = 60;

// ---------- Rating system config ----------
// Each program exercise gets:
//  - multiplier: importance weight (compound lifts count more than isolation)
//  - type: 'weight' (bodyweight-relative load) | 'reps' (bodyweight-only reps) | 'duration' (seconds, logged in the reps field)
//  - avg: the benchmark value representing an "average person" your bodyweight — 'top 5%' is modeled as 2x this.
// These are directional estimates for a home dumbbell setup (no official published dumbbell strength-standard
// database exists), meant to make progress feel meaningful, not a lab-grade measurement.
const EXERCISE_META = {
  "Dumbbell Bench Press": { multiplier: 1.5, type: "weight", avg: 0.18 },
  "Dumbbell Single-Arm Row": { multiplier: 1.5, type: "weight", avg: 0.21 },
  "Dumbbell Overhead Press": { multiplier: 1.5, type: "weight", avg: 0.12 },
  "Dumbbell Lateral Raise": { multiplier: 0.75, type: "weight", avg: 0.05 },
  "Dumbbell Curl": { multiplier: 0.75, type: "weight", avg: 0.12 },
  "Triceps Extension": { multiplier: 0.75, type: "weight", avg: 0.10 },
  "Machine Leg Press": { multiplier: 1.5, type: "weight", avg: 1.30 },
  "Dumbbell Walking Lunge": { multiplier: 1.3, type: "weight", avg: 0.13 },
  "Machine Leg Extension": { multiplier: 0.8, type: "weight", avg: 0.40 },
  "Rowing Machine (Erg)": { multiplier: 0.6, type: "duration", avg: 480 },
  "Dumbbell Hip Thrust": { multiplier: 1.5, type: "weight", avg: 0.18 },
  "Standing Calf Raise": { multiplier: 0.55, type: "reps", avg: 20 },
  "Forearm Plank": { multiplier: 0.5, type: "duration", avg: 45 },
  "Dumbbell Incline Bench Press": { multiplier: 1.5, type: "weight", avg: 0.145 },
  "Lat Pulldown / Pull-Up": { multiplier: 1.5, type: "weight", avg: 0.46 },
  "Dumbbell Rear Delt Fly": { multiplier: 0.75, type: "weight", avg: 0.05 },
  "Dumbbell Hammer Curl": { multiplier: 0.75, type: "weight", avg: 0.12 },
  "Single-Arm Overhead Triceps Ext.": { multiplier: 0.75, type: "weight", avg: 0.08 },
  "Dumbbell Goblet Split Squat": { multiplier: 1.3, type: "weight", avg: 0.16 },
  "Back Extension": { multiplier: 0.75, type: "reps", avg: 15 },
  "Calf Raise": { multiplier: 0.55, type: "reps", avg: 20 },
  "Side Plank": { multiplier: 0.5, type: "duration", avg: 30 },
};
const DEFAULT_EXERCISE_META = { multiplier: 0.6, type: "weight", avg: 0.10 }; // fallback for custom-added exercises
const RATING_NEUTRAL = 1.0;
const RATING_HALF_LIFE_DAYS = 14; // how fast an untouched exercise's contribution fades toward neutral
const RATING_BASELINE = 800;
const LAYOFF_GRACE_DAYS = 7; // gaps up to a week between ANY two sessions cause no penalty
const LAYOFF_HALF_LIFE_DAYS = 21; // beyond the grace window, every 21 "excess" days pulls the rating halfway back toward baseline

const TIERS = [
  // Bronze deliberately stays orange — it's a metal, not the brand accent.
  { name: "Bronze", min: 0, color: "text-orange-700", bg: "bg-orange-100" },
  { name: "Silver", min: 1000, color: "text-gray-500", bg: "bg-gray-200" },
  { name: "Gold", min: 1200, color: "text-yellow-600", bg: "bg-yellow-100" },
  { name: "Platinum", min: 1500, color: "text-cyan-600", bg: "bg-cyan-100" },
  { name: "Diamond", min: 1800, color: "text-blue-600", bg: "bg-blue-100" },
  { name: "Top 5%", min: 2000, color: "text-purple-600", bg: "bg-purple-100" },
];

// ---------- Exercise identity ----------
// Exercises are identified by a stable id, never by their display name. Names are editable,
// and matching on them meant renaming a lift silently detached its entire history from the
// coach, the charts and the rating. Built-in exercises derive their id from their original
// name, so sessions logged before ids existed migrate for free (see normalizeSession).
//
// slugId now lives in src/i18n.js. It used to strip everything outside [a-z0-9], which meant
// every Cyrillic name collapsed to the single id "x" — see the comment on the function for
// what that broke and why the ASCII path is preserved byte-for-byte.

const BUILTIN_META_BY_ID = {};
Object.keys(EXERCISE_META).forEach((n) => { BUILTIN_META_BY_ID[slugId(n)] = EXERCISE_META[n]; });

// ---------- Movement patterns ----------
// A user-added exercise has no benchmark, and the rating can't score what it can't measure.
// Rather than inventing a number per exercise, the user picks the movement pattern and
// inherits its multiplier/type/avg. Same honesty caveat as §6 applies, harder: these are
// rough family averages, not measurements of any specific lift.
//
// The table itself now lives in src/scoring.js (imported above) because the ranked slot set
// is derived from it and the Worker needs both. Nothing else about how it's used has changed.

// Best-guess pattern for a built-in exercise, so opening one in the editor shows something
// sensible rather than an empty selector. Closest multiplier within the same measurement type.
function inferPatternId(meta) {
  if (!meta) return "isolation-upper";
  const sameType = MOVEMENT_PATTERNS.filter((p) => p.type === meta.type);
  const pool = sameType.length ? sameType : MOVEMENT_PATTERNS;
  let best = pool[0];
  let bestScore = Infinity;
  pool.forEach((p) => {
    const score = Math.abs(p.multiplier - meta.multiplier) + Math.abs(p.avg - meta.avg) / Math.max(p.avg, meta.avg, 0.01);
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return best.id;
}

function metaFromPattern(patternId) {
  const p = patternById(patternId);
  if (!p) return { ...DEFAULT_EXERCISE_META };
  return { multiplier: p.multiplier, type: p.type, avg: p.avg };
}

// ---------- The program ----------
// PROGRAM above is no longer *the* program — it's the default a new user starts from. The
// live program lives in CloudStorage and is fully editable (§13).
const DEFAULT_PROGRAM = (() => {
  const days = Object.keys(PROGRAM).map((name) => ({ id: slugId(name), name, subtitle: PROGRAM[name].subtitle }));
  const exercisesByDay = {};
  Object.keys(PROGRAM).forEach((dayName) => {
    exercisesByDay[slugId(dayName)] = PROGRAM[dayName].exercises.map((e) => {
      const meta = EXERCISE_META[e.name] || DEFAULT_EXERCISE_META;
      return {
        id: slugId(e.name),
        name: e.name,
        muscle: e.muscle,
        target: e.target,
        rest: e.rest,
        link: e.link,
        pattern: inferPatternId(meta),
        meta,
        builtIn: true,
      };
    });
  });
  return { version: 1, days, exercisesByDay };
})();

// ---------- Starting programs ----------
// A new user used to land in Ramazan's 4-day split, hip thrusts and all. These are the
// choices offered at onboarding instead; the old split is still here as one option among
// several rather than as everyone's default.
//
// Built from movement patterns rather than named benchmarks, so every exercise scores
// straight away. Deliberately no links or muscle strings — a template is a starting point
// to edit, and half-filled metadata reads as more authoritative than it is.
const TEMPLATE_EXERCISE = (name, pattern, target, rest) => ({ name, pattern, target, rest });

const PROGRAM_TEMPLATES = [
  {
    id: "full-body-3",
    name: "Full body, 3 days",
    blurb: "The safest default if you're unsure. Every pattern, three times a week.",
    days: [
      { name: "Full A", exercises: [
        TEMPLATE_EXERCISE("Bench / Chest Press", "push-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Row", "pull-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Squat / Leg Press", "squat", "3 x 8-12", 120),
        TEMPLATE_EXERCISE("Plank", "core", "3 x 45s", 60),
      ] },
      { name: "Full B", exercises: [
        TEMPLATE_EXERCISE("Overhead Press", "push-vertical", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Pulldown / Pull-Up", "pull-vertical", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Split Squat", "lunge", "3 x 10/leg", 90),
        TEMPLATE_EXERCISE("Curl", "isolation-upper", "3 x 10-12", 60),
      ] },
      { name: "Full C", exercises: [
        TEMPLATE_EXERCISE("Incline Press", "push-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Row", "pull-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Hip Hinge", "hinge", "3 x 8-12", 120),
        TEMPLATE_EXERCISE("Calf Raise", "calves", "3 x 15-20", 45),
      ] },
    ],
  },
  {
    id: "upper-lower-4",
    name: "Upper / lower, 4 days",
    blurb: "More volume per muscle. Legs are built into two of the four days on purpose.",
    days: [
      { name: "Upper A", exercises: [
        TEMPLATE_EXERCISE("Bench / Chest Press", "push-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Row", "pull-horizontal", "3 x 10-12", 90),
        TEMPLATE_EXERCISE("Overhead Press", "push-vertical", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Curl", "isolation-upper", "2 x 10-12", 60),
      ] },
      { name: "Lower A", exercises: [
        TEMPLATE_EXERCISE("Squat / Leg Press", "squat", "3 x 8-12", 120),
        TEMPLATE_EXERCISE("Split Squat", "lunge", "3 x 10/leg", 90),
        TEMPLATE_EXERCISE("Leg Extension", "isolation-lower", "3 x 12-15", 60),
        TEMPLATE_EXERCISE("Plank", "core", "3 x 45s", 60),
      ] },
      { name: "Upper B", exercises: [
        TEMPLATE_EXERCISE("Incline Press", "push-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Pulldown / Pull-Up", "pull-vertical", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Lateral Raise", "isolation-upper", "3 x 12-15", 60),
        TEMPLATE_EXERCISE("Triceps Extension", "isolation-upper", "2 x 10-12", 60),
      ] },
      { name: "Lower B", exercises: [
        TEMPLATE_EXERCISE("Hip Hinge", "hinge", "3 x 8-12", 120),
        TEMPLATE_EXERCISE("Walking Lunge", "lunge", "3 x 10/leg", 90),
        TEMPLATE_EXERCISE("Calf Raise", "calves", "3 x 15-20", 45),
        TEMPLATE_EXERCISE("Side Plank", "core", "3 x 30s", 45),
      ] },
    ],
  },
  {
    id: "dumbbells-home",
    name: "Dumbbells only, 3 days",
    blurb: "No machines, no barbell. For training at home or a small building gym.",
    days: [
      { name: "Push", exercises: [
        TEMPLATE_EXERCISE("Dumbbell Bench Press", "push-horizontal", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Dumbbell Overhead Press", "push-vertical", "3 x 8-12", 90),
        TEMPLATE_EXERCISE("Lateral Raise", "isolation-upper", "3 x 12-15", 60),
      ] },
      { name: "Pull", exercises: [
        TEMPLATE_EXERCISE("Single-Arm Row", "pull-horizontal", "3 x 10-12", 90),
        TEMPLATE_EXERCISE("Dumbbell Curl", "isolation-upper", "3 x 10-12", 60),
        TEMPLATE_EXERCISE("Back Extension", "bodyweight-reps", "3 x 12-15", 60),
      ] },
      { name: "Legs", exercises: [
        TEMPLATE_EXERCISE("Goblet Squat", "squat", "3 x 8-12", 120),
        TEMPLATE_EXERCISE("Split Squat", "lunge", "3 x 10/leg", 90),
        TEMPLATE_EXERCISE("Calf Raise", "calves", "3 x 15-20", 45),
        TEMPLATE_EXERCISE("Plank", "core", "3 x 45s", 60),
      ] },
    ],
  },
];

function programFromTemplate(tpl) {
  const days = tpl.days.map((d) => ({ id: slugId(d.name), name: d.name, subtitle: "" }));
  const exercisesByDay = {};
  tpl.days.forEach((d) => {
    exercisesByDay[slugId(d.name)] = d.exercises.map((e) => ({
      id: slugId(e.name),
      name: e.name,
      muscle: "",
      target: e.target,
      rest: e.rest,
      link: "",
      pattern: e.pattern,
      meta: metaFromPattern(e.pattern),
    }));
  });
  return withMetaIndex({ version: 1, days, exercisesByDay });
}

// Attaches an id -> meta index. Everything that needs an exercise's rating metadata goes
// through this, so there is exactly one place that knows the lookup order.
function withMetaIndex(program) {
  const metaById = {};
  (program.days || []).forEach((d) => {
    (program.exercisesByDay[d.id] || []).forEach((e) => {
      metaById[e.id] = e.meta || DEFAULT_EXERCISE_META;
    });
  });
  return { ...program, metaById };
}

// Lookup order: the user's own program wins, then the built-in table (for exercises that
// were removed from the program but still appear in history), then a neutral default.
// Lookup order matters:
//   1. the live program — so editing an exercise's pattern re-contextualises its whole
//      history, the same way changing bodyweight does (§6).
//   2. metadata carried on the logged entry itself — the only source for a one-day
//      substitute, which by definition isn't in the program.
//   3. the built-in table, for exercises removed from the program but still in history.
function metaForEntry(entry, program) {
  if (!entry) return DEFAULT_EXERCISE_META;
  const byId = (program && program.metaById) || {};
  return (
    byId[entry.id] ||
    entry.meta ||
    BUILTIN_META_BY_ID[entry.id] ||
    EXERCISE_META[entry.name] ||
    DEFAULT_EXERCISE_META
  );
}

function dayById(program, dayId) {
  return (program.days || []).find((d) => d.id === dayId) || null;
}

function exercisesForDay(program, dayId) {
  return program.exercisesByDay[dayId] || [];
}

// Every exercise in the program, deduped — an exercise appearing on two days is one slot,
// not two.
function programSlots(program) {
  const seen = new Set();
  const slots = [];
  (program.days || []).forEach((d) => {
    (program.exercisesByDay[d.id] || []).forEach((e) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      slots.push({ id: e.id, name: e.name, meta: e.meta || DEFAULT_EXERCISE_META });
    });
  });
  return slots;
}

// ---------- Telegram platform bridge ----------
// Telegram CloudStorage caps each value at 4096 chars, so sessions are stored one key per
// session (sess_<id>) rather than as a single blob, with an index key listing the ids.
// Falls back to localStorage when opened outside Telegram (e.g. testing in a browser).
const TG = typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const inTelegram = !!(TG && TG.initDataUnsafe && TG.platform && TG.platform !== "unknown");

const cloud = {
  get(key) {
    return new Promise((resolve) => {
      if (!inTelegram || !TG.CloudStorage) {
        try { resolve(localStorage.getItem(key)); } catch (e) { resolve(null); }
        return;
      }
      TG.CloudStorage.getItem(key, (err, val) => resolve(err ? null : (val || null)));
    });
  },
  set(key, value) {
    return new Promise((resolve) => {
      if (!inTelegram || !TG.CloudStorage) {
        try { localStorage.setItem(key, value); resolve(true); } catch (e) { resolve(false); }
        return;
      }
      TG.CloudStorage.setItem(key, value, (err, ok) => resolve(!err && ok !== false));
    });
  },
  remove(key) {
    return new Promise((resolve) => {
      if (!inTelegram || !TG.CloudStorage) {
        try { localStorage.removeItem(key); resolve(true); } catch (e) { resolve(false); }
        return;
      }
      TG.CloudStorage.removeItem(key, (err, ok) => resolve(!err && ok !== false));
    });
  },
};

const SESSION_PREFIX = "sess_";
const INDEX_KEY = "sess_index";

// Sessions written before exercises had ids only stored display names. Rather than rewriting
// storage (a migration that can half-fail), ids are derived on read — slugId() of a built-in
// name reproduces exactly the id that exercise has in the default program, so old history
// reattaches itself to the right slot. Same trick for the day.
function normalizeSession(s) {
  return {
    ...s,
    // Everything logged before activities existed was a lifting session by definition.
    kind: s.kind || "lift",
    dayId: s.dayId || slugId(s.day),
    exercises: (s.exercises || []).map((e) => ({ ...e, id: e.id || slugId(e.name) })),
  };
}

async function loadAllSessions() {
  const raw = await cloud.get(INDEX_KEY);
  let ids = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
  const out = [];
  for (const id of ids) {
    const s = await cloud.get(SESSION_PREFIX + id);
    if (!s) continue;
    try { out.push(normalizeSession(JSON.parse(s))); } catch (e) { /* skip corrupt entry */ }
  }
  return out;
}

// Storage failures return a translation KEY plus any values it needs, rather than finished
// prose. These functions run below the React tree with no access to the language context, and
// threading `lang` down into every one of them to build one rare error string was the worse
// trade — App resolves them where it already has both.
// ---------- Program storage ----------
// Split the same way sessions are (§5): one key per day, because a single blob of four days
// with links and targets would sit right on the 4096-char ceiling.
const PROGRAM_KEY = "prog_v1";
const PROGRAM_DAY_PREFIX = "prog_d_";

async function loadProgram() {
  const raw = await cloud.get(PROGRAM_KEY);
  if (!raw) return withMetaIndex(DEFAULT_PROGRAM); // never edited — use the built-in split
  let head;
  try { head = JSON.parse(raw); } catch (e) { return withMetaIndex(DEFAULT_PROGRAM); }
  if (!head || !Array.isArray(head.days) || head.days.length === 0) return withMetaIndex(DEFAULT_PROGRAM);

  const exercisesByDay = {};
  for (const d of head.days) {
    const r = await cloud.get(PROGRAM_DAY_PREFIX + d.id);
    try { exercisesByDay[d.id] = r ? JSON.parse(r) : []; } catch (e) { exercisesByDay[d.id] = []; }
  }
  return withMetaIndex({ version: 1, days: head.days, exercisesByDay });
}

async function saveProgram(program) {
  // Check every day fits before writing any of it, so a too-big day can't leave the program
  // half-saved with an index pointing at days that were never written.
  for (const d of program.days) {
    const payload = JSON.stringify(program.exercisesByDay[d.id] || []);
    if (payload.length > 4000) {
      return { ok: false, reason: "err.dayTooBig", reasonVars: { day: d.name } };
    }
  }

  const prevRaw = await cloud.get(PROGRAM_KEY);
  let prevDays = [];
  try { prevDays = prevRaw ? (JSON.parse(prevRaw).days || []) : []; } catch (e) { prevDays = []; }

  for (const d of program.days) {
    const ok = await cloud.set(PROGRAM_DAY_PREFIX + d.id, JSON.stringify(program.exercisesByDay[d.id] || []));
    if (!ok) return { ok: false, reason: "err.writeFailed" };
  }
  const ok = await cloud.set(PROGRAM_KEY, JSON.stringify({ version: 1, days: program.days }));
  if (!ok) return { ok: false, reason: "err.programIndex" };

  // Only now that the index no longer references them, drop deleted days' keys. Doing this
  // first would strand the data if the index write failed.
  const liveIds = new Set(program.days.map((d) => d.id));
  for (const d of prevDays) {
    if (!liveIds.has(d.id)) await cloud.remove(PROGRAM_DAY_PREFIX + d.id);
  }
  return { ok: true };
}

async function resetProgram() {
  const raw = await cloud.get(PROGRAM_KEY);
  let days = [];
  try { days = raw ? (JSON.parse(raw).days || []) : []; } catch (e) { days = []; }
  for (const d of days) await cloud.remove(PROGRAM_DAY_PREFIX + d.id);
  await cloud.remove(PROGRAM_KEY);
  return withMetaIndex(DEFAULT_PROGRAM);
}

// Sessions are written individually so one oversized session can never corrupt the whole log.
async function saveSession(session) {
  const payload = JSON.stringify(session);
  if (payload.length > 4000) {
    return { ok: false, reason: "err.sessionTooBig" };
  }
  const ok = await cloud.set(SESSION_PREFIX + session.id, payload);
  if (!ok) return { ok: false, reason: "err.writeFailed" };
  const raw = await cloud.get(INDEX_KEY);
  let ids = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
  if (!ids.includes(session.id)) ids.push(session.id);
  const idxOk = await cloud.set(INDEX_KEY, JSON.stringify(ids));
  if (!idxOk) return { ok: false, reason: "err.sessionIndex" };
  return { ok: true };
}

async function deleteSessionStored(id) {
  await cloud.remove(SESSION_PREFIX + id);
  const raw = await cloud.get(INDEX_KEY);
  let ids = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
  await cloud.set(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
}

// ---------- The group relay ----------
// The bot Worker. It receives a summary of a finished session — name, scores, exercise names —
// and forwards it to the group chat. Workout data itself never goes here.
//
// Confirmed against the deployed worker 2026-08-18.
const RELAY_URL = "https://chetamba-bot.chetamba.workers.dev";
const GROUP_KEY = "group_v1";

// Telegram signs initData with the bot token, so the Worker can prove who is calling without
// any login. Outside Telegram there's nothing to send, and publishing is simply skipped.
const initData = () => (TG && TG.initData) || "";

async function relay(path, body) {
  if (!initData()) return { ok: false, error: "not in telegram" };
  try {
    const res = await fetch(`${RELAY_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, initData: initData() }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: "network" };
  }
}

/**
 * Everything the relay needs to reproduce this user's standings from scratch.
 *
 * The ledger stores INPUTS (dated efforts), never the finished weekly total — effort decays
 * and resets on Mondays, so a cached total is right for a few hours and then quietly wrong,
 * and /score is answered when no client is running to correct it.
 */
function syncPayload(sessions, profile, program, lang) {
  const asOf = leagueTodayISO();
  const all = hydratePatterns(sessions || [], program);
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  return {
    strength: strengthScore(all, Number(profile.weightKg) || null, asOf).score,
    name: profile.displayName || "",
    lang: lang || DEFAULT_LANG,
    ledger: all
      .filter((s) => s.date >= cutoff)
      .map((s) => ({ id: s.id, date: s.date, effort: sessionEffort(s), kind: s.kind || "lift" })),
  };
}

/**
 * Push the local score to the relay on app open.
 *
 * Without this, `user.strength` on the Worker only moved when a workout was published, so
 * someone who joined a group and typed /score read as a blank 800 — the app said 1771 and the
 * chat said 800, which reads as two different scoring systems rather than one stale copy.
 * Fire-and-forget: this is a correction, and failing to send it must never surface as an error.
 */
function syncScore(sessions, profile, program, lang) {
  if (!initData()) return;
  if (!Number(profile.weightKg)) return; // nothing meaningful to send yet
  relay("/api/sync", syncPayload(sessions, profile, program, lang));
}

// Fire-and-forget by design. The session is already saved to CloudStorage by the time this
// runs, so a failed publish must never surface as a failed workout — the worst case is the
// group misses one message, and the next publish carries the updated totals anyway.
function publishSession(session, profile, program, sessions, lang) {
  if (!initData()) return;
  const asOf = leagueTodayISO();
  const all = hydratePatterns([...sessions, session], program);
  const strength = strengthScore(all, Number(profile.weightKg) || null, asOf).score;
  // The label is what the group chat will read, so it goes out as a translation key rather
  // than as finished text: the group's language is set at /register and may not be this
  // user's. Custom day names have no key and travel as-is, which is correct — a name someone
  // typed is not ours to translate.
  const label = session.kind === "activity"
    ? `act.${session.activityType}`
    : `day.${session.dayId || slugId(session.day || "")}`;

  relay("/api/publish", {
    sessionId: session.id,
    date: session.date,
    kind: session.kind,
    label,
    labelText: session.kind === "activity" ? "" : session.day || "",
    minutes: session.minutes || null,
    effort: sessionEffort(session),
    strength,
    name: profile.displayName || "",
    // Keeps the bot's private messages in the language the app is set to, so someone who
    // flips the switch doesn't keep getting English DMs.
    lang: lang || DEFAULT_LANG,
    exercises: (session.exercises || []).map((e) => e.name),
  });
}

// ---------- Helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
// Follows the app's language rather than the device locale. Someone on an English phone who
// has chosen Russian should get "18 авг. 2026", not a date in a language they switched away
// from — the switch is a statement about what they want to read.
const DATE_LOCALES = { en: "en-GB", ru: "ru-RU" };
const fmtDate = (iso, lang = DEFAULT_LANG) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(DATE_LOCALES[lang] || DATE_LOCALES.en, { month: "short", day: "numeric", year: "numeric" });
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtClock = (secs) => {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// `pattern` decides how the entry is scored. It defaults rather than being left blank because
// an unscored exercise is a silent hole in the rating — the user picks the right one on the
// card, but a wrong-but-present default is far easier to notice and fix than a missing one.
function emptyExerciseLog(name, muscle, rest, link, pattern) {
  return {
    name, muscle: muscle || "", rest: rest || DEFAULT_REST, link: link || "",
    pattern: pattern || "isolation-upper", notes: "", sets: [],
  };
}

// ---------- Sound (Web Audio beep, no external files) ----------
function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.18, 0.36].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1046.5 : 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.18);
    });
    setTimeout(() => ctx.close(), 700);
  } catch (e) {
    /* audio not available, ignore */
  }
}

// ---------- Rest Timer hook ----------
function useRestTimer() {
  const [state, setState] = useState(null); // { endAt, total, label, paused, remainingAtPause }
  const rafRef = useRef();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!state || state.paused) return;
    function loop() {
      forceTick((n) => n + 1);
      if (Date.now() >= state.endAt) {
        playBeep();
        setState((s) => (s ? { ...s, done: true } : s));
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state && state.endAt, state && state.paused]);

  const start = useCallback((seconds, label) => {
    setState({ endAt: Date.now() + seconds * 1000, total: seconds, label, paused: false, done: false });
  }, []);
  const pause = useCallback(() => {
    setState((s) => (s && !s.paused ? { ...s, paused: true, remainingAtPause: s.endAt - Date.now() } : s));
  }, []);
  const resume = useCallback(() => {
    setState((s) => (s && s.paused ? { ...s, paused: false, endAt: Date.now() + s.remainingAtPause } : s));
  }, []);
  const addTime = useCallback((secs) => {
    setState((s) => (s ? { ...s, endAt: s.endAt + secs * 1000, total: s.total + secs, done: false } : s));
  }, []);
  const dismiss = useCallback(() => setState(null), []);

  const remaining = state ? (state.paused ? state.remainingAtPause / 1000 : (state.endAt - Date.now()) / 1000) : 0;

  return { state, remaining, start, pause, resume, addTime, dismiss };
}

// ---------- Language ----------
// A context rather than a prop, because `lang` is needed in roughly forty components and
// threading it through every one of them would touch more code than the translation itself.
//
// Stored under its own key, not inside the profile blob: the profile is what gets published
// to the group relay, and language is a display preference rather than something the
// leaderboard has any business knowing. Its own key also means resetting a profile doesn't
// silently flip someone back to English.
const LANG_KEY = "lang_v1";
const LangContext = React.createContext(DEFAULT_LANG);

/** The translator for the current language. `t("nav.log")` in any component. */
function useT() {
  const lang = React.useContext(LangContext);
  return useMemo(() => translator(lang), [lang]);
}

/** The raw language id, for the handful of callers that need plurals or a display name. */
function useLang() {
  return React.useContext(LangContext);
}

/**
 * Resolve what an exercise should be called on screen.
 *
 * Built-ins and template entries have an `ex.<id>` key and follow the switch; anything the
 * user typed has no key and is shown exactly as they typed it. That asymmetry is the whole
 * design — we translate our copy, never theirs.
 */
function useExerciseName() {
  const lang = useLang();
  return useCallback((ex) => exerciseDisplayName(lang, ex && ex.id, ex && ex.name), [lang]);
}

function useDayName() {
  const lang = useLang();
  return useCallback((d) => dayDisplayName(lang, d && d.id, d && d.name), [lang]);
}

/**
 * A hint that stays out of the way until asked for.
 *
 * Every screen had accumulated a paragraph explaining itself — why bodyweight is required,
 * how substitution scores, what the export formats are for. Each one was worth writing and
 * none of them are worth reading twice, so on the fifth visit they are just noise between you
 * and the thing you opened the app to do. They're all still here, one tap away.
 *
 * Wraps the heading it belongs to rather than floating on its own, so the ⓘ is attached to
 * something: an unlabelled ⓘ makes people tap it to find out what it is, which is the
 * opposite of the point.
 *
 * Russian runs longer than English, so this earns more room back on the Russian UI than the
 * English one — which is where the complaint came from.
 */
function WithInfo({ children, text, className = "", tone = "muted" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dot = tone === "light"
    ? (open ? "bg-white/25 text-white" : "bg-white/10 text-gray-400")
    : (open ? "bg-maroon-600 text-white" : "bg-gray-200 text-gray-500");

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">{children}</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("common.whatsThis")}
          className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-colors ${dot}`}
        >
          <Info size={13} />
        </button>
      </div>
      {open && (
        <p className={`text-xs leading-snug mt-1.5 ${tone === "light" ? "text-gray-400" : "text-gray-500"}`}>
          {text}
        </p>
      )}
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const [tab, setTab] = useState("log");
  const [sessions, setSessions] = useState(null);
  const [profile, setProfile] = useState(null);
  const [program, setProgram] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [onboarded, setOnboarded] = useState(true); // assume yes until storage says otherwise, so onboarding can't flash on reload
  // Whether entering the program editor should land with the generator already open. Set by
  // which button in Profile was pressed, so the two entry points reach the same screen.
  const [programAiOpen, setProgramAiOpen] = useState(false);
  // Seeded synchronously from the Telegram account so the very first paint is already in the
  // right language. Storage is read a moment later and wins if the user has ever chosen.
  const [lang, setLang] = useState(() => detectLang(TG && TG.initDataUnsafe && TG.initDataUnsafe.user && TG.initDataUnsafe.user.language_code));
  const timer = useRestTimer();

  useEffect(() => {
    if (TG) {
      try {
        TG.ready();
        TG.expand();
      } catch (e) { /* older Telegram clients */ }
    }
    (async () => {
      const storedLang = await cloud.get(LANG_KEY);
      if (isLang(storedLang)) setLang(storedLang);
      setOnboarded((await cloud.get(ONBOARDED_KEY)) === "1");
      const prog = await loadProgram();
      setProgram(prog);
      const loaded = await loadAllSessions();
      setSessions(loaded);
      const raw = await cloud.get(PROFILE_KEY);
      let p = { heightCm: "", weightKg: "", displayName: "" };
      try { if (raw) p = { ...p, ...JSON.parse(raw) }; } catch (e) { /* keep defaults */ }
      // Pre-fill the leaderboard name from the Telegram account on first run only.
      if (!p.displayName && TG && TG.initDataUnsafe && TG.initDataUnsafe.user) {
        p.displayName = TG.initDataUnsafe.user.first_name || "";
      }
      setProfile(p);

      // Reconcile the relay's copy of the score with this device's. Last, so it sees the
      // fully-loaded state, and unawaited so a slow network never delays the first paint.
      syncScore(loaded, p, prog, isLang(storedLang) ? storedLang : lang);
    })();
  }, []);

  async function saveProfile(next) {
    setSaving(true);
    setError("");
    const ok = await cloud.set(PROFILE_KEY, JSON.stringify(next));
    if (ok) setProfile(next);
    else setError(t(lang, "err.profileSave"));
    setSaving(false);
  }

  // Applied to the UI immediately and persisted in the background: a language switch that
  // waits on a network round-trip feels broken, and the worst case of a failed write is that
  // the choice doesn't survive a reload.
  function changeLang(next) {
    if (!isLang(next)) return;
    setLang(next);
    cloud.set(LANG_KEY, next);
  }

  async function addSession(session) {
    setSaving(true);
    setError("");
    const res = await saveSession(session);
    if (res.ok) {
      setSessions((prev) => [...(prev || []), session]);
      // Only after the local write succeeded — the group should never be told about a
      // workout the user's own device failed to keep.
      publishSession(session, profile, program, sessions || [], lang);
    } else setError(t(lang, res.reason, res.reasonVars));
    setSaving(false);
  }

  async function deleteSession(id) {
    setSaving(true);
    await deleteSessionStored(id);
    setSessions((prev) => (prev || []).filter((s) => s.id !== id));
    setSaving(false);
  }

  async function commitProgram(next) {
    setSaving(true);
    setError("");
    const withIndex = withMetaIndex(next);
    const res = await saveProgram(withIndex);
    if (res.ok) setProgram(withIndex);
    else setError(t(lang, res.reason, res.reasonVars));
    setSaving(false);
    return res;
  }

  async function restoreDefaultProgram() {
    setSaving(true);
    setError("");
    setProgram(await resetProgram());
    setSaving(false);
  }

  const loading = sessions === null || profile === null || program === null;

  // Shown once, to someone who has never set a bodyweight. Skippable rather than a wall —
  // people should be able to look around first, and a blocked first screen is a worse
  // failure than a missing number we can nag about later.
  const needsOnboarding = !loading && !profile.weightKg && !onboarded;

  async function completeOnboarding({ profile: nextProfile, program: nextProgram }) {
    setSaving(true);
    await saveProfile(nextProfile);
    if (nextProgram) await commitProgram(nextProgram);
    await cloud.set(ONBOARDED_KEY, "1");
    setOnboarded(true);
    setSaving(false);
  }

  if (needsOnboarding) {
    return (
      <LangContext.Provider value={lang}>
        <div className="min-h-screen bg-white text-gray-900 font-sans" style={{ colorScheme: "light" }}>
          <div className="max-w-md mx-auto pb-12">
            <Onboarding
              initialName={profile.displayName || ""}
              onDone={completeOnboarding}
              lang={lang}
              onLang={changeLang}
            />
          </div>
        </div>
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={lang}>
    <div
      className="min-h-screen bg-white text-gray-900 font-sans"
      style={{ colorScheme: "light" }}
    >
      {/* pb-24 clears the bottom nav. It used to switch to pb-44 when the rest timer was
          showing, because the old timer bar floated above the nav and covered the Save
          button. The ring doesn't overlap anything, so one constant is enough now. */}
      <div className="max-w-md mx-auto pb-24">
        <RestReadout timer={timer} />
        <Header saving={saving} />
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-gray-500 py-24">
            <Loader2 className="animate-spin" size={18} />
            <span className="text-sm">{t(lang, "app.loading")}</span>
          </div>
        ) : (
          <>
            {error && (
              <div className="mx-4 mt-3 rounded-md border border-maroon-300 bg-maroon-50 px-3 py-2 text-xs text-maroon-700">
                {error}
              </div>
            )}
            {tab === "log" && <LogView onSave={addSession} timer={timer} sessions={sessions} program={program} />}
            {tab === "history" && <HistoryView sessions={sessions} onDelete={deleteSession} />}
            {tab === "progress" && <ProgressView sessions={sessions} profile={profile} program={program} />}
            {tab === "profile" && (
              <ProfileView
                profile={profile}
                onSave={saveProfile}
                sessions={sessions}
                program={program}
                onEditProgram={({ openAi } = {}) => { setProgramAiOpen(!!openAi); setTab("program"); }}
                lang={lang}
                onLang={changeLang}
              />
            )}
            {tab === "program" && (
              <ProgramEditor
                program={program}
                profile={profile}
                autoOpenAi={programAiOpen}
                onCommit={commitProgram}
                onReset={restoreDefaultProgram}
                onBack={() => setTab("profile")}
              />
            )}
          </>
        )}
      </div>
      <RestRing timer={timer} />
      <BottomNav tab={tab} setTab={setTab} />
    </div>
    </LangContext.Provider>
  );
}

// ---------- Onboarding ----------
// A friend opening a shared link used to land straight in someone else's 4-day split with no
// bodyweight set — which silently means a dead score, because every load benchmark divides by
// it (strengthScore returns baseline and nothing explains why).
//
// Bodyweight is therefore the one thing this insists on. The program is not: it can be picked
// from a template, or skipped entirely, because under fixed pattern slots your program no
// longer affects your score — it's a checklist, so getting it wrong costs nothing.
const ONBOARDED_KEY = "onboarded_v1";

function Onboarding({ initialName, onDone, lang, onLang }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName || "");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");

  const weightNum = toNumber(weight);
  const canContinue = weightNum > 0 && weightNum < 400;

  function finishWith(program) {
    onDone({
      profile: { displayName: name.trim(), weightKg: weightNum, heightCm: toNumber(height) || "" },
      program,
    });
  }

  if (step === 0) {
    return (
      <div className="px-5 pt-8">
        {/* The language picker sits above the greeting, and is the only control on screen
            that is deliberately shown in both languages at once — someone who landed in the
            wrong one still has to be able to read their way out. */}
        <LangToggle lang={lang} onLang={onLang} className="mb-5" />

        <h2 className="text-2xl font-bold tracking-tight mb-1">{t("onb.welcome")}</h2>
        <p className="text-sm text-gray-500 mb-6">{t("onb.sub")}</p>

        <label className="block mb-4">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("onb.name")}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("onb.namePlaceholder")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
          />
        </label>

        <div className="flex gap-3 mb-2">
          <label className="flex-1">
            <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("onb.weight")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="76"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
            />
          </label>
          <label className="flex-1">
            <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("onb.height")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="186"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-gray-400 mb-6 leading-snug">{t("onb.whyWeight")}</p>

        <button
          onClick={() => setStep(1)}
          disabled={!canContinue}
          className={`w-full rounded-lg py-3 text-sm font-semibold ${
            canContinue ? "bg-maroon-600 text-white" : "bg-gray-200 text-gray-400"
          }`}
        >
          {t("onb.continue")}
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pt-8">
      <h2 className="text-2xl font-bold tracking-tight mb-1">{t("onb.pickProgram")}</h2>
      <p className="text-sm text-gray-500 mb-6">{t("onb.pickProgramSub")}</p>

      <div className="space-y-2.5 mb-5">
        {PROGRAM_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => finishWith(programFromTemplate(tpl))}
            className="w-full text-left rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
          >
            <p className="text-sm font-semibold">{t(`tpl.${tpl.id}`)}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{t(`tpl.${tpl.id}.blurb`)}</p>
          </button>
        ))}
      </div>

      <button
        onClick={() => finishWith(null)}
        className="w-full rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-600"
      >
        {t("onb.skip")}
      </button>
      <p className="text-xs text-gray-400 mt-1.5 text-center leading-snug">{t("onb.skipHint")}</p>
    </div>
  );
}

/**
 * The language switch. Two buttons rather than a <select>, because a select on iOS opens a
 * native wheel that renders its options in the system font and looked broken next to the
 * rest of the form. Both labels are always shown in their own language — "Русский", not
 * "Russian" — so it reads correctly whichever side you're currently stuck on.
 */
function LangToggle({ lang, onLang, className = "" }) {
  return (
    <div className={`inline-flex rounded-lg border border-gray-300 p-0.5 ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          onClick={() => onLang(l.id)}
          aria-pressed={lang === l.id}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            lang === l.id ? "bg-maroon-600 text-white" : "text-gray-600"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Header ----------
function Header({ saving }) {
  const t = useT();
  return (
    <div className="px-5 pt-6 pb-4 border-b border-gray-200">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-widest uppercase text-maroon-600 font-semibold mb-1">{t("app.tagline")}</p>
          {/* The product name is a proper noun and stays Latin in both languages. */}
          <h1 className="text-3xl font-bold tracking-tight">Chetamba</h1>
        </div>
        {saving && <Loader2 className="animate-spin text-gray-500" size={16} />}
      </div>
    </div>
  );
}

// ---------- Bottom Nav ----------
function BottomNav({ tab, setTab }) {
  const t = useT();
  // Russian nav labels are longer than the English ones ("Прогресс" vs "Progress"). At the
  // 18px base font four of them still fit across a narrow phone, but there is no room left —
  // adding a fifth tab would wrap, which is a second reason the program editor lives inside
  // Profile rather than beside it.
  const items = [
    { id: "log", label: t("nav.log"), icon: Dumbbell },
    { id: "history", label: t("nav.history"), icon: History },
    { id: "progress", label: t("nav.progress"), icon: LineChartIcon },
    { id: "profile", label: t("nav.profile"), icon: User },
  ];
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white backdrop-blur border-t border-gray-200 shadow-sm">
      <div className="max-w-md mx-auto grid grid-cols-4">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              // The program editor is a sub-screen of Profile rather than a fifth tab —
              // five icons at 18px base don't fit, and it isn't a daily destination.
              tab === id || (id === "profile" && tab === "program") ? "text-maroon-600" : "text-gray-500"
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Rest timer: edge ring + top readout ----------
// This used to be a bar floating above the bottom nav. On a phone the keyboard pushes that
// bar upward and it lands exactly on top of the weight/reps inputs, so you can't see the
// number you're typing. The timer is now a loop drawn around the screen edge instead:
// always visible, never on top of a control, and it shrinks as the rest runs down.
// The exact seconds live in RestReadout at the very top of the page — scroll up for them.

// Measured from the layout viewport, not visualViewport: when the keyboard opens we want
// the ring to stay pinned to the physical screen edge rather than reflowing around the
// keyboard, which would put its bottom edge right back over the inputs.
function useViewportBox() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const measure = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);
  return box;
}

const RING_INSET = 3;    // px between the screen edge and the outside of the stroke
const RING_WIDTH = 7;    // px stroke — thick enough to read peripherally while lifting
const RING_RADIUS = 20;  // px corner rounding

function RestRing({ timer }) {
  const { state, remaining } = timer;
  const { w, h } = useViewportBox();
  if (!state || w === 0 || h === 0) return null;

  const done = remaining <= 0;
  const edge = RING_INSET + RING_WIDTH / 2;
  const boxW = w - 2 * edge;
  const boxH = h - 2 * edge;
  if (boxW <= 0 || boxH <= 0) return null;

  const r = Math.min(RING_RADIUS, boxW / 2, boxH / 2);
  // Rounded-rect perimeter: the four straight runs plus one full circle's worth of corners.
  const perim = 2 * (boxW - 2 * r) + 2 * (boxH - 2 * r) + 2 * Math.PI * r;
  const fractionLeft = done ? 0 : Math.min(1, Math.max(0, remaining / state.total));

  return (
    <svg
      className="fixed inset-0 z-40 pointer-events-none"
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      aria-hidden="true"
    >
      {/* Track — the full loop, faint, so you can see how much has already gone. */}
      <rect
        x={edge} y={edge} width={boxW} height={boxH} rx={r} ry={r}
        stroke={done ? "#059669" : "#F3E6EF"}
        strokeWidth={RING_WIDTH}
        className={done ? "animate-pulse" : ""}
      />
      {/* Remaining time. The dash is the live arc; the gap is long enough to never repeat. */}
      {!done && (
        <rect
          x={edge} y={edge} width={boxW} height={boxH} rx={r} ry={r}
          stroke="#410038"
          strokeWidth={RING_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${perim * fractionLeft} ${perim}`}
        />
      )}
    </svg>
  );
}

// Sits in normal document flow at the very top of the page, so scrolling to the top of the
// workout reveals it — it reads as the edge ring unrolling into a label.
function RestReadout({ timer }) {
  const t = useT();
  const { state, remaining, pause, resume, addTime, dismiss } = timer;
  if (!state) return null;
  const done = remaining <= 0;

  return (
    <div className="px-3 pt-2">
      <div
        className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
          done ? "bg-emerald-50 border-emerald-300" : "bg-maroon-50 border-maroon-200"
        }`}
      >
        <span className={`font-mono text-3xl font-bold tabular-nums ${done ? "text-emerald-600" : "text-maroon-600"}`}>
          {done ? "0:00" : fmtClock(remaining)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 truncate">{done ? t("timer.done") : t("timer.resting", { label: state.label })}</p>
        </div>
        {!done && (
          <>
            <button onClick={() => addTime(15)} className="text-sm font-semibold text-gray-500 bg-white rounded-md px-2 py-1.5">
              +15s
            </button>
            <button onClick={state.paused ? resume : pause} className="text-gray-900 bg-white rounded-md p-1.5">
              {state.paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
          </>
        )}
        <button onClick={dismiss} className="text-gray-900 bg-white rounded-md p-1.5">
          {done ? <X size={17} /> : <SkipForward size={17} />}
        </button>
      </div>
    </div>
  );
}

// ---------- Log View ----------
// ---------- Quick Timer (manual start/stop, always on the main screen) ----------
function QuickTimer({ timer }) {
  const t = useT();
  const { state, remaining, start, pause, resume, addTime, dismiss } = timer;
  const [customLen, setCustomLen] = useState(60);
  const presets = [30, 45, 60, 90, 120];
  const active = !!state;
  const done = active && remaining <= 0;

  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-3 mb-4">
      {!active ? (
        <>
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">{t("timer.quickTitle")}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setCustomLen(p)}
                className={`text-xs font-mono px-2.5 py-1.5 rounded-md ${
                  customLen === p ? "bg-maroon-600 text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {p}s
              </button>
            ))}
          </div>
          <button
            onClick={() => start(customLen, t("timer.quick"))}
            className="w-full mt-2 flex items-center justify-center gap-1.5 bg-gray-900 text-white text-xs font-semibold rounded-md py-2.5"
          >
            <Play size={13} /> {t("timer.start")}
          </button>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <span className={`font-mono text-3xl font-bold tabular-nums ${done ? "text-emerald-600" : "text-gray-900"}`}>
            {done ? "0:00" : fmtClock(remaining)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 truncate">{done ? t("timer.done") : state.label}</p>
          </div>
          {!done && (
            <>
              <button onClick={() => addTime(15)} className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-md px-2 py-1.5">
                +15s
              </button>
              <button onClick={state.paused ? resume : pause} className="text-gray-900 bg-white border border-gray-200 rounded-md p-1.5">
                {state.paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
            </>
          )}
          <button onClick={dismiss} className="text-gray-900 bg-white border border-gray-200 rounded-md p-1.5">
            {done ? <X size={15} /> : <SkipForward size={15} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Rating system (Elo-flavored, benchmarked against your bodyweight) ----------
function diffDaysBetween(aIso, bIso) {
  const a = new Date(aIso + "T00:00:00").getTime();
  const b = new Date(bIso + "T00:00:00").getTime();
  return Math.max(0, Math.round((a - b) / 86400000));
}

// The slot an entry counts toward. A today-only substitution is credited to the exercise it
// replaced, NOT to itself — see the comment on computeEloTrajectory for why that matters.
function slotIdOf(entry) {
  return entry.substituteFor || entry.id;
}

// Pull the "top" logged set for an exercise entry (main weight/reps, ignoring drop-set weights,
// consistent with how the Progress tab already treats top sets).
function topSetOf(exerciseEntry) {
  if (!exerciseEntry || !exerciseEntry.sets || exerciseEntry.sets.length === 0) return null;
  return exerciseEntry.sets.reduce((best, s) => (s.weight > best.weight ? s : best), exerciseEntry.sets[0]);
}

// Performance index for a single logged instance of an exercise: 1.0 = benchmark "average person"
// your current bodyweight, 2.0 = benchmark "top 5%".
function performanceIndex(exerciseEntry, bodyweightKg, meta) {
  const top = topSetOf(exerciseEntry);
  if (!top || !bodyweightKg) return null;
  if (meta.type === "weight") {
    const ratio = top.weight / bodyweightKg;
    const raw = ratio * (top.reps / 10);
    return raw / meta.avg;
  }
  if (meta.type === "reps") {
    return top.reps / meta.avg;
  }
  if (meta.type === "duration") {
    // duration exercises (planks) are logged with seconds in the reps field
    return top.reps / meta.avg;
  }
  return null;
}

function expectedPFromRating(rating) {
  return (rating - 400) / 800;
}

function tierForRating(rating) {
  let current = TIERS[0];
  for (const t of TIERS) {
    if (rating >= t.min) current = t;
  }
  const idx = TIERS.indexOf(current);
  const next = TIERS[idx + 1] || null;
  return { tier: current, next };
}

// Replays your full session history to produce a rating trajectory. Skipped/never-touched exercises
// decay toward a neutral 1.0 (not 0) over RATING_HALF_LIFE_DAYS — so missing one lift slows growth,
// it doesn't freeze or reverse it. Always uses your CURRENT saved bodyweight, so updating your profile
// re-contextualizes your whole history, not just future sessions.
// The denominator is the CURRENT program, not everything ever logged. Two consequences,
// both deliberate:
//   - Removing an exercise from your program stops it dragging on your rating forever.
//   - A substituted lift is credited to the slot it replaced (slotIdOf), so swapping in a
//     leg extension when the leg press is taken does NOT leave "leg press" reading as
//     untouched. Without this, doing the workout correctly would slow your climb, which
//     directly contradicts the rule in §6 that skipping is what costs you.
// The substitute is scored with ITS OWN benchmark (you did a leg extension, so it's judged
// as a leg extension) but weighted by the SLOT's multiplier, because that's the role it
// filled today.
function computeEloTrajectory(sessions, bodyweightKg, program) {
  if (!bodyweightKg || !sessions || sessions.length === 0) {
    return { trajectory: [], rating: STRENGTH_BASELINE, coverage: [] };
  }
  // Patterns are what the ranked slots are keyed on, and history predating pattern stamping
  // has none — backfill before any of it is scored, or old sessions read as untrained.
  const hydrated = hydratePatterns(sessions, program && program.days ? program : withMetaIndex(DEFAULT_PROGRAM));
  const sorted = [...hydrated].sort((a, b) => (a.date < b.date ? -1 : 1));

  // The score at each past date is recomputed from the log as it stood that day. Slower than
  // the old incremental replay, but it's a few dozen sessions and it buys order-independence:
  // the same log always yields the same curve, which an Elo update loop could not promise.
  const trajectory = sorted.map((session, i) => ({
    date: session.date,
    rating: strengthScore(sorted.slice(0, i + 1), bodyweightKg, session.date).score,
    layoffPenalty: 0, // absence is shown on the weekly effort axis now, not punished twice
    gapDays: i > 0 ? diffDaysBetween(session.date, sorted[i - 1].date) : 0,
  }));

  const latestDate = sorted[sorted.length - 1].date;
  const final = strengthScore(sorted, bodyweightKg, latestDate);

  // Per-pattern coverage, as of the latest session. This is also what the per-slot tiers in
  // the Progress tab render from — twelve sub-goals rather than one number.
  const coverage = final.slots.map((slot) => ({
    id: slot.id,
    name: slot.label,
    status:
      slot.daysSince === null ? "untouched"
        : slot.daysSince <= 3 ? "fresh"
        : slot.daysSince <= STRENGTH_HALF_LIFE_DAYS ? "fading"
        : "stale",
    daysSince: slot.daysSince,
    rating: Math.round(STRENGTH_FLOOR + 800 * slot.contribution),
    viaName: null,
  }));

  return { trajectory, rating: final.score, coverage };
}

function daysAgo(iso, lang = DEFAULT_LANG) {
  const d = new Date(iso + "T00:00:00");
  const diffMs = Date.now() - d.getTime();
  const days = Math.round(diffMs / 86400000);
  if (days <= 0) return t(lang, "time.today");
  return t(lang, "time.daysAgo", { n: days, unit: plural(lang, days, "unit.day") });
}

// ---------- Local rule-based coach (no API, works offline) ----------
// Compares today's planned exercises against your most recent session of the same day,
// plus overall recency for fatigue context. Deliberately conservative: anything that reads
// like pain or discomfort in your notes produces a back-off suggestion, never a push.
// Both languages are checked at once, regardless of the UI setting. Two reasons: the note
// was typed in whatever language the user thinks in, which need not match the switch, and a
// missed pain word is the single most costly failure in this file — it lets the next branch
// suggest ADDING WEIGHT to a lift that hurt.
//
// The Russian entries are stems rather than whole words because Russian inflects: "бол"
// catches боль / болит / больно / болел, which listing full forms would not. Stems overmatch
// slightly and that is the correct direction to be wrong in — a false positive tells someone
// to back off a lift that was fine, a false negative tells someone to load a lift that hurt.
const PAIN_WORDS = [
  // English
  "pain", "hurt", "sharp", "tweak", "twinge", "sore", "strain", "pinch", "ache",
  "uncomfortable", "wrong", "clicked", "pop",
  // Russian — stems
  "бол",        // боль, болит, больно, болел
  "ноет", "ныл",
  "прострел", "защемил", "защемл", "зажал",
  "хрустн", "щёлкн", "щелкн", "хруст",
  "тяне",       // тянет спину
  "жжёт", "жжет",
  "дискомфорт", "неприятн",
  "остр",       // острая боль — does not match "осторожно"
  "потянул", "надорвал", "сорвал",
  "свело", "спазм", "судорог",
  "воспал", "отёк", "отек", "травм", "неудобн",
];

function noteSignalsProblem(note) {
  if (!note) return false;
  const n = note.toLowerCase();
  return PAIN_WORDS.some((w) => n.includes(w));
}

function repTargetCeiling(target) {
  if (!target) return null;
  const m = String(target).match(/(\d+)\s*-\s*(\d+)/);
  return m ? Number(m[2]) : null;
}

function buildLocalCoach({ day, programExercises, lastSameDay, lastOverall, program, lang = DEFAULT_LANG }) {
  const notes = [];
  const tr = (key, vars) => t(lang, key, vars);
  const nameOf = (ex) => exerciseDisplayName(lang, ex && ex.id, ex && ex.name);

  programExercises.forEach((pe) => {
    // Match on id, not name: renaming a lift must not orphan its history.
    const entries = (lastSameDay && lastSameDay.exercises) || [];
    const prev = entries.find((e) => e.id === pe.id && !e.substituteFor);
    const name = nameOf(pe);

    if (!prev || !prev.sets || prev.sets.length === 0) {
      // If the slot was filled by a substitute last time, say so rather than claiming there's
      // no history. Quoting the substitute's weights here would be actively misleading — a
      // leg extension's 40kg is not a leg press's 40kg.
      const sub = entries.find((e) => e.substituteFor === pe.id && e.sets && e.sets.length);
      if (sub) {
        notes.push({ id: pe.id, name, note: tr("coach.swapped", { sub: nameOf(sub) }) });
        return;
      }
      notes.push({ id: pe.id, name, note: tr("coach.noHistory") });
      return;
    }
    // Stays ahead of every suggestion below — a note that mentioned pain must never reach the
    // "add weight" branch. tests/test-flow.mjs pins this ordering.
    if (noteSignalsProblem(prev.notes)) {
      notes.push({ id: pe.id, name, note: tr("coach.pain") });
      return;
    }
    const meta = metaForEntry(pe, program);
    const ceiling = repTargetCeiling(pe.target);
    const lastSet = prev.sets[prev.sets.length - 1];
    const topSet = topSetOf(prev);
    const hadDrops = prev.sets.some((s) => (s.drops || []).length > 0);

    if (meta.type === "duration" || meta.type === "reps") {
      notes.push({
        id: pe.id,
        name,
        note: tr("coach.beatIt", {
          amount: meta.type === "duration"
            ? tr("unit.secondsShort", { n: topSet.reps })
            : `${topSet.reps} ${plural(lang, topSet.reps, "unit.rep")}`,
        }),
      });
      return;
    }
    if (ceiling && lastSet.reps >= ceiling && !hadDrops) {
      const bump = topSet.weight >= 20 ? 2.5 : topSet.weight >= 10 ? 2 : 1;
      notes.push({ id: pe.id, name, note: tr("coach.addWeight", { was: topSet.weight, next: topSet.weight + bump }) });
      return;
    }
    if (hadDrops) {
      notes.push({ id: pe.id, name, note: tr("coach.drops", { weight: topSet.weight }) });
      return;
    }
    notes.push({ id: pe.id, name, note: tr("coach.addReps", { weight: topSet.weight }) });
  });

  let overall;
  if (!lastSameDay) {
    overall = tr("coach.firstDay", { day });
  } else {
    const gap = diffDaysBetween(todayISO(), lastSameDay.date);
    const overallGap = lastOverall ? diffDaysBetween(todayISO(), lastOverall.date) : null;
    if (overallGap !== null && overallGap <= 1) {
      overall = tr("coach.trainedRecently", { when: tr(overallGap === 0 ? "time.today" : "time.yesterday") });
    } else if (gap > 21) {
      overall = tr("coach.longGap", { days: gap, unit: plural(lang, gap, "unit.day"), day });
    } else {
      overall = tr("coach.recentGap", { day, days: gap, unit: plural(lang, gap, "unit.day") });
    }
  }

  return { overall, exercises: notes };
}

// ---------- Coach Panel (pre-workout analysis) ----------
function CoachPanel({ analysis, onStart }) {
  const t = useT();
  if (analysis === null) {
    return (
      <button
        onClick={onStart}
        className="w-full mb-5 flex items-center justify-center gap-2 px-3 rounded-xl border border-dashed border-maroon-300 bg-maroon-50 text-maroon-700 text-sm font-semibold leading-tight text-center py-3"
      >
        <Sparkles size={15} className="shrink-0" /> {t("coach.start")}
      </button>
    );
  }

  return (
    <div className="mb-5 rounded-xl bg-gray-900 text-white px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles size={13} className="text-maroon-400" />
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">{t("coach.title")}</p>
      </div>
      <p className="text-sm leading-snug">{analysis.overall}</p>
      <p className="text-xs text-gray-400 mt-2">{t("coach.perExercise")}</p>
    </div>
  );
}

const DRAFT_KEY = "draft_v1";

// Turn a program exercise into a blank log entry. The id travels with it — that's what ties
// the logged sets back to the right slot in the rating and the coach.
// The movement pattern travels too. The cross-user score in scoring.js is computed per
// PATTERN rather than per exercise, and it has to keep working for a session logged today
// after the program is edited tomorrow — so the pattern is recorded on the entry at log
// time rather than looked up later. Sessions logged before this existed are backfilled on
// read by hydratePatterns().
function logEntryFor(progEx) {
  return {
    id: progEx.id,
    name: progEx.name,
    muscle: progEx.muscle || "",
    rest: progEx.rest || DEFAULT_REST,
    link: progEx.link || "",
    target: progEx.target || "",
    pattern: progEx.pattern || inferPatternId(progEx.meta),
    notes: "",
    sets: [],
  };
}

// Backfill `pattern` for history logged before entries carried one. Same lookup order as
// metaForEntry: the live program wins (so re-classifying an exercise re-contextualises its
// whole history), then metadata carried on the entry itself, then the built-in table.
// Never mutates storage — a migration that rewrites every session can half-fail, and the
// export is copy-only, so there'd be no way back.
function hydratePatterns(sessions, program) {
  const byId = {};
  (program.days || []).forEach((d) => {
    (program.exercisesByDay[d.id] || []).forEach((e) => {
      if (e.pattern) byId[e.id] = e.pattern;
    });
  });
  return (sessions || []).map((s) => ({
    ...s,
    exercises: (s.exercises || []).map((e) => ({
      ...e,
      pattern: byId[e.id] || e.pattern || inferPatternId(metaForEntry(e, program)),
    })),
  }));
}

// A blank day you build as you go. Not part of the program, so exercisesForDay returns []
// for it and you add what you actually did. This is how "I went to the gym and improvised"
// gets logged without editing your split — and since the ranked score is keyed on movement
// patterns rather than program membership, improvised work scores exactly like planned work.
// Name and subtitle are translation keys resolved at render, not literals: unlike a real
// program day this one is ours, so it has to follow the language switch. `day.adhoc` also
// exists in the dictionary so dayDisplayName() resolves it like any other built-in.
const ADHOC_DAY = { id: "adhoc", name: "Ad-hoc", subtitle: "" };

function ModeToggle({ mode, setMode }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-1.5 mb-4">
      {[{ id: "lift", label: t("log.lift") }, { id: "activity", label: t("log.activity") }].map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
            mode === m.id ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-500"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// Basketball, hikes, runs. Scored on the effort axis only: there is no load and no reps, so
// there is nothing about a pickup game that can honestly be called strength. Duration curves
// saturate rather than decline, so logging the true length is never worse than shading it —
// see the note on ACTIVITY_TYPES in scoring.js.
function ActivityLog({ onSave }) {
  const t = useT();
  const [typeId, setTypeId] = useState(ACTIVITY_TYPES[0].id);
  const [minutes, setMinutes] = useState("");
  const [date, setDate] = useState(todayISO());
  const [justSaved, setJustSaved] = useState(false);

  const mins = toNumber(minutes);
  const earned = mins > 0 ? activityEffort(typeId, mins) : 0;
  const type = activityTypeById(typeId);

  async function save() {
    await onSave({ id: uid(), kind: "activity", date, activityType: typeId, minutes: mins, exercises: [] });
    setMinutes("");
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  return (
    <div>
      <WithInfo text={t("act.explain")} className="mb-3">
        <p className="text-xs text-gray-500">{t("act.explainTitle")}</p>
      </WithInfo>

      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {ACTIVITY_TYPES.map((a) => (
          <button
            key={a.id}
            onClick={() => setTypeId(a.id)}
            className={`rounded-lg py-2 text-xs font-semibold leading-tight transition-colors ${
              typeId === a.id ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {t(`act.${a.id}`)}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("log.date")}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("act.minutes")}</span>
          {/* text + inputMode, never type="number" — see the iOS notes in the handover doc. */}
          <input
            type="text"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder={String(type.halfMin)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {mins > 0 && (
        <p className="text-xs text-gray-500 mb-4">
          {t("act.worth")}{" "}
          <span className="font-semibold text-maroon-600">{earned.toFixed(2)}</span>{" "}
          {earned > type.ceiling * 0.9 ? t("act.worthSuffixNearCap") : t("act.worthSuffix")}
        </p>
      )}

      <button
        onClick={save}
        disabled={!(mins > 0)}
        className={`w-full rounded-lg py-3 text-sm font-semibold ${
          mins > 0 ? "bg-maroon-600 text-white" : "bg-gray-200 text-gray-400"
        }`}
      >
        {justSaved ? t("log.saved") : t("act.record")}
      </button>
    </div>
  );
}

function LogView({ onSave, timer, sessions, program }) {
  const t = useT();
  const lang = useLang();
  const dayName = useDayName();
  const days = program.days;
  const [dayId, setDayId] = useState(() => (days[0] ? days[0].id : ""));
  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState("");
  const [exercises, setExercises] = useState(() => exercisesForDay(program, days[0] ? days[0].id : "").map(logEntryFor));
  const [justSaved, setJustSaved] = useState(false);
  const [analysis, setAnalysis] = useState(null); // null | { overall, exercises }
  const [restored, setRestored] = useState(false);
  const [draftState, setDraftState] = useState("idle"); // idle | saving | saved
  const draftTimer = useRef(null);

  const [mode, setMode] = useState("lift"); // lift | activity
  const selectableDays = [...days, ADHOC_DAY];
  const day =
    dayById(program, dayId) ||
    (dayId === ADHOC_DAY.id ? ADHOC_DAY : null) ||
    days[0] || { id: "", name: "", subtitle: "" };

  // Restore an in-progress workout on open, so closing the app mid-session never loses sets.
  useEffect(() => {
    (async () => {
      const raw = await cloud.get(DRAFT_KEY);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          const hasWork = d.exercises && d.exercises.some((e) => e.sets && e.sets.length > 0);
          if (hasWork) {
            // Drafts written before ids existed, or against a day that has since been
            // renamed or deleted, still restore — never lose logged work over a schema detail.
            const restoredDayId = d.dayId || slugId(d.day || "");
            if (dayById(program, restoredDayId)) setDayId(restoredDayId);
            setDate(d.date || todayISO());
            setDuration(d.duration || "");
            setExercises(d.exercises.map((e) => ({ ...e, id: e.id || slugId(e.name) })));
          }
        } catch (e) { /* ignore malformed draft */ }
      }
      setRestored(true);
    })();
  }, []);

  // Continuously persist the working draft (debounced) — this is the autosave.
  useEffect(() => {
    if (!restored) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const hasWork = exercises.some((e) => e.sets.length > 0);
    draftTimer.current = setTimeout(async () => {
      if (!hasWork) return;
      setDraftState("saving");
      const payload = JSON.stringify({ day: day.name, dayId, date, duration, exercises });
      const ok = payload.length <= 4000 ? await cloud.set(DRAFT_KEY, payload) : false;
      setDraftState(ok ? "saved" : "idle");
      if (ok) setTimeout(() => setDraftState("idle"), 1500);
    }, 700);
    return () => draftTimer.current && clearTimeout(draftTimer.current);
  }, [dayId, day.name, date, duration, exercises, restored]);

  function changeDay(newDayId) {
    setDayId(newDayId);
    setExercises(exercisesForDay(program, newDayId).map(logEntryFor));
    setAnalysis(null);
  }

  function handleStartWorkout() {
    const sameDaySessions = (sessions || [])
      .filter((s) => (s.dayId || slugId(s.day)) === dayId)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const allSorted = [...(sessions || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    setAnalysis(
      buildLocalCoach({
        // The coach quotes the day back at you ("Last Upper A was 4 days ago"), so it needs
        // the translated name rather than the stored one.
        day: dayName(day),
        programExercises: exercisesForDay(program, dayId),
        lastSameDay: sameDaySessions[0] || null,
        lastOverall: allSorted[0] || null,
        program,
        lang,
      })
    );
  }

  function updateExercise(idx, updated) {
    setExercises((prev) => prev.map((e, i) => (i === idx ? updated : e)));
  }

  // Today-only substitution. The slot being filled (substituteFor) is preserved across
  // repeated swaps, so swapping twice doesn't chain and lose the original slot.
  function substituteExercise(idx, replacement) {
    const inProgram = programSlots(program).some((s) => s.id === replacement.id);
    setExercises((prev) =>
      prev.map((e, i) => {
        if (i !== idx) return e;
        const slot = e.substituteFor || e.id;
        if (replacement.id === slot) {
          // Swapped back to the original — drop the substitution rather than marking the
          // exercise as a substitute for itself.
          const { substituteFor, substituteForName, ...rest } = e;
          return { ...rest, ...logEntryFor(replacement) };
        }
        const entry = { ...logEntryFor(replacement), substituteFor: slot, substituteForName: e.substituteForName || e.name };
        // An off-program substitute has nowhere else to keep its benchmark, so it carries a
        // copy. Program exercises deliberately don't, so that editing the program later
        // re-contextualises their history instead of freezing it at log time.
        if (!inProgram) entry.meta = replacement.meta || metaFromPattern(replacement.pattern);
        return entry;
      })
    );
    setAnalysis(null);
  }

  function addCustomExercise() {
    // The placeholder name is stored translated rather than as a key, because a one-off id
    // is unique per tap and so can never have a dictionary entry. It's a starting value the
    // user is expected to overwrite, so freezing it in the language it was created in is the
    // same rule that applies to anything else they type.
    setExercises((prev) => [...prev, { ...emptyExerciseLog(t("log.newExercise"), "", DEFAULT_REST), id: "one-off-" + uid() }]);
  }


  function removeExercise(idx) {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalSets = exercises.reduce((sum, e) => sum + e.sets.length, 0);
  const canSave = totalSets > 0;

  async function handleSave() {
    const session = {
      id: uid(),
      kind: "lift",
      date,
      day: day.name,
      dayId,
      duration: duration ? Number(duration) : null,
      exercises: exercises.filter((e) => e.sets.length > 0),
    };
    await onSave(session);
    await cloud.remove(DRAFT_KEY);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    setExercises(exercisesForDay(program, dayId).map(logEntryFor));
    setDuration("");
    setAnalysis(null);
  }

  // Placed after every hook, so the early return can't change hook order between renders.
  if (mode === "activity") {
    return (
      <div className="px-4 pt-4">
        <ModeToggle mode={mode} setMode={setMode} />
        <ActivityLog onSave={onSave} />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <ModeToggle mode={mode} setMode={setMode} />
      <QuickTimer timer={timer} />

      {/* Day selector. Two columns once there are more than four days, because the program
          is user-editable now and a fixed 4-wide grid squeezes them unreadably thin. */}
      <div className={`grid gap-1.5 mb-4 ${selectableDays.length > 4 ? "grid-cols-3" : "grid-cols-4"}`}>
        {selectableDays.map((d) => (
          <button
            key={d.id}
            onClick={() => changeDay(d.id)}
            className={`rounded-lg py-2 text-xs font-semibold leading-tight transition-colors ${
              dayId === d.id ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {dayName(d)}
          </button>
        ))}
      </div>
      {/* The built-in days' subtitles come from the dictionary; a day the user created keeps
          whatever subtitle they typed. Same rule as the names. */}
      {(t(`day.${day.id}.subtitle`) !== `day.${day.id}.subtitle`
        ? <p className="text-xs text-gray-500 mb-4">{t(`day.${day.id}.subtitle`)}</p>
        : day.subtitle ? <p className="text-xs text-gray-500 mb-4">{day.subtitle}</p> : null)}

      {/* Coach: pre-workout analysis */}
      <CoachPanel analysis={analysis} onStart={handleStartWorkout} />

      {/* Date + duration */}
      <div className="flex gap-3 mb-5">
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("log.date")}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ colorScheme: "light" }}
            className="w-full bg-gray-100 rounded-md px-3 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
          />
        </label>
        <label className="w-28">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("act.minutes")}</span>
          <input
            type="number"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="47"
            className="w-full bg-gray-100 rounded-md px-3 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
          />
        </label>
      </div>

      {/* Exercises */}
      <div className="space-y-3">
        {exercises.map((ex, idx) => {
          // Matched on the slot, so a substituted card still shows the advice for the slot
          // it's filling rather than falling silent.
          const slot = ex.substituteFor || ex.id;
          const coachNote =
            analysis && typeof analysis === "object"
              ? (analysis.exercises || []).find((a) => a.id === slot)?.note
              : null;
          return (
            <ExerciseCard
              key={idx}
              exercise={ex}
              target={ex.target}
              timer={timer}
              coachNote={coachNote}
              program={program}
              onChange={(updated) => updateExercise(idx, updated)}
              onSubstitute={(replacement) => substituteExercise(idx, replacement)}
              onRemove={() => removeExercise(idx)}
            />
          );
        })}
      </div>

      <button
        onClick={addCustomExercise}
        className="w-full mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 text-gray-500 text-sm py-2.5 hover:border-gray-300 hover:text-gray-900 transition-colors"
      >
        <Plus size={15} /> {t("log.addOneOff")}
      </button>
      {/* This copy was wrong in the wild once — it still claimed one-offs "don't count toward
          your rating" long after that rule was deleted. Re-read it whenever scoring changes;
          tests/test-program.mjs pins the corrected sentence. */}
      <WithInfo text={t("log.oneOffHint")} className="mt-1.5">
        <p className="text-xs text-gray-400 leading-snug">{t("log.oneOffTitle")}</p>
      </WithInfo>

      <button
        onClick={handleSave}
        disabled={!canSave}
        className={`w-full mt-5 flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors ${
          canSave ? "bg-maroon-600 text-white active:bg-maroon-700" : "bg-gray-100 text-gray-400"
        }`}
      >
        {justSaved ? `${t("log.saved")} ✓` : (
          <>
            <Save size={16} /> {t("log.save")}
          </>
        )}
      </button>
    </div>
  );
}

// ---------- Keyboard accessory bar ----------
// iOS's numeric and decimal keypads have no return key at all, so `enterkeyhint` can't give
// us a "next" or a "done" — there is no key to put the hint on. The only way to get a tab
// key on a phone is to draw one ourselves directly above the keyboard, which means knowing
// where the keyboard is: visualViewport is the one API that tells us.
function useKeyboardOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    // How much of the layout viewport is currently covered from the bottom — the keyboard
    // plus any browser chrome. Pinning the bar to this keeps it flush with the key tops.
    const update = () => setOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return offset;
}

function KeyboardAccessory({ label, actionLabel, actionIcon, onAction, onDone, disabled }) {
  const t = useT();
  const offset = useKeyboardOffset();
  if (typeof document === "undefined") return null;

  // Portalled to <body> so no card's overflow or stacking context can clip it.
  return createPortal(
    <div className="fixed inset-x-0 z-50" style={{ bottom: offset }}>
      <div className="max-w-md mx-auto flex items-center gap-2 bg-gray-100 border-t border-gray-300 px-3 py-2 shadow-lg">
        <span className="flex-1 min-w-0 truncate text-sm text-gray-500">{label}</span>
        {/* preventDefault on mousedown keeps focus in the input, so the keyboard doesn't
            flicker shut and reopen between fields. */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDone}
          className="text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-md px-3 py-2"
        >
          {t("kb.done")}
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onAction}
          disabled={disabled}
          className={`flex items-center gap-1.5 text-sm font-semibold rounded-md px-4 py-2 ${
            disabled ? "bg-gray-300 text-gray-500" : "bg-maroon-600 text-white"
          }`}
        >
          {actionLabel} {actionIcon}
        </button>
      </div>
    </div>,
    document.body
  );
}

// iOS decimal keypads emit a comma as the separator in some locales.
function toNumber(v) {
  const n = Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * The movement-pattern dropdown, shared by Swap, the exercise card and the program editor.
 * Factored out when it was translated: three copies of the same <option> list meant three
 * places to forget, and the label+hint format is the kind of thing that drifts silently.
 */
function PatternSelect({ value, onChange, className }) {
  const t = useT();
  return (
    <select
      value={value || "isolation-upper"}
      onChange={(e) => onChange(e.target.value)}
      style={{ colorScheme: "light" }}
      className={className}
    >
      {MOVEMENT_PATTERNS.map((p) => (
        <option key={p.id} value={p.id}>
          {t(`pat.${p.id}`)} — {t(`pat.${p.id}.hint`)}
        </option>
      ))}
    </select>
  );
}

// ---------- Swap (today-only substitution) ----------
// The machine you wanted is taken. Pick something else for today WITHOUT editing the program:
// the work still counts toward the slot it replaced, so the rating doesn't read the original
// as skipped. Editing the program itself is a different action, in the Program editor.
function SwapPanel({ program, currentId, slotId, loggedSets, onPick, onCancel }) {
  const t = useT();
  const lang = useLang();
  const exName = useExerciseName();
  const [mode, setMode] = useState("pick"); // pick | custom
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");

  const byId = useMemo(() => {
    const m = {};
    (program.days || []).forEach((d) =>
      (program.exercisesByDay[d.id] || []).forEach((e) => { if (!m[e.id]) m[e.id] = e; })
    );
    return m;
  }, [program]);

  // Default to the movement pattern of the lift being replaced. A substitute is nearly always
  // the same movement — the machine was busy, not the goal — so this is both the likely answer
  // and the one least able to distort the rating if left alone.
  const slotExercise = byId[slotId];
  const [customPattern, setCustomPattern] = useState(
    (slotExercise && slotExercise.pattern) || inferPatternId(slotExercise && slotExercise.meta) || "isolation-upper"
  );

  const options = useMemo(
    () => programSlots(program).filter((s) => s.id !== currentId).map((s) => byId[s.id]).filter(Boolean),
    [program, currentId, byId]
  );

  // Matches the displayed name AND the stored one. Searching only the stored name meant a
  // Russian user typing "жим" found nothing, because the underlying record still says
  // "Dumbbell Bench Press"; searching only the displayed name would break the reverse case.
  const filtered = query.trim()
    ? options.filter((e) => {
        const q = query.trim().toLowerCase();
        return exName(e).toLowerCase().includes(q) || String(e.name || "").toLowerCase().includes(q);
      })
    : options;

  function pickCustom() {
    const name = customName.trim();
    if (!name) return;
    onPick({
      id: "sub-" + slugId(name) + "-" + uid().slice(-4),
      name,
      muscle: t(`pat.${customPattern}`),
      target: "",
      rest: DEFAULT_REST,
      link: "",
      pattern: customPattern,
      meta: metaFromPattern(customPattern),
    });
  }

  return (
    <div className="mx-3.5 mb-3 rounded-md bg-white border border-gray-200 px-2.5 py-2.5">
      <WithInfo text={t("swap.explain")} className="mb-2">
        <p className="text-xs font-semibold text-gray-700">{t("swap.title")}</p>
      </WithInfo>

      {loggedSets > 0 && (
        <p className="text-xs text-maroon-700 mb-2 leading-snug">
          {t("swap.willClear", { n: loggedSets, unit: plural(lang, loggedSets, "unit.set") })}
        </p>
      )}

      <div className="flex gap-1.5 mb-2">
        <button
          onClick={() => setMode("pick")}
          className={`flex-1 text-xs font-semibold rounded-md py-1.5 ${mode === "pick" ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-600"}`}
        >
          {t("swap.fromProgram")}
        </button>
        <button
          onClick={() => setMode("custom")}
          className={`flex-1 text-xs font-semibold rounded-md py-1.5 ${mode === "custom" ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-600"}`}
        >
          {t("swap.somethingElse")}
        </button>
      </div>

      {mode === "pick" ? (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("swap.search")}
            className="w-full mb-2 bg-gray-50 rounded-md px-2.5 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {filtered.length === 0 && <p className="text-xs text-gray-400 py-2">{t("swap.noMatch")}</p>}
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => onPick(e)}
                className="w-full text-left rounded-md border border-gray-200 px-2.5 py-2 hover:bg-gray-50"
              >
                <span className="block text-sm font-semibold truncate">{exName(e)}</span>
                {e.muscle && <span className="block text-xs text-gray-500 truncate">{e.muscle}</span>}
                {e.id === slotId && <span className="block text-xs text-maroon-600">{t("swap.original")}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={t("swap.customPlaceholder")}
            className="w-full mb-2 bg-gray-50 rounded-md px-2.5 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          <WithInfo text={t("swap.patternHint")} className="mb-1">
            <p className="text-xs text-gray-500">{t("log.patternLabel")}</p>
          </WithInfo>
          <PatternSelect value={customPattern} onChange={setCustomPattern} className="w-full mb-2 bg-gray-50 rounded-md px-2.5 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600" />
          <button
            onClick={pickCustom}
            disabled={!customName.trim()}
            className={`w-full text-sm font-semibold rounded-md py-2 ${customName.trim() ? "bg-maroon-600 text-white" : "bg-gray-200 text-gray-400"}`}
          >
            {t("swap.useToday")}
          </button>
        </>
      )}

      <button onClick={onCancel} className="w-full mt-2 text-xs font-semibold text-gray-500 py-1.5">
        {t("common.cancel")}
      </button>
    </div>
  );
}

function ExerciseCard({ exercise, target, timer, coachNote, program, onChange, onSubstitute, onRemove }) {
  const t = useT();
  const exName = useExerciseName();
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [swapOpen, setSwapOpen] = useState(false);
  const [restLen, setRestLen] = useState(exercise.rest || DEFAULT_REST);
  const [dropFormFor, setDropFormFor] = useState(null);
  const [dropWeight, setDropWeight] = useState("");
  const [dropReps, setDropReps] = useState("");

  // Which of this card's set-entry fields has the keyboard, so we know what the accessory
  // bar's action button should do. Only the focused card renders a bar.
  const [focusField, setFocusField] = useState(null); // null | "weight" | "reps"
  const weightRef = useRef(null);
  const repsRef = useRef(null);
  const blurTimer = useRef(null);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  function handleFieldFocus(field, el) {
    clearTimeout(blurTimer.current);
    setFocusField(field);
    // The accessory bar sits right on top of the keyboard, and iOS only guarantees the
    // focused input is above the keyboard — not above our bar. Centre it so it can't hide.
    setTimeout(() => {
      try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* older webview */ }
    }, 300);
  }

  // Tapping from weight to reps blurs before it focuses; the delay lets the incoming focus
  // cancel the teardown so the bar doesn't flash away between fields.
  function handleFieldBlur() {
    clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setFocusField(null), 150);
  }

  const weightNum = toNumber(weight);
  const repsNum = toNumber(reps);
  const canAddSet = weight !== "" && reps !== "" && !Number.isNaN(weightNum) && !Number.isNaN(repsNum);

  function addSet() {
    if (!canAddSet) return;
    const set = { weight: weightNum, reps: repsNum };
    onChange({ ...exercise, sets: [...exercise.sets, set] });
    setReps("");
    timer.start(restLen, exName(exercise));
  }

  function goToReps() {
    const el = repsRef.current;
    if (!el) return;
    el.focus();
    // Select rather than clear, so the previous set's rep count is a one-tap repeat.
    try { el.select(); } catch (e) { /* not selectable in this engine */ }
  }

  // "Record the set" from the keyboard bar: log it, then drop the keyboard so the set list
  // and the rest ring are visible — you're about to rest, not type.
  function recordFromKeyboard() {
    if (!canAddSet) return;
    addSet();
    clearTimeout(blurTimer.current);
    setFocusField(null);
    if (repsRef.current) repsRef.current.blur();
  }

  function removeSet(i) {
    onChange({ ...exercise, sets: exercise.sets.filter((_, si) => si !== i) });
    if (dropFormFor === i) setDropFormFor(null);
  }

  function toggleDropForm(i) {
    if (dropFormFor === i) {
      setDropFormFor(null);
    } else {
      setDropFormFor(i);
      setDropWeight("");
      setDropReps("");
    }
  }

  function addDrop(i) {
    if (dropWeight === "" || dropReps === "") return;
    if (Number.isNaN(toNumber(dropWeight)) || Number.isNaN(toNumber(dropReps))) return;
    const newSets = exercise.sets.map((s, si) => {
      if (si !== i) return s;
      const drop = { weight: toNumber(dropWeight), reps: toNumber(dropReps) };
      const drops = s.drops ? [...s.drops, drop] : [drop];
      return { ...s, drops };
    });
    onChange({ ...exercise, sets: newSets });
    setDropReps("");
    // no rest timer — drop sets continue immediately, no rest between the drop and the set before it
  }

  function removeDrop(setIdx, dropIdx) {
    const newSets = exercise.sets.map((s, si) => {
      if (si !== setIdx) return s;
      return { ...s, drops: (s.drops || []).filter((_, di) => di !== dropIdx) };
    });
    onChange({ ...exercise, sets: newSets });
  }

  function renameExercise(name) {
    onChange({ ...exercise, name });
  }

  function updateNotes(notes) {
    onChange({ ...exercise, notes });
  }

  const restPresets = [45, 60, 90, 120];
  const slotId = exercise.substituteFor || exercise.id;
  const slotMatch = exercise.substituteFor && program
    ? programSlots(program).find((s) => s.id === exercise.substituteFor)
    : null;
  const originalName = slotMatch
    ? exName(slotMatch)
    : exercise.substituteForName || null;
  // One-off additions aren't in the program, so there's no slot for them to stand in for.
  const canSwap = !!onSubstitute && !String(exercise.id || "").startsWith("one-off-");

  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          {expanded ? <ChevronUp size={15} className="text-gray-500 shrink-0" /> : <ChevronDown size={15} className="text-gray-500 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{exName(exercise)}</p>
            {exercise.muscle && <p className="text-xs text-gray-500 truncate">{exercise.muscle}{target ? ` · ${t("log.target")} ${target}` : ""}</p>}
          </div>
        </button>
        {canSwap && (
          <button
            onClick={() => setSwapOpen((v) => !v)}
            className={`flex items-center gap-1 text-xs font-semibold rounded-md px-2 py-1.5 shrink-0 mr-1 ${
              swapOpen ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            <RotateCcw size={11} /> {t("log.swap")}
          </button>
        )}
        {exercise.link && (
          <a
            href={exercise.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs font-semibold text-maroon-600 bg-maroon-50 rounded-md px-2 py-1.5 shrink-0 mr-1"
          >
            <ExternalLink size={11} /> {t("log.form")}
          </a>
        )}
        <button onClick={onRemove} className="text-gray-500 hover:text-maroon-600 bg-gray-100 rounded-md p-1.5 shrink-0">
          <X size={14} />
        </button>
      </div>

      {/* Substitution badge. Says which slot is being filled, because that's what the rating
          and the coach will attribute this work to. */}
      {exercise.substituteFor && (
        <div className="mx-3.5 mb-3 flex items-center gap-1.5 rounded-md bg-gray-100 border border-gray-200 px-2.5 py-2">
          <RotateCcw size={12} className="text-gray-500 shrink-0" />
          <p className="text-xs text-gray-600 leading-snug flex-1">
            {t("log.standingInFor")}{" "}
            <span className="font-semibold">{originalName || t("log.anotherLift")}</span>{" "}
            {t("log.countsToSlot")}
          </p>
        </div>
      )}

      {/* One-off exercises aren't in the program, so nothing else knows how to score them.
          Program lifts get their pattern from the program and don't need this. */}
      {String(exercise.id).startsWith("one-off-") && (
        <div className="mx-3.5 mb-3">
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            {t("log.patternLabel")}
          </label>
          <PatternSelect
            value={exercise.pattern}
            onChange={(next) => onChange({ ...exercise, pattern: next, meta: metaFromPattern(next) })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
        </div>
      )}

      {swapOpen && (
        <SwapPanel
          program={program}
          currentId={exercise.id}
          slotId={slotId}
          loggedSets={exercise.sets.length}
          onPick={(replacement) => { setSwapOpen(false); onSubstitute(replacement); }}
          onCancel={() => setSwapOpen(false)}
        />
      )}

      {coachNote && (
        <div className="mx-3.5 mb-3 flex items-start gap-1.5 rounded-md bg-maroon-50 border border-maroon-100 px-2.5 py-2">
          <Sparkles size={12} className="text-maroon-500 shrink-0 mt-0.5" />
          <p className="text-xs text-maroon-800 leading-snug">{coachNote}</p>
        </div>
      )}

      {expanded && (
        <div className="px-3.5 pb-3.5">
          {!exercise.muscle && (
            <input
              value={exercise.name}
              onChange={(e) => renameExercise(e.target.value)}
              placeholder={t("log.exerciseName")}
              className="w-full mb-2 bg-white rounded-md px-2.5 py-1.5 text-xs text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
            />
          )}

          {exercise.sets.length > 0 && (
            <div className="mb-2.5 space-y-1">
              {exercise.sets.map((s, i) => (
                <div key={i} className="bg-white rounded-md px-2.5 py-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 w-10 shrink-0">{t("log.setN", { n: i + 1 })}</span>
                    <span className="font-mono text-sm tabular-nums flex-1 text-center break-words">
                      {s.weight}<span className="text-gray-500 text-xs">{t("unit.kg")}</span>×{s.reps}
                      {(s.drops || []).map((d, di) => (
                        <button
                          key={di}
                          onClick={() => removeDrop(i, di)}
                          className="text-maroon-600"
                          title={t("log.removeDrop")}
                        >
                          {" → "}{d.weight}<span className="text-gray-500 text-xs">{t("unit.kg")}</span>×{d.reps}
                        </button>
                      ))}
                    </span>
                    <button
                      onClick={() => toggleDropForm(i)}
                      className={`flex items-center shrink-0 rounded-md p-1 ${dropFormFor === i ? "bg-maroon-100 text-maroon-600" : "bg-gray-100 text-gray-500"}`}
                      title={t("log.addDropSet")}
                    >
                      <ArrowDown size={11} />
                      <Plus size={9} className="-ml-0.5" />
                    </button>
                    <button onClick={() => removeSet(i)} className="text-gray-500 hover:text-maroon-600 bg-gray-100 rounded-md p-1 shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {dropFormFor === i && (
                    <div className="flex items-center gap-1.5 mt-2 pl-10">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={dropWeight}
                        onChange={(e) => setDropWeight(e.target.value)}
                        placeholder={t("unit.kg")}
                        className="w-16 bg-gray-50 rounded-md px-2 py-2 text-base text-center font-mono border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
                      />
                      <span className="text-gray-400 text-sm">×</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        value={dropReps}
                        onChange={(e) => setDropReps(e.target.value)}
                        placeholder={t("log.repsShort")}
                        className="w-16 bg-gray-50 rounded-md px-2 py-2 text-base text-center font-mono border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
                        onKeyDown={(e) => e.key === "Enter" && addDrop(i)}
                      />
                      <button
                        onClick={() => addDrop(i)}
                        className="flex-1 bg-maroon-50 text-maroon-600 text-xs font-semibold rounded-md py-1.5"
                      >
                        {t("log.addDrop")}
                      </button>
                      <button onClick={() => setDropFormFor(null)} className="text-gray-400 shrink-0">
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mb-2.5">
            <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-400 mb-1">
              <NotebookPen size={11} /> {t("log.notes")}
            </label>
            <textarea
              value={exercise.notes || ""}
              onChange={(e) => updateNotes(e.target.value)}
              placeholder={t("log.notesPlaceholder")}
              rows={2}
              className="w-full resize-none bg-gray-50 rounded-md px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
            />
          </div>

          <div className="flex gap-1.5 mb-2">
            {/* type="text" + inputMode="decimal", NOT type="number": on iOS a number input
                shows a keypad whose decimal point is present but dead, so 7.5 kg can't be
                entered at all. text/decimal gives a live dot. Values are parsed by hand. */}
            <input
              ref={weightRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onFocus={(e) => handleFieldFocus("weight", e.target)}
              onBlur={handleFieldBlur}
              placeholder={t("unit.kg")}
              className="w-20 bg-white rounded-md px-2 py-2 text-base text-center font-mono border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
            />
            <span className="self-center text-gray-400 text-sm">×</span>
            <input
              ref={repsRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              onFocus={(e) => handleFieldFocus("reps", e.target)}
              onBlur={handleFieldBlur}
              placeholder={t("log.repsShort")}
              className="w-20 bg-white rounded-md px-2 py-2 text-base text-center font-mono border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
              onKeyDown={(e) => e.key === "Enter" && addSet()}
            />
            {/* min-w-0 + leading-tight because this button shares its row with two 80px
                inputs and gets whatever is left. Russian labels run longer than English, and
                without these a long label pushes its own text past the button edge rather
                than wrapping inside it. The icon needs shrink-0 or it gets squashed first. */}
            <button
              onClick={addSet}
              className="flex-1 min-w-0 flex items-center justify-center gap-1 px-1 bg-gray-100 rounded-md text-sm font-semibold leading-tight text-center text-gray-900 hover:bg-gray-200 transition-colors"
            >
              <Plus size={15} className="shrink-0" /> {t("log.addSet")}
            </button>
          </div>

          {/* The phone equivalent of tab-then-enter: weight → reps → record, without
              reaching for the screen between fields. */}
          {focusField && (
            <KeyboardAccessory
              label={`${exName(exercise)} · ${focusField === "weight" ? t("log.weightInKg") : t("log.repsShort")}`}
              actionLabel={focusField === "weight" ? t("log.next") : t("log.recordSet")}
              actionIcon={focusField === "weight" ? <SkipForward size={15} /> : <Check size={15} />}
              onAction={focusField === "weight" ? goToReps : recordFromKeyboard}
              onDone={() => {
                clearTimeout(blurTimer.current);
                setFocusField(null);
                if (weightRef.current) weightRef.current.blur();
                if (repsRef.current) repsRef.current.blur();
              }}
              disabled={focusField === "reps" && !canAddSet}
            />
          )}

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 mr-0.5">{t("log.restTimer")}</span>
            {restPresets.map((r) => (
              <button
                key={r}
                onClick={() => setRestLen(r)}
                className={`text-xs font-mono px-2 py-1 rounded ${
                  restLen === r ? "bg-maroon-600 text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {r}s
              </button>
            ))}
          </div>
          <button
            onClick={() => timer.start(restLen, exName(exercise))}
            className="w-full mt-1.5 flex items-center justify-center gap-1.5 bg-maroon-50 text-maroon-600 text-xs font-semibold rounded-md py-1.5"
          >
            <RotateCcw size={12} /> {t("log.startRestNow")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- History View ----------
function HistoryView({ sessions, onDelete }) {
  const t = useT();
  const lang = useLang();
  const exName = useExerciseName();
  const dayName = useDayName();
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [sessions]
  );
  const [openId, setOpenId] = useState(null);

  if (sorted.length === 0) {
    return (
      <div className="px-5 pt-16 text-center">
        <History size={28} className="mx-auto text-gray-400 mb-3" />
        <p className="text-sm text-gray-500">{t("hist.empty")}</p>
        <p className="text-xs text-gray-400 mt-1">{t("hist.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-2.5">
      {sorted.map((s) => {
        const open = openId === s.id;
        const totalSets = (s.exercises || []).reduce((sum, e) => sum + e.sets.length, 0);

        // An activity has no exercises or sets, so the lifting card would render it as an
        // empty workout. It gets its own one-line row instead — there's nothing to expand.
        if (s.kind === "activity") {
          const at = activityTypeById(s.activityType);
          return (
            <div key={s.id} className="rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{t(`act.${at.id}`)}</p>
                <p className="text-xs text-gray-500">
                  {fmtDate(s.date, lang)} · {t("hist.minutes", { n: s.minutes })} · {t("hist.effortValue", { n: activityEffort(s.activityType, s.minutes).toFixed(2) })}
                </p>
              </div>
              <button onClick={() => onDelete(s.id)} className="text-gray-400 p-1.5" aria-label={t("hist.deleteActivity")}>
                <Trash2 size={15} />
              </button>
            </div>
          );
        }

        return (
          <div key={s.id} className="rounded-xl bg-gray-50 border border-gray-200 overflow-hidden">
            <button
              onClick={() => setOpenId(open ? null : s.id)}
              className="w-full flex items-center justify-between px-3.5 py-3 text-left"
            >
              <div>
                {/* Sessions store the day name as it was at log time; dayName() re-resolves
                    built-ins through the dictionary so old records follow the switch too. */}
                <p className="text-sm font-semibold">{dayName({ id: s.dayId || slugId(s.day || ""), name: s.day })}</p>
                <p className="text-xs text-gray-500">
                  {fmtDate(s.date, lang)} · {t("hist.exerciseCount", { n: s.exercises.length, unit: plural(lang, s.exercises.length, "unit.exercise") })} · {t("hist.setCount", { n: totalSets, unit: plural(lang, totalSets, "unit.set") })}
                  {s.duration ? ` · ${t("hist.minutes", { n: s.duration })}` : ""}
                </p>
              </div>
              {open ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
            </button>
            {open && (
              <div className="px-3.5 pb-3.5 space-y-2.5">
                {s.exercises.map((e, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold text-gray-900">{exName(e)}</p>
                      {e.link && (
                        <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-maroon-600">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {e.sets.map((set, si) => (
                        <span key={si} className="font-mono text-xs tabular-nums bg-white rounded px-2 py-1 text-gray-700">
                          {set.weight}{t("unit.kg")}×{set.reps}
                          {(set.drops || []).map((d, di) => (
                            <span key={di} className="text-maroon-600">{" → "}{d.weight}{t("unit.kg")}×{d.reps}</span>
                          ))}
                        </span>
                      ))}
                    </div>
                    {e.notes && <p className="text-xs text-gray-500 italic mt-1">"{e.notes}"</p>}
                  </div>
                ))}
                <button
                  onClick={() => onDelete(s.id)}
                  className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 hover:text-maroon-600"
                >
                  <Trash2 size={12} /> {t("hist.deleteSession")}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Progress View ----------
// ---------- Profile View ----------
// Joining the group board. The code comes from /register in the group chat — a code rather
// than a link because it has to survive being read off one phone and typed into another.
function GroupJoin({ sessions, profile, program, lang }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [state, setState] = useState({ status: "idle" }); // idle | working | joined | error
  const [joined, setJoined] = useState(null);

  useEffect(() => {
    (async () => {
      const stored = await cloud.get(GROUP_KEY);
      if (stored) setJoined(stored);
    })();
  }, []);

  async function submit() {
    setState({ status: "working" });
    // The score rides along with the join, so the group sees the real number immediately
    // rather than a placeholder 800 until this user's next finished workout.
    const res = await relay("/api/join", {
      code: code.trim().toUpperCase(),
      ...syncPayload(sessions, profile, program, lang),
    });
    if (res && res.ok) {
      const title = res.groupTitle || t("group.yourGroup");
      await cloud.set(GROUP_KEY, title);
      setJoined(title);
      setState({ status: "joined" });
      setCode("");
    } else {
      // The Worker's error strings are already localised to this user's language — it knows
      // it from the initData we sent — so they're shown as-is rather than re-translated here.
      setState({ status: "error", message: (res && res.error) || t("group.joinFailed") });
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 mb-4">
      <p className="text-sm font-semibold mb-1">{t("group.title")}</p>
      {joined ? (
        <p className="text-xs text-gray-500 leading-snug">
          {t("group.postingTo")} <span className="font-semibold">{joined}</span>. {t("group.postingHint")}{" "}
          <span className="font-mono">/score</span> {t("group.postingHint2")}
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2.5 leading-snug">
            {t("group.runRegister1")} <span className="font-mono">/register</span> {t("group.runRegister2")}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC234"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase"
            />
            <button
              onClick={submit}
              disabled={code.trim().length < 4 || state.status === "working"}
              className={`rounded-lg px-4 text-sm font-semibold ${
                code.trim().length >= 4 ? "bg-maroon-600 text-white" : "bg-gray-200 text-gray-400"
              }`}
            >
              {state.status === "working" ? "…" : t("group.join")}
            </button>
          </div>
          {state.status === "error" && <p className="text-xs text-maroon-600 mt-1.5">{state.message}</p>}
        </>
      )}
    </div>
  );
}

function ProfileView({ profile, onSave, sessions, program, onEditProgram, lang, onLang }) {
  const t = useT();
  const [heightCm, setHeightCm] = useState(profile.heightCm ?? "");
  const [weightKg, setWeightKg] = useState(profile.weightKg ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    String(heightCm) !== String(profile.heightCm ?? "") ||
    String(weightKg) !== String(profile.weightKg ?? "") ||
    String(displayName) !== String(profile.displayName ?? "");

  async function handleSave() {
    const h = toNumber(heightCm);
    const w = toNumber(weightKg);
    await onSave({
      heightCm: heightCm === "" || Number.isNaN(h) ? "" : h,
      weightKg: weightKg === "" || Number.isNaN(w) ? "" : w,
      displayName: displayName.trim(),
    });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  }

  return (
    <div className="px-4 pt-4">
      {/* Language sits at the top of Profile, above the bodyweight copy — someone who opened
          the app in the wrong language needs to find this without reading anything first. */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{t("prof.language")}</span>
        <LangToggle lang={lang} onLang={onLang} />
      </div>

      <WithInfo text={t("prof.weightExplain")} className="mb-4">
        <p className="text-xs text-gray-500">{t("prof.weightExplainTitle")}</p>
      </WithInfo>

      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("prof.height")}</span>
          <input
            type="number"
            inputMode="numeric"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="186"
            className="w-full bg-white rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{t("prof.weight")}</span>
          {/* text/decimal, not number — see the set-entry inputs: iOS renders a dead
              decimal point on number inputs, so 76.5 kg would be unenterable. */}
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="76"
            className="w-full bg-white rounded-md px-3 py-2.5 text-base text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">
            <Users size={11} /> {t("prof.displayName")}
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("prof.displayNamePlaceholder")}
            maxLength={24}
            className="w-full bg-white rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-maroon-600"
          />
        </label>
        <button
          onClick={handleSave}
          disabled={!dirty && !justSaved}
          className={`w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors ${
            dirty ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-400"
          }`}
        >
          {justSaved ? `${t("log.saved")} ✓` : (
            <>
              <Save size={16} /> {t("prof.save")}
            </>
          )}
        </button>
      </div>

      <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Dumbbell size={14} className="text-maroon-600" />
          <p className="text-sm uppercase tracking-wider text-gray-500 font-semibold">{t("prof.program")}</p>
        </div>
        <p className="text-sm text-gray-500 mb-3 leading-snug">
          {t("prof.programSummary", {
            days: program.days.length,
            dayUnit: plural(lang, program.days.length, "unit.dayCount"),
            exercises: programSlots(program).length,
            exerciseUnit: plural(lang, programSlots(program).length, "unit.exercise"),
          })}
        </p>
        {/* Two entry points to the same screen. Generation used to live only inside the
            editor, which meant finding it required already knowing it existed — the first
            person to look for it didn't. It opens the editor with the panel already open. */}
        <button
          onClick={() => onEditProgram({ openAi: true })}
          className="w-full flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold bg-maroon-600 text-white"
        >
          <Sparkles size={15} /> {t("ai.open")}
        </button>
        <button
          onClick={() => onEditProgram({ openAi: false })}
          className="w-full mt-1.5 flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold bg-white border border-gray-200 text-gray-700"
        >
          <Dumbbell size={15} /> {t("prof.editProgram")}
        </button>
      </div>

      <GroupJoin sessions={sessions} profile={profile} program={program} lang={lang} />

      <ExportPanel sessions={sessions} profile={profile} program={program} />

      <WithInfo text={t("prof.privacy")} className="mt-5 rounded-xl bg-maroon-50 border border-maroon-100 px-4 py-3">
        <p className="text-sm text-maroon-800 leading-snug font-semibold">{t("prof.privacyTitle")}</p>
      </WithInfo>
    </div>
  );
}

// ---------- Program editor ----------
// The persistent half of the pair. Swap (SwapPanel) changes one workout; this changes the
// program itself, for every session from here on. They're deliberately separate screens:
// "the leg press is busy today" and "I don't do leg press any more" are different statements
// and the rating treats them differently.
//
// Edits are held locally and written on Save, so a half-finished reshuffle never reaches
// storage — and so one write covers a whole editing session rather than one per keystroke.
/**
 * Turn a generated program into the app's own program shape.
 *
 * Ids are derived from names via slugId, exactly like a template — which is why slugId had to
 * learn about non-Latin alphabets first: a Russian-language generation produces Russian day
 * names, and under the old implementation every one of them collapsed to the id "x" and
 * overwrote the previous day.
 *
 * Day ids are de-duplicated because nothing stops the model naming two days the same thing.
 */
function programFromGenerated(generated) {
  const days = [];
  const exercisesByDay = {};
  const seen = new Set();

  (generated.days || []).forEach((d, i) => {
    let id = slugId(d.name);
    while (seen.has(id)) id = `${slugId(d.name)}-${i}`;
    seen.add(id);

    days.push({ id, name: d.name, subtitle: d.subtitle || "" });
    const usedEx = new Set();
    exercisesByDay[id] = (d.exercises || []).map((e, j) => {
      let exId = slugId(e.name);
      while (usedEx.has(exId)) exId = `${slugId(e.name)}-${j}`;
      usedEx.add(exId);
      return {
        id: exId,
        name: e.name,
        muscle: "",
        target: e.target || "",
        rest: Math.min(300, Math.max(30, Number(e.rest) || DEFAULT_REST)),
        link: "",
        pattern: e.pattern,
        meta: metaFromPattern(e.pattern),
      };
    });
  });

  return withMetaIndex({ version: 1, days, exercisesByDay });
}

/**
 * Describe a program in plain text, get one back.
 *
 * Nothing is saved automatically. The generated program is loaded into the editor's draft as
 * an unsaved change, so the user reviews it in the same UI they'd edit it in and still has to
 * press Save — the model's output is a proposal, never a commit. That's the whole reason this
 * lives inside the editor rather than being its own screen.
 */
function AiProgramPanel({ profile, lang, autoOpen, onAccept }) {
  const t = useT();
  const [open, setOpen] = useState(!!autoOpen);
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState({ status: "idle" }); // idle | working | preview | error
  const [result, setResult] = useState(null);

  const canSend = prompt.trim().length >= 10 && state.status !== "working";

  async function generate() {
    setState({ status: "working" });
    const res = await relay("/api/program", {
      prompt: prompt.trim(),
      profile: { weightKg: profile.weightKg, heightCm: profile.heightCm },
    });
    if (res && res.ok && res.program) {
      setResult(res.program);
      setState({ status: "preview" });
    } else {
      // The Worker returns a translation key, not prose, so the message renders in whatever
      // language the app is set to rather than whatever the Worker guessed.
      const key = (res && res.reason) || "ai.errNetwork";
      setState({ status: "error", message: t(key) });
    }
  }

  function accept() {
    onAccept(programFromGenerated(result));
    setResult(null);
    setPrompt("");
    setState({ status: "idle" });
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full mb-4 flex items-center justify-center gap-2 rounded-xl border border-dashed border-maroon-300 bg-maroon-50 text-maroon-700 text-sm font-semibold py-3"
      >
        <Sparkles size={15} /> {t("ai.open")}
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-maroon-200 bg-maroon-50 px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={14} className="text-maroon-600" />
        <p className="text-sm font-semibold text-maroon-800">{t("ai.title")}</p>
      </div>

      {state.status === "preview" && result ? (
        <>
          <p className="text-sm font-semibold mb-0.5">{result.name}</p>
          <p className="text-xs text-gray-600 mb-2 leading-snug">{result.summary}</p>

          {result.exclusions && result.exclusions.length > 0 && (
            <p className="text-xs text-gray-500 mb-2 leading-snug">
              {t("ai.excluded")}: {result.exclusions.join(", ")}
            </p>
          )}

          <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
            {result.days.map((d, i) => (
              <div key={i} className="rounded-lg bg-white border border-gray-200 px-2.5 py-2">
                <p className="text-xs font-semibold">{d.name}</p>
                {d.subtitle && <p className="text-xs text-gray-500 leading-snug">{d.subtitle}</p>}
                <ul className="mt-1 space-y-0.5">
                  {d.exercises.map((e, j) => (
                    <li key={j} className="text-xs text-gray-700 leading-snug">
                      {e.name} <span className="text-gray-400">· {e.target} · {t(`pat.${e.pattern}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 mb-2 leading-snug">{t("ai.reviewNote")}</p>
          <div className="flex gap-1.5">
            <button onClick={accept} className="flex-1 bg-maroon-600 text-white text-sm font-semibold rounded-md py-2">
              {t("ai.use")}
            </button>
            <button
              onClick={() => setState({ status: "idle" })}
              className="flex-1 bg-white border border-gray-200 text-gray-600 text-sm font-semibold rounded-md py-2"
            >
              {t("ai.tryAgain")}
            </button>
          </div>
        </>
      ) : (
        <>
          <WithInfo text={t("ai.explain")} className="mb-2">
            <p className="text-xs text-gray-600">{t("ai.explainTitle")}</p>
          </WithInfo>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("ai.placeholder")}
            rows={4}
            className="w-full resize-none bg-white rounded-md px-2.5 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          {state.status === "error" && (
            <p className="text-xs text-maroon-700 mt-1.5 leading-snug">{state.message}</p>
          )}
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={generate}
              disabled={!canSend}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold rounded-md py-2 ${
                canSend ? "bg-maroon-600 text-white" : "bg-gray-200 text-gray-400"
              }`}
            >
              {state.status === "working" ? (
                <><Loader2 size={14} className="animate-spin" /> {t("ai.working")}</>
              ) : (
                <>{t("ai.generate")}</>
              )}
            </button>
            <button
              onClick={() => { setOpen(false); setState({ status: "idle" }); }}
              className="px-3 bg-white border border-gray-200 text-gray-600 text-sm font-semibold rounded-md py-2"
            >
              {t("common.cancel")}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 leading-snug">{t("ai.slowNote")}</p>
        </>
      )}
    </div>
  );
}

function ProgramEditor({ program, profile, autoOpenAi, onCommit, onReset, onBack }) {
  const t = useT();
  const lang = useLang();
  const dayName = useDayName();
  const [draft, setDraft] = useState(program);
  const [openDayId, setOpenDayId] = useState(program.days[0] ? program.days[0].id : null);
  const [editingId, setEditingId] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState("");

  const dirty = useMemo(
    () => JSON.stringify({ d: draft.days, e: draft.exercisesByDay }) !== JSON.stringify({ d: program.days, e: program.exercisesByDay }),
    [draft, program]
  );

  function setDayExercises(dayId, next) {
    setDraft((p) => ({ ...p, exercisesByDay: { ...p.exercisesByDay, [dayId]: next } }));
  }

  function updateExercise(dayId, id, patch) {
    setDayExercises(dayId, (draft.exercisesByDay[dayId] || []).map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function moveExercise(dayId, idx, delta) {
    const list = [...(draft.exercisesByDay[dayId] || [])];
    const to = idx + delta;
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(idx, 1);
    list.splice(to, 0, item);
    setDayExercises(dayId, list);
  }

  function removeExercise(dayId, id) {
    setDayExercises(dayId, (draft.exercisesByDay[dayId] || []).filter((e) => e.id !== id));
  }

  function addExercise(dayId) {
    // A fresh random id, not one derived from the name: renaming this later must not orphan
    // the history it has already accumulated.
    const id = "x" + uid().slice(-6);
    const pattern = "push-horizontal";
    const next = [
      ...(draft.exercisesByDay[dayId] || []),
      { id, name: t("log.newExercise"), muscle: "", target: "3 x 8-12", rest: DEFAULT_REST, link: "", pattern, meta: metaFromPattern(pattern) },
    ];
    setDayExercises(dayId, next);
    setEditingId(id);
  }

  function addDay() {
    const id = "d" + uid().slice(-6);
    setDraft((p) => ({
      ...p,
      days: [...p.days, { id, name: t("prog.dayN", { n: p.days.length + 1 }), subtitle: "" }],
      exercisesByDay: { ...p.exercisesByDay, [id]: [] },
    }));
    setOpenDayId(id);
  }

  function updateDay(dayId, patch) {
    setDraft((p) => ({ ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) }));
  }

  function removeDay(dayId) {
    setDraft((p) => {
      const days = p.days.filter((d) => d.id !== dayId);
      const exercisesByDay = { ...p.exercisesByDay };
      delete exercisesByDay[dayId];
      return { ...p, days, exercisesByDay };
    });
  }

  async function save() {
    const res = await onCommit(draft);
    if (res && res.ok) {
      setStatus(t("log.saved"));
      setTimeout(() => setStatus(""), 2000);
    }
  }

  return (
    <div className="px-4 pt-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 mb-3">
        <ChevronDown size={15} className="rotate-90" /> {t("prog.back")}
      </button>

      <h2 className="text-2xl font-bold tracking-tight mb-1">{t("prog.title")}</h2>
      <WithInfo text={t("prog.explain")} className="mb-4">
        <p className="text-sm text-gray-500 leading-snug">{t("prog.explainTitle")}</p>
      </WithInfo>

      <AiProgramPanel
        profile={profile}
        lang={lang}
        autoOpen={autoOpenAi}
        onAccept={(generated) => {
          setDraft(generated);
          setOpenDayId(generated.days[0] ? generated.days[0].id : null);
        }}
      />

      <div className="space-y-2.5">
        {draft.days.map((d) => {
          const list = draft.exercisesByDay[d.id] || [];
          const open = openDayId === d.id;
          return (
            <div key={d.id} className="rounded-xl bg-gray-50 border border-gray-200 overflow-hidden">
              <button
                onClick={() => setOpenDayId(open ? null : d.id)}
                className="w-full flex items-center gap-2 px-3.5 py-3 text-left"
              >
                {open ? <ChevronUp size={15} className="text-gray-500 shrink-0" /> : <ChevronDown size={15} className="text-gray-500 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{dayName(d)}</span>
                  <span className="block text-xs text-gray-500">{t("hist.exerciseCount", { n: list.length, unit: plural(lang, list.length, "unit.exercise") })}</span>
                </span>
              </button>

              {open && (
                <div className="px-3.5 pb-3.5">
                  <div className="flex gap-1.5 mb-2.5">
                    {/* The editable field shows the STORED name, not the translated one —
                        editing a built-in day means renaming it for yourself, and seeding the
                        box with our translation would silently convert it into a custom name
                        the moment anyone touched it. */}
                    <input
                      value={d.name}
                      onChange={(e) => updateDay(d.id, { name: e.target.value })}
                      placeholder={t("prog.dayName")}
                      className="flex-1 min-w-0 bg-white rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
                    />
                    <button
                      onClick={() => removeDay(d.id)}
                      disabled={draft.days.length <= 1}
                      className={`shrink-0 rounded-md px-2.5 ${draft.days.length <= 1 ? "bg-gray-100 text-gray-300" : "bg-gray-100 text-gray-600"}`}
                      title={draft.days.length <= 1 ? t("prog.needOneDay") : t("prog.deleteDay")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input
                    value={d.subtitle || ""}
                    onChange={(e) => updateDay(d.id, { subtitle: e.target.value })}
                    placeholder={t("prog.dayDescription")}
                    className="w-full mb-3 bg-white rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
                  />

                  <div className="space-y-1.5">
                    {list.map((e, idx) => (
                      <ProgramExerciseRow
                        key={e.id}
                        exercise={e}
                        editing={editingId === e.id}
                        canMoveUp={idx > 0}
                        canMoveDown={idx < list.length - 1}
                        onToggleEdit={() => setEditingId(editingId === e.id ? null : e.id)}
                        onChange={(patch) => updateExercise(d.id, e.id, patch)}
                        onMove={(delta) => moveExercise(d.id, idx, delta)}
                        onRemove={() => removeExercise(d.id, e.id)}
                      />
                    ))}
                    {list.length === 0 && (
                      <p className="text-xs text-gray-400 py-2">{t("prog.noExercises")}</p>
                    )}
                  </div>

                  <button
                    onClick={() => addExercise(d.id)}
                    className="w-full mt-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 text-gray-500 text-sm py-2"
                  >
                    <Plus size={15} /> {t("prog.addExercise")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={addDay}
        className="w-full mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 text-gray-500 text-sm py-2.5"
      >
        <Plus size={15} /> {t("prog.addDay")}
      </button>

      <button
        onClick={save}
        disabled={!dirty}
        className={`w-full mt-5 flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold ${
          dirty ? "bg-maroon-600 text-white" : "bg-gray-100 text-gray-400"
        }`}
      >
        {status || (dirty ? <><Save size={16} /> {t("prog.save")}</> : t("prog.noChanges"))}
      </button>

      <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
        {/* NB: this paragraph describes the OLD program-relative rating. Under fixed pattern
            slots your program no longer moves your score at all — flagged rather than
            silently reworded, because correcting it is a copy decision, not a translation. */}
        <WithInfo text={t("prog.ratingNote")} className="mb-2">
          <p className="text-sm text-gray-500 leading-snug">{t("prog.ratingNoteTitle")}</p>
        </WithInfo>
        {confirmReset ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => { setConfirmReset(false); onReset(); }}
              className="flex-1 bg-maroon-600 text-white text-sm font-semibold rounded-md py-2"
            >
              {t("prog.confirmRestore")}
            </button>
            <button onClick={() => setConfirmReset(false)} className="flex-1 bg-white border border-gray-200 text-gray-600 text-sm font-semibold rounded-md py-2">
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)} className="text-sm font-semibold text-gray-600">
            {t("prog.restore")}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgramExerciseRow({ exercise, editing, canMoveUp, canMoveDown, onToggleEdit, onChange, onMove, onRemove }) {
  const t = useT();
  const exName = useExerciseName();
  const pattern = patternById(exercise.pattern) || null;

  return (
    <div className="rounded-md bg-white border border-gray-200">
      <div className="flex items-center gap-1 px-2.5 py-2">
        <button onClick={onToggleEdit} className="flex-1 min-w-0 text-left">
          <span className="block text-sm font-semibold truncate">{exName(exercise)}</span>
          <span className="block text-xs text-gray-500 truncate">
            {exercise.target || t("prog.noTarget")}{pattern ? ` · ${t(`pat.${pattern.id}`)}` : ""}
          </span>
        </button>
        <button
          onClick={() => onMove(-1)}
          disabled={!canMoveUp}
          className={`shrink-0 rounded p-1.5 ${canMoveUp ? "text-gray-600 bg-gray-100" : "text-gray-300"}`}
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={!canMoveDown}
          className={`shrink-0 rounded p-1.5 ${canMoveDown ? "text-gray-600 bg-gray-100" : "text-gray-300"}`}
        >
          <ChevronDown size={14} />
        </button>
        <button onClick={onRemove} className="shrink-0 rounded p-1.5 text-gray-500 bg-gray-100">
          <X size={14} />
        </button>
      </div>

      {editing && (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-gray-100 pt-2.5">
          {/* Stored name again, not the translated one — same reason as the day-name field. */}
          <input
            value={exercise.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t("log.exerciseName")}
            className="w-full bg-gray-50 rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          <input
            value={exercise.muscle || ""}
            onChange={(e) => onChange({ muscle: e.target.value })}
            placeholder={t("prog.muscles")}
            className="w-full bg-gray-50 rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          <div className="flex gap-1.5">
            <input
              value={exercise.target || ""}
              onChange={(e) => onChange({ target: e.target.value })}
              placeholder="3 x 8-12"
              className="flex-1 min-w-0 bg-gray-50 rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
            />
            <input
              type="text"
              inputMode="numeric"
              value={exercise.rest || ""}
              onChange={(e) => onChange({ rest: Number(toNumber(e.target.value)) || DEFAULT_REST })}
              placeholder={t("prog.restSeconds")}
              className="w-24 bg-gray-50 rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
            />
          </div>
          <input
            value={exercise.link || ""}
            onChange={(e) => onChange({ link: e.target.value })}
            placeholder={t("prog.formLink")}
            className="w-full bg-gray-50 rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          <WithInfo text={t("prog.patternNote")} className="pt-1">
            <p className="text-xs text-gray-500">{t("log.patternLabel")}</p>
          </WithInfo>
          <PatternSelect
            value={exercise.pattern}
            onChange={(next) => onChange({ pattern: next, meta: metaFromPattern(next) })}
            className="w-full bg-gray-50 rounded-md px-2.5 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          {exercise.builtIn && (
            <p className="text-xs text-gray-400 leading-snug">{t("prog.builtInNote")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Export ----------
// Two different jobs, deliberately two different formats:
//   markdown — written to be READ by whoever reviews the training (currently an LLM chat).
//              It carries the context a reviewer needs to not give bad advice: bodyweight,
//              day balance, anything the notes flagged as painful, and the caveats from §6.
//   json     — the actual backup. CloudStorage is the only copy of this data (§5) and
//              Telegram can lose it, so this must round-trip losslessly. Don't "tidy" it
//              into the markdown; a backup that a human edited is not a backup.
// Delivery is clipboard-first: inside Telegram's webview there is no usable file download,
// and the whole point is pasting into a chat anyway.

const EXPORT_RANGES = [
  { id: "4w", days: 28 },
  { id: "12w", days: 84 },
  { id: "all", days: null },
];

function sessionsInRange(sessions, days) {
  if (!days) return sessions;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  return sessions.filter((s) => s.date >= cutoffISO);
}

function describeSet(s, kg) {
  return `${s.weight}${kg}×${s.reps}` + (s.drops || []).map((d) => ` → ${d.weight}${kg}×${d.reps}`).join("");
}

function buildExportMarkdown(sessions, profile, rangeLabel, program, lang = DEFAULT_LANG) {
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1));
  const weight = Number(profile.weightKg) || null;
  const elo = computeEloTrajectory(sorted, weight, program);
  const tr = (key, vars) => t(lang, key, vars);
  const kg = tr("unit.kg");
  const exName = (e) => exerciseDisplayName(lang, e && e.id, e && e.name);
  const dyName = (d) => dayDisplayName(lang, d && d.id, d && d.name);
  const slotNames = {};
  if (program) programSlots(program).forEach((s) => { slotNames[s.id] = exName(s); });
  const L = [];

  L.push(`# ${tr("exp.title")}`);
  L.push("");
  L.push(`- ${tr("exp.exported")}: ${todayISO()}`);
  L.push(`- ${tr("exp.range")}: ${rangeLabel} — ${sorted.length} ${plural(lang, sorted.length, "unit.session")}`);
  if (profile.displayName) L.push(`- ${tr("exp.athlete")}: ${profile.displayName}`);
  const bio = [profile.heightCm ? `${profile.heightCm} ${tr("unit.cm")}` : null, weight ? `${weight} ${kg}` : null].filter(Boolean).join(" · ");
  if (bio) L.push(`- ${tr("exp.body")}: ${bio}`);
  if (weight && elo.trajectory.length) {
    L.push(`- ${tr("exp.rating")}: ${elo.rating} (${tr(`tier.${tierForRating(elo.rating).tier.name}`)}) — ${tr("exp.seeCaveat")}`);
  }

  if (sorted.length === 0) {
    L.push("");
    L.push(`_${tr("exp.noSessions")}_`);
    return L.join("\n");
  }

  // Frequency and day balance. Skipping leg days is the specific historical failure mode
  // (§1), so make it impossible for a reviewer to miss.
  const spanDays = Math.max(1, diffDaysBetween(sorted[0].date, sorted[sorted.length - 1].date) + 1);
  const perWeek = (sorted.length / (spanDays / 7)).toFixed(1);
  L.push(`- ${tr("exp.frequency", { perWeek, days: spanDays })}`);
  L.push("");
  L.push(`## ${tr("exp.dayBalance")}`);
  L.push("");
  const progDays = (program && program.days) || DEFAULT_PROGRAM.days;
  progDays.forEach((d) => {
    const n = sorted.filter((s) => (s.dayId || slugId(s.day)) === d.id).length;
    L.push(`- ${dyName(d)}: ${n}`);
  });
  const dayIds = new Set(progDays.map((d) => d.id));
  const other = sorted.filter((s) => !dayIds.has(s.dayId || slugId(s.day))).length;
  if (other) L.push(`- ${tr("exp.daysNotInProgram")}: ${other}`);

  // The program itself, so a reviewer can tell "not in the program" from "skipped".
  L.push("");
  L.push(`## ${tr("exp.currentProgram")}`);
  progDays.forEach((d) => {
    L.push("");
    L.push(`**${dyName(d)}**${d.subtitle ? ` — ${d.subtitle}` : ""}`);
    exercisesForDay(program || DEFAULT_PROGRAM, d.id).forEach((e) => {
      L.push(`- ${exName(e)}${e.target ? ` — ${e.target}` : ""}`);
    });
  });

  // Anything the notes flagged as painful, pulled from the logs rather than hard-coded, so
  // this stays correct if someone else uses the app.
  const flagged = [];
  sorted.forEach((s) => {
    s.exercises.forEach((e) => {
      if (noteSignalsProblem(e.notes)) flagged.push(`- ${s.date} · ${exName(e)}: "${String(e.notes).trim()}"`);
    });
  });
  if (flagged.length) {
    L.push("");
    L.push(`## ${tr("exp.flagged")}`);
    L.push("");
    L.push(tr("exp.flaggedNote"));
    L.push("");
    flagged.forEach((f) => L.push(f));
  }

  L.push("");
  L.push(`## ${tr("exp.sessions")}`);
  sorted.forEach((s) => {
    L.push("");
    const dayLabel = s.kind === "activity"
      ? tr(`act.${s.activityType}`)
      : dyName({ id: s.dayId || slugId(s.day || ""), name: s.day });
    L.push(`### ${s.date} · ${dayLabel}${s.duration ? ` · ${tr("hist.minutes", { n: s.duration })}` : ""}`);
    L.push("");
    s.exercises.forEach((e) => {
      const meta = metaForEntry(e, program);
      const sets = e.sets.map((x) => describeSet(x, kg)).join(", ");
      const unit = meta.type === "duration" ? ` (${tr("exp.repsAreSeconds")})` : "";
      // Flag substitutions inline. A reviewer comparing week to week would otherwise read a
      // one-off swap as the athlete abandoning a lift.
      const slot = e.substituteFor ? (slotNames[e.substituteFor] || e.substituteForName) : null;
      const via = slot ? ` _(${tr("exp.swappedInFor", { slot })})_` : "";
      L.push(`- **${exName(e)}**: ${sets || tr("exp.noSets")}${unit}${via}`);
      if (e.notes) L.push(`  - ${tr("exp.note")}: "${String(e.notes).trim()}"`);
    });
  });

  L.push("");
  L.push(`## ${tr("exp.howToRead")}`);
  L.push("");
  tr("exp.legend").split("\n").forEach((line) => L.push(line));

  return L.join("\n");
}

function buildExportJSON(sessions, profile) {
  return JSON.stringify(
    {
      app: "chetamba",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      sessions: [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1)),
    },
    null,
    2
  );
}

function ExportPanel({ sessions, profile, program }) {
  const t = useT();
  const lang = useLang();
  const [rangeId, setRangeId] = useState("4w");
  const [copied, setCopied] = useState("");
  const [fallback, setFallback] = useState("");
  const fallbackRef = useRef(null);

  const range = EXPORT_RANGES.find((r) => r.id === rangeId) || EXPORT_RANGES[0];
  const scoped = useMemo(() => sessionsInRange(sessions, range.days), [sessions, range.days]);

  async function copy(text, which) {
    setFallback("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(""), 2000);
      return;
    } catch (e) {
      // Some webviews block the clipboard API outright. Show the text so it can be
      // selected by hand rather than failing silently.
      setFallback(text);
      setTimeout(() => {
        if (fallbackRef.current) {
          fallbackRef.current.focus();
          try { fallbackRef.current.select(); } catch (err) { /* not selectable */ }
        }
      }, 50);
    }
  }

  return (
    <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <FileText size={14} className="text-maroon-600" />
        <p className="text-sm uppercase tracking-wider text-gray-500 font-semibold">{t("exp.panelTitle")}</p>
      </div>
      <WithInfo text={`${t("exp.panelExplain")} ${t("exp.footnote")}`} className="mb-3">
        <p className="text-sm text-gray-500 leading-snug">{t("exp.panelTitleSub")}</p>
      </WithInfo>

      <div className="flex gap-1.5 mb-3">
        {EXPORT_RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => { setRangeId(r.id); setFallback(""); }}
            className={`flex-1 min-w-0 px-1 text-sm font-semibold leading-tight rounded-md py-2 ${
              rangeId === r.id ? "bg-maroon-600 text-white" : "bg-white text-gray-500 border border-gray-200"
            }`}
          >
            {t(`exp.range.${r.id}`)}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-400 mb-2">
        {t("exp.inRange", { n: scoped.length, unit: plural(lang, scoped.length, "unit.session") })}
      </p>

      <button
        onClick={() => copy(buildExportMarkdown(scoped, profile, t(`exp.range.${range.id}`), program, lang), "md")}
        disabled={scoped.length === 0}
        className={`w-full flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold mb-1.5 ${
          scoped.length === 0 ? "bg-gray-200 text-gray-400" : "bg-maroon-600 text-white"
        }`}
      >
        {copied === "md" ? <><Check size={15} /> {t("exp.copiedMd")}</> : <><Copy size={15} /> {t("exp.copyMd")}</>}
      </button>
      <button
        onClick={() => copy(buildExportJSON(scoped, profile), "json")}
        disabled={scoped.length === 0}
        className="w-full flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold bg-white text-gray-700 border border-gray-200"
      >
        {copied === "json" ? <><Check size={15} /> {t("exp.copiedJson")}</> : <><Save size={15} /> {t("exp.copyJson")}</>}
      </button>

      {fallback && (
        <div className="mt-2.5">
          <p className="text-sm text-maroon-700 mb-1.5">{t("exp.clipboardFailed")}</p>
          <textarea
            ref={fallbackRef}
            readOnly
            value={fallback}
            rows={6}
            className="w-full resize-none bg-white rounded-md px-2.5 py-2 text-xs font-mono text-gray-900 border border-gray-200"
          />
        </div>
      )}


    </div>
  );
}

// ---------- Rating Card (Elo-style score, shown at top of Progress tab) ----------
function RatingCard({ eloResult, profile }) {
  const t = useT();
  const lang = useLang();
  const hasWeight = !!Number(profile.weightKg);

  if (!hasWeight) {
    return (
      <div className="mb-5 rounded-xl bg-gray-900 text-white px-4 py-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Award size={14} className="text-maroon-400" />
          <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">{t("prog.rating")}</p>
        </div>
        <p className="text-sm text-gray-300">{t("prog.needWeight")}</p>
      </div>
    );
  }

  const { trajectory, rating, coverage } = eloResult;
  const { tier, next } = tierForRating(rating);
  const prevRating = trajectory.length >= 2 ? trajectory[trajectory.length - 2].rating : RATING_BASELINE;
  const change = trajectory.length ? rating - prevRating : 0;

  const rangeStart = tier.min;
  const rangeEnd = next ? next.min : tier.min + 400;
  const pctToNext = next ? Math.min(1, Math.max(0, (rating - rangeStart) / (rangeEnd - rangeStart))) : 1;

  const staleCount = coverage.filter((c) => c.status === "stale" || c.status === "untouched").length;

  return (
    <div className="mb-5 rounded-xl bg-gray-900 text-white px-4 py-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Award size={14} className="text-maroon-400" />
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">{t("prog.rating")}</p>
      </div>

      <div className="flex items-end gap-3 mb-1">
        <span className="font-mono text-4xl font-bold tabular-nums leading-none">{trajectory.length ? rating : RATING_BASELINE}</span>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${tier.bg} ${tier.color}`}>{t(`tier.${tier.name}`)}</span>
        {trajectory.length > 1 && change !== 0 && (
          <span className={`text-xs font-semibold ml-auto mb-1 ${change > 0 ? "text-emerald-400" : "text-maroon-400"}`}>
            {change > 0 ? "+" : ""}{change}
          </span>
        )}
      </div>

      {trajectory.length === 0 && (
        <p className="text-xs text-gray-400 mt-1">{t("prog.logFirst")}</p>
      )}

      {/* The layoff penalty is gone. Time off already shows up on the weekly effort axis,
          publicly, and the per-pattern decay handles staleness — deducting a third time was
          punishing one absence three ways. */}

      {next && trajectory.length > 0 && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-maroon-500 rounded-full" style={{ width: `${pctToNext * 100}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {next.min - rating > 0
              ? t("prog.toNextTier", { n: next.min - rating, tier: t(`tier.${next.name}`) })
              : t("prog.readyForTier", { tier: t(`tier.${next.name}`) })}
          </p>
        </div>
      )}

      {trajectory.length > 2 && (
        <div className="h-24 mt-3 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trajectory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <Line type="monotone" dataKey="rating" stroke="#C99CBC" strokeWidth={2} dot={false} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(v) => [v, t("prog.rating")]}
                labelFormatter={(l, p) => (p && p[0] ? fmtDate(p[0].payload.date, lang) : "")}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {staleCount > 0 && trajectory.length > 0 && (
        <p className="text-xs text-gray-500 mt-3">
          {t("prog.staleCount", { n: staleCount, unit: plural(lang, staleCount, "unit.exercise") })}
        </p>
      )}

      {/* Honesty note — see workout_tracker.md §6. There is no published strength-standard
          database for dumbbell lifts, so the benchmarks are derived estimates. Keep this visible. */}
      <WithInfo text={t("prog.benchmarkCaveat")} className="mt-3" tone="light">
        <p className="text-xs text-gray-500">{t("prog.benchmarkCaveatTitle")}</p>
      </WithInfo>
    </div>
  );
}

// ---------- Leaderboard (shared storage — visible to anyone with this artifact's link) ----------
// ---------- Leaderboard (share a score card into a Telegram group; paste your friend's back) ----------
// Telegram's CloudStorage is per-user and isolated, so two people's apps cannot read each other
// directly. Instead each person shares a compact score card into a shared chat, and pastes their
// friend's card in here. Rivals are stored locally, so the standings survive restarts.
const RIVALS_KEY = "rivals_v1";
const CARD_TAG = "GAINS";

function buildScoreCard(name, rating, tierName) {
  const safeName = (name || "Anon").replace(/[|]/g, "");
  return `${CARD_TAG}|${safeName}|${rating}|${tierName}|${todayISO()}`;
}

function parseScoreCard(text) {
  if (!text) return null;
  const match = String(text).match(/GAINS\|([^|]+)\|(\d+)\|([^|]+)\|(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  return { name: match[1].trim(), rating: Number(match[2]), tier: match[3].trim(), updatedAt: match[4] };
}

function Leaderboard({ displayName, rating, tierName }) {
  const t = useT();
  const [rivals, setRivals] = useState([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await cloud.get(RIVALS_KEY);
      try { setRivals(raw ? JSON.parse(raw) : []); } catch (e) { setRivals([]); }
    })();
  }, []);

  async function persistRivals(next) {
    setRivals(next);
    await cloud.set(RIVALS_KEY, JSON.stringify(next));
  }

  const card = buildScoreCard(displayName, rating, tierName);

  function shareCard() {
    const text = `${displayName || "I"} — ${rating} (${tierName})\n${card}`;
    if (TG && TG.openTelegramLink) {
      TG.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encodeURIComponent(text)}`);
      return;
    }
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* clipboard unavailable */ }
  }

  function addRival() {
    const parsed = parseScoreCard(pasteVal);
    if (!parsed) {
      setPasteErr(t("board.badCard"));
      return;
    }
    if (displayName && parsed.name.toLowerCase() === displayName.toLowerCase()) {
      setPasteErr(t("board.ownCard"));
      return;
    }
    const next = [...rivals.filter((r) => r.name.toLowerCase() !== parsed.name.toLowerCase()), parsed];
    persistRivals(next);
    setPasteVal("");
    setPasteErr("");
    setPasteOpen(false);
  }

  const board = [
    ...(displayName ? [{ name: displayName, rating, tier: tierName, me: true }] : []),
    ...rivals.map((r) => ({ ...r, me: false })),
  ].sort((a, b) => b.rating - a.rating);

  return (
    <div className="mb-5 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Users size={13} className="text-maroon-600" />
        <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{t("board.title")}</p>
      </div>

      {!displayName && (
        <p className="text-xs text-gray-500 mb-2.5">{t("board.needName")}</p>
      )}

      {board.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {board.map((e, i) => (
            <div
              key={e.name + i}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 border ${
                e.me ? "bg-maroon-50 border-maroon-200" : "bg-white border-gray-100"
              }`}
            >
              <span className="text-xs font-semibold text-gray-700 truncate">
                {i + 1}. {e.name}{e.me ? ` ${t("board.you")}` : ""}
              </span>
              <span className="font-mono text-xs tabular-nums text-gray-900 shrink-0 ml-2">{e.rating}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={shareCard}
          className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1 bg-maroon-600 text-white text-xs font-semibold leading-tight text-center rounded-md py-2"
        >
          <Share2 size={12} className="shrink-0" /> {copied ? t("board.copied") : t("board.share")}
        </button>
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1 bg-white border border-gray-200 text-gray-700 text-xs font-semibold leading-tight text-center rounded-md py-2"
        >
          <Plus size={12} className="shrink-0" /> {t("board.addFriend")}
        </button>
      </div>

      {pasteOpen && (
        <div className="mt-2.5">
          <textarea
            value={pasteVal}
            onChange={(e) => { setPasteVal(e.target.value); setPasteErr(""); }}
            rows={2}
            placeholder={t("board.pastePlaceholder")}
            className="w-full resize-none bg-white rounded-md px-2.5 py-2 text-xs text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-maroon-600"
          />
          <button onClick={addRival} className="w-full mt-1.5 bg-gray-900 text-white text-xs font-semibold rounded-md py-2">
            {t("board.addToBoard")}
          </button>
          {pasteErr && <p className="text-xs text-maroon-600 mt-1.5">{pasteErr}</p>}
        </div>
      )}

      <WithInfo text={t("board.snapshotNote")} className="mt-2.5">
        <p className="text-xs text-gray-400">{t("board.snapshotTitle")}</p>
      </WithInfo>
    </div>
  );
}

function ProgressView({ sessions, profile, program }) {
  const t = useT();
  const lang = useLang();
  const exName = useExerciseName();

  // Keyed by id, not by name. It used to group on the display name, which was already a
  // latent bug — two exercises can share a name, and renaming one split its chart in two —
  // and became a certain one here, since a built-in's displayed name now changes with the
  // language. Grouping on the stable id is what the rest of the app already does.
  const exerciseOptions = useMemo(() => {
    const byId = new Map();
    sessions.forEach((s) =>
      (s.exercises || []).forEach((e) => {
        const id = e.id || slugId(e.name);
        if (!byId.has(id)) byId.set(id, { id, name: e.name });
      })
    );
    return [...byId.values()].sort((a, b) => exName(a).localeCompare(exName(b), lang));
  }, [sessions, exName, lang]);

  const [selected, setSelected] = useState(exerciseOptions[0] ? exerciseOptions[0].id : "");

  useEffect(() => {
    const stillThere = exerciseOptions.some((o) => o.id === selected);
    if (!stillThere && exerciseOptions.length) setSelected(exerciseOptions[0].id);
  }, [exerciseOptions, selected]);

  const eloResult = useMemo(
    () => computeEloTrajectory(sessions, Number(profile.weightKg) || null, program),
    [sessions, profile.weightKg, program]
  );

  const data = useMemo(() => {
    const rows = [];
    const matches = (e) => (e.id || slugId(e.name)) === selected;
    sessions
      .filter((s) => (s.exercises || []).some(matches))
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .forEach((s) => {
        const ex = s.exercises.find(matches);
        if (!ex || ex.sets.length === 0) return;
        const topWeight = Math.max(...ex.sets.map((st) => st.weight));
        const totalReps = ex.sets.reduce(
          (sum, st) => sum + st.reps + (st.drops ? st.drops.reduce((ds, d) => ds + d.reps, 0) : 0),
          0
        );
        rows.push({ date: s.date, label: fmtDate(s.date, lang), topWeight, totalReps, sets: ex.sets.length });
      });
    return rows;
  }, [sessions, selected, lang]);

  if (exerciseOptions.length === 0) {
    return (
      <div className="px-4 pt-4">
        <RatingCard eloResult={eloResult} profile={profile} />
        {eloResult.trajectory.length > 0 && (
          <Leaderboard displayName={profile.displayName} rating={eloResult.rating} tierName={tierForRating(eloResult.rating).tier.name} />
        )}
        <div className="px-1 pt-12 text-center">
          <TrendingUp size={28} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm text-gray-500">{t("prog.noData")}</p>
          <p className="text-xs text-gray-400 mt-1">{t("prog.noDataHint")}</p>
        </div>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const first = data[0];
  const delta = latest && first ? latest.topWeight - first.topWeight : 0;

  return (
    <div className="px-4 pt-4">
      <RatingCard eloResult={eloResult} profile={profile} />
      {eloResult.trajectory.length > 0 && (
        <Leaderboard displayName={profile.displayName} rating={eloResult.rating} tierName={tierForRating(eloResult.rating).tier.name} />
      )}

      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{ colorScheme: "light" }}
        className="w-full bg-gray-100 rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 mb-4 focus:outline-none focus:ring-2 focus:ring-maroon-600"
      >
        {exerciseOptions.map((o) => (
          <option key={o.id} value={o.id}>{exName(o)}</option>
        ))}
      </select>

      {data.length > 0 && (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-mono text-3xl font-bold tabular-nums">{latest.topWeight}</span>
            <span className="text-sm text-gray-500">{t("prog.topSet")}</span>
            {delta !== 0 && (
              <span className={`text-xs font-semibold ml-auto ${delta > 0 ? "text-emerald-600" : "text-maroon-600"}`}>
                {delta > 0 ? "+" : ""}{t("prog.sinceFirst", { delta })}
              </span>
            )}
          </div>

          <div className="h-48 mt-4 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#6B7280", fontSize: 10 }} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} />
                <YAxis tick={{ fill: "#6B7280", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{ background: "#F7F7F8", border: "1px solid #E2E4E8", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#6B7280" }}
                />
                <Line type="monotone" dataKey="topWeight" stroke="#410038" strokeWidth={2.5} dot={{ fill: "#410038", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-5 space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t("prog.sessionLog")}</p>
            {[...data].reverse().map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded-md px-3 py-2 border border-gray-200">
                <span className="text-gray-500">{d.label}</span>
                <span className="font-mono tabular-nums">
                  {d.topWeight}{t("unit.kg")} · {d.sets} {plural(lang, d.sets, "unit.set")} · {d.totalReps} {plural(lang, d.totalReps, "unit.rep")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
