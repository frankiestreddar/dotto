import { appState } from './core-state.js';
import { applyTransform } from './history-autosave.js';

// ---------- Schedule Mode: in-place canvas transform (single-canvas view) ----------
// Deliberately kept in its own file, separate from waypoints-render-loop.js/srs-connections-core.js
// (canvas core) — those two only get small guarded delegating stubs (see
// applyItemWrapperAttrs/attachUniversalItemBehavior and the pointerdown/wheel handlers), so the
// actual arrange/animate logic here never has to touch canvas-core files directly. Everything in
// this file is gated behind appState.scheduleViewMode && appState.scheduleViewSelection !==
// SCHEDULE_ALL — false for ~100% of real sessions, so normal canvas usage is unaffected by
// construction, not just in practice.
//
// SCHEDULE_ALL is the sentinel for "cross-canvas aggregate" (appState.scheduleViewSelection's
// other possible values are folder ids) — the existing #schedule-view overlay/ScheduleAgenda.jsx
// handle that case unchanged; this file only ever runs for a single specific canvas.
export const SCHEDULE_ALL = 'all';

// Set by setArrangedSlots/clearArrangedSlots below (called from messages-schedule.js's
// enter/exitScheduleViewMode and date-shift orchestration) — read by
// applyScheduleModeWrapperAttrs (every item's own layout effect, via CanvasItemsLayer.jsx) and
// handleScheduleModeWheel (the canvas's own wheel listener, srs-connections-core.js). Kept as
// plain module state rather than on appState itself since nothing outside this file needs it.
let arrangedSlotsById = new Map();
let scrollBounds = { min: 0, max: 0 };

// Column layout for the arranged list: sorted-by-time items stacked vertically at a fixed column
// width, centered on their own local origin. Pure geometry — no DOM writes, no appState.tx/ty/scale
// reads or writes (the caller owns the camera move via the returned centerX/centerY, and owns
// committing the result via setArrangedSlots below). `sortedItems` is an array of `{it}` (already
// resolved to a real item and already sorted by scheduled time) — this function doesn't know or
// care where that ordering came from. Each slot's `index` (its row position) is what
// applyScheduleModeWrapperAttrs below uses to alternate the entrance animation's direction and
// stagger its timing — it has nothing to do with the item's real canvas position, on purpose (see
// that function's own comment).
export function computeArrangedLayout(sortedItems) {
    const w = appState.SCHEDULE_LIST_COLUMN_WIDTH;
    const rowH = appState.SCHEDULE_LIST_ROW_HEIGHT, gap = appState.SCHEDULE_LIST_ROW_GAP;
    const totalHeight = sortedItems.length ? sortedItems.length * rowH + (sortedItems.length - 1) * gap : 0;
    const originX = -w / 2, originY = -totalHeight / 2;
    const slotsById = new Map();
    sortedItems.forEach(({ it }, i) => {
        slotsById.set(it.id, { x: originX, y: originY + i * (rowH + gap), w, h: rowH, index: i });
    });
    return { slotsById, centerX: originX + w / 2, centerY: originY + totalHeight / 2, totalHeight };
}

// tx/ty that would center (centerX, centerY) in the current viewport at scale 1 — same formula
// centerOnContent (waypoints-render-loop.js) uses for the real canvas's own "center on everything"
// action, just not scoped to that function since this needs to run before this mode's items even
// have real DOM positions to measure.
export function cameraCenterFor(centerX, centerY) {
    return { tx: window.innerWidth / 2 - centerX, ty: window.innerHeight / 2 - centerY };
}

// Commits a freshly computed arrangement so applyScheduleModeWrapperAttrs/handleScheduleModeWheel
// (below) pick it up. totalHeight drives the vertical-scroll clamp: a short list (fits the
// viewport) gets scrollBounds {0,0} — no scroll at all, matching "only able to scroll... if there
// is more scheduled than what fits."
export function setArrangedSlots(slotsById, totalHeight) {
    arrangedSlotsById = slotsById;
    const margin = 140; // keeps the topmost/bottommost row off #schedule-view-header / the screen edge
    const overflow = totalHeight + margin * 2 - window.innerHeight;
    scrollBounds = { min: overflow > 0 ? -overflow : 0, max: 0 };
}

export function clearArrangedSlots() {
    arrangedSlotsById = new Map();
    scrollBounds = { min: 0, max: 0 };
}

// Real per-item wrapper attrs while single-canvas Schedule Mode is active — called instead of
// applyItemWrapperAttrs' own body (waypoints-render-loop.js), which delegates here. A scheduled
// item (a key in arrangedSlotsById) gets its arranged slot position + .schedule-mode-card, which
// enters via a CSS keyframe animation (globals.css) that alternates sliding in from the left/right
// of the screen based on the slot's own row index, staggered in order via animation-delay — NOT
// from the item's real canvas position (deliberately: real positions can be scattered arbitrarily
// far apart, which looked chaotic animating dozens of cards in from all over the screen at once;
// a uniform alternating reveal reads as a single intentional motion instead). Every other item
// keeps its REAL x/y/w/h (mirroring applyItemWrapperAttrs' own title/waypoint/unsized-table
// width-height exception) and gets .schedule-hidden instead — it's already exactly where it needs
// to be the instant it fades back in on exit, so it needs no position logic of its own (see
// scheduleModeStore's own comment in bridges.js).
export function applyScheduleModeWrapperAttrs(el, it) {
    const slot = arrangedSlotsById.get(it.id);
    if (slot) {
        const fromRight = slot.index % 2 === 1;
        el.className = `item ${it.kind} schedule-mode-card` + (fromRight ? ' schedule-card-from-right' : '');
        el.style.left = slot.x + 'px'; el.style.top = slot.y + 'px';
        el.style.width = slot.w + 'px'; el.style.height = slot.h + 'px';
        el.style.zIndex = '';
        el.style.animationDelay = (slot.index * 70) + 'ms';
        return;
    }
    el.className = `item ${it.kind} schedule-hidden`;
    el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
    el.style.animationDelay = '';
    if (it.zIndex) el.style.zIndex = it.zIndex;
    if (it.kind !== 'title' && it.kind !== 'waypoint' && !(it.kind === 'table' && !it.userSized)) {
        el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
    }
}

// Vertical-scroll-only, driven directly against the real camera (there's no separate scrolling DOM
// element to defer to here, unlike SCHEDULE_ALL's #schedule-view-canvas) — consumes only
// e.deltaY, clamped to the arranged list's own bounds; tx/scale never move, so the column can't
// drift sideways or the zoom level change while this mode is active.
export function handleScheduleModeWheel(e) {
    e.preventDefault();
    appState.ty = Math.min(scrollBounds.max, Math.max(scrollBounds.min, appState.ty - e.deltaY));
    applyTransform();
}
