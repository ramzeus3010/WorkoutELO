// Export test.
//
// This is the only route data has out of Telegram CloudStorage (§5) — if it breaks quietly,
// the backup is worthless exactly when it's needed. So this asserts the real content:
// every session present, decimals and drop sets intact, and the reviewer context that stops
// an LLM giving advice that contradicts the athlete's own pain notes.

import {
  BUNDLE, makeDom, sleep, buttonWithText, click, rootText, daysAgoISO, check, finish,
} from "./dom.mjs";

const recent = {
  id: "e1",
  date: daysAgoISO(3),
  day: "Upper A",
  duration: 32,
  exercises: [
    {
      name: "Dumbbell Bench Press", muscle: "", rest: 90, link: "", notes: "",
      sets: [{ weight: 22.5, reps: 10 }, { weight: 22.5, reps: 8, drops: [{ weight: 15, reps: 6 }] }],
    },
    {
      name: "Dumbbell Lateral Raise", muscle: "", rest: 60, link: "",
      notes: "sharp pain in the left mid-back again",
      sets: [{ weight: 7.5, reps: 14 }],
    },
  ],
};

// Outside the 4-week window, so the range selector has something to actually exclude.
const old = {
  id: "e0",
  date: daysAgoISO(60),
  day: "Lower A",
  duration: 28,
  exercises: [
    { name: "Leg Press", muscle: "", rest: 90, link: "", notes: "", sets: [{ weight: 80, reps: 12 }] },
  ],
};

const dom = makeDom();
const w = dom.window;
const doc = w.document;
const errs = [];
w.console.error = (...a) => errs.push(a.join(" "));

// Capture whatever the app puts on the clipboard.
let clipboard = null;
w.navigator.clipboard = { writeText: async (t) => { clipboard = t; } };

w.localStorage.setItem("sess_index", JSON.stringify([old.id, recent.id]));
w.localStorage.setItem("sess_" + old.id, JSON.stringify(old));
w.localStorage.setItem("sess_" + recent.id, JSON.stringify(recent));
w.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76.5, displayName: "Ramazan" }));

w.eval(BUNDLE);
await sleep(700);

click(w, buttonWithText(doc, "Profile"));
await sleep(400);

check("export panel is on the Profile tab", !!buttonWithText(doc, "Copy for review"));

// ---- Markdown, default range (last 4 weeks) ----
click(w, buttonWithText(doc, "Copy for review"));
await sleep(300);

check("markdown export reaches the clipboard", typeof clipboard === "string" && clipboard.length > 0);
const md = clipboard || "";

check("recent session is included", md.includes(recent.date) && md.includes("Dumbbell Bench Press"));
check("session outside the range is excluded", !md.includes("Leg Press"),
  "the 4-week range leaked a 60-day-old session");
check("decimal weights survive", md.includes("22.5kg×10") && md.includes("7.5kg×14"));
check("drop sets are marked, not flattened", md.includes("→ 15kg×6"));
check("bodyweight is included for context", md.includes("76.5 kg"));
check("day balance is reported", md.includes("Day balance") && md.includes("Upper A"));
check("frequency is reported", /sessions\/week/.test(md));

// The reviewer-safety part: an LLM reading this must see the pain note as a constraint.
check("pain notes are surfaced as constraints", md.includes("Flagged as painful"));
check("the actual pain note text is carried over", md.includes("sharp pain in the left mid-back"));
check("reviewer is told not to push through it", /not as things to push through/i.test(md));

// The honesty caveat from §6 has to travel with the data, not just live in the UI.
check("rating caveat travels with the export", /game score, not a clinical measure/i.test(md));
check("seconds-in-reps quirk is explained", /seconds in the reps field/i.test(md));

// The copy buttons relabel themselves to "Copied ✓" for 2s, so wait them out before
// looking for them again by name.
await sleep(2100);

// ---- Range selector ----
clipboard = null;
click(w, buttonWithText(doc, "Everything"));
await sleep(250);
click(w, buttonWithText(doc, "Copy for review"));
await sleep(300);
check("Everything range includes the older session", (clipboard || "").includes("Leg Press"));

await sleep(2100);

// ---- JSON backup ----
clipboard = null;
click(w, buttonWithText(doc, "Copy backup"));
await sleep(300);

let parsed = null;
try { parsed = JSON.parse(clipboard); } catch (e) { /* asserted below */ }
check("backup is valid JSON", !!parsed, clipboard ? clipboard.slice(0, 120) : "nothing copied");

if (parsed) {
  check("backup is version-stamped", parsed.formatVersion === 1 && parsed.app === "chetamba");
  check("backup carries every session", parsed.sessions.length === 2);
  check("backup carries the profile", parsed.profile.weightKg === 76.5);
  // Lossless is the whole point — a backup that drops drop sets isn't a backup.
  const bench = parsed.sessions.find((s) => s.id === recent.id).exercises[0];
  check("backup round-trips sets exactly", JSON.stringify(bench.sets) === JSON.stringify(recent.exercises[0].sets));
  check("backup keeps notes", parsed.sessions.find((s) => s.id === recent.id).exercises[1].notes === recent.exercises[1].notes);
}

check("no console errors during export", errs.length === 0, errs.slice(0, 3).join(" | "));

finish("export");
