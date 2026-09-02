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
    // already an established React -> vanilla bridge (app/dotto/lib/coreState.ts reads it as
    // `window.__dottoSupabase || null`) before any .ts file needed it typed.
    __dottoSupabase?: SupabaseClient;
    // app/dotto/lib/coreState.ts — returns the live, mutated-in-place appState singleton (Phase 3's universal
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
    // app/dotto/lib/notificationsStore.ts — app/dotto/lib/cardShortcuts.ts's hover-scoped
    // game-card/PDF-page-turn shortcuts gate on this so a notification's own Enter/Escape
    // handling wins instead.
    __hasVisibleNotifications?: () => boolean;
    // app/dotto/lib/profileAchievementsPricing.ts
    openPricingOverlay?: () => void;
    // app/dotto/lib/canvasPresence.ts — canonical item-data accessor, used by
    // app/dotto/lib/stopwatch.ts to reach a stopwatch card's own live item (part of
    // appState.folders, not a separate store). Declared again, in full, further down alongside
    // this port's own other bridges.
    // app/dotto/lib/historyAutosave.ts (Phase 4.5 port — was history-autosave.js)
    __saveSnapshot?: () => void;
    __scheduleWorkspaceSave?: () => void;
    // app/dotto/lib/waypointsRenderLoop.ts (Phase 4.5 port — was waypoints-render-loop.js) — the
    // global re-render escape hatch. syncSiblings genuinely is optional at the real call site
    // (defaults true) — this was declared as a 0-arg function before any real caller passed one.
    __render?: (syncSiblings?: boolean) => void;
    __renderSelectedOutlines?: () => void;
    // app/dotto/lib/coreState.ts — the live-read canvas/world DOM element accessors (Phase 3's universal
    // bridge for these two, already consumed by app/dotto/canvasItemBehavior.js, a plain .js file
    // that never needed these declared until a real .ts file touched them here).
    __getCanvasEl?: () => HTMLElement | undefined;
    __getWorldEl?: () => HTMLElement | undefined;
    // srs-algorithm.js (sets this bridge itself — genuinely pure/zero-import, so it can safely do
    // so directly, no longer re-exported through srs-connections-core.js, gone as of its own
    // Phase 4.5 port) — needed by app/dotto/lib/stopwatch.ts's swToggleRun to archive a finished
    // session's rating deltas; public/dotto/*.js isn't reachable from app/dotto/ even for an
    // otherwise-pure function.
    __diffRatings?: (live: unknown, base: unknown) => Record<string, number> | undefined;
    // app/dotto/lib/stopwatch.ts (Phase 4.4 port — was stopwatch.js) — vanilla -> React bridges,
    // not React -> vanilla like most entries here: StopwatchCard.jsx's own onClick already called
    // these as globals before the port (same shape window.pushNotification uses), and
    // stopwatch.js's still-vanilla renderStopwatchHTML calls swToggleRun/swTogglePause the same
    // way via its onclick="..." string attributes.
    swToggleRun?: (id: number) => void;
    swTogglePause?: (id: number) => void;
    // app/dotto/lib/stopwatch.ts — app/dotto/lib/historyAutosave.ts's ensureSwTicking/swTick (its own 1s
    // DOM-patch of a running stopwatch's .sw-time text) and stopwatch.js's renderStopwatchHTML
    // both call these instead of a local function now.
    __swFormatTime?: (ms: number) => string;
    __swCurrentElapsedMs?: (it: Record<string, unknown>) => number;
    // app/dotto/lib/coreState.ts — swaps which pane's fields are the live appState.<field> ones.
    __switchActivePane?: (paneId: number) => void;
    // app/dotto/lib/coreState.ts — resets a freshly-split pane's camera/selection/history to fresh defaults.
    __initializeNewPane?: (paneId: number, folderId: string) => void;
    // app/dotto/lib/waypointsRenderLoop.ts — re-navigates the canvas to a folder (used by
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
    // app/dotto/lib/panelsHamburger.ts (Phase 4.5 port — was panels-hamburger.js)
    __closeRailView?: () => void;
    // app/dotto/lib/sourceButtonsCursorMode.ts
    __applyCursorMode?: () => void;
    // add-menu.js — a card kind's default {w, h} for the placement ghost.
    __kindSize?: (kind: string) => { w: number; h: number };
    // app/dotto/lib/cardShortcuts.ts (Phase 4.5 port — was card-shortcuts.js)
    __deleteSelectedCards?: () => void;
    // Plain (non-`__`) global — real inline onclick target in content/dotto-markup.html and
    // content/fragments/context-menu.html.
    setTableAlign?: (align: string) => void;
    // app/dotto/lib/coreState.ts — registers a per-pane canvas-listener setup function, called once for every
    // future pane's own canvas element (see that function's own comment for the real pane-0-only-
    // listener bug this exists to prevent).
    __registerPaneCanvasListenerSetup?: (
      fn: (canvasEl: HTMLElement, paneId: number) => void,
    ) => void;
    // app/dotto/lib/copyPaste.ts (Phase 4.4 port — was copy-paste.js) — vanilla -> React bridges:
    // history-autosave.js's Cmd+C/X/V keydown handler, blocks-panel.js's handleBlockItemClick, and
    // srs-connections-core.js's 'a'-chord/Escape handling already called these as globals before
    // the port (prepareAdd already was; the other 4 are new here, same shape).
    copySelectedCards?: () => void;
    cutSelectedCards?: () => void;
    pasteClipboardCards?: () => void;
    removePlacementGhost?: () => void;
    prepareAdd?: (kind: string, statKind?: string | null) => void;
    // app/dotto/lib/waypointsRenderLoop.ts — the global folder-navigation entry point. Genuinely
    // async (a shared: key not yet fetched is loaded first) — this was declared as a sync void
    // function before any real caller awaited it.
    __openFolder?: (folderId: string) => Promise<void>;
    // app/dotto/lib/aiAssistantSuggestions.ts — structural (real canvas hierarchy) parent lookup,
    // used by app/dotto/lib/tabManagement.ts's buildAncestorChain.
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
    // app/dotto/lib/waypointsRenderLoop.ts — pans/zooms to fit the current folder's content.
    __centerOnContent?: () => void;
    // app/dotto/lib/sharedAndPublicCanvasLoading.ts (Phase 4.4 port — was
    // shared-and-public-canvas-loading.js) — vanilla -> React bridges: app-init.js,
    // command-verbs.js, history-autosave.js, and waypoints-render-loop.js all previously imported
    // these directly, plus app/dotto/lib/canvasPresence.ts and app/dotto/lib/hamburgerCollab.ts
    // (both ported since).
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
    // app/dotto/lib/historyAutosave.ts — reapplies appState.tx/ty/scale to the canvas transform.
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
    // app/dotto/lib/coreState.ts — the single, never-reassigned #add-menu/#btn-add elements (separate
    // module-level bindings, not appState properties — same reasoning as __getCanvasEl/
    // __getWorldEl above).
    __getAddMenuEl?: () => HTMLElement | undefined;
    __getBtnAddEl?: () => HTMLElement | undefined;
    // app/dotto/lib/panelsHamburger.ts (Phase 4.5 port — was panels-hamburger.js)
    __wireRailIcon?: (
      key: string,
      btn: HTMLElement,
      viewEl: HTMLElement,
      onOpen?: ((pin?: boolean) => void) | null,
    ) => void;
    __openRailView?: (
      key: string,
      viewEl: HTMLElement,
      btn: HTMLElement,
      onOpen?: ((pin?: boolean) => void) | null,
      pin?: boolean,
    ) => void;
    // app/dotto/lib/messagingCanvasPreview.ts — used by app/dotto/lib/marketplace.ts's
    // packageSelectedAsTemplate.
    __snapshotItem?: (it: Record<string, unknown>) => Record<string, unknown>;
    __sanitizeFlashcardSnapshot?: (
      snapshot: Record<string, unknown>,
      batchItemIds: number[],
    ) => Record<string, unknown>;
    // app/dotto-app.jsx (via app/dotto/bridges.js's marketDiscoverStore/marketDetailStore) —
    // React-facing setters, plain store.set (no flushSync — nothing reads their DOM synchronously
    // right after).
    __setMarketDiscover?: (items: Record<string, unknown>[]) => void;
    __setMarketDetail?: (item: Record<string, unknown> | null) => void;
    // blocks-panel.js
    __refreshBlocksPanel?: () => void;
    // app/dotto/lib/libraryPublish.ts (Phase 4.5 port — was library-publish.js)
    __openItemDetail?: (item: Record<string, unknown>, folder: string) => void;
    __deleteMyCreationItem?: (
      item: Record<string, unknown>,
      folderKey: "drafts" | "published",
    ) => void;
    // app/dotto-app.jsx (via app/dotto/bridges.js's itemDetailFooterStore) — React-facing setter,
    // plain store.set, no synchronous DOM read follows it.
    __setItemDetailFooter?: (
      state: { sourceFolder: string | null; itemId: string; dirty: boolean } | null,
    ) => void;
    // Plain (non-`__`) globals — real inline oninput/onclick targets in
    // content/fragments/hamburger-stack.html.
    onItemDetailFieldChange?: () => void;
    confirmPublishFlow?: () => Promise<void>;
    // app/dotto/lib/marketplace.ts (Phase 4.4 port — was marketplace.js) — vanilla -> React
    // bridges: MarketDiscoverPanel.jsx/ItemDetailFooter.jsx already called
    // __openMarketDetail/__deployPurchasedTemplate/__packageSelectedAsTemplate as globals before
    // the port; canvasItemBehavior.js's setupDraggingAndClicking already called
    // __packageSelectedAsTemplate too. handleMarketplaceSearch/closeMarketDetail/
    // purchaseCurrentMarketItem are real inline onclick targets (hamburger-stack.html), same
    // plain (non-`__`) global shape window.pushNotification/window.prepareAdd use.
    __openMarketDetail?: (item: Record<string, unknown>) => void;
    __deployPurchasedTemplate?: (id: string) => void;
    __packageSelectedAsTemplate?: (targetIt: Record<string, unknown>) => void;
    handleMarketplaceSearch?: (val: string) => void;
    closeMarketDetail?: () => void;
    purchaseCurrentMarketItem?: () => Promise<void>;
    __refreshMyLibrary?: () => Promise<void>;
    // drawing-connections.js
    __folderIdForConnectedSource?: (sourceItemId: number) => string | undefined;
    __folderTitleForConnectedSource?: (sourceItemId: number) => string;
    __ensureConnections?: (folder: {
      connections?: { fromId: number; toId: number }[];
    }) => { fromId: number; toId: number }[];
    __createConnection?: (
      conns: { fromId: number; toId: number }[],
      fromId: number,
      toId: number,
    ) => { id: string; fromId: number; toId: number };
    __makeLayerSVG?: (zIndex: number) => SVGSVGElement;
    __ensureDrawings?: (folder: {
      drawings?: Record<string, unknown>[];
    }) => Record<string, unknown>[];
    __findLinkedTable?: (fromItem: Record<string, unknown>) => Record<string, unknown> | null;
    __findTableById?: (tableId: number) => Record<string, unknown> | null;
    __pathNearPoint?: (d: string, px: number, py: number, radius: number) => boolean;
    __penPointsToPath?: (
      points: { x: number; y: number; handleOut: [number, number] | null }[],
    ) => string;
    __pointsToPath?: (pts: [number, number][]) => string;
    // friends-presence.js
    __syncCanvasCollabTitle?: (folderId: string, newTitle: string) => Promise<void>;
    // app/dotto/lib/canvasPresence.ts
    __broadcastEditingState?: (isEditing: boolean, targetSelector?: string) => void;
    __renderInlineCanvas?: (
      items: Record<string, unknown>[],
      draggableOut?: boolean,
      connections?: { fromId: number; toId: number }[],
      onDelete?: (id: number) => void,
    ) => HTMLElement;
    // app/dotto/lib/coreState.ts
    __itemElId?: (id: number, paneId?: number) => string;
    // text-utils.js
    __escapeHtml?: (str: string) => string;
    // app/dotto/lib/shelfSearch.ts (Phase 4.4 port — was shelf-search.js) — vanilla -> React
    // bridges: startRenameShelfName/shelfSelectSession/handleShelfSourceRowClick/
    // startRenameShelfSourceRow/filterShelfRows are real inline onclick="..." targets inside
    // renderShelfHTML's own built HTML string; closeSearchCardsModal is a real inline onclick
    // target (canvas-modal.html); setFilterMode/toggleFilterTag are called from FilterCard.jsx
    // the same plain-global way window.pushNotification is; openSearchCardsModal/
    // clearSearchCardContext have no confirmed remaining caller, kept for parity with the
    // pre-port file.
    startRenameShelfName?: (nameEl: HTMLElement, itemId: number) => void;
    shelfSelectSession?: (id: number, sessionId: string) => void;
    handleShelfSourceRowClick?: (rowEl: HTMLElement, sourceItemId: number) => void;
    startRenameShelfSourceRow?: (labelEl: HTMLElement, sourceItemId: number) => void;
    filterShelfRows?: (inputEl: HTMLInputElement) => void;
    closeSearchCardsModal?: () => void;
    setFilterMode?: (id: number, mode: string) => void;
    toggleFilterTag?: (id: number, tagId: string) => void;
    openSearchCardsModal?: () => void;
    clearSearchCardContext?: () => void;
    // Used by app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3).
    __addCardsToSearchContext?: (ids: number[]) => void;
    __autoGrowSearchInput?: () => void;
    __renderShelfHTML?: (it: Record<string, unknown>) => string;
    // text-utils.js / cards-misc.js / app/dotto/lib/coreState.ts — already-existing bridges, untyped until
    // app/dotto/lib/outlineTree.ts became the first .ts file to reach them.
    __stripHtml?: (html: string) => string;
    __shortUrl?: (url: string) => string;
    // app/dotto/lib/cardsMisc.ts (Phase 4.5) — used by app/dotto/lib/messagingCanvasPreview.ts.
    __toEmbeddableUrl?: (rawUrl: string) => string;
    // Plain (non-`__`) globals — real inline onclick/onchange/oninput targets built into
    // cardsMisc.ts's own renderChecklistHTML output, same shape window.pushNotification uses.
    editEmbed?: (id: number) => void;
    addTask?: (id: number) => void;
    toggleTask?: (id: number, tid: number) => void;
    updateTaskText?: (id: number, tid: number, el: HTMLElement) => void;
    updateTaskDeadline?: (id: number, tid: number, el: HTMLInputElement) => void;
    removeTask?: (id: number, tid: number) => void;
    __findItemEl?: (itemId: number, paneId?: number) => HTMLElement | null;
    // app/dotto/lib/coreState.ts — center of the visible canvas viewport in screen-space X (accounts for the
    // hamburger/rail sidebars eating into the left/right edges), used to invert screen->canvas
    // coordinates the same way smoothPanTo/centerOnContent already do.
    __canvasViewportCenterX?: () => number;
    // app/dotto/lib/historyAutosave.ts — animates tx/ty/scale to the given target over durationMs
    // (default 450ms).
    __smoothPanTo?: (
      targetTx: number,
      targetTy: number,
      targetScale: number,
      durationMs?: number,
    ) => void;
    // app/dotto/lib/mnemonicSearchMatching.ts — brief highlight flash on a canvas element, used to
    // draw the eye after a jump-to-item navigation (outline row click, search result click, etc).
    __flashCanvasElement?: (el: HTMLElement | undefined) => void;
    // app/dotto/lib/sourceTable.ts — moves keyboard focus (and starts editing on Enter-driven nav)
    // to a specific table cell; pos is an optional caret-position hint for text inputs.
    __focusTableCell?: (id: number, r: number, c: number, pos?: "start" | "end") => void;
    // app/dotto/lib/waypointsRenderLoop.ts — expands (or, with opts.editable, opens for rename) a
    // waypoint card's DOM in place. hover/peekMs were missing from this declaration until a real
    // caller (the vanilla original's own hover/nav-jump branches) needed them typed.
    __expandWaypointCard?: (
      el: HTMLElement,
      it: Record<string, unknown>,
      opts?: { editable?: boolean; hover?: boolean; peekMs?: number },
    ) => void;
    // app/dotto/lib/outlineTree.ts (Phase 4.4 port — was outline-tree.js) — React -> vanilla
    // bridges used by OutlinePanel.jsx/FilesListPanel.jsx (already established before this port,
    // just now typed) plus vanilla -> React bridges used by search-panel-history.js/
    // panels-hamburger.js/window-bridge.js/waypoints-render-loop.js/srs-connections-core.js, which
    // all previously imported these directly, plus app/dotto/lib/messagingCanvasPreview.ts and
    // app/dotto/lib/hamburgerCollab.ts (both ported since — the former was live-presence.js's own
    // direct import of kindIconHTML).
    __kindIconFile?: (kind: string, level?: number) => string;
    __goToOutlineSource?: (folderId: string) => void;
    __goToOutlineSourceRow?: (tableItemId: number, rowNumber: number) => void;
    __syncOutlineRows?: (elements: ArrayLike<HTMLElement>) => void;
    __goToOutlineItem?: (folderId: string, itemId: number) => void;
    __toggleOutlineCollapse?: (id: number) => void;
    __buildOutline?: (preserveState?: boolean) => void;
    __kindIconHTML?: (kind: string, level: number | undefined, extraClass: string) => string;
    __rowActionsHTML?: () => string;
    // Real inline oninput target (hamburger-stack.html) — plain global, no underscore, same shape
    // handleMarketplaceSearch/closeMarketDetail use.
    handleOutlineSearch?: (query: string) => void;
    __setOutlineActive?: (idx: number) => void;
    __toggleHamburgerMenu?: () => void;
    // app/dotto-app.jsx (via app/dotto/bridges.js's outlineStore) — React-facing setter, flushSync'd
    // (OutlinePanel.jsx's own useLayoutEffect syncs real DOM nodes back via __syncOutlineRows
    // synchronously right after, so the commit must already be flushed).
    __setOutlineState?: (state: { rows: unknown[]; query: string }) => void;
    // app/dotto/lib/coreState.ts — the single, never-reassigned #context-menu/#draw-settings elements, same
    // "not appState properties" category as __getAddMenuEl/__getBtnAddEl above.
    __getContextMenuEl?: () => HTMLElement | undefined;
    __getDrawSettingsEl?: () => HTMLElement | undefined;
    // app/dotto/lib/coreState.ts — resolves the cursor mode actually in effect right now (accounting for a
    // temporary D/Escape/Shift keyboard override on top of the persistent cardMode).
    __effectiveMode?: () => string;
    // app/dotto/canvasItemBehavior.js (via app/dotto-app.jsx) — recomputes a source table's column
    // widths/scroll affordance against its container's current rendered width.
    __layoutSourceTableColumns?: (
      it: Record<string, unknown>,
      el: HTMLElement,
      reserve?: number,
    ) => void;
    // drawing-connections.js
    __linkSelectedCards?: () => void;
    // friends-presence.js
    __closeCollabPanel?: () => void;
    // app/dotto/lib/hamburgerCollab.ts
    __dispatchListPanelDelete?: (panel: string, ids: string[]) => void;
    // app/dotto/lib/historyAutosave.ts — dual-exposed with the plain `hideCanvasContextMenu`
    // global further down (a real inline onclick target too).
    __hideCanvasContextMenu?: () => void;
    __layoutDotLayer?: () => void;
    // source-tags-ai.js
    __closeCellTagPicker?: () => void;
    // app/dotto/lib/srsConnectionsCore.ts
    __clearDataLinkPending?: () => void;
    // app/dotto/lib/panelsHamburger.ts (Phase 4.5 port — was panels-hamburger.js)
    __closeAllPanels?: (except?: string) => void;
    // app/dotto/lib/sourceButtonsCursorMode.ts (Phase 4.4 port — was
    // source-buttons-cursor-mode.js) — vanilla -> React bridge: panels-hamburger.js/source-table.js/
    // waypoints-render-loop.js/source-tags-ai.js all previously imported this directly.
    __closeSourceAddMenu?: () => void;
    // Real inline onclick target (canvasItemBehavior.js's cell markup) — plain global, no
    // underscore, same shape window.handleOutlineSearch/window.pushNotification use.
    openCellAddMenu?: (id: number, r: number, c: number, btnEl: HTMLElement) => void;
    // app/dotto/lib/coreState.ts — extracts an item's id out of its DOM element (the inverse of __itemElId).
    __parseItemId?: (el: HTMLElement) => number;
    // app/dotto/lib/profileAchievementsPricing.ts
    __awardUserPoints?: (
      actionType: string,
      points: number,
    ) => Promise<{ ok: boolean; reason?: string; totalScore?: number }>;
    __bumpAchievementStat?: (
      achievementId: string,
      delta?: number,
      absolute?: boolean,
    ) => Promise<void>;
    // srs-algorithm.js (sets this bridge itself, same reasoning as __diffRatings above) — used by
    // app/dotto/lib/gamesFlashcardTyperight.ts's fcRate/trCheck.
    __calculateSM2?: (card: Record<string, unknown>, quality: number) => Record<string, unknown>;
    __defaultSrsState?: () => Record<string, unknown>;
    // app/dotto/lib/gamesFlashcardTyperight.ts (Phase 4.4 port — was games-flashcard-typeright.js)
    // — React -> vanilla bridges pre-dating this port (FlashcardCard.jsx/TypeRightCard.jsx now
    // import these directly instead, being in the same app/dotto/ tree; GameOptionsPanel.jsx does
    // too — these stay declared/assigned since app/dotto/lib/messagingCanvasPreview.ts's mini
    // previews reach cellContentType/colHasAnyCloze indirectly through renderFlashcardHTML/
    // renderTypeRightHTML, not directly, so kept for parity/safety rather than proven-unused).
    __cellContentType?: (html: string) => "text" | "image" | "audio";
    __colHasAnyCloze?: (it: Record<string, unknown>, i: number) => boolean;
    __normalizeGameSlot?: (entry: unknown) => { col: number; mode: "plain" | "blank" | "extract" };
    __fcCurrentRow?: (
      it: Record<string, unknown>,
      playable: Record<string, unknown>[],
    ) => Record<string, unknown> | null;
    __fcPlayableCards?: (it: Record<string, unknown>) => Record<string, unknown>[];
    __renderGameFaceBlocksHTML?: (
      blocks:
        { col: number; type: "text" | "image" | "audio"; text: string; html: string }[] | undefined,
    ) => string;
    __resolveGameFace?: (
      it: Record<string, unknown>,
      row: Record<string, unknown>,
      side: "front" | "back",
    ) => { col: number; type: "text" | "image" | "audio"; text: string; html: string }[];
    __trCurrentCard?: (
      it: Record<string, unknown>,
      playable: Record<string, unknown>[],
    ) => Record<string, unknown> | null;
    __trPlayableCards?: (it: Record<string, unknown>) => Record<string, unknown>[];
    // Vanilla -> React bridges: waypoints-render-loop.js/srs-connections-core.js all previously
    // imported these directly, plus app/dotto/lib/messagingCanvasPreview.ts (ported since — was
    // live-presence.js's own direct import).
    __openGameOptionsPanel?: (id: number) => void;
    __closeGameOptionsPanel?: (id: number) => void;
    __defaultFlashcardDeck?: () => Record<string, unknown>[];
    __renderFlashcardHTML?: (it: Record<string, unknown>) => string;
    __renderTypeRightHTML?: (it: Record<string, unknown>) => string;
    // Plain (non-`__`) globals — real inline onclick/oninput/onmouseenter targets built into
    // gamesFlashcardTyperight.ts's own HTML strings, same shape window.pushNotification/
    // window.handleMarketplaceSearch use. Formerly re-exported through window-bridge.js's own
    // centralized inline-handler list.
    setGameColumnSlot?: (
      id: number,
      side: "front" | "back",
      slotIndex: number,
      value: string,
    ) => void;
    addGameColumnSlot?: (id: number, side: "front" | "back") => void;
    removeGameColumnSlot?: (id: number, side: "front" | "back", slotIndex: number) => void;
    fcFlip?: (id: number) => void;
    fcRate?: (id: number, rating: string) => void;
    fcToggleMode?: (id: number) => void;
    trUpdateInput?: (id: number, value: string) => void;
    trFocusInput?: (id: number) => void;
    trCheck?: (id: number) => void;
    trNext?: (id: number) => void;
    trToggleMode?: (id: number) => void;
    // search-orchestration-selection.js — used by app/dotto/lib/mediaPdfEpub.ts's buildEpubViewer
    // to feed the "select text -> Add to source"/"Look up" flow from inside an EPUB's own
    // same-origin iframe.
    __showSelectionToolbarFor?: (
      range: Range,
      host: HTMLElement,
      rectOverride?: { left: number; top: number; width: number; height: number },
    ) => void;
    // app/dotto/lib/mediaPdfEpub.ts (Phase 4.4 port — was media-pdf-epub.js) — React -> vanilla
    // bridges pre-dating this port (MediaCard.jsx now imports these directly instead, being in the
    // same app/dotto/ tree — kept declared/assigned since app/dotto/lib/messagingCanvasPreview.ts's
    // mini previews still need them) plus vanilla -> React bridges: live-presence.js/window-
    // bridge.js/upload-popup.js all previously imported these directly (as of this file's own
    // port — live-presence.js has since been ported too, see messagingCanvasPreview.ts above).
    __renderMediaHTML?: (it: Record<string, unknown>) => string;
    __buildPdfViewer?: (it: Record<string, unknown>) => HTMLElement;
    __buildEpubViewer?: (it: Record<string, unknown>) => HTMLElement;
    __processMediaFile?: (id: number, file: File | undefined | null) => void;
    // Plain (non-`__`) globals — real inline onclick targets built into
    // mediaPdfEpub.ts's renderMediaHTML output, same shape window.pushNotification/
    // window.handleMarketplaceSearch use.
    setMediaFromLink?: (id: number) => void;
    triggerMediaUpload?: (id: number) => void;
    clearMedia?: (id: number) => void;
    // app/dotto/lib/canvasPresence.ts — places the caret at the end of an element's content.
    __placeCaretEnd?: (el: HTMLElement) => void;
    // drawing-connections.js — same as __findItemById, but also reaches a table living in a
    // different folder than the one currently open (e.g. a flashcard fed via a connected Stack).
    __resolveTableForEdit?: (id: number) => Record<string, unknown> | undefined;
    // app/dotto/lib/sourceTable.ts (Phase 4.4 port — was source-table.js) — React -> vanilla
    // bridges pre-dating this port (TableCard.jsx now imports the technical ones directly instead,
    // being in the same app/dotto/ tree — kept declared/assigned since still-vanilla callers need
    // them too) plus a new bridge for source-tags-ai.js's still-vanilla triggerSourceUpload.
    __distributeTableSizing?: (it: Record<string, unknown>, el: HTMLElement) => void;
    __mergeTableCells?: (
      id: number,
      regionA: { r1: number; c1: number; r2: number; c2: number },
      regionB: { r1: number; c1: number; r2: number; c2: number },
    ) => void;
    __renderTableHTML?: (it: Record<string, unknown>) => string;
    __colgroupHTML?: (numCols: number) => string;
    __importDelimitedIntoSource?: (text: string, delim: string) => void;
    // Plain (non-`__`) globals — real inline onclick/oninput/onkeydown/onmousedown/onfocus targets
    // built into sourceTable.ts's own renderTableHTML output, canvasItemBehavior.js's source-page
    // markup, and static HTML fragments (source-add-menu.html/audio-record-indicator.html), same
    // shape window.pushNotification/window.handleMarketplaceSearch use. updateTableCell/
    // handleTableKeydown/addTableCol/addTableRow/handleCellMouseDown are ALSO real ES imports in
    // TableCard.jsx now (same precedent as every recent Phase 4.4 port).
    updateTableCell?: (id: number, r: number, c: number, el: HTMLElement) => void;
    handleTableKeydown?: (e: KeyboardEvent, id: number, r: number, c: number) => void;
    addTableCol?: (id: number) => void;
    addTableRow?: (id: number) => void;
    handleCellMouseDown?: (e: MouseEvent) => void;
    renameTableColumn?: (id: number, colIndex: number, value: string) => void;
    handleColNameKeydown?: (e: KeyboardEvent, id: number, colIndex: number) => void;
    setLastFocusedCell?: (id: number, r: number, c: number) => void;
    triggerCellImageUpload?: () => void;
    triggerCellAudioUpload?: () => void;
    startCellAudioRecording?: () => void;
    stopCellAudioRecording?: () => void;
    // app/dotto/lib/aiAssistantSuggestions.ts (Phase 4.5 port — was ai-assistant-suggestions.js) —
    // used by app/dotto/lib/panelsHamburger.ts's wireRailIcon/openRailView calls for the AI rail
    // icon.
    __refreshAiPanel?: () => void;
    __resetAiSearchState?: () => void;
    // app/dotto/lib/aiAssistantSuggestions.ts — used by search-orchestration-selection.js (still
    // vanilla), which used to import these 4 directly.
    __updateChatThread?: () => void;
    __scrollChatThreadToBottom?: () => void;
    __updateSearchDropdown?: () => void;
    __showAiChatView?: () => void;
    // app/dotto/lib/hamburgerCollab.ts (Phase 4.5 port — was hamburger-collab.js) — used by
    // app/dotto/lib/panelsHamburger.ts's openRailView/wireRailIcon calls.
    __clearListPanelSelection?: () => void;
    __renderFilesList?: (query?: string) => void;
    __renderHubCollabList?: (query?: string) => void;
    __renderSourcesList?: (query?: string) => void;
    __renderWaypointsList?: (query?: string) => void;
    // app/dotto/lib/panelsHamburger.ts (Phase 4.5 port — was panels-hamburger.js) — vanilla ->
    // React bridges: blocks-panel.js/ai-assistant-suggestions.js/card-shortcuts.js/extensions-
    // panel.js/history-autosave.js/hamburger-collab.js/friends-presence.js/messages-schedule.js/
    // profile-achievements-pricing.js/source-tags-ai.js/srs-connections-core.js all previously
    // imported these directly.
    __isAnyUiPanelOpen?: () => boolean;
    // app/dotto/lib/hamburgerCollab.ts — already an established runtime bridge
    // (WaypointsListPanel.jsx's own row click), just never typed here until
    // app/dotto/lib/srsConnectionsCore.ts (Phase 4.5) needed it too, for the same 1-9/0
    // waypoints-panel jump shortcut.
    __goToWaypointCard?: (ownerId: string, folderId: string, itemId: number) => Promise<void>;
    __scheduleHoverClose?: (
      name: string,
      hoverEls: (HTMLElement | undefined | null)[],
      closeFn: () => void,
    ) => void;
    __pinOnInsideClick?: (name: string, els: (HTMLElement | undefined | null)[]) => void;
    // Plain (non-`__`) globals — real inline oninput targets (content/fragments/hamburger-
    // stack.html), same shape window.pushNotification/window.handleMarketplaceSearch use.
    handleFilesSearch?: (v: string) => void;
    handleHubCollabSearch?: (v: string) => void;
    handleSourcesSearch?: (v: string) => void;
    handleWaypointsSearch?: (v: string) => void;
    // app/dotto/lib/coreState.ts — same live-read reasoning as __getCanvasEl/__getWorldEl above.
    __getCursorOverlayEl?: () => HTMLElement | undefined;
    // app/dotto/lib/profileAchievementsPricing.ts
    __renderAvatarInto?: (
      el: HTMLElement,
      avatar: { id: number; url: string | null },
      fallbackText: string,
    ) => void;
    // app/dotto-app.jsx (via app/dotto/bridges.js's profileLevelStore/achievementsStore/
    // pricingOverlayStore) — React-facing setters, plain store.sets, no synchronous DOM read
    // follows any of them.
    __setProfileLevel?: (state: { displayName: string; tierColor: string }) => void;
    __setAchievements?: (unlockedIds: string[]) => void;
    __setPricingOverlayOpen?: (open: boolean) => void;
    // React -> vanilla bridges — used by AchievementsGrid.jsx (app/dotto/), which can't import
    // these directly since public/dotto/*.js isn't reachable from app/dotto/. True constants
    // (never reassigned after init), unlike __setProfileLevel/__setAchievements above.
    __ACHIEVEMENTS?: {
      id: string;
      statKey: string;
      threshold: number;
      name: string;
      spriteIndex: number;
    }[];
    __SPRITE_TOTAL_COUNT?: number;
    // Plain (non-`__`) globals — real inline onclick targets in
    // content/fragments/hamburger-stack.html/canvas-modal.html.
    closeDotbotUpgradeModal?: () => void;
    showProfileMainView?: () => void;
    showProfileSettingsView?: () => void;
    // app/dotto/lib/canvasPresence.ts (Phase 4.5 port — was part of live-presence.js) — React ->
    // vanilla bridges pre-dating this port (kept declared/assigned since still-vanilla callers
    // need them too) plus new vanilla -> React bridges: ai-assistant-suggestions.js/cards-misc.js/
    // card-shortcuts.js/drawing-connections.js/history-autosave.js/hamburger-collab.js/friends-
    // presence.js/drag-drop-chat.js/srs-connections-core.js/window-bridge.js/waypoints-render-
    // loop.js all previously imported these directly.
    __findItemById?: (id: number) => Record<string, unknown> | undefined;
    __ensureCanvasPresenceChannel?: () => void;
    __repositionAllRemoteCursors?: () => void;
    __goToCollaboratorCursor?: (userId: string) => void;
    __broadcastCursorPositionThrottled?: () => void;
    __broadcastItemDragPositions?: (startPositions: { id: number }[]) => void;
    __broadcastItemResize?: (id: number, w: number, h: number) => void;
    __queueSyncDiff?: (folderObj: Record<string, unknown>) => void;
    // Plain (non-`__`) global too — broadcastEditingState is ALSO a real inline onfocus/onblur
    // target (canvasItemBehavior.js's cell markup), kept alongside the `__` bridge above since
    // real callers elsewhere (app/dotto/lib/waypointsRenderLoop.ts's own .onblur closures, reached
    // via this bridge since it's a different lib file) need programmatic access too, not just the
    // inline-HTML-string form.
    broadcastEditingState?: (isEditing: boolean, targetSelector?: string) => void;
    // add-menu.js
    __searchKindLabel?: (it: Record<string, unknown>) => string;
    // app/dotto/lib/aiAssistantSuggestions.ts
    __countSourceEntries?: (folderId: string) => number;
    // app/dotto/lib/cardsMisc.ts
    __renderChecklistHTML?: (it: Record<string, unknown>) => string;
    __renderStatcardHTML?: (it: Record<string, unknown>) => string;
    // stopwatch.js
    __renderStopwatchHTML?: (it: Record<string, unknown>) => string;
    // app/dotto/lib/messagingCanvasPreview.ts (Phase 4.5 port — was part of live-presence.js) —
    // React -> vanilla bridges pre-dating this port (TitleCard.jsx/MsgConvo.jsx/
    // SharedCanvasModalBody.jsx/CollabListPanel.jsx/FilesListPanel.jsx/MessagesListPanel.jsx/
    // MarketDetailPanel.jsx/TableCard.jsx now import these directly instead, all in the same
    // app/dotto/ tree — kept declared/assigned since still-vanilla callers need them too) plus new
    // vanilla -> React bridges: blocks-panel.js/friends-presence.js/messages-schedule.js/drag-
    // drop-chat.js/library-publish.js/window-bridge.js all previously imported these directly.
    __syncColorPicker?: (bodyEl: HTMLElement) => void;
    __titleFontSize?: (level: number) => number;
    __renderRealCardPreview?: (it: Record<string, unknown>) => HTMLElement;
    __renderMsgSnapshotCard?: (item: Record<string, unknown>) => HTMLElement;
    __openSharedCanvasView?: (items: Record<string, unknown>[]) => void;
    __miniLabelForItem?: (item: Record<string, unknown>) => string;
    __importSharedCardsAtScreenPoint?: (
      items: Record<string, unknown>[],
      clientX: number,
      clientY: number,
    ) => void;
    __openConvo?: (friendId: string) => void;
    __renderConvoBody?: (f: Record<string, unknown>) => void;
    __closeMessagesPanel?: () => void;
    __renderMsgList?: (query: string) => void;
    // app/dotto-app.jsx (via app/dotto/bridges.js's msgConvoStore/sharedCanvasModalStore) —
    // React-facing setters, plain store.set (no flushSync — see renderConvoBody/openSharedCanvasView's
    // own comments for why neither needs it).
    __setMsgConvo?: (state: Record<string, unknown> | null) => void;
    __setSharedCanvasModal?: (state: Record<string, unknown> | null) => void;
    // Plain (non-`__`) globals — real inline onclick targets (content/fragments/hamburger-
    // stack.html/canvas-modal.html), same shape window.pushNotification/
    // window.handleMarketplaceSearch use.
    closeConvo?: () => void;
    sendMsg?: () => Promise<void>;
    closeSharedCanvasView?: () => void;
    setTitleLevel?: (id: number, level: string | number) => void;
    // app/dotto/lib/coreState.ts — same "single, never-reassigned element" category as addMenu/btnAdd/
    // contextMenu above.
    __getCanvasContextMenuEl?: () => HTMLElement | undefined;
    __getZoomTrackEl?: () => HTMLElement | undefined;
    __getZoomFillEl?: () => HTMLElement | undefined;
    __getZoomThumbEl?: () => HTMLElement | undefined;
    // app/dotto/lib/coreState.ts — same live-read reasoning as __getCanvasEl/__getWorldEl above.
    __getDotLayerEl?: () => HTMLElement | undefined;
    // app/dotto/lib/coreState.ts — same "single, never-reassigned element" category as addMenu/btnAdd/
    // contextMenu above. Used by app/dotto/lib/srsConnectionsCore.ts (Phase 4.5).
    __getDrawColorInputEl?: () => HTMLInputElement | undefined;
    __getDrawSizeInputEl?: () => HTMLInputElement | undefined;
    __getDrawPenBtnEl?: () => HTMLElement | undefined;
    __getDrawEraserBtnEl?: () => HTMLElement | undefined;
    __getDrawFrontBtnEl?: () => HTMLElement | undefined;
    __getDrawBackBtnEl?: () => HTMLElement | undefined;
    __recomputeTopCardZIndex?: () => void;
    __restorePaneState?: (paneId: number, savedFields: Record<string, unknown>) => void;
    // app/dotto/lib/aiAssistantSuggestions.ts
    __clearSearch?: () => void;
    // global-ids.js
    __generateGlobalId?: () => string;
    // app/dotto/lib/hamburgerCollab.ts
    __resolveSharedFolderChain?: (ownerId: string, folderId: string) => Promise<string[] | null>;
    // app/dotto/lib/profileAchievementsPricing.ts (Phase 4.5 port — was profile-achievements-pricing.js)
    __closeDotbotUpgradeModal?: () => void;
    __closePricingOverlay?: () => void;
    __refreshDotbotUsage?: () => Promise<void>;
    __closeProfilePanel?: () => void;
    __openDotbotUpgradeModal?: () => void;
    // app/dotto/lib/srsConnectionsCore.ts
    __cancelAddingKind?: () => void;
    __finishPenPolyline?: () => void;
    // upload-popup.js
    __closeUploadPopup?: () => void;
    // app/dotto-app.jsx (via app/dotto/bridges.js's paneLayoutStore) — __setPaneLayout is
    // flushSync'd (every restored pane's own DOM must exist synchronously before
    // window.__listPaneIds() is read right after it).
    __getPaneLayout?: () => Record<string, unknown> | null;
    __setPaneLayout?: (tree: Record<string, unknown>) => void;
    // app/dotto/lib/historyAutosave.ts (Phase 4.5 port — was history-autosave.js) — vanilla ->
    // React bridges: ai-assistant-suggestions.js/card-shortcuts.js/app-init.js/cards-misc.js/
    // drag-drop-chat.js/drawing-connections.js/hamburger-collab.js/search-orchestration-
    // selection.js/command-verbs.js/srs-connections-core.js/window-bridge.js/table-grid-resize.js/
    // source-tags-ai.js/mnemonic-search-matching.js/waypoints-render-loop.js all previously
    // imported these directly.
    __loadWorkspace?: () => Promise<boolean>;
    __saveWorkspaceNow?: () => Promise<void>;
    __scheduleApplyTransform?: () => void;
    __ensureSwTicking?: () => void;
    __updateContextMenuPosition?: () => void;
    __undo?: () => void;
    __redo?: () => void;
    // Plain (non-`__`) globals — real inline onclick/onmouseenter/onmouseleave/oncontextmenu
    // targets (content/fragments/canvas-context-menu.html, canvasItemBehavior.js's cell markup),
    // same shape window.pushNotification/window.handleMarketplaceSearch use.
    undo?: () => void;
    redo?: () => void;
    hideCanvasContextMenu?: () => void;
    deleteContextColumn?: () => void;
    deleteContextRow?: () => void;
    highlightContextColumn?: (on: boolean) => void;
    highlightContextRow?: (on: boolean) => void;
    openTableCellContextMenu?: (e: MouseEvent, tableId: number, r: number, c: number) => void;
    // Used by app/dotto/lib/srsConnectionsCore.ts (Phase 4.5 port — was srs-connections-core.js)
    // — add-menu.js/ai-assistant-suggestions.js/profile-achievements-pricing.js/theme-toggle.js/
    // upload-popup.js/waypoints-render-loop.js all previously imported these directly.
    __kindLabel?: (kind: string) => string;
    __openSearchOverlay?: () => void;
    __showProfileSettingsView?: () => void;
    __toggleTheme?: () => void;
    __toggleUploadPopup?: () => void;
    __startBoxSelection?: (e: PointerEvent) => void;
    __syncWaypointToDb?: (folderId: string, it: Record<string, unknown>) => Promise<void>;
    // srsConnectionsCore.ts's own outbound bridges — FilterCard.jsx/canvasItemBehavior.js (React ->
    // vanilla) and drawing-connections.js/waypoints-render-loop.js/window-bridge.js/app-init.js/
    // command-verbs.js/source-tags-ai.js/upload-popup.js (vanilla -> React) all reach these.
    __applyFilterToRows?: (
      item: Record<string, unknown>,
      rows: Record<string, unknown>[],
    ) => Record<string, unknown>[];
    __collectAvailableFilterTags?: (
      rows: Record<string, unknown>[] | undefined,
    ) => { id: number; name: string; color?: string }[];
    __deepCloneItem?: (it: Record<string, unknown>) => Record<string, unknown>;
    __deleteClonedItemFolders?: (item: Record<string, unknown> | undefined) => void;
    __handlePenPointerDown?: (e: PointerEvent) => void;
    __isValidConnection?: (fromId: number, toId: number) => boolean;
    __handleDataModeClick?: (it: Record<string, unknown>, el: HTMLElement) => void;
    __applyConnections?: (folderObj: Record<string, unknown>) => void;
    __createNewSource?: () => void;
    // Real inline onclick target (content/fragments/hamburger-stack.html's "New source" +
    // button), dual-exposed alongside __createNewSource above — same shape
    // window.hideCanvasContextMenu/window.__hideCanvasContextMenu use.
    createNewSource?: () => void;
    __viewportCenterWorldPoint?: () => { x: number; y: number };
    __updateDrawLayerBtns?: () => void;
    __add?: (kind: string, x?: number, y?: number, statKind?: string | null) => void;
    // app/dotto/lib/coreState.ts — same "single, never-reassigned element"/live-read categories as
    // __getBtnAddEl/__getCanvasEl above. Used by app/dotto/lib/waypointsRenderLoop.ts (Phase 4.5).
    __getZoomControlEl?: () => HTMLElement | undefined;
    __paneElId?: (staticId: string, paneId?: number) => string;
    __otherPanesViewingFolder?: (folderId: string, excludePaneId: number) => number[];
    __mirrorItemToSiblingPanes?: (itemId: number, apply: (el: HTMLElement) => void) => void;
    // bridges.js (via app/dotto-app.jsx, flushSync-wrapped) — see __renderCanvasItems's own
    // comment there for why it must commit synchronously.
    __renderCanvasItems?: (items: Record<string, unknown>[], paneId: number) => void;
    __setMediaViewerZoom?: (paneId: number, state: { show: boolean; zoom: number }) => void;
    // friends-presence.js
    __refreshCanvasCollabForCurrentFolder?: () => Promise<void>;
    __renderCollabPill?: () => void;
    // app/dotto/lib/cardShortcuts.ts
    __findNextFreeSlot?: (folderId: string) => number;
    // waypointsRenderLoop.ts's own outbound bridges (Phase 4.5 port — was
    // waypoints-render-loop.js) — CanvasItemsLayer.jsx/CanvasCard.jsx/SourceCard.jsx/NoteCard.jsx/
    // WatermarkCard.jsx/TitleCard.jsx/WaypointCard.jsx/FilesListPanel.jsx/PaneZoomBar.jsx/
    // SourcesListPanel.jsx/TabsBar.jsx (React -> vanilla) and drawing-connections.js/
    // search-orchestration-selection.js/app-init.js/command-verbs.js/
    // source-tags-ai.js (vanilla -> React) all reach these.
    __applyCanvasItemWrapperAttrs?: (el: HTMLElement, it: Record<string, unknown>) => void;
    __attachUniversalItemBehavior?: (el: HTMLElement, it: Record<string, unknown>) => void;
    __attachWatermarkBody?: (
      el: HTMLElement,
      b: HTMLElement,
      it: Record<string, unknown>,
      paneId?: number,
    ) => void;
    __attachTitleBody?: (
      el: HTMLElement,
      b: HTMLElement,
      it: Record<string, unknown>,
      paneId?: number,
    ) => void;
    __attachNoteBody?: (el: HTMLElement, it: Record<string, unknown>, paneId?: number) => void;
    __syncNoteFormatButtons?: (bodyEl: HTMLElement) => void;
    __buildFolderInlineCanvas?: (folderId: string) => HTMLElement;
    __startRenameFolderCardTitle?: (
      titleEl: HTMLElement,
      it: { id?: number; folderId: string },
      editingClass?: string,
      selectAll?: boolean,
    ) => void;
    __folderTitle?: (folderId: string) => string;
    __folderGlobalId?: (folderId: string) => string;
    __attachFolderCardClick?: (
      el: HTMLElement,
      it: Record<string, unknown>,
      titleEl: HTMLElement,
    ) => void;
    __attachWaypointCardBody?: (el: HTMLElement, it: Record<string, unknown>) => void;
    __attachSourceCardClick?: (
      el: HTMLElement,
      it: Record<string, unknown>,
      titleEl: HTMLElement,
    ) => void;
    __performMerge?: (source: Record<string, unknown>, targetEl: HTMLElement) => void;
    __spawnMediaItemAt?: (
      source: Record<string, unknown>,
      clientX: number,
      clientY: number,
      paneId?: number,
    ) => void;
    __renderMediaViewerZoom?: (paneId?: number) => void;
    __setMediaViewerZoomLevel?: (paneId: number, zoom: number) => void;
    __deleteWaypointFromDb?: (folderId: string, itemId: number) => Promise<void>;
    __deleteCanvasCollabsForFolder?: (folderId: string) => Promise<void>;
    __cascadeDeleteFolderContents?: (folderId: string) => Promise<void>;
    __deleteWaypointCardEverywhere?: (
      ownerId: string,
      folderId: string,
      itemId: number | string,
    ) => Promise<void>;
    // app/dotto-app.jsx — set inline during DottoApp's own render body (not an effect, not module
    // eval — see that file's own comment for why: dotto-script.js's afterInteractive <Script> tag,
    // and app/dotto/lib/coreState.ts's own ensureCoreState(), both need this ready before they run).
    __DOTTO_USER__?: {
      id: string | null;
      username: string;
      displayName?: string;
      unlockedAchievementIds?: string[];
      [key: string]: unknown;
    };
    // app/dotto-app.jsx (via activePaneIdStore, bridges.js) — lets PaneZoomBar.jsx react to which
    // pane is active.
    __setActivePaneId?: (paneId: number) => void;
    // app/dotto/lib/coreState.ts (Phase 4.5 port — was core-state.js) — used by
    // app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3), same reasoning as
    // window.__getAppState.
    __bringCardToFront?: (it: Record<string, unknown> | undefined, el?: HTMLElement | null) => void;

    // app/dotto-app.jsx (via app/dotto/bridges.js's various stores) — React-facing setters for the
    // Phase 4.5 aiAssistantSuggestions.ts/hamburgerCollab.ts/mnemonicSearchMatching.ts trio.
    __setCommandPalette?: (state: { rows: Record<string, unknown>[] } | null) => void;
    __setSearchSuggestions?: (state: Record<string, unknown> | null) => void;
    __setChatThread?: (turns: { id: string; query: string; panels: unknown }[]) => void;
    __setHubCollabList?: (state: {
      view: string;
      requestsCount?: number;
      ownedShown?: unknown[];
      sharedShown?: unknown[];
      requests?: unknown[];
      query?: string;
    }) => void;
    __setWaypointsList?: (state: { rows: unknown[]; query: string }) => void;
    __setSourcesList?: (state: { rows: unknown[]; query: string }) => void;
    __setFilesList?: (state: { rows: unknown[]; query: string }) => void;
    __setChatsList?: (rows: { id: string; title: string; updated_at: string }[]) => void;
    __setListPanelSelection?: (state: { panel: string | null; ids: Set<string> }) => void;
    __setImageResult?: (state: Record<string, unknown> | null) => void;
    __setTranslationPanel?: (panel: unknown) => void;
    __setDictionaryPanel?: (panel: unknown) => void;
    __setExamplesPanel?: (panel: unknown) => void;
    __setRecommendedSearches?: (panel: unknown) => void;
    __setDotbotAnswer?: (state: Record<string, unknown> | null) => void;

    // command-palette.js — new bridge for this port; app/dotto/lib/aiAssistantSuggestions.ts used
    // to import updateCommandPalette directly (vanilla-to-vanilla), which no longer reaches across
    // the public/app boundary now that it's ported.
    __updateCommandPalette?: (value: string) => void;
    // search-orchestration-selection.js — new bridge for this port, same reasoning:
    // app/dotto/lib/mnemonicSearchMatching.ts used to import commenceDotbotSearch directly.
    __commenceDotbotSearch?: (query: string) => void;
    // friends-presence.js — new bridge for this port; app/dotto/lib/hamburgerCollab.ts used to
    // import activePaneCollabBubbleEl directly (vanilla-to-vanilla).
    __activePaneCollabBubbleEl?: () => HTMLElement | undefined;
    // friends-presence.js — already an established runtime bridge, just never typed here until
    // app/dotto/lib/hamburgerCollab.ts (Phase 4.5) needed it too.
    __openCollabPanel?: (pin?: boolean) => void;
    // app/dotto/lib/mnemonicSearchMatching.ts — kept as bridges (not upgraded to real imports)
    // since search-orchestration-selection.js (still vanilla) is a real caller alongside
    // SearchSuggestionsPanel.jsx.
    __buildMnemonicErrorEl?: (reason: string) => HTMLElement;
    __commenceSearchOrMnemonic?: (query: string) => void;
    // Plain (non-`__`) globals — real inline oninput/onfocus/onclick targets in
    // content/fragments/hamburger-stack.html and content/dotto-markup.html.
    handleSearchFocus?: () => void;
    handleSearchInput?: (value: string) => void;
    showAiListView?: () => void;
    hmenuAction?: (action: string) => void;
  }
}
