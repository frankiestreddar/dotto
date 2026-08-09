import { clearSearch } from './ai-assistant-suggestions.js';
import { appState, canvas, zoomControl } from './core-state.js';
import { renderMsgList } from './friends-presence.js';
import { applyTransform, smoothPanTo } from './history-autosave.js';
import { closeConvo, miniLabelForItem } from './live-presence.js';
import { closeAllPanels, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { cameraCenterFor, clearArrangedSlots, computeArrangedLayout, SCHEDULE_ALL, setArrangedSlots } from './schedule-view-canvas.js';
import { ensureSharedFolderLoaded, kindTypeLabel } from './shared-canvases-outline.js';


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
    // Clicking the schedule button transforms the CURRENT canvas in place, animated, rather than
    // opening a separate page: the camera zooms to 100%, every card not scheduled for the active
    // date fades out, and every scheduled one slides from its real position into a clean
    // sorted-by-time list (a simplified icon+name+type+time row, not the full card — see
    // ScheduleModeCardBody.jsx/app/dotto/CanvasItemsLayer.jsx). Exiting reverses all of it —
    // everything flies back to exactly where it was. See enterCanvasScheduleMode/
    // renderCanvasScheduleAgenda below, and schedule-view-canvas.js for the arrange/animate
    // mechanics themselves (deliberately kept out of this and the canvas-core files). The
    // cross-canvas aggregate view (every canvas at once, via the old hour-timeline overlay) is
    // still here too (renderScheduleAgenda/enterScheduleModeAll, further down) — not reachable via
    // any UI yet, wired back up by the canvas-switcher in a later PR.

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
    // Default entry point (the schedule button) — always targets the currently open canvas for
    // now; the canvas-switcher (a later PR) will let this retarget to a different folder or to
    // SCHEDULE_ALL instead.
    function enterScheduleViewMode() {
        enterCanvasScheduleMode(appState.currentFolderId);
    }
    // Cross-canvas aggregate (SCHEDULE_ALL) — the original overlay-based hour-timeline, unchanged.
    // Not reachable via any UI yet (the schedule button defaults to enterScheduleViewMode above) —
    // wired up by the canvas-switcher's "select all" option in a later PR.
    function enterScheduleModeAll() {
        if (appState.scheduleViewMode) return;
        closeAllPanels(null);
        appState.scheduleViewMode = true;
        appState.scheduleViewSelection = SCHEDULE_ALL;
        appState.scheduleBtn.classList.add('active');
        canvas.classList.add('schedule-view-mode', 'schedule-view-all');
        appState.modeToolbar.style.display = 'none';
        appState.addToolbar.style.display = 'none';
        zoomControl.style.display = 'none';
        appState.scheduleViewSavedTransform = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.scale = 1; appState.tx = 0; appState.ty = 0;
        applyTransform();
        appState.scheduleViewDate = new Date();
        appState.scheduleViewHeader.classList.add('active');
        appState.scheduleView.classList.add('active');
        renderScheduleAgenda();
    }

    // Single-canvas in-place transform for `folderId`'s canvas — real cards hide/rearrange, camera
    // zooms to 100% centered on the arranged list. Idempotent: call this again (not
    // enterScheduleViewMode) to retarget an already-active session at a different canvas (the
    // switcher) or a new date (scheduleAgendaShift below) — `isFreshEntry` skips the mode-entry
    // side effects (toolbar hiding, saving the prior camera transform) when they're already done.
    async function enterCanvasScheduleMode(folderId) {
        const isFreshEntry = !appState.scheduleViewMode;
        if (isFreshEntry) {
            closeAllPanels(null);
            appState.scheduleViewMode = true;
            appState.scheduleBtn.classList.add('active');
            canvas.classList.add('schedule-view-mode');
            // Mirrors the exact mechanism render() already uses to hide these same three toolbars
            // for source pages (see the folderObj.isSource branch) — inline style, since a
            // stylesheet rule can never win against one set elsewhere. The schedule toolbar itself
            // is deliberately left alone: it's what toggles the mode back off.
            appState.modeToolbar.style.display = 'none';
            appState.addToolbar.style.display = 'none';
            zoomControl.style.display = 'none';
            appState.scheduleViewSavedTransform = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
            appState.scheduleViewDate = new Date();
            appState.scheduleViewHeader.classList.add('active');
        }
        appState.scheduleViewSelection = folderId;
        document.getElementById('schedule-view-date').textContent = formatDateLabel(appState.scheduleViewDate);
        await renderCanvasScheduleAgenda(folderId);
    }

    function exitScheduleViewMode() {
        if (!appState.scheduleViewMode) return;
        const wasAll = appState.scheduleViewSelection === SCHEDULE_ALL;
        appState.scheduleViewMode = false;
        appState.scheduleViewSelection = SCHEDULE_ALL;
        appState.scheduleBtn.classList.remove('active');
        appState.modeToolbar.style.display = '';
        appState.addToolbar.style.display = '';
        zoomControl.style.display = '';
        appState.scheduleViewHeader.classList.remove('active');
        canvas.classList.remove('schedule-view-all');
        if (wasAll) {
            appState.scheduleView.classList.remove('active');
            canvas.classList.remove('schedule-view-mode');
        } else {
            clearArrangedSlots();
            window.__setScheduleMode({ active: false, itemsById: new Map() });
            // Keep the item slide/fade transition CSS (#canvas.schedule-view-mode:not(.schedule-
            // view-all) .item{...}, globals.css) alive for exactly as long as the fly-back
            // animation needs, THEN drop the class — same set-transition/wait/clear technique
            // smoothPanTo itself uses, just delayed to the end since this is the LEAVING
            // transition. Dropping the class immediately would snap items back instantly instead
            // of animating — appState.scheduleViewMode already flipped to false above is what
            // makes applyItemWrapperAttrs (waypoints-render-loop.js) go back to writing each
            // item's real x/y the moment its layout effect re-runs (triggered by the store update
            // right above), so the class only needs to keep the CSS transition itself alive.
            clearTimeout(appState.scheduleExitTransitionTimeout);
            appState.scheduleExitTransitionTimeout = setTimeout(() => {
                canvas.classList.remove('schedule-view-mode');
            }, 520);
        }
        if (appState.scheduleViewSavedTransform) {
            const target = appState.scheduleViewSavedTransform;
            appState.scheduleViewSavedTransform = null;
            smoothPanTo(target.tx, target.ty, target.scale, 500);
        }
    }
    appState.scheduleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleScheduleViewMode(); });

    function scheduleAgendaShift(unit, delta) {
        const d = new Date(appState.scheduleViewDate);
        if (unit === 'day') d.setDate(d.getDate() + delta);
        else if (unit === 'week') d.setDate(d.getDate() + delta * 7);
        else if (unit === 'month') d.setMonth(d.getMonth() + delta);
        appState.scheduleViewDate = d;
        if (appState.scheduleViewSelection === SCHEDULE_ALL) { renderScheduleAgenda(); return; }
        enterCanvasScheduleMode(appState.scheduleViewSelection);
    }

    function formatHourLabel(h) {
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        return `${h12} ${period}`;
    }

 // px per hour in the timeline

    // Computes and commits one canvas's arranged schedule-mode list for the active date: resolves
    // today's scheduledEvents for `folderId` to real items (loading a shared folder on demand,
    // same defensive drop-if-unresolvable stance renderScheduleAgenda below already takes), hands
    // the sorted list to schedule-view-canvas.js's pure layout math, commits the result so
    // applyScheduleModeWrapperAttrs/handleScheduleModeWheel can read it, pushes the simplified
    // per-card display data (time/name/type) to React via scheduleModeStore, and animates the
    // camera to center on the arranged list at 100% zoom. Doesn't touch appState.scheduleViewMode/
    // toolbars/saved-transform itself — enterCanvasScheduleMode (above) owns entry side effects;
    // this just (re)computes the arrangement for whichever canvas+date is currently selected, so
    // it's also what scheduleAgendaShift calls on a date change.
    async function renderCanvasScheduleAgenda(folderId) {
        const key = dateKey(appState.scheduleViewDate);
        let todaysEvents = appState.scheduledEvents.filter(e => e.date === key && e.folderId === folderId);

        if (folderId.startsWith('shared:') && !appState.folders[folderId]) {
            const ok = await ensureSharedFolderLoaded(folderId);
            if (!ok) todaysEvents = [];
        }

        const list = todaysEvents
            .map(ev => ({ ev, it: findItemInFolder(folderId, ev.itemId) }))
            .filter(x => x.it)
            .sort((a, b) => a.ev.time.localeCompare(b.ev.time));

        const { slotsById, centerX, centerY, totalHeight } = computeArrangedLayout(list);
        setArrangedSlots(slotsById, totalHeight);

        const itemsById = new Map(list.map(({ it, ev }) => [it.id, {
            time: formatTimeLabel(ev.time),
            name: miniLabelForItem(it),
            kindLabel: kindTypeLabel(it.kind, it.level),
        }]));
        window.__setScheduleMode({ active: true, itemsById });

        const { tx, ty } = cameraCenterFor(centerX, centerY);
        smoothPanTo(tx, ty, 1, 500);
    }

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
