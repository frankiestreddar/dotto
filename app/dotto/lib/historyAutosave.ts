// Phase 4.5 port of public/dotto/history-autosave.js: undo/redo + workspace autosave/load, the
// canvas camera transform (pan/zoom/dot-grid), the canvas right-click context menu (undo/redo +
// source-table column/row delete), a stopwatch live-tick loop, and the app's global keydown/paste
// handlers — genuinely several small, tightly-coupled concerns (applyTransform calls straight into
// canvasPresence.ts's repositionAllRemoteCursors/broadcastCursorPositionThrottled; the keydown
// handler drives undo/redo AND cut/paste AND every "close everything" escape hatch at once) that
// together total under half live-presence.js's own size — kept as one file rather than mechanically
// split, same precedent app/dotto/lib/sourceButtonsCursorMode.ts and every single-file Phase 4.4
// port already established for a file this size. No React hook/store was built for the undo/redo
// stack despite this being exactly the kind of state a "useHistoryStore" might own — checked
// against the real codebase first, same discipline as every other Phase 4.5 port so far: zero React
// components read appState.undoStack/redoStack directly today (undo/redo is keyboard- and
// vanilla-context-menu-driven only), so there is no real consumer to serve. Reaches every
// still-vanilla dependency through window bridges; wires its real, module-load-time-only DOM
// listeners (canvas contextmenu, document paste/keydown, window resize) via wireHistoryAutosave(),
// using the same bridge-readiness poll every other Phase 4.4/4.5 port with real DOM wiring has used.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateGlobalId } from "./globalIds";

interface Item {
  id: number;
  kind: string;
  zIndex?: number;
  tableData?: string[][];
  cellTags?: Record<string, unknown>;
  swRunning?: boolean;
  swPaused?: boolean;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  globalId?: string;
  title?: string;
  isSource?: boolean;
  isSharedView?: boolean;
  sharedOwnerId?: string;
  sharedRemoteFolderId?: string;
  items: Item[];
  [key: string]: unknown;
}
interface PaneSavedFields {
  tx: number;
  ty: number;
  scale: number;
  currentFolderId: string;
  historyStack: string[];
  historyIndex: number;
  tabs: { id: string; folderId: string }[];
  activeTabId: string;
  nextTabId: number;
  [key: string]: unknown;
}
interface AppState {
  currentUser: { id: string | null };
  folders: Record<string, FolderObj>;
  idCounter: number;
  undoStack: string[];
  redoStack: string[];
  currentFolderId: string;
  historyStack: string[];
  historyIndex: number;
  tabs: { id: string; folderId: string }[];
  activeTabId: string;
  nextTabId: number;
  tx: number;
  ty: number;
  scale: number;
  dotLayerBaseX: number;
  dotLayerBaseY: number;
  applyTransformRafId: number | null;
  cameraTweenTimeout: ReturnType<typeof setTimeout>;
  workspaceSaveTimer: ReturnType<typeof setTimeout>;
  workspaceLoaded: boolean;
  swTickInterval: ReturnType<typeof setInterval> | null;
  currentEditingEl: HTMLElement | null;
  contextMenuTableCtx: { tableId: number; r: number; c: number } | null;
  contextMenuItemId: number | null;
  preSharedViewState: {
    currentFolderId: string;
    historyStack: string[];
    historyIndex: number;
  } | null;
  panes: Record<number, PaneSavedFields>;
  activePaneId: number;
  nextPaneId: number;
  penPolyline: unknown;
  addingKind: string | null;
  selectedCardIds: number[];
  cardClipboard: unknown[];
  DOT_LAYER_MARGIN: number;
  ZOOM_MIN: number;
  ZOOM_MAX: number;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

// ---------- Stopwatch live ticking ----------
export function ensureSwTicking(): void {
  const appState = getAppState();
  if (!appState) return;
  const hasRunning = appState.folders[appState.currentFolderId]?.items.some(
    (i) => i.kind === "stopwatch" && i.swRunning && !i.swPaused,
  );
  if (hasRunning && !appState.swTickInterval) {
    appState.swTickInterval = setInterval(swTick, 1000);
  } else if (!hasRunning && appState.swTickInterval) {
    clearInterval(appState.swTickInterval);
    appState.swTickInterval = null;
  }
}
function swTick(): void {
  const appState = getAppState();
  if (!appState || !appState.folders[appState.currentFolderId]) return;
  // Always patch every running stopwatch's own digits directly first — cheap, and doesn't depend
  // on the render() call below actually landing visually on this exact tick (called from a plain
  // setInterval, outside any React event, unlike a real user click on Start/Stop — see
  // StopwatchCard.jsx).
  appState.folders[appState.currentFolderId].items.forEach((it) => {
    if (it.kind === "stopwatch" && it.swRunning) {
      const el = window.__findItemEl?.(it.id);
      const timeEl = el?.querySelector(".sw-time");
      if (timeEl)
        timeEl.textContent = window.__swFormatTime?.(window.__swCurrentElapsedMs?.(it) ?? 0) ?? "";
    }
  });
  // Don't yank focus away from whatever text the user is editing — a full render() would rebuild
  // that card's DOM out from under an in-progress edit. Still needed for kinds connected to this
  // stopwatch via propagateCanvasStreams (Statcard, Shelf) to see fresh data live while it runs,
  // so this isn't skipped outright the rest of the time, just deferred until nothing's being
  // edited.
  if (appState.currentEditingEl) return;
  window.__render?.();
}

export function saveSnapshot(): void {
  const appState = getAppState();
  if (!appState) return;
  appState.undoStack.push(
    JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }),
  );
  if (appState.undoStack.length > 60) appState.undoStack.shift();
  appState.redoStack = [];
}

