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
