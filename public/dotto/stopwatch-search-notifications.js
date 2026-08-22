import { escapeHtml } from './ai-assistant-suggestions.js';
import { appState } from './core-state.js';
import { ensureConnections, folderIdForConnectedSource, folderTitleForConnectedSource } from './drawing-connections.js';
import { syncCanvasCollabTitle } from './friends-presence.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { broadcastEditingState, findItemById, renderInlineCanvas, sanitizeFlashcardSnapshot, snapshotItem } from './live-presence.js';
import { diffRatings } from './srs-connections-core.js';
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
    function handleShelfSourceRowClick(rowEl, sourceItemId) {
        if (appState.shelfRowClickTimer) { clearTimeout(appState.shelfRowClickTimer); appState.shelfRowClickTimer = null; return; }
        appState.shelfRowClickTimer = setTimeout(() => {
            appState.shelfRowClickTimer = null;
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
    // (Rendering itself moved to FilterCard.jsx, app/dotto/ — a real Component now, no mini-
    // preview elsewhere calls this kind, unlike Shelf/Stopwatch/Flashcard/Typeright, so there's no
    // renderFilterHTML left to keep around.)
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

    // ---------- Notifications ----------
    // Generic engine — notifications queue up and are shown one at a time as a pill sliding down
    // into the top bar's own slot (top:20px, centered), while #top-bar-center (breadcrumb/back-
    // forward/collaborators) slides up and out of view to make room for it — the two swap places
    // via one shared .notif-active class (see #notification-pill/#top-bar-center.notif-active,
    // globals.css). Optional action button triggerable by click OR Enter. Non-sticky ones
    // auto-dismiss after `durationMs`; sticky ones need an explicit dismiss (Escape, or the action
    // button itself).
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
    //   durationMs,       // default 5000 (5 seconds) — how long the pill stays fully visible
    //                     // before it starts sliding away (the slide itself, NOTIF_SLIDE_MS, comes
    //                     // on top of this, not carved out of it)
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
    // No per-call sequence guard needed here (unlike the old search-box version of this) —
    // tryShowNextNotification's own currentNotification check already makes showNotification
    // uncallable while one's already displaying, and dismissCurrentNotification nulls
    // currentNotification synchronously as its very first act, so a second concurrent call (e.g.
    // Escape landing the same tick the auto-dismiss timer fires) is already a clean no-op via that
    // same guard.

    function pushNotification(config) {
        appState.notificationQueue.push(config);
        tryShowNextNotification();
    }
    function tryShowNextNotification() {
        if (appState.currentNotification || !appState.notificationQueue.length) return;
        // Held while the tab isn't actually visible (another tab/app, backgrounded, screen
        // locked) — retried by the visibilitychange listener below the moment it's visible
        // again, so queued notifications come through one at a time from there rather than
        // firing unseen while away.
        if (document.visibilityState !== 'visible') return;
        if (appState.lastNotificationCloseTime) {
            const elapsed = Date.now() - appState.lastNotificationCloseTime;
            if (elapsed < appState.NOTIFICATION_QUEUE_GAP_MS) {
                // Re-checks everything above (visibility, remaining gap) once it fires, rather
                // than assuming this is still the right moment — self-correcting if the tab gets
                // backgrounded or the gap gets pushed out again in the meantime.
                setTimeout(tryShowNextNotification, appState.NOTIFICATION_QUEUE_GAP_MS - elapsed);
                return;
            }
        }
        showNotification(appState.notificationQueue.shift());
    }
    function showNotification(config) {
        appState.currentNotification = config;
        // Content itself is real React state now (see app/dotto/NotificationBar.jsx) — the
        // enter-arrow suffix on a configured action label is built there, not here.
        window.__setNotificationContent(config);
        appState.topBarCenter.classList.add('notif-active');
        appState.notificationPill.classList.add('notif-active');
        clearTimeout(appState.notificationTimer);
        if (!config.sticky) {
            const durationMs = config.durationMs || appState.NOTIFICATION_DEFAULT_DURATION_MS;
            appState.notificationTimer = setTimeout(dismissCurrentNotification, durationMs);
        }
    }
    // Click OR Enter (see the keydown handler below) — a no-op if this notification has no
    // action configured, so a stray Enter press can't dismiss a sticky plain notification.
    function runNotificationAction() {
        if (!appState.currentNotification || !appState.currentNotification.actionLabel) return;
        const cb = appState.currentNotification.onAction;
        dismissCurrentNotification();
        if (cb) cb();
    }
    // Reverse of showNotification — #top-bar-center slides back down into view while
    // #notification-pill slides back up and away. Only once that settles (NOTIF_SLIDE_MS later) is
    // the queue allowed to advance to the next notification, so a back-to-back pair never overlaps
    // or snaps between each other mid-animation.
    function dismissCurrentNotification() {
        if (!appState.currentNotification) return;
        clearTimeout(appState.notificationTimer);
        appState.currentNotification = null;
        appState.topBarCenter.classList.remove('notif-active');
        appState.notificationPill.classList.remove('notif-active');
        setTimeout(() => {
            appState.lastNotificationCloseTime = Date.now();
            tryShowNextNotification();
        }, appState.NOTIF_SLIDE_MS);
    }
    document.addEventListener('keydown', (e) => {
        if (!appState.currentNotification) return;
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
            if (appState.currentNotification && !appState.currentNotification.sticky) {
                const durationMs = appState.currentNotification.durationMs || appState.NOTIFICATION_DEFAULT_DURATION_MS;
                clearTimeout(appState.notificationTimer);
                appState.notificationTimer = setTimeout(dismissCurrentNotification, durationMs);
            }
            tryShowNextNotification();
        } else {
            clearTimeout(appState.notificationTimer);
        }
    });

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
        const hasPill = typeof appState.searchCardContext !== 'undefined' && appState.searchCardContext.length > 0;
        const minH = hasPill ? 60 : 40;
        let h;
        // With no typed value, the box is always exactly 1 (text) line tall — measuring
        // scrollHeight here would instead reflect the animated placeholder's current wrapped
        // shape (a <textarea>'s placeholder wraps like real content when the value is empty),
        // which has nothing to do with what the user has actually typed.
        if (!appState.searchInput.value) {
            h = minH;
        } else {
            appState.searchInput.style.height = 'auto';
            // #search-input itself is borderless now (the wrap owns the border — see globals.css),
            // so scrollHeight's content+padding measurement already matches what style.height
            // (box-sizing:border-box) needs — no border-compensation offset required.
            h = Math.max(minH, Math.min(100, appState.searchInput.scrollHeight));
        }
        appState.searchInput.style.height = h + 'px';
        // #search-dropdown is a normal flex-flow sibling now, not absolutely positioned against
        // the wrap's height (see globals.css) — it just follows in flow, no synced top needed.
        // style.height='auto' above forces a reflow that resets scrollTop to 0 — once content
        // no longer fits (capped at 100px), that leaves the caret's actual line scrolled out of
        // view after every keystroke. Pin back to the bottom, where the caret always is (typing
        // never happens mid-text via a mouse click without also refocusing/reflowing here).
        if (appState.searchInput.scrollHeight > appState.searchInput.clientHeight) appState.searchInput.scrollTop = appState.searchInput.scrollHeight;
    }

    // ---------- Card context: cards dragged into the search box as AI context ----------
    // Persists across searches (unlike the text input, which clears after every search) so
    // follow-up questions about the same attached cards don't require redragging — only cleared
    // by the global outside-click handler, alongside every other ephemeral search-state reset.
 // { id, snapshot }
 // { fromId, toId } — copied across from the live folder for
    // any pair that was dragged in together, so a data-mode link between two dragged cards
    // survives into the popup preview.

    function renderSearchCardPill() {
        if (!appState.searchCardPill) return;
        const n = appState.searchCardContext.length;
        appState.searchCardPill.classList.toggle('visible', n > 0);
        appState.searchInput.classList.toggle('has-pill', n > 0);
        appState.searchCardPillLabel.textContent = n > 0 ? `${n} card${n === 1 ? '' : 's'}` : '';
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
            if (appState.searchCardContext.some(c => c.id === id)) return;
            const it = findItemById(id);
            if (!it) return;
            appState.searchCardContext.push({ id, snapshot: sanitizeFlashcardSnapshot(snapshotItem(it), ids) });
        });
        const conns = ensureConnections(folder);
        conns.forEach(c => {
            if (!ids.includes(c.fromId) || !ids.includes(c.toId)) return;
            if (appState.searchCardConnections.some(sc => sc.fromId === c.fromId && sc.toId === c.toId)) return;
            appState.searchCardConnections.push({ fromId: c.fromId, toId: c.toId });
        });
        renderSearchCardPill();
    }

    function removeSearchCardContextItem(id) {
        appState.searchCardContext = appState.searchCardContext.filter(c => c.id !== id);
        appState.searchCardConnections = appState.searchCardConnections.filter(c => c.fromId !== id && c.toId !== id);
        renderSearchCardPill();
        if (!appState.searchCardContext.length) { closeSearchCardsModal(); return; }
        if (document.getElementById('search-cards-modal-overlay').classList.contains('open')) openSearchCardsModal();
    }

    // The pill's hover-reveal "✕" — clears every attached card at once, unlike
    // removeSearchCardContextItem which only drops one.
    function clearSearchCardContext() {
        appState.searchCardContext = [];
        appState.searchCardConnections = [];
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
        if (!appState.searchCardContext.length) return;
        const laidOut = layoutSnapshotsInGrid(appState.searchCardContext.map(c => c.snapshot));
        const body = document.getElementById('search-cards-modal-body');
        body.innerHTML = '';
        body.appendChild(renderInlineCanvas(laidOut, false, appState.searchCardConnections, (id) => removeSearchCardContextItem(id)));
        document.getElementById('search-cards-modal-overlay').classList.add('open');
    }
    function closeSearchCardsModal() {
        document.getElementById('search-cards-modal-overlay').classList.remove('open');
    }

