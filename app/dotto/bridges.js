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

// Pricing/upgrade overlay (Phase 2 increment 1, the first subsystem converted) — a plain boolean.
// See public/dotto/profile-achievements-pricing.js's openPricingOverlay/closePricingOverlay for
// the vanilla callers (inline onclick="..." attributes, other ES modules) that still trigger this.
export const pricingOverlayStore = createStore(false);

// Text-selection toolbar shell (Phase 2 increment 2) — {isOpen, left, top}, richer than
// pricingOverlayStore's plain boolean since this one also carries the toolbar's already-clamped
// screen position. See public/dotto/search-orchestration-selection.js's showSelectionToolbarFor/
// hideSelectionToolbar for the vanilla side that still owns WHEN to show/hide and WHERE.
export const selectionToolbarStore = createStore({ isOpen: false, left: 0, top: 0 });

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
// array, set by render() (waypoints-render-loop.js) via window.__renderCanvasItems(items, paneId)
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
// (split-pane-management.js) and nowhere else, so a plain array beats bothering with an object.
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

// Search-dropdown result panels (public/dotto/mnemonic-search-matching.js) — each a single-owner
// static container (#search-translation/#search-dictionary/etc.), unlike searchSuggestionsStore
// below, which is shared by multiple producers and needs its own discriminated-union design.
// null means "nothing to show" (matches each panel's own
// display:none default) — the actual card content
// still comes from a vanilla builder (buildTranslationCard/buildDictionaryCard/etc., several of
// them small self-contained widgets with their own internal cycling/drag state), mounted by a
// plain side-effect component (TranslationPanel.jsx and friends) rather than a portal, since
// there's no list to key/diff — one blob of vanilla-built content, wholesale-replaced each time,
// same as before, just triggered by React state instead of a direct DOM write.
//
// All six __set* bridges for these (app/dotto-app.jsx) wrap their store.set in flushSync, unlike
// the ported notification stack (app/dotto/lib/notificationsStore.ts, a plain Zustand store
// rather than a flushSync'd bridge like these) — updateSearchDropdown (ai-assistant-suggestions.js)
// reads each panel's real DOM node's style.display SYNCHRONOUSLY right after calling its
// render*Panel function (see renderOrchestrateResult in search-orchestration-selection.js, which
// calls several of these back-to-back and then updateSearchDropdown once at the end) — without
// flushSync, that read would race the layout effect that actually sets style.display and could
// see a stale value, exactly the bug flushSync already exists to prevent for canvasItemsStore.
export const translationPanelStore = createStore(null);
export const dictionaryPanelStore = createStore(null);
export const examplesPanelStore = createStore(null);
export const recommendedSearchesStore = createStore(null);
// { text, answerBlocksPanel, answerBlocksLanguage } | null — combines what were originally two
// separate vanilla functions (renderDotbotAnswerPanel/renderAnswerBlocksPanel) into one store:
// the second always ran immediately after the first, appending into the SAME container the first
// had just cleared, so they were never really two independent panels — see
// DotbotAnswerPanel.jsx and renderDotbotAnswerPanel's own updated comment.
export const dotbotAnswerStore = createStore(null);
// { status: 'loading' | 'error' | 'success', reason, imageDataUrl } | null — the mnemonic image
// result panel's three mutually-exclusive states, see ImageResultPanel.jsx.
export const imageResultStore = createStore(null);

// #search-chat-thread (public/dotto/search-orchestration-selection.js) — a persisted, multi-turn
// Dotbot conversation shown ABOVE the search input (chat-app style), entirely separate from the
// six single-owner panel stores above, which stay exactly as they are for canvas
// matches/commands/suggestions below the input. Array of turns: { id, query, panels, fresh } —
// `panels` is the same raw panel array the orchestrate route returns (and
// supabase/migrations/20260819_add_dotbot_conversations.sql persists verbatim as
// dotbot_messages.content) rather than pre-split per panel type, so ChatThread.jsx can dispatch on
// it exactly like renderOrchestrateResult already does for the single-turn panels above. `fresh`
// is true only for a turn just appended from a LIVE response (drives ChatTurn's one-time
// typewriter reveal + drag-to-canvas wiring on mount); turns restored from history (reopening a
// saved chat, see the reopen-flow bridge) render with `fresh` false/omitted so they show fully
// settled immediately, never re-typewriter. Like commandPaletteStore below, __setChatThread/
// __appendChatTurn (app/dotto-app.jsx) are flushSync'd — the new independent chat-thread
// height-transition function (ai-assistant-suggestions.js) reads #search-chat-thread's real
// scrollHeight synchronously right after appending a turn, same reasoning as
// updateSearchDropdown's own flushSync dependency.
export const chatThreadStore = createStore([]);

