"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  allowedEdgesForPane,
  breadcrumbMapStore,
  computePaneRects,
  paneLayoutStore,
  tabsStore,
} from "./bridges";
import { startRenameFolderCardTitle } from "./lib/waypointsRenderLoop";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object/array literal as the getServerSnapshot fallback trips React's "should be cached"
// warning.
const EMPTY_BREADCRUMB = { hasMore: false, root: null, parent: null, current: null };
const EMPTY_TABS = { tabs: [], activeTabId: null };

// Below this many px of horizontal pointer movement, a pointerdown-then-up on a tab still counts
// as a plain click (switch tab / rename) rather than a drag-to-reorder — same "was this a click or
// a drag" threshold shape as PEN_CLICK_THRESHOLD_PX (app/dotto/lib/srsConnectionsCore.ts), just for this
// unrelated gesture.
const DRAG_THRESHOLD_PX = 4;

// Split-screen Stage 5 — how close an escaped tab-drag needs to get to a pane's own edge (in real
// pixels, via getPaneRectsPx below — automatically rail/hmenu-width-aware since it reads
// .pane-grid-viewport's own live bounding box rather than duplicating that CSS math) before that
// edge's drop-zone activates.
const EDGE_ZONE_PX = 80;

// Split-screen Stage 6 — every currently-open pane's own screen box, in real pixels, for hit-
// testing during a drag ("which pane is the cursor over right now, and how close is it to which of
// THAT pane's own 4 edges"). Reads paneLayoutStore directly rather than through a bridge (this file
// already lives in the same React tree/module graph as bridges.js, unlike the vanilla side) and
// .pane-grid-viewport's own live bounding box rather than window.innerWidth/--rail-width math, so
// this stays correct through the hamburger-panel-open width reservation (globals.css) without
// having to duplicate that CSS's own arithmetic here.
function getPaneRectsPx() {
  const viewportEl = document.querySelector(".pane-grid-viewport");
  if (!viewportEl) return [];
  const vp = viewportEl.getBoundingClientRect();
  return computePaneRects(paneLayoutStore.getSnapshot()).map(({ paneId, rect }) => ({
    paneId,
    x: vp.left + rect.x * vp.width,
    y: vp.top + rect.y * vp.height,
    width: rect.w * vp.width,
    height: rect.h * vp.height,
  }));
}

// The drop-zone rectangle for a given pane+edge: half of that pane's own box on the dropped side,
// inset OUTER px from the pane's true boundary and INNER px from the (future) split line — same
// "padding off the true edges" shape the original ask/Stage 5 both used, just computed generically
// against any pane's own box now instead of two hardcoded viewport-half CSS variants.
const DROPZONE_OUTER_PX = 16;
const DROPZONE_INNER_PX = 8;
function computeDropzoneRect(pane, edge) {
  const o = DROPZONE_OUTER_PX,
    i = DROPZONE_INNER_PX;
  if (edge === "left" || edge === "right") {
    const halfW = pane.width / 2;
    const top = pane.y + o,
      height = pane.height - o * 2,
      width = halfW - o - i;
    return edge === "left"
      ? { left: pane.x + o, top, width, height }
      : { left: pane.x + halfW + i, top, width, height };
  }
  const halfH = pane.height / 2;
  const left = pane.x + o,
    width = pane.width - o * 2,
    height = halfH - o - i;
  return edge === "top"
    ? { left, top: pane.y + o, width, height }
    : { left, top: pane.y + halfH + i, width, height };
}

// The four-phase "switch tabs" sequence (per explicit request): a brief pause, then the OLD
// content flies upward out of the tab, then the tab itself grows/shrinks, then the NEW content
// flies up into place — durations match the CSS this drives, see TabRow's own comment on `phase`.
const SWITCH_DELAY_MS = 100;
const CONTENT_FLY_MS = 150;
const RESIZE_MS = 250;

