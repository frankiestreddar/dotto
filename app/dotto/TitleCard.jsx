"use client";

import { useLayoutEffect, useRef } from "react";
import { setTitleLevel, titleFontSize } from "./lib/messagingCanvasPreview";
import { attachTitleBody } from "./lib/waypointsRenderLoop";

// Ported from the old inline title branch in renderLegacyCardBody (app/dotto/lib/
// waypointsRenderLoop.ts). Body's click-to-edit lifecycle (attachTitleBody) stays vanilla, same reasoning as
// WatermarkCard's attachWatermarkBody — coupled to appState.currentEditingEl/broadcastEditingState,
// shared with other still-unconverted click-to-edit kinds (note).
//
// fontSize lives on the WRAPPER <div>, not this component's own top-level element (there isn't a
// single one — format-bar and body are siblings, same as the original markup) — set directly via
// window.__findItemEl(it.id, paneId) each render, same technique swTick/fcFlip use to reach a
// card from outside React. setTitleLevel (app/dotto/lib/messagingCanvasPreview.ts, now a real ES
// import here too) already patches this itself for the one interaction that changes it directly;
// this covers every other reason it.level might change (initial mount, a remote sync) — redundant
// with setTitleLevel's own patch but harmless, since it's always reapplying the same correct value.
//
// That same el lookup is also what attachTitleBody needs for its wrapper — passed in explicitly
// rather than derived via bodyRef.current.closest('.item') inside that function, which broke on
// first mount: React fires a CHILD component's layout effect (this one) before its PARENT's
// (CanvasItem's, which is what actually sets className="item title" via applyItemWrapperAttrs),
// so closest('.item') ran too early and matched nothing. document.getElementById doesn't have
// this problem — the wrapper <div> itself already exists in the DOM by the time ANY layout effect
// runs (React commits DOM mutations before firing effects), only its className is what's not set
// yet.
export default function TitleCard({ it, paneId }) {
  const bodyRef = useRef(null);

  useLayoutEffect(() => {
    const el = window.__findItemEl(it.id, paneId);
    if (el) el.style.fontSize = titleFontSize(it.level || 1) + "px";
    if (el && bodyRef.current) attachTitleBody(el, bodyRef.current, it, paneId);
  });

  return (
    <>
      <div
        className="format-bar"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          className="format-select"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setTitleLevel(it.id, e.target.value)}
          value={String(it.level || 1)}
        >
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
        </select>
        <input
          type="color"
          className="text-color-swatch"
          onInput={(e) => document.execCommand("foreColor", false, e.target.value)}
        />
      </div>
      <div
        className="body"
        ref={bodyRef}
        data-placeholder="Title..."
        dangerouslySetInnerHTML={{ __html: it.html || "" }}
      />
    </>
  );
}
