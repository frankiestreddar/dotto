"use client";

import { createPortal } from "react-dom";
import { useChatsListStore } from "./lib/chatsListStore";
import { useListPanelSelectionStore } from "./lib/listPanelSelectionStore";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";
import { openSavedChat } from "./lib/hamburgerCollab";

const EMPTY_IDS = new Set();

function ChatRow({ r, selected }) {
  return (
    <div
      className={"outline-item" + (selected ? " outline-item-selected" : "")}
      data-select-id={r.id}
      onClick={(e) => {
        e.stopPropagation();
        // Selecting (both a plain shift+click and a shift+click-drag across several rows) is
        // handled entirely by setupListPanelDragSelect (app/dotto/lib/hamburgerCollab.ts),
        // listening on the stable #chats-list container rather than here — this guard just stops
        // a shift+click from ALSO opening the chat below.
        if (e.shiftKey) return;
        openSavedChat(r.id);
      }}
    >
      {/* .search-history-icon (globals.css) reused as-is — same row structure #search-panel's own
          history rows use (app/dotto/lib/searchPanelHistory.ts), both sharing .panel-history-list's row
          override, just with query.png instead of search.png. Row itself is .outline-item, not a
          bespoke class, so it keeps working with setupListPanelDragSelect's shift-click-drag
          selection (data-select-id/.outline-item-selected above). */}
      <img className="search-history-icon" src="/assets/icons/query.png" alt="" />
      <span className="outline-label">{r.title || "New chat"}</span>
      <RowActions />
    </div>
  );
}

// Portals into #chats-list (content/fragments/hamburger-stack.html) — structurally identical to
// WaypointsListPanel.jsx (a plain flex-item container, safe to portal into directly), minus the
// query-dependent empty-state message since this panel has no search box for v1.
export default function ChatsListPanel() {
  const rows = useChatsListStore();
  const selection = useListPanelSelectionStore();
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
