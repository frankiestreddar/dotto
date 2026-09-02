// Phase 4.1 extraction (public/dotto/messages-schedule.js) — a tiny pure helper with a single
// caller (dayChangeAndAdNotifications.ts's statsDayKey), pulled out on its own so that caller
// could fully exit the vanilla layer without needing messages-schedule.js itself ported yet (it
// still had real vanilla hub dependencies of its own at the time — openRailView/wireRailIcon from
// app/dotto/lib/panelsHamburger.ts; it's since been ported too, see
// app/dotto/lib/messagesSchedule.ts, Phase 4.5). messages-schedule.js's own copy of this function
// was removed once this became the only caller.
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(d: Date): string {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
