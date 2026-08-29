// Ambient type declarations for the window.__*/window.* bridges connecting ported app/dotto/lib
// code back to whatever vanilla still owns each piece — see CONTRIBUTING.md's own bridge
// convention. Grows as more Phase 4.x ports need to reach a still-vanilla function; only declares
// bridges actually consumed by real .ts code so far, not a speculative full inventory.
import type { SupabaseClient } from "@supabase/supabase-js";

export {};

declare global {
  interface Window {
    // app/dotto-app.jsx — the real Supabase browser client, set once during module eval (same
    // "set during module eval, not an effect" timing dotto-app.jsx's own comment describes) —
    // already an established React -> vanilla bridge (core-state.js reads it as
    // `window.__dottoSupabase || null`) before any .ts file needed it typed.
    __dottoSupabase?: SupabaseClient;
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
    // app/dotto/lib/tabManagement.ts — pushes appState.tabs/activeTabId into React; called after a
    // tab-bookkeeping mutation that doesn't itself trigger a render().
    __renderTabsPanel?: (paneId?: number) => void;
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
    // waypoints-render-loop.js — the global folder-navigation entry point.
    __openFolder?: (folderId: string) => void;
    // ai-assistant-suggestions.js — structural (real canvas hierarchy) parent lookup, used by
    // app/dotto/lib/tabManagement.ts's buildAncestorChain.
    __findParentFolderId?: (folderId: string) => string | undefined;
    // app/dotto/lib/sharedAndPublicCanvasLoading.ts — leaves a live-shared/public canvas tree
    // and lands on the user's own real root, used by app/dotto/lib/tabManagement.ts's
    // breadcrumbMapRowClick for its synthetic Root row.
    __exitSharedCanvasToRoot?: () => void;
    // app/dotto-app.jsx (via app/dotto/bridges.js's pane-keyed stores) — React-facing setters,
    // called from vanilla/TS with fresh data on every navigation; not flushSync'd (no synchronous
    // DOM read races them the way canvasItemsStore's own setter has to guard against).
    __setBreadcrumbMap?: (
      paneId: number,
      state: {
        hasMore: boolean;
        root: { label: string; folderId: string; isSyntheticRoot: boolean } | null;
        parent: { label: string; folderId: string; isSyntheticRoot: boolean } | null;
        current: { label: string; folderId: string; isSyntheticRoot: boolean } | null;
      },
    ) => void;
    __setTabs?: (
      paneId: number,
      state: { tabs: { id: string; folderId: string; label: string }[]; activeTabId: string },
    ) => void;
    __setNavHistory?: (
      paneId: number,
      state: { canGoBack: boolean; canGoForward: boolean },
    ) => void;
    // app/dotto/lib/tabManagement.ts (Phase 4.4 port — was tab-management.js) — vanilla -> React
    // bridges: TabsBar.jsx/PaneTopBar.jsx already called these as globals before the port; only
    // __renderBreadcrumbMapPanel is new (waypoints-render-loop.js's render() was the one real
    // remaining direct-import caller, switched to this bridge as part of the port).
    __breadcrumbMapRowClick?: (folderId: string, isSyntheticRoot: boolean, paneId?: number) => void;
    __addTab?: (paneId?: number) => void;
    __switchTab?: (tabId: string, paneId?: number) => void;
    __closeTab?: (tabId: string, paneId?: number) => void;
    __reorderTab?: (tabId: string, toIndex: number, paneId?: number) => void;
    __jumpToHistoryIndex?: (newIndex: number, paneId?: number) => void;
    __navBack?: (paneId?: number) => void;
    __navForward?: (paneId?: number) => void;
    __openMediaViewerTab?: (item: { id: number; mediaName?: string }, paneId?: number) => void;
    __renderNavArrows?: (paneId?: number) => void;
    __renderBreadcrumbMapPanel?: (paneId?: number) => void;
    // waypoints-render-loop.js — pans/zooms to fit the current folder's content.
    __centerOnContent?: () => void;
    // app/dotto/lib/sharedAndPublicCanvasLoading.ts (Phase 4.4 port — was
    // shared-and-public-canvas-loading.js) — vanilla -> React bridges: app-init.js,
    // command-verbs.js, hamburger-collab.js, history-autosave.js, live-presence.js, and
    // waypoints-render-loop.js all previously imported these directly.
    __announceEnteredCollaboration?: (localKey: string) => Promise<void>;
    __openPublicCanvas?: (ownerId: string, folderId: string, title?: string) => Promise<void>;
    __ensureSharedFolderLoaded?: (localKey: string) => Promise<boolean>;
    __sharedFolderKey?: (ownerId: string, folderId: string) => string;
    __stripSharedFolderIds?: (
      items: Record<string, unknown>[] | undefined,
    ) => Record<string, unknown>[];
    __namespaceSharedFolderIds?: (
      ownerId: string,
      items: Record<string, unknown>[] | undefined,
    ) => Record<string, unknown>[];
    __parseSharedFolderKey?: (key: string) => { ownerId: string; remoteFolderId: string };
    // history-autosave.js — reapplies appState.tx/ty/scale to the canvas transform.
    __applyTransform?: () => void;
    // Set from app/dotto/lib/sharedAndPublicCanvasLoading.ts itself — declared here because that
    // file both reads and writes these two (self-referential bridge, same as every other
    // vanilla -> React entry in this file), unlike a plain vanilla assignment which needed no type.
    __openSharedCanvas?: (
      ownerId: string,
      folderId: string,
      title?: string,
      ownerName?: string,
    ) => Promise<void>;
    __resolveReferenceFolderKey?: (ownerId: string, folderId: string) => Promise<string | null>;
  }
}
