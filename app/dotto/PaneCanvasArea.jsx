"use client";

import { useLayoutEffect, useMemo } from "react";
import CanvasItemsLayer from "./CanvasItemsLayer";
import PaneTopBar from "./PaneTopBar";
import PaneZoomBar from "./PaneZoomBar";

// Split-screen Stage 4 (see the split-screen plan). Renders one pane's own copy of
// content/fragments/canvas-area.html — the exact same static markup CanvasArea.jsx/MarkupSection
// always rendered, still injected via dangerouslySetInnerHTML — plus that pane's own
// <CanvasItemsLayer>, portalled into its own #items-layer.
//
// Pane 0 keeps its ORIGINAL, unqualified ids (canvas/world/dot-layer/cursor-overlay/items-layer).
// globals.css has ~13 rules keyed on those exact ids (#canvas.crosshair, #canvas.mode-data,
// #world, #dot-layer, #cursor-overlay, and their state-class combinators) — pane-qualifying pane
// 0's ids too (the way canvas item ids already are, see itemElId, app/dotto/lib/coreState.ts) would have
// silently stopped every one of them from matching, breaking cursor/background/overflow/mode
// styling app-wide the instant split-screen work started. Every ADDITIONAL pane (paneId >= 1)
// gets qualified ids instead (canvas-1, etc.), and EVERY pane (0 included) gets a shared
// pane-canvas/pane-world/pane-dot-layer/pane-cursor-overlay class — globals.css's relevant rules
// were extended (never replaced) to also match those classes, so qualified panes get identical
// styling without a duplicate rule set of their own.
const PANE_MARKUP_IDS = [
  { staticId: "canvas", cls: "pane-canvas" },
  { staticId: "world", cls: "pane-world" },
  { staticId: "dot-layer", cls: "pane-dot-layer" },
  { staticId: "cursor-overlay", cls: "pane-cursor-overlay" },
  // items-layer has no CSS of its own (content/fragments/canvas-area.html: "deliberately left
  // unstyled") — no class needed, just its id.
  { staticId: "items-layer", cls: null },
];

// data-pane-id is added to the #canvas/#canvas-{paneId} element itself (rather than an extra
// wrapper div around it) — PaneGrid.jsx's capture-phase pointerdown router uses it to identify
// which pane was clicked via a plain e.target.closest("[data-pane-id]"), with no additional DOM
// nesting beyond what content/fragments/canvas-area.html already has.
function paneQualifyHtml(html, paneId) {
  if (paneId === 0) {
    // Pane 0: ids stay exactly as they are — only add the shared classes (+ data-pane-id).
    let out = html;
    PANE_MARKUP_IDS.forEach(({ staticId, cls }) => {
      if (!cls) return;
      out = out.replace(`id="${staticId}"`, `id="${staticId}" class="${cls}"`);
    });
    return out.replace('id="canvas"', 'id="canvas" data-pane-id="0"');
  }
  let out = html;
  PANE_MARKUP_IDS.forEach(({ staticId, cls }) => {
    const qualifiedId = `${staticId}-${paneId}`;
    out = out.replace(
      `id="${staticId}"`,
      cls ? `id="${qualifiedId}" class="${cls}"` : `id="${qualifiedId}"`,
    );
  });
  return out.replace(`id="canvas-${paneId}"`, `id="canvas-${paneId}" data-pane-id="${paneId}"`);
}

// rect is {x,y,w,h} in fractional [0,1] viewport coordinates (see app/dotto/lib/paneLayoutStore.ts),
// relative to PaneGrid's own .pane-grid-viewport wrapper — which already reserves the same rail/
// hmenu space #canvas's own CSS always did (see globals.css), so a single, unsplit pane's rect
// (the full box, {x:0,y:0,w:1,h:1}) lands exactly where #canvas always rendered, with zero visual
// change. Positioning is applied directly to the resolved #canvas/#canvas-{paneId} DOM node (not
// via a further wrapper) — this pane's canvas root is exactly the element globals.css's #canvas
// rule already makes position:absolute, so an inline style here naturally overrides that rule's
// own top/left/width/height (inline styles always beat a stylesheet rule, regardless of selector
// specificity) without needing to touch that rule itself. A plain percentage style (not the CSS
// custom-property based --rail-width/--hmenu-width math #canvas's own base rule uses) is
// intentional for this stage — Stage 4 only needs a fixed, non-animated split to prove the core
// mechanism; an animated drag-to-split gesture is Stage 5+ scope.
export default function PaneCanvasArea({ html, paneId, rect }) {
  const qualifiedHtml = paneQualifyHtml(html, paneId);
  const canvasId = paneId === 0 ? "canvas" : `canvas-${paneId}`;
  // Memoized so the dangerouslySetInnerHTML PROP OBJECT keeps the same reference across renders
  // whenever qualifiedHtml itself hasn't changed — a fresh `{ __html: qualifiedHtml }` literal every
  // render (the more obvious way to write this) was silently replacing #canvas/#canvas-{paneId}'s
  // entire subtree on every single re-render of this component, even when the actual html content
  // was byte-for-byte identical — confirmed via a real production build, not just a dev-mode
  // artifact. That wiped every listener setupDraggingAndClicking/the canvas-level wheel-pan/box-
  // select/context-menu handlers etc. had attached, since the underlying DOM node itself was being
  // torn down and recreated (a real, previously-undiscovered gap the split-screen plan's own
  // research didn't anticipate — Stage 4's own "real go/no-go checkpoint" framing exists for
  // exactly this kind of discovery).
  const dangerousHtml = useMemo(() => ({ __html: qualifiedHtml }), [qualifiedHtml]);

  // qualifiedHtml is a dependency too, not just the rect/id values — if dangerouslySetInnerHTML
  // DOES ever legitimately re-apply (a real qualifiedHtml change), that replaces the whole subtree
  // (a fresh #canvas/#canvas-{paneId} DOM node), which would otherwise leave a freshly-replaced
  // node with no position style at all until something else happened to change rect/canvasId.
  useLayoutEffect(() => {
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;
    canvasEl.style.position = "absolute";
    canvasEl.style.top = rect.y * 100 + "%";
    canvasEl.style.left = rect.x * 100 + "%";
    canvasEl.style.width = rect.w * 100 + "%";
    canvasEl.style.height = rect.h * 100 + "%";
  }, [canvasId, rect.x, rect.y, rect.w, rect.h, qualifiedHtml]);

  return (
    <>
      <div dangerouslySetInnerHTML={dangerousHtml} />
      <CanvasItemsLayer paneId={paneId} />
      {/* This pane's own FULL top-bar pill — nav-arrows, tab row, collaborator bubble, and add-tab
          button together (split-screen Stage 8, explicit correction — Stage 7 only made the tab
          row itself per-pane; see PaneTopBar.jsx's own comment for the full story). Centered over
          THIS pane's own box via the same fractional rect every other per-pane element here uses —
          for a single unsplit pane (rect the full viewport) this lands at exactly the same screen
          position the old single global #top-bar-center always did, so nothing visually changes
          until a pane actually exists to need its own. */}
      <PaneTopBar paneId={paneId} rect={rect} />
      {/* This pane's own media-viewer zoom bar (PaneZoomBar.jsx — explicit request/spec) — only
          renders any actual DOM once this pane is both the active one AND its current tab is a
          media-viewer, so it costs nothing extra for the common (non-media-viewer) case. */}
      <PaneZoomBar paneId={paneId} rect={rect} />
    </>
  );
}
