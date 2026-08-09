"use client";

// The simplified row single-canvas Schedule Mode swaps in for a real card's own content while
// it's scheduled for the active date (see CanvasItemsLayer.jsx's CanvasItem and
// scheduleModeStore's own comment in bridges.js) — icon + the name given to it + what kind of
// block it is + the time it's scheduled for, nothing else. `it`/`slot` come straight from
// CanvasItem: `it` for the icon (kind/level), `slot` for name/kindLabel/time (computed vanilla-side
// by renderCanvasScheduleAgenda, messages-schedule.js, via miniLabelForItem/kindTypeLabel/
// formatTimeLabel — see that function's own comment for why those three specific helpers).
export default function ScheduleModeCardBody({ it, slot }) {
  const iconUrl = `/assets/icons/${window.__kindIconFile(it.kind, it.level)}`;
  return (
    <>
      <span
        className="schedule-mode-card-icon icon-mask"
        style={{ maskImage: `url(${iconUrl})`, WebkitMaskImage: `url(${iconUrl})` }}
      />
      <div className="schedule-mode-card-meta">
        <div className="schedule-mode-card-name">{slot.name}</div>
        <div className="schedule-mode-card-type">{slot.kindLabel}</div>
      </div>
      <div className="schedule-mode-card-time">{slot.time}</div>
    </>
  );
}
