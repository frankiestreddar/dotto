"use client";

import { useLayoutEffect, useRef } from "react";

// Ported from the old inline folder branch in renderLegacyCardBody (public/dotto/waypoints-render-
// loop.js) — this is the "Canvas" card kind (kind:'folder'), a nested canvas, not to be confused
// with the "Table" card kind (a plain in-canvas grid, see TableCard.jsx) or the "Source" card kind
// (a database block, see SourceCard.jsx). buildFolderInlineCanvas/attachFolderCardClick/
// startRenameFolderCardTitle all stay vanilla: the preview is a whole live mini-canvas DOM tree with
// its own auto-fit zoom/pan math (see buildFolderInlineCanvas's own comment), not worth re-deriving
// in JSX, and the title's click-to-rename lifecycle is coupled to appState/broadcastEditingState the
// same way Title/Note/Watermark's bodies are.
export default function CanvasCard({ it }) {
  const titleRef = useRef(null);
  const previewWrapRef = useRef(null);

  // Rebuilding the inline preview walks every nested item and renders a mini preview of each —
  // there's no cheap signature for "did this folder's live contents change", so this only reruns
  // when the nested folder itself changes, not on every unrelated render() call (same reasoning as
  // the Shelf/stopwatch-tick fix, and MediaCard's own dependency array).
  useLayoutEffect(() => {
    if (!previewWrapRef.current) return;
    previewWrapRef.current.innerHTML = "";
    previewWrapRef.current.appendChild(window.__buildFolderInlineCanvas(it.folderId));
  }, [it.folderId]);

  // `el` is CanvasCard's own wrapper, passed in explicitly via document.getElementById rather than
  // derived via closest('.item') — see attachWatermarkBody/attachTitleBody's comments for why
  // closest() breaks on first mount (child-before-parent layout effect ordering).
  useLayoutEffect(() => {
    const el = document.getElementById("item-" + it.id);
    if (el && titleRef.current) window.__attachFolderCardClick(el, it, titleRef.current);
  });

  const liveTitle = window.__folderTitle(it.folderId);

  return (
    <>
      <div ref={titleRef} className="folder-card-title" title={liveTitle}>
        {liveTitle}
      </div>
      <div ref={previewWrapRef} className="folder-card-preview" />
    </>
  );
}
