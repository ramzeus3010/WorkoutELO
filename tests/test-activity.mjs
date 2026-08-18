// Activity sessions and ad-hoc lifting.
//
// Two things the app couldn't express before: "I played basketball for two hours" and "I went
// to the gym and did whatever". Both matter for a group where friends don't share a program.
//
// The load-bearing assertion is that an activity is stored with kind:"activity" and its
// minutes intact. Everything downstream — the effort axis, the bot's group message, the
// weekly board — reads those two fields, and a lifting-shaped record with no sets would be
// silently worth nothing.

import {
  BUNDLE, makeDom, sleep, buttonWithText, click, setNativeValue, rootText, check, finish,
} from "./dom.mjs";

function boot() {
  const dom = makeDom();
  const w = dom.window;
  const errs = [];
  w.console.error = (...a) => errs.push(a.join(" "));
  w.navigator.clipboard = { writeText: async () => {} };
  w.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76, displayName: "Ramazan" }));
  w.eval(BUNDLE);
  return { w, doc: w.document, errs };
}

const storedSessions = (w) => {
  let ids = [];
  try { ids = JSON.parse(w.localStorage.getItem("sess_index") || "[]"); } catch (e) { ids = []; }
  return ids.map((id) => JSON.parse(w.localStorage.getItem("sess_" + id)));
};

// ---------------------------------------------------------------- logging an activity
console.log("activity logging");
{
  const { w, doc, errs } = boot();
  await sleep(700);

  check("the log screen offers an Activity mode", !!buttonWithText(doc, "Activity"));
  click(w, buttonWithText(doc, "Activity"));
  await sleep(400);

  const text = rootText(w);
  check("activity types are offered", text.includes("Basketball") && text.includes("Hiking"));
  check("it says plainly that this isn't strength", /not toward strength/i.test(text));

  click(w, buttonWithText(doc, "Basketball"));
  await sleep(200);

  const mins = [...doc.querySelectorAll('input[inputmode="numeric"]')].pop();
  check("a minutes field is present", !!mins);
  // Never type="number": iOS renders a decimal point on it that does nothing (handover doc).
  check("minutes is a text input, per the iOS keypad constraint", mins.getAttribute("type") === "text");

  setNativeValue(w, mins, "120");
  await sleep(300);
  check("it previews the effort earned before you commit", /effort/i.test(rootText(w)));

  click(w, buttonWithText(doc, "Record activity"));
  await sleep(600);

  const saved = storedSessions(w);
  check("the activity is stored", saved.length === 1, `stored ${saved.length}`);
  check("it is marked as an activity, not a workout", saved[0] && saved[0].kind === "activity");
  check("the activity type survives", saved[0] && saved[0].activityType === "basketball");
  check("the duration survives", saved[0] && saved[0].minutes === 120);
  check("no console errors while logging an activity", errs.length === 0, errs.join("\n"));
}

// ---------------------------------------------------------------- it shows up in history
console.log("\nactivities in history");
{
  const { w, doc } = boot();
  await sleep(700);
  click(w, buttonWithText(doc, "Activity"));
  await sleep(300);
  click(w, buttonWithText(doc, "Hiking"));
  await sleep(200);
  const mins = [...doc.querySelectorAll('input[inputmode="numeric"]')].pop();
  setNativeValue(w, mins, "300");
  await sleep(200);
  click(w, buttonWithText(doc, "Record activity"));
  await sleep(600);

  click(w, buttonWithText(doc, "History"));
  await sleep(400);
  const text = rootText(w);
  check("the hike is listed in history", text.includes("Hiking"));
  check("its duration is shown", text.includes("300 min"));
  check("history does not render it as an empty workout", !/0 exercises/.test(text));
}

// ---------------------------------------------------------------- ad-hoc lifting
console.log("\nad-hoc lifting");
{
  const { w, doc, errs } = boot();
  await sleep(700);

  check("an ad-hoc day is offered alongside the program days", !!buttonWithText(doc, "Ad-hoc"));
  click(w, buttonWithText(doc, "Ad-hoc"));
  await sleep(400);
  check("the ad-hoc day starts empty rather than with someone else's split",
    !rootText(w).includes("Dumbbell Bench Press"));

  click(w, buttonWithText(doc, "Add a one-off exercise"));
  await sleep(400);
  check("an exercise can be added from scratch", rootText(w).includes("New exercise"));

  // The whole point: an off-program lift must be scoreable, which means picking a pattern.
  const selects = [...doc.querySelectorAll("select")];
  const patternSelect = selects.find((s) => [...s.options].some((o) => /Horizontal push/.test(o.textContent)));
  check("a one-off exercise exposes a movement pattern picker", !!patternSelect);
  // The old rule ("logged but not scored") is gone, so the UI must not still claim it.
  check("the UI no longer says one-offs are unscored", !/don't count toward your rating/.test(rootText(w)));
  check("no console errors building an ad-hoc session", errs.length === 0, errs.join("\n"));
}

finish("activity");
