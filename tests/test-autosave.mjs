// Autosave regression test — the most important behaviour in the app (workout_tracker.md §5).
// He lost a real workout to the old "you must press Save" model. This asserts that a set
// logged in one app instance survives into a fresh instance sharing the same storage.

import { BUNDLE, makeDom, sleep, rootText, buttonWithText, click, setNativeValue, check, finish } from "./dom.mjs";

// ---- Pass 1: log a set, expect a draft to be autosaved ----
const dom1 = makeDom();
const w1 = dom1.window;
const errs1 = [];
w1.console.error = (...a) => errs1.push(a.join(" "));
w1.eval(BUNDLE);
await sleep(500);

const doc1 = w1.document;
const numberInputs = [...doc1.querySelectorAll('input[type="number"]')];
const kg = numberInputs.find((i) => i.placeholder === "kg");
const reps = numberInputs.find((i) => i.placeholder === "reps");
check("first exercise card exposes weight and reps inputs", !!kg && !!reps);

setNativeValue(w1, kg, "12");
setNativeValue(w1, reps, "10");
await sleep(100);

const addBtn = buttonWithText(doc1, "Add set");
check("Add set button is present", !!addBtn);
click(w1, addBtn);

await sleep(1500); // past the 700ms debounce

const draft = w1.localStorage.getItem("draft_v1");
check("draft is written without pressing Save", !!draft);

let withSets = [];
if (draft) {
  const parsed = JSON.parse(draft);
  withSets = parsed.exercises.filter((e) => e.sets.length > 0);
  check("draft records the current day", parsed.day === "Upper A", `got ${parsed.day}`);
  check("exactly the logged exercise carries sets", withSets.length === 1, `got ${withSets.length}`);
  check(
    "the set is stored with the values entered",
    withSets[0] && withSets[0].sets[0] && withSets[0].sets[0].weight === 12 && withSets[0].sets[0].reps === 10,
    JSON.stringify(withSets[0] && withSets[0].sets)
  );
}
check("no console errors while logging", errs1.length === 0, errs1.slice(0, 3).join(" | "));

// ---- Pass 2: fresh app instance sharing the same storage, expect restore ----
const dom2 = makeDom();
const w2 = dom2.window;
w2.localStorage.setItem("draft_v1", draft); // simulates reopening the app
const errs2 = [];
w2.console.error = (...a) => errs2.push(a.join(" "));
w2.eval(BUNDLE);
await sleep(900);

const text2 = rootText(w2);
check("in-progress set is restored on reopen", text2.includes("12") && text2.includes("Set 1"));
check("no console errors on restore", errs2.length === 0, errs2.slice(0, 3).join(" | "));

finish("autosave");