// #search-command-palette (public/dotto/command-palette.js's updateCommandPalette) —
// { rows: [...] } | null, the slash-command live suggestions list. Genuine JSX rows, portaled via
// createPortal unlike the single-owner panels above, since there IS real list identity here (real
// list identity, clicked rows need their own onClick) — see CommandPalette.jsx.
// IMPORTANT: because this is a real portal (React tracks its children), nothing outside
// CommandPalette.jsx may touch #search-command-palette's innerHTML/children directly — always go
// through window.__setCommandPalette(null) to clear it, never a raw DOM write (that would desync
// React's fiber tree from the actual DOM and risk a crash on the next update). Plain attribute
// reads/writes on the node itself (style.display, querySelectorAll for the existing keyboard-nav
// code) are fine — React's portal only owns the CHILDREN, never the target node's own attributes.
// Row selection (click, or Enter on an arrow-selected row) always calls back into vanilla via
// window.__selectCommandRow (command-palette.js) rather than executing anything in the component
// itself, same "React renders, vanilla owns the app-state mutation" split as every other bridge here.
export const commandPaletteStore = createStore(null);

// #search-suggestions — shared by 5 different producers across 3 files (live AI suggestions, the
// mnemonic story/loading/error trio, and an orchestrate error), so this holds a small discriminated
// union ({kind, ...}) rather than one plain value —
// only ONE of them is ever shown at a time, unlike the ported notification stack
// (app/dotto/lib/notificationsStore.ts), which is a genuine multi-item stack. See
// renderMnemonicResultCard's own comment in mnemonic-search-matching.js
// for the full producer list, and SearchSuggestionsPanel.jsx for how each kind is built. Unlike
// commandPaletteStore above, this one is NOT a portal (every kind's content stays 100%
// vanilla-built, mounted the same "return null, mutate in an effect" way as
// TranslationPanel.jsx/DictionaryPanel.jsx/etc.) — so, same as those, direct DOM clears from
// elsewhere are harmless as long as they only ever touch this SPECIFIC node's children (never
// true for #search-command-palette, see above).
export const searchSuggestionsStore = createStore(null);

// Add-to-source popup (public/dotto/search-orchestration-selection.js) — {isOpen, left, top},
// same shape as selectionToolbarStore, for the same reason: this popup isn't nested inside any
// static markup fragment (the original code appended it straight onto document.body), so it
// doesn't need a portal — React renders it independently, same as PricingOverlay/SelectionToolbar.
// The popup's actual CONTENT (source search, the entry row, its own drag-free inline editing)
// stays fully vanilla, built by renderAddToSourcePopup directly against
// document.getElementById('add-to-source-popup') — see AddToSourcePopup.jsx and
// openAddToSourcePopup's own comment for why no mount effect is needed: __setAddToSourcePopupOpen
// is flushSync'd, so the div already exists by the time openAddToSourcePopup calls
// renderAddToSourcePopup right after.
export const addToSourcePopupStore = createStore({ isOpen: false, left: 0, top: 0 });

// Hamburger menu's Waypoints panel (public/dotto/hamburger-collab.js's renderWaypointsList) —
// { rows: [{owner_id, folder_id, item_id, name}], query } — genuine JSX rows (see
// WaypointsListPanel.jsx), same reasoning as commandPaletteStore: simple icon+label+onclick rows,
// no per-row widget state worth keeping vanilla. `query` rides along just to pick the right empty-
// state message ("No waypoints yet." vs "No matching waypoints."), matching the original.
export const waypointsListStore = createStore({ rows: [], query: "" });

