import { clearSearch, countSourceEntries, escapeHtml, findParentFolderId, truncateCenter } from './ai-assistant-suggestions.js';
import { editEmbed, renderChecklistHTML, renderEmbedHTML, renderStatcardHTML } from './cards-misc.js';
import { appState, breadcrumbs, bringCardToFront, btnBack, btnForward, canvas, contextMenu, supabase, world, zoomControl } from './core-state.js';
import { setupDraggingAndClicking } from './drag-drop-chat.js';
import { ensureDrawings, makeLayerSVG } from './drawing-connections.js';
import { refreshCanvasCollabForCurrentFolder, renderCollabPill, syncCanvasCollabTitle } from './friends-presence.js';
import { closeGameOptionsPanel, openGameOptionsPanel, renderFlashcardHTML, renderTypeRightHTML } from './games-flashcard-typeright.js';
import { applyTransform, ensureSwTicking, saveSnapshot, scheduleWorkspaceSave, updateContextMenuPosition } from './history-autosave.js';
import { broadcastEditingState, miniLabelForItem, placeCaretEnd, renderRealCardPreview, repositionAllRemoteCursors, syncColorPicker, titleFontSize } from './live-presence.js';
import { buildEpubViewer, buildPdfViewer, renderMediaHTML } from './media-pdf-epub.js';
import { findNextFreeSlot, setupResizing } from './resize-shortcuts-init.js';
import { ensureSharedFolderLoaded, kindIconHTML, openBreadcrumbMapPanel } from './shared-canvases-outline.js';
import { closeSourceAddMenu } from './source-buttons-cursor-mode.js';
import { attachStaticTableHoverZones, distributeTableSizing, layoutSourceTableColumns, renderStaticTableHTML, renderTableHTML } from './source-table.js';
import { closeCellTagPicker } from './source-tags-ai.js';
import { applyConnections, renderConnectionsLayer } from './srs-connections-core.js';
import { renderFilterHTML, renderShelfHTML, renderStopwatchHTML } from './stopwatch-search-notifications.js';


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

    // Inline-rename a folder card's title, right on the card — same contentEditable
    // click-to-edit flow as the breadcrumb rename (see the crumb-item span.onclick further down),
    // just parameterized on `it.folderId` instead of always being currentFolderId. Writes to the
    // exact same folders[folderId].title the breadcrumb writes to, so the two stay in sync for
    // free — no separate propagation needed, they're just two editors of the same property.
    // Guarded on folders[it.folderId] existing at all: a folder card nested INSIDE a canvas
    // someone else shared with you is a static, non-drillable preview (see the sharing scope note
    // in 20260726_add_canvas_collaboration.sql) with no local data to rename in the first place.
    function startRenameFolderCardTitle(titleEl, it, editingClass) {
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
        broadcastEditingState(true, `#item-${it.id} .${editingClass}`);
        titleEl.focus();
        // Same caret-at-end-on-a-deferred-macrotask dance as the breadcrumb rename — see its own
        // comment for why the deferral is load-bearing (a pending native click-to-caret action
        // would otherwise silently override this).
        const placeCaretAtEnd = () => {
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        placeCaretAtEnd();
        setTimeout(placeCaretAtEnd, 0);
        titleEl.onblur = () => {
            titleEl.contentEditable = false;
            broadcastEditingState(false);
            titleEl.classList.remove('crumb-placeholder');
            const newTitle = titleEl.textContent.trim();
            if (newTitle) { appState.folders[folderId].title = newTitle; syncCanvasCollabTitle(folderId, newTitle); }
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

    // ---------- Main Canvas Render Loop ----------
    function render() {
        scheduleWorkspaceSave();
        clearSearch();
        // #items-layer (React-owned canvas item cards — see app/dotto/CanvasItemsLayer.jsx) is a
        // stable, permanent child of #world; only its siblings (drawing/connection SVG layers, the
        // isSource static-table div) get wiped and rebuilt here, in place of #world's own former
        // wholesale world.innerHTML='' (see the canvas-items-react plan, PHASE2_ROADMAP.md).
        Array.from(world.children).forEach(child => { if (child.id !== 'items-layer') child.remove(); });
        if(!appState.folders[appState.currentFolderId]) { window.__renderCanvasItems([]); return; }
        const folderObj = appState.folders[appState.currentFolderId];
        // Waypoints are private to whoever dropped them — even on a canvas shared with (or by)
        // other people, only the creator ever sees their own waypoint cards (see the 20260729
        // migration/renderWaypointsList). Legacy items from before creatorId existed default to
        // the folder's owner, which is always correct for your own canvases and the conservative
        // choice for shared ones (owner still sees it, collaborators don't, rather than everyone).
        const folderOwnerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const currentItems = folderObj.items.filter(it => it.kind !== 'waypoint' || (it.creatorId || folderOwnerId) === appState.currentUser.id);
        breadcrumbs.innerHTML = '';
        // ".." opens the full breadcrumb map (see openBreadcrumbMapPanel) rather than jumping
        // straight to the parent — shown whenever there's anywhere to go: a real structural
        // parent (see findParentFolderId — reflects the true canvas hierarchy, not navigation
        // history, so this is correct regardless of how this folder was reached: drilling in, a
        // waypoint jump, search, or the hamburger menu), or, within a shared tree, always (since
        // the map's own "Root" row is what gets you home from there — see
        // renderBreadcrumbMapPanel).
        const parentFolderId = findParentFolderId(appState.currentFolderId);
        if (parentFolderId || folderObj.isSharedView) {
            const dots = document.createElement('span');
            dots.textContent = '..';
            dots.className = 'crumb-item';
            dots.onclick = (e) => {
                e.stopPropagation();
                openBreadcrumbMapPanel();
            };
            breadcrumbs.appendChild(dots);
            breadcrumbs.appendChild(document.createTextNode(' / '));
        }
        {
            const id = appState.currentFolderId;
            const span = document.createElement('span');
            span.textContent = truncateCenter(appState.folders[id].title, 12);
            span.className = 'crumb-item';
            span.onclick = (e) => {
                e.stopPropagation();
                // The handler stays attached for the whole edit session (needed so a later click
                // outside of it, via the blur handler, can commit) — without this guard, EVERY
                // click while already editing (e.g. clicking elsewhere in the text to reposition
                // the caret, completely normal mid-edit behavior) would re-run the "enter edit
                // mode" logic below from scratch: resetting the text back to the last-committed
                // title (discarding whatever had been typed since) and recomputing a caret
                // position against that now-mismatched text. That's the actual bug behind the
                // caret seeming to land in the wrong place — once already editing, just let the
                // click behave as an ordinary native contentEditable click (reposition the caret
                // where clicked) and do nothing else.
                if (span.contentEditable === 'true') return;
                saveSnapshot();
                const fullTitle = appState.folders[id].title;
                // Still-default, never-renamed titles start truly empty with the default shown
                // only as a CSS placeholder (see .crumb-placeholder:empty::before) — typing the
                // first character replaces it outright, rather than editing "New Canvas" as if
                // it were real text the user would need to select/delete first.
                const isDefaultTitle = fullTitle === 'New Canvas' || fullTitle === 'New Source';
                if (isDefaultTitle) {
                    span.textContent = '';
                    span.setAttribute('data-placeholder', fullTitle);
                    span.classList.add('crumb-placeholder');
                } else {
                    span.textContent = fullTitle;
                }
                span.contentEditable = true;
                broadcastEditingState(true);
                span.focus();
                // Entering edit mode always puts the caret at the end (not wherever the click
                // that triggered entry happened to land) — a click once already editing (see the
                // early return above) repositions it normally via the browser's own native
                // click-to-caret behavior instead.
                //
                // contentEditable flips to true DURING this same click's dispatch, so the click
                // still has a pending default action that places the caret at the original click
                // coordinates — that default action runs AFTER this handler returns, so it wins
                // over (silently undoes) a selection set synchronously here. Deferring to a
                // fresh macrotask runs after that default action has already settled, so this
                // explicit placement is what actually sticks.
                const placeCaretAtEnd = () => {
                    const range = document.createRange();
                    range.selectNodeContents(span);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                };
                placeCaretAtEnd();
                setTimeout(placeCaretAtEnd, 0);
                span.onblur = () => {
                    span.contentEditable = false;
                    broadcastEditingState(false);
                    span.classList.remove('crumb-placeholder');
                    const newTitle = span.textContent.trim();
                    if (newTitle) { appState.folders[id].title = newTitle; syncCanvasCollabTitle(id, newTitle); }
                    render();
                };
                // Live per-keystroke sync (not a full render() — that would wipe/rebuild #world
                // mid-edit and risk disrupting the caret, which this rename flow already has
                // fragile positioning logic for; scheduleWorkspaceSave() alone is enough to reach
                // collaborators without touching this card's own DOM at all).
                span.oninput = () => {
                    const liveTitle = span.textContent;
                    if (liveTitle.trim()) { appState.folders[id].title = liveTitle; scheduleWorkspaceSave(); }
                };
                span.onkeydown = (ke) => {
                    if (ke.key === 'Enter') { ke.preventDefault(); span.blur(); }
                    if (ke.key === 'Escape') { ke.preventDefault(); span.textContent = isDefaultTitle ? '' : fullTitle; span.blur(); }
                };
            };
            breadcrumbs.appendChild(span);
        }

        renderCollabPill();

        if (folderObj.isSource) {
            canvas.classList.add('static-source');
            appState.addToolbar.style.display = 'none';
            appState.modeToolbar.style.display = 'none';
            appState.scheduleToolbar.style.display = 'none';
            zoomControl.style.display = 'none';
            appState.tx = 0; appState.ty = 0; appState.scale = 1; applyTransform();
            let tableItem = folderObj.items.find(i => i.kind === 'table');
            if (!tableItem) {
                tableItem = { id: appState.idCounter++, x: 0, y: 0, w: 0, h: 0, kind: 'table', tableData: [['', ''], ['', ''], ['', ''], ['', '']] };
                folderObj.items.push(tableItem);
            }
            const el = document.createElement('div');
            el.className = 'item table static-table';
            el.id = 'item-' + tableItem.id;
            el.innerHTML = renderStaticTableHTML(tableItem, appState.currentFolderId);
            world.appendChild(el);
            attachStaticTableHoverZones(el, tableItem);
            layoutSourceTableColumns(tableItem, el);
            btnBack.disabled = appState.historyIndex === 0; btnForward.disabled = appState.historyIndex === appState.historyStack.length - 1;
            // isSource folders never reach the real item list below — #items-layer must be told
            // there's nothing to show, or it would keep showing whatever the previous folder had.
            window.__renderCanvasItems([]);
            return;
        }
        canvas.classList.remove('static-source');
        appState.addToolbar.style.display = 'flex';
        appState.modeToolbar.style.display = '';
        appState.scheduleToolbar.style.display = '';
        zoomControl.style.display = '';
        closeSourceAddMenu(); closeCellTagPicker();

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
        const itemsLayer = document.getElementById('items-layer');
        world.insertBefore(backLayer, itemsLayer);
        world.insertBefore(renderConnectionsLayer(folderObj, currentItems), itemsLayer);

        // React (app/dotto/CanvasItemsLayer.jsx) owns creating/keying/removing each item's wrapper
        // <div id="item-{id}"> inside #items-layer — see the canvas-items-react plan in
        // PHASE2_ROADMAP.md. This bridge call is a synchronous flushSync under the hood
        // (app/dotto-app.jsx), so every item's wrapper div (and, via each CanvasItem's
        // useLayoutEffect, its body content — see renderLegacyCardInto below) already exists in the
        // DOM by the time this call returns, matching the old synchronous
        // createElement+appendChild guarantee callers like the alt-duplicate-drag path in
        // drag-drop-chat.js depend on.
        window.__renderCanvasItems(currentItems);

        world.appendChild(frontLayer);
        if (appState.addingKind && appState.placementGhost) world.appendChild(appState.placementGhost);
        btnBack.disabled = appState.historyIndex === 0; btnForward.disabled = appState.historyIndex === appState.historyStack.length - 1;

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

    // Builds one canvas item's body content and wires up its behavior (click/drag/resize/context-
    // menu handlers) into an already-mounted wrapper <div>. Mechanically lifted out of render()'s
    // old currentItems.forEach loop (canvas-items-react plan, PHASE2_ROADMAP.md) — React
    // (app/dotto/CanvasItemsLayer.jsx) now owns creating/keying/removing the wrapper <div
    // id="item-{id}"> itself; this function still does everything render() used to do to populate
    // one, just called from a per-item useLayoutEffect (via window.__renderLegacyCardInto below)
    // instead of inline in a loop, so it only re-runs when that item's own props actually change
    // (React.memo), not on every render() call. `el` is always the live wrapper node for `it.id` —
    // reused across calls, never recreated, so every assignment below (className, innerHTML, etc.)
    // is a plain overwrite exactly as it always was on a freshly created node.
    function renderLegacyCardInto(el, it) {
        el.className = `item ${it.kind}`;
        el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
        if (it.zIndex) el.style.zIndex = it.zIndex;
        // Re-applied on every call (rather than left as a one-off class toggle) since el.className
        // above already resets the base class list — see handleDataModeClick.
        if (appState.dataLinkPendingId === it.id) el.classList.add('link-source-armed');
        if (it.optionsOpen) el.classList.add('options-open');
        if (it.kind !== 'title' && it.kind !== 'waypoint') {
            if (it.kind === 'table' && !it.userSized) {
                // Sizing handled automatically
            } else {
                el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
            }
        }

            if (it.kind === 'folder') {
                el.innerHTML = '';
                const folderTitleEl = document.createElement('div');
                folderTitleEl.className = 'folder-card-title';
                const liveTitle = appState.folders[it.folderId] ? appState.folders[it.folderId].title : '';
                folderTitleEl.textContent = liveTitle;
                folderTitleEl.title = liveTitle; // native tooltip for whatever the ellipsis truncates
                el.appendChild(folderTitleEl);
                const folderPreviewWrap = document.createElement('div');
                folderPreviewWrap.className = 'folder-card-preview';
                folderPreviewWrap.appendChild(buildFolderInlineCanvas(it.folderId));
                el.appendChild(folderPreviewWrap);
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (e.target.closest('.folder-card-title')) { startRenameFolderCardTitle(folderTitleEl, it); return; }
                    openFolder(it.folderId);
                };
            } else if (it.kind === 'source') {
                const nestedTitle = appState.folders[it.folderId] ? appState.folders[it.folderId].title : '';
                const nestedCount = countSourceEntries(it.folderId);
                el.innerHTML = `${kindIconHTML('source', null, 'source-card-icon')}
                <div class="source-card-info">
                    <span class="source-card-title" title="${escapeHtml(nestedTitle)}">${escapeHtml(nestedTitle)}</span>
                    <span class="source-card-count">${nestedCount} ${nestedCount === 1 ? 'entry' : 'entries'}</span>
                </div>`;
                const sourceTitleEl = el.querySelector('.source-card-title');
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (e.target.closest('.source-card-title')) { startRenameFolderCardTitle(sourceTitleEl, it, 'source-card-title'); return; }
                    openFolder(it.folderId);
                };
            } else if (it.kind === 'title') {
                el.style.fontSize = titleFontSize(it.level || 1) + 'px';
                el.innerHTML = `<div class="format-bar" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()">
                    <select class="format-select" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" onchange="setTitleLevel(${it.id}, this.value)">
                        <option value="1" ${(it.level||1)===1?'selected':''}>H1</option>
                        <option value="2" ${(it.level||1)===2?'selected':''}>H2</option>
                        <option value="3" ${(it.level||1)===3?'selected':''}>H3</option>
                    </select>
                    <input type="color" class="text-color-swatch" oninput="document.execCommand('foreColor', false, this.value)"/>
                </div>
                <div class="body" data-placeholder="Title..."></div>`;
                const b = el.querySelector('.body'); b.innerHTML = it.html || '';
                b.onblur = (e) => { if(e.relatedTarget && (e.relatedTarget.closest('.format-bar'))) return; el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); scheduleWorkspaceSave(); };
                // Commits + syncs on every keystroke, not just on blur — otherwise a collaborator
                // watching this card only ever sees the FINAL text once you click away, never the
                // actual typing happen. scheduleWorkspaceSave() itself already debounces the real
                // broadcast (~120ms, see queueSyncDiff) so this doesn't flood the channel per
                // character, just makes it feel genuinely live.
                b.oninput = () => { it.html = b.innerHTML; scheduleWorkspaceSave(); };
                b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
                b.onfocus = () => syncColorPicker(b);
                b.addEventListener('keyup', () => syncColorPicker(b));
                b.addEventListener('click', () => syncColorPicker(b));
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.currentEditingEl !== el) saveSnapshot();
                    el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#item-' + it.id); } appState.currentEditingEl = el;
                };
            } else if (it.kind === 'table') {
                el.innerHTML = renderTableHTML(it);
                if (it.userSized) { el.classList.add('sized'); requestAnimationFrame(() => distributeTableSizing(it, el)); }
                setupResizing(el, it);
            } else if (it.kind === 'media') {
                // pdf/epub need real live DOM (canvas contexts, iframes, event handlers) built by
                // JS, not an HTML string like the plain image/video/empty states below.
                if (it.mediaSrc && it.mediaType === 'pdf') {
                    el.innerHTML = '';
                    el.appendChild(buildPdfViewer(it));
                } else if (it.mediaSrc && it.mediaType === 'epub') {
                    el.innerHTML = '';
                    el.appendChild(buildEpubViewer(it));
                } else {
                    el.innerHTML = renderMediaHTML(it);
                }
                // A no-op until there's real content to resize (renderMediaHTML's empty/uploading
                // states have no .resize handle at all yet — see setupResizing's own early return).
                setupResizing(el, it);
            } else if (it.kind === 'embed') {
                el.innerHTML = renderEmbedHTML(it);
                if (!it.embedUrl) {
                    el.onclick = (e) => { e.stopPropagation(); editEmbed(it.id); };
                }
            } else if (it.kind === 'waypoint') {
                el.innerHTML = `${kindIconHTML('waypoint', null, 'waypoint-card-icon')}<span class="waypoint-card-name"></span>`;
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (el.classList.contains('waypoint-editing')) return; // already editing — let the native click just reposition the caret
                    expandWaypointCard(el, it, { editable: true });
                };
                // el is the item's persistent wrapper node (reused across renders, not recreated —
                // see the canvas-items-react plan, PHASE2_ROADMAP.md), and this branch re-runs
                // every time renderLegacyCardInto re-populates it — a plain addEventListener here
                // would stack a duplicate hover/drag-expand listener per re-run instead of replacing
                // the old one. Same AbortController fix as setupDraggingAndClicking
                // (drag-drop-chat.js), kept under its own key since a waypoint card carries both.
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
                // Dragging a card around the canvas should show it expanded the whole time it's
                // being moved. It's almost always already expanded by this point anyway (you have
                // to be hovering it to pick it up), but this both guarantees it (e.g. a very fast
                // mousedown-drag before the hover-triggered expand above has settled) and — via
                // .waypoint-dragging above — keeps it that way for the whole drag even in the rare
                // case the cursor doesn't track exactly over the moving card. Only acts once real
                // movement crosses the same 3px threshold setupDraggingAndClicking's own drag
                // detection uses, so a plain click-to-rename (no movement at all) is unaffected.
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
                        // The card moves WITH the cursor during a drag, so it's normally still
                        // directly under it at drop — but if it isn't for some reason, there's no
                        // future mouseleave to catch it (one may already have fired, and been
                        // ignored, mid-drag), so check and collapse explicitly here instead.
                        if (!el.classList.contains('waypoint-editing') && !el.matches(':hover')) collapseWaypointCardWidth(el);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                }, { signal: waypointSignal });
            } else if (it.kind === 'checklist') {
                el.innerHTML = renderChecklistHTML(it);
            } else if (it.kind === 'watermark') {
                el.innerHTML = `<div class="body watermark-text" data-placeholder="Type to trace...">${it.html || ''}</div>`;
                const b = el.querySelector('.watermark-text');
                b.onblur = (e) => { el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); scheduleWorkspaceSave(); };
                // Live per-keystroke commit+sync — see the identical comment on the title body above.
                b.oninput = () => { it.html = b.innerHTML; scheduleWorkspaceSave(); };
                b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.currentEditingEl !== el) saveSnapshot();
                    el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#item-' + it.id); } appState.currentEditingEl = el;
                };
            } else if (it.kind === 'flashcard') {
                el.innerHTML = renderFlashcardHTML(it);
                setupResizing(el, it);
            } else if (it.kind === 'typeright') {
                el.innerHTML = renderTypeRightHTML(it);
                setupResizing(el, it);
            } else if (it.kind === 'statcard') {
                el.innerHTML = renderStatcardHTML(it);
            } else if (it.kind === 'stopwatch') {
                el.innerHTML = renderStopwatchHTML(it);
            } else if (it.kind === 'shelf') {
                el.innerHTML = renderShelfHTML(it);
            } else if (it.kind === 'filter') {
                el.innerHTML = renderFilterHTML(it);
            } else if (it.kind === 'sentence') {
                // Dropped from a Dotbot example-sentence drag (see importDotbotResultAtScreenPoint)
                // — a dedicated read-only card, not a note: big target-script text, small
                // transliteration underneath only when the AI supplied one (i.e. the script isn't
                // Latin-based), translation below. No contentEditable/onblur wiring — uneditable,
                // like statcard/stopwatch/shelf above.
                el.innerHTML = `<div class="sentence-card-text">${escapeHtml(it.text || '')}</div>
                    ${it.translit ? `<div class="sentence-card-translit">${escapeHtml(it.translit)}</div>` : ''}
                    ${it.translation ? `<div class="sentence-card-translation">${escapeHtml(it.translation)}</div>` : ''}`;
            } else {
                el.innerHTML = `<div class="format-bar" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()">
                    <button class="format-btn" onmousedown="document.execCommand('bold')">B</button>
                    <button class="format-btn" onmousedown="document.execCommand('italic')">I</button>
                    <button class="format-btn" onmousedown="document.execCommand('underline')">U</button>
                    <input type="color" class="text-color-swatch" oninput="document.execCommand('foreColor', false, this.value)"/>
                </div>
                <div class="body" data-placeholder="Note..."></div><div class="more-btn" style="display:none;">${(it.expanded ? 'Collapse' : 'More…')}</div><div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
                const b = el.querySelector('.body'); b.innerHTML = it.html || '';
                const moreBtn = el.querySelector('.more-btn');
                const isClipped = () => b.scrollHeight > b.clientHeight || b.scrollWidth > b.clientWidth;
                el.classList.toggle('expanded', !!it.expanded);
                if (moreBtn) {
                    requestAnimationFrame(() => { moreBtn.style.display = (it.expanded || isClipped()) ? 'block' : 'none'; });
                    moreBtn.onclick = (e) => {
                        e.stopPropagation();
                        // Expanding makes the note taller, so it can newly overlap neighboring
                        // cards it didn't before — bring it to front the same way a direct click
                        // would, rather than leaving it to whatever z-index it last had (see the
                        // now-removed hardcoded z-index:50 on .item.note.expanded in globals.css,
                        // which broke as soon as any other card's real click-driven z-index
                        // caught up to/passed 50).
                        bringCardToFront(it, el);
                        clearTimeout(el.__noteHeightTimer);
                        const expanding = !it.expanded;
                        it.expanded = expanding;
                        moreBtn.textContent = expanding ? 'Collapse' : 'More…';
                        // No render() here — a full rebuild would replace `el` already in its
                        // final state, with nothing to actually transition from/to (the "sudden
                        // jump" this fixes). Instead this animates the live element directly,
                        // mirroring expandWaypointCardWidth/collapseWaypointCardWidth's technique
                        // elsewhere in this file: CSS can't smoothly transition to/from
                        // height:auto (browsers snap instantly), so it measures the real target
                        // height in pixels first and animates between two concrete values,
                        // handing back to the CSS class (.item.note.expanded's height:auto
                        // !important) only once the transition has actually settled.
                        // setProperty(..., 'important') is needed because render() unconditionally
                        // applies a plain inline it.h+'px' height to every card (so a collapsed
                        // note keeps its own resized height) — a plain inline style can't
                        // out-rank that, but an !important one briefly can.
                        const startH = el.getBoundingClientRect().height / appState.scale;
                        if (expanding) {
                            el.classList.add('expanded');
                            el.style.removeProperty('height'); // let height:auto take over just long enough to measure the natural target
                            const targetH = el.getBoundingClientRect().height / appState.scale;
                            // .item.note.expanded .body{overflow:visible} takes effect the instant
                            // .expanded was added above — well before the card's own height has
                            // caught up — so without this, the full text pops into view immediately
                            // (nothing left to clip it) while just the card's border/background
                            // animates open underneath, which is the "sudden switch" this fixes.
                            // Pinning a plain (non-important — the class's own overflow rule isn't
                            // !important, unlike its height rule) inline overflow:hidden here keeps
                            // the body clipped to whatever height the card currently has at each
                            // frame — .body has no explicit height of its own (flex:1 1 auto, and
                            // it's the only normal-flow child left now that format-bar/more-btn/
                            // resize are all position:absolute), so it already exactly tracks the
                            // card's own animating height without needing a separate animation.
                            b.style.overflow = 'hidden';
                            el.style.setProperty('height', startH + 'px', 'important');
                            void el.offsetHeight; // commit the start point before animating
                            el.style.setProperty('height', targetH + 'px', 'important');
                            el.__noteHeightTimer = setTimeout(() => {
                                el.style.removeProperty('height');
                                b.style.removeProperty('overflow'); // hand back to .expanded .body{overflow:visible} now that the card has caught up to full size
                            }, 200); // matches .item.note's own .15s height transition + a small buffer
                        } else {
                            // Same reasoning as the expand branch, in reverse: .expanded (and so
                            // .body{overflow:visible}) is still in effect for the whole shrink
                            // animation below, right up until the timeout removes it — without
                            // clipping here too, the text would hang fully visible below the
                            // shrinking card instead of being clipped away progressively.
                            b.style.overflow = 'hidden';
                            el.style.setProperty('height', startH + 'px', 'important');
                            void el.offsetHeight;
                            el.style.setProperty('height', (it.h || startH) + 'px', 'important');
                            el.__noteHeightTimer = setTimeout(() => {
                                el.classList.remove('expanded');
                                // Unlike the expand branch, there's no CSS fallback for the resting
                                // collapsed height (no class sets it — render() normally does, via
                                // a plain, non-important inline it.h+'px') — so this re-applies that
                                // same value at normal priority rather than just clearing it, or
                                // the card would end up with no height at all until the next
                                // unrelated render().
                                el.style.removeProperty('height');
                                el.style.height = (it.h || startH) + 'px';
                                // .expanded is already gone by this point, so this now falls back
                                // to .item.note .body{overflow-y:auto} (the normal collapsed rule),
                                // not the expanded one.
                                b.style.removeProperty('overflow');
                                moreBtn.style.display = (it.expanded || isClipped()) ? 'block' : 'none';
                            }, 200);
                        }
                        scheduleWorkspaceSave();
                    };
                }
                b.onblur = (e) => { if(e.relatedTarget && (e.relatedTarget.closest('.format-bar') || e.relatedTarget.closest('.resize') || e.relatedTarget.closest('.more-btn'))) return; el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); b.scrollTop = 0; if (moreBtn) moreBtn.style.display = (it.expanded || isClipped()) ? 'block' : 'none'; scheduleWorkspaceSave(); };
                // Live per-keystroke commit+sync — see the identical comment on the title body above.
                b.oninput = () => { it.html = b.innerHTML; scheduleWorkspaceSave(); };
                b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
                b.onfocus = () => syncColorPicker(b);
                b.addEventListener('keyup', () => syncColorPicker(b));
                b.addEventListener('click', () => syncColorPicker(b));
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.currentEditingEl !== el) saveSnapshot();
                    el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#item-' + it.id); } appState.currentEditingEl = el;
                };
                setupResizing(el, it);
            }
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
            // (Schedule/Delete are gone — see startScheduleConversation/deleteSelectedCards);
            // flashcard/typeright game cards instead slide their own in-card options panel into
            // view (see openGameOptionsPanel/renderGameOptionsHTML) — only these two kinds have a
            // real front/back notion today, so other game-category placeholders (blanks/match/
            // audiotype) get no right-click menu, same as any other non-table kind. Right-clicking
            // again while the panel is already open toggles it back to the normal card view,
            // rather than just re-opening (already-open) options.
            el.oncontextmenu = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (it.kind === 'flashcard' || it.kind === 'typeright') {
                    if (it.optionsOpen) closeGameOptionsPanel(it.id); else openGameOptionsPanel(it.id);
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
        setupDraggingAndClicking(el, it);
    }

    function renderSelectedOutlines() {
        document.querySelectorAll('.item').forEach(el => {
            const idStr = el.id.replace('item-', '');
            if (idStr.startsWith('folder-')) return; // ignore static compiler assets
            const id = parseInt(idStr);
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
        const tid = parseInt(targetEl.id.replace('item-', ''));
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
            appState.tx = window.innerWidth / 2; appState.ty = window.innerHeight / 2;
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
        appState.tx = window.innerWidth / 2 - cx;
        appState.ty = window.innerHeight / 2 - cy;
        applyTransform();
    }

    // Shared by every navigation entry point (opening a folder, back/forward, breadcrumb ".."):
    // saves the OUTGOING folder's pan/zoom as folders[id].lastView (skipped for sources, which
    // never remember one), switches currentFolderId, re-renders, then either restores the
    // incoming folder's saved view or centers fresh on first-ever visit. Source folders always
    // reset regardless — render() itself unconditionally forces tx/ty/scale back to a fixed
    // 0/0/1 static transform for them (see the `folderObj.isSource` branch inside render()), so
    // there's nothing to restore or center for a source here.
    function applyFolderView(folderId) {
        const outgoing = appState.folders[appState.currentFolderId];
        if (outgoing && !outgoing.isSource) outgoing.lastView = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.currentFolderId = folderId;
        render();
        const target = appState.folders[folderId];
        if (target && !target.isSource) {
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
        if (folderId.startsWith('shared:') && !appState.folders[folderId] && !(await ensureSharedFolderLoaded(folderId))) return;
        appState.historyStack = appState.historyStack.slice(0, appState.historyIndex + 1);
        appState.historyStack.push(folderId);
        appState.historyIndex++;
        applyFolderView(folderId);
    }

export { applyFolderView, cascadeDeleteFolderContents, centerOnContent, deleteCanvasCollabsForFolder, deleteWaypointFromDb, expandWaypointCard, openFolder, performMerge, render, renderLegacyCardInto, renderSelectedOutlines, startBoxSelection, syncWaypointToDb };

// React → vanilla bridge, the other direction from window-bridge.js (which is specifically the
// ~104 auto-generated inline onclick="..." names — see its own header comment). CanvasItem
// (app/dotto/CanvasItemsLayer.jsx) calls this from a useLayoutEffect, once per item whose props
// actually changed, to populate/rewire an already-mounted wrapper <div> — see the canvas-items-
// react plan in PHASE2_ROADMAP.md.
window.__renderLegacyCardInto = renderLegacyCardInto;
