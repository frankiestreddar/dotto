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

// pricingOverlayStore and selectionToolbarStore (Phase 2 increments 1-2) migrated to real Zustand
// — see app/dotto/lib/pricingOverlayStore.ts/app/dotto/lib/selectionToolbarStore.ts (Zustand
// migration plan, batch 1, PHASE4_ROADMAP.md).

// Pane-keyed variant of createStore, split-screen Stage 4 (see the split-screen plan) — each pane
// shows its own folder's items (and, since Stage 7, its own tabs/breadcrumb trail) independently,
// so a single shared store (the original shape here) would make every pane render whichever pane
// last called render() instead of its own content. Lazily creates one real createStore the first
// time a given paneId is asked for, so pane 0 (the only one that exists before any split happens)
// doesn't need anything pre-declared. defaultValue is a FACTORY (called fresh per pane, not a
// single shared value) so each pane's own store starts from its own independent object rather than
// every pane accidentally sharing one array/object reference — defaults to `[]` per pane, matching
// canvasItemsStore's original (and only, before Stage 7) shape.
function createPaneKeyedStore(defaultValue = () => []) {
  const stores = new Map();
  function storeFor(paneId) {
    let store = stores.get(paneId);
    if (!store) {
      store = createStore(defaultValue());
      stores.set(paneId, store);
    }
    return store;
  }
  // Drops a closed pane's store (split-screen Stage 5+) so it doesn't just leak forever.
  function remove(paneId) {
    stores.delete(paneId);
  }
  return { storeFor, remove };
}

// Canvas items layer (canvas-items-react plan, see PHASE2_ROADMAP.md) — the current folder's item
// array, set by render() (app/dotto/lib/waypointsRenderLoop.ts) via window.__renderCanvasItems(items, paneId)
// every time it would previously have wiped and rebuilt #world's item divs by hand. React now owns
// each pane's own #items-layer child of #world (see app/dotto/CanvasItemsLayer.jsx) and keys off
// item.id, so unchanged items are left alone instead of being torn down and recreated on every
// canvas interaction. canvasItemsStore.storeFor(paneId) — not a single store — since split-screen
// Stage 4.
export const canvasItemsStore = createPaneKeyedStore();

// Pane layout tree (split-screen Stage 6+) — a real split tree, not a flat list of rects. Stage
// 4/5 originally used a flat array ({ id, rect }[]), justified at the time as "sufficient for a
// hard 2x2 cap and trivial to render/hit-test" — that stopped being true once Stage 6's own "what
// happens when a quartered pane closes" product question got answered "re-merge into its sibling":
// a flat list has no way to express "these two panes are a pair" once a pane has been split TWICE
// (a quartered pane's own sibling might itself be a further-split PAIR, not a single leaf) — a
// closed pane needs to know exactly which OTHER subtree reclaims its space, which only a real tree
// can express correctly. Replaced here rather than patched once that became clear.
//
// Shape: { type: 'leaf', paneId } | { type: 'split', direction: 'row'|'column', children: [tree, tree] }.
// 'row' = children sit side by side (a left/right edge drop splits this way); 'column' = children
// stack top/bottom. children[0] is always the visually-first (left/top) child — which edge was
// dropped on decides which side the NEW pane lands on, not some fixed convention. Starts as a
// single leaf (pane 0, full viewport), matching how the app looked before split-screen existed.
export const paneLayoutStore = createStore({ type: "leaf", paneId: 0 });

