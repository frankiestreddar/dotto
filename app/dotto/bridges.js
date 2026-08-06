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
