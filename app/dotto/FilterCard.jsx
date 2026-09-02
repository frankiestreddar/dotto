"use client";

import { applyFilterToRows, collectAvailableFilterTags } from "./lib/srsConnectionsCore";

// Ported from the old renderFilterHTML (app/dotto/lib/shelfSearch.ts — kept
// there, not deleted: it's still exported alongside its siblings and cheap to leave). setFilterMode/
// toggleFilterTag were already window-bridged for the original inline onclick attributes.
// applyFilterToRows/collectAvailableFilterTags (app/dotto/lib/srsConnectionsCore.ts) are real
// filtering logic, not boilerplate — real ES imports now (Phase 4.5 port, same-tree — the
// window.__applyFilterToRows/__collectAvailableFilterTags bridges stay set from that file too,
// for still-vanilla callers).
export default function FilterCard({ it }) {
  const rows = it.incomingRows || [];
  if (!rows.length) {
    return (
      <>
        <div className="filter-header">Filter</div>
        <div className="filter-empty">
          Connect a source (or another filter) to see its tags here.
        </div>
      </>
    );
  }

  const availableTags = collectAvailableFilterTags(rows);
  const selected = new Set(it.filterTagIds || []);
  const mode = it.filterMode === "and" ? "and" : "or";
  const outCount = applyFilterToRows(it, rows).length;

  return (
    <>
      <div className="filter-header">
        <span>Filter</span>
        <div className="filter-mode-toggle" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={"filter-mode-btn" + (mode === "or" ? " active" : "")}
            onClick={(e) => {
              e.stopPropagation();
              window.setFilterMode(it.id, "or");
            }}
          >
            OR
          </button>
          <button
            type="button"
            className={"filter-mode-btn" + (mode === "and" ? " active" : "")}
            onClick={(e) => {
              e.stopPropagation();
              window.setFilterMode(it.id, "and");
            }}
          >
            AND
          </button>
        </div>
      </div>
      <div className="filter-tags">
        {availableTags.length ? (
          availableTags.map((t) => (
            <span
              key={t.id}
              className={"filter-tag-chip" + (selected.has(t.id) ? " selected" : "")}
              style={{ "--chip-color": t.color }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                window.toggleFilterTag(it.id, t.id);
              }}
            >
              {t.name}
            </span>
          ))
        ) : (
          <span className="filter-empty-tags">No tags on the connected rows yet.</span>
        )}
      </div>
      <div className="filter-count">
        {rows.length} in → {outCount} out
      </div>
    </>
  );
}
