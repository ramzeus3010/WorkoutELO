// The group leaderboard's server side: identity, the ledger, and the standings maths.
//
// The load-bearing assertions are the verifyInitData block. /api/publish writes a score that
// everyone in the group sees, and identity comes from Telegram's signature alone — if a
// forged or replayed initData string got through, anyone could post any score as anyone.
// Nothing else in this system can catch that, so it is tested directly against real HMAC.

import crypto from "node:crypto";
import {
  verifyInitData, MAX_INITDATA_AGE_SEC,
  emptyUser, applyPublish, standingFor, rankChange, makeJoinCode,
} from "../bot/relay.js";

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`); }
}

const BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-one";

// Builds a genuinely signed initData string, the same way Telegram does.
function signInitData(fields, token = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const nowSec = Math.floor(Date.now() / 1000);
const validFields = () => ({
  auth_date: String(nowSec),
  query_id: "AAE",
  user: JSON.stringify({ id: 12345, first_name: "Ramazan", username: "ramzeus" }),
});

// ---------------------------------------------------------------- identity
console.log("initData verification");
{
  const good = await verifyInitData(signInitData(validFields()), BOT_TOKEN, nowSec);
  check("a correctly signed payload verifies", good !== null && good.id === "12345");
  check("the user's name comes through", good && good.firstName === "Ramazan");

  // Each of these is somebody getting in who shouldn't.
  check("a tampered field is rejected",
    (await verifyInitData(signInitData(validFields()).replace("Ramazan", "Someone"), BOT_TOKEN, nowSec)) === null);
  check("a payload signed with a different bot token is rejected",
    (await verifyInitData(signInitData(validFields(), "999:OTHER"), BOT_TOKEN, nowSec)) === null);
  check("a missing hash is rejected",
    (await verifyInitData("auth_date=1&user=%7B%22id%22%3A1%7D", BOT_TOKEN, nowSec)) === null);
  check("garbage is rejected rather than throwing",
    (await verifyInitData("%%%not-a-query%%%", BOT_TOKEN, nowSec)) === null);
  check("empty input is rejected", (await verifyInitData("", BOT_TOKEN, nowSec)) === null);
  check("a missing bot token rejects everything", (await verifyInitData(signInitData(validFields()), "", nowSec)) === null);

  // A signature never expires on its own, so an intercepted string would replay forever.
  const stale = signInitData({ ...validFields(), auth_date: String(nowSec - MAX_INITDATA_AGE_SEC - 60) });
  check("a stale payload is rejected, so initData can't be replayed indefinitely",
    (await verifyInitData(stale, BOT_TOKEN, nowSec)) === null);
  const fresh = signInitData({ ...validFields(), auth_date: String(nowSec - 60) });
  check("a recent payload still verifies", (await verifyInitData(fresh, BOT_TOKEN, nowSec)) !== null);

  // Signed, but carrying no user — there'd be nobody to attribute the score to.
  check("a signed payload with no user is rejected",
    (await verifyInitData(signInitData({ auth_date: String(nowSec), query_id: "AAE" }), BOT_TOKEN, nowSec)) === null);
}

// ---------------------------------------------------------------- the ledger
console.log("\npublishing into the ledger");
{
  const u0 = emptyUser("1", "Ramazan");
  check("a new user starts at baseline", u0.strength === 800 && u0.ledger.length === 0);

  const u1 = applyPublish(u0, { sessionId: "s1", date: "2026-08-17", effort: 1.2, strength: 1350, kind: "lift" }, "2026-08-17");
  check("the session lands in the ledger", u1.ledger.length === 1);
  check("strength is taken from the payload", u1.strength === 1350);

  // A client retrying a failed publish must not be paid twice for one workout.
  const u2 = applyPublish(u1, { sessionId: "s1", date: "2026-08-17", effort: 1.2, strength: 1350, kind: "lift" }, "2026-08-17");
  check("republishing the same session does not double-count", u2.ledger.length === 1);

  const u3 = applyPublish(u2, { sessionId: "s2", date: "2026-08-18", effort: 0.9, strength: 1360, kind: "lift" }, "2026-08-18");
  check("a genuinely new session is added", u3.ledger.length === 2);

  // The ledger must not grow forever — it's a KV value with a size limit.
  const old = { ...u3, ledger: [{ id: "ancient", date: "2026-01-01", effort: 5, kind: "lift" }, ...u3.ledger] };
  const trimmed = applyPublish(old, { sessionId: "s3", date: "2026-08-19", effort: 1, kind: "lift" }, "2026-08-19");
  check("entries too old to affect any current week are dropped",
    !trimmed.ledger.some((e) => e.id === "ancient"));

  check("a hostile name is truncated rather than stored whole",
    applyPublish(u0, { name: "x".repeat(500), sessionId: "s9", date: "2026-08-17", effort: 1 }, "2026-08-17").name.length <= 32);
  check("negative effort can't be published",
    applyPublish(u0, { sessionId: "s8", date: "2026-08-17", effort: -50 }, "2026-08-17").ledger[0].effort === 0);
}

// ---------------------------------------------------------------- standings
console.log("\nstandings");
{
  const user = {
    ...emptyUser("1", "Ramazan"),
    strength: 1400,
    ledger: [
      { id: "a", date: "2026-08-17", effort: 1.2, kind: "lift" },   // Monday
      { id: "b", date: "2026-08-19", effort: 1.0, kind: "lift" },
      { id: "c", date: "2026-08-14", effort: 9.9, kind: "lift" },   // previous week
    ],
  };
  const s = standingFor(user, "2026-08-19");

  check("last week's effort doesn't count toward this week", s.effort < 9.9, `effort=${s.effort}`);
  check("this week's sessions are counted", s.sessions === 2);
  check("both columns are reported, not just a total",
    s.strength === 1400 && typeof s.effort === "number" && typeof s.total === "number");
  check("the total is on the 0-100 scale", s.total >= 0 && s.total <= 100);

  const idle = standingFor({ ...emptyUser("2", "Idle"), strength: 1400, ledger: [] }, "2026-08-19");
  check("someone who trained nothing this week still shows their strength", idle.strength === 1400);
  check("...but scores less overall than someone who showed up", idle.total < s.total);
}

// ---------------------------------------------------------------- rank movement
console.log("\nrank changes");
{
  const before = [{ id: "a", name: "Timur", total: 50 }, { id: "b", name: "Ramazan", total: 40 }];
  const after = [{ id: "b", name: "Ramazan", total: 60 }, { id: "a", name: "Timur", total: 50 }];

  const moved = rankChange(before, after, "b");
  check("overtaking someone is detected", moved !== null && moved.to === 1);
  check("it names who was passed", moved && moved.passed.includes("Timur"));
  check("standing still reports no movement", rankChange(before, before, "b") === null);
  check("losing a place is not announced as a gain", rankChange(after, before, "b") === null);
  check("an unknown id is handled", rankChange(before, after, "zzz") === null);
}

// ---------------------------------------------------------------- join codes
console.log("\njoin codes");
{
  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(makeJoinCode((arr) => crypto.randomFillSync(arr)));
  check("codes are 6 characters", [...codes][0].length === 6);
  check("codes don't obviously collide", codes.size > 190, `${codes.size}/200 unique`);
  check("ambiguous characters are excluded — these get typed off another phone",
    ![...codes].some((c) => /[01IO]/.test(c)));
}

if (failures > 0) {
  console.log(`\ntest-relay: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\ntest-relay: all checks passed");
