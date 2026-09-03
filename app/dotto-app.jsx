"use client";

import { useEffect } from "react";
import { flushSync } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  canvasItemsStore,
  closeLeafInTree,
  listPaneIds,
  paneLayoutStore,
  splitLeafInTree,
} from "./dotto/bridges";
import { useBreadcrumbMapStore } from "./dotto/lib/breadcrumbMapStore";
import { useCollabPillStore } from "./dotto/lib/collabPillStore";
import { useMediaViewerZoomStore } from "./dotto/lib/mediaViewerZoomStore";
import { useNavHistoryStore } from "./dotto/lib/navHistoryStore";
import { useTabsStore } from "./dotto/lib/tabsStore";
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
import { wireCopyPaste } from "./dotto/lib/copyPaste";
import { wireDayChangeAndAdNotifications } from "./dotto/lib/dayChangeAndAdNotifications";
import { wireMarketplace } from "./dotto/lib/marketplace";
import { wireNotifications } from "./dotto/lib/notificationsStore";
import { wireSourceButtonsCursorMode } from "./dotto/lib/sourceButtonsCursorMode";
import { wirePanelsHamburger } from "./dotto/lib/panelsHamburger";
import { wireCanvasPresence } from "./dotto/lib/canvasPresence";
import { wireMessagingCanvasPreview } from "./dotto/lib/messagingCanvasPreview";
import { wireHistoryAutosave } from "./dotto/lib/historyAutosave";
import { wireSrsConnectionsCore } from "./dotto/lib/srsConnectionsCore";
import { wireProfileAchievementsPricing } from "./dotto/lib/profileAchievementsPricing";
import { wireCardShortcuts } from "./dotto/lib/cardShortcuts";
import { wireAiAssistantSuggestions } from "./dotto/lib/aiAssistantSuggestions";
import { wireSearchOrchestrationSelection } from "./dotto/lib/searchOrchestrationSelection";
import { wireHamburgerCollab } from "./dotto/lib/hamburgerCollab";
import { wireFriendsPresence } from "./dotto/lib/friendsPresence";
import { wireMessagesSchedule } from "./dotto/lib/messagesSchedule";
import { wireAppInit } from "./dotto/lib/appInit";
import { wireExtensionsPanel } from "./dotto/lib/extensionsPanel";
import { wireUploadPopup } from "./dotto/lib/uploadPopup";
import { wireBlocksPanel } from "./dotto/lib/blocksPanel";
// Side-effect only — sets this module's own bridges (__buildMnemonicErrorEl/etc) at module-eval
// time. Every real consumer (SearchSuggestionsPanel.jsx, app/dotto/lib/searchOrchestrationSelection.ts)
// now real-imports what it needs directly instead, same app/dotto tree — this bare import may be
// fully redundant at this point, kept rather than risk a subtle evaluation-order regression
// without a dedicated pass to verify it. No wireX() of its own (every top-level statement here is
// a plain function declaration).
import "./dotto/lib/mnemonicSearchMatching";
import { ensureCoreState } from "./dotto/lib/coreState";
// Side-effect only, same reasoning as splitPaneManagement/tabManagement above — sets
// window.__openGameOptionsPanel/fcFlip/etc at module-eval time for the 5 still-vanilla callers
// that used to import these directly, plus the React->vanilla bridges FlashcardCard.jsx/
// TypeRightCard.jsx/GameOptionsPanel.jsx already called before this port.
import "./dotto/lib/gamesFlashcardTyperight";
// Side-effect only, same reasoning as splitPaneManagement/tabManagement above — sets
// window.__renderMediaHTML/setMediaFromLink/etc at module-eval time for the 3 still-vanilla
// callers that used to import these directly, plus the React->vanilla bridges MediaCard.jsx
// itself now imports directly instead (app/dotto/lib/messagingCanvasPreview.ts's mini previews
// still need the bridges).
import "./dotto/lib/mediaPdfEpub";
// Side-effect only, same reasoning as splitPaneManagement/tabManagement above — sets
// window.__renderTableHTML/updateTableCell/etc at module-eval time for the 5 still-vanilla
// callers that used to import these directly, plus the React->vanilla bridges TableCard.jsx
// itself now imports directly instead (app/dotto/lib/messagingCanvasPreview.ts's mini previews
// and canvasItemBehavior.js's Source-page renderer still need the bridges).
import "./dotto/lib/sourceTable";
// Side-effect only — sets window.__splitPaneWithTab/__closePane at module-eval time (no wireX()
// needed, unlike the two imports above: nothing here needs a live DOM/appState read at wire time,
// just the bridge assignment itself). Imported here, not from any specific component, since
// TabsBar.jsx/PaneTopBar.jsx are bridge CONSUMERS (call window.__splitPaneWithTab/__closePane),
// not producers — this needs to run unconditionally, same as bridges.js's own pane helpers below.
import "./dotto/lib/splitPaneManagement";
// Side-effect only, same reasoning as splitPaneManagement above — sets window.__addTab/__switchTab/
// etc at module-eval time; TabsBar.jsx/PaneTopBar.jsx are bridge consumers, not producers.
import "./dotto/lib/tabManagement";
// Side-effect only, same reasoning as splitPaneManagement/tabManagement above — sets
// window.__openSharedCanvas/__ensureSharedFolderLoaded/etc at module-eval time for the 6
// still-vanilla callers that used to import these directly.
import "./dotto/lib/sharedAndPublicCanvasLoading";
// Side-effect only, same reasoning as splitPaneManagement/tabManagement above — sets
// window.startRenameShelfName/setFilterMode/etc at module-eval time for the 5 still-vanilla
// callers that used to import these directly.
import "./dotto/lib/shelfSearch";
// Side-effect only, same reasoning as splitPaneManagement/tabManagement above — sets
// window.__buildOutline/__kindIconFile/etc at module-eval time for the 7 still-vanilla callers
// that used to import these directly, plus the React->vanilla bridges OutlinePanel.jsx/
// FilesListPanel.jsx already called before this port.
import "./dotto/lib/outlineTree";
// Side-effect only, same reasoning as outlineTree/splitPaneManagement/tabManagement above — sets
// window.__render/__openFolder/__attachNoteBody/etc at module-eval time for the 10 still-vanilla
// callers that used to import these directly, plus the many React->vanilla bridges
// CanvasItemsLayer.jsx/CanvasCard.jsx/etc already called before this port. Unlike every wireX()
// port, this file has no real DOM-listener wiring to defer — every interactive piece is attached
// per-item from a React layout effect or invoked directly by a caller — so a plain side-effect
// import is enough, no useEffect/wireX() call needed here.
import "./dotto/lib/waypointsRenderLoop";
// Side-effect only — sets window.__shortUrl/__toEmbeddableUrl/__renderChecklistHTML/
// __renderStatcardHTML/editEmbed/addTask/etc at module-eval time; EmbedCard.jsx/ChecklistCard.jsx
// import the real functions directly instead (same app/dotto/ tree), but the plain-global names
// still need to exist for renderChecklistHTML's own generated inline onclick/onchange/oninput
// attributes and for outlineTree.ts/messagingCanvasPreview.ts's bridge reads.
import "./dotto/lib/cardsMisc";
// Side-effect only — sets window.__openItemDetail/__deleteMyCreationItem/onItemDetailFieldChange/
// confirmPublishFlow at module-eval time for app/dotto/lib/blocksPanel.ts (kept as a bridge
// deliberately — see that file's own header comment for why a direct import would be circular)
// and content/fragments/hamburger-stack.html's inline oninput/onclick targets; ItemDetailTitle.jsx/
// PublishFlowName.jsx/ItemDetailFooter.jsx import the real functions directly instead (same
// app/dotto/ tree).
import "./dotto/lib/libraryPublish";
// Side-effect only — sets window.__calculateSM2/__defaultSrsState/__diffRatings at module-eval
// time for still-vanilla/still-bridge-only callers; genuinely pure/zero-import, same reasoning
// srs-algorithm.js already established.
import "./dotto/lib/srsAlgorithm";
// Side-effect only — sets window.__dispatchSelectedToChat at module-eval time; its only real
// caller (app/dotto/canvasItemBehavior.js) is a plain .js file, not same-tree.
import "./dotto/lib/dragDropChat";
// Side-effect only — sets window.__openRowTagPicker/__tagPillsHTML/__closeCellTagPicker plus the
// real inline-HTML plain globals (closeCellTagPicker/closeTagContextMenu/createTagFromCellPicker/
// deleteActiveTag/startRenameActiveTag/triggerSourceUpload) at module-eval time;
// CellTagPickerList.jsx imports the real functions directly instead (same app/dotto/ tree) for its
// own TagRow handlers.
import "./dotto/lib/sourceTagsAi";
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
//   2. public/dotto-script.js used to be a thin ES module entry point that
//      imported every remaining file under public/dotto/ — Phase 4.1's own
//      closing port (PHASE4_ROADMAP.md) emptied that surface out entirely,
//      so the <Script> tag that used to load it (and window-bridge.js,
//      which made every inline onclick="..." attribute above resolve
//      against a real `window` assignment, the way a classic script did for
//      free) are both gone now. Every inline handler resolves against a
//      real plain-global assignment (`window.foo = ...`) set directly by
//      whichever app/dotto/lib/*.ts file owns it instead — same shape, just
//      set from here on.
//
// dotto-script.js's own (now-removed) entry point could never top-level
// `import` the Supabase client itself without creating a real dependency
// edge into app/ from public/. Nothing loads before this component anymore,
// but window.__dottoSupabase remains: it's still the one bridge every
// ported file's own module-eval-time code reads before this component's own
// (passive) useEffect below would get a chance to assign it via props/
// context instead — same "set during module eval, not an effect" timing
// window.__setupResizing below needs too.
if (typeof window !== "undefined" && !window.__dottoSupabase) {
  window.__dottoSupabase = createClient();
}

