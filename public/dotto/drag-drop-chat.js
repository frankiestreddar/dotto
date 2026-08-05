import { addCardsToSearchContext } from './ai-assistant-suggestions.js';
import { appState, bringCardToFront, canvas, effectiveMode, supabase, world } from './core-state.js';
import { startScheduleConversation } from './dotbot-schedule-notifications.js';
import { drawMode } from './drawing-connections.js';
import { activeConvoId, friends, renderMsgList } from './friends-presence.js';
import { applyTransform, saveSnapshot, undoStack } from './history-autosave.js';
import { broadcastItemDragPositions, findItemById, renderConvoBody, sanitizeFlashcardSnapshot, snapshotItem } from './live-presence.js';
import { cartPanel, packageSelectedAsTemplate } from './marketplace.js';
import { messagesPanel, scheduleBtn } from './messages-schedule.js';
import { deepCloneItem, deleteClonedItemFolders, startConnectionDrag, startDrawStroke } from './srs-connections-core.js';
import { performMerge, render, renderSelectedOutlines } from './waypoints-render-loop.js';

    // ---------- Element Drag and Drop System ----------
    function setupDraggingAndClicking(el, it) {
        el.addEventListener('pointerdown', (e) => {
            // The game-options panel's own controls (esp. the column-picker <select>s) must
            // never start a card drag — the .game-options-row/.game-options-slot elements'
            // onmousedown="event.stopPropagation()" only stops the separate 'mousedown' event,
            // not this 'pointerdown' listener, and opening a native <select> popup doesn't
            // reliably fire a matching window 'pointerup' back to end() the drag afterward —
            // so without this check, picking an option left the card permanently glued to the
            // cursor with no pointerup ever arriving to release it. Same exemption pattern
            // already used for '.resize' just above.
            if (e.target.closest('.item-options')) return;
            if (e.target.classList.contains('resize') || (appState.currentEditingEl === el && e.target !== el)) return;

            bringCardToFront(it, el);

            // Selection logic happens with Shift Key, or persistently while in Select mode
            if (e.shiftKey || effectiveMode() === 'select') {
                e.stopPropagation();
                e.preventDefault();
                if (appState.selectedCardIds.includes(it.id)) {
                    appState.selectedCardIds = appState.selectedCardIds.filter(id => id !== it.id);
                } else {
                    appState.selectedCardIds.push(it.id);
                }
                renderSelectedOutlines();
                // Prevent this same interaction from also opening folders/sources,
                // focusing contenteditable bodies, or otherwise "activating" the card -
                // shift-click should ONLY toggle selection.
                const suppressShiftClick = (ce) => { ce.stopPropagation(); ce.preventDefault(); el.removeEventListener('click', suppressShiftClick, true); };
                el.addEventListener('click', suppressShiftClick, true);
                return;
            }

            // Data mode: drag from this card to another to link them. Cards are not
            // otherwise clickable/openable/editable while in this mode.
            if (effectiveMode() === 'data') {
                if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
                e.stopPropagation();
                e.preventDefault();
                const suppressDataClick = (ce) => { ce.stopPropagation(); ce.preventDefault(); el.removeEventListener('click', suppressDataClick, true); };
                el.addEventListener('click', suppressDataClick, true);
                startConnectionDrag(e, it, el);
                return;
            }

            if (drawMode) {
                if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
                e.stopPropagation();
                startDrawStroke(e);
                return;
            }
            e.stopPropagation();
            let moved = false;
            const downX = e.clientX, downY = e.clientY;

            saveSnapshot();

            // Which card(s) this gesture operates on: the whole selection if the pressed
            // card is part of it, otherwise just this one card.
            const isTargetSelected = appState.selectedCardIds.includes(it.id);
            const gestureIds = isTargetSelected ? appState.selectedCardIds.slice() : [it.id];
            const preDuplicateSelection = appState.selectedCardIds.slice();

            let targetEl = el, targetIt = it;
            const startPositions = [];
            const isAltDuplicate = e.altKey && !(appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource);

            if (isAltDuplicate) {
                // Option/Alt held: duplicate the card(s) first, then drag the duplicate(s)
                // away — the original(s) stay exactly where they were.
                const idMap = {};
                gestureIds.forEach(srcId => {
                    const src = findItemById(srcId);
                    if (!src) return;
                    const clone = deepCloneItem(src);
                    appState.topCardZIndex++; clone.zIndex = appState.topCardZIndex;
                    appState.folders[appState.currentFolderId].items.push(clone);
                    idMap[srcId] = clone.id;
                    startPositions.push({ id: clone.id, x: clone.x, y: clone.y });
                });
                if (!startPositions.length) { undoStack.pop(); return; }
                appState.selectedCardIds = isTargetSelected ? gestureIds.map(gid => idMap[gid]).filter(gid => gid != null) : [];
                render();
                const newTargetId = idMap[it.id];
                targetIt = findItemById(newTargetId);
                targetEl = document.getElementById('item-' + newTargetId);
                if (!targetIt || !targetEl) {
                    const cloneIdSet = new Set(startPositions.map(p => p.id));
                    appState.folders[appState.currentFolderId].items.filter(i => cloneIdSet.has(i.id)).forEach(deleteClonedItemFolders);
                    appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !cloneIdSet.has(i.id));
                    appState.selectedCardIds = preDuplicateSelection;
                    undoStack.pop();
                    render();
                    return;
                }
                bringCardToFront(targetIt, targetEl);
            } else {
                // Cache starting positions of moved cards.
                // If dragging a card that is selected, drag all selected ones. Otherwise, drag only this single card!
                gestureIds.forEach(selId => {
                    const item = findItemById(selId);
                    if (item) startPositions.push({ id: selId, x: item.x, y: item.y });
                });
            }

            document.body.classList.add('dragging');
            let sx = e.clientX, sy = e.clientY, hovered = null;
            let lastClientX = e.clientX, lastClientY = e.clientY;
            // Auto-pan-driven displacement, tracked separately from startPositions' own x/y —
            // see autoPanTick below. Kept apart from the real cursor delta (sx/sy) so `up`'s
            // "snap back to original position on an aborted drop" still has startPositions'
            // untouched original coordinates to restore.
            let autoPanAccumX = 0, autoPanAccumY = 0;
            const suppressClick = (ce) => { ce.stopPropagation(); ce.preventDefault(); targetEl.removeEventListener('click', suppressClick, true); };

            // Moves every dragged card to (start position) + (real cursor delta since drag
            // start) + (accumulated auto-pan delta) — called on every real pointermove AND every
            // auto-pan tick, so a card keeps moving even while the cursor itself sits still near
            // the edge.
            const applyDraggedPositions = () => {
                const dx = (lastClientX - sx) / appState.scale + autoPanAccumX;
                const dy = (lastClientY - sy) / appState.scale + autoPanAccumY;
                startPositions.forEach(pos => {
                    const selItem = findItemById(pos.id);
                    const selEl = document.getElementById('item-' + pos.id);
                    if (selItem && selEl) {
                        selItem.x = Math.round((pos.x + dx) / 28) * 28;
                        selItem.y = Math.round((pos.y + dy) / 28) * 28;
                        selEl.style.left = selItem.x + 'px';
                        selEl.style.top = selItem.y + 'px';
                    }
                });
                broadcastItemDragPositions(startPositions);
            };

            const checkDropTargets = () => {
                // Detect if cursor is over cart panel dropzone
                const cartPanelOpen = cartPanel.classList.contains('open');
                if (cartPanelOpen) {
                    const cartRect = cartPanel.getBoundingClientRect();
                    const overCart = (lastClientX >= cartRect.left && lastClientX <= cartRect.right && lastClientY >= cartRect.top && lastClientY <= cartRect.bottom);
                    document.getElementById('cart-dropzone-overlay').classList.toggle('active', overCart);
                }

                // Detect if cursor is over the schedule button (drag-to-schedule drop target —
                // see the matching drop check in `up` below)
                const scheduleRect = scheduleBtn.getBoundingClientRect();
                const overSchedule = (lastClientX >= scheduleRect.left && lastClientX <= scheduleRect.right && lastClientY >= scheduleRect.top && lastClientY <= scheduleRect.bottom);
                scheduleBtn.classList.toggle('drag-hover', overSchedule);

                // Detect merging folder highlights
                const r1 = targetEl.getBoundingClientRect();
                let newH = null;
                for (const sib of Array.from(world.children)) {
                    if (sib === targetEl || !sib.classList.contains('item')) continue;
                    const sibId = parseInt(sib.id.replace('item-', ''));
                    const sibItem = appState.folders[appState.currentFolderId].items.find(i => i.id === sibId);
                    if (!sibItem || sibItem.kind !== 'folder') continue;
                    const r2 = sib.getBoundingClientRect();
                    if (!(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom)) { newH = sib; break; }
                }
                if (hovered && hovered !== newH) { hovered.classList.remove('merging-target'); targetEl.classList.remove('merging-target'); }
                if (newH) { newH.classList.add('merging-target'); targetEl.classList.add('merging-target'); }
                hovered = newH;
            };

            // Auto-pan the canvas while the drag's cursor sits near the viewport's edge, so a
            // drag can reach content well beyond whatever was on-screen when it started — same
            // UX as Figma/Miro: holding near the perimeter keeps scrolling the world underneath
            // the dragged card (dragging the card along with it, via autoPanAccumX/Y) for as long
            // as the cursor stays there. Speed ramps from 0 at EDGE_MARGIN in, up to
            // EDGE_MAX_SPEED right at the edge. Driven by its own rAF loop rather than
            // pointermove, since it has to keep going even while the cursor itself is dead still.
            const EDGE_MARGIN = 60, EDGE_MAX_SPEED = 900; // px screen-space from edge / px per second right at the edge
            let autoPanLastT = null, autoPanRAFId = null;
            const autoPanTick = (now) => {
                if (autoPanLastT == null) autoPanLastT = now;
                const dt = Math.min((now - autoPanLastT) / 1000, 0.1);
                autoPanLastT = now;
                const rect = canvas.getBoundingClientRect();
                let vx = 0, vy = 0;
                if (lastClientX < rect.left + EDGE_MARGIN) vx = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientX - rect.left) / EDGE_MARGIN);
                else if (lastClientX > rect.right - EDGE_MARGIN) vx = EDGE_MAX_SPEED * (1 - Math.max(0, rect.right - lastClientX) / EDGE_MARGIN);
                if (lastClientY < rect.top + EDGE_MARGIN) vy = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientY - rect.top) / EDGE_MARGIN);
                else if (lastClientY > rect.bottom - EDGE_MARGIN) vy = EDGE_MAX_SPEED * (1 - Math.max(0, rect.bottom - lastClientY) / EDGE_MARGIN);
                // vx/vy are computed independently per axis, so a corner already blends into an
                // exact diagonal proportional to how close the cursor is to EACH edge (e.g. nearer
                // the top than the left pans more up than left) — this just caps the combined
                // vector's magnitude to EDGE_MAX_SPEED so a corner doesn't pan up to ~41% faster
                // (sqrt(2)x) than a straight edge would; the direction/ratio between vx and vy is
                // untouched, only the overall speed is scaled down.
                const speed = Math.hypot(vx, vy);
                if (speed > EDGE_MAX_SPEED) {
                    const k = EDGE_MAX_SPEED / speed;
                    vx *= k; vy *= k;
                }
                if (vx || vy) {
                    const screenDx = vx * dt, screenDy = vy * dt;
                    appState.tx -= screenDx; appState.ty -= screenDy;
                    autoPanAccumX += screenDx / appState.scale;
                    autoPanAccumY += screenDy / appState.scale;
                    moved = true;
                    applyTransform();
                    applyDraggedPositions();
                    checkDropTargets();
                }
                autoPanRAFId = requestAnimationFrame(autoPanTick);
            };
            autoPanRAFId = requestAnimationFrame(autoPanTick);

            const move = (me) => {
                if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) moved = true;
                lastClientX = me.clientX; lastClientY = me.clientY;
                applyDraggedPositions();
                checkDropTargets();
            };

            const up = (me) => {
                cancelAnimationFrame(autoPanRAFId);
                document.body.classList.remove('dragging');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (moved) targetEl.addEventListener('click', suppressClick, true);
                if (!moved) {
                    if (isAltDuplicate) {
                        // Nothing was actually dragged — discard the speculative
                        // duplicate(s) and restore the selection exactly as it was.
                        const cloneIdSet = new Set(startPositions.map(p => p.id));
                        appState.folders[appState.currentFolderId].items.filter(i => cloneIdSet.has(i.id)).forEach(deleteClonedItemFolders);
                        appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !cloneIdSet.has(i.id));
                        appState.selectedCardIds = preDuplicateSelection;
                        undoStack.pop();
                        render();
                        return;
                    }
                    if (!hovered) { undoStack.pop(); }
                }

                // Hide dragover templates dropbox overlay
                document.getElementById('cart-dropzone-overlay').classList.remove('active');
                scheduleBtn.classList.remove('drag-hover');

                // Check Drop zones intersects
                const mX = me.clientX;
                const mY = me.clientY;
                let droppedOnTarget = false;

                // 1. Drop into active Chat
                if (messagesPanel.classList.contains('open')) {
                    const rect = messagesPanel.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        dispatchSelectedToChat(targetIt);
                        droppedOnTarget = true;
                    }
                }

                // 2. Drop into Template Marketplace Dropbox
                if (cartPanel.classList.contains('open')) {
                    const rect = cartPanel.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        packageSelectedAsTemplate(targetIt);
                        droppedOnTarget = true;
                    }
                }

                // 3. Drop into the search box as AI card context
                if (!droppedOnTarget) {
                    const searchBarEl = document.getElementById('search-bar');
                    const rect = searchBarEl.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        addCardsToSearchContext(gestureIds);
                        droppedOnTarget = true;
                    }
                }

                // 4. Drop onto the Schedule button — starts the schedule conversation for
                // whichever card(s) were being dragged (replaces the old right-click "Schedule"
                // context-menu option).
                if (!droppedOnTarget) {
                    const rect = scheduleBtn.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        startScheduleConversation(gestureIds);
                        droppedOnTarget = true;
                    }
                }

                if (droppedOnTarget) {
                    // Restore original positions! Cards fly back to original coordinates
                    startPositions.forEach(pos => {
                        const selItem = findItemById(pos.id);
                        if (selItem) {
                            selItem.x = pos.x;
                            selItem.y = pos.y;
                        }
                    });
                    render();
                } else {
                    if (hovered) {
                        performMerge(targetIt, hovered);
                    } else if (moved) {
                        render();
                    }
                }
            };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        });
    }

    // ---------- Dispatch to Chat Interaction ----------
    async function dispatchSelectedToChat(targetIt) {
        if (!activeConvoId) return;
        const f = friends.find(x => x.id === activeConvoId);
        if (!f) return;

        saveSnapshot();

        let itemsToShare = [];
        // If targetIt is selected, we share all selected cards. Otherwise, share just this card.
        const gestureIds = appState.selectedCardIds.includes(targetIt.id) ? appState.selectedCardIds.slice() : [targetIt.id];
        gestureIds.forEach(id => {
            const it = findItemById(id);
            if (it) itemsToShare.push(sanitizeFlashcardSnapshot(snapshotItem(it), gestureIds));
        });

        if (itemsToShare.length === 0) return;

        const text = itemsToShare.length === 1 ? `Shared Node` : `Shared Canvas Collection`;
        const { data, error } = await supabase
            .from('messages')
            .insert({ friendship_id: f.friendshipId, sender_id: appState.currentUser.id, body: text, canvas_snapshot: itemsToShare })
            .select()
            .single();
        if (error) { console.error('[chat] failed to share card:', error); return; }
        f.messages.push({ id: data.id, senderId: data.sender_id, text: data.body, canvasSnapshot: data.canvas_snapshot, createdAt: data.created_at });

        renderConvoBody(f);
        renderMsgList('');
    }


export { setupDraggingAndClicking };
