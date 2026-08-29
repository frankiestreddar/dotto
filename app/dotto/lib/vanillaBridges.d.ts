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
    __scheduleWorkspaceSave?: () => void;
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
    // app/dotto/lib/sourceButtonsCursorMode.ts
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
    // core-state.js — the single, never-reassigned #add-menu/#btn-add elements (separate
    // module-level bindings, not appState properties — same reasoning as __getCanvasEl/
    // __getWorldEl above).
    __getAddMenuEl?: () => HTMLElement | undefined;
    __getBtnAddEl?: () => HTMLElement | undefined;
    // panels-hamburger.js
    __wireRailIcon?: (
      key: string,
      btn: HTMLElement,
      viewEl: HTMLElement,
      onOpen: () => void,
    ) => void;
    __openRailView?: (
      key: string,
      viewEl: HTMLElement,
      btn: HTMLElement,
      onOpen: () => void,
      pin: boolean,
    ) => void;
    // live-presence.js — used by app/dotto/lib/marketplace.ts's packageSelectedAsTemplate.
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
    // library-publish.js
    __openItemDetail?: (item: Record<string, unknown>, folder: string) => void;
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
    // friends-presence.js
    __syncCanvasCollabTitle?: (folderId: string, newTitle: string) => Promise<void>;
    // live-presence.js
    __broadcastEditingState?: (isEditing: boolean, targetSelector?: string) => void;
    __renderInlineCanvas?: (
      items: Record<string, unknown>[],
      draggableOut: boolean,
      connections: { fromId: number; toId: number }[],
      onDelete: (id: number) => void,
    ) => HTMLElement;
    // core-state.js
    __itemElId?: (id: number, paneId?: number) => string;
    // ai-assistant-suggestions.js
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
    // text-utils.js / cards-misc.js / core-state.js — already-existing bridges, untyped until
    // app/dotto/lib/outlineTree.ts became the first .ts file to reach them.
    __stripHtml?: (html: string) => string;
    __shortUrl?: (url: string) => string;
    __findItemEl?: (itemId: number, paneId?: number) => HTMLElement | null;
    // core-state.js — center of the visible canvas viewport in screen-space X (accounts for the
    // hamburger/rail sidebars eating into the left/right edges), used to invert screen->canvas
    // coordinates the same way smoothPanTo/centerOnContent already do.
    __canvasViewportCenterX?: () => number;
    // history-autosave.js — animates tx/ty/scale to the given target over durationMs (default
    // 450ms).
    __smoothPanTo?: (
      targetTx: number,
      targetTy: number,
      targetScale: number,
      durationMs?: number,
    ) => void;
    // mnemonic-search-matching.js — brief highlight flash on a canvas element, used to draw the
    // eye after a jump-to-item navigation (outline row click, search result click, etc).
    __flashCanvasElement?: (el: HTMLElement | undefined) => void;
    // source-table.js — moves keyboard focus (and starts editing on Enter-driven nav) to a
    // specific table cell; pos is an optional caret-position hint for text inputs.
    __focusTableCell?: (id: number, r: number, c: number, pos?: unknown) => void;
    // waypoints-render-loop.js — expands (or, with opts.editable, opens for rename) a waypoint
    // card's DOM in place.
    __expandWaypointCard?: (
      el: HTMLElement,
      it: Record<string, unknown>,
      opts?: { editable?: boolean },
    ) => void;
    // app/dotto/lib/outlineTree.ts (Phase 4.4 port — was outline-tree.js) — React -> vanilla
    // bridges used by OutlinePanel.jsx/FilesListPanel.jsx (already established before this port,
    // just now typed) plus vanilla -> React bridges used by hamburger-collab.js/live-presence.js/
    // search-panel-history.js/panels-hamburger.js/window-bridge.js/waypoints-render-loop.js/
    // srs-connections-core.js, which all previously imported these directly.
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
    // core-state.js — the single, never-reassigned #context-menu/#draw-settings elements, same
    // "not appState properties" category as __getAddMenuEl/__getBtnAddEl above.
    __getContextMenuEl?: () => HTMLElement | undefined;
    __getDrawSettingsEl?: () => HTMLElement | undefined;
    // core-state.js — resolves the cursor mode actually in effect right now (accounting for a
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
    // hamburger-collab.js
    __dispatchListPanelDelete?: (panel: string, ids: number[]) => void;
    // history-autosave.js
    __hideCanvasContextMenu?: () => void;
    // source-tags-ai.js
    __closeCellTagPicker?: () => void;
    // srs-connections-core.js
    __clearDataLinkPending?: () => void;
    // panels-hamburger.js
    __closeAllPanels?: (except?: string) => void;
    // app/dotto/lib/sourceButtonsCursorMode.ts (Phase 4.4 port — was
    // source-buttons-cursor-mode.js) — vanilla -> React bridge: panels-hamburger.js/source-table.js/
    // waypoints-render-loop.js/source-tags-ai.js all previously imported this directly.
    __closeSourceAddMenu?: () => void;
    // Real inline onclick target (canvasItemBehavior.js's cell markup) — plain global, no
    // underscore, same shape window.handleOutlineSearch/window.pushNotification use.
    openCellAddMenu?: (id: number, r: number, c: number, btnEl: HTMLElement) => void;
    // core-state.js — extracts an item's id out of its DOM element (the inverse of __itemElId).
    __parseItemId?: (el: HTMLElement) => number;
    // profile-achievements-pricing.js
    __awardUserPoints?: (
      actionType: string,
      points: number,
    ) => Promise<{ ok: boolean; reason?: string; totalScore?: number }>;
    __bumpAchievementStat?: (
      achievementId: string,
      delta?: number,
      absolute?: boolean,
    ) => Promise<void>;
    // srs-algorithm.js (re-exported from srs-connections-core.js, same reasoning as __diffRatings
    // above) — used by app/dotto/lib/gamesFlashcardTyperight.ts's fcRate/trCheck.
    __calculateSM2?: (card: Record<string, unknown>, quality: number) => Record<string, unknown>;
    __defaultSrsState?: () => Record<string, unknown>;
    // app/dotto/lib/gamesFlashcardTyperight.ts (Phase 4.4 port — was games-flashcard-typeright.js)
    // — React -> vanilla bridges pre-dating this port (FlashcardCard.jsx/TypeRightCard.jsx now
    // import these directly instead, being in the same app/dotto/ tree; GameOptionsPanel.jsx does
    // too — these stay declared/assigned since still-vanilla live-presence.js's mini previews
    // reach cellContentType/colHasAnyCloze indirectly through renderFlashcardHTML/
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
    // Vanilla -> React bridges: waypoints-render-loop.js/
    // live-presence.js/srs-connections-core.js all previously imported these directly.
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
    // same app/dotto/ tree — kept declared/assigned since live-presence.js's mini previews still
    // need them) plus vanilla -> React bridges: live-presence.js/window-bridge.js/upload-popup.js
    // all previously imported these directly.
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
  }
}
