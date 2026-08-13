/**
 * Chetamba bot — a Telegram webhook handler that runs on Cloudflare Workers.
 *
 * WHY THIS EXISTS
 * BotFather registers a bot and its Mini App, but it does not answer messages. Telegram
 * posts every /start to whatever URL you register as the webhook; if nothing is listening,
 * the bot appears dead even though the Mini App link works fine. That was the bug.
 *
 * WHY A WORKER
 * There is no server in this project on purpose (§2 of workout_tracker.md) and this doesn't
 * really add one: a webhook is stateless, runs only when someone messages the bot, and fits
 * inside Cloudflare's free tier. It is also the natural place to put a server-side API proxy
 * later if the AI-generated-program idea happens, so the API key never ships to the client.
 *
 * CONFIG (set with wrangler, see bot/README.md — never commit these)
 *   BOT_TOKEN       secret. From BotFather. Full control of the bot; treat like a password.
 *   WEBHOOK_SECRET  secret. Echoed by Telegram in a header so randoms can't POST fake updates.
 *   MINI_APP_URL    var.    https URL the Mini App is served from.
 *   DIRECT_LINK     var.    https://t.me/<bot>/<app> — used where web_app buttons aren't allowed.
 *   PREVIEW_IMAGE_URL var.  optional; if set, /start sends a photo card instead of plain text.
 */

const WELCOME = [
  "*Chetamba* — your training log.",
  "",
  "Four-day upper/lower split, a rest timer you can read from across the gym, and a rating that",
  "tracks whether you're actually getting stronger for your bodyweight.",
  "",
  "Everything is stored on your own Telegram account. No sign-up, no server, no ads.",
  "",
  "Tap below to open it. It picks up exactly where you left off — even mid-set.",
].join("\n");

const HELP = [
  "*How it works*",
  "",
  "• *Log* — pick the day, enter weight × reps, hit Record. Sets save as you go, so closing",
  "  the app mid-workout never loses anything.",
  "• *History* — every past session.",
  "• *Progress* — your rating, tier, and per-exercise charts.",
  "• *Profile* — bodyweight (the rating is relative to it) and *Export*, for pulling your whole",
  "  history out to review or back up.",
  "",
  "Commands: /start · /app · /help",
].join("\n");

export default {
  async fetch(request, env) {
    // A plain GET is how you check the worker is up without going through Telegram.
    if (request.method === "GET") {
      return new Response("chetamba bot: alive. POST here from Telegram's webhook.", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    // Telegram echoes the secret we registered with setWebhook. Without this check the
    // endpoint is a public URL that anyone can post fabricated updates to.
    if (env.WEBHOOK_SECRET) {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("ok"); // malformed body: swallow, don't make Telegram retry
    }

    try {
      await handleUpdate(update, env);
    } catch (err) {
      // Deliberately not rethrown. A non-2xx makes Telegram redeliver the same update on a
      // backoff, so one bad message would turn into a retry storm.
      console.error("handleUpdate failed", err && err.stack ? err.stack : err);
    }

    return new Response("ok");
  },
};

async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;
  const isPrivate = msg.chat.type === "private";
  const text = (msg.text || "").trim();

  // "/start@somebot arg" -> "start"
  const command = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;

  if (command === "start" || command === "app") {
    await sendOpenCard(chatId, isPrivate, WELCOME, env);
    return;
  }
  if (command === "help") {
    await sendOpenCard(chatId, isPrivate, HELP, env);
    return;
  }

  // Anything else. Keep it short — this fires on stray messages, so don't be chatty.
  await sendOpenCard(chatId, isPrivate, "Not a command I know. /start opens the app, /help explains it.", env);
}

function openMarkup(isPrivate, env) {
  // web_app buttons only work in private chats. In groups Telegram rejects them, so fall
  // back to the plain direct link, which opens the same Mini App.
  const button = isPrivate
    ? { text: "🏋️ Open Chetamba", web_app: { url: env.MINI_APP_URL } }
    : { text: "🏋️ Open Chetamba", url: env.DIRECT_LINK };
  return { inline_keyboard: [[button]] };
}

async function sendOpenCard(chatId, isPrivate, body, env) {
  const reply_markup = openMarkup(isPrivate, env);

  if (env.PREVIEW_IMAGE_URL) {
    const res = await tg(env, "sendPhoto", {
      chat_id: chatId,
      photo: env.PREVIEW_IMAGE_URL,
      caption: body,
      parse_mode: "Markdown",
      reply_markup,
    });
    if (res.ok) return;
    // A bad or unreachable image URL shouldn't mean the user gets nothing back.
    console.error("sendPhoto failed, falling back to text:", res.description);
  }

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: body,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup,
  });
}

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch (e) {
    json = { ok: false, description: `non-JSON response (${res.status})` };
  }
  if (!json.ok) console.error(`${method} failed:`, json.description);
  return json;
}