export { addCardsToSearchContext, autoGrowSearchInput, clearSearchCardContext, closeSearchCardsModal, filterShelfRows, handleShelfSourceRowClick, openSearchCardsModal, pushNotification, renderShelfHTML, renderStopwatchHTML, runNotificationAction, setFilterMode, shelfSelectSession, startRenameShelfName, startRenameShelfSourceRow, swCurrentElapsedMs, swFormatTime, swTogglePause, swToggleRun, toggleFilterTag };

// Not an inline-HTML onclick target (see window-bridge.js's own header comment for why those
// live there instead) — this is the first real React component (app/dotto/PricingOverlay.jsx,
// Phase 2 increment 1) needing to call into a still-vanilla subsystem, and app/ can't import
// public/dotto/*.js directly (same constraint window.__dottoSupabase/__DOTTO_USER__ solve in the
// other direction — see app/dotto-app.jsx). More of these will likely accumulate here as more
// subsystems migrate to React while still depending on notifications.
window.pushNotification = pushNotification;

// Same React → vanilla bridge, `__`-prefixed per the convention established in cards-misc.js
// (shortUrl/toEmbeddableUrl) once more than one of these existed — used by StopwatchCard.jsx.
// swTick (history-autosave.js) still directly patches a running stopwatch's .sw-time textContent
// while the user is mid-edit elsewhere (skipping render() entirely so it doesn't yank focus) —
// that keeps working unchanged against a React-rendered .sw-time node: the next real render always
// recomputes the same formula from the same live it.swElapsedMs/it.swLastResumeAt, so React's diff
// just re-confirms whatever the direct patch already showed, never fights or reverts it.
window.__swFormatTime = swFormatTime;
window.__swCurrentElapsedMs = swCurrentElapsedMs;
