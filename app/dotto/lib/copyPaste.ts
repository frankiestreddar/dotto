// Phase 4.4 port of public/dotto/copy-paste.js: copy/cut/paste, the add-menu "placement ghost"
// preview, and prepareAdd (arming a placement). Reaches every still-vanilla dependency through
// window bridges — most already existed (window.__getCanvasEl/__getWorldEl/__findItemById/
// __saveSnapshot/__render/__renderSelectedOutlines), 5 are new as part of this port
// (__closeRailView, __applyCursorMode, __kindSize, __deleteSelectedCards,
// __registerPaneCanvasListenerSetup — see each one's own vanilla-side comment for why).

interface AppState {
  idCounter: number;
  folders: Record<string, { id: string; items: Item[]; collaborators: unknown[] }>;
  currentFolderId: string;
  selectedCardIds: number[];
  cardClipboard: Record<string, unknown>[];
  clipboardPasteCount: number;
  topCardZIndex: number;
  placementGhost: HTMLElement | null;
  addingKind: string | null;
  addingStatKind: string | null;
  cardMode: string;
  lastPointerClientX: number | null;
  lastPointerClientY: number | null;
  tx: number;
  ty: number;
  scale: number;
}

interface Item {
  id: number;
  kind: string;
  x?: number;
  y?: number;
  zIndex?: number;
  folderId?: string;
  [key: string]: unknown;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

// ---------- Copy / Cut / Paste (Cmd/Ctrl+C / X / V — see app/dotto/lib/historyAutosave.ts's own keydown
// handler) ----------
// Independent of the OS clipboard — an in-memory snapshot of whatever was selected at copy time.
// A folder/source card's real content lives in folders[] keyed by a live id that a Cut would
// otherwise delete out from under it (see cascadeDeleteFolderContents) before any Paste happens,
// so the snapshot has to carry a fully independent copy of that subtree, not just a folderId
// pointing at data that may no longer exist by paste time. Reset (and its cascading paste offset
// re-armed) every time something new is copied or cut; NOT cleared by pasting, so Cmd+V can be
// pressed repeatedly to stamp down more copies, same as any normal clipboard.

// Self-contained capture of a card for cardClipboard — same embed-nested-contents idea as
// snapshotItem (used for external chat/marketplace sharing, app/dotto/lib/messagingCanvasPreview.ts),
// kept as its own
// function since that one is optimized for a read-only, cross-account view (renderInlineCanvas),
// while this one needs to round-trip back into real, live folders[] data via
// materializeClipboardItem.
function snapshotItemForClipboard(it: Item): Record<string, unknown> {
  const appState = getAppState();
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(it));
  if (
    (it.kind === "folder" || it.kind === "source") &&
    it.folderId &&
    appState?.folders[it.folderId]
  ) {
    const srcFolder = appState.folders[it.folderId];
    const clipboardFolder: Record<string, unknown> = JSON.parse(JSON.stringify(srcFolder));
    clone.clipboardFolder = clipboardFolder;
    // recursive — nested folders/sources capture their own subtree too
    clipboardFolder.items = srcFolder.items.map(snapshotItemForClipboard);
  }
  return clone;
}

// Reverse of snapshotItemForClipboard — turns a captured snapshot into a real, freshly id'd canvas
// item, recreating a brand-new folders[] entry (recursively) for any folder/source content it
// carries. Same fresh-id/dropped-sharing-fields handling as deepCloneItem's Alt-drag duplicate,
// just sourced from a stored snapshot instead of a still-live item.
function materializeClipboardItem(snap: Record<string, unknown>): Item {
  const appState = getAppState();
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(snap));
  clone.id = appState ? appState.idCounter++ : Date.now();
  delete clone.clipboardFolder;
  const clipboardFolder = snap.clipboardFolder as Record<string, unknown> | undefined;
  if (clipboardFolder && appState) {
    const newFid = "folder-" + appState.idCounter++;
    const newFolder: Record<string, unknown> = JSON.parse(JSON.stringify(clipboardFolder));
    newFolder.id = newFid;
    newFolder.collaborators = []; // a paste starts with no collaborators of its own, same as an Alt-drag duplicate
    delete newFolder.isSharedView;
    delete newFolder.sharedOwnerId;
    delete newFolder.sharedRemoteFolderId;
    // recursive — nested folders/sources get their own fresh ids too
    newFolder.items = (clipboardFolder.items as Record<string, unknown>[]).map(
      materializeClipboardItem,
    );
    appState.folders[newFid] = newFolder as unknown as AppState["folders"][string];
    clone.folderId = newFid;
  }
  return clone as unknown as Item;
}

