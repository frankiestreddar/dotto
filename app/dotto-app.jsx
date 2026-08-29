"use client";

import { useEffect } from "react";
import Script from "next/script";
import { flushSync } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  achievementsStore,
  activePaneIdStore,
  addToSourcePopupStore,
  blocksViewStore,
  breadcrumbMapStore,
  canvasItemsStore,
  cellTagPickerListStore,
  chatsListStore,
  chatThreadStore,
  closeLeafInTree,
  collabListStore,
  collabPillStore,
  commandPaletteStore,
  dictionaryPanelStore,
  dotbotAnswerStore,
  examplesPanelStore,
  extensionsListStore,
  filesListStore,
  hubCollabListStore,
  imageResultStore,
  itemDetailFooterStore,
  listPanelSelectionStore,
  listPaneIds,
  marketDetailStore,
  marketDiscoverStore,
  mediaViewerZoomStore,
  msgConvoStore,
  msgListStore,
  navHistoryStore,
  outlineStore,
  paneLayoutStore,
  splitLeafInTree,
  pricingOverlayStore,
  profileLevelStore,
  recommendedSearchesStore,
  searchSuggestionsStore,
  selectionToolbarStore,
  sharedCanvasModalStore,
  sourcesListStore,
  tabsStore,
  translationPanelStore,
  waypointsListStore,
} from "./dotto/bridges";
import AchievementsGrid from "./dotto/AchievementsGrid";
import AddToSourcePopup from "./dotto/AddToSourcePopup";
import {
  attachStaticTableHoverZones,
  layoutSourceTableColumns,
  renderConnectionsLayer,
  renderStaticTableHTML,
  setupDraggingAndClicking,
  setupResizing,
} from "./dotto/canvasItemBehavior";
import { wireDayChangeAndAdNotifications } from "./dotto/lib/dayChangeAndAdNotifications";
import { wireNotifications } from "./dotto/lib/notificationsStore";
// Side-effect only — sets window.__splitPaneWithTab/__closePane at module-eval time (no wireX()
// needed, unlike the two imports above: nothing here needs a live DOM/appState read at wire time,
// just the bridge assignment itself). Imported here, not from any specific component, since
// TabsBar.jsx/PaneTopBar.jsx are bridge CONSUMERS (call window.__splitPaneWithTab/__closePane),
// not producers — this needs to run unconditionally, same as bridges.js's own pane helpers below.
import "./dotto/lib/splitPaneManagement";
import BlocksPanel from "./dotto/BlocksPanel";
import CellTagPickerList from "./dotto/CellTagPickerList";
import ChatsListPanel from "./dotto/ChatsListPanel";
import ChatThread from "./dotto/ChatThread";
import CollabListPanel from "./dotto/CollabListPanel";
import CommandPalette from "./dotto/CommandPalette";
import DictionaryPanel from "./dotto/DictionaryPanel";
import DotbotAnswerPanel from "./dotto/DotbotAnswerPanel";
import ErrorBoundary from "./dotto/ErrorBoundary";
import ExamplesPanel from "./dotto/ExamplesPanel";
import ExtensionsPanel from "./dotto/ExtensionsPanel";
import FilesListPanel from "./dotto/FilesListPanel";
import HubCollabListPanel from "./dotto/HubCollabListPanel";
import ImageResultPanel from "./dotto/ImageResultPanel";
import ItemDetailFooter from "./dotto/ItemDetailFooter";
import ItemDetailTitle from "./dotto/ItemDetailTitle";
import MarketDetailPanel from "./dotto/MarketDetailPanel";
import MarketDiscoverPanel from "./dotto/MarketDiscoverPanel";
import MessagesListPanel from "./dotto/MessagesListPanel";
import MsgConvo from "./dotto/MsgConvo";
import NotificationBar from "./dotto/NotificationBar";
import OutlinePanel from "./dotto/OutlinePanel";
import PricingOverlay from "./dotto/PricingOverlay";
import ProfileAvatarSm from "./dotto/ProfileAvatarSm";
import ProfileIdentity from "./dotto/ProfileIdentity";
import ProfileLevelPill from "./dotto/ProfileLevelPill";
import PublishFlowName from "./dotto/PublishFlowName";
import RecommendedSearchesPanel from "./dotto/RecommendedSearchesPanel";
import SearchSuggestionsPanel from "./dotto/SearchSuggestionsPanel";
import SelectionToolbar from "./dotto/SelectionToolbar";
import SharedCanvasModalBody from "./dotto/SharedCanvasModalBody";
import SourcesListPanel from "./dotto/SourcesListPanel";
import TranslationPanel from "./dotto/TranslationPanel";
import WaypointsListPanel from "./dotto/WaypointsListPanel";

