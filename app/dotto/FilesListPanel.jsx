"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { computePaneRects, filesListStore, paneLayoutStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };

// Below this many px of pointer movement, a pointerdown-then-up still counts as a plain click
// (open/navigate) rather than a drag — same threshold shape as TabsBar.jsx's own DRAG_THRESHOLD_PX.
const DRAG_THRESHOLD_PX = 4;

// Every currently-open pane's own screen box, in real pixels — identical copy of TabsBar.jsx's own
// getPaneRectsPx (not extracted to a shared util; both call sites are small and independent enough
// that a shared import wasn't worth the coupling). Used to hit-test which pane (if any) a dragged
// file row is currently over, and whether it's over that pane's own tab bar specifically.
function getPaneRectsPx() {
  const viewportEl = document.querySelector(".pane-grid-viewport");
  if (!viewportEl) return [];
  const vp = viewportEl.getBoundingClientRect();
  return computePaneRects(paneLayoutStore.getSnapshot()).map(({ paneId, rect }) => ({
    paneId,
    x: vp.left + rect.x * vp.width,
    y: vp.top + rect.y * vp.height,
    width: rect.w * vp.width,
    height: rect.h * vp.height,
  }));
}

// Clears any drop-target highlight left on a pane's own pill/canvas — called both on every
// pointermove (before re-applying whichever ONE target currently applies) and on drag end, so a
// highlight never gets stuck on a pane the cursor has since left.
function clearDropHighlights() {
  document
    .querySelectorAll(".file-drop-target-tab")
    .forEach((el) => el.classList.remove("file-drop-target-tab"));
  document
    .querySelectorAll(".file-drop-target-canvas")
    .forEach((el) => el.classList.remove("file-drop-target-canvas"));
}

