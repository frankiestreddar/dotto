"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { listPanelSelectionStore, waypointsListStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };
const EMPTY_IDS = new Set();
const EMPTY_SELECTION = { panel: null, ids: EMPTY_IDS };

// Same `${owner_id}-${folder_id}-${item_id}` key used as this row's React `key` below AND as the
// shift-click selection id (see hamburger-collab.js's waypointRowKey, which must stay identical to
// this) — vanilla can't reverse-parse it (owner_id is a UUID full of hyphens) but re-deriving the
// same string per candidate row and comparing works fine.
function waypointRowKey(r) {
  return `${r.owner_id}-${r.folder_id}-${r.item_id}`;
}

// index is this row's position in the current sorted-by-proximity, filtered list (WaypointsListPanel
// below, matching appState.lastWaypointsRows' own order exactly — see sortWaypointRowsByProximity,
// hamburger-collab.js) — the first 10 rows (index 0-9) get a keyboard-shortcut badge, 1-9 then 0,
// per explicit request; row 11+ gets none. The actual key handling lives in srs-connections-
// core.js's keydown handler, gated on the Waypoints panel being open — this component only draws
// the indicator, matching whatever that handler will actually respond to.
function WaypointRow({ r, selected, index }) {
  const iconUrl = `/assets/icons/${window.__kindIconFile("waypoint")}`;
  const shortcutKey = index === 9 ? "0" : index < 9 ? String(index + 1) : null;
  return (
    <div
      className={"outline-item" + (selected ? " outline-item-selected" : "")}
      data-select-id={waypointRowKey(r)}
      onClick={(e) => {
        e.stopPropagation();
        // Selecting (both a plain shift+click and a shift+click-drag across several rows) is
        // handled entirely by setupListPanelDragSelect (hamburger-collab.js), listening on the
        // stable #waypoints-list container rather than here — this guard just stops a shift+click
        // from ALSO running the normal open-waypoint action below.
        if (e.shiftKey) return;
        window.__goToWaypointCard(r.owner_id, r.folder_id, r.item_id);
      }}
    >
      <span
        className="outline-icon icon-mask"
        style={{ maskImage: `url(${iconUrl})`, WebkitMaskImage: `url(${iconUrl})` }}
      />
      <span className="outline-label">{r.name || "New Waypoint"}</span>
      {shortcutKey && <span className="outline-item-key">{shortcutKey}</span>}
      <RowActions />
    </div>
  );
}

// Portals into #waypoints-list (content/fragments/hamburger-stack.html) — a plain flex-item
// container, safe to portal into directly, no wrapper needed. Visibility of the panel ITSELF (vs.
// the outline/hub-collab panels) stays a vanilla classList toggle, unrelated to this — this
// component only owns the row list.
export default function WaypointsListPanel() {
  const state = useSyncExternalStore(waypointsListStore.subscribe, waypointsListStore.getSnapshot, () => EMPTY_STATE);
  const selection = useSyncExternalStore(listPanelSelectionStore.subscribe, listPanelSelectionStore.getSnapshot, () => EMPTY_SELECTION);
  const selectedIds = selection.panel === "waypoints" ? selection.ids : EMPTY_IDS;
  const portalNode = usePortalNode("waypoints-list");

  if (!portalNode) return null;

  return createPortal(
    state.rows.length ? (
      state.rows.map((r, index) => <WaypointRow key={waypointRowKey(r)} r={r} selected={selectedIds.has(waypointRowKey(r))} index={index} />)
    ) : (
      <div className="outline-empty">{state.query ? "No matching waypoints." : "No waypoints yet."}</div>
    ),
    portalNode,
  );
}
