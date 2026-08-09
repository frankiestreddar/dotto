import { clearSearch } from './ai-assistant-suggestions.js';
import { appState, canvas, zoomControl } from './core-state.js';
import { renderMsgList } from './friends-presence.js';
import { applyTransform } from './history-autosave.js';
import { closeConvo } from './live-presence.js';
import { closeAllPanels, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { ensureSharedFolderLoaded } from './shared-canvases-outline.js';


    // ---------- Messages Panel Controls ----------
    // Also closes any open conversation (not just the panel around it) — otherwise it stays
    // "open" internally at whatever scroll position was left, and reopening the panel later
    // shows that same stale state instead of a fresh bottom-of-conversation view.
    function closeMessagesPanel() { appState.messagesPanel.classList.remove('open'); appState.messagesBtn.classList.remove('active'); appState.panelPinned.messages = false; closeConvo(); }
    function positionMessagesPanel() {
        const rect = appState.messagesBtn.getBoundingClientRect();
        appState.messagesPanel.style.bottom = 'auto';
        appState.messagesPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 320;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        appState.messagesPanel.style.left = leftPos + 'px';
        appState.messagesPanel.style.right = 'auto';
    }
    function openMessagesPanel(pin) {
        closeAllPanels('messages');
        clearSearch();
        appState.messagesPanel.classList.add('open');
        appState.messagesBtn.classList.add('active');
        closeConvo();
        appState.msgView = 'main'; // always land on the main list, never mid-Requests from last time
        appState.msgSearchInput.value = '';
        renderMsgList('');
        positionMessagesPanel();
        if (pin) { appState.msgSearchInput.focus(); appState.panelPinned.messages = true; }
    }
    appState.messagesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (appState.panelPinned.messages) { closeMessagesPanel(); }
        else { openMessagesPanel(true); }
    });
    appState.messagesBtn.addEventListener('mouseenter', () => { if (!appState.messagesPanel.classList.contains('open')) openMessagesPanel(false); });
    appState.messagesBtn.addEventListener('mouseleave', () => scheduleHoverClose('messages', [appState.messagesBtn, appState.messagesPanel], closeMessagesPanel));
    appState.messagesPanel.addEventListener('mouseleave', () => scheduleHoverClose('messages', [appState.messagesBtn, appState.messagesPanel], closeMessagesPanel));
    pinOnInsideClick('messages', [appState.messagesPanel]);

    // ---------- Schedule: data + shared date helpers ----------
    // Scheduling itself happens conversationally through Dotbot (see the "Dotbot Scheduling
    // Conversation" section below); the schedule button instead puts the whole canvas into a
    // read-only agenda view (see "Schedule View Mode") for browsing what's scheduled.
 // { id, itemId, folderId, title, date: 'YYYY-MM-DD', time: 'HH:MM' }


    function pad2(n) { return String(n).padStart(2, '0'); }
    function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function formatDateLabel(d) {
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function formatTimeLabel(time) {
        const [h, m] = time.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        return `${h12}:${pad2(m)} ${period}`;
    }
    // scheduledEvents can reference items in any folder (you can schedule a card, navigate
    // away, and still see it in the agenda), so lookups here can't rely on findItemById
    // (which only searches the current folder).
    function findItemInFolder(folderId, itemId) {
        const f = appState.folders[folderId];
        return f ? f.items.find(i => i.id === itemId) : null;
    }

    // ---------- Schedule View Mode ----------
    // Clicking the schedule button turns the current canvas into a read-only agenda: unscheduled
    // cards disappear, and everything scheduled for the active date appears as real cards
    // positioned against an hour-marked timeline (see renderScheduleAgenda), on the same dotted
    // grid as the normal canvas. The agenda aggregates across ALL of this user's canvases — their
    // own whole folder tree (already loaded, see loadWorkspace) plus canvases shared with them
    // (loaded on demand per event, see renderScheduleAgenda) — not just whichever canvas happened
    // to be open when it was entered. Cards can't be dragged/moved, but folder/source cards can
    // still be clicked into and notes can still be edited in place. No horizontal scroll, no free
    // panning — only vertical scroll, and only once the timeline is taller than the viewport.

    // Drag-to-scroll (vertical only), same feel as panning the real canvas — set up once since
    // this is a single persistent DOM element, not rebuilt on every render.
    appState.scheduleViewCanvasEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.item')) return; // let clicks/edits on a real card through untouched
        appState.scheduleScrollDragging = true;
        appState.scheduleScrollStartY = e.clientY;
        appState.scheduleScrollStartTop = appState.scheduleViewCanvasEl.scrollTop;
        appState.scheduleViewCanvasEl.setPointerCapture(e.pointerId);
    });
    appState.scheduleViewCanvasEl.addEventListener('pointermove', (e) => {
        if (!appState.scheduleScrollDragging) return;
        appState.scheduleViewCanvasEl.scrollTop = appState.scheduleScrollStartTop - (e.clientY - appState.scheduleScrollStartY);
    });
    appState.scheduleViewCanvasEl.addEventListener('pointerup', () => { appState.scheduleScrollDragging = false; });
    appState.scheduleViewCanvasEl.addEventListener('pointercancel', () => { appState.scheduleScrollDragging = false; });

    function toggleScheduleViewMode() {
        if (appState.scheduleViewMode) exitScheduleViewMode(); else enterScheduleViewMode();
    }
    function enterScheduleViewMode() {
        if (appState.scheduleViewMode) return;
        closeAllPanels(null);
        appState.scheduleViewMode = true;
        appState.scheduleBtn.classList.add('active');
        canvas.classList.add('schedule-view-mode');
        // Mirrors the exact mechanism render() already uses to hide these same three toolbars
        // for source pages (see the folderObj.isSource branch) — they're toggled via inline
        // style there, which a stylesheet rule can never win against, so schedule view mode has
        // to hide them the same way rather than through a CSS class. The schedule toolbar itself
        // is deliberately left alone: it's what toggles the mode back off.
        appState.modeToolbar.style.display = 'none';
        appState.addToolbar.style.display = 'none';
        zoomControl.style.display = 'none';
        appState.scheduleViewSavedTransform = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.scale = 1; appState.tx = 0; appState.ty = 0;
        applyTransform();
        appState.scheduleViewDate = new Date();
        appState.scheduleView.classList.add('active');
        renderScheduleAgenda();
    }
    function exitScheduleViewMode() {
        if (!appState.scheduleViewMode) return;
        appState.scheduleViewMode = false;
        appState.scheduleBtn.classList.remove('active');
        canvas.classList.remove('schedule-view-mode');
        appState.modeToolbar.style.display = '';
        appState.addToolbar.style.display = '';
        zoomControl.style.display = '';
        appState.scheduleView.classList.remove('active');
        if (appState.scheduleViewSavedTransform) {
            ({ tx: appState.tx, ty: appState.ty, scale: appState.scale } = appState.scheduleViewSavedTransform);
            appState.scheduleViewSavedTransform = null;
            applyTransform();
        }
    }
    appState.scheduleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleScheduleViewMode(); });

    function scheduleAgendaShift(unit, delta) {
        const d = new Date(appState.scheduleViewDate);
        if (unit === 'day') d.setDate(d.getDate() + delta);
        else if (unit === 'week') d.setDate(d.getDate() + delta * 7);
        else if (unit === 'month') d.setMonth(d.getMonth() + delta);
        appState.scheduleViewDate = d;
        renderScheduleAgenda();
    }

    function formatHourLabel(h) {
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        return `${h12} ${period}`;
    }

 // px per hour in the timeline

    // Hour markers + event cards are real React state now (see app/dotto/ScheduleAgenda.jsx,
    // portaling into #schedule-view-hours/#schedule-view-stack) — this only computes the data and
    // hands it off via window.__setScheduleAgenda. #schedule-view-date's textContent and
    // #schedule-view-inner's height stay direct DOM writes: trivial, no list-diffing involved, not
    // worth a bridge of their own.
    //
    // Aggregates across every canvas this user can see, not just appState.currentFolderId — a flat
    // scan over the whole scheduledEvents array (already how the due-event notifier in
    // dotbot-schedule-notifications.js reads it) rather than one folder's item list. Owned folders
    // are always already loaded (loadWorkspace loads the whole tree up front); a folderId can also
    // be a shared:owner:id key (scheduling already works on a shared canvas today, it just wasn't
    // surfaced anywhere except that exact canvas) — those load on demand here, one RPC per distinct
    // shared folder actually referenced by today's events, not every shared canvas wholesale. A
    // folder/event that fails to resolve (access revoked, canvas deleted since) is silently
    // dropped rather than erroring the whole agenda, same defensive stance renderHubCollabList
    // takes for the same class of problem.
    async function renderScheduleAgenda() {
        document.getElementById('schedule-view-date').textContent = formatDateLabel(appState.scheduleViewDate);
        const key = dateKey(appState.scheduleViewDate);
        const todaysEvents = appState.scheduledEvents.filter(e => e.date === key);

        const sharedFolderIds = [...new Set(todaysEvents.map(e => e.folderId).filter(id => id.startsWith('shared:') && !appState.folders[id]))];
        await Promise.all(sharedFolderIds.map(id => ensureSharedFolderLoaded(id)));

        const list = todaysEvents
            .map(ev => ({ ev, it: findItemInFolder(ev.folderId, ev.itemId) }))
            .filter(x => x.it)
            .sort((a, b) => a.ev.time.localeCompare(b.ev.time));

        if (!list.length) {
            appState.scheduleViewInner.style.height = '100%';
            window.__setScheduleAgenda({ hours: [], events: [] });
            return;
        }

        let firstHour = 23, lastHour = 0;
        list.forEach(({ ev }) => {
            const h = parseInt(ev.time.split(':')[0], 10);
            firstHour = Math.min(firstHour, h);
            lastHour = Math.max(lastHour, h);
        });

        const totalHeight = (lastHour - firstHour + 1) * appState.SCHEDULE_HOUR_ROW + 40;
        appState.scheduleViewInner.style.height = totalHeight + 'px';

        const hours = [];
        for (let h = firstHour; h <= lastHour; h++) {
            hours.push({ hour: h, label: formatHourLabel(h), top: (h - firstHour) * appState.SCHEDULE_HOUR_ROW });
        }

        const events = list.map(({ it, ev }) => {
            const [h, m] = ev.time.split(':').map(Number);
            const top = ((h + m / 60) - firstHour) * appState.SCHEDULE_HOUR_ROW;
            const w = Math.min(it.w || 220, 420), hgt = it.h || 100;
            return { it, ev, top, w, h: hgt };
        });

        window.__setScheduleAgenda({ hours, events });
    }

export { closeMessagesPanel, dateKey, exitScheduleViewMode, formatDateLabel, formatTimeLabel, openMessagesPanel, pad2, scheduleAgendaShift };

// React → vanilla bridge — used by ScheduleAgenda.jsx (app/dotto/), which can't import this
// directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__exitScheduleViewMode = exitScheduleViewMode;
