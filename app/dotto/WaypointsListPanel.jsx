"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { waypointsListStore } from "./bridges";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };

function WaypointRow({ r }) {
  const iconUrl = `/assets/icons/${window.__kindIconFile("waypoint")}`;
  return (
    <div
      className="outline-item"
      onClick={(e) => {
        e.stopPropagation();
        window.__goToWaypointCard(r.owner_id, r.folder_id, r.item_id);
      }}
    >
      <span
        className="outline-icon icon-mask"
        style={{ maskImage: `url(${iconUrl})`, WebkitMaskImage: `url(${iconUrl})` }}
      />
      <span className="outline-label">{r.name || "New Waypoint"}</span>
    </div>
  );
}

// Portals into #waypoints-list (content/fragments/hamburger-stack.html) — a plain flex-item
// container, safe to portal into directly (no wrapper needed) same as #schedule-view-hours/stack.
// Visibility of the panel ITSELF (vs. the outline/hub-collab panels) stays a vanilla classList
// toggle, unrelated to this — this component only owns the row list.
export default function WaypointsListPanel() {
  const state = useSyncExternalStore(waypointsListStore.subscribe, waypointsListStore.getSnapshot, () => EMPTY_STATE);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("waypoints-list"));
  }, []);

  if (!portalNode) return null;

  return createPortal(
    state.rows.length ? (
      state.rows.map((r) => <WaypointRow key={`${r.owner_id}-${r.folder_id}-${r.item_id}`} r={r} />)
    ) : (
      <div className="outline-empty">{state.query ? "No matching waypoints." : "No waypoints yet."}</div>
    ),
    portalNode,
  );
}
