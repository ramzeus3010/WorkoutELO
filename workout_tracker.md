# workout_tracker.md

Handover doc for **Chetamba** — a workout tracker running as a Telegram Mini App.

> **For Claude Code:** this file is the source of truth for the project. Read it before
> changing anything. **Update it in the same commit as any change** — see
> [Maintaining this doc](#maintaining-this-doc) at the bottom.

Last updated: 2026-08-13 · Status: app builds clean, all five suites green, **Pages deploy
and bot webhook not yet verified live** · Next up:
[editable exercises](#12-next-session--editable--custom-exercises)

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

### The one exception: `bot/`

The **bot webhook** (§10a) is a small Cloudflare Worker, and it is the only server-side
code in the project. It exists solely so `/start` replies with a button; **it never sees
workout data**, which never leaves the user's own Telegram account. The app does not call
it and does not know it exists — delete the worker and the Mini App still works exactly as
before, you just get a silent bot again. Keep that separation: the moment the app starts
talking to the worker, every privacy claim in the Profile tab has to be rewritten.

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
├── .gitignore           ← ignores node_modules; deliberately does NOT ignore dist/
├── src/
│   ├── app.jsx          ← the entire app (~1700 lines, single file by design)
│   └── main.jsx         ← mounts <App/> into #root; also calls tg.ready()/expand()
├── dist/
│   ├── index.html       ← page shell; loads Telegram SDK + Tailwind CDN + app.js
│   └── app.js           ← build output, COMMITTED (GitHub Pages serves it directly)
├── bot/                 ← Telegram bot webhook (Cloudflare Worker). Deployed separately.
│   ├── worker.js        ← answers /start, /app, /help with an Open-the-Mini-App button
│   ├── wrangler.toml    ← non-secret config; secrets are set with `wrangler secret put`
│   └── README.md        ← setup + BotFather steps
└── tests/
    ├── dom.mjs          ← shared jsdom harness + assertion helpers (no test cases)
    ├── smoke.mjs        ← renders the bundle in jsdom, visits every tab, asserts no errors
    ├── test-autosave.mjs← logs a set, kills app, reopens, asserts restore
    ├── test-flow.mjs    ← coach + keyboard + rating + leaderboard end-to-end
    ├── test-export.mjs  ← markdown + JSON export content and round-tripping (§8a)
    └── test-bot.mjs     ← bot webhook, with the Telegram API stubbed (no network)
```

`dist/app.js` **is committed on purpose** — GitHub Pages serves static files with no
build step, so the built bundle must be in the repo. **Rebuild before every push**, or the
deployed app silently stays on the old code.

The bundle is an IIFE and exports nothing, so all three suites drive the real UI through
jsdom rather than importing functions. `tests/dom.mjs` holds the shared setup: it stubs
`AudioContext`, `requestAnimationFrame`, `getBoundingClientRect` and **`ResizeObserver`**
(recharts' `ResponsiveContainer` throws without it in jsdom; real browsers have it). Any
new test should import from there rather than rebuilding its own DOM.

### Commands

```bash
npm install
npm run build     # src/ -> dist/app.js
npm test          # build + all five suites
```

The bot is deployed separately and is not part of `npm run build` — see `bot/README.md`.
`npm test` does cover it (`tests/test-bot.mjs`, Telegram API stubbed, no network).

There is no dev server. To iterate: `npm run build`, then open `dist/index.html` in a
browser. Outside Telegram the app falls back to `localStorage`, so it's fully testable
in a normal browser — it just won't sync to a Telegram account.

---

## 4. Architecture of `src/app.jsx`

Roughly in file order:

| Lines | Section |
|---|---|
| 1–4 | Imports (react, react-dom/client portal, lucide-react, recharts) |
| ~8–62 | `PROGRAM` — the 4-day split, exercise definitions and form links |
| ~64–105 | Rating config: `EXERCISE_META`, `TIERS`, tuning constants |
| ~109–192 | **Telegram bridge + storage layer** (§5) |
| ~195–260 | `emptyExerciseLog`, `playBeep`, `useRestTimer` |
| ~263–355 | `App` — tab state, loads sessions/profile, save handlers |
| ~356–405 | `Header`, `BottomNav` |
| ~406–510 | **Rest timer UI**: `useViewportBox`, `RestRing`, `RestReadout` (§9a) |
| ~513–570 | `QuickTimer` |
| ~573–705 | **Rating engine** (§6) |
| ~721–795 | **Local coach** (§7) |
| ~799–1020 | `CoachPanel`, `LogView` (incl. draft autosave) |
| ~1025–1082 | **Keyboard accessory bar**: `useKeyboardOffset`, `KeyboardAccessory`, `toNumber` (§9b) |
| ~1084–1410 | `ExerciseCard` — sets, drop sets, notes, per-exercise rest |
| ~1413–1580 | `HistoryView`, `ProfileView` |
| ~1585–1820 | `RatingCard`, **Leaderboard** (§8) |
| ~1826+ | `ProgressView` — rating card, leaderboard, per-exercise charts |

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
stated to the user in the UI — a footer line at the bottom of `RatingCard` — and should
stay stated. Do not present these as clinical. `tests/test-flow.mjs` asserts the caveat is
still rendered.

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
branch and must stay that way. `tests/test-flow.mjs` seeds a lateral raise that *both*
flagged pain *and* hit the top of its rep range, then asserts the coach backs off instead
of adding weight — that test fails the moment the ordering is reversed.

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

## 8a. Export

Lives in the **Profile** tab. Two buttons, two formats, deliberately not one:

| Button | Format | Job |
|---|---|---|
| Copy for review | Markdown | To be **read** — pasted into a chat with an LLM for a training review |
| Copy backup (JSON) | JSON | To be **restored** — must round-trip losslessly |

Don't merge them. A backup a human has reformatted is not a backup, and a raw JSON dump is
a poor thing to hand a reviewer.

Range selector: last 4 weeks / last 3 months / everything. He reviews roughly monthly, and
an unbounded dump gets unwieldy fast.

### What the markdown carries, and why

The export is the only context a reviewer gets, so it ships the things that stop them
giving bad advice:

- **Bodyweight**, because every rating number is relative to it.
- **Day balance** — sessions per program day. Skipping leg days is the specific historical
  failure mode (§1); a reviewer should not have to count dates to notice it.
- **Anything the notes flagged as painful**, pulled out of the logs via
  `noteSignalsProblem` and labelled as constraints rather than as things to push through.
  This is derived from the data, **not hard-coded to his injuries** — friends using the app
  get their own flags, and nobody gets his.
- **The §6 caveat**, verbatim: benchmarks are estimates, it's a game score, don't reason
  about health from it. It travels with the data instead of only living in the UI, because
  the number is about to be shown to something that will happily over-interpret it.
- The `seconds-in-the-reps-field` quirk for duration work, which otherwise reads as someone
  doing 300-rep planks.

`tests/test-export.mjs` asserts all of the above, plus that the JSON round-trips drop sets,
decimals and notes exactly.

### Delivery

Clipboard, not file download: inside Telegram's webview there is no usable download, and
the destination is a chat anyway. Some webviews block the clipboard API outright, so a
failed copy falls back to showing the text in a focused, selected textarea rather than
failing silently.

---

## 9. Styling and phone-input constraints

`dist/index.html` loads the **Tailwind Play CDN**, which compiles at runtime.

### Brand colour

The accent is **maroon `#410038`**, defined as a `maroon-*` scale in the
`tailwind.config` block in `dist/index.html`. Everything accent-coloured uses
`maroon-50/100/200/300/400/500/600/700/800`; `600` is the brand colour itself.

⚠️ **If that config block is deleted or mistyped, every `maroon-*` class compiles to
nothing and the buttons turn invisible** — the same failure mode that cost several rounds
of debugging in the artifact era. There is no test for this, because jsdom never runs
Tailwind. Check it in a real browser after touching `index.html`. To retune the brand,
change the scale in one place rather than editing class names.

The one deliberate exception: the **Bronze tier badge stays orange**. It's a metal, not
the brand accent.

### Sizing

`html { font-size: 18px }` in `dist/index.html` (browser default is 16). Tailwind's type
*and* spacing scales are both in `rem`, so this one number scales text, padding and gaps
together. **This is the size dial** — change it rather than rewriting class names.

### Light theme

**Light theme is forced** (`color-scheme: light` on `:root` and on inputs). Telegram's
webview can inject a dark theme that made native form controls black-on-black. Don't
remove those declarations.

### 9a. The rest timer is a screen-edge ring, not a bar

The timer used to be a bar floating above the bottom nav. On a phone the keyboard pushes
that bar upward and it lands **exactly on top of the weight/reps inputs**, so you can't
see the number you're typing. Reported as the single most annoying thing in the app.

It is now:

- **`RestRing`** — an SVG rounded-rect stroked around the screen edge, `fixed inset-0`,
  `pointer-events-none`, drawn from the **layout** viewport (not `visualViewport`, which
  would reflow the ring around the keyboard and put its bottom edge back over the inputs).
  The remaining time is `strokeDasharray = "<perim × fraction> <perim>"`, so the loop
  shrinks as the rest runs down. Turns solid emerald and pulses when done.
- **`RestReadout`** — the exact `m:ss` plus pause / +15s / skip, in **normal document
  flow at the very top of the page**. Scroll up to see it. It is not sticky on purpose:
  anything pinned to an edge is something that can end up over an input again.

Consequences, don't undo them:
- Bottom padding is a constant `pb-24` (nav clearance). The old `pb-24`/`pb-44` switch
  existed only to dodge the timer bar and is gone.
- **Nothing may be added that is fixed to the bottom of the screen** except the nav and
  the keyboard accessory bar, which is deliberately tied to the keyboard's own position.

### 9b. Phone keyboard rules for numeric fields

Three separate iOS behaviours, all of which have bitten this app:

1. **`type="number"` renders a decimal point that does nothing on iOS.** Entering 7.5 kg
   was impossible — it had to be logged as 7. All weight fields are therefore
   `type="text"` + `inputMode="decimal"`, and values are parsed by `toNumber()`, which
   also normalises the comma some locales' keypads emit. **Do not "tidy" these back to
   `type="number"`.** Rep fields are `type="text"` + `inputMode="numeric"`.
2. **The iOS numeric keypad has no return key at all**, so `enterkeyhint` cannot give you
   a Next or Done — there's no key to put the hint on. `KeyboardAccessory` draws our own
   toolbar instead, positioned with `visualViewport` (`window.innerHeight - vv.height -
   vv.offsetTop`), which is the only reliable way to know where the keyboard actually is.
   Its buttons `preventDefault()` on mousedown so focus never leaves the input and the
   keyboard doesn't flicker shut between fields.
3. The bar's action is **"Next" on the weight field** (focuses and selects reps) and
   **"Record the set" on the reps field** (logs it, starts the rest timer, drops the
   keyboard). That's the whole point: log a set without moving your finger off the keypad.
   On focus each input is `scrollIntoView({block:"center"})` after 300 ms, because iOS
   only guarantees the input clears the *keyboard* — it knows nothing about our bar.

`tests/test-flow.mjs` covers the whole weight → Next → reps → Record path, and asserts the
fields still request the right keypads.

### Other layout notes

- Avoid `ml-auto` on buttons inside `overflow-hidden` cards — it previously pushed
  buttons outside the clip region and made them invisible.
- `KeyboardAccessory` renders through a **portal to `document.body`** so no card's
  overflow or stacking context can clip it.

---

## 10. Deploying

Remote is already set: `https://github.com/ramzeus3010/WorkoutELO.git`.

**1. GitHub Pages** — push `main`, then on github.com: **Settings → Pages → Source:
"Deploy from a branch" → Branch `main`, folder `/ (root)` → Save.** First build takes
1–2 minutes. The app then lives at:

```
https://ramzeus3010.github.io/WorkoutELO/dist/
```

Open that in a normal browser first and confirm it renders — outside Telegram it falls
back to `localStorage`, so it's fully usable as a sanity check. If the page is blank,
check the browser console: a 404 on `app.js` means Pages hasn't finished building, or the
folder setting is wrong.

**2. BotFather** (in Telegram, talk to [@BotFather](https://t.me/BotFather)):

| Command | What to answer |
|---|---|
| `/newbot` | display name, then a username ending in `bot` — save the token it gives you, even though this app doesn't use one |
| `/newapp` | pick the bot → title, short description, a 640×360 icon, then paste the Pages URL above |
| `/setmenubutton` | pick the bot → paste the same URL → set the button label (e.g. "Open Chetamba") |

`/newapp` requires an image; anything 640×360 works, it can be replaced later.

**3. Updating.** `npm run build`, commit `dist/app.js`, push. Users get the new version on
next open — no reinstall, no store review. Telegram caches the webview aggressively; if a
change doesn't appear, fully close the mini app (swipe it away, don't just background it)
and reopen.

### 10a. The bot itself

Current bot: **@workoutelobot**, app short name `chetamba`, direct link
`https://t.me/workoutelobot/chetamba`.

⚠️ **BotFather does not make a bot answer messages.** It registers the bot and the Mini App,
nothing more. `/start` reaches whatever URL is registered as the bot's webhook, and if
nothing is listening the bot looks dead — even while the direct link works perfectly,
because a direct-link Mini App is opened by Telegram itself with no bot logic involved.
That was the "my bot doesn't do anything" symptom on 2026-08-13.

`bot/worker.js` is the listener. Cloudflare Worker, free tier, stateless. Setup steps are
in `bot/README.md`; the short version:

1. `wrangler secret put BOT_TOKEN` / `WEBHOOK_SECRET`, then `wrangler deploy`.
2. Register the webhook: `api.telegram.org/bot<TOKEN>/setWebhook?url=<worker>&secret_token=<secret>`.
3. When the bot goes quiet, `getWebhookInfo` and read `last_error_message` — that's where
   the answer is, every time.

Design rules for the worker, don't break them:

- It **always returns 200**, even on an error. Telegram redelivers any update that isn't
  2xx, so a thrown exception turns one bad message into a retry storm.
- It checks the `x-telegram-bot-api-secret-token` header. Without that the endpoint is a
  public URL that anyone can post fabricated updates to.
- `web_app` buttons only work in **private chats**. In groups it falls back to the plain
  direct link, otherwise Telegram rejects the message and the user sees nothing at all.
- `BOT_TOKEN` is full control of the bot. It is a Worker secret and must never be committed
  or shipped to the client.

**The shared-link preview is a separate thing.** The card people see when the
`t.me/workoutelobot/chetamba` link is pasted into a chat comes from the Mini App's own
photo/title/description in BotFather (`/myapps`), not from the worker. Both halves have to
be set to look finished — see the table in `bot/README.md`.

---

## 11. Open items

- [ ] **Never deployed or opened in a real Telegram client.** All testing is jsdom.
      Real-device layout/sizing is unverified, and CloudStorage has never actually run —
      every test so far has exercised the `localStorage` fallback path only.
- [ ] **Verify on device after the UI rework** (2026-08-12): the edge ring, the keyboard
      accessory bar, and 18px base sizing have only ever run in jsdom. Specifically check
      that the ring is visible on a notched screen with `viewport-fit=cover`, and that
      starting a rest timer while scrolled down doesn't jump the page (the readout is
      inserted at the top of the flow; browser scroll anchoring should absorb it).
- [ ] **Lower B still has hip thrusts**, which he said he doesn't want. Needs a
      replacement (back extension or a hamstring curl machine) — ask before swapping.
- [ ] Duration exercises (planks, rowing erg) are logged as seconds in the reps field.
      A dedicated duration input would be better.
- [ ] Lateral raise mid-back pain — monitor; medical attention if it persists.
- [ ] Row form: he reported not feeling his back. Cue is elbow back/down, pause and
      squeeze the shoulder blade, don't shrug or pull with the arm.
- [ ] **Export is copy-only, and restore doesn't exist.** You can get a JSON backup out
      (§8a) but there is no import to put it back. Until that's built, the backup protects
      against Telegram losing the data, not against a bad write inside the app.

---

## 12. Next session — editable / custom exercises

Agreed on 2026-08-12 as the next piece of work: **be able to change the exercises in a day
and add your own.** Right now `PROGRAM` is a hard-coded `const` and the only escape hatch
is "add custom exercise", which creates an unnamed entry that the rating engine ignores.

This is not a UI job. Four things in the current design assume a fixed program, and each
one has to be answered before writing code:

**1. Exercises are keyed by display name.** The coach does
`lastSameDay.exercises.find((e) => e.name === pe.name)`, the charts group by name, and
`EXERCISE_META` is a name-keyed object. **Rename a lift and its entire history detaches.**
Editing almost certainly means giving exercises a stable `id` and treating the name as a
label. That's a storage migration for any session already saved.

**2. `PROGRAM` has to move into CloudStorage.** A new key (`program_v1`) subject to the
same 4096-char-per-value limit as everything else in §5 — the full 4-day split with links
and targets will be close to that ceiling, so it probably needs splitting per day
(`program_UpperA`…). Existing users need a fallback to the built-in default when the key
is absent.

**3. The rating engine needs a benchmark for a lift it has never heard of.** `EXERCISE_META`
gives each exercise a `multiplier` (how much it counts) and an `avg` (the "average person"
benchmark for your bodyweight). A user-added lift has neither. Options, roughly in order of
how well they fit what he's already asked for:

  - **Ask what it replaces**, and inherit that exercise's meta. Fits the actual use case —
    the machine he wants is taken, so he swaps in a near-equivalent.
  - **Pick a movement pattern** (horizontal push / vertical pull / squat / hinge /
    isolation / core / conditioning) and derive a multiplier and a bodyweight-relative
    `avg` from the pattern.
  - **Track-only**: it logs but doesn't score. Simplest, and wrong for the main use case.

**4. The trap: §6 rule 3 says untouched exercises decay toward neutral, so skipping a lift
slows the climb.** If a swapped-in exercise is treated as *new* rather than as a
*substitution*, the lift it replaced reads as untouched and his rating quietly slows down
**for doing the workout correctly**. Whatever design gets picked, a substitution must
inherit the replaced exercise's coverage, not sit alongside it. This is the thing most
likely to silently break, and it directly contradicts a rule he explicitly asked for.

**Decided 2026-08-13: both.** He substitutes for himself when a machine is taken
(one session, doesn't change the split), *and* he wants friends to build their own programs
from scratch (persistent). So this needs two distinct actions in the UI, not one blurred
"edit" — a today-only swap and a permanent program change behave differently in the rating
and should not be reachable from the same button.

Implied by "friends build their own": the built-in 4-day split stops being *the* program
and becomes the default for a new user. Everything in §7's coach and §6's rating that reads
`PROGRAM` has to read the user's program instead.

### 12a. AI-generated programs — the blocker to solve first

Raised 2026-08-13: friends describe what they want, an LLM generates a program. Fine idea.
Two things have to be true before any of it gets written:

**1. The API key cannot live in the client.** This is the same wall §7 already hit: an
earlier version called the Anthropic API from the browser and was torn out because the key
had to ship inside client-side code. Nothing has changed — `dist/app.js` is a public file
on GitHub Pages, so a key in it is a key published to the internet. Whoever's key it is
gets drained. Cost isn't the issue (a program generation is a fraction of a cent, so a $10
balance is plenty of runway); **exposure** is.

The fix is a server-side proxy, and `bot/` is already the right place — a Cloudflare Worker
with the key as a secret. The client sends the user's request, the worker calls the model
and returns the result. The key never reaches the phone.

**2. A public proxy is a free LLM for the entire internet.** Anyone who reads the bundle
finds the worker URL and can hammer it. Mitigation is Telegram's own signature: the Mini App
receives `initData` signed with the bot token, so the worker can verify with HMAC that a
caller is a real user of this bot, and rate-limit per user id. **Do not ship the proxy
without this.** It's the difference between a $0.30/month bill and a drained account.

Also worth settling before building: a generated program still needs `multiplier` and `avg`
values per exercise for the rating to work at all (see point 3 above), so generation and the
custom-exercise metadata problem are the same problem — solve that first, and generation
becomes "fill in the same fields a human would have".

---

## 13. Maintaining this doc

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
| 2026-08-12 | Repo was flat and unbuildable — no `src/main.jsx`, no `tests/`, and a stale `app.js` predating the Lower A rework. Restored the documented layout, wrote the missing entry point, and rebuilt. |
| 2026-08-12 | Wrote the two missing suites (`smoke.mjs`, `test-flow.mjs`) that `npm test` already referenced, and extracted the jsdom setup into `tests/dom.mjs` so all three share one harness. Added a `ResizeObserver` stub — without it recharts throws in jsdom and the Progress tab can't be tested at all. |
| 2026-08-12 | Surfaced the §6 dumbbell-benchmark caveat in `RatingCard`. The doc claimed it was shown to the user; it only existed as a source comment. Now rendered, and asserted by `test-flow.mjs`. |
| 2026-08-12 | **Rest timer bar → screen-edge ring** (§9a). The bar was pushed up by the keyboard and covered the inputs being typed into. Nothing is pinned to the bottom of the screen any more, and the `pb-24`/`pb-44` switch is gone with it. |
| 2026-08-12 | **Phone keypad fixes** (§9b): weight fields are `type="text"` + `inputMode="decimal"` so the decimal point actually works (7.5 kg was unenterable), and a custom `KeyboardAccessory` bar gives Next / Record-the-set, because iOS's numeric keypad has no return key to hang `enterkeyhint` on. |
| 2026-08-12 | Brand accent orange → **maroon `#410038`**, defined as a `maroon-*` scale in `tailwind.config` (§9). Base font size 16 → 18px as a single global dial. App renamed to **Chetamba**, which also settles the old two-names open item. |
| 2026-08-13 | **Export** added to the Profile tab (§8a): readable markdown for review, lossless JSON for backup, with a range selector. Closes the long-standing "no export/backup" item; restore is still missing. |
| 2026-08-13 | **Bot answers `/start`** (§10a). `bot/` is a Cloudflare Worker webhook — the first and only server-side code in the project, and it never sees workout data. The bot looked broken because BotFather registers a bot but doesn't reply for it, and nothing was listening. |
| 2026-08-13 | Corrected the Profile privacy notice, which still claimed the leaderboard published your name and rating to "anyone with this artifact's link". That stopped being true when the leaderboard became share/paste (§8). |
