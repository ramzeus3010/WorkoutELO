# Chetamba — state of the project

*A briefing document, written to be pasted into a fresh conversation. Assumes no prior
context. Last updated 2026-08-17 17:05.*

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

### Who it's for — this has changed

Originally built for one person: Ramazan. 186 cm, ~76 kg, "skinny fat", wants visible
upper-body muscle and less abdominal fat. Trains between an apartment-building gym and a
commercial gym with machines.

**As of 2026-08-17 the goal is explicitly multi-user:** a small friend group, competing via a
Telegram group chat where a bot posts scores. That decision drove most of the work below.

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
| App code | Built, **10** automated test suites passing |
| GitHub Pages hosting | **Live** |
| Mini App registered with BotFather | **Yes** |
| Bot Worker deployed and answering | **Yes — confirmed 2026-08-17** |
| Cross-user scoring engine (`src/scoring.js`) | **Built and tested (52 checks)** |
| Pattern stamping on logged entries | **Built** |
| Old personal rating retired | **Done** — one score now |
| Activity / ad-hoc session types | **Done** — `tests/test-activity.mjs` |
| Onboarding + program templates | **Done** — `tests/test-onboarding.mjs` |
| Bot: KV, `/score`, publish-on-finish, crons | **Written and tested — NOT YET DEPLOYED** |
| Other users | **Zero.** Nobody but the author has used it |

### Built and working

- **Logging** — 4-day upper/lower split; weight × reps per set; drop sets; per-exercise
  notes; per-exercise rest timers; form-video links.
- **Autosave** — in-progress workout written on a 700 ms debounce, restored on reopen. The
  most heavily tested behaviour in the app, because a lost workout already happened once.
- **Rest timer** — a ring drawn around the screen edge that shrinks as time runs down.
- **Local coach** — rule-based, no AI, no network. Pain words override everything.
- **Rating + tiers**, with per-exercise progress charts.
- **Export** — copy history as readable markdown or lossless JSON.
- **Editable program + substitution.**

### Stack

React 18 + esbuild → a single ~620 KB bundle, committed to the repo and served statically.
Tailwind via the Play CDN. recharts, lucide-react. Tests are jsdom driving the real UI, plus
one buildless pure-maths suite. ~3,000 lines in `app.jsx` (single-file by design) and a
separate `src/scoring.js`.

---

## 3. Architecture

**There is no server and no database for workout data.** It lives in **Telegram
CloudStorage**, which is per-Telegram-user storage Telegram hosts for free. The app is static
files.

That gives: zero cost, zero maintenance, no privacy policy to write, nothing to breach, and
sync across a user's own devices for free. It costs: **users cannot see each other's data.**

**The social layer resolves this without a real backend.** The existing Cloudflare Worker
becomes a *publish-only relay*: the client posts a small summary (name, scores, exercise
names) when a workout finishes; the Worker verifies it and forwards it to the group chat.
CloudStorage stays the sole source of truth for workout data. Cloudflare KV holds only what
the group already sees.

- `/score` **requires** KV. When someone types it, no client is running, so the Worker must
  answer from its own state.
- **Store the inputs, not the finished numbers.** Effort decays with time; a cached total goes
  stale and lies. Keep session dates and recompute at read time.
- **`src/scoring.js` is shared by the app and the Worker.** Two implementations of the same
  maths would drift and the group board would disagree with the app. Plain ESM, no imports,
  no DOM — importable by esbuild, node, and a Worker.

---

## 4. The scoring model (rewritten 2026-08-17)

### Why the old rating couldn't be a leaderboard

The original rating is program-relative and deliberately forgiving. Three properties make it
non-comparable between people:

1. **Your program is the denominator**, so deleting a lift you're bad at raises your rating —
   a cheat button in the settings menu once friends can see it.
2. **Untouched slots pull toward neutral**, so a 6-lift program suffers less drag than an
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
per-activity `ceiling` stops "I logged a 14-hour hike" with no decline required. Hiking:
5h = 1.93, 7h = 2.08, 9h = 2.15 — flat where a decline was wanted, but never reversing.

### The same principle, twice more

- **Strength uses your best per slot, decayed by how recently you last trained that pattern.**
  Two separate facts, deliberately not conflated. Using your *most recent* performance meant a
  deload week or one bad day lowered your score — it paid you not to log them. Dating the
  decay from the *best* instead punished consistency: bench the same weight every week and the
  best's date never moves, so you'd go stale while actively training the lift. Best answers
  "what can you do"; last-trained answers "is it current".
- **Decay fades toward average (1.0), never toward untrained (0.5)**, so neglecting a lift you
  have trained can never drag you below average.
- **No layoff penalty.** Removed with the personal rating. Time off is already visible on the
  weekly effort axis and in per-pattern decay; deducting a third time punished one absence
  three ways.

