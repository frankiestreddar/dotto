import { clearSearch } from './ai-assistant-suggestions.js';
import { addToolbar } from './copy-paste.js';
import { appState, canvas, zoomControl } from './core-state.js';
import { msgView, renderMsgList } from './friends-presence.js';
import { applyTransform, scheduleWorkspaceSave } from './history-autosave.js';
import { closeConvo, renderRealCardPreview } from './live-presence.js';
import { closeAllPanels, panelPinned, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { modeToolbar } from './source-buttons-cursor-mode.js';
import { openFolder } from './waypoints-render-loop.js';

    // ---------- Messages Panel Controls ----------
    const messagesBtn = document.getElementById('btn-messages'), messagesPanel = document.getElementById('messages-panel');
    const msgConvo = document.getElementById('msg-convo'), msgList = document.getElementById('msg-list');
    const msgSearchInput = document.getElementById('msg-search');
    // Also closes any open conversation (not just the panel around it) — otherwise it stays
    // "open" internally at whatever scroll position was left, and reopening the panel later
    // shows that same stale state instead of a fresh bottom-of-conversation view.
    function closeMessagesPanel() { messagesPanel.classList.remove('open'); messagesBtn.classList.remove('active'); panelPinned.messages = false; closeConvo(); }
    function positionMessagesPanel() {
        const rect = messagesBtn.getBoundingClientRect();
        messagesPanel.style.bottom = 'auto';
        messagesPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 320;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        messagesPanel.style.left = leftPos + 'px';
        messagesPanel.style.right = 'auto';
    }
    function openMessagesPanel(pin) {
        closeAllPanels('messages');
        clearSearch();
        messagesPanel.classList.add('open');
        messagesBtn.classList.add('active');
        closeConvo();
        msgView = 'main'; // always land on the main list, never mid-Requests from last time
        msgSearchInput.value = '';
        renderMsgList('');
        positionMessagesPanel();
        if (pin) { msgSearchInput.focus(); panelPinned.messages = true; }
    }
    messagesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.messages) { closeMessagesPanel(); }
        else { openMessagesPanel(true); }
    });
    messagesBtn.addEventListener('mouseenter', () => { if (!messagesPanel.classList.contains('open')) openMessagesPanel(false); });
    messagesBtn.addEventListener('mouseleave', () => scheduleHoverClose('messages', [messagesBtn, messagesPanel], closeMessagesPanel));
    messagesPanel.addEventListener('mouseleave', () => scheduleHoverClose('messages', [messagesBtn, messagesPanel], closeMessagesPanel));
    pinOnInsideClick('messages', [messagesPanel]);

    // ---------- Schedule: data + shared date helpers ----------
    // Scheduling itself happens conversationally through Dotbot (see the "Dotbot Scheduling
    // Conversation" section below); the schedule button instead puts the whole canvas into a
    // read-only agenda view (see "Schedule View Mode") for browsing what's scheduled.
    let scheduledEvents = []; // { id, itemId, folderId, title, date: 'YYYY-MM-DD', time: 'HH:MM' }
    let scheduleViewDate = new Date();

    const scheduleBtn = document.getElementById('btn-schedule');

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
    // Clicking the schedule button turns the current canvas into a read-only timeline: unscheduled
    // cards disappear, scheduled ones from *this* canvas appear as real cards positioned against
    // an hour-marked timeline (see renderScheduleAgenda), on the same dotted grid as the normal
    // canvas. They can't be dragged/moved, but folder/source cards can still be clicked into and
    // notes can still be edited in place. No horizontal scroll, no free panning — only vertical
    // scroll, and only once the timeline is taller than the viewport.
    let scheduleViewMode = false;
    let scheduleViewSavedTransform = null;
    const scheduleView = document.getElementById('schedule-view');
    const scheduleViewCanvasEl = document.getElementById('schedule-view-canvas');
    const scheduleViewInner = document.getElementById('schedule-view-inner');
    const scheduleViewHours = document.getElementById('schedule-view-hours');
    const scheduleViewStack = document.getElementById('schedule-view-stack');

    // Drag-to-scroll (vertical only), same feel as panning the real canvas — set up once since
    // this is a single persistent DOM element, not rebuilt on every render.
    let scheduleScrollDragging = false, scheduleScrollStartY = 0, scheduleScrollStartTop = 0;
    scheduleViewCanvasEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.item')) return; // let clicks/edits on a real card through untouched
        scheduleScrollDragging = true;
        scheduleScrollStartY = e.clientY;
        scheduleScrollStartTop = scheduleViewCanvasEl.scrollTop;
        scheduleViewCanvasEl.setPointerCapture(e.pointerId);
    });
    scheduleViewCanvasEl.addEventListener('pointermove', (e) => {
        if (!scheduleScrollDragging) return;
        scheduleViewCanvasEl.scrollTop = scheduleScrollStartTop - (e.clientY - scheduleScrollStartY);
    });
    scheduleViewCanvasEl.addEventListener('pointerup', () => { scheduleScrollDragging = false; });
    scheduleViewCanvasEl.addEventListener('pointercancel', () => { scheduleScrollDragging = false; });

    function toggleScheduleViewMode() {
        if (scheduleViewMode) exitScheduleViewMode(); else enterScheduleViewMode();
    }
    function enterScheduleViewMode() {
        if (scheduleViewMode) return;
        closeAllPanels(null);
        scheduleViewMode = true;
        scheduleBtn.classList.add('active');
        canvas.classList.add('schedule-view-mode');
        // Mirrors the exact mechanism render() already uses to hide these same three toolbars
        // for source pages (see the folderObj.isSource branch) — they're toggled via inline
        // style there, which a stylesheet rule can never win against, so schedule view mode has
        // to hide them the same way rather than through a CSS class. The schedule toolbar itself
        // is deliberately left alone: it's what toggles the mode back off.
        modeToolbar.style.display = 'none';
        addToolbar.style.display = 'none';
        zoomControl.style.display = 'none';
        scheduleViewSavedTransform = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.scale = 1; appState.tx = 0; appState.ty = 0;
        applyTransform();
        scheduleViewDate = new Date();
        scheduleView.classList.add('active');
        renderScheduleAgenda();
    }
    function exitScheduleViewMode() {
        if (!scheduleViewMode) return;
        scheduleViewMode = false;
        scheduleBtn.classList.remove('active');
        canvas.classList.remove('schedule-view-mode');
        modeToolbar.style.display = '';
        addToolbar.style.display = '';
        zoomControl.style.display = '';
        scheduleView.classList.remove('active');
        if (scheduleViewSavedTransform) {
            ({ tx: appState.tx, ty: appState.ty, scale: appState.scale } = scheduleViewSavedTransform);
            scheduleViewSavedTransform = null;
            applyTransform();
        }
    }
    scheduleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleScheduleViewMode(); });

    function scheduleAgendaShift(unit, delta) {
        const d = new Date(scheduleViewDate);
        if (unit === 'day') d.setDate(d.getDate() + delta);
        else if (unit === 'week') d.setDate(d.getDate() + delta * 7);
        else if (unit === 'month') d.setMonth(d.getMonth() + delta);
        scheduleViewDate = d;
        renderScheduleAgenda();
    }

    function formatHourLabel(h) {
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        return `${h12} ${period}`;
    }

    const SCHEDULE_HOUR_ROW = 96; // px per hour in the timeline

    function renderScheduleAgenda() {
        document.getElementById('schedule-view-date').textContent = formatDateLabel(scheduleViewDate);
        const key = dateKey(scheduleViewDate);
        // Scoped to the current canvas only — matches every other schedule entry point
        // (scheduling itself always records the folderId you were in at the time).
        const folderObj = appState.folders[appState.currentFolderId];
        const list = (folderObj ? folderObj.items : [])
            .map(it => ({ it, ev: scheduledEvents.find(e => e.folderId === appState.currentFolderId && e.itemId === it.id && e.date === key) }))
            .filter(x => x.ev)
            .sort((a, b) => a.ev.time.localeCompare(b.ev.time));

        scheduleViewHours.innerHTML = '';
        scheduleViewStack.innerHTML = '';

        if (!list.length) {
            scheduleViewInner.style.height = '100%';
            scheduleViewStack.innerHTML = `<div id="schedule-view-empty">Nothing scheduled for this day on this canvas.<br><br>Right-click any card (or a selection of cards) and choose "Schedule" to add one.</div>`;
            return;
        }

        let firstHour = 23, lastHour = 0;
        list.forEach(({ ev }) => {
            const h = parseInt(ev.time.split(':')[0], 10);
            firstHour = Math.min(firstHour, h);
            lastHour = Math.max(lastHour, h);
        });

        const totalHeight = (lastHour - firstHour + 1) * SCHEDULE_HOUR_ROW + 40;
        scheduleViewInner.style.height = totalHeight + 'px';

        for (let h = firstHour; h <= lastHour; h++) {
            const marker = document.createElement('div');
            marker.className = 'schedule-view-hour';
            marker.style.top = ((h - firstHour) * SCHEDULE_HOUR_ROW) + 'px';
            marker.textContent = formatHourLabel(h);
            scheduleViewHours.appendChild(marker);
        }

        list.forEach(({ it, ev }) => {
            const [h, m] = ev.time.split(':').map(Number);
            const top = ((h + m / 60) - firstHour) * SCHEDULE_HOUR_ROW;
            const w = Math.min(it.w || 220, 420), hgt = it.h || 100;

            const wrap = document.createElement('div');
            wrap.className = 'schedule-view-card-wrap';
            wrap.style.top = top + 'px';
            wrap.style.width = w + 'px';

            const card = renderRealCardPreview(it);
            card.style.position = 'relative';
            if (it.kind !== 'title') { card.style.width = w + 'px'; card.style.height = hgt + 'px'; }
            wrap.appendChild(card);

            // No dragging/moving (renderRealCardPreview never wires that up — it's a real-looking
            // but otherwise inert clone by default), but folder/source cards can still be clicked
            // into, and a note's text can still be edited directly.
            if (it.kind === 'folder' || it.kind === 'source') {
                card.style.cursor = 'pointer';
                card.addEventListener('click', (e) => { e.stopPropagation(); exitScheduleViewMode(); openFolder(it.folderId); });
            } else if (it.kind === 'note') {
                const body = card.querySelector('.body');
                if (body) {
                    body.contentEditable = 'true';
                    body.style.cursor = 'text';
                    body.addEventListener('pointerdown', (e) => e.stopPropagation());
                    body.addEventListener('blur', () => { it.html = body.innerHTML; scheduleWorkspaceSave(); });
                }
            }

            scheduleViewStack.appendChild(wrap);
        });
    }


export { closeMessagesPanel, dateKey, exitScheduleViewMode, formatDateLabel, formatTimeLabel, messagesPanel, msgConvo, msgList, msgSearchInput, openMessagesPanel, pad2, scheduleAgendaShift, scheduleBtn, scheduleViewMode, scheduledEvents };
