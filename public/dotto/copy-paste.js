import { kindSize } from './add-menu.js';
import { appState, canvas, registerPaneCanvasListenerSetup, world } from './core-state.js';
import { saveSnapshot } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { closeRailView } from './panels-hamburger.js';
import { deleteSelectedCards } from './resize-shortcuts-init.js';
import { applyCursorMode } from './source-buttons-cursor-mode.js';
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
    // Shared by showPlacementGhost's own initial placement and the pointermove handler just below
    // — same grid-snapped, viewport-to-world conversion either way, just fed a different (clientX,
    // clientY) source.
    function placementGhostWorldPos(clientX, clientY, kind) {
        const rect = canvas.getBoundingClientRect();
        const { w, h } = kindSize(kind);
        const x = Math.round((((clientX - rect.left - appState.tx) / appState.scale) - w / 2) / 28) * 28;
        const y = Math.round((((clientY - rect.top - appState.ty) / appState.scale) - h / 2) / 28) * 28;
        return { x, y };
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
        // Per explicit bug report: a keyboard-triggered placement (the 'a'-chord, srs-connections-
        // core.js) never moves the mouse at all, so parking the ghost off-screen until the next
        // real pointermove left it (and the crosshair cursor feedback with it) invisible until the
        // user deliberately jiggled the mouse. lastPointerClientX/Y (live-presence.js) already
        // tracks the cursor's real screen position on every canvas pointermove regardless of what
        // triggered this — reusing it here means the ghost renders at the CURRENT cursor position
        // immediately, with the exact same math the live pointermove handler below already uses, no
        // movement required. Only falls back to off-screen in the (practically unreachable, since
        // the cursor has to be somewhere on the canvas to have triggered any of this in the first
        // place) case that no pointermove has ever fired yet this session.
        if (appState.lastPointerClientX != null && appState.lastPointerClientY != null) {
            const { x, y } = placementGhostWorldPos(appState.lastPointerClientX, appState.lastPointerClientY, kind);
            appState.placementGhost.style.left = x + 'px';
            appState.placementGhost.style.top = y + 'px';
        } else {
            appState.placementGhost.style.left = '-9999px';
            appState.placementGhost.style.top = '-9999px';
        }
    }
    // Purely a visual preview (the actual placement, on click, always correctly uses whichever
    // pane was clicked into — see setupCanvasLevelInteractionListeners, srs-connections-core.js) —
    // no switchActivePane needed here, just re-attached per pane (split-screen Stage 4: see
    // registerPaneCanvasListenerSetup, core-state.js) so the ghost tracks the cursor over ANY
    // pane, not just pane 0.
    function setupPlacementGhostTracking(canvasEl) {
        canvasEl.addEventListener('pointermove', (e) => {
            if (!appState.addingKind || !appState.placementGhost) return;
            const { x, y } = placementGhostWorldPos(e.clientX, e.clientY, appState.addingKind);
            appState.placementGhost.style.left = x + 'px';
            appState.placementGhost.style.top = y + 'px';
        });
    }
    setupPlacementGhostTracking(canvas);
    registerPaneCanvasListenerSetup(setupPlacementGhostTracking);

    // The only caller (handleBlockItemClick, blocks-panel.js) is only ever reached while the
    // Blocks panel itself is the open rail view, so closeRailView here always closes that panel.
    function prepareAdd(kind, statKind) {
        appState.addingKind = kind; appState.addingStatKind = statKind || null; closeRailView(); canvas.classList.add('crosshair');
        // Starting to place any card kind exits pen mode, same as opening the Blocks panel itself
        // already does (refreshBlocksPanel, blocks-panel.js) — was setDrawMode(false).
        if (appState.cardMode === 'pen') { appState.cardMode = 'normal'; applyCursorMode(); }
        showPlacementGhost(kind);
    }

export { copySelectedCards, cutSelectedCards, pasteClipboardCards, prepareAdd, removePlacementGhost };
