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

// PR1 stub: always reports "nothing arranged," so every guard wired up in this PR is reachable in
// code review but a provable runtime no-op — appState.scheduleViewSelection also never becomes
// anything other than SCHEDULE_ALL yet (see core-state.js's default), so these guards aren't even
// reachable at runtime until a later PR starts setting it. Real arrange algorithm lands in PR2.
export function getScheduleModeSlot() {
    return null;
}

// PR1 stub — mirrors applyItemWrapperAttrs' real body (waypoints-render-loop.js) exactly, so PR2
// only has to change what gets computed here, not how the call site delegates to it.
export function applyScheduleModeWrapperAttrs(el, it) {
    el.className = `item ${it.kind}`;
    el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
    if (it.zIndex) el.style.zIndex = it.zIndex;
    if (it.kind !== 'title' && it.kind !== 'waypoint' && !(it.kind === 'table' && !it.userSized)) {
        el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
    }
}

// PR1 stub — PR2 fills this in to drive appState.ty (clamped to the arranged list's bounds) via
// applyTransform(), consuming only e.deltaY. Unreachable in PR1 (see the module comment above), so
// the empty body is intentional, not a placeholder that needs appState/applyTransform imported yet.
export function handleScheduleModeWheel() {}
