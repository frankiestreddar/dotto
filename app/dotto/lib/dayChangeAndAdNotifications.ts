import { dateKey } from "./dateKey";

// Despite the original filename (public/dotto/dotbot-schedule-notifications.js — the Dotbot
// scheduling conversation + due-event reminders that used to live there were removed along with
// the rest of the Schedule feature), this only ever owned two unrelated, generic app notifiers
// that happened to live alongside it: the 3am day-change ping and the one-time paid-tier ad
// nudge, both below.
//
// Phase 4.1 port — its three external dependencies were dateKey (extracted alongside this, see
// dateKey.ts's own comment — at the time, messages-schedule.js itself stayed vanilla; it's since
// been ported too, see app/dotto/lib/messagesSchedule.ts, Phase 4.5), and
// pushNotification/openPricingOverlay, both already reachable via
// existing plain window bridges (window.pushNotification, set in notifications.js;
// window.openPricingOverlay, set in window-bridge.js) without needing either of those files
// ported first. appState.lastStatsDayKey is a dynamically-added field (never pre-declared in
// app/dotto/lib/coreState.ts's own appState object literal — see this function's own note below), read/written
// through the existing universal window.__getAppState() bridge like any other live appState touch.

// ---------- Day-change notification (3am cutoff, not midnight) ----------
// "Today" for stats purposes runs 3am-to-3am rather than midnight-to-midnight — this is purely a
// clock/calendar concept (nothing here actually resets anything; every system with its own
// daily/rolling window — login streak, Dotbot credits — already tracks its own independent
// boundary, see their own migrations). This just tells the user a new day has started while
// they're sitting there. Checked every minute against a local day-bucket key rather than
// scheduling one big setTimeout for the literal next 3am — the tab can be closed/reopened, the
// system clock can change, DST can shift things — a cheap periodic recheck is simple and
// self-correcting where a single long-lived timer wouldn't be.
function statsDayKey(d: Date): string {
  const bucket = new Date(d);
  if (bucket.getHours() < 3) bucket.setDate(bucket.getDate() - 1);
  return dateKey(bucket);
}

const DAY_CHECK_INTERVAL_MS = 60000;
const AD_DELAY_MS = 3 * 60 * 1000;
// How long to wait for the vanilla afterInteractive bundle to set window.__getAppState before
// giving up — see the readiness-wait note below. Generous since both real timers below (60s,
// 3min) already tolerate a multi-second startup delay with no visible effect.
const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function setUpTimers(appState: Record<string, unknown>): () => void {
  // Baseline on load — only an actual crossing notifies, not "today" itself. Relocated here (was
  // set directly on core-state.js's appState object literal in the original vanilla file) since it
  // needs to call statsDayKey, a function this module already owns, and
  // app/dotto/lib/coreState.ts deliberately imports nothing of its own (same reasoning
  // core-state.js's own comment gave: avoiding a circular-evaluation hazard, this time
  // for appState itself).
  appState.lastStatsDayKey = statsDayKey(new Date());

  const dayInterval = setInterval(() => {
    const nowKey = statsDayKey(new Date());
    if (nowKey === appState.lastStatsDayKey) return;
    appState.lastStatsDayKey = nowKey;
    window.pushNotification?.({ type: "day_change", message: "A new day has started" }); // no buttons, auto-dismisses — no dismiss function
  }, DAY_CHECK_INTERVAL_MS);

  // ---------- Paid-tier ad notification ----------
  // No real subscription/tier system exists (see the pricing page comment above — everyone is
  // effectively on the free plan right now), so this can't gate on "already paid" the way a real
  // ad would. It just shows once per session, a few minutes in, as a soft nudge toward the
  // pricing page — cadence and copy are both placeholders, same as the pricing page's own
  // content, easy to retune once there's a real plan for it to point at.
  const adTimer = setTimeout(() => {
    window.pushNotification?.({
      type: "paid_tier_ad",
      message: "Unlock more with Dotto Pro — higher limits, priority support, and more.",
      actionLabel: "Upgrade",
      onAction: () => window.openPricingOverlay?.(),
      durationMs: 10000,
    });
  }, AD_DELAY_MS);

  return () => {
    clearInterval(dayInterval);
    clearTimeout(adTimer);
  };
}

// Called once from DottoApp's own useEffect on mount (app/dotto-app.jsx) — global, app-lifetime
// timers, not scoped to any particular panel/component, same as the vanilla original ran once at
// script-load time. Unlike railTooltipExpand.ts's own window.__getAppState() read (only ever
// touched lazily, on hover, well after mount), this needs appState available RIGHT at wire time
// (to seed lastStatsDayKey) — and since window.__getAppState is set by the vanilla
// afterInteractive <Script> bundle, which loads independently of and can genuinely resolve AFTER
// React's own mount (the exact race a Phase 1 bug already surfaced for a different component),
// a single readiness check isn't enough here the way it was for the outline panel's own
// self-healing case. Polls briefly instead of assuming either "already ready" or "never will be."
export function wireDayChangeAndAdNotifications(): () => void {
  if (window.__getAppState) {
    return setUpTimers(window.__getAppState());
  }

  let cancelled = false;
  let cleanupTimers: (() => void) | null = null;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState) {
      clearInterval(poll);
      cleanupTimers = setUpTimers(window.__getAppState());
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
    cleanupTimers?.();
  };
}
