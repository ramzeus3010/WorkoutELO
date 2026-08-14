// Program editing + substitution.
//
// The load-bearing assertion is the LAST one: a substituted lift must be credited to the
// slot it replaced. If it isn't, the replaced exercise reads as untouched, decays toward
// neutral, and the athlete's rating drops *for doing the workout correctly* — which
// directly contradicts the rule in §6 that skipping is what costs you. That failure is
// silent and looks like normal rating noise, so it gets an explicit test.

import {
  BUNDLE, makeDom, sleep, buttonWithText, click, setNativeValue, rootText,
  daysAgoISO, check, finish,
} from "./dom.mjs";

function boot({ seed } = {}) {
  const dom = makeDom();
  const w = dom.window;
  const errs = [];
  w.console.error = (...a) => errs.push(a.join(" "));
  w.navigator.clipboard = { writeText: async () => {} };
  w.localStorage.setItem("profile", JSON.stringify({ heightCm: 186, weightKg: 76, displayName: "Ramazan" }));
  if (seed) seed(w);
  w.eval(BUNDLE);
  return { w, doc: w.document, errs };
}

const ratingFrom = (text) => {
  const m = text.match(/(\d{3,4})\s*(Bronze|Silver|Gold|Platinum|Diamond|Top 5%)/);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------- program editing
console.log("editing");
{
  const { w, doc, errs } = boot();
  await sleep(700);

  click(w, buttonWithText(doc, "Profile"));
  await sleep(400);
  check("Profile offers a way into the program editor", !!buttonWithText(doc, "Edit program"));

  click(w, buttonWithText(doc, "Edit program"));
  await sleep(400);
  check("the editor opens", rootText(w).includes("Your program"));
  check("the editor explains it is not the same as a one-day swap", /Swap/.test(rootText(w)));
  check("the built-in days are listed", rootText(w).includes("Upper A") && rootText(w).includes("Lower B"));

  // Nothing changed yet, so saving must be inert.
  const saveBtn = buttonWithText(doc, "No changes");
  check("save is disabled until something changes", !!saveBtn && saveBtn.disabled);

  // The first day starts expanded; only click if it isn't.
  if (!doc.querySelector('input[placeholder="Day name"]')) {
    click(w, buttonWithText(doc, "Upper A"));
    await sleep(300);
  }
  const nameInput = doc.querySelector('input[placeholder="Day name"]');
  check("day name is editable", !!nameInput);
  setNativeValue(w, nameInput, "Push Day");
  await sleep(200);
  check("save becomes available once edited", !!buttonWithText(doc, "Save program"));

  // Add an exercise to that day.
  click(w, buttonWithText(doc, "Add exercise"));
  await sleep(300);
  check("a new exercise is added and opened for editing", rootText(w).includes("New exercise"));

  const exName = doc.querySelector('input[placeholder="Exercise name"]');
  check("the new exercise can be named", !!exName);
  setNativeValue(w, exName, "Cable Fly");
  await sleep(200);

  // Movement pattern is what gives a user-added lift a benchmark at all.
  const patternSelect = [...doc.querySelectorAll("select")].find((s) => s.value && s.options.length > 5);
  check("a movement pattern can be chosen for it", !!patternSelect);
  if (patternSelect) {
    setNativeValue(w, patternSelect, "push-horizontal");
    patternSelect.dispatchEvent(new w.Event("change", { bubbles: true }));
    await sleep(200);
  }

  click(w, buttonWithText(doc, "Save program"));
  await sleep(600);

  const savedHead = JSON.parse(w.localStorage.getItem("prog_v1") || "{}");
  check("the program is persisted", Array.isArray(savedHead.days) && savedHead.days.length === 4);
  check("the renamed day is stored", savedHead.days.some((d) => d.name === "Push Day"));

  const dayKey = "prog_d_" + savedHead.days[0].id;
  const savedDay = JSON.parse(w.localStorage.getItem(dayKey) || "[]");
  const added = savedDay.find((e) => e.name === "Cable Fly");
  check("days are stored one key each, per the 4096-char limit", !!w.localStorage.getItem(dayKey));
  check("the added exercise is stored", !!added);
  check("the added exercise carries rating metadata", !!added && !!added.meta && typeof added.meta.multiplier === "number");
  check("its id is not derived from its name, so renaming can't orphan its history",
    !!added && added.id !== "cable-fly",
    added ? `id was ${added.id}` : "");
  check("no console errors while editing", errs.length === 0, errs.slice(0, 3).join(" | "));
}

// ---------------------------------------------------------------- edits reach the Log tab
console.log("edited program drives logging");
{
  const { w, doc } = boot({
    seed: (win) => {
      win.localStorage.setItem("prog_v1", JSON.stringify({ version: 1, days: [{ id: "solo", name: "Solo Day", subtitle: "just one" }] }));
      win.localStorage.setItem("prog_d_solo", JSON.stringify([
        { id: "x1", name: "Zercher Whatever", muscle: "everything", target: "3 x 5", rest: 90, link: "", pattern: "squat", meta: { multiplier: 1.5, type: "weight", avg: 0.6 } },
      ]));
    },
  });
  await sleep(700);

  const text = rootText(w);
  check("the Log tab uses the saved program, not the built-in split", text.includes("Zercher Whatever"));
  check("built-in exercises are gone when the program replaces them", !text.includes("Dumbbell Bench Press"));
  check("the custom day name is shown", text.includes("Solo Day"));
}

// ---------------------------------------------------------------- substitution
console.log("substitution");
{
  const { w, doc, errs } = boot();
  await sleep(700);

  const swapBtn = buttonWithText(doc, "Swap");
  check("each exercise card offers a swap", !!swapBtn);
  click(w, swapBtn);
  await sleep(300);

  check("the swap panel says it is for today only", /for today only/i.test(rootText(w)));
  check("the swap panel says the work still counts toward the slot", /counts toward this slot/i.test(rootText(w)));

  // Swap the bench press for something not in the program at all.
  click(w, buttonWithText(doc, "Something else"));
  await sleep(250);
  const customName = doc.querySelector('input[placeholder="What are you doing instead?"]');
  check("a non-program exercise can be named", !!customName);
  setNativeValue(w, customName, "Machine Chest Press");
  await sleep(200);
  click(w, buttonWithText(doc, "Use this for today"));
  await sleep(400);

  const afterSwap = rootText(w);
  check("the card becomes the substitute", afterSwap.includes("Machine Chest Press"));
  check("the card says which lift it is standing in for",
    /Standing in for/.test(afterSwap) && afterSwap.includes("Dumbbell Bench Press"));

  // Log a set against the substitute and confirm the slot is recorded in storage.
  const kg = doc.querySelector('input[placeholder="kg"]');
  const reps = doc.querySelector('input[placeholder="reps"]');
  setNativeValue(w, kg, "40");
  setNativeValue(w, reps, "10");
  await sleep(150);
  click(w, buttonWithText(doc, "Add set"));
  await sleep(1200);

  const draft = JSON.parse(w.localStorage.getItem("draft_v1") || "{}");
  const subEntry = (draft.exercises || []).find((e) => e.name === "Machine Chest Press");
  check("the substitute is logged", !!subEntry && subEntry.sets.length === 1);
  check("it records the slot it replaced",
    !!subEntry && subEntry.substituteFor === "dumbbell-bench-press",
    subEntry ? `substituteFor was ${subEntry.substituteFor}` : "");
  check("no console errors during a swap", errs.length === 0, errs.slice(0, 3).join(" | "));
}

// ---------------------------------------------------------------- the trap
// Two identical histories, except one session swapped the bench press for an equivalent
// lift. A substitution must not be punished relative to doing the original.
console.log("substituting must not cost rating");
{
  const dates = [daysAgoISO(21), daysAgoISO(14), daysAgoISO(7), daysAgoISO(2)];

  // A full Upper A session. `benchAs` decides whether the bench slot was filled by the bench
  // press itself or by a substitute doing identical numbers.
  // The substitute carries the SAME benchmark as the bench press it replaces — which is what
  // the app now does, since the swap panel pre-selects the replaced lift's movement pattern.
  // That isolates what's under test: an equal effort in the same slot must score equally.
  // (Substituting a genuinely different movement legitimately scores differently; that's the
  // benchmark doing its job, not the slot logic failing.)
  const benchMeta = { multiplier: 1.5, type: "weight", avg: 0.18 };
  function upperA(date, benchAs) {
    const bench = benchAs === "self"
      ? { id: "dumbbell-bench-press", name: "Dumbbell Bench Press", notes: "", sets: [{ weight: 24, reps: 10 }] }
      : { id: "sub-machine-press", name: "Machine Chest Press", substituteFor: "dumbbell-bench-press", meta: benchMeta, notes: "", sets: [{ weight: 24, reps: 10 }] };
    return {
      id: "s" + date + benchAs,
      date,
      day: "Upper A",
      dayId: "upper-a",
      exercises: [
        bench,
        { id: "dumbbell-single-arm-row", name: "Dumbbell Single-Arm Row", notes: "", sets: [{ weight: 26, reps: 10 }] },
        { id: "dumbbell-overhead-press", name: "Dumbbell Overhead Press", notes: "", sets: [{ weight: 14, reps: 10 }] },
      ],
    };
  }

  // A three-exercise program containing exactly what these sessions log. The default 22-slot
  // split would work too, but one lift out of 22 moves the rating by well under a point —
  // deliberately, since §6 says skipping should slow progress, not punish it — which is too
  // small to measure. Shrinking the program makes the effect observable without changing it.
  function seedProgram(win) {
    win.localStorage.setItem("prog_v1", JSON.stringify({ version: 1, days: [{ id: "upper-a", name: "Upper A", subtitle: "" }] }));
    win.localStorage.setItem("prog_d_upper-a", JSON.stringify([
      { id: "dumbbell-bench-press", name: "Dumbbell Bench Press", muscle: "", target: "3 x 8-12", rest: 90, link: "", pattern: "push-horizontal", meta: benchMeta },
      { id: "dumbbell-single-arm-row", name: "Dumbbell Single-Arm Row", muscle: "", target: "3 x 10-12", rest: 90, link: "", pattern: "pull-horizontal", meta: { multiplier: 1.5, type: "weight", avg: 0.21 } },
      { id: "dumbbell-overhead-press", name: "Dumbbell Overhead Press", muscle: "", target: "3 x 8-12", rest: 90, link: "", pattern: "push-vertical", meta: { multiplier: 1.5, type: "weight", avg: 0.12 } },
    ]));
  }

  function ratingFor(benchOnLast) {
    const sessions = [
      upperA(dates[0], "self"),
      upperA(dates[1], "self"),
      upperA(dates[2], "self"),
      upperA(dates[3], benchOnLast),
    ];
    const { w } = boot({
      seed: (win) => {
        seedProgram(win);
        win.localStorage.setItem("sess_index", JSON.stringify(sessions.map((s) => s.id)));
        sessions.forEach((s) => win.localStorage.setItem("sess_" + s.id, JSON.stringify(s)));
      },
    });
    return { w, sessions };
  }

  const a = ratingFor("self");
  await sleep(700);
  click(a.w, buttonWithText(a.w.document, "Progress"));
  await sleep(500);
  const ratingDoingOriginal = ratingFrom(rootText(a.w));

  const b = ratingFor("substitute");
  await sleep(700);
  click(b.w, buttonWithText(b.w.document, "Progress"));
  await sleep(500);
  const ratingDoingSubstitute = ratingFrom(rootText(b.w));

  check("both histories produce a rating", ratingDoingOriginal !== null && ratingDoingSubstitute !== null,
    `original=${ratingDoingOriginal} substitute=${ratingDoingSubstitute}`);
  check(
    "swapping a lift costs nothing versus doing the original",
    ratingDoingOriginal === ratingDoingSubstitute,
    `doing the original gave ${ratingDoingOriginal}, substituting gave ${ratingDoingSubstitute} — ` +
      "the replaced slot is being treated as untouched, which punishes training correctly"
  );

  // And the control: genuinely skipping the lift SHOULD cost something, otherwise the
  // substitution credit has just disabled the decay rule altogether.
  const dropBench = (s, tag) => { s.exercises = s.exercises.slice(1); s.id = "skip" + tag; return s; };
  const skipped = [
    upperA(dates[0], "self"),
    upperA(dates[1], "self"),
    dropBench(upperA(dates[2], "self"), "a"),
    dropBench(upperA(dates[3], "self"), "b"),
  ];
  const c = boot({
    seed: (win) => {
      seedProgram(win);
      win.localStorage.setItem("sess_index", JSON.stringify(skipped.map((s) => s.id)));
      skipped.forEach((s) => win.localStorage.setItem("sess_" + s.id, JSON.stringify(s)));
    },
  });
  await sleep(700);
  click(c.w, buttonWithText(c.w.document, "Progress"));
  await sleep(500);
  const ratingSkipping = ratingFrom(rootText(c.w));
  check(
    "actually skipping the lift still costs something",
    ratingSkipping !== null && ratingSkipping < ratingDoingSubstitute,
    `skipping gave ${ratingSkipping}, substituting gave ${ratingDoingSubstitute}`
  );
}

// ---------------------------------------------------------------- history survives a rename
console.log("renaming keeps history");
{
  const sess = {
    id: "r1",
    date: daysAgoISO(3),
    day: "Upper A",
    dayId: "upper-a",
    exercises: [{ id: "dumbbell-bench-press", name: "Dumbbell Bench Press", notes: "", sets: [{ weight: 24, reps: 10 }] }],
  };
  const { w, doc } = boot({
    seed: (win) => {
      // Same id, different display name — as if the exercise had been renamed in the editor.
      win.localStorage.setItem("prog_v1", JSON.stringify({ version: 1, days: [{ id: "upper-a", name: "Upper A", subtitle: "" }] }));
      win.localStorage.setItem("prog_d_upper-a", JSON.stringify([
        { id: "dumbbell-bench-press", name: "Flat DB Press (renamed)", muscle: "chest", target: "3 x 8-12", rest: 90, link: "", pattern: "push-horizontal", meta: { multiplier: 1.5, type: "weight", avg: 0.18 } },
      ]));
      win.localStorage.setItem("sess_index", JSON.stringify([sess.id]));
      win.localStorage.setItem("sess_" + sess.id, JSON.stringify(sess));
    },
  });
  await sleep(700);

  click(w, buttonWithText(doc, "Start Workout"));
  await sleep(400);
  const coached = rootText(w);
  check("the coach still finds history after a rename",
    coached.includes("24kg") && !coached.includes("No history yet"),
    "renaming detached the exercise from its own history");
}

finish("program");
