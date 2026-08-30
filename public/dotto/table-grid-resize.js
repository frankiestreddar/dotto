import { appState, findItemEl } from './core-state.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';

// Phase 4.3 split (was part of resize-shortcuts-init.js, see PHASE4_ROADMAP.md) — the "resize"
// concern: dragging an internal table column/row divider. Separate from setupResizing's corner
// handle (app/dotto/canvasItemBehavior.js, Phase 3 — which resizes the WHOLE table) — these
// resize one column or row at a time, redistributing the dragged distance to/from its immediate
// neighbor only, so the table's own overall width/height (it.w/it.h) never changes from dragging
// an internal divider, only from the corner handle. Percentage-based (it.colWidths/it.rowHeights,
// each summing to 100) rather than pixel-based, so they scale automatically for free whenever the
// corner handle later changes the table's overall size — <col style="width:X%"> and
// distributeTableSizing (app/dotto/lib/sourceTable.ts, which now reads it.rowHeights when present) both
// already recompute off the CURRENT table size every time, so no separate rescaling logic is
// needed here for that case.
// Real pixel floors, not a flat percentage — a fixed % of the table's own width/height doesn't
// correspond to any one pixel size across different table sizes, and specifically didn't match
// .item-table td's own real min-width:40px (globals.css): at a small enough table, 40px was
// already MORE than the flat percentage allowed, so the browser's own min-width silently floored
// the actual column before the drag's own percentage clamp ever did — the divider (driven by the
// now-further-than-reality percentage) kept sliding past where the column had already visually
// stopped shrinking, decoupling the purple highlight from the real boundary line. Converting a
// real pixel floor to a percentage of the table's CURRENT it.w/it.h (fixed for the duration of
// one divider drag — only the corner handle, a separate gesture, ever changes those) keeps the
// two in agreement at every table size. TABLE_ROW_MIN_PX has no CSS counterpart to match (row
// height is entirely JS-driven, see distributeTableSizing) — 28px is just a sane "about one line
// of cell content" floor.

const TABLE_COL_MIN_PX = 40;
const TABLE_ROW_MIN_PX = 28;
// React → vanilla bridges — app/dotto/canvasItemBehavior.js's setupResizing needs these same two
// floors to stay in exact agreement with startTableColResize/startTableRowResize below (so a
// corner-drag and a divider-drag never disagree about the smallest allowed column/row), but can
// no longer share them via a same-module import now that it's moved out of this file — plain
// constant bridges, not functions, same convention as window.__ACHIEVEMENTS
// (profile-achievements-pricing.js).
window.__TABLE_COL_MIN_PX = TABLE_COL_MIN_PX;
window.__TABLE_ROW_MIN_PX = TABLE_ROW_MIN_PX;

