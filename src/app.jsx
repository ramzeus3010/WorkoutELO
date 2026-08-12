import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Save, ChevronDown, ChevronUp, Trash2, TrendingUp, Dumbbell, History, LineChart as LineChartIcon, Loader2, Play, Pause, RotateCcw, SkipForward, ExternalLink, NotebookPen, Sparkles, ArrowDown, User, Award, Users, Share2, Check } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ---------- Program reference (from the 4-day upper/lower split) ----------
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

const DAYS = Object.keys(PROGRAM);
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
  { name: "Bronze", min: 0, color: "text-orange-700", bg: "bg-orange-100" },
  { name: "Silver", min: 1000, color: "text-gray-500", bg: "bg-gray-200" },
  { name: "Gold", min: 1200, color: "text-yellow-600", bg: "bg-yellow-100" },
  { name: "Platinum", min: 1500, color: "text-cyan-600", bg: "bg-cyan-100" },
  { name: "Diamond", min: 1800, color: "text-blue-600", bg: "bg-blue-100" },
  { name: "Top 5%", min: 2000, color: "text-purple-600", bg: "bg-purple-100" },
];

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

async function loadAllSessions() {
  const raw = await cloud.get(INDEX_KEY);
  let ids = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
  const out = [];
  for (const id of ids) {
    const s = await cloud.get(SESSION_PREFIX + id);
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (e) { /* skip corrupt entry */ }
  }
  return out;
}

// Sessions are written individually so one oversized session can never corrupt the whole log.
async function saveSession(session) {
  const payload = JSON.stringify(session);
  if (payload.length > 4000) {
    return { ok: false, reason: "This session is too large to store (too many sets/notes). Try shorter notes." };
  }
  const ok = await cloud.set(SESSION_PREFIX + session.id, payload);
  if (!ok) return { ok: false, reason: "Storage write failed." };
  const raw = await cloud.get(INDEX_KEY);
  let ids = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
  if (!ids.includes(session.id)) ids.push(session.id);
  const idxOk = await cloud.set(INDEX_KEY, JSON.stringify(ids));
  if (!idxOk) return { ok: false, reason: "Couldn't update the session index." };
  return { ok: true };
}

