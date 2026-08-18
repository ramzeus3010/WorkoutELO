// Bot webhook tests.
//
// Worth having because the alternative is debugging through Telegram, where a broken
// handler just looks like a silent bot — exactly the symptom this worker exists to fix.
// No network: the Telegram API is stubbed and we assert on what would have been sent.

import worker from "../bot/worker.js";
import { check, finish } from "./dom.mjs";

// The worker reads and writes KV on nearly every path now (per-user language, per-group
// language, join codes). An env without the binding used to make handleUpdate throw, which
// the top-level catch turned into a silent 200 — a bot that looks alive and answers nothing.
// So the fake env models the real one rather than omitting it.
function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix } = {}) {
      const keys = [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    },
    store,
  };
}

let kv = makeKV();

const baseEnv = () => ({
  BOT_TOKEN: "123:TEST",
  WEBHOOK_SECRET: "s3cret",
  MINI_APP_URL: "https://example.github.io/WorkoutELO/dist/",
  DIRECT_LINK: "https://t.me/workoutelobot/chetamba",
  CHETAMBA: kv,
});

let ENV = baseEnv();

let sent = [];
let apiResponse = () => ({ ok: true, result: {} });

const realFetch = async (url, init) => {
  const method = String(url).split("/").pop();
  const body = JSON.parse(init.body);
  sent.push({ method, body });
  const res = apiResponse(method, body);
  return { json: async () => res, status: 200 };
};
globalThis.fetch = realFetch;

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

const USER_ID = 7;
const message = (text, chatType = "private", from = {}) => ({
  message: {
    chat: { id: 42, type: chatType },
    text,
    from: { id: USER_ID, first_name: "Test", ...from },
  },
});

/** Give the user a stored language, so the first-run prompt doesn't fire. */
async function seedLang(lang, id = USER_ID) {
  await kv.put(`user:${id}`, JSON.stringify({ id: String(id), name: "Test", lang, ledger: [], strength: 800 }));
}

const texts = () => sent.filter((s) => s.method === "sendMessage" || s.method === "sendPhoto");

// ---- Health check ----
const alive = await worker.fetch(new Request("https://bot.workers.dev"), ENV);
check("GET returns a health check", alive.status === 200 && (await alive.text()).includes("alive"));

// ---- Webhook authentication ----
const forged = await post(message("/start"), { secret: "wrong" });
check("a request without the right secret is rejected", forged.status === 403);
check("nothing is sent for a rejected request", sent.length === 0);

// ---- First /start: welcome, then the language question ----
let res = await post(message("/start", "private", { language_code: "en" }));
check("/start returns 200", res.status === 200);
check("a first /start sends the welcome and a language prompt", sent.length === 2, JSON.stringify(sent.map((s) => s.method)));

const startBody = sent[0].body;
const startButton = startBody.reply_markup.inline_keyboard[0][0];
check("/start replies to the right chat", startBody.chat_id === 42);
check("/start describes the app, not just a bare link", startBody.text.length > 150);
check("/start attaches a button that opens the Mini App in-app",
  !!startButton.web_app && startButton.web_app.url === ENV.MINI_APP_URL,
  JSON.stringify(startButton));

const langPrompt = sent[1].body;
const langButtons = langPrompt.reply_markup.inline_keyboard[0];
check("the language prompt offers both languages", langButtons.length === 2);
check("each language is labelled in its own language",
  langButtons.some((b) => b.text === "English") && langButtons.some((b) => b.text === "Русский"),
  JSON.stringify(langButtons));
check("the buttons carry a personal-language callback",
  langButtons.every((b) => /^lang:(en|ru)$/.test(b.callback_data)),
  JSON.stringify(langButtons));

// ---- Locale detection ----
kv = makeKV(); ENV = baseEnv();
await post(message("/start", "private", { language_code: "ru", id: 99 }));
check("a Russian-locale user gets the Russian welcome",
  sent[0].body.text.includes("дневник тренировок"),
  sent[0].body.text.slice(0, 60));

kv = makeKV(); ENV = baseEnv();
await post(message("/start", "private", { language_code: "kk", id: 98 }));
check("a Kazakh-locale user also gets Russian", sent[0].body.text.includes("дневник тренировок"));

kv = makeKV(); ENV = baseEnv();
await post(message("/start", "private", { language_code: "de", id: 97 }));
check("an unrecognised locale falls back to English", sent[0].body.text.includes("your training log"));