// ---------- Workspace autosave ----------
// Persists the same { folders, idCounter } shape saveSnapshot() already uses for undo, so loading
// it back is just the undo/redo restore path reused at startup. Debounced so continuous typing
// doesn't hammer Supabase on every keystroke; flushed immediately on tab hide/close so "close the
// window" can't lose more than the debounce window.
export function scheduleWorkspaceSave(): void {
  const appState = getAppState();
  const supabaseClient = window.__dottoSupabase;
  if (!appState || !supabaseClient || !appState.currentUser.id) return;
  // Live presence/content-sync — this, not render(), is the real universal "something changed"
  // signal: render() itself always calls this first, but a lot of mutations (committing a text
  // edit on blur, rating a flashcard, etc.) call ONLY this, never render() — so anchoring on
  // render() alone silently missed every one of those for sync purposes, even though the change
  // was saved/undoable fine locally. This is a strict superset of what render()-anchoring caught.
  const folderObj = appState.folders[appState.currentFolderId];
  if (folderObj) {
    window.__ensureCanvasPresenceChannel?.();
    window.__queueSyncDiff?.(folderObj as unknown as Record<string, unknown>);
  }
  clearTimeout(appState.workspaceSaveTimer);
  appState.workspaceSaveTimer = setTimeout(saveWorkspaceNow, 800);
}
export async function saveWorkspaceNow(): Promise<void> {
  const appState = getAppState();
  const supabaseClient = window.__dottoSupabase as SupabaseClient | undefined;
  if (!appState) return;
  clearTimeout(appState.workspaceSaveTimer);
  if (!supabaseClient || !appState.currentUser.id) return;
  // See appState.workspaceLoaded's own comment, app/dotto/lib/coreState.ts — refuses to save before the initial
  // loadWorkspace() has resolved, so a tab-hide/pagehide firing mid-fetch can never upsert pre-load
  // default state over real saved data.
  if (!appState.workspaceLoaded) return;

  // shared:owner:folderId entries (see openSharedCanvas) are someone else's canvas fetched on
  // demand, not this user's own — they must never be written into this user's own workspace row,
  // only patched back to the OWNER's via update_shared_folder below. public: entries get the same
  // exclusion but for a stronger reason: there's no update_public_folder counterpart at all to
  // patch one back to. media-view-*: entries (window.__openMediaViewerTab,
  // app/dotto/lib/tabManagement.ts) are a synthetic, session-local wrapper around a real canvas
  // item — not real user content of their own.
  const localFolders: Record<string, FolderObj> = {};
  for (const id in appState.folders) {
    if (!id.startsWith("shared:") && !id.startsWith("public:") && !id.startsWith("media-view-"))
      localFolders[id] = appState.folders[id];
  }
  // Backfills globalId (global-ids.js) on any local folder that doesn't have one yet.
  for (const id in localFolders) {
    if (!localFolders[id].globalId) localFolders[id].globalId = generateGlobalId();
  }
  const resumeFolderId = appState.preSharedViewState
    ? appState.preSharedViewState.currentFolderId
    : appState.currentFolderId;
  const resumeStack = appState.preSharedViewState
    ? appState.preSharedViewState.historyStack
    : appState.historyStack;
  const resumeIndex = appState.preSharedViewState
    ? appState.preSharedViewState.historyIndex
    : appState.historyIndex;
  // A shared canvas isn't reachable from resumeFolderId alone — so a refresh/reload used to always
  // silently drop back to wherever this user's own navigation was just before entering, kicking
  // them out of the collaboration entirely. Persisting just enough to re-fetch and re-enter it
  // fixes that.
  const activeShared = appState.folders[appState.currentFolderId];
  const lastSharedView = activeShared?.isSharedView
    ? { ownerId: activeShared.sharedOwnerId, folderId: activeShared.sharedRemoteFolderId }
    : null;

  // Split-screen window layout + every OTHER pane's own tabs/history/camera — the ACTIVE pane's
  // own fields were already saved above; this adds the SAME shape for every OTHER currently-open
  // pane, plus the tree describing how they're arranged.
  const paneLayout = window.__getPaneLayout ? window.__getPaneLayout() : null;
  const paneStates: Record<number, Partial<PaneSavedFields>> = {};
  (window.__listPaneIds ? window.__listPaneIds() : []).forEach((paneId) => {
    if (paneId === appState.activePaneId) return; // already covered by the top-level fields above
    const saved = appState.panes[paneId];
    if (!saved) return;
    paneStates[paneId] = {
      tx: saved.tx,
      ty: saved.ty,
      scale: saved.scale,
      currentFolderId: saved.currentFolderId,
      historyStack: saved.historyStack,
      historyIndex: saved.historyIndex,
      tabs: saved.tabs,
      activeTabId: saved.activeTabId,
      nextTabId: saved.nextTabId,
    };
  });
  const workspaceData = {
    folders: localFolders,
    idCounter: appState.idCounter,
    historyStack: resumeStack,
    historyIndex: resumeIndex,
    tx: appState.tx,
    ty: appState.ty,
    scale: appState.scale,
    lastSharedView,
    tabs: appState.tabs,
    activeTabId: appState.activeTabId,
    nextTabId: appState.nextTabId,
    paneLayout,
    paneStates,
    nextPaneId: appState.nextPaneId,
    activePaneId: appState.activePaneId,
  };
  const { error } = await supabaseClient.from("workspaces").upsert({
    user_id: appState.currentUser.id,
    data: workspaceData,
    current_folder_id: resumeFolderId,
    updated_at: new Date().toISOString(),
  });
  // error often logs as an unhelpful bare '{}' by itself — spelled out explicitly for a real
  // diagnosable trail, plus the actual payload size (a large embedded image/video is the prime
  // suspect for a save that starts failing without anything else about the workspace changing).
  if (error) {
    let payloadSize = "unknown";
    try {
      payloadSize = JSON.stringify(workspaceData).length + " chars";
    } catch {
      // circular or unserializable — the error itself either way
    }
    console.error("[workspace] save failed:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      payloadSize,
    });
  }

  // Lazy global-id registration (global-ids.js) — every local folder, every save. Best-effort: a
  // failure here doesn't block or roll back the real workspace save above.
  const globalItems = Object.keys(localFolders).map((id) => ({
    global_id: localFolders[id].globalId,
    folder_id: id,
    kind: localFolders[id].isSource ? "source" : "canvas",
    title: localFolders[id].title || "",
  }));
  if (globalItems.length) {
    const { error: globalItemsErr } = await supabaseClient.rpc("register_global_items", {
      p_items: globalItems,
    });
    if (globalItemsErr) {
      console.error(
        `[global-ids] registration failed: message=${globalItemsErr.message} code=${globalItemsErr.code} details=${globalItemsErr.details} hint=${globalItemsErr.hint}`,
      );
    }
  }

  // A currently-open shared canvas is saved separately — patches just that one folder in the
  // OWNER's own workspace row (see update_shared_folder), never this user's own.
  const openShared = appState.folders[appState.currentFolderId];
  if (openShared?.isSharedView) {
    const {
      isSharedView: _isSharedView,
      sharedOwnerId,
      sharedRemoteFolderId,
      id: _id,
      ...folderData
    } = openShared;
    // The owner's canonical storage always uses bare, un-namespaced folder ids.
    (folderData as { items: Item[] }).items = (window.__stripSharedFolderIds?.(
      (folderData as { items: Item[] }).items as unknown as Record<string, unknown>[],
    ) ?? []) as unknown as Item[];
    const { error: sharedErr } = await supabaseClient.rpc("update_shared_folder", {
      p_owner_id: sharedOwnerId,
      p_folder_id: sharedRemoteFolderId,
      p_new_folder_data: folderData,
    });
    if (sharedErr) console.error("[collab] failed to save shared canvas:", sharedErr);
  }
}
// Returns true if a saved camera position (tx/ty/scale) was restored — the caller should skip its
// own default centerOnContent() in that case, the same way applyFolderView already prefers a
// folder's own saved lastView over re-centering when one exists.
export async function loadWorkspace(): Promise<boolean> {
  const appState = getAppState();
  const supabaseClient = window.__dottoSupabase as SupabaseClient | undefined;
  if (!appState) return false;
  // appState.workspaceLoaded gets set true on EVERY exit path below, including the early-return
  // ones — once this async attempt has definitively concluded, saveWorkspaceNow() is safe to run.
  if (!supabaseClient || !appState.currentUser.id) {
    appState.workspaceLoaded = true;
    return false;
  }
  const { data, error } = await supabaseClient
    .from("workspaces")
    .select("data, current_folder_id")
    .eq("user_id", appState.currentUser.id)
    .maybeSingle();
  if (error) {
    console.error("[workspace] load failed:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    appState.workspaceLoaded = true;
    return false;
  }
  if (!data) {
    appState.workspaceLoaded = true;
    return false;
  } // first-ever login — keep the built-in starter content
  const saved = data.data as Record<string, unknown>;
  appState.folders = saved.folders as Record<string, FolderObj>;
  appState.idCounter = saved.idCounter as number;
  window.__recomputeTopCardZIndex?.();

  const savedStack = saved.historyStack as string[];
  const savedHistoryIndex = saved.historyIndex as number;
  if (
    Array.isArray(savedStack) &&
    savedStack.length &&
    savedStack[0] === "root" &&
    savedStack.every((id) => appState.folders[id]) &&
    Number.isInteger(savedHistoryIndex) &&
    savedHistoryIndex >= 0 &&
    savedHistoryIndex < savedStack.length
  ) {
    appState.historyStack = savedStack;
    appState.historyIndex = savedHistoryIndex;
    appState.currentFolderId = appState.historyStack[appState.historyIndex];
  } else if (data.current_folder_id && appState.folders[data.current_folder_id]) {
    // Older save made before historyStack was persisted — best effort: still show root as root
    // rather than treating the leaf as root.
    appState.currentFolderId = data.current_folder_id;
    appState.historyStack =
      appState.currentFolderId === "root" ? ["root"] : ["root", appState.currentFolderId];
    appState.historyIndex = appState.historyStack.length - 1;
  }

  // Resume a collaboration session across a reload instead of it silently kicking the user back
  // to their own canvas — currentFolderId/historyStack/historyIndex above are already this user's
  // own correct resume position at this point, exactly what preSharedViewState needs to fall back
  // to if the shared view can't be re-entered for any reason.
  const lastSharedView = saved.lastSharedView as
    { ownerId?: string; folderId?: string } | undefined;
  if (lastSharedView?.ownerId && lastSharedView.folderId) {
    const { ownerId, folderId } = lastSharedView;
    appState.preSharedViewState = {
      currentFolderId: appState.currentFolderId,
      historyStack: appState.historyStack.slice(),
      historyIndex: appState.historyIndex,
    };
    const localKeys = await window.__resolveSharedFolderChain?.(ownerId, folderId);
    if (localKeys) {
      appState.currentFolderId = localKeys[localKeys.length - 1];
      appState.historyStack = localKeys;
      appState.historyIndex = localKeys.length - 1;
    } else {
      appState.preSharedViewState = null; // couldn't resume — stay on this user's own canvas instead
    }
  }

  // Tabs (app/dotto/lib/tabManagement.ts's addTab/switchTab/closeTab) — validated against
  // appState.folders as it stands AFTER the shared-canvas resume block above, so a tab pointing
  // into an actively-resumed shared chain still validates correctly.
  const rawTabs = saved.tabs;
  const savedTabs = Array.isArray(rawTabs)
    ? rawTabs.filter((t) => t && typeof t.id === "string" && typeof t.folderId === "string")
    : [];
  if (savedTabs.length) {
    appState.tabs = savedTabs.map((t) => ({
      id: t.id,
      folderId: appState.folders[t.folderId] ? t.folderId : appState.currentFolderId,
    }));
    appState.activeTabId = appState.tabs.some((t) => t.id === saved.activeTabId)
      ? (saved.activeTabId as string)
      : appState.tabs[0].id;
    const maxExistingId = appState.tabs.reduce((max, t) => {
      const match = /^tab-(\d+)$/.exec(t.id);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, -1);
    appState.nextTabId = Math.max(
      Number.isInteger(saved.nextTabId) ? (saved.nextTabId as number) : 0,
      maxExistingId + 1,
    );
  }

  appState.workspaceLoaded = true;
  const hasCameraData =
    typeof saved.tx === "number" && typeof saved.ty === "number" && typeof saved.scale === "number";
  if (hasCameraData) {
    appState.tx = saved.tx as number;
    appState.ty = saved.ty as number;
    appState.scale = saved.scale as number;
  }
  // Split-screen window layout + every other pane's own tabs/history/camera. Pane 0 (the only one
  // that can exist before this runs) is already fully restored above — this only has anything to
  // do once a real multi-pane save exists.
  restorePaneLayoutAndTabs(saved);
  return hasCameraData; // older save made before tx/ty/scale was persisted — nothing to restore
}

// See loadWorkspace's own call site for context. `saved.paneLayout` (the split tree,
// window.__setPaneLayout/paneLayoutStore) is only present once a real split has ever been saved; a
// plain single-pane save has none, so this just no-ops for the (overwhelmingly common) unsplit
// case. window.__setPaneLayout is flushSync'd, so every restored pane's own DOM (PaneCanvasArea.jsx)
// exists synchronously by the time window.__listPaneIds() is read right after it.
//
// The top-level tabs/historyStack/tx/ty/scale fields (already restored onto LIVE appState above,
// since that's always been "whichever pane happens to be live" — pane 0, the only one that exists
// before window.__setPaneLayout below runs) describe whichever pane was actually ACTIVE at SAVE
// time, which is NOT necessarily pane 0 — saveWorkspaceNow only writes paneStates entries for the
// OTHER panes, deliberately skipping whichever was active then. Snapshotting the CURRENTLY-live
// fields into `activeFieldsSnapshot` before window.__setPaneLayout runs (the only moment they're
// guaranteed to still be intact) and feeding that snapshot to whichever paneId turns out to
// actually be `savedActivePaneId`, uniformly through the exact same restorePaneState call every
// other pane goes through, is what fixes a real bug this function's first version had (see
// PHASE4_ROADMAP.md's own history-autosave.js entry for the full account).
function restorePaneLayoutAndTabs(saved: Record<string, unknown>): void {
  const appState = getAppState();
  const paneLayout = saved.paneLayout as { type?: string } | undefined;
  if (
    !appState ||
    !paneLayout ||
    paneLayout.type !== "split" ||
    !window.__setPaneLayout ||
    !window.__listPaneIds
  )
    return;
  const activeFieldsSnapshot: Partial<PaneSavedFields> = {
    tx: appState.tx,
    ty: appState.ty,
    scale: appState.scale,
    currentFolderId: appState.currentFolderId,
    historyStack: appState.historyStack,
    historyIndex: appState.historyIndex,
    tabs: appState.tabs,
    activeTabId: appState.activeTabId,
    nextTabId: appState.nextTabId,
  };
  window.__setPaneLayout(paneLayout as unknown as Record<string, unknown>);
  const paneIds = window.__listPaneIds();
  const savedActivePaneId =
    typeof saved.activePaneId === "number" && paneIds.includes(saved.activePaneId)
      ? saved.activePaneId
      : 0;
  let maxPaneId = 0;
  const paneStates = saved.paneStates as Record<number, Partial<PaneSavedFields>> | undefined;
  paneIds.forEach((paneId) => {
    maxPaneId = Math.max(maxPaneId, paneId);
    const savedPane =
      paneId === savedActivePaneId ? activeFieldsSnapshot : paneStates?.[paneId] || {};
    window.__restorePaneState?.(paneId, savedPane as unknown as Record<string, unknown>);
    window.__render?.();
  });
  // Lands on whichever pane was actually active when this was saved — guaranteed a real slot by
  // now, so this always finds the right data regardless of which paneId happened to be visited
  // last by the loop.
  window.__switchActivePane?.(savedActivePaneId);
  window.__render?.();
  // Keeps a future real split (splitPaneWithTab, app/dotto/lib/splitPaneManagement.ts) from
  // minting a paneId that collides with one just restored.
  appState.nextPaneId = Math.max(
    typeof saved.nextPaneId === "number" ? saved.nextPaneId : 0,
    maxPaneId + 1,
  );
}

function afterHistoryChange(): void {
  const appState = getAppState();
  if (!appState) return;
  if (!appState.folders[appState.currentFolderId]) {
    appState.currentFolderId = "root";
    appState.historyStack = [appState.currentFolderId];
    appState.historyIndex = 0;
    window.__render?.();
    window.__centerOnContent?.();
    return;
  }
  // currentFolderId is still valid, so the navigation path the user actually took to get here is
  // still accurate — leave historyStack/historyIndex alone. Overwriting it with a single-entry
  // stack (the old behavior) made whatever folder you were undoing/redoing inside of look like
  // the root.
  window.__render?.();
}
// Real inline onclick target (content/fragments/canvas-context-menu.html) — plain global, no
// underscore.
export function undo(): void {
  const appState = getAppState();
  if (!appState || !appState.undoStack.length) return;
  appState.redoStack.push(
    JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }),
  );
  const state = JSON.parse(appState.undoStack.pop() as string);
  appState.folders = state.folders;
  appState.idCounter = state.idCounter;
  afterHistoryChange();
}
// Real inline onclick target (content/fragments/canvas-context-menu.html) — plain global, no
// underscore.
export function redo(): void {
  const appState = getAppState();
  if (!appState || !appState.redoStack.length) return;
  appState.undoStack.push(
    JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }),
  );
  const state = JSON.parse(appState.redoStack.pop() as string);
  appState.folders = state.folders;
  appState.idCounter = state.idCounter;
  afterHistoryChange();
}
// Set by openTableCellContextMenu when a source-table cell is right-clicked, so the canvas
// context menu knows which table/row/column "Delete column"/"Delete row" (and their hover
// highlights) should act on. Cleared whenever the menu closes or blank canvas space is
// right-clicked instead. Dual-exposed on purpose — both `window.hideCanvasContextMenu` (a real
// inline onclick target, canvas-context-menu.html) and `window.__hideCanvasContextMenu` (real
// vanilla-JS callers, e.g. sourceButtonsCursorMode.ts's own window.onclick handler, need
// programmatic access too) — same shape `broadcastEditingState` (canvasPresence.ts) uses.
export function hideCanvasContextMenu(): void {
  const appState = getAppState();
  const canvasContextMenu = window.__getCanvasContextMenuEl?.();
  if (!appState || !canvasContextMenu) return;
  canvasContextMenu.style.display = "none";
  clearContextDeleteHighlight();
  appState.contextMenuTableCtx = null;
}
function showCanvasContextMenu(clientX: number, clientY: number): void {
  const appState = getAppState();
  const canvasContextMenu = window.__getCanvasContextMenuEl?.();
  if (!appState || !canvasContextMenu) return;
  canvasContextMenu.style.display = "flex";
  canvasContextMenu.style.left = clientX + "px";
  canvasContextMenu.style.top = clientY + "px";
  document
    .getElementById("canvas-ctx-undo")
    ?.classList.toggle("disabled", appState.undoStack.length === 0);
  document
    .getElementById("canvas-ctx-redo")
    ?.classList.toggle("disabled", appState.redoStack.length === 0);
  const hasCellCtx = !!appState.contextMenuTableCtx;
  const delCol = document.getElementById("canvas-ctx-del-col");
  const delRow = document.getElementById("canvas-ctx-del-row");
  if (delCol) delCol.style.display = hasCellCtx ? "block" : "none";
  if (delRow) delRow.style.display = hasCellCtx ? "block" : "none";
}
// Re-attached per pane (split-screen Stage 4). Right-click is a deliberate interaction with this
// specific pane, same as a plain click.
function setupCanvasContextMenu(canvasEl: HTMLElement, paneId: number): void {
  canvasEl.addEventListener("contextmenu", (e) => {
    // Only show the undo/redo menu when right-clicking blank canvas space (cards handle their own
    // contextmenu and stop it from bubbling here).
    e.preventDefault();
    e.stopPropagation();
    const appState = getAppState();
    const contextMenu = window.__getContextMenuEl?.();
    if (!appState) return;
    window.__switchActivePane?.(paneId);
    if (contextMenu) contextMenu.style.display = "none";
    appState.contextMenuItemId = null;
    appState.contextMenuTableCtx = null;
    showCanvasContextMenu(e.clientX, e.clientY);
  });
}
// Right-clicking a source-table data cell shows the same undo/redo menu plus "Delete column"/
// "Delete row" for that cell's column/row. Real inline oncontextmenu target
// (canvasItemBehavior.js's cell markup) — plain global, no underscore.
export function openTableCellContextMenu(
  e: MouseEvent,
  tableId: number,
  r: number,
  c: number,
): void {
  e.preventDefault();
  e.stopPropagation();
  const appState = getAppState();
  const contextMenu = window.__getContextMenuEl?.();
  if (!appState) return;
  if (contextMenu) contextMenu.style.display = "none";
  appState.contextMenuItemId = null;
  appState.contextMenuTableCtx = { tableId, r, c };
  showCanvasContextMenu(e.clientX, e.clientY);
}
function clearContextDeleteHighlight(): void {
  document
    .querySelectorAll(".ctx-del-highlight")
    .forEach((el) => el.classList.remove("ctx-del-highlight"));
}
// Real inline onmouseenter/onmouseleave target (content/fragments/canvas-context-menu.html) —
// plain global, no underscore.
export function highlightContextColumn(on: boolean): void {
  clearContextDeleteHighlight();
  const appState = getAppState();
  if (!on || !appState?.contextMenuTableCtx) return;
  const { tableId, c } = appState.contextMenuTableCtx;
  const itemId = window.__itemElId?.(tableId);
  document
    .querySelectorAll(`#${itemId} .item-table td[data-c="${c}"]`)
    .forEach((td) => td.classList.add("ctx-del-highlight"));
  const slot = document.querySelector(`#${itemId} .col-name-slot[data-c="${c}"]`);
  if (slot) slot.classList.add("ctx-del-highlight");
}
// Matched by [data-origin-table] rather than scoped to the table's own id like the column
// highlight above — a foreign row's tableId is never the id of anything actually in the DOM, and
// its data-r can collide with a local row sharing the same index, so both origin and row index
// are needed together to pick out the right <td>s. Real inline onmouseenter/onmouseleave target —
// plain global, no underscore.
export function highlightContextRow(on: boolean): void {
  clearContextDeleteHighlight();
  const appState = getAppState();
  if (!on || !appState?.contextMenuTableCtx) return;
  const { tableId, r } = appState.contextMenuTableCtx;
  document
    .querySelectorAll(`.item-table td[data-origin-table="${tableId}"][data-r="${r}"]`)
    .forEach((td) => td.classList.add("ctx-del-highlight"));
}
// Removing a column shifts every column after it down by one in the row data. Real inline
// onclick target — plain global, no underscore.
export function deleteContextColumn(): void {
  const appState = getAppState();
  const ctx = appState?.contextMenuTableCtx;
  hideCanvasContextMenu();
  if (!ctx) return;
  const it = window.__findItemById?.(ctx.tableId) as unknown as Item | undefined;
  if (!it?.tableData || it.tableData[0].length <= 1) return;
  saveSnapshot();
  it.tableData.forEach((row) => row.splice(ctx.c, 1));
  window.__render?.();
}
// Removing a row shifts every row after it up by one (data rows only — the header row at index 0
// is never deletable here), remapping the row-tag map (keyed by row index) the same way. Real
// inline onclick target — plain global, no underscore.
export function deleteContextRow(): void {
  const appState = getAppState();
  const ctx = appState?.contextMenuTableCtx;
  hideCanvasContextMenu();
  if (!ctx) return;
  const it = window.__resolveTableForEdit?.(ctx.tableId) as unknown as Item | undefined;
  if (!it?.tableData || ctx.r === 0 || it.tableData.length <= 2) return;
  saveSnapshot();
  it.tableData.splice(ctx.r, 1);
  if (it.cellTags) {
    const remapped: Record<string, unknown> = {};
    Object.keys(it.cellTags).forEach((key) => {
      const kr = Number(key);
      if (kr === ctx.r) return;
      remapped[kr > ctx.r ? kr - 1 : kr] = (it.cellTags as Record<string, unknown>)[key];
    });
    it.cellTags = remapped;
  }
  window.__render?.();
}

