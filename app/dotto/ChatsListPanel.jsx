"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { chatsListStore, listPanelSelectionStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh array literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_ROWS = [];
const EMPTY_IDS = new Set();
const EMPTY_SELECTION = { panel: null, ids: EMPTY_IDS };

function ChatRow({ r, selected }) {
  return (
    <div
      className={"outline-item" + (selected ? " outline-item-selected" : "")}
      data-select-id={r.id}
      onClick={(e) => {
        e.stopPropagation();
        // Selecting (both a plain shift+click and a shift+click-drag across several rows) is
        // handled entirely by setupListPanelDragSelect (hamburger-collab.js), listening on the
        // stable #chats-list container rather than here — this guard just stops a shift+click
        // from ALSO opening the chat below.
        if (e.shiftKey) return;
        window.__openSavedChat(r.id);
      }}
    >
      {/* .search-history-icon (globals.css) reused as-is — per explicit request that this row
          look like #search-panel's own history rows (search-panel-history.js), just with
          query.png instead of search.png. Row itself stays .outline-item, not
          .search-history-row: this one still needs to work with setupListPanelDragSelect's
          shift-click-drag selection (data-select-id/.outline-item-selected above), which that
          class was never wired into. */}
      <img className="search-history-icon" src="/assets/icons/query.png" alt="" />
      <span className="outline-label">{r.title || "New chat"}</span>
    </div>
  );
}

// Portals into #chats-list (content/fragments/hamburger-stack.html) — structurally identical to
// WaypointsListPanel.jsx (a plain flex-item container, safe to portal into directly), minus the
// query-dependent empty-state message since this panel has no search box for v1.
export default function ChatsListPanel() {
  const rows = useSyncExternalStore(chatsListStore.subscribe, chatsListStore.getSnapshot, () => EMPTY_ROWS);
  const selection = useSyncExternalStore(listPanelSelectionStore.subscribe, listPanelSelectionStore.getSnapshot, () => EMPTY_SELECTION);
  const selectedIds = selection.panel === "chats" ? selection.ids : EMPTY_IDS;
  const portalNode = usePortalNode("chats-list");

  if (!portalNode) return null;

  return createPortal(
    rows.length ? (
      rows.map((r) => <ChatRow key={r.id} r={r} selected={selectedIds.has(r.id)} />)
    ) : (
      <div className="outline-empty">No chats yet.</div>
    ),
    portalNode,
  );
}
