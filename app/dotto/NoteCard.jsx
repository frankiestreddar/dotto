"use client";

import { useLayoutEffect } from "react";

// Ported from the old default/untyped branch in renderLegacyCardBody (public/dotto/waypoints-
// render-loop.js) — the most common card kind on any canvas. Format-bar (bold/italic/underline/
// color) is real JSX with direct handlers (document.execCommand is a plain browser API, no bridge
// needed); the body's click-to-edit lifecycle plus the "More…" expand/collapse height animation
// stay vanilla as attachNoteBody, called via document.getElementById('item-'+it.id) each render —
// same technique TitleCard uses for its wrapper-level fontSize, needed here because attachNoteBody
// itself needs the wrapper (for the expand/collapse animation, resize, and the click-to-edit
// classList toggle), not just the body — see that function's own comment for the full reasoning
// (coupled to appState.currentEditingEl/broadcastEditingState, and a height:auto CSS transition
// needs real getBoundingClientRect measurements JS has to drive).
export default function NoteCard({ it }) {
  useLayoutEffect(() => {
    const el = document.getElementById("item-" + it.id);
    if (el) window.__attachNoteBody(el, it);
  });

  return (
    <>
      <div className="format-bar" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="format-btn" onMouseDown={() => document.execCommand("bold")}>
          B
        </button>
        <button type="button" className="format-btn" onMouseDown={() => document.execCommand("italic")}>
          I
        </button>
        <button type="button" className="format-btn" onMouseDown={() => document.execCommand("underline")}>
          U
        </button>
        <input type="color" className="text-color-swatch" onInput={(e) => document.execCommand("foreColor", false, e.target.value)} />
      </div>
      <div className="body" data-placeholder="Note..." dangerouslySetInnerHTML={{ __html: it.html || "" }} />
      <div className="more-btn" style={{ display: "none" }}>
        {it.expanded ? "Collapse" : "More…"}
      </div>
      <div className="resize">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 2L2 10M10 6L6 10M10 10L10 10" />
        </svg>
      </div>
    </>
  );
}
