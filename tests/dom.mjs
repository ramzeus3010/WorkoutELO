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