// ---- Choosing a language ----
kv = makeKV(); ENV = baseEnv();
await post({
  callback_query: { id: "cb1", data: "lang:ru", from: { id: USER_ID, first_name: "Test" }, message: { chat: { id: 42, type: "private" } } },
});
check("a language tap is acknowledged first", sent[0].method === "answerCallbackQuery");
check("the confirmation is in the chosen language", sent[1].body.text.includes("говорю по-русски"), sent[1].body.text);
const storedUser = JSON.parse(await kv.get(`user:${USER_ID}`));
check("the choice is persisted", storedUser.lang === "ru", JSON.stringify(storedUser));

// Once stored, the prompt must not reappear on every /start.
await post(message("/start", "private", { language_code: "en" }));
check("a returning user gets only the welcome", sent.length === 1, JSON.stringify(sent.map((s) => s.method)));
check("a stored language beats the Telegram locale", sent[0].body.text.includes("дневник тренировок"));

// A junk callback must not write anything or crash the handler.
await post({
  callback_query: { id: "cb2", data: "lang:klingon", from: { id: USER_ID }, message: { chat: { id: 42, type: "private" } } },
});
check("an unknown language is ignored", sent.length === 1 && sent[0].method === "answerCallbackQuery");
check("the stored language is unchanged", JSON.parse(await kv.get(`user:${USER_ID}`)).lang === "ru");

// ---- Command parsing ----
kv = makeKV(); ENV = baseEnv();
await seedLang("en");
await post(message("/start@workoutelobot"));
check("a command addressed to the bot by name is recognised", texts().length === 1);
await post(message("/start deeplinkpayload"));
check("a /start with a deep-link payload is still recognised", texts().length === 1);

await post(message("/help"));
check("/help explains the tabs", sent[0].body.text.includes("Export"));
await post(message("/app"));
check("/app opens the app too", !!sent[0].body.reply_markup.inline_keyboard[0][0].web_app);

await post(message("hello"));
check("a stray message still gets a reply", sent.length === 1);
check("the stray-message reply stays short", sent[0].body.text.length < 120);

// /language lets someone change their mind without reinstalling anything.
await post(message("/language"));
check("/language re-offers the choice",
  sent[0].body.reply_markup.inline_keyboard[0].every((b) => b.callback_data.startsWith("lang:")));

// ---- Groups ----
// Telegram rejects web_app buttons outside private chats; sending one anyway means the
// message fails and the user sees nothing.
await post(message("/start", "supergroup"));
const groupButton = sent[0].body.reply_markup.inline_keyboard[0][0];
check("in a group the button is a plain link, not a web_app button",
  !groupButton.web_app && groupButton.url === ENV.DIRECT_LINK,
  JSON.stringify(groupButton));
check("a group /start does not ask each member for a language", texts().length === 1);

// ---- /register sets the board's language ----
kv = makeKV(); ENV = baseEnv();
await post({
  message: {
    chat: { id: -100, type: "supergroup", title: "Gym crew" },
    text: "/register",
    from: { id: USER_ID, first_name: "Test", language_code: "ru" },
  },
});
check("/register seeds the board language from whoever ran it",
  (await kv.get("grouplang:-100")) === "ru", await kv.get("grouplang:-100"));
check("/register posts the code in that language", sent[0].body.text.includes("таблица лидеров"), sent[0].body.text);
check("/register offers to change the board language",
  sent[1].body.reply_markup.inline_keyboard[0].every((b) => b.callback_data.startsWith("glang:")),
  JSON.stringify(sent[1].body.reply_markup));

await post({
  callback_query: { id: "cb3", data: "glang:en", from: { id: USER_ID }, message: { chat: { id: -100, type: "supergroup" } } },
});
check("the board language can be switched", (await kv.get("grouplang:-100")) === "en");
check("the switch is confirmed in the new language", sent[1].body.text.includes("posts in English"), sent[1].body.text);

// A group post reads in the BOARD's language, not the reader's.
await post({
  message: { chat: { id: -100, type: "supergroup" }, text: "/score", from: { id: USER_ID, language_code: "ru" } },
});
check("a group /score uses the board language, not the sender's",
  sent[0].body.text.includes("Nobody has joined") || sent[0].body.text.includes("Standings"),
  sent[0].body.text.slice(0, 80));

// ---- Optional photo card ----
kv = makeKV(); ENV = baseEnv();
await seedLang("en");
const withPhoto = { ...baseEnv(), PREVIEW_IMAGE_URL: "https://example.com/preview.png" };
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
globalThis.fetch = realFetch;

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
