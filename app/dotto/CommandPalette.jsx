"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { commandPaletteStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// One suggestion row — kind autocomplete ("/source", "/canvas"), an id lookup, or an own-tree
// name match (see command-palette.js's buildCommandRows for the three row shapes). data-index
// drives the existing keyboard-nav technique (querySelectorAll + classList,
// search-orchestration-selection.js's setCommandActive).
function CommandRow({ row, index }) {
  return (
    <div
      className="command-palette-row"
      data-index={index}
      onClick={(e) => {
        e.stopPropagation();
        window.__selectCommandRow(row);
      }}
    >
      <span className="command-palette-row-label">{row.label}</span>
      <span className="command-palette-row-sublabel">{row.sublabel}</span>
    </div>
  );
}

// Portals into #search-command-palette (content/fragments/top-bar.html), ordered first among
// #search-dropdown's children so it visually leads whenever it has rows — see
// updateSearchDropdown's panel list (ai-assistant-suggestions.js), which this node's own
// display:block/none (driven by the layout effect below) participates in exactly like every
// other panel there.
export default function CommandPalette() {
  const state = useSyncExternalStore(
    commandPaletteStore.subscribe,
    commandPaletteStore.getSnapshot,
    () => null,
  );
  const portalNode = usePortalNode("search-command-palette");

  useLayoutEffect(() => {
    const el = document.getElementById("search-command-palette");
    if (el) el.style.display = state && state.rows.length ? "block" : "none";
  }, [state]);

  if (!portalNode) return null;

  return createPortal(
    (state ? state.rows : []).map((row, i) => <CommandRow key={row.key} row={row} index={i} />),
    portalNode,
  );
}
