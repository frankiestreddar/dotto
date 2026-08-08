"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { msgListStore } from "./bridges";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { view: "main", requestsCount: 0, matchedFriends: [], searchResults: [], query: "" };

function RequestsRow({ count }) {
  return (
    <div className="outline-item requests-row" onClick={(e) => { e.stopPropagation(); window.__openMsgRequestsView(); }}>
      <span className="outline-label">Requests</span>
      <span className="requests-count">{count}</span>
    </div>
  );
}

// Clicking opens the real conversation thread — still vanilla (see renderMsgList's own comment in
// friends-presence.js for why: that's part of the much larger "Live canvas presence" cluster, not
// this list).
function ChatRow({ f }) {
  return (
    <div className="msg-chat-row" onClick={() => window.__openConvo(f.id)}>
      <Avatar className="msg-avatar" avatar={{ id: f.avatarId, url: f.avatarUrl }} name={f.displayName} />
      <div className="msg-chat-meta">
        <div className="msg-chat-name">{f.displayName}</div>
        <div className="msg-chat-preview">{f.preview}</div>
      </div>
    </div>
  );
}

function AddFriendRow({ u, query }) {
  return (
    <div className="msg-add-row">
      <div className="msg-chat-meta">
        <div className="msg-chat-name">@{u.username}</div>
      </div>
      <button
        className="msg-add-btn"
        disabled={u.pending}
        onClick={(e) => { e.stopPropagation(); window.__handleAddFriendClick(u.id, query); }}
      >
        {u.pending ? "Requested" : "Add"}
      </button>
    </div>
  );
}

function BackRow() {
  return (
    <div className="requests-back-row" onClick={(e) => { e.stopPropagation(); window.__backToMsgMain(); }}>
      <span>&larr;</span>
      <span>Requests</span>
    </div>
  );
}

function FriendRequestRow({ req }) {
  return (
    <div className="msg-add-row">
      <div className="msg-chat-meta">
        <div className="msg-chat-name">@{req.username}</div>
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        <button className="msg-add-btn msg-req-accept" onClick={(e) => { e.stopPropagation(); window.__respondToMsgRequest(req.id, true); }}>
          Accept
        </button>
        <button className="msg-add-btn msg-req-decline" onClick={(e) => { e.stopPropagation(); window.__respondToMsgRequest(req.id, false); }}>
          Decline
        </button>
      </div>
    </div>
  );
}

// Portals into #msg-list (content/fragments/messages-panel.html) — a plain flex-item container,
// safe to portal into directly, same as #waypoints-list/#hub-collab-list.
export default function MessagesListPanel() {
  const state = useSyncExternalStore(msgListStore.subscribe, msgListStore.getSnapshot, () => EMPTY_STATE);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("msg-list"));
  }, []);

  if (!portalNode) return null;

  if (state.view === "requests") {
    return createPortal(
      <>
        <BackRow />
        {state.requests.length ? (
          state.requests.map((req) => <FriendRequestRow key={req.id} req={req} />)
        ) : (
          <div className="msg-empty">No pending requests.</div>
        )}
      </>,
      portalNode,
    );
  }

  const hasContent = state.matchedFriends.length || state.searchResults.length;

  return createPortal(
    <>
      {state.requestsCount > 0 && <RequestsRow count={state.requestsCount} />}
      {state.matchedFriends.length > 0 && (
        <>
          <div className="msg-section-label">Chats</div>
          {state.matchedFriends.map((f) => <ChatRow key={f.id} f={f} />)}
        </>
      )}
      {state.searchResults.length > 0 && (
        <>
          <div className="msg-section-label">Add a friend</div>
          {state.searchResults.map((u) => <AddFriendRow key={u.id} u={u} query={state.query} />)}
        </>
      )}
      {!hasContent && <div className="msg-empty">{state.query ? "No chats or usernames found." : "No conversations yet."}</div>}
    </>,
    portalNode,
  );
}
