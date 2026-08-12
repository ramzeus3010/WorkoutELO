# workout_tracker.md

Handover doc for **Gains** — a workout tracker running as a Telegram Mini App.

> **For Claude Code:** this file is the source of truth for the project. Read it before
> changing anything. **Update it in the same commit as any change** — see
> [Maintaining this doc](#maintaining-this-doc) at the bottom.

Last updated: 2026-08-12 · Status: built and tested, not yet deployed

---

## 1. Who this is for

Ramazan — 186 cm, ~76 kg, "skinny fat", goal is visible upper-body muscle and less
abdominal fat. Trains in an apartment building gym plus a commercial gym with machines.
Plays basketball/football 1–2×/week, which counts as conditioning, **not** a lifting day.

Constraints that drove design decisions:

- **No Romanian deadlifts, no hip thrusts, nothing that feels injury-prone.**
- Historically inconsistent (~3–4 sessions/month) and **always skipped legs** — legs are
  deliberately embedded in 2 of 4 training days so they can't be quietly dropped.
- Wants short sessions (~25–45 min). Rest periods are 45–90 s, not powerlifting-length.
- Uses the app **during** workouts on a phone, and switches away mid-session to ask
  questions. Losing in-progress data is the single worst failure mode. See §5.

### Known health flag

He logged **sharp pain in the left mid-back** during dumbbell lateral raises. The coach
logic explicitly detects pain-like words in notes and tells him to back off. **Do not
"improve" the coach into something that encourages pushing through pain.** If a change
touches `buildLocalCoach`, re-run `tests/test-flow.mjs`, which asserts this behaviour.

---

## 2. What it is, technically

A single-page React app bundled to one JS file, loaded by Telegram in a webview.

- **No server. No database. No API keys.** Everything runs client-side.
- Data lives in **Telegram CloudStorage**, scoped per Telegram user.
- Hosted as static files (GitHub Pages). Telegram does not host anything itself — it
  only opens a URL, and that URL must be HTTPS with a valid certificate.

### Why not the earlier versions

This started as a Claude artifact using `window.storage`. That required both users to
have a paid Claude plan, so it was ported. A Vercel + Supabase version was considered and
rejected as unnecessary once Telegram CloudStorage covered the storage need.

---

## 3. Repo layout

```
.
├── workout_tracker.md   ← this file
├── package.json
├── src/
│   ├── app.jsx          ← the entire app (~1600 lines, single file by design)
│   └── main.jsx         ← mounts <App/> into #root
├── dist/
│   ├── index.html       ← page shell; loads Telegram SDK + Tailwind CDN + app.js
│   └── app.js           ← build output, COMMITTED (GitHub Pages serves it directly)
└── tests/
    ├── smoke.mjs        ← renders the bundle in jsdom, asserts no errors
    ├── test-autosave.mjs← logs a set, kills app, reopens, asserts restore
    └── test-flow.mjs    ← coach + rating + leaderboard end-to-end
```

`dist/app.js` **is committed on purpose** — GitHub Pages serves static files with no
build step, so the built bundle must be in the repo.

### Commands

```bash
npm install
npm run build     # src/ -> dist/app.js
npm test          # build + all three suites
```

There is no dev server. To iterate: `npm run build`, then open `dist/index.html` in a
browser. Outside Telegram the app falls back to `localStorage`, so it's fully testable
in a normal browser — it just won't sync to a Telegram account.

---

## 4. Architecture of `src/app.jsx`

Roughly in file order:

| Lines | Section |
|---|---|
| 1–3 | Imports (react, lucide-react, recharts) |
| ~7–51 | `PROGRAM` — the 4-day split, exercise definitions and form links |
| ~53–105 | Rating config: `EXERCISE_META`, `TIERS`, tuning constants |
| ~107–190 | **Telegram bridge + storage layer** (§5) |
| ~193–260 | `emptyExerciseLog`, `playBeep`, `useRestTimer` |
| ~261–350 | `App` — tab state, loads sessions/profile, save handlers |
| ~351–495 | `Header`, `BottomNav`, `RestTimerBar`, `QuickTimer` |
| ~498–630 | **Rating engine** (§6) |
| ~646–722 | **Local coach** (§7) |
| ~724–945 | `CoachPanel`, `LogView` (incl. draft autosave) |
| ~945–1188 | `ExerciseCard` — sets, drop sets, notes, per-exercise rest |
| ~1189–1355 | `HistoryView`, `ProfileView` |
| ~1356–1590 | `RatingCard`, **Leaderboard** (§8) |
| ~1590+ | `ProgressView` — rating card, leaderboard, per-exercise charts |

Line numbers drift as the file changes; treat them as a map, not gospel. Grep for the
function name.

### The 4-day split

| Day | Focus |
|---|---|
| Upper A | Push — bench, row, OHP, lateral raise, curl, triceps |
| Lower A | Leg press, walking lunge, leg extension, calf raise, rowing erg, plank |
| Upper B | Pull — incline press, pulldown, rear delt fly, hammer curl, triceps |
| Lower B | Split squat, hip thrust, back extension, calf raise, side plank |

**Lower B still contains hip thrusts.** He said he doesn't want them and this was raised
but never resolved — see [Open items](#11-open-items).

Duration-based work (planks, rowing erg) is logged as **seconds in the reps field**.
This is clunky and known; a proper duration input is an open item.

---

## 5. Storage layer — read before touching

```
Telegram CloudStorage  →  used when running inside Telegram
localStorage           →  automatic fallback in a plain browser
```

`cloud.get/set/remove` wrap this. Everything else in the app calls `cloud.*` and never
touches either backend directly. **Keep it that way.**

### Hard limits (Telegram's, not ours)

- **1024 keys per user**
- **4096 characters per value**

The 4096 cap is why sessions are **not** stored as one blob:

| Key | Contents |
|---|---|
| `sess_index` | JSON array of session ids |
| `sess_<id>` | one full session |
| `profile` | height, weight, display name |
| `draft_v1` | the in-progress workout (§ autosave) |
| `rivals_v1` | friends' pasted scores |

`saveSession` refuses payloads over 4000 chars and returns
`{ok: false, reason}` rather than silently dropping the session. Keep that guard.

### Autosave — the most important behaviour in the app

He lost a workout to the old "you must press Save" model. Do not regress this.

- `LogView` writes `draft_v1` on a 700 ms debounce whenever anything changes.
- On mount, `LogView` restores `draft_v1` if it contains any logged sets.
- `handleSave` commits the session **and** clears the draft.
- The `restored` flag prevents the empty initial state from overwriting a saved draft
  before it loads. **This ordering matters — don't remove the flag.**

`tests/test-autosave.mjs` covers exactly this: log a set → new app instance sharing
storage → assert the set is still there. Run it after any `LogView` change.

---

## 6. Rating system ("ELO")

Not real Elo — there's no opponent. It's a **bodyweight-relative strength percentile**
run through Elo-style update maths so it moves like a game rank.

- Baseline **800** = untrained for his size
- **1200** ≈ average active person
- **2000** = "top 5%"
- Tiers: Bronze → Silver → Gold → Platinum → Diamond → Top 5%

### How a session moves the number

1. **Layoff penalty first.** Gap since the previous session, minus a 7-day grace, decays
   the rating toward baseline with a 21-day half-life. A week off costs nothing; a month
   costs ~425 points; three months lands near baseline. Never drops below 400.
2. **Every program exercise contributes**, weighted by `multiplier` in `EXERCISE_META`
   (compounds 1.5, accessories ~0.75, calves/core ~0.5).
3. **Untouched exercises decay toward neutral 1.0, not zero** (14-day half-life). This is
   deliberate: skipping one lift *slows* progress but can never freeze or reverse it.
   He explicitly asked for this. Don't turn it into a hard zero.
4. Weighted average → Elo update against expected score, K=32 for the first 10 sessions
   then 16.

Weight comes from the Profile tab and is applied to **the whole history on every
recalculation**, so cutting or bulking re-contextualises past sessions too.

### Honesty note

There is **no published strength-standard database for dumbbell lifts**. The `avg`
benchmarks in `EXERCISE_META` are estimates derived from barbell standards. This is
stated to the user in the UI and should stay stated. Do not present these as clinical.

---

## 7. Coach (`buildLocalCoach`)

Rule-based, runs locally, no API. Triggered by the "Start Workout" button. Compares
today's planned exercises against the most recent session of the same day.

| Condition | Suggestion |
|---|---|
| Note contains a pain word | **Back off, check form, stop if it recurs** |
| Hit top of rep range, no drop sets | Bump weight (+1/+2/+2.5 kg by load) |
| Used drop sets | Repeat same weight, cleaner reps |
| Otherwise | Same weight, add a rep |
| No history | Neutral encouragement, no invented numbers |

Pain words live in `PAIN_WORDS`. The pain branch is checked **before** any progression
branch and must stay that way.

An earlier version called the Anthropic API from the client. That was removed — it
needed a key shipped in client-side code, which is not safe. Don't reintroduce it
without a server-side proxy.

---

## 8. Leaderboard

Telegram CloudStorage is **per-user and isolated** — one user's app cannot read
another's. There is no server. So the leaderboard is **snapshot exchange, not live sync**:

- "Share my score" builds a card `GAINS|name|rating|tier|date` and opens Telegram's
  share sheet.
- "Add friend's score" parses a pasted card into `rivals_v1`.

Limitations are stated in the UI. A live leaderboard would require a backend; that's a
scope change, not a bug fix.

---

## 9. Styling constraints

`dist/index.html` loads the **Tailwind Play CDN**, which compiles at runtime, so
arbitrary values like `bg-[#FF5A36]` *do* work here.

⚠️ The source currently uses **only core Tailwind classes** because the previous Claude
artifact environment had no JIT compiler and arbitrary values silently rendered as
nothing — an invisible-buttons bug that took several rounds to find. The current code is
therefore safe in both environments. If you introduce arbitrary values, the app will
still work on Telegram, but the code stops being portable back to an artifact.

**Light theme is forced** (`color-scheme: light` on `:root` and on inputs). Telegram's
webview can inject a dark theme that made native form controls black-on-black. Don't
remove those declarations.

Layout notes:
- Bottom padding switches between `pb-24` and `pb-44` depending on whether the rest timer
  bar is showing, so the timer never covers the Save button. This was a real reported bug.
- Avoid `ml-auto` on buttons inside `overflow-hidden` cards — it previously pushed
  buttons outside the clip region and made them invisible.

---

## 10. Deploying

**GitHub Pages:** push the repo, Settings → Pages → deploy from `main`, root folder.
Live at `https://<user>.github.io/<repo>/dist/` (or move `dist/` contents to root and
serve from there — simpler).

**BotFather:** `/newbot` → `/newapp` (paste the HTTPS URL) → `/setmenubutton`.

Updates are just a rebuild + push; users get them on next open, no reinstall.

---

## 11. Open items

- [ ] **Never deployed or opened in a real Telegram client.** All testing is jsdom.
      Real-device layout/sizing is unverified.
- [ ] **Lower B still has hip thrusts**, which he said he doesn't want. Needs a
      replacement (back extension or a hamstring curl machine) — ask before swapping.
- [ ] Duration exercises (planks, rowing erg) are logged as seconds in the reps field.
      A dedicated duration input would be better.
- [ ] Lateral raise mid-back pain — monitor; medical attention if it persists.
- [ ] Row form: he reported not feeling his back. Cue is elbow back/down, pause and
      squeeze the shoulder blade, don't shrug or pull with the arm.
- [ ] No export/backup. If Telegram data is lost, it's gone.

---

## 12. Maintaining this doc

**Update this file in the same commit as the change.** Specifically:

1. Bump **Last updated** at the top.
2. If behaviour changed, edit the relevant section — don't just append to the changelog.
3. Add a line to the changelog below.
4. If an open item is done, remove it from §11 rather than leaving it checked.
5. If you added a rule the user asked for (like "skipping a lift must not freeze the
   rating"), write down **why**, not just what. The reasoning is the part that gets lost.

### Changelog

| Date | Change |
|---|---|
| 2026-08-12 | Ported from Claude artifact to Telegram Mini App. Storage → CloudStorage, AI coach → local rules, leaderboard → share/paste cards. Added draft autosave. Added jsdom test suite. |
| 2026-08-12 | Lower A reworked: leg press replaces goblet squat, leg extension replaces hip thrust, rowing erg added. |
| 2026-08-12 | Added layoff decay so long breaks drop the rating meaningfully. |
| 2026-08-12 | Added drop sets, per-exercise notes, form links, Profile tab, rating/tier system. |
