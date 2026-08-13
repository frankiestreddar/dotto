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

// Schedule View Mode's agenda (public/dotto/messages-schedule.js's renderScheduleAgenda) — an
// { hours: [{hour, top}], events: [{it, ev, top, w, h}] } snapshot computed fresh on every entry/
// date-shift, same "compute data, hand it to React" split as canvasItemsStore, just for a single
// read-mostly view instead of a persistent list. Each event's own preview DOM (it can be any card
// kind) still gets built by the vanilla renderRealCardPreview — a whole live node, same "vanilla
// function builds live DOM, React just mounts it" reasoning as CanvasCard's
// buildFolderInlineCanvas — see ScheduleAgenda.jsx.
export const scheduleAgendaStore = createStore({ hours: [], events: [] });

// Search-dropdown result panels (public/dotto/mnemonic-search-matching.js) — each a single-owner
// static container (#search-translation/#search-dictionary/etc.), unlike canvasResultsStore/
// searchSuggestionsStore below, which are shared by multiple producers and need their own
// discriminated-union design. null means "nothing to show" (matches each panel's own
// display:none default) — the actual card content
// still comes from a vanilla builder (buildTranslationCard/buildDictionaryCard/etc., several of
// them small self-contained widgets with their own internal cycling/drag state), mounted by a
// plain side-effect component (TranslationPanel.jsx and friends) rather than a portal, since
// there's no list to key/diff — one blob of vanilla-built content, wholesale-replaced each time,
// same as before, just triggered by React state instead of a direct DOM write.
//
// All six __set* bridges for these (app/dotto-app.jsx) wrap their store.set in flushSync, unlike
// notificationStore/scheduleAgendaStore above — updateSearchDropdown (ai-assistant-suggestions.js)
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

// #search-results (public/dotto/mnemonic-search-matching.js's renderCanvasResultsPanel) —
// { matches, isSourceFolder } | null. Genuine JSX rows (see CanvasResultsPanel.jsx), portaled via
// createPortal unlike the single-owner panels above, since there IS real list identity here.
// IMPORTANT: because this is a real portal (React tracks its children), nothing outside
// CanvasResultsPanel.jsx may touch #search-results' innerHTML/children directly — always go
// through window.__setCanvasResults(null) to clear it, never a raw DOM write (that would desync
// React's fiber tree from the actual DOM and risk a crash on the next update). Plain attribute
// reads/writes on the node itself (style.display, querySelectorAll for the existing keyboard-nav
// code) are fine — React's portal only owns the CHILDREN, never the target node's own attributes.
export const canvasResultsStore = createStore(null);

// #search-command-palette (public/dotto/command-palette.js's updateCommandPalette) —
// { rows: [...] } | null, the slash-command live suggestions list. Same "genuine JSX rows via
// createPortal" reasoning as canvasResultsStore right above (real list identity, clicked rows
// need their own onClick) — see CommandPalette.jsx. Row selection (click, or Enter on an
// arrow-selected row) always calls back into vanilla via window.__selectCommandRow
// (command-palette.js) rather than executing anything in the component itself, same "React
// renders, vanilla owns the app-state mutation" split as every other bridge here.
export const commandPaletteStore = createStore(null);

// #search-suggestions — shared by 6 different producers across 4 files (live AI suggestions, the
// mnemonic story/loading/error trio, a Dotbot scheduling-conversation prompt, and an orchestrate
// error), so this holds a small discriminated union ({kind, ...}) rather than one plain value —
// only ONE of them is ever shown at a time, same "replaces this one slot" idea as
// notificationStore. See renderMnemonicResultCard's own comment in mnemonic-search-matching.js
// for the full producer list, and SearchSuggestionsPanel.jsx for how each kind is built. Unlike
// canvasResultsStore above, this one is NOT a portal (every kind's content stays 100%
// vanilla-built, mounted the same "return null, mutate in an effect" way as
// TranslationPanel.jsx/DictionaryPanel.jsx/etc.) — so, same as those, direct DOM clears from
// elsewhere are harmless as long as they only ever touch this SPECIFIC node's children (never
// true for #search-results, see above).
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
// WaypointsListPanel.jsx), same reasoning as canvasResultsStore: simple icon+label+onclick rows,
// no per-row widget state worth keeping vanilla. `query` rides along just to pick the right empty-
// state message ("No waypoints yet." vs "No matching waypoints."), matching the original.
export const waypointsListStore = createStore({ rows: [], query: "" });

// Hamburger menu's Collaborations panel (public/dotto/hamburger-collab.js's renderHubCollabList/
// renderHubCollabRequests) — two views sharing #hub-collab-list, same as the vanilla version:
// { view: 'main', requestsCount, ownedShown, sharedShown, query } or
// { view: 'requests', requests }. Genuine JSX rows (see HubCollabListPanel.jsx), same reasoning as
// waypointsListStore. Not flushSync'd on the bridge (app/dotto-app.jsx) — both entry points are
// real async Supabase calls, so there's no synchronous DOM read to race.
export const hubCollabListStore = createStore({ view: "main", requestsCount: 0, ownedShown: [], sharedShown: [], query: "" });

