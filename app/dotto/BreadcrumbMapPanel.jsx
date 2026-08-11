"use client";

import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { breadcrumbMapStore } from "./bridges";
import usePortalNode from "./usePortalNode";

const EMPTY_ROWS = [];

// The current-folder row doubles as its rename control — same click-to-edit contentEditable flow
// every other title in the app uses (window.__startRenameFolderCardTitle, shared with folder/
// source cards — see its own comment in waypoints-render-loop.js), just handed this row's own DOM
// node via a ref instead of a canvas card's. A plain {folderId} stands in for the `it` object
// those callers pass; there's no real `.id`/canvas item behind a sidebar row.
function BreadcrumbMapRow({ r }) {
  const elRef = useRef(null);
  const isCurrent = r.isCurrent;
  return (
    <div
      ref={elRef}
      className={"breadcrumb-map-row" + (isCurrent ? " current" : "")}
      style={{ "--map-indent": r.indent * 16 + "px" }}
      onClick={isCurrent
        ? (e) => { e.stopPropagation(); window.__startRenameFolderCardTitle(elRef.current, { folderId: r.folderId }, "breadcrumb-map-row"); }
        : (e) => { e.stopPropagation(); window.__breadcrumbMapRowClick(r.folderId, r.isSyntheticRoot); }}
    >
      {r.label}
    </div>
  );
}

// Portals into #breadcrumb-map-list (content/fragments/top-bar.html) — a plain empty div, safe to
// portal into directly, same as #waypoints-list and friends.
export default function BreadcrumbMapPanel() {
  const rows = useSyncExternalStore(breadcrumbMapStore.subscribe, breadcrumbMapStore.getSnapshot, () => EMPTY_ROWS);
  const portalNode = usePortalNode("breadcrumb-map-list");

  if (!portalNode) return null;

  return createPortal(rows.map((r) => <BreadcrumbMapRow key={r.folderId} r={r} />), portalNode);
}
