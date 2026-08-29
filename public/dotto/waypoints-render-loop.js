import { clearSearch } from './ai-assistant-suggestions.js';
import { appState, btnAdd, canvas, canvasViewportCenterX, contextMenu, itemElId, mirrorItemToSiblingPanes, otherPanesViewingFolder, paneElId, parseItemId, supabase, switchActivePane, world, zoomControl } from './core-state.js';
import { ensureDrawings, makeLayerSVG } from './drawing-connections.js';
import { refreshCanvasCollabForCurrentFolder, renderCollabPill, syncCanvasCollabTitle } from './friends-presence.js';
import { renderFilesList, renderSourcesList } from './hamburger-collab.js';
import { applyTransform, ensureSwTicking, saveSnapshot, scheduleWorkspaceSave, updateContextMenuPosition } from './history-autosave.js';
import { broadcastEditingState, miniLabelForItem, placeCaretEnd, renderRealCardPreview, repositionAllRemoteCursors, syncColorPicker } from './live-presence.js';
import { findNextFreeSlot } from './card-shortcuts.js';
import { closeCellTagPicker } from './source-tags-ai.js';
import { applyConnections } from './srs-connections-core.js';


    // ---------- Waypoint card expand/collapse ----------
    // Three entry points, all sharing the same expand/collapse machinery: hovering the card
    // (read-only, stays open until mouseleave — see the waypoint branch in render()), a direct
    // click (editable — stays open until Enter/Escape/blur, and marks the card with
    // .waypoint-editing so hover/mouseleave leave it alone while typing is in progress), and a
    // jump from the Waypoints hub panel/search/hamburger menu (read-only "peek" — auto-collapses
    // after a couple seconds, unless a hover takes over first). Mirrors the contentEditable
    // placeholder/commit/revert pattern used for the canvas-title breadcrumb rename elsewhere in
    // this file: empty text node + data-placeholder + .crumb-placeholder for "New Waypoint" until
    // the first real keystroke, Enter commits via blur, Escape reverts the visible text then
    // blurs.
 // .item.waypoint's own base width — see globals.css
    // Width can't transition smoothly to/from CSS `width:auto` directly — browsers just snap
    // instead of animating when one end of a `width` transition is auto — so expanding measures
    // the natural (content-based) width first and drives an explicit px-to-px transition instead
    // of relying on the CSS class alone. `.expanded` is only removed once the width transition
    // has actually finished (not immediately) so the name text — which the CSS keys off that
    // same class — stays visible and gets naturally clipped away by overflow:hidden as the box
    // narrows, instead of vanishing in one frame while the box is still wide. Reads/writes the
    // CURRENT live width (via getBoundingClientRect, not an assumption of "at rest") so calling
    // either of these mid-transition — e.g. a hover collapse interrupted by a re-hover — reverses
    // smoothly from wherever the box actually is, not just from its resting states.
    // getBoundingClientRect() returns SCREEN-space pixels (post #world's own scale(scale)
    // transform), but el.style.width is a LOCAL/world-space CSS pixel value that gets scaled
    // AGAIN when the browser renders it — the two only coincide at exactly scale===1. Every
    // measurement below divides by `scale` to convert back to local space before assigning it as
    // a width, otherwise the zoom factor gets applied twice (e.g. at scale 1.5 a card sized
    // itself as if it were 1.5x too wide, then THAT got rendered 1.5x again).
    function expandWaypointCardWidth(el) {
        clearTimeout(el.__waypointWidthTimer);
        const startW = el.getBoundingClientRect().width / appState.scale;
        el.classList.add('expanded');
        el.style.width = ''; // let width:auto take over just long enough to measure the natural size
        const targetW = el.getBoundingClientRect().width / appState.scale;
        el.style.width = startW + 'px';
        void el.offsetWidth; // commit the start point before animating to the target
        el.style.width = targetW + 'px';
    }
    function collapseWaypointCardWidth(el) {
        clearTimeout(el.__waypointWidthTimer);
        el.style.width = (el.getBoundingClientRect().width / appState.scale) + 'px';
        void el.offsetWidth;
        el.style.width = appState.WAYPOINT_COLLAPSED_W + 'px';
        el.__waypointWidthTimer = setTimeout(() => {
            el.classList.remove('expanded');
            el.style.width = '';
        }, 200); // matches .item.waypoint's own .18s width transition + a small buffer
    }
    function expandWaypointCard(el, it, opts) {
        const nameEl = el.querySelector('.waypoint-card-name');
        if (!nameEl) return;
        if (opts && opts.editable) {
            el.classList.add('waypoint-editing');
            // A pending __waypointWidthTimer means a collapse is actively mid-shrink right now
            // (see collapseWaypointCardWidth) — .expanded is still true at this exact moment, but
            // el.style.width is some in-between, still-animating value, not the settled full
            // width. Treated the same as "not expanded yet" below (snap open fresh) rather than
            // freezing at whatever half-collapsed width happened to be live on this click.
            const wasCollapsing = !!el.__waypointWidthTimer;
            clearTimeout(el.__waypointWidthTimer);

            // Content must be set BEFORE the width:auto measurement below, not after — otherwise
            // the box measures/snaps to fit empty content first (all .waypoint-card-name has at
            // that point), then jumps a second time once the real name lands, instead of landing
            // on its final width in one step.
            const isDefaultName = !it.name;
            if (isDefaultName) { nameEl.textContent = ''; nameEl.setAttribute('data-placeholder', 'New Waypoint'); nameEl.classList.add('crumb-placeholder'); }
            else { nameEl.textContent = it.name; }

            // If a hover/peek already had it expanded, leave el.style.width completely alone —
            // it's already pinned to the exact content+padding width (see
            // expandWaypointCardWidth), and the whole point here is that clicking to edit must
            // not change the width at all, not even to the same value via a recompute. Only a
            // genuinely collapsed card (clicked directly, with no prior hover) needs to actually
            // open — instantly, no transition, since it's otherwise still animating open under
            // overflow:hidden while the caret is already (correctly) at the end, so the end of
            // the text — and the caret sitting on it — would only become visible progressively as
            // the box widens, reading as the caret itself lagging into place instead of landing
            // there instantly.
            if (wasCollapsing || !el.classList.contains('expanded')) {
                el.classList.add('waypoint-no-anim');
                el.classList.add('expanded');
                el.style.width = ''; // hand width back to the CSS class (width:auto) for this one instant snap
                void el.offsetWidth; // commit the instant width jump before re-enabling the transition
                el.classList.remove('waypoint-no-anim');
            }

            nameEl.contentEditable = true;
            broadcastEditingState(true);
            // contentEditable flips to true DURING this same click's dispatch, so the click still
            // has a pending default action that places the caret at the click coordinates — that
            // runs AFTER this handler returns and silently undoes a synchronous placement here
            // (same issue as the breadcrumb title rename above). Deferring to a fresh macrotask
            // runs after that default action has settled, so this placement is what actually
            // sticks; the synchronous call is just so there's no flash of a wrong caret position
            // first.
            placeCaretEnd(nameEl);
            setTimeout(() => placeCaretEnd(nameEl), 0);
            nameEl.onblur = () => {
                nameEl.contentEditable = false;
                broadcastEditingState(false);
                nameEl.classList.remove('crumb-placeholder');
                it.name = nameEl.textContent.trim();
                el.classList.remove('waypoint-editing');
                collapseWaypointCardWidth(el);
                scheduleWorkspaceSave();
                syncWaypointToDb(appState.currentFolderId, it);
            };
            nameEl.onkeydown = (ke) => {
                if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
                if (ke.key === 'Escape') { ke.preventDefault(); nameEl.textContent = isDefaultName ? '' : it.name; nameEl.blur(); }
            };
            // Without this the box only ever re-measures at snap-open and on blur (see below) —
            // it'd sit at whatever width it started editing with the entire time you type, only
            // snapping to fit the real content once you click away. Reusing expandWaypointCardWidth
            // itself (rather than duplicating its measure-then-animate logic) keeps every keystroke
            // animating smoothly to the new natural width exactly like the initial snap-open does.
            nameEl.oninput = () => expandWaypointCardWidth(el);
        } else {
            nameEl.textContent = it.name || 'New Waypoint';
            expandWaypointCardWidth(el);
            clearTimeout(appState.waypointPeekTimer);
            // A hover has no fixed duration — mouseleave collapses it instead (see render()) — so
            // only the nav-triggered peek gets a timer.
            if (!(opts && opts.hover)) {
                appState.waypointPeekTimer = setTimeout(() => collapseWaypointCardWidth(el), (opts && opts.peekMs) || 2000);
            }
        }
    }

    // Wires up a waypoint card's wrapper click/hover/drag-expand behavior — mechanically lifted
    // out of the old inline waypoint branch in renderLegacyCardBody, now that waypoint is a real
    // Component (see WaypointCard.jsx, app/dotto/CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS).
    // `el` is WaypointCard's own wrapper, passed in explicitly via document.getElementById rather
    // than derived via closest('.item') — see attachWatermarkBody/attachTitleBody's own comments
    // for why closest() breaks on first mount (child-before-parent layout effect ordering).
    function attachWaypointCardBody(el, it) {
        el.onclick = (e) => {
            e.stopPropagation();
            if (el.classList.contains('waypoint-editing')) return; // already editing — let the native click just reposition the caret
            expandWaypointCard(el, it, { editable: true });
        };
        // el is the item's persistent wrapper node (reused across renders, not recreated), and
        // this runs on every render() call (WaypointCard's own layout effect has no dependency
        // array, matching every converted kind) — a plain addEventListener here would stack a
        // duplicate hover/drag-expand listener per call instead of replacing the old one. Same
        // AbortController fix as setupDraggingAndClicking (app/dotto/canvasItemBehavior.js), kept
        // under its own key since a waypoint card carries both.
        el.__waypointListenerAbort?.abort();
        const { signal: waypointSignal } = (el.__waypointListenerAbort = new AbortController());
        el.addEventListener('mouseenter', () => {
            if (el.classList.contains('waypoint-editing')) return;
            expandWaypointCard(el, it, { editable: false, hover: true });
        }, { signal: waypointSignal });
        el.addEventListener('mouseleave', () => {
            // Typing in progress, or being actively dragged (see below) — stays open
            // regardless of the mouse either way.
            if (el.classList.contains('waypoint-editing') || el.classList.contains('waypoint-dragging')) return;
            collapseWaypointCardWidth(el);
        }, { signal: waypointSignal });
        // Dragging a card around the canvas should show it expanded the whole time it's being
        // moved. It's almost always already expanded by this point anyway (you have to be
        // hovering it to pick it up), but this both guarantees it (e.g. a very fast
        // mousedown-drag before the hover-triggered expand above has settled) and — via
        // .waypoint-dragging above — keeps it that way for the whole drag even in the rare case
        // the cursor doesn't track exactly over the moving card. Only acts once real movement
        // crosses the same 3px threshold setupDraggingAndClicking's own drag detection uses, so a
        // plain click-to-rename (no movement at all) is unaffected.
        el.addEventListener('pointerdown', (e) => {
            if (el.classList.contains('waypoint-editing')) return;
            const downX = e.clientX, downY = e.clientY;
            const onMove = (me) => {
                if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) {
                    el.classList.add('waypoint-dragging');
                    if (!el.classList.contains('expanded')) expandWaypointCard(el, it, { editable: false, hover: true });
                    window.removeEventListener('pointermove', onMove);
                }
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                el.classList.remove('waypoint-dragging');
                // The card moves WITH the cursor during a drag, so it's normally still directly
                // under it at drop — but if it isn't for some reason, there's no future
                // mouseleave to catch it (one may already have fired, and been ignored,
                // mid-drag), so check and collapse explicitly here instead.
                if (!el.classList.contains('waypoint-editing') && !el.matches(':hover')) collapseWaypointCardWidth(el);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }, { signal: waypointSignal });
    }

    // Mirrors one waypoint item into the global `waypoints` table (see the 20260729 migration) —
    // the source of truth for the hamburger Waypoints panel, which lists EVERY waypoint this user
    // has ever dropped across their own canvases and any canvas shared with them, regardless of
    // whether that canvas's folder data happens to be loaded locally right now (a friend's canvas
    // 300 layers deep isn't fetched until you actually navigate into it — see
    // renderWaypointsList/goToWaypointCard below). Fire-and-forget; the canvas item itself already
    // holds the real data (name, position), this is just a searchable/global index of it, keyed by
    // the REAL (non shared:-namespaced) owner+folder id since that's what's stable across users.
    async function syncWaypointToDb(folderId, it) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
        const { error } = await supabase.from('waypoints').upsert({
            creator_id: appState.currentUser.id, owner_id: ownerId, folder_id: realFolderId, item_id: String(it.id),
            name: it.name || 'New Waypoint',
        }, { onConflict: 'owner_id,folder_id,item_id' });
        if (error) console.error('[waypoints] failed to sync waypoint:', error);
    }
    async function deleteWaypointFromDb(folderId, itemId) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
        const { error } = await supabase.from('waypoints').delete()
            .eq('owner_id', ownerId).eq('folder_id', realFolderId).eq('item_id', String(itemId));
        if (error) console.error('[waypoints] failed to remove waypoint:', error);
    }
    // Deletes a waypoint's own canvas-card item (not just the global waypoints-table pointer —
    // deleteWaypointFromDb above only removes that) — used by the hamburger Waypoints panel's
    // shift-click + Backspace gesture (see deleteSelectedWaypointRows, hamburger-collab.js), where
    // the target folder might not even be loaded yet (a friend's shared canvas never navigated
    // into this session — own canvases are always fully loaded up front, see loadWorkspace).
    // For an own canvas, mutating appState.folders[...] + scheduleWorkspaceSave() is enough:
    // saveWorkspaceNow serializes ALL local folders every save cycle, not just the current one, so
    // no navigation is needed. For a shared canvas, load it on demand if not already loaded (same
    // ensureSharedFolderLoaded normal navigation uses), then call update_shared_folder DIRECTLY —
    // bypassing saveWorkspaceNow's "only if currentFolderId" gating, which is a pure client
    // convention, not a constraint of the RPC itself — so deleting one waypoint never yanks the
    // user's current view to a canvas they weren't looking at.
    async function deleteWaypointCardEverywhere(ownerId, folderId, itemId) {
        const isOwn = ownerId === appState.currentUser.id;
        const localKey = isOwn ? folderId : window.__sharedFolderKey(ownerId, folderId);
        if (!appState.folders[localKey]) {
            if (isOwn) { await deleteWaypointFromDb(localKey, itemId); return; }
            if (!(await window.__ensureSharedFolderLoaded(localKey))) {
                // Access revoked or the canvas itself is gone — nothing to patch, just drop the
                // stale global pointer directly (deleteWaypointFromDb needs a loaded folderObj to
                // derive owner/folder from, which we don't have here).
                if (supabase && appState.currentUser.id) {
                    await supabase.from('waypoints').delete()
                        .eq('creator_id', appState.currentUser.id).eq('owner_id', ownerId)
                        .eq('folder_id', folderId).eq('item_id', String(itemId));
                }
                return;
            }
        }
        const folderObj = appState.folders[localKey];
        const stillThere = (folderObj.items || []).some(it => String(it.id) === String(itemId));
        folderObj.items = (folderObj.items || []).filter(it => String(it.id) !== String(itemId));
        await deleteWaypointFromDb(localKey, itemId);
        if (!stillThere) return; // pointer existed, card already gone — nothing left to persist
        if (isOwn) {
            scheduleWorkspaceSave();
        } else {
            const { isSharedView, sharedOwnerId, sharedRemoteFolderId, id, ...folderData } = folderObj;
            folderData.items = window.__stripSharedFolderIds(folderData.items);
            const { error } = await supabase.rpc('update_shared_folder', {
                p_owner_id: sharedOwnerId, p_folder_id: sharedRemoteFolderId, p_new_folder_data: folderData,
            });
            if (error) console.error('[waypoints] failed to remove waypoint card from shared canvas:', error);
        }
        if (appState.currentFolderId === localKey) render();
    }

    // Revokes every pending/accepted collaborator on ONE exact folder — reuses
    // revoke_canvas_collaboration, the same RPC the Collaborations panel's own per-collaborator
    // "remove" button already calls (see revokeCanvasCollab), rather than a new bulk-delete RPC.
    // "Revoked" (not a hard delete of the row) is enough for the folder to disappear from both the
    // owner's and every collaborator's Collaborations list: both of refreshCanvasCollabData's
    // queries filter to status in ('pending','accepted') (see renderHubCollabList). Owner-only —
    // revoke_canvas_collaboration is auth.uid()-scoped with no owner-id parameter, so this can only
    // run against a canvas the current user actually owns; see cascadeDeleteFolderContents below
    // for why that's always true everywhere this gets called from.
    async function deleteCanvasCollabsForFolder(folderId) {
        if (!supabase || !appState.currentUser.id) return;
        const { data, error } = await supabase.from('canvas_collaborations').select('collaborator_id')
            .eq('owner_id', appState.currentUser.id).eq('folder_id', folderId).in('status', ['pending', 'accepted']);
        if (error) { console.error('[collab] failed to look up collaborators for deleted folder:', error); return; }
        await Promise.all((data || []).map(r =>
            supabase.rpc('revoke_canvas_collaboration', { p_folder_id: folderId, p_collaborator_id: r.collaborator_id })
        ));
    }

    // Recursively cleans up everything a deleted folder/source card owned: nested waypoints
    // (removed from the creator's global Waypoints list, same as a directly-deleted waypoint card
    // — see deleteSelectedCards), collaborators on this canvas AND every nested canvas inside it
    // (removed from the Collaborations list, see deleteCanvasCollabsForFolder above), and finally
    // the orphaned folders[] entry itself (the same structural cleanup deleteClonedItemFolders does
    // for a canceled duplicate, just also handling the two DB-backed concerns above along the way).
    // Skips the collaborator cleanup step entirely while folderObj.isSharedView is true — that only
    // happens at the ROOT of this recursion (a nested folder inside a tree you own is never itself
    // a shared view — sharing doesn't work by embedding a foreign owner's canvas inside your own),
    // and it means the current user is a collaborator, not the real owner, deleting content inside
    // someone else's shared canvas. revoke_canvas_collaboration has no permission path for that (see
    // its own comment), so there's nothing safe to do here but skip — any collaborators the real
    // owner added to that specific nested canvas are left for the owner to clean up themselves.
    async function cascadeDeleteFolderContents(folderId) {
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        for (const item of (folderObj.items || [])) {
            if (item.kind === 'waypoint') {
                deleteWaypointFromDb(folderId, item.id);
            } else if ((item.kind === 'folder' || item.kind === 'source') && item.folderId) {
                await cascadeDeleteFolderContents(item.folderId);
            }
        }
        if (!folderObj.isSharedView) {
            await deleteCanvasCollabsForFolder(folderId);
        }
        // Best-effort — a shared-view folder never has its own global_items row under the current
        // (collaborator) user's owner_id in the first place, so this naturally no-ops for those
        // rather than needing its own isSharedView guard like deleteCanvasCollabsForFolder above.
        if (supabase && appState.currentUser.id) {
            const { error: globalItemErr } = await supabase.from('global_items').delete()
                .eq('owner_id', appState.currentUser.id).eq('folder_id', folderId);
            if (globalItemErr) console.error('[global-ids] failed to remove global item for deleted folder:', globalItemErr);
        }
        delete appState.folders[folderId];
    }

    // Static, real-content preview for a folder card's body — same mini-card rendering
    // (renderRealCardPreview) as renderInlineCanvas's marketplace/chat preview, but with no
    // interactivity of its own: no pan, no zoom slider, no in-place drill-down. The whole card
    // is a single click target (see the 'folder' branch in render()) — dragging it moves the
    // card on the real canvas like any other card, it does not pan this preview. Content is
    // auto zoomed-to-fit and centered, floored at 25% so a very large/sprawling nested canvas
    // still reads as *something* rather than shrinking to illegibility. Reads
    // folders[folderId].items live (not a snapshot) since render() rebuilds this fresh on every
    // call anyway.
    function buildFolderInlineCanvas(folderId) {
        const viewport = document.createElement('div');
        viewport.className = 'msg-inline-canvas';
        const world = document.createElement('div');
        world.className = 'msg-inline-canvas-world';
        viewport.appendChild(world);

        const MINI_ZOOM_MAX = 2, MINI_ZOOM_FIT_MIN = 0.25, MINI_ZOOM_FIT_PADDING = 24;
        let contentW = 1, contentH = 1;
        function centerView() {
            const rect = viewport.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const fitZoom = Math.min(
                (rect.width - MINI_ZOOM_FIT_PADDING * 2) / contentW,
                (rect.height - MINI_ZOOM_FIT_PADDING * 2) / contentH
            );
            const vZoom = Math.max(MINI_ZOOM_FIT_MIN, Math.min(MINI_ZOOM_MAX, fitZoom));
            const vPanX = (rect.width - contentW * vZoom) / 2;
            const vPanY = (rect.height - contentH * vZoom) / 2;
            world.style.transform = `translate(${vPanX}px, ${vPanY}px) scale(${vZoom})`;
            viewport.style.backgroundPosition = `${vPanX}px ${vPanY}px`;
            viewport.style.backgroundSize = `${28 * vZoom}px ${28 * vZoom}px`;
        }

        const items = (appState.folders[folderId] && appState.folders[folderId].items) || [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(it => {
            const w = it.w || 100, h = it.h || 60;
            minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
            maxX = Math.max(maxX, it.x + w); maxY = Math.max(maxY, it.y + h);
        });
        if (!items.length) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
        contentW = Math.max(1, maxX - minX);
        contentH = Math.max(1, maxY - minY);

        items.forEach(it => {
            const w = it.w || 100, h = it.h || 60;
            const mini = renderRealCardPreview(it);
            mini.style.position = 'absolute';
            mini.style.left = (it.x - minX) + 'px';
            mini.style.top = (it.y - minY) + 'px';
            if (it.kind !== 'title') {
                mini.style.width = w + 'px';
                mini.style.height = h + 'px';
            }
            mini.style.pointerEvents = 'none';
            mini.title = miniLabelForItem(it);
            world.appendChild(mini);
        });

        requestAnimationFrame(centerView);
        return viewport;
    }

    // Inline-rename a folder/source card's title, right on the card — also reused by the active
    // tab's own breadcrumb trail (TabsBar.jsx's ActiveTabTrail, via
    // window.__startRenameFolderCardTitle) for renaming the current-folder segment, passing a
    // plain {folderId} with no real `.id` — see the
    // targetSelector guard below. Writes to the exact same folders[folderId].title every one of
    // these editors shares, so they all stay in sync for free, no separate propagation needed.
    // Guarded on folders[it.folderId] existing at all: a folder card nested INSIDE a canvas
    // someone else shared with you is a static, non-drillable preview (see the sharing scope note
    // in 20260726_add_canvas_collaboration.sql) with no local data to rename in the first place.
    function startRenameFolderCardTitle(titleEl, it, editingClass, selectAll) {
        editingClass = editingClass || 'folder-card-title';
        const folderId = it.folderId;
        if (!appState.folders[folderId] || titleEl.contentEditable === 'true') return;
        saveSnapshot();
        const fullTitle = appState.folders[folderId].title;
        const isDefaultTitle = fullTitle === 'New Canvas' || fullTitle === 'New Source';
        if (isDefaultTitle) {
            titleEl.textContent = '';
            titleEl.setAttribute('data-placeholder', fullTitle);
            titleEl.classList.add('crumb-placeholder'); // same empty-state placeholder convention as the breadcrumb
        } else {
            titleEl.textContent = fullTitle;
        }
        titleEl.contentEditable = true;
        // No real `#item-X` wrapper to pin a remote caret indicator to for a sidebar row (it's not
        // a canvas element) — omitting targetSelector there just falls back to a plain floating
        // cursor for other viewers, same as the old breadcrumb-title rename always did.
        broadcastEditingState(true, it.id != null ? `#${itemElId(it.id)} .${editingClass}` : undefined);
        titleEl.focus();
        // Same caret-at-end-on-a-deferred-macrotask dance as the breadcrumb rename — see its own
        // comment for why the deferral is load-bearing (a pending native click-to-caret action
        // (or, for a double-click-triggered rename — the Sources panel, selectAll:true — the
        // browser's own native "double-click selects the word under the cursor" behavior) would
        // otherwise silently override this). selectAll (per explicit request, Sources panel only
        // so far) leaves the range spanning the whole title instead of collapsing it to the end,
        // so the very next keystroke replaces the entire name rather than appending to it.
        const applySelection = () => {
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            if (!selectAll) range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        applySelection();
        setTimeout(applySelection, 0);
        titleEl.onblur = () => {
            titleEl.contentEditable = false;
            broadcastEditingState(false);
            titleEl.classList.remove('crumb-placeholder');
            const newTitle = titleEl.textContent.trim();
            if (newTitle) {
                appState.folders[folderId].title = newTitle;
                syncCanvasCollabTitle(folderId, newTitle);
            } else {
                // Aborted edit (blurred without typing anything, or deleted everything back to
                // empty) — appState.folders[folderId].title is deliberately left unchanged above,
                // but titleEl's own live textContent may still be empty (cleared to show the
                // placeholder hint while editing a still-default title, or emptied by deleting real
                // text) and can't be counted on to get fixed up by the render()/React re-render
                // just below: this element's title-card/breadcrumb counterpart may see the exact
                // same string it already believed was there (fullTitle, unchanged either way) and
                // skip touching its own DOM text node as a result, leaving it visibly stuck blank
                // instead of back to normal. Restoring it directly here removes any dependency on
                // that happening — the visible text is correct the instant editing ends, regardless
                // of what render() does or doesn't decide to repaint afterward.
                titleEl.textContent = fullTitle;
            }
            render();
        };
        titleEl.oninput = () => {
            const liveTitle = titleEl.textContent;
            if (liveTitle.trim()) { appState.folders[folderId].title = liveTitle; scheduleWorkspaceSave(); }
        };
        titleEl.onkeydown = (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); titleEl.blur(); }
            if (ke.key === 'Escape') { ke.preventDefault(); titleEl.textContent = isDefaultTitle ? '' : fullTitle; titleEl.blur(); }
        };
    }

    // Live title text for a folder/source card — same appState.folders[folderId].title read the
    // breadcrumb and startRenameFolderCardTitle both use, exposed standalone since CanvasCard/
    // SourceCard (app/dotto/) render it directly and can't reach appState themselves.
    function folderTitle(folderId) {
        return (appState.folders[folderId] && appState.folders[folderId].title) || '';
    }

    // Same reasoning as folderTitle above, for the new global-id display (global-ids.js) —
    // CanvasCard/SourceCard read this directly, no store needed since they already re-render on
    // every canvas update.
    function folderGlobalId(folderId) {
        return (appState.folders[folderId] && appState.folders[folderId].globalId) || '';
    }

    // Wires up a folder (Canvas) card's wrapper click routing — mechanically lifted out of the old
    // inline folder branch in renderLegacyCardBody now that folder is a real Component (see
    // CanvasCard.jsx). `el` is CanvasCard's wrapper, passed in explicitly (via
    // findItemEl(it.id)) rather than derived via closest() — see
    // attachWatermarkBody/attachTitleBody's own comments for why closest('.item') breaks on first
    // mount (child-before-parent layout effect ordering). `el.onclick =` is a plain assignment, not
    // addEventListener, so it's naturally idempotent across repeated calls — no AbortController
    // needed here.
    function attachFolderCardClick(el, it, titleEl) {
        el.onclick = (e) => {
            e.stopPropagation();
            if (e.target.closest('.folder-card-title')) { startRenameFolderCardTitle(titleEl, it); return; }
            openFolder(it.folderId);
        };
    }

    // Same as attachFolderCardClick, for a source card's wrapper — see SourceCard.jsx.
    function attachSourceCardClick(el, it, titleEl) {
        el.onclick = (e) => {
            e.stopPropagation();
            if (e.target.closest('.source-card-title')) { startRenameFolderCardTitle(titleEl, it, 'source-card-title'); return; }
            openFolder(it.folderId);
        };
    }

    // ---------- Main Canvas Render Loop ----------
    // Renders the CURRENTLY ACTIVE pane's own view from scratch — everything from here down to its
    // closing brace is exactly what render() always was, unchanged. Split out under this name so
    // render() itself (just below) can call it a second time per OTHER pane currently viewing the
    // same folder, reusing switchActivePane's existing swap-in-place trick to "borrow" the live
    // canvas/world/appState.currentFolderId bindings this function (and everything it calls —
    // applyConnections, makeLayerSVG, window.__renderConnectionsLayer, etc.) already depends on,
    // rather than threading a paneId through this whole function and everything downstream of it.
    function renderOnce() {
        scheduleWorkspaceSave();
        clearSearch();
        // #items-layer (React-owned canvas item cards — see app/dotto/CanvasItemsLayer.jsx) is a
        // stable, permanent child of #world; only its siblings (drawing/connection SVG layers, the
        // isSource static-table div) get wiped and rebuilt here, in place of #world's own former
        // wholesale world.innerHTML='' (see the canvas-items-react plan, PHASE2_ROADMAP.md).
        Array.from(world.children).forEach(child => { if (child.id !== paneElId('items-layer')) child.remove(); });
        // .media-viewer-fullscreen (isMediaViewer branch, below) is a direct child of `canvas`
        // itself, not `world` — it needs to fill the pane's own real, explicitly-sized canvas box
        // (see .media-viewer-fullscreen's own comment, globals.css, for why `world` can't host it),
        // so the world-wipe just above can't clean up a stale one left over from navigating away
        // from a previous media-viewer folder. Wiped unconditionally, every render, same as world's
        // own children — the isMediaViewer branch below re-adds a fresh one when it applies.
        const staleViewer = canvas.querySelector(':scope > .media-viewer-fullscreen');
        if (staleViewer) staleViewer.remove();
        if(!appState.folders[appState.currentFolderId]) { window.__renderCanvasItems([], appState.activePaneId); return; }
        const folderObj = appState.folders[appState.currentFolderId];
        // Waypoints are private to whoever dropped them — even on a canvas shared with (or by)
        // other people, only the creator ever sees their own waypoint cards (see the 20260729
        // migration/renderWaypointsList). Legacy items from before creatorId existed default to
        // the folder's owner, which is always correct for your own canvases and the conservative
        // choice for shared ones (owner still sees it, collaborators don't, rather than everyone).
        const folderOwnerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const currentItems = folderObj.items.filter(it => it.kind !== 'waypoint' || (it.creatorId || folderOwnerId) === appState.currentUser.id);
        // Location/wayfinding lives in the top-bar tabs bar (see renderBreadcrumbMapPanel,
        // app/dotto/lib/tabManagement.ts, and TabsBar.jsx). The current-folder segment's rename
        // click reuses startRenameFolderCardTitle below, the same flow folder/source cards already
        // use.
        window.__renderBreadcrumbMapPanel();
        // Keeps the active tab's own bookmarked folderId (and its displayed label) in sync with
        // wherever navigation just landed — see renderTabsPanel's own comment,
        // app/dotto/lib/tabManagement.ts, for why this needs to run after literally every navigation,
        // not just ones that went through addTab/switchTab/closeTab directly.
        window.__renderTabsPanel();
        // Sources rail panel (SourcesListPanel.jsx) — every source account-wide (current-canvas
        // ones sorted first), per explicit request; see renderSourcesList's own comment,
        // hamburger-collab.js, for why it's called unconditionally here rather than only on
        // panel-open/search-input, same reasoning as renderBreadcrumbMapPanel/renderTabsPanel just
        // above.
        renderSourcesList();
        // Files rail panel (FilesListPanel.jsx) — every uploaded kind:'media' item account-wide
        // (current-canvas ones sorted first), same reasoning/pattern as renderSourcesList just
        // above (see renderFilesList's own comment, hamburger-collab.js) — copied from it per
        // explicit request, including this call site.
        renderFilesList();
        // Outline rail panel (app/dotto/lib/outlineTree.ts) — per explicit request that it reflect
        // whatever page navigation just landed on, and any rename that just happened anywhere on
        // the canvas, without needing to be closed and reopened first. Same unconditional-on-every-
        // render() reasoning as the three calls just above, but buildOutline itself needed a
        // preserveState param first (true here) — unlike those three, its own from-scratch build
        // used to always reset the panel's scroll position and blow away any in-progress search
        // text, which was fine for a fresh panel-OPEN (still is — see buildOutline's own comment,
        // app/dotto/lib/outlineTree.ts, and toggleHamburgerMenu's own call, which passes no argument)
        // but would otherwise re-fire on every one of this function's many other callers too,
        // constantly yanking focus/scroll out from under someone actively browsing or searching an
        // already-open outline.
        window.__buildOutline(true);

        renderCollabPill();

        // A file opened full-screen in its own tab (window.__openMediaViewerTab,
        // app/dotto/lib/tabManagement.ts, explicit request/correction — "a new tab in the app... full
        // screen and scrollable") — same "a folder that renders something completely different from
        // the normal item canvas" shape folderObj.isSource already established just below, reusing
        // that exact same toolbar-hiding/identity-camera setup. Appended directly to `canvas` (not
        // `world`, unlike isSource's own static-table div) since it needs to fill the pane's own
        // real, explicitly-sized canvas box — see .media-viewer-fullscreen's own comment,
        // globals.css. window.__buildEpubViewer is a bridge (app/dotto/lib/mediaPdfEpub.ts) rather than a direct
        // import — that file already imports render() FROM this one, so importing back would be
        // circular.
        if (folderObj.isMediaViewer) {
            canvas.classList.add('static-source');
            btnAdd.style.display = 'none';
            appState.modeToolbar.style.display = 'none';
            zoomControl.style.display = 'none';
            appState.tx = 0; appState.ty = 0; appState.scale = 1; applyTransform();
            const item = folderObj.mediaItem;
            const viewer = document.createElement('div');
            viewer.className = 'media-viewer-fullscreen';
            if (item.mediaType === 'video') {
                viewer.innerHTML = `<video src="${item.mediaSrc}" controls autoplay></video>`;
            } else if (item.mediaType === 'pdf') {
                viewer.innerHTML = `<iframe src="${item.mediaSrc}" title="${item.mediaName || 'PDF'}"></iframe>`;
            } else if (item.mediaType === 'epub') {
                viewer.appendChild(window.__buildEpubViewer(item));
            } else {
                viewer.innerHTML = `<img src="${item.mediaSrc}" alt="${item.mediaName || ''}"/>`;
            }
            // --viewer-zoom (globals.css) — read from the folder object (the real, persistent
            // owner of this pane's current zoom level, see renderMediaViewerZoom's own comment)
            // rather than always starting at 1, so navigating away and back (or a sibling pane
            // sync, render()'s own wrapper) doesn't silently reset a zoom the user already set.
            viewer.style.setProperty('--viewer-zoom', folderObj.viewerZoom || 1);
            canvas.appendChild(viewer);
            window.__renderNavArrows();
            renderMediaViewerZoom(appState.activePaneId);
            window.__renderCanvasItems([], appState.activePaneId);
            return;
        }
        renderMediaViewerZoom(appState.activePaneId);

        if (folderObj.isSource) {
            canvas.classList.add('static-source');
            // Was appState.addToolbar (the #add-toolbar wrapper div around #btn-add) — that wrapper
            // was removed when the rail was split into six .rail-group sections (top-bar.html);
            // #btn-add now sits directly in its own group with no wrapper of its own, so this just
            // hides the button itself instead, same visual result.
            btnAdd.style.display = 'none';
            appState.modeToolbar.style.display = 'none';
            zoomControl.style.display = 'none';
            appState.tx = 0; appState.ty = 0; appState.scale = 1; applyTransform();
            let tableItem = folderObj.items.find(i => i.kind === 'table');
            if (!tableItem) {
                tableItem = { id: appState.idCounter++, x: 0, y: 0, w: 0, h: 0, kind: 'table', tableData: [['', ''], ['', ''], ['', ''], ['', '']] };
                folderObj.items.push(tableItem);
            }
            const el = document.createElement('div');
            el.className = 'item table static-table';
            el.id = itemElId(tableItem.id);
            el.innerHTML = window.__renderStaticTableHTML(tableItem, appState.currentFolderId);
            world.appendChild(el);
            window.__attachStaticTableHoverZones(el, tableItem);
            window.__layoutSourceTableColumns(tableItem, el);
            window.__renderNavArrows();
            // isSource folders never reach the real item list below — #items-layer must be told
            // there's nothing to show, or it would keep showing whatever the previous folder had.
            window.__renderCanvasItems([], appState.activePaneId);
            return;
        }
        canvas.classList.remove('static-source');
        btnAdd.style.display = 'flex';
        appState.modeToolbar.style.display = '';
        zoomControl.style.display = '';
        window.__closeSourceAddMenu(); closeCellTagPicker();

        applyConnections(folderObj);

        const backLayer = makeLayerSVG(0);
        const frontLayer = makeLayerSVG(2);
        ensureDrawings(folderObj).forEach(dw => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', dw.d);
            path.setAttribute('stroke', dw.color);
            path.setAttribute('stroke-width', String(dw.width || 3));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            (dw.layer === 'back' ? backLayer : frontLayer).appendChild(path);
        });
        // #items-layer (see above) is a stable, never-removed child that's always exactly where
        // the scoped wipe left it — insertBefore it (not appendChild) is what keeps these under
        // the item cards in paint order, matching the original back-layer/connections/items/front-
        // layer stacking exactly. world.appendChild(frontLayer) below is correct as a plain append:
        // #items-layer is the only other real child left at that point, so appending still lands
        // frontLayer after it.
        const itemsLayer = document.getElementById(paneElId('items-layer'));
        world.insertBefore(backLayer, itemsLayer);
        world.insertBefore(window.__renderConnectionsLayer(folderObj, currentItems), itemsLayer);

        // React (app/dotto/CanvasItemsLayer.jsx) owns creating/keying/removing each item's wrapper
        // <div id={itemElId(id)}> inside #items-layer — see the canvas-items-react plan in
        // PHASE2_ROADMAP.md. This bridge call is a synchronous flushSync under the hood
        // (app/dotto-app.jsx), so every item's wrapper div (and, via each CanvasItem's
        // useLayoutEffect, its body content — see renderLegacyCardInto below) already exists in the
        // DOM by the time this call returns, matching the old synchronous
        // createElement+appendChild guarantee callers like the alt-duplicate-drag path in
        // drag-drop-chat.js depend on.
        window.__renderCanvasItems(currentItems, appState.activePaneId);

        world.appendChild(frontLayer);
        if (appState.addingKind && appState.placementGhost) world.appendChild(appState.placementGhost);
        window.__renderNavArrows();

        // Sync visual selected outlines state
        renderSelectedOutlines();
        ensureSwTicking();
        // #items-layer's contents were just refreshed above (see window.__renderCanvasItems) — any
        // element a remote collaborator was shown editing (see applyRemoteCursorMode) may be a
        // fresh DOM node now if that item's props actually changed (React reuses unchanged items'
        // nodes, but a real content change still replaces the node's innerHTML the same as the old
        // full rebuild did), so the highlight/caret/label all need reapplying (or the cursor needs
        // to reappear, if that target no longer exists at all — e.g. the card was deleted out from
        // under them).
        repositionAllRemoteCursors();
    }

    // Live cross-pane sync (explicit request: "if you have two same pages open in split screen,
    // doing something in one updates the other instantly"). appState.folders (items, drawings,
    // connections, etc.) is genuinely shared, global state — NOT one of PANE_SCOPED_FIELDS
    // (core-state.js) — so a card add/edit/move/delete already lands in data every pane can see;
    // the actual gap was that renderOnce() above only ever rebuilds the ACTIVE pane's own DOM
    // (#world/#canvas, whichever the live canvas/world bindings currently point at) and only ever
    // pushes to that pane's own canvasItemsStore slot (window.__renderCanvasItems(...,
    // appState.activePaneId)) — an inactive sibling pane looking at the exact same folder wouldn't
    // see the change until IT next became active. render() itself is the one universal "something
    // on this canvas changed" signal already — dozens of call sites across the app (item drag end,
    // add/delete, realtime remote updates, etc.) all funnel through it — so hooking sibling-sync in
    // HERE, once, covers every one of them for free instead of chasing down each call site.
    // syncSiblings defaults true for every real caller; false is only ever used for the recursive
    // per-sibling calls below, so this never cascades into checking siblings-of-siblings.
    function render(syncSiblings = true) {
        renderOnce();
        if (!syncSiblings) return;
        const targetFolderId = appState.currentFolderId;
        const originalPaneId = appState.activePaneId;
        otherPanesViewingFolder(targetFolderId, originalPaneId).forEach((paneId) => {
            switchActivePane(paneId);
            renderOnce();
        });
        // switchActivePane no-ops if already on the target, so this is only a real switch back
        // when the loop above actually moved off originalPaneId.
        if (appState.activePaneId !== originalPaneId) switchActivePane(originalPaneId);
    }

    // Wrapper <div> attributes every item gets regardless of kind — split out of the old single
    // renderLegacyCardInto (canvas-items-react plan, PHASE2_ROADMAP.md) so a kind's own Component
    // (see CARD_KIND_COMPONENTS in app/dotto/CanvasItemsLayer.jsx) doesn't have to duplicate this
    // formula (and can't easily anyway: link-source-armed/options-open read appState, which
    // app/dotto/ can't import). `el` is always the item's live wrapper node — reused across
    // calls, never recreated, so every assignment below is a plain overwrite exactly as it always
    // was on a freshly created node.
    function applyItemWrapperAttrs(el, it) {
        el.className = `item ${it.kind}`;
        el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
        if (it.zIndex) el.style.zIndex = it.zIndex;
        // Re-applied on every call (rather than left as a one-off class toggle) since el.className
        // above already resets the base class list — see handleDataModeClick. 'sized' needs the
        // same treatment: TableCard.jsx's own layout effect also adds it once it.userSized is
        // true, but that effect runs on the CHILD (TableCard), and React fires child layout
        // effects before the parent's (CanvasItem, which calls this) — so TableCard's 'sized' was
        // getting added, then immediately stripped right back off by this function's own
        // el.className reset one effect later, on every render (including the one after a plain
        // drag-move, not just a resize). The wrapper kept its correct inline width/height (set in
        // the 'else' branch below) but the table itself fell back to CSS's width:auto/
        // table-layout:auto default without 'sized' — reading as "resize looks right, but move it
        // and the table shrinks back to tiny inside its still-correctly-sized background."
        if (it.kind === 'table' && it.userSized) el.classList.add('sized');
        if (appState.dataLinkPendingId === it.id) el.classList.add('link-source-armed');
        if (it.optionsOpen) el.classList.add('options-open');
        if (it.kind !== 'title' && it.kind !== 'waypoint') {
            if (it.kind === 'table' && !it.userSized) {
                // Sizing handled automatically
            } else if (it.kind === 'note') {
                // Width only — height is always automatic (content + current width drive it via
                // plain CSS auto-sizing, see .item.note/.body, globals.css), never pinned from
                // it.h here. it.h still gets kept in sync (see attachNoteBody's ResizeObserver)
                // purely for other systems that read a card's height (collision detection when
                // placing new cards, connection-line anchor points) — nothing here applies it.
                el.style.width = it.w + 'px';
            } else {
                el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
            }
        }
    }

    // Click-to-edit contentEditable lifecycle for the note card (the default/untyped kind), plus
    // format-bar wiring — mechanically lifted out of the old default branch in
    // renderLegacyCardBody, now that note is a real Component (see NoteCard.jsx, app/dotto/
    // CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS). Stays vanilla rather than becoming React state
    // for the same reason attachWatermarkBody/attachTitleBody do — it's coupled to
    // appState.currentEditingEl/broadcastEditingState. Takes `el` (the wrapper) directly, not a
    // body ref like attachWatermarkBody/attachTitleBody — NoteCard's own top-level content is a
    // Fragment (format-bar/body/resize are siblings, matching the original markup), so there's no
    // single child ref that would reach `el` via closest() the way those two do.
    // Height is never touched here (or anywhere else for notes) — always automatic, driven purely
    // by plain CSS auto-sizing at whatever width the card currently is (see .item.note/.body,
    // globals.css): the wrapper is a flex column with no explicit height and .body sizes to its own
    // content, so typing and resizing the width both just reflow the text and the browser does the
    // rest, with zero JS measurement needed. No more "More…"/expand-collapse clipping toggle — a
    // note now always shows its full content.
    function attachNoteBody(el, it, paneId = appState.activePaneId) {
        const b = el.querySelector('.body');
        // Purely a read: keeps it.h in sync with the real rendered height for OTHER systems that
        // still read a card's height (collision detection when placing new cards, connection-line
        // anchor points) — nothing here drives layout from it. Created once per element (guarded by
        // the marker, same reuse pattern as b.__noteListenerAbort below) since this function reruns
        // on every render() call (no dependency array on NoteCard's own layout effect).
        if (!el.__noteHeightObserver) {
            el.__noteHeightObserver = new ResizeObserver(() => {
                it.h = Math.round(el.getBoundingClientRect().height / appState.scale);
            });
            el.__noteHeightObserver.observe(el);
        }
        b.__noteListenerAbort?.abort();
        const { signal } = (b.__noteListenerAbort = new AbortController());
        b.onblur = (e) => { if(e.relatedTarget && (e.relatedTarget.closest('.format-bar') || e.relatedTarget.closest('.resize'))) return; el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); b.scrollTop = 0; scheduleWorkspaceSave(); };
        // Live per-keystroke commit+sync — see the identical comment on the title body in
        // attachTitleBody.
        // Live per-keystroke commit + cross-pane mirror — explicit request that text edits be fully
        // live (keystroke by keystroke) in any sibling pane viewing this same folder, not just once
        // editing ends and render() next runs. it.html itself is shared data (updated above,
        // already visible to a sibling the NEXT time IT re-renders) — mirrorItemToSiblingPanes just
        // pushes the same innerHTML into that sibling's own `.body` element right now, this tick,
        // rather than waiting.
        b.oninput = () => {
            it.html = b.innerHTML;
            scheduleWorkspaceSave();
            mirrorItemToSiblingPanes(it.id, (el) => { const siblingBody = el.querySelector('.body'); if (siblingBody) siblingBody.innerHTML = it.html; });
        };
        b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
        b.onfocus = () => { syncColorPicker(b); syncNoteFormatButtons(b); };
        b.addEventListener('keyup', () => { syncColorPicker(b); syncNoteFormatButtons(b); }, { signal });
        b.addEventListener('click', () => { syncColorPicker(b); syncNoteFormatButtons(b); }, { signal });
        el.onclick = (e) => {
            e.stopPropagation();
            if (appState.currentEditingEl !== el) saveSnapshot();
            el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#' + itemElId(it.id, paneId)); } appState.currentEditingEl = el;
        };
        window.__setupResizing(el, it);
    }

    // Reflects the note body's current bold/italic/underline/strikethrough state at the caret (or
    // selection) onto the matching format-bar button's .active class — same "sync UI to the live
    // editor state" job syncColorPicker already does for the color swatch, just for
    // document.queryCommandState instead of queryCommandValue. Called from the same
    // onfocus/keyup/click triggers as syncColorPicker, plus directly after a format button's own
    // click (see NoteCard.jsx) so a button reflects its own just-applied toggle immediately rather
    // than waiting for the next keyup/click on the body itself.
    function syncNoteFormatButtons(bodyEl) {
        const bar = bodyEl.closest('.item')?.querySelector('.format-bar');
        if (!bar) return;
        bar.querySelectorAll('[data-cmd]').forEach(btn => {
            try { btn.classList.toggle('active', document.queryCommandState(btn.dataset.cmd)); } catch (e) {}
        });
    }

    // Behavior every item gets regardless of kind or whether its body is legacy-rendered or a
    // real Component — the other half of the old renderLegacyCardInto split (see
    // applyItemWrapperAttrs above). Must run for every kind, including converted ones: the
    // aiGenerated badge, right-click suppression, and — critically — drag/click wiring
    // (setupDraggingAndClicking) aren't kind-specific.
    function attachUniversalItemBehavior(el, it) {
            // Kind-agnostic — covers every drag-to-canvas Dotbot result (dictionary/answer/
            // mnemonic story/image, all still kind:'note', plus the new 'sentence' cards), since
            // importDotbotResultAtScreenPoint sets aiGenerated:true on all of them in one place.
            if (it.aiGenerated) {
                const badge = document.createElement('div');
                badge.className = 'item-ai-badge';
                badge.textContent = 'Generated content may be inaccurate';
                el.appendChild(badge);
            }
            // Per-card right-click menu: table cards get the shared #context-menu align-pill
            // (Delete is keyboard-only — see deleteSelectedCards, card-shortcuts.js — not a
            // menu item here); flashcard/typeright game cards instead slide their own in-card
            // options panel into
            // view (see openGameOptionsPanel/renderGameOptionsHTML) — only these two kinds have a
            // real front/back notion today, so other game-category placeholders (blanks/match/
            // audiotype) get no right-click menu, same as any other non-table kind. Right-clicking
            // again while the panel is already open toggles it back to the normal card view,
            // rather than just re-opening (already-open) options.
            el.oncontextmenu = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (it.kind === 'flashcard' || it.kind === 'typeright') {
                    if (it.optionsOpen) window.__closeGameOptionsPanel(it.id); else window.__openGameOptionsPanel(it.id);
                    return;
                }
                if (it.kind !== 'table') return;
                contextMenu.style.display = 'flex';
                appState.contextMenuItemId = it.id;
                updateContextMenuPosition();
                contextMenu.dataset.id = it.id;
                const pill = document.getElementById('align-pill');
                pill.style.display = 'flex';
                pill.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.align === (it.textAlign || 'left')));
            };
        window.__setupDraggingAndClicking(el, it);
    }

    // Click-to-edit contentEditable lifecycle for the watermark card's body — mechanically lifted
    // out of the old inline watermark branch in renderLegacyCardBody, now that watermark is a real
    // Component (see WatermarkCard.jsx, app/dotto/CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS).
    // Stays vanilla rather than becoming React state because it's coupled to appState.currentEditingEl
    // and broadcastEditingState, both shared with other still-unconverted click-to-edit kinds
    // (title, note) — splitting just this one kind off that shared lifecycle would be a bigger,
    // riskier rewrite than the rendering change this PR is actually making. `b` is the body element
    // WatermarkCard renders (a ref, not created here); `el` is its wrapper, passed in explicitly
    // rather than found via b.closest('.item') — React fires a CHILD component's layout effect
    // (WatermarkCard's own, which calls this) before its PARENT's (CanvasItem's, which is what
    // actually sets className="item watermark" via applyItemWrapperAttrs), so on first mount
    // closest('.item') ran too early and matched nothing, throwing on el.classList/el.onclick
    // below. findItemEl(it.id) (see WatermarkCard.jsx) doesn't have this
    // problem — the wrapper <div> itself already exists in the DOM by the time ANY layout effect
    // runs (React commits DOM mutations before firing effects), only its className is what's not
    // set yet.
    function attachWatermarkBody(el, b, it, paneId = appState.activePaneId) {
        b.onblur = (e) => { el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); scheduleWorkspaceSave(); };
        // Live per-keystroke commit+sync — see the identical comment on the title body in
        // renderLegacyCardBody.
        // Live per-keystroke commit + cross-pane mirror — explicit request that text edits be fully
        // live (keystroke by keystroke) in any sibling pane viewing this same folder, not just once
        // editing ends and render() next runs. it.html itself is shared data (updated above,
        // already visible to a sibling the NEXT time IT re-renders) — mirrorItemToSiblingPanes just
        // pushes the same innerHTML into that sibling's own `.body` element right now, this tick,
        // rather than waiting.
        b.oninput = () => {
            it.html = b.innerHTML;
            scheduleWorkspaceSave();
            mirrorItemToSiblingPanes(it.id, (el) => { const siblingBody = el.querySelector('.body'); if (siblingBody) siblingBody.innerHTML = it.html; });
        };
        b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
        el.onclick = (e) => {
            e.stopPropagation();
            if (appState.currentEditingEl !== el) saveSnapshot();
            el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#' + itemElId(it.id, paneId)); } appState.currentEditingEl = el;
        };
    }

    // Click-to-edit contentEditable lifecycle for the title card's body, plus wiring the format-
    // bar's color-picker swatch to stay in sync with the caret's current color — mechanically
    // lifted out of the old inline title branch in renderLegacyCardBody, now that title is a real
    // Component (see TitleCard.jsx, app/dotto/CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS). Stays
    // vanilla rather than becoming React state for the same reason attachWatermarkBody does: it's
    // coupled to appState.currentEditingEl/broadcastEditingState, shared with other still-
    // unconverted click-to-edit kinds (note). `el` is passed in explicitly rather than found via
    // b.closest('.item') — see attachWatermarkBody's own comment for why that broke on first
    // mount (child-before-parent layout effect ordering).
    //
    // b.addEventListener (keyup/click, for syncColorPicker) needs the same AbortController
    // idempotency fix as setupDraggingAndClicking/setupResizing: this runs on every render() call
    // (TitleCard's own layout effect has no dependency array, matching every converted kind), and
    // `b` is a persistent node reused across those calls, not recreated.
    function attachTitleBody(el, b, it, paneId = appState.activePaneId) {
        b.__titleListenerAbort?.abort();
        const { signal } = (b.__titleListenerAbort = new AbortController());
        b.onblur = (e) => { if(e.relatedTarget && (e.relatedTarget.closest('.format-bar'))) return; el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); scheduleWorkspaceSave(); };
        // Live per-keystroke commit+sync — see the identical comment on the note body in
        // renderLegacyCardBody.
        // Live per-keystroke commit + cross-pane mirror — explicit request that text edits be fully
        // live (keystroke by keystroke) in any sibling pane viewing this same folder, not just once
        // editing ends and render() next runs. it.html itself is shared data (updated above,
        // already visible to a sibling the NEXT time IT re-renders) — mirrorItemToSiblingPanes just
        // pushes the same innerHTML into that sibling's own `.body` element right now, this tick,
        // rather than waiting.
        b.oninput = () => {
            it.html = b.innerHTML;
            scheduleWorkspaceSave();
            mirrorItemToSiblingPanes(it.id, (el) => { const siblingBody = el.querySelector('.body'); if (siblingBody) siblingBody.innerHTML = it.html; });
        };
        b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
        b.onfocus = () => syncColorPicker(b);
        b.addEventListener('keyup', () => syncColorPicker(b), { signal });
        b.addEventListener('click', () => syncColorPicker(b), { signal });
        el.onclick = (e) => {
            e.stopPropagation();
            if (appState.currentEditingEl !== el) saveSnapshot();
            el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#' + itemElId(it.id, paneId)); } appState.currentEditingEl = el;
        };
    }

    function renderSelectedOutlines() {
        document.querySelectorAll('.item').forEach(el => {
            const id = parseItemId(el);
            if (Number.isNaN(id)) return; // merged-folder items (string "folder-N" ids) and non-canvas .item elements
            el.classList.toggle('selected', appState.selectedCardIds.includes(id));
        });
    }

    // Shift+drag on empty canvas: draw a selection window and select any card
    // that overlaps it even slightly, adding to whatever is already selected.
    function startBoxSelection(e) {
        const rect = canvas.getBoundingClientRect();
        const baseSelection = appState.selectedCardIds.slice();
        const startClientX = e.clientX, startClientY = e.clientY;

        const box = document.createElement('div');
        box.id = 'selection-box';
        box.style.cssText = 'position:fixed;border:1px dashed var(--brand);border-radius:5px;background:rgba(99,102,241,0.05);z-index:1500;pointer-events:none;';
        document.body.appendChild(box);

        const updateBoxRect = (curX, curY) => {
            const x = Math.min(startClientX, curX), y = Math.min(startClientY, curY);
            const w = Math.abs(curX - startClientX), h = Math.abs(curY - startClientY);
            box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
            return { x, y, w, h };
        };
        updateBoxRect(startClientX, startClientY);

        const move = (me) => {
            const { x, y, w, h } = updateBoxRect(me.clientX, me.clientY);
            // Convert the screen-space selection window into world coordinates
            const wx0 = (x - rect.left - appState.tx) / appState.scale, wy0 = (y - rect.top - appState.ty) / appState.scale;
            const wx1 = (x + w - rect.left - appState.tx) / appState.scale, wy1 = (y + h - rect.top - appState.ty) / appState.scale;

            const items = (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items) || [];
            const hitIds = items.filter(it => {
                const ix0 = it.x, iy0 = it.y, ix1 = it.x + (it.w || 0), iy1 = it.y + (it.h || 0);
                // Any overlap at all counts as a hit (even a sliver)
                return ix0 < wx1 && ix1 > wx0 && iy0 < wy1 && iy1 > wy0;
            }).map(it => it.id);

            appState.selectedCardIds = Array.from(new Set([...baseSelection, ...hitIds]));
            renderSelectedOutlines();
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            box.remove();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    function performMerge(source, targetEl) {
        const tid = parseItemId(targetEl);
        const target = appState.folders[appState.currentFolderId].items.find(i => i.id === tid);
        if(!target || target.kind !== 'folder') return;
        saveSnapshot();
        source.x = findNextFreeSlot(target.folderId);
        source.y = 28;
        appState.folders[target.folderId].items.push(source);
        appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => i.id !== source.id);
        openFolder(target.folderId);
    }

    function centerOnContent() {
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
        const items = appState.folders[appState.currentFolderId] ? appState.folders[appState.currentFolderId].items : [];
        appState.scale = 1;
        if (!items.length) {
            appState.tx = canvasViewportCenterX(); appState.ty = window.innerHeight / 2;
            applyTransform();
            return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(it => {
            const w = it.kind === 'title' ? (it.w || 100) : it.w;
            const h = it.kind === 'title' ? (it.h || 50) : it.h;
            minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
            maxX = Math.max(maxX, it.x + w); maxY = Math.max(maxY, it.y + h);
        });
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        appState.tx = canvasViewportCenterX() - cx;
        appState.ty = window.innerHeight / 2 - cy;
        applyTransform();
    }

    // Shared by every navigation entry point (opening a folder, back/forward, breadcrumb ".."):
    // saves the OUTGOING folder's pan/zoom as folders[id].lastView (skipped for sources/media-
    // viewers, which never remember one), switches currentFolderId, re-renders, then either
    // restores the incoming folder's saved view or centers fresh on first-ever visit. Source/
    // media-viewer folders always reset regardless — render() itself unconditionally forces
    // tx/ty/scale back to a fixed 0/0/1 static transform for them (see the `folderObj.isSource`/
    // `folderObj.isMediaViewer` branches inside render()), so there's nothing to restore or
    // center for either here — without this same exclusion, centerOnContent()'s own camera math
    // (meant for a normal folder's real item positions) would run right after and stomp that
    // fixed transform straight back out.
    function applyFolderView(folderId) {
        const outgoing = appState.folders[appState.currentFolderId];
        if (outgoing && !outgoing.isSource && !outgoing.isMediaViewer) outgoing.lastView = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.currentFolderId = folderId;
        render();
        const target = appState.folders[folderId];
        if (target && !target.isSource && !target.isMediaViewer) {
            if (target.lastView) {
                appState.tx = target.lastView.tx; appState.ty = target.lastView.ty; appState.scale = target.lastView.scale;
                applyTransform();
            } else {
                centerOnContent();
            }
        }
        // Fire-and-forget — updates the collab bubble/pill once it resolves rather than blocking
        // navigation on a round trip. renderCollabPill() itself already no-ops for root/shared
        // canvases, so this is harmless even when it doesn't apply.
        refreshCanvasCollabForCurrentFolder().then(renderCollabPill);
    }

    // Drills into a folder/source, pushing new history (truncating any forward history, same as
    // clicking a link in a browser). A shared: key not yet fetched (see below) is loaded first —
    // every existing call site already just fires this without awaiting it (a normal click
    // handler), which still works fine now that it's async.
    async function openFolder(folderId) {
        if (folderId.startsWith('shared:') && !appState.folders[folderId] && !(await window.__ensureSharedFolderLoaded(folderId))) return;
        appState.historyStack = appState.historyStack.slice(0, appState.historyIndex + 1);
        appState.historyStack.push(folderId);
        appState.historyIndex++;
        applyFolderView(folderId);
    }

    // Drops a Files-panel row onto a pane's own canvas (window.__spawnMediaItemAt,
    // FilesListPanel.jsx's new drag gesture — explicit request: "dragging a file from the sidebar
    // onto canvas places it on canvas"). Spawns a genuinely NEW item (a fresh id, kind:'media')
    // copying `source`'s own media fields rather than moving it — `source` stays exactly where it
    // already lives, same "drag copies, doesn't relocate" behavior the Blocks panel's own drag-into-
    // folder gesture already established for a different kind of row. Same screen→world conversion
    // formula placementGhostWorldPos (app/dotto/lib/copyPaste.ts) already uses for click-to-place — canvas/
    // appState.tx/ty/scale only ever describe the ACTIVE pane's own live camera, so a drop on a
    // different (inactive) pane activates it first (same "interacting with a pane's own UI focuses
    // that pane" convention every other per-pane action in this codebase follows), which is what
    // makes `canvas`/`appState.tx/ty/scale` resolve to THAT pane's own values by the time this reads
    // them. w/h copied from `source` (not a fresh default size) so the dropped copy looks the same
    // size as the row it came from; docAspectRatio carried over too, for a dropped PDF/media card
    // whose own aspect lock (setupResizing's media branch, canvasItemBehavior.js) depends on it.
    function spawnMediaItemAt(source, clientX, clientY, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (!appState.folders[appState.currentFolderId]) return;
        const rect = canvas.getBoundingClientRect();
        const w = source.w || 340, h = source.h || 440;
        const x = Math.round((((clientX - rect.left - appState.tx) / appState.scale) - w / 2) / 28) * 28;
        const y = Math.round((((clientY - rect.top - appState.ty) / appState.scale) - h / 2) / 28) * 28;
        const item = {
            id: appState.idCounter++, x, y, w, h, kind: 'media',
            mediaType: source.mediaType, mediaSrc: source.mediaSrc, mediaName: source.mediaName,
            // Copies `source`'s own mediaFileId rather than minting a fresh one — this new card is
            // another instance of the SAME uploaded file (explicit request/bug report: dragging a
            // file onto canvas was silently duplicating it in the Files sidebar), not a new upload.
            // Keeping the same id is what lets renderFilesList (hamburger-collab.js) correctly
            // recognize both cards as one file and only ever show a single row for it, while the
            // Outline panel (which has no dedup logic of its own) keeps listing every card
            // instance individually, per explicit request.
            mediaFileId: source.mediaFileId,
        };
        if (source.docAspectRatio) item.docAspectRatio = source.docAspectRatio;
        appState.folders[appState.currentFolderId].items.push(item);
        render();
        scheduleWorkspaceSave();
    }

    // Media-viewer zoom, one per pane (window.__mediaViewerZoomStore, app/dotto/PaneZoomBar.jsx —
    // explicit request/spec: "allow zooming in and out of the document, with the default 100% zoom
    // being the document at 100% width of the window"). paneId defaults to the live active pane,
    // same reasoning as renderNavArrows/renderCollabPill's own default — only ever meaningful for
    // whichever pane is currently active while called from render()'s per-frame loop, but also
    // called explicitly from switchActivePane (core-state.js) so a newly-active pane's own zoom
    // doesn't wait a frame. Reads the REAL zoom value off the folder object itself
    // (folderObj.viewerZoom) — this store is just the React-facing mirror of it (see its own
    // comment, bridges.js).
    function renderMediaViewerZoom(paneId = appState.activePaneId) {
        const folderId = paneId === appState.activePaneId ? appState.currentFolderId : (appState.panes[paneId] && appState.panes[paneId].currentFolderId);
        const folderObj = appState.folders[folderId];
        window.__setMediaViewerZoom(paneId, { show: !!(folderObj && folderObj.isMediaViewer), zoom: (folderObj && folderObj.viewerZoom) || 1 });
    }

    // Applies a NEW zoom level to an already-open media-viewer tab (PaneZoomBar.jsx's +/-/reset
    // buttons) WITHOUT going through a full render() — a full render() would tear down and rebuild
    // the whole .media-viewer-fullscreen div (see the isMediaViewer branch above), which for an
    // <iframe> (a PDF's own native viewer) or the epub.js-owned .epub-viewer would reset its
    // internal scroll position/reading location on every single zoom click. Instead this directly
    // restyles the ALREADY-LIVE viewer element's own --viewer-zoom custom property (globals.css) in
    // place, same "mutate the DOM directly, skip render()" shape the live drag/resize mirroring
    // (mirrorItemToSiblingPanes, core-state.js) already established this session for the identical
    // reason. Clamped to a sane 25%-400% range. No-ops if the target pane's current folder isn't
    // actually a media-viewer (stale click racing a navigation away, extremely unlikely but cheap
    // to guard).
    const MEDIA_VIEWER_ZOOM_MIN = 0.25, MEDIA_VIEWER_ZOOM_MAX = 4;
    function setMediaViewerZoom(paneId, zoom) {
        const clamped = Math.max(MEDIA_VIEWER_ZOOM_MIN, Math.min(MEDIA_VIEWER_ZOOM_MAX, zoom));
        const folderId = paneId === appState.activePaneId ? appState.currentFolderId : (appState.panes[paneId] && appState.panes[paneId].currentFolderId);
        const folderObj = appState.folders[folderId];
        if (!folderObj || !folderObj.isMediaViewer) return;
        folderObj.viewerZoom = clamped;
        const canvasEl = document.getElementById(paneElId('canvas', paneId));
        const viewer = canvasEl && canvasEl.querySelector(':scope > .media-viewer-fullscreen');
        if (viewer) viewer.style.setProperty('--viewer-zoom', clamped);
        window.__setMediaViewerZoom(paneId, { show: true, zoom: clamped });
        scheduleWorkspaceSave();
    }

export { applyFolderView, applyItemWrapperAttrs, attachFolderCardClick, attachNoteBody, attachSourceCardClick, attachTitleBody, attachUniversalItemBehavior, attachWatermarkBody, attachWaypointCardBody, buildFolderInlineCanvas, cascadeDeleteFolderContents, centerOnContent, deleteCanvasCollabsForFolder, deleteWaypointCardEverywhere, deleteWaypointFromDb, expandWaypointCard, folderGlobalId, folderTitle, openFolder, performMerge, render, renderMediaViewerZoom, renderSelectedOutlines, setMediaViewerZoom, spawnMediaItemAt, startBoxSelection, startRenameFolderCardTitle, syncNoteFormatButtons, syncWaypointToDb };

// React → vanilla bridge, the other direction from window-bridge.js (which is specifically the
// ~107 auto-generated inline onclick="..." names — see its own header comment). CanvasItem
// (app/dotto/CanvasItemsLayer.jsx) calls the first two from a per-item layout effect that runs on
// every render() call: wrapper attrs and universal behavior (drag/click, aiGenerated badge,
// right-click) apply to every kind, all of which are now real Components (see
// CARD_KIND_COMPONENTS in CanvasItemsLayer.jsx). The rest — attachWatermarkBody/attachTitleBody/
// attachNoteBody — are each called from their own converted kind's own layout effect instead:
// leftover stateful (not purely rendering) logic specific to that one kind, not a generic per-item
// hook.
window.__applyCanvasItemWrapperAttrs = applyItemWrapperAttrs;
window.__attachUniversalItemBehavior = attachUniversalItemBehavior;
window.__attachWatermarkBody = attachWatermarkBody;
window.__attachTitleBody = attachTitleBody;
window.__attachNoteBody = attachNoteBody;
window.__syncNoteFormatButtons = syncNoteFormatButtons;
window.__buildFolderInlineCanvas = buildFolderInlineCanvas;
window.__startRenameFolderCardTitle = startRenameFolderCardTitle;
window.__folderTitle = folderTitle;
window.__folderGlobalId = folderGlobalId;
window.__attachFolderCardClick = attachFolderCardClick;
window.__attachWaypointCardBody = attachWaypointCardBody;
window.__attachSourceCardClick = attachSourceCardClick;
window.__openFolder = openFolder;
// Used by app/dotto/lib/sharedAndPublicCanvasLoading.ts's openSharedCanvas/openPublicCanvas/
// exitSharedCanvasToRoot (Phase 4.4).
window.__centerOnContent = centerOnContent;
// Used by app/dotto/lib/splitPaneManagement.ts's splitPaneWithTab (Phase 4.4).
window.__applyFolderView = applyFolderView;
// Used by app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3's second relocated
// piece), same reasoning as window.__getAppState (core-state.js).
window.__performMerge = performMerge;
window.__render = render;
// Used by app/dotto/lib/outlineTree.ts's goToOutlineItem (Phase 4.4).
window.__expandWaypointCard = expandWaypointCard;
window.__renderSelectedOutlines = renderSelectedOutlines;
// React → vanilla bridge — used by FilesListPanel.jsx's drag-onto-canvas gesture.
window.__spawnMediaItemAt = spawnMediaItemAt;
// React → vanilla bridges — used by PaneZoomBar.jsx and switchActivePane (core-state.js, the
// latter via a bridge rather than a direct import since core-state.js is imported BY this file).
window.__renderMediaViewerZoom = renderMediaViewerZoom;
window.__setMediaViewerZoomLevel = setMediaViewerZoom;
