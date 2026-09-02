// Phase 4.4 port of public/dotto/stopwatch.js's swFormatTime/swCurrentElapsedMs/swToggleRun/
// swTogglePause (itself a Phase 4.3 split of stopwatch-search-notifications.js — see
// PHASE4_ROADMAP.md). renderStopwatchHTML stays vanilla in stopwatch.js —
// app/dotto/lib/messagingCanvasPreview.ts's mini inline-canvas previews still call it directly —
// so this isn't a Zustand-store port like
// notifications.js: a stopwatch card's own fields (swElapsedMs, swRunning, ...) live on the same
// `it` object every other item field does, inside appState.folders
// (app/dotto/lib/coreState.ts), which stays the single source of truth — appState itself is a
// plain mutable object even after its own Phase 4.5 port, not a reactive store. This just moves the
// PURE/mutating LOGIC to TS, reaching that live item — and every other still-vanilla dependency —
// through the existing window.__getAppState()/window.__findItemById() etc. bridges, same pattern
// every Phase 4.1 port already established.

export interface StopwatchItem {
  id: number;
  swElapsedMs: number;
  swRunning: boolean;
  swPaused: boolean;
  swLastResumeAt: number | null;
  swSessionActive?: boolean;
  swSessionId?: string;
  swSessionStartedAt?: number;
  swSessionLive?: Record<string, { seen?: number; totalCards?: number; ratings?: unknown }>;
  swSessionBaseline?: Record<string, { seen?: number; totalCards?: number; ratings?: unknown }>;
  swSessions?: unknown[];
}

export function swFormatTime(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600),
    m = Math.floor((totalSec % 3600) / 60),
    s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function swCurrentElapsedMs(it: StopwatchItem): number {
  if (it.swRunning && !it.swPaused && it.swLastResumeAt)
    return it.swElapsedMs + (Date.now() - it.swLastResumeAt);
  return it.swElapsedMs;
}

export function swToggleRun(id: number): void {
  const it = window.__findItemById?.(id) as unknown as StopwatchItem | undefined;
  if (!it) return;
  window.__saveSnapshot?.();
  if (!it.swRunning) {
    it.swRunning = true;
    it.swPaused = false;
    it.swLastResumeAt = Date.now();
    it.swSessionActive = true;
    const appState = window.__getAppState?.() as { idCounter: number } | undefined;
    it.swSessionId = "sess_" + (appState ? appState.idCounter++ : Date.now());
    it.swSessionStartedAt = Date.now();
    it.swSessionLive = {};
    it.swSessionBaseline = {};
  } else {
    if (!it.swPaused && it.swLastResumeAt) it.swElapsedMs += Date.now() - it.swLastResumeAt;
    const finishedDurationMs = it.swElapsedMs;
    it.swRunning = false;
    it.swPaused = false;
    it.swLastResumeAt = null;
    if (it.swSessionActive) {
      const live = it.swSessionLive || {};
      const baseline = it.swSessionBaseline || {};
      const payloads = Object.keys(live).map((originId) => {
        const l = live[originId] || {};
        const b = baseline[originId] || {};
        return {
          originId,
          delta: {
            seen: (l.seen || 0) - (b.seen || 0),
            totalCards: l.totalCards,
            ratings: window.__diffRatings?.(l.ratings, b.ratings),
          },
        };
      });
      const session = {
        sessionId: it.swSessionId,
        startedAt: it.swSessionStartedAt,
        endedAt: Date.now(),
        durationMs: finishedDurationMs,
        payloads,
      };
      // Stopwatches keep only the 3 most-recent sessions behind the scenes (most recent first); a
      // connected shelf card archives them permanently as they stream through, so it can hold
      // unlimited history even though the stopwatch itself only ever remembers the last 3.
      it.swSessions = it.swSessions || [];
      it.swSessions.unshift(session);
      if (it.swSessions.length > 3) it.swSessions.length = 3;
    }
    it.swSessionActive = false;
    it.swElapsedMs = 0; // Stop always resets the timer, ready for the next run.
  }
  window.__render?.();
}

export function swTogglePause(id: number): void {
  const it = window.__findItemById?.(id) as unknown as StopwatchItem | undefined;
  if (!it || !it.swRunning) return;
  window.__saveSnapshot?.();
  if (it.swPaused) {
    it.swPaused = false;
    it.swLastResumeAt = Date.now();
  } else {
    if (it.swLastResumeAt) it.swElapsedMs += Date.now() - it.swLastResumeAt;
    it.swPaused = true;
    it.swLastResumeAt = null;
  }
  window.__render?.();
}

// React -> global bridges (StopwatchCard.jsx imports these functions directly now — a real
// same-tree import, no bridge needed for that direction) plus vanilla -> TS bridges for
// stopwatch.js's still-vanilla renderStopwatchHTML (its onclick="swToggleRun(...)" string calls
// the global by name, same as before this port) and app/dotto/lib/historyAutosave.ts's ensureSwTicking/swTick
// (its own 1s DOM-patch of a running stopwatch's .sw-time text, unchanged by this port).
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.swToggleRun = swToggleRun;
  window.swTogglePause = swTogglePause;
  window.__swFormatTime = swFormatTime;
  window.__swCurrentElapsedMs = swCurrentElapsedMs as unknown as (
    it: Record<string, unknown>,
  ) => number;
}
