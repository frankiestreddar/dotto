"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { sourcesListStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };

// .outline-item/.search-history-icon/.outline-label — the same row structure #chats-list's rows
// and #search-panel-content's rows use (ChatsListPanel.jsx/search-panel-history.js), both sharing
// .panel-history-list's own row override — matches this panel too, since #sources-panel-content
// carries that same class (see hamburger-stack.html). source.png reused from SourceCard.jsx/the
// old rail icon. No shift-click multi-select (unlike Waypoints/Collaborations/Chats) — deleting a
// source isn't part of what was asked for, so there's nothing for a selection to actually do here
// yet; a plain click just opens it, same as before this list existed at all (SourceCard.jsx's own
// click handler, attachSourceCardClick).
function SourceRow({ r }) {
  return (
    <div className="outline-item" onClick={(e) => { e.stopPropagation(); window.__openFolder(r.folderId); }}>
      <img className="search-history-icon" src="/assets/icons/source.png" alt="" />
      <span className="outline-label">{r.title}</span>
    </div>
  );
}

// Portals into #sources-panel-content (content/fragments/hamburger-stack.html) — a plain flex-item
// container, safe to portal into directly, no wrapper needed. Visibility of the panel itself stays
// a vanilla classList toggle (openRailView/wireRailIcon, panels-hamburger.js), unrelated to this —
// this component only owns the row list. Lists every kind:'source' item on the CURRENT canvas
// (appState.folders[currentFolderId].items), not every source anywhere in the whole workspace —
// see renderSourcesList's own comment, hamburger-collab.js, for the full reasoning and why it
// refreshes on every render() rather than just on panel-open/search-input.
export default function SourcesListPanel() {
  const state = useSyncExternalStore(sourcesListStore.subscribe, sourcesListStore.getSnapshot, () => EMPTY_STATE);
  const portalNode = usePortalNode("sources-panel-content");

  if (!portalNode) return null;

  return createPortal(
    state.rows.length ? (
      state.rows.map((r) => <SourceRow key={r.id} r={r} />)
    ) : (
      <div className="outline-empty">{state.query ? "No matching sources." : "No sources yet."}</div>
    ),
    portalNode,
  );
}