// Hamburger menu's Outline panel (public/dotto/outline-tree.js's buildOutline/
// handleOutlineSearch) — { rows, query }, one row per canvas card/heading/nested-canvas/source (or,
// on a source page, one row per data row — see computeOutlineRows/computeSourceOutlineRows for the
// row shapes). Genuine JSX rows (see OutlinePanel.jsx), same "no natural content-parameter
// boundary" case CONTRIBUTING.md names as this migration's Phase 1 — the first vanilla list panel
// converted where the existing keyboard-nav (srs-connections-core.js's ArrowUp/ArrowDown/Enter
// block) still needs real DOM nodes handed back to it (see syncOutlineRows/window.__syncOutlineRows,
// called from OutlinePanel.jsx's own layout effect) rather than owning that DOM itself.
export const outlineStore = createStore({ rows: [], query: "" });

// Hamburger menu's Sources panel (public/dotto/hamburger-collab.js's renderSourcesList) —
// { rows: [{id, folderId, title, globalId, onCanvas, active}] , query }, one row per source folder
// account-wide (current-canvas ones sorted first). Genuine JSX rows (see SourcesListPanel.jsx),
// same reasoning as chatsListStore below. Not flushSync'd — a plain store.set, no synchronous DOM
// read follows a render()-driven update.
export const sourcesListStore = createStore({ rows: [], query: "" });

// Hamburger menu's Files panel (public/dotto/hamburger-collab.js's renderFilesList) — structurally
// identical to sourcesListStore just above (copied from it per explicit request), just
// { rows: [{id, folderId, itemId, title, onCanvas}], query }, one row per uploaded kind:'media' item
// account-wide (current-canvas ones sorted first). See FilesListPanel.jsx.
export const filesListStore = createStore({ rows: [], query: "" });

// Hamburger menu's Chats panel (public/dotto/hamburger-collab.js's renderChatsList) — a plain
// array of { id, title, updated_at } rows (see ChatsListPanel.jsx), no search/query state (v1: no
// search box, unlike Waypoints/Collaborations above — a saved-chat list is likely short enough not
// to need one yet). Row click reopens that conversation in the search palette — see
// window.__openSavedChat, search-orchestration-selection.js.
export const chatsListStore = createStore([]);

// Hamburger menu's Collaborations panel (public/dotto/hamburger-collab.js's renderHubCollabList/
// renderHubCollabRequests) — two views sharing #hub-collab-list, same as the vanilla version:
// { view: 'main', requestsCount, ownedShown, sharedShown, query } or
// { view: 'requests', requests }. Genuine JSX rows (see HubCollabListPanel.jsx), same reasoning as
// waypointsListStore. Not flushSync'd on the bridge (app/dotto-app.jsx) — both entry points are
// real async Supabase calls, so there's no synchronous DOM read to race.
export const hubCollabListStore = createStore({
  view: "main",
  requestsCount: 0,
  ownedShown: [],
  sharedShown: [],
  query: "",
});

// Shift-click-to-select + Backspace-to-delete state for the Chats/Waypoints/Collaborations
// hamburger list panels (public/dotto/hamburger-collab.js's window.__toggleListPanelSelection).
// One shared store, not three — openHubSubpanel (panels-hamburger.js) already enforces exactly
// one hub-subpanel open at a time, so `panel` (which list the ids belong to) doubles as the
// disambiguation a Backspace handler needs for free, no separate "which panel is active"
// bookkeeping. Collaborations' two row kinds (owned vs. shared-with-me) share this same `ids` Set
// with an "owned:"/"shared:" id prefix to avoid any collision between the two id spaces. `ids` is
// a real Set (not an array) purely for O(1) has()/toggle() in each row's render — never mutated in
// place, always replaced wholesale via .set() like every other store here.
export const listPanelSelectionStore = createStore({ panel: null, ids: new Set() });

// Profile panel's level pill (public/dotto/profile-achievements-pricing.js's renderProfileLevel)
// — { displayName, tierColor }, updated once at init and again live after awardUserPoints. Text +
// background color move together as one store value — see ProfileLevelPill.jsx.
export const profileLevelStore = createStore({ displayName: "", tierColor: "" });

// Profile panel's achievement spritebook (renderSpriteGrid) — just the array of unlocked
// achievement ids; window.__ACHIEVEMENTS/__SPRITE_TOTAL_COUNT (bridged as plain constants, not
// through a store, since they never change) supply everything else AchievementsGrid.jsx needs to
// render every cell. Genuine JSX, same reasoning as commandPaletteStore/waypointsListStore.
export const achievementsStore = createStore([]);

