"use client";

import { useLayoutEffect, useRef } from "react";

// Ported from the old inline watermark branch in renderLegacyCardBody (public/dotto/waypoints-
// render-loop.js) — see EmbedCard.jsx for the general pattern this follows. Unlike Embed/Checklist,
// the click-to-edit contentEditable lifecycle (click to start editing, blur to commit, Escape to
// exit) stays vanilla — see attachWatermarkBody's own comment for why: it's coupled to
// appState.currentEditingEl/broadcastEditingState, shared state with other still-unconverted
// click-to-edit kinds (title, note), not something safe to peel off in isolation here.
export default function WatermarkCard({ it, paneId }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = window.__findItemEl(it.id, paneId);
    if (el && ref.current) window.__attachWatermarkBody(el, ref.current, it, paneId);
  });

  // dangerouslySetInnerHTML, not plain text children — it.html is genuinely rich content (read/
  // written via b.innerHTML, not .textContent, same as the title/note cards this mirrors), and
  // since it's mutated in place by the same attachWatermarkBody handlers that would otherwise
  // fight a React-diffed value, this is the one field on this card React shouldn't try to own.
  return (
    <div
      ref={ref}
      className="body watermark-text"
      data-placeholder="Type to trace..."
      dangerouslySetInnerHTML={{ __html: it.html || "" }}
    />
  );
}
