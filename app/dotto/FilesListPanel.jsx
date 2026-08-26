"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { filesListStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };

// Structural copy of SourcesListPanel.jsx's own SourceRow, per explicit request ("copy the sources
// panel to the files panel so it's consistent") — same .outline-item/.outline-label/.panel-
// history-list row shape every other sidebar list already shares, same RowActions hover-overlay
// share button. Trimmed of the things that don't apply to a file row: no double-click-to-rename (a
// file's name is its own mediaName/upload, not something renamed from here), no Option-held id
// reveal (files don't have a global id concept the way sources do), and no delayed-click-vs-
// dblclick dance as a result — a plain single click is enough.
// Click reuses window.__goToOutlineItem (goToOutlineItem, shared-canvases-outline.js) — navigates
// to the file's own containing folder if not already there, then pans/centers on and flashes its
// canvas card — the same primitive the Outline tree's own non-source rows already use for every
// other card kind, rather than a source's own "enter it directly" behavior (a file is a normal
// canvas card, not a full-page view of its own).
// r.onCanvas (whichever file's own folder IS the current canvas — computed in renderFilesList,
// hamburger-collab.js) only drives sort order here (current-canvas files first), unlike Sources'
// own r.active which also permanently highlights a row — a file's own folder isn't really "the
// current page" the way a source's is, so there's no equivalent single "you're here" row to mark.
function FileRow({ r }) {
  return (
    <div
      className="outline-item"
      onClick={(e) => { e.stopPropagation(); window.__goToOutlineItem(r.folderId, r.itemId); }}
    >
      <img className="search-history-icon" src="/assets/icons/files.png" alt="" />
      <span className="outline-label">{r.title}</span>
      <RowActions />
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
  const state = useSyncExternalStore(filesListStore.subscribe, filesListStore.getSnapshot, () => EMPTY_STATE);
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
