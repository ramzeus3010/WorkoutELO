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

import {
  verifyInitData, readUser, writeUser, emptyUser, applyPublish,
  standingFor, groupStandings, rankChange, makeJoinCode,
  codeKey, memberKey, groupKey, leagueTodayISO, weekStartISO,
} from "./relay.js";

// Cron expressions are UTC; the league runs on UTC+5 (Almaty). Monday 08:00 and Sunday 19:00
// local. These must match wrangler.toml exactly — runCron() compares the string, so a typo
// means the trigger fires and silently does nothing.
// Cloudflare's day-of-week is 1-7 (Mon-Sun), not the standard cron 0-6.
const MONDAY_CRON = "0 3 * * 1";
const SUNDAY_CRON = "0 14 * * 7";

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

// The Mini App is served from GitHub Pages, a different origin, so the browser preflights
// every POST to /api/*. Restricted to the known origin rather than "*" — this endpoint
// accepts writes, so it shouldn't be callable from any page that fancies it.
function corsHeaders(env) {
  return {
    "access-control-allow-origin": env.APP_ORIGIN || "https://ramzeus3010.github.io",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
  };
}

const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(env) },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // A plain GET is how you check the worker is up without going through Telegram.
    if (request.method === "GET") {
      return new Response("chetamba bot: alive. POST here from Telegram's webhook.", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(url.pathname, request, env);
      } catch (err) {
        console.error("api failed", err && err.stack ? err.stack : err);
        return json(env, { ok: false, error: "server error" }, 500);
      }
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

  // Two fixed beats a week, both in league time (UTC+5). Monday opens the new week, Sunday
  // evening is the nudge that actually gets someone off the couch while it still counts.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(event.cron, env));
  },
};