// Phase 3 of the vanilla->React consolidation: setupResizing/setupDraggingAndClicking/
// renderConnectionsLayer/renderStaticTableHTML/attachStaticTableHoverZones/
// layoutSourceTableColumns now live in app/dotto/canvasItemBehavior.js instead of
// public/dotto/resize-shortcuts-init.js, public/dotto/drag-drop-chat.js,
// public/dotto/srs-connections-core.js, and app/dotto/lib/sourceTable.ts — every already-React
// card component that owns a resize handle (TableCard.jsx, FlashcardCard.jsx, MediaCard.jsx,
// TypeRightCard.jsx) imports setupResizing directly now, no bridge needed, and as of
// app/dotto/lib/waypointsRenderLoop.ts's own Phase 4.5 port, so does that file (render()'s own
// calls to renderConnectionsLayer/renderStaticTableHTML/attachStaticTableHoverZones/
// layoutSourceTableColumns, attachNoteBody's own call to setupResizing,
// attachUniversalItemBehavior's own call to setupDraggingAndClicking — same-tree, both live in
// app/dotto/lib now). The one remaining real bridge consumer is
// relayoutSourceTableIfVisible's own call to layoutSourceTableColumns
// (app/dotto/lib/sourceButtonsCursorMode.ts, a different lib file, reached via a component's own
// layout effect) — still needs these bridges set, same "set during module eval, not an effect"
// timing as window.__dottoSupabase above: that vanilla call can fire from another component's OWN
// layout effect during the very first commit, before this component's own (passive) useEffect
// below would otherwise get a chance to assign them.
if (typeof window !== "undefined") {
  window.__setupResizing = setupResizing;
  window.__setupDraggingAndClicking = setupDraggingAndClicking;
  window.__renderConnectionsLayer = renderConnectionsLayer;
  window.__renderStaticTableHTML = renderStaticTableHTML;
  window.__attachStaticTableHoverZones = attachStaticTableHoverZones;
  window.__layoutSourceTableColumns = layoutSourceTableColumns;
}

