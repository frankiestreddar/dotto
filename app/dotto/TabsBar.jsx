"use client";

import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { breadcrumbMapStore, tabsStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object/array literal as the getServerSnapshot fallback trips React's "should be cached"
// warning.
const EMPTY_BREADCRUMB = { hasMore: false, root: null, parent: null, current: null };
const EMPTY_TABS = { tabs: [], activeTabId: null };

// The ACTIVE tab's own content — the full "…/parent/current" trail, per explicit request (only
// the active tab shows the full breadcrumb; every other tab just shows its own current segment,
// see TabRow below). This is exactly what BreadcrumbPill.jsx used to render directly before tabs
// existed — breadcrumbMapStore itself still only ever describes wherever appState.currentFolderId
// currently is, which by construction is always the active tab's own location (see
// renderTabsPanel's own comment, shared-canvases-outline.js), so no changes were needed there.
// The current-folder segment doubles as its rename control — same click-to-edit contentEditable
// flow every other title in the app uses (window.__startRenameFolderCardTitle, shared with folder/
// source cards) — see waypoints-render-loop.js's own comment on that function. A plain {folderId}
// stands in for the `it` object those callers pass; there's no real `.id`/canvas item behind a
// breadcrumb segment, so the 3rd arg (editingClass) is inert here.
function ActiveTabTrail() {
  const bc = useSyncExternalStore(breadcrumbMapStore.subscribe, breadcrumbMapStore.getSnapshot, () => EMPTY_BREADCRUMB);
  const currentRef = useRef(null);

  if (!bc.current) return null;

  return (
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
    </>
  );
}

// One tab pill — the active one renders the full ActiveTabTrail above (not itself clickable as a
// whole, same as before tabs existed: only its own ellipsis/parent/current segments carry their
// own click behavior); every other tab is a plain clickable label that switches to it
// (window.__switchTab). closeTabBtn is shown on both kinds whenever there's more than one tab —
// mirrors real browser tab bars, where every tab (including the active one) can be closed as long
// as it isn't the only one left (closeTab itself, shared-canvases-outline.js, already no-ops on a
// single remaining tab as a second layer of defense).
function TabRow({ tab, isActive, canClose }) {
  return (
    <div
      className={"tab-pill" + (isActive ? " tab-pill-active" : "")}
      onClick={isActive ? undefined : (e) => { e.stopPropagation(); window.__switchTab(tab.id); }}
    >
      {isActive ? <ActiveTabTrail /> : <span className="tab-pill-label">{tab.label}</span>}
      {canClose && (
        <button
          type="button"
          className="tab-pill-close"
          title="Close tab"
          onClick={(e) => { e.stopPropagation(); window.__closeTab(tab.id); }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// Portals into #breadcrumb-pill (content/fragments/top-bar.html), inside #top-bar-center — dead
// centre of the viewport, beside the "add a collaborator" flyout (see its own comment,
// globals.css). Used to portal a single breadcrumb trail directly (BreadcrumbPill.jsx, now folded
// into ActiveTabTrail above) — now a row of tab pills instead, plus a "+" button that adds a new
// one, per explicit request. New tabs start at the same location as whichever tab is currently
// active (see addTab's own comment, shared-canvases-outline.js) — this component has no say in
// where a new tab starts, it just renders whatever tabsStore already reflects.
export default function TabsBar() {
  const { tabs, activeTabId } = useSyncExternalStore(tabsStore.subscribe, tabsStore.getSnapshot, () => EMPTY_TABS);
  const portalNode = usePortalNode("breadcrumb-pill");

  if (!portalNode || !tabs.length) return null;

  return createPortal(
    <>
      {tabs.map((tab) => (
        <TabRow key={tab.id} tab={tab} isActive={tab.id === activeTabId} canClose={tabs.length > 1} />
      ))}
      <button type="button" id="tab-add-btn" title="New tab" onClick={(e) => { e.stopPropagation(); window.__addTab(); }}>
        +
      </button>
    </>,
    portalNode,
  );
}