// ---------- The Mini App's API ----------
async function handleApi(pathname, request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json(env, { ok: false, error: "bad json" }, 400); }

  // Identity comes from Telegram's signature, never from the request body. A client that
  // simply claims to be user 12345 gets nowhere.
  const caller = await verifyInitData(body.initData, env.BOT_TOKEN);
  if (!caller) return json(env, { ok: false, error: "unverified" }, 401);

  const today = leagueTodayISO();
  const existing = (await readUser(env, caller.id)) || emptyUser(caller.id, caller.firstName);

  if (pathname === "/api/join") {
    const code = String(body.code || "").trim().toUpperCase();
    const groupId = code ? await env.CHETAMBA.get(codeKey(code)) : null;
    if (!groupId) return json(env, { ok: false, error: "That code isn't valid. Ask for a fresh one with /register in the group." }, 400);

    // Leaving an old group shouldn't strand a membership key pointing at this user.
    if (existing.groupId && existing.groupId !== groupId) {
      await env.CHETAMBA.delete(memberKey(existing.groupId, caller.id));
    }
    const joined = { ...existing, groupId, name: body.name || existing.name || caller.firstName };
    await writeUser(env, joined);
    await env.CHETAMBA.put(memberKey(groupId, caller.id), "1");

    const title = (await env.CHETAMBA.get(groupKey(groupId))) || "the group";
    await tg(env, "sendMessage", {
      chat_id: groupId,
      text: `*${escapeMd(joined.name)}* joined the board.`,
      parse_mode: "Markdown",
    });
    return json(env, { ok: true, groupTitle: title });
  }

  if (pathname === "/api/publish") {
    const before = existing.groupId ? await groupStandings(env, existing.groupId, today) : [];
    const updated = applyPublish(existing, body, today);
    await writeUser(env, updated);

    // No group yet is fine — the score is still recorded, there's just nowhere to announce it.
    if (!updated.groupId) return json(env, { ok: true, posted: false, standing: standingFor(updated, today) });

    const after = await groupStandings(env, updated.groupId, today);
    const moved = rankChange(before, after, caller.id);
    await tg(env, "sendMessage", {
      chat_id: updated.groupId,
      text: finishedMessage(updated, body, standingFor(updated, today), moved),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    return json(env, { ok: true, posted: true, standing: standingFor(updated, today) });
  }

  if (pathname === "/api/me") {
    const standings = existing.groupId ? await groupStandings(env, existing.groupId, today) : [];
    return json(env, { ok: true, standing: standingFor(existing, today), groupId: existing.groupId, standings });
  }

  return json(env, { ok: false, error: "unknown endpoint" }, 404);
}

// ---------- Message rendering ----------
// Telegram's legacy Markdown treats these as syntax; a name containing one breaks the whole
// message, and Telegram rejects it rather than sending it plain.
function escapeMd(s) {
  return String(s == null ? "" : s).replace(/([*_`\[\]])/g, "\\$1");
}

function finishedMessage(user, payload, standing, moved) {
  const lines = [];
  if (payload.kind === "activity") {
    lines.push(`🏃 *${escapeMd(user.name)}* — ${escapeMd(payload.label || "activity")}, ${payload.minutes || 0} min`);
  } else {
    lines.push(`🏋️ *${escapeMd(user.name)}* finished ${escapeMd(payload.label || "a workout")}`);
    const names = (payload.exercises || []).slice(0, 6).map(escapeMd);
    if (names.length) lines.push(`_${names.join(" · ")}_`);
  }
  lines.push("");
  lines.push(`Strength *${standing.strength}* · this week *${standing.effort.toFixed(1)}* effort over ${standing.sessions} session${standing.sessions === 1 ? "" : "s"}`);
  if (moved) {
    lines.push(`📈 Up to *#${moved.to}*, past ${moved.passed.map(escapeMd).join(" and ")}.`);
  }
  return lines.join("\n");
}

function boardMessage(standings, asOfIso, title) {
  if (standings.length === 0) {
    return "Nobody has joined the board yet. Run /register here, then paste the code into the app.";
  }
  const medal = ["🥇", "🥈", "🥉"];
  const rows = standings.map((s, i) =>
    `${medal[i] || `${i + 1}.`} *${escapeMd(s.name)}* — ${s.total.toFixed(1)}  _(str ${s.strength} · eff ${s.effort.toFixed(1)})_`
  );
  return [
    `*${title}*`,
    `_week of ${weekStartISO(asOfIso)} · effort resets Monday_`,
    "",
    ...rows,
    "",
    "_Scores are as of each person's last logged workout._",
  ].join("\n");
}

// ---------- Cron ----------
async function runCron(cron, env) {
  // Explicit rather than "anything that isn't Sunday is Monday" — otherwise adding a third
  // trigger later would quietly start announcing weekly winners at the wrong time.
  if (cron !== MONDAY_CRON && cron !== SUNDAY_CRON) {
    console.error("unrecognised cron, ignoring:", cron);
    return;
  }
  const listed = await env.CHETAMBA.list({ prefix: "group:" });
  const today = leagueTodayISO();

  for (const key of listed.keys) {
    const groupId = key.name.split(":")[1];
    const standings = await groupStandings(env, groupId, today);
    if (standings.length === 0) continue;

    // Sunday evening: the deadline nudge, while there's still time to act on it.
    if (cron === SUNDAY_CRON) {
      await tg(env, "sendMessage", {
        chat_id: groupId,
        text: boardMessage(standings, today, "⏳ Final hours of the week"),
        parse_mode: "Markdown",
      });
      continue;
    }

    // Monday: name last week's winner, then everyone's effort is back to zero.
    const winner = standings[0];
    await tg(env, "sendMessage", {
      chat_id: groupId,
      text: [
        `*New week.* Effort is back to zero for everyone.`,
        "",
        `Last week: 🥇 *${escapeMd(winner.name)}* on ${winner.total.toFixed(1)}.`,
      ].join("\n"),
      parse_mode: "Markdown",
    });
  }
}

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

  // Turns this chat into a leaderboard and hands back a code to paste into the app. Issuing a
  // fresh code each time is deliberate: it's how you re-invite people without any admin UI.
  if (command === "register") {
    if (isPrivate) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "Run /register inside the group chat you want to compete in." });
      return;
    }
    const code = makeJoinCode();
    // Codes expire so a screenshot in an old chat can't be used to join months later.
    await env.CHETAMBA.put(codeKey(code), String(chatId), { expirationTtl: 7 * 24 * 60 * 60 });
    await env.CHETAMBA.put(groupKey(String(chatId)), msg.chat.title || "this group");
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: [
        "*This chat is now a leaderboard.*",
        "",
        `Open Chetamba → Profile → Join group, and paste: \`${code}\``,
        "",
        "_Code works for 7 days. Run /register again for a fresh one._",
      ].join("\n"),
      parse_mode: "Markdown",
    });
    return;
  }

  if (command === "score" || command === "top") {
    const today = leagueTodayISO();
    // In a group, show that group. In a DM, show the board you belong to.
    let groupId = isPrivate ? null : String(chatId);
    if (isPrivate) {
      const me = msg.from && (await readUser(env, String(msg.from.id)));
      groupId = me && me.groupId;
    }
    if (!groupId) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "You're not on a board yet. Run /register in your group chat to start one." });
      return;
    }
    const standings = await groupStandings(env, groupId, today);
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: boardMessage(standings, today, "🏆 Standings"),
      parse_mode: "Markdown",
    });
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