// Messages panel's chat/friend list (public/dotto/friends-presence.js's renderMsgList/
// renderMsgRequests) — same two-view shape as hubCollabListStore:
// { view: 'main', requestsCount, matchedFriends, searchResults, query } or
// { view: 'requests', requests }. Genuine JSX rows (see MessagesListPanel.jsx). Not flushSync'd —
// both entry points are real async Supabase calls. The actual conversation thread (openConvo/
// renderConvoBody) stays vanilla — part of the much larger "Live canvas presence" cluster
// (PHASE2_ROADMAP.md item 11), not this list.
export const msgListStore = createStore({
  view: "main",
  requestsCount: 0,
  matchedFriends: [],
  searchResults: [],
  query: "",
});

// Per-canvas Collaborations flyout (public/dotto/friends-presence.js's renderCollabList) —
// { rows: [{id, displayName, avatarId, avatarUrl, added, pending, isPresent}], query }. No
// Requests drill-down of its own (unlike hubCollabListStore/msgListStore above) — adding someone
// here sends a request that shows as "Requested" until accepted from THEIR OWN hamburger
// Collaborations panel. Genuine JSX rows, same reasoning as the others. Not flushSync'd — both
// refreshFriendsData/refreshCanvasCollabForCurrentFolder are real async Supabase calls.
export const collabListStore = createStore({ rows: [], query: "" });

// Marketplace "Discover" tab's trending list (public/dotto/marketplace.js's
// renderMarketplaceDiscover) — the already-filtered array of items. Genuine JSX rows, same
// reasoning as the other list panels. openMarketDetail/the rest of the marketplace/library
// cluster stay vanilla for now — see marketplace.js's own comment for why this is one
// self-contained slice, not the whole roadmap item 8 at once.
export const marketDiscoverStore = createStore([]);

// Marketplace item detail view's content (public/dotto/marketplace.js's openMarketDetail/
// closeMarketDetail) — the selected item, or null. Text fields as real JSX; the canvas preview
// (renderInlineCanvas) stays vanilla-built, mounted via a ref — see MarketDetailPanel.jsx. Which
// VIEW is showing (#view-discover vs #market-detail-view) stays a vanilla classList toggle, shared
// machinery with switchCartTab/openItemDetail/startPublishFlow elsewhere in this cluster.
export const marketDetailStore = createStore(null);

// Blocks panel's list content (public/dotto/blocks-panel.js's computeBlocksRows/refreshBlocksPanel)
// — was libraryViewStore/Library's own discriminated-union-of-views shape before Essentials/
// Library were repurposed into Blocks/Plugins (explicit request); Blocks shows every folder's
// contents at once now (no drill-down navigation), so this is just a flat row array, same
// convention as outlineStore/computeOutlineRows: [{ rowKind: 'folder', key, label, deletable,
// count } | { rowKind: 'block-item', kind, statKind, label, icon } | { rowKind: 'content-item',
// item, status, folderKey, deletable, draggable } | { rowKind: 'new-folder' }]. Genuine JSX rows —
// drag-into-folder (setupContentItemDrag), opening the item detail view (openItemDetail), and
// folder/item CRUD all stay vanilla, invoked via window.__ bridges from row handlers, see
// BlocksPanel.jsx.
export const blocksViewStore = createStore([]);

// Extensions panel's list content (was Library's own role before the repurposing above — see
// blocksViewStore's comment; was going to be called "Plugins" before an explicit follow-up rename)
// — just a flat array of installed extensions, [{id, label}], rendered as rectangular pills rather
// than item cards (explicit request). Currently seeded with two dummy entries (blocks-panel.js has
// no real extension system to back this yet) — see ExtensionsPanel.jsx.
export const extensionsListStore = createStore([
  { id: "extension-1", label: "Plugin 1" },
  { id: "extension-2", label: "Plugin 2" },
]);

// Item Detail view's footer button set (public/dotto/library-publish.js's renderItemDetailFooter)
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
// public/dotto/friends-presence.js's renderCollabPill(paneId). MUST be flushSync'd (see
// app/dotto-app.jsx): openCollabPanel (friends-presence.js) reads the triggering bubble element's
// `.show` class synchronously right after a caller pushes here.
export const collabPillStore = createPaneKeyedStore(() => ({
  show: false,
  collabs: [],
  moreCount: 0,
}));

