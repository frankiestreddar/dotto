// Phase 4.5 port of public/dotto/core-state.js — the appState singleton itself, deliberately
// ported last (per the migration plan's own reasoning: "everything reads it"). Every bridge this
// file needs to expose already existed before this port even started: 5 earlier Phase 4.4/4.5
// ports (canvasPresence.ts, historyAutosave.ts, srsConnectionsCore.ts, waypointsRenderLoop.ts,
// sourceButtonsCursorMode.ts) each needed to reach into core-state.js's internals and established
// window.__getAppState/__getCanvasEl/__getWorldEl/__switchActivePane/etc proactively — this port's
// own job is almost entirely "actually implement what those getters already promised," not
// designing new surface area.
//
// Genuinely different from every other Phase 4.4/4.5 port in one specific way: this can NOT be a
// plain module-load-time side-effect import (the pattern outlineTree.ts/shelfSearch.ts/
// waypointsRenderLoop.ts/etc all use), because appState.currentUser depends on
// window.__DOTTO_USER__, which dotto-app.jsx deliberately sets INSIDE DottoApp's own render body
// (not at module eval, not in an effect — see that file's own comment on why: dotto-script.js's
// afterInteractive <Script> tag needs it ready before that script runs, and setting it during
// render, not after paint, is what guarantees that ordering) — module evaluation always completes
// BEFORE the first render call, so a plain side-effect import here would run too early and
// construct appState.currentUser from the guest fallback every time, even for a real logged-in
// user. Instead this exports ensureCoreState(), called from DottoApp's own render body immediately
// after window.__DOTTO_USER__ is set (same synchronous timing), idempotent (safe to call on every
// re-render — only the first call actually does anything).
//
// No wireX()/bridge-readiness-poll needed either, unlike most Phase 4.4/4.5 ports with real DOM
// wiring — ensureCoreState() runs synchronously during render, well before any other file's own
// wireX() poll could possibly find these bridges missing, so there's no gap to poll across.

interface PaneState {
  currentFolderId?: string;
  [key: string]: unknown;
}

// appState's own shape is intentionally left loosely typed (a plain Record, not a hand-written
// 100+-field interface) — this file is appState's sole owner/constructor, not a consumer reaching
// into a handful of fields the way every other port's own local AppState interface does; every
// other port already treats window.__getAppState()'s return value as a loosely-typed
// Record<string, unknown>, so a fully precise type here would buy nothing external code could see
// anyway. `strict: false` (tsconfig) means the many `document.getElementById(...)` assignments
// below don't need individual null-checks/assertions.
type AppStateShape = Record<string, any>;

let canvas: HTMLElement | undefined;
let world: HTMLElement | undefined;
let dotLayer: HTMLElement | undefined;
let cursorOverlay: HTMLElement | undefined;
let btnAdd: HTMLElement | undefined;
let addMenu: HTMLElement | undefined;
let contextMenu: HTMLElement | undefined;
let zoomTrack: HTMLElement | undefined;
let zoomFill: HTMLElement | undefined;
let zoomThumb: HTMLElement | undefined;
let zoomControl: HTMLElement | undefined;
let drawSettings: HTMLElement | undefined;
let drawColorInput: HTMLInputElement | undefined;
let drawFrontBtn: HTMLElement | undefined;
let drawBackBtn: HTMLElement | undefined;
let drawPenBtn: HTMLElement | undefined;
let drawEraserBtn: HTMLElement | undefined;
let drawSizeInput: HTMLInputElement | undefined;
let canvasContextMenu: HTMLElement | undefined;
let appState: AppStateShape;

// ---------- Pure helpers (safe to declare at module scope — they only touch DOM/appState when
// CALLED, not when defined, so none of this needs the ensureCoreState() guard below) ----------

function effectiveMode(): string {
  if (appState.modeOverrideKey === "shift") return "select";
  if (appState.modeOverrideKey === "d") return "data";
  if (appState.modeOverrideKey === "escape") return "normal";
  return appState.cardMode;
}
function bringCardToFront(it: AppStateShape | undefined, el?: HTMLElement | null): void {
  if (!it) return;
  appState.topCardZIndex++;
  it.zIndex = appState.topCardZIndex;
  if (el) el.style.zIndex = String(appState.topCardZIndex);
}
// Every card's zIndex is persisted with the workspace, but topCardZIndex itself always restarts at
// its hardcoded default above on a fresh page load — so without this, a card that reached e.g.
// zIndex 87 in a past session would still outrank anything freshly clicked this session until the
// new session's counter happened to climb back past 87 on its own. Called right after `folders` is
// populated from persisted/remote data (see loadWorkspace) so "click brings to front" is
// guaranteed to actually mean "in front of literally everything," not just everything clicked so
// far this session.
function recomputeTopCardZIndex(): void {
  let max = appState.topCardZIndex;
  Object.values(appState.folders).forEach((f) => {
    ((f as AppStateShape)?.items || []).forEach((it: AppStateShape) => {
      if (typeof it.zIndex === "number" && it.zIndex > max) max = it.zIndex;
    });
  });
  appState.topCardZIndex = max;
}

