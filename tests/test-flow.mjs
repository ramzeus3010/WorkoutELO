// End-to-end flow: coach → rating → leaderboard.
//
// Seeds one prior Upper A session into storage, then drives the real UI.
// The load-bearing assertion here is the PAIN ORDERING one: the lateral raise below
// both flags pain in its notes AND hit the top of its rep range. If the pain branch in
// buildLocalCoach ever stops being checked first, the coach would tell him to add weight
// to the lift that hurt him. See workout_tracker.md §1 and §7.

import {
  BUNDLE, makeDom, sleep, rootText, buttonWithText, click, setNativeValue,
  daysAgoISO, check, finish,
} from "./dom.mjs";

const LAST_SESSION_DATE = daysAgoISO(30); // >21 days, so the coach should also advise starting lighter

const priorSession = {
  id: "seed1",
  date: LAST_SESSION_DATE,
  day: "Upper A",
  duration: 35,
  exercises: [
    {
      name: "Dumbbell Bench Press", muscle: "", rest: 90, link: "", notes: "",
      // 12 reps = top of the 8-12 range, no drop sets → expect a weight bump
      sets: [{ weight: 20, reps: 10 }, { weight: 20, reps: 12 }],
    },
    {
      name: "Dumbbell Overhead Press", muscle: "", rest: 90, link: "", notes: "",
      // went to failure with a drop set → expect "repeat this weight"
      sets: [{ weight: 12, reps: 8, drops: [{ weight: 8, reps: 6 }] }],
    },
    {
      name: "Dumbbell Lateral Raise", muscle: "", rest: 60, link: "",
      notes: "sharp pain in the left mid-back on the last set",
      // 15 reps = top of the 12-15 range. Pain must still win over the bump.
      sets: [{ weight: 8, reps: 15 }],
    },
    {
      name: "Dumbbell Curl", muscle: "", rest: 60, link: "", notes: "",
      // mid-range, no drops → expect "same weight, add a rep"
      sets: [{ weight: 10, reps: 10 }],
    },
  ],
};

// An older session so the seeded one has a real gap before it — that's what triggers the
// layoff decay in the rating (workout_tracker.md §6). One session alone has nothing to
// measure a gap against.
const olderSession = {
  id: "seed0",
  date: daysAgoISO(75), // 45 days before priorSession → well past the 7-day grace
  day: "Upper A",
  duration: 30,
  exercises: [
    { name: "Dumbbell Bench Press", muscle: "", rest: 90, link: "", notes: "", sets: [{ weight: 18, reps: 9 }] },
    { name: "Dumbbell Curl", muscle: "", rest: 60, link: "", notes: "", sets: [{ weight: 10, reps: 9 }] },
  ],
};

const dom = makeDom();
const w = dom.window;
const doc = w.document;
const errs = [];
w.console.error = (...a) => errs.push(a.join(" "));

w.localStorage.setItem("sess_index", JSON.stringify([olderSession.id, priorSession.id]));
w.localStorage.setItem("sess_" + olderSession.id, JSON.stringify(olderSession));
w.localStorage.setItem("sess_" + priorSession.id, JSON.stringify(priorSession));
w.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76, displayName: "Ramazan" }));

w.eval(BUNDLE);
await sleep(700);

// ---- Coach ----
console.log("coach");
const startBtn = buttonWithText(doc, "Start Workout");
check("coach button is present before starting", !!startBtn);
click(w, startBtn);
await sleep(400);

const coachText = rootText(w);

check(
  "pain note produces a back-off suggestion",
  coachText.includes("flagged discomfort"),
  "expected the lateral-raise card to warn about discomfort"
);
check(
  "pain check beats the progression check (nothing tells him to go heavier on the painful lift)",
  !coachText.includes("try 10.5kg") && !coachText.includes("Hit the top of the range at 8kg"),
  "a pain-flagged exercise was given a weight bump — PAIN_WORDS branch is no longer first"
);
check("top-of-range lift gets a weight bump", coachText.includes("try 22.5kg"));
check("drop-set lift is told to repeat the weight", coachText.includes("repeat that weight"));
check("mid-range lift is told to add reps", coachText.includes("Stay at 10kg"));
check("long layoff is called out in the overall note", coachText.includes("start lighter"));

