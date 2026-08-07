"use client";

import { useLayoutEffect, useRef } from "react";

// Ported from the old inline title branch in renderLegacyCardBody (public/dotto/waypoints-render-
// loop.js). Body's click-to-edit lifecycle (attachTitleBody) stays vanilla, same reasoning as
// WatermarkCard's attachWatermarkBody — coupled to appState.currentEditingEl/broadcastEditingState,
// shared with other still-unconverted click-to-edit kinds (note).
//
// fontSize lives on the WRAPPER <div>, not this component's own top-level element (there isn't a
// single one — format-bar and body are siblings, same as the original markup) — set directly via
// document.getElementById('item-'+it.id) each render, same technique swTick/fcFlip use to reach a
// card from outside React. setTitleLevel (live-presence.js) already patches this itself for the
// one interaction that changes it directly; this covers every other reason it.level might change
// (initial mount, a remote sync) — redundant with setTitleLevel's own patch but harmless, since
// it's always reapplying the same correct value.
export default function TitleCard({ it }) {
  const bodyRef = useRef(null);

  useLayoutEffect(() => {
    const el = document.getElementById("item-" + it.id);
    if (el) el.style.fontSize = window.__titleFontSize(it.level || 1) + "px";
    if (bodyRef.current) window.__attachTitleBody(bodyRef.current, it);
  });

  return (
    <>
      <div className="format-bar" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <select
          className="format-select"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => window.setTitleLevel(it.id, e.target.value)}
          value={String(it.level || 1)}
        >
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
        </select>
        <input type="color" className="text-color-swatch" onInput={(e) => document.execCommand("foreColor", false, e.target.value)} />
      </div>
      <div className="body" ref={bodyRef} data-placeholder="Title..." dangerouslySetInnerHTML={{ __html: it.html || "" }} />
    </>
  );
}
