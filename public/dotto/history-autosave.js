import { clearSearch } from './ai-assistant-suggestions.js';
import { cutSelectedCards, pasteClipboardCards } from './copy-paste.js';
import { appState, canvas, canvasContextMenu, contextMenu, dotLayer, recomputeTopCardZIndex, supabase, world, zoomFill, zoomThumb, zoomTrack } from './core-state.js';
import { resolveTableForEdit } from './drawing-connections.js';
import { generateGlobalId } from './global-ids.js';
import { resolveSharedFolderChain } from './hamburger-collab.js';
import { broadcastCursorPositionThrottled, closeSharedCanvasView, ensureCanvasPresenceChannel, findItemById, queueSyncDiff, repositionAllRemoteCursors } from './live-presence.js';
import { closeAllPanels } from './panels-hamburger.js';
import { closeDotbotUpgradeModal, closePricingOverlay } from './profile-achievements-pricing.js';
import { stripSharedFolderIds } from './shared-canvases-outline.js';
import { closeCellTagPicker } from './source-tags-ai.js';
import { cancelAddingKind, finishPenPolyline } from './srs-connections-core.js';
import { closeSearchCardsModal, swCurrentElapsedMs, swFormatTime } from './stopwatch-search-notifications.js';
import { closeUploadPopup } from './upload-popup.js';
import { centerOnContent, render } from './waypoints-render-loop.js';


    // ---------- Undo / Redo ----------

    // ---------- Stopwatch live ticking ----------
    function ensureSwTicking() {
        const hasRunning = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.some(i => i.kind === 'stopwatch' && i.swRunning && !i.swPaused);
        if (hasRunning && !appState.swTickInterval) {
            appState.swTickInterval = setInterval(swTick, 1000);
        } else if (!hasRunning && appState.swTickInterval) {
            clearInterval(appState.swTickInterval); appState.swTickInterval = null;
        }
    }
    function swTick() {
        if (!appState.folders[appState.currentFolderId]) return;
        // Always patch every running stopwatch's own digits directly first — cheap, and doesn't
        // depend on the render() call below actually landing visually on this exact tick (called
        // from a plain setInterval, outside any React event, unlike a real user click on Start/
        // Stop — see StopwatchCard.jsx). Previously this direct patch only ran while
        // appState.currentEditingEl was set (to avoid yanking focus from whatever the user was
        // typing elsewhere); it's unconditional now since it's just as correct — and more
        // reliable — the rest of the time too.
        appState.folders[appState.currentFolderId].items.forEach(it => {
            if (it.kind === 'stopwatch' && it.swRunning) {
                const el = document.getElementById('item-' + it.id);
                const timeEl = el && el.querySelector('.sw-time');
                if (timeEl) timeEl.textContent = swFormatTime(swCurrentElapsedMs(it));
            }
        });
        // Don't yank focus away from whatever text the user is editing — a full render() would
        // rebuild that card's DOM out from under an in-progress edit (see renderLegacyCardBody's
        // title/note/watermark branches). Still needed for kinds connected to this stopwatch via
        // propagateCanvasStreams (Statcard, Shelf) to see fresh data live while it runs, so this
        // isn't skipped outright the rest of the time, just deferred until nothing's being edited.
        if (appState.currentEditingEl) return;
        render();
    }

    function saveSnapshot() {
        appState.undoStack.push(JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }));
        if (appState.undoStack.length > 60) appState.undoStack.shift();
        appState.redoStack = [];
    }

    // ---------- Workspace autosave ----------
    // Persists the same { folders, idCounter } shape saveSnapshot() already
    // uses for undo, so loading it back is just the undo/redo restore path
    // reused at startup. Debounced so continuous typing doesn't hammer
    // Supabase on every keystroke; flushed immediately on tab hide/close so
    // "close the window" can't lose more than the debounce window.
    function scheduleWorkspaceSave() {
        if (!supabase || !appState.currentUser.id) return;
        // Live presence/content-sync — see the "Live canvas presence" section further down. This,
        // not render(), is the real universal "something changed" signal: render() itself always
        // calls this first, but a lot of mutations (committing a text edit on blur, rating a
        // flashcard, etc.) call ONLY this, never render() — so anchoring on render() alone silently
        // missed every one of those for sync purposes, even though the change was saved/undoable
        // fine locally. This is a strict superset of what render()-anchoring caught.
        const folderObj = appState.folders[appState.currentFolderId];
        if (folderObj) { ensureCanvasPresenceChannel(); queueSyncDiff(folderObj); }
        clearTimeout(appState.workspaceSaveTimer);
        appState.workspaceSaveTimer = setTimeout(saveWorkspaceNow, 800);
    }
    async function saveWorkspaceNow() {
        clearTimeout(appState.workspaceSaveTimer);
        if (!supabase || !appState.currentUser.id) return;

        // shared:owner:folderId entries (see openSharedCanvas) are someone else's canvas fetched
        // on demand, not this user's own — they must never be written into this user's own
        // workspace row, only patched back to the OWNER's via update_shared_folder below. While
        // one is open, the "resume here" fields also fall back to wherever this user's own
        // navigation was just before entering it (preSharedViewState), not the shared key itself,
        // since that key wouldn't mean anything on a fresh load without re-fetching. public:
        // entries (openPublicCanvas, shared-canvases-outline.js) get the same exclusion but for a
        // stronger reason: there's no update_public_folder counterpart at all to patch one back
        // to — a public view is read-only and never persisted anywhere, so it must never even be
        // attempted here.
        const localFolders = {};
        for (const id in appState.folders) { if (!id.startsWith('shared:') && !id.startsWith('public:')) localFolders[id] = appState.folders[id]; }
        // Backfills globalId (global-ids.js) on any local folder that doesn't have one yet — every
        // canvas/source created through add()/deepCloneItem already gets one immediately, but the
        // built-in 'root' canvas (declared directly in core-state.js, which can't import this —
        // see its own comment on why) and anything saved before this feature existed never did.
        // Mutates the same objects localFolders already points at, so this doubles as fixing
        // appState.folders itself, not just what gets sent below.
        for (const id in localFolders) { if (!localFolders[id].globalId) localFolders[id].globalId = generateGlobalId(); }
        const resumeFolderId = appState.preSharedViewState ? appState.preSharedViewState.currentFolderId : appState.currentFolderId;
        const resumeStack = appState.preSharedViewState ? appState.preSharedViewState.historyStack : appState.historyStack;
        const resumeIndex = appState.preSharedViewState ? appState.preSharedViewState.historyIndex : appState.historyIndex;
        // A shared canvas isn't reachable from resumeFolderId alone (it's someone else's tree,
        // fetched on demand — see the comment above) — so a refresh/reload used to always silently
        // drop back to wherever this user's own navigation was just before entering, kicking them
        // out of the collaboration entirely. Persisting just enough to re-fetch and re-enter it
        // (see loadWorkspace's own resume logic, which walks this back via
        // resolveSharedFolderChain) fixes that — this doesn't replace resumeFolderId/resumeStack
        // above, which still correctly describe where to land if the shared view can't be resumed
        // for any reason (e.g. access was revoked in the meantime).
        const activeShared = appState.folders[appState.currentFolderId];
        const lastSharedView = (activeShared && activeShared.isSharedView)
            ? { ownerId: activeShared.sharedOwnerId, folderId: activeShared.sharedRemoteFolderId }
            : null;

        const { error } = await supabase.from('workspaces').upsert({
            user_id: appState.currentUser.id,
            // historyStack/historyIndex are saved alongside folders so the full
            // breadcrumb trail (root -> ... -> current folder) survives a reload —
            // saving only the leaf folder id previously made whatever nested
            // canvas you were last in look like the root on reload. tx/ty/scale (the current
            // pan/zoom, always live/up to date on these module-level vars) ride along the same
            // way — panning/zooming alone doesn't call scheduleWorkspaceSave (only render() does,
            // to avoid saving on every single drag/wheel frame), but every save that DOES happen
            // for any other reason captures wherever the camera currently is, and pagehide/
            // visibilitychange below call this directly so a plain refresh or tab close always
            // gets one in first. tabs/activeTabId/nextTabId (per explicit request that tabs
            // survive a reload) are saved as-is, unlike resumeFolderId/resumeStack/resumeIndex
            // above — no special-casing for a currently-open shared canvas, since any tab whose own
            // folderId turns out to be unresolvable on the next load (a shared:/public: key that
            // isn't fetched by default) just falls back to wherever the reload actually lands
            // instead, see loadWorkspace's own validation.
            data: { folders: localFolders, idCounter: appState.idCounter, historyStack: resumeStack, historyIndex: resumeIndex, tx: appState.tx, ty: appState.ty, scale: appState.scale, lastSharedView, tabs: appState.tabs, activeTabId: appState.activeTabId, nextTabId: appState.nextTabId },
            current_folder_id: resumeFolderId,
            updated_at: new Date().toISOString()
        });
        if (error) console.error('[workspace] save failed:', error);

        // Lazy global-id registration (global-ids.js) — every local folder, every save. Simpler
        // than tracking which ones already round-tripped successfully, at the cost of one cheap
        // upsert-per-folder on every save cycle; register_global_items batches them into a single
        // RPC call regardless of how many there are. Best-effort: a failure here (including a
        // genuine cross-owner id collision — see the migration's own comment) doesn't block or
        // roll back the real workspace save above, it just retries again next cycle with whatever
        // globalId is on the folder at that point.
        const globalItems = Object.keys(localFolders).map(id => ({
            global_id: localFolders[id].globalId,
            folder_id: id,
            kind: localFolders[id].isSource ? 'source' : 'canvas',
            title: localFolders[id].title || '',
        }));
        if (globalItems.length) {
            const { error: globalItemsErr } = await supabase.rpc('register_global_items', { p_items: globalItems });
            // Spelled out explicitly rather than logging the PostgrestError object directly — its
            // own useful fields (message/code/details/hint) don't reliably show up that way, see
            // ensureSharedFolderLoaded's identical comment (shared-canvases-outline.js). A "does
            // not exist" message here almost always means the 20260812_add_global_items.sql
            // migration hasn't been applied to the actual Supabase project yet, not a real bug.
            if (globalItemsErr) console.error(`[global-ids] registration failed: message=${globalItemsErr.message} code=${globalItemsErr.code} details=${globalItemsErr.details} hint=${globalItemsErr.hint}`);
        }

        // A currently-open shared canvas is saved separately — patches just that one folder in
        // the OWNER's own workspace row (see update_shared_folder), never this user's own.
        const openShared = appState.folders[appState.currentFolderId];
        if (openShared && openShared.isSharedView) {
            const { isSharedView, sharedOwnerId, sharedRemoteFolderId, id, ...folderData } = openShared;
            // The owner's canonical storage always uses bare, un-namespaced folder ids — this
            // local folders dict's shared: wrapping (see injectSharedFolder) must never leak back
            // into it, or it compounds into a permanently corrupt double-wrapped id on the next
            // fetch (see namespaceSharedFolderIds/stripSharedFolderIds).
            folderData.items = stripSharedFolderIds(folderData.items);
            const { error: sharedErr } = await supabase.rpc('update_shared_folder', {
                p_owner_id: sharedOwnerId, p_folder_id: sharedRemoteFolderId, p_new_folder_data: folderData,
            });
            if (sharedErr) console.error('[collab] failed to save shared canvas:', sharedErr);
        }
    }
    // Returns true if a saved camera position (tx/ty/scale) was restored — the caller should
    // skip its own default centerOnContent() in that case, the same way applyFolderView already
    // prefers a folder's own saved lastView over re-centering when one exists.
    async function loadWorkspace() {
        if (!supabase || !appState.currentUser.id) return false;
        const { data, error } = await supabase
            .from('workspaces')
            .select('data, current_folder_id')
            .eq('user_id', appState.currentUser.id)
            .maybeSingle();
        if (error) { console.error('[workspace] load failed:', error); return false; }
        if (!data) return false; // first-ever login — keep the built-in starter content
        appState.folders = data.data.folders;
        appState.idCounter = data.data.idCounter;
        recomputeTopCardZIndex();

        const savedStack = data.data.historyStack;
        if (Array.isArray(savedStack) && savedStack.length && savedStack[0] === 'root' &&
            savedStack.every(id => appState.folders[id]) &&
            Number.isInteger(data.data.historyIndex) && data.data.historyIndex >= 0 && data.data.historyIndex < savedStack.length) {
            appState.historyStack = savedStack;
            appState.historyIndex = data.data.historyIndex;
            appState.currentFolderId = appState.historyStack[appState.historyIndex];
        } else if (data.current_folder_id && appState.folders[data.current_folder_id]) {
            // Older save made before historyStack was persisted — best effort:
            // still show root as root rather than treating the leaf as root.
            appState.currentFolderId = data.current_folder_id;
            appState.historyStack = appState.currentFolderId === 'root' ? ['root'] : ['root', appState.currentFolderId];
            appState.historyIndex = appState.historyStack.length - 1;
        }

        // Resume a collaboration session across a reload instead of it silently kicking the user
        // back to their own canvas — currentFolderId/historyStack/historyIndex above are already
        // this user's own correct resume position at this point, exactly what preSharedViewState
        // needs to fall back to if the shared view can't be re-entered for any reason (e.g. access
        // was revoked while away). Re-walks the whole chain (not just the leaf folder) via the
        // same helper a cross-user waypoint jump uses, so any nested position is restored exactly,
        // not just the collaboration's top level.
        if (data.data.lastSharedView && data.data.lastSharedView.ownerId && data.data.lastSharedView.folderId) {
            const { ownerId, folderId } = data.data.lastSharedView;
            appState.preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
            const localKeys = await resolveSharedFolderChain(ownerId, folderId);
            if (localKeys) {
                appState.currentFolderId = localKeys[localKeys.length - 1];
                appState.historyStack = localKeys;
                appState.historyIndex = localKeys.length - 1;
            } else {
                appState.preSharedViewState = null; // couldn't resume — stay on this user's own canvas instead
            }
        }

        // Tabs (public/dotto/shared-canvases-outline.js's addTab/switchTab/closeTab) — per explicit
        // request that they survive a reload. Validated against appState.folders as it stands
        // AFTER the shared-canvas resume block above (not right after the plain `data.data.folders`
        // assignment near the top) so a tab pointing into an actively-resumed shared chain still
        // validates correctly: any tab whose own folderId isn't currently loaded (a shared:/
        // public: key that wasn't re-fetched, or a folder that's since been deleted) falls back to
        // currentFolderId instead of being dropped, so a save with one bad tab never leaves fewer
        // tabs open than before. renderTabsPanel (called from the very first render() after this)
        // force-syncs the ACTIVE tab's own folderId to currentFolderId regardless, so only the
        // OTHER tabs' folderIds actually depend on this validation for correctness.
        // nextTabId is kept safely ahead of every restored tab's own numeric suffix regardless of
        // what was persisted for it, so a freshly-added tab can never collide with a restored one.
        const savedTabs = Array.isArray(data.data.tabs)
            ? data.data.tabs.filter(t => t && typeof t.id === 'string' && typeof t.folderId === 'string')
            : [];
        if (savedTabs.length) {
            appState.tabs = savedTabs.map(t => ({ id: t.id, folderId: appState.folders[t.folderId] ? t.folderId : appState.currentFolderId }));
            appState.activeTabId = appState.tabs.some(t => t.id === data.data.activeTabId) ? data.data.activeTabId : appState.tabs[0].id;
            const maxExistingId = appState.tabs.reduce((max, t) => {
                const match = /^tab-(\d+)$/.exec(t.id);
                return match ? Math.max(max, parseInt(match[1], 10)) : max;
            }, -1);
            appState.nextTabId = Math.max(Number.isInteger(data.data.nextTabId) ? data.data.nextTabId : 0, maxExistingId + 1);
        }
        // Older save made before this feature existed, or corrupted data — appState.tabs already
        // has its own single-default-tab starting value from core-state.js, so there's nothing
        // further to do here; that default just needs its folderId synced, which renderTabsPanel
        // (see above) already handles on the first render() regardless.

        if (typeof data.data.tx === 'number' && typeof data.data.ty === 'number' && typeof data.data.scale === 'number') {
            appState.tx = data.data.tx; appState.ty = data.data.ty; appState.scale = data.data.scale;
            return true;
        }
        return false; // older save made before tx/ty/scale was persisted — nothing to restore
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWorkspaceNow(); });
    window.addEventListener('pagehide', () => saveWorkspaceNow());

    // Paste anywhere in the app (note bodies, table cells, checklist items, titles, etc.) is
    // always plain text — it takes on whatever formatting is already active at the cursor
    // (bold/italic/color from the format bar, or none), never the styling/markup carried over
    // from wherever it was copied from. Scoped to contentEditable only: plain <input>/<textarea>
    // elements already paste as plain text natively, nothing to intercept there.
    document.addEventListener('paste', (e) => {
        const target = e.target.closest ? e.target.closest('[contenteditable="true"]') : null;
        if (!target) return;
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    });
    function afterHistoryChange() {
        if (!appState.folders[appState.currentFolderId]) {
            appState.currentFolderId = 'root';
            appState.historyStack = [appState.currentFolderId];
            appState.historyIndex = 0;
            render();
            centerOnContent();
            return;
        }
        // currentFolderId is still valid, so the navigation path the user actually
        // took to get here is still accurate — leave historyStack/historyIndex
        // alone. Overwriting it with a single-entry stack (the old behavior) made
        // whatever folder you were undoing/redoing inside of look like the root.
        render();
    }
    function undo() {
        if (!appState.undoStack.length) return;
        appState.redoStack.push(JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }));
        const state = JSON.parse(appState.undoStack.pop());
        appState.folders = state.folders; appState.idCounter = state.idCounter;
        afterHistoryChange();
    }
    function redo() {
        if (!appState.redoStack.length) return;
        appState.undoStack.push(JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }));
        const state = JSON.parse(appState.redoStack.pop());
        appState.folders = state.folders; appState.idCounter = state.idCounter;
        afterHistoryChange();
    }
    // Set by openTableCellContextMenu when a source-table cell is right-clicked, so the
    // canvas context menu knows which table/row/column "Delete column"/"Delete row" (and
    // their hover highlights) should act on. Cleared whenever the menu closes or blank
    // canvas space is right-clicked instead.
    function hideCanvasContextMenu() {
        canvasContextMenu.style.display = 'none';
        clearContextDeleteHighlight();
        appState.contextMenuTableCtx = null;
    }
    function showCanvasContextMenu(clientX, clientY) {
        canvasContextMenu.style.display = 'flex';
        canvasContextMenu.style.left = clientX + 'px';
        canvasContextMenu.style.top = clientY + 'px';
        document.getElementById('canvas-ctx-undo').classList.toggle('disabled', appState.undoStack.length === 0);
        document.getElementById('canvas-ctx-redo').classList.toggle('disabled', appState.redoStack.length === 0);
        const hasCellCtx = !!appState.contextMenuTableCtx;
        document.getElementById('canvas-ctx-del-col').style.display = hasCellCtx ? 'block' : 'none';
        document.getElementById('canvas-ctx-del-row').style.display = hasCellCtx ? 'block' : 'none';
    }
    canvas.addEventListener('contextmenu', (e) => {
        // Only show the undo/redo menu when right-clicking blank canvas space
        // (cards handle their own contextmenu and stop it from bubbling here).
        e.preventDefault();
        e.stopPropagation();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        appState.contextMenuTableCtx = null;
        showCanvasContextMenu(e.clientX, e.clientY);
    });
    // Right-clicking a source-table data cell shows the same undo/redo menu plus
    // "Delete column"/"Delete row" for that cell's column/row.
    function openTableCellContextMenu(e, tableId, r, c) {
        e.preventDefault();
        e.stopPropagation();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        appState.contextMenuTableCtx = { tableId, r, c };
        showCanvasContextMenu(e.clientX, e.clientY);
    }
    function clearContextDeleteHighlight() {
        document.querySelectorAll('.ctx-del-highlight').forEach(el => el.classList.remove('ctx-del-highlight'));
    }
    function highlightContextColumn(on) {
        clearContextDeleteHighlight();
        if (!on || !appState.contextMenuTableCtx) return;
        const { tableId, c } = appState.contextMenuTableCtx;
        document.querySelectorAll(`#item-${tableId} .item-table td[data-c="${c}"]`).forEach(td => td.classList.add('ctx-del-highlight'));
        const slot = document.querySelector(`#item-${tableId} .col-name-slot[data-c="${c}"]`);
        if (slot) slot.classList.add('ctx-del-highlight');
    }
    // Matched by [data-origin-table] rather than scoped to "#item-${tableId}" like the column
    // highlight above — a foreign row's tableId is never the id of anything actually in the DOM
    // (the one rendered top-level container is always the LOCAL table's own id), and its data-r
    // can collide with a local row sharing the same index, so both origin and row index are
    // needed together to pick out the right <td>s.
    function highlightContextRow(on) {
        clearContextDeleteHighlight();
        if (!on || !appState.contextMenuTableCtx) return;
        const { tableId, r } = appState.contextMenuTableCtx;
        document.querySelectorAll(`.item-table td[data-origin-table="${tableId}"][data-r="${r}"]`).forEach(td => td.classList.add('ctx-del-highlight'));
    }
    // Removing a column shifts every column after it down by one in the row data. Tags now
    // live on the row as a whole (not per cell), so they're untouched by column changes — no
    // remapping needed here anymore.
    function deleteContextColumn() {
        const ctx = appState.contextMenuTableCtx;
        hideCanvasContextMenu();
        if (!ctx) return;
        const it = findItemById(ctx.tableId);
        if (!it || it.tableData[0].length <= 1) return;
        saveSnapshot();
        it.tableData.forEach(row => row.splice(ctx.c, 1));
        render();
    }
    // Removing a row shifts every row after it up by one (data rows only — the header row at
    // index 0 is never deletable here), remapping the row-tag map (keyed by row index) the
    // same way.
    function deleteContextRow() {
        const ctx = appState.contextMenuTableCtx;
        hideCanvasContextMenu();
        if (!ctx) return;
        const it = resolveTableForEdit(ctx.tableId);
        if (!it || ctx.r === 0 || it.tableData.length <= 2) return;
        saveSnapshot();
        it.tableData.splice(ctx.r, 1);
        if (it.cellTags) {
            const remapped = {};
            Object.keys(it.cellTags).forEach(key => {
                const kr = Number(key);
                if (kr === ctx.r) return;
                remapped[kr > ctx.r ? kr - 1 : kr] = it.cellTags[key];
            });
            it.cellTags = remapped;
        }
        render();
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Every hover/pin panel (menu, messages, cart, profile, add, collab, sourceAdd —
            // see closeAllPanels) plus every standalone modal/overlay in the app, all in one go.
            closeAllPanels();
            if (document.getElementById('search-cards-modal-overlay').classList.contains('open')) closeSearchCardsModal();
            closeSharedCanvasView();
            closeDotbotUpgradeModal();
            closePricingOverlay();
            closeCellTagPicker();
            closeUploadPopup();
            clearSearch(); // also closes the search overlay + blurs the input, see its own comment
            // Was setDrawMode(false) — finishes (commits, or discards a stray single point) any
            // in-progress pen-tool polyline. Pen mode itself is exited separately, by the same
            // tap/hold override logic just below that already handles Data/Select/Normal.
            if (appState.penPolyline) finishPenPolyline();
            if (appState.addingKind) cancelAddingKind();
            // Escape switching the cursor back to Normal mode (tap vs. hold, same as the
            // other mode keys) is handled by the dedicated keydown/keyup pair further below —
            // this listener only handles Escape's other, unrelated "close everything" duties.
        }
        if (!(e.metaKey || e.ctrlKey)) return;
        const active = document.activeElement;
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (e.key === 'z' || e.key === 'Z') {
            if (isEditingText) return;
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
            return;
        }
        // Cut/Paste whatever's currently selected (shift-click or select-cursor-mode click — see
        // setupDraggingAndClicking) as whole cards, the same independent copy an Alt-drag
        // duplicate produces (see deepCloneItem/copySelectedCards) reachable without a drag.
        // isEditingText/shiftKey/altKey are all excluded so this never steals an ordinary text
        // cut/paste happening inside a note body, table cell, or title, and Cmd+X never fires
        // alongside Shift+X's unrelated "link selected cards" shortcut.
        // The bare 'C' copy shortcut that used to live here was removed per explicit request —
        // Collaborations now owns 'C' outright (see srs-connections-core.js) with no fallback
        // collision to worry about; copySelectedCards() itself stays, still called internally by
        // cutSelectedCards() below, just no longer independently keyboard-triggerable.
        if (!isEditingText && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X') && appState.selectedCardIds.length > 0) {
            e.preventDefault();
            cutSelectedCards();
            return;
        }
        if (!isEditingText && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V') && appState.cardClipboard.length > 0) {
            e.preventDefault();
            pasteClipboardCards();
            return;
        }
    });

    // #dot-layer's own CSS left/top (see layoutDotLayer) — a fixed, viewport-independent offset,
    // NOT part of the scale/translate transform below. Needed to correctly phase-align the dot
    // pattern with world-space coordinates (see wrapPhase's comment) — this constant never
    // actually changes across resizes (only the box's width/height do, to stay big enough to
    // cover the viewport), so it's safe to compute once rather than re-derive on every resize.
 // must comfortably exceed the largest possible phase-wrap wobble (28 * ZOOM_MAX)
    // The dot grid is sized generously beyond the viewport (see layoutDotLayer) so it always
    // fully covers the screen even at ZOOM_MIN, the most zoomed-out the pattern itself is ever
    // actually drawn at (it tracks the real `scale` directly now — see applyTransform — so cards
    // and the grid they sit on always stay in exact proportion at any zoom level; it used to be
    // clamped to a separate, higher floor purely to keep this element's own pre-sized box
    // smaller, which visibly desynced the two below that floor). Since it's a fixed-size element,
    // though, panning it by the *raw* tx/ty (which grow without bound the further you pan) would
    // eventually carry it right off past that padding — but for an infinitely-repeating pattern,
    // shifting by any whole multiple of one tile's period (28 local units, i.e. 28*scale screen
    // px) looks completely identical to not shifting it at all. So only the sub-tile-period
    // *remainder* of tx/ty is ever applied as this element's own translate, keeping it
    // essentially stationary (just wobbling within one tile width/height) regardless of how far
    // tx/ty themselves have wandered.
    //
    // Crucially, that remainder has to be taken relative to the element's OWN base position
    // (dotLayerBaseX/Y), not tx/ty in isolation: the element sits at (dotLayerBaseX, dotLayerBaseY)
    // via plain CSS left/top (outside the transform entirely), so its rendered position after
    // `translate(d) scale(s)` is (dotLayerBaseX + d + local*s) versus a card's
    // (tx + local*s) — for those to land on the same screen pixel for every grid-aligned
    // `local`, d must equal (tx - dotLayerBaseX), and only the *wrapped* remainder of THAT
    // (mod period) — not of tx alone — is what's actually safe to substitute in (wrapping tx
    // alone silently drops the constant dotLayerBaseX offset, which is what let the two drift
    // out of phase by an amount that grew with zoom instead of being a fixed, harmless pixel
    // wobble).
    function wrapPhase(v, period) { return ((v % period) + period) % period; }
    function applyTransform() {
        world.style.transform = `translate(${appState.tx}px, ${appState.ty}px) scale(${appState.scale})`;
        // background-size on #dot-layer is a fixed 28px (see CSS) and never touched here — the
        // zoom is applied purely through this `scale()`, a compositor-only operation, so the
        // tile is only ever rasterized once and simply scaled smoothly from there on, instead
        // of being re-rasterized at a new size on every change (which is what caused the jitter
        // when this used to be done via background-size/background-position directly).
        // Same `scale` the cards themselves use (see world.style.transform above) — no separate
        // floor — so a card's position on the grid stays exact at every zoom level, not just
        // above some threshold.
        const period = 28 * appState.scale;
        const dx = wrapPhase(appState.tx - appState.dotLayerBaseX, period);
        const dy = wrapPhase(appState.ty - appState.dotLayerBaseY, period);
        dotLayer.style.transform = `translate(${dx}px, ${dy}px) scale(${appState.scale})`;
        updateZoomUI();
        updateContextMenuPosition();
        repositionAllRemoteCursors();
        // Keeps OUR OWN cursor broadcast live while panning/zooming without any real mouse
        // movement (see lastPointerClientX/Y's comment) — repositionAllRemoteCursors above only
        // repositions everyone ELSE's cursor on our screen using our new tx/ty; this is the
        // symmetric other half, telling THEM where ours now is.
        broadcastCursorPositionThrottled();
    }
    // Eases the camera to a new pan/zoom instead of snapping — used by every "jump to X"
    // navigation (goToOutlineItem, goToWaypointCard) so the canvas visibly pans
    // there rather than teleporting. Sets an inline `transition` on #world/#dot-layer just long
    // enough to cover one ease, then clears it back to '' — never left on permanently, since
    // normal real-time dragging/pinch-zooming needs tx/ty/scale to apply instantly, not ease.
    // Using an inline style (rather than a toggled CSS class) keeps this one function fully
    // self-contained and lets each call site pick its own duration without needing multiple CSS
    // variants.
    function smoothPanTo(targetTx, targetTy, targetScale, durationMs = 450) {
        const transitionValue = `transform ${durationMs / 1000}s ease`;
        world.style.transition = transitionValue;
        dotLayer.style.transition = transitionValue;
        appState.tx = targetTx; appState.ty = targetTy; appState.scale = targetScale;
        applyTransform();
        clearTimeout(appState.cameraTweenTimeout);
        appState.cameraTweenTimeout = setTimeout(() => {
            world.style.transition = '';
            dotLayer.style.transition = '';
        }, durationMs + 20);
    }
    // Keeps the dot-layer element itself big enough (and positioned) to always cover the
    // screen no matter the current pan phase, at ZOOM_MIN — the smallest the pattern is ever
    // actually rendered at now that it tracks the real scale directly (scale() only ever grows it
    // bigger from there, which just over-covers further, never under-covers) — recomputed on load
    // and on window resize. Since transform-origin is 0 0 (the box's own top-left, not its
    // center), scaling stretches it away from that corner rather than from the middle, so the
    // box's local size is chosen such that its rendered size at the floor comes out to exactly
    // viewport+margin, which makes the *always-constant* `-margin/2` a valid static left/top for
    // every viewport size.
    function layoutDotLayer() {
        const w = window.innerWidth, h = window.innerHeight;
        const boxW = (w + appState.DOT_LAYER_MARGIN) / appState.ZOOM_MIN;
        const boxH = (h + appState.DOT_LAYER_MARGIN) / appState.ZOOM_MIN;
        dotLayer.style.width = boxW + 'px';
        dotLayer.style.height = boxH + 'px';
        dotLayer.style.left = appState.dotLayerBaseX + 'px';
        dotLayer.style.top = appState.dotLayerBaseY + 'px';
    }
    layoutDotLayer();
    window.addEventListener('resize', layoutDotLayer);
    // Trackpad pinch-to-zoom fires `wheel` events far faster than the display can actually
    // repaint (often 60-120/sec). Batching every call through here so at most one
    // applyTransform() happens per animation frame — tx/ty/scale themselves are still updated
    // synchronously and immediately on every event, so the zoom's own math (each event
    // anchoring off the latest values) is completely unaffected; only how often the visuals
    // actually get applied changes.
    function scheduleApplyTransform() {
        if (appState.applyTransformRafId !== null) return;
        appState.applyTransformRafId = requestAnimationFrame(() => { appState.applyTransformRafId = null; applyTransform(); });
    }
    function updateContextMenuPosition() {
        if (contextMenu.style.display !== 'flex' || appState.contextMenuItemId == null) return;
        const it = findItemById(appState.contextMenuItemId);
        const el = document.getElementById('item-' + appState.contextMenuItemId);
        if (!it || !el) { contextMenu.style.display = 'none'; appState.contextMenuItemId = null; return; }
        const w = el.offsetWidth;
        contextMenu.style.left = (appState.tx + (it.x + w) * appState.scale + 8) + 'px';
        contextMenu.style.top = (appState.ty + it.y * appState.scale) + 'px';
    }
    function updateZoomUI() {
        const pct = Math.max(0, Math.min(1, (appState.scale - appState.ZOOM_MIN) / (appState.ZOOM_MAX - appState.ZOOM_MIN)));
        const h = zoomTrack.clientHeight;
        const y = pct * h;
        zoomFill.style.height = y + 'px';
        zoomThumb.style.bottom = y + 'px';
    }

export { applyTransform, deleteContextColumn, deleteContextRow, ensureSwTicking, hideCanvasContextMenu, highlightContextColumn, highlightContextRow, loadWorkspace, openTableCellContextMenu, redo, saveSnapshot, saveWorkspaceNow, scheduleApplyTransform, scheduleWorkspaceSave, smoothPanTo, undo, updateContextMenuPosition };
