// Shared jsdom harness for the test suites.
//
// The bundle is an IIFE with nothing exported, so every test drives the real UI:
// build a DOM, eval the bundle into it, then click and type like a user would.
// Outside Telegram the app falls back to localStorage, which is what lets us seed
// and inspect state here (see workout_tracker.md §5).

import { JSDOM } from "jsdom";
import fs from "fs";

export const BUNDLE = fs.readFileSync("./dist/app.js", "utf8");

export function makeDom() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.com/",
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  // recharts measures its container; jsdom reports 0x0, so give it a real box.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: 360, height: 200, top: 0, left: 0, right: 360, bottom: 200, x: 0, y: 0, toJSON() {} };
  };
  // recharts' ResponsiveContainer needs ResizeObserver; jsdom has none. Real browsers do.
  window.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  window.AudioContext = function () {
    return {
      createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: "" }),
      createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
      destination: {}, currentTime: 0, close() {},
    };
  };
  return dom;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until `predicate()` is true, polling until `timeout`.
 *
 * Prefer this over a fixed `sleep` before asserting on rendered output. Each suite creates
 * several jsdom windows and never closes them, and the rest-timer ring keeps a
 * requestAnimationFrame loop running in every one — so by the third or fourth block the same
 * React update genuinely takes longer to land than it did in the first. A fixed sleep that
 * passes in isolation then fails in sequence, which reads as a real regression.
 *
 * Returns true if the condition was met, false on timeout — so a caller can still assert and
 * get a useful failure message rather than an exception.
 */
export async function waitFor(predicate, { timeout = 3000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return true;
    } catch (e) { /* not rendered yet — keep polling */ }
    await sleep(interval);
  }
  return false;
}

// React installs its own value setter on inputs, so assigning .value directly is
// invisible to it. Go through the native prototype setter, then fire the event.
export function setNativeValue(win, el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
}

export function click(win, el) {
  el.dispatchEvent(new win.Event("click", { bubbles: true }));
}

export function buttonWithText(doc, text) {
  return [...doc.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

/**
 * Expand a WithInfo (ⓘ) hint so its text is in the DOM.
 *
 * Explanatory copy used to sit open on every screen; it's now one tap away. Tests that assert
 * on that copy are still asserting something real — that the explanation is *reachable* — so
 * they open it rather than being deleted. `root` scopes the search (pass a panel element to
 * hit that panel's toggle rather than the first one on the page).
 */
export function infoToggles(root) {
  return [...root.querySelectorAll("button[aria-expanded]")];
}

export function openInfo(win, root, index = 0) {
  const button = infoToggles(root)[index];
  if (button) click(win, button);
  return !!button;
}

export function rootText(win) {
  return win.document.getElementById("root").textContent;
}

export function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Minimal assertion helpers — a failed check exits non-zero so `npm test` fails.
let failures = 0;

export function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  }
}

export function finish(suiteName) {
  if (failures > 0) {
    console.log(`\n${suiteName}: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log(`\n${suiteName}: all checks passed`);
}
