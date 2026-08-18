// Russian end to end, through the real UI.
//
// tests/test-i18n.mjs checks the dictionary in isolation, which cannot catch the failures
// that actually reach a phone: a screen still rendering English because its component never
// called t(), or a Cyrillic exercise name losing its identity somewhere between the input and
// storage. This drives the built bundle to check both.

import {
  BUNDLE, makeDom, sleep, buttonWithText, click, setNativeValue, rootText, check, finish,
} from "./dom.mjs";

function boot({ lang = "ru", profile = { heightCm: 186, weightKg: 76, displayName: "Рамазан" }, extra = {} } = {}) {
  const dom = makeDom();
  const w = dom.window;
  const errs = [];
  w.console.error = (...a) => errs.push(a.join(" "));
  w.navigator.clipboard = { writeText: async () => {} };
  w.localStorage.setItem("profile", JSON.stringify(profile));
  w.localStorage.setItem("onboarded_v1", "1");
  if (lang) w.localStorage.setItem("lang_v1", lang);
  Object.entries(extra).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.eval(BUNDLE);
  return { w, doc: w.document, errs };
}

const hasCyrillic = (s) => /[а-яА-ЯёЁ]/.test(s);

// ---------------------------------------------------------------- the app in Russian
console.log("the app renders in Russian");
{
  const { w, doc, errs } = boot();
  await sleep(800);

  const text = rootText(w);
  check("the nav is translated", text.includes("Запись") && text.includes("История") && text.includes("Прогресс") && text.includes("Профиль"), text.slice(0, 200));
  check("the header tagline is translated", text.includes("Дневник тренировок"));
  check("the product name stays Latin", text.includes("Chetamba"));
  check("built-in day names follow the switch", text.includes("Верх A") || text.includes("Всё тело A"), text.slice(0, 300));
  check("no console errors rendering in Russian", errs.length === 0, errs.join("\n"));

  // Every tab, because a component that forgot its t() only shows up on its own screen.
  for (const [label, expect] of [["История", "Пока нет"], ["Прогресс", "Рейтинг"], ["Профиль", "Язык"]]) {
    click(w, buttonWithText(doc, label));
    await sleep(400);
    check(`the ${label} tab is translated`, rootText(w).includes(expect), rootText(w).slice(0, 200));
  }
}

// ---------------------------------------------------------------- the switch itself
console.log("\nthe language switch");
{
  const { w, doc } = boot({ lang: "en" });
  await sleep(800);
  check("an English user starts in English", rootText(w).includes("Training Log"));

  click(w, buttonWithText(doc, "Profile"));
  await sleep(400);
  const ruButton = buttonWithText(doc, "Русский");
  check("the Profile tab exposes a language switch", !!ruButton);

  click(w, ruButton);
  await sleep(500);
  check("flipping the switch re-renders in Russian", rootText(w).includes("Профиль"), rootText(w).slice(0, 200));
  check("the choice is persisted", w.localStorage.getItem("lang_v1") === "ru");

  // Back again — a one-way switch would strand anyone who tapped it by accident.
  click(w, buttonWithText(doc, "English"));
  await sleep(500);
  check("the switch works in both directions", rootText(w).includes("Profile"));
  check("switching back persists too", w.localStorage.getItem("lang_v1") === "en");
}