// Profile panel's level pill (public/dotto/profile-achievements-pricing.js's renderProfileLevel)
// — { displayName, tierColor }, updated once at init and again live after awardUserPoints. Text +
// background color move together as one store value — see ProfileLevelPill.jsx.
export const profileLevelStore = createStore({ displayName: "", tierColor: "" });

// Profile panel's achievement spritebook (renderSpriteGrid) — just the array of unlocked
// achievement ids; window.__ACHIEVEMENTS/__SPRITE_TOTAL_COUNT (bridged as plain constants, not
// through a store, since they never change) supply everything else AchievementsGrid.jsx needs to
// render every cell. Genuine JSX, same reasoning as canvasResultsStore/waypointsListStore.
export const achievementsStore = createStore([]);

// Messages panel's chat/friend list (public/dotto/friends-presence.js's renderMsgList/
// renderMsgRequests) — same two-view shape as hubCollabListStore:
// { view: 'main', requestsCount, matchedFriends, searchResults, query } or
// { view: 'requests', requests }. Genuine JSX rows (see MessagesListPanel.jsx). Not flushSync'd —
// both entry points are real async Supabase calls. The actual conversation thread (openConvo/
// renderConvoBody) stays vanilla — part of the much larger "Live canvas presence" cluster
// (PHASE2_ROADMAP.md item 11), not this list.
export const msgListStore = createStore({ view: "main", requestsCount: 0, matchedFriends: [], searchResults: [], query: "" });

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

// Library tab's list content (public/dotto/marketplace.js's renderLibrary) — a discriminated union
// covering all three sub-views it can show: { view: 'folders', fixed, custom } (the folder
// picker), { view: 'items', folderKey, isCustom, customFolders, items } (inside one folder), or
// { view: 'search', results } (cross-folder search, appState.librarySearchQuery set). Genuine JSX
// rows, same reasoning as the other list panels. Drag-out-to-canvas for draft items
// (makeDraftItemDraggable) and opening the item detail view (openItemDetail, library-publish.js)
// stay vanilla, invoked via bridges from row handlers — see LibraryPanel.jsx.
export const libraryViewStore = createStore({ view: "folders", fixed: [], custom: [] });

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

// Collaborators pill under the search bar (public/dotto/friends-presence.js's renderCollabPill) —
// { show, collabs: [{id, avatarId, avatarUrl, displayName}] (up to 3), moreCount }. Genuine JSX, same
// Avatar.jsx-based reasoning as CollabListPanel — this is just the small trigger/indicator for
// that panel, not the panel itself (already done, item 6). Portals into #collab-content only;
// #collab-bubble's own `.show` class and #collab-tooltip's text are plain sibling/ancestor nodes
// outside the portal, synced imperatively via useLayoutEffect in CollabPill.jsx. MUST be
// flushSync'd (see app/dotto-app.jsx): openCollabPanel (friends-presence.js) reads collabBubble's
// `.show` class synchronously right after a caller in hamburger-collab.js calls this.
export const collabPillStore = createStore({ show: false, collabs: [], moreCount: 0 });

// Breadcrumb map dropdown (public/dotto/shared-canvases-outline.js's renderBreadcrumbMapPanel) —
// [{label, indent, folderId, isCurrent, isSyntheticRoot}]. Genuine JSX rows, same reasoning as the
// other list panels. flushSync'd (see app/dotto-app.jsx): openBreadcrumbMapPanel calls
// positionBreadcrumbMapPanel immediately after, which reads the panel's own offsetWidth —
// content-driven (white-space:nowrap up to max-width), so it needs the rows already painted.
export const breadcrumbMapStore = createStore([]);

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

// Single-canvas Schedule Mode's in-place canvas transform (public/dotto/schedule-view-canvas.js) —
// { active, itemsById: Map<itemId, {time, name, kindLabel}> }. Read by CanvasItem
// (CanvasItemsLayer.jsx): when active and an item's id is a key in itemsById, it renders
// ScheduleModeCardBody instead of its real CARD_KIND_COMPONENTS entry — the wrapper <div
// id="item-X"> stays the same DOM node either way, which is what lets a card's entrance animation
// (a CSS keyframe, alternating left/right by row — see applyScheduleModeWrapperAttrs/globals.css,
// deliberately NOT sourced from the item's real canvas position) swap it in without ever
// unmounting anything. Every OTHER item (not a key in itemsById) keeps rendering its real
// Component — it stays exactly where it is and just fades via CSS opacity (see the
// .schedule-hidden class), so it needs no entry in this store at all. Deliberately not the same
// store as scheduleAgendaStore (the SCHEDULE_ALL cross-canvas overlay's hour-timeline data) — the
// two views are mutually exclusive and have very different shapes; sharing one store would mean
// most fields are meaningless in either mode.
export const SCHEDULE_MODE_OFF = { active: false, itemsById: new Map() };
export const scheduleModeStore = createStore(SCHEDULE_MODE_OFF);
