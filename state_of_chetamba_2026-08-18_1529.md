# Chetamba — state of the project

*A briefing document, written to be pasted into a fresh conversation. Assumes no prior
context. Last updated 2026-08-18 15:29.*

There is a much longer engineering handover doc in the repo (`workout_tracker.md`, ~670
lines). This one is the strategic summary: what exists, what it cost to learn, what's
undecided.

**Maintenance rule:** this document is updated after every meaningful change. Summarise, don't
accumulate — replace stale sections rather than appending to them, and keep the hard-won
constraints (§5) even when they're not currently in play. Rename with a fresh timestamp when
it's substantially revised.

---

## 1. What it is

**Chetamba** is a weightlifting tracker that runs as a **Telegram Mini App** — a web app that
opens inside Telegram, with no app store, no install and no sign-up.

Its distinguishing feature is a **rating**: a bodyweight-relative strength score that moves
like a game rank (Bronze → Silver → Gold → Platinum → Diamond → Top 5%). The intent is
motivational — make consistency feel like it's counting toward something.

- **Live:** https://t.me/workoutelobot/chetamba
- **Repo:** https://github.com/ramzeus3010/WorkoutELO
- **Hosting:** https://ramzeus3010.github.io/WorkoutELO/dist/ (GitHub Pages)
- **Running cost: $0**, and that's a deliberate design constraint, not an accident.

### Who it's for — this has changed twice

Originally built for one person: Ramazan. 186 cm, ~76 kg, "skinny fat", wants visible
upper-body muscle and less abdominal fat. Trains between an apartment-building gym and a
commercial gym with machines.

**As of 2026-08-17 the goal is multi-user:** a small friend group competing via a Telegram
group chat where a bot posts scores.

**As of 2026-08-18 that group is Russian-speaking.** The app and the bot are bilingual, and
users type exercise names in Cyrillic. This turned out to be more than a translation job — see
§5, "Alphabets".

Original constraints, still shaping the app:

- **No Romanian deadlifts, no hip thrusts**, nothing that feels injury-prone.
- Historically inconsistent (~3–4 sessions/month) and **always skipped legs**.
- Short sessions (25–45 min); rest periods 45–90 s.
- Used **during** workouts, on a phone, one-handed, switching away mid-session.
  **Losing in-progress data is the single worst failure mode.**
- Logged sharp pain in the left mid-back during lateral raises. The coach detects pain words
  in notes and says to back off — with a test asserting the pain check runs *before* any
  "add weight" suggestion.

---

## 2. Where it stands

| Area | Status |
|---|---|
| App code | Built, **12** automated test suites passing |
| GitHub Pages hosting | **Live** |
| Mini App registered with BotFather | **Yes** |
| Bot Worker deployed and answering | **Yes** — URL confirmed 2026-08-18 |
| Cross-user scoring engine (`src/scoring.js`) | **Built and tested (52 checks)** |
| English + Russian, app and bot (`src/i18n.js`) | **Built and tested** |
| Onboarding, activities, program templates | **Done** |
| Bot: KV, `/score`, publish-on-finish, crons | **Written and tested** |
| Bot: the bilingual version | **NOT YET DEPLOYED — see §8** |
| Other users | **Zero.** Nobody but the author has used it |

### Built and working

- **Logging** — 4-day upper/lower split; weight × reps per set; drop sets; per-exercise
  notes; per-exercise rest timers; form-video links.
- **Autosave** — in-progress workout written on a 700 ms debounce, restored on reopen. The
  most heavily tested behaviour in the app, because a lost workout already happened once.
- **Rest timer** — a ring drawn around the screen edge that shrinks as time runs down.
- **Local coach** — rule-based, no AI, no network. Pain words override everything, in both
  languages.
- **Rating + tiers**, with per-exercise progress charts.
- **Export** — copy history as readable markdown or lossless JSON, in either language.
- **Editable program + substitution.**
- **Language switch** — Profile tab and onboarding; the bot asks on first `/start`.

### Stack

React 18 + esbuild → a single ~720 KB bundle, committed to the repo and served statically.
Tailwind via the Play CDN. recharts, lucide-react. Tests are jsdom driving the real UI, plus
three buildless pure-module suites. ~3,600 lines in `app.jsx` (single-file by design), plus
`src/scoring.js` and `src/i18n.js`.

---

## 3. Architecture