import TopBar from "./dotto/sections/TopBar";
import CollaboratorsPanel from "./dotto/sections/CollaboratorsPanel";
import SharedCanvasModal from "./dotto/sections/SharedCanvasModal";
import HamburgerMenu from "./dotto/sections/HamburgerMenu";
import PaneGrid from "./dotto/PaneGrid";
import ZoomControl from "./dotto/sections/ZoomControl";
import SourceAddMenu from "./dotto/sections/SourceAddMenu";
import CellTagPicker from "./dotto/sections/CellTagPicker";
import AudioRecordIndicator from "./dotto/sections/AudioRecordIndicator";
import DrawSettingsBar from "./dotto/sections/DrawSettingsBar";
import ItemContextMenu from "./dotto/sections/ItemContextMenu";
import CanvasContextMenu from "./dotto/sections/CanvasContextMenu";

// Phase 1 "lift and shim" + Phase 2 increment 1 ("shell componentization") + Phase 1 (the
// dotto-script.js restructuring one, see PHASE2_ROADMAP.md — the numbering collides with the
// increment above, both predate the restructuring plan) module split.
//
// The original Dotto.html was one file: static markup followed by a single
// giant classic (non-module) <script> that queries the DOM with
// document.getElementById(...) at top level and wires everything up with
// closures over shared mutable state. Rather than trying to rewrite all 269
// interdependent functions into React state in one pass (high risk of
// silently losing behavior), this component reproduces the exact same
// runtime shape under Next.js, now split into per-subsystem sections:
//
//   1. Each section's markup is injected verbatim via dangerouslySetInnerHTML
//      (see app/dotto/sections/*), so it's real HTML parsed by the browser
//      (not JSX) — every inline onclick="..."/oninput="..." attribute from
//      the original file keeps working unmodified, resolved against the
//      global scope at click time. Splitting into named sections is purely
//      organizational (confirmed no CSS/JS in the original relies on these
//      containers being direct children of <body> or on their exact sibling
//      order via `:nth-child`), so this is still zero behavior change.
//   2. public/dotto-script.js is no longer the whole app in one classic
//      script — it's now a thin ES module entry point that just imports
//      every file under public/dotto/ (in the original file's own top-to-
//      bottom order — see PHASE2_ROADMAP.md Phase 1) plus a generated
//      window-bridge.js at the end, which is what makes every inline
//      onclick="..." attribute above still resolve: real ES modules don't
//      attach their top-level functions to `window` the way a classic
//      script did, so window-bridge.js explicitly does that for every name
//      actually called by name from HTML. `type="module"` on the <Script>
//      tag below is the one change that makes the browser load it as such.
//
// Phase 2 will continue by peeling pieces of dotto-script.js into real React
// state/hooks, subsystem by subsystem (see PHASE2_ROADMAP.md), replacing
// this shim a bit at a time rather than all at once.
//
// dotto-script.js's entry point can't top-level `import` the Supabase client
// itself without creating a real dependency edge into app/ from public/ (and
// every module it loads still expects a plain global, not an import, since
// they were mechanically extracted from the original classic script — see
// Phase 1 in PHASE2_ROADMAP.md). Instead this component — which hydrates
// before the afterInteractive script runs — hangs a shared client on
// `window` for it to use, alongside the signed-in user's profile.
if (typeof window !== "undefined" && !window.__dottoSupabase) {
  window.__dottoSupabase = createClient();
}

