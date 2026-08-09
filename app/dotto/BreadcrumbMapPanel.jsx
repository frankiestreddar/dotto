"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { breadcrumbMapStore } from "./bridges";
import usePortalNode from "./usePortalNode";

const EMPTY_ROWS = [];

function BreadcrumbMapRow({ r }) {
  return (
    <div
      className={"breadcrumb-map-row" + (r.isCurrent ? " current" : "")}
      style={{ "--map-indent": r.indent * 16 + "px" }}
      onClick={r.isCurrent ? undefined : (e) => { e.stopPropagation(); window.__breadcrumbMapRowClick(r.folderId, r.isSyntheticRoot); }}
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
