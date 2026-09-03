"use client";

import { swCurrentElapsedMs, swFormatTime, swTogglePause, swToggleRun } from "./lib/stopwatch";

// Ported from the old renderStopwatchHTML (public/dotto/stopwatch.js, Phase 4.3 split of
// stopwatch-search-notifications.js) — app/dotto/lib/stopwatch.ts's own renderStopwatchHTML (a
// separate HTML-string builder, not this component) is what
// app/dotto/lib/messagingCanvasPreview.ts's mini inline-canvas previews call directly now, both
// ported since. swToggleRun/swTogglePause/swFormatTime/swCurrentElapsedMs moved to
// app/dotto/lib/stopwatch.ts in Phase 4.4 — real imports now, not window bridges, since both this
// component and that module live in the same app/dotto/ tree. stopwatch.ts still sets
// window.swToggleRun/swTogglePause/__swFormatTime/__swCurrentElapsedMs as bridges of its own, for
// its own renderStopwatchHTML's generated onclick="..." strings and
// app/dotto/lib/historyAutosave.ts's ensureSwTicking/swTick (its own 1s setInterval outside React,
// sometimes patching this card's .sw-time text directly instead of going through render(), which
// is safe against a React-rendered node for the same "mutate in place, next real render reads
// current data" reason as the rest of this migration).
export default function StopwatchCard({ it }) {
  return (
    <div className="sw-row" onMouseDown={(e) => e.stopPropagation()}>
      <button
        className="sw-btn sw-startstop"
        onClick={() => swToggleRun(it.id)}
        title={it.swRunning ? "Stop" : "Start"}
      >
        {it.swRunning ? "⏹" : "▶"}
      </button>
      <button
        className="sw-btn sw-pauseplay"
        onClick={() => swTogglePause(it.id)}
        disabled={!it.swRunning}
        title={it.swPaused ? "Resume" : "Pause"}
      >
        {it.swPaused ? "▶" : "⏸"}
      </button>
      <div className="sw-time">{swFormatTime(swCurrentElapsedMs(it))}</div>
    </div>
  );
}