**There is no server and no database for workout data.** It lives in **Telegram
CloudStorage**, which is per-Telegram-user storage Telegram hosts for free. The app is static
files.

That gives: zero cost, zero maintenance, no privacy policy to write, nothing to breach, and
sync across a user's own devices for free. It costs: **users cannot see each other's data.**

**The social layer resolves this without a real backend.** The existing Cloudflare Worker is a
*publish-only relay*: the client posts a small summary (name, scores, exercise names) when a
workout finishes; the Worker verifies it and forwards it to the group chat. CloudStorage stays
the sole source of truth for workout data. Cloudflare KV holds only what the group already
sees, plus language preferences.

- `/score` **requires** KV. When someone types it, no client is running, so the Worker must
  answer from its own state.
- **Store the inputs, not the finished numbers.** Effort decays with time; a cached total goes
  stale and lies. Keep session dates and recompute at read time.

### The two shared modules

`src/scoring.js` and `src/i18n.js` are imported by the app, the node tests **and** the Worker.
Both are plain ESM with no imports, no DOM and no React, which is what makes that possible.
The rule behind both is the same: **two implementations of one thing drift, and the drift is
invisible until a user sees the group chat and the app disagree.** For scoring that means two
different numbers; for strings it means the bot announcing a workout in wording the app never
uses. Neither failure throws an error anywhere.

`src/i18n.js` also owns `slugId()`, because identity turned out to be an alphabet problem
(§5).

---

## 4. The scoring model

### Why the old rating couldn't be a leaderboard

The original rating was program-relative and deliberately forgiving. Three properties made it
non-comparable between people:

1. **Your program was the denominator**, so deleting a lift you're bad at raised your rating —
   a cheat button in the settings menu once friends can see it.
2. **Untouched slots pulled toward neutral**, so a 6-lift program suffered less drag than an
   18-lift one. Smaller program, higher number, free.
3. **`load / bodyweight` is linear**, but strength scales ~`bodyweight^0.67`. The lightest
   person in any group wins by arithmetic.

### Two axes, combined 40 / 60

Keeping these separate is load-bearing. If effort raised the *strength* number, strength would
stop meaning strength.

**Strength** — scored against a **fixed set of 12 movement-pattern slots, identical for
everyone**. Your program decides how you *fill* the slots, not which slots exist, so editing
your split can no longer move your score. Allometric bodyweight scaling. Slow-moving.

**Effort** — weekly, resets Monday. Credits **distinct movement patterns**, not exercise
count: six curl variations is one pattern; six covering push/pull/squat/hinge/core is real
training. Saturating, so the 6th pattern adds less than the 2nd. Max 2 sessions/day counted.

`total = 0.4 × strengthPoints + 0.6 × effortPoints`, both mapped to 0–100. Effort is weighted
higher because it's the axis that's actually winnable each week — it's what keeps a group
board alive past week three.

### The scale

Everyone starts at **800** with an empty log. A never-trained slot contributes 0.5 rather than
neutral 1.0 — without that, a brand new user would open the app already rated "average".

| | |
|---|---|
| Empty log | 800 |
| One strong bench, nothing else | 933 |
| One average 5-pattern session | 992 |
| Same session, double the load | 1376 |
| All 12 slots at average | 1200 |
| All 12 slots elite ("top 5%") | 2000 |
| Cap | 2600 (≈2.75× average everywhere — unreachable in practice) |

**No calibration period.** The score is a closed form, not an Elo climb, so a strong newcomer's
first real session reads 1376 on day one. Tenure never beats strength: two people with equal
logs always score the same. That is what makes it comparable.

### Activities (basketball, hiking, running…)

A 2-hour pickup game earns **zero strength** — no load, no reps, nothing honestly measurable —
and **full effort credit**. The two-axis split is the only structure where both are true.

Duration curves are **saturating, never declining**:
`credit = ceiling × (1 − 2^(−minutes / halfMin))`.

A curve that falls after a peak would pay people to under-report — hike 9 hours, type 7, score
better. Everything is self-reported, so **honest logging must never cost points.** The
per-activity `ceiling` stops "I logged a 14-hour hike" with no decline required.

### The same principle, twice more

