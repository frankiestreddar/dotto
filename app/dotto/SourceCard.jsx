"use client";

import { useLayoutEffect, useRef } from "react";

// Ported from the old inline source branch in renderLegacyCardBody (public/dotto/waypoints-render-
// loop.js) — this is the "Source" card kind (kind:'source'), a database block storing entries for
// linking with games, not to be confused with the "Canvas" card kind (a nested canvas, see
// CanvasCard.jsx) or the "Table" card kind (a plain in-canvas grid, see TableCard.jsx). The icon is
// built as real JSX rather than via kindIconHTML's returned HTML string, since that string is a
// standalone <span> and dangerouslySetInnerHTML-ing it here would require an extra wrapper element
// not present in the original flat markup (icon span and .source-card-info are direct siblings) —
// kindIconFile (just the icon-filename lookup) is bridged instead so the same table stays the single
// source of truth.
export default function SourceCard({ it }) {
  const titleRef = useRef(null);

  // `el` is SourceCard's own wrapper, passed in explicitly — see CanvasCard.jsx's identical comment.
  useLayoutEffect(() => {
    const el = document.getElementById("item-" + it.id);
    if (el && titleRef.current) window.__attachSourceCardClick(el, it, titleRef.current);
  });

  const liveTitle = window.__folderTitle(it.folderId);
  const nestedCount = window.__countSourceEntries(it.folderId);
  const iconUrl = `/assets/icons/${window.__kindIconFile("source")}`;

  return (
    <>
      <span
        className="source-card-icon icon-mask"
        style={{ maskImage: `url(${iconUrl})`, WebkitMaskImage: `url(${iconUrl})` }}
      />
      <div className="source-card-info">
        <span ref={titleRef} className="source-card-title" title={liveTitle}>
          {liveTitle}
        </span>
        <span className="source-card-count">
          {nestedCount} {nestedCount === 1 ? "entry" : "entries"}
        </span>
      </div>
    </>
  );
}
