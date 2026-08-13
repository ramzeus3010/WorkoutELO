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
```

Optionally, to put an image above the `/start` message too, upload one to
`dist/preview.png`, uncomment `PREVIEW_IMAGE_URL` in `wrangler.toml`, and redeploy.

## Updating

Edit `worker.js`, then `wrangler deploy`. Nothing else needs redeploying — the bot and the
Mini App are independent. Changing the app itself is still just `npm run build` + push.

## Cost

Cloudflare's free tier is 100k requests/day. A bot with a handful of users will use a few
dozen. This will not cost anything.
