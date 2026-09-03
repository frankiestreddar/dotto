// Phase 4.5 port of public/dotto/live-presence.js's "card-preview/messaging DOM" concern (per the
// migration plan's own split of this file's 3 bundled concerns) — mini read-only canvas previews
// (chat/marketplace/drafts snapshot cards, the pannable/zoomable inline canvas widget), snapshot/
// sanitize helpers for exporting cards off the live canvas, and the chat conversation panel's own
// send/close/title-level plumbing. MsgConvo.jsx/SharedCanvasModalBody.jsx/TitleCard.jsx were
// already real React components calling into this concern via window bridges before this port —
// upgraded to real ES imports now that both sides live in the same app/dotto/ tree (same precedent
// stopwatch.ts/MediaCard.jsx/TableCard.jsx established), keeping the bridges only for the
// still-vanilla callers. See canvasPresence.ts for the other bundled concern (realtime presence/
// content-sync) and its own findItemById/placeCaretEnd. miniIconForKind (the original file's own
// dead code — CARD_KINDS[kind]?.icon lookup, never called anywhere but its own definition) was
// dropped rather than carried over. Reaches every still-vanilla dependency through window bridges.

import { renderStopwatchHTML, type StopwatchItem } from "./stopwatch";
import { searchKindLabel } from "./addMenu";