### Consequence worth knowing

Skipping a single session no longer costs strength directly — the pattern keeps its best,
decayed by time. **Showing up is measured on the effort axis now**, and that's deliberate: the
strength number answers "how strong are you", not "how diligent have you been". The two used
to be fused because there was only one number.

---

## 5. Hard constraints and gotchas

Accumulated the expensive way. Check any proposal against these.

### Telegram platform

| Constraint | Consequence |
|---|---|
| CloudStorage: **4096 chars per value**, 1024 keys per user | Sessions and program days stored one key each, never as one blob |
| CloudStorage is **per-user and isolated** | One user's app **cannot** read another's |
| BotFather registers a bot but **does not answer messages** | `/start` needs a webhook and a server listening |
| `web_app` buttons only work in **private chats** | In groups, fall back to a plain link or the message silently fails |
| Telegram redelivers any webhook update you don't answer with 200 | A thrown error becomes a retry storm |
| Telegram caches the webview aggressively | After an update, fully close the Mini App, don't just background it |

### iOS, learned from real gym use

| Gotcha | Fix in place |
|---|---|
| `type="number"` renders a decimal point that **does nothing** on iOS | Weight fields are `type="text"` + `inputMode="decimal"`. 7.5 kg was unenterable before |
| The iOS numeric keypad **has no return key** | Custom toolbar drawn above the keyboard using `visualViewport` |
| Bottom-fixed elements get pushed up by the keyboard onto the input you're typing into | Rest timer became a screen-edge ring. Nothing is bottom-pinned except the nav |

### Build and styling

- `dist/app.js` is **committed on purpose** (Pages has no build step). **Rebuild before every
  push** or the deployed app silently stays on old code.
- The brand colour is a `tailwind.config` block in `index.html`. If it breaks, every accent
  class compiles to nothing and **the buttons turn invisible**. jsdom runs no CSS, so **no
  test can catch this** — it needs a real browser check.
- Base font size is a single `html { font-size: 18px }` dial.

### Data model

- Exercises are keyed by **stable id, not display name**. Old sessions migrate on read.
- Logged entries now carry their **movement pattern**, stamped at log time by `logEntryFor`,
  so a session logged today still scores correctly after the program is edited tomorrow.
  History predating this is backfilled on read by `hydratePatterns` — which deliberately does
  **not** rewrite storage, because a migration touching every session can half-fail and export
  is copy-only.
- **Export is copy-only. There is no import/restore.**

### The AI constraint

**An API key cannot ship in the client.** The bundle is public. This already happened once and
had to be torn out. The fix is the Worker as a server-side proxy, with Telegram's `initData`
signature verifying the caller is a real user of this bot, plus per-user rate limiting.
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
| **Fixed pattern slots for the ranked score** | The only way two people's numbers mean the same thing |
| **Strength and effort kept separate** | Merged, "strength" would just mean stamina for logging |
| **Saturating curves everywhere, never declining** | Self-reported data: honest logging must never cost points |
| **Everyone starts at 800, no calibration** | A first week where the score is meaningless wastes the hook |
| **Retire the personal rating** | Two near-identical numbers that disagree reads as a bug. Ranked score becomes the only score |
| **Off-program exercises are scored** | Under fixed slots every exercise maps to a pattern, so the old "logged but not scored" rule was just a missing feature. Shipped |
| **Activities earn effort, never strength** | A pickup game has no load and no reps; any strength number for it would be invented |
| **Challenges must never stake strength points** | Losing a bet would make the number mean "how strong you are, minus bets lost" — killing comparability and reintroducing punishment |

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
rush. **Flagged as the priority to solve after the current build.** Candidate answers, cheapest
first:

