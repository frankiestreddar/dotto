"use client";

import { useLayoutEffect } from "react";
import { setupResizing } from "./canvasItemBehavior";

// Ported from the old renderTableHTML (public/dotto/source-table.js — kept there, not deleted:
// renderStaticTableHTML, the much larger Source database-page renderer, shares colgroupHTML with
// it and is a separate, harder conversion of its own — see PHASE2_ROADMAP.md). This is the plain
// in-canvas Table card specifically, not Source's page.
//
// Each <td> is contentEditable with dangerouslySetInnerHTML for its content (cells can contain
// arbitrary HTML from paste/rich content, not just plain text) — same "mutate in place, next real
// render reads current data" reasoning as Checklist's text field: updateTableCell mutates
// it.tableData[r][c] directly and never calls render(), so there's nothing for a later render to
// fight even mid-edit.
//
// A click and drag on a cell should move the whole card, never focus/edit that cell — but the
// browser grabs focus on a contentEditable element the instant mousedown fires, before there's
// any way to know yet whether this gesture is a click or the start of a drag. This tracks real
// pointer movement after mousedown and blurs the cell the moment it crosses
// TABLE_CELL_DRAG_THRESHOLD_PX, handing the gesture over to the wrapper's own whole-card drag
// system (drag-drop-chat.js's setupDraggingAndClicking, already listening on the same
// pointerdown via bubbling — completely unaffected by anything here, it was already tracking this
// same gesture in parallel the whole time). A plain click (no meaningful movement before mouseup)
// never blurs anything, so normal editing is untouched.
//
// Also handles the folder/waypoint title rename's own "the first click into an unfocused field
// always lands the caret at the end, not wherever you clicked" behavior (startRenameFolderCardTitle,
// waypoints-render-loop.js) — but a table <td> is always contentEditable here (never toggled on
// click the way a rename field is), so "was this the very first click into an unfocused cell" is
// detected via document.activeElement at mousedown time, before the browser's own focus+click-to-
// caret handling has run. The deferred placement is itself guarded on dragDetected, so a fast
// drag that starts with a same-tick setTimeout race never re-focuses the cell right after the
// blur above already fired.
const TABLE_CELL_DRAG_THRESHOLD_PX = 4;
function handleCellMouseDown(e) {
  const el = e.currentTarget;
  const wasFocused = document.activeElement === el;
  const downX = e.clientX, downY = e.clientY;
  let dragDetected = false;
  const onMove = (me) => {
    if (dragDetected) return;
    if (Math.hypot(me.clientX - downX, me.clientY - downY) > TABLE_CELL_DRAG_THRESHOLD_PX) {
      dragDetected = true;
      el.blur();
      cleanup();
    }
  };
  const cleanup = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", cleanup);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", cleanup);
  if (!wasFocused) {
    setTimeout(() => { if (!dragDetected) window.__placeCaretEnd(el); }, 0);
  }
}

// it.mergedCells is a flat list of {r1,c1,r2,c2} rectangular regions (see mergeTableCells,
// source-table.js) — a plain, still-unmerged cell has no entry of its own here at all. Builds a
// full numRows x numCols lookup, one entry per grid position pointing at whichever region (real
// or, for an unmerged cell, the trivial 1x1 region matching just itself) actually covers it, so
// the render loop below never has to re-search the list per cell.
function computeMergeGrid(mergedCells, numRows, numCols) {
  const grid = Array.from({ length: numRows }, () => new Array(numCols).fill(null));
  (mergedCells || []).forEach((region) => {
    for (let r = region.r1; r <= region.r2; r++) {
      for (let c = region.c1; c <= region.c2; c++) {
        grid[r][c] = region;
      }
    }
  });
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (!grid[r][c]) grid[r][c] = { r1: r, c1: c, r2: r, c2: c };
    }
  }
  return grid;
}

