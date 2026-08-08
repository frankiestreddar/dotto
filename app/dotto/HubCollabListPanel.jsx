"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { hubCollabListStore } from "./bridges";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { view: "main", requestsCount: 0, ownedShown: [], sharedShown: [], query: "" };

function folderIconStyle() {
  const url = `/assets/icons/${window.__kindIconFile("folder")}`;
  return { maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` };
}

function RequestsRow({ count }) {
  return (
    <div className="outline-item requests-row" onClick={(e) => { e.stopPropagation(); window.__openHubCollabRequestsView(); }}>
      <span className="outline-label">Requests</span>
      <span className="requests-count">{count}</span>
    </div>
  );
}

// Own canvas that has collaborators — up to 3 avatars (same convention as the per-canvas collab
// bubble), hover shows the exact count via .hub-collab-avatars-tooltip, clicking navigates there
// AND opens its collaborator panel (managing it is the obvious next step from here).
function OwnedCanvasRow({ c }) {
  const shown = c.collaborators.slice(0, 3);
  return (
    <div className="outline-item hub-collab-canvas-row" onClick={(e) => { e.stopPropagation(); window.__handleOwnedHubCollabRowClick(c.folderId); }}>
      <span className="outline-icon icon-mask" style={folderIconStyle()} />
      <div className="hub-collab-row-meta">
        <span className="outline-label">{c.liveTitle}</span>
        <span className="hub-collab-row-owner">Owned by you</span>
      </div>
      <span className="hub-collab-avatars-tooltip">
        {c.collaborators.length} {c.collaborators.length === 1 ? "Collaborator" : "Collaborators"}
      </span>
      <div className="collab-avatars">
        {shown.map((f) => (
          <Avatar key={f.id} className="collab-avatar" avatar={{ id: f.avatarId, url: f.avatarUrl }} name={f.displayName} />
        ))}
        {c.collaborators.length > 3 && <div className="collab-avatar collab-more">+{c.collaborators.length - 3}</div>}
      </div>
    </div>
  );
}

// Canvas someone else shared with this user — single avatar (the owner).
function SharedCanvasRow({ c }) {
  return (
    <div
      className="outline-item hub-collab-canvas-row"
      onClick={(e) => { e.stopPropagation(); window.__openSharedCanvas(c.ownerId, c.folderId, c.folderTitle, c.ownerName); }}
    >
      <span className="outline-icon icon-mask" style={folderIconStyle()} />
      <div className="hub-collab-row-meta">
        <span className="outline-label">{c.liveTitle}</span>
        <span className="hub-collab-row-owner">Owned by {c.ownerName}</span>
      </div>
      <div className="collab-avatars">
        <Avatar className="collab-avatar" avatar={{ id: c.ownerAvatarId, url: c.ownerAvatarUrl }} name={c.ownerName} />
      </div>
    </div>
  );
}

function BackRow() {
  return (
    <div className="requests-back-row" onClick={(e) => { e.stopPropagation(); window.__backToHubCollabMain(); }}>
      <span>&larr;</span>
      <span>Requests</span>
    </div>
  );
}

function RequestRow({ req }) {
  return (
    <div className="msg-add-row">
      <div className="msg-chat-meta">
        <div className="msg-chat-name">{req.folderTitle}</div>
        <div className="collab-row-sub">from {req.ownerName}</div>
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        <button className="msg-add-btn hub-collab-accept" onClick={(e) => { e.stopPropagation(); window.__respondToHubCollabRequest(req.id, true); }}>
          Accept
        </button>
        <button className="msg-add-btn hub-collab-decline" onClick={(e) => { e.stopPropagation(); window.__respondToHubCollabRequest(req.id, false); }}>
          Decline
        </button>
      </div>
    </div>
  );
}

// Portals into #hub-collab-list (content/fragments/hamburger-stack.html) — a plain flex-item
// container, safe to portal into directly, same as #waypoints-list. Visibility of the panel
// ITSELF (vs. outline/waypoints) and which sub-view is showing (hubCollabView) stay vanilla —
// this component only owns the row list for whichever view is currently active.
export default function HubCollabListPanel() {
  const state = useSyncExternalStore(hubCollabListStore.subscribe, hubCollabListStore.getSnapshot, () => EMPTY_STATE);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("hub-collab-list"));
  }, []);

  if (!portalNode) return null;

  if (state.view === "requests") {
    return createPortal(
      <>
        <BackRow />
        {state.requests.length ? (
          state.requests.map((req) => <RequestRow key={req.id} req={req} />)
        ) : (
          <div className="outline-empty">No pending requests.</div>
        )}
      </>,
      portalNode,
    );
  }

  const hasRows = state.ownedShown.length || state.sharedShown.length;

  return createPortal(
    <>
      {state.requestsCount > 0 && <RequestsRow count={state.requestsCount} />}
      {hasRows ? (
        <>
          {state.ownedShown.map((c) => <OwnedCanvasRow key={c.folderId} c={c} />)}
          {state.sharedShown.map((c) => <SharedCanvasRow key={c.id} c={c} />)}
        </>
      ) : (
        <div className="outline-empty">{state.query ? "No matching canvases." : "No collaborations yet."}</div>
      )}
    </>,
    portalNode,
  );
}
