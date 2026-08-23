"use client";

import { useLayoutEffect } from "react";

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
    window.__setupResizing(el, it);
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
              <tbody>
                {it.tableData.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        contentEditable
                        suppressContentEditableWarning
                        data-r={ri}
                        data-c={ci}
                        onMouseDown={handleCellMouseDown}
                        onInput={(e) => window.updateTableCell(it.id, ri, ci, e.currentTarget)}
                        onKeyDown={(e) => window.handleTableKeydown(e, it.id, ri, ci)}
                        onFocus={() => window.broadcastEditingState(true, `#item-${it.id} td[data-r="${ri}"][data-c="${ci}"]`)}
                        onBlur={() => window.broadcastEditingState(false)}
                        dangerouslySetInnerHTML={{ __html: cell }}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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