async function deleteSessionStored(id) {
  await cloud.remove(SESSION_PREFIX + id);
  const raw = await cloud.get(INDEX_KEY);
  let ids = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
  await cloud.set(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
}

// ---------- Helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtClock = (secs) => {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function emptyExerciseLog(name, muscle, rest, link) {
  return { name, muscle: muscle || "", rest: rest || DEFAULT_REST, link: link || "", notes: "", sets: [] };
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

// ---------- Main App ----------
export default function App() {
  const [tab, setTab] = useState("log");
  const [sessions, setSessions] = useState(null);
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const timer = useRestTimer();

  useEffect(() => {
    if (TG) {
      try {
        TG.ready();
        TG.expand();
      } catch (e) { /* older Telegram clients */ }
    }
    (async () => {
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
    })();
  }, []);

  async function saveProfile(next) {
    setSaving(true);
    setError("");
    const ok = await cloud.set(PROFILE_KEY, JSON.stringify(next));
    if (ok) setProfile(next);
    else setError("Couldn't save profile. Try again.");
    setSaving(false);
  }

  async function addSession(session) {
    setSaving(true);
    setError("");
    const res = await saveSession(session);
    if (res.ok) setSessions((prev) => [...(prev || []), session]);
    else setError(res.reason);
    setSaving(false);
  }

  async function deleteSession(id) {
    setSaving(true);
    await deleteSessionStored(id);
    setSessions((prev) => (prev || []).filter((s) => s.id !== id));
    setSaving(false);
  }

  const loading = sessions === null || profile === null;
  const timerActive = !!timer.state;

  return (
    <div
      className="min-h-screen bg-white text-gray-900 font-sans"
      style={{ colorScheme: "light" }}
    >
      <div className={`max-w-md mx-auto ${timerActive ? "pb-44" : "pb-24"}`}>
        <Header saving={saving} />
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-gray-500 py-24">
            <Loader2 className="animate-spin" size={18} />
            <span className="text-sm">Loading log…</span>
          </div>
        ) : (
          <>
            {error && (
              <div className="mx-4 mt-3 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-700">
                {error}
              </div>
            )}
            {tab === "log" && <LogView onSave={addSession} timer={timer} sessions={sessions} />}
            {tab === "history" && <HistoryView sessions={sessions} onDelete={deleteSession} />}
            {tab === "progress" && <ProgressView sessions={sessions} profile={profile} />}
            {tab === "profile" && <ProfileView profile={profile} onSave={saveProfile} />}
          </>
        )}
      </div>
      {timerActive && <RestTimerBar timer={timer} liftAbove={true} />}
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ---------- Header ----------
function Header({ saving }) {
  return (
    <div className="px-5 pt-6 pb-4 border-b border-gray-200">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-widest uppercase text-orange-600 font-semibold mb-1">Training Log</p>
          <h1 className="text-2xl font-bold tracking-tight">Iron &amp; Ledger</h1>
        </div>
        {saving && <Loader2 className="animate-spin text-gray-500" size={16} />}
      </div>
    </div>
  );
}

// ---------- Bottom Nav ----------
function BottomNav({ tab, setTab }) {
  const items = [
    { id: "log", label: "Log", icon: Dumbbell },
    { id: "history", label: "History", icon: History },
    { id: "progress", label: "Progress", icon: LineChartIcon },
    { id: "profile", label: "Profile", icon: User },
  ];
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white backdrop-blur border-t border-gray-200 shadow-sm">
      <div className="max-w-md mx-auto grid grid-cols-4">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              tab === id ? "text-orange-600" : "text-gray-500"
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

// ---------- Rest Timer Bar (floating, above bottom nav) ----------
function RestTimerBar({ timer }) {
  const { state, remaining, pause, resume, addTime, dismiss } = timer;
  const pct = state ? Math.min(1, Math.max(0, 1 - remaining / state.total)) : 0;
  const done = state && remaining <= 0;

  return (
    <div className="fixed bottom-16 inset-x-0 z-20">
      <div className="max-w-md mx-auto px-3 pb-2">
        <div className={`rounded-xl border overflow-hidden shadow-lg ${done ? "bg-emerald-50 border-emerald-300" : "bg-gray-50 border-gray-200"}`}>
          <div className="h-1 bg-gray-200">
            <div
              className={`h-full transition-all ${done ? "bg-emerald-600" : "bg-orange-600"}`}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className={`font-mono text-2xl font-bold tabular-nums ${done ? "text-emerald-600" : "text-gray-900"}`}>
              {done ? "0:00" : fmtClock(remaining)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 truncate">{done ? "Rest done — go" : `Resting · ${state.label}`}</p>
            </div>
            {!done && (
              <>
                <button onClick={() => addTime(15)} className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-md px-2 py-1.5">
                  +15s
                </button>
                <button onClick={state.paused ? resume : pause} className="text-gray-900 bg-gray-100 rounded-md p-1.5">
                  {state.paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
              </>
            )}
            <button onClick={dismiss} className="text-gray-900 bg-gray-100 rounded-md p-1.5">
              {done ? <X size={15} /> : <SkipForward size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Log View ----------
// ---------- Quick Timer (manual start/stop, always on the main screen) ----------
function QuickTimer({ timer }) {
  const { state, remaining, start, pause, resume, addTime, dismiss } = timer;
  const [customLen, setCustomLen] = useState(60);
  const presets = [30, 45, 60, 90, 120];
  const active = !!state;
  const done = active && remaining <= 0;

  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-3 mb-4">
      {!active ? (
        <>
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Quick Rest Timer</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setCustomLen(p)}
                className={`text-xs font-mono px-2.5 py-1.5 rounded-md ${
                  customLen === p ? "bg-orange-600 text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {p}s
              </button>
            ))}
          </div>
          <button
            onClick={() => start(customLen, "Quick timer")}
            className="w-full mt-2 flex items-center justify-center gap-1.5 bg-gray-900 text-white text-xs font-semibold rounded-md py-2.5"
          >
            <Play size={13} /> Start
          </button>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <span className={`font-mono text-3xl font-bold tabular-nums ${done ? "text-emerald-600" : "text-gray-900"}`}>
            {done ? "0:00" : fmtClock(remaining)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 truncate">{done ? "Rest done — go" : state.label}</p>
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

function metaFor(name) {
  return EXERCISE_META[name] || DEFAULT_EXERCISE_META;
}

// Pull the "top" logged set for an exercise entry (main weight/reps, ignoring drop-set weights,
// consistent with how the Progress tab already treats top sets).
function topSetOf(exerciseEntry) {
  if (!exerciseEntry || !exerciseEntry.sets || exerciseEntry.sets.length === 0) return null;
  return exerciseEntry.sets.reduce((best, s) => (s.weight > best.weight ? s : best), exerciseEntry.sets[0]);
}

// Performance index for a single logged instance of an exercise: 1.0 = benchmark "average person"
// your current bodyweight, 2.0 = benchmark "top 5%".
function performanceIndex(exerciseEntry, bodyweightKg) {
  const meta = metaFor(exerciseEntry.name);
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
function computeEloTrajectory(sessions, bodyweightKg) {
  if (!bodyweightKg || !sessions || sessions.length === 0) {
    return { trajectory: [], rating: RATING_BASELINE, coverage: [] };
  }
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const allNames = new Set(Object.keys(EXERCISE_META));
  sorted.forEach((s) => s.exercises.forEach((e) => allNames.add(e.name)));

  const exState = {}; // name -> { lastP, lastDate }
  let rating = RATING_BASELINE;
  let prevDate = null;
  const trajectory = [];

  sorted.forEach((session, i) => {
    // Layoff penalty: a long gap since your last logged session (any type) pulls the rating itself
    // back toward baseline before this session's performance even counts. Short gaps (rest days,
    // a missed exercise here and there) barely move it — this is specifically for real time off.
    let layoffPenalty = 0;
    if (prevDate) {
      const gapDays = diffDaysBetween(session.date, prevDate);
      const excess = gapDays - LAYOFF_GRACE_DAYS;
      if (excess > 0) {
        const decay = Math.pow(0.5, excess / LAYOFF_HALF_LIFE_DAYS);
        const decayedRating = RATING_BASELINE + (rating - RATING_BASELINE) * decay;
        layoffPenalty = Math.round(rating - decayedRating);
        rating = decayedRating;
      }
    }

    session.exercises.forEach((e) => {
      const p = performanceIndex(e, bodyweightKg);
      if (p !== null) {
        exState[e.name] = { lastP: p, lastDate: session.date };
      }
    });

    let sumW = 0;
    let sumWP = 0;
    allNames.forEach((name) => {
      const meta = metaFor(name);
      const st = exState[name];
      let contribution;
      if (!st) {
        contribution = RATING_NEUTRAL;
      } else {
        const daysSince = diffDaysBetween(session.date, st.lastDate);
        const decay = Math.pow(0.5, daysSince / RATING_HALF_LIFE_DAYS);
        contribution = RATING_NEUTRAL + (st.lastP - RATING_NEUTRAL) * decay;
      }
      sumW += meta.multiplier;
      sumWP += meta.multiplier * contribution;
    });
    const pRolling = sumWP / sumW;
    const expected = expectedPFromRating(rating);
    const K = i < 10 ? 32 : 16;
    const actualClamped = Math.max(0.1, Math.min(2.5, pRolling));
    rating = rating + K * (actualClamped - expected);
    rating = Math.max(400, Math.min(2600, rating));
    trajectory.push({ date: session.date, rating: Math.round(rating), pRolling, layoffPenalty, gapDays: prevDate ? diffDaysBetween(session.date, prevDate) : 0 });
    prevDate = session.date;
  });

  // Coverage snapshot as of the latest session — which exercises are "fresh" vs decaying vs untouched.
  const latestDate = sorted[sorted.length - 1].date;
  const coverage = Array.from(allNames)
    .filter((n) => EXERCISE_META[n]) // only show program exercises, not one-off custom ones
    .map((name) => {
      const st = exState[name];
      if (!st) return { name, status: "untouched", daysSince: null };
      const daysSince = diffDaysBetween(latestDate, st.lastDate);
      const status = daysSince <= 3 ? "fresh" : daysSince <= RATING_HALF_LIFE_DAYS ? "fading" : "stale";
      return { name, status, daysSince };
    });

  return { trajectory, rating: Math.round(rating), coverage };
}

function daysAgo(iso) {
  const d = new Date(iso + "T00:00:00");
  const diffMs = Date.now() - d.getTime();
  const days = Math.round(diffMs / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ---------- Local rule-based coach (no API, works offline) ----------
// Compares today's planned exercises against your most recent session of the same day,
// plus overall recency for fatigue context. Deliberately conservative: anything that reads
// like pain or discomfort in your notes produces a back-off suggestion, never a push.
const PAIN_WORDS = ["pain", "hurt", "sharp", "tweak", "twinge", "sore", "strain", "pinch", "ache", "uncomfortable", "wrong", "clicked", "pop"];

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

function buildLocalCoach({ day, programExercises, lastSameDay, lastOverall }) {
  const notes = [];

  programExercises.forEach((pe) => {
    const prev = lastSameDay && lastSameDay.exercises.find((e) => e.name === pe.name);
    if (!prev || !prev.sets || prev.sets.length === 0) {
      notes.push({ name: pe.name, note: "No history yet — pick a weight you can control for all reps." });
      return;
    }
    if (noteSignalsProblem(prev.notes)) {
      notes.push({
        name: pe.name,
        note: "Your last note flagged discomfort here — drop the weight, focus on form, and stop if it recurs.",
      });
      return;
    }
    const meta = metaFor(pe.name);
    const ceiling = repTargetCeiling(pe.target);
    const lastSet = prev.sets[prev.sets.length - 1];
    const topSet = topSetOf(prev);
    const hadDrops = prev.sets.some((s) => (s.drops || []).length > 0);

    if (meta.type === "duration" || meta.type === "reps") {
      notes.push({
        name: pe.name,
        note: `Last time: ${topSet.reps}${meta.type === "duration" ? "s" : " reps"}. Aim to beat it by a little.`,
      });
      return;
    }
    if (ceiling && lastSet.reps >= ceiling && !hadDrops) {
      const bump = topSet.weight >= 20 ? 2.5 : topSet.weight >= 10 ? 2 : 1;
      notes.push({
        name: pe.name,
        note: `Hit the top of the range at ${topSet.weight}kg — try ${topSet.weight + bump}kg today.`,
      });
      return;
    }
    if (hadDrops) {
      notes.push({
        name: pe.name,
        note: `You went to failure with drops at ${topSet.weight}kg — repeat that weight and aim for cleaner reps.`,
      });
      return;
    }
    notes.push({ name: pe.name, note: `Stay at ${topSet.weight}kg and try to add a rep or two.` });
  });

  let overall;
  if (!lastSameDay) {
    overall = `First ${day} on record — log honestly today so the next one has something to build on.`;
  } else {
    const gap = diffDaysBetween(todayISO(), lastSameDay.date);
    const overallGap = lastOverall ? diffDaysBetween(todayISO(), lastOverall.date) : null;
    if (overallGap !== null && overallGap <= 1) {
      overall = `You trained ${overallGap === 0 ? "today" : "yesterday"} already — if anything feels heavy, back off rather than grinding.`;
    } else if (gap > 21) {
      overall = `It's been ${gap} days since your last ${day} — start lighter than you think and rebuild.`;
    } else {
      overall = `Last ${day} was ${gap} day${gap === 1 ? "" : "s"} ago. Beat it by a small margin, not a big one.`;
    }
  }

  return { overall, exercises: notes };
}

// ---------- Coach Panel (pre-workout analysis) ----------
function CoachPanel({ analysis, onStart }) {
  if (analysis === null) {
    return (
      <button
        onClick={onStart}
        className="w-full mb-5 flex items-center justify-center gap-2 rounded-xl border border-dashed border-orange-300 bg-orange-50 text-orange-700 text-sm font-semibold py-3"
      >
        <Sparkles size={15} /> Start Workout — check last session
      </button>
    );
  }

  return (
    <div className="mb-5 rounded-xl bg-gray-900 text-white px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles size={13} className="text-orange-400" />
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Coach</p>
      </div>
      <p className="text-sm leading-snug">{analysis.overall}</p>
      <p className="text-xs text-gray-400 mt-2">Per-exercise notes below, on each exercise card.</p>
    </div>
  );
}

const DRAFT_KEY = "draft_v1";

function LogView({ onSave, timer, sessions }) {
  const [day, setDay] = useState(DAYS[0]);
  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState("");
  const [exercises, setExercises] = useState(() =>
    PROGRAM[DAYS[0]].exercises.map((e) => emptyExerciseLog(e.name, e.muscle, e.rest, e.link))
  );
  const [justSaved, setJustSaved] = useState(false);
  const [analysis, setAnalysis] = useState(null); // null | { overall, exercises }
  const [restored, setRestored] = useState(false);
  const [draftState, setDraftState] = useState("idle"); // idle | saving | saved
  const draftTimer = useRef(null);

  // Restore an in-progress workout on open, so closing the app mid-session never loses sets.
  useEffect(() => {
    (async () => {
      const raw = await cloud.get(DRAFT_KEY);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          const hasWork = d.exercises && d.exercises.some((e) => e.sets && e.sets.length > 0);
          if (hasWork) {
            setDay(d.day || DAYS[0]);
            setDate(d.date || todayISO());
            setDuration(d.duration || "");
            setExercises(d.exercises);
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
      const payload = JSON.stringify({ day, date, duration, exercises });
      const ok = payload.length <= 4000 ? await cloud.set(DRAFT_KEY, payload) : false;
      setDraftState(ok ? "saved" : "idle");
      if (ok) setTimeout(() => setDraftState("idle"), 1500);
    }, 700);
    return () => draftTimer.current && clearTimeout(draftTimer.current);
  }, [day, date, duration, exercises, restored]);

  function changeDay(newDay) {
    setDay(newDay);
    setExercises(PROGRAM[newDay].exercises.map((e) => emptyExerciseLog(e.name, e.muscle, e.rest, e.link)));
    setAnalysis(null);
  }

  function handleStartWorkout() {
    const sameDaySessions = (sessions || [])
      .filter((s) => s.day === day)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const allSorted = [...(sessions || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    setAnalysis(
      buildLocalCoach({
        day,
        programExercises: PROGRAM[day].exercises,
        lastSameDay: sameDaySessions[0] || null,
        lastOverall: allSorted[0] || null,
      })
    );
  }

  function updateExercise(idx, updated) {
    setExercises((prev) => prev.map((e, i) => (i === idx ? updated : e)));
  }

  function addCustomExercise() {
    setExercises((prev) => [...prev, emptyExerciseLog("New exercise", "", DEFAULT_REST)]);
  }

  function removeExercise(idx) {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalSets = exercises.reduce((sum, e) => sum + e.sets.length, 0);
  const canSave = totalSets > 0;

  async function handleSave() {
    const session = {
      id: uid(),
      date,
      day,
      duration: duration ? Number(duration) : null,
      exercises: exercises.filter((e) => e.sets.length > 0),
    };
    await onSave(session);
    await cloud.remove(DRAFT_KEY);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    setExercises(PROGRAM[day].exercises.map((e) => emptyExerciseLog(e.name, e.muscle, e.rest, e.link)));
    setDuration("");
    setAnalysis(null);
  }

  return (
    <div className="px-4 pt-4">
      <QuickTimer timer={timer} />

      {/* Day selector */}
      <div className="grid grid-cols-4 gap-1.5 mb-4">
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => changeDay(d)}
            className={`rounded-lg py-2 text-xs font-semibold leading-tight transition-colors ${
              day === d ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-4">{PROGRAM[day].subtitle}</p>

      {/* Coach: pre-workout analysis */}
      <CoachPanel analysis={analysis} onStart={handleStartWorkout} />

      {/* Date + duration */}
      <div className="flex gap-3 mb-5">
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ colorScheme: "light" }}
            className="w-full bg-gray-100 rounded-md px-3 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-600"
          />
        </label>
        <label className="w-28">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">Minutes</span>
          <input
            type="number"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="47"
            className="w-full bg-gray-100 rounded-md px-3 py-2 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-600"
          />
        </label>
      </div>

      {/* Exercises */}
      <div className="space-y-3">
        {exercises.map((ex, idx) => {
          const coachNote =
            analysis && typeof analysis === "object"
              ? (analysis.exercises || []).find((a) => a.name === ex.name)?.note
              : null;
          return (
            <ExerciseCard
              key={idx}
              exercise={ex}
              target={PROGRAM[day].exercises[idx]?.target}
              timer={timer}
              coachNote={coachNote}
              onChange={(updated) => updateExercise(idx, updated)}
              onRemove={() => removeExercise(idx)}
            />
          );
        })}
      </div>

      <button
        onClick={addCustomExercise}
        className="w-full mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 text-gray-500 text-sm py-2.5 hover:border-gray-300 hover:text-gray-900 transition-colors"
      >
        <Plus size={15} /> Add exercise
      </button>

      <button
        onClick={handleSave}
        disabled={!canSave}
        className={`w-full mt-5 flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors ${
          canSave ? "bg-orange-600 text-white active:bg-orange-700" : "bg-gray-100 text-gray-400"
        }`}
      >
        {justSaved ? "Saved ✓" : (
          <>
            <Save size={16} /> Save Workout
          </>
        )}
      </button>
    </div>
  );
}

function ExerciseCard({ exercise, target, timer, coachNote, onChange, onRemove }) {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [restLen, setRestLen] = useState(exercise.rest || DEFAULT_REST);
  const [dropFormFor, setDropFormFor] = useState(null);
  const [dropWeight, setDropWeight] = useState("");
  const [dropReps, setDropReps] = useState("");

  function addSet() {
    if (weight === "" || reps === "") return;
    const set = { weight: Number(weight), reps: Number(reps) };
    onChange({ ...exercise, sets: [...exercise.sets, set] });
    setReps("");
    timer.start(restLen, exercise.name);
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
    const newSets = exercise.sets.map((s, si) => {
      if (si !== i) return s;
      const drops = s.drops ? [...s.drops, { weight: Number(dropWeight), reps: Number(dropReps) }] : [{ weight: Number(dropWeight), reps: Number(dropReps) }];
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

  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          {expanded ? <ChevronUp size={15} className="text-gray-500 shrink-0" /> : <ChevronDown size={15} className="text-gray-500 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{exercise.name}</p>
            {exercise.muscle && <p className="text-xs text-gray-500 truncate">{exercise.muscle}{target ? ` · target ${target}` : ""}</p>}
          </div>
        </button>
        {exercise.link && (
          <a
            href={exercise.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 rounded-md px-2 py-1.5 shrink-0 mr-1"
          >
            <ExternalLink size={11} /> Form
          </a>
        )}
        <button onClick={onRemove} className="text-gray-500 hover:text-orange-600 bg-gray-100 rounded-md p-1.5 shrink-0">
          <X size={14} />
        </button>
      </div>

      {coachNote && (
        <div className="mx-3.5 mb-3 flex items-start gap-1.5 rounded-md bg-orange-50 border border-orange-100 px-2.5 py-2">
          <Sparkles size={12} className="text-orange-500 shrink-0 mt-0.5" />
          <p className="text-xs text-orange-800 leading-snug">{coachNote}</p>
        </div>
      )}

      {expanded && (
        <div className="px-3.5 pb-3.5">
          {!exercise.muscle && (
            <input
              value={exercise.name}
              onChange={(e) => renameExercise(e.target.value)}
              placeholder="Exercise name"
              className="w-full mb-2 bg-white rounded-md px-2.5 py-1.5 text-xs text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
            />
          )}

          {exercise.sets.length > 0 && (
            <div className="mb-2.5 space-y-1">
              {exercise.sets.map((s, i) => (
                <div key={i} className="bg-white rounded-md px-2.5 py-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 w-10 shrink-0">Set {i + 1}</span>
                    <span className="font-mono text-sm tabular-nums flex-1 text-center break-words">
                      {s.weight}<span className="text-gray-500 text-xs">kg</span>×{s.reps}
                      {(s.drops || []).map((d, di) => (
                        <button
                          key={di}
                          onClick={() => removeDrop(i, di)}
                          className="text-orange-600"
                          title="Tap to remove this drop"
                        >
                          {" → "}{d.weight}<span className="text-gray-500 text-xs">kg</span>×{d.reps}
                        </button>
                      ))}
                    </span>
                    <button
                      onClick={() => toggleDropForm(i)}
                      className={`flex items-center shrink-0 rounded-md p-1 ${dropFormFor === i ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500"}`}
                      title="Add a drop set"
                    >
                      <ArrowDown size={11} />
                      <Plus size={9} className="-ml-0.5" />
                    </button>
                    <button onClick={() => removeSet(i)} className="text-gray-500 hover:text-orange-600 bg-gray-100 rounded-md p-1 shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {dropFormFor === i && (
                    <div className="flex items-center gap-1.5 mt-2 pl-10">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={dropWeight}
                        onChange={(e) => setDropWeight(e.target.value)}
                        placeholder="kg"
                        className="w-14 bg-gray-50 rounded-md px-2 py-1.5 text-sm text-center font-mono border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
                      />
                      <span className="text-gray-400 text-xs">×</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={dropReps}
                        onChange={(e) => setDropReps(e.target.value)}
                        placeholder="reps"
                        className="w-14 bg-gray-50 rounded-md px-2 py-1.5 text-sm text-center font-mono border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
                        onKeyDown={(e) => e.key === "Enter" && addDrop(i)}
                      />
                      <button
                        onClick={() => addDrop(i)}
                        className="flex-1 bg-orange-50 text-orange-600 text-xs font-semibold rounded-md py-1.5"
                      >
                        Add drop
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
              <NotebookPen size={11} /> Notes
            </label>
            <textarea
              value={exercise.notes || ""}
              onChange={(e) => updateNotes(e.target.value)}
              placeholder="e.g. seat height 4, felt it in shoulders not back…"
              rows={2}
              className="w-full resize-none bg-gray-50 rounded-md px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
            />
          </div>

          <div className="flex gap-1.5 mb-2">
            <input
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="kg"
              className="w-16 bg-white rounded-md px-2 py-1.5 text-sm text-center font-mono border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
            />
            <span className="self-center text-gray-400 text-xs">×</span>
            <input
              type="number"
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              placeholder="reps"
              className="w-16 bg-white rounded-md px-2 py-1.5 text-sm text-center font-mono border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
              onKeyDown={(e) => e.key === "Enter" && addSet()}
            />
            <button
              onClick={addSet}
              className="flex-1 flex items-center justify-center gap-1 bg-gray-100 rounded-md text-xs font-semibold text-gray-900 hover:bg-gray-200 transition-colors"
            >
              <Plus size={13} /> Add set + rest
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 mr-0.5">Rest timer:</span>
            {restPresets.map((r) => (
              <button
                key={r}
                onClick={() => setRestLen(r)}
                className={`text-xs font-mono px-2 py-1 rounded ${
                  restLen === r ? "bg-orange-600 text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {r}s
              </button>
            ))}
          </div>
          <button
            onClick={() => timer.start(restLen, exercise.name)}
            className="w-full mt-1.5 flex items-center justify-center gap-1.5 bg-orange-50 text-orange-600 text-xs font-semibold rounded-md py-1.5"
          >
            <RotateCcw size={12} /> Start rest timer now
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- History View ----------
function HistoryView({ sessions, onDelete }) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [sessions]
  );
  const [openId, setOpenId] = useState(null);

  if (sorted.length === 0) {
    return (
      <div className="px-5 pt-16 text-center">
        <History size={28} className="mx-auto text-gray-400 mb-3" />
        <p className="text-sm text-gray-500">No sessions logged yet.</p>
        <p className="text-xs text-gray-400 mt-1">Log a workout and it'll show up here.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-2.5">
      {sorted.map((s) => {
        const open = openId === s.id;
        const totalSets = s.exercises.reduce((sum, e) => sum + e.sets.length, 0);
        return (
          <div key={s.id} className="rounded-xl bg-gray-50 border border-gray-200 overflow-hidden">
            <button
              onClick={() => setOpenId(open ? null : s.id)}
              className="w-full flex items-center justify-between px-3.5 py-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold">{s.day}</p>
                <p className="text-xs text-gray-500">
                  {fmtDate(s.date)} · {s.exercises.length} exercises · {totalSets} sets
                  {s.duration ? ` · ${s.duration} min` : ""}
                </p>
              </div>
              {open ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
            </button>
            {open && (
              <div className="px-3.5 pb-3.5 space-y-2.5">
                {s.exercises.map((e, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold text-gray-900">{e.name}</p>
                      {e.link && (
                        <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-orange-600">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {e.sets.map((set, si) => (
                        <span key={si} className="font-mono text-xs tabular-nums bg-white rounded px-2 py-1 text-gray-700">
                          {set.weight}kg×{set.reps}
                          {(set.drops || []).map((d, di) => (
                            <span key={di} className="text-orange-600">{" → "}{d.weight}kg×{d.reps}</span>
                          ))}
                        </span>
                      ))}
                    </div>
                    {e.notes && <p className="text-xs text-gray-500 italic mt-1">"{e.notes}"</p>}
                  </div>
                ))}
                <button
                  onClick={() => onDelete(s.id)}
                  className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600"
                >
                  <Trash2 size={12} /> Delete session
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
function ProfileView({ profile, onSave }) {
  const [heightCm, setHeightCm] = useState(profile.heightCm ?? "");
  const [weightKg, setWeightKg] = useState(profile.weightKg ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    String(heightCm) !== String(profile.heightCm ?? "") ||
    String(weightKg) !== String(profile.weightKg ?? "") ||
    String(displayName) !== String(profile.displayName ?? "");

  async function handleSave() {
    await onSave({
      heightCm: heightCm === "" ? "" : Number(heightCm),
      weightKg: weightKg === "" ? "" : Number(weightKg),
      displayName: displayName.trim(),
    });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  }

  return (
    <div className="px-4 pt-4">
      <p className="text-xs text-gray-500 mb-4">
        Your rating on the Progress tab is calculated relative to your current bodyweight. Update this anytime you cut, bulk, or just want your numbers re-contextualized — your whole rating history recalculates against the new figure, not just future sessions.
      </p>

      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">Height (cm)</span>
          <input
            type="number"
            inputMode="numeric"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="186"
            className="w-full bg-white rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-600"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">Weight (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="76"
            className="w-full bg-white rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-600"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">
            <Users size={11} /> Display name (for the leaderboard)
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ramazan"
            maxLength={24}
            className="w-full bg-white rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-600"
          />
        </label>
        <button
          onClick={handleSave}
          disabled={!dirty && !justSaved}
          className={`w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors ${
            dirty ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-400"
          }`}
        >
          {justSaved ? "Saved ✓" : (
            <>
              <Save size={16} /> Save Profile
            </>
          )}
        </button>
      </div>

      <div className="mt-5 rounded-xl bg-orange-50 border border-orange-100 px-4 py-3">
        <p className="text-xs text-orange-800 leading-snug">
          Height and weight stay private, used only for your own rating math and coach suggestions. Your display name and current rating (not your actual workout logs, sets, or notes) are shared publicly on the leaderboard with anyone who has this artifact's link — leave the name blank to opt out.
        </p>
      </div>
    </div>
  );
}

// ---------- Rating Card (Elo-style score, shown at top of Progress tab) ----------
function RatingCard({ eloResult, profile }) {
  const hasWeight = !!Number(profile.weightKg);

  if (!hasWeight) {
    return (
      <div className="mb-5 rounded-xl bg-gray-900 text-white px-4 py-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Award size={14} className="text-orange-400" />
          <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Rating</p>
        </div>
        <p className="text-sm text-gray-300">Add your weight in the Profile tab to unlock your rating.</p>
      </div>
    );
  }

  const { trajectory, rating, coverage } = eloResult;
  const { tier, next } = tierForRating(rating);
  const prevRating = trajectory.length >= 2 ? trajectory[trajectory.length - 2].rating : RATING_BASELINE;
  const change = trajectory.length ? rating - prevRating : 0;
  const lastEntry = trajectory[trajectory.length - 1];
  const hadLayoff = lastEntry && lastEntry.layoffPenalty > 0;

  const rangeStart = tier.min;
  const rangeEnd = next ? next.min : tier.min + 400;
  const pctToNext = next ? Math.min(1, Math.max(0, (rating - rangeStart) / (rangeEnd - rangeStart))) : 1;

  const staleCount = coverage.filter((c) => c.status === "stale" || c.status === "untouched").length;

  return (
    <div className="mb-5 rounded-xl bg-gray-900 text-white px-4 py-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Award size={14} className="text-orange-400" />
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Rating</p>
      </div>

      <div className="flex items-end gap-3 mb-1">
        <span className="font-mono text-4xl font-bold tabular-nums leading-none">{trajectory.length ? rating : RATING_BASELINE}</span>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${tier.bg} ${tier.color}`}>{tier.name}</span>
        {trajectory.length > 1 && change !== 0 && (
          <span className={`text-xs font-semibold ml-auto mb-1 ${change > 0 ? "text-emerald-400" : "text-orange-400"}`}>
            {change > 0 ? "+" : ""}{change}
          </span>
        )}
      </div>

      {trajectory.length === 0 && (
        <p className="text-xs text-gray-400 mt-1">Log your first session to get your starting rating.</p>
      )}

      {hadLayoff && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-gray-700 px-2.5 py-1.5">
          <p className="text-xs text-orange-300">
            {lastEntry.gapDays}-day gap since your last session — rating dropped {lastEntry.layoffPenalty} pts for the layoff, before this session even counted.
          </p>
        </div>
      )}

      {next && trajectory.length > 0 && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full" style={{ width: `${pctToNext * 100}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{next.min - rating > 0 ? `${next.min - rating} to ${next.name}` : `Ready for ${next.name}`}</p>
        </div>
      )}

      {trajectory.length > 2 && (
        <div className="h-24 mt-3 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trajectory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <Line type="monotone" dataKey="rating" stroke="#fb923c" strokeWidth={2} dot={false} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(v) => [v, "Rating"]}
                labelFormatter={(l, p) => (p && p[0] ? fmtDate(p[0].payload.date) : "")}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {staleCount > 0 && trajectory.length > 0 && (
        <p className="text-xs text-gray-500 mt-3">
          {staleCount} exercise{staleCount > 1 ? "s" : ""} untouched or fading — training them keeps your climb faster.
        </p>
      )}

      {/* Honesty note — see workout_tracker.md §6. There is no published strength-standard
          database for dumbbell lifts, so the benchmarks are derived estimates. Keep this visible. */}
      <p className="text-xs text-gray-500 mt-3 leading-snug">
        Benchmarks are directional estimates derived from barbell standards — no published dumbbell
        strength database exists. Treat this as a game score, not a clinical measure.
      </p>
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
      setPasteErr("That doesn't look like a score card — paste the whole GAINS|... line.");
      return;
    }
    if (displayName && parsed.name.toLowerCase() === displayName.toLowerCase()) {
      setPasteErr("That's your own card.");
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
        <Users size={13} className="text-orange-600" />
        <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Leaderboard</p>
      </div>

      {!displayName && (
        <p className="text-xs text-gray-500 mb-2.5">Set a display name in the Profile tab to join.</p>
      )}

      {board.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {board.map((e, i) => (
            <div
              key={e.name + i}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 border ${
                e.me ? "bg-orange-50 border-orange-200" : "bg-white border-gray-100"
              }`}
            >
              <span className="text-xs font-semibold text-gray-700 truncate">
                {i + 1}. {e.name}{e.me ? " (you)" : ""}
              </span>
              <span className="font-mono text-xs tabular-nums text-gray-900 shrink-0 ml-2">{e.rating}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={shareCard}
          className="flex-1 flex items-center justify-center gap-1.5 bg-orange-600 text-white text-xs font-semibold rounded-md py-2"
        >
          <Share2 size={12} /> {copied ? "Copied!" : "Share my score"}
        </button>
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-semibold rounded-md py-2"
        >
          <Plus size={12} /> Add friend's score
        </button>
      </div>

      {pasteOpen && (
        <div className="mt-2.5">
          <textarea
            value={pasteVal}
            onChange={(e) => { setPasteVal(e.target.value); setPasteErr(""); }}
            rows={2}
            placeholder="Paste their GAINS|... line here"
            className="w-full resize-none bg-white rounded-md px-2.5 py-2 text-xs text-gray-900 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-600"
          />
          <button onClick={addRival} className="w-full mt-1.5 bg-gray-900 text-white text-xs font-semibold rounded-md py-2">
            Add to leaderboard
          </button>
          {pasteErr && <p className="text-xs text-orange-600 mt-1.5">{pasteErr}</p>}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2.5">
        Scores update only when you each re-share — it's a snapshot, not a live feed.
      </p>
    </div>
  );
}

function ProgressView({ sessions, profile }) {
  const exerciseNames = useMemo(() => {
    const set = new Set();
    sessions.forEach((s) => s.exercises.forEach((e) => set.add(e.name)));
    return Array.from(set).sort();
  }, [sessions]);

  const [selected, setSelected] = useState(exerciseNames[0] || "");

  useEffect(() => {
    if (!selected && exerciseNames.length) setSelected(exerciseNames[0]);
  }, [exerciseNames, selected]);

  const eloResult = useMemo(
    () => computeEloTrajectory(sessions, Number(profile.weightKg) || null),
    [sessions, profile.weightKg]
  );

  const data = useMemo(() => {
    const rows = [];
    sessions
      .filter((s) => s.exercises.some((e) => e.name === selected))
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .forEach((s) => {
        const ex = s.exercises.find((e) => e.name === selected);
        if (!ex || ex.sets.length === 0) return;
        const topWeight = Math.max(...ex.sets.map((st) => st.weight));
        const totalReps = ex.sets.reduce(
          (sum, st) => sum + st.reps + (st.drops ? st.drops.reduce((ds, d) => ds + d.reps, 0) : 0),
          0
        );
        rows.push({ date: s.date, label: fmtDate(s.date), topWeight, totalReps, sets: ex.sets.length });
      });
    return rows;
  }, [sessions, selected]);

  if (exerciseNames.length === 0) {
    return (
      <div className="px-4 pt-4">
        <RatingCard eloResult={eloResult} profile={profile} />
        {eloResult.trajectory.length > 0 && (
          <Leaderboard displayName={profile.displayName} rating={eloResult.rating} tierName={tierForRating(eloResult.rating).tier.name} />
        )}
        <div className="px-1 pt-12 text-center">
          <TrendingUp size={28} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm text-gray-500">No exercise data yet.</p>
          <p className="text-xs text-gray-400 mt-1">Log a few sessions to see trends.</p>
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
        className="w-full bg-gray-100 rounded-md px-3 py-2.5 text-sm text-gray-900 border border-gray-200 mb-4 focus:outline-none focus:ring-2 focus:ring-orange-600"
      >
        {exerciseNames.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>

      {data.length > 0 && (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-mono text-3xl font-bold tabular-nums">{latest.topWeight}</span>
            <span className="text-sm text-gray-500">kg top set</span>
            {delta !== 0 && (
              <span className={`text-xs font-semibold ml-auto ${delta > 0 ? "text-emerald-600" : "text-orange-600"}`}>
                {delta > 0 ? "+" : ""}{delta}kg since first log
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
                <Line type="monotone" dataKey="topWeight" stroke="#FF5A36" strokeWidth={2.5} dot={{ fill: "#FF5A36", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-5 space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Session log</p>
            {[...data].reverse().map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded-md px-3 py-2 border border-gray-200">
                <span className="text-gray-500">{d.label}</span>
                <span className="font-mono tabular-nums">{d.topWeight}kg · {d.sets} sets · {d.totalReps} reps</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