// Phase 3 of the vanilla->React consolidation: setupResizing/setupDraggingAndClicking/
// renderConnectionsLayer/renderStaticTableHTML/attachStaticTableHoverZones/
// layoutSourceTableColumns now live in app/dotto/canvasItemBehavior.js instead of
// public/dotto/resize-shortcuts-init.js, public/dotto/drag-drop-chat.js,
// public/dotto/srs-connections-core.js, and public/dotto/source-table.js — every already-React
// card component that owns a resize handle (TableCard.jsx, FlashcardCard.jsx, MediaCard.jsx,
// TypeRightCard.jsx) imports setupResizing directly now, no bridge needed. The remaining vanilla
// callers (attachNoteBody's own call to setupResizing, attachUniversalItemBehavior's own call to
// setupDraggingAndClicking, render()'s own calls to renderConnectionsLayer/renderStaticTableHTML/
// attachStaticTableHoverZones/layoutSourceTableColumns, and relayoutSourceTableIfVisible's own
// call to layoutSourceTableColumns — waypoints-render-loop.js and
// source-buttons-cursor-mode.js, some reached via a component's own layout effect) still need
// these bridges — same "set during module eval, not an effect" timing as window.__dottoSupabase
// above: several of these vanilla calls can fire from another component's OWN layout effect
// during the very first commit, before this component's own (passive) useEffect below would
// otherwise get a chance to assign them.
if (typeof window !== "undefined") {
  window.__setupResizing = setupResizing;
  window.__setupDraggingAndClicking = setupDraggingAndClicking;
  window.__renderConnectionsLayer = renderConnectionsLayer;
  window.__renderStaticTableHTML = renderStaticTableHTML;
  window.__attachStaticTableHoverZones = attachStaticTableHoverZones;
  window.__layoutSourceTableColumns = layoutSourceTableColumns;
}