interface Item {
  id: number;
  kind: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  folderId?: string;
  html?: string;
  level?: number;
  tableData?: string[][];
  tasks?: { text: string; done: boolean }[];
  embedUrl?: string;
  mediaSrc?: string;
  mediaType?: string;
  cards?: unknown[];
  fcOrder?: number[];
  fcIndex?: number;
  fcFlipped?: boolean;
  fcStats?: Record<string, number>;
  fcSeenCount?: number;
  trOrder?: number[];
  trIndex?: number;
  trInput?: string;
  trChecked?: boolean;
  trStats?: Record<string, number>;
  trSeenCount?: number;
  statKind?: string;
  userSized?: boolean;
  snapshotChildren?: Item[];
  snapshotTitle?: string;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  connections?: { fromId: number; toId: number }[];
}
interface Friend {
  id: string;
  friendshipId: string;
  displayName?: string;
  avatarId?: number;
  avatarUrl?: string | null;
  messages: {
    id: string;
    senderId: string;
    text: string;
    canvasSnapshot?: Item[];
    createdAt: string;
  }[];
  [key: string]: unknown;
}
interface AppState {
  currentFolderId: string;
  folders: Record<string, FolderObj>;
  idCounter: number;
  tx: number;
  ty: number;
  scale: number;
  currentUser: { id: string | null };
  friends: Friend[];
  activeConvoId: string | null;
  msgConvo: HTMLElement;
  msgList: HTMLElement;
  msgSearchInput: HTMLInputElement;
  msgView: string;
  messagesPanel: HTMLElement;
  inlineCanvasDeleteMenuEl?: HTMLElement;
  CardStreamIO: Record<string, { outputs?: string[] }>;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

export function renderMsgSnapshotCard(item: Item): HTMLElement {
  const card = document.createElement("div");
  card.className = "msg-snapshot-card";

  const header = document.createElement("div");
  header.className = "snap-header";
  header.textContent = searchKindLabel(item);
  card.appendChild(header);

  if (item.kind === "title") {
    const titleEl = document.createElement("div");
    titleEl.className = "snap-title";
    titleEl.innerHTML = item.html || "Untitled Title";
    card.appendChild(titleEl);
  } else if (item.kind === "table") {
    const tableWrap = document.createElement("div");
    tableWrap.className = "overflow-x-auto";
    const table = document.createElement("table");
    table.className = "snap-table";
    const tbody = document.createElement("tbody");
    (item.tableData || []).forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        td.innerHTML = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
  } else if (item.kind === "checklist") {
    const rowsWrap = document.createElement("div");
    rowsWrap.className = "flex flex-col gap-1";
    (item.tasks || []).forEach((t) => {
      const row = document.createElement("div");
      row.className = "snap-checklist-row";
      row.innerHTML = `<input type="checkbox" ${t.done ? "checked" : ""} disabled>
                    <span class="snap-checklist-text" style="${t.done ? "text-decoration:line-through;opacity:.5;" : ""}">${window.__escapeHtml?.(t.text || "Task")}</span>`;
      rowsWrap.appendChild(row);
    });
    card.appendChild(rowsWrap);
  } else if (item.kind === "embed") {
    card.innerHTML += `<div class="flex items-center gap-2"><span class="text-sm">🌐</span><span class="font-semibold truncate">${window.__escapeHtml?.(item.embedUrl ? (window.__shortUrl?.(item.embedUrl) ?? "") : "Embed")}</span></div>`;
  } else if (item.kind === "media") {
    if (item.mediaSrc) {
      const tag =
        item.mediaType === "video"
          ? `<video src="${item.mediaSrc}" class="w-full h-24 object-cover rounded" muted controls></video>`
          : `<img src="${item.mediaSrc}" class="w-full h-24 object-cover rounded"/>`;
      card.innerHTML += tag;
    } else {
      card.innerHTML += `<div class="text-[11px] text-slate-500 italic">Empty media card</div>`;
    }
  } else if (item.kind === "watermark") {
    card.innerHTML += `<div class="text-xs opacity-50 italic">${window.__escapeHtml?.(item.html || "Watermark text")}</div>`;
  } else {
    // Default note / text card
    const body = document.createElement("div");
    body.className = "snap-body";
    body.innerHTML = item.html || '<span class="text-slate-500 italic">Empty note</span>';
    card.appendChild(body);
  }
  return card;
}

// Deep-clones an item for sharing (chat) or packaging (marketplace draft). Folder/source items
// additionally embed a self-contained, recursive copy of their own nested contents
// (snapshotChildren/snapshotTitle) — a plain clone only carries a dangling folderId, which means
// nothing once the snapshot leaves the account that made it (a friend viewing a shared card, or a
// marketplace listing viewed by its buyer, has no access to the sharer's live `folders`).
// Embedding the contents directly is what lets renderInlineCanvas click into a nested folder/
// source card and actually show something, for anyone who views it.
export function snapshotItem(it: Item): Item {
  const appState = getAppState();
  const clone: Item = JSON.parse(JSON.stringify(it));
  if ((it.kind === "folder" || it.kind === "source") && appState?.folders[it.folderId as string]) {
    clone.snapshotChildren = appState.folders[it.folderId as string].items.map(snapshotItem);
    clone.snapshotTitle = appState.folders[it.folderId as string].title;
  }
  return clone;
}

// Same source-of-truth rule as the live disconnect reset in propagateCanvasStreams, applied at
// export time: a flashcard snapshot leaving the canvas (marketplace, chat, search card context)
// only gets to keep real word data if the table/source/folder it's actually connected to on the
// LIVE canvas is also part of this same export batch. Otherwise the clone is neutered to the
// generic placeholder deck — the live canvas item is never touched, only the copy. Call right
// after snapshotItem(it), passing every id in the same gesture.
export function sanitizeFlashcardSnapshot(snapshot: Item, batchItemIds: number[]): Item {
  if (snapshot.kind !== "flashcard" && snapshot.kind !== "typeright") return snapshot;
  const appState = getAppState();
  const folder = appState?.folders[appState.currentFolderId];
  const conns = folder?.connections || [];
  const sourceComesToo = conns.some((c) => {
    const otherId = c.fromId === snapshot.id ? c.toId : c.toId === snapshot.id ? c.fromId : null;
    if (!otherId || !batchItemIds.includes(otherId)) return false;
    const other = folder?.items.find((i) => i.id === otherId);
    return (
      other &&
      appState?.CardStreamIO[other.kind] &&
      (appState.CardStreamIO[other.kind].outputs || []).includes("content")
    );
  });
  if (!sourceComesToo) {
    if (snapshot.kind === "flashcard") {
      snapshot.cards = window.__defaultFlashcardDeck?.() ?? [];
      snapshot.fcOrder = [];
      snapshot.fcIndex = 0;
      snapshot.fcFlipped = false;
      snapshot.fcStats = {};
      snapshot.fcSeenCount = 0;
    } else {
      snapshot.cards = [];
      snapshot.trOrder = [];
      snapshot.trIndex = 0;
      snapshot.trInput = "";
      snapshot.trChecked = false;
      snapshot.trStats = {};
      snapshot.trSeenCount = 0;
    }
  }
  return snapshot;
}

export function miniLabelForItem(item: Item): string {
  const appState = getAppState();
  if (item.kind === "table") return "Table";
  if (item.kind === "checklist") return "Checklist";
  if (item.kind === "flashcard") return "Flashcards";
  if (item.kind === "typeright") return "Typeright";
  if (item.kind === "statcard") return item.statKind === "accuracy" ? "Accuracy" : "Progress";
  if (item.kind === "stopwatch") return "Stopwatch";
  if (item.kind === "shelf") return (item.shelfName as string) || "Stack";
  if (item.kind === "folder" || item.kind === "source") {
    return (item.folderId && appState?.folders[item.folderId]?.title) || "Folder";
  }
  const text = window.__stripHtml?.(item.html || "") ?? "";
  return text
    ? text.slice(0, 24)
    : item.kind
      ? item.kind[0].toUpperCase() + item.kind.slice(1)
      : "Card";
}

// Builds a read-only replica of a card exactly as it appears on the real canvas (same classes/
// markup/content as the main render() loop), for use inside the inline chat canvas preview. No
// editing handlers are attached.
export function renderRealCardPreview(it: Item): HTMLElement {
  const appState = getAppState();
  const el = document.createElement("div");
  el.className = `item ${it.kind}`;

  if (it.kind === "folder") {
    const f = appState?.folders[it.folderId as string];
    el.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;"><span style="opacity:0.8;">↗</span>${f ? f.title : "Folder"}</div>
                <div style="font-size:12px;opacity:0.6;">${f ? f.items.length : 0} items</div>
            </div>`;
  } else if (it.kind === "source") {
    const f = appState?.folders[it.folderId as string];
    const count = window.__countSourceEntries?.(it.folderId as string) ?? 0;
    el.innerHTML = `${window.__kindIconHTML?.("source", undefined, "source-card-icon")}
            <div class="source-card-info">
                <span class="source-card-title">${f ? f.title : ""}</span>
                <span class="source-card-count">${count} ${count === 1 ? "entry" : "entries"}</span>
            </div>`;
  } else if (it.kind === "title") {
    el.style.fontSize = titleFontSize(it.level || 1) + "px";
    el.innerHTML = `<div class="body">${it.html || ""}</div>`;
  } else if (it.kind === "table") {
    el.innerHTML = window.__renderTableHTML?.(it as unknown as Record<string, unknown>) ?? "";
    if (it.userSized) el.classList.add("sized");
  } else if (it.kind === "media") {
    el.innerHTML = window.__renderMediaHTML?.(it as unknown as Record<string, unknown>) ?? "";
  } else if (it.kind === "embed") {
    // Static placeholder, not a live iframe — this renders into mini inline-canvas previews
    // (folder cards, chat/marketplace snapshots) where several might be on screen at once,
    // unlike the single live card in render() (see EmbedCard.jsx).
    el.innerHTML = `<div class="embed-icon">🌐</div>
                <div class="embed-title">${it.embedUrl ? window.__shortUrl?.(it.embedUrl) : "New Embed"}</div>`;
  } else if (it.kind === "checklist") {
    el.innerHTML = window.__renderChecklistHTML?.(it as unknown as Record<string, unknown>) ?? "";
  } else if (it.kind === "watermark") {
    el.innerHTML = `<div class="body watermark-text">${it.html || ""}</div>`;
  } else if (it.kind === "flashcard") {
    el.innerHTML = window.__renderFlashcardHTML?.(it as unknown as Record<string, unknown>) ?? "";
  } else if (it.kind === "typeright") {
    el.innerHTML = window.__renderTypeRightHTML?.(it as unknown as Record<string, unknown>) ?? "";
  } else if (it.kind === "statcard") {
    el.innerHTML = window.__renderStatcardHTML?.(it as unknown as Record<string, unknown>) ?? "";
  } else if (it.kind === "stopwatch") {
    el.innerHTML = renderStopwatchHTML(it as unknown as StopwatchItem);
  } else if (it.kind === "shelf") {
    el.innerHTML = window.__renderShelfHTML?.(it as unknown as Record<string, unknown>) ?? "";
  } else {
    el.innerHTML = `<div class="body">${it.html || ""}</div>`;
  }
  return el;
}

// Renders a set of shared cards as a real pannable/zoomable mini canvas, preserving their
// relative x/y layout. The viewer is read-only (pan + zoom only, no editing or moving cards).
// Dragging the handle above it out onto the main app canvas imports the cards there. Renders a
// set of packaged/shared cards as a small read-only canvas preview. Visually identical everywhere
// it's used (chat, marketplace, drafts, publish flow) — the only functional difference
// draggableOut controls is whether the top-left tab lets you drag the currently-shown cards out
// onto your real canvas (chat only; marketplace/draft previews are look-only). Clicking a folder/
// source card drills into its own packaged contents (see snapshotChildren on snapshotItem) using
// a navigation stack local to this one widget, with its own back/forward arrows — independent of,
// and without touching, the real app's canvas navigation. No other card kind is clickable.
// A single shared floating "Delete" row, reused by every renderInlineCanvas instance that passes
// onDelete (currently only the search card-context popup) — deliberately separate from the real
// per-card #context-menu / contextMenuItemId, since these mini previews aren't real canvas items.
function showInlineCanvasDeleteMenu(x: number, y: number, onConfirm: () => void): void {
  const appState = getAppState();
  if (!appState) return;
  if (!appState.inlineCanvasDeleteMenuEl) {
    appState.inlineCanvasDeleteMenuEl = document.createElement("div");
    appState.inlineCanvasDeleteMenuEl.id = "inline-canvas-delete-menu";
    appState.inlineCanvasDeleteMenuEl.className = "inline-canvas-delete-menu";
    appState.inlineCanvasDeleteMenuEl.innerHTML = `<div class="menu-item">Delete</div>`;
    document.body.appendChild(appState.inlineCanvasDeleteMenuEl);
    document.addEventListener("pointerdown", (e) => {
      if (!appState.inlineCanvasDeleteMenuEl!.contains(e.target as Node))
        appState.inlineCanvasDeleteMenuEl!.style.display = "none";
    });
  }
  appState.inlineCanvasDeleteMenuEl.style.left = x + "px";
  appState.inlineCanvasDeleteMenuEl.style.top = y + "px";
  appState.inlineCanvasDeleteMenuEl.style.display = "flex";
  (appState.inlineCanvasDeleteMenuEl.querySelector(".menu-item") as HTMLElement).onclick = (e) => {
    e.stopPropagation();
    appState.inlineCanvasDeleteMenuEl!.style.display = "none";
    onConfirm();
  };
}

// `connections` and `onDelete` are optional, used only by the search card-context popup (see
// openSearchCardsModal): connections draw simple non-interactive lines between the top-level
// items they reference (never inside a drilled-into folder/source level, which is a different,
// unrelated item set), and onDelete — when provided — wires a right-click "Delete" row onto each
// top-level mini card.
export function renderInlineCanvas(
  items: Item[],
  draggableOut?: boolean,
  connections?: { fromId: number; toId: number }[],
  onDelete?: (id: number) => void,
): HTMLElement {
  if (draggableOut === undefined) draggableOut = true;
  const wrap = document.createElement("div");
  wrap.className = "msg-inline-canvas-wrap";

  const viewport = document.createElement("div");
  viewport.className = "msg-inline-canvas";
  const world = document.createElement("div");
  world.className = "msg-inline-canvas-world";
  viewport.appendChild(world);
  wrap.appendChild(viewport);

  let navStack: { items: Item[]; isSource: boolean; title: string | null }[] = [
    { items, isSource: false, title: null },
  ];
  let navIndex = 0;

  let dragTab: HTMLElement | null = null;
  if (draggableOut) {
    dragTab = document.createElement("div");
    dragTab.className = "msg-inline-canvas-drag-tab";
    dragTab.innerHTML = `<span>⠿</span>`;
    dragTab.title = "Drag onto your canvas";
    viewport.appendChild(dragTab);
  }

  const navBar = document.createElement("div");
  navBar.className = "msg-inline-canvas-nav";
  navBar.innerHTML = `<button class="msg-inline-canvas-nav-btn" data-dir="back" title="Back">‹</button><button class="msg-inline-canvas-nav-btn" data-dir="fwd" title="Forward">›</button>`;
  viewport.appendChild(navBar);
  const navBackBtn = navBar.querySelector<HTMLButtonElement>('[data-dir="back"]')!;
  const navFwdBtn = navBar.querySelector<HTMLButtonElement>('[data-dir="fwd"]')!;

  const zoomBar = document.createElement("div");
  zoomBar.className = "msg-inline-canvas-zoom";
  zoomBar.innerHTML = `<div class="msg-inline-canvas-zoom-track">
            <div class="msg-inline-canvas-zoom-fill"></div>
            <div class="msg-inline-canvas-zoom-thumb"></div>
        </div>`;
  viewport.appendChild(zoomBar);
  const zoomTrackMini = zoomBar.querySelector<HTMLElement>(".msg-inline-canvas-zoom-track")!;
  const zoomFillMini = zoomBar.querySelector<HTMLElement>(".msg-inline-canvas-zoom-fill")!;
  const zoomThumbMini = zoomBar.querySelector<HTMLElement>(".msg-inline-canvas-zoom-thumb")!;

  // ---- Pan (drag) & zoom (slider only; no wheel/pinch response) — normal levels only ----
  const MINI_ZOOM_MIN = 0.2,
    MINI_ZOOM_MAX = 2,
    MINI_ZOOM_FIT_MIN = 0.4,
    MINI_ZOOM_FIT_PADDING = 24;
  let vZoom = 1,
    vPanX = 0,
    vPanY = 0,
    contentW = 1,
    contentH = 1;
  function applyView() {
    world.style.transform = `translate(${vPanX}px, ${vPanY}px) scale(${vZoom})`;
    viewport.style.backgroundPosition = `${vPanX}px ${vPanY}px`;
    viewport.style.backgroundSize = `${28 * vZoom}px ${28 * vZoom}px`;
  }
  function updateZoomBarUI() {
    const pct = Math.max(0, Math.min(1, (vZoom - MINI_ZOOM_MIN) / (MINI_ZOOM_MAX - MINI_ZOOM_MIN)));
    const trackW = zoomTrackMini.clientWidth;
    const x = pct * trackW;
    zoomFillMini.style.width = x + "px";
    zoomThumbMini.style.left = x + "px";
  }
  // Default zoom fits all of the level's content in the viewport with a little padding, never
  // going below MINI_ZOOM_FIT_MIN (40%) even if the content is too big to fully fit — it'll just
  // spill past the edges/need panning at that floor rather than shrink further.
  function centerView() {
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fitZoom = Math.min(
      (rect.width - MINI_ZOOM_FIT_PADDING * 2) / contentW,
      (rect.height - MINI_ZOOM_FIT_PADDING * 2) / contentH,
    );
    vZoom = Math.max(MINI_ZOOM_FIT_MIN, Math.min(MINI_ZOOM_MAX, fitZoom));
    vPanX = (rect.width - contentW * vZoom) / 2;
    vPanY = (rect.height - contentH * vZoom) / 2;
    applyView();
    updateZoomBarUI();
  }

  function updateNavUI() {
    navBackBtn.disabled = navIndex === 0;
    navFwdBtn.disabled = navIndex === navStack.length - 1;
  }

  function renderCurrentLevel() {
    const level = navStack[navIndex];
    world.innerHTML = "";
    updateNavUI();

    if (level.isSource) {
      viewport.classList.add("is-source");
      zoomBar.style.display = "none";
      world.style.width = "100%";
      world.style.height = "100%";
      world.style.transform = "translate(0,0) scale(1)";
      renderSourcePreview(level);
      return;
    }
    viewport.classList.remove("is-source");
    zoomBar.style.display = "";
    world.style.width = "";
    world.style.height = "";

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    level.items.forEach((it) => {
      const w = it.w || 100,
        h = it.h || 60;
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + w);
      maxY = Math.max(maxY, it.y + h);
    });
    contentW = Math.max(1, maxX - minX);
    contentH = Math.max(1, maxY - minY);

    const isTopLevel = navIndex === 0;
    const centers: Record<number, { x: number; y: number }> = {};
    level.items.forEach((it) => {
      const w = it.w || 100,
        h = it.h || 60;
      // Render the actual card (same markup, text and sizing as the real canvas item)
      const mini = renderRealCardPreview(it);
      mini.style.position = "absolute";
      mini.style.left = it.x - minX + "px";
      mini.style.top = it.y - minY + "px";
      if (it.kind !== "title") {
        mini.style.width = w + "px";
        mini.style.height = h + "px";
      }
      mini.title = miniLabelForItem(it);
      centers[it.id] = { x: it.x - minX + w / 2, y: it.y - minY + h / 2 };

      const openable =
        (it.kind === "folder" || it.kind === "source") && Array.isArray(it.snapshotChildren);
      if (openable) {
        mini.style.pointerEvents = "auto";
        mini.style.cursor = "pointer";
        mini.addEventListener("click", (e) => {
          e.stopPropagation();
          openInlineLevel(it);
        });
      } else {
        mini.style.pointerEvents = "none";
      }
      if (isTopLevel && onDelete) {
        mini.style.pointerEvents = "auto";
        mini.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          showInlineCanvasDeleteMenu(e.clientX, e.clientY, () => {
            onDelete(it.id);
          });
        });
      }
      world.appendChild(mini);
    });

    if (isTopLevel && connections && connections.length) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "msg-inline-canvas-connections");
      svg.style.position = "absolute";
      svg.style.left = "0";
      svg.style.top = "0";
      svg.style.width = contentW + "px";
      svg.style.height = contentH + "px";
      svg.style.overflow = "visible";
      svg.style.pointerEvents = "none";
      connections.forEach((c) => {
        const a = centers[c.fromId],
          b = centers[c.toId];
        if (!a || !b) return;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(a.x));
        line.setAttribute("y1", String(a.y));
        line.setAttribute("x2", String(b.x));
        line.setAttribute("y2", String(b.y));
        line.setAttribute("stroke", "var(--brand)");
        line.setAttribute("stroke-width", "2");
        svg.appendChild(line);
      });
      world.appendChild(svg);
    }

    requestAnimationFrame(centerView);
  }

  function openInlineLevel(it: Item) {
    // Drilling in truncates any forward history, same convention as the main app's own back/
    // forward stack.
    navStack = navStack.slice(0, navIndex + 1);
    navStack.push({
      items: it.snapshotChildren || [],
      isSource: it.kind === "source",
      title: it.snapshotTitle || miniLabelForItem(it),
    });
    navIndex++;
    renderCurrentLevel();
  }
  navBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (navIndex > 0) {
      navIndex--;
      renderCurrentLevel();
    }
  });
  navFwdBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (navIndex < navStack.length - 1) {
      navIndex++;
      renderCurrentLevel();
    }
  });

  // ---- Source level: a plain drag-to-scroll (vertical only) table, no click functionality at
  // all — mirrors how source pages behave in the real app (no pan/zoom, no dot grid).
  function renderSourcePreview(level: { items: Item[] }) {
    const tableItem = (level.items || []).find((i) => i.kind === "table");
    const scroller = document.createElement("div");
    scroller.className = "msg-inline-canvas-source-scroll";
    if (tableItem) {
      const tableWrap = document.createElement("div");
      tableWrap.className = "msg-inline-canvas-source-table";
      tableWrap.innerHTML =
        window.__renderTableHTML?.(tableItem as unknown as Record<string, unknown>) ?? "";
      tableWrap.style.pointerEvents = "none";
      scroller.appendChild(tableWrap);
    }
    world.appendChild(scroller);

    let scrollDragging = false,
      scrollStartY = 0,
      startScrollTop = 0;
    scroller.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      scrollDragging = true;
      scrollStartY = e.clientY;
      startScrollTop = scroller.scrollTop;
      scroller.setPointerCapture(e.pointerId);
    });
    scroller.addEventListener("pointermove", (e) => {
      if (!scrollDragging) return;
      scroller.scrollTop = startScrollTop - (e.clientY - scrollStartY);
    });
    scroller.addEventListener("pointerup", () => {
      scrollDragging = false;
    });
    scroller.addEventListener("pointercancel", () => {
      scrollDragging = false;
    });
  }

  // Panning only starts on true background clicks — not on an openable card (that's a click-to-
  // open instead), and not on a source level (that scrolls instead of panning).
  let panning = false,
    panStartX = 0,
    panStartY = 0,
    startPanX = 0,
    startPanY = 0;
  viewport.addEventListener("pointerdown", (e) => {
    if (navStack[navIndex].isSource) return;
    if (
      (e.target as HTMLElement).closest(
        ".item, .msg-inline-canvas-drag-tab, .msg-inline-canvas-nav, .msg-inline-canvas-zoom",
      )
    )
      return;
    e.stopPropagation();
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    startPanX = vPanX;
    startPanY = vPanY;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!panning) return;
    vPanX = startPanX + (e.clientX - panStartX);
    vPanY = startPanY + (e.clientY - panStartY);
    applyView();
  });
  viewport.addEventListener("pointerup", () => {
    panning = false;
  });
  viewport.addEventListener("pointercancel", () => {
    panning = false;
  });

  // Zoom slider — identical range/behavior to the main canvas zoom control, just horizontal
  function setZoomFromClientX(clientX: number) {
    const rect = zoomTrackMini.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    const newZoom = MINI_ZOOM_MIN + pct * (MINI_ZOOM_MAX - MINI_ZOOM_MIN);
    const vpRect = viewport.getBoundingClientRect();
    const cx = vpRect.width / 2,
      cy = vpRect.height / 2;
    const worldX = (cx - vPanX) / vZoom,
      worldY = (cy - vPanY) / vZoom;
    vPanX = cx - worldX * newZoom;
    vPanY = cy - worldY * newZoom;
    vZoom = newZoom;
    applyView();
    updateZoomBarUI();
  }
  zoomTrackMini.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    zoomTrackMini.classList.add("dragging");
    setZoomFromClientX(e.clientX);
    const move = (me: PointerEvent) => setZoomFromClientX(me.clientX);
    const up = () => {
      zoomTrackMini.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  // ---- Drag the top-left tab out of the chat onto the main app canvas, importing whichever
  // level is currently shown ----
  if (dragTab) {
    dragTab.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      let dragStarted = false,
        dragGhost: HTMLElement | null = null;
      const startX = e.clientX,
        startY = e.clientY;
      const move = (me: PointerEvent) => {
        if (!dragStarted) {
          if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
          dragStarted = true;
          const n = navStack[navIndex].items.length;
          dragGhost = document.createElement("div");
          dragGhost.className = "inline-canvas-drag-ghost";
          dragGhost.textContent = `${n} card${n === 1 ? "" : "s"} — drop onto your canvas`;
          document.body.appendChild(dragGhost);
        }
        dragGhost!.style.left = me.clientX + 14 + "px";
        dragGhost!.style.top = me.clientY + 14 + "px";
      };
      const up = (ue: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (dragGhost) dragGhost.remove();
        if (!dragStarted) return;
        const appState = getAppState();
        const canvasEl = window.__getCanvasEl?.();
        if (!appState || !canvasEl) return;
        const panelRect = appState.messagesPanel.getBoundingClientRect();
        const overPanel =
          ue.clientX >= panelRect.left &&
          ue.clientX <= panelRect.right &&
          ue.clientY >= panelRect.top &&
          ue.clientY <= panelRect.bottom;
        if (overPanel) return; // dropped back inside the chat panel, no-op
        const canvasRect = canvasEl.getBoundingClientRect();
        const overCanvas =
          ue.clientX >= canvasRect.left &&
          ue.clientX <= canvasRect.right &&
          ue.clientY >= canvasRect.top &&
          ue.clientY <= canvasRect.bottom;
        if (!overCanvas) return;
        importSharedCardsAtScreenPoint(navStack[navIndex].items, ue.clientX, ue.clientY);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  renderCurrentLevel();
  return wrap;
}

// Drops a shared set of cards onto the working canvas at the given screen point, preserving their
// relative layout.
export function importSharedCardsAtScreenPoint(
  items: Item[],
  clientX: number,
  clientY: number,
): void {
  const appState = getAppState();
  const canvasEl = window.__getCanvasEl?.();
  if (!appState || !canvasEl) return;
  window.__saveSnapshot?.();
  const rect = canvasEl.getBoundingClientRect();
  const dropX = Math.round((clientX - rect.left - appState.tx) / appState.scale / 28) * 28;
  const dropY = Math.round((clientY - rect.top - appState.ty) / appState.scale / 28) * 28;
  let minX = Infinity,
    minY = Infinity;
  items.forEach((it) => {
    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
  });
  items.forEach((it) => {
    const clone: Item = JSON.parse(JSON.stringify(it));
    clone.id = appState.idCounter++;
    clone.x = dropX + (it.x - minX);
    clone.y = dropY + (it.y - minY);
    appState.folders[appState.currentFolderId].items.push(clone);
  });
  window.__render?.();
  window.__closeMessagesPanel?.();
}

// Real React state now (see app/dotto/SharedCanvasModalBody.jsx, sharedCanvasModalStore) — the
// list itself is genuine JSX-owned, but each item's own card content still comes from
// renderMsgSnapshotCard (below), ref-mounted — same "vanilla builds live DOM, React just mounts
// it" pattern as InlineCanvasPreview, since that function builds real per-kind DOM (tables,
// checklists, media), not something worth re-expressing as JSX. The overlay's own open/close
// class toggle and the title text stay vanilla (plain attribute writes on the modal shell, not on
// anything React portals into).
export function openSharedCanvasView(items: Item[]): void {
  const titleEl = document.getElementById("canvas-modal-title");
  if (titleEl) titleEl.textContent = "Shared Card";
  window.__setSharedCanvasModal?.({ items } as unknown as Record<string, unknown>);
  document.getElementById("canvas-modal-overlay")?.classList.add("open");
}
// Real inline onclick target (content/fragments/canvas-modal.html) — plain global, no underscore.
export function closeSharedCanvasView(): void {
  document.getElementById("canvas-modal-overlay")?.classList.remove("open");
}

// Real React state now (see app/dotto/MsgConvo.jsx, msgConvoStore) — the header (avatar/title) and
// the message list are genuine JSX; each canvas-snapshot message's own card content still comes
// from renderInlineCanvas/renderMsgSnapshotCard, ref-mounted, same reasoning as
// SharedCanvasModalBody above. Not flushSync'd: every caller (openConvo, sendMsg, the realtime
// message-insert handler in app/dotto/lib/friendsPresence.ts) has no synchronous DOM read right
// after — the scrollTop-to-bottom reset that used to happen here now lives in a useLayoutEffect inside
// MsgConvo.jsx itself, so it stays correctly synchronous with THAT component's own commit
// regardless of whether the store update that triggered it was flushSync'd.
export function renderConvoBody(f: Friend): void {
  window.__setMsgConvo?.({
    friendId: f.id,
    displayName: f.displayName,
    avatarId: f.avatarId ?? 0,
    avatarUrl: f.avatarUrl || null,
    messages: f.messages,
  } as unknown as Record<string, unknown>);
}
export function openConvo(friendId: string): void {
  const appState = getAppState();
  if (!appState) return;
  appState.activeConvoId = friendId;
  const f = appState.friends.find((x) => x.id === friendId);
  if (!f) return;
  // #msg-convo (and #msg-convo-body inside it) is display:none until the 'open' class is added —
  // made visible BEFORE renderConvoBody runs, since setting scrollTop on a still-hidden 0-height
  // element is a no-op that doesn't stick once it becomes visible afterward (this is what
  // silently broke the always-start-at-the-bottom reset; the actual reset now happens in a
  // useLayoutEffect, see MsgConvo.jsx, but the same ordering still matters for it).
  const searchWrap = document.getElementById("msg-search-wrap");
  if (searchWrap) searchWrap.style.display = "none";
  appState.msgList.style.display = "none";
  appState.msgConvo.classList.add("open");
  renderConvoBody(f);
}
// Real inline onclick target (content/fragments/hamburger-stack.html) — plain global, no
// underscore.
export function closeConvo(): void {
  const appState = getAppState();
  if (!appState) return;
  appState.msgConvo.classList.remove("open");
  appState.activeConvoId = null;
  // No unsubscribe here — messages are subscribed per-friendship globally now (see
  // subscribeToAllFriendMessages), not per open conversation.
  const searchWrap = document.getElementById("msg-search-wrap");
  if (searchWrap) searchWrap.style.display = "";
  appState.msgList.style.display = "";
  // The list underneath was built once, whenever the panel first opened (or last searched) —
  // sendMsg/the realtime message-insert handler both push straight onto f.messages without ever
  // re-running renderMsgList, so its preview text (lastPreview) would otherwise still show
  // whatever was there before this conversation started, even after sending/receiving messages
  // in it. Only refresh if the list is actually what's showing next (not the Requests drill-down).
  if (appState.msgView === "main") window.__renderMsgList?.(appState.msgSearchInput.value);
}
// Real inline onclick target (content/fragments/hamburger-stack.html) — plain global, no
// underscore.
export async function sendMsg(): Promise<void> {
  const appState = getAppState();
  const supabaseClient = window.__dottoSupabase;
  if (!appState || !supabaseClient) return;
  const input = document.getElementById("msg-convo-input") as HTMLInputElement | null;
  const text = input?.value.trim();
  if (!text || !appState.activeConvoId || !input) return;
  const f = appState.friends.find((x) => x.id === appState.activeConvoId);
  if (!f) return;
  input.value = "";
  updateMsgSendState();
  const { data, error } = await supabaseClient
    .from("messages")
    .insert({ friendship_id: f.friendshipId, sender_id: appState.currentUser.id, body: text })
    .select()
    .single();
  if (error) {
    console.error("[chat] failed to send message:", error);
    return;
  }
  f.messages.push({
    id: data.id,
    senderId: data.sender_id,
    text: data.body,
    canvasSnapshot: data.canvas_snapshot,
    createdAt: data.created_at,
  });
  renderConvoBody(f);
  window.__awardUserPoints?.("send_chat_message", 2);
}
// Send button lights up brand-purple once there's actually something to send, instead of staying
// the same dim grey whether the box is empty or full.
function updateMsgSendState(): void {
  const input = document.getElementById("msg-convo-input") as HTMLInputElement | null;
  document
    .getElementById("msg-convo-send")
    ?.classList.toggle("has-text", (input?.value.trim().length ?? 0) > 0);
}

export function titleFontSize(level: number): number {
  return level === 3 ? 18 : level === 2 ? 22 : 28;
}
// Real inline onchange target (was called via window.setTitleLevel by TitleCard.jsx before this
// port — now a real ES import there instead, kept as a plain global too since it's the same shape
// window.pushNotification/window.handleMarketplaceSearch use).
export function setTitleLevel(id: number, level: string | number): void {
  const appState = getAppState();
  const it = appState?.folders[appState.currentFolderId].items.find((i) => i.id === id);
  if (!it) return;
  window.__saveSnapshot?.();
  it.level = parseInt(String(level));
  const el = window.__findItemEl?.(id);
  if (el) el.style.fontSize = titleFontSize(it.level) + "px";
}

function rgbToHex(rgb: string): string {
  if (!rgb) return "#ffffff";
  if (rgb.startsWith("#")) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m) return "#ffffff";
  return (
    "#" +
    m
      .slice(0, 3)
      .map((n) => (+n).toString(16).padStart(2, "0"))
      .join("")
  );
}
export function syncColorPicker(bodyEl: HTMLElement): void {
  const picker = bodyEl
    .closest(".item")
    ?.querySelector<HTMLInputElement>(".format-bar input[type=color]");
  if (!picker) return;
  try {
    const val = document.queryCommandValue("foreColor");
    let hex = rgbToHex(val);
    if (!val || hex === "#000000") {
      const sel = window.getSelection();
      let node: Node | null = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : bodyEl;
      if (node && node.nodeType === 3) node = node.parentElement;
      if (node && bodyEl.contains(node)) {
        hex = rgbToHex(getComputedStyle(node as Element).color);
      } else {
        hex = rgbToHex(getComputedStyle(bodyEl).color);
      }
    }
    picker.value = hex;
  } catch {
    // Same silent-catch as the original — queryCommandValue can throw in some browsers/states.
  }
}

function doWire(): void {
  const convoInput = document.getElementById("msg-convo-input") as HTMLInputElement | null;
  // Stops keys from leaking out to other keyboard shortcuts while typing a message — except
  // Escape, which must still bubble up to the global handler so it can close the panel even
  // while this input has focus (increasingly common now that typing anywhere auto-focuses it).
  convoInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") e.stopPropagation();
  });
  convoInput?.addEventListener("input", updateMsgSendState);
  // Typing anywhere while a conversation is open (without having clicked into the message box
  // first) focuses it and lets the same keystroke land there — so you can just start typing a
  // reply the moment a chat opens, rather than needing to click the input first.
  document.addEventListener("keydown", (e) => {
    const appState = getAppState();
    if (!appState || !appState.msgConvo.classList.contains("open")) return;
    const input = document.getElementById("msg-convo-input") as HTMLInputElement | null;
    if (!input || document.activeElement === input) return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return; // only real printable characters — not Enter/Escape/arrows/Tab/etc.
    input.focus();
  });
  const msgSearchInput = getAppState()?.msgSearchInput;
  msgSearchInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") e.stopPropagation();
  });
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs live appState (for
// appState.msgSearchInput) AND #msg-convo-input already existing, same bridge-readiness-poll
// reasoning as every other Phase 4.4/4.5 wireX() port.
export function wireMessagingCanvasPreview(): () => void {
  const ready = getAppState();
  if (ready && document.getElementById("msg-convo-input")) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (getAppState() && document.getElementById("msg-convo-input")) {
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

// React -> vanilla bridges (see the identical pattern/comment in app/dotto/lib/cardsMisc.ts) — used by
// TitleCard.jsx/MsgConvo.jsx/SharedCanvasModalBody.jsx/CollabListPanel.jsx/FilesListPanel.jsx/
// MessagesListPanel.jsx/MarketDetailPanel.jsx/TableCard.jsx, all now real ES imports there instead
// (same app/dotto/ tree) — kept declared/assigned since still-vanilla callers need them too.
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__syncColorPicker = syncColorPicker;
  window.__titleFontSize = titleFontSize;
  window.__renderRealCardPreview = renderRealCardPreview;
  window.__renderInlineCanvas = renderInlineCanvas;
  window.__renderMsgSnapshotCard = renderMsgSnapshotCard;
  window.__openSharedCanvasView = openSharedCanvasView;
  window.__miniLabelForItem = miniLabelForItem;
  window.__snapshotItem = snapshotItem;
  window.__sanitizeFlashcardSnapshot = sanitizeFlashcardSnapshot;
  // Vanilla -> React bridges — blocks-panel.js/friends-presence.js/messages-schedule.js/drag-drop-
  // chat.js/library-publish.js/window-bridge.js all previously imported these directly.
  window.__importSharedCardsAtScreenPoint = importSharedCardsAtScreenPoint;
  window.__openConvo = openConvo;
  window.__renderConvoBody = renderConvoBody;
  // Plain (non-`__`) globals — real inline onclick targets (content/fragments/hamburger-stack.html/
  // canvas-modal.html), same shape window.pushNotification/window.handleMarketplaceSearch use.
  window.closeConvo = closeConvo;
  window.sendMsg = sendMsg;
  window.closeSharedCanvasView = closeSharedCanvasView;
  window.setTitleLevel = setTitleLevel;
}
