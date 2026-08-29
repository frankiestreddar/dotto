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
  }
}