// Phase 2 increment 1: the pricing overlay is the first subsystem converted to real React state
// (see app/dotto/PricingOverlay.jsx). public/dotto/profile-achievements-pricing.js's vanilla
// openPricingOverlay/closePricingOverlay still exist unchanged for every existing caller (inline
// onclick="..." attributes, other ES modules) — they just call this instead of touching the DOM
// directly now. Same "set during module eval, not an effect" timing as window.__dottoSupabase
// above: vanilla code (via afterInteractive dotto-script.js) needs this to exist as soon as it
// might call it, and effects run after paint, too late relative to that ordering guarantee.
if (typeof window !== "undefined") {
  window.__setPricingOverlayOpen = pricingOverlayStore.set;
  // Phase 2 increment 2: same pattern, for the text-selection toolbar shell — see
  // app/dotto/SelectionToolbar.jsx and search-orchestration-selection.js's
  // showSelectionToolbarFor/hideSelectionToolbar.
  window.__setSelectionToolbarState = selectionToolbarStore.set;
  // Canvas items layer (see app/dotto/CanvasItemsLayer.jsx, PHASE2_ROADMAP.md's canvas-items-react
  // plan) — render() (waypoints-render-loop.js) calls this in place of its old world.innerHTML=''
  // rebuild, passing appState.activePaneId explicitly (split-screen Stage 4 — canvasItemsStore is
  // pane-keyed now, see bridges.js: each pane shows its own folder's items independently).
  // MUST commit synchronously: at least one caller (drag-drop-chat.js's alt-duplicate-drag) does
  // `render(); findItemEl(id)` immediately afterward and depends on that node already existing. A
  // plain store.set(...) here would only schedule the update (React 18+ batches/defers updates
  // triggered outside of React's own event handlers to a microtask), so this wraps it in flushSync
  // to force the commit — and, since each CanvasItem's own body-building happens in a
  // useLayoutEffect (synchronous, pre-paint), flushSync flushes that too, before this returns.
  window.__renderCanvasItems = (items, paneId) =>
    flushSync(() => canvasItemsStore.storeFor(paneId).set(items));
  // Pane layout (split-screen Stage 4+, see app/dotto/PaneGrid.jsx) — the tree itself, plus the
  // split/close operations on it (Stage 6 — see paneLayoutStore's own comment, bridges.js, for why
  // this became a real tree instead of a flat rect list). All flushSync'd for the same reason
  // __renderCanvasItems is: a caller that splits or closes a pane needs that pane's own
  // #canvas-{paneId}/#world-{paneId}/etc DOM to actually exist (or stop existing) immediately
  // afterward, not just scheduled for a later batched update.
  window.__setPaneLayout = (tree) => flushSync(() => paneLayoutStore.set(tree));
  window.__getPaneLayout = () => paneLayoutStore.getSnapshot();
  window.__listPaneIds = () => listPaneIds(paneLayoutStore.getSnapshot());
  window.__countPanes = () => listPaneIds(paneLayoutStore.getSnapshot()).length;
  window.__splitPaneInLayout = (targetPaneId, newPaneId, edge) =>
    flushSync(() =>
      paneLayoutStore.set(
        splitLeafInTree(paneLayoutStore.getSnapshot(), targetPaneId, newPaneId, edge),
      ),
    );
  window.__closePaneInLayout = (paneId) =>
    flushSync(() => paneLayoutStore.set(closeLeafInTree(paneLayoutStore.getSnapshot(), paneId)));
  // Drops a closed pane's own items/tabs/breadcrumb stores (see createPaneKeyedStore's own
  // comment, bridges.js) so they don't just leak forever once closePane
  // (app/dotto/lib/splitPaneManagement.ts) actually closes a pane.
  window.__removePaneItemsStore = (paneId) => canvasItemsStore.remove(paneId);
  window.__removePaneTabsStore = (paneId) => {
    tabsStore.remove(paneId);
    breadcrumbMapStore.remove(paneId);
    navHistoryStore.remove(paneId);
    collabPillStore.remove(paneId);
    mediaViewerZoomStore.remove(paneId);
  };
  // Temporary dev-only trigger (split-screen Stage 4 — "Ship WITHOUT the drag-to-split gesture
  // yet") for exercising a real second pane ahead of Stage 5's actual drag-to-split UI. Splits the
  // viewport into a fixed 50/50 left/right layout, activates the new right pane, and brings it up
  // to a fresh starting state (own camera/selection/history, not a copy of the left pane's) via
  // window.__initializeNewPane. Still useful post-Stage-6 as a quick manual smoke-test trigger, so
  // kept rather than removed.
  window.__debugSplitPane = () => {
    const appState = window.__getAppState();
    if (appState.activePaneId !== 0) window.__switchActivePane(0);
    window.__splitPaneInLayout(0, 1, "right");
    window.__switchActivePane(1);
    window.__initializeNewPane(1, "root");
    window.__render();
  };
  // Search-dropdown result panels (see app/dotto/TranslationPanel.jsx and friends,
  // public/dotto/mnemonic-search-matching.js). Unlike the notification stack (app/dotto/lib/
  // notificationsStore.ts — a plain Zustand store now, React reads it directly with no
  // window-bridge write needed at all), these DO need flushSync — updateSearchDropdown
  // (ai-assistant-suggestions.js) reads
  // each panel's real DOM node's style.display synchronously right after calling its
  // render*Panel function (see renderOrchestrateResult, search-orchestration-selection.js, which
  // calls several of these back-to-back and then updateSearchDropdown once at the end) — without
  // flushSync that read would race the layout effect that actually sets style.display, same bug
  // flushSync already exists to prevent for canvasItemsStore above.
  window.__setTranslationPanel = (panel) => flushSync(() => translationPanelStore.set(panel));
  window.__setDictionaryPanel = (panel) => flushSync(() => dictionaryPanelStore.set(panel));
  window.__setExamplesPanel = (panel) => flushSync(() => examplesPanelStore.set(panel));
  window.__setRecommendedSearches = (panel) => flushSync(() => recommendedSearchesStore.set(panel));
  window.__setDotbotAnswer = (answer) => flushSync(() => dotbotAnswerStore.set(answer));
  window.__setImageResult = (state) => flushSync(() => imageResultStore.set(state));
  // #search-chat-thread (see app/dotto/ChatThread.jsx, chatThreadStore's own comment above) — the
  // persisted multi-turn conversation shown above the search input, entirely separate from the six
  // single-owner panels right above (canvas matches/commands/suggestions below the input are
  // unaffected). flushSync for the same reason as those: the new independent chat-thread
  // height-transition function (ai-assistant-suggestions.js) reads #search-chat-thread's real
  // scrollHeight synchronously right after a turn is appended/restored.
  window.__setChatThread = (turns) => flushSync(() => chatThreadStore.set(turns));
  window.__appendChatTurn = (turn) =>
    flushSync(() => chatThreadStore.set([...chatThreadStore.getSnapshot(), turn]));
  // #search-command-palette (see app/dotto/CommandPalette.jsx, command-palette.js's
  // updateCommandPalette) — same flushSync reasoning as the six above. Specifically also needs it
  // for a second reason: it's a real portal (see commandPaletteStore's own comment in bridges.js),
  // and search-orchestration-selection.js's command-mode keydown branches read its rows via
  // querySelectorAll synchronously right after this is called.
  window.__setCommandPalette = (state) => flushSync(() => commandPaletteStore.set(state));
  window.__setSearchSuggestions = (state) => flushSync(() => searchSuggestionsStore.set(state));
  // Add-to-source popup (see app/dotto/AddToSourcePopup.jsx, addToSourcePopupStore) — MUST be
  // flushSync: openAddToSourcePopup (search-orchestration-selection.js) calls
  // renderAddToSourcePopup immediately after this, which looks the div up by id and needs it to
  // already exist in the DOM.
  window.__setAddToSourcePopupOpen = (state) => flushSync(() => addToSourcePopupStore.set(state));
  // Hamburger menu's Outline panel (see app/dotto/OutlinePanel.jsx, outline-tree.js's
  // buildOutline/handleOutlineSearch) — MUST be flushSync: buildOutline's own scrollTop restore,
  // and toggleHamburgerMenu's setOutlineActive(0) call right after buildOutline() returns, both
  // need OutlinePanel.jsx's real DOM (and its own layout effect, which calls
  // window.__syncOutlineRows) already committed.
  window.__setOutlineState = (state) => flushSync(() => outlineStore.set(state));
  // Hamburger menu's Waypoints panel (see app/dotto/WaypointsListPanel.jsx,
  // hamburger-collab.js's renderWaypointsList) — a plain store.set, not flushSync'd: the fetch
  // it follows is async (a real network round-trip), so there's no synchronous DOM read racing
  // this the way there was for the search panels.
  window.__setWaypointsList = waypointsListStore.set;
  // Hamburger menu's Sources panel (see app/dotto/SourcesListPanel.jsx,
  // hamburger-collab.js's renderSourcesList) — a plain store.set, no synchronous DOM read follows
  // it (it's called from render() itself, not a click handler expecting an immediate reflection).
  window.__setSourcesList = sourcesListStore.set;
  // Hamburger menu's Files panel (see app/dotto/FilesListPanel.jsx, hamburger-collab.js's
  // renderFilesList) — copied from __setSourcesList just above per explicit request; same
  // reasoning (a plain store.set, no synchronous DOM read follows it).
  window.__setFilesList = filesListStore.set;
  // Hamburger menu's Chats panel (see app/dotto/ChatsListPanel.jsx, hamburger-collab.js's
  // renderChatsList) — same reasoning as __setWaypointsList: a real async Supabase call.
  window.__setChatsList = chatsListStore.set;
  // Hamburger menu's Collaborations panel (see app/dotto/HubCollabListPanel.jsx,
  // hamburger-collab.js's renderHubCollabList/renderHubCollabRequests) — same reasoning as
  // __setWaypointsList: both entry points are real async Supabase calls.
  window.__setHubCollabList = hubCollabListStore.set;
  // Shift-click-to-select state for the Chats/Waypoints/Collaborations hamburger list panels (see
  // listPanelSelectionStore's own comment) — plain store.set, no synchronous DOM read follows a
  // selection toggle either.
  window.__setListPanelSelection = listPanelSelectionStore.set;
  // Profile panel (see app/dotto/ProfileLevelPill.jsx/AchievementsGrid.jsx,
  // profile-achievements-pricing.js's renderProfileLevel/renderSpriteGrid) — plain store.sets,
  // no synchronous DOM read follows either one.
  window.__setProfileLevel = profileLevelStore.set;
  window.__setAchievements = achievementsStore.set;
  // Messages panel (see app/dotto/MessagesListPanel.jsx, friends-presence.js's renderMsgList/
  // renderMsgRequests) — same reasoning as __setWaypointsList/__setHubCollabList: both entry
  // points are real async Supabase calls.
  window.__setMsgList = msgListStore.set;
  // Per-canvas Collaborations flyout (see app/dotto/CollabListPanel.jsx,
  // friends-presence.js's renderCollabList) — same reasoning: real async Supabase calls.
  window.__setCollabList = collabListStore.set;
  // Marketplace Discover tab's trending list (see app/dotto/MarketDiscoverPanel.jsx,
  // marketplace.js's renderMarketplaceDiscover) — a plain store.set, no synchronous DOM read
  // follows it.
  window.__setMarketDiscover = marketDiscoverStore.set;
  // Marketplace item detail view (see app/dotto/MarketDetailPanel.jsx, marketplace.js's
  // openMarketDetail/closeMarketDetail) — a plain store.set, no synchronous DOM read follows it.
  window.__setMarketDetail = marketDetailStore.set;
  // Blocks panel's list content (see app/dotto/BlocksPanel.jsx, blocks-panel.js's
  // computeBlocksRows/refreshBlocksPanel — was Library/LibraryPanel.jsx's role before Essentials/
  // Library were repurposed into Blocks/Extensions) — a plain store.set, no synchronous DOM read
  // follows it.
  window.__setBlocksView = blocksViewStore.set;
  // Extensions panel's list content (see app/dotto/ExtensionsPanel.jsx) — dummy data for now, a
  // plain store.set, no synchronous DOM read follows it.
  window.__setExtensionsList = extensionsListStore.set;
  // Item Detail view's footer button set (see app/dotto/ItemDetailFooter.jsx, library-publish.js's
  // renderItemDetailFooter) — a plain store.set, no synchronous DOM read follows it.
  window.__setItemDetailFooter = itemDetailFooterStore.set;
  // Collaborators pill, one per pane (see app/dotto/PaneTopBar.jsx, friends-presence.js's
  // renderCollabPill) — pane-keyed since split-screen Stage 8, same reasoning as
  // __setBreadcrumbMap/__setTabs below. MUST be flushSync: openCollabPanel (friends-presence.js)
  // reads the triggering bubble element's `.show` class synchronously right after this runs.
  window.__setCollabPill = (paneId, state) =>
    flushSync(() => collabPillStore.storeFor(paneId).set(state));
  // Back/forward enabled-state, one per pane (see app/dotto/PaneTopBar.jsx,
  // tab-management.js's renderNavArrows) — pane-keyed for the same reason. A plain
  // store.set, no synchronous DOM read follows it.
  window.__setNavHistory = (paneId, state) => navHistoryStore.storeFor(paneId).set(state);
  // Which pane is active (see app/dotto/PaneZoomBar.jsx) — pushed by switchActivePane
  // (core-state.js). A plain store.set, no synchronous DOM read follows it.
  window.__setActivePaneId = (paneId) => activePaneIdStore.set(paneId);
  // Media-viewer zoom, one per pane (see app/dotto/PaneZoomBar.jsx,
  // shared-canvases-outline.js's renderMediaViewerZoom/setMediaViewerZoom) — pane-keyed for the
  // same reason as __setNavHistory above. A plain store.set, no synchronous DOM read follows it.
  window.__setMediaViewerZoom = (paneId, state) => mediaViewerZoomStore.storeFor(paneId).set(state);
  // Breadcrumb pill — the compact "…/parent/current" trail for one pane's own active tab (see
  // app/dotto/TabsBar.jsx, tab-management.js's renderBreadcrumbMapPanel, called from
  // every render()) — pane-keyed since split-screen Stage 7 (each pane gets its own breadcrumb
  // pill now), so this takes the paneId explicitly rather than being tabsStore.set directly. A
  // plain store.set, no synchronous DOM read follows it.
  window.__setBreadcrumbMap = (paneId, state) => breadcrumbMapStore.storeFor(paneId).set(state);
  // Canvas tabs (see app/dotto/TabsBar.jsx, tab-management.js's renderTabsPanel, called
  // from every render() alongside the breadcrumb map above) — pane-keyed for the same reason. A
  // plain store.set, no synchronous DOM read follows it.
  window.__setTabs = (paneId, state) => tabsStore.storeFor(paneId).set(state);
  // Open conversation thread (see app/dotto/MsgConvo.jsx, live-presence.js's renderConvoBody) — a
  // plain store.set, no synchronous DOM read follows it (the scroll-to-bottom reset lives in a
  // useLayoutEffect inside MsgConvo.jsx itself instead).
  window.__setMsgConvo = msgConvoStore.set;
  // Shared Card preview modal's body (see app/dotto/SharedCanvasModalBody.jsx, live-presence.js's
  // openSharedCanvasView) — a plain store.set, no synchronous DOM read follows it.
  window.__setSharedCanvasModal = sharedCanvasModalStore.set;
  // Cell tag picker dropdown (see app/dotto/CellTagPickerList.jsx, source-tags-ai.js's
  // renderCellTagPickerList) — a plain store.set, no synchronous DOM read follows it.
  window.__setCellTagPickerList = cellTagPickerListStore.set;
}

