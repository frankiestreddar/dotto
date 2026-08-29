// Ambient type declarations for the window.__*/window.* bridges connecting ported app/dotto/lib
// code back to whatever vanilla still owns each piece — see CONTRIBUTING.md's own bridge
// convention. Grows as more Phase 4.x ports need to reach a still-vanilla function; only declares
// bridges actually consumed by real .ts code so far, not a speculative full inventory.
export {};

declare global {
  interface Window {
    // core-state.js — returns the live, mutated-in-place appState singleton (Phase 3's universal
    // bridge). Loosely typed (not the full appState shape) since only a handful of fields are
    // read/written from ported code so far; widen as more fields are actually touched.
    __getAppState?: () => Record<string, unknown>;
    // app/dotto/lib/notificationsStore.ts (Phase 4.4 port — was notifications.js) — a vanilla ->
    // React bridge now, not React -> vanilla like every other entry here: still-vanilla callers
    // reach the ported notification engine through this, same call shape as before the port.
    pushNotification?: (config: {
      type: string;
      message: string;
      imageUrl?: string;
      actionLabel?: string;
      onAction?: () => void;
      sticky?: boolean;
      durationMs?: number;
    }) => void;
    // app/dotto/lib/notificationsStore.ts — card-shortcuts.js's hover-scoped game-card/PDF-page-
    // turn shortcuts gate on this so a notification's own Enter/Escape handling wins instead.
    __hasVisibleNotifications?: () => boolean;
    // profile-achievements-pricing.js
    openPricingOverlay?: () => void;
    // live-presence.js — canonical item-data accessor, used by app/dotto/lib/stopwatch.ts to
    // reach a stopwatch card's own live item (part of appState.folders, not a separate store).
    __findItemById?: (id: number) => Record<string, unknown> | undefined;
    // history-autosave.js
    __saveSnapshot?: () => void;
    // waypoints-render-loop.js — the global re-render escape hatch.
    __render?: () => void;
    // srs-connections-core.js (re-exported from srs-algorithm.js) — needed by
    // app/dotto/lib/stopwatch.ts's swToggleRun to archive a finished session's rating deltas;
    // public/dotto/*.js isn't reachable from app/dotto/ even for an otherwise-pure function.
    __diffRatings?: (live: unknown, base: unknown) => Record<string, number> | undefined;
    // app/dotto/lib/stopwatch.ts (Phase 4.4 port — was stopwatch.js) — vanilla -> React bridges,
    // not React -> vanilla like most entries here: StopwatchCard.jsx's own onClick already called
    // these as globals before the port (same shape window.pushNotification uses), and
    // stopwatch.js's still-vanilla renderStopwatchHTML calls swToggleRun/swTogglePause the same
    // way via its onclick="..." string attributes.
    swToggleRun?: (id: number) => void;
    swTogglePause?: (id: number) => void;
    // app/dotto/lib/stopwatch.ts — history-autosave.js's ensureSwTicking/swTick (its own 1s
    // DOM-patch of a running stopwatch's .sw-time text) and stopwatch.js's renderStopwatchHTML
    // both call these instead of a local function now.
    __swFormatTime?: (ms: number) => string;
    __swCurrentElapsedMs?: (it: Record<string, unknown>) => number;
  }
}
