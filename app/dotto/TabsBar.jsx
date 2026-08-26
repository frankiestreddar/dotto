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
// flies up into place — durations match the CSS this drives, see TabRow's own comment on `phase`.
const SWITCH_DELAY_MS = 100;
const CONTENT_FLY_MS = 150;
const RESIZE_MS = 250;

// The ACTIVE tab's own content — the full "…/parent/current" trail, per explicit request (only
// the active tab shows the full breadcrumb; every other tab just shows its own current segment,
// see TabRow below). Takes its data as a prop now (not its own useSyncExternalStore subscription
// — see TabRow's own comment for why) so TabRow can hand it a FROZEN snapshot while this tab is
// fading out, rather than whatever breadcrumbMapStore currently holds (which, by the time a fade-
// out is even playing, already describes the NEWLY active tab's folder, not this one's).
// The current-folder segment doubles as its rename control — same click-to-edit contentEditable
// flow every other title in the app uses (window.__startRenameFolderCardTitle, shared with folder/
// source cards) — see waypoints-render-loop.js's own comment on that function. A plain {folderId}
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
function ActiveTabTrail({ bc }) {
  const currentRef = useRef(null);

  if (!bc.current) return null;

  return (
    <>
      {bc.hasMore && (
        <>
          <span
            className="breadcrumb-pill-ellipsis"
            onPointerDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
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
        onPointerDown={(e) => e.stopPropagation()}
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
function TabRow({ tab, isActive, canClose, dragX, isDragging, tabRef, onDragStart, onDragMove, onDragEnd }) {
  const suppressClickRef = useRef(false);
  const bc = useSyncExternalStore(breadcrumbMapStore.subscribe, breadcrumbMapStore.getSnapshot, () => EMPTY_BREADCRUMB);
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
    timers.push(setTimeout(() => {
      if (cancelled) return;
      setPhase("fly-out");
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setPhase("resize");
        setShowTrail(true);
        timers.push(setTimeout(() => {
          if (cancelled) return;
          setPhase("fly-in");
          timers.push(setTimeout(() => {
            if (cancelled) return;
            setPhase("idle");
          }, CONTENT_FLY_MS));
        }, RESIZE_MS));
      }, CONTENT_FLY_MS));
    }, SWITCH_DELAY_MS));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [isActive]);

  const contentClass =
    phase === "fly-out" ? " tab-content-fly-out" : phase === "fly-in" ? " tab-content-fly-in" : phase === "resize" ? " tab-content-hidden" : "";

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
      <div className={"tab-pill-content" + contentClass}>
        {showTrail ? <ActiveTabTrail bc={isActive ? bc : lastOwnBc} /> : <span className="tab-pill-label">{tab.label}</span>}
      </div>
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
  // "+" button now portals separately, into #right-actions-pill's own #tab-add-slot (top-bar.html)
  // alongside #collab-bubble, rather than being the tab row's own last child — per explicit request
  // to group it with the collaborator button instead. See #tab-add-btn's own comment, globals.css,
  // for why it needed its own portal target rather than just living inside #collab-bubble itself.
  const addBtnPortalNode = usePortalNode("tab-add-slot");

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

  if (!tabs.length) return null;

  return (
    <>
      {portalNode && createPortal(
        tabs.map((tab) => (
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
        )),
        portalNode,
      )}
      {addBtnPortalNode && createPortal(
        <button type="button" id="tab-add-btn" title="New tab" onClick={(e) => { e.stopPropagation(); window.__addTab(); }}>
          +
        </button>,
        addBtnPortalNode,
      )}
    </>
  );
}
