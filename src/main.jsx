import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app.jsx";

// Telegram opens the mini app in a partially-collapsed sheet; expand it to full height
// and disable the swipe-to-close gesture so scrolling a long exercise list doesn't
// dismiss the app mid-workout.
if (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  try { tg.ready(); } catch (e) { /* older client */ }
  try { tg.expand(); } catch (e) { /* older client */ }
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) { /* added in Bot API 7.7 */ }
}

createRoot(document.getElementById("root")).render(<App />);