- **Strength uses your best per slot, decayed by how recently you last trained that pattern.**
  Two separate facts, deliberately not conflated. Using your *most recent* performance meant a
  deload week or one bad day lowered your score — it paid you not to log them. Dating the
  decay from the *best* instead punished consistency: bench the same weight every week and the
  best's date never moves, so you'd go stale while actively training the lift. Best answers
  "what can you do"; last-trained answers "is it current".
- **Decay fades toward average (1.0), never toward untrained (0.5)**, so neglecting a lift you
  have trained can never drag you below average.
- **No layoff penalty.** Time off is already visible on the weekly effort axis and in
  per-pattern decay; deducting a third time punished one absence three ways.

### Consequence worth knowing

Skipping a single session no longer costs strength directly. **Showing up is measured on the
effort axis now**, and that's deliberate: the strength number answers "how strong are you",
not "how diligent have you been".

---

## 5. Hard constraints and gotchas

Accumulated the expensive way. Check any proposal against these.

### Alphabets — the newest and least obvious

`slugId()` derives an exercise's or a day's stable id from its name. It used to strip
everything outside `[a-z0-9]` and fall back to `"x"` when nothing survived. **For any Cyrillic
name, nothing ever survived**, so "Жим лёжа", "Приседания" and "Планка" all became the id
`"x"`. That is not cosmetic:

- `exercisesByDay[slugId(dayName)]` — a program with Russian day names kept only its last day,
  because each one overwrote the previous.
- `hydratePatterns` keys history by id, so every Russian exercise inherited one movement
  pattern and was scored as the wrong lift.
- The Progress charts collapsed every Russian exercise into a single line.

The fix transliterates and appends a hash. **The ASCII path is preserved byte-for-byte**, and
a test asserts it, because ids are already written into CloudStorage and old sessions
re-derive them on read — changing what an existing name hashes to would silently detach a
user's history from their charts, coach and rating.

Two subtleties worth keeping:

- The test is "does the name contain any non-ASCII character", **not** "is anything left after
  stripping". Gym Russian mixes alphabets — "Жим DB", "Тяга DB" — and the second test would
  send both down the old path and collide them on `"db"`.
- **Anything deriving identity from user text has this problem.** If you add a feature that
  keys on a name, route it through `slugId`.

### Self-reported data in two languages

The coach's pain-word list decides whether it says "back off" or "add weight". It now checks
**English and Russian at once, regardless of the UI language**, because the note was typed in
whatever language the user thinks in. The Russian entries are **stems** (`бол` catches
боль/болит/больно/болел) since Russian inflects. Stems overmatch slightly, which is the
correct direction: a false positive tells someone to ease off a lift that was fine; a false
negative tells someone to load a lift that hurt.

### Telegram platform

| Constraint | Consequence |
|---|---|
| CloudStorage: **4096 chars per value**, 1024 keys per user | Sessions and program days stored one key each, never as one blob |
| CloudStorage is **per-user and isolated** | One user's app **cannot** read another's |
| BotFather registers a bot but **does not answer messages** | `/start` needs a webhook and a server listening |
| `web_app` buttons only work in **private chats** | In groups, fall back to a plain link or the message silently fails |
| Telegram redelivers any webhook update you don't answer with 200 | A thrown error becomes a retry storm |
| Telegram caches the webview aggressively | After an update, fully close the Mini App, don't just background it |
| An inline button spins until `answerCallbackQuery` | Answer it **first**, before any KV write that could fail |
| Legacy Markdown: an unbalanced `*` makes Telegram **reject** the message | A mistranslated bot string is a silent outage, not a formatting bug |

### iOS, learned from real gym use

| Gotcha | Fix in place |
|---|---|
| `type="number"` renders a decimal point that **does nothing** on iOS | Weight fields are `type="text"` + `inputMode="decimal"`. 7.5 kg was unenterable before |
| The iOS numeric keypad **has no return key** | Custom toolbar drawn above the keyboard using `visualViewport` |
| Bottom-fixed elements get pushed up by the keyboard onto the input you're typing into | Rest timer became a screen-edge ring. Nothing is bottom-pinned except the nav |
| A native `<select>` renders its options in the system font | The language switch is two buttons, not a dropdown |

### Build and styling

- `dist/app.js` is **committed on purpose** (Pages has no build step). **Rebuild before every
  push** or the deployed app silently stays on old code.
- The brand colour is a `tailwind.config` block in `index.html`. If it breaks, every accent
  class compiles to nothing and **the buttons turn invisible**. jsdom runs no CSS, so **no
  test can catch this** — it needs a real browser check.
