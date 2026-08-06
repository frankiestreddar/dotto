import { kindSize, switchAddTab } from './add-menu.js';
import { addMenu, appState, canvas, world } from './core-state.js';
import { saveSnapshot } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { closeAllPanels, scheduleHoverClose } from './panels-hamburger.js';
import { deleteSelectedCards } from './resize-shortcuts-init.js';
import { setDrawMode } from './srs-connections-core.js';
import { render, renderSelectedOutlines } from './waypoints-render-loop.js';



    // ---------- Copy / Cut / Paste (Cmd/Ctrl+C / X / V — see the keydown handler above) ----------
    // Independent of the OS clipboard — an in-memory snapshot of whatever was selected at copy
    // time. A folder/source card's real content lives in folders[] keyed by a live id that a Cut
    // would otherwise delete out from under it (see cascadeDeleteFolderContents) before any
    // Paste happens, so the snapshot has to carry a fully independent copy of that subtree, not
    // just a folderId pointing at data that may no longer exist by paste time. Reset (and its
    // cascading paste offset re-armed) every time something new is copied or cut; NOT cleared by
    // pasting, so Cmd+V can be pressed repeatedly to stamp down more copies, same as any normal
    // clipboard.

    // Self-contained capture of a card for cardClipboard — same embed-nested-contents idea as
    // snapshotItem (used for external chat/marketplace sharing), kept as its own function since
    // that one is optimized for a read-only, cross-account view (renderInlineCanvas), while this
    // one needs to round-trip back into real, live folders[] data via materializeClipboardItem.
    function snapshotItemForClipboard(it) {
        const clone = JSON.parse(JSON.stringify(it));
        if ((it.kind === 'folder' || it.kind === 'source') && it.folderId && appState.folders[it.folderId]) {
            const srcFolder = appState.folders[it.folderId];
            clone.clipboardFolder = JSON.parse(JSON.stringify(srcFolder));
            clone.clipboardFolder.items = srcFolder.items.map(snapshotItemForClipboard); // recursive — nested folders/sources capture their own subtree too
        }
        return clone;
    }
    // Reverse of snapshotItemForClipboard — turns a captured snapshot into a real, freshly id'd
    // canvas item, recreating a brand-new folders[] entry (recursively) for any folder/source
    // content it carries. Same fresh-id/dropped-sharing-fields handling as deepCloneItem's
    // Alt-drag duplicate, just sourced from a stored snapshot instead of a still-live item.
    function materializeClipboardItem(snap) {
        const clone = JSON.parse(JSON.stringify(snap));
        clone.id = appState.idCounter++;
        delete clone.clipboardFolder;
        if (snap.clipboardFolder) {
            const newFid = 'folder-' + appState.idCounter++;
            const newFolder = JSON.parse(JSON.stringify(snap.clipboardFolder));
            newFolder.id = newFid;
            newFolder.collaborators = []; // a paste starts with no collaborators of its own, same as an Alt-drag duplicate
            delete newFolder.isSharedView; delete newFolder.sharedOwnerId; delete newFolder.sharedRemoteFolderId;
            newFolder.items = snap.clipboardFolder.items.map(materializeClipboardItem); // recursive — nested folders/sources get their own fresh ids too
            appState.folders[newFid] = newFolder;
            clone.folderId = newFid;
        }
        return clone;
    }
    function copySelectedCards() {
        if (!appState.selectedCardIds.length) return;
        const items = appState.selectedCardIds.map(id => findItemById(id)).filter(Boolean);
        if (!items.length) return;
        appState.cardClipboard = items.map(snapshotItemForClipboard);
        appState.clipboardPasteCount = 0;
    }
    function cutSelectedCards() {
        if (!appState.selectedCardIds.length) return;
        copySelectedCards();
        if (!appState.cardClipboard.length) return;
        deleteSelectedCards(); // its own confirm()/saveSnapshot()/cascade cleanup — see its own comment
    }
    function pasteClipboardCards() {
        if (!appState.cardClipboard.length || !appState.folders[appState.currentFolderId]) return;
        saveSnapshot();
        appState.clipboardPasteCount++;
        const offset = appState.clipboardPasteCount * 28; // cascades further with each repeated paste, so stamping Cmd+V several times doesn't stack copies exactly on top of each other
        const pasted = appState.cardClipboard.map(snap => {
            const clone = materializeClipboardItem(snap);
            clone.x = (clone.x || 0) + offset;
            clone.y = (clone.y || 0) + offset;
            appState.topCardZIndex++; clone.zIndex = appState.topCardZIndex;
            return clone;
        });
        appState.folders[appState.currentFolderId].items.push(...pasted);
        appState.selectedCardIds = pasted.map(it => it.id);
        render();
        renderSelectedOutlines();
    }

    function removePlacementGhost() {
        if (appState.placementGhost) { appState.placementGhost.remove(); appState.placementGhost = null; }
    }
    function showPlacementGhost(kind) {
        removePlacementGhost();
        const { w, h } = kindSize(kind);
        appState.placementGhost = document.createElement('div');
        appState.placementGhost.id = 'placement-ghost';
        appState.placementGhost.className = `item ${kind}`;
        appState.placementGhost.style.width = w + 'px';
        appState.placementGhost.style.height = h + 'px';
        appState.placementGhost.style.opacity = '0.5';
        appState.placementGhost.style.background = 'transparent';
        appState.placementGhost.style.pointerEvents = 'none';
        appState.placementGhost.style.zIndex = '999';
        world.appendChild(appState.placementGhost);
        appState.placementGhost.style.left = '-9999px';
        appState.placementGhost.style.top = '-9999px';
    }
    canvas.addEventListener('pointermove', (e) => {
        if (!appState.addingKind || !appState.placementGhost) return;
        const rect = canvas.getBoundingClientRect();
        const { w, h } = kindSize(appState.addingKind);
        const x = Math.round((((e.clientX - rect.left - appState.tx) / appState.scale) - w / 2) / 28) * 28;
        const y = Math.round((((e.clientY - rect.top - appState.ty) / appState.scale) - h / 2) / 28) * 28;
        appState.placementGhost.style.left = x + 'px';
        appState.placementGhost.style.top = y + 'px';
    });

    function prepareAdd(kind, statKind) { appState.addingKind = kind; appState.addingStatKind = statKind || null; addMenu.style.display = 'none'; appState.panelPinned.add = false; canvas.classList.add('crosshair'); setDrawMode(false); showPlacementGhost(kind); }
    function closeAddMenu() { addMenu.style.display = 'none'; appState.panelPinned.add = false; }
    function openAddMenu(pin) {
        if (appState.drawMode) setDrawMode(false);
        closeAllPanels('add');
        addMenu.style.display = 'flex';
        // Always reopens showing tabs, never mid-search from a previous visit.
        if (appState.addMenuSearching) {
            appState.addMenuSearching = false;
            document.getElementById('add-menu-tabs').classList.remove('searching');
            document.getElementById('add-menu-search-btn').classList.remove('active');
        }
        switchAddTab(appState.currentAddTab);
        if (pin) appState.panelPinned.add = true;
    }
    // addMenuActions (New Canvas/New Source) sits visually beside #add-menu, not inside it (see
    // globals.css), with real dead space in between both it and the panel, and between the panel
    // and addToolbar — scheduleHoverClose's 80ms grace period already tolerates a brief gap
    // between listed hoverEls, but only if EVERY zone the pointer might legitimately be heading
    // towards is actually in that list. Leaving addMenuActions out of it meant reaching those
    // buttons (or just crossing the gap towards them) wasn't recognized as "still relevant
    // hovering" at all, so the panel could close out from under the pointer on the way there.
    appState.addToolbar.addEventListener('click', (e) => {
        e.stopPropagation();
        if (appState.panelPinned.add) { closeAddMenu(); }
        else { openAddMenu(true); }
    });
    appState.addToolbar.addEventListener('mouseenter', () => { if (addMenu.style.display !== 'flex') openAddMenu(false); });
    appState.addToolbar.addEventListener('mouseleave', () => scheduleHoverClose('add', appState.addMenuHoverEls, closeAddMenu));
    addMenu.addEventListener('mouseleave', () => scheduleHoverClose('add', appState.addMenuHoverEls, closeAddMenu));
    appState.addMenuActions.addEventListener('mouseleave', () => scheduleHoverClose('add', appState.addMenuHoverEls, closeAddMenu));

export { closeAddMenu, copySelectedCards, cutSelectedCards, pasteClipboardCards, prepareAdd, removePlacementGhost };
