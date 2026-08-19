# Chetamba bot

Makes `/start` actually reply. Runs on Cloudflare Workers' free tier.

## Why the bot looked broken

`https://t.me/workoutelobot/chetamba` worked because that's a **direct link Mini App** —
Telegram opens the URL itself, no bot logic involved. But `/start` did nothing, because a
Telegram bot only replies if a server is listening for updates. BotFather registers the
bot; it doesn't answer for it. Nothing was listening. That's all this fixes.

## What you get

`/start` → a message describing the app with an **Open Chetamba** button that launches the
Mini App inside Telegram. Same for `/app`. `/help` explains the tabs. Anything else gets a
one-line nudge.

Since the group leaderboard landed, it also does:

| Command | Where | Does |
|---|---|---|
| `/register` | in a group | Turns that chat into a leaderboard and returns a 7-day join code |
| `/score`, `/top` | group or DM | Current standings, recomputed live |
| `/language`, `/lang` | group or DM | In a DM, your own language; in a group, the board's |

…plus it posts automatically when someone finishes a workout, announces the winner every
Monday, and nudges the group on Sunday evening.

### Languages

English and Russian, from the same dictionary the Mini App uses (`src/i18n.js`), so the bot
and the app never word the same thing differently.

Three settings, deliberately separate:

- **Per user.** Seeded from Telegram's `language_code` (Russian for `ru`/`kk`/`uk` and the
  rest of the post-Soviet set), confirmed with two buttons on a first `/start`, and changed
  later with `/language` or the switch in the app's Profile tab. Stored on the user's KV
  record. The app sends its current language with every publish, so flipping the switch there
  also changes the bot's DMs.
- **Per group.** Chosen at `/register` — seeded from whoever ran it, then offered as buttons.
  Every standings post, finish announcement and cron message in that chat uses it. A group
  post has many readers and can only be in one language, so this can't be per user.
- **A DM `/score`** uses the reader's own language even for a group's board. Same numbers,
  different wording.

### The API the Mini App calls

| Route | Does |
|---|---|
| `POST /api/join` | Redeems a join code, adds you to that group's board |
| `POST /api/publish` | Records a finished session and announces it to the group |
| `POST /api/sync` | Reconciles the stored score with the client's. Announces nothing |
| `POST /api/me` | Your standing plus the current board |
| `POST /api/program` | Generates a training program from a plain-text description |

Every one of them requires a valid Telegram `initData` signature — identity comes from the
signature, never from the request body, so claiming to be someone else gets nowhere. See
`relay.js` and `tests/test-relay.mjs`, which tests forged and replayed payloads against real
HMAC.

**What is stored server-side:** display name, Telegram id, published scores, and a 60-day
ledger of `{date, effort}` pairs. **Not** sets, reps, notes or programs — those never leave
CloudStorage on each user's own account. If the KV store were wiped, every client could
republish.

### Why `/api/sync` exists

`/api/publish` only fires when a workout is finished, so someone who joined a group and then
typed `/score` read as a blank 800 while their own app showed their real rating — the same
metric, one stale copy. `/api/sync` is the reconciling counterpart: the app sends its score
and ledger on open and on join, and the Worker replaces (not merges) what it holds. Replacing
is what lets a ledger that drifted because a publish was lost heal on the next app open.

### Program generation

`POST /api/program` takes a plain-text description and returns a validated program. This is
the only endpoint that costs money per call, so:

- **The key never reaches the client.** The Mini App bundle is public; an earlier client-side
  attempt had to be torn out for exactly this reason. Cost was never the blocker — abuse is.
- **Callers are verified** by `initData` like every other endpoint, and **rate limited** to 15
  generations per user per day (`aiquota:` keys in KV, self-expiring).
- **Output is schema-constrained.** The model must return JSON matching a fixed schema whose
  `pattern` field is an enum of the thirteen real movement-pattern ids — a hallucinated
  pattern would leave an exercise silently unscoreable.
- **Exclusions are checked, not trusted.** The model reports back what it understood the user
  to have ruled out, and the Worker rejects the program if any exercise name matches. It will
  otherwise happily produce a Romanian deadlift for someone who said no deadlifts, and the
  person asking is usually asking because of an injury.
