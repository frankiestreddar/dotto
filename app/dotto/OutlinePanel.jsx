"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { outlineStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };

// Same mask-image icon shape kindIconHTML (app/dotto/lib/outlineTree.ts) already builds for every
// other outline-icon use — window.__kindIconFile resolves the kind(+level)->filename mapping,
// bridged since kindIconFile is also called from vanilla files (live-presence.js and others).
function OutlineIcon({ kind, level }) {
  const url = `/assets/icons/${window.__kindIconFile(kind, level)}`;
  return (
    <span
      className="outline-icon icon-mask"
      style={{ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }}
    />
  );
}

// Collapse toggle (explicit request) — only rendered for a heading (title kind) row that actually
// has something nested under it (r.hasChildren, computed by renderHeadingSubtree,
// app/dotto/lib/outlineTree.ts: a grouped item OR a child heading). Sits in the same slot as
// OutlineIcon and only shows on row hover, swapping places with it via CSS (.has-children:hover) —
// same mechanism/reasoning as the Blocks panel's own folder-collapse toggle, BlocksPanel.jsx.
function OutlineCollapseToggle({ id, collapsed }) {
  return (
    <button
      type="button"
      className={"outline-collapse-toggle" + (collapsed ? " collapsed" : "")}
      onClick={(e) => {
        e.stopPropagation();
        window.__toggleOutlineCollapse(id);
      }}
      title={collapsed ? "Expand" : "Collapse"}
    >
      <img src="/assets/icons/chevron.png" alt="" />
    </button>
  );
}

// Three row shapes, computed by computeOutlineRows/computeSourceOutlineRows
// (app/dotto/lib/outlineTree.ts) — see their own comments for the full field meanings:
//   - rowKind 'item': any non-source card/heading/nested-canvas row. Click lands on it within its
//     own parent folder (window.__goToOutlineItem) — never drills into a nested canvas from here.
//   - rowKind 'source': a source-linking item. Click enters it directly (window.__goToOutlineSource)
//     rather than centering on a card, unlike every other kind.
//   - rowKind 'sourceRow': a source PAGE's own table rows (only ever the entire row set when the
//     current folder itself is a source) — numbered instead of icon'd, click focuses that row's
//     first cell in the live table (window.__goToOutlineSourceRow) instead of panning a canvas.
// No --outline-indent style on a sourceRow row — .outline-item's own CSS falls back to 0px, same
// as the old rowEl never setting it for these rows either.
function OutlineRow({ r }) {
  if (r.rowKind === "sourceRow") {
    return (
      <div
        className="outline-item"
        onClick={(e) => {
          e.stopPropagation();
          window.__goToOutlineSourceRow(r.tableItemId, r.number);
        }}
      >
        <span className="outline-item-number">{r.number}</span>
        <span className="outline-label">{r.label}</span>
        <RowActions />
      </div>
    );
  }
  return (
    <div
      className={"outline-item" + (r.hasChildren ? " has-children" : "")}
      style={{ "--outline-indent": r.indent + "px" }}
      onClick={(e) => {
        e.stopPropagation();
        if (r.rowKind === "source") window.__goToOutlineSource(r.targetFolderId);
        else window.__goToOutlineItem(r.parentFolderId, r.id);
      }}
    >
      <OutlineIcon kind={r.itemKind} level={r.level} />
      {r.hasChildren && <OutlineCollapseToggle id={r.id} collapsed={r.collapsed} />}
      <span className="outline-label">{r.label}</span>
      <RowActions />
    </div>
  );
}

// Portals into #hmenu-outline-container (content/fragments/hamburger-stack.html) — a plain
// flex-item container, safe to portal into directly, no wrapper needed. Visibility of the panel
// itself stays a vanilla classList toggle (openRailView/wireRailIcon, app/dotto/lib/panelsHamburger.ts),
// unrelated to this — this component only owns the row list, same division of ownership every
// other converted sidebar list panel already uses (SourcesListPanel.jsx and friends).
//
// The useLayoutEffect below is this panel's one real difference from those: srs-connections-core.js's
// existing ArrowUp/ArrowDown/Enter keyboard-nav block reads real DOM nodes out of
// appState.outlineRows (untouched by this migration), so every time the row list changes, the
// portal's freshly-committed .outline-item children are handed back to vanilla via
// window.__syncOutlineRows — a layout effect (not a plain effect) so this happens synchronously,
// before buildOutline's own flushSync call (app/dotto-app.jsx's window.__setOutlineState) returns
// and toggleHamburgerMenu's setOutlineActive(0) call runs immediately after it.
export default function OutlinePanel() {
  const state = useSyncExternalStore(
    outlineStore.subscribe,
    outlineStore.getSnapshot,
    () => EMPTY_STATE,
  );
  const portalNode = usePortalNode("hmenu-outline-container");

  useLayoutEffect(() => {
    // window.__syncOutlineRows is set by app/dotto/lib/outlineTree.ts's own side-effect import
    // (app/dotto-app.jsx), evaluated as part of the same module graph as this component — always
    // ready by the time this effect runs. The guard stays purely defensive: real rows can only
    // ever reach outlineStore via buildOutline/handleOutlineSearch (both in that same file), so
    // there's nothing real to hand back on the EMPTY_STATE first render regardless.
    if (!portalNode || typeof window.__syncOutlineRows !== "function") return;
    window.__syncOutlineRows(portalNode.querySelectorAll(".outline-item"));
  }, [state.rows, portalNode]);

  if (!portalNode) return null;

  return createPortal(
    state.rows.length ? (
      state.rows.map((r) => <OutlineRow key={r.id} r={r} />)
    ) : (
      <div className="outline-empty">
        {state.query ? "No matching blocks." : "Nothing here yet."}
      </div>
    ),
    portalNode,
  );
}
