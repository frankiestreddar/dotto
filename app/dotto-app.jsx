"use client";

import Script from "next/script";
import { flushSync } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  achievementsStore,
  addToSourcePopupStore,
  canvasItemsStore,
  canvasResultsStore,
  collabListStore,
  dictionaryPanelStore,
  dotbotAnswerStore,
  examplesPanelStore,
  hubCollabListStore,
  imageResultStore,
  itemDetailFooterStore,
  libraryViewStore,
  marketDetailStore,
  marketDiscoverStore,
  msgListStore,
  notificationStore,
  pricingOverlayStore,
  profileLevelStore,
  recommendedSearchesStore,
  scheduleAgendaStore,
  searchSuggestionsStore,
  selectionToolbarStore,
  translationPanelStore,
  waypointsListStore,
} from "./dotto/bridges";
import AchievementsGrid from "./dotto/AchievementsGrid";
import AddToSourcePopup from "./dotto/AddToSourcePopup";
import CanvasItemsLayer from "./dotto/CanvasItemsLayer";
import CanvasResultsPanel from "./dotto/CanvasResultsPanel";
import CollabListPanel from "./dotto/CollabListPanel";
import DictionaryPanel from "./dotto/DictionaryPanel";
import DotbotAnswerPanel from "./dotto/DotbotAnswerPanel";
import ErrorBoundary from "./dotto/ErrorBoundary";
import ExamplesPanel from "./dotto/ExamplesPanel";
import HubCollabListPanel from "./dotto/HubCollabListPanel";
import ImageResultPanel from "./dotto/ImageResultPanel";
import ItemDetailFooter from "./dotto/ItemDetailFooter";
import LibraryPanel from "./dotto/LibraryPanel";
import MarketDetailPanel from "./dotto/MarketDetailPanel";
import MarketDiscoverPanel from "./dotto/MarketDiscoverPanel";
import MessagesListPanel from "./dotto/MessagesListPanel";
import NotificationBar from "./dotto/NotificationBar";
import PricingOverlay from "./dotto/PricingOverlay";
import ProfileAvatarSm from "./dotto/ProfileAvatarSm";
import ProfileIdentity from "./dotto/ProfileIdentity";
import ProfileLevelPill from "./dotto/ProfileLevelPill";
import RecommendedSearchesPanel from "./dotto/RecommendedSearchesPanel";
import ScheduleAgenda from "./dotto/ScheduleAgenda";
import SearchSuggestionsPanel from "./dotto/SearchSuggestionsPanel";
import SelectionToolbar from "./dotto/SelectionToolbar";
import TranslationPanel from "./dotto/TranslationPanel";
import WaypointsListPanel from "./dotto/WaypointsListPanel";