// userSized's wrapper class + distributeTableSizing, and setupResizing/setupTableGridResizing,
// all need the wrapper element this component doesn't itself own — reached via
// document.getElementById('item-'+it.id) each render, same technique TitleCard/NoteCard use.
export default function TableCard({ it }) {
  useLayoutEffect(() => {
    const el = document.getElementById("item-" + it.id);
    if (!el) return;
    if (it.userSized) {
      el.classList.add("sized");
      requestAnimationFrame(() => window.__distributeTableSizing(it, el));
    }
    setupResizing(el, it);
    window.__setupTableGridResizing(el, it);
  });

  const numCols = it.tableData[0].length;
  const numRows = it.tableData.length;
  // Falls back to an even split whenever there's no real per-column customization yet, or the
  // column count has since changed (adding/removing a column just resets the split rather than
  // trying to preserve old customization across it) — same fallback shape distributeTableSizing
  // (source-table.js) already uses for rows. Only ever WRITTEN to it.colWidths/it.rowHeights by
  // actually dragging a divider (see startTableColResize/startTableRowResize,
  // resize-shortcuts-init.js); this fallback is purely a render-time computation, nothing here
  // persists it.
  const colWidths = Array.isArray(it.colWidths) && it.colWidths.length === numCols ? it.colWidths : new Array(numCols).fill(100 / numCols);
  const rowHeights = Array.isArray(it.rowHeights) && it.rowHeights.length === numRows ? it.rowHeights : new Array(numRows).fill(100 / numRows);
  // Cumulative offsets — the left/top position (as a % of the table's own box) of each internal
  // divider, one fewer than the column/row count since the very last column/row has no divider
  // of its own past its trailing edge.
  let colAcc = 0;
  const colDividerLefts = colWidths.slice(0, -1).map((w) => (colAcc += w));
  let rowAcc = 0;
  const rowDividerTops = rowHeights.slice(0, -1).map((h) => (rowAcc += h));
  const mergeGrid = computeMergeGrid(it.mergedCells, numRows, numCols);
  // colLefts[i]/rowTops[i] is the left/top edge of column/row i as a % of the table's own box
  // (colLefts[numCols]/rowTops[numRows] is the table's own right/bottom edge, 100) — a superset
  // of colDividerLefts/rowDividerTops above (which only need the INTERNAL boundaries), needed
  // here to place a merge-edge overlay against a region's own bounds rather than a single
  // column/row's.
  const colLefts = [0];
  for (const w of colWidths) colLefts.push(colLefts[colLefts.length - 1] + w);
  const rowTops = [0];
  for (const h of rowHeights) rowTops.push(rowTops[rowTops.length - 1] + h);
  // One rendered <td> per merge region (at its own top-left cell), carrying rowSpan/colSpan
  // matching the region's size — every OTHER (r,c) a region covers is skipped (returns null; see
  // computeMergeGrid). Merge-edge overlays (rendered as siblings of <table> further below, same
  // reasoning as the divider handles) are collected into this flat list as a side effect of the
  // same pass, rather than a second walk over the grid.
  const mergeEdges = [];
  const rows = it.tableData.map((row, ri) => (
    <tr key={ri}>
      {row.map((cell, ci) => {
        const region = mergeGrid[ri][ci];
        if (region.r1 !== ri || region.c1 !== ci) return null;
        const rowSpan = region.r2 - region.r1 + 1;
        const colSpan = region.c2 - region.c1 + 1;
        // A merge across this cell's right/bottom edge is only offered when the region on that
        // side spans the exact same row/column range as this one — anything else would produce a
        // non-rectangular union, which a single <td> rowSpan/colSpan can't express.
        const rightRegion = region.c2 + 1 < numCols ? mergeGrid[region.r1][region.c2 + 1] : null;
        if (rightRegion && rightRegion.r1 === region.r1 && rightRegion.r2 === region.r2) {
          mergeEdges.push({
            key: `mr${region.r1}-${region.c1}`,
            className: "table-merge-edge table-merge-edge-v",
            style: { left: colLefts[region.c2 + 1] + "%", top: rowTops[region.r1] + "%", height: rowTops[region.r2 + 1] - rowTops[region.r1] + "%" },
            onClick: () => window.__mergeTableCells(it.id, region, rightRegion),
          });
        }
        const bottomRegion = region.r2 + 1 < numRows ? mergeGrid[region.r2 + 1][region.c1] : null;
        if (bottomRegion && bottomRegion.c1 === region.c1 && bottomRegion.c2 === region.c2) {
          mergeEdges.push({
            key: `mb${region.r1}-${region.c1}`,
            className: "table-merge-edge table-merge-edge-h",
            style: { top: rowTops[region.r2 + 1] + "%", left: colLefts[region.c1] + "%", width: colLefts[region.c2 + 1] - colLefts[region.c1] + "%" },
            onClick: () => window.__mergeTableCells(it.id, region, bottomRegion),
          });
        }
        return (
          <td
            key={ci}
            contentEditable
            suppressContentEditableWarning
            data-r={ri}
            data-c={ci}
            rowSpan={rowSpan > 1 ? rowSpan : undefined}
            colSpan={colSpan > 1 ? colSpan : undefined}
            onMouseDown={handleCellMouseDown}
            onInput={(e) => window.updateTableCell(it.id, ri, ci, e.currentTarget)}
            onKeyDown={(e) => window.handleTableKeydown(e, it.id, ri, ci)}
            onFocus={() => window.broadcastEditingState(true, `#item-${it.id} td[data-r="${ri}"][data-c="${ci}"]`)}
            onBlur={() => window.broadcastEditingState(false)}
            dangerouslySetInnerHTML={{ __html: cell }}
          />
        );
      })}
    </tr>
  ));

  return (
    <>
      <div className="static-table-wrap" style={{ "--cell-align": it.textAlign || "left" }}>
        <div className="static-table-row">
          <div className="table-rounded">
            <table className="item-table">
              {it.userSized && (
                <colgroup>
                  {it.tableData[0].map((_, ci) => (
                    <col key={ci} style={{ width: colWidths[ci] + "%" }} />
                  ))}
                </colgroup>
              )}
              <tbody>{rows}</tbody>
            </table>
            {/* Gated on it.userSized, same as the divider-resize handles just below — their
                shared percentage-based positioning (colLefts/rowTops, colDividerLefts/
                rowDividerTops) only actually lines up with the real rendered grid once the table
                is in fixed table-layout with real percentage column widths; before that
                (table-layout:auto, browser-determined widths) these percentages wouldn't match
                anything on screen. No onPointerDown/stopPropagation needed here — the whole-card
                drag system (drag-drop-chat.js's setupDraggingAndClicking) is a native listener on
                the card wrapper itself, which fires during real DOM bubbling before React's
                delegated synthetic handlers ever run, so a React-level stopPropagation on this
                element couldn't have stopped it anyway; it's exempted by class name inside that
                listener directly instead (same pattern already used there for '.resize'). */}
            {it.userSized &&
              mergeEdges.map((edge) => (
                <div key={edge.key} className={edge.className} style={edge.style} onClick={edge.onClick} title="Delete border (merge cells)" />
              ))}
            {/* Per-column/row divider drags — separate from the corner .resize handle below,
                which still resizes the WHOLE table. Wired up in the effect above
                (setupTableGridResizing), not inline here, same split as .resize itself. */}
            {it.userSized &&
              colDividerLefts.map((leftPct, i) => <div key={"cd" + i} className="table-col-resize-handle" style={{ left: leftPct + "%" }} />)}
            {it.userSized &&
              rowDividerTops.map((topPct, i) => <div key={"rd" + i} className="table-row-resize-handle" style={{ top: topPct + "%" }} />)}
          </div>
        </div>
      </div>
      <div className="add-col-zone" onMouseDown={(e) => e.stopPropagation()}>
        <div className="table-add-btn" onClick={() => window.addTableCol(it.id)} title="Add column">
          +
        </div>
      </div>
      <div className="add-row-zone" onMouseDown={(e) => e.stopPropagation()}>
        <div className="table-add-btn" onClick={() => window.addTableRow(it.id)} title="Add row">
          +
        </div>
      </div>
      <div className="resize">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 2L2 10M10 6L6 10M10 10L10 10" />
        </svg>
      </div>
    </>
  );
}