// Walks the tree, dividing `rect` (fractional [0,1] viewport coords, defaulting to the full
// viewport) evenly between each split's two children, and returns a flat [{ paneId, rect }] for
// however many leaves currently exist — this is what PaneGrid.jsx actually renders from; nothing
// downstream of it needs to know the tree shape at all, only the resulting flat rects. No
// adjustable dividers (both children of a split always get exactly half) — matches the plan's own
// "Stage 4 only needs a fixed, non-animated split" scope; a real draggable-divider feature would
// extend this function's own math, not the tree shape.
export function computePaneRects(tree, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  if (tree.type === "leaf") return [{ paneId: tree.paneId, rect }];
  const [a, b] = tree.children;
  if (tree.direction === "row") {
    const halfW = rect.w / 2;
    return [
      ...computePaneRects(a, { x: rect.x, y: rect.y, w: halfW, h: rect.h }),
      ...computePaneRects(b, { x: rect.x + halfW, y: rect.y, w: halfW, h: rect.h }),
    ];
  }
  const halfH = rect.h / 2;
  return [
    ...computePaneRects(a, { x: rect.x, y: rect.y, w: rect.w, h: halfH }),
    ...computePaneRects(b, { x: rect.x, y: rect.y + halfH, w: rect.w, h: halfH }),
  ];
}

// One thin divider line per split node — walks the same tree computePaneRects does, but instead
// of leaf rects, collects the boundary BETWEEN each split's two children (explicit request: "a
// dividing line between the split screens"). 'row' splits (children side by side) get a vertical
// line at the shared x boundary spanning that subtree's own full height; 'column' splits get a
// horizontal line at the shared y boundary spanning its own full width — each in the same
// fractional [0,1] coordinate space PaneGrid.jsx already renders panes in, so the caller just
// converts to percent the same way it does for a pane's own rect.
export function computeSplitDividers(tree, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  if (tree.type === "leaf") return [];
  const [a, b] = tree.children;
  if (tree.direction === "row") {
    const halfW = rect.w / 2;
    return [
      { orientation: "vertical", x: rect.x + halfW, y: rect.y, length: rect.h },
      ...computeSplitDividers(a, { x: rect.x, y: rect.y, w: halfW, h: rect.h }),
      ...computeSplitDividers(b, { x: rect.x + halfW, y: rect.y, w: halfW, h: rect.h }),
    ];
  }
  const halfH = rect.h / 2;
  return [
    { orientation: "horizontal", y: rect.y + halfH, x: rect.x, length: rect.w },
    ...computeSplitDividers(a, { x: rect.x, y: rect.y, w: rect.w, h: halfH }),
    ...computeSplitDividers(b, { x: rect.x, y: rect.y + halfH, w: rect.w, h: halfH }),
  ];
}

// Every currently-open paneId, in no particular order — used for the 4-pane cap check
// (app/dotto/lib/splitPaneManagement.ts) and nowhere else, so a plain array beats bothering with an object.
export function listPaneIds(tree) {
  return tree.type === "leaf"
    ? [tree.paneId]
    : [...listPaneIds(tree.children[0]), ...listPaneIds(tree.children[1])];
}

// Which of a pane's 4 edges are valid drop targets right now — explicit request/correction: split-
// screen must only ever grow into a clean 2x2 (quartering one or both halves of an existing row/
// column split), never 3+ panes side by side in the same direction. Walks root-to-leaf collecting
// each ancestor split's own direction; the shape of that path is exactly what decides which edges
// are still legal for THIS leaf:
//  - path length 0 (tree is just this one leaf, nothing split yet): every edge is legal — this is
//    the very first split, which can go either way.
//  - path length 1 (this leaf is one of an existing row/column pair, not itself split again yet):
//    only the PERPENDICULAR edges are legal (top/bottom if its parent split was 'row', left/right
//    if 'column'). The parent's own direction is explicitly excluded — splitting a pane that's
//    already part of a row AGAIN in the row direction would produce 3 panes side by side instead of
//    quartering it, which is exactly the shape this function exists to prevent.
//  - path length 2+ (this leaf is already one of a quartered pair): no edge is legal — a 3rd level
//    of nesting can only ever produce something other than a clean 2x2 (and this codebase caps
//    split-screen at 4 panes total regardless, enforced separately by window.__countPanes() < 4 at
//    the call site, TabsBar.jsx).
// Returns the empty array for a paneId that isn't in the tree at all, same as "no legal edges."
export function allowedEdgesForPane(tree, paneId) {
  function pathTo(node, path) {
    if (node.type === "leaf") return node.paneId === paneId ? path : null;
    const [a, b] = node.children;
    return pathTo(a, [...path, node.direction]) || pathTo(b, [...path, node.direction]);
  }
  const path = pathTo(tree, []);
  if (!path) return [];
  if (path.length === 0) return ["left", "right", "top", "bottom"];
  if (path.length === 1) return path[0] === "row" ? ["top", "bottom"] : ["left", "right"];
  return [];
}