- Base font size is a single `html { font-size: 18px }` dial.
- **Russian strings run 10–30% longer than English.** Four bottom-nav tabs still fit at 18px;
  a fifth would wrap. That's a second reason the program editor lives inside Profile.

### Data model

- Exercises are keyed by **stable id, not display name**. Old sessions migrate on read.
- Logged entries carry their **movement pattern**, stamped at log time, so a session logged
  today still scores correctly after the program is edited tomorrow. Older history is
  backfilled on read by `hydratePatterns` — which deliberately does **not** rewrite storage,
  because a migration touching every session can half-fail and export is copy-only.
- **Export is copy-only. There is no import/restore.**

### The AI constraint

**There is no AI in this project at all** — no API key, no model call, nothing in
`package.json`. The rule-based coach is plain JavaScript.

**An API key cannot ship in the client.** The bundle is public. This already happened once and
had to be torn out. The fix, if AI is ever added, is the Worker as a server-side proxy, with
Telegram's `initData` signature verifying the caller plus per-user rate limiting.
**Cost is not the blocker — a generation is a fraction of a cent. Abuse is.**

---

## 6. Decisions made, and why

| Decision | Reason |
|---|---|
| Telegram Mini App | No install, no store review, no sign-up; his friends live in Telegram |
| No server or database for workout data | Cost, maintenance, privacy surface |
| Publish-only relay + KV, not a real backend | Gets a live group leaderboard without moving the source of truth off-device |
| Rule-based coach, not an LLM | The LLM version needed a client-side key. Also works offline in a basement gym |
| Skipping slows but never reverses the rating | Explicitly requested. Punishing lapses drives off exactly the person the app is for |
| Swap and Edit are separate actions | "Busy machine today" and "I don't do this lift" have different rating consequences |
| Light theme forced | Telegram's webview injected a dark theme that made form controls black-on-black |
| Fixed pattern slots for the ranked score | The only way two people's numbers mean the same thing |
| Strength and effort kept separate | Merged, "strength" would just mean stamina for logging |
| Saturating curves everywhere, never declining | Self-reported data: honest logging must never cost points |
| Everyone starts at 800, no calibration | A first week where the score is meaningless wastes the hook |
| Off-program exercises are scored | Under fixed slots every exercise maps to a pattern |
| Activities earn effort, never strength | A pickup game has no load and no reps; any strength number would be invented |
| Challenges must never stake strength points | Losing a bet would make the number mean "how strong you are, minus bets lost" |
| **One dictionary shared by app, tests and Worker** | Same reason as `scoring.js`: two copies drift, and nothing throws when they do |
| **We translate our copy, never the user's** | Built-ins have an `ex.<id>` key and follow the switch; a name someone typed is shown exactly as typed. Machine-translating user input would need an API, which contradicts the $0 rule |
| **Language is stored under its own key, not in the profile** | The profile is what gets published to the relay; language is a display preference the leaderboard has no business knowing |
| **Group language is set once, at `/register`** | A group post has many readers and can only be in one language. Bilingual posts would double the length of a message that fires on every finished workout |
| **A DM `/score` uses the reader's own language** | Same numbers, different wording — nothing shared is at stake |
| **Tier names stay English in both languages** | They're game ranks and what the group says out loud. "Золото" reads like a translation of a rank rather than the rank itself |
| **Locale detection is a pre-selection, never a wall** | The bot confirms with two buttons; the app pre-sets and exposes a switch. Guessing wrong costs one tap |
| **`ru` is the default for `kk`/`uk`/`uz`/… too** | The group is in Almaty. A Kazakh-locale phone wants Russian over English here |

---

## 7. Open items

### The one that matters most — the motivation curve

**The score moves fast for two weeks, then goes quiet for months, and that will lose the
room.** Modelled honestly:

- **Weeks 1–2:** 800 → ~1200. But this is not progress — it's the app *learning what you can
  already do* as the 12 slots fill in. At fixed strength, going 0 → 12 slots covered is worth
  800 → 1520 on its own.
- **Year 1:** perhaps +300–500 points. Every +200 costs a **25% load increase**.
- **After that:** 5–10% strength a year, so **+40–80 points annually**.

So the risk was never "people hit the top too fast" — it's the silence after the onboarding
rush. **Still the priority.** Candidate answers, cheapest first:

