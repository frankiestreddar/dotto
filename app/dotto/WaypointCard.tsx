"use client";

import { useLayoutEffect } from "react";
import { attachWaypointCardBody } from "./lib/waypointsRenderLoop";
import type { Item } from "./lib/messagingCanvasPreview";

// Ported from the old inline waypoint branch in renderLegacyCardBody (app/dotto/lib/
// waypointsRenderLoop.ts). The expand/collapse-on-hover/click/drag animation and the name's click-to-edit
// contentEditable lifecycle (expandWaypointCard/collapseWaypointCardWidth, plus the new
// attachWaypointCardBody wiring click/hover/pointerdown) all stay vanilla — coupled to
// appState.waypointPeekTimer/broadcastEditingState/syncWaypointToDb, and driven by direct
// getBoundingClientRect width measurements JS has to own for the px-to-px transition (CSS can't
// animate to/from width:auto). The name span is left with no JSX children at all (not even ""),
// same reasoning as WatermarkCard's dangerouslySetInnerHTML: it's mutated in place by
// attachWaypointCardBody's handlers, and since its JSX-declared children never change render to
// render, React never has anything to diff/fight it with.
export default function WaypointCard({ it, paneId }: { it: Item; paneId?: number }) {
  // `el` is WaypointCard's own wrapper, passed in explicitly — see attachFolderCardClick's comment
  // in app/dotto/lib/waypointsRenderLoop.ts for why (closest('.item') breaks on first mount).
  useLayoutEffect(() => {
    const el = window.__findItemEl!(it.id, paneId);
    if (el) attachWaypointCardBody(el, it);
  });

  const iconUrl = `/assets/icons/${window.__kindIconFile!("waypoint")}`;

  return (
    <>
      <span
        className="waypoint-card-icon icon-mask"
        style={{ maskImage: `url(${iconUrl})`, WebkitMaskImage: `url(${iconUrl})` }}
      />
      <span className="waypoint-card-name" />
    </>
  );
}
