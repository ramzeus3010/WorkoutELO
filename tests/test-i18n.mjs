// i18n: dictionary parity, slugId identity, and the pain check in both languages.
//
// Buildless — imports src/i18n.js directly, the same way test-scoring.mjs imports the maths.
// The value of this suite is that a half-finished translation is invisible in jsdom (a
// missing key renders as the key, and nothing throws), so only a key-set comparison catches
// it before it reaches a phone.

import { STRINGS, LANG_IDS, t, plural, slugId, detectLang, exerciseDisplayName } from "../src/i18n.js";
import { check, finish } from "./dom.mjs";

console.log("i18n\n");

// ---------- Key parity ----------
const enKeys = Object.keys(STRINGS.en).sort();
const ruKeys = Object.keys(STRINGS.ru).sort();

const missingInRu = enKeys.filter((k) => !(k in STRINGS.ru));
const extraInRu = ruKeys.filter((k) => !(k in STRINGS.en));

check(
  "every English key has a Russian translation",
  missingInRu.length === 0,
  missingInRu.length ? `missing from ru: ${missingInRu.join(", ")}` : ""
);
check(
  "no orphaned Russian keys",
  extraInRu.length === 0,
  extraInRu.length ? `not in en: ${extraInRu.join(", ")}` : ""
);

// A key that exists but was left as the English text is the other half-finished-translation
// failure, and it looks fine in review. Proper nouns and rank names are legitimately
// identical, so they're listed rather than guessed at.
const ALLOWED_IDENTICAL = new Set([
  "tier.Bronze", "tier.Silver", "tier.Gold", "tier.Platinum", "tier.Diamond", "tier.Top 5%",
]);
// Placeholder names are stripped before the Latin-letter test: a string like "{n} {unit}" is
// legitimately identical across languages, and counting the word "unit" inside the braces as
// untranslated English text flagged it every time.
const withoutPlaceholders = (s) => String(s).replace(/\{\w+\}/g, "");
const untranslated = enKeys.filter(
  (k) =>
    !ALLOWED_IDENTICAL.has(k) &&
    STRINGS.en[k] === STRINGS.ru[k] &&
    /[a-zA-Z]{3}/.test(withoutPlaceholders(STRINGS.en[k]))
);
check(
  "no Russian value left as its English original",
  untranslated.length === 0,
  untranslated.length ? `identical: ${untranslated.join(", ")}` : ""
);

// ---------- Interpolation ----------
// A placeholder present in one language and absent in the other renders a sentence with a
// hole in it, which no type checker here would catch.
const placeholders = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(",");
const mismatched = enKeys.filter((k) => placeholders(STRINGS.en[k]) !== placeholders(STRINGS.ru[k]));
check(
  "placeholders match across languages",
  mismatched.length === 0,
  mismatched.length ? mismatched.map((k) => `${k}: en(${placeholders(STRINGS.en[k])}) ru(${placeholders(STRINGS.ru[k])})`).join("; ") : ""
);

check("t() substitutes vars", t("en", "time.daysAgo", { n: 3, unit: "days" }) === "3 days ago");
check("t() falls back to the key when unknown", t("en", "no.such.key") === "no.such.key");
check("t() falls back to English for a missing ru key", t("ru", "no.such.key") === "no.such.key");

// ---------- Length budgets for tight controls ----------
// Russian runs 10-30% longer than English, and several of these labels sit in fixed-width
// controls — a flex-1 button sharing its row with two 80px inputs, three equal-width range
// buttons, a half-width button with an icon. Overflowing text there is a CSS failure, and
// jsdom runs no CSS, so no rendering test can catch it. A character budget can.
//
// The budget is per key, measured from what actually fit on a 360px screen at the app's 18px
// base font. Raising one means re-checking that control on a real phone.
const BUDGETS = {
  "log.addSet": 18,      // flex-1 beside two 80px inputs — the tightest control in the app
  "exp.range.4w": 14,    // one of three equal-width buttons
  "exp.range.12w": 14,
  "exp.range.all": 14,
  "board.share": 16,     // half width, with an icon
  "board.addFriend": 18,
  "log.swap": 10,        // small inline button on every exercise card
  "log.form": 10,
  "nav.log": 12,         // four across the bottom nav; a fifth tab would already wrap
  "nav.history": 12,
  "nav.progress": 12,
  "nav.profile": 12,
  "log.lift": 14,        // two-across toggle
  "log.activity": 14,
  "timer.start": 10,
  "group.join": 10,      // sits beside a code input on one row
  "common.cancel": 12,
};

