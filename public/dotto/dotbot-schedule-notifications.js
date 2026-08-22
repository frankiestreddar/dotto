import { appState } from './core-state.js';
import { dateKey } from './messages-schedule.js';
import { openPricingOverlay } from './profile-achievements-pricing.js';
import { pushNotification } from './stopwatch-search-notifications.js';

// Despite the filename (the Dotbot scheduling conversation + due-event reminders that used to live
// here were removed along with the rest of the Schedule feature), this file now only owns two
// unrelated, generic app notifiers that happened to live alongside it: the 3am day-change ping and
// the one-time paid-tier ad nudge, both below.

    // ---------- Day-change notification (3am cutoff, not midnight) ----------
    // "Today" for stats purposes runs 3am-to-3am rather than midnight-to-midnight — this is
    // purely a clock/calendar concept (nothing here actually resets anything; every system with
    // its own daily/rolling window — login streak, Dotbot credits — already tracks its own
    // independent boundary, see their own migrations). This just tells the user a new day has
    // started while they're sitting there. Checked every minute against a local day-bucket key
    // rather than scheduling one big setTimeout for the literal next 3am — the tab can be closed/
    // reopened, the system clock can change, DST can shift things — a cheap periodic recheck is
    // simple and self-correcting where a single long-lived timer wouldn't be.
    function statsDayKey(d) {
        const bucket = new Date(d);
        if (bucket.getHours() < 3) bucket.setDate(bucket.getDate() - 1);
        return dateKey(bucket);
    }
 // baseline on load — only an actual crossing notifies, not "today" itself
    setInterval(() => {
        const nowKey = statsDayKey(new Date());
        if (nowKey === appState.lastStatsDayKey) return;
        appState.lastStatsDayKey = nowKey;
        pushNotification({ type: 'day_change', message: 'A new day has started' }); // no buttons, auto-dismisses — no dismiss function
    }, 60000);

    // ---------- Paid-tier ad notification ----------
    // No real subscription/tier system exists (see the pricing page comment above — everyone is
    // effectively on the free plan right now), so this can't gate on "already paid" the way a
    // real ad would. It just shows once per session, a few minutes in, as a soft nudge toward the
    // pricing page — cadence and copy are both placeholders, same as the pricing page's own
    // content, easy to retune once there's a real plan for it to point at.
    setTimeout(() => {
        pushNotification({
            type: 'paid_tier_ad',
            message: 'Unlock more with Dotto Pro — higher limits, priority support, and more.',
            actionLabel: 'Upgrade',
            onAction: openPricingOverlay,
            durationMs: 10000,
        });
    }, 3 * 60 * 1000);

    // Relocated here from core-state.js's appState object literal — it needs to call a
    // function this file already owns, and core-state.js must never import anything (see its
    // own comment on why: any import there re-creates the exact circular-evaluation hazard this
    // whole pass exists to eliminate, this time for appState itself).
    appState.lastStatsDayKey = statsDayKey(new Date());
