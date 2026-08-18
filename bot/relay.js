/**
 * The group leaderboard: identity, storage, and the maths the bot answers /score with.
 *
 * WHAT THIS IS NOT
 * It is not a backend for workout data. Sets, reps, notes and programs never leave Telegram
 * CloudStorage on each user's own account. What lands here is the summary a user chose to
 * broadcast into a group chat they joined: a display name, two scores, and a ledger of
 * {date, effort} pairs. If this store were wiped, every client could republish.
 *
 * WHY THE LEDGER STORES INPUTS
 * Weekly effort decays and resets on Mondays. A cached total is correct for a few hours and
 * then quietly wrong, and /score is answered when no client is running to correct it. So the
 * ledger keeps dated entries and the weekly figure is recomputed at read time, through the
 * same weeklyEffort() the app uses.
 */

import {
  weeklyEffort, leagueTodayISO, weekStartISO,
  strengthPoints, effortPoints, STRENGTH_WEIGHT, EFFORT_WEIGHT,
} from "../src/scoring.js";

// Ledger entries older than this can't affect any current week. Trimming keeps each user's
// KV value small and bounds how long a published summary is retained.
const LEDGER_KEEP_DAYS = 60;

const enc = new TextEncoder();

// ---------- Telegram initData verification ----------
// Proves the caller is a real user of this bot, using the bot token as the shared secret.
// Without it, /publish is an open endpoint anyone could post fabricated scores to — and it's
// also the same primitive the AI proxy will need, which is why it's worth doing properly now.
async function hmac(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, msgBytes));
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Constant-time compare. A fast-exit compare leaks how much of the hash matched, which is
// enough to forge one byte at a time.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const MAX_INITDATA_AGE_SEC = 24 * 60 * 60;

/**
 * Returns the verified Telegram user, or null. Never throws on malformed input — this is
 * reached straight from the network.
 */
export async function verifyInitData(initData, botToken, nowSec = Math.floor(Date.now() / 1000)) {
  if (!initData || !botToken) return null;

  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }

  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // Telegram signs the remaining fields sorted by key, joined by newlines.
  const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`);
  const dataCheckString = pairs.join("\n");

  const secret = await hmac(enc.encode("WebAppData"), enc.encode(botToken));
  const computed = toHex(await hmac(secret, enc.encode(dataCheckString)));
  if (!timingSafeEqual(computed, hash)) return null;

  // A valid signature is forever, so without this an intercepted initData string replays
  // indefinitely.
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || nowSec - authDate > MAX_INITDATA_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !user.id) return null;
    return { id: String(user.id), firstName: user.first_name || "", username: user.username || "" };
  } catch (e) {
    return null;
  }
}

// ---------- KV keys ----------
export const userKey = (id) => `user:${id}`;
export const memberKey = (groupId, id) => `member:${groupId}:${id}`;
export const codeKey = (code) => `joincode:${code}`;
export const groupKey = (groupId) => `group:${groupId}`;
// The language a group's posts are written in, chosen once at /register. Separate from the
// group's title rather than packed in beside it, because the title is already stored as a
// bare string and re-encoding it would break every group registered before this existed.
export const groupLangKey = (groupId) => `grouplang:${groupId}`;

// ---------- User records ----------
export function emptyUser(id, name, lang = null) {
  return { id, name: name || "", groupId: null, strength: 800, ledger: [], updatedAt: null, lang };
}

export async function readUser(env, id) {
  const raw = await env.CHETAMBA.get(userKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function writeUser(env, user) {
  await env.CHETAMBA.put(userKey(user.id), JSON.stringify(user));
}

/**
 * Fold a freshly finished session into a user's ledger.
 * Idempotent per session id: a client that retries a failed publish must not be paid twice.
 */
export function applyPublish(user, payload, todayIso) {
  const next = { ...user };
  if (payload.name) next.name = String(payload.name).slice(0, 32);
  if (typeof payload.strength === "number") next.strength = Math.round(payload.strength);
  // The app sends the language it is set to, so flipping the switch in the app also changes
  // what the bot's private messages sound like. Validated rather than trusted — this comes
  // off the network, and an unknown value would fall through to the key name on screen.
  if (payload.lang === "en" || payload.lang === "ru") next.lang = payload.lang;

  const entry = {
    id: String(payload.sessionId || ""),
    date: String(payload.date || todayIso).slice(0, 10),
    effort: Math.max(0, Number(payload.effort) || 0),
    kind: payload.kind === "activity" ? "activity" : "lift",
  };

  const cutoff = new Date(Date.parse(todayIso + "T00:00:00Z") - LEDGER_KEEP_DAYS * 86400000)
    .toISOString().slice(0, 10);

  next.ledger = [...(user.ledger || []).filter((e) => e.id !== entry.id && e.date >= cutoff), entry];
  next.updatedAt = todayIso;
  return next;
}

/** The two columns plus the combined total, recomputed as of `asOfIso`. */
export function standingFor(user, asOfIso) {
  const week = weeklyEffort(user.ledger || [], asOfIso, (e) => e.effort);
  const sPts = strengthPoints(user.strength || 800);
  const ePts = effortPoints(week.effort);
  return {
    id: user.id,
    name: user.name || "Someone",
    strength: user.strength || 800,
    effort: Math.round(week.effort * 100) / 100,
    sessions: week.sessions,
    total: Math.round((STRENGTH_WEIGHT * sPts + EFFORT_WEIGHT * ePts) * 10) / 10,
  };
}

/** Every member of a group, ranked. Highest total first. */
export async function groupStandings(env, groupId, asOfIso = leagueTodayISO()) {
  const listed = await env.CHETAMBA.list({ prefix: `member:${groupId}:` });
  const ids = listed.keys.map((k) => k.name.split(":")[2]);
  const users = await Promise.all(ids.map((id) => readUser(env, id)));
  return users
    .filter(Boolean)
    .map((u) => standingFor(u, asOfIso))
    .sort((a, b) => b.total - a.total);
}

/**
 * Where someone sits, and who they just overtook. Movement is what people react to — a
 * static list of standings stops being interesting after the first week.
 */
export function rankChange(before, after, id) {
  const idx = (list) => list.findIndex((s) => s.id === id);
  const from = idx(before);
  const to = idx(after);
  if (from < 0 || to < 0 || to >= from) return null;
  const passed = before.slice(to, from).map((s) => s.name).filter(Boolean);
  return passed.length ? { to: to + 1, passed } : null;
}

// Ambiguous characters (0/O, 1/I) left out — this gets read off one phone and typed into
// another, usually in a gym.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeJoinCode(random = crypto.getRandomValues.bind(crypto)) {
  const bytes = random(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export { weekStartISO, leagueTodayISO };
