"use client";

import { useLayoutEffect, useRef } from "react";
import { setupResizing } from "./canvasItemBehavior";

// Ported from the old inline media branch in renderLegacyCardBody (public/dotto/waypoints-render-
// loop.js, logic itself in public/dotto/media-pdf-epub.js). buildPdfViewer/buildEpubViewer build a
// whole live DOM subtree (pdf.js/epub.js need real canvas/iframe elements, not an HTML string) —
// same "vanilla function builds live DOM, React just mounts it" pattern as CanvasCard's
// buildFolderInlineCanvas. This wrapper div uses display:contents so it doesn't participate in
// layout itself — the mounted content (.pdf-viewer/.epub-viewer/img/video) sizes itself via
// width/height:100%, which per spec resolves against the nearest ANCESTOR that generates a box
// once this wrapper is display:contents — i.e. the .item wrapper itself, exactly matching the
// original flat markup (buildPdfViewer/buildEpubViewer were appended straight onto `el`, no
// wrapper div at all).
//
// Rebuilding a PDF/EPUB viewer from scratch is expensive (canvas paint, iframe reflow, loses
// in-progress scroll/zoom) and there's no cheap signature for "did this media actually change" —
// so, like CanvasCard's buildFolderInlineCanvas, this only reruns when the fields that actually
// describe WHAT to render change, not on every unrelated render() call (same reasoning as the
// Shelf/stopwatch-tick fix — without this, a running Stopwatch elsewhere on the canvas would tear
// down and rebuild every PDF card once a second).
export default function MediaCard({ it }) {
  const mountRef = useRef(null);

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.innerHTML = "";
    if (it.mediaSrc && it.mediaType === "pdf") {
      mount.appendChild(window.__buildPdfViewer(it));
    } else if (it.mediaSrc && it.mediaType === "epub") {
      mount.appendChild(window.__buildEpubViewer(it));
    } else {
      mount.innerHTML = window.__renderMediaHTML(it);
      // A no-op until there's real content to resize (the empty/uploading states have no .resize
      // handle yet — see setupResizing's own early return). `el`, not `mount` — setupResizing
      // reads/writes el.style.width/height and el.offsetWidth/Height directly, so it needs the
      // actual sized .item wrapper, not this unstyled mount point.
      const el = document.getElementById("item-" + it.id);
      if (el) setupResizing(el, it);
    }
    // `it` itself (not just the fields below) is deliberately left out of the deps list — this
    // component only ever renders one keyed item for its whole lifetime (key={it.id} in
    // CanvasItemsLayer), so `it` is never stale in a way these fields wouldn't already catch; the
    // fields below are the actual "should this rebuild" signal (see this component's own comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.id, it.mediaSrc, it.mediaType, it.mediaUploading, it.mediaName]);

  return <div ref={mountRef} style={{ display: "contents" }} />;
}