// Replaces the leaf for targetPaneId with a new split node pairing it with newPaneId — direction/
// child order both come from `edge` ('left'/'right' -> row, existing pane and new pane ordered so
// the new one lands on the dropped side; 'top'/'bottom' -> column, same reasoning). Returns a NEW
// tree (the leaf/split nodes on the path to the target are new objects; every sibling subtree not
// on that path is reused as-is) rather than mutating — matches how every other store in this file
// gets updated (a fresh value passed to .set(), not an in-place mutation), and keeps this function
// safe to call speculatively before deciding whether to commit the result. Returns the ORIGINAL
// tree unchanged if targetPaneId isn't found (caller's job to guard against that not happening).
export function splitLeafInTree(tree, targetPaneId, newPaneId, edge) {
  if (tree.type === "leaf") {
    if (tree.paneId !== targetPaneId) return tree;
    const targetLeaf = { type: "leaf", paneId: targetPaneId };
    const newLeaf = { type: "leaf", paneId: newPaneId };
    if (edge === "left")
      return { type: "split", direction: "row", children: [newLeaf, targetLeaf] };
    if (edge === "right")
      return { type: "split", direction: "row", children: [targetLeaf, newLeaf] };
    if (edge === "top")
      return { type: "split", direction: "column", children: [newLeaf, targetLeaf] };
    return { type: "split", direction: "column", children: [targetLeaf, newLeaf] }; // 'bottom'
  }
  return {
    ...tree,
    children: [
      splitLeafInTree(tree.children[0], targetPaneId, newPaneId, edge),
      splitLeafInTree(tree.children[1], targetPaneId, newPaneId, edge),
    ],
  };
}

// Closes paneId and re-merges its space into whichever subtree it was paired with — the split
// node immediately ABOVE its leaf is replaced by that split's OTHER child, so the surviving
// subtree (a single pane, or itself a further-split pair — e.g. closing the one pane NOT quartered
// correctly hands the full reclaimed box to the still-quartered pair, not just one arbitrary pane
// of it) expands to fill exactly the space the closed pane's pair used to occupy. Returns null if
// paneId was the tree's only leaf (closing the last pane isn't a real operation — same "always
// keep at least one" guard closeTab/splitPaneWithTab already enforce, just expressed as null here
// since there's no tree left to return). Same "returns a new tree, doesn't mutate" shape as
// splitLeafInTree.
export function closeLeafInTree(tree, paneId) {
  if (tree.type === "leaf") return tree.paneId === paneId ? null : tree;
  const [a, b] = tree.children;
  if (a.type === "leaf" && a.paneId === paneId) return b;
  if (b.type === "leaf" && b.paneId === paneId) return a;
  const newA = closeLeafInTree(a, paneId);
  if (newA !== a) return newA === null ? b : { ...tree, children: [newA, b] };
  const newB = closeLeafInTree(b, paneId);
  if (newB !== b) return newB === null ? a : { ...tree, children: [a, newB] };
  return tree;
}

// The six search-dropdown result panels (translationPanelStore/dictionaryPanelStore/
// examplesPanelStore/recommendedSearchesStore/dotbotAnswerStore/imageResultStore) migrated to
// real Zustand (Zustand migration plan, batch 2, see PHASE4_ROADMAP.md) — see
// app/dotto/lib/translationPanelStore.ts and its 5 siblings.

