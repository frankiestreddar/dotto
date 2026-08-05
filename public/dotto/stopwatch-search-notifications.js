import { escapeHtml } from './ai-assistant-suggestions.js';
import { appState } from './core-state.js';
import { ensureConnections, folderIdForConnectedSource, folderTitleForConnectedSource } from './drawing-connections.js';
import { syncCanvasCollabTitle } from './friends-presence.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { broadcastEditingState, findItemById, renderInlineCanvas, sanitizeFlashcardSnapshot, snapshotItem } from './live-presence.js';
import { applyFilterToRows, collectAvailableFilterTags, diffRatings } from './srs-connections-core.js';
import { openFolder, render } from './waypoints-render-loop.js';


    // ---------- Stopwatch card ----------
    function swFormatTime(ms) {
        const totalSec = Math.floor(Math.max(0, ms) / 1000);
        const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }
    function swCurrentElapsedMs(it) {
        if (it.swRunning && !it.swPaused && it.swLastResumeAt) return it.swElapsedMs + (Date.now() - it.swLastResumeAt);
        return it.swElapsedMs;
    }
    function swToggleRun(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        if (!it.swRunning) {
            it.swRunning = true; it.swPaused = false; it.swLastResumeAt = Date.now();
            it.swSessionActive = true;
            it.swSessionId = 'sess_' + (appState.idCounter++);
            it.swSessionStartedAt = Date.now();
            it.swSessionLive = {}; it.swSessionBaseline = {};
        } else {
            if (!it.swPaused && it.swLastResumeAt) it.swElapsedMs += Date.now() - it.swLastResumeAt;
            const finishedDurationMs = it.swElapsedMs;
            it.swRunning = false; it.swPaused = false; it.swLastResumeAt = null;
            if (it.swSessionActive) {
                const payloads = Object.keys(it.swSessionLive).map(originId => {
                    const live = it.swSessionLive[originId] || {};
                    const base = it.swSessionBaseline[originId] || {};
                    return { originId, delta: { seen: (live.seen || 0) - (base.seen || 0), totalCards: live.totalCards, ratings: diffRatings(live.ratings, base.ratings) } };
                });
                const session = { sessionId: it.swSessionId, startedAt: it.swSessionStartedAt, endedAt: Date.now(), durationMs: finishedDurationMs, payloads };
                // Stopwatches keep only the 3 most-recent sessions behind the scenes (most
                // recent first); a connected shelf card archives them permanently as they
                // stream through, so it can hold unlimited history even though the stopwatch
                // itself only ever remembers the last 3.
                it.swSessions = it.swSessions || [];
                it.swSessions.unshift(session);
                if (it.swSessions.length > 3) it.swSessions.length = 3;
            }
            it.swSessionActive = false;
            it.swElapsedMs = 0; // Stop always resets the timer, ready for the next run.
        }
        render();
    }
    function swTogglePause(id) {
        const it = findItemById(id); if (!it || !it.swRunning) return;
        saveSnapshot();
        if (it.swPaused) { it.swPaused = false; it.swLastResumeAt = Date.now(); }
        else { if (it.swLastResumeAt) it.swElapsedMs += Date.now() - it.swLastResumeAt; it.swPaused = true; it.swLastResumeAt = null; }
        render();
    }
    function renderStopwatchHTML(it) {
        return `<div class="sw-row" onmousedown="event.stopPropagation()">
            <button class="sw-btn sw-startstop" onclick="swToggleRun(${it.id})" title="${it.swRunning ? 'Stop' : 'Start'}">${it.swRunning ? '⏹' : '▶'}</button>
            <button class="sw-btn sw-pauseplay" onclick="swTogglePause(${it.id})" ${it.swRunning ? '' : 'disabled'} title="${it.swPaused ? 'Resume' : 'Pause'}">${it.swPaused ? '▶' : '⏸'}</button>
            <div class="sw-time">${swFormatTime(swCurrentElapsedMs(it))}</div>
        </div>`;
    }

    function shelfSelectSession(id, sessionId) {
        const it = findItemById(id); if (!it) return;
        it.shelfSelectedId = sessionId;
        render();
    }
    // "Stack" in the UI (kind stays 'shelf' internally — see its add-menu entry). Dual-purpose:
    // saved stopwatch sessions (below, unchanged) plus a summary of every source card currently
    // feeding it (see CardStreamIO.shelf's 'sourceRows' aggregation) — connect a source here, then
    // connect this Stack into a flashcard (or any other card that accepts 'content') to play every
    // connected source's rows at once.
    function renderShelfHTML(it) {
        const sessions = it.shelfSessions || [];
        const sourceEntries = Object.keys(it.stackSourceRows || {}).map(sid => ({
            sourceItemId: Number(sid),
            title: folderTitleForConnectedSource(Number(sid)),
            count: (it.stackSourceRows[sid] || []).length,
        }));
        // Own name lives directly on the item (it.shelfName) rather than a folders[] entry — a
        // Stack has no canvas of its own, it just aggregates streams from whatever's connected
        // (see CardStreamIO.shelf). Unrenamed stacks fall back to the same empty-content +
        // data-placeholder convention as an unrenamed folder/source title (see
        // startRenameFolderCardTitle) rather than a hardcoded string, so the placeholder and the
        // eventual real name render through the exact same markup.
        const nameHTML = it.shelfName
            ? `<div class="shelf-header" onclick="event.stopPropagation(); startRenameShelfName(this, ${it.id})">${escapeHtml(it.shelfName)}</div>`
            : `<div class="shelf-header crumb-placeholder" data-placeholder="Stack" onclick="event.stopPropagation(); startRenameShelfName(this, ${it.id})"></div>`;
        // Clicking anywhere in the pill (not just its label) opens that source's own page — the
        // same static-source view its real card opens into (see handleShelfSourceRowClick/
        // openFolder), not just a jump to its card on this canvas. Double-clicking the label
        // renames it in place instead (see startRenameShelfSourceRow); handleShelfSourceRowClick
        // debounces a single click against a pending double-click so a rename's first click
        // doesn't also navigate away first.
        const sourcesHTML = sourceEntries.length
            ? `<div class="shelf-sources">${sourceEntries.map(s => `
                <div class="shelf-source-row" onclick="event.stopPropagation(); handleShelfSourceRowClick(this, ${s.sourceItemId})">
                    <span class="shelf-row-label" data-source-id="${s.sourceItemId}" ondblclick="event.stopPropagation(); startRenameShelfSourceRow(this, ${s.sourceItemId})" title="Double-click to rename">${escapeHtml(s.title)}</span>
                    <span class="shelf-row-meta">${s.count} ${s.count === 1 ? 'entry' : 'entries'}</span>
                </div>`).join('')}</div>`
            : '';
        // Lets you search across whichever connected sources / saved sessions are currently
        // listed — see filterShelfRows, which just show/hides rows on the DOM already built here
        // rather than re-rendering, so it never yanks focus out of the input mid-keystroke.
        // mousedown does BOTH stopPropagation (so clicking/dragging from inside the box never
        // starts a card-drag) AND preventDefault (so it never grabs focus purely from a mousedown
        // that turns into a card drag started elsewhere but happens to end with the pointer over
        // this box — see suppressClick in the card drag handler, which swallows that trailing
        // click before it ever reaches here) — focus is instead granted explicitly on a genuine
        // click via onclick, which only fires for a real, non-drag-suppressed click.
        const searchHTML = (sourceEntries.length || sessions.length)
            ? `<input type="text" class="shelf-search" placeholder="Search..." onmousedown="event.stopPropagation(); event.preventDefault();" onclick="event.stopPropagation(); this.focus();" oninput="filterShelfRows(this)" />`
            : '';
        if (!sessions.length) {
            if (sourceEntries.length) return `${nameHTML}${searchHTML}${sourcesHTML}`;
            return `${nameHTML}<div class="shelf-empty">No sessions saved yet, and nothing connected. Connect a source here to combine it with others for flashcards, or link a stopwatch (that's linked to a game) here, then press Start then Stop on it, to save a session.</div>`;
        }
        const rows = sessions.map(s => {
            const selected = s.sessionId === it.shelfSelectedId;
            const totalSeen = s.payloads.reduce((sum, p) => sum + ((p.delta && p.delta.seen) || 0), 0);
            return `<div class="shelf-row ${selected ? 'selected' : ''}" onmousedown="event.stopPropagation()" onclick="shelfSelectSession(${it.id}, '${s.sessionId}')">
                <span class="shelf-row-label">${s.label}</span>
                <span class="shelf-row-meta">${totalSeen} seen</span>
            </div>`;
        }).join('');
        return `${nameHTML}${searchHTML}${sourcesHTML}<div class="shelf-rows">${rows}</div>`;
    }
    // Show/hide rows in-place by matching their label text against the search box's current
    // value — deliberately not a render() (would rebuild the whole card and drop the input's
    // focus/caret mid-keystroke). Matches across both connected-source rows and saved-session
    // rows, whichever are present.
    function filterShelfRows(inputEl) {
        const card = inputEl.closest('.item.shelf');
        if (!card) return;
        const q = inputEl.value.trim().toLowerCase();
        card.querySelectorAll('.shelf-source-row, .shelf-row').forEach(rowEl => {
            const label = rowEl.querySelector('.shelf-row-label');
            const text = label ? label.textContent.toLowerCase() : '';
            rowEl.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
    }
    // Inline-rename a Stack's own name — same contentEditable click-to-edit flow as
    // startRenameFolderCardTitle, just writing to it.shelfName directly (a Stack has no
    // folders[] entry of its own to write to).
    function startRenameShelfName(nameEl, itemId) {
        const it = findItemById(itemId);
        if (!it || nameEl.contentEditable === 'true') return;
        saveSnapshot();
        const fullTitle = it.shelfName || '';
        const isDefaultTitle = !fullTitle;
        if (isDefaultTitle) {
            nameEl.textContent = '';
            nameEl.setAttribute('data-placeholder', 'Stack');
            nameEl.classList.add('crumb-placeholder');
        } else {
            nameEl.textContent = fullTitle;
        }
        nameEl.contentEditable = true;
        broadcastEditingState(true, `#item-${it.id} .shelf-header`);
        nameEl.focus();
        const placeCaretAtEnd = () => {
            const range = document.createRange();
            range.selectNodeContents(nameEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        placeCaretAtEnd();
        setTimeout(placeCaretAtEnd, 0);
        nameEl.onblur = () => {
            nameEl.contentEditable = false;
            broadcastEditingState(false);
            nameEl.classList.remove('crumb-placeholder');
            const newTitle = nameEl.textContent.trim();
            if (newTitle) it.shelfName = newTitle;
            render();
        };
        nameEl.oninput = () => {
            const liveTitle = nameEl.textContent;
            if (liveTitle.trim()) { it.shelfName = liveTitle; scheduleWorkspaceSave(); }
        };
        nameEl.onkeydown = (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
            if (ke.key === 'Escape') { ke.preventDefault(); nameEl.textContent = isDefaultTitle ? '' : fullTitle; nameEl.blur(); }
        };
    }
    // Distinguishes a real single click (open the source's own page — see openFolder) from the
    // first half of a double-click on its label (rename — see startRenameShelfSourceRow's
    // ondblclick): a genuine click opens the source after a short delay, but if a second click
    // lands within that window this just cancels the pending navigation and lets ondblclick take
    // over, so renaming a row doesn't also navigate away first.
    let shelfRowClickTimer = null;
    function handleShelfSourceRowClick(rowEl, sourceItemId) {
        if (shelfRowClickTimer) { clearTimeout(shelfRowClickTimer); shelfRowClickTimer = null; return; }
        shelfRowClickTimer = setTimeout(() => {
            shelfRowClickTimer = null;
            const folderId = folderIdForConnectedSource(sourceItemId);
            if (folderId) openFolder(folderId);
        }, 220);
    }
    // Inline-rename a connected source's name from inside the Stack that's aggregating it —
    // writes straight back to that source's own folders[folderId].title (via
    // folderIdForConnectedSource), the same real property its own card and breadcrumb read/write,
    // so the rename is visible everywhere that source appears, not just here.
    function startRenameShelfSourceRow(labelEl, sourceItemId) {
        if (labelEl.contentEditable === 'true') return;
        const folderId = folderIdForConnectedSource(sourceItemId);
        if (!appState.folders[folderId]) return;
        saveSnapshot();
        const fullTitle = appState.folders[folderId].title;
        labelEl.textContent = fullTitle;
        labelEl.contentEditable = true;
        broadcastEditingState(true, `.shelf-row-label[data-source-id="${sourceItemId}"]`);
        labelEl.focus();
        const placeCaretAtEnd = () => {
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        placeCaretAtEnd();
        setTimeout(placeCaretAtEnd, 0);
        labelEl.onblur = () => {
            labelEl.contentEditable = false;
            broadcastEditingState(false);
            const newTitle = labelEl.textContent.trim();
            if (newTitle) { appState.folders[folderId].title = newTitle; syncCanvasCollabTitle(folderId, newTitle); }
            render();
        };
        labelEl.oninput = () => {
            const liveTitle = labelEl.textContent;
            if (liveTitle.trim()) { appState.folders[folderId].title = liveTitle; scheduleWorkspaceSave(); }
        };
        labelEl.onkeydown = (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); labelEl.blur(); }
            if (ke.key === 'Escape') { ke.preventDefault(); labelEl.textContent = fullTitle; labelEl.blur(); }
        };
    }

    // Filter card: connect a source (or another filter) into it, then it into a flashcard (or
    // another source/filter) — see CardStreamIO.filter. Its only real UI is "which tags currently
    // flowing through it should pass" plus an AND/OR switch for combining more than one; the
    // available tags list is entirely derived from incomingRows (see collectAvailableFilterTags)
    // since a filter has no source of its own, only whatever's connected to it right now.
    function renderFilterHTML(it) {
        const rows = it.incomingRows || [];
        if (!rows.length) {
            return `<div class="filter-header">Filter</div><div class="filter-empty">Connect a source (or another filter) to see its tags here.</div>`;
        }
        const availableTags = collectAvailableFilterTags(rows);
        const selected = new Set(it.filterTagIds || []);
        const mode = it.filterMode === 'and' ? 'and' : 'or';
        const tagsHTML = availableTags.length
            ? availableTags.map(t => `<span class="filter-tag-chip${selected.has(t.id) ? ' selected' : ''}" style="--chip-color:${t.color}" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); toggleFilterTag(${it.id}, '${t.id}')">${escapeHtml(t.name)}</span>`).join('')
            : `<span class="filter-empty-tags">No tags on the connected rows yet.</span>`;
        const outCount = applyFilterToRows(it, rows).length;
        return `<div class="filter-header">
                <span>Filter</span>
                <div class="filter-mode-toggle" onmousedown="event.stopPropagation()">
                    <button class="filter-mode-btn${mode === 'or' ? ' active' : ''}" onclick="event.stopPropagation(); setFilterMode(${it.id}, 'or')">OR</button>
                    <button class="filter-mode-btn${mode === 'and' ? ' active' : ''}" onclick="event.stopPropagation(); setFilterMode(${it.id}, 'and')">AND</button>
                </div>
            </div>
            <div class="filter-tags">${tagsHTML}</div>
            <div class="filter-count">${rows.length} in → ${outCount} out</div>`;
    }
    function setFilterMode(id, mode) {
        const it = findItemById(id); if (!it) return;
        it.filterMode = mode;
        scheduleWorkspaceSave();
        render();
    }
    function toggleFilterTag(id, tagId) {
        const it = findItemById(id); if (!it) return;
        const set = new Set(it.filterTagIds || []);
        if (set.has(tagId)) set.delete(tagId); else set.add(tagId);
        it.filterTagIds = Array.from(set);
        scheduleWorkspaceSave();
        render();
    }

    // ---------- Search & AI Gen ----------
    const searchInput = document.getElementById('search-input'), searchResults = document.getElementById('search-results'),
        searchDotbotAnswer = document.getElementById('search-dotbot-answer'),
        searchTranslation = document.getElementById('search-translation'),
        searchDictionary = document.getElementById('search-dictionary'), searchExamples = document.getElementById('search-examples'),
        searchImageResult = document.getElementById('search-image-result'),
        searchSuggestions = document.getElementById('search-suggestions'), searchRecommended = document.getElementById('search-recommended'),
        searchDropdown = document.getElementById('search-dropdown'), searchSpinner = document.getElementById('search-spinner'),
        searchInputWrap = document.getElementById('search-input-wrap'), searchCardPill = document.getElementById('search-card-pill'),
        searchCardPillLabel = document.getElementById('search-card-pill-label'), searchSpaceHint = document.getElementById('search-space-hint');

    // ---------- Notifications ----------
    // Generic engine — notifications queue up and are shown one at a time IN the search bar
    // itself (see #search-notification, which takes #search-input's place while one's showing),
    // optionally growing the bar taller (e.g. to fit an image), with an optional action button
    // triggerable by click OR Enter. Non-sticky ones auto-dismiss after `durationMs`; sticky ones
    // need an explicit dismiss (Escape, or the action button itself). Deferred while the user is
    // actively typing in the search box — retried on blur — so a notification never interrupts
    // something they're mid-typing.
    //
    // No notification has a visible dismiss button — Escape always dismisses whatever's showing
    // (see the notification keydown handler below), so even a sticky one always has a way out
    // without needing its own dedicated button for it.
    //
    // pushNotification({
    //   type,             // string id for the notification kind (e.g. 'chat', 'friend_request') —
    //                     // informational/for any future per-type styling, not used by the engine itself
    //   message,          // main text
    //   imageUrl,         // optional
    //   actionLabel,      // optional — shows the primary button (its rendered text gets an enter-
    //                     // arrow glyph appended, see showNotification); click or Enter activates it
    //   onAction,         // called when the primary button is activated
    //   sticky,           // default false — no auto-dismiss timer at all; needs actionLabel or
    //                     // Escape to ever go away
    //   durationMs,       // default 5000 (5 seconds) — auto-dismiss delay when not sticky
    //   grows,            // default false — let the bar grow taller than its normal single-line
    //                     // height for this one (see .notification-grows), instead of staying compact
    // })
    //
    // The only notification type from the original list with nothing behind it now is platform
    // tips, dropped entirely (no content for them) — achievements now have a real trigger too (see
    // bumpAchievementStat). Everything else — including the 3am day-change, which isn't a "reset"
    // of anything, just a clock boundary, and the paid-tier ad, which points at a
    // placeholder-content pricing page rather than a real subscription system — is wired to a
    // real trigger (see the pushNotification call sites in refreshCanvasCollabData/
    // refreshFriendsData/subscribeToAllFriendMessages/handleFriendPresenceSync/awardUserPoints/
    // refreshDotbotUsage/checkDueScheduledEvents/the day-change interval/the ad timer/
    // bumpAchievementStat below).
    const NOTIFICATION_DEFAULT_DURATION_MS = 5000;
    // Entrance/exit choreography timing — see the CSS block above #search-notification in
    // globals.css for the actual animations these durations drive (must stay in sync: the fast
    // flash is 2 iterations of a 0.2s keyframe, the slide is a 0.3s transition).
    const NOTIF_FLASH_MS = 400;
    const NOTIF_SLIDE_MS = 300;
    let notificationQueue = [];
    let currentNotification = null;
    let notificationTimer = null;
    // Bumped at the start of every enter/exit sequence — a pending setTimeout from an older
    // sequence checks this before acting, so it can't step on a newer sequence's state (e.g. the
    // user dismisses a notification mid-entrance, or the queue advances to the next one before a
    // stale timeout fires).
    let notificationSeq = 0;
    const notifImageEl = document.getElementById('search-notification-image'),
        notifTextEl = document.getElementById('search-notification-text'),
        notifActionBtn = document.getElementById('search-notification-action');

    // Time from when a notification settles (fully slid in) until its exit sequence STARTS, given
    // its configured `durationMs` — reserves NOTIF_FLASH_MS+NOTIF_SLIDE_MS at the end for the
    // pre-exit flash + slide-away so the notification's TOTAL time on screen still roughly
    // matches durationMs, rather than durationMs being purely the settled dwell time on top of
    // the exit animation. Clamped so a very short durationMs still gets at least as long to settle
    // as its own entrance took.
    function computeNotificationDismissDelay(durationMs) {
        const exitReserve = NOTIF_FLASH_MS + NOTIF_SLIDE_MS;
        return Math.max(durationMs - exitReserve, exitReserve);
    }

    // Minimum idle time between one notification fully closing and the next one opening, so a
    // backlog of queued notifications doesn't read as one continuous flicker. 0 means "no
    // notification has ever closed yet" — the very first one of the session shows with no
    // artificial gap. Set right when a notification finishes closing (see dismissCurrentNotification).
    const NOTIFICATION_QUEUE_GAP_MS = 5000;
    let lastNotificationCloseTime = 0;

    function pushNotification(config) {
        notificationQueue.push(config);
        tryShowNextNotification();
    }
    function tryShowNextNotification() {
        if (currentNotification || !notificationQueue.length) return;
        // Held while the tab isn't actually visible (another tab/app, backgrounded, screen
        // locked) — retried by the visibilitychange listener below the moment it's visible
        // again, so queued notifications come through one at a time from there rather than
        // firing unseen while away.
        if (document.visibilityState !== 'visible') return;
        if (document.activeElement === searchInput) return; // don't interrupt active typing — searchInput's blur listener retries this
        if (lastNotificationCloseTime) {
            const elapsed = Date.now() - lastNotificationCloseTime;
            if (elapsed < NOTIFICATION_QUEUE_GAP_MS) {
                // Re-checks everything above (visibility, focus, remaining gap) once it fires,
                // rather than assuming this is still the right moment — self-correcting if the tab
                // gets backgrounded or the gap gets pushed out again in the meantime.
                setTimeout(tryShowNextNotification, NOTIFICATION_QUEUE_GAP_MS - elapsed);
                return;
            }
        }
        showNotification(notificationQueue.shift());
    }
    // Entrance: (1) the border flashes 2 quick pulses while the bar still looks completely
    // normal, (2) #search-input/#search-space-hint slide up and out while #search-notification
    // slides up into view (both driven by the same .notifying toggle — see globals.css), (3) once
    // settled, a slow continuous pulse plays until the exit sequence begins.
    function showNotification(config) {
        currentNotification = config;
        const seq = ++notificationSeq;
        searchInputWrap.classList.toggle('notification-grows', !!config.grows);

        if (config.imageUrl) notifImageEl.src = config.imageUrl;
        else notifImageEl.removeAttribute('src');
        notifTextEl.textContent = config.message || '';
        // The enter-arrow suffix mirrors #search-space-hint's own "Enter" pill (same size/color —
        // see globals.css) so the button visually reads as "press Enter to do this", not a
        // separately-styled call-to-action button.
        notifActionBtn.textContent = config.actionLabel ? `${config.actionLabel} ↵` : '';
        notifActionBtn.classList.toggle('visible', !!config.actionLabel);

        searchInputWrap.classList.add('notif-flash');
        setTimeout(() => {
            if (seq !== notificationSeq) return; // superseded mid-flash (e.g. dismissed already)
            searchInputWrap.classList.remove('notif-flash');
            searchInputWrap.classList.add('notifying', 'notif-clipping');
            updateSearchSpaceHint(); // starts its slide-out now, in lockstep with #search-input
            setTimeout(() => {
                if (seq !== notificationSeq) return;
                searchInputWrap.classList.add('notif-pulse-slow');
            }, NOTIF_SLIDE_MS);
        }, NOTIF_FLASH_MS);

        clearTimeout(notificationTimer);
        const durationMs = config.durationMs || NOTIFICATION_DEFAULT_DURATION_MS;
        if (!config.sticky) notificationTimer = setTimeout(dismissCurrentNotification, computeNotificationDismissDelay(durationMs));
    }
    // Click OR Enter (see the keydown handler below) — a no-op if this notification has no
    // action configured, so a stray Enter press can't dismiss a sticky plain notification.
    function runNotificationAction() {
        if (!currentNotification || !currentNotification.actionLabel) return;
        const cb = currentNotification.onAction;
        dismissCurrentNotification();
        if (cb) cb();
    }
    // Exit: (1) the border flashes 2 quick pulses again while the notification is still fully on
    // screen, (2) it slides back down and away while #search-input/#search-space-hint slide back
    // into place (the exact reverse of showNotification's entrance) — only once that settles is
    // the queue allowed to advance to the next notification, so a back-to-back pair never
    // overlaps or snaps between each other mid-animation.
    function dismissCurrentNotification() {
        if (!currentNotification) return;
        clearTimeout(notificationTimer);
        currentNotification = null;
        const seq = ++notificationSeq; // supersedes any pending entrance-sequence timeouts
        searchInputWrap.classList.remove('notif-pulse-slow');
        searchInputWrap.classList.add('notif-flash');
        setTimeout(() => {
            if (seq !== notificationSeq) return;
            // 'notifying' comes off now, flipping the reverse slide's target transform (see
            // .notif-clipping's own comment in globals.css) — but 'notif-clipping' deliberately
            // stays on through that whole slide so the content stays clipped to the box the entire
            // time, instead of spending its last 0.3s visible outside the border.
            searchInputWrap.classList.remove('notif-flash', 'notifying');
            updateSearchSpaceHint(); // may need to reappear now that the box is back to normal — slides back in alongside #search-input
            setTimeout(() => {
                if (seq !== notificationSeq) return;
                searchInputWrap.classList.remove('notification-grows', 'notif-clipping');
                lastNotificationCloseTime = Date.now();
                tryShowNextNotification();
            }, NOTIF_SLIDE_MS);
        }, NOTIF_FLASH_MS);
    }
    searchInput.addEventListener('blur', tryShowNextNotification);
    document.addEventListener('keydown', (e) => {
        if (!currentNotification) return;
        const active = document.activeElement;
        // Some OTHER field being actively edited (a waypoint rename, a table cell, etc.) wins —
        // Enter/Escape apply to that as usual rather than surprise-triggering the notification
        // sitting in the background.
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (isEditingText) return;
        if (e.key === 'Enter') { e.preventDefault(); runNotificationAction(); }
        // No dismiss button exists, so this is the only way to close a notification without
        // triggering its action — always just hides it, no callback (dismissCurrentNotification
        // itself never calls one), which is exactly what every real notification wants here.
        else if (e.key === 'Escape') { e.preventDefault(); dismissCurrentNotification(); }
    });
    // Notifications only ever DISPLAY while the tab is actually visible (see
    // tryShowNextNotification) — this is what makes that true both ways: hides/holds new ones the
    // instant the tab is backgrounded (another tab, another app, screen lock, ...), and freezes
    // the CURRENTLY showing one's auto-dismiss timer too, so nothing can silently finish counting
    // down while nobody's there to see it. Coming back re-arms it at its full duration (not
    // whatever was left) and then tries to advance the queue, so anything that piled up while away
    // still comes through one at a time from here rather than all at once.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (currentNotification && !currentNotification.sticky) {
                const durationMs = currentNotification.durationMs || NOTIFICATION_DEFAULT_DURATION_MS;
                clearTimeout(notificationTimer);
                notificationTimer = setTimeout(dismissCurrentNotification, computeNotificationDismissDelay(durationMs));
            }
            tryShowNextNotification();
        } else {
            clearTimeout(notificationTimer);
        }
    });

    // Faint "Enter" pill on the right of the search box — visible only while it's both empty and
    // NOT focused (the hint is for the "press Enter to open it" case; once it's actually focused
    // that action no longer applies — pressing Enter at that point closes it instead, see the
    // search-input keydown handler further down). Called from handleSearchInput/clearSearch (on
    // every value change) and on focus/blur, plus once here for the correct state on first load
    // (the markup itself defaults to visible for a flash-free first paint, but that default is
    // only actually right if the box starts empty and unfocused).
    function updateSearchSpaceHint() {
        if (!searchSpaceHint || !searchInput) return;
        const focused = document.activeElement === searchInput;
        const notifying = searchInputWrap.classList.contains('notifying');
        searchSpaceHint.classList.toggle('visible', !focused && !notifying && searchInput.value.trim() === '');
    }
    updateSearchSpaceHint();

    // #search-input is a <textarea> that grows line by line as typed text wraps, up to 4 lines
    // (100px) — or 3 text lines + the card-context pill's own line (80px) when cards are
    // attached, since the pill counts toward the same 4-line budget. Repositions #search-dropdown
    // to stay glued 7px below the input at whatever height it's currently at.
    function autoGrowSearchInput() {
        // The pill (when shown) claims its own line by pushing padding-bottom from 10px to 30px
        // (see #search-input.has-pill in globals.css) — that alone shrinks the available TEXT
        // budget from 4 lines to 3 within the very same 100px overall cap (10 top pad + 3*20 text
        // + 30 bottom pad/pill = 100, vs. 10 + 4*20 + 10 = 100 with no pill), so the cap itself
        // never changes, only the minimum (1 empty text line, plus the pill's own line when
        // present).
        const hasPill = typeof searchCardContext !== 'undefined' && searchCardContext.length > 0;
        const minH = hasPill ? 60 : 40;
        let h;
        // With no typed value, the box is always exactly 1 (text) line tall — measuring
        // scrollHeight here would instead reflect the animated placeholder's current wrapped
        // shape (a <textarea>'s placeholder wraps like real content when the value is empty),
        // which has nothing to do with what the user has actually typed.
        if (!searchInput.value) {
            h = minH;
        } else {
            searchInput.style.height = 'auto';
            // #search-input itself is borderless now (the wrap owns the border — see globals.css),
            // so scrollHeight's content+padding measurement already matches what style.height
            // (box-sizing:border-box) needs — no border-compensation offset required.
            h = Math.max(minH, Math.min(100, searchInput.scrollHeight));
        }
        searchInput.style.height = h + 'px';
        searchDropdown.style.top = (searchInputWrap.offsetHeight + 7) + 'px';
        // style.height='auto' above forces a reflow that resets scrollTop to 0 — once content
        // no longer fits (capped at 100px), that leaves the caret's actual line scrolled out of
        // view after every keystroke. Pin back to the bottom, where the caret always is (typing
        // never happens mid-text via a mouse click without also refocusing/reflowing here).
        if (searchInput.scrollHeight > searchInput.clientHeight) searchInput.scrollTop = searchInput.scrollHeight;
    }

    // ---------- Card context: cards dragged into the search box as AI context ----------
    // Persists across searches (unlike the text input, which clears after every search) so
    // follow-up questions about the same attached cards don't require redragging — only cleared
    // by the global outside-click handler, alongside every other ephemeral search-state reset.
    let searchCardContext = []; // { id, snapshot }
    let searchCardConnections = []; // { fromId, toId } — copied across from the live folder for
    // any pair that was dragged in together, so a data-mode link between two dragged cards
    // survives into the popup preview.

    function renderSearchCardPill() {
        if (!searchCardPill) return;
        const n = searchCardContext.length;
        searchCardPill.classList.toggle('visible', n > 0);
        searchInput.classList.toggle('has-pill', n > 0);
        searchCardPillLabel.textContent = n > 0 ? `${n} card${n === 1 ? '' : 's'}` : '';
        autoGrowSearchInput();
    }

    // Adds `ids` (a drag gesture's card ids — a single card or a multi-selection) to the
    // persistent card-context set. Each is snapshotted and sanitized exactly like a
    // marketplace/chat export (see sanitizeFlashcardSnapshot) using the OTHER ids in this same
    // call as the batch, so a flashcard dragged together with its source keeps real data, but
    // dragged alone it's generic-ified — same source-of-truth rule either way. Connections
    // between two cards that are both part of this drag are copied across too, so the link
    // itself (not just the two cards) survives into the popup preview.
    function addCardsToSearchContext(ids) {
        const folder = appState.folders[appState.currentFolderId];
        if (!folder) return;
        ids.forEach(id => {
            if (searchCardContext.some(c => c.id === id)) return;
            const it = findItemById(id);
            if (!it) return;
            searchCardContext.push({ id, snapshot: sanitizeFlashcardSnapshot(snapshotItem(it), ids) });
        });
        const conns = ensureConnections(folder);
        conns.forEach(c => {
            if (!ids.includes(c.fromId) || !ids.includes(c.toId)) return;
            if (searchCardConnections.some(sc => sc.fromId === c.fromId && sc.toId === c.toId)) return;
            searchCardConnections.push({ fromId: c.fromId, toId: c.toId });
        });
        renderSearchCardPill();
    }

    function removeSearchCardContextItem(id) {
        searchCardContext = searchCardContext.filter(c => c.id !== id);
        searchCardConnections = searchCardConnections.filter(c => c.fromId !== id && c.toId !== id);
        renderSearchCardPill();
        if (!searchCardContext.length) { closeSearchCardsModal(); return; }
        if (document.getElementById('search-cards-modal-overlay').classList.contains('open')) openSearchCardsModal();
    }

    // The pill's hover-reveal "✕" — clears every attached card at once, unlike
    // removeSearchCardContextItem which only drops one.
    function clearSearchCardContext() {
        searchCardContext = [];
        searchCardConnections = [];
        renderSearchCardPill();
        closeSearchCardsModal();
    }

    // Packs a flat set of snapshots into a neat grid (ceil(sqrt(n)) columns, uniform spacing
    // derived from the largest card's own w/h) purely for the popup preview — mutates copies
    // only, never the stored snapshot's original x/y (which is meaningless outside its original
    // canvas anyway) or anything on the live canvas.
    function layoutSnapshotsInGrid(snapshots) {
        const n = snapshots.length;
        const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
        const maxW = Math.max(100, ...snapshots.map(s => s.w || 100));
        const maxH = Math.max(60, ...snapshots.map(s => s.h || 60));
        const gap = 40;
        return snapshots.map((s, i) => Object.assign({}, s, {
            x: (i % cols) * (maxW + gap),
            y: Math.floor(i / cols) * (maxH + gap),
        }));
    }

    function openSearchCardsModal() {
        if (!searchCardContext.length) return;
        const laidOut = layoutSnapshotsInGrid(searchCardContext.map(c => c.snapshot));
        const body = document.getElementById('search-cards-modal-body');
        body.innerHTML = '';
        body.appendChild(renderInlineCanvas(laidOut, false, searchCardConnections, (id) => removeSearchCardContextItem(id)));
        document.getElementById('search-cards-modal-overlay').classList.add('open');
    }
    function closeSearchCardsModal() {
        document.getElementById('search-cards-modal-overlay').classList.remove('open');
    }

export { addCardsToSearchContext, autoGrowSearchInput, clearSearchCardContext, closeSearchCardsModal, currentNotification, filterShelfRows, handleShelfSourceRowClick, openSearchCardsModal, pushNotification, renderFilterHTML, renderShelfHTML, renderStopwatchHTML, runNotificationAction, searchCardConnections, searchCardContext, searchDictionary, searchDotbotAnswer, searchDropdown, searchExamples, searchImageResult, searchInput, searchInputWrap, searchRecommended, searchResults, searchSpinner, searchSuggestions, searchTranslation, setFilterMode, shelfSelectSession, startRenameShelfName, startRenameShelfSourceRow, swCurrentElapsedMs, swFormatTime, swTogglePause, swToggleRun, toggleFilterTag, updateSearchSpaceHint };
