// Phase 4.4 port of public/dotto/source-buttons-cursor-mode.js: two genuinely unrelated concerns
// that happened to share a file — a source page's per-cell Add/Upload/Tags button popovers, and
// the cursor-mode toolbar (normal/data/select/pen) plus its D/Escape/Shift keyboard overrides —
// left bundled here too rather than split, matching the original's own reasoning (neither piece
// is large enough on its own to be worth a separate Phase 4.3 split). Reaches every still-vanilla
// dependency through window bridges; wires its real, module-load-time-only DOM listeners
// (mode-toolbar clicks/hover, global keydown/keyup/blur/resize, window.onclick, the canvas
// transitionend hook) via wireSourceButtonsCursorMode(), using the same bridge-readiness poll
// wireDayChangeAndAdNotifications/wireCopyPaste/wireMarketplace already established — this needs
// live appState AND several already-existing DOM elements (modeToolbar, modeButtons,
// modePopupRows, canvas) right at wire time, not just a bridge function reference.

import { linkSelectedCards } from "./drawingConnections";

interface FolderObj {
  id: string;
  isSource?: boolean;
  items: { id: number; kind: string }[];
}

interface AppState {
  sourceAddMenu: HTMLElement;
  lastFocusedCell: { id: number; r: number; c: number } | null;
  panelPinned: { rail: boolean; collab: boolean; sourceAdd: boolean };
  contextMenuItemId: number | null;
  modeToolbar: HTMLElement;
  modePopup: HTMLElement;
  modeButtons: HTMLElement[];
  modePopupRows: HTMLElement[];
  cardMode: string;
  modeOverrideKey: string | null;
  modeKeyHoldStart: number | null;
  MODE_HOLD_THRESHOLD_MS: number;
  MODE_ORDER_WEIGHT: Record<string, number>;
  selectedCardIds: number[];
  listPanelSelection: { panel: string | null; ids: Set<string> };
  folders: Record<string, FolderObj>;
  currentFolderId: string;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

// ---------- Source page: per-cell Add / Upload / Tags buttons (hover-only, no global toolbars) ----------
export function closeSourceAddMenu(): void {
  const appState = getAppState();
  if (!appState) return;
  appState.sourceAddMenu.style.display = "none";
  appState.panelPinned.sourceAdd = false;
}
// Opens the Add (image/audio) menu anchored to the specific cell's button that was clicked, and
// remembers that cell as the target for the insert actions below. Real inline onclick target
// (canvasItemBehavior.js's renderStaticTableHTML-equivalent cell markup) — plain global, no
// underscore.
export function openCellAddMenu(id: number, r: number, c: number, btnEl: HTMLElement): void {
  const appState = getAppState();
  if (!appState) return;
  const it = window.__findItemById?.(id);
  if (!it) return;
  // 'rail' — a click on a cell's own Add button is exactly the kind of "clicked elsewhere on the
  // canvas" interaction that must no longer close an open rail panel (see window.onclick's own
  // comment below).
  window.__closeAllPanels?.("rail");
  window.__closeCellTagPicker?.();
  appState.lastFocusedCell = { id, r, c };
  const rect = btnEl.getBoundingClientRect();
  appState.sourceAddMenu.style.left = Math.min(rect.left, window.innerWidth - 190) + "px";
  appState.sourceAddMenu.style.top = rect.bottom + 6 + "px";
  appState.sourceAddMenu.style.display = "flex";
  appState.panelPinned.sourceAdd = true;
}

// ---------- Cursor mode toolbar (normal / data / select / pen) ----------
function updateModeToolbarUI(): void {
  const appState = getAppState();
  if (!appState) return;
  const eff = window.__effectiveMode?.() ?? appState.cardMode;
  appState.modeButtons.forEach((b) => {
    const mode = b.dataset.mode ?? "";
    b.classList.toggle("mode-visible", mode === eff);
    b.classList.toggle("active", mode === appState.cardMode);
    // Keep whichever mode is currently pinned anchored at the bottom (order 99 — higher than any
    // natural MODE_ORDER_WEIGHT value, so a future mode's own weight can never collide with this
    // pin), so expanding the pill always grows upward from the same spot.
    b.style.order = mode === appState.cardMode ? "99" : String(appState.MODE_ORDER_WEIGHT[mode]);
  });
  // #mode-popup's own rows (top-bar.html) — per explicit follow-up request the active row no
  // longer sorts to the top; all four always stay in their fixed DOM order, only the highlight
  // moves.
  appState.modePopupRows.forEach((row) => {
    row.classList.toggle("active", row.dataset.mode === appState.cardMode);
  });
}
// Even-odd ray-casting point-in-polygon test (Jordan curve theorem) — generic over any vertex
// count, used below for the mode popup's "safe zone" quadrilateral.
function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
// The "safe zone" quadrilateral covering every straight-line path from anywhere in the mode-
// toolbar button to anywhere on the popup's own left edge — toolbar's left corners paired with
// the popup's near corners, live-measured so it tracks either element's actual current size/
// position rather than any hardcoded pixel guess. Per explicit follow-up request/screenshot:
// cutting diagonally from the toolbar toward a lower popup row (e.g. Pen mode) used to cross dead
// space or another rail button's hitbox partway through and close the popup early — this is what
// lets that diagonal path stay "inside" the whole way.
function modePopupSafeZone(appState: AppState): [number, number][] {
  const t = appState.modeToolbar.getBoundingClientRect();
  const p = appState.modePopup.getBoundingClientRect();
  return [
    [t.left, t.top],
    [p.left, p.top],
    [p.left, p.bottom],
    [t.left, t.bottom],
  ];
}
let modePopupSafeZoneActive = false;
function handleModePopupSafeMove(e: MouseEvent): void {
  const appState = getAppState();
  if (!appState) return;
  if (!appState.modeToolbar.classList.contains("expanded")) {
    stopModePopupSafeZone();
    return;
  }
  const target = e.target as Node;
  if (appState.modeToolbar.contains(target)) {
    stopModePopupSafeZone(); // back over it for real — nothing left to track
    return;
  }
  // Landing on another rail button's own hitbox closes the popup outright, even inside the safe
  // zone below — per explicit request that hovering another icon still closes it.
  const otherBtn = target instanceof Element ? target.closest(".rail-btn") : null;
  if (otherBtn && !appState.modeToolbar.contains(otherBtn)) {
    closeModePopup();
    return;
  }
  if (!pointInPolygon(e.clientX, e.clientY, modePopupSafeZone(appState))) closeModePopup();
}
function startModePopupSafeZone(): void {
  if (modePopupSafeZoneActive) return;
  modePopupSafeZoneActive = true;
  document.addEventListener("mousemove", handleModePopupSafeMove);
}
function stopModePopupSafeZone(): void {
  if (!modePopupSafeZoneActive) return;
  modePopupSafeZoneActive = false;
  document.removeEventListener("mousemove", handleModePopupSafeMove);
}
function closeModePopup(): void {
  stopModePopupSafeZone();
  getAppState()?.modeToolbar.classList.remove("expanded");
  updateModeToolbarUI();
}
export function applyCursorMode(): void {
  const appState = getAppState();
  if (!appState) return;
  const eff = window.__effectiveMode?.() ?? appState.cardMode;
  const canvasEl = window.__getCanvasEl?.();
  canvasEl?.classList.toggle("mode-data", eff === "data");
  canvasEl?.classList.toggle("mode-select", eff === "select");
  canvasEl?.classList.toggle("mode-pen", eff === "pen");
  // Leaving data mode (for any reason — toolbar click, D/Escape/Shift override) always cancels a
  // half-made click-to-link selection rather than letting it linger and potentially link two
  // unrelated cards later when data mode is re-entered.
  if (eff !== "data") window.__clearDataLinkPending?.();
  // #draw-settings (color/size/pen-eraser/front-back — see draw-settings.html) is pen mode's own
  // settings bar, shown only while pen mode is actually active.
  const drawSettingsEl = window.__getDrawSettingsEl?.();
  if (drawSettingsEl) drawSettingsEl.style.display = eff === "pen" ? "flex" : "none";
  updateModeToolbarUI();
}

function beginModeOverride(appState: AppState, key: string): void {
  if (appState.modeOverrideKey === key) return;
  appState.modeOverrideKey = key;
  appState.modeKeyHoldStart = Date.now();
  applyCursorMode();
}
function endModeOverride(appState: AppState, key: string, mode: string): void {
  if (appState.modeOverrideKey !== key) return;
  const elapsed =
    appState.modeKeyHoldStart !== null ? Date.now() - appState.modeKeyHoldStart : Infinity;
  appState.modeOverrideKey = null;
  appState.modeKeyHoldStart = null;
  if (elapsed < appState.MODE_HOLD_THRESHOLD_MS) appState.cardMode = mode; // quick tap — make the switch stick
  applyCursorMode();
}

// Re-run the source table's column sizing whenever its container's rendered width actually
// changes, since column widths are derived from it (layoutSourceTableColumns). Shared by two
// genuinely different triggers: a real window resize, and a rail panel opening/closing (which now
// also changes the table's available width — see .item.static-table's own
// body:has(#hamburger-stack.open) override, globals.css — but is a pure CSS transition with no
// resize event of its own to hook).
function relayoutSourceTableIfVisible(): void {
  const appState = getAppState();
  const folderObj = appState?.folders[appState.currentFolderId];
  if (!folderObj || !folderObj.isSource) return;
  const tableItem = folderObj.items.find((i) => i.kind === "table");
  const el = document.querySelector<HTMLElement>(".item.static-table");
  if (tableItem && el) window.__layoutSourceTableColumns?.(tableItem, el);
}
// Fires once #canvas's own left/width transition (see its body:has(#hamburger-stack.open)
// override, globals.css) finishes — not sooner, since reading the container's width mid-
// transition would just recompute against whatever partial value the animation happened to be at
// that instant, not the actual end state. e.propertyName is checked so this only reacts once per
// transition (left and width both finish here, one event each) rather than twice. Re-attached per
// pane (split-screen Stage 4: see registerPaneCanvasListenerSetup, app/dotto/lib/coreState.ts) so this doesn't
// just stop firing for panes other than pane 0 — e.target===canvasEl now checks against THIS
// listener's own pane rather than the ambient canvas binding, for the same reason
// setupCanvasLevelInteractionListeners' pointerdown check does (app/dotto/lib/srsConnectionsCore.ts).
// relayoutSourceTableIfVisible itself still queries '.item.static-table' globally (not
// pane-scoped) — a known, separate gap in the Source-page-in-split-screen story that hasn't been
// audited yet, out of scope for this specific listener-attachment fix.
function setupCanvasTransitionEnd(canvasEl: HTMLElement): void {
  canvasEl.addEventListener("transitionend", (e) => {
    if (e.target === canvasEl && e.propertyName === "width") relayoutSourceTableIfVisible();
  });
}

function doWire(appState: AppState): void {
  appState.modeButtons.forEach((btn) => {
    // This is the collapsed rail icon itself (only the currently-active mode's .mode-btn is ever
    // visible/clickable, see updateModeToolbarUI's own .mode-visible toggle) — clicking it always
    // just re-selects whatever mode is already active. Per explicit follow-up request, that click
    // no longer closes the popup either — it leaves it open exactly as hover already does, rather
    // than closeModePopup() like an actual row selection (below) does.
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const state = getAppState();
      if (!state) return;
      state.cardMode = btn.dataset.mode ?? state.cardMode;
      applyCursorMode();
    });
  });
  // A real mode selection (unlike the rail icon's own click just above) — still closes the popup,
  // wired separately since #mode-popup's rows (top-bar.html) are their own distinct elements, not
  // the rail button.
  appState.modePopupRows.forEach((row) => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const state = getAppState();
      if (!state) return;
      state.cardMode = row.dataset.mode ?? state.cardMode;
      closeModePopup();
      applyCursorMode();
    });
  });
  appState.modeToolbar.addEventListener("mouseenter", () => {
    stopModePopupSafeZone();
    appState.modeToolbar.classList.add("expanded");
    updateModeToolbarUI();
  });
  // Doesn't close outright — starts the safe-zone tracker (above) instead, which closes for real
  // once the pointer actually leaves that zone (or lands on another rail button), rather than the
  // instant the pointer leaves the toolbar's own small box.
  appState.modeToolbar.addEventListener("mouseleave", () => {
    startModePopupSafeZone();
  });

  // D / Escape / Shift each work as both a quick switch and a temporary (held) override for three
  // of the four cursor modes (Drawing / Normal / Select respectively — Data mode has no keyboard
  // shortcut of its own anymore, see below): pressing and releasing one within
  // MODE_HOLD_THRESHOLD_MS counts as a tap and switches to that mode for good, exactly like
  // clicking its toolbar button — the same as it would happen anyway from the immediate
  // keydown-triggered override, just made to stick around after keyup instead of reverting.
  // Holding it past that threshold keeps it a temporary override, reverting back to whatever mode
  // was active before the key went down the moment it's released. Option/Alt+drag is reserved
  // separately for duplicating cards, so D/Shift are ignored while actively typing in a text field
  // (Escape never types a character, so it's exempt from that check — same as its other,
  // unrelated "close everything" behavior above), and D/Shift both bail out while a meta/ctrl
  // modifier is held so they don't hijack unrelated shortcuts (e.g. Cmd+Z for undo). Drawing
  // (still internally the 'pen' cardMode/data-mode value — same "id stays, display name changes"
  // convention as every other rename this session — was "Pen mode" on 'P' before an explicit
  // request moved it here, which is also what freed 'D' up from Data mode: Data mode deliberately
  // has no replacement shortcut per that same request, only its own toolbar button/mode-popup row
  // still work.
  document.addEventListener("keydown", (e) => {
    const state = getAppState();
    if (!state) return;
    const active = document.activeElement;
    const isEditingText =
      active &&
      ((active as HTMLElement).isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");
    // Shift+X: a discrete shortcut (not a held-mode override) that links the current
    // multi-selection. Handled first so it never falls through into the Normal-mode override
    // logic below and briefly flips the cursor away from Data-linking context.
    if (
      !isEditingText &&
      e.shiftKey &&
      (e.key === "x" || e.key === "X") &&
      state.selectedCardIds.length >= 2
    ) {
      e.preventDefault();
      linkSelectedCards();
      return;
    }
    // Deletes whatever's currently selected. List-panel selection (Chats/Waypoints/
    // Collaborations, shift-click — see toggleListPanelSelection, app/dotto/lib/hamburgerCollab.ts) is checked
    // FIRST and, if present, wins outright: opening the hamburger menu doesn't clear an existing
    // canvas-card selection, so both could genuinely be non-empty at once (e.g. select some
    // cards, then open the menu and shift-click a chat row) — without this ordering a bare
    // Backspace would fire both deletions. Canvas-card selection (shift-click or select-cursor-
    // mode click — see setupDraggingAndClicking) is the only way to delete a card now that the
    // per-card right-click "Delete" menu item is gone.
    if (!isEditingText && e.key === "Backspace") {
      const sel = state.listPanelSelection;
      if (sel.panel && sel.ids.size) {
        e.preventDefault();
        window.__dispatchListPanelDelete?.(sel.panel, Array.from(sel.ids));
        return;
      }
      if (state.selectedCardIds.length > 0) {
        e.preventDefault();
        window.__deleteSelectedCards?.();
        return;
      }
    }
    if (!isEditingText && e.key === "Shift" && !e.metaKey && !e.ctrlKey) {
      beginModeOverride(state, "shift");
    } else if (!isEditingText && !e.metaKey && !e.ctrlKey && (e.key === "d" || e.key === "D")) {
      beginModeOverride(state, "d");
    } else if (e.key === "Escape") {
      beginModeOverride(state, "escape");
    }
  });
  document.addEventListener("keyup", (e) => {
    const state = getAppState();
    if (!state) return;
    if (e.key === "Shift") endModeOverride(state, "shift", "select");
    else if (e.key === "d" || e.key === "D") endModeOverride(state, "d", "pen");
    else if (e.key === "Escape") endModeOverride(state, "escape", "normal");
  });
  window.addEventListener("blur", () => {
    const state = getAppState();
    if (!state) return;
    if (state.modeOverrideKey) {
      state.modeOverrideKey = null;
      state.modeKeyHoldStart = null;
      applyCursorMode();
    }
  });

  const canvasEl = window.__getCanvasEl?.();
  if (canvasEl) setupCanvasTransitionEnd(canvasEl);
  window.__registerPaneCanvasListenerSetup?.(setupCanvasTransitionEnd);
  window.addEventListener("resize", relayoutSourceTableIfVisible);

  // Deliberately does NOT close the #hamburger-stack rail panel (Search/Outline/Waypoints/
  // Collaborations/Marketplace/Library/Messages/Sources/Files/Queries/Profile/Add) — per explicit
  // request, a rail panel now only closes via Escape (closeAllPanels, app/dotto/lib/historyAutosave.ts) or by
  // clicking its own already-open icon again (wireRailIcon, app/dotto/lib/panelsHamburger.ts), never by
  // clicking anywhere else. clearSearch() (app/dotto/lib/aiAssistantSuggestions.ts) is omitted for the same
  // reason — despite its generic name, its only effect is closing the Queries/AI rail view
  // specifically (see its own body), which is exactly the behavior being removed here. Everything
  // else this handler closes (the source-add-menu, cell tag picker, canvas/item context menus,
  // the per-canvas collab flyout, the mode-toolbar's hover-expanded state) is unrelated to that
  // rail-panel system and keeps closing on any outside click as before.
  window.onclick = () => {
    closeSourceAddMenu();
    window.__closeCellTagPicker?.();
    const state = getAppState();
    const contextMenuEl = window.__getContextMenuEl?.();
    if (contextMenuEl) contextMenuEl.style.display = "none";
    if (state) state.contextMenuItemId = null;
    window.__hideCanvasContextMenu?.();
    window.__closeCollabPanel?.();
    closeModePopup();
  };
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — this needs live appState AND
// several already-existing DOM elements (modeToolbar, modeButtons, modePopupRows) right at wire
// time, same reasoning as wireDayChangeAndAdNotifications' own comment: a single readiness check
// isn't enough since window.__getAppState is set by the vanilla afterInteractive <Script> bundle,
// which can genuinely resolve after React's own mount.
export function wireSourceButtonsCursorMode(): () => void {
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

// React -> vanilla bridge — window-bridge.js used to re-export this from its own centralized
// inline-handler list; now set directly here since this is the sole real caller (real inline
// onclick target, canvasItemBehavior.js's cell markup) — plain (non-`__`) global, same shape
// window.handleOutlineSearch/window.pushNotification use.
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.openCellAddMenu = openCellAddMenu;
  // Vanilla -> React bridges — app/dotto/lib/panelsHamburger.ts/app/dotto/lib/sourceTable.ts/waypoints-render-loop.js/
  // source-tags-ai.js/app-init.js/blocks-panel.js all previously imported these directly.
  window.__closeSourceAddMenu = closeSourceAddMenu;
  window.__applyCursorMode = applyCursorMode;
}