// #search-chat-thread, #search-command-palette, #search-suggestions, and the add-to-source popup
// all migrated to real Zustand (Zustand migration plan, batch 3, see PHASE4_ROADMAP.md) — see
// app/dotto/lib/chatThreadStore.ts, commandPaletteStore.ts, searchSuggestionsStore.ts, and
// addToSourcePopupStore.ts.

// Hamburger menu's Outline/Waypoints/Sources/Files/Chats/Collaborations list panels, and their
// shared shift-click selection state, all migrated to real Zustand (Zustand migration plan,
// batch 4, see PHASE4_ROADMAP.md) — see app/dotto/lib/outlineStore.ts, waypointsListStore.ts,
// sourcesListStore.ts, filesListStore.ts, chatsListStore.ts, hubCollabListStore.ts, and
// listPanelSelectionStore.ts.

// Profile panel's level pill and achievement spritebook both migrated to real Zustand (Zustand
// migration plan, batch 5, see PHASE4_ROADMAP.md) — see app/dotto/lib/profileLevelStore.ts and
// achievementsStore.ts.

// Messages panel's chat/friend list, the per-canvas Collaborations flyout, the open conversation
// thread, and the Shared Card preview modal all migrated to real Zustand (Zustand migration plan,
// batch 6, see PHASE4_ROADMAP.md) — see app/dotto/lib/msgListStore.ts, collabListStore.ts,
// msgConvoStore.ts, and sharedCanvasModalStore.ts.

// Marketplace "Discover" tab's trending list (app/dotto/lib/marketplace.ts's
// renderMarketplaceDiscover) — the already-filtered array of items. Genuine JSX rows, same
// reasoning as the other list panels. openMarketDetail/the rest of the marketplace/library
// cluster stay in this pattern for now — see marketplace.ts's own comment for why this is one
// self-contained slice, not the whole roadmap item 8 at once.
export const marketDiscoverStore = createStore([]);

// Marketplace item detail view's content (app/dotto/lib/marketplace.ts's openMarketDetail/
// closeMarketDetail) — the selected item, or null. Text fields as real JSX; the canvas preview
// (renderInlineCanvas) stays vanilla-built, mounted via a ref — see MarketDetailPanel.jsx. Which
// VIEW is showing (#view-discover vs #market-detail-view) stays a vanilla classList toggle, shared
// machinery with switchCartTab/openItemDetail/startPublishFlow elsewhere in this cluster.
export const marketDetailStore = createStore(null);

// Blocks panel's list content (app/dotto/lib/blocksPanel.ts's computeBlocksRows/refreshBlocksPanel)
// — was libraryViewStore/Library's own discriminated-union-of-views shape before Essentials/
// Library were repurposed into Blocks/Plugins (explicit request); Blocks shows every folder's
// contents at once now (no drill-down navigation), so this is just a flat row array, same
// convention as outlineStore/computeOutlineRows: [{ rowKind: 'folder', key, label, deletable,
// count } | { rowKind: 'block-item', kind, statKind, label, icon } | { rowKind: 'content-item',
// item, status, folderKey, deletable, draggable } | { rowKind: 'new-folder' }]. Genuine JSX rows —
// drag-into-folder (setupContentItemDrag) and folder/item CRUD are all real ES imports from
// blocksPanel.ts now (same app/dotto/ tree, see BlocksPanel.jsx); opening the item detail view
// (openItemDetail) still goes through a window.__ bridge, since that one lives in
// app/dotto/lib/libraryPublish.ts and a direct import back would be circular (see blocksPanel.ts's
// own header comment).
export const blocksViewStore = createStore([]);

// Extensions panel's list content (was Library's own role before the repurposing above — see
// blocksViewStore's comment; was going to be called "Plugins" before an explicit follow-up rename)
// — just a flat array of installed extensions, [{id, label}], rendered as rectangular pills rather
// than item cards (explicit request). Currently seeded with two dummy entries
// (app/dotto/lib/blocksPanel.ts has no real extension system to back this yet) — see
// ExtensionsPanel.jsx.
export const extensionsListStore = createStore([
  { id: "extension-1", label: "Plugin 1" },
  { id: "extension-2", label: "Plugin 2" },
]);

