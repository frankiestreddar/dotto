import { appState } from './core-state.js';

// Phase 4.3 split (was part of stopwatch-search-notifications.js, see PHASE4_ROADMAP.md) — the
// "notifications" concern: the bottom-left notification stack engine (push/show/dismiss/action),
// independent of both the Stopwatch/Shelf card logic and the top search bar's own AI-context
// machinery this file used to be bundled with.

    // ---------- Notifications ----------
    // Generic engine — explicit redesign of what used to be a single top-center pill shown one at
    // a time with an enforced gap between them (swapping places with #top-bar-center, which no
    // longer even renders any content of its own — see that element's own comment, globals.css).
    // Now a real STACK, top-right: every notification pushed gets its own id and stays visible
    // (independently) until its own timer/dismissal, genuinely simultaneously with any others —
    // "remove the delay between notifications" — no queue, no gap, no single "current" one.
    // window.__setNotifications(list) (app/dotto-app.jsx) pushes the whole array to
    // notificationsStore (bridges.js); NotificationBar.jsx owns the actual stacking/slide/shift
    // animation and the hover-reveal close button — this file only owns WHEN one appears/expires.
    //
    // pushNotification({
    //   type,             // string id for the notification kind (e.g. 'chat', 'friend_request') —
    //                     // informational/for any future per-type styling, not used by the engine itself
    //   message,          // main text
    //   imageUrl,         // optional
    //   actionLabel,      // optional — shows the primary button (its rendered text gets an enter-
    //                     // arrow glyph appended, see NotificationBar.jsx); click activates it
    //   onAction,         // called when the primary button is activated
    //   sticky,           // default false — no auto-dismiss timer at all; needs actionLabel, its
    //                     // own hover-close button, or Escape to ever go away
    //   durationMs,       // default 5000 (5 seconds) — how long before this SPECIFIC notification
    //                     // auto-dismisses
    // })
    //
    // The only notification type from the original list with nothing behind it now is platform
    // tips, dropped entirely (no content for them) — achievements now have a real trigger too (see
    // bumpAchievementStat). Everything else — including the 3am day-change, which isn't a "reset"
    // of anything, just a clock boundary, and the paid-tier ad, which points at a
    // placeholder-content pricing page rather than a real subscription system — is wired to a
    // real trigger (see the pushNotification call sites in refreshCanvasCollabData/
    // refreshFriendsData/subscribeToAllFriendMessages/handleFriendPresenceSync/awardUserPoints/
    // refreshDotbotUsage/the day-change interval/the ad timer/bumpAchievementStat below).

    let nextNotificationId = 1;
    function pushNotifications(list) { window.__setNotifications(list); }
    // Held (queued, not shown) while the tab isn't actually visible (another tab/app, backgrounded,
    // screen lock) — the visibilitychange listener below flushes them the moment it's visible
    // again, same "don't show something nobody's there to see" guarantee the old one-at-a-time
    // engine had, just applied to the whole pending batch instead of a single item.
    function pushNotification(config) {
        if (document.visibilityState !== 'visible') {
            appState.notificationQueue.push(config);
            return;
        }
        showNotification(config);
    }
    function showNotification(config) {
        const id = nextNotificationId++;
        const entry = { id, config };
        // Newest first — "new ones push existing down" (NotificationBar.jsx renders top to bottom
        // in array order). Sliced to NOTIFICATION_MAX_VISIBLE — dropping whichever entry falls off
        // the end (the oldest, per explicit request) rather than growing the stack unbounded;
        // NotificationBar.jsx detects that drop and plays a real slide-out exit for it instead of
        // it just vanishing.
        appState.visibleNotifications = [entry, ...appState.visibleNotifications].slice(0, appState.NOTIFICATION_MAX_VISIBLE);
        pushNotifications(appState.visibleNotifications);
        if (!config.sticky) {
            const durationMs = config.durationMs || appState.NOTIFICATION_DEFAULT_DURATION_MS;
            setTimeout(() => dismissNotification(id), durationMs);
        }
    }
    // Click (NotificationBar.jsx's own action button onClick) or Enter (see the keydown handler
    // below, which always targets the TOPMOST/newest notification) — id-scoped so triggering one
    // notification's action can never accidentally dismiss a DIFFERENT one still in the stack.
    function runNotificationAction(id) {
        const entry = appState.visibleNotifications.find(n => n.id === id);
        if (!entry || !entry.config.actionLabel) return;
        const cb = entry.config.onAction;
        dismissNotification(id);
        if (cb) cb();
    }
    function dismissNotification(id) {
        const next = appState.visibleNotifications.filter(n => n.id !== id);
        if (next.length === appState.visibleNotifications.length) return; // already gone
        appState.visibleNotifications = next;
        pushNotifications(next);
    }
    document.addEventListener('keydown', (e) => {
        if (!appState.visibleNotifications.length) return;
        const active = document.activeElement;
        // Some OTHER field being actively edited (a waypoint rename, a table cell, etc.) wins —
        // Enter/Escape apply to that as usual rather than surprise-triggering the notification
        // stack sitting in the background.
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (isEditingText) return;
        // Always the topmost (newest) notification — the one visually/logically "in front".
        const topId = appState.visibleNotifications[0].id;
        if (e.key === 'Enter') { e.preventDefault(); runNotificationAction(topId); }
        else if (e.key === 'Escape') { e.preventDefault(); dismissNotification(topId); }
    });
    // Notifications only ever DISPLAY while the tab is actually visible — this is what makes that
    // true: anything pushed while backgrounded (another tab/app, screen lock) queued up in
    // notificationQueue instead of showing immediately (see pushNotification above); coming back
    // flushes that whole queue at once (each becomes its own real, independently-timed
    // notification — no artificial stagger between them, per explicit request).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const queued = appState.notificationQueue;
            appState.notificationQueue = [];
            queued.forEach(showNotification);
        }
    });

export { dismissNotification, pushNotification, runNotificationAction };

// Not an inline-HTML onclick target (see window-bridge.js's own header comment for why those
// live there instead) — this is the first real React component (app/dotto/PricingOverlay.jsx,
// Phase 2 increment 1) needing to call into a still-vanilla subsystem, and app/ can't import
// public/dotto/*.js directly (same constraint window.__dottoSupabase/__DOTTO_USER__ solve in the
// other direction — see app/dotto-app.jsx). More of these will likely accumulate here as more
// subsystems migrate to React while still depending on notifications.
window.pushNotification = pushNotification;
// Same reasoning — used by NotificationBar.jsx's own hover-reveal close button.
window.__dismissNotification = dismissNotification;
