"use client";

import { computePaneRects, computeSplitDividers, usePaneLayoutStore } from "./lib/paneLayoutStore";
import PaneCanvasArea from "./PaneCanvasArea";

// Split-screen Stage 4 (see the split-screen plan) — replaces the single, always-full-viewport
// <CanvasArea> with 1-4 <PaneCanvasArea> instances, positioned via paneLayoutStore's rects inside
// one wrapper that reserves the same rail/hmenu space #canvas's own CSS always did (see
// .pane-grid-viewport, globals.css) — so the single-pane (no split yet) case renders pixel-identical
// to how the app looked before any of this existed.
//
// The capture-phase pointerdown listener is the single most load-bearing piece of plumbing here:
// it calls switchActivePane BEFORE any bubble-phase handler on the clicked pane's own content runs
// (capture always fires before bubble for the same event, on the same dispatch) — which is what
// makes "whichever pane is active" actually track a click/drag/type into a DIFFERENT pane
// correctly, since every synchronous gesture function elsewhere (setupDraggingAndClicking,
// startConnectionDrag, resize handles, ...) still just reads canvas/world/appState.tx and friends
// ambiently, assuming whichever pane is "active" is already correct by the time it runs.
export default function PaneGrid({ html }: { html: string }) {
  // Zustand's own getInitialState() (what useStore's SSR snapshot reads) already matches the
  // store's real initial value ({type:"leaf",paneId:0}) — no separate module-level fallback
  // constant needed the way the old useSyncExternalStore call required (see
  // ProfileLevelPill.tsx/SelectionToolbar.tsx's identical comment for the server/client hydration
  // mismatch this avoids).
  // The store itself holds a split TREE, not a flat rect list (Stage 6 — see usePaneLayoutStore's
  // own comment, app/dotto/lib/paneLayoutStore.ts). computePaneRects walks it fresh on every
  // render into the flat [{ paneId, rect }] this component actually needs — cheap (at most 4
  // leaves) and simpler than trying to memoize a derivation this small.
  const tree = usePaneLayoutStore();
  const panes = computePaneRects(tree);
  const dividers = computeSplitDividers(tree);

  const handlePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const paneEl = (e.target as HTMLElement).closest<HTMLElement>("[data-pane-id]");
    if (!paneEl) return;
    const paneId = Number(paneEl.dataset.paneId);
    if (Number.isNaN(paneId) || paneId === window.__getAppState!().activePaneId) return;
    window.__switchActivePane!(paneId);
  };

  return (
    <div className="pane-grid-viewport" onPointerDownCapture={handlePointerDownCapture}>
      {panes.map(({ paneId, rect }) => (
        <PaneCanvasArea key={paneId} html={html} paneId={paneId} rect={rect} />
      ))}
      {/* Dividing line between panes (explicit request) — one per split node in the tree, not one
          per pane, so a quartered layout gets exactly the 3 lines it visually needs rather than
          each pane drawing its own border and doubling up along shared edges. pointer-events:none
          so a 2px line can never itself swallow the capture-phase pane-switch click below it. */}
      {dividers.map((d, i) => (
        <div
          key={"divider-" + i}
          className={"pane-divider pane-divider-" + d.orientation}
          style={
            d.orientation === "vertical"
              ? { left: d.x * 100 + "%", top: d.y * 100 + "%", height: d.length * 100 + "%" }
              : { top: d.y * 100 + "%", left: d.x * 100 + "%", width: d.length * 100 + "%" }
          }
        />
      ))}
      {/* Split-screen Stage 6 — a pane can only be closed once a second one exists (mirrors
          closeTab's own "always keep at least one" guard, just for panes instead of tabs).
          Positioned in the same fractional [0,1] rect space PaneCanvasArea itself uses, against
          this same position:absolute .pane-grid-viewport — bottom-left corner of each pane's own
          box, not top-right: the breadcrumb/tab pill (#top-bar-center) is always centered at the
          very top of the screen, exactly where a row-split's LEFT pane's own top-right corner
          always lands, so top-right collided with it for the single most common topology. Nothing
          this app renders unconditionally lives near the bottom-left of any pane's own box the way
          the tab bar owns the top-center. */}
      {panes.length > 1 &&
        panes.map(({ paneId, rect }) => (
          <button
            key={"close-" + paneId}
            type="button"
            className="pane-close-btn"
            title="Close pane"
            style={{ top: (rect.y + rect.h) * 100 + "%", left: rect.x * 100 + "%" }}
            onClick={(e) => {
              e.stopPropagation();
              window.__closePane!(paneId);
            }}
          >
            ×
          </button>
        ))}
    </div>
  );
}
