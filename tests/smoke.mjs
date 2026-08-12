// Smoke test: does the bundle render at all, with no console errors?
// This is the cheapest guard against a bad build or a crash-on-mount regression.

import { BUNDLE, makeDom, sleep, rootText, buttonWithText, click, check, finish } from "./dom.mjs";

const dom = makeDom();
const w = dom.window;
const errs = [];
w.console.error = (...a) => errs.push(a.join(" "));

w.eval(BUNDLE);
await sleep(600);

const text = rootText(w);

check("renders something into #root", text.length > 0);
check("no console errors on mount", errs.length === 0, errs.slice(0, 3).join(" | "));
check("shows the app header", text.includes("Chetamba") && text.includes("Training Log"));
check("shows all four tabs", ["Log", "History", "Progress", "Profile"].every((t) => text.includes(t)));
check("defaults to the Log tab with Upper A", text.includes("Upper A"));
check("renders the first exercise of the split", text.includes("Dumbbell Bench Press"));
check("offers the coach entry point", !!buttonWithText(w.document, "Start Workout"));

// Every tab must mount without throwing, including the empty states.
for (const tab of ["History", "Progress", "Profile"]) {
  const btn = buttonWithText(w.document, tab);
  click(w, btn);
  await sleep(300);
  check(`${tab} tab mounts`, rootText(w).length > 0);
}
check("no console errors after visiting every tab", errs.length === 0, errs.slice(0, 3).join(" | "));

finish("smoke");
