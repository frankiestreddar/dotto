"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { hubCollabListStore, listPanelSelectionStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { view: "main", requestsCount: 0, ownedShown: [], sharedShown: [], query: "" };
const EMPTY_IDS = new Set();
const EMPTY_SELECTION = { panel: null, ids: EMPTY_IDS };

function folderIconStyle() {
  const url = `/assets/icons/${window.__kindIconFile("folder")}`;
  return { maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` };
}

function RequestsRow({ count }) {
  return (
    <div
      className="outline-item requests-row"
      onClick={(e) => {
        e.stopPropagation();
        window.__openHubCollabRequestsView();
      }}
    >
      <span className="outline-label">Requests</span>
      <span className="requests-count">{count}</span>
    </div>
  );
}

// Own canvas that has collaborators — up to 3 avatars (same convention as the per-canvas collab
// bubble), hover shows the exact count via .hub-collab-avatars-tooltip, clicking navigates there
// AND opens its collaborator panel (managing it is the obvious next step from here). Selection id
// is prefixed "owned:" — shares one listPanelSelectionStore ids Set with SharedCanvasRow's
// "shared:" ids below (folderId and a canvas_collaborations row's own bigint id are two unrelated
// id spaces), and lets the delete dispatcher (dispatchListPanelDelete, hamburger-collab.js) tell
// the two apart with no extra lookup — deleting an "owned:" id removes every collaborator via
// deleteCanvasCollabsForFolder; a "shared:" id leaves that canvas via leave_canvas_collaboration.
function OwnedCanvasRow({ c, selected }) {
  const shown = c.collaborators.slice(0, 3);
  return (
    <div
      className={"outline-item hub-collab-canvas-row" + (selected ? " outline-item-selected" : "")}
      data-select-id={"owned:" + c.folderId}
      onClick={(e) => {
        e.stopPropagation();
        // Selecting (both a plain shift+click and a shift+click-drag across several rows) is
        // handled entirely by setupListPanelDragSelect (hamburger-collab.js), listening on the
        // stable #hub-collab-list container rather than here — this guard just stops a shift+click
        // from ALSO running the normal row-click action below.
        if (e.shiftKey) return;
        window.__handleOwnedHubCollabRowClick(c.folderId);
      }}
    >
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
          <Avatar
            key={f.id}
            className="collab-avatar"
            avatar={{ id: f.avatarId, url: f.avatarUrl }}
            name={f.displayName}
          />
        ))}
        {c.collaborators.length > 3 && (
          <div className="collab-avatar collab-more">+{c.collaborators.length - 3}</div>
        )}
      </div>
      {/* Overlays on top of .collab-avatars' own right-edge position on hover (both want the same
          spot) — an accepted first-pass overlap for now, same as every other row type's own share
          button (RowActions' own comment). */}
      <RowActions />
    </div>
  );
}

// Canvas someone else shared with this user — single avatar (the owner). Selection id prefixed
// "shared:" — see OwnedCanvasRow's own comment.
function SharedCanvasRow({ c, selected }) {
  return (
    <div
      className={"outline-item hub-collab-canvas-row" + (selected ? " outline-item-selected" : "")}
      data-select-id={"shared:" + c.id}
      onClick={(e) => {
        e.stopPropagation();
        // Selecting (both a plain shift+click and a shift+click-drag across several rows) is
        // handled entirely by setupListPanelDragSelect (hamburger-collab.js), listening on the
        // stable #hub-collab-list container rather than here — this guard just stops a shift+click
        // from ALSO running the normal row-click action below.
        if (e.shiftKey) return;
        window.__openSharedCanvas(c.ownerId, c.folderId, c.folderTitle, c.ownerName);
      }}
    >
      <span className="outline-icon icon-mask" style={folderIconStyle()} />
      <div className="hub-collab-row-meta">
        <span className="outline-label">{c.liveTitle}</span>
        <span className="hub-collab-row-owner">Owned by {c.ownerName}</span>
      </div>
      <div className="collab-avatars">
        <Avatar
          className="collab-avatar"
          avatar={{ id: c.ownerAvatarId, url: c.ownerAvatarUrl }}
          name={c.ownerName}
        />
      </div>
      <RowActions />
    </div>
  );
}

function BackRow() {
  return (
    <div
      className="requests-back-row"
      onClick={(e) => {
        e.stopPropagation();
        window.__backToHubCollabMain();
      }}
    >
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
        <button
          className="msg-add-btn hub-collab-accept"
          onClick={(e) => {
            e.stopPropagation();
            window.__respondToHubCollabRequest(req.id, true);
          }}
        >
          Accept
        </button>
        <button
          className="msg-add-btn hub-collab-decline"
          onClick={(e) => {
            e.stopPropagation();
            window.__respondToHubCollabRequest(req.id, false);
          }}
        >
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
  const state = useSyncExternalStore(
    hubCollabListStore.subscribe,
    hubCollabListStore.getSnapshot,
    () => EMPTY_STATE,
  );
  const selection = useSyncExternalStore(
    listPanelSelectionStore.subscribe,
    listPanelSelectionStore.getSnapshot,
    () => EMPTY_SELECTION,
  );
  const selectedIds = selection.panel === "collaborations" ? selection.ids : EMPTY_IDS;
  const portalNode = usePortalNode("hub-collab-list");

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
          {state.ownedShown.map((c) => (
            <OwnedCanvasRow
              key={c.folderId}
              c={c}
              selected={selectedIds.has("owned:" + c.folderId)}
            />
          ))}
          {state.sharedShown.map((c) => (
            <SharedCanvasRow key={c.id} c={c} selected={selectedIds.has("shared:" + c.id)} />
          ))}
        </>
      ) : (
        <div className="outline-empty">
          {state.query ? "No matching canvases." : "No collaborations yet."}
        </div>
      )}
    </>,
    portalNode,
  );
}