// Every appState field whose value genuinely belongs to "whichever specific pane you're looking
// at" — camera position, which folder/tabs it's navigated to, its own back/forward history, and
// its own selection/cursor-mode — as opposed to app-wide chrome/settings/data that's the same no
// matter which pane is active. Deliberately does NOT include transient, actively-in-progress
// interaction state (context menus, an in-progress pen stroke or media recording, an open tag
// picker, currentEditingEl) — those are momentary and naturally resolve themselves (blur,
// pointerup) the same way switching windows/apps mid-gesture would in any other app, rather than
// needing to be preserved across a pane switch.
const PANE_SCOPED_FIELDS = [
  "tx",
  "ty",
  "scale",
  "currentFolderId",
  "historyStack",
  "historyIndex",
  "tabs",
  "activeTabId",
  "nextTabId",
  "selectedCardIds",
  "cardMode",
  "modeOverrideKey",
  "modeKeyHoldStart",
  "dataLinkPendingId",
  // smoothPanTo (historyAutosave.ts) clears this specific pending timeout at the top of every call
  // before scheduling its own, so it has to track whichever PANE'S tween is in flight, not a
  // single global handle shared by every pane.
  "cameraTweenTimeout",
  // Gates canvasPresence.ts's throttled broadcasters (cursor position, dragged-item
  // position/resize, caret position) to at most one send per ~50ms — a throttle window only ever
  // needs to track "whichever pane you're actively pointer-interacting with right now," which
  // swap-in-place already models exactly.
  "cursorBroadcastThrottleId",
  "itemDragBroadcastThrottleId",
  "itemResizeBroadcastThrottleId",
  "caretBroadcastThrottleId",
];
// Swap-in-place pane switching. Copies the CURRENTLY active pane's live PANE_SCOPED_FIELDS values
// out into its own saved slot in appState.panes, then — if the target pane already has a saved
// slot (i.e. it's a real pre-existing pane, not a brand-new one) — copies that pane's saved values
// into the live appState.<field> slots so every existing reader/writer across the app
// (appState.tx, appState.selectedCardIds, etc.) transparently sees the newly-active pane's own
// state with zero changes to those call sites. A brand-new target pane (no saved slot yet) is left
// with whatever the live fields already hold — its caller (splitPaneWithTab) is responsible for
// resetting them to fresh defaults right after, not this function's job.
function switchActivePane(paneId: number): void {
  if (paneId === appState.activePaneId) return;
  const outgoing =
    appState.panes[appState.activePaneId] || (appState.panes[appState.activePaneId] = {});
  PANE_SCOPED_FIELDS.forEach((f) => {
    outgoing[f] = appState[f];
  });
  outgoing.canvas = canvas;
  outgoing.world = world;
  outgoing.dotLayer = dotLayer;
  outgoing.cursorOverlay = cursorOverlay;

  const incoming = appState.panes[paneId];
  if (incoming) {
    PANE_SCOPED_FIELDS.forEach((f) => {
      appState[f] = incoming[f];
    });
    canvas = incoming.canvas;
    world = incoming.world;
    dotLayer = incoming.dotLayer;
    cursorOverlay = incoming.cursorOverlay;
  }
  // The pane that was just switched TO is the one whose values are now live — it has no saved
  // slot of its own while active.
  delete appState.panes[paneId];
  appState.activePaneId = paneId;

  // Push the newly-active pane's own tabs/activeTabId into React (TabsBar.jsx) immediately —
  // without this, clicking into an already-existing OTHER pane (not one just created by
  // splitPaneWithTab, which already gets a render() of its own via initializeNewPane) left the tab
  // bar showing whichever pane's tabs it last rendered until something UNRELATED happened to call
  // render() afterward.
  window.__renderTabsPanel?.();
  // Same reasoning, split-screen Stage 8 — the newly-active pane's own back/forward buttons and
  // collaborator bubble (PaneTopBar.jsx) shouldn't have to wait for the next render() frame to
  // reflect its own historyIndex/currentFolderId either.
  window.__renderNavArrows?.();
  window.__renderCollabPill?.();
  // Lets PaneZoomBar.jsx react to which pane is active.
  window.__setActivePaneId?.(paneId);
  window.__renderMediaViewerZoom?.(paneId);
}

// Canvas-LEVEL (not item-level) event listeners — wheel pan/zoom, box-selection pointerdown,
// context menu, pen-polyline finish, paste-preview tracking, cursor-broadcast pointermove,
// panel-resize recalc — are each attached exactly ONCE, at their owning file's own wire-time,
// directly to whichever DOM node `canvas` happened to be AT THAT MOMENT (pane 0's element, the
// only one that exists at boot). Reassigning the `canvas`/`world` bindings later
// (switchActivePane/initializeNewPane) does NOT move these listeners — addEventListener binds to a
// specific node reference, not a variable — so a brand-new pane's own canvas element never gets
// any of them unless something explicitly re-attaches them to it. Each owning file registers its
// own "attach my canvas-level listener(s) to a given canvas element" function here via
// registerPaneCanvasListenerSetup. setupPaneCanvasListeners(paneId), called from
// initializeNewPane/restorePaneState, then runs every registered setup against that pane's own
// canvas element, so every new pane picks up the full set automatically without each
// pane-creation call site needing its own list.
const paneCanvasListenerSetups: ((canvasEl: HTMLElement, paneId: number) => void)[] = [];
function registerPaneCanvasListenerSetup(
  fn: (canvasEl: HTMLElement, paneId: number) => void,
): void {
  paneCanvasListenerSetups.push(fn);
}
function setupPaneCanvasListeners(paneId: number): void {
  const canvasEl = document.getElementById(paneElId("canvas", paneId));
  if (!canvasEl) return;
  paneCanvasListenerSetups.forEach((fn) => fn(canvasEl, paneId));
}

// Finishes bringing a BRAND-NEW pane (one switchActivePane just made active but that had no saved
// slot, so its live fields/DOM refs are still whatever the PREVIOUS pane's were) up to a real,
// independent starting state: resolves and assigns this pane's own DOM refs and resets every
// PANE_SCOPED_FIELDS entry to a fresh default — matching "the new pane gets its own
// camera/selection state from scratch," not a copy of whichever pane it split off from. Must be
// called AFTER switchActivePane(paneId) has already made this pane active and after that pane's
// own DOM (PaneCanvasArea.jsx) has actually mounted.
function initializeNewPane(paneId: number, folderId = "root"): void {
  canvas = document.getElementById(paneElId("canvas", paneId)) || undefined;
  world = document.getElementById(paneElId("world", paneId)) || undefined;
  dotLayer = document.getElementById(paneElId("dot-layer", paneId)) || undefined;
  cursorOverlay = document.getElementById(paneElId("cursor-overlay", paneId)) || undefined;
  appState.tx = 0;
  appState.ty = 0;
  appState.scale = 1;
  appState.currentFolderId = folderId;
  appState.historyStack = [folderId];
  appState.historyIndex = 0;
  appState.tabs = [{ id: "tab-0", folderId }];
  appState.activeTabId = "tab-0";
  appState.nextTabId = 1;
  appState.selectedCardIds = [];
  appState.cardMode = "normal";
  appState.modeOverrideKey = null;
  appState.modeKeyHoldStart = null;
  appState.dataLinkPendingId = null;
  appState.cameraTweenTimeout = null;
  appState.cursorBroadcastThrottleId = null;
  appState.itemDragBroadcastThrottleId = null;
  appState.itemResizeBroadcastThrottleId = null;
  appState.caretBroadcastThrottleId = null;
  setupPaneCanvasListeners(paneId);
  // Sizes this pane's own #dot-layer-{paneId} against the live dotLayer binding (already
  // repointed above) — layoutDotLayer (historyAutosave.ts) otherwise only ever runs once at page
  // load and on window resize, neither of which fires when a pane is split. Without this the new
  // pane's dot grid box has no explicit size at all and never paints anything.
  window.__layoutDotLayer?.();
}