1. **Per-slot tiers.** Twelve sub-ratings instead of one number ("Gold bench, Silver squat,
   **Bronze hinge**"), so there's always a visible next goal even at 1800 overall, and it
   pushes the balanced training the score already rewards. The data is already returned in
   `strengthScore().slots` — this is a rendering job, not a maths job.
2. **Monthly seasons** on the effort axis, with recorded winners.
3. **Challenges / 1v1s.** Player-generated, so it never runs out. Cheap once KV and the bot
   exist. Must pay out in a separate currency (see §6).

### Product gaps

- No import/restore to match the export.
- No way to edit or correct a past session.
- Duration work is logged as **seconds typed into the reps field**. Needs a real input.
- UI copy can go stale when the maths changes and nobody re-reads the strings. One case was
  already caught in the wild: the log screen still said one-off exercises "don't count toward
  your rating" after that rule was deleted. **Sweep user-facing copy whenever scoring
  changes** — a test now pins that particular sentence down.

### Unverified

- Whether the newest UI has been re-checked on a real phone since it shipped.
- Whether Telegram CloudStorage has *ever* actually run. Every test to date has exercised the
  `localStorage` fallback path.

### Health

- The lateral-raise mid-back pain is monitored by the coach but unresolved medically.

---

## 8. Roadmap

Settled: it's a small product for a real user base — a friend group competing in a Telegram
group chat. The §8 questions in the previous revision are resolved and folded into §4 and §6.

1. ~~Retire the personal rating.~~ **Done.** `computeEloTrajectory` is now a thin adapter over
   `strengthScore` — it keeps the `{ trajectory, rating, coverage }` shape so the chart, tier
   card, export and leaderboard kept working, but the Elo replay loop is gone. The trajectory
   is recomputed per date from the log as it stood, which is slower but order-independent.
   `coverage` now carries a per-pattern rating, so **per-slot tiers (§7) are a render away**.
2. ~~Activity + ad-hoc session types.~~ **Done.** Sessions now carry `kind: "lift" | "activity"`
   (old records default to `"lift"` on read). The Log tab has a Lift/Activity toggle; activities
   store `activityType` + `minutes` and render as their own one-line row in History rather than
   as an empty workout. An **Ad-hoc** pseudo-day sits alongside the program days — a blank
   session you build as you go, which is how improvised gym work gets logged without editing
   your split. One-off exercises now expose a **movement-pattern picker** and are scored like
   anything else; the UI copy claiming they don't count has been corrected.
3. ~~Onboarding.~~ **Done.** First run asks for name + bodyweight (+ optional height), then
   offers three starting programs — full body 3-day, upper/lower 4-day, dumbbells-only — or
   skipping the program entirely. **Bodyweight is the only thing it insists on**, because
   without it every load benchmark divides by nothing and the score sits at baseline with no
   explanation. The program is skippable precisely because under fixed pattern slots it no
   longer affects your score.
   - Onboarding is **skippable, not a wall** — a blocked first screen is a worse failure than
     a missing number that can be nagged about later. Gated on `onboarded_v1` in storage.
   - **`DEFAULT_PROGRAM` is no longer anyone's default**, which retires the hip-thrust
     problem. A test asserts no template reintroduces it.
   - Templates carry a `pattern` per exercise, so a fresh program scores from session one.
4. ~~The bot.~~ **Written and tested; awaiting deploy.** `bot/relay.js` holds identity,
   storage and standings; `bot/worker.js` routes `/api/{join,publish,me}`, the `/register`
   and `/score` group commands, and two crons.
   - **Identity is `initData` only** — never the request body. `tests/test-relay.mjs` checks
     tampered, wrong-token, stale and user-less payloads against real HMAC, plus a
     constant-time hash compare.
   - **Publishing is idempotent per session id**, so a retried publish can't be paid twice.
   - **Fire-and-forget from the client**, and only after the local write succeeded: a failed
     publish must never surface as a failed workout.
   - The ledger keeps 60 days of `{date, effort}`; the weekly figure is recomputed at read
     time via the *same* `weeklyEffort()` the app uses (it now takes an effort accessor, so
     there is still exactly one implementation of the week rule).
   - `RELAY_URL` in `app.jsx` is a **guess at the workers.dev subdomain and must be confirmed.**
5. **The motivation curve** (§7) — the priority after the above.
6. **AI program generation** — last, and genuinely optional. Needs schema validation against
   the 13 known pattern ids, an explicit check against stated exclusions (it *will* produce
   RDLs for someone who said no RDLs), and review-before-commit in the existing editor.

### Waiting on Ramazan

- ~~A KV namespace id.~~ Created and bound in `bot/wrangler.toml`
  (`dbeecc7987a94570be7662302771f88a`).
- **Confirm the Worker URL.** `RELAY_URL` in `src/app.jsx` is currently a guess
  (`https://chetamba-bot.ramzeus3010.workers.dev`). Wrong value = publishing silently
  no-ops. `npx wrangler deployments list` from `bot/` prints the real one.
- **Deploy:** `npx wrangler deploy` from `bot/`. Adds the KV binding and both cron triggers.
- **Rebuild and push `dist/app.js`** — Pages has no build step, so the deployed app stays on
  old code otherwise.
- **Add the bot to the group chat**, run `/register`, paste the code into Profile → Group
  leaderboard.
- **An Anthropic API key**, for step 6 only — set via `npx wrangler secret put
  ANTHROPIC_API_KEY`, never pasted into a chat or a file.

### Settled configuration

- League week: **Monday–Sunday, fixed UTC+5 (Almaty)** for everyone, not per-user local. A
  shared deadline is the point — the Sunday-evening nudge only works if everyone races the
  same clock. `WEEK_TZ_OFFSET_MIN` in `src/scoring.js`.
- Combined score: **40 strength / 60 effort**.
