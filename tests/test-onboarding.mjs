// First run: what a friend sees when they open a link someone shared.
//
// Before this existed they landed straight in Ramazan's 4-day split — hip thrusts included —
// with no bodyweight set. The bodyweight part is the silent one: strengthScore divides every
// load benchmark by it, so without it the score sits at baseline forever and nothing on
// screen explains why. That's what the first block guards.

import {
  BUNDLE, makeDom, sleep, buttonWithText, click, setNativeValue, rootText, check, finish,
} from "./dom.mjs";

function bootFresh() {
  const dom = makeDom();
  const w = dom.window;
  const errs = [];
  w.console.error = (...a) => errs.push(a.join(" "));
  w.navigator.clipboard = { writeText: async () => {} };
  w.eval(BUNDLE); // deliberately no profile and no onboarded flag
  return { w, doc: w.document, errs };
}

const readProfile = (w) => {
  try { return JSON.parse(w.localStorage.getItem("profile") || "null"); } catch (e) { return null; }
};

// ---------------------------------------------------------------- the gate
console.log("first run");
{
  const { w, doc, errs } = bootFresh();
  await sleep(700);

  const text = rootText(w);
  check("a brand new user gets onboarding, not someone else's split", text.includes("Welcome to Chetamba"));
  check("it does NOT drop them into a stranger's program", !text.includes("Dumbbell Bench Press"));
  check("bodyweight is asked for", /bodyweight/i.test(text));
  check("it explains why bodyweight is needed", /relative to your bodyweight/i.test(text));

  // Bodyweight is the one thing that can't be skipped, so Continue stays inert without it.
  const cont = buttonWithText(doc, "Continue");
  check("continue is disabled until a bodyweight is entered", !!cont && cont.disabled);

  const weight = doc.querySelector('input[inputmode="decimal"]');
  check("the bodyweight field asks for a decimal keypad", !!weight);
  setNativeValue(w, weight, "76");
  await sleep(250);
  check("continue unlocks once it's filled in", !buttonWithText(doc, "Continue").disabled);
  check("no console errors during onboarding", errs.length === 0, errs.join("\n"));
}

// ---------------------------------------------------------------- picking a template
console.log("\nchoosing a starting program");
{
  const { w, doc } = bootFresh();
  await sleep(700);

  setNativeValue(w, doc.querySelector('input[inputmode="decimal"]'), "82");
  await sleep(200);
  click(w, buttonWithText(doc, "Continue"));
  await sleep(400);

  const text = rootText(w);
  check("starting programs are offered", text.includes("Full body, 3 days"));
  check("more than one option is offered", text.includes("Upper / lower, 4 days") && text.includes("Dumbbells only"));
  check("skipping the program entirely is allowed", !!buttonWithText(doc, "Skip"));
  check("it says the program isn't what you're scored against", /not what you're scored against/i.test(text));

  // The default program used to contain hip thrusts, which the author doesn't do, and every
  // new user inherited them. No template may reintroduce that.
  check("no template contains hip thrusts", !/hip thrust/i.test(text));

  click(w, buttonWithText(doc, "Full body, 3 days"));
  await sleep(800);

  check("the bodyweight is saved", readProfile(w) && readProfile(w).weightKg === 82);
  check("onboarding is marked done so it doesn't reappear", w.localStorage.getItem("onboarded_v1") === "1");
  check("the app proper is now showing", rootText(w).includes("Full A") || rootText(w).includes("Log"));
}

// ---------------------------------------------------------------- skipping the program
console.log("\nskipping the program");
{
  const { w, doc } = bootFresh();
  await sleep(700);
  setNativeValue(w, doc.querySelector('input[inputmode="decimal"]'), "70");
  await sleep(200);
  click(w, buttonWithText(doc, "Continue"));
  await sleep(400);
  click(w, buttonWithText(doc, "Skip"));
  await sleep(800);

  check("skipping still records the bodyweight", readProfile(w) && readProfile(w).weightKg === 70);
  check("skipping still completes onboarding", w.localStorage.getItem("onboarded_v1") === "1");
}

// ---------------------------------------------------------------- returning users
console.log("\nreturning users");
{
  const dom = makeDom();
  const w = dom.window;
  w.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76, displayName: "Ramazan" }));
  w.localStorage.setItem("onboarded_v1", "1");
  w.eval(BUNDLE);
  await sleep(700);
  check("someone already set up never sees onboarding again", !rootText(w).includes("Welcome to Chetamba"));
}

finish("onboarding");
