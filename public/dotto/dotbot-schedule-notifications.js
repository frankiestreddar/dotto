import { clearSearch, typewriterReveal, updateSearchDropdown } from './ai-assistant-suggestions.js';
import { appState } from './core-state.js';
import { scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById, miniLabelForItem, renderInlineCanvas, renderRealCardPreview } from './live-presence.js';
import { dateKey, formatDateLabel, formatTimeLabel, pad2, scheduledEvents } from './messages-schedule.js';
import { closeAllPanels } from './panels-hamburger.js';
import { bumpAchievementStat, openPricingOverlay } from './profile-achievements-pricing.js';
import { goToOutlineItem } from './shared-canvases-outline.js';
import { autoGrowSearchInput, pushNotification, searchInput, searchResults, searchSuggestions } from './stopwatch-search-notifications.js';

    // ---------- Dotbot Scheduling Conversation ----------
    // Dragging a card (or a multi-card selection) onto the schedule button hands off to Dotbot
    // in the search box rather than opening a date/time form directly — Dotbot asks when, the
    // next thing you type in the search box is read as the answer instead of a search query.
    let dotbotScheduleConversation = null; // { itemIds: [...] } while awaiting the user's reply

    // `previewEl`, when given, is shown above the (typed-out) message — a real card preview for
    // a single item, or an inline-canvas preview for several (see startScheduleConversation) — so
    // you can see exactly what you're scheduling while Dotbot asks when. The dropdown/search box
    // naturally grows to fit it since nothing here constrains its height.
    function renderDotbotPrompt(text, previewEl) {
        searchSuggestions.innerHTML = '';
        if (previewEl) searchSuggestions.appendChild(previewEl);
        const msg = document.createElement('div');
        msg.className = 'search-suggestion-item dotbot-prompt-msg';
        searchSuggestions.appendChild(msg);
        searchResults.style.display = 'none';
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        typewriterReveal(msg, text, updateSearchDropdown);
    }

    // Starts the "when would you like to schedule X for?" Dotbot conversation for an arbitrary
    // set of item ids — entry point is now dragging a card (or the active multi-selection) onto
    // the schedule button (see its drop-zone check in setupDraggingAndClicking's drag `up`
    // handler), replacing the old right-click "Schedule" context-menu option.
    function startScheduleConversation(itemIds) {
        if (!itemIds.length) return;
        dotbotScheduleConversation = { itemIds };
        closeAllPanels(null);
        const it = findItemById(itemIds[0]);
        const label = itemIds.length === 1 ? (miniLabelForItem(it) || 'this card') : `these ${itemIds.length} cards`;

        // Show exactly what's being scheduled: the real card itself for one, an inline-canvas
        // preview for several.
        let previewEl = null;
        if (itemIds.length === 1 && it) {
            previewEl = document.createElement('div');
            previewEl.className = 'dotbot-schedule-card-preview';
            const mini = renderRealCardPreview(it);
            mini.style.position = 'relative';
            mini.style.width = (it.w || 220) + 'px';
            mini.style.height = (it.kind === 'title' ? 'auto' : (it.h || 100) + 'px');
            previewEl.appendChild(mini);
        } else if (itemIds.length > 1) {
            previewEl = renderInlineCanvas(itemIds.map(id => findItemById(id)).filter(Boolean), false);
        }

        renderDotbotPrompt(`When would you like to schedule ${label} for?`, previewEl);
        searchInput.value = '';
        autoGrowSearchInput();
        searchInput.focus();
    }
    function cancelDotbotScheduleConversation() {
        if (!dotbotScheduleConversation) return;
        dotbotScheduleConversation = null;
        clearSearch();
    }
    function submitDotbotScheduleAnswer(text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const parsed = parseScheduleDateTime(trimmed);
        if (!parsed) {
            renderDotbotPrompt(`Sorry, I didn't catch a date/time there — try something like "tomorrow at 3pm" or "next monday 9am".`);
            searchInput.value = '';
            autoGrowSearchInput();
            return;
        }
        const { itemIds } = dotbotScheduleConversation;
        itemIds.forEach(id => {
            const it = findItemById(id);
            if (!it) return;
            const existing = scheduledEvents.find(e => e.itemId === id && e.folderId === appState.currentFolderId);
            if (existing) { existing.date = parsed.date; existing.time = parsed.time; existing.title = miniLabelForItem(it); }
            else {
                scheduledEvents.push({ id: 'ev_' + appState.idCounter++, itemId: id, folderId: appState.currentFolderId, title: miniLabelForItem(it), date: parsed.date, time: parsed.time });
                bumpAchievementStat('five_scheduled');
            }
        });
        scheduleWorkspaceSave();
        const when = formatDateLabel(new Date(parsed.date + 'T00:00:00')) + ' at ' + formatTimeLabel(parsed.time);
        const count = itemIds.length;
        dotbotScheduleConversation = null;
        renderDotbotPrompt(`Done — ${count === 1 ? "that's" : `all ${count} are`} scheduled for ${when}.`);
        searchInput.value = '';
        autoGrowSearchInput();
    }

    // ---------- Scheduled-card due-time notifications ----------
    // Purely client-side (no server push infra — real screen-locked mobile reminders would need
    // the same Edge Function/Web Push piece described alongside subscribeToAllFriendMessages
    // above): polls scheduledEvents against the clock every 20s while the tab is open, gated by
    // the same visible-tab/held-while-away rules as every other notification (see
    // pushNotification/tryShowNextNotification). notifiedScheduledEventIds is in-memory only —
    // resets on reload, so a still-due, still-undismissed event can notify again next session,
    // which is the right trade-off until this has real server-side persistence.
    let notifiedScheduledEventIds = new Set();
    function checkDueScheduledEvents() {
        const now = new Date();
        const nowKey = dateKey(now);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        scheduledEvents.forEach(ev => {
            if (notifiedScheduledEventIds.has(ev.id)) return;
            if (ev.date !== nowKey) return;
            const [h, m] = ev.time.split(':').map(Number);
            if (h * 60 + m > nowMinutes) return; // not due yet
            notifiedScheduledEventIds.add(ev.id);
            pushNotification({
                type: 'scheduled_card',
                message: `Time for "${ev.title}"`,
                actionLabel: 'Go',
                onAction: () => goToOutlineItem(ev.folderId, ev.itemId),
                // No dismiss button — Escape hides it; the reminder itself isn't cleared, so it's
                // still visible in schedule view either way.
                sticky: true, // does not self-dismiss
            });
        });
    }
    setInterval(checkDueScheduledEvents, 20000);

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
    let lastStatsDayKey = statsDayKey(new Date()); // baseline on load — only an actual crossing notifies, not "today" itself
    setInterval(() => {
        const nowKey = statsDayKey(new Date());
        if (nowKey === lastStatsDayKey) return;
        lastStatsDayKey = nowKey;
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

    // A small deterministic parser (no AI call needed) for the kinds of casual date/time
    // replies people actually type: "tomorrow at 3pm", "next monday 9am", "in 2 days",
    // "friday at noon", explicit "2026-07-25", or "july 25".
    const SCHEDULE_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const SCHEDULE_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    function parseScheduleDateTime(input) {
        let rest = input.trim().toLowerCase();
        if (!rest) return null;

        // Date phrases are matched (and their matched text removed from `rest`) before the time
        // is ever searched for — otherwise a bare number that's actually part of a date phrase
        // (the "3" in "in 3 days at 11am") gets misread as the time.
        const dateBase = new Date();
        dateBase.setHours(0, 0, 0, 0);
        let dateFound = false;

        if (/\btoday\b/.test(rest)) { rest = rest.replace(/\btoday\b/, ''); dateFound = true; }
        else if (/\btomorrow\b/.test(rest)) { dateBase.setDate(dateBase.getDate() + 1); rest = rest.replace(/\btomorrow\b/, ''); dateFound = true; }
        else if (/\bnext week\b/.test(rest)) { dateBase.setDate(dateBase.getDate() + 7); rest = rest.replace(/\bnext week\b/, ''); dateFound = true; }
        else if (/\bnext month\b/.test(rest)) { dateBase.setMonth(dateBase.getMonth() + 1); rest = rest.replace(/\bnext month\b/, ''); dateFound = true; }
        else {
            const inMatch = rest.match(/\bin\s+(\d+)\s*(day|days|week|weeks|month|months)\b/);
            const wdIdx = SCHEDULE_WEEKDAYS.findIndex(w => rest.includes(w));
            const isoMatch = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
            const monthIdx = SCHEDULE_MONTHS.findIndex(m => rest.includes(m));
            if (inMatch) {
                const n = parseInt(inMatch[1], 10);
                const unit = inMatch[2];
                if (unit.startsWith('day')) dateBase.setDate(dateBase.getDate() + n);
                else if (unit.startsWith('week')) dateBase.setDate(dateBase.getDate() + n * 7);
                else dateBase.setMonth(dateBase.getMonth() + n);
                rest = rest.replace(inMatch[0], '');
                dateFound = true;
            } else if (wdIdx !== -1) {
                // "next <weekday>" means the same upcoming occurrence as "<weekday>" alone in
                // ordinary usage — "next" only needs to push a whole week further out in the one
                // case where the plain weekday would otherwise mean *today*.
                const isNext = /\bnext\b/.test(rest);
                const cur = dateBase.getDay();
                let diff = (wdIdx - cur + 7) % 7;
                if (diff === 0 && isNext) diff = 7;
                dateBase.setDate(dateBase.getDate() + diff);
                rest = rest.replace(/\bnext\b/, '').replace(new RegExp(`\\b${SCHEDULE_WEEKDAYS[wdIdx]}\\b`), '');
                dateFound = true;
            } else if (isoMatch) {
                dateBase.setFullYear(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
                rest = rest.replace(isoMatch[0], '');
                dateFound = true;
            } else if (monthIdx !== -1) {
                const dayMatch = rest.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
                if (dayMatch) {
                    const day = parseInt(dayMatch[1], 10);
                    const candidate = new Date(dateBase.getFullYear(), monthIdx, day);
                    if (candidate < dateBase) candidate.setFullYear(candidate.getFullYear() + 1);
                    dateBase.setTime(candidate.getTime());
                    rest = rest.replace(SCHEDULE_MONTHS[monthIdx], '').replace(dayMatch[0], '');
                    dateFound = true;
                }
            }
        }

        // Whatever's left after stripping the matched date phrase is searched for a time.
        rest = rest.replace(/\bat\b/g, '').trim();
        let time = null;
        if (/\bnoon\b/.test(rest)) time = '12:00';
        else if (/\bmidnight\b/.test(rest)) time = '00:00';
        else {
            const timeMatch = rest.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm)?\b/);
            if (timeMatch) {
                let h = parseInt(timeMatch[1], 10);
                const min = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
                const ampm = timeMatch[4];
                if (ampm === 'pm' && h < 12) h += 12;
                if (ampm === 'am' && h === 12) h = 0;
                if (h <= 23 && min <= 59) time = pad2(h) + ':' + pad2(min);
            }
        }

        if (!dateFound && !time) return null;
        return { date: dateKey(dateBase), time: time || '09:00' };
    }


export { cancelDotbotScheduleConversation, dotbotScheduleConversation, startScheduleConversation, submitDotbotScheduleAnswer };
