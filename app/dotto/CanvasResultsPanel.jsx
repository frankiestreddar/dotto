"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { canvasResultsStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// One ranked match row — real JSX, not a vanilla builder, since there's no complex per-row widget
// state here (just an icon, some text, an onclick) — see canvasResultsStore's own comment in
// bridges.js for why this one genuinely needs createPortal (real list identity) unlike the
// single-owner panels. The icon reuses the same window.__kindIconFile + mask-image technique
// SourceCard.jsx uses, for the same reason: kindIconHTML returns a standalone <span> as an HTML
// string, and dangerouslySetInnerHTML-ing that here would need an extra wrapper not present in
// the original flat markup.
function ResultRow({ m, isSourceFolder, index }) {
  const handleClick = (e) => {
    e.stopPropagation();
    if (isSourceFolder) window.__goToSourceRow(m.tableId, m.ri);
    else window.__goToCanvasItem(m.it.id);
  };

  const text = (isSourceFolder ? m.text : m.text || "(untitled)").slice(0, 60);

  return (
    <div className="search-result-item" data-index={index} onClick={handleClick}>
      {isSourceFolder ? (
        <span className="search-result-kind">Row {m.ri + 1}</span>
      ) : (
        <span
          className="search-result-kind-icon icon-mask"
          style={{
            maskImage: `url(/assets/icons/${window.__kindIconFile(m.it.kind, m.it.level)})`,
            WebkitMaskImage: `url(/assets/icons/${window.__kindIconFile(m.it.kind, m.it.level)})`,
          }}
        />
      )}
      <span className="search-result-text">{text}</span>
      <span className="search-result-index-pill">{index + 1}</span>
    </div>
  );
}

// Portals into #search-results (content/fragments/top-bar.html). setSearchActive's keyboard-nav
// code (ai-assistant-suggestions.js) and the ArrowUp/ArrowDown/digit-key/Enter handlers
// (search-orchestration-selection.js) keep working unmodified against these rows — they only ever
// use querySelectorAll('.search-result-item')/classList/.click(), plain DOM APIs that don't care
// who created the elements, as long as the rows exist in the DOM in the same order the matches
// array is in. That's why __setCanvasResults (app/dotto-app.jsx) wraps this store's set in
// flushSync: those handlers, and updateSearchDropdown, both read the DOM synchronously.
export default function CanvasResultsPanel() {
  const state = useSyncExternalStore(canvasResultsStore.subscribe, canvasResultsStore.getSnapshot, () => null);
  const portalNode = usePortalNode("search-results");

  useLayoutEffect(() => {
    const el = document.getElementById("search-results");
    if (el) el.style.display = state && state.matches.length ? "block" : "none";
  }, [state]);

  if (!portalNode) return null;

  return createPortal(
    (state ? state.matches : []).map((m, i) => (
      <ResultRow key={state.isSourceFolder ? `row-${m.ri}` : `item-${m.it.id}`} m={m} isSourceFolder={state.isSourceFolder} index={i} />
    )),
    portalNode,
  );
}
