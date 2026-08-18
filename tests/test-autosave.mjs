// Autosave regression test — the most important behaviour in the app (workout_tracker.md §5).
// He lost a real workout to the old "you must press Save" model. This asserts that a set
// logged in one app instance survives into a fresh instance sharing the same storage.

import { BUNDLE, makeDom, sleep, rootText, buttonWithText, click, setNativeValue, check, finish } from "./dom.mjs";

// ---- Pass 1: log a set, expect a draft to be autosaved ----
const dom1 = makeDom();
const w1 = dom1.window;
const errs1 = [];
w1.console.error = (...a) => errs1.push(a.join(" "));
// Past onboarding — otherwise the app opens on the welcome screen and there's no set to log.
w1.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76, displayName: "Ramazan" }));
w1.localStorage.setItem("onboarded_v1", "1");
w1.eval(BUNDLE);
await sleep(500);

const doc1 = w1.document;
// Matched by placeholder, not type: the weight field is type="text" + inputMode="decimal"
// so iOS gives it a working decimal point (see the comment on the input in app.jsx).
const kg = doc1.querySelector('input[placeholder="kg"]');
const reps = doc1.querySelector('input[placeholder="reps"]');
check("first exercise card exposes weight and reps inputs", !!kg && !!reps);
check("weight field asks for a decimal keypad", kg && kg.getAttribute("inputmode") === "decimal");

// A decimal weight must survive — entering 7.5 kg was impossible before this.
setNativeValue(w1, kg, "12.5");
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
    "the decimal weight is stored as entered, not truncated",
    withSets[0] && withSets[0].sets[0] && withSets[0].sets[0].weight === 12.5 && withSets[0].sets[0].reps === 10,
    JSON.stringify(withSets[0] && withSets[0].sets)
  );
}
check("no console errors while logging", errs1.length === 0, errs1.slice(0, 3).join(" | "));

// ---- Pass 2: fresh app instance sharing the same storage, expect restore ----
const dom2 = makeDom();
const w2 = dom2.window;
w2.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76, displayName: "Ramazan" }));
w2.localStorage.setItem("onboarded_v1", "1");
w2.localStorage.setItem("draft_v1", draft); // simulates reopening the app
const errs2 = [];
w2.console.error = (...a) => errs2.push(a.join(" "));
w2.eval(BUNDLE);
await sleep(900);

const text2 = rootText(w2);
check("in-progress set is restored on reopen", text2.includes("12.5") && text2.includes("Set 1"));
check("no console errors on restore", errs2.length === 0, errs2.slice(0, 3).join(" | "));

finish("autosave");