// Brings a pane up to a SAVED state loaded from Supabase (loadWorkspace, historyAutosave.ts —
// explicit request: "tabs and window splits should persist across refreshes and log out/login"),
// rather than the fresh-defaults state initializeNewPane resets a brand-new pane to. Does both
// halves switchActivePane normally splits across two call sites itself: saves the CURRENTLY active
// pane's own live fields out to its own slot first, then resolves paneId's own DOM refs directly
// and applies `savedFields` (each falling back to the same fresh-default initializeNewPane itself
// uses if missing).
function restorePaneState(paneId: number, savedFields: AppStateShape = {}): void {
  const outgoingId = appState.activePaneId;
  if (outgoingId !== paneId) {
    const outgoing = appState.panes[outgoingId] || (appState.panes[outgoingId] = {});
    PANE_SCOPED_FIELDS.forEach((f) => {
      outgoing[f] = appState[f];
    });
    outgoing.canvas = canvas;
    outgoing.world = world;
    outgoing.dotLayer = dotLayer;
    outgoing.cursorOverlay = cursorOverlay;
  }
  canvas = document.getElementById(paneElId("canvas", paneId)) || undefined;
  world = document.getElementById(paneElId("world", paneId)) || undefined;
  dotLayer = document.getElementById(paneElId("dot-layer", paneId)) || undefined;
  cursorOverlay = document.getElementById(paneElId("cursor-overlay", paneId)) || undefined;
  appState.tx = savedFields.tx ?? 0;
  appState.ty = savedFields.ty ?? 0;
  appState.scale = savedFields.scale ?? 1;
  appState.currentFolderId = savedFields.currentFolderId || "root";
  appState.historyStack = savedFields.historyStack || [appState.currentFolderId];
  appState.historyIndex = savedFields.historyIndex || 0;
  appState.tabs = savedFields.tabs || [{ id: "tab-0", folderId: appState.currentFolderId }];
  appState.activeTabId = savedFields.activeTabId || appState.tabs[0].id;
  appState.nextTabId = savedFields.nextTabId || 1;
  appState.selectedCardIds = [];
  appState.cardMode = "normal";
  appState.modeOverrideKey = null;
  appState.modeKeyHoldStart = null;
  appState.dataLinkPendingId = null;
  appState.cameraTweenTimeout = null;
  appState.cursorBroadcastThrottleId = null;
  appState.itemDragBroadcastThrottleId = null;
  appState.itemResizeBroadcastThrottleId = null;
  appState.caretBroadcastThrottleId = null;
  delete appState.panes[paneId];
  appState.activePaneId = paneId;
  setupPaneCanvasListeners(paneId);
  window.__layoutDotLayer?.();
}

// Pane ids (other than excludePaneId, default the live active pane) currently viewing folderId
// (default the live active pane's own currentFolderId) — an inactive pane's own currentFolderId
// lives in its saved slot (appState.panes), never a live field; the active pane itself is checked
// against the live field directly, since it has no saved slot of its own while active. Backs
// render()'s own "sync siblings on commit" (waypointsRenderLoop.ts) and mirrorItemToSiblingPanes
// just below (live, per-pixel/per-keystroke mirroring) — both need exactly this same "who else is
// looking at this folder" answer, just at different granularities.
function otherPanesViewingFolder(
  folderId: string = appState.currentFolderId,
  excludePaneId: number = appState.activePaneId,
): number[] {
  return (window.__listPaneIds?.() || []).filter((paneId) => {
    if (paneId === excludePaneId) return false;
    const paneFolderId: string | undefined =
      paneId === appState.activePaneId
        ? appState.currentFolderId
        : (appState.panes[paneId] as PaneState | undefined)?.currentFolderId;
    return paneFolderId === folderId;
  });
}

// Live cross-pane mirroring for anything that mutates a canvas item's DOM directly, DURING a
// gesture, outside React's own render cycle and outside render()'s own "sync on commit" —
// explicit request: "movement is not live, only updating on release... i want it to be fully
// live. keystroke by keystroke, pixel by pixel movement while dragging." A drag/resize's own
// pointermove handler (canvasItemBehavior.js) and a contentEditable body's own oninput handler
// (attachNoteBody/attachWatermarkBody/attachTitleBody, waypointsRenderLoop.ts) already mutate the
// ACTIVE pane's own element on every tick/keystroke for local responsiveness — this runs
// `apply(el, paneId)` against itemId's own wrapper element in every OTHER pane currently viewing
// the same folder right alongside that, so a sibling pane's copy of the same item updates in the
// exact same tick rather than waiting for the gesture to end and render() to catch up. Silently
// no-ops per pane if that pane's own wrapper element doesn't exist (defensive only).
function mirrorItemToSiblingPanes(
  itemId: number,
  apply: (el: HTMLElement, paneId: number) => void,
  folderId: string = appState.currentFolderId,
  excludePaneId: number = appState.activePaneId,
): void {
  otherPanesViewingFolder(folderId, excludePaneId).forEach((paneId) => {
    const el = document.getElementById(itemElId(itemId, paneId));
    if (el) apply(el, paneId);
  });
}

// Pane-qualifies one of the 5 canvas-area structural ids (canvas/world/dot-layer/cursor-
// overlay/items-layer) the same way PaneCanvasArea.jsx's own paneQualifyHtml does when it renders
// each pane's markup: pane 0 keeps the bare, unqualified id, every other pane gets "-{paneId}"
// appended. Needed anywhere vanilla code looks up one of these 5 by id directly rather than
// through the canvas/world/dotLayer/cursorOverlay bindings themselves (e.g. items-layer, which has
// no binding of its own since only React ever reads it, via CanvasItemsLayer.jsx's portal).
function paneElId(staticId: string, paneId: number = appState.activePaneId): string {
  return paneId === 0 ? staticId : `${staticId}-${paneId}`;
}

