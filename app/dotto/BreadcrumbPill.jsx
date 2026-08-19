"use client";

import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { breadcrumbMapStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_BREADCRUMB = { hasMore: false, root: null, parent: null, current: null };

// Portals into #breadcrumb-pill (content/fragments/top-bar.html), next to #btn-back/#btn-forward
// — replaces the old always-visible full ancestor list that used to live inside the hamburger
// sidebar (#breadcrumb-menu, removed) with a compact "…/parent/current" trail. The current-folder
// segment doubles as its rename control — same click-to-edit contentEditable flow every other
// title in the app uses (window.__startRenameFolderCardTitle, shared with folder/source cards —
// see its own comment in waypoints-render-loop.js), just handed this segment's own DOM node via a
// ref instead of a canvas card's. A plain {folderId} stands in for the `it` object those callers
// pass; there's no real `.id`/canvas item behind a breadcrumb segment, so the 3rd arg
// (editingClass) is inert here — see startRenameFolderCardTitle's own body.
export default function BreadcrumbPill() {
  const bc = useSyncExternalStore(breadcrumbMapStore.subscribe, breadcrumbMapStore.getSnapshot, () => EMPTY_BREADCRUMB);
  const portalNode = usePortalNode("breadcrumb-pill");
  const currentRef = useRef(null);

  if (!portalNode || !bc.current) return null;

  return createPortal(
    <>
      {bc.hasMore && (
        <>
          <span
            className="breadcrumb-pill-ellipsis"
            onClick={(e) => { e.stopPropagation(); window.__breadcrumbMapRowClick(bc.root.folderId, bc.root.isSyntheticRoot); }}
          >
            …
          </span>
          <span className="breadcrumb-pill-sep">/</span>
        </>
      )}
      {bc.parent && (
        <>
          <span
            className="breadcrumb-pill-parent"
            onClick={(e) => { e.stopPropagation(); window.__breadcrumbMapRowClick(bc.parent.folderId, bc.parent.isSyntheticRoot); }}
          >
            {bc.parent.label}
          </span>
          <span className="breadcrumb-pill-sep">/</span>
        </>
      )}
      <span
        ref={currentRef}
        className="breadcrumb-pill-current"
        onClick={(e) => { e.stopPropagation(); window.__startRenameFolderCardTitle(currentRef.current, { folderId: bc.current.folderId }, "breadcrumb-pill-current"); }}
      >
        {bc.current.label}
      </span>
    </>,
    portalNode,
  );
}
