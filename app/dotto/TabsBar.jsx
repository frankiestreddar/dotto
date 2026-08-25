"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { breadcrumbMapStore, tabsStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object/array literal as the getServerSnapshot fallback trips React's "should be cached"
// warning.
const EMPTY_BREADCRUMB = { hasMore: false, root: null, parent: null, current: null };
const EMPTY_TABS = { tabs: [], activeTabId: null };

// Below this many px of horizontal pointer movement, a pointerdown-then-up on a tab still counts
// as a plain click (switch tab / rename) rather than a drag-to-reorder — same "was this a click or
// a drag" threshold shape as PEN_CLICK_THRESHOLD_PX (srs-connections-core.js), just for this
// unrelated gesture.
const DRAG_THRESHOLD_PX = 4;

// The four-phase "switch tabs" sequence (per explicit request): a brief pause, then the OLD
// content flies upward out of the tab, then the tab itself grows/shrinks, then the NEW content
// flies up into place. Durations match the CSS this drives — see TabRow's own comment on `phase`.
const SWITCH_DELAY_MS = 100;
const CONTENT_FLY_MS = 150;
const RESIZE_MS = 250;

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
// (window.__switchTab). The close button is shown on both kinds whenever there's more than one tab
// — mirrors real browser tab bars, where every tab (including the active one) can be closed as
// long as it isn't the only one left (closeTab itself, shared-canvases-outline.js, already no-ops
// on a single remaining tab as a second layer of defense).
//
// The "switch tabs: pause, then the old text flies upward out of the tab, then it grows/shrinks,
// then the new content flies up into place" sequence (per explicit request) is a small local state
// machine — `phase` — rather than a plain className swap, since it needs THREE distinct visual
// beats in order, not just one property transitioning between two states (which is all a plain
// CSS transition-delay could give). `showTrail` is what's ACTUALLY rendered (label vs. full
// trail) — deliberately decoupled from `isActive` itself, only flipping midway through the
// sequence (right as the resize phase starts), so the OLD content is still what's on screen (and
// able to fly out) for the first beat, and the box has already resized to fit the NEW content
// before it flies in for the last beat. `phase` drives which CSS animation class applies:
// 'fly-out' plays tab-content-fly-out (globals.css) on whatever `showTrail` still shows; 'resize'
// hides the content outright (nothing to show mid-resize) while .tab-pill-grown's max-width
// transitions; 'fly-in' plays tab-content-fly-in on the NOW-current `showTrail` content. Settles
// back to 'idle' once the whole sequence finishes, matching whatever `isActive` currently is
// (also the steady state on first mount / for a tab that never transitions).
function TabRow({ tab, isActive, canClose, dragX, isDragging, tabRef, onDragStart, onDragMove, onDragEnd }) {
  const suppressClickRef = useRef(false);
  const [phase, setPhase] = useState("idle");
  const [showTrail, setShowTrail] = useState(isActive);
  const prevIsActiveRef = useRef(isActive);

  useEffect(() => {
    if (isActive === prevIsActiveRef.current) return;
    prevIsActiveRef.current = isActive;
    let cancelled = false;
    const t1 = setTimeout(() => {
      if (cancelled) return;
      setPhase("fly-out");
      setTimeout(() => {
        if (cancelled) return;
        setPhase("resize");
        setShowTrail(isActive);
        setTimeout(() => {
          if (cancelled) return;
          setPhase("fly-in");
          setTimeout(() => {
            if (cancelled) return;
            setPhase("idle");
          }, CONTENT_FLY_MS);
        }, RESIZE_MS);
      }, CONTENT_FLY_MS);
    }, SWITCH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(t1); };
  }, [isActive]);

  const contentClass =
    phase === "fly-out" ? " tab-content-fly-out" : phase === "fly-in" ? " tab-content-fly-in" : "";

  return (
    <div
      ref={tabRef}
      className={
        "tab-pill" +
        (isActive ? " tab-pill-active" : "") +
        (showTrail ? " tab-pill-grown" : "") +
        (isDragging ? " tab-pill-dragging" : "")
      }
      style={isDragging ? { transform: `translateX(${dragX}px)` } : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        suppressClickRef.current = false;
        onDragStart(tab.id, e.clientX);
      }}
      onPointerMove={(e) => onDragMove(tab.id, e.clientX)}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        suppressClickRef.current = onDragEnd(tab.id, e.clientX);
      }}
      onClick={isActive ? undefined : (e) => {
        e.stopPropagation();
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        window.__switchTab(tab.id);
      }}
    >
      {phase !== "resize" && (
        <div className={"tab-pill-content" + contentClass}>
          {showTrail ? <ActiveTabTrail /> : <span className="tab-pill-label">{tab.label}</span>}
        </div>
      )}
      {canClose && (
        <button
          type="button"
          className="tab-pill-close"
          title="Close tab"
          onPointerDown={(e) => e.stopPropagation()}
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

  // Drag-to-reorder — see TabRow's own comment for why this is plain pointer tracking rather than
  // native HTML5 DnD, and why the actual reorder is computed once on release rather than live.
  const tabRefs = useRef({});
  const dragRef = useRef(null); // { id, startX }
  const [drag, setDrag] = useState({ id: null, x: 0 });

  const handleDragStart = (id, clientX) => {
    dragRef.current = { id, startX: clientX };
  };
  const handleDragMove = (id, clientX) => {
    if (!dragRef.current || dragRef.current.id !== id) return;
    setDrag({ id, x: clientX - dragRef.current.startX });
  };
  // Returns true if this release should suppress the pill's own onClick (i.e. it was a real drag,
  // not a plain click) — TabRow reads this back into its own suppressClickRef.
  const handleDragEnd = (id, clientX) => {
    const wasDragging = !!dragRef.current && dragRef.current.id === id && Math.abs(clientX - dragRef.current.startX) >= DRAG_THRESHOLD_PX;
    if (wasDragging) {
      // Final drop index: the position of the LAST (rightmost, in left-to-right tab order) other
      // tab whose own current midpoint the release point has passed — see the file header comment
      // for why this single end-of-drag measurement is preferred over live per-frame reordering.
      let toIndex = tabs.findIndex((t) => t.id === id);
      tabs.forEach((t, i) => {
        if (t.id === id) return;
        const el = tabRefs.current[t.id];
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (clientX > rect.left + rect.width / 2) toIndex = i;
      });
      window.__reorderTab(id, toIndex);
    }
    dragRef.current = null;
    setDrag({ id: null, x: 0 });
    return wasDragging;
  };

  if (!portalNode || !tabs.length) return null;

  return createPortal(
    <>
      {tabs.map((tab) => (
        <TabRow
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          canClose={tabs.length > 1}
          isDragging={tab.id === drag.id}
          dragX={drag.x}
          tabRef={(el) => { tabRefs.current[tab.id] = el; }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        />
      ))}
      <button type="button" id="tab-add-btn" title="New tab" onClick={(e) => { e.stopPropagation(); window.__addTab(); }}>
        +
      </button>
    </>,
    portalNode,
  );
}