1. **Per-slot tiers.** Twelve sub-ratings instead of one number ("Gold bench, Silver squat,
   **Bronze hinge**"), so there's always a visible next goal even at 1800 overall, and it
   pushes the balanced training the score already rewards. The data is already returned in
   `strengthScore().slots` — this is a rendering job, not a maths job.
2. **Monthly seasons** on the effort axis, with recorded winners.
3. **Challenges / 1v1s.** Player-generated, so it never runs out. Must pay out in a separate
   currency (see §6).

### Product gaps

- No import/restore to match the export.
- No way to edit or correct a past session.
- Duration work is logged as **seconds typed into the reps field**. Needs a real input.
- One paragraph in the program editor (`prog.ratingNote`) still describes the **old
  program-relative rating** — it says removing an exercise stops it counting against you,
  which fixed pattern slots made untrue. Flagged rather than silently reworded, because
  correcting it is a copy decision. **Sweep user-facing copy whenever scoring changes**; a
  test pins the one sentence that was already caught wrong in the wild.
- The Russian translation has not been read by a native speaker in situ.

### Unverified

- Whether the newest UI has been re-checked on a real phone since it shipped — including
  whether the longer Russian strings actually fit.
- Whether Telegram CloudStorage has *ever* actually run. Every test to date has exercised the
  `localStorage` fallback path.

### Health

- The lateral-raise mid-back pain is monitored by the coach but unresolved medically.

---

## 8. Roadmap

1. ~~Retire the personal rating.~~ **Done.** `computeEloTrajectory` is a thin adapter over
   `strengthScore`, keeping the `{ trajectory, rating, coverage }` shape so the chart, tier
   card, export and leaderboard kept working. `coverage` carries a per-pattern rating, so
   **per-slot tiers are a render away**.
2. ~~Activity + ad-hoc session types.~~ **Done.**
3. ~~Onboarding.~~ **Done.** Name + bodyweight (+ optional height), then three starting
   programs or skip. **Bodyweight is the only thing it insists on**, because without it every
   load benchmark divides by nothing. Skippable, not a wall.
4. ~~The bot.~~ **Written, tested, deployed** — but the bilingual version is **not deployed
   yet** (see below). Identity is `initData` only, never the request body. Publishing is
   idempotent per session id. Fire-and-forget from the client, only after the local write
   succeeded.
5. ~~English + Russian.~~ **Done.** Both surfaces, one dictionary, 12 suites green.
6. **The motivation curve** (§7) — the priority now.
7. **AI program generation** — last, and genuinely optional. Needs schema validation against
   the 13 known pattern ids, an explicit check against stated exclusions (it *will* produce
   RDLs for someone who said no RDLs), and review-before-commit in the existing editor.

### Waiting on Ramazan

- **Redeploy the bot.** `npx wrangler deploy` from `bot/`. The Worker now imports
  `src/i18n.js`, handles `callback_query`, and reads/writes two new KV shapes
  (`user.lang`, `grouplang:<chatId>`). **Until this runs, the deployed bot is still the
  English-only build.**
- **Rebuild and push `dist/app.js`** — Pages has no build step, so the deployed app stays on
  old code otherwise. (`npm test` rebuilds it; the push is manual.)
- **Re-run `/setcommands` in BotFather** to add `/language` to the menu — `bot/README.md` has
  the block to paste.
- **Add the bot to the group chat**, run `/register`, pick the board language, paste the code
  into Profile → Group leaderboard.
- **Read the Russian on a real phone.** Automated tests prove the strings are *present* and
  that no key is missing; they cannot tell you a sentence reads like a translation, or that a
  nav label wraps.
- **An Anthropic API key**, for step 7 only — set via `npx wrangler secret put
  ANTHROPIC_API_KEY`, never pasted into a chat or a file.

### Settled configuration

- League week: **Monday–Sunday, fixed UTC+5 (Almaty)** for everyone, not per-user local. A
  shared deadline is the point — the Sunday-evening nudge only works if everyone races the
  same clock. `WEEK_TZ_OFFSET_MIN` in `src/scoring.js`.
- Combined score: **40 strength / 60 effort**.
- Languages: **en, ru**. Adding a third is a matter of adding one object to `STRINGS` and one
  entry to `LANGS`; `tests/test-i18n.mjs` will fail until every key is covered.
