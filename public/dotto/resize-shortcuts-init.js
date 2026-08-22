import { switchAddTab } from './add-menu.js';
import { addMenu, appState, btnBack, btnForward, contextMenu } from './core-state.js';
import { refreshCanvasCollabForCurrentFolder, refreshFriendsData, renderCollabPill } from './friends-presence.js';
import { fcFlip, fcRate, trNext } from './games-flashcard-typeright.js';
import { applyTransform, loadWorkspace, saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { broadcastItemResize, findItemById } from './live-presence.js';
import { refreshDotbotUsage } from './profile-achievements-pricing.js';
import { announceEnteredCollaboration, jumpToHistoryIndex } from './shared-canvases-outline.js';
import { applyCursorMode } from './source-buttons-cursor-mode.js';
import { distributeTableSizing, renderTableHTML } from './source-table.js';
import { updateDrawLayerBtns } from './srs-connections-core.js';
import { cascadeDeleteFolderContents, centerOnContent, deleteWaypointFromDb, render, renderSelectedOutlines } from './waypoints-render-loop.js';


    // ---------- Element Resize System ----------
    // Called every time a card's body is (re)built — including, for a Component-owned kind (see
    // CARD_KIND_COMPONENTS, app/dotto/CanvasItemsLayer.jsx), on every render() call, since that
    // kind's own layout effect has no dependency array (see the canvas-items-react plan,
    // PHASE2_ROADMAP.md). A plain addEventListener would stack a duplicate pointerdown listener on
    // the same persistent .resize handle each time instead of replacing it — same fix as
    // setupDraggingAndClicking (drag-drop-chat.js): abort the previous listener before attaching a
    // fresh one, a no-op on first call.
    function setupResizing(el, it) {
        const handle = el.querySelector('.resize');
        if(!handle) return;
        handle.__resizeListenerAbort?.abort();
        const { signal } = (handle.__resizeListenerAbort = new AbortController());
        handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            // stopPropagation alone only stops the drag system's own listener from firing — it
            // does nothing to the browser's own native default action for a mousedown-and-drag,
            // which for a media card is "start a text selection" if the drag happens to sweep
            // near/across the invisible PDF text layer sitting nearby. preventDefault suppresses
            // that native default outright, so dragging this handle is only ever a resize.
            e.preventDefault();
            saveSnapshot();
            if (it.kind === 'table' && !it.userSized) {
                it.w = el.offsetWidth; it.h = el.offsetHeight;
                it.userSized = true;
                el.classList.add('sized');
                el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
                el.innerHTML = renderTableHTML(it);
                setupResizing(el, it);
                distributeTableSizing(it, el);
            }
            let sx = e.clientX, sy = e.clientY, sw = it.w, sh = it.h;
            const minSize = it.kind === 'table' ? 56 : 112;
            // Media cards (image/video/PDF/EPUB) resize proportionally, preserving their content's
            // real aspect ratio, instead of each axis independently the way table/flashcard do (or
            // width-only the way note does, just below) — locked to the PDF page's own true ratio
            // if it's known yet (see renderPage's it.docAspectRatio), otherwise whatever ratio the
            // card is currently at (correct
            // already for images/video, since computeMediaCardSize set w/h from the media's own
            // natural dimensions; an arbitrary starting point for EPUB, which has no fixed "page"
            // shape to lock to, but still scales proportionally from wherever it starts).
            const aspectRatio = it.kind === 'media' ? (it.docAspectRatio || (sw / sh)) : null;
            const move = (me) => {
                const dx = (me.clientX - sx) / appState.scale, dy = (me.clientY - sy) / appState.scale;
                if (aspectRatio) {
                    // Follow whichever axis the cursor moved more along; derive the other from
                    // the locked ratio rather than letting both drift independently.
                    let newW, newH;
                    if (Math.abs(dx) >= Math.abs(dy)) { newW = sw + dx; newH = newW / aspectRatio; }
                    else { newH = sh + dy; newW = newH * aspectRatio; }
                    it.w = Math.max(minSize, Math.round(newW / 28) * 28);
                    it.h = Math.max(minSize, Math.round(newH / 28) * 28);
                    el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
                } else if (it.kind === 'note') {
                    // Width only — dy is ignored entirely. Height is never set here (or anywhere
                    // else for notes): it's always automatic, driven by plain CSS auto-sizing at
                    // whatever width this drag lands on (see .item.note/.body, globals.css) —
                    // the browser reflows the text and resizes the wrapper on its own, live, with
                    // no JS measurement needed on every pointermove.
                    it.w = Math.max(minSize, Math.round((sw + dx) / 28) * 28);
                    el.style.width = it.w + 'px';
                } else {
                    it.w = Math.max(minSize, Math.round((sw + dx) / 28) * 28);
                    it.h = Math.max(minSize, Math.round((sh + dy) / 28) * 28);
                    el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
                }
                if (it.kind === 'table') distributeTableSizing(it, el);
                // Live visual streaming while dragging — see handleRemoteItemResize/broadcastItemResize.
                // Purely DOM-only on the receiving end, same as item-drag; the real w/h is only
                // committed once scheduleWorkspaceSave below runs on release. For notes, it.h at
                // this point is whatever attachNoteBody's ResizeObserver last measured — close
                // enough mid-drag, and it settles exactly once that observer's next callback fires.
                broadcastItemResize(it.id, it.w, it.h);
            };
            // Previously never called scheduleWorkspaceSave() at all — a resize wasn't synced live
            // to collaborators OR promptly persisted; it only ever reached the DB once some
            // unrelated later action happened to trigger a save.
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); scheduleWorkspaceSave(); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        }, { signal });
    }

    function findNextFreeSlot(folderId) {
        const items = appState.folders[folderId].items;
        let x = 28;
        while (items.some(i => Math.abs(i.x - x) < 28 && Math.abs(i.y - 28) < 28)) { x += 28 * 8; }
        return x;
    }

    // Deletes the current multi-selection (see the Backspace keydown handler) — confirms once,
    // combined, first if any of them would lose irrecoverable data (a Source's spaced-repetition
    // memory, a Shelf's saved review sessions, or a table's own SM-2 progress). This is now the
    // only way to delete a card — the old per-card right-click "Delete" menu item is gone (see
    // the oncontextmenu change above).
    function deleteSelectedCards() {
        if (!appState.selectedCardIds.length) return;
        const items = appState.selectedCardIds.map(id => findItemById(id)).filter(Boolean);
        if (!items.length) return;
        const hasSource = items.some(it => it.kind === 'source');
        const hasShelf = items.some(it => it.kind === 'shelf');
        const hasSrsTable = items.some(it => it.kind === 'table' && it.srsMeta && Object.keys(it.srsMeta).length);
        if (hasSource || hasShelf || hasSrsTable) {
            const parts = [];
            if (hasSource) parts.push("a Source's permanently stored spaced-repetition memory (intervals, ease factors, due dates, streaks)");
            if (hasShelf) parts.push("a Shelf's permanently stored review session history");
            if (hasSrsTable) parts.push("a table's permanently stored spaced-repetition progress");
            if (!confirm(`Deleting will erase ${parts.join(', ')} for good. Delete anyway?`)) return;
        }
        saveSnapshot();
        const idSet = new Set(appState.selectedCardIds);
        const removedWaypoints = items.filter(it => it.kind === 'waypoint');
        // Nested canvases/sources being deleted along with everything inside them (their own
        // waypoints, their own collaborators, and any further-nested canvases in turn) — see
        // cascadeDeleteFolderContents.
        const removedFolders = items.filter(it => (it.kind === 'folder' || it.kind === 'source') && it.folderId);
        appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !idSet.has(i.id));
        appState.selectedCardIds = [];
        render();
        renderSelectedOutlines();
        removedWaypoints.forEach(it => deleteWaypointFromDb(appState.currentFolderId, it.id));
        removedFolders.forEach(it => cascadeDeleteFolderContents(it.folderId));
    }
    function setTableAlign(align) {
        const id = parseInt(contextMenu.dataset.id);
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.textAlign = align;
        render();
        contextMenu.style.display = 'none'; appState.contextMenuItemId = null;
    }

    // ---------- Hover-scoped game card shortcuts ----------
    // Whichever game card the mouse is currently sitting over gets its own keyboard shortcuts —
    // F to flip a flashcard, 1-4 for its rating row once flipped, Enter to advance a Typeright
    // card once it's been checked (the ONLY way to do that from the keyboard, since the input
    // itself goes disabled right after checking — see renderTypeRightHTML — and so can no longer
    // receive its own onkeydown). Read live via the :hover pseudo-class rather than tracked
    // mouseenter/mouseleave state, since render() rebuilds every .item element from scratch on
    // every change anyway.
    function hoveredGameCard() {
        const el = document.querySelector('.item.flashcard:hover, .item.typeright:hover');
        if (!el) return null;
        const it = findItemById(Number(el.id.replace('item-', '')));
        return it && (it.kind === 'flashcard' || it.kind === 'typeright') ? it : null;
    }
    // Any panel that owns its own keyboard input while open — same set closeAllPanels() knows
    // about, plus the search dropdown — wins over a hovered card's shortcuts even if the cursor
    // happens to still be sitting over that card underneath it. Outline/Waypoints/Collaborations/
    // Marketplace/Messages/Profile all share one rail shell now (see appState.railViewEls,
    // core-state.js) — checking the whole list covers all of them in one go instead of naming each
    // one individually.
    function isAnyUiPanelOpen() {
        return appState.railViewEls.some(el => el && el.classList.contains('open'))
            || appState.collabPanel.classList.contains('open')
            || addMenu.style.display === 'flex'
            || appState.sourceAddMenu.style.display === 'flex'
            || (appState.searchDropdown && appState.searchDropdown.classList.contains('visible'))
            || (appState.searchChatThread && appState.searchChatThread.classList.contains('visible'));
    }
    document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const active = document.activeElement;
        // An actually-focused field always wins — this is also what keeps this handler from
        // double-firing Enter while someone's still typing in a Typeright input, since that
        // input has its own onkeydown for the pre-check Enter-to-submit path (see
        // renderTypeRightHTML); this one only ever needs to cover the POST-check state, where
        // the input has gone disabled and can't hold focus anymore.
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (isEditingText) return;
        if (isAnyUiPanelOpen()) return;
        if (appState.currentNotification) return; // its own Enter/Escape handling should win, not compete
        const it = hoveredGameCard();
        if (!it) return;
        if (it.kind === 'flashcard') {
            if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fcFlip(it.id); return; }
            if (it.fcFlipped && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
                e.preventDefault();
                fcRate(it.id, ['noclue', 'wrong', 'hard', 'easy'][Number(e.key) - 1]);
            }
        } else if (it.kind === 'typeright') {
            if (e.key === 'Enter' && it.trChecked) { e.preventDefault(); trNext(it.id); }
        }
    });


    btnBack.onclick = () => { if(appState.historyIndex > 0) jumpToHistoryIndex(appState.historyIndex - 1); };
    btnForward.onclick = () => { if(appState.historyIndex < appState.historyStack.length - 1) jumpToHistoryIndex(appState.historyIndex + 1); };

    updateDrawLayerBtns();
    switchAddTab('notes');
    applyCursorMode();
    // Waits for any saved workspace before the first render, so a returning
    // user's real content shows immediately instead of flashing the built-in
    // starter folders first. loadWorkspace() no-ops instantly if there's no
    // signed-in user or nothing saved yet.
    (async () => {
        const restoredView = await loadWorkspace();
        render();
        if (!restoredView) centerOnContent();
        else applyTransform();
        // Same reasoning as the fix inside refreshCanvasCollabForCurrentFolder itself — the very
        // first render() above ran before this had any real data, so a landing folder with an
        // actual collaborator could otherwise start out wrongly deciding "no live channel needed"
        // straight from a fresh page load, not just after a later in-app navigation.
        refreshCanvasCollabForCurrentFolder();
        // A reload that resumed straight back into a shared canvas (see loadWorkspace's own
        // resume logic) reads the same as freshly entering it from the user's point of view — the
        // one-time "Collaborating on..." notification should still fire, not just for the
        // in-session entry points (openSharedCanvas/goToWaypointCard).
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSharedView) announceEnteredCollaboration(appState.currentFolderId);
    })();
    refreshFriendsData().then(() => renderCollabPill());
    refreshDotbotUsage();



export { deleteSelectedCards, findNextFreeSlot, setTableAlign, setupResizing };

// React → vanilla bridge (see the identical pattern/comment in cards-misc.js) — used by
// FlashcardCard.jsx directly (a converted kind's own layout effect, same as
// attachWatermarkBody/attachUniversalItemBehavior), not just from renderLegacyCardBody's own
// still-legacy table/media/typeright/note branches.
window.__setupResizing = setupResizing;