// ---- Keyboard accessory: weight → Next → reps → Record the set ----
// On iOS the numeric keypad has no return key, so this bar is the only way to move between
// fields without reaching for the screen. If it stops rendering, logging a set goes back to
// three separate taps mid-workout.
console.log("keyboard");
const kgInput = doc.querySelector('input[placeholder="kg"]');
const repsInput = doc.querySelector('input[placeholder="reps"]');

check("weight field requests a decimal keypad", kgInput.getAttribute("inputmode") === "decimal");
check("weight field is not type=number", kgInput.getAttribute("type") !== "number",
  "type=number renders a dead decimal point on iOS — 7.5kg becomes unenterable");
check("reps field requests a numeric keypad", repsInput.getAttribute("inputmode") === "numeric");

kgInput.focus();
await sleep(150);
check("accessory bar appears when the weight field is focused", !!buttonWithText(doc, "Next"));

setNativeValue(w, kgInput, "7.5");
await sleep(100);
click(w, buttonWithText(doc, "Next"));
await sleep(200);
check("Next moves focus to the reps field", doc.activeElement === repsInput,
  `focus landed on ${doc.activeElement && doc.activeElement.placeholder}`);
check("action button becomes Record the set on the reps field", !!buttonWithText(doc, "Record the set"));

setNativeValue(w, repsInput, "11");
await sleep(100);
click(w, buttonWithText(doc, "Record the set"));
await sleep(300);

const afterRecord = rootText(w);
check("the set is logged from the keyboard bar", afterRecord.includes("7.5") && afterRecord.includes("Set 1"));
check("keyboard bar closes after recording", !buttonWithText(doc, "Record the set"));

await sleep(900); // past the 700ms autosave debounce
check("decimal weight survives into storage", (w.localStorage.getItem("draft_v1") || "").includes('"weight":7.5'));

// ---- Rest timer is a screen-edge ring, never a bar over the inputs ----
check("recording a set starts the rest ring", !!doc.querySelector("svg.fixed.inset-0"));
check(
  "the ring cannot sit on top of a control",
  (doc.querySelector("svg.fixed.inset-0").getAttribute("class") || "").includes("pointer-events-none")
);
check("exact time is available in a readout at the top of the page", /Resting ·/.test(rootText(w)));

// ---- Rating ----
console.log("rating");
click(w, buttonWithText(doc, "Progress"));
await sleep(500);

const progressText = rootText(w);
const tiers = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Top 5%"];

check("progress tab shows a rating", /\b\d{3,4}\b/.test(progressText));
check("a tier is assigned", tiers.some((t) => progressText.includes(t)), progressText.slice(0, 200));
// The layoff penalty was removed with the move to the ranked score: time off is already
// visible on the weekly effort axis and in per-pattern decay, so deducting for it a third
// time punished one absence three ways.
check("no layoff penalty is charged any more", !progressText.includes("for the layoff"));
check("dumbbell benchmarks stay caveated", /estimate/i.test(progressText));

// ---- Leaderboard ----
console.log("leaderboard");
check("own name appears on the board", progressText.includes("Ramazan"));

const addBtn = buttonWithText(doc, "Add friend's score");
check("add-a-rival button is present", !!addBtn);
click(w, addBtn);
await sleep(200);

const paste = doc.querySelector("textarea[placeholder*='GAINS']");
check("paste box opens", !!paste);
setNativeValue(w, paste, "check this out GAINS|Aidos|1750|Platinum|2026-08-01 lol");
await sleep(150);
click(w, buttonWithText(doc, "Add to leaderboard"));
await sleep(400);

const boardText = rootText(w);
check("rival is added to the board", boardText.includes("Aidos") && boardText.includes("1750"));
check("rival is persisted for next open", (w.localStorage.getItem("rivals_v1") || "").includes("Aidos"));

// A rival above him should outrank him; ordering is by rating descending.
const posRival = boardText.indexOf("Aidos");
const posMe = boardText.indexOf("Ramazan (you)");
check("board is sorted by rating", posRival !== -1 && posMe !== -1 && posRival < posMe);

// Garbage input must be rejected, not stored.
click(w, buttonWithText(doc, "Add friend's score"));
await sleep(200);
const paste2 = doc.querySelector("textarea[placeholder*='GAINS']");
setNativeValue(w, paste2, "just some random text");
await sleep(150);
click(w, buttonWithText(doc, "Add to leaderboard"));
await sleep(300);
check("malformed card is rejected with a message", rootText(w).includes("doesn't look like a score card"));

check("no console errors across the whole flow", errs.length === 0, errs.slice(0, 3).join(" | "));

finish("flow");
