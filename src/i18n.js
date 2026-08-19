/**
 * Chetamba — translations and non-Latin text handling.
 *
 * WHY THIS IS A SEPARATE MODULE, AND WHY IT LOOKS LIKE scoring.js
 * The app, the node test suites and the Cloudflare Worker all need the same strings. The
 * Worker answers /score with no client running, and it posts standings into a group chat —
 * so it needs the dictionary just as much as the UI does. Two copies of the strings would
 * drift, and the group board would disagree with the app in a way nobody would notice until
 * a friend screenshotted it.
 *
 * Therefore, exactly like src/scoring.js: plain ESM, no imports, no DOM, no React. That is
 * what lets esbuild, node and workerd all consume it.
 *
 * WHAT LIVES HERE
 *   1. slugId()      — exercise/day identity. Here rather than in app.jsx because its whole
 *                      problem is alphabets (see the long comment above it).
 *   2. t()           — the lookup.
 *   3. STRINGS       — the dictionary, one flat object per language.
 *
 * ADDING A STRING
 * Add it to `en` first, then `ru`. tests/test-i18n.mjs fails if the two ever disagree on
 * keys, which is the only thing that reliably catches a half-finished translation.
 */

export const LANGS = [
  { id: "en", label: "English", short: "EN" },
  { id: "ru", label: "Русский", short: "RU" },
];

export const DEFAULT_LANG = "en";
export const LANG_IDS = LANGS.map((l) => l.id);
export const isLang = (x) => LANG_IDS.indexOf(x) !== -1;

/**
 * Pick a starting language from Telegram's `user.language_code`.
 *
 * Russian is the default for the whole post-Soviet set, not just "ru": the friend group is
 * in Almaty, and a Kazakh- or Ukrainian-locale phone almost certainly wants Russian over
 * English here. This is only ever a PRE-SELECTION — the bot confirms it with two buttons and
 * the app exposes a switch, so guessing wrong costs one tap rather than stranding anyone.
 */
const RU_LOCALES = ["ru", "kk", "uk", "be", "ky", "uz", "tg", "hy", "az", "mo"];

export function detectLang(languageCode) {
  const code = String(languageCode || "").toLowerCase().split(/[-_]/)[0];
  if (RU_LOCALES.indexOf(code) !== -1) return "ru";
  return "en";
}

// ---------- Transliteration ----------
// Russian plus the Kazakh-specific letters (ә ғ қ ң ө ұ ү һ і). Lowercase only — every
// caller lowercases first. Multi-character outputs are deliberate: ж -> zh keeps "Жим" and
// "Зим" apart, which a single-letter mapping would not.
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
  ә: "ae", ғ: "gh", қ: "q", ң: "ng", ө: "oe", ұ: "u", ү: "ue", һ: "h", і: "i", ї: "yi",
  є: "ye", ґ: "g",
};

function transliterate(lower) {
  let out = "";
  for (const ch of lower) out += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
  return out;
}