- **Nothing is auto-saved.** The generated program lands in the editor as an unsaved change
  and the user still has to press Save.

Without `OPENAI_API_KEY` set, the endpoint returns a clean "not switched on yet" message and
the rest of the bot is unaffected.

**Provider.** This runs on OpenAI, called with plain `fetch` — one POST to
`/v1/chat/completions` with `response_format: json_schema` and `strict: true`, which is what
makes the schema binding rather than advisory. No SDK: it's a single call, and a bundled
dependency is one more thing that can break a Worker deploy.

Everything provider-specific lives in `callModel()` in `bot/program-ai.js` — about thirty
lines. The schema, validation, exclusion checks, prompts and app UI are all neutral, so
moving to a different provider means editing that one function. (It started on Anthropic and
moved in exactly one edit.)

**Model.** Defaults to `gpt-4o`. Point it somewhere else with an `OPENAI_MODEL` var in
`wrangler.toml` — no code change needed. Whatever you pick must support structured outputs
(`response_format: json_schema`); not every model does. No output-token ceiling is sent,
because the parameter that sets one was renamed across model generations and hard-coding
either spelling silently restricts which models you can point at.

## Setup (~10 minutes, once)

**1. Get the bot token.** In Telegram, [@BotFather](https://t.me/BotFather) →
`/mybots` → `workoutelobot` → **API Token**. Treat it like a password: anyone with it
controls the bot. Never commit it.

**2. Install wrangler and log in.**

```bash
npm install -g wrangler
wrangler login
```

**3. Make up a webhook secret.** Any random string, 1–256 chars of `A-Z a-z 0-9 _ -`.
This is how the worker knows an incoming request really came from Telegram.

**4. From this `bot/` directory, set the secrets and deploy.**

```bash
cd bot
wrangler secret put BOT_TOKEN        # paste the BotFather token
wrangler secret put WEBHOOK_SECRET   # paste the random string you invented
wrangler deploy
```

Deploy prints a URL like `https://chetamba-bot.<your-subdomain>.workers.dev`. Open it in a
browser — it should say `chetamba bot: alive`.

**5. Point Telegram at it.** Paste this into a browser, with your values filled in:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://chetamba-bot.<subdomain>.workers.dev&secret_token=<WEBHOOK_SECRET>
```

You should get `{"ok":true,"result":true,...}`. Now message the bot `/start`.

To check it later: `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` — look at
`last_error_message`, which is where the reason for a silent bot will be.

**6. Optional — turn on program generation.** Get a key from
[platform.openai.com](https://platform.openai.com/api-keys), then:

```bash
cd bot
wrangler secret put OPENAI_API_KEY   # paste it here, never into a file or a chat
wrangler deploy
```

To use a model other than the `gpt-4o` default, add `OPENAI_MODEL = "..."` under `[vars]` in
`wrangler.toml` and deploy again.

Skip this entirely and everything else still works — the generator just reports that it isn't
switched on. Each user is capped at 15 generations per day.

## The other half: the link preview

The card people see when the `t.me/workoutelobot/chetamba` link is **shared into a chat**
is *not* produced by this worker. Telegram builds it from the Mini App's own title,
description and photo. Set those in BotFather:

| BotFather step | Sets |
|---|---|
| `/myapps` → pick the app → **Edit Photo** (640×360) | the image in the shared-link card |
| `/myapps` → **Edit Description** | the text in the shared-link card |
| `/setdescription` | the blurb on the bot's empty chat, above the Start button |
| `/setabouttext` | the short "what can this bot do?" line on the profile |
| `/setcommands` | the `/` command menu next to the input box |

For `/setcommands`, paste:

```
start - Open Chetamba
app - Open Chetamba
help - How the app works
language - English / Русский
register - Turn this group into a leaderboard
score - Current standings
```

Optionally, to put an image above the `/start` message too, upload one to
`dist/preview.png`, uncomment `PREVIEW_IMAGE_URL` in `wrangler.toml`, and redeploy.

## Updating

Edit `worker.js`, then `wrangler deploy`. Nothing else needs redeploying — the bot and the
Mini App are independent. Changing the app itself is still just `npm run build` + push.

## Cost

Cloudflare's free tier is 100k requests/day. A bot with a handful of users will use a few
dozen. This will not cost anything.
