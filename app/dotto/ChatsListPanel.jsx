"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { chatsListStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh array literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_ROWS = [];

function ChatRow({ r }) {
  return (
    <div
      className="outline-item"
      onClick={(e) => {
        e.stopPropagation();
        window.__openSavedChat(r.id);
      }}
    >
      <span className="outline-label">{r.title || "New chat"}</span>
    </div>
  );
}

// Portals into #chats-list (content/fragments/hamburger-stack.html) — structurally identical to
// WaypointsListPanel.jsx (a plain flex-item container, safe to portal into directly), minus the
// query-dependent empty-state message since this panel has no search box for v1.
export default function ChatsListPanel() {
  const rows = useSyncExternalStore(chatsListStore.subscribe, chatsListStore.getSnapshot, () => EMPTY_ROWS);
  const portalNode = usePortalNode("chats-list");

  if (!portalNode) return null;

  return createPortal(
    rows.length ? (
      rows.map((r) => <ChatRow key={r.id} r={r} />)
    ) : (
      <div className="outline-empty">No chats yet.</div>
    ),
    portalNode,
  );
}