// pricingOverlayStore and selectionToolbarStore (Phase 2 increments 1-2) were the first two
// subsystems converted to real React state — both migrated to real Zustand since (Zustand
// migration plan, batch 1, see PHASE4_ROADMAP.md): PricingOverlay.jsx/SelectionToolbar.jsx and
// their respective producers (app/dotto/lib/profileAchievementsPricing.ts,
// app/dotto/lib/searchOrchestrationSelection.ts) now import usePricingOverlayStore/
// useSelectionToolbarStore directly, no bridge needed.
if (typeof window !== "undefined") {
  // Canvas items layer (see app/dotto/CanvasItemsLayer.jsx, PHASE2_ROADMAP.md's canvas-items-react
  // plan) — render() (app/dotto/lib/waypointsRenderLoop.ts) calls this in place of its old world.innerHTML=''
  // rebuild, passing appState.activePaneId explicitly (split-screen Stage 4 — canvasItemsStore is
  // pane-keyed now, see bridges.js: each pane shows its own folder's items independently).
  // MUST commit synchronously: at least one caller (canvasItemBehavior.js's alt-duplicate-drag) does
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
  // comment, bridges.js, and app/dotto/lib/paneKeyedStore.ts's redesigned Zustand version) so they
  // don't just leak forever once closePane (app/dotto/lib/splitPaneManagement.ts) actually closes
  // a pane.
  window.__removePaneItemsStore = (paneId) => canvasItemsStore.remove(paneId);
  window.__removePaneTabsStore = (paneId) => {
    useTabsStore.remove(paneId);
    useBreadcrumbMapStore.remove(paneId);
    useNavHistoryStore.remove(paneId);
    useCollabPillStore.remove(paneId);
    useMediaViewerZoomStore.remove(paneId);
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
  // The six search-dropdown result panels (translationPanelStore/dictionaryPanelStore/
  // examplesPanelStore/recommendedSearchesStore/dotbotAnswerStore/imageResultStore) all migrated
  // to real Zustand (Zustand migration plan, batch 2, see PHASE4_ROADMAP.md) — their producer
  // (app/dotto/lib/mnemonicSearchMatching.ts) now calls each store's own setState directly,
  // still wrapped in flushSync there for the same reason these bridges used to need it:
  // updateSearchDropdown (app/dotto/lib/aiAssistantSuggestions.ts) reads each panel's real DOM
  // node's style.display synchronously right after.
  // #search-chat-thread (ChatThread.jsx), #search-command-palette (CommandPalette.jsx),
  // #search-suggestions (SearchSuggestionsPanel.jsx), and the add-to-source popup
  // (AddToSourcePopup.jsx) all migrated to real Zustand (Zustand migration plan, batch 3, see
  // PHASE4_ROADMAP.md) — see app/dotto/lib/chatThreadStore.ts, commandPaletteStore.ts,
  // searchSuggestionsStore.ts, and addToSourcePopupStore.ts for each store's own comment on why
  // its producers still wrap every setState call in flushSync.
  // Hamburger menu's Outline/Waypoints/Sources/Files/Chats/Collaborations list panels, and their
  // shared shift-click selection state, all migrated to real Zustand (Zustand migration plan,
  // batch 4, see PHASE4_ROADMAP.md) — see app/dotto/lib/outlineStore.ts, waypointsListStore.ts,
  // sourcesListStore.ts, filesListStore.ts, chatsListStore.ts, hubCollabListStore.ts, and
  // listPanelSelectionStore.ts for each store's own comment on flushSync requirements.
  // Profile panel's level pill and achievement spritebook (see app/dotto/ProfileLevelPill.jsx/
  // AchievementsGrid.jsx) both migrated to real Zustand (Zustand migration plan, batch 5, see
  // PHASE4_ROADMAP.md) — see app/dotto/lib/profileLevelStore.ts/achievementsStore.ts.
  // Messages panel's list (MessagesListPanel.jsx), the per-canvas Collaborations flyout
  // (CollabListPanel.jsx), the open conversation thread (MsgConvo.jsx), and the Shared Card
  // preview modal (SharedCanvasModalBody.jsx) all migrated to real Zustand (Zustand migration
  // plan, batch 6, see PHASE4_ROADMAP.md) — see app/dotto/lib/msgListStore.ts, collabListStore.ts,
  // msgConvoStore.ts, and sharedCanvasModalStore.ts.
  // Marketplace Discover/Detail panels, the Blocks panel, the Extensions panel, and the Item
  // Detail footer all migrated to real Zustand (Zustand migration plan, batch 7, see
  // PHASE4_ROADMAP.md) — see app/dotto/lib/marketDiscoverStore.ts, marketDetailStore.ts,
  // blocksViewStore.ts, extensionsListStore.ts, and itemDetailFooterStore.ts.
  // The per-pane collaborators pill, back/forward nav state, active-pane id, media-viewer zoom,
  // breadcrumb trail, and canvas tabs all migrated to real Zustand (Zustand migration plan,
  // batch 9, see PHASE4_ROADMAP.md) — see app/dotto/lib/collabPillStore.ts, navHistoryStore.ts,
  // activePaneIdStore.ts, mediaViewerZoomStore.ts, breadcrumbMapStore.ts, and tabsStore.ts (the
  // pane-keyed ones now built on app/dotto/lib/paneKeyedStore.ts's redesigned factory).
  // Cell tag picker dropdown (see app/dotto/CellTagPickerList.jsx,
  // app/dotto/lib/sourceTagsAi.ts's renderCellTagPickerList) migrated to real Zustand (Zustand
  // migration plan, batch 8, see PHASE4_ROADMAP.md) — see app/dotto/lib/cellTagPickerListStore.ts.
}

export default function DottoApp({ sections, currentUser }) {
  // A raw <script> rendered via JSX/dangerouslySetInnerHTML is never executed
  // by the browser on the client (same rule as innerHTML) — it silently did
  // nothing here. Setting it directly during render is what actually runs,
  // same as the window.__dottoSupabase bootstrap above.
  if (typeof window !== "undefined") {
    // Deliberately not moved into an effect (which the react-hooks/immutability rule below
    // would otherwise want) — ensureCoreState() right below reads window.__DOTTO_USER__
    // synchronously, in this same render-body spot, and setting it during render (not after
    // paint, which an effect would do) is what guarantees it's already there — same reasoning as
    // the window.__dottoSupabase bootstrap above.
    // eslint-disable-next-line react-hooks/immutability
    window.__DOTTO_USER__ = currentUser;
    // ensureCoreState() (app/dotto/lib/coreState.ts, Phase 4.5 port — was core-state.js)
    // constructs appState itself, which reads window.__DOTTO_USER__ right above — must run in
    // this exact same render-body spot, not a plain module-load-time side-effect import (every
    // other Phase 4.4/4.5 port's own pattern) and not a useEffect either: module evaluation always
    // completes before the first render, too early for window.__DOTTO_USER__ above; an effect
    // fires after paint, too late — window.__DOTTO_USER__ needs to already be set by the time
    // this line runs. Idempotent — only the first call across DottoApp's whole lifetime actually
    // builds anything.
    ensureCoreState();
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
  // Phase 4.4: the copy/cut/paste + add-menu placement-ghost engine's own canvas-listener wiring
  // — see wireCopyPaste's own comment, app/dotto/lib/copyPaste.ts, for why this needs to poll for
  // window.__getCanvasEl rather than a single readiness check.
  useEffect(() => wireCopyPaste(), []);
  // Phase 4.4: the Marketplace rail icon's click/hover/pin wiring — see wireMarketplace's own
  // comment, app/dotto/lib/marketplace.ts, for why this needs to poll for
  // window.__wireRailIcon/appState.btnCart/appState.cartPanel rather than a single readiness check.
  useEffect(() => wireMarketplace(), []);
  // Phase 4.4: the cursor-mode toolbar's click/hover/keyboard-override wiring plus window.onclick
  // — see wireSourceButtonsCursorMode's own comment, app/dotto/lib/sourceButtonsCursorMode.ts, for
  // why this needs to poll for window.__getAppState/appState.modeToolbar rather than a single
  // readiness check.
  useEffect(() => wireSourceButtonsCursorMode(), []);
  // Phase 4.5: the permanent rail's shared open/close contract — 10 real rail-icon click listeners
  // — see wirePanelsHamburger's own comment, app/dotto/lib/panelsHamburger.ts, for why this needs
  // to poll for window.__getAppState/every rail-icon DOM element rather than a single readiness
  // check.
  useEffect(() => wirePanelsHamburger(), []);
  // Phase 4.5: the realtime presence/cursor-broadcast concern's own cursor-tracking pointermove
  // listener + selectionchange listener — see wireCanvasPresence's own comment,
  // app/dotto/lib/canvasPresence.ts, for why this needs to poll for
  // window.__getCanvasEl/window.__registerPaneCanvasListenerSetup rather than a single readiness
  // check.
  useEffect(() => wireCanvasPresence(), []);
  // Phase 4.5: the card-preview/messaging DOM concern's own #msg-convo-input keydown/input
  // listeners — see wireMessagingCanvasPreview's own comment,
  // app/dotto/lib/messagingCanvasPreview.ts, for why this needs to poll for live appState AND that
  // element already existing rather than a single readiness check.
  useEffect(() => wireMessagingCanvasPreview(), []);
  // Phase 4.5: undo/redo, workspace autosave, the canvas camera transform, the canvas context
  // menu, and the global keydown/paste handlers — see wireHistoryAutosave's own comment,
  // app/dotto/lib/historyAutosave.ts, for why this needs to poll for
  // window.__getCanvasEl/window.__getDotLayerEl rather than a single readiness check.
  useEffect(() => wireHistoryAutosave(), []);
  // Phase 4.5: the canvas data-conduit connection system (appState.CardStreamIO), click-to-link,
  // canvas item creation, the pen/eraser drawing tool, the zoom-track drag/dblclick handlers, the
  // draw toolbar, and the global keydown handler backing every one-letter rail shortcut — see
  // wireSrsConnectionsCore's own comment, app/dotto/lib/srsConnectionsCore.ts, for why this needs
  // to poll for live appState AND the canvas/zoom-track/draw-toolbar elements rather than a single
  // readiness check.
  useEffect(() => wireSrsConnectionsCore(), []);
  // Phase 4.5: the profile level pill/avatar/achievements/Dotbot-usage-bars/pricing-overlay
  // system, plus wiring the Profile rail icon itself — see wireProfileAchievementsPricing's own
  // comment, app/dotto/lib/profileAchievementsPricing.ts, for why this needs to poll for both
  // window.__getAppState AND window.__wireRailIcon (app/dotto/lib/panelsHamburger.ts) rather than
  // a single readiness check.
  useEffect(() => wireProfileAchievementsPricing(), []);
  // Phase 4.5: global Option-held tracking, the multi-select delete action, and the hover-scoped
  // game-card/PDF-page-turn keyboard shortcuts — see wireCardShortcuts's own comment,
  // app/dotto/lib/cardShortcuts.ts, for why a single window.__getAppState readiness check is
  // enough here (no rail icon or DOM writes to defer past mount, unlike
  // wireProfileAchievementsPricing above).
  useEffect(() => wireCardShortcuts(), []);
  // Phase 4.5: the animated search-placeholder loop — see wireAiAssistantSuggestions's own
  // comment, app/dotto/lib/aiAssistantSuggestions.ts, for why this needs live appState right at
  // wire time (to read appState.searchInput) rather than a single readiness check.
  useEffect(() => wireAiAssistantSuggestions(), []);
  // Phase 4.1 cluster revisit (file #11/11, closes out the cluster): the selection toolbar's
  // document-level selectionchange/pointerdown listeners, the add-to-source popup's own
  // outside-click listener, and #search-input's slash-command/Enter keydown handling — see
  // wireSearchOrchestrationSelection's own comment for why this needs live appState right at wire
  // time too.
  useEffect(() => wireSearchOrchestrationSelection(), []);
  // Phase 4.5: the three list panels' shift+drag "paint select" listeners and the draw-settings
  // panel's click-stop-propagation — see wireHamburgerCollab's own comment,
  // app/dotto/lib/hamburgerCollab.ts, for why this needs window.__getDrawSettingsEl
  // (app/dotto/lib/coreState.ts) ready right at wire time.
  useEffect(() => wireHamburgerCollab(), []);
  // Phase 4.5: the collabPanel mouseleave listener, window.__pinOnInsideClick('collab', ...), the
  // AFK-activity listeners, and the initial resetAfkTimer() call — see wireFriendsPresence's own
  // comment, app/dotto/lib/friendsPresence.ts, for why this needs live appState right at wire time
  // rather than a single readiness check.
  useEffect(() => wireFriendsPresence(), []);
  // Phase 4.5: wires the Messages rail icon itself (window.__wireRailIcon,
  // app/dotto/lib/panelsHamburger.ts) — see wireMessagesSchedule's own comment,
  // app/dotto/lib/messagesSchedule.ts, for why this needs to poll for both window.__getAppState
  // AND window.__wireRailIcon rather than a single readiness check.
  useEffect(() => wireMessagesSchedule(), []);
  // Phase 4.1: the Extensions/Upload/Blocks wiring, all newly-portable leaf files — order among
  // these three doesn't matter (none depend on each other). Extensions/Blocks are real rail panels
  // (each polls for window.__getAppState AND window.__wireRailIcon, Blocks also
  // window.__getAddMenuEl/__getBtnAddEl, same multi-bridge poll shape
  // app/dotto/lib/profileAchievementsPricing.ts's own wireProfileAchievementsPricing established);
  // Upload is its own independent floating popup (see wireUploadPopup's own comment) and only
  // needs the single window.__getAppState readiness check.
  useEffect(() => wireExtensionsPanel(), []);
  useEffect(() => wireUploadPopup(), []);
  useEffect(() => wireBlocksPanel(), []);
  // Phase 4.1: the one-time app bootstrap sequence (load workspace, first render, center camera)
  // — deliberately the LAST wireX() call in this whole list, same "everything it calls must
  // already be wired up" ordering guarantee app-init.js's own original position in
  // dotto-script.js's import order relied on. See wireAppInit's own comment,
  // app/dotto/lib/appInit.ts.
  useEffect(() => wireAppInit(), []);

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
    </>
  );
}