const overBudget = [];
Object.entries(BUDGETS).forEach(([key, max]) => {
  LANG_IDS.forEach((lang) => {
    const value = STRINGS[lang][key];
    if (value === undefined) {
      overBudget.push(`${key} [${lang}]: missing`);
    } else if (value.length > max) {
      overBudget.push(`${key} [${lang}]: ${value.length} > ${max} ("${value}")`);
    }
  });
});
check(
  "labels in fixed-width controls stay within their budget",
  overBudget.length === 0,
  overBudget.join("\n       ")
);

// ---------- Russian plurals ----------
// The rule that catches people out: 11-14 take the genitive plural despite ending in 1-4.
const day = (n) => plural("ru", n, "unit.day");
check("ru plural 1 день", day(1) === "день", day(1));
check("ru plural 2 дня", day(2) === "дня", day(2));
check("ru plural 5 дней", day(5) === "дней", day(5));
check("ru plural 11 дней (not день)", day(11) === "дней", day(11));
check("ru plural 21 день", day(21) === "день", day(21));
check("ru plural 22 дня", day(22) === "дня", day(22));
check("en plural 1/2", plural("en", 1, "unit.day") === "day" && plural("en", 2, "unit.day") === "days");

// ---------- slugId ----------
// Backwards compatibility is the whole risk here: these ids are already written into
// CloudStorage, and changing one detaches a user's history from their charts and rating.
const legacy = (name) =>
  String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";

const asciiNames = [
  "Dumbbell Bench Press", "Lat Pulldown / Pull-Up", "Single-Arm Overhead Triceps Ext.",
  "Rowing Machine (Erg)", "Upper A", "Lower B", "New exercise", "Bench / Chest Press", "",
];
const drifted = asciiNames.filter((n) => legacy(n) !== slugId(n));
check(
  "ASCII ids are byte-identical to the pre-i18n implementation",
  drifted.length === 0,
  drifted.map((n) => `${JSON.stringify(n)}: ${legacy(n)} -> ${slugId(n)}`).join("; ")
);

// The bug this replaced: every Cyrillic name collapsed to the id "x", so Russian program
// days overwrote each other and every Russian exercise shared one pattern.
const ruNames = [
  "Жим лёжа", "Приседания со штангой", "Тяга верхнего блока", "Подъём на бицепс",
  "Планка", "Жим DB", "Тяга DB", "Разгибание ног в тренажёре сидя", "Сгибание ног в тренажёре сидя",
  "Верх A", "Верх B", "Низ A", "Низ B",
];
const ruIds = ruNames.map(slugId);
check("Cyrillic names produce distinct ids", new Set(ruIds).size === ruNames.length,
  `${new Set(ruIds).size} unique of ${ruNames.length}: ${ruIds.join(", ")}`);
check("no Cyrillic name collapses to the old 'x' fallback", ruIds.every((id) => id !== "x"));
check("slugId is deterministic", slugId("Жим лёжа") === slugId("Жим лёжа"));
check("Kazakh letters are handled", slugId("Аяқ жаттығуы") !== "x" && slugId("Аяқ жаттығуы") !== slugId("Қол жаттығуы"));
check("mixed-alphabet names stay distinct", slugId("Жим DB") !== slugId("Тяга DB"));
check("ids stay within a sane length", ruIds.every((id) => id.length <= 45), ruIds.map((i) => i.length).join(","));

// ---------- Language detection ----------
check("ru detected", detectLang("ru") === "ru");
check("ru-RU detected", detectLang("ru-RU") === "ru");
check("Kazakh locale defaults to Russian", detectLang("kk") === "ru");
check("English stays English", detectLang("en-US") === "en");
check("unknown locale falls back to English", detectLang("ja") === "en");
check("missing locale falls back to English", detectLang(undefined) === "en");

// ---------- Names that follow the switch ----------
check(
  "a built-in exercise is translated",
  exerciseDisplayName("ru", "dumbbell-bench-press", "Dumbbell Bench Press") === "Жим гантелей лёжа"
);
check(
  "a user-typed name is never translated",
  exerciseDisplayName("ru", slugId("Мой жим"), "Мой жим") === "Мой жим"
);
check(
  "a user-typed English name survives the Russian switch",
  exerciseDisplayName("ru", "my-weird-lift", "My weird lift") === "My weird lift"
);

finish("i18n");