// The ACTIVE tab's own content — the full "…/parent/current" trail, per explicit request (only
// the active tab shows the full breadcrumb; every other tab just shows its own current segment,
// see TabRow below). Takes its data as a prop now (not its own useSyncExternalStore subscription
// — see TabRow's own comment for why) so TabRow can hand it a FROZEN snapshot while this tab is
// fading out, rather than whatever this pane's own breadcrumbMapStore slot currently holds (which,
// by the time a fade-out is even playing, already describes the NEWLY active tab's folder, not
// this one's). paneId (split-screen Stage 7 — each pane has its own breadcrumb pill now) is
// threaded down to breadcrumbMapRowClick so a click on a non-current segment activates THIS pane
// first if it wasn't already, same "clicking a pane's own UI focuses that pane" convention every
// other tab operation in this file now follows.
// The current-folder segment doubles as its rename control — same click-to-edit contentEditable
// flow every other title in the app uses (startRenameFolderCardTitle, shared with folder/
// source cards) — see app/dotto/lib/waypointsRenderLoop.ts's own comment on that function. A plain {folderId}
// stands in for the `it` object those callers pass; there's no real `.id`/canvas item behind a
// breadcrumb segment, so the 3rd arg (editingClass) is inert here.
//
// Every segment's own onPointerDown stops propagation before it reaches TabRow's — TabRow's
// setPointerCapture call (its own onPointerDown, below) redirects every subsequent pointer event
// for that pointer, INCLUDING the synthesized `click`, to the CAPTURING element (the whole
// .tab-pill) rather than wherever the pointer actually landed — the exact same reason
// .tab-pill-close already needs (and has) this same guard on its own onPointerDown. Without it,
// clicking any of these segments would silently fire the pill's own onClick instead (undefined
// for the active tab, since it isn't itself clickable — see TabRow's own comment), never reaching
// the handlers below at all.
function ActiveTabTrail({ bc, paneId }) {
  const currentRef = useRef(null);

  if (!bc.current) return null;

  return (
    <>
      {bc.hasMore && (
        <>
          <span
            className="breadcrumb-pill-ellipsis"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              window.__breadcrumbMapRowClick(bc.root.folderId, bc.root.isSyntheticRoot, paneId);
            }}
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              window.__breadcrumbMapRowClick(bc.parent.folderId, bc.parent.isSyntheticRoot, paneId);
            }}
          >
            {bc.parent.label}
          </span>
          <span className="breadcrumb-pill-sep">/</span>
        </>
      )}
      <span
        ref={currentRef}
        className="breadcrumb-pill-current"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          startRenameFolderCardTitle(
            currentRef.current,
            { folderId: bc.current.folderId },
            "breadcrumb-pill-current",
          );
        }}
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
// long as it isn't the only one left (closeTab itself, app/dotto/lib/tabManagement.ts, already no-ops
// on a single remaining tab as a second layer of defense).
//
// The "switch tabs: pause, then the old text flies upward out of the tab, then it grows, then the
// new content flies up into place" sequence (per explicit request) plays ONLY for the tab BECOMING
// active — the one it's replacing shrinks back to its short label instantly instead (per a later
// explicit request), no pause/animation of any kind. It's a small local state machine — `phase` —
// rather than a plain className swap, since the growing direction needs THREE distinct visual
// beats in order, not just one property transitioning between two states (which is all a plain
// CSS transition-delay could give). Two things this deliberately does NOT do, per an explicit
// follow-up bug report that the whole tab (not just its text) was disappearing: the content wrapper
// is ALWAYS rendered (never conditionally removed from the DOM — 'resize' just hides it via CSS
// visibility, below) and `.tab-pill` itself never has anything applied that could hide the pill's
// own box/background/border at any phase, only .tab-pill-content's own visibility/animation.
// `bc` is subscribed to HERE (not inside ActiveTabTrail) and cached in `lastOwnBc` state while this
// tab IS the live active one, so its fly-out plays against ITS OWN last-known breadcrumb even
// after breadcrumbMapStore has already moved on to describe the newly active tab (which happens
// synchronously, before any of this component's phase timers even start) — without this, a fading-
// out tab would render the WRONG (new) trail for the brief moment it's still visible. Moot for the
// instant-shrink direction itself (nothing animates long enough to read stale data), but still
// correct to keep unconditional here since a shrunk tab can always become the fly-out candidate
// again on some LATER switch.
// `showTrail` is what's ACTUALLY rendered (label vs. full trail) — deliberately decoupled from
// `isActive` itself: for the growing direction it only flips midway through the sequence (right as
// the resize phase starts), so the OLD content is still on screen (and able to fly out) for the
// first beat, and the box has already resized to fit the NEW content before it flies in for the
// last; for the shrinking direction it flips immediately, alongside everything else.
function TabRow({
  tab,
  paneId,
  isActive,
  canClose,
  dragX,
  isDragging,
  isEscaped,
  tabRef,
  onDragStart,
  onDragMove,
  onDragEnd,
}) {
  const suppressClickRef = useRef(false);
  // This pane's own breadcrumb store slot (split-screen Stage 7 — breadcrumbMapStore is pane-keyed
  // now, one slot per pane, not a single shared store) — .storeFor(paneId) is stable across
  // renders (createPaneKeyedStore caches it), so this is safe to call directly in render, same as
  // every other pane-keyed store consumer in this codebase (CanvasItemsLayer.jsx, BlocksPanel.jsx).
  const paneBreadcrumbStore = breadcrumbMapStore.storeFor(paneId);
  const bc = useSyncExternalStore(
    paneBreadcrumbStore.subscribe,
    paneBreadcrumbStore.getSnapshot,
    () => EMPTY_BREADCRUMB,
  );
  // Cached in state, corrected DURING render (React's documented "adjusting state" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // — a conditional setState call in the render body itself, not inside an effect, which would
  // schedule an extra, avoidable commit for something this cheap) rather than a plain ref: both
  // reading and writing a ref's .current during render are disallowed (react-hooks/refs), and a
  // ref wouldn't need this file's OWN comment to explain safety anyway. Tracks `bc` while this tab
  // is active — the condition (bc !== lastOwnBc) is what keeps this a single corrective update per
  // real change rather than looping: once set equal, the condition stops matching until `bc`
  // actually changes again. Freezes at whatever it last was the instant `isActive` goes false,
  // which is exactly the point — see this function's own header comment for why.
  const [lastOwnBc, setLastOwnBc] = useState(bc);
  if (isActive && bc !== lastOwnBc) setLastOwnBc(bc);

  const [phase, setPhase] = useState("idle");
  const [showTrail, setShowTrail] = useState(isActive);
  const prevIsActiveRef = useRef(isActive);

  // Losing active status shrinks instantly — per explicit request, only the tab BECOMING active
  // gets the pause/fly-out/resize/fly-in sequence below; the one it's replacing just snaps straight
  // back to its short label with no animation at all, content or width. (The width half of
  // "instant" comes from .tab-pill-grown carrying its OWN transition, globals.css, rather than the
  // base .tab-pill rule — removing that class, exactly what happens here, then has no transition to
  // animate through.) Corrected DURING render (same reasoning/pattern as `lastOwnBc` above) rather
  // than in the effect below — a synchronous setState call in an effect body is exactly what
  // react-hooks/set-state-in-effect flags, even for a legitimate "sync state to this prop" case
  // like this one.
  if (!isActive && showTrail) {
    setShowTrail(false);
    setPhase("idle");
  }

  useEffect(() => {
    if (isActive === prevIsActiveRef.current) return;
    prevIsActiveRef.current = isActive;
    if (!isActive) return; // instant shrink already handled during render, above
    let cancelled = false;
    const timers = [];
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        setPhase("fly-out");
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            setPhase("resize");
            setShowTrail(true);
            timers.push(
              setTimeout(() => {
                if (cancelled) return;
                setPhase("fly-in");
                timers.push(
                  setTimeout(() => {
                    if (cancelled) return;
                    setPhase("idle");
                  }, CONTENT_FLY_MS),
                );
              }, RESIZE_MS),
            );
          }, CONTENT_FLY_MS),
        );
      }, SWITCH_DELAY_MS),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [isActive]);

  const contentClass =
    phase === "fly-out"
      ? " tab-content-fly-out"
      : phase === "fly-in"
        ? " tab-content-fly-in"
        : phase === "resize"
          ? " tab-content-hidden"
          : "";

  return (
    <div
      ref={tabRef}
      className={
        "tab-pill" +
        (isActive ? " tab-pill-active" : "") +
        (showTrail ? " tab-pill-grown" : "") +
        (isDragging && !isEscaped ? " tab-pill-dragging" : "") +
        (isEscaped ? " tab-pill-collapsed" : "")
      }
      style={isDragging && !isEscaped ? { transform: `translateX(${dragX}px)` } : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        suppressClickRef.current = false;
        onDragStart(tab.id, e.clientX, e.clientY);
      }}
      onPointerMove={(e) => onDragMove(tab.id, e.clientX, e.clientY)}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        suppressClickRef.current = onDragEnd(tab.id, e.clientX, e.clientY);
      }}
      onClick={
        isActive
          ? undefined
          : (e) => {
              e.stopPropagation();
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              window.__switchTab(tab.id, paneId);
            }
      }
    >
      <div className={"tab-pill-content" + contentClass}>
        {showTrail ? (
          <ActiveTabTrail bc={isActive ? bc : lastOwnBc} paneId={paneId} />
        ) : (
          <span className="tab-pill-label">{tab.label}</span>
        )}
      </div>
      {canClose && (
        <button
          type="button"
          className="tab-pill-close"
          title="Close tab"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            window.__closeTab(tab.id, paneId);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// One TabsBar instance PER PANE now (split-screen Stage 7, explicit request — was a single global
// instance tied to whichever pane happened to be active). Portals into that pane's own
// #pane-tabs-{paneId} anchor — the middle grid column of that pane's own FULL top-bar pill
// (PaneTopBar.jsx, split-screen Stage 8 — nav-arrows/tab row/collab bubble/add-tab button together,
// each independently hover-expanding, was just the tab row alone in Stage 7's
// #pane-breadcrumb-pill-{paneId}) instead of the single static #breadcrumb-pill — used to portal a
// single breadcrumb trail directly (BreadcrumbPill.jsx, now folded into ActiveTabTrail above), then
// a shared row of tab pills, now one row per pane. New tabs start at the same location as whichever
// tab is currently active in THIS pane (see addTab's own comment, app/dotto/lib/tabManagement.ts) —
// this component has no say in where a new tab starts, it just renders whatever this pane's own
// tabsStore slot already reflects.
export default function TabsBar({ paneId }) {
  // This pane's own tabs store slot (split-screen Stage 7 — tabsStore is pane-keyed now, one slot
  // per pane, not a single shared store). .storeFor(paneId) is stable across renders
  // (createPaneKeyedStore caches it), safe to call directly in render.
  const paneTabsStore = tabsStore.storeFor(paneId);
  const { tabs, activeTabId } = useSyncExternalStore(
    paneTabsStore.subscribe,
    paneTabsStore.getSnapshot,
    () => EMPTY_TABS,
  );
  const portalNode = usePortalNode("pane-tabs-" + paneId);

  // Drag-to-reorder — see TabRow's own comment for why this is plain pointer tracking rather than
  // native HTML5 DnD, and why the actual reorder is computed once on release rather than live.
  //
  // Extended (split-screen Stage 5) into a full 2D drag-tab-to-edge-to-split gesture: once the drag
  // both exceeds DRAG_THRESHOLD_PX AND the cursor leaves the breadcrumb pill's own bounding box, it
  // "escapes" reorder-within-row mode entirely — the dragged tab collapses out of the row
  // (.tab-pill-collapsed), a fixed, cursor-following ghost appears, and getting within
  // EDGE_ZONE_PX of a viewport edge (rail-width-aware, same reasoning as canvasViewportCenterX,
  // core-state.js) reveals that edge's drop-zone. Releasing inside an active zone calls
  // window.__splitPaneWithTab; releasing outside one (still escaped) just cancels — the tab snaps
  // back into the row with no reorder and no split, same as a real browser tab you drag out and
  // drop back onto its own bar.
  const tabRefs = useRef({});
  const dragRef = useRef(null); // { id, startX, startY, escaped, edge, targetPaneId }
  const [drag, setDrag] = useState({
    id: null,
    x: 0,
    y: 0,
    escaped: false,
    edge: null,
    targetPaneId: null,
    zoneRect: null,
    clientX: 0,
    clientY: 0,
  });

  const handleDragStart = (id, clientX, clientY) => {
    dragRef.current = {
      id,
      startX: clientX,
      startY: clientY,
      escaped: false,
      edge: null,
      targetPaneId: null,
    };
  };
  const handleDragMove = (id, clientX, clientY) => {
    const d = dragRef.current;
    if (!d || d.id !== id) return;
    const dx = clientX - d.startX,
      dy = clientY - d.startY;

    if (!d.escaped) {
      const movedEnough = Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
      const pillRect = portalNode && portalNode.getBoundingClientRect();
      const outsidePill =
        pillRect &&
        (clientX < pillRect.left ||
          clientX > pillRect.right ||
          clientY < pillRect.top ||
          clientY > pillRect.bottom);
      if (!(movedEnough && outsidePill)) {
        setDrag({
          id,
          x: dx,
          y: 0,
          escaped: false,
          edge: null,
          targetPaneId: null,
          zoneRect: null,
          clientX,
          clientY,
        });
        return;
      }
      d.escaped = true;
    }

    // Split-screen Stage 6 — hit-test every currently-open pane's own box (not just the two
    // viewport halves), find whichever one the cursor is nearest, then check proximity to only
    // THAT pane's own currently-LEGAL edges (allowedEdgesForPane, bridges.js — Stage 9, explicit
    // correction: dropping on a pane that's already part of a row/column pair, on the SAME
    // direction as that existing split, used to be allowed and produced 3+ panes side by side
    // instead of quartering — only the perpendicular edges may ever show a zone now, growing
    // strictly toward a clean 2x2). Capped: once 4 panes already exist, no edge zone can activate
    // at all (window.__countPanes, app/dotto/lib/splitPaneManagement.ts is the actual authority; this just
    // avoids showing a drop-zone that a drop would immediately be rejected against) — redundant
    // with allowedEdgesForPane's own depth-2 case in practice (a clean 2x2 always hits 4 panes
    // exactly when every leaf is at depth 2), kept as an explicit belt-and-suspenders check.
    let edge = null,
      targetPaneId = null,
      zoneRect = null;
    if (window.__countPanes() < 4) {
      const panes = getPaneRectsPx();
      const hovered =
        panes.find(
          (p) =>
            clientX >= p.x &&
            clientX <= p.x + p.width &&
            clientY >= p.y &&
            clientY <= p.y + p.height,
        ) ||
        panes.reduce((best, p) => {
          const cx = Math.max(p.x, Math.min(clientX, p.x + p.width));
          const cy = Math.max(p.y, Math.min(clientY, p.y + p.height));
          const dist = Math.hypot(clientX - cx, clientY - cy);
          return !best || dist < best.dist ? { ...p, dist } : best;
        }, null);
      if (hovered) {
        const allowed = allowedEdgesForPane(paneLayoutStore.getSnapshot(), hovered.paneId);
        const distances = {
          left: clientX - hovered.x,
          right: hovered.x + hovered.width - clientX,
          top: clientY - hovered.y,
          bottom: hovered.y + hovered.height - clientY,
        };
        let bestEdge = null,
          bestDist = Infinity;
        allowed.forEach((e) => {
          if (distances[e] < bestDist) {
            bestDist = distances[e];
            bestEdge = e;
          }
        });
        if (bestEdge && bestDist <= EDGE_ZONE_PX) {
          edge = bestEdge;
          targetPaneId = hovered.paneId;
          zoneRect = computeDropzoneRect(hovered, edge);
        }
      }
    }
    d.edge = edge;
    d.targetPaneId = targetPaneId;
    setDrag({ id, x: dx, y: dy, escaped: true, edge, targetPaneId, zoneRect, clientX, clientY });
  };
  // Returns true if this release should suppress the pill's own onClick (i.e. it was a real drag,
  // not a plain click) — TabRow reads this back into its own suppressClickRef.
  const handleDragEnd = (id, clientX) => {
    const d = dragRef.current;
    const wasDragging =
      !!d && d.id === id && (d.escaped || Math.abs(clientX - d.startX) >= DRAG_THRESHOLD_PX);
    if (d && d.id === id && d.escaped) {
      if (d.edge) window.__splitPaneWithTab(id, d.targetPaneId, d.edge, paneId);
      // else: cancelled — the tab just snaps back into the row below, no reorder/split.
    } else if (wasDragging) {
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
      window.__reorderTab(id, toIndex, paneId);
    }
    dragRef.current = null;
    setDrag({
      id: null,
      x: 0,
      y: 0,
      escaped: false,
      edge: null,
      targetPaneId: null,
      zoneRect: null,
      clientX: 0,
      clientY: 0,
    });
    return wasDragging;
  };

  if (!tabs.length) return null;

  const draggedTab = drag.escaped ? tabs.find((t) => t.id === drag.id) : null;

  return (
    <>
      {portalNode &&
        createPortal(
          tabs.map((tab) => (
            <TabRow
              key={tab.id}
              tab={tab}
              paneId={paneId}
              isActive={tab.id === activeTabId}
              canClose={tabs.length > 1}
              isDragging={tab.id === drag.id}
              isEscaped={tab.id === drag.id && drag.escaped}
              dragX={drag.x}
              tabRef={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
            />
          )),
          portalNode,
        )}
      {draggedTab &&
        createPortal(
          <>
            <div
              className="tab-drag-ghost"
              style={{ left: drag.clientX + 14, top: drag.clientY + 14 }}
            >
              {draggedTab.label}
            </div>
            {/* Split-screen Stage 6 — a single zone now, geometry computed per-frame against
              whichever pane+edge is actually targeted (computeDropzoneRect, above) rather than two
              fixed viewport-half CSS variants. */}
            {drag.zoneRect && (
              <div className="pane-dropzone-overlay active" style={drag.zoneRect} />
            )}
          </>,
          document.body,
        )}
    </>
  );
}
