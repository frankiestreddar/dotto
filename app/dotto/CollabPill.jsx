"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { collabPillStore } from "./bridges";

const EMPTY_STATE = { show: false, collabs: [], moreCount: 0 };

// Portals into #collab-content (content/fragments/top-bar.html) — a plain content wrapper inside
// #collab-bubble. #collab-bubble's own `.show` class and #collab-tooltip's text sit OUTSIDE the
// portal (siblings of #collab-content, not children of it), so they're synced imperatively below
// rather than through React — safe since nothing else ever writes to them (see collabPillStore's
// own comment in bridges.js). useLayoutEffect (not useEffect) so this is guaranteed to have run by
// the time the flushSync'd bridge call returns — openCollabPanel reads collabBubble's `.show`
// class synchronously right after one of its callers re-renders this pill.
export default function CollabPill() {
  const state = useSyncExternalStore(collabPillStore.subscribe, collabPillStore.getSnapshot, () => EMPTY_STATE);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("collab-content"));
  }, []);

  useLayoutEffect(() => {
    const bubble = document.getElementById("collab-bubble");
    const tooltip = document.getElementById("collab-tooltip");
    const total = state.collabs.length + state.moreCount;
    if (bubble) bubble.classList.toggle("show", state.show);
    if (tooltip) tooltip.textContent = total > 0 ? `${total} collaborator${total === 1 ? "" : "s"}` : "";
  }, [state]);

  if (!portalNode || !state.show) return null;

  if (!state.collabs.length) {
    return createPortal(
      <button id="collab-add-btn" title="Add collaborators" onClick={(e) => { e.stopPropagation(); window.__openCollabPanel(true); }}>+</button>,
      portalNode,
    );
  }

  return createPortal(
    <div className="collab-avatars">
      {state.collabs.map((f, i) => (
        <Avatar key={i} className="collab-avatar" avatar={{ id: f.avatarId, url: f.avatarUrl }} name={f.displayName} />
      ))}
      {state.moreCount > 0 && <div className="collab-avatar collab-more">+{state.moreCount}</div>}
    </div>,
    portalNode,
  );
}