// Structural copy of SourcesListPanel.jsx's own SourceRow, per explicit request ("copy the sources
// panel to the files panel so it's consistent") — same .outline-item/.outline-label/.panel-
// history-list row shape every other sidebar list already shares, same RowActions hover-overlay
// share button. Trimmed of the things that don't apply to a file row: no double-click-to-rename (a
// file's name is its own mediaName/upload, not something renamed from here), no Option-held id
// reveal (files don't have a global id concept the way sources do), and no delayed-click-vs-
// dblclick dance as a result — a plain single click is enough.
// Click reuses window.__goToOutlineItem (goToOutlineItem, app/dotto/lib/outlineTree.ts) — navigates
// to the file's own containing folder if not already there, then pans/centers on and flashes its
// canvas card — the same primitive the Outline tree's own non-source rows already use for every
// other card kind, rather than a source's own "enter it directly" behavior (a file is a normal
// canvas card, not a full-page view of its own).
// r.onCanvas (whichever file's own folder IS the current canvas — computed in renderFilesList,
// hamburger-collab.js) only drives sort order here (current-canvas files first), unlike Sources'
// own r.active which also permanently highlights a row — a file's own folder isn't really "the
// current page" the way a source's is, so there's no equivalent single "you're here" row to mark.
//
// RowActions' onOpen (open.png, per explicit request — corrected from an initial window.open()
// browser-tab version: "i didnt mean a new browser tab, i meant a new tab in the app, with the
// file full screen and scrollable") opens the file in a real tab of THIS app's own tab bar
// (window.__openMediaViewerTab, app/dotto/lib/tabManagement.ts) — a synthetic folder wrapping the item
// (isMediaViewer:true), rendered full-screen/scrollable by a dedicated branch in render()
// (waypoints-render-loop.js), riding the exact same tab/pane machinery every other tab already
// uses. window.__findItemById resolves the row's own itemId back to the real, live item object
// (mediaSrc/mediaType/mediaName) rather than this row carrying a stale copy. Omitted (falls back to
// RowActions' own "don't render the button" branch) for the rare row whose upload hasn't finished
// yet and so has no mediaSrc.
//
// Drag gesture (explicit request: "dragging a file from the sidebar onto canvas places it on
// canvas. dragging into the tab bar adds it as a full tab, switching to it automatically") — plain
// pointerdown/move/up, same convention every other drag in this codebase uses (TabsBar.jsx's own
// tab-drag-to-split, blocks-panel.js's setupContentItemDrag), never native HTML5 DnD. Below
// DRAG_THRESHOLD_PX still counts as a click (suppressClickRef, same pattern TabRow/TabsBar.jsx
// already uses); past it, a floating label ghost follows the cursor and every pane is hit-tested
// each move for whether the cursor is over that pane's own breadcrumb pill (drop → open as a
// media-viewer tab there) or elsewhere within that pane's own canvas box (drop → spawn a real copy
// of the file as a new card at that point, window.__spawnMediaItemAt). Released outside any pane
// (or on a row with no mediaSrc yet — an unfinished upload) just cancels, no drop.
function FileRow({ r }) {
  const suppressClickRef = useRef(false);
  const dragRef = useRef(null); // { startX, startY, dragging, targetPaneId, targetKind }
  const [drag, setDrag] = useState(null); // { clientX, clientY } while a real drag is in progress

  const handlePointerDown = (e) => {
    if (e.button !== 0 || !r.mediaSrc) return;
    if (e.target.closest(".outline-item-actions")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClickRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      targetPaneId: null,
      targetKind: null,
    };
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.dragging = true;
    }
    let targetPaneId = null,
      targetKind = null;
    for (const p of getPaneRectsPx()) {
      if (
        e.clientX < p.x ||
        e.clientX > p.x + p.width ||
        e.clientY < p.y ||
        e.clientY > p.y + p.height
      )
        continue;
      targetPaneId = p.paneId;
      const pill = document.getElementById("pane-breadcrumb-pill-" + p.paneId);
      const pillRect = pill && pill.getBoundingClientRect();
      const overPill =
        pillRect &&
        e.clientX >= pillRect.left &&
        e.clientX <= pillRect.right &&
        e.clientY >= pillRect.top &&
        e.clientY <= pillRect.bottom;
      targetKind = overPill ? "tab" : "canvas";
      break;
    }
    d.targetPaneId = targetPaneId;
    d.targetKind = targetKind;
    clearDropHighlights();
    if (targetKind === "tab") {
      document
        .getElementById("pane-breadcrumb-pill-" + targetPaneId)
        ?.classList.add("file-drop-target-tab");
    } else if (targetKind === "canvas") {
      document
        .getElementById(targetPaneId === 0 ? "canvas" : "canvas-" + targetPaneId)
        ?.classList.add("file-drop-target-canvas");
    }
    setDrag({ clientX: e.clientX, clientY: e.clientY });
  };

  const handlePointerUp = (e) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    const d = dragRef.current;
    dragRef.current = null;
    clearDropHighlights();
    if (d && d.dragging) {
      suppressClickRef.current = true;
      const item = window.__findItemById(r.itemId);
      if (item && d.targetKind === "tab") window.__openMediaViewerTab(item, d.targetPaneId);
      else if (item && d.targetKind === "canvas")
        window.__spawnMediaItemAt(item, e.clientX, e.clientY, d.targetPaneId);
    }
    setDrag(null);
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    window.__goToOutlineItem(r.folderId, r.itemId);
  };

  return (
    <div
      className="outline-item"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <img className="search-history-icon" src="/assets/icons/files.png" alt="" />
      <span className="outline-label">{r.title}</span>
      <RowActions
        onOpen={
          r.mediaSrc
            ? () => window.__openMediaViewerTab(window.__findItemById(r.itemId))
            : undefined
        }
      />
      {drag &&
        createPortal(
          <div
            className="file-row-drag-ghost"
            style={{ left: drag.clientX + 14, top: drag.clientY + 14 }}
          >
            {r.title}
          </div>,
          document.body,
        )}
    </div>
  );
}

// Portals into #files-panel-content (content/fragments/hamburger-stack.html) — a plain flex-item
// container, safe to portal into directly, no wrapper needed. Visibility of the panel itself stays
// a vanilla classList toggle (openRailView/wireRailIcon, panels-hamburger.js), unrelated to this —
// this component only owns the row list. Lists every uploaded file anywhere in the account,
// current-canvas ones sorted first — see renderFilesList's own comment, hamburger-collab.js, for
// the full reasoning and why it refreshes on every render() rather than just on panel-open/
// search-input (same as Sources/Outline/Tabs/Breadcrumb already do).
export default function FilesListPanel() {
  const state = useSyncExternalStore(
    filesListStore.subscribe,
    filesListStore.getSnapshot,
    () => EMPTY_STATE,
  );
  const portalNode = usePortalNode("files-panel-content");

  if (!portalNode) return null;

  return createPortal(
    state.rows.length ? (
      state.rows.map((r) => <FileRow key={r.id} r={r} />)
    ) : (
      <div className="outline-empty">{state.query ? "No matching files." : "No files yet."}</div>
    ),
    portalNode,
  );
}
