// Bot webhook tests.
//
// Worth having because the alternative is debugging through Telegram, where a broken
// handler just looks like a silent bot — exactly the symptom this worker exists to fix.
// No network: the Telegram API is stubbed and we assert on what would have been sent.

import worker from "../bot/worker.js";
import { check, finish } from "./dom.mjs";

const ENV = {
  BOT_TOKEN: "123:TEST",
  WEBHOOK_SECRET: "s3cret",
  MINI_APP_URL: "https://example.github.io/WorkoutELO/dist/",
  DIRECT_LINK: "https://t.me/workoutelobot/chetamba",
};

let sent = [];
let apiResponse = () => ({ ok: true, result: {} });

globalThis.fetch = async (url, init) => {
  const method = String(url).split("/").pop();
  const body = JSON.parse(init.body);
  sent.push({ method, body });
  const res = apiResponse(method, body);
  return { json: async () => res, status: 200 };
};

function post(update, { secret = "s3cret", env = ENV } = {}) {
  sent = [];
  return worker.fetch(
    new Request("https://bot.workers.dev", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(update),
    }),
    env
  );
}

const message = (text, chatType = "private") => ({
  message: { chat: { id: 42, type: chatType }, text },
});

// ---- Health check ----
const alive = await worker.fetch(new Request("https://bot.workers.dev"), ENV);
check("GET returns a health check", alive.status === 200 && (await alive.text()).includes("alive"));

// ---- Webhook authentication ----
const forged = await post(message("/start"), { secret: "wrong" });
check("a request without the right secret is rejected", forged.status === 403);
check("nothing is sent for a rejected request", sent.length === 0);

// ---- /start ----
let res = await post(message("/start"));
check("/start returns 200", res.status === 200);
check("/start sends exactly one message", sent.length === 1 && sent[0].method === "sendMessage");

const startBody = sent[0].body;
const startButton = startBody.reply_markup.inline_keyboard[0][0];
check("/start replies to the right chat", startBody.chat_id === 42);
check("/start describes the app, not just a bare link", startBody.text.length > 150);
check("/start attaches a button that opens the Mini App in-app",
  !!startButton.web_app && startButton.web_app.url === ENV.MINI_APP_URL,
  JSON.stringify(startButton));

// ---- Command parsing ----
await post(message("/start@workoutelobot"));
check("a command addressed to the bot by name is recognised", sent.length === 1);
await post(message("/start deeplinkpayload"));
check("a /start with a deep-link payload is still recognised", sent.length === 1);

await post(message("/help"));
check("/help explains the tabs", sent[0].body.text.includes("Export"));
await post(message("/app"));
check("/app opens the app too", !!sent[0].body.reply_markup.inline_keyboard[0][0].web_app);

await post(message("hello"));
check("a stray message still gets a reply", sent.length === 1);
check("the stray-message reply stays short", sent[0].body.text.length < 120);

// ---- Groups ----
// Telegram rejects web_app buttons outside private chats; sending one anyway means the
// message fails and the user sees nothing.
await post(message("/start", "supergroup"));
const groupButton = sent[0].body.reply_markup.inline_keyboard[0][0];
check("in a group the button is a plain link, not a web_app button",
  !groupButton.web_app && groupButton.url === ENV.DIRECT_LINK,
  JSON.stringify(groupButton));

// ---- Optional photo card ----
const withPhoto = { ...ENV, PREVIEW_IMAGE_URL: "https://example.com/preview.png" };
await post(message("/start"), { env: withPhoto });
check("a configured preview image is sent as a photo card", sent[0].method === "sendPhoto");
check("the photo card keeps the open button", !!sent[0].body.reply_markup);

// A broken image URL must not swallow the reply entirely.
apiResponse = (method) => (method === "sendPhoto" ? { ok: false, description: "wrong file identifier" } : { ok: true });
await post(message("/start"), { env: withPhoto });
check("a failed photo falls back to a text reply",
  sent.length === 2 && sent[0].method === "sendPhoto" && sent[1].method === "sendMessage");
apiResponse = () => ({ ok: true, result: {} });

// ---- Failure handling ----
// Telegram redelivers any update the webhook doesn't 200, so a thrown error would turn one
// bad message into a retry loop.
globalThis.fetch = async () => { throw new Error("network down"); };
res = await post(message("/start"));
check("a Telegram API failure still returns 200", res.status === 200);

const malformed = await worker.fetch(
  new Request("https://bot.workers.dev", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret" },
    body: "not json",
  }),
  ENV
);
check("a malformed body returns 200 rather than triggering retries", malformed.status === 200);

finish("bot");
