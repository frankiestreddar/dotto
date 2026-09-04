"use client";

import { useEffect, useState } from "react";
import { useMediaViewerZoomStore } from "./lib/mediaViewerZoomStore";
import { setMediaViewerZoom } from "./lib/waypointsRenderLoop";
import type { PaneRect } from "./lib/paneLayoutStore";

const ZOOM_STEP = 0.25;

// One per pane, mounted from PaneCanvasArea.jsx alongside PaneTopBar — a zoom control for a
// media-viewer tab (window.__openMediaViewerTab), explicit request/spec: "allow zooming in and out
// of the document, with the default 100% zoom being the document at 100% width of the window...
// each split window should have its own zoom bar, not just one overall." Visibility went through
// two corrections: first gated purely on "current meaning last clicked in" (activePaneIdStore);
// then, per "the zoom slider for each window are not showing when the window is hovered", extended
// to ALSO show on hover; then, per the explicit follow-up "they still dont hide and show depending
// on the window your mouse is in", simplified to PURE hover — visible if and only if the cursor is
// currently over THAT pane's own canvas, full stop, no "stays up because it's the active pane"
// exception (activePaneIdStore/the pane-activity concept isn't used here at all any more).
// `hovered` is tracked via a plain rect-hit-test on every mousemove (same shape as PaneTopBar.jsx's
// own proximity-hover listener) rather than mouseenter/mouseleave directly on the canvas element —
// this bar itself sits ABOVE the canvas (a sibling positioned on top, not a descendant), so moving
// the cursor from the canvas onto the bar's own buttons would otherwise fire a real mouseleave on
// the canvas partway through the click, immediately hiding the very control being reached for. A
// rect check doesn't care about that layering: the bar's own box sits within the same canvas rect,
// so hovering it still reads as "inside."
// zoom itself is a plain multiplier (1 = 100%) stored on the media-viewer's own synthetic folder
// object (folderObj.viewerZoom), not here — this store is just this component's own reactive mirror
// of it (see app/dotto/lib/mediaViewerZoomStore.ts's own comment). setMediaViewerZoom
// (app/dotto/lib/waypointsRenderLoop.ts) restyles the already-live viewer element's own --viewer-zoom custom
// property directly rather than going through a full render(), so clicking +/- doesn't reset an
// <iframe> PDF's or epub.js's own internal scroll position on every click.
export default function PaneZoomBar({ paneId, rect }: { paneId: number; rect: PaneRect }) {
  const zoomState = useMediaViewerZoomStore.storeFor(paneId)();
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const canvasId = paneId === 0 ? "canvas" : "canvas-" + paneId;
    function handleMove(e: MouseEvent) {
      const canvasEl = document.getElementById(canvasId);
      if (!canvasEl) return;
      const r = canvasEl.getBoundingClientRect();
      const inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      setHovered((prev) => (prev === inside ? prev : inside));
    }
    document.addEventListener("mousemove", handleMove);
    return () => document.removeEventListener("mousemove", handleMove);
  }, [paneId]);

  if (!hovered || !zoomState.show) return null;

  const pct = Math.round(zoomState.zoom * 100);

  return (
    <div
      className="pane-zoom-bar"
      style={{
        right: `calc(${(1 - (rect.x + rect.w)) * 100}% + 20px)`,
        bottom: `calc(${(1 - (rect.y + rect.h)) * 100}% + 20px)`,
      }}
    >
      <button
        type="button"
        className="pane-zoom-btn"
        title="Zoom out"
        onClick={() => setMediaViewerZoom(paneId, zoomState.zoom - ZOOM_STEP)}
      >
        −
      </button>
      <button
        type="button"
        className="pane-zoom-pct"
        title="Reset to 100%"
        onClick={() => setMediaViewerZoom(paneId, 1)}
      >
        {pct}%
      </button>
      <button
        type="button"
        className="pane-zoom-btn"
        title="Zoom in"
        onClick={() => setMediaViewerZoom(paneId, zoomState.zoom + ZOOM_STEP)}
      >
        +
      </button>
    </div>
  );
}