export function copySelectedCards(): void {
  const appState = getAppState();
  if (!appState || !appState.selectedCardIds.length) return;
  const items = appState.selectedCardIds
    .map((id) => window.__findItemById?.(id) as Item | undefined)
    .filter((it): it is Item => Boolean(it));
  if (!items.length) return;
  appState.cardClipboard = items.map(snapshotItemForClipboard);
  appState.clipboardPasteCount = 0;
}

export function cutSelectedCards(): void {
  const appState = getAppState();
  if (!appState || !appState.selectedCardIds.length) return;
  copySelectedCards();
  if (!appState.cardClipboard.length) return;
  window.__deleteSelectedCards?.(); // its own confirm()/saveSnapshot()/cascade cleanup — see its own comment
}

export function pasteClipboardCards(): void {
  const appState = getAppState();
  if (!appState || !appState.cardClipboard.length || !appState.folders[appState.currentFolderId])
    return;
  window.__saveSnapshot?.();
  appState.clipboardPasteCount++;
  const offset = appState.clipboardPasteCount * 28; // cascades further with each repeated paste, so stamping Cmd+V several times doesn't stack copies exactly on top of each other
  const pasted = appState.cardClipboard.map((snap) => {
    const clone = materializeClipboardItem(snap);
    clone.x = (clone.x || 0) + offset;
    clone.y = (clone.y || 0) + offset;
    appState.topCardZIndex++;
    clone.zIndex = appState.topCardZIndex;
    return clone;
  });
  appState.folders[appState.currentFolderId].items.push(...pasted);
  appState.selectedCardIds = pasted.map((it) => it.id);
  window.__render?.();
  window.__renderSelectedOutlines?.();
}

export function removePlacementGhost(): void {
  const appState = getAppState();
  if (appState?.placementGhost) {
    appState.placementGhost.remove();
    appState.placementGhost = null;
  }
}

// Shared by showPlacementGhost's own initial placement and the pointermove handler just below —
// same grid-snapped, viewport-to-world conversion either way, just fed a different (clientX,
// clientY) source.
function placementGhostWorldPos(clientX: number, clientY: number, kind: string) {
  const appState = getAppState();
  const canvasEl = window.__getCanvasEl?.();
  const rect = canvasEl?.getBoundingClientRect();
  const { w, h } = window.__kindSize?.(kind) ?? { w: 0, h: 0 };
  const tx = appState?.tx ?? 0;
  const ty = appState?.ty ?? 0;
  const scale = appState?.scale ?? 1;
  const left = rect?.left ?? 0;
  const top = rect?.top ?? 0;
  const x = Math.round(((clientX - left - tx) / scale - w / 2) / 28) * 28;
  const y = Math.round(((clientY - top - ty) / scale - h / 2) / 28) * 28;
  return { x, y };
}

function showPlacementGhost(kind: string): void {
  removePlacementGhost();
  const appState = getAppState();
  if (!appState) return;
  const { w, h } = window.__kindSize?.(kind) ?? { w: 0, h: 0 };
  const ghost = document.createElement("div");
  ghost.id = "placement-ghost";
  ghost.className = `item ${kind}`;
  ghost.style.width = w + "px";
  ghost.style.height = h + "px";
  ghost.style.opacity = "0.5";
  ghost.style.background = "transparent";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "999";
  appState.placementGhost = ghost;
  window.__getWorldEl?.()?.appendChild(ghost);
  // Per explicit bug report: a keyboard-triggered placement (the 'a'-chord, srs-connections-
  // core.js) never moves the mouse at all, so parking the ghost off-screen until the next real
  // pointermove left it (and the crosshair cursor feedback with it) invisible until the user
  // deliberately jiggled the mouse. lastPointerClientX/Y (app/dotto/lib/canvasPresence.ts,
  // mirrored onto appState) already tracks the cursor's real screen position on every canvas
  // pointermove regardless of
  // what triggered this — reusing it here means the ghost renders at the CURRENT cursor position
  // immediately, with the exact same math the live pointermove handler below already uses, no
  // movement required. Only falls back to off-screen in the (practically unreachable, since the
  // cursor has to be somewhere on the canvas to have triggered any of this in the first place)
  // case that no pointermove has ever fired yet this session.
  if (appState.lastPointerClientX != null && appState.lastPointerClientY != null) {
    const { x, y } = placementGhostWorldPos(
      appState.lastPointerClientX,
      appState.lastPointerClientY,
      kind,
    );
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
  } else {
    ghost.style.left = "-9999px";
    ghost.style.top = "-9999px";
  }
}