// Canvas item DOM ids are pane-qualified ("item-{paneId}-{itemId}") for split-screen — see
// itemElId/findItemEl/parseItemId's own usage throughout the app; paneId defaults to
// appState.activePaneId (the vast majority of call sites are vanilla code responding to a direct
// user interaction, which by the time it runs is ALWAYS operating on whichever pane is currently
// active — the capture-phase pointerdown router, PaneGrid.jsx, guarantees that). React card
// components' own layout effects always pass their own paneId prop through explicitly instead of
// relying on this default (a card can re-render for reasons unrelated to its pane being active).
function itemElId(itemId: number, paneId: number = appState.activePaneId): string {
  return "item-" + paneId + "-" + itemId;
}
function findItemEl(itemId: number, paneId: number = appState.activePaneId): HTMLElement | null {
  return document.getElementById(itemElId(itemId, paneId));
}
function parseItemId(el: HTMLElement | null): number {
  const m = el && el.id && el.id.match(/^item-\d+-(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

let canvasViewportCenterX: () => number;

let initialized = false;
// Called from DottoApp's own render body (app/dotto-app.jsx), immediately after
// window.__DOTTO_USER__ is set — NOT a plain module-load-time side effect like every other
// Phase 4.4/4.5 port, and NOT deferred to a useEffect/wireX() poll either. Both would be wrong
// here: a plain side-effect import would run during module evaluation, before ANY render — too
// early for window.__DOTTO_USER__, which dotto-app.jsx deliberately sets during render specifically
// to be ready before dotto-script.js's afterInteractive tag fires; a useEffect would run AFTER
// paint, too late for that same reason. This needs the exact same synchronous render-body timing
// window.__DOTTO_USER__ itself uses. Idempotent — DottoApp re-renders many times over its
// lifetime, but appState must only ever be constructed once.
export function ensureCoreState(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;

  // canvas/world/dotLayer/cursorOverlay are reassigned by switchActivePane (below) once a second
  // pane's DOM exists (split-screen Stage 4+) — every other DOM ref declared alongside them here
  // is genuine singleton app chrome (one instance regardless of pane count) and is never
  // reassigned.
  canvas = document.getElementById("canvas") || undefined;
  world = document.getElementById("world") || undefined;
  dotLayer = document.getElementById("dot-layer") || undefined;
  cursorOverlay = document.getElementById("cursor-overlay") || undefined;
  btnAdd = document.getElementById("btn-add") || undefined;
  addMenu = document.getElementById("add-menu") || undefined;
  contextMenu = document.getElementById("context-menu") || undefined;
  zoomTrack = document.getElementById("zoom-track") || undefined;
  zoomFill = document.getElementById("zoom-fill") || undefined;
  zoomThumb = document.getElementById("zoom-thumb") || undefined;
  zoomControl = document.getElementById("zoom-control") || undefined;
  drawSettings = document.getElementById("draw-settings") || undefined;
  drawColorInput = (document.getElementById("draw-color") as HTMLInputElement) || undefined;
  drawFrontBtn = document.getElementById("draw-front-btn") || undefined;
  drawBackBtn = document.getElementById("draw-back-btn") || undefined;
  drawPenBtn = document.getElementById("draw-pen-btn") || undefined;
  drawEraserBtn = document.getElementById("draw-eraser-btn") || undefined;
  drawSizeInput = (document.getElementById("draw-size") as HTMLInputElement) || undefined;
  canvasContextMenu = document.getElementById("canvas-context-menu") || undefined;

  const supabase = window.__dottoSupabase || null;
  // Shared with appState.currentUser just below — captured once here rather than reading
  // window.__DOTTO_USER__ twice, since the object literal itself can't reference
  // appState.currentUser (appState doesn't exist until the literal finishes constructing).
  const initialUser = window.__DOTTO_USER__ || { id: null, username: "guest", displayName: "You" };

  // Every piece of shared, cross-function mutable app state, consolidated into one owned object.
  appState = {
    currentUser: initialUser,
    tx: 0,
    ty: 0,
    scale: 1,
    idCounter: 10,
    currentEditingEl: null,
    contextMenuItemId: null,
    // Source-page table state: which data cell last had focus (so the bottom-bar Add menu knows
    // where to insert images/audio), which cell's tag picker is currently open, and the
    // in-progress MediaRecorder session (if any) for the Audio > Record option.
    lastFocusedCell: null,
    activeTagRow: null,
    renamingTagId: null, // tag currently being renamed inline in the tag picker list, if any
    contextMenuTagId: null, // tag the right-click context menu (rename/delete) is currently targeting
    cellAudioRecorder: null,
    cellAudioChunks: [],
    historyStack: ["root"],
    historyIndex: 0,
    currentFolderId: "root",
    // Canvas tabs (tabManagement.ts's addTab/switchTab/closeTab) — each a lightweight bookmark of
    // a folder location, NOT an independent history/camera context: back/forward
    // (historyStack/historyIndex above) and pan/zoom stay global/shared across all tabs.
    tabs: [{ id: "tab-0", folderId: "root" }],
    activeTabId: "tab-0",
    nextTabId: 1,
    // Split-screen pane bookkeeping (see switchActivePane/PANE_SCOPED_FIELDS above) — GLOBAL, not
    // itself pane-scoped: this is the bookkeeping ABOUT panes, shared across all of them.
    // activePaneId is which pane is currently "hot"; panes holds every OTHER (inactive) pane's own
    // saved snapshot, keyed by paneId.
    activePaneId: 0,
    panes: {},
    nextPaneId: 1,
    // Core data mapping of our multiple folder structures
    folders: {
      root: {
        id: "root",
        title: "My First Canvas",
        items: [
          {
            id: 1,
            x: 100,
            y: 150,
            w: 308,
            h: 140,
            kind: "note",
            html: "Welcome to Dotter!<br>Explore the app, report any bugs, and learn some languages!",
          },
        ],
        drawings: [],
      },
    },
    addingKind: null,
    addingStatKind: null, // optional variant config threaded through to add() for kinds like 'statcard' that come in multiple flavors (e.g. Progress vs Accuracy)
    placementGhost: null,
    selectedCardIds: [],
    // Shift-click-to-select state for the Chats/Waypoints/Collaborations hamburger list panels —
    // vanilla owns this as the source of truth, mirrored into React's listPanelSelectionStore
    // (bridges.js) via window.__setListPanelSelection whenever it changes.
    listPanelSelection: { panel: null, ids: new Set() },
    // The card "armed" by a first click in data mode, awaiting a second click on a different card
    // to complete the link.
    dataLinkPendingId: null,
    // ---- Card interaction modes: 'normal' (move/click), 'data' (draw connections), 'select' (multi-select) ----
    cardMode: "normal",
    modeOverrideKey: null, // 'shift' | 'd' | 'escape' | null — temporary override while a mode key is held
    topCardZIndex: 10,
    trendingMarketplace: [
      {
        id: "m1",
        title: "Spanish Conjugation Matrix",
        price: "$4.99",
        creatorId: "u101",
        creatorUsername: "LanguagePros",
        description:
          "Complete map of irregular roots and structural tables. Perfect for conjugation visual tracking.",
        canvasSnapshot: [
          {
            id: "p1a",
            x: 0,
            y: 0,
            w: 200,
            h: 50,
            kind: "title",
            level: 2,
            html: "Irregular Verbs",
          },
          {
            id: "p1b",
            x: 0,
            y: 70,
            w: 280,
            h: 180,
            kind: "table",
            tableData: [
              ["Verb", "Yo", "Tú"],
              ["ser", "soy", "eres"],
              ["ir", "voy", "vas"],
              ["tener", "tengo", "tienes"],
            ],
          },
          {
            id: "p1c",
            x: 310,
            y: 70,
            w: 200,
            h: 112,
            kind: "note",
            html: "Practice these daily — focus on stem changes.",
          },
        ],
      },
      {
        id: "m2",
        title: "React Performance Blueprint",
        price: "$8.00",
        creatorId: "u102",
        creatorUsername: "TechArchitect",
        description:
          "Performance tracing models, custom hook trackers and render speed visual pathways.",
        canvasSnapshot: [
          {
            id: "p2a",
            x: 0,
            y: 0,
            w: 220,
            h: 50,
            kind: "title",
            level: 2,
            html: "Render Pipeline",
          },
          {
            id: "p2b",
            x: 0,
            y: 70,
            w: 220,
            h: 112,
            kind: "note",
            html: "Memoize expensive components with React.memo.",
          },
          {
            id: "p2c",
            x: 250,
            y: 70,
            w: 220,
            h: 160,
            kind: "checklist",
            tasks: [
              { id: 1, text: "Profile with DevTools", done: true },
              { id: 2, text: "Audit re-renders", done: false },
              { id: 3, text: "Add useMemo hooks", done: false },
            ],
          },
        ],
      },
      {
        id: "m3",
        title: "Organic Chemistry Pathways",
        price: "$5.50",
        creatorId: "u103",
        creatorUsername: "ScienceVisuals",
        description:
          "Advanced drawings with organic pathways designed to trigger visual memory pathways.",
        canvasSnapshot: [
          {
            id: "p3a",
            x: 0,
            y: 0,
            w: 220,
            h: 50,
            kind: "title",
            level: 2,
            html: "Reaction Pathways",
          },
          {
            id: "p3b",
            x: 0,
            y: 70,
            w: 280,
            h: 180,
            kind: "table",
            tableData: [
              ["Reactant", "Product"],
              ["Alkene", "Alcohol"],
              ["Alcohol", "Ketone"],
            ],
          },
        ],
      },
      {
        id: "m4",
        title: "Business Model Canvas Pack",
        price: "$3.00",
        creatorId: "u104",
        creatorUsername: "CorpStrategy",
        description:
          "Classic analytical matrix layouts formatted directly onto interactive tables for strategy.",
        canvasSnapshot: [
          { id: "p4a", x: 0, y: 0, w: 220, h: 50, kind: "title", level: 2, html: "Business Model" },
          { id: "p4b", x: 0, y: 70, w: 220, h: 112, kind: "note", html: "Key Partners" },
          { id: "p4c", x: 250, y: 70, w: 220, h: 112, kind: "note", html: "Revenue Streams" },
        ],
      },
    ],
    activeLibraryFolder: null,
    librarySearchQuery: "",
    marketplaceSearchQuery: "",
    selectedMarketItem: null,
    drawColor: "#ffffff",
    drawLayer: "front",
    drawTool: "pen",
    drawSize: 3,
    liveSvg: null,
    livePath: null,
    drawing: null,
    // Point-by-point pen-tool line in progress (see startPenPolyline/addPenPolylinePoint/
    // finishPenPolyline, srsConnectionsCore.ts) — null whenever no such line is being built.
    // penPolylineMoveHandler holds the persistent window pointermove listener that draws the
    // rubber-band segment between clicks, so it can be torn down when the line finishes.
    penPolyline: null,
    penPolylineMoveHandler: null,
    hubCollabView: "main",
    dotbotUpgradePromptedForFullness: false,
    activeConvoId: null,
    msgView: "main",
    // Tracks the arrow-selected row in #search-command-palette's row list.
    commandActiveIndex: -1,
    dotbotSearchGeneration: 0,
    // The persisted chat thread the next Dotbot message continues, if any.
    currentConversationId: null,
    preSharedViewState: null,
    ADD_MENU_DATA: {
      notes: {
        label: "Notes",
        categoryDesc: "The building blocks of your canvas — headings, notes, tables and media.",
        items: [
          { kind: "title", label: "Heading", icon: "/assets/icons/heading.png" },
          { kind: "note", label: "Note", icon: "/assets/icons/note.png" },
          { kind: "table", label: "Table", icon: "/assets/icons/table.png" },
          { kind: "media", label: "Upload", icon: "/assets/icons/media.png" },
        ],
      },
      tools: {
        label: "Tools",
        categoryDesc: "Tools that help you interact with content — read, record, link, and trace.",
        items: [
          { kind: "reader", label: "Reader", icon: "/assets/icons/reader.png" },
          { kind: "voice", label: "Voice Recorder", icon: "/assets/icons/voice.png" },
          { kind: "watermark", label: "Watermark", icon: "/assets/icons/watermark.png" },
        ],
      },
      utilities: {
        label: "Utilities",
        categoryDesc: "Workflow helpers — track tasks, time, history, and navigation.",
        items: [
          { kind: "embed", label: "Embed", icon: "/assets/icons/embed.png" },
          { kind: "stopwatch", label: "Stopwatch", icon: "/assets/icons/stopwatch.png" },
          { kind: "shelf", label: "Stack", icon: "/assets/icons/shelf.png" },
          { kind: "filter", label: "Filter", icon: "/assets/icons/filter.png" },
          { kind: "waypoint", label: "Waypoint", icon: "/assets/icons/waypoint.png" },
        ],
      },
      games: {
        label: "Games",
        categoryDesc: "Interactive exercises to practice a language.",
        items: [
          { kind: "flashcard", label: "Flashcard", icon: "/assets/icons/flashcards.png" },
          { kind: "typeright", label: "Typeright", icon: "/assets/icons/typeright.png" },
          { kind: "blanks", label: "Blanks", icon: "/assets/icons/blanks.png" },
          { kind: "match", label: "Match", icon: "/assets/icons/match.png" },
          { kind: "audiotype", label: "Audio Type", icon: "/assets/icons/audio.png" },
        ],
      },
      stats: {
        label: "Stats",
        categoryDesc: "Cards that show stats pulled from a linked card.",
        items: [
          {
            kind: "statcard",
            statKind: "progress",
            label: "Progress",
            icon: "/assets/icons/progress.png",
          },
          {
            kind: "statcard",
            statKind: "accuracy",
            label: "Accuracy",
            icon: "/assets/icons/accuracy.png",
          },
        ],
      },
    },
    userLibrary: {
      purchased: [],
      drafts: [],
      published: [],
      customFolders: [],
    },
    addMenuSearchQuery: "",
    undoStack: [],
    redoStack: [],
    swTickInterval: null,
    workspaceSaveTimer: null,
    // Guards against a real, observed data-loss race: loadWorkspace() (historyAutosave.ts) is an
    // async network round-trip, awaited before the very first render() — but the
    // visibilitychange/pagehide listeners that flush an immediate save on tab-hide/close are
    // registered at plain wire time, active from the instant the page starts, with no awareness of
    // whether that initial fetch has resolved yet. false until loadWorkspace's own async work
    // concludes in every outcome; saveWorkspaceNow bails out early while this is still false rather
    // than ever risking a save from pre-load default state.
    workspaceLoaded: false,
    contextMenuTableCtx: null,
    ZOOM_MIN: 0.2,
    ZOOM_MAX: 2,
    DOT_LAYER_MARGIN: 200,
    cameraTweenTimeout: null,
    applyTransformRafId: null,
    SM2_QUALITY: { noclue: 0, wrong: 1, hard: 3, easy: 5 },
    cardClipboard: [],
    clipboardPasteCount: 0,
    sourceAddMenu: document.getElementById("source-add-menu"),
    cellTagPicker: document.getElementById("cell-tag-picker"),
    audioRecordIndicator: document.getElementById("audio-record-indicator"),
    modeToolbar: document.getElementById("mode-toolbar"),
    modePopup: document.getElementById("mode-popup"),
    MODE_ORDER_WEIGHT: { normal: 0, data: 1, select: 2, pen: 3 },
    MODE_HOLD_THRESHOLD_MS: 180,
    modeKeyHoldStart: null,
    // "rail" replaces the old separate menu/messages/cart/profile/add flags — all of them now
    // share one #hamburger-stack shell (see openRailView, panelsHamburger.ts), so there's only
    // ever one pinned-or-not state to track. collab/sourceAdd are unrelated systems and keep their
    // own flags.
    panelPinned: { rail: false, collab: false, sourceAdd: false },
    // Which #hamburger-stack view is currently showing.
    activeRailView: null,
    dottoRail: document.getElementById("dotto-rail"),
    btnInbox: document.getElementById("btn-inbox"),
    inboxPanel: document.getElementById("inbox-panel"),
    btnSearch: document.getElementById("btn-search"),
    searchPanel: document.getElementById("search-panel"),
    btnSources: document.getElementById("btn-sources"),
    sourcesPanel: document.getElementById("sources-panel"),
    btnSnippets: document.getElementById("btn-snippets"),
    snippetsPanel: document.getElementById("snippets-panel"),
    // A separate, newer Snippets button from btnSnippets/snippetsPanel above (which is actually
    // Files under the hood) — the two just happen to share a name and icon, per explicit request.
    btnSnippets2: document.getElementById("btn-snippets2"),
    snippets2Panel: document.getElementById("snippets2-panel"),
    // File-upload popup (U toggles it) — independent of the #hamburger-stack rail-panel system
    // entirely.
    uploadPopup: document.getElementById("upload-popup"),
    uploadPopupBtn: document.getElementById("upload-popup-btn"),
    uploadPopupClose: document.getElementById("upload-popup-close"),
    uploadDropzone: document.getElementById("upload-dropzone"),
    uploadDropzoneLabel: document.getElementById("upload-dropzone-label"),
    railBtnAi: document.getElementById("rail-btn-ai"),
    railBtnWaypoints: document.getElementById("rail-btn-waypoints"),
    railBtnCollab: document.getElementById("rail-btn-collab"),
    hamburgerBtn: document.getElementById("btn-menu"),
    outlineMenu: document.getElementById("outline-menu"),
    outlineSearchInput: document.getElementById("outline-search"),
    hamburgerStack: document.getElementById("hamburger-stack"),
    waypointsPanel: document.getElementById("waypoints-panel"),
    waypointsSearchInput: document.getElementById("waypoints-search"),
    hubCollabPanel: document.getElementById("hub-collab-panel"),
    hubCollabSearchInput: document.getElementById("hub-collab-search"),
    incomingCanvasRequests: [],
    acceptedCanvasCollaborations: [],
    ownedCanvasCollaborations: [],
    seenIncomingCanvasRequestIds: null,
    profileBtn: document.getElementById("btn-profile"),
    profilePanel: document.getElementById("profile-panel"),
    // profilePanel is the whole rail view; profileMainView/profileSettingsView are its two
    // internal sub-views, toggled independently of the outer rail's own open/close state.
    profileMainView: document.getElementById("profile-main-view"),
    profileSettingsView: document.getElementById("profile-settings-view"),
    LEVEL_NAMES: [
      "Noob",
      "Novice",
      "Apprentice",
      "Learner",
      "Scholar",
      "Seeker",
      "Thinker",
      "Strategist",
      "Specialist",
      "Expert",
      "Master",
      "Savant",
      "Polymath",
      "Brainiac",
      "Prodigy",
      "Intellect",
      "Visionary",
      "Titan",
      "Archon",
      "Omniscient",
    ],
    SUB_RANKS_PER_TIER: 9,
    LEVEL_GROWTH_RATE: 1.045,
    LEVEL_BASE_POINTS: 100,
    ACHIEVEMENTS: [
      {
        id: "first_block",
        statKey: "blocks_placed",
        threshold: 1,
        name: "Place your first block",
        spriteIndex: 1,
      },
      {
        id: "three_friends",
        statKey: "friends_added",
        threshold: 3,
        name: "Add three friends",
        spriteIndex: 2,
      },
      {
        id: "twenty_searches",
        statKey: "ai_searches",
        threshold: 20,
        name: "Make twenty AI searches",
        spriteIndex: 4,
      },
      {
        id: "fifty_links",
        statKey: "data_links",
        threshold: 50,
        name: "Make fifty links in data mode",
        spriteIndex: 5,
      },
      {
        id: "hundred_flips",
        statKey: "flashcard_flips",
        threshold: 100,
        name: "Flip one hundred cards",
        spriteIndex: 6,
      },
      {
        id: "master_250_words",
        statKey: "words_mastered",
        threshold: 250,
        name: "Master 250 words",
        spriteIndex: 7,
      },
      {
        id: "day_in_platform",
        statKey: "platform_seconds",
        threshold: 86400,
        name: "Spend 24 hours in the platform",
        spriteIndex: 8,
      },
    ],
    SPRITE_TOTAL_COUNT: 108,
    BLOCKS_CAP: 100,
    searchUsageWarned: false,
    genUsageWarned: false,
    messagesBtn: document.getElementById("btn-messages"),
    messagesPanel: document.getElementById("messages-panel"),
    // Bare shell for now (see wireRailIcon('servers', ...), panelsHamburger.ts) — behavior/content
    // not yet decided, same as most of this rail.
    btnServers: document.getElementById("btn-servers"),
    serversPanel: document.getElementById("servers-panel"),
    msgConvo: document.getElementById("msg-convo"),
    msgList: document.getElementById("msg-list"),
    msgSearchInput: document.getElementById("msg-search"),
    // No static #collab-bubble any more (split-screen Stage 8 — every pane renders its own,
    // PaneTopBar.jsx) — starts null, retargeted to whichever pane's own bubble element the user
    // actually clicks/hovers before anything reads it.
    collabBubble: null,
    collabPanel: document.getElementById("collab-panel"),
    collabSearchInput: document.getElementById("collab-search"),
    outgoingCanvasInvitePendingIds: new Set(),
    COLLAB_LIST_MAX: 6,
    friends: [],
    incomingRequests: [],
    outgoingPendingIds: new Set(),
    seenIncomingFriendRequestIds: null,
    AFK_THRESHOLD_MS: 5 * 60 * 1000,
    localPresenceStatus: "online",
    afkTimer: null,
    friendPresenceLastStatus: new Map(),
    friendMessageChannels: new Map(),
    CURSOR_COLORS: [
      "#F87171",
      "#FB923C",
      "#FBBF24",
      "#4ADE80",
      "#22D3EE",
      "#60A5FA",
      "#A78BFA",
      "#F472B6",
    ],
    REMOTE_CURSOR_TRAVEL_MS: 220,
    canvasPresenceChannel: null,
    canvasPresenceKey: null,
    remoteCursors: new Map(),
    lastBroadcastSnapshot: null,
    pendingSyncDeltas: null,
    syncBroadcastTimer: null,
    localEditingState: { editing: false, editingTarget: null, caret: null },
    lastPointerClientX: null,
    lastPointerClientY: null,
    cursorBroadcastThrottleId: null,
    itemDragBroadcastThrottleId: null,
    itemResizeBroadcastThrottleId: null,
    caretBroadcastThrottleId: null,
    inlineCanvasDeleteMenuEl: null,
    STATIC_HEADER_PILL_GAP: 8,
    // Was 3.2 (3 full columns + a peek of the 4th before scrolling) — tightened to 2.2 per
    // explicit request that only 2 columns fit the screen before more start scrolling.
    STATIC_TABLE_VISIBLE_COLS: 2.2,
    STATIC_TABLE_ROW_GAP: 10,
    STATIC_TABLE_PAGE_PADDING_TOP: 96,
    STATIC_TABLE_PAGE_PADDING_BOTTOM: 16,
    STATIC_TABLE_BOTTOM_MARGIN: 20,
    STATIC_TABLE_UPLOAD_BTN_RESERVE: 35,
    AI_SOURCE_MAX_COLS: 10,
    AI_SOURCE_MAX_ROWS: 150,
    pdfjsLibPromise: null,
    pdfDocCache: new Map(),
    epubjsLibPromise: null,
    epubBookCache: new Map(),
    CLOZE_RE: /\[([^\[\]]+)\]/g,
    shelfRowClickTimer: null,
    searchInput: document.getElementById("search-input"),
    searchCommandPalette: document.getElementById("search-command-palette"),
    searchDotbotAnswer: document.getElementById("search-dotbot-answer"),
    searchTranslation: document.getElementById("search-translation"),
    searchDictionary: document.getElementById("search-dictionary"),
    searchExamples: document.getElementById("search-examples"),
    searchImageResult: document.getElementById("search-image-result"),
    searchSuggestions: document.getElementById("search-suggestions"),
    searchRecommended: document.getElementById("search-recommended"),
    searchDropdown: document.getElementById("search-dropdown"),
    // The persisted multi-turn chat thread, above #search-input-wrap.
    searchChatThread: document.getElementById("search-chat-thread"),
    searchSpinner: document.getElementById("search-spinner"),
    searchInputWrap: document.getElementById("search-input-wrap"),
    // AI search shares the permanent rail's one shell now (see openRailView, panelsHamburger.ts).
    // aiPanel is the whole rail view; aiChatView/aiListView are its two internal sub-views,
    // toggled independently of the outer rail's own open/close state. aiListHeader is where
    // #search-input-wrap/#search-dropdown live at rest.
    aiPanel: document.getElementById("ai-panel"),
    aiChatView: document.getElementById("ai-chat-view"),
    aiListView: document.getElementById("ai-list-view"),
    aiListHeader: document.getElementById("ai-list-header"),
    // Notification stack, bottom-left — fully ported to a real Zustand store now
    // (notificationsStore.ts). Still-vanilla callers reach it via
    // window.pushNotification/window.__hasVisibleNotifications.
    searchCardContext: [],
    searchCardConnections: [],
    NON_LATIN_SCRIPT_RE: new RegExp("[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\s\d]"),
    dotbotSuggestDebounceTimer: null,
    dotbotSuggestAbortController: null,
    // Same idea as dotbotSuggestDebounceTimer above, for the slash-command palette's nested
    // shared-tree name search (search_accessible_by_name RPC).
    commandSuggestDebounceTimer: null,
    dotbotMnemonicPair: { text: null, image: null },
    TYPEWRITER_LOADING_WORDS: [
      "Thinking",
      "Consulting",
      "Reasoning",
      "Picturing",
      "Composing",
      "Imagining",
    ],
    typewriterLoadingTimers: new WeakMap(),
    currentTtsAudio: null,
    // selectionToolbarEl removed — React owns the toolbar element now (see
    // app/dotto/SelectionToolbar.jsx).
    selectionToolbarRange: null,
    selectionToolbarHostEl: null,
    selectionToolbarRect: null,
    // addToSourcePopupEl removed — React owns the popup element now (see
    // app/dotto/AddToSourcePopup.jsx).
    addToSourceTarget: null,
    WAYPOINT_COLLAPSED_W: 28,
    waypointPeekTimer: null,
    sharedOwnerNameCache: {},
    outlineRows: [],
    outlineActiveIndex: -1,
    OUTLINE_MAX_DEPTH: 2,
    OUTLINE_GROUP_MAX_DIST: 30 * 28,
    OUTLINE_RESCUE_MAX_DIST: 10 * 28,
    btnCart: document.getElementById("btn-cart"),
    cartPanel: document.getElementById("cart-panel"),
    libraryBtn: document.getElementById("btn-library"),
    libraryPanel: document.getElementById("library-panel"),
    libraryFolderLabels: { purchased: "Purchased", drafts: "Drafts", published: "Published" },
    detailItem: null,
    detailSourceFolder: null,
    detailOriginal: null,
    publishFlowItem: null,
  };
  appState.dotLayerBaseX = -appState.DOT_LAYER_MARGIN / 2;
  appState.dotLayerBaseY = -appState.DOT_LAYER_MARGIN / 2;
  appState.modeButtons = Array.from(appState.modeToolbar.querySelectorAll(".mode-btn"));
  // The separate popup-panel rows (top-bar.html) — a different, new element from .mode-btn above,
  // deliberately not sharing that class; kept in sync alongside modeButtons by the same
  // updateModeToolbarUI (sourceButtonsCursorMode.ts).
  appState.modePopupRows = Array.from(appState.modeToolbar.querySelectorAll(".mode-popup-row"));
  // Every panel-style rail view, in the same order as their icons top-to-bottom in #dotto-rail —
  // replaces the old hubSubpanels now that Marketplace/Library/Messages/Add/Profile/AI search
  // share the exact same "one shell, swap which section is .open" mechanism.
  appState.railViewEls = [
    appState.inboxPanel,
    appState.searchPanel,
    appState.aiPanel,
    appState.sourcesPanel,
    appState.snippetsPanel,
    appState.snippets2Panel,
    appState.outlineMenu,
    appState.waypointsPanel,
    appState.hubCollabPanel,
    appState.cartPanel,
    appState.libraryPanel,
    appState.messagesPanel,
    appState.serversPanel,
    addMenu,
    appState.profilePanel,
  ];
  appState.railIconBtns = [
    appState.btnInbox,
    appState.btnSearch,
    appState.railBtnAi,
    appState.btnSources,
    appState.btnSnippets,
    appState.btnSnippets2,
    appState.hamburgerBtn,
    appState.railBtnWaypoints,
    appState.railBtnCollab,
    appState.btnCart,
    appState.libraryBtn,
    appState.messagesBtn,
    appState.btnServers,
    btnAdd,
    appState.profileBtn,
  ];
  appState.TOTAL_SUB_LEVELS = appState.LEVEL_NAMES.length * appState.SUB_RANKS_PER_TIER;
  appState.unlockedAchievementIds = new Set(appState.currentUser.unlockedAchievementIds || []);

  // Reserved space on the left for the permanent hamburger rail (#btn-menu — see --rail-width,
  // globals.css). Read from the CSS custom property (not hardcoded a second time here) so
  // globals.css stays the single source of truth — safe at this point since ensureCoreState()
  // itself only ever runs client-side, well after layout.js's blocking globals.css import has
  // applied.
  const RAIL_WIDTH =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-width")) || 64;
  // #hamburger-stack open reserves an extra --hmenu-width of space too now — subtracted here the
  // same way RAIL_WIDTH already is, so "center of the visible canvas" stays accurate whether or
  // not a rail panel is currently open.
  const HMENU_WIDTH =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hmenu-width")) || 300;
  canvasViewportCenterX = () => {
    const panelWidth = appState.activeRailView ? HMENU_WIDTH : 0;
    return (window.innerWidth - RAIL_WIDTH - panelWidth) / 2;
  };

  // React -> vanilla bridge — used by app/dotto/canvasItemBehavior.js (live drag/resize
  // mirroring), which can't import this directly since public/dotto/*.js isn't reachable from
  // app/dotto/.
  window.__mirrorItemToSiblingPanes = mirrorItemToSiblingPanes;
  window.__otherPanesViewingFolder = otherPanesViewingFolder;
  // Returns the SAME live object reference every call (appState is mutated in place, never
  // replaced), so callers always see the current value with no separate sync mechanism needed.
  window.__getAppState = () => appState;
  window.__bringCardToFront = bringCardToFront;
  window.__effectiveMode = effectiveMode;
  // Used by every React card component (CanvasCard.jsx, NoteCard.jsx, etc.) to look up its own
  // mounted DOM element by item id.
  window.__findItemEl = findItemEl;
  window.__parseItemId = parseItemId;
  window.__canvasViewportCenterX = () => canvasViewportCenterX();
  window.__itemElId = itemElId;
  window.__paneElId = paneElId;
  // Used by the PaneGrid capture-phase pointerdown router (split-screen Stage 4+) to make
  // "whichever pane is active" track user focus/clicks.
  window.__switchActivePane = switchActivePane;
  // Split-screen Stage 2+: returns the CURRENT value of the `let` binding on every call, so
  // callers always see whichever pane is active right now with no separate sync step.
  window.__getCanvasEl = () => canvas;
  window.__getWorldEl = () => world;
  window.__getCursorOverlayEl = () => cursorOverlay;
  // addMenu/btnAdd are the same "single, never-reassigned #add-menu/#btn-add elements" as
  // contextMenu etc, not per-pane like canvas/world above.
  window.__getAddMenuEl = () => addMenu;
  window.__getBtnAddEl = () => btnAdd;
  window.__getContextMenuEl = () => contextMenu;
  window.__getZoomControlEl = () => zoomControl;
  window.__getDrawSettingsEl = () => drawSettings;
  window.__getCanvasContextMenuEl = () => canvasContextMenu;
  window.__getZoomTrackEl = () => zoomTrack;
  window.__getZoomFillEl = () => zoomFill;
  window.__getZoomThumbEl = () => zoomThumb;
  window.__getDotLayerEl = () => dotLayer;
  window.__getDrawColorInputEl = () => drawColorInput;
  window.__getDrawSizeInputEl = () => drawSizeInput;
  window.__getDrawPenBtnEl = () => drawPenBtn;
  window.__getDrawEraserBtnEl = () => drawEraserBtn;
  window.__getDrawFrontBtnEl = () => drawFrontBtn;
  window.__getDrawBackBtnEl = () => drawBackBtn;
  window.__recomputeTopCardZIndex = recomputeTopCardZIndex;
  window.__restorePaneState = restorePaneState;
  // Used to re-attach a pointermove listener to every future pane's own canvas element.
  window.__registerPaneCanvasListenerSetup = registerPaneCanvasListenerSetup;
  // Used by the debug split-pane trigger (split-screen Stage 4, dotto-app.jsx) to finish bringing
  // a brand-new pane up to a real starting state after switchActivePane has made it active.
  window.__initializeNewPane = initializeNewPane;
}