// Back/forward enabled-state, one per pane (split-screen Stage 8) — { canGoBack, canGoForward },
// pushed by public/dotto/tab-management.js's renderNavArrows(paneId) (called from
// render()'s per-frame loop for the active pane, and from jumpToHistoryIndex/switchActivePane for
// immediate feedback). Replaces the old singular #btn-back/#btn-forward .disabled assignments
// (waypoints-render-loop.js) now that PaneTopBar.jsx renders its own back/forward buttons per pane.
export const navHistoryStore = createPaneKeyedStore(() => ({
  canGoBack: false,
  canGoForward: false,
}));

// Which pane is currently active — a plain, non-pane-keyed store (there's only ever one answer,
// unlike everything else pane-keyed here). Backs PaneZoomBar.jsx's own "only show for the pane you
// last clicked into" requirement (explicit request) — everything else in this codebase reads
// appState.activePaneId directly off the vanilla side, which isn't reactive; this is the one place
// so far that needs an active REACT re-render when it changes. Pushed by switchActivePane
// (core-state.js) via window.__setActivePaneId.
export const activePaneIdStore = createStore(0);

// Media-viewer full-screen zoom, one per pane (mirrors navHistoryStore/collabPillStore's own
// per-pane reasoning) — { show, zoom }. show is true only while that pane's own CURRENT folder is a
// synthetic isMediaViewer one (window.__openMediaViewerTab, tab-management.js); zoom is a
// plain multiplier (1 = 100%, i.e. the document at exactly the window's own width — explicit spec).
// Pushed by renderMediaViewerZoom(paneId)/setMediaViewerZoom (waypoints-render-loop.js). zoom itself
// actually lives on the synthetic folder object (folderObj.viewerZoom), not here — this store is
// just the React-facing mirror of it, same "vanilla owns the real data, this is the push target"
// split every other pane-keyed store in this file already follows.
export const mediaViewerZoomStore = createPaneKeyedStore(() => ({ show: false, zoom: 1 }));

// Compact "…/parent/current" breadcrumb trail for a pane's own active tab (see
// app/dotto/TabsBar.jsx's ActiveTabTrail, public/dotto/tab-management.js's
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
// public/dotto/tab-management.js's renderTabsPanel/addTab/switchTab/closeTab) —
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
// Open conversation thread (public/dotto/live-presence.js's openConvo/renderConvoBody) —
// { friendId, displayName, avatarId, avatarUrl, messages } | null. Genuine JSX for the header
// (Avatar.jsx) and each plain-text message bubble; each canvas-snapshot message's own card
// content is ref-mounted vanilla DOM (renderInlineCanvas/renderMsgSnapshotCard) — see
// MsgConvo.jsx. Not flushSync'd — no caller reads the DOM synchronously right after; the
// scroll-to-bottom reset that used to happen inline now lives in a useLayoutEffect inside
// MsgConvo.jsx itself, so it's correctly synchronous with that component's own commit regardless.
export const msgConvoStore = createStore(null);

// Shared Card preview modal's body (public/dotto/live-presence.js's openSharedCanvasView) —
// { items } | null. Genuine JSX list, each item's own card content ref-mounted the same way as
// MsgConvo's canvas-snapshot messages (renderMsgSnapshotCard) — see SharedCanvasModalBody.jsx. The
// modal shell's own open/close class toggle and title text stay vanilla (plain attribute writes
// on the shell, not on anything React portals into).
export const sharedCanvasModalStore = createStore(null);

// Item 9's remainder (the Source database page cluster) turned out to have only one clean, low-
// risk conversion candidate: the cell tag picker's dropdown list (public/dotto/source-tags-ai.js's
// renderCellTagPickerList) — { rows: [{tagId, name, color, selected, renaming}], id, r }. Genuine
// JSX, including the rename row's plain <input> (not contentEditable, so none of the
// caret-regression risk that ruled out converting the Source table's own cells or the Item Detail/
// Publish Flow contentEditable fields). The rest of the cluster stays vanilla: the Source table
// itself (renderStaticTableHTML) is built by the legacy `folderObj.isSource` branch in render()
// (waypoints-render-loop.js), entirely bypassing CanvasItemsLayer, and is deeply
// contentEditable-per-cell plus continuous pointermove-driven hover-zone pixel math — the same
// canvas-core-tier risk as item 12, not this migration's usual mechanical conversion. Cell image/
// audio upload, AI-generated source content, and SM-2 are all pure logic with no DOM of their own.
export const cellTagPickerListStore = createStore({ rows: [], id: null, r: null });