// Purely a visual preview (the actual placement, on click, always correctly uses whichever pane
// was clicked into — see setupCanvasLevelInteractionListeners, app/dotto/lib/srsConnectionsCore.ts) — no
// switchActivePane needed here, just re-attached per pane (split-screen Stage 4: see
// window.__registerPaneCanvasListenerSetup, app/dotto/lib/coreState.ts) so the ghost tracks the cursor over ANY
// pane, not just pane 0.
function setupPlacementGhostTracking(canvasEl: HTMLElement): void {
  canvasEl.addEventListener("pointermove", (e) => {
    const appState = getAppState();
    if (!appState?.addingKind || !appState.placementGhost) return;
    const { x, y } = placementGhostWorldPos(e.clientX, e.clientY, appState.addingKind);
    appState.placementGhost.style.left = x + "px";
    appState.placementGhost.style.top = y + "px";
  });
}

// How long to wait for window.__getCanvasEl/__registerPaneCanvasListenerSetup to be set before
// giving up — same readiness-poll shape wireDayChangeAndAdNotifications uses and for the same
// reason: this needs pane 0's own canvas element to exist and be reachable RIGHT at wire time (not
// lazily on a later interaction). app/dotto/lib/coreState.ts (which sets both bridges) is called
// from DottoApp's own render body via ensureCoreState() — earlier than this file's own wireX()
// poll could possibly run, in practice, but the poll is kept anyway rather than assumed: this
// file's own module evaluation, and the timing of whichever effect calls its wireX(), aren't
// something coreState.ts's own render-body timing can make any guarantee about from its side.
const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  const canvasEl = window.__getCanvasEl?.();
  if (canvasEl) setupPlacementGhostTracking(canvasEl);
  window.__registerPaneCanvasListenerSetup?.(setupPlacementGhostTracking);
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — wires pane 0's own canvas
// immediately, then registers so every future pane picks it up too (this module's own equivalent
// of the vanilla original's module-load-time setupPlacementGhostTracking(canvas) +
// registerPaneCanvasListenerSetup call).
export function wireCopyPaste(): () => void {
  if (window.__getCanvasEl && window.__registerPaneCanvasListenerSetup) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getCanvasEl && window.__registerPaneCanvasListenerSetup) {
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

// One real caller (handleBlockItemClick, app/dotto/lib/blocksPanel.ts) is only ever reached while
// the Blocks panel itself is the open rail view, so closeRailView here always closes that panel —
// plus a real inline onclick="prepareAdd('folder')" target (content/dotto-markup.html), which is
// why this stays a plain (non-`__`) global rather than a real ES import for blocksPanel.ts's own
// call.
export function prepareAdd(kind: string, statKind?: string | null): void {
  const appState = getAppState();
  if (!appState) return;
  appState.addingKind = kind;
  appState.addingStatKind = statKind || null;
  window.__closeRailView?.();
  window.__getCanvasEl?.()?.classList.add("crosshair");
  // Starting to place any card kind exits pen mode, same as opening the Blocks panel itself
  // already does (refreshBlocksPanel, app/dotto/lib/blocksPanel.ts) — was setDrawMode(false).
  if (appState.cardMode === "pen") {
    appState.cardMode = "normal";
    window.__applyCursorMode?.();
  }
  showPlacementGhost(kind);
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.copySelectedCards = copySelectedCards;
  window.cutSelectedCards = cutSelectedCards;
  window.pasteClipboardCards = pasteClipboardCards;
  window.removePlacementGhost = removePlacementGhost;
  window.prepareAdd = prepareAdd;
}