// Item Detail view's footer button set (app/dotto/lib/libraryPublish.ts's renderItemDetailFooter)
// — { sourceFolder: 'drafts'|'published'|'purchased', itemId, dirty } | null. A natural,
// self-contained discriminated union (same "compute state, render 1-3 buttons" shape as
// ImageResultPanel), unlike the rest of the Item Detail/Publish Flow views: the title/price/desc
// fields (contentEditable title, autosave-on-blur for drafts, disabled-until-dirty tracking for
// published) and the entire Publish Flow form (including focusPublishFlowName's manual caret/
// scroll positioning) stay vanilla — no acute bug in any of it, and converting contentEditable
// fields to React state risks regressing caret behavior for zero behavior gain, same reasoning as
// the hamburger menu's Outline panel exception (see PHASE2_ROADMAP.md item 6).
export const itemDetailFooterStore = createStore(null);

// Collaborators pill, now one per pane (split-screen Stage 8 — was a single shared store tied to
// whichever pane happened to be active, per the same "each pane needs its own copy, not one shared
// trigger" correction that made tabsStore/breadcrumbMapStore pane-keyed in Stage 7). Rendered
// directly by PaneTopBar.jsx (app/dotto/) now, not portalled into a static top-bar.html node —
// #collab-bubble/#collab-content/#collab-tooltip no longer exist as singular ids, see that file.
// { show, collabs: [{id, avatarId, avatarUrl, displayName}] (up to 3), moreCount }, pushed by
// app/dotto/lib/friendsPresence.ts's renderCollabPill(paneId). MUST be flushSync'd (see
// app/dotto-app.jsx): openCollabPanel (app/dotto/lib/friendsPresence.ts) reads the triggering
// bubble element's `.show` class synchronously right after a caller pushes here.
export const collabPillStore = createPaneKeyedStore(() => ({
  show: false,
  collabs: [],
  moreCount: 0,
}));

// Back/forward enabled-state, one per pane (split-screen Stage 8) — { canGoBack, canGoForward },
// pushed by app/dotto/lib/tabManagement.ts's renderNavArrows(paneId) (called from
// render()'s per-frame loop for the active pane, and from jumpToHistoryIndex/switchActivePane for
// immediate feedback). Replaces the old singular #btn-back/#btn-forward .disabled assignments
// (app/dotto/lib/waypointsRenderLoop.ts) now that PaneTopBar.jsx renders its own back/forward buttons per pane.
export const navHistoryStore = createPaneKeyedStore(() => ({
  canGoBack: false,
  canGoForward: false,
}));

// Which pane is currently active — a plain, non-pane-keyed store (there's only ever one answer,
// unlike everything else pane-keyed here). Backs PaneZoomBar.jsx's own "only show for the pane you
// last clicked into" requirement (explicit request) — everything else in this codebase reads
// appState.activePaneId directly off the vanilla side, which isn't reactive; this is the one place
// so far that needs an active REACT re-render when it changes. Pushed by switchActivePane
// (app/dotto/lib/coreState.ts) via window.__setActivePaneId.
export const activePaneIdStore = createStore(0);

// Media-viewer full-screen zoom, one per pane (mirrors navHistoryStore/collabPillStore's own
// per-pane reasoning) — { show, zoom }. show is true only while that pane's own CURRENT folder is a
// synthetic isMediaViewer one (window.__openMediaViewerTab, app/dotto/lib/tabManagement.ts); zoom is a
// plain multiplier (1 = 100%, i.e. the document at exactly the window's own width — explicit spec).
// Pushed by renderMediaViewerZoom(paneId)/setMediaViewerZoom (app/dotto/lib/waypointsRenderLoop.ts). zoom itself
// actually lives on the synthetic folder object (folderObj.viewerZoom), not here — this store is
// just the React-facing mirror of it, same "vanilla owns the real data, this is the push target"
// split every other pane-keyed store in this file already follows.
export const mediaViewerZoomStore = createPaneKeyedStore(() => ({ show: false, zoom: 1 }));

