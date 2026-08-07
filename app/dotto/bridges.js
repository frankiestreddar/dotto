// Canonical registration point for vanilla-JS <-> React bridges, as public/dotto/*.js gets
// migrated to real React one subsystem at a time (see PHASE2_ROADMAP.md). public/dotto/*.js can't
// import from app/ (same constraint that makes window.__dottoSupabase/__DOTTO_USER__ bridge the
// other direction in app/dotto-app.jsx), so each migrated piece of state gets a plain external
// store here: vanilla code keeps calling a small window.__set*/window.<fn> surface, and the React
// component that now owns the real state subscribes via useSyncExternalStore. New increments add
// their own store below rather than each inventing its own ad hoc globals.

function createStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  return {
    set(next) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return value;
    },
  };
}

export const pricingOverlayStore = createStore(false);

// Text-selection toolbar shell (Phase 2 increment 2) — {isOpen, left, top}, richer than
// pricingOverlayStore's plain boolean since this one also carries the toolbar's already-clamped
// screen position. See public/dotto/search-orchestration-selection.js's showSelectionToolbarFor/
// hideSelectionToolbar for the vanilla side that still owns WHEN to show/hide and WHERE.
export const selectionToolbarStore = createStore({ isOpen: false, left: 0, top: 0 });

// Canvas items layer (canvas-items-react plan, see PHASE2_ROADMAP.md) — the current folder's item
// array, set by render() (waypoints-render-loop.js) via window.__renderCanvasItems every time it
// would previously have wiped and rebuilt #world's item divs by hand. React now owns the #items-
// layer child of #world (see app/dotto/CanvasItemsLayer.jsx) and keys off item.id, so unchanged
// items are left alone instead of being torn down and recreated on every canvas interaction.
export const canvasItemsStore = createStore([]);

// Search-bar notification content (message/imageUrl/actionLabel) — the queue/sequencing engine
// and the staged CSS-class choreography that shows/hides it both stay fully vanilla (see
// public/dotto/stopwatch-search-notifications.js's showNotification/dismissCurrentNotification —
// neither is list-diffing or list-rebuilding, so there's no analogous bug to the canvas-items-
// react one to fix; only the notification's own rendering surface moves to React, via
// NotificationBar.jsx portaling into #search-notification-root, see content/fragments/top-bar.html).
// null means nothing has ever been shown yet (matches the original static markup's empty
// image/text/button on load) — showNotification sets this once per notification and dismissal
// deliberately leaves the last content in place rather than clearing it, same as the original
// (harmless: the notification bar is hidden via CSS once #search-input-wrap loses .notifying).
export const notificationStore = createStore(null);