// #dot-layer's own CSS left/top (see layoutDotLayer) — a fixed, viewport-independent offset, NOT
// part of the scale/translate transform below. Needed to correctly phase-align the dot pattern
// with world-space coordinates.
function wrapPhase(v: number, period: number): number {
  return ((v % period) + period) % period;
}
export function applyTransform(): void {
  const appState = getAppState();
  const worldEl = window.__getWorldEl?.();
  const dotLayerEl = window.__getDotLayerEl?.();
  if (!appState || !worldEl || !dotLayerEl) return;
  worldEl.style.transform = `translate(${appState.tx}px, ${appState.ty}px) scale(${appState.scale})`;
  // Same `scale` the cards themselves use — no separate floor — so a card's position on the grid
  // stays exact at every zoom level, not just above some threshold.
  const period = 28 * appState.scale;
  const dx = wrapPhase(appState.tx - appState.dotLayerBaseX, period);
  const dy = wrapPhase(appState.ty - appState.dotLayerBaseY, period);
  dotLayerEl.style.transform = `translate(${dx}px, ${dy}px) scale(${appState.scale})`;
  updateZoomUI();
  updateContextMenuPosition();
  window.__repositionAllRemoteCursors?.();
  // Keeps OUR OWN cursor broadcast live while panning/zooming without any real mouse movement —
  // repositionAllRemoteCursors above only repositions everyone ELSE's cursor on our screen using
  // our new tx/ty; this is the symmetric other half, telling THEM where ours now is.
  window.__broadcastCursorPositionThrottled?.();
}
// Eases the camera to a new pan/zoom instead of snapping — used by every "jump to X" navigation
// (goToOutlineItem, goToWaypointCard) so the canvas visibly pans there rather than teleporting.
export function smoothPanTo(
  targetTx: number,
  targetTy: number,
  targetScale: number,
  durationMs = 450,
): void {
  const appState = getAppState();
  const worldEl = window.__getWorldEl?.();
  const dotLayerEl = window.__getDotLayerEl?.();
  if (!appState || !worldEl || !dotLayerEl) return;
  const transitionValue = `transform ${durationMs / 1000}s ease`;
  worldEl.style.transition = transitionValue;
  dotLayerEl.style.transition = transitionValue;
  appState.tx = targetTx;
  appState.ty = targetTy;
  appState.scale = targetScale;
  applyTransform();
  clearTimeout(appState.cameraTweenTimeout);
  // Capture world/dotLayer as locals rather than closing over a live binding that could get
  // reassigned by switchActivePane the moment the user switches panes, since this callback fires
  // later, asynchronously.
  const tweenWorld = worldEl,
    tweenDotLayer = dotLayerEl;
  appState.cameraTweenTimeout = setTimeout(() => {
    tweenWorld.style.transition = "";
    tweenDotLayer.style.transition = "";
  }, durationMs + 20);
}
// Keeps the dot-layer element itself big enough (and positioned) to always cover the screen no
// matter the current pan phase, at ZOOM_MIN — recomputed on load and on window resize.
export function layoutDotLayer(): void {
  const appState = getAppState();
  const dotLayerEl = window.__getDotLayerEl?.();
  if (!appState || !dotLayerEl) return;
  const w = window.innerWidth,
    h = window.innerHeight;
  const boxW = (w + appState.DOT_LAYER_MARGIN) / appState.ZOOM_MIN;
  const boxH = (h + appState.DOT_LAYER_MARGIN) / appState.ZOOM_MIN;
  dotLayerEl.style.width = boxW + "px";
  dotLayerEl.style.height = boxH + "px";
  dotLayerEl.style.left = appState.dotLayerBaseX + "px";
  dotLayerEl.style.top = appState.dotLayerBaseY + "px";
}
// Trackpad pinch-to-zoom fires `wheel` events far faster than the display can actually repaint —
// batching every call through here so at most one applyTransform() happens per animation frame.
export function scheduleApplyTransform(): void {
  const appState = getAppState();
  if (!appState || appState.applyTransformRafId !== null) return;
  appState.applyTransformRafId = requestAnimationFrame(() => {
    appState.applyTransformRafId = null;
    applyTransform();
  });
}
export function updateContextMenuPosition(): void {
  const appState = getAppState();
  const contextMenu = window.__getContextMenuEl?.();
  if (
    !appState ||
    !contextMenu ||
    contextMenu.style.display !== "flex" ||
    appState.contextMenuItemId == null
  )
    return;
  const it = window.__findItemById?.(appState.contextMenuItemId) as unknown as
    { x: number; y: number } | undefined;
  const el = window.__findItemEl?.(appState.contextMenuItemId);
  if (!it || !el) {
    contextMenu.style.display = "none";
    appState.contextMenuItemId = null;
    return;
  }
  const w = el.offsetWidth;
  contextMenu.style.left = appState.tx + (it.x + w) * appState.scale + 8 + "px";
  contextMenu.style.top = appState.ty + it.y * appState.scale + "px";
}
function updateZoomUI(): void {
  const appState = getAppState();
  const zoomTrack = window.__getZoomTrackEl?.();
  const zoomFill = window.__getZoomFillEl?.();
  const zoomThumb = window.__getZoomThumbEl?.();
  if (!appState || !zoomTrack || !zoomFill || !zoomThumb) return;
  const pct = Math.max(
    0,
    Math.min(1, (appState.scale - appState.ZOOM_MIN) / (appState.ZOOM_MAX - appState.ZOOM_MIN)),
  );
  const h = zoomTrack.clientHeight;
  const y = pct * h;
  zoomFill.style.height = y + "px";
  zoomThumb.style.bottom = y + "px";
}

