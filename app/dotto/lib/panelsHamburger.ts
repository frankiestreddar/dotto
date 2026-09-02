// Phase 4.5 port of public/dotto/panels-hamburger.js: the permanent rail's shared open/close
// contract (one sliding #hamburger-stack shell, many trigger icons) plus the hover/pin panel
// helper used by the add-menu and per-canvas collaborator flyout. All 12 real callers are still
// vanilla today (no React component reaches this file yet — see PHASE4_ROADMAP.md's own note on
// why no usePanelState hook/context was invented here despite the original plan anticipating one:
// nothing currently needs it, and this migration's own discipline throughout has been "port what's
// actually needed," not speculative future shape). Reaches every still-vanilla dependency through
// window bridges; wires its real, module-load-time-only rail-icon click listeners (against
// already-existing DOM elements) via wirePanelsHamburger(), using the same bridge-readiness poll
// established by every other Phase 4.4/4.5 wireX() port.

interface AppState {
  panelPinned: Record<string, boolean>;
  railViewEls: (HTMLElement | undefined)[];
  railIconBtns: (HTMLElement | undefined)[];
  hamburgerStack: HTMLElement;
  collabPanel: HTMLElement;
  sourceAddMenu: HTMLElement;
  searchDropdown?: HTMLElement;
  searchChatThread?: HTMLElement;
  activeRailView: string | null;
  hubCollabView: string;
  btnInbox: HTMLElement;
  inboxPanel: HTMLElement;
  btnSearch: HTMLElement;
  searchPanel: HTMLElement;
  btnSources: HTMLElement;
  sourcesPanel: HTMLElement;
  btnSnippets: HTMLElement;
  snippetsPanel: HTMLElement;
  btnSnippets2: HTMLElement;
  snippets2Panel: HTMLElement;
  btnServers: HTMLElement;
  serversPanel: HTMLElement;
  railBtnAi: HTMLElement;
  aiPanel: HTMLElement;
  hamburgerBtn: HTMLElement;
  outlineMenu: HTMLElement;
  railBtnWaypoints: HTMLElement;
  waypointsPanel: HTMLElement;
  railBtnCollab: HTMLElement;
  hubCollabPanel: HTMLElement;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

// ---------- Hover/Pin Panel Helper ----------
// Used by the add-menu and the per-canvas collaborator flyout ('add'/'collab' — see
// app/dotto/lib/copyPaste.ts/friends-presence.js): hovering the trigger opens them temporarily
// (closing again once the pointer leaves both the button and the panel), while clicking pins the
// panel open until the user clicks elsewhere. The permanent rail (below) no longer uses this at
// all — every rail icon is click-only now, so there's nothing for it to hover-close.
export function scheduleHoverClose(
  name: string,
  hoverEls: (HTMLElement | undefined | null)[],
  closeFn: () => void,
): void {
  setTimeout(() => {
    const appState = getAppState();
    if (!appState || appState.panelPinned[name]) return;
    const stillOver = hoverEls.some((el) => el && el.matches(":hover"));
    if (!stillOver) closeFn();
  }, 80);
}
// A panel that only opened via hover (never pinned by clicking its trigger button) still closes as
// soon as the pointer leaves it — but clicking ANYTHING inside it promotes it to pinned right then,
// same as if the trigger button itself had been clicked, so it now stays open until an outside
// click/Escape instead of closing on mouseleave. Capture phase so this fires before whatever the
// click itself does (including a handler that closes the panel, e.g. a menu action — pinning a
// panel the same tick it closes is harmless). Not wired up for #add-menu/#source-add-menu, which
// are getting different, separate treatment.
export function pinOnInsideClick(name: string, els: (HTMLElement | undefined | null)[]): void {
  els.forEach((el) => {
    if (!el) return;
    el.addEventListener(
      "click",
      () => {
        const appState = getAppState();
        if (appState) appState.panelPinned[name] = true;
      },
      true,
    );
  });
}
// 'rail' covers every panel-style rail icon (see openRailView below) — Marketplace/Messages/Add/
// Profile/the hamburger outline used to each have their own except-key here ('cart'/'messages'/
// 'add'/'profile'/'menu'); now that they all share one shell there's only one to skip.
export function closeAllPanels(except?: string): void {
  if (except !== "rail") closeRailView();
  if (except !== "collab") window.__closeCollabPanel?.();
  if (except !== "sourceAdd") window.__closeSourceAddMenu?.();
}
// Any panel that owns its own keyboard input while open — same set closeAllPanels() knows about,
// plus the search dropdown — should win over any OTHER global single-key shortcut (game-card
// shortcuts in card-shortcuts.js, the Space/"/"/m/n shortcuts in app/dotto/lib/srsConnectionsCore.ts) even when
// nothing inside that panel happens to be focused yet. Without this, typing a normal sentence while
// e.g. the Waypoints panel is open (cursor resting on the panel, no input actually clicked into)
// would silently do nothing for most letters, then hijack focus to the AI search box the instant a
// space or "/" was typed — reading as "if you start typing, it starts inputting in the text box."
// Outline/Waypoints/Collaborations/Marketplace/Library/Messages/Add/Profile all share one rail
// shell now (see appState.railViewEls, app/dotto/lib/coreState.ts) — checking the whole list covers all of them
// in one go instead of naming each one individually.
export function isAnyUiPanelOpen(): boolean {
  const appState = getAppState();
  if (!appState) return false;
  return (
    appState.railViewEls.some((el) => el && el.classList.contains("open")) ||
    appState.collabPanel.classList.contains("open") ||
    appState.sourceAddMenu.style.display === "flex" ||
    !!(appState.searchDropdown && appState.searchDropdown.classList.contains("visible")) ||
    !!(appState.searchChatThread && appState.searchChatThread.classList.contains("visible"))
  );
}

// ---------- Permanent rail: one shared sliding shell, many trigger icons ----------
// Every panel-style rail icon (outline, Waypoints, Collaborations, Marketplace, Library, Messages,
// Profile, AI search) shares ONE #hamburger-stack shell and ONE pinned state
// (appState.panelPinned.rail) — opening any of them closes whichever other one was showing, for
// free, just by hiding every other railViewEls sibling and un-.active-ing every other
// railIconBtns entry. Click-only — hovering a rail icon does nothing; only a real click opens,
// switches, or (clicking the already-active icon again) closes a panel. `onOpen` is that view's
// own refresh call (renderWaypointsList, buildOutline, refreshAiPanel, etc.), called every time so
// content is never stale.
// resetAiSearchState (ai-assistant-suggestions.js) is called here specifically when the AI view is
// the one being navigated AWAY from (activeRailView was 'ai', the new key isn't) — opening AI
// itself, or re-clicking it while it's already active, must never reset an in-progress
// conversation. Checked BEFORE activeRailView is reassigned below, since the check needs the OLD
// value.
let railCloseTimeoutId: ReturnType<typeof setTimeout> | null = null;
export function openRailView(
  key: string,
  viewEl: HTMLElement,
  btn: HTMLElement,
  onOpen?: ((pin?: boolean) => void) | null,
  pin?: boolean,
): void {
  const appState = getAppState();
  if (!appState) return;
  window.__clearListPanelSelection?.();
  if (railCloseTimeoutId) clearTimeout(railCloseTimeoutId);
  if (appState.activeRailView === "ai" && key !== "ai") window.__resetAiSearchState?.();
  // 'closing' is removed here too, not just 'open' — in case this same view was still mid fade-out
  // (see closeRailView below) when it (or another icon) got clicked again; without this it would
  // stay stuck at opacity:0 despite being freshly reopened.
  appState.railViewEls.forEach((el) => {
    if (el && el !== viewEl) el.classList.remove("open", "closing");
  });
  appState.railIconBtns.forEach((b) => {
    if (b && b !== btn) b.classList.remove("active");
  });
  viewEl.classList.remove("closing");
  viewEl.classList.add("open");
  btn.classList.add("active");
  appState.hamburgerStack.classList.add("open");
  appState.activeRailView = key;
  if (onOpen) onOpen(pin);
  if (pin) appState.panelPinned.rail = true;
}
// Same resetAiSearchState reasoning as openRailView above, for the "close the rail entirely"
// direction (Escape, clicking outside, etc.) — if AI was the view showing, reset it; checked before
// activeRailView is cleared below.
// The shell itself (#hamburger-stack) slides away over .3s (see its own `left` transition,
// globals.css) the instant 'open' is removed below — but the view el's OWN display:none (see
// .hmenu-panel/.hub-subpanel) would normally apply in that same synchronous tick, making the
// content vanish instantly instead of sliding away with the shell. 'closing' (opacity transition,
// same .3s duration — see globals.css) keeps it visible and fading for exactly as long as the
// slide takes, then 'open'/'closing' are both dropped together so display:none applies only once
// the fade has actually finished.
export function closeRailView(): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.activeRailView === "ai") window.__resetAiSearchState?.();
  if (railCloseTimeoutId) clearTimeout(railCloseTimeoutId);
  const closingEls = appState.railViewEls.filter(
    (el): el is HTMLElement => !!el && el.classList.contains("open"),
  );
  closingEls.forEach((el) => el.classList.add("closing"));
  appState.railIconBtns.forEach((b) => b && b.classList.remove("active"));
  appState.hamburgerStack.classList.remove("open");
  appState.activeRailView = null;
  appState.panelPinned.rail = false;
  window.__clearListPanelSelection?.();
  railCloseTimeoutId = setTimeout(() => {
    closingEls.forEach((el) => el.classList.remove("open", "closing"));
  }, 300);
}
// Wires one rail icon's click-only open/switch/close — the same listener every trigger button in
// the app already used individually before this (compare the old per-panel wiring that used to
// live in marketplace.js/messages-schedule.js/profile-achievements-pricing.js), now written once
// instead of duplicated per file. No mouseenter/mouseleave — hovering a rail icon previews/
// switches nothing regardless of whether some other panel is already open or not (a
// hover-switches-panels version of this was tried and explicitly reverted); only a click ever
// opens, switches, or closes a panel. The one thing that DOES change while a panel is open is the
// tooltip, suppressed via body:has(#hamburger-stack.open) in globals.css — that part is
// deliberate and stays.
export function wireRailIcon(
  key: string,
  btn: HTMLElement,
  viewEl: HTMLElement,
  onOpen?: ((pin?: boolean) => void) | null,
): void {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const appState = getAppState();
    if (appState?.activeRailView === key) {
      closeRailView();
      // Closing removes .active, which immediately re-satisfies .rail-tooltip's own
      // :not(.active):hover CSS rule (globals.css) — without this, the tooltip would pop up right
      // away as a side effect of the click, even though the pointer never actually left the
      // button and re-hovered it. .tooltip-hold-hidden overrides that rule back to hidden (see
      // its own comment, globals.css) until a real pointerleave below actually happens, per
      // explicit bug report.
      btn.classList.add("tooltip-hold-hidden");
    } else {
      openRailView(key, viewEl, btn, onOpen, true);
    }
  });
  btn.addEventListener("pointerleave", () => btn.classList.remove("tooltip-hold-hidden"));
}

