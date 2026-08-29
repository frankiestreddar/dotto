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
    __renderSelectedOutlines?: () => void;
    // core-state.js — the live-read canvas/world DOM element accessors (Phase 3's universal
    // bridge for these two, already consumed by app/dotto/canvasItemBehavior.js, a plain .js file
    // that never needed these declared until a real .ts file touched them here).
    __getCanvasEl?: () => HTMLElement | undefined;
    __getWorldEl?: () => HTMLElement | undefined;
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
    // core-state.js — swaps which pane's fields are the live appState.<field> ones.
    __switchActivePane?: (paneId: number) => void;
    // core-state.js — resets a freshly-split pane's camera/selection/history to fresh defaults.
    __initializeNewPane?: (paneId: number, folderId: string) => void;
    // waypoints-render-loop.js — re-navigates the canvas to a folder (used by
    // app/dotto/lib/splitPaneManagement.ts's splitPaneWithTab).
    __applyFolderView?: (folderId: string) => void;
    // app/dotto/lib/tabManagement.ts (still tab-management.js as of this writing) — pushes
    // appState.tabs/activeTabId into React; called after a tab-bookkeeping mutation that doesn't
    // itself trigger a render().
    __renderTabsPanel?: () => void;
    // app/dotto/bridges.js (via app/dotto-app.jsx) — pane-layout-tree helpers, all already
    // React-callable bridges before any Phase 4.4 port needed them.
    __countPanes?: () => number;
    __listPaneIds?: () => number[];
    __splitPaneInLayout?: (
      targetPaneId: number,
      newPaneId: number,
      edge: "left" | "right" | "top" | "bottom",
    ) => void;
    __closePaneInLayout?: (paneId: number) => void;
    __removePaneItemsStore?: (paneId: number) => void;
    __removePaneTabsStore?: (paneId: number) => void;
    // app/dotto/lib/splitPaneManagement.ts (Phase 4.4 port — was split-pane-management.js) —
    // vanilla -> React bridges: TabsBar.jsx's drag-to-split gesture and PaneTopBar.jsx's close
    // button already called these as globals before the port.
    __splitPaneWithTab?: (
      tabId: string,
      targetPaneId: number,
      edge: "left" | "right" | "top" | "bottom",
      sourcePaneId?: number,
    ) => void;
    __closePane?: (paneId: number) => void;
    // panels-hamburger.js
    __closeRailView?: () => void;
    // source-buttons-cursor-mode.js
    __applyCursorMode?: () => void;
    // add-menu.js — a card kind's default {w, h} for the placement ghost.
    __kindSize?: (kind: string) => { w: number; h: number };
    // card-shortcuts.js
    __deleteSelectedCards?: () => void;
    // core-state.js — registers a per-pane canvas-listener setup function, called once for every
    // future pane's own canvas element (see that function's own comment for the real pane-0-only-
    // listener bug this exists to prevent).
    __registerPaneCanvasListenerSetup?: (fn: (canvasEl: HTMLElement) => void) => void;
    // app/dotto/lib/copyPaste.ts (Phase 4.4 port — was copy-paste.js) — vanilla -> React bridges:
    // history-autosave.js's Cmd+C/X/V keydown handler, blocks-panel.js's handleBlockItemClick, and
    // srs-connections-core.js's 'a'-chord/Escape handling already called these as globals before
    // the port (prepareAdd already was; the other 4 are new here, same shape).
    copySelectedCards?: () => void;
    cutSelectedCards?: () => void;
    pasteClipboardCards?: () => void;
    removePlacementGhost?: () => void;
    prepareAdd?: (kind: string, statKind?: string | null) => void;
  }
}