// ---------------------------------------------------------------- Cyrillic names
console.log("\nCyrillic exercise names");
{
  const { w, doc, errs } = boot();
  await sleep(800);

  // Add a one-off and give it a Russian name, the way someone at a gym actually would.
  const addButton = buttonWithText(doc, "Добавить разовое упражнение");
  check("the add-exercise button is translated", !!addButton);
  click(w, addButton);
  await sleep(400);

  const nameInput = [...doc.querySelectorAll("input")].find((i) => i.value === "Новое упражнение");
  check("a new one-off is named in Russian", !!nameInput, [...doc.querySelectorAll("input")].map((i) => i.value).join(" | "));

  setNativeValue(w, nameInput, "Жим лёжа");
  await sleep(300);

  // Scoped to this card. The default program renders six other cards, each with its own
  // identical "add set" button, and a document-wide search finds the first one — which would
  // silently log the set against the wrong exercise and make this test pass for a lie.
  const card = nameInput.closest(".rounded-xl");
  const weight = card.querySelector('input[inputmode="decimal"]');
  const reps = card.querySelector('input[inputmode="numeric"]');
  setNativeValue(w, weight, "60");
  setNativeValue(w, reps, "8");
  await sleep(300);
  click(w, buttonWithText(card, "Добавить подход"));
  await sleep(400);

  check("a Cyrillic-named exercise accepts sets", rootText(w).includes("Подх. 1"), rootText(w).slice(0, 300));
  check("the Cyrillic name survives on screen", rootText(w).includes("Жим лёжа"));
  check("no console errors with Cyrillic input", errs.length === 0, errs.join("\n"));

  click(w, buttonWithText(doc, "Сохранить тренировку"));
  await sleep(900);

  // The stored session is what the bug destroyed: ids derived from a Cyrillic name all
  // collapsed to "x", so two Russian exercises became indistinguishable in storage.
  const keys = Object.keys(w.localStorage).filter((k) => k.startsWith("sess_") && k !== "sess_index");
  check("the session was saved", keys.length > 0, Object.keys(w.localStorage).join(", "));
  const session = JSON.parse(w.localStorage.getItem(keys[0]));
  const entry = (session.exercises || []).find((e) => hasCyrillic(e.name || ""));
  check("the Cyrillic name round-trips through storage", !!entry && entry.name === "Жим лёжа", JSON.stringify(session.exercises || []));
  check("it did NOT collapse to the old 'x' id", entry && entry.id !== "x", entry && entry.id);
}

// ---------------------------------------------------------------- a Russian program
console.log("\na program with Russian day names");
{
  // Two days whose names are entirely Cyrillic. Under the old slugId both hashed to "x", so
  // exercisesByDay["x"] was written twice and the first day's exercises vanished.
  // Stored the way the app stores it: an index in prog_v1, then one key per day (the 4096-char
  // CloudStorage ceiling means a whole program can't be one blob).
  const days = [
    { id: "den-a", name: "День A", subtitle: "" },
    { id: "den-b", name: "День B", subtitle: "" },
  ];
  const { w, doc, errs } = boot({
    extra: {
      prog_v1: JSON.stringify({ version: 1, days }),
      "prog_d_den-a": JSON.stringify([{ id: "zhim", name: "Жим лёжа", muscle: "", target: "3 x 8", rest: 90, link: "", pattern: "push-horizontal" }]),
      "prog_d_den-b": JSON.stringify([{ id: "tyaga", name: "Тяга штанги", muscle: "", target: "3 x 8", rest: 90, link: "", pattern: "pull-horizontal" }]),
    },
  });
  await sleep(900);

  const text = rootText(w);
  check("both Russian days survive", text.includes("День A") && text.includes("День B"), text.slice(0, 300));
  check("the first day's exercise is shown", text.includes("Жим лёжа"), text.slice(0, 300));

  click(w, buttonWithText(doc, "День B"));
  await sleep(500);
  check("the second day has its own exercise, not the first's",
    rootText(w).includes("Тяга штанги") && !rootText(w).includes("Жим лёжа"),
    rootText(w).slice(0, 300));
  check("no console errors with a Russian program", errs.length === 0, errs.join("\n"));
}

// ---------------------------------------------------------------- the pain check
console.log("\nthe coach reads Russian pain notes");
{
  // The highest-stakes string in the app: if a Russian note about pain isn't recognised, the
  // coach falls through to its "add weight" branch and tells someone to load a lift that hurt.
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const session = {
    id: "s1",
    kind: "lift",
    date: yesterday,
    day: "Верх A",
    dayId: "upper-a",
    exercises: [{
      id: "dumbbell-bench-press",
      name: "Dumbbell Bench Press",
      pattern: "push-horizontal",
      notes: "болит правое плечо в нижней точке",
      sets: [{ weight: 30, reps: 12 }],
    }],
  };
  const { w, doc } = boot({
    extra: { sess_index: JSON.stringify(["s1"]), sess_s1: JSON.stringify(session) },
  });
  await sleep(900);

  const start = buttonWithText(doc, "Начать тренировку");
  check("the coach button is translated", !!start, rootText(w).slice(0, 200));
  click(w, start);
  await sleep(600);

  const text = rootText(w);
  check("a Russian pain note is recognised", text.includes("дискомфорт"), text.slice(0, 500));
  check("it does NOT suggest adding weight after a pain note", !/попробуйте сегодня/.test(text), text.slice(0, 500));
}

finish("russian");