// The resize affordance (purple highlight + col/row-resize cursor, both driven by the .armed
// class — see globals.css) only shows once the cursor has rested on a divider for this long, not
// the instant it merely passes over — and dragging is only actually possible once armed too (see
// the pointerdown guards below), so a quick pass-through across a divider on the way to somewhere
// else never accidentally starts a resize. Cleared immediately, timer included, on mouseleave, so
// leaving before the delay elapses can never arm it a moment late.
const TABLE_GRID_HOVER_ARM_MS = 300;
function armDividerOnHover(handle, signal) {
    let armTimer = null;
    handle.addEventListener('mouseenter', () => { armTimer = setTimeout(() => handle.classList.add('armed'), TABLE_GRID_HOVER_ARM_MS); }, { signal });
    handle.addEventListener('mouseleave', () => { clearTimeout(armTimer); handle.classList.remove('armed'); }, { signal });
}
function setupTableGridResizing(el, it) {
    el.querySelectorAll('.table-col-resize-handle').forEach((handle, i) => {
        handle.__resizeListenerAbort?.abort();
        const { signal } = (handle.__resizeListenerAbort = new AbortController());
        armDividerOnHover(handle, signal);
        handle.addEventListener('pointerdown', (e) => { if (handle.classList.contains('armed')) startTableColResize(e, it, i); }, { signal });
    });
    el.querySelectorAll('.table-row-resize-handle').forEach((handle, i) => {
        handle.__resizeListenerAbort?.abort();
        const { signal } = (handle.__resizeListenerAbort = new AbortController());
        armDividerOnHover(handle, signal);
        handle.addEventListener('pointerdown', (e) => { if (handle.classList.contains('armed')) startTableRowResize(e, it, i); }, { signal });
    });
}
// Dragging the divider between column `i` and `i+1` only ever moves width between those two —
// every other column's width is untouched, and the pair's own combined width stays constant,
// clamped so neither column can be dragged below TABLE_COL_MIN_PX (converted to a percentage of
// it.w). minPct is additionally capped at half the pair's own combined width, so a pair too
// narrow to give both columns the full pixel floor still splits evenly instead of producing an
// inverted (min > max) clamp range.
function startTableColResize(e, it, i) {
    e.stopPropagation();
    e.preventDefault();
    saveSnapshot();
    const numCols = it.tableData[0].length;
    const widths = (Array.isArray(it.colWidths) && it.colWidths.length === numCols) ? it.colWidths.slice() : new Array(numCols).fill(100 / numCols);
    const pairTotal = widths[i] + widths[i + 1];
    const minPct = Math.min((TABLE_COL_MIN_PX / it.w) * 100, pairTotal / 2);
    const startA = widths[i];
    const sx = e.clientX;
    const move = (me) => {
        const dxPct = ((me.clientX - sx) / appState.scale / it.w) * 100;
        const a = Math.max(minPct, Math.min(pairTotal - minPct, startA + dxPct));
        widths[i] = a; widths[i + 1] = pairTotal - a;
        it.colWidths = widths;
        const el2 = findItemEl(it.id);
        if (!el2) return;
        const cols = el2.querySelectorAll('.item-table > colgroup > col');
        if (cols[i]) cols[i].style.width = widths[i] + '%';
        if (cols[i + 1]) cols[i + 1].style.width = widths[i + 1] + '%';
        const handles = el2.querySelectorAll('.table-col-resize-handle');
        let acc = 0;
        for (let k = 0; k <= i; k++) acc += widths[k];
        if (handles[i]) handles[i].style.left = acc + '%';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); scheduleWorkspaceSave(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
}
// Same idea as startTableColResize, vertically — dragging the divider between row `i` and `i+1`
// moves height between just that pair, applied live via distributeTableSizing (which converts
// it.rowHeights' percentages to real pixel heights off the table's current rendered height, same
// as it already does on every corner-resize tick).
function startTableRowResize(e, it, i) {
    e.stopPropagation();
    e.preventDefault();
    saveSnapshot();
    const numRows = it.tableData.length;
    const heights = (Array.isArray(it.rowHeights) && it.rowHeights.length === numRows) ? it.rowHeights.slice() : new Array(numRows).fill(100 / numRows);
    const pairTotal = heights[i] + heights[i + 1];
    const minPct = Math.min((TABLE_ROW_MIN_PX / it.h) * 100, pairTotal / 2);
    const startA = heights[i];
    const sy = e.clientY;
    const move = (me) => {
        const dyPct = ((me.clientY - sy) / appState.scale / it.h) * 100;
        const a = Math.max(minPct, Math.min(pairTotal - minPct, startA + dyPct));
        heights[i] = a; heights[i + 1] = pairTotal - a;
        it.rowHeights = heights;
        const el2 = findItemEl(it.id);
        if (!el2) return;
        window.__distributeTableSizing(it, el2);
        const handles = el2.querySelectorAll('.table-row-resize-handle');
        let acc = 0;
        for (let k = 0; k <= i; k++) acc += heights[k];
        if (handles[i]) handles[i].style.top = acc + '%';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); scheduleWorkspaceSave(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
}

export { setupTableGridResizing };

// window.__setupResizing is now assigned from app/dotto-app.jsx instead (setupResizing itself
// moved to app/dotto/canvasItemBehavior.js) — the bridge's direction flipped along with its
// implementation, but vanilla code that still needs it (attachNoteBody, waypoints-render-loop.js)
// calls it exactly the same way as before.
window.__setupTableGridResizing = setupTableGridResizing;
