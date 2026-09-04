"use client";

import { applyFilterToRows, collectAvailableFilterTags } from "./lib/srsConnectionsCore";
import type { Item } from "./lib/messagingCanvasPreview";

// Ported from the old renderFilterHTML (app/dotto/lib/shelfSearch.ts — kept
// there, not deleted: it's still exported alongside its siblings and cheap to leave). setFilterMode/
// toggleFilterTag were already window-bridged for the original inline onclick attributes.
// applyFilterToRows/collectAvailableFilterTags (app/dotto/lib/srsConnectionsCore.ts) are real
// filtering logic, not boilerplate — real ES imports now (Phase 4.5 port, same-tree — the
// window.__applyFilterToRows/__collectAvailableFilterTags bridges stay set from that file too,
// for still-vanilla callers).
export default function FilterCard({ it }: { it: Item }) {
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
              window.setFilterMode!(it.id, "or");
            }}
          >
            OR
          </button>
          <button
            type="button"
            className={"filter-mode-btn" + (mode === "and" ? " active" : "")}
            onClick={(e) => {
              e.stopPropagation();
              window.setFilterMode!(it.id, "and");
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
              style={{ ["--chip-color" as string]: t.color } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                // toggleFilterTag (shelfSearch.ts) declares tagId as string, but
                // collectAvailableFilterTags/applyFilterToRows (srsConnectionsCore.ts) both treat
                // tag ids as number — a real, pre-existing inconsistency between those two
                // already-converted files, out of this batch's scope to resolve. Cast here to
                // preserve the exact same runtime value that was always passed, unchanged.
                window.toggleFilterTag!(it.id, t.id as unknown as string);
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