// Compact "…/parent/current" breadcrumb trail for a pane's own active tab (see
// app/dotto/TabsBar.jsx's ActiveTabTrail, app/dotto/lib/tabManagement.ts's
// renderBreadcrumbMapPanel) — { hasMore, root, parent, current }, each of `root`/`parent`/
// `current` either null or {label, folderId, isSyntheticRoot}. Pane-keyed since split-screen Stage
// 7 (each pane gets its own breadcrumb pill now, explicit request — was a single shared store,
// which only ever reflected whichever pane was CURRENTLY active, so an inactive pane's own pill
// had nothing correct to show). Not flushSync'd — a plain store.set, same reasoning as
// chatsListStore/waypointsListStore: no synchronous DOM read follows a navigation-driven update.
export const breadcrumbMapStore = createPaneKeyedStore(() => ({
  hasMore: false,
  root: null,
  parent: null,
  current: null,
}));

// Canvas tabs, next to each pane's own breadcrumb pill (see app/dotto/TabsBar.jsx,
// app/dotto/lib/tabManagement.ts's renderTabsPanel/addTab/switchTab/closeTab) —
// { tabs: [{id, folderId, label}], activeTabId }. Each tab is a lightweight bookmark of a folder
// location, not an independent history/camera context — see renderTabsPanel's own comment for why.
// Pane-keyed since split-screen Stage 7, same reasoning as breadcrumbMapStore just above — each
// pane now renders its own <TabsBar paneId={paneId}/> instance (PaneCanvasArea.jsx) instead of one
// shared instance tied to whichever pane happens to be active. Not flushSync'd — same reasoning as
// breadcrumbMapStore: a plain store.set, no synchronous DOM read follows a navigation-driven update.
export const tabsStore = createPaneKeyedStore(() => ({ tabs: [], activeTabId: null }));

// First slice of item 11's "Live canvas presence + real-time content sync" grab-bag (see
// PHASE2_ROADMAP.md — that section needed a 3-way split before extraction): the messaging/
// conversation-thread part. Cursor/typing/selection presence sync and the diff-based content-sync
// engine stay fully vanilla — tightly coupled to live pan/zoom pixel math and per-frame drag
// updates, same "canvas-core-adjacent, migrate last" reasoning as canvas core itself, not a list
// with any natural React-owned identity.
//
// The open conversation thread (msgConvoStore) and Shared Card preview modal
// (sharedCanvasModalStore) also migrated to real Zustand in this same batch 6 — see
// app/dotto/lib/msgConvoStore.ts and sharedCanvasModalStore.ts.

// Item 9's remainder (the Source database page cluster) turned out to have only one clean, low-
// risk conversion candidate: the cell tag picker's dropdown list
// (app/dotto/lib/sourceTagsAi.ts's renderCellTagPickerList) — { rows: [{tagId, name, color,
// selected, renaming}], id, r }. Genuine
// JSX, including the rename row's plain <input> (not contentEditable, so none of the
// caret-regression risk that ruled out converting the Source table's own cells or the Item Detail/
// Publish Flow contentEditable fields). The rest of the cluster stays vanilla: the Source table
// itself (renderStaticTableHTML) is built by the legacy `folderObj.isSource` branch in render()
// (app/dotto/lib/waypointsRenderLoop.ts), entirely bypassing CanvasItemsLayer, and is deeply
// contentEditable-per-cell plus continuous pointermove-driven hover-zone pixel math — the same
// canvas-core-tier risk as item 12, not this migration's usual mechanical conversion. Cell image/
// audio upload, AI-generated source content, and SM-2 are all pure logic with no DOM of their own.
export const cellTagPickerListStore = createStore({ rows: [], id: null, r: null });