function doWire(): void {
  const canvasEl = window.__getCanvasEl?.();
  if (canvasEl) setupCanvasContextMenu(canvasEl, 0);
  window.__registerPaneCanvasListenerSetup?.(setupCanvasContextMenu);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveWorkspaceNow();
  });
  window.addEventListener("pagehide", () => saveWorkspaceNow());

  // Paste anywhere in the app is always plain text — it takes on whatever formatting is already
  // active at the cursor, never the styling/markup carried over from wherever it was copied from.
  // Scoped to contentEditable only: plain <input>/<textarea> elements already paste as plain text
  // natively.
  document.addEventListener("paste", (e) => {
    const target = (e.target as HTMLElement)?.closest?.('[contenteditable="true"]');
    if (!target) return;
    e.preventDefault();
    const text = (
      (e as ClipboardEvent).clipboardData ||
      (window as unknown as { clipboardData: DataTransfer }).clipboardData
    )?.getData("text/plain");
    document.execCommand("insertText", false, text);
  });

  document.addEventListener("keydown", (e) => {
    const appState = getAppState();
    if (!appState) return;
    if (e.key === "Escape") {
      // Every hover/pin panel (menu, messages, cart, profile, add, collab, sourceAdd) plus every
      // standalone modal/overlay in the app, all in one go.
      window.__closeAllPanels?.();
      if (document.getElementById("search-cards-modal-overlay")?.classList.contains("open"))
        window.closeSearchCardsModal?.();
      window.closeSharedCanvasView?.();
      window.__closeDotbotUpgradeModal?.();
      window.__closePricingOverlay?.();
      window.__closeCellTagPicker?.();
      window.__closeUploadPopup?.();
      window.__clearSearch?.(); // also closes the search overlay + blurs the input
      // Was setDrawMode(false) — finishes (commits, or discards a stray single point) any
      // in-progress pen-tool polyline. Pen mode itself is exited separately, by the tap/hold
      // override logic in sourceButtonsCursorMode.ts.
      if (appState.penPolyline) window.__finishPenPolyline?.();
      if (appState.addingKind) window.__cancelAddingKind?.();
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    const active = document.activeElement;
    const isEditingText =
      active &&
      ((active as HTMLElement).isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");
    if (e.key === "z" || e.key === "Z") {
      if (isEditingText) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    // Cut/Paste whatever's currently selected as whole cards, the same independent copy an
    // Alt-drag duplicate produces, reachable without a drag. isEditingText/shiftKey/altKey are
    // all excluded so this never steals an ordinary text cut/paste happening inside a note body,
    // table cell, or title, and Cmd+X never fires alongside Shift+X's unrelated "link selected
    // cards" shortcut.
    if (
      !isEditingText &&
      !e.shiftKey &&
      !e.altKey &&
      (e.key === "x" || e.key === "X") &&
      appState.selectedCardIds.length > 0
    ) {
      e.preventDefault();
      window.cutSelectedCards?.();
      return;
    }
    if (
      !isEditingText &&
      !e.shiftKey &&
      !e.altKey &&
      (e.key === "v" || e.key === "V") &&
      appState.cardClipboard.length > 0
    ) {
      e.preventDefault();
      window.pasteClipboardCards?.();
      return;
    }
  });

  layoutDotLayer();
  window.addEventListener("resize", layoutDotLayer);
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — this needs live appState AND
// several already-existing DOM elements (canvas, dot-layer) right at wire time, same
// bridge-readiness-poll reasoning as every other Phase 4.4/4.5 wireX() port.
export function wireHistoryAutosave(): () => void {
  const ready = getAppState();
  if (ready && window.__getCanvasEl?.() && window.__getDotLayerEl?.()) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (getAppState() && window.__getCanvasEl?.() && window.__getDotLayerEl?.()) {
      clearInterval(poll);
      doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// Guarded (unlike this migration's other Phase 4.4/4.5 bridge blocks) because this is the first
// point in app/dotto-app.jsx's whole import graph where a bridge-setting module's top level
// actually runs during Next's server-side render pass: canvasItemBehavior.js (a plain .js file,
// deliberately zero-import before this port) now imports real functions from here, which pulls
// this module's top level in ahead of every other lib/*.ts file's own bridge assignments — and
// `window` genuinely doesn't exist yet at that point in SSR, a real reproducible 500 (confirmed
// via the dev server log, "ReferenceError: window is not defined"), not a false positive.
if (typeof window !== "undefined") {
  // React -> vanilla bridge — used by app/dotto/canvasItemBehavior.js's setupResizing/
  // setupDraggingAndClicking, same reasoning as window.__getAppState (app/dotto/lib/coreState.ts).
  window.__saveSnapshot = saveSnapshot;
  window.__scheduleWorkspaceSave = scheduleWorkspaceSave;
  window.__applyTransform = applyTransform;
  // Used by app/dotto/lib/outlineTree.ts's goToOutlineItem (Phase 4.4).
  window.__smoothPanTo = smoothPanTo;
  // Used by initializeNewPane (app/dotto/lib/coreState.ts) via this bridge rather than a direct import — that
  // file is imported BY this one, so importing back would be circular.
  window.__layoutDotLayer = layoutDotLayer;
  // Vanilla -> React bridges — ai-assistant-suggestions.js/card-shortcuts.js/app-init.js/
  // cards-misc.js/drag-drop-chat.js/drawing-connections.js/hamburger-collab.js/search-orchestration-
  // selection.js/command-verbs.js/srs-connections-core.js/window-bridge.js/table-grid-resize.js/
  // source-tags-ai.js/mnemonic-search-matching.js/waypoints-render-loop.js all previously imported
  // these directly.
  window.__loadWorkspace = loadWorkspace;
  window.__saveWorkspaceNow = saveWorkspaceNow;
  window.__scheduleApplyTransform = scheduleApplyTransform;
  window.__ensureSwTicking = ensureSwTicking;
  window.__updateContextMenuPosition = updateContextMenuPosition;
  window.__undo = undo;
  window.__redo = redo;
  window.__hideCanvasContextMenu = hideCanvasContextMenu;
  // Plain (non-`__`) globals — real inline onclick/onmouseenter/onmouseleave/oncontextmenu targets
  // (content/fragments/canvas-context-menu.html, canvasItemBehavior.js's cell markup), same shape
  // window.pushNotification/window.handleMarketplaceSearch use.
  window.undo = undo;
  window.redo = redo;
  window.hideCanvasContextMenu = hideCanvasContextMenu;
  window.deleteContextColumn = deleteContextColumn;
  window.deleteContextRow = deleteContextRow;
  window.highlightContextColumn = highlightContextColumn;
  window.highlightContextRow = highlightContextRow;
  window.openTableCellContextMenu = openTableCellContextMenu;
}