// FNV-1a over code points, base36. Not cryptographic and doesn't need to be — it exists so
// two different names can never land on the same id, nothing more. Iterating with for..of
// walks code points rather than UTF-16 units, so emoji hash as one unit instead of two.
function hash36(str) {
  let h = 0x811c9dc5;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Stable id for an exercise or a program day.
 *
 * THE BUG THIS FIXES
 * The original implementation stripped everything outside [a-z0-9] and fell back to "x" when
 * nothing survived. For any Cyrillic name, nothing ever survived — "Жим лёжа", "Приседания"
 * and "Планка" all became the id "x". That is not cosmetic:
 *
 *   - exercisesByDay[slugId(dayName)] means Russian day names overwrite each other, so a
 *     program built in Russian keeps only its last day;
 *   - hydratePatterns keys history by id, so every Russian exercise would inherit one
 *     pattern and be scored as the wrong movement;
 *   - the Progress charts collapse into a single line.
 *
 * WHY THE ASCII PATH IS PRESERVED BYTE-FOR-BYTE
 * Ids are written into CloudStorage and old sessions migrate by re-deriving them on read
 * (normalizeSession). Changing what an existing name hashes to would silently detach a
 * user's history from their charts, coach and rating — the exact failure the stable-id rule
 * was introduced to prevent. So: a pure-ASCII name goes down the original code path
 * unchanged, and only a name containing a non-ASCII character takes the new one.
 *
 * WHY NOT JUST TRANSLITERATE EVERYTHING
 * Gym Russian mixes alphabets — "Жим DB", "Тяга DB". Those contain ASCII, so a "does any
 * ASCII survive" test would send both down the old path and collide them on "db" again. The
 * test is therefore "does the name contain any non-ASCII", not "is anything left after
 * stripping". The hash suffix then guarantees distinctness even when two names transliterate
 * alike; the readable prefix is there purely so ids stay debuggable.
 */
export function slugId(name) {
  const raw = String(name || "");
  const lower = raw.toLowerCase();

  if (!/[^\x00-\x7F]/.test(raw)) {
    // Pure ASCII — the original pipeline, untouched, so every id that already exists in
    // anyone's CloudStorage keeps resolving to the same thing.
    return (
      lower
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "x"
    );
  }

  const readable = transliterate(lower)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = hash36(raw);
  return readable ? `${readable}-${suffix}` : `x-${suffix}`;
}

// ---------- Lookup ----------

/**
 * t(lang, key, vars) -> string
 *
 * Falls back ru -> en -> the key itself. Returning the key rather than empty string is
 * deliberate: a missing translation shows up as `profile.weight` on screen, which is
 * obviously a bug, where an empty string just looks like a blank label nobody notices.
 *
 * Interpolation is {name}. Values are substituted verbatim — every caller is passing numbers
 * or names that are already going into a text node, and the Worker escapes separately for
 * Telegram's markdown.
 */
export function t(lang, key, vars) {
  const table = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  let s = table[key];
  if (s === undefined) s = STRINGS[DEFAULT_LANG][key];
  if (s === undefined) return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Curried form, for components that would otherwise thread `lang` through every call. */
export const translator = (lang) => (key, vars) => t(lang, key, vars);

/**
 * Plural picker for Russian, which has three forms where English has two.
 * 1 подход / 2 подхода / 5 подходов. Passing the three RU forms as one key with `|`
 * separators keeps them adjacent in the dictionary, where they're easy to check.
 */
export function plural(lang, n, key) {
  const forms = t(lang, key).split("|");
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (lang === "ru") {
    if (abs > 10 && abs < 20) return forms[2] || forms[0];
    if (last > 1 && last < 5) return forms[1] || forms[0];
    if (last === 1) return forms[0];
    return forms[2] || forms[0];
  }
  return n === 1 ? forms[0] : forms[1] || forms[0];
}

// ---------- The dictionary ----------
// Keys are namespaced by screen: nav.*, log.*, hist.*, prog.*, prof.*, onb.*, coach.*,
// pat.* (movement patterns), act.* (activities), tier.*, ex.* (built-in exercise names),
// day.* (program day names), bot.* (Telegram messages).
//
// ex.* and day.* exist because built-in exercise names follow the language switch: the
// display name is looked up by id and falls back to whatever is stored, so a name the user
// typed themselves is never touched. See exerciseDisplayName() below.

const en = {
  // -- movement patterns (labels + hints mirror src/scoring.js) --
  "pat.push-horizontal": "Horizontal push",
  "pat.push-horizontal.hint": "bench, chest press, dips",
  "pat.push-vertical": "Overhead push",
  "pat.push-vertical.hint": "shoulder press, OHP",
  "pat.pull-horizontal": "Row",
  "pat.pull-horizontal.hint": "any rowing movement",
  "pat.pull-vertical": "Pulldown / pull-up",
  "pat.pull-vertical.hint": "lats",
  "pat.squat": "Squat / leg press",
  "pat.squat.hint": "loaded knee bend",
  "pat.hinge": "Hinge",
  "pat.hinge.hint": "glutes and hamstrings",
  "pat.lunge": "Lunge / split squat",
  "pat.lunge.hint": "one leg at a time",
  "pat.isolation-upper": "Arm / shoulder isolation",
  "pat.isolation-upper.hint": "curls, raises, extensions",
  "pat.isolation-lower": "Leg isolation",
  "pat.isolation-lower.hint": "extensions, curls",
  "pat.calves": "Calves",
  "pat.calves.hint": "counted in reps",
  "pat.bodyweight-reps": "Bodyweight reps",
  "pat.bodyweight-reps.hint": "push-ups, back extensions",
  "pat.core": "Core hold",
  "pat.core.hint": "planks — logged in seconds",
  "pat.conditioning": "Conditioning",
  "pat.conditioning.hint": "rowing, bike — logged in seconds",

  // -- activities --
  "act.basketball": "Basketball",
  "act.football": "Football",
  "act.running": "Running",
  "act.cycling": "Cycling",
  "act.swimming": "Swimming",
  "act.hiking": "Hiking",
  "act.climbing": "Climbing",
  "act.tennis": "Tennis / padel",
  "act.martial-arts": "Martial arts",
  "act.walking": "Walking",
  "act.other": "Other activity",

  // -- tiers --
  "tier.Bronze": "Bronze",
  "tier.Silver": "Silver",
  "tier.Gold": "Gold",
  "tier.Platinum": "Platinum",
  "tier.Diamond": "Diamond",
  "tier.Top 5%": "Top 5%",

  // -- chrome --
  "app.tagline": "Training Log",
  "app.loading": "Loading log…",
  "nav.log": "Log",
  "nav.history": "History",
  "nav.progress": "Progress",
  "nav.profile": "Profile",
  "err.profileSave": "Couldn't save profile. Try again.",
  "err.dayTooBig": "\"{day}\" has too much in it to store. Shorten some names or notes, or split it across two days.",
  "err.writeFailed": "Storage write failed.",
  "err.programIndex": "Couldn't save the program index.",
  "err.sessionTooBig": "This session is too large to store (too many sets/notes). Try shorter notes.",
  "err.sessionIndex": "Couldn't update the session index.",

  // -- units and time --
  "unit.day": "day|days",
  "unit.rep": "rep|reps",
  "unit.set": "set|sets",
  "unit.session": "session|sessions",
  "unit.secondsShort": "{n}s",
  "time.today": "today",
  "time.yesterday": "yesterday",
  "time.daysAgo": "{n} {unit} ago",

  // -- onboarding --
  "onb.welcome": "Welcome to Chetamba",
  "onb.sub": "Two things and you're in.",
  "onb.name": "Name on the leaderboard",
  "onb.namePlaceholder": "Your name",
  "onb.weight": "Bodyweight (kg)",
  "onb.height": "Height (cm, optional)",
  "onb.whyWeight": "Your score is strength relative to your bodyweight, so it can't be worked out without this. You can change it any time — it re-scores your whole history, not just what comes after.",
  "onb.continue": "Continue",
  "onb.pickProgram": "Pick a starting program",
  "onb.pickProgramSub": "Edit it later, or ignore it entirely — your program is a checklist, not what you're scored against.",
  "onb.skip": "Skip — I'll log as I go",
  "onb.skipHint": "Uses the Ad-hoc day: add whatever you did, whenever you did it.",

  // -- program templates --
  "tpl.full-body-3": "Full body, 3 days",
  "tpl.full-body-3.blurb": "The safest default if you're unsure. Every pattern, three times a week.",
  "tpl.upper-lower-4": "Upper / lower, 4 days",
  "tpl.upper-lower-4.blurb": "More volume per muscle. Legs are built into two of the four days on purpose.",
  "tpl.dumbbells-home": "Dumbbells only, 3 days",
  "tpl.dumbbells-home.blurb": "No machines, no barbell. For training at home or a small building gym.",

  // -- rest timer --
  "timer.quickTitle": "Quick Rest Timer",
  "timer.quick": "Quick timer",
  "timer.start": "Start",
  "timer.done": "Rest done — go",
  "timer.resting": "Resting · {label}",

  // -- coach --
  "coach.title": "Coach",
  "coach.start": "Start Workout — check last session",
  "coach.perExercise": "Per-exercise notes below, on each exercise card.",
  "coach.noHistory": "No history yet — pick a weight you can control for all reps.",
  "coach.swapped": "Last time you swapped in {sub} here, so there's no recent number for this lift. Start from what you remember and stay conservative.",
  "coach.pain": "Your last note flagged discomfort here — drop the weight, focus on form, and stop if it recurs.",
  "coach.beatIt": "Last time: {amount}. Aim to beat it by a little.",
  "coach.addWeight": "Hit the top of the range at {was}kg — try {next}kg today.",
  "coach.drops": "You went to failure with drops at {weight}kg — repeat that weight and aim for cleaner reps.",
  "coach.addReps": "Stay at {weight}kg and try to add a rep or two.",
  "coach.firstDay": "First {day} on record — log honestly today so the next one has something to build on.",
  "coach.trainedRecently": "You trained {when} already — if anything feels heavy, back off rather than grinding.",
  "coach.longGap": "It's been {days} {unit} since your last {day} — start lighter than you think and rebuild.",
  "coach.recentGap": "Last {day} was {days} {unit} ago. Beat it by a small margin, not a big one.",

  // -- built-in and template exercise names --
  "ex.dumbbell-bench-press": "Dumbbell Bench Press",
  "ex.dumbbell-single-arm-row": "Dumbbell Single-Arm Row",
  "ex.dumbbell-overhead-press": "Dumbbell Overhead Press",
  "ex.dumbbell-lateral-raise": "Dumbbell Lateral Raise",
  "ex.dumbbell-curl": "Dumbbell Curl",
  "ex.triceps-extension": "Triceps Extension",
  "ex.machine-leg-press": "Machine Leg Press",
  "ex.dumbbell-walking-lunge": "Dumbbell Walking Lunge",
  "ex.machine-leg-extension": "Machine Leg Extension",
  "ex.standing-calf-raise": "Standing Calf Raise",
  "ex.rowing-machine-erg": "Rowing Machine (Erg)",
  "ex.forearm-plank": "Forearm Plank",
  "ex.dumbbell-incline-bench-press": "Dumbbell Incline Bench Press",
  "ex.lat-pulldown-pull-up": "Lat Pulldown / Pull-Up",
  "ex.dumbbell-rear-delt-fly": "Dumbbell Rear Delt Fly",
  "ex.dumbbell-hammer-curl": "Dumbbell Hammer Curl",
  "ex.single-arm-overhead-triceps-ext": "Single-Arm Overhead Triceps Ext.",
  "ex.dumbbell-goblet-split-squat": "Dumbbell Goblet Split Squat",
  "ex.dumbbell-hip-thrust": "Dumbbell Hip Thrust",
  "ex.back-extension": "Back Extension",
  "ex.calf-raise": "Calf Raise",
  "ex.side-plank": "Side Plank",
  "ex.bench-chest-press": "Bench / Chest Press",
  "ex.row": "Row",
  "ex.squat-leg-press": "Squat / Leg Press",
  "ex.plank": "Plank",
  "ex.overhead-press": "Overhead Press",
  "ex.pulldown-pull-up": "Pulldown / Pull-Up",
  "ex.split-squat": "Split Squat",
  "ex.curl": "Curl",
  "ex.incline-press": "Incline Press",
  "ex.hip-hinge": "Hip Hinge",
  "ex.leg-extension": "Leg Extension",
  "ex.lateral-raise": "Lateral Raise",
  "ex.walking-lunge": "Walking Lunge",
  "ex.single-arm-row": "Single-Arm Row",
  "ex.goblet-squat": "Goblet Squat",

  // -- program day names --
  "day.upper-a": "Upper A",
  "day.upper-a.subtitle": "Push focus — chest, shoulders, triceps, back, biceps",
  "day.lower-a": "Lower A",
  "day.lower-a.subtitle": "Legs + conditioning — quads, glutes, hamstrings, calves, core",
  "day.upper-b": "Upper B",
  "day.upper-b.subtitle": "Pull focus — upper chest, back, rear delts, arms",
  "day.lower-b": "Lower B",
  "day.lower-b.subtitle": "Legs + posterior chain — quads, glutes, lower back, calves",
  "day.full-a": "Full A",
  "day.full-b": "Full B",
  "day.full-c": "Full C",
  "day.push": "Push",
  "day.pull": "Pull",
  "day.legs": "Legs",
  "day.adhoc": "Ad-hoc",
  "day.adhoc.subtitle": "Anything you did today — add exercises as you go.",

  // -- more units --
  "unit.kg": "kg",
  "unit.cm": "cm",
  "unit.exercise": "exercise|exercises",
  "unit.dayCount": "day|days",
  "common.cancel": "Cancel",

  // -- log screen --
  "log.lift": "Lift",
  "log.activity": "Activity",
  "log.date": "Date",
  "log.save": "Save Workout",
  "log.saved": "Saved",
  "log.swap": "Swap",
  "log.form": "Form",
  "log.target": "target",
  "log.notes": "Notes",
  "log.notesPlaceholder": "e.g. seat height 4, felt it in shoulders not back…",
  "log.exerciseName": "Exercise name",
  "log.newExercise": "New exercise",
  "log.repsShort": "reps",
  "log.setN": "Set {n}",
  "log.addSet": "Add set + rest",
  "log.addDrop": "Add drop",
  "log.addDropSet": "Add a drop set",
  "log.removeDrop": "Tap to remove this drop",
  "log.restTimer": "Rest timer:",
  "log.startRestNow": "Start rest timer now",
  "log.next": "Next",
  "log.recordSet": "Record the set",
  "log.weightInKg": "weight in kg",
  "log.addOneOff": "Add a one-off exercise",
  "log.oneOffHint": "One-offs count toward your rating like anything else — pick their movement pattern on the card so it knows how to score them. To swap a lift for today, use Swap on its card.",
  "log.patternLabel": "Movement pattern — how this gets scored",
  "log.standingInFor": "Standing in for",
  "log.anotherLift": "another lift",
  "log.countsToSlot": "today. It counts toward that slot.",

  // -- activities --
  "act.explain": "Counts toward showing up, not toward strength — there's no load to measure in a pickup game.",
  "act.minutes": "Minutes",
  "act.record": "Record activity",
  "act.worth": "Worth",
  "act.worthSuffix": "effort this week.",
  "act.worthSuffixNearCap": "effort this week — near the most this activity can be worth, so extra time adds little.",

  // -- swap --
  "swap.explain": "Swap this lift for today only. Your program isn't changed, and the work still counts toward this slot.",
  "swap.willClear": "The {n} {unit} already logged here belong to the current exercise and will be cleared.",
  "swap.fromProgram": "From my program",
  "swap.somethingElse": "Something else",
  "swap.search": "Search your exercises…",
  "swap.noMatch": "Nothing matches.",
  "swap.original": "the original for this slot",
  "swap.customPlaceholder": "What are you doing instead?",
  "swap.patternHint": "Closest movement pattern — this is how it gets scored. Pre-set to match the lift you're replacing; change it only if this is a genuinely different movement.",
  "swap.useToday": "Use this for today",

  // -- keyboard accessory --
  "kb.done": "Done",

  // -- history --
  "hist.empty": "No sessions logged yet.",
  "hist.emptyHint": "Log a workout and it'll show up here.",
  "hist.minutes": "{n} min",
  "hist.effortValue": "{n} effort",
  "hist.exerciseCount": "{n} {unit}",
  "hist.setCount": "{n} {unit}",
  "hist.deleteActivity": "Delete activity",
  "hist.deleteSession": "Delete session",

  // -- profile --
  "prof.language": "Language",
  "prof.weightExplain": "Your rating on the Progress tab is calculated relative to your current bodyweight. Update this anytime you cut, bulk, or just want your numbers re-contextualized — your whole rating history recalculates against the new figure, not just future sessions.",
  "prof.height": "Height (cm)",
  "prof.weight": "Weight (kg)",
  "prof.displayName": "Display name (for the leaderboard)",
  "prof.displayNamePlaceholder": "e.g. Ramazan",
  "prof.save": "Save Profile",
  "prof.program": "Program",
  "prof.programSummary": "{days} {dayUnit}, {exercises} {exerciseUnit}. Add your own lifts, change the days, or start from scratch.",
  "prof.editProgram": "Edit program",
  "prof.privacy": "Everything here stays on your own Telegram account — nothing is uploaded and there is no server. Your display name and rating only leave this device if you tap \"Share my score\" on the Progress tab, which puts a single line into a chat you choose. Your sets, notes and bodyweight are never in that line.",

  // -- group relay --
  "group.title": "Group leaderboard",
  "group.yourGroup": "your group",
  "group.join": "Join",
  "group.joinFailed": "Couldn't join. Check the code and try again.",
  "group.postingTo": "Posting to",
  "group.postingHint": "Finish a workout and the bot announces it. Type",
  "group.postingHint2": "in the chat for standings.",
  "group.runRegister1": "Run",
  "group.runRegister2": "in your group chat, then paste the code here. Only your name and scores are shared — never your sets or notes.",

  // -- program editor --
  "prog.back": "Back to Profile",
  "prog.title": "Your program",
  "prog.explain": "Changes here apply to every future workout. To change just today's session — a busy machine, say — use Swap on the exercise card in the Log tab instead.",
  "prog.dayN": "Day {n}",
  "prog.dayName": "Day name",
  "prog.dayDescription": "Short description (optional)",
  "prog.deleteDay": "Delete this day",
  "prog.needOneDay": "A program needs at least one day",
  "prog.noExercises": "No exercises on this day yet.",
  "prog.addExercise": "Add exercise",
  "prog.addDay": "Add a day",
  "prog.save": "Save program",
  "prog.noChanges": "No changes",
  "prog.noTarget": "no target",
  "prog.muscles": "Muscles worked (optional)",
  "prog.restSeconds": "rest s",
  "prog.formLink": "Form video link (optional)",
  "prog.patternNote": "Movement pattern — the rating has no benchmark for a lift it's never seen, so it borrows the pattern's. Rough family averages, not measurements of this exercise.",
  "prog.builtInNote": "This is one of the built-in lifts. Changing its pattern overrides the benchmark it shipped with.",
  "prog.ratingNote": "Your rating is calculated across the exercises in this program. Removing one stops it counting against you; adding one starts it counting as untrained until you log it. Past sessions are kept either way.",
  "prog.confirmRestore": "Yes, restore the default",
  "prog.restore": "Restore the built-in 4-day split",

  // -- progress tab --
  "prog.rating": "Rating",
  "prog.needWeight": "Add your weight in the Profile tab to unlock your rating.",
  "prog.logFirst": "Log your first session to get your starting rating.",
  "prog.toNextTier": "{n} to {tier}",
  "prog.readyForTier": "Ready for {tier}",
  "prog.staleCount": "{n} {unit} untouched or fading — training them keeps your climb faster.",
  "prog.benchmarkCaveat": "Benchmarks are directional estimates derived from barbell standards — no published dumbbell strength database exists. Treat this as a game score, not a clinical measure.",
  "prog.noData": "No exercise data yet.",
  "prog.noDataHint": "Log a few sessions to see trends.",
  "prog.topSet": "kg top set",
  "prog.sinceFirst": "{delta}kg since first log",
  "prog.sessionLog": "Session log",

  // -- shareable score card --
  "board.title": "Leaderboard",
  "board.needName": "Set a display name in the Profile tab to join.",
  "board.you": "(you)",
  "board.share": "Share my score",
  "board.copied": "Copied!",
  "board.addFriend": "Add friend's score",
  "board.pastePlaceholder": "Paste their GAINS|... line here",
  "board.addToBoard": "Add to leaderboard",
  "board.badCard": "That doesn't look like a score card — paste the whole GAINS|... line.",
  "board.ownCard": "That's your own card.",
  "board.snapshotNote": "Scores update only when you each re-share — it's a snapshot, not a live feed.",

  // -- export --
  "exp.panelTitle": "Export",
  "exp.panelExplain": "Copy your training out to review it somewhere else, or to keep a backup. Telegram's storage is the only copy of this data.",
  "exp.range.4w": "Last 4 weeks",
  "exp.range.12w": "Last 3 months",
  "exp.range.all": "Everything",
  "exp.inRange": "{n} {unit} in range",
  "exp.copyMd": "Copy for review",
  "exp.copiedMd": "Copied — paste it into the chat",
  "exp.copyJson": "Copy backup (JSON)",
  "exp.copiedJson": "Backup copied",
  "exp.clipboardFailed": "Couldn't reach the clipboard here — select all of this and copy it manually.",
  "exp.footnote": "\"Copy for review\" is readable text meant for a person or a chat. \"Copy backup\" is the raw data — keep that one somewhere safe.",
  "exp.title": "Chetamba training export",
  "exp.exported": "Exported",
  "exp.range": "Range",
  "exp.athlete": "Athlete",
  "exp.body": "Body",
  "exp.rating": "Rating",
  "exp.seeCaveat": "see the caveat at the bottom",
  "exp.noSessions": "No sessions in this range.",
  "exp.frequency": "Frequency: {perWeek} sessions/week across {days} days",
  "exp.dayBalance": "Day balance",
  "exp.daysNotInProgram": "Days no longer in the program",
  "exp.currentProgram": "Current program",
  "exp.flagged": "Flagged as painful or uncomfortable",
  "exp.flaggedNote": "These came from the athlete's own notes. Treat them as constraints, not as things to push through.",
  "exp.sessions": "Sessions (newest first)",
  "exp.repsAreSeconds": "reps column is seconds",
  "exp.swappedInFor": "swapped in for {slot} that day",
  "exp.noSets": "no sets logged",
  "exp.note": "note",
  // -- AI program generation --
  // ai.err* are returned BY THE WORKER as keys rather than prose, so the message renders in
  // whatever language the app is set to rather than whatever the Worker guessed.
  "ai.open": "Write a program for me",
  "ai.title": "Describe your program",
  "ai.explain": "Say what you want in plain words — how many days, what equipment you have, what you're training for, and anything you can't or won't do.",
  "ai.placeholder": "e.g. 3 days a week, dumbbells and a pull-up bar only, want visible upper body. Bad lower back — nothing that loads it directly.",
  "ai.generate": "Generate",
  "ai.working": "Writing…",
  "ai.slowNote": "Takes up to a minute.",
  "ai.excluded": "Left out, as you asked",
  "ai.reviewNote": "Loaded into the editor as an unsaved change — check it over and press Save program to keep it.",
  "ai.use": "Use this",
  "ai.tryAgain": "Try again",
  "ai.errNetwork": "Couldn't reach the server. Check your connection and try again.",
  "ai.errNotConfigured": "Program generation isn't switched on yet.",
  "ai.errTooShort": "Add a bit more detail — how many days, what equipment, what you're after.",
  "ai.errRateLimited": "You've hit today's limit for generated programs. Try again tomorrow.",
  "ai.errUpstream": "The program writer is unavailable right now. Try again in a moment.",
  "ai.errBusy": "Too many requests at once. Wait a moment and try again.",
  "ai.errRefused": "That request was declined. Try describing the training itself.",
  "ai.errShape": "Got something unreadable back. Try again.",
  "ai.errNoDays": "Came back empty. Try describing it again.",
  "ai.errEmptyDay": "One of the days came back empty. Try again.",
  "ai.errTooManyDays": "That's more days than the app supports. Ask for seven or fewer.",
  "ai.errTooManyExercises": "One day came back with too many exercises. Try asking for something shorter.",
  "ai.errPattern": "One exercise couldn't be scored. Try again.",
  "ai.errExcluded": "It included something you asked to avoid, so it was thrown away. Try again.",
  "ai.errTooBig": "That program is too large to store. Ask for something shorter.",

  // -- the Telegram bot --
  // These carry Telegram's legacy-Markdown syntax (*bold*, _italic_, `code`). Keep the
  // markers in both languages: a stray unmatched * makes Telegram reject the whole message
  // rather than send it plain, so an unbalanced translation is a silent outage.
  "bot.openButton": "🏋️ Open Chetamba",
  "bot.welcome": [
    "*Chetamba* — your training log.",
    "",
    "Four-day upper/lower split, a rest timer you can read from across the gym, and a rating that",
    "tracks whether you're actually getting stronger for your bodyweight.",
    "",
    "Everything is stored on your own Telegram account. No sign-up, no server, no ads.",
    "",
    "Tap below to open it. It picks up exactly where you left off — even mid-set.",
  ].join("\n"),
  "bot.help": [
    "*How it works*",
    "",
    "• *Log* — pick the day, enter weight × reps, hit Record. Sets save as you go, so closing",
    "  the app mid-workout never loses anything.",
    "• *History* — every past session.",
    "• *Progress* — your rating, tier, and per-exercise charts.",
    "• *Profile* — bodyweight (the rating is relative to it), *language*, and *Export*, for",
    "  pulling your whole history out to review or back up.",
    "",
    "Commands: /start · /app · /help · /language",
  ].join("\n"),
  "bot.unknownCommand": "Not a command I know. /start opens the app, /help explains it.",
  "bot.langAsk": "Which language should I use?",
  "bot.langSet": "Done — I'll speak English. You can change it again with /language, or in the app under Profile.",
  "bot.groupLangAsk": "Which language should this board post in?",
  "bot.groupLangSet": "This board now posts in English.",
  "bot.registerInGroup": "Run /register inside the group chat you want to compete in.",
  "bot.registered": [
    "*This chat is now a leaderboard.*",
    "",
    "Open Chetamba → Profile → Join group, and paste: `{code}`",
    "",
    "_Code works for 7 days. Run /register again for a fresh one._",
  ].join("\n"),
  "bot.badCode": "That code isn't valid. Ask for a fresh one with /register in the group.",
  "bot.joinedBoard": "*{name}* joined the board.",
  "bot.notOnBoard": "You're not on a board yet. Run /register in your group chat to start one.",
  "bot.emptyBoard": "Nobody has joined the board yet. Run /register here, then paste the code into the app.",
  "bot.standingsTitle": "🏆 Standings",
  "bot.finalHours": "⏳ Final hours of the week",
  "bot.newWeek": "*New week.* Effort is back to zero for everyone.",
  "bot.lastWeekWinner": "Last week: 🥇 *{name}* on {total}.",
  "bot.finishedLift": "🏋️ *{name}* finished {label}",
  "bot.finishedActivity": "🏃 *{name}* — {label}, {minutes} min",
  "bot.aWorkout": "a workout",
  "bot.anActivity": "an activity",
  // Column headers for the standings table. These sit inside a fixed-width block, so keep
  // them SHORT — anything past ~7 characters pushes the columns off a narrow phone screen.
  // "Rating" deliberately matches what the app's Progress tab calls the same number; the bot
  // used to call it "Strength", which read as a second, different score.
  "bot.colName": "Athlete",
  "bot.colRating": "Rating",
  "bot.colWeek": "Week",
  "bot.rankedBy": "_Ranked on 40% rating + 60% this week's effort._",
  "bot.weekOf": "_week of {date} · effort resets Monday_",
  "bot.asOf": "_Scores are as of each person's last logged workout._",
  "bot.groupFallback": "the group",
  "bot.thisGroup": "this group",

  "exp.howToRead": "How to read this",
  "exp.legend": [
    "- Weights are per dumbbell/machine as entered, in kg. `20kg×12` is 20 kg for 12 reps.",
    "- `→` marks a drop set: the athlete went to failure and immediately continued lighter.",
    "- Duration work (planks, rowing) is logged as **seconds in the reps field** — a known rough edge.",
    "- The rating is a bodyweight-relative score. There is no published strength-standard",
    "  database for dumbbell lifts, so its benchmarks are directional estimates derived from",
    "  barbell standards.",
    "- It is a game score, not a clinical measure — don't reason about health from it.",
    "- Sessions are only what was logged. An absent exercise may have been skipped or just not recorded.",
  ].join("\n"),
};

const ru = {
  // -- movement patterns --
  "pat.push-horizontal": "Горизонтальный жим",
  "pat.push-horizontal.hint": "жим лёжа, жим от груди, брусья",
  "pat.push-vertical": "Жим над головой",
  "pat.push-vertical.hint": "жим стоя, армейский жим",
  "pat.pull-horizontal": "Тяга",
  "pat.pull-horizontal.hint": "любая тяга к корпусу",
  "pat.pull-vertical": "Тяга сверху / подтягивания",
  "pat.pull-vertical.hint": "широчайшие",
  "pat.squat": "Присед / жим ногами",
  "pat.squat.hint": "сгибание колена с весом",
  "pat.hinge": "Наклон / шарнир",
  "pat.hinge.hint": "ягодицы и бицепс бедра",
  "pat.lunge": "Выпад / болгарский присед",
  "pat.lunge.hint": "на одну ногу",
  "pat.isolation-upper": "Изоляция рук / плеч",
  "pat.isolation-upper.hint": "сгибания, разведения, разгибания",
  "pat.isolation-lower": "Изоляция ног",
  "pat.isolation-lower.hint": "разгибания, сгибания",
  "pat.calves": "Икры",
  "pat.calves.hint": "считаются в повторениях",
  "pat.bodyweight-reps": "Повторения со своим весом",
  "pat.bodyweight-reps.hint": "отжимания, гиперэкстензия",
  "pat.core": "Статика на корпус",
  "pat.core.hint": "планка — записывается в секундах",
  "pat.conditioning": "Кардио",
  "pat.conditioning.hint": "гребля, велотренажёр — в секундах",

  // -- activities --
  "act.basketball": "Баскетбол",
  "act.football": "Футбол",
  "act.running": "Бег",
  "act.cycling": "Велосипед",
  "act.swimming": "Плавание",
  "act.hiking": "Поход",
  "act.climbing": "Скалолазание",
  "act.tennis": "Теннис / падел",
  "act.martial-arts": "Единоборства",
  "act.walking": "Ходьба",
  "act.other": "Другая активность",

  // -- tiers --
  // Left in English on purpose: these are game-rank names, they're what the group chat says
  // out loud, and "Золото" reads like a translation of a rank rather than the rank itself.
  "tier.Bronze": "Bronze",
  "tier.Silver": "Silver",
  "tier.Gold": "Gold",
  "tier.Platinum": "Platinum",
  "tier.Diamond": "Diamond",
  "tier.Top 5%": "Top 5%",

  // -- chrome --
  "app.tagline": "Дневник тренировок",
  "app.loading": "Загрузка…",
  "nav.log": "Запись",
  "nav.history": "История",
  "nav.progress": "Прогресс",
  "nav.profile": "Профиль",
  "err.profileSave": "Не удалось сохранить профиль. Попробуйте ещё раз.",
  "err.dayTooBig": "В дне «{day}» слишком много всего. Сократите названия или заметки либо разбейте его на два дня.",
  "err.writeFailed": "Не удалось записать в хранилище.",
  "err.programIndex": "Не удалось сохранить индекс программы.",
  "err.sessionTooBig": "Эта тренировка слишком большая для хранилища (слишком много подходов или заметок). Попробуйте сократить заметки.",
  "err.sessionIndex": "Не удалось обновить индекс тренировок.",

  // -- units and time --
  // Three forms each: 1 день / 2 дня / 5 дней. plural() picks between them.
  "unit.day": "день|дня|дней",
  "unit.rep": "повтор|повтора|повторов",
  "unit.set": "подход|подхода|подходов",
  "unit.session": "тренировка|тренировки|тренировок",
  "unit.secondsShort": "{n} с",
  "time.today": "сегодня",
  "time.yesterday": "вчера",
  "time.daysAgo": "{n} {unit} назад",

  // -- onboarding --
  "onb.welcome": "Добро пожаловать в Chetamba",
  "onb.sub": "Две вещи — и можно начинать.",
  "onb.name": "Имя в таблице лидеров",
  "onb.namePlaceholder": "Ваше имя",
  "onb.weight": "Вес тела (кг)",
  "onb.height": "Рост (см, необязательно)",
  "onb.whyWeight": "Ваш рейтинг — это сила относительно веса тела, без него его невозможно посчитать. Вес можно изменить в любой момент: пересчитается вся история, а не только новые тренировки.",
  "onb.continue": "Продолжить",
  "onb.pickProgram": "Выберите программу",
  "onb.pickProgramSub": "Её можно изменить позже или вообще не использовать — программа это чек-лист, а не то, по чему вас оценивают.",
  "onb.skip": "Пропустить — буду записывать по ходу",
  "onb.skipHint": "Используется день «Свободный»: добавляйте что угодно и когда угодно.",

  // -- program templates --
  "tpl.full-body-3": "Всё тело, 3 дня",
  "tpl.full-body-3.blurb": "Самый безопасный вариант, если сомневаетесь. Все движения три раза в неделю.",
  "tpl.upper-lower-4": "Верх / низ, 4 дня",
  "tpl.upper-lower-4.blurb": "Больше объёма на каждую мышцу. Ноги специально стоят в двух днях из четырёх.",
  "tpl.dumbbells-home": "Только гантели, 3 дня",
  "tpl.dumbbells-home.blurb": "Без тренажёров и штанги. Для дома или небольшого зала в доме.",

  // -- rest timer --
  "timer.quickTitle": "Быстрый таймер отдыха",
  "timer.quick": "Быстрый таймер",
  "timer.start": "Старт",
  "timer.done": "Отдых окончен — вперёд",
  "timer.resting": "Отдых · {label}",

  // -- coach --
  "coach.title": "Тренер",
  "coach.start": "Начать тренировку — посмотреть прошлую",
  "coach.perExercise": "Заметки по упражнениям — ниже, на карточках.",
  "coach.noHistory": "Истории пока нет — возьмите вес, который держите во всех повторениях.",
  "coach.swapped": "В прошлый раз вы заменили это на {sub}, поэтому свежих цифр по этому упражнению нет. Начните с того, что помните, и не форсируйте.",
  "coach.pain": "В прошлой заметке вы отметили дискомфорт — снизьте вес, сосредоточьтесь на технике и прекратите, если повторится.",
  "coach.beatIt": "В прошлый раз: {amount}. Постарайтесь немного улучшить.",
  "coach.addWeight": "Вы вышли на верх диапазона с {was} кг — попробуйте сегодня {next} кг.",
  "coach.drops": "Вы дошли до отказа с дроп-сетами на {weight} кг — повторите этот вес и сделайте чище.",
  "coach.addReps": "Оставьте {weight} кг и постарайтесь добавить повтор-другой.",
  "coach.firstDay": "Первый «{day}» в истории — записывайте честно, чтобы следующему было от чего отталкиваться.",
  "coach.trainedRecently": "Вы уже тренировались {when} — если что-то идёт тяжело, лучше сбавьте, чем продавливайте.",
  "coach.longGap": "С последнего дня «{day}» прошло {days} {unit} — начните легче, чем кажется нужным.",
  "coach.recentGap": "Последний «{day}» был {days} {unit} назад. Улучшайте понемногу, а не рывком.",

  // -- built-in and template exercise names --
  "ex.dumbbell-bench-press": "Жим гантелей лёжа",
  "ex.dumbbell-single-arm-row": "Тяга гантели одной рукой",
  "ex.dumbbell-overhead-press": "Жим гантелей стоя",
  "ex.dumbbell-lateral-raise": "Разведение гантелей в стороны",
  "ex.dumbbell-curl": "Подъём гантелей на бицепс",
  "ex.triceps-extension": "Разгибание на трицепс",
  "ex.machine-leg-press": "Жим ногами в тренажёре",
  "ex.dumbbell-walking-lunge": "Выпады с гантелями в движении",
  "ex.machine-leg-extension": "Разгибание ног в тренажёре",
  "ex.standing-calf-raise": "Подъём на носки стоя",
  "ex.rowing-machine-erg": "Гребной тренажёр",
  "ex.forearm-plank": "Планка на локтях",
  "ex.dumbbell-incline-bench-press": "Жим гантелей на наклонной",
  "ex.lat-pulldown-pull-up": "Тяга верхнего блока / подтягивания",
  "ex.dumbbell-rear-delt-fly": "Разведение гантелей в наклоне",
  "ex.dumbbell-hammer-curl": "Молотковые сгибания",
  "ex.single-arm-overhead-triceps-ext": "Разгибание на трицепс одной рукой",
  "ex.dumbbell-goblet-split-squat": "Болгарский присед с гантелью",
  "ex.dumbbell-hip-thrust": "Ягодичный мост с гантелью",
  "ex.back-extension": "Гиперэкстензия",
  "ex.calf-raise": "Подъём на носки",
  "ex.side-plank": "Боковая планка",
  "ex.bench-chest-press": "Жим лёжа / жим от груди",
  "ex.row": "Тяга к поясу",
  "ex.squat-leg-press": "Присед / жим ногами",
  "ex.plank": "Планка",
  "ex.overhead-press": "Жим стоя",
  "ex.pulldown-pull-up": "Тяга сверху / подтягивания",
  "ex.split-squat": "Болгарский присед",
  "ex.curl": "Сгибание на бицепс",
  "ex.incline-press": "Жим на наклонной",
  "ex.hip-hinge": "Наклон с весом",
  "ex.leg-extension": "Разгибание ног",
  "ex.lateral-raise": "Разведение в стороны",
  "ex.walking-lunge": "Выпады в движении",
  "ex.single-arm-row": "Тяга одной рукой",
  "ex.goblet-squat": "Присед с гантелью у груди",

  // -- program day names --
  "day.upper-a": "Верх A",
  "day.upper-a.subtitle": "Акцент на жим — грудь, плечи, трицепс, спина, бицепс",
  "day.lower-a": "Низ A",
  "day.lower-a.subtitle": "Ноги + кардио — квадрицепс, ягодицы, бицепс бедра, икры, корпус",
  "day.upper-b": "Верх B",
  "day.upper-b.subtitle": "Акцент на тягу — верх груди, спина, задние дельты, руки",
  "day.lower-b": "Низ B",
  "day.lower-b.subtitle": "Ноги + задняя цепь — квадрицепс, ягодицы, поясница, икры",
  "day.full-a": "Всё тело A",
  "day.full-b": "Всё тело B",
  "day.full-c": "Всё тело C",
  "day.push": "Жимовой",
  "day.pull": "Тяговый",
  "day.legs": "Ноги",
  "day.adhoc": "Свободный",
  "day.adhoc.subtitle": "Всё, что вы сегодня делали — добавляйте упражнения по ходу.",

  // -- more units --
  "unit.kg": "кг",
  "unit.cm": "см",
  "unit.exercise": "упражнение|упражнения|упражнений",
  "unit.dayCount": "день|дня|дней",
  "common.cancel": "Отмена",

  // -- log screen --
  "log.lift": "Железо",
  "log.activity": "Активность",
  "log.date": "Дата",
  "log.save": "Сохранить тренировку",
  "log.saved": "Сохранено",
  "log.swap": "Замена",
  "log.form": "Техника",
  "log.target": "цель",
  "log.notes": "Заметки",
  "log.notesPlaceholder": "напр. высота сиденья 4, чувствовал в плечах, а не в спине…",
  "log.exerciseName": "Название упражнения",
  "log.newExercise": "Новое упражнение",
  "log.repsShort": "повт.",
  "log.setN": "Подх. {n}",
  "log.addSet": "Записать + отдых",
  "log.addDrop": "Добавить дроп",
  "log.addDropSet": "Добавить дроп-сет",
  "log.removeDrop": "Нажмите, чтобы убрать этот дроп",
  "log.restTimer": "Таймер отдыха:",
  "log.startRestNow": "Запустить отдых сейчас",
  "log.next": "Далее",
  "log.recordSet": "Записать подход",
  "log.weightInKg": "вес в кг",
  "log.addOneOff": "Добавить разовое упражнение",
  "log.oneOffHint": "Разовые упражнения идут в рейтинг наравне с остальными — выберите на карточке тип движения, чтобы их было чем оценить. Чтобы заменить упражнение на сегодня, нажмите «Замена» на его карточке.",
  "log.patternLabel": "Тип движения — как это будет оценено",
  "log.standingInFor": "Сегодня вместо",
  "log.anotherLift": "другого упражнения",
  "log.countsToSlot": ". Засчитывается в тот же слот.",

  // -- activities --
  "act.explain": "Идёт в зачёт посещаемости, но не в силу — в дворовой игре нечего измерять по весу.",
  "act.minutes": "Минуты",
  "act.record": "Записать активность",
  "act.worth": "Даёт",
  "act.worthSuffix": "очков активности на этой неделе.",
  "act.worthSuffixNearCap": "очков активности на этой неделе — почти максимум для этого занятия, лишнее время добавит мало.",

  // -- swap --
  "swap.explain": "Замена только на сегодня. Программа не меняется, а работа всё равно идёт в этот слот.",
  "swap.willClear": "{n} уже записанных {unit} относятся к текущему упражнению и будут удалены.",
  "swap.fromProgram": "Из моей программы",
  "swap.somethingElse": "Другое",
  "swap.search": "Поиск по упражнениям…",
  "swap.noMatch": "Ничего не найдено.",
  "swap.original": "исходное упражнение для этого слота",
  "swap.customPlaceholder": "Что делаете вместо этого?",
  "swap.patternHint": "Ближайший тип движения — по нему считается оценка. Уже выбран такой же, как у заменяемого упражнения; меняйте, только если движение действительно другое.",
  "swap.useToday": "Использовать сегодня",

  // -- keyboard accessory --
  "kb.done": "Готово",

  // -- history --
  "hist.empty": "Пока нет записанных тренировок.",
  "hist.emptyHint": "Запишите тренировку — она появится здесь.",
  "hist.minutes": "{n} мин",
  "hist.effortValue": "{n} очков активности",
  "hist.exerciseCount": "{n} {unit}",
  "hist.setCount": "{n} {unit}",
  "hist.deleteActivity": "Удалить активность",
  "hist.deleteSession": "Удалить тренировку",

  // -- profile --
  "prof.language": "Язык",
  "prof.weightExplain": "Рейтинг на вкладке «Прогресс» считается относительно вашего текущего веса. Обновляйте его при сушке, наборе или просто чтобы пересчитать цифры — пересчитается вся история рейтинга, а не только будущие тренировки.",
  "prof.height": "Рост (см)",
  "prof.weight": "Вес (кг)",
  "prof.displayName": "Имя для таблицы лидеров",
  "prof.displayNamePlaceholder": "напр. Рамазан",
  "prof.save": "Сохранить профиль",
  "prof.program": "Программа",
  "prof.programSummary": "{days} {dayUnit}, {exercises} {exerciseUnit}. Добавляйте свои упражнения, меняйте дни или начните с нуля.",
  "prof.editProgram": "Изменить программу",
  "prof.privacy": "Всё хранится в вашём собственном аккаунте Telegram — ничего никуда не загружается, сервера нет. Имя и рейтинг покидают устройство, только если вы нажмёте «Поделиться результатом» на вкладке «Прогресс» — это одна строка в чат, который выберете вы. Ваших подходов, заметок и веса в этой строке нет.",

  // -- group relay --
  "group.title": "Таблица лидеров группы",
  "group.yourGroup": "вашу группу",
  "group.join": "Войти",
  "group.joinFailed": "Не удалось присоединиться. Проверьте код и попробуйте снова.",
  "group.postingTo": "Публикуется в",
  "group.postingHint": "Завершите тренировку — бот объявит об этом. Напишите",
  "group.postingHint2": "в чате, чтобы увидеть таблицу.",
  "group.runRegister1": "Отправьте",
  "group.runRegister2": "в групповом чате и вставьте код сюда. Передаются только имя и очки — никогда подходы или заметки.",

  // -- program editor --
  "prog.back": "Назад в профиль",
  "prog.title": "Ваша программа",
  "prog.explain": "Изменения здесь действуют на все будущие тренировки. Чтобы поменять только сегодняшнюю — например, тренажёр занят — используйте «Замену» на карточке упражнения во вкладке «Запись».",
  "prog.dayN": "День {n}",
  "prog.dayName": "Название дня",
  "prog.dayDescription": "Краткое описание (необязательно)",
  "prog.deleteDay": "Удалить этот день",
  "prog.needOneDay": "В программе нужен хотя бы один день",
  "prog.noExercises": "В этом дне пока нет упражнений.",
  "prog.addExercise": "Добавить упражнение",
  "prog.addDay": "Добавить день",
  "prog.save": "Сохранить программу",
  "prog.noChanges": "Без изменений",
  "prog.noTarget": "без цели",
  "prog.muscles": "Рабочие мышцы (необязательно)",
  "prog.restSeconds": "отдых, с",
  "prog.formLink": "Ссылка на видео с техникой (необязательно)",
  "prog.patternNote": "Тип движения — у рейтинга нет эталона для незнакомого упражнения, поэтому он берёт эталон типа движения. Это приблизительные средние по группе, а не замеры конкретного упражнения.",
  "prog.builtInNote": "Это одно из встроенных упражнений. Смена типа движения переопределит эталон, с которым оно поставляется.",
  "prog.ratingNote": "Рейтинг считается по упражнениям из этой программы. Убрали упражнение — оно перестаёт тянуть вас вниз; добавили — оно считается нетренированным, пока вы его не запишете. Прошлые тренировки сохраняются в любом случае.",
  "prog.confirmRestore": "Да, вернуть стандартную",
  "prog.restore": "Вернуть встроенный 4-дневный сплит",

  // -- progress tab --
  "prog.rating": "Рейтинг",
  "prog.needWeight": "Укажите вес во вкладке «Профиль», чтобы открыть рейтинг.",
  "prog.logFirst": "Запишите первую тренировку, чтобы получить стартовый рейтинг.",
  "prog.toNextTier": "{n} до {tier}",
  "prog.readyForTier": "Готовы к {tier}",
  "prog.staleCount": "{n} {unit} не тренировались или теряют форму — вернитесь к ним, и рост пойдёт быстрее.",
  "prog.benchmarkCaveat": "Эталоны — это приблизительные оценки, выведенные из штанговых нормативов: опубликованной базы по гантелям не существует. Считайте это игровым счётом, а не медицинским показателем.",
  "prog.noData": "Пока нет данных по упражнениям.",
  "prog.noDataHint": "Запишите несколько тренировок, чтобы увидеть динамику.",
  "prog.topSet": "кг в лучшем подходе",
  "prog.sinceFirst": "{delta} кг с первой записи",
  "prog.sessionLog": "Журнал тренировок",

  // -- shareable score card --
  "board.title": "Таблица лидеров",
  "board.needName": "Укажите имя во вкладке «Профиль», чтобы участвовать.",
  "board.you": "(вы)",
  "board.share": "Поделиться",
  "board.copied": "Скопировано!",
  "board.addFriend": "Добавить друга",
  "board.pastePlaceholder": "Вставьте сюда их строку GAINS|...",
  "board.addToBoard": "Добавить в таблицу",
  "board.badCard": "Это не похоже на карточку результата — вставьте строку GAINS|... целиком.",
  "board.ownCard": "Это ваша собственная карточка.",
  "board.snapshotNote": "Результаты обновляются только когда вы заново обмениваетесь ими — это снимок, а не живая лента.",

  // -- export --
  "exp.panelTitle": "Экспорт",
  "exp.panelExplain": "Выгрузите тренировки, чтобы разобрать их где-то ещё или сохранить резервную копию. Хранилище Telegram — единственная копия этих данных.",
  "exp.range.4w": "4 недели",
  "exp.range.12w": "3 месяца",
  "exp.range.all": "Всё",
  "exp.inRange": "{n} {unit} в диапазоне",
  "exp.copyMd": "Скопировать для разбора",
  "exp.copiedMd": "Скопировано — вставьте в чат",
  "exp.copyJson": "Скопировать копию (JSON)",
  "exp.copiedJson": "Копия скопирована",
  "exp.clipboardFailed": "Не удалось получить доступ к буферу обмена — выделите всё это и скопируйте вручную.",
  "exp.footnote": "«Скопировать для разбора» — читаемый текст для человека или чата. «Скопировать копию» — сырые данные, храните их в надёжном месте.",
  "exp.title": "Выгрузка тренировок Chetamba",
  "exp.exported": "Выгружено",
  "exp.range": "Диапазон",
  "exp.athlete": "Спортсмен",
  "exp.body": "Тело",
  "exp.rating": "Рейтинг",
  "exp.seeCaveat": "см. оговорку внизу",
  "exp.noSessions": "В этом диапазоне нет тренировок.",
  "exp.frequency": "Частота: {perWeek} тренировок в неделю за {days} дней",
  "exp.dayBalance": "Баланс дней",
  "exp.daysNotInProgram": "Дни, которых больше нет в программе",
  "exp.currentProgram": "Текущая программа",
  "exp.flagged": "Отмечено как болезненное или неприятное",
  "exp.flaggedNote": "Это взято из собственных заметок спортсмена. Считайте это ограничениями, а не тем, что нужно перетерпеть.",
  "exp.sessions": "Тренировки (сначала новые)",
  "exp.repsAreSeconds": "в колонке повторений — секунды",
  "exp.swappedInFor": "в тот день заменяло: {slot}",
  "exp.noSets": "подходы не записаны",
  "exp.note": "заметка",
  // -- AI program generation --
  "ai.open": "Составить программу",
  "ai.title": "Опишите программу",
  "ai.explain": "Напишите обычными словами — сколько дней, какой инвентарь, к чему готовитесь и что вам нельзя или не хочется делать.",
  "ai.placeholder": "напр. 3 раза в неделю, только гантели и турник, хочу видимый верх. Больная поясница — ничего с осевой нагрузкой.",
  "ai.generate": "Составить",
  "ai.working": "Составляю…",
  "ai.slowNote": "Занимает до минуты.",
  "ai.excluded": "Исключено, как вы просили",
  "ai.reviewNote": "Загружено в редактор как несохранённое изменение — проверьте и нажмите «Сохранить программу».",
  "ai.use": "Использовать",
  "ai.tryAgain": "Ещё раз",
  "ai.errNetwork": "Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.",
  "ai.errNotConfigured": "Генерация программ пока не включена.",
  "ai.errTooShort": "Добавьте деталей — сколько дней, какой инвентарь, какая цель.",
  "ai.errRateLimited": "На сегодня лимит сгенерированных программ исчерпан. Попробуйте завтра.",
  "ai.errUpstream": "Генератор программ сейчас недоступен. Попробуйте через минуту.",
  "ai.errBusy": "Слишком много запросов сразу. Подождите немного и попробуйте снова.",
  "ai.errRefused": "Запрос отклонён. Попробуйте описать именно тренировки.",
  "ai.errShape": "Пришло что-то нечитаемое. Попробуйте ещё раз.",
  "ai.errNoDays": "Вернулось пусто. Попробуйте описать заново.",
  "ai.errEmptyDay": "Один из дней вернулся пустым. Попробуйте ещё раз.",
  "ai.errTooManyDays": "Столько дней приложение не поддерживает. Попросите семь или меньше.",
  "ai.errTooManyExercises": "В одном дне слишком много упражнений. Попробуйте попросить покороче.",
  "ai.errPattern": "Одно упражнение не удалось оценить. Попробуйте ещё раз.",
  "ai.errExcluded": "В программу попало то, что вы просили исключить, поэтому она отброшена. Попробуйте ещё раз.",
  "ai.errTooBig": "Такая программа слишком большая для хранилища. Попросите покороче.",

  // -- the Telegram bot --
  "bot.openButton": "🏋️ Открыть Chetamba",
  "bot.welcome": [
    "*Chetamba* — ваш дневник тренировок.",
    "",
    "Четырёхдневный сплит верх/низ, таймер отдыха, который видно с другого конца зала, и рейтинг,",
    "который показывает, действительно ли вы становитесь сильнее относительно своего веса.",
    "",
    "Всё хранится в вашем аккаунте Telegram. Без регистрации, без сервера, без рекламы.",
    "",
    "Нажмите кнопку ниже. Приложение продолжит ровно с того места, где вы остановились — даже посреди подхода.",
  ].join("\n"),
  "bot.help": [
    "*Как это работает*",
    "",
    "• *Запись* — выберите день, введите вес × повторения, нажмите «Записать». Подходы сохраняются",
    "  по ходу, поэтому закрыть приложение посреди тренировки ничего не теряет.",
    "• *История* — все прошлые тренировки.",
    "• *Прогресс* — рейтинг, ранг и графики по каждому упражнению.",
    "• *Профиль* — вес тела (рейтинг считается относительно него), *язык* и *Экспорт*, чтобы",
    "  выгрузить всю историю для разбора или резервной копии.",
    "",
    "Команды: /start · /app · /help · /language",
  ].join("\n"),
  "bot.unknownCommand": "Не знаю такой команды. /start откроет приложение, /help всё объяснит.",
  "bot.langAsk": "На каком языке мне общаться?",
  "bot.langSet": "Готово — говорю по-русски. Поменять можно командой /language или в приложении в «Профиле».",
  "bot.groupLangAsk": "На каком языке публиковать результаты в этом чате?",
  "bot.groupLangSet": "Теперь этот чат ведётся на русском.",
  "bot.registerInGroup": "Отправьте /register в том групповом чате, где хотите соревноваться.",
  "bot.registered": [
    "*Этот чат теперь таблица лидеров.*",
    "",
    "Откройте Chetamba → Профиль → Войти в группу и вставьте: `{code}`",
    "",
    "_Код действует 7 дней. Отправьте /register снова, чтобы получить новый._",
  ].join("\n"),
  "bot.badCode": "Этот код недействителен. Запросите новый командой /register в группе.",
  "bot.joinedBoard": "*{name}* присоединился к таблице.",
  "bot.notOnBoard": "Вы пока не в таблице. Отправьте /register в групповом чате, чтобы её создать.",
  "bot.emptyBoard": "В таблице пока никого нет. Отправьте здесь /register и вставьте код в приложение.",
  "bot.standingsTitle": "🏆 Таблица",
  "bot.finalHours": "⏳ Последние часы недели",
  "bot.newWeek": "*Новая неделя.* Активность у всех обнулена.",
  "bot.lastWeekWinner": "Прошлая неделя: 🥇 *{name}* — {total}.",
  "bot.finishedLift": "🏋️ *{name}* завершил: {label}",
  "bot.finishedActivity": "🏃 *{name}* — {label}, {minutes} мин",
  "bot.aWorkout": "тренировка",
  "bot.anActivity": "активность",
  // Short by necessity — these are columns in a fixed-width block. "Рейтинг" is already 7
  // characters, which is the practical ceiling on a narrow phone.
  "bot.colName": "Атлет",
  "bot.colRating": "Рейтинг",
  "bot.colWeek": "Неделя",
  "bot.rankedBy": "_Место = 40% рейтинга + 60% активности за неделю._",
  "bot.weekOf": "_неделя с {date} · активность обнуляется в понедельник_",
  "bot.asOf": "_Результаты — на момент последней записанной тренировки каждого._",
  "bot.groupFallback": "группу",
  "bot.thisGroup": "этот чат",

  "exp.howToRead": "Как это читать",
  "exp.legend": [
    "- Веса указаны как введены — на гантель или тренажёр, в кг. `20кг×12` это 20 кг на 12 повторений.",
    "- `→` обозначает дроп-сет: спортсмен дошёл до отказа и сразу продолжил с меньшим весом.",
    "- Работа на время (планка, гребля) записывается как **секунды в поле повторений** — известная шероховатость.",
    "- Рейтинг — это оценка силы относительно веса тела. Опубликованной базы нормативов",
    "  для гантельных упражнений не существует, поэтому эталоны выведены приблизительно",
    "  из штанговых нормативов.",
    "- Это игровой счёт, а не медицинский показатель — не делайте по нему выводов о здоровье.",
    "- В тренировках есть только то, что было записано. Отсутствующее упражнение могли пропустить, а могли просто не внести.",
  ].join("\n"),
};

export const STRINGS = { en, ru };

// ---------- Names that follow the language switch ----------

/**
 * Display name for an exercise or day.
 *
 * Built-in and template entries carry a stable id that also exists as an `ex.<id>` /
 * `day.<id>` key, so they re-render in the chosen language. Anything the user typed has no
 * such key and falls through to the stored name untouched — which is the whole point: we
 * translate our own copy, never theirs.
 */
export function exerciseDisplayName(lang, id, storedName) {
  const key = `ex.${id}`;
  const hit = (STRINGS[lang] || {})[key] || STRINGS[DEFAULT_LANG][key];
  return hit || storedName || "";
}

export function dayDisplayName(lang, id, storedName) {
  const key = `day.${id}`;
  const hit = (STRINGS[lang] || {})[key] || STRINGS[DEFAULT_LANG][key];
  return hit || storedName || "";
}