import TopBar from "./dotto/sections/TopBar";
import ProfilePanel from "./dotto/sections/ProfilePanel";
import MessagesPanel from "./dotto/sections/MessagesPanel";
import CollaboratorsPanel from "./dotto/sections/CollaboratorsPanel";
import SharedCanvasModal from "./dotto/sections/SharedCanvasModal";
import MarketplacePanel from "./dotto/sections/MarketplacePanel";
import HamburgerMenu from "./dotto/sections/HamburgerMenu";
import CanvasArea from "./dotto/sections/CanvasArea";
import BottomToolbars from "./dotto/sections/BottomToolbars";
import ZoomControl from "./dotto/sections/ZoomControl";
import AddMenu from "./dotto/sections/AddMenu";
import SourceAddMenu from "./dotto/sections/SourceAddMenu";
import CellTagPicker from "./dotto/sections/CellTagPicker";
import AudioRecordIndicator from "./dotto/sections/AudioRecordIndicator";
import DrawSettingsBar from "./dotto/sections/DrawSettingsBar";
import ItemContextMenu from "./dotto/sections/ItemContextMenu";
import CanvasContextMenu from "./dotto/sections/CanvasContextMenu";
import Footer from "./dotto/sections/Footer";

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
  // rebuild. Unlike the two stores above, this one MUST commit synchronously: at least one caller
  // (drag-drop-chat.js's alt-duplicate-drag) does `render(); document.getElementById('item-'+id)`
  // immediately afterward and depends on that node already existing. A plain store.set(...) here
  // would only schedule the update (React 18+ batches/defers updates triggered outside of React's
  // own event handlers to a microtask), so this wraps it in flushSync to force the commit — and,
  // since each CanvasItem's own body-building happens in a useLayoutEffect (synchronous, pre-paint),
  // flushSync flushes that too, before this function returns.
  window.__renderCanvasItems = (items) => flushSync(() => canvasItemsStore.set(items));
  // Notifications core engine (see app/dotto/NotificationBar.jsx, public/dotto/stopwatch-search-
  // notifications.js's showNotification) — a plain store.set is fine here, unlike
  // __renderCanvasItems: nothing reads the notification bar's DOM synchronously right after
  // calling pushNotification (confirmed by grep — the only readers of notifTextEl/notifImageEl/
  // notifActionBtn were the notification functions themselves, now replaced by this).
  window.__setNotificationContent = notificationStore.set;
  // Schedule View Mode's agenda (see app/dotto/ScheduleAgenda.jsx, public/dotto/messages-
  // schedule.js's renderScheduleAgenda) — a plain store.set, same reasoning as
  // __setNotificationContent: nothing reads #schedule-view-hours/#schedule-view-stack's DOM
  // synchronously right after calling renderScheduleAgenda.
  window.__setScheduleAgenda = scheduleAgendaStore.set;
  // Search-dropdown result panels (see app/dotto/TranslationPanel.jsx and friends,
  // public/dotto/mnemonic-search-matching.js). Unlike __setNotificationContent/__setScheduleAgenda
  // above, these DO need flushSync — updateSearchDropdown (ai-assistant-suggestions.js) reads
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
  // #search-results/#search-suggestions (see app/dotto/CanvasResultsPanel.jsx/
  // SearchSuggestionsPanel.jsx) — same flushSync reasoning as the six above. __setCanvasResults
  // specifically also needs it for a second reason: it's a real portal (see canvasResultsStore's
  // own comment in bridges.js), and the existing keyboard-nav code
  // (search-orchestration-selection.js) reads its rows via querySelectorAll synchronously on
  // every arrow/digit/Enter keypress.
  window.__setCanvasResults = (state) => flushSync(() => canvasResultsStore.set(state));
  window.__setSearchSuggestions = (state) => flushSync(() => searchSuggestionsStore.set(state));
  // Add-to-source popup (see app/dotto/AddToSourcePopup.jsx, addToSourcePopupStore) — MUST be
  // flushSync: openAddToSourcePopup (search-orchestration-selection.js) calls
  // renderAddToSourcePopup immediately after this, which looks the div up by id and needs it to
  // already exist in the DOM.
  window.__setAddToSourcePopupOpen = (state) => flushSync(() => addToSourcePopupStore.set(state));
  // Hamburger menu's Waypoints panel (see app/dotto/WaypointsListPanel.jsx,
  // hamburger-collab.js's renderWaypointsList) — a plain store.set, not flushSync'd: the fetch
  // it follows is async (a real network round-trip), so there's no synchronous DOM read racing
  // this the way there was for the search panels.
  window.__setWaypointsList = waypointsListStore.set;
  // Hamburger menu's Collaborations panel (see app/dotto/HubCollabListPanel.jsx,
  // hamburger-collab.js's renderHubCollabList/renderHubCollabRequests) — same reasoning as
  // __setWaypointsList: both entry points are real async Supabase calls.
  window.__setHubCollabList = hubCollabListStore.set;
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
  // Library tab's list content (see app/dotto/LibraryPanel.jsx, marketplace.js's renderLibrary) —
  // a plain store.set, no synchronous DOM read follows it.
  window.__setLibraryView = libraryViewStore.set;
  // Item Detail view's footer button set (see app/dotto/ItemDetailFooter.jsx, library-publish.js's
  // renderItemDetailFooter) — a plain store.set, no synchronous DOM read follows it.
  window.__setItemDetailFooter = itemDetailFooterStore.set;
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

  return (
    <>
      <div id="dotto-root">
        <ErrorBoundary name="TopBar"><TopBar html={sections["top-bar"]} /></ErrorBoundary>
        <ErrorBoundary name="ProfilePanel"><ProfilePanel html={sections["profile-panel"]} /></ErrorBoundary>
        <ErrorBoundary name="MessagesPanel"><MessagesPanel html={sections["messages-panel"]} /></ErrorBoundary>
        <ErrorBoundary name="CollaboratorsPanel"><CollaboratorsPanel html={sections["collab-panel"]} /></ErrorBoundary>
        <ErrorBoundary name="SharedCanvasModal"><SharedCanvasModal html={sections["canvas-modal"]} /></ErrorBoundary>
        <ErrorBoundary name="MarketplacePanel"><MarketplacePanel html={sections["cart-panel"]} /></ErrorBoundary>
        <ErrorBoundary name="HamburgerMenu"><HamburgerMenu html={sections["hamburger-stack"]} /></ErrorBoundary>
        <ErrorBoundary name="CanvasArea"><CanvasArea html={sections["canvas-area"]} /></ErrorBoundary>
        <ErrorBoundary name="BottomToolbars"><BottomToolbars html={sections["bottom-toolbars"]} /></ErrorBoundary>
        <ErrorBoundary name="ZoomControl"><ZoomControl html={sections["zoom-control"]} /></ErrorBoundary>
        <ErrorBoundary name="AddMenu"><AddMenu html={sections["add-menu"]} /></ErrorBoundary>
        <ErrorBoundary name="SourceAddMenu"><SourceAddMenu html={sections["source-add-menu"]} /></ErrorBoundary>
        <ErrorBoundary name="CellTagPicker"><CellTagPicker html={sections["cell-tag-picker"]} /></ErrorBoundary>
        <ErrorBoundary name="AudioRecordIndicator"><AudioRecordIndicator html={sections["audio-record-indicator"]} /></ErrorBoundary>
        <ErrorBoundary name="DrawSettingsBar"><DrawSettingsBar html={sections["draw-settings"]} /></ErrorBoundary>
        <ErrorBoundary name="ItemContextMenu"><ItemContextMenu html={sections["context-menu"]} /></ErrorBoundary>
        <ErrorBoundary name="CanvasContextMenu"><CanvasContextMenu html={sections["canvas-context-menu"]} /></ErrorBoundary>
        <ErrorBoundary name="Footer"><Footer html={sections["footer"]} /></ErrorBoundary>
      </div>
      <ErrorBoundary name="PricingOverlay"><PricingOverlay /></ErrorBoundary>
      <ErrorBoundary name="SelectionToolbar"><SelectionToolbar /></ErrorBoundary>
      <ErrorBoundary name="CanvasItemsLayer"><CanvasItemsLayer /></ErrorBoundary>
      <ErrorBoundary name="NotificationBar"><NotificationBar /></ErrorBoundary>
      <ErrorBoundary name="ScheduleAgenda"><ScheduleAgenda /></ErrorBoundary>
      <ErrorBoundary name="TranslationPanel"><TranslationPanel /></ErrorBoundary>
      <ErrorBoundary name="DictionaryPanel"><DictionaryPanel /></ErrorBoundary>
      <ErrorBoundary name="ExamplesPanel"><ExamplesPanel /></ErrorBoundary>
      <ErrorBoundary name="RecommendedSearchesPanel"><RecommendedSearchesPanel /></ErrorBoundary>
      <ErrorBoundary name="DotbotAnswerPanel"><DotbotAnswerPanel /></ErrorBoundary>
      <ErrorBoundary name="ImageResultPanel"><ImageResultPanel /></ErrorBoundary>
      <ErrorBoundary name="CanvasResultsPanel"><CanvasResultsPanel /></ErrorBoundary>
      <ErrorBoundary name="SearchSuggestionsPanel"><SearchSuggestionsPanel /></ErrorBoundary>
      <ErrorBoundary name="AddToSourcePopup"><AddToSourcePopup /></ErrorBoundary>
      <ErrorBoundary name="WaypointsListPanel"><WaypointsListPanel /></ErrorBoundary>
      <ErrorBoundary name="HubCollabListPanel"><HubCollabListPanel /></ErrorBoundary>
      <ErrorBoundary name="MessagesListPanel"><MessagesListPanel /></ErrorBoundary>
      <ErrorBoundary name="CollabListPanel"><CollabListPanel /></ErrorBoundary>
      <ErrorBoundary name="MarketDiscoverPanel"><MarketDiscoverPanel /></ErrorBoundary>
      <ErrorBoundary name="MarketDetailPanel"><MarketDetailPanel /></ErrorBoundary>
      <ErrorBoundary name="LibraryPanel"><LibraryPanel /></ErrorBoundary>
      <ErrorBoundary name="ItemDetailFooter"><ItemDetailFooter /></ErrorBoundary>
      <ErrorBoundary name="ProfileLevelPill"><ProfileLevelPill /></ErrorBoundary>
      <ErrorBoundary name="ProfileIdentity"><ProfileIdentity /></ErrorBoundary>
      <ErrorBoundary name="ProfileAvatarSm"><ProfileAvatarSm /></ErrorBoundary>
      <ErrorBoundary name="AchievementsGrid"><AchievementsGrid /></ErrorBoundary>
      <Script src="/dotto-script.js" type="module" strategy="afterInteractive" />
    </>
  );
}
