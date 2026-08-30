// Phase 4.1 extraction (public/dotto/messages-schedule.js) — a tiny pure helper with a single
// caller (dayChangeAndAdNotifications.ts's statsDayKey), pulled out on its own so that caller
// could fully exit the vanilla layer without needing messages-schedule.js itself ported (it still
// has real vanilla hub dependencies of its own — openRailView/wireRailIcon from
// app/dotto/lib/panelsHamburger.ts — so it stays vanilla for now). messages-schedule.js's own copy of this
// function was removed once this became the only caller.
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(d: Date): string {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
