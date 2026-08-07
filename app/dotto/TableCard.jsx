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
// userSized's wrapper class + distributeTableSizing, and setupResizing, both need the wrapper
// element this component doesn't itself own — reached via document.getElementById('item-'+it.id)
// each render, same technique TitleCard/NoteCard use.
export default function TableCard({ it }) {
  useLayoutEffect(() => {
    const el = document.getElementById("item-" + it.id);
    if (!el) return;
    if (it.userSized) {
      el.classList.add("sized");
      requestAnimationFrame(() => window.__distributeTableSizing(it, el));
    }
    window.__setupResizing(el, it);
  });

  const numCols = it.tableData[0].length;
  const colWidthPct = numCols ? (100 / numCols).toFixed(4) : 0;

  return (
    <>
      <div className="static-table-wrap" style={{ "--cell-align": it.textAlign || "left" }}>
        <div className="static-table-row">
          <div className="table-rounded">
            <table className="item-table">
              {it.userSized && (
                <colgroup>
                  {it.tableData[0].map((_, ci) => (
                    <col key={ci} style={{ width: colWidthPct + "%" }} />
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
