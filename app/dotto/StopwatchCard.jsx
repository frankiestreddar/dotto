"use client";

// Ported from the old renderStopwatchHTML (public/dotto/stopwatch-search-notifications.js — kept
// there, not deleted: live-presence.js's mini inline-canvas previews still call it directly).
// swToggleRun/swTogglePause/swFormatTime/swCurrentElapsedMs all stay vanilla, reached via
// window.swToggleRun/window.swTogglePause (already bridged for the original inline onclick=
// attributes) and the new window.__swFormatTime/window.__swCurrentElapsedMs (see that file's own
// comment on why the ticking mechanism itself — ensureSwTicking/swTick, history-autosave.js —
// needed no changes at all: it drives a plain 1s setInterval outside React, sometimes patching
// this card's .sw-time text directly instead of going through render(), which is safe against a
// React-rendered node for the same "mutate in place, next real render reads current data" reason
// as the rest of this migration).
export default function StopwatchCard({ it }) {
  return (
    <div className="sw-row" onMouseDown={(e) => e.stopPropagation()}>
      <button className="sw-btn sw-startstop" onClick={() => window.swToggleRun(it.id)} title={it.swRunning ? "Stop" : "Start"}>
        {it.swRunning ? "⏹" : "▶"}
      </button>
      <button className="sw-btn sw-pauseplay" onClick={() => window.swTogglePause(it.id)} disabled={!it.swRunning} title={it.swPaused ? "Resume" : "Pause"}>
        {it.swPaused ? "▶" : "⏸"}
      </button>
      <div className="sw-time">{window.__swFormatTime(window.__swCurrentElapsedMs(it))}</div>
    </div>
  );
}
