"use client";

import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { useCollabListStore } from "./lib/collabListStore";
import type { CollabListRow } from "./lib/collabListStore";
import { goToCollaboratorCursor } from "./lib/canvasPresence";
import { handleCollabAddRemoveClick } from "./lib/friendsPresence";
import usePortalNode from "./usePortalNode";

// A live presence dot + clickable name only makes sense for someone who's both an actual
// collaborator here AND currently present on this exact canvas right now (r.isPresent, computed
// in renderCollabList) — not just anyone in the friends list.
function CollabRow({ r }: { r: CollabListRow & { query: string } }) {
  const label = r.added ? "Remove" : r.pending ? "Requested" : "Add";
  const nameClass = "collab-row-name" + (r.isPresent ? " collab-row-name-live" : "");

  return (
    <div className="collab-row">
      <Avatar
        className="collab-row-avatar"
        avatar={{ id: r.avatarId, url: r.avatarUrl }}
        name={r.displayName}
      />
      <div className="collab-row-meta">
        <div
          className={nameClass}
          onClick={
            r.isPresent
              ? (e) => {
                  e.stopPropagation();
                  goToCollaboratorCursor(r.id);
                }
              : undefined
          }
        >
          {r.displayName}
          {r.isPresent && <span className="collab-row-live-dot" />}
        </div>
      </div>
      <button
        className={"collab-add-btn" + (r.added ? " added" : "") + (r.pending ? " pending" : "")}
        disabled={r.pending}
        onClick={(e) => {
          e.stopPropagation();
          handleCollabAddRemoveClick(r.id, r.added, r.pending, r.query);
        }}
      >
        {label}
      </button>
    </div>
  );
}

// Portals into #collab-list (content/fragments/collab-panel.html) — a plain flex-item container,
// safe to portal into directly, same as #waypoints-list/#hub-collab-list/#msg-list.
export default function CollabListPanel() {
  const state = useCollabListStore();
  const portalNode = usePortalNode("collab-list");

  if (!portalNode) return null;

  if (!state.rows.length) {
    return createPortal(
      <div className="collab-empty">{state.query ? "No friends found." : "No friends yet."}</div>,
      portalNode,
    );
  }

  return createPortal(
    state.rows.map((r) => <CollabRow key={r.id} r={{ ...r, query: state.query }} />),
    portalNode,
  );
}
