import { JSDOM } from "jsdom";
import fs from "fs";

const bundle = fs.readFileSync("./dist/app.js", "utf8");

function makeDom() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.com/",
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.AudioContext = function () {
    return {
      createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: "" }),
      createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
      destination: {}, currentTime: 0, close() {},
    };
  };
  return dom;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Pass 1: log a set, expect a draft to be autosaved ----
const dom1 = makeDom();
const w1 = dom1.window;
const errs1 = [];
w1.console.error = (...a) => errs1.push(a.join(" "));
w1.eval(bundle);
await sleep(500);

const doc1 = w1.document;

// find the weight + reps inputs of the first exercise card
const numberInputs = [...doc1.querySelectorAll('input[type="number"]')];
console.log("number inputs found:", numberInputs.length);

function setNativeValue(win, el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
}

// The first card's inputs: placeholder "kg" and "reps"
const kg = numberInputs.find((i) => i.placeholder === "kg");
const reps = numberInputs.find((i) => i.placeholder === "reps");
console.log("found kg input:", !!kg, "reps input:", !!reps);

setNativeValue(w1, kg, "12");
setNativeValue(w1, reps, "10");
await sleep(100);

// find the "Add set" button
const addBtn = [...doc1.querySelectorAll("button")].find((b) => b.textContent.includes("Add set"));
console.log("found Add set button:", !!addBtn);
addBtn.dispatchEvent(new w1.Event("click", { bubbles: true }));

await sleep(1500); // wait past the 700ms debounce

const draft = w1.localStorage.getItem("draft_v1");
console.log("DRAFT SAVED:", draft ? "YES" : "NO");
if (draft) {
  const parsed = JSON.parse(draft);
  const withSets = parsed.exercises.filter((e) => e.sets.length > 0);
  console.log("  day:", parsed.day, "| exercises with sets:", withSets.length);
  console.log("  first logged:", withSets[0] && withSets[0].name, JSON.stringify(withSets[0] && withSets[0].sets));
}
console.log("errors pass1:", errs1.length, errs1.slice(0, 3));

// ---- Pass 2: fresh app instance sharing the same storage, expect restore ----
const dom2 = makeDom();
const w2 = dom2.window;
// copy localStorage across (simulates reopening the app)
w2.localStorage.setItem("draft_v1", draft);
const errs2 = [];
w2.console.error = (...a) => errs2.push(a.join(" "));
w2.eval(bundle);
await sleep(900);

const text2 = w2.document.getElementById("root").textContent;
const restored = text2.includes("12") && text2.includes("Set 1");
console.log("RESTORED ON REOPEN:", restored ? "YES" : "NO");
console.log("errors pass2:", errs2.length, errs2.slice(0, 3));

if (!draft || !restored) process.exit(1);