export default function DottoApp({ sections, currentUser }) {
  // A raw <script> rendered via JSX/dangerouslySetInnerHTML is never executed
  // by the browser on the client (same rule as innerHTML) — it silently did
  // nothing here. Setting it directly during render is what actually runs,
  // same as the window.__dottoSupabase bootstrap above.
  if (typeof window !== "undefined") {
    // Deliberately not moved into an effect (which the react-hooks/immutability rule below
    // would otherwise want) — dotto-script.js's afterInteractive <Script> tag needs
    // window.__DOTTO_USER__ set before it runs, and setting it during render (not after paint,
    // which an effect would do) is what guarantees that ordering — same reasoning as the
    // window.__dottoSupabase bootstrap above.
    // eslint-disable-next-line react-hooks/immutability
    window.__DOTTO_USER__ = currentUser;
  }

  // Overwrites app/layout.js's static "Dotto" fallback title once the logged-in user is known —
  // per explicit request, replacing the old "Dotter v0.1.3" placeholder with "Dotto | @username".
  // A real effect (not inline during render like window.__DOTTO_USER__ above) since nothing else
  // depends on document.title being set before some other script runs.
  useEffect(() => {
    document.title = `Dotto | @${currentUser.username}`;
  }, [currentUser]);

  // Phase 4.1: dotbot-schedule-notifications.js's two generic app-lifetime timers (3am day-change
  // ping, one-time paid-tier ad nudge) — see wireDayChangeAndAdNotifications' own comment for why
  // this needs to poll for window.__getAppState rather than a single readiness check.
  useEffect(() => wireDayChangeAndAdNotifications(), []);
  // Phase 4.4: the notification stack's global keydown (Enter/Escape act on the topmost
  // notification) and visibilitychange (flush anything queued while backgrounded) listeners — see
  // wireNotifications' own comment, app/dotto/lib/notificationsStore.ts.
  useEffect(() => wireNotifications(), []);

  return (
    <>
      <div id="dotto-root">
        <ErrorBoundary name="TopBar">
          <TopBar html={sections["top-bar"]} />
        </ErrorBoundary>
        <ErrorBoundary name="CollaboratorsPanel">
          <CollaboratorsPanel html={sections["collab-panel"]} />
        </ErrorBoundary>
        <ErrorBoundary name="SharedCanvasModal">
          <SharedCanvasModal html={sections["canvas-modal"]} />
        </ErrorBoundary>
        {/* Profile/Messages/Marketplace/Add/AI search all moved into #hamburger-stack (see
            hamburger-stack.html) now that they share the permanent rail's one shell — no more
            separate top-level sections/markup of their own, and no more dimming modal backdrop
            for AI search specifically. */}
        <ErrorBoundary name="HamburgerMenu">
          <HamburgerMenu html={sections["hamburger-stack"]} />
        </ErrorBoundary>
        <ErrorBoundary name="PaneGrid">
          <PaneGrid html={sections["canvas-area"]} />
        </ErrorBoundary>
        <ErrorBoundary name="ZoomControl">
          <ZoomControl html={sections["zoom-control"]} />
        </ErrorBoundary>
        <ErrorBoundary name="SourceAddMenu">
          <SourceAddMenu html={sections["source-add-menu"]} />
        </ErrorBoundary>
        <ErrorBoundary name="CellTagPicker">
          <CellTagPicker html={sections["cell-tag-picker"]} />
        </ErrorBoundary>
        <ErrorBoundary name="AudioRecordIndicator">
          <AudioRecordIndicator html={sections["audio-record-indicator"]} />
        </ErrorBoundary>
        <ErrorBoundary name="DrawSettingsBar">
          <DrawSettingsBar html={sections["draw-settings"]} />
        </ErrorBoundary>
        <ErrorBoundary name="ItemContextMenu">
          <ItemContextMenu html={sections["context-menu"]} />
        </ErrorBoundary>
        <ErrorBoundary name="CanvasContextMenu">
          <CanvasContextMenu html={sections["canvas-context-menu"]} />
        </ErrorBoundary>
      </div>
      <ErrorBoundary name="PricingOverlay">
        <PricingOverlay />
      </ErrorBoundary>
      <ErrorBoundary name="SelectionToolbar">
        <SelectionToolbar />
      </ErrorBoundary>
      <ErrorBoundary name="NotificationBar">
        <NotificationBar />
      </ErrorBoundary>
      <ErrorBoundary name="TranslationPanel">
        <TranslationPanel />
      </ErrorBoundary>
      <ErrorBoundary name="DictionaryPanel">
        <DictionaryPanel />
      </ErrorBoundary>
      <ErrorBoundary name="ExamplesPanel">
        <ExamplesPanel />
      </ErrorBoundary>
      <ErrorBoundary name="RecommendedSearchesPanel">
        <RecommendedSearchesPanel />
      </ErrorBoundary>
      <ErrorBoundary name="DotbotAnswerPanel">
        <DotbotAnswerPanel />
      </ErrorBoundary>
      <ErrorBoundary name="ImageResultPanel">
        <ImageResultPanel />
      </ErrorBoundary>
      <ErrorBoundary name="CommandPalette">
        <CommandPalette />
      </ErrorBoundary>
      <ErrorBoundary name="SearchSuggestionsPanel">
        <SearchSuggestionsPanel />
      </ErrorBoundary>
      <ErrorBoundary name="ChatThread">
        <ChatThread />
      </ErrorBoundary>
      <ErrorBoundary name="AddToSourcePopup">
        <AddToSourcePopup />
      </ErrorBoundary>
      <ErrorBoundary name="OutlinePanel">
        <OutlinePanel />
      </ErrorBoundary>
      <ErrorBoundary name="WaypointsListPanel">
        <WaypointsListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="SourcesListPanel">
        <SourcesListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="FilesListPanel">
        <FilesListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="ChatsListPanel">
        <ChatsListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="HubCollabListPanel">
        <HubCollabListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="MessagesListPanel">
        <MessagesListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="CollabListPanel">
        <CollabListPanel />
      </ErrorBoundary>
      <ErrorBoundary name="MarketDiscoverPanel">
        <MarketDiscoverPanel />
      </ErrorBoundary>
      <ErrorBoundary name="MarketDetailPanel">
        <MarketDetailPanel />
      </ErrorBoundary>
      <ErrorBoundary name="BlocksPanel">
        <BlocksPanel />
      </ErrorBoundary>
      <ErrorBoundary name="ExtensionsPanel">
        <ExtensionsPanel />
      </ErrorBoundary>
      <ErrorBoundary name="ItemDetailFooter">
        <ItemDetailFooter />
      </ErrorBoundary>
      <ErrorBoundary name="ItemDetailTitle">
        <ItemDetailTitle />
      </ErrorBoundary>
      <ErrorBoundary name="PublishFlowName">
        <PublishFlowName />
      </ErrorBoundary>
      <ErrorBoundary name="MsgConvo">
        <MsgConvo />
      </ErrorBoundary>
      <ErrorBoundary name="SharedCanvasModalBody">
        <SharedCanvasModalBody />
      </ErrorBoundary>
      <ErrorBoundary name="CellTagPickerList">
        <CellTagPickerList />
      </ErrorBoundary>
      <ErrorBoundary name="ProfileLevelPill">
        <ProfileLevelPill />
      </ErrorBoundary>
      <ErrorBoundary name="ProfileIdentity">
        <ProfileIdentity />
      </ErrorBoundary>
      <ErrorBoundary name="ProfileAvatarSm">
        <ProfileAvatarSm />
      </ErrorBoundary>
      <ErrorBoundary name="AchievementsGrid">
        <AchievementsGrid />
      </ErrorBoundary>
      <Script src="/dotto-script.js" type="module" strategy="afterInteractive" />
    </>
  );
}