// Real inline oninput targets (content/fragments/hamburger-stack.html) — plain globals, no
// underscore, same shape window.pushNotification/window.handleMarketplaceSearch use.
export function handleWaypointsSearch(v: string): void {
  window.__renderWaypointsList?.(v);
}
export function handleHubCollabSearch(v: string): void {
  window.__renderHubCollabList?.(v);
}
export function handleSourcesSearch(v: string): void {
  window.__renderSourcesList?.(v);
}
export function handleFilesSearch(v: string): void {
  window.__renderFilesList?.(v);
}

function doWire(appState: AppState): void {
  appState.hamburgerStack.addEventListener("click", (e) => e.stopPropagation());

  // refreshAiPanel is reached via window.__refreshAiPanel — wired here, alongside every other rail
  // icon, rather than ai-assistant-suggestions.js calling wireRailIcon on itself. That circular-
  // import concern (this file and ai-assistant-suggestions.js each importing from the other at
  // their own module top level) is what originally justified the indirection back when both were
  // vanilla ES modules; now that this file reaches it through a bridge instead, the historical
  // reasoning no longer strictly applies — kept as-is anyway, since centralizing every rail icon's
  // wiring here (rather than each panel's own file wiring itself) is a real, independently good
  // convention this migration hasn't had a reason to revisit.
  // #inbox-panel/#search-panel/#snippets2-panel have no content/refresh logic of their own yet
  // (see their own comments, hamburger-stack.html) — no onOpen callback needed until that's
  // designed. #snippets-panel (Files) is no longer one of these — see renderFilesList's own
  // comment, hamburger-collab.js.
  wireRailIcon("inbox", appState.btnInbox, appState.inboxPanel, null);
  wireRailIcon("search", appState.btnSearch, appState.searchPanel, null);
  wireRailIcon("sources", appState.btnSources, appState.sourcesPanel, () =>
    window.__renderSourcesList?.(""),
  );
  wireRailIcon("snippets", appState.btnSnippets, appState.snippetsPanel, () =>
    window.__renderFilesList?.(""),
  );
  wireRailIcon("snippets2", appState.btnSnippets2, appState.snippets2Panel, null);
  wireRailIcon("servers", appState.btnServers, appState.serversPanel, null);
  wireRailIcon("ai", appState.railBtnAi, appState.aiPanel, () => window.__refreshAiPanel?.());
  wireRailIcon("outline", appState.hamburgerBtn, appState.outlineMenu, () =>
    window.__buildOutline?.(),
  );
  wireRailIcon("waypoints", appState.railBtnWaypoints, appState.waypointsPanel, () =>
    window.__renderWaypointsList?.(""),
  );
  wireRailIcon("collab", appState.railBtnCollab, appState.hubCollabPanel, () => {
    appState.hubCollabView = "main";
    window.__renderHubCollabList?.("");
  });
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — this needs live appState AND
// every rail-icon DOM element already existing at wire time, same reasoning as
// wireDayChangeAndAdNotifications/wireSourceButtonsCursorMode's own comments: a single readiness
// check isn't enough since window.__getAppState is set by the vanilla afterInteractive <Script>
// bundle, which can genuinely resolve after React's own mount.
export function wirePanelsHamburger(): () => void {
  const ready = getAppState();
  if (ready) {
    doWire(ready);
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    const appState = getAppState();
    if (appState) {
      clearInterval(poll);
      doWire(appState);
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// Vanilla -> React bridges — blocks-panel.js/ai-assistant-suggestions.js/card-shortcuts.js/
// extensions-panel.js/history-autosave.js/hamburger-collab.js/friends-presence.js/messages-
// schedule.js/profile-achievements-pricing.js/source-tags-ai.js/srs-connections-core.js all
// previously imported these directly. __closeRailView/__wireRailIcon/__openRailView/
// __closeAllPanels were already established bridges (set here now instead of from this file's own
// vanilla original) — used by app/dotto/lib/copyPaste.ts/marketplace.ts/sourceButtonsCursorMode.ts.
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__closeRailView = closeRailView;
  window.__wireRailIcon = wireRailIcon;
  window.__openRailView = openRailView;
  window.__closeAllPanels = closeAllPanels;
  window.__isAnyUiPanelOpen = isAnyUiPanelOpen;
  window.__scheduleHoverClose = scheduleHoverClose;
  window.__pinOnInsideClick = pinOnInsideClick;
  // Plain (non-`__`) globals — real inline oninput targets (content/fragments/hamburger-stack.html),
  // same shape window.pushNotification/window.handleMarketplaceSearch use.
  window.handleFilesSearch = handleFilesSearch;
  window.handleHubCollabSearch = handleHubCollabSearch;
  window.handleSourcesSearch = handleSourcesSearch;
  window.handleWaypointsSearch = handleWaypointsSearch;
}
