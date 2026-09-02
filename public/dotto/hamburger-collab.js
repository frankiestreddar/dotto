import { openSearchOverlay, scrollChatThreadToBottom, showAiChatView, updateChatThread } from './ai-assistant-suggestions.js';
import { appState, canvasViewportCenterX, drawSettings, findItemEl, supabase } from './core-state.js';
import { activePaneCollabBubbleEl, openCollabPanel, renderCollabPill } from './friends-presence.js';
import { flashCanvasElement } from './mnemonic-search-matching.js';
import { closeProfilePanel, openPricingOverlay } from './profile-achievements-pricing.js';
import { deleteCanvasCollabsForFolder, deleteWaypointCardEverywhere, expandWaypointCard, folderGlobalId, openFolder, render } from './waypoints-render-loop.js';


    // ---------- Hamburger "Collaborations" panel ----------
    // Two views sharing #hub-collab-list: the main list (a "Requests" row with a pending-count
    // badge, then every canvas someone has shared with this user — click to enter via
    // openSharedCanvas) and the Requests view (every pending invite, Accept/Decline each) —
    // swapped via hubCollabView rather than a separate hub-subpanel, since it's a drill-down
    // within Collaborations, not a distinct top-level hamburger menu item.
 // [{id, folderId, folderTitle, ownerId, ownerName}]
 // [{id, folderId, folderTitle, ownerId, ownerName, ownerAvatarId, ownerAvatarUrl}] — shared WITH this user
 // [{folderId, folderTitle, collaborators:[{id,username,displayName,avatarId,avatarUrl}]}] — shared BY this user
    // Same baseline-then-diff pattern as seenIncomingFriendRequestIds — null until the first
    // refresh (baseline, no notifications), every run after that notifies for any request id
    // that wasn't in the set yet.
    async function refreshCanvasCollabData() {
        if (!supabase || !appState.currentUser.id) { appState.incomingCanvasRequests = []; appState.acceptedCanvasCollaborations = []; appState.ownedCanvasCollaborations = []; return; }
        const [sharedWithMeRes, ownedRes] = await Promise.all([
            supabase.from('canvas_collaborations')
                .select('id, folder_id, folder_title, status, owner:profiles!canvas_collaborations_owner_id_fkey(id, username, display_name, avatar_id, avatar_url)')
                .eq('collaborator_id', appState.currentUser.id)
                .in('status', ['pending', 'accepted']),
            supabase.from('canvas_collaborations')
                .select('folder_id, folder_title, collaborator:profiles!canvas_collaborations_collaborator_id_fkey(id, username, display_name, avatar_id, avatar_url)')
                .eq('owner_id', appState.currentUser.id)
                .eq('status', 'accepted'),
        ]);
        // message/code/details/hint spelled out explicitly (same convention as command-verbs.js,
        // app/dotto/lib/sharedAndPublicCanvasLoading.ts, etc.) rather than logging the PostgrestError object
        // directly — its actual fields aren't enumerable in a way every console/error-overlay
        // serializer picks up, so a raw `console.error(..., error)` can print as an unhelpful {}.
        if (sharedWithMeRes.error) {
            const error = sharedWithMeRes.error;
            console.error(`[collab] failed to load canvas collaborations: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        }
        if (ownedRes.error) {
            const error = ownedRes.error;
            console.error(`[collab] failed to load owned canvas collaborations: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        }

        const rows = (sharedWithMeRes.data || []).map(r => ({
            id: r.id, folderId: r.folder_id, folderTitle: r.folder_title,
            ownerId: r.owner.id, ownerName: r.owner.display_name || r.owner.username,
            ownerAvatarId: r.owner.avatar_id ?? 0, ownerAvatarUrl: r.owner.avatar_url || null, status: r.status,
        }));
        appState.incomingCanvasRequests = rows.filter(r => r.status === 'pending');
        appState.acceptedCanvasCollaborations = rows.filter(r => r.status === 'accepted');
        if (appState.seenIncomingCanvasRequestIds === null) {
            appState.seenIncomingCanvasRequestIds = new Set(appState.incomingCanvasRequests.map(r => r.id));
        } else {
            appState.incomingCanvasRequests.forEach(r => {
                if (appState.seenIncomingCanvasRequestIds.has(r.id)) return;
                appState.seenIncomingCanvasRequestIds.add(r.id);
                window.pushNotification({
                    type: 'collab_request',
                    message: `${r.ownerName} invited you to collaborate on "${r.folderTitle}"`,
                    actionLabel: 'Accept',
                    onAction: () => respondToCanvasCollabRequest(r.id, true),
                    // No dismiss button — Escape hides it without accepting, request stays pending
                    // (see Requests in the Collaborations hub panel).
                    sticky: true,
                });
            });
        }

        const byFolder = new Map();
        (ownedRes.data || []).forEach(r => {
            if (!byFolder.has(r.folder_id)) byFolder.set(r.folder_id, { folderId: r.folder_id, folderTitle: r.folder_title, collaborators: [] });
            byFolder.get(r.folder_id).collaborators.push({
                id: r.collaborator.id, username: r.collaborator.username,
                displayName: r.collaborator.display_name || r.collaborator.username,
                avatarId: r.collaborator.avatar_id ?? 0, avatarUrl: r.collaborator.avatar_url || null,
            });
        });
        appState.ownedCanvasCollaborations = Array.from(byFolder.values());
    }
    async function respondToCanvasCollabRequest(id, accept) {
        if (!supabase) return;
        const { error } = await supabase.rpc('respond_to_canvas_collaboration', { p_id: id, p_accept: accept });
        if (error) console.error('[collab] failed to respond to canvas collaboration request:', error);
    }
    // Both directions in one flat list (own canvases with collaborators, and canvases others
    // shared with this user) — no subheading distinguishing them, same "no separate subheadings"
    // convention as the per-canvas panel; the row content itself (avatars vs. an Open button)
    // makes which is which obvious.
    // Real React state now (see app/dotto/HubCollabListPanel.jsx, hubCollabListStore) — genuine
    // JSX rows for both views (main list + Requests drill-down), same reasoning as
    // WaypointsListPanel: no complex per-row widget state, just icon/text/avatar(s)/onclick.
    // renderAvatarInto is replaced by a reusable Avatar.jsx component (same img-with-fallback
    // logic, just as real JSX with local state instead of an onerror handler mutating the DOM).
    // Not flushSync'd (see window.__setHubCollabList, app/dotto-app.jsx) — both entry points are
    // async (refreshCanvasCollabData/get_shared_folder are real network calls), so there's no
    // synchronous DOM read that could race a plain store.set.
    async function renderHubCollabList(query) {
        await refreshCanvasCollabData();
        if (appState.hubCollabView === 'requests') { renderHubCollabRequests(); return; }
        const q = (query || '').trim().toLowerCase();
        // Own canvases that have since been deleted shouldn't show here even if their
        // canvas_collaborations rows are somehow still lingering (e.g. deleteCanvasCollabsForFolder's
        // revoke call failed silently — see its own error handling) — folders[] is this user's own
        // COMPLETE tree, loaded in full up front (see loadWorkspace), so absence here reliably means
        // "no longer exists," no extra round trip needed. Opportunistically retries the cleanup for
        // any match found, since we're the owner and can actually fix it from here.
        //
        // Title prefers the LIVE in-memory folders[...].title over the DB row's own folder_title
        // (only a snapshot taken at invite time — see canvas_collaborations' own schema comment),
        // computed here (not in the component) since appState is exactly as reachable from this
        // vanilla code as it always was.
        const ownedCandidates = appState.ownedCanvasCollaborations.filter(c => !q || c.folderTitle.toLowerCase().includes(q));
        const ownedShown = ownedCandidates.filter(c => {
            if (appState.folders[c.folderId]) return true;
            deleteCanvasCollabsForFolder(c.folderId);
            return false;
        }).map(c => ({ ...c, liveTitle: (appState.folders[c.folderId] && appState.folders[c.folderId].title) || c.folderTitle }));
        // Canvases shared WITH this user aren't necessarily loaded locally yet (a friend's canvas
        // isn't fetched until actually opened — see openSharedCanvas), so existence has to be
        // verified server-side instead: get_shared_folder returns null data (with no error) once
        // access is confirmed but the folder itself is gone — same defensive-cleanup reasoning as
        // above, covering both "canvas deleted" and "access actually revoked but the status column
        // update didn't land" in one check. A collaborator has no permission to delete the owner's
        // row themselves (see canvas_collaborations' RLS), so this only filters the display here;
        // the owner's own next panel render is what actually cleans up their row.
        const sharedCandidates = appState.acceptedCanvasCollaborations.filter(c => !q || c.folderTitle.toLowerCase().includes(q));
        const sharedStillExists = await Promise.all(sharedCandidates.map(async (c) => {
            if (appState.folders[window.__sharedFolderKey(c.ownerId, c.folderId)]) return true; // already loaded locally this session
            const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: c.ownerId, p_folder_id: c.folderId });
            return !error && data != null;
        }));
        const sharedShown = sharedCandidates.filter((c, i) => sharedStillExists[i]).map(c => {
            const sharedKey = window.__sharedFolderKey(c.ownerId, c.folderId);
            return { ...c, liveTitle: (appState.folders[sharedKey] && appState.folders[sharedKey].title) || c.folderTitle };
        });
        window.__setHubCollabList({ view: 'main', requestsCount: appState.incomingCanvasRequests.length, ownedShown, sharedShown, query: q });
    }
    function renderHubCollabRequests() {
        window.__setHubCollabList({ view: 'requests', requests: appState.incomingCanvasRequests });
    }
    // Wired up from HubCollabListPanel.jsx's JSX handlers — see that file for the row shapes these
    // feed.
    function openHubCollabRequestsView() { appState.hubCollabView = 'requests'; renderHubCollabRequests(); }
    function backToHubCollabMain() { appState.hubCollabView = 'main'; renderHubCollabList(appState.hubCollabSearchInput.value); }
    // Own canvas row click: navigates there AND opens its collaborator panel, since managing it is
    // the obvious next step from here.
    function handleOwnedHubCollabRowClick(folderId) {
        openFolder(folderId); // our own canvas — plain local navigation, no fetch needed
        // Retargets appState.collabBubble to the (now-active) pane's own bubble element first —
        // split-screen Stage 8, every pane has its own now, so there's no single static bubble to
        // assume any more (see collabBubblePaneClick's own comment, friends-presence.js).
        const bubbleEl = activePaneCollabBubbleEl();
        if (bubbleEl) appState.collabBubble = bubbleEl;
        renderCollabPill(); // sets the bubble's .show class synchronously so the line below doesn't no-op
        openCollabPanel(true);
    }
    async function respondToHubCollabRequest(id, accept) {
        await respondToCanvasCollabRequest(id, accept);
        await refreshCanvasCollabData();
        renderHubCollabRequests();
    }
    // Sorts nearest-first to where the user is actually looking right now, per explicit request —
    // but only within the CURRENTLY OPEN folder: a waypoint on some other canvas (a different
    // owner's tree, or even just a different folder of this user's own) has no comparable
    // "distance" at all, since world coordinates are local to each folder's own canvas, not a
    // single shared space. Those simply keep whatever order they were already in (most-recently-
    // updated-first, from the query above) and sort after every same-folder waypoint — Infinity
    // for their "distance" plus Array#sort's guaranteed stability (ES2019+) is what achieves that
    // for free, no separate two-pass split needed. canvasViewportCenterX()/window.innerHeight/2 is
    // the same screen-space viewport-center formula smoothPanTo's own callers already pan TO (see
    // e.g. peekWaypointCard below); inverting it back through the current tx/ty/scale (the exact
    // reverse of toWorldPoint-style screen-to-world math used elsewhere in this app) gives the
    // world-space point the user is currently centered on.
    function sortWaypointRowsByProximity(rows) {
        const worldCenterX = (canvasViewportCenterX() - appState.tx) / appState.scale;
        const worldCenterY = (window.innerHeight / 2 - appState.ty) / appState.scale;
        const distanceOf = (r) => {
            if (r.folder_id !== appState.currentFolderId) return Infinity;
            const it = window.__findItemById(r.item_id);
            if (!it) return Infinity;
            return Math.hypot(it.x - worldCenterX, it.y - worldCenterY);
        };
        rows.sort((a, b) => distanceOf(a) - distanceOf(b));
    }
    // Queries the global `waypoints` table (see the 20260729 migration) rather than scanning
    // locally-loaded `folders` — a friend's canvas 300 layers deep isn't loaded client-side until
    // you actually navigate into it, but a waypoint you dropped there still needs to show up and
    // be jumpable-to from here, platform-wide. RLS on that table already restricts this to
    // waypoints THIS user created, so there's no need to filter by creator client-side too.
    // Real React state now (see app/dotto/WaypointsListPanel.jsx, waypointsListStore) — genuine
    // JSX rows, since there's no complex per-row widget state (just an icon, a label, an onclick).
    // No flushSync needed on the bridge (unlike the search panels):
    // this is async (a real network round-trip), so there's no synchronous-read race to guard
    // against — by the time the store updates, we're already in a later task entirely.
    async function renderWaypointsList(query) {
        const q = (query || '').trim().toLowerCase();
        if (!supabase || !appState.currentUser.id) { window.__setWaypointsList({ rows: [], query: q }); return; }
        const { data, error } = await supabase.from('waypoints')
            .select('owner_id, folder_id, item_id, name')
            .eq('creator_id', appState.currentUser.id)
            .order('updated_at', { ascending: false });
        if (error) { console.error('[waypoints] failed to load waypoints:', error); window.__setWaypointsList({ rows: [], query: q }); return; }
        const rows = (data || []).filter(r => !q || (r.name || 'New Waypoint').toLowerCase().includes(q));
        sortWaypointRowsByProximity(rows);
        // Cached so deleteSelectedWaypointRows can look a selected row back up by its composite
        // key (owner_id/folder_id/item_id can't be safely reverse-parsed OUT of that key string —
        // owner_id is itself a UUID full of hyphens — but re-deriving the same key per cached row
        // and comparing works fine) — and now also so the 1-9/0 keyboard shortcuts (srs-
        // connections-core.js's keydown handler) can jump straight to row N by index, matching
        // whatever this same sorted-and-filtered order the panel is actually showing.
        // waypointsListStore (app/dotto/bridges.js) holds the same rows for rendering, but vanilla
        // code can't read a React store back, only push to it.
        appState.lastWaypointsRows = rows;
        window.__setWaypointsList({ rows, query: q });
    }
    // Matches WaypointsListPanel.jsx's own `key={...}` computation exactly — reused here as the
    // shift-click selection id for waypoint rows (see listPanelSelectionStore).
    function waypointRowKey(r) { return `${r.owner_id}-${r.folder_id}-${r.item_id}`; }
    // Sources rail panel (SourcesListPanel.jsx) — every kind:'source' linking item on the CURRENT
    // canvas specifically (appState.folders[currentFolderId].items), not every source anywhere in
    // the whole workspace (that's findAllSourceFolders(), search-orchestration-selection.js, a
    // different, unrelated use case) — per explicit request. Entirely local/synchronous, unlike
    // renderWaypointsList/renderChatsList/renderHubCollabList above (no Supabase round trip needed
    // — a canvas's own item list is already fully in memory).
    // Called from render() itself (waypoints-render-loop.js), same as renderBreadcrumbMapPanel/
    // renderTabsPanel — not just on panel-open/search-input — so the list stays correct even if the
    // current folder changes while the panel happens to be pinned open, and so creating a new
    // source (createNewSource, srs-connections-core.js, which calls add() -> render()) updates the
    // list for free without a second explicit render call of its own.
    // query is optional — render()'s own call omits it, falling back to whatever's currently typed
    // into the live search input (if the panel isn't even open/mounted yet, that lookup just comes
    // back empty, same as an untouched box) so a render()-driven refresh doesn't clobber the user's
    // in-progress search; the oninput handler (handleSourcesSearch, app/dotto/lib/panelsHamburger.ts) always
    // passes the freshly-typed value directly instead.
    // Account-wide: every source folder that exists (appState.folders is a flat, non-nested map
    // of ALL folders — see findAllSourceFolders's own comment, search-orchestration-selection.js,
    // for the same fact established there), not just the ones linked onto the current canvas —
    // per explicit request that this list show every source, not just this canvas's. The ones
    // actually linked here (a kind:'source' item in this folder's own items[], pointing at that
    // source folder via folderId) are pulled to the top via the sort below, also per explicit
    // request, rather than being the only ones shown as before.
    function renderSourcesList(query) {
        const input = document.getElementById('sources-panel-search');
        const q = (query !== undefined ? query : (input ? input.value : '')).trim().toLowerCase();
        const folderObj = appState.folders[appState.currentFolderId];
        const onCanvasIds = new Set(
            (folderObj ? folderObj.items : []).filter(it => it.kind === 'source').map(it => it.folderId)
        );
        const rows = Object.values(appState.folders)
            .filter(f => f.isSource)
            .map(f => ({ id: f.id, folderId: f.id, title: f.title || 'New Source', globalId: folderGlobalId(f.id), onCanvas: onCanvasIds.has(f.id), active: f.id === appState.currentFolderId }))
            .filter(r => !q || r.title.toLowerCase().includes(q))
            .sort((a, b) => (b.onCanvas === a.onCanvas ? 0 : b.onCanvas ? 1 : -1));
        window.__setSourcesList({ rows, query: q });
    }
    // Files panel (SourcesListPanel's own structure copied — see #snippets-panel's own comment,
    // hamburger-stack.html — then edited to list a different underlying thing) — every uploaded
    // file across the user's ENTIRE account, not just the current canvas, per explicit request:
    // every kind:'media' item (app/dotto/lib/mediaPdfEpub.ts) with a real mediaSrc, found by walking every
    // folder's own items[] (appState.folders is the same flat, account-wide map findAllSourceFolders/
    // renderSourcesList's own comments already establish this fact for). mediaSrc is what makes it
    // an actual uploaded/attached file rather than an empty media card still waiting for one
    // (triggerMediaUpload/setMediaFromLink both only set it once real content lands). Title prefers
    // mediaName (the original filename — only ever set for the PDF/EPUB upload path,
    // uploadDocumentToStorage) since that's the one case with a real user-chosen name to show;
    // everything else falls back to a plain type label. Sorted current-canvas-first, same "onCanvas"
    // convention renderSourcesList's own rows already use, though the underlying relationship here
    // is simpler — a media item only ever lives in exactly one folder directly, no separate linking
    // item the way a source can appear on canvases other than its own.
    // Files sidebar — deduplicated to ONE row per uploaded file, per explicit bug report: dragging
    // a file from this panel onto canvas (spawnMediaItemAt, waypoints-render-loop.js) spawns a
    // second card pointing at the exact same underlying file, which used to show up as a second,
    // seemingly-duplicate row here. it.mediaFileId (a real crypto.randomUUID(), assigned once per
    // upload — see setMediaFromLink/processMediaFile/uploadDocumentToStorage's own comments,
    // app/dotto/lib/mediaPdfEpub.ts, for why a real UUID rather than appState.idCounter: "not just a unique
    // code for the user... unique across the platform") is the dedupe key; a legacy item from
    // before this field existed falls back to its own mediaSrc (still a real, if less explicit,
    // per-upload identity — two cards genuinely pointing at the same storage URL/data: URI ARE the
    // same file either way). Deliberately NOT applied to the Outline panel (computeOutlineRows,
    // app/dotto/lib/outlineTree.ts, which has no dedup logic of its own and isn't touched here) — per
    // explicit request, Outline should keep listing every individual card instance on the canvas,
    // only the Files sidebar collapses them down to one.
    function renderFilesList(query) {
        const input = document.getElementById('files-panel-search');
        const q = (query !== undefined ? query : (input ? input.value : '')).trim().toLowerCase();
        const mediaTypeLabel = { video: 'Video', pdf: 'PDF', epub: 'EPUB' };
        const byFileKey = new Map();
        Object.values(appState.folders).forEach(f => {
            (f.items || []).forEach(it => {
                if (it.kind !== 'media' || !it.mediaSrc) return;
                const fileKey = it.mediaFileId || it.mediaSrc;
                const onCanvas = f.id === appState.currentFolderId;
                const existing = byFileKey.get(fileKey);
                // First instance found wins by default; a later one only replaces it if THIS one is
                // on the current canvas and the kept one wasn't — so the row always navigates
                // somewhere actually visible right now when that's an option.
                if (existing && !(onCanvas && !existing.onCanvas)) return;
                byFileKey.set(fileKey, {
                    id: it.id,
                    folderId: f.id,
                    itemId: it.id,
                    title: it.mediaName || mediaTypeLabel[it.mediaType] || 'Image',
                    onCanvas,
                    // The file's own real, directly-openable URL (a Supabase Storage public URL,
                    // or occasionally a data: URI for a not-yet-uploaded local preview — see
                    // app/dotto/lib/mediaPdfEpub.ts's own it.mediaSrc assignments) — used by FilesListPanel.jsx's
                    // "open in a new tab" row action; every browser already knows how to render an
                    // image/video/PDF navigated to directly, so no special per-type handling is
                    // needed here.
                    mediaSrc: it.mediaSrc,
                });
            });
        });
        const filtered = Array.from(byFileKey.values())
            .filter(r => !q || r.title.toLowerCase().includes(q))
            .sort((a, b) => (b.onCanvas === a.onCanvas ? 0 : b.onCanvas ? 1 : -1));
        window.__setFilesList({ rows: filtered, query: q });
    }
    // Hamburger menu's Chats panel — every saved Dotbot conversation belonging to this user, most
    // recently updated first. Same fresh-fetch-every-open pattern as renderWaypointsList right
    // above (RLS already scopes this to the caller's own rows via owner_id = auth.uid() — see
    // supabase/migrations/20260819_add_dotbot_conversations.sql — no client-side filtering needed
    // beyond that). No search box for v1 (unlike waypoints), so no query param here.
    // Returns the fetched rows (in addition to pushing them into chatsListStore for the full
    // #chats-list view) — handleSearchFocus (ai-assistant-suggestions.js) reuses this same fetch
    // for the compact "recent chats" preview shown in the AI panel's dropdown before you start
    // typing, rather than duplicating the query.
    async function renderChatsList() {
        if (!supabase || !appState.currentUser.id) { window.__setChatsList([]); return []; }
        const { data, error } = await supabase.from('dotbot_conversations')
            .select('id, title, updated_at')
            .eq('owner_id', appState.currentUser.id)
            .order('updated_at', { ascending: false });
        if (error) { console.error('[chats] failed to load conversations:', error); window.__setChatsList([]); return []; }
        window.__setChatsList(data || []);
        return data || [];
    }
    // Pans to and briefly expands (read-only "peek") a waypoint card already present in the
    // CURRENTLY open folder's DOM — shared by both branches of goToWaypointCard below.
    function peekWaypointCard(folderId, it) {
        const el = findItemEl(it.id);
        const w = el ? el.offsetWidth : (it.w || 28);
        const h = el ? el.offsetHeight : (it.h || 28);
        window.__smoothPanTo(canvasViewportCenterX() - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
        if (el) expandWaypointCard(el, it, { editable: false });
        flashCanvasElement(el);
    }
    // Navigates to a waypoint card, possibly on a completely different user's canvas and
    // arbitrarily deep inside it. Own-canvas waypoints are already fully loaded locally
    // (loadWorkspace loads this user's whole tree up front), so that's just a normal openFolder;
    // a friend's waypoint needs its whole access path fetched and injected level by level first
    // (get_folder_ancestor_chain + ensureSharedFolderLoaded per level) so that once there,
    // findParentFolderId/the breadcrumb "up" navigation work exactly like a hand-drilled visit —
    // same reasoning as openSharedCanvas/ensureSharedFolderLoaded above, just resolving every
    // level of the path in one shot instead of one openFolder click at a time.
    // Walks the ancestor chain from the top of ownerId's shared tree down to folderId (via
    // get_folder_ancestor_chain) and loads every level along the way, same as clicking down into
    // each one by hand would — used both for a waypoint landing deep inside someone else's canvas
    // and for resuming a shared session after a page reload (see loadWorkspace). Returns the
    // array of local (shared:owner:id) keys in root-to-target order, or null if any level failed
    // to resolve/load.
    async function resolveSharedFolderChain(ownerId, folderId) {
        if (!supabase || !appState.currentUser.id) return null;
        const { data: chain, error } = await supabase.rpc('get_folder_ancestor_chain', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !chain || !chain.length) { console.error('[collab] failed to resolve shared folder path:', error); return null; }
        const localKeys = [];
        for (const fid of chain) {
            const key = window.__sharedFolderKey(ownerId, fid);
            if (!(await window.__ensureSharedFolderLoaded(key))) return null;
            localKeys.push(key);
        }
        return localKeys;
    }
    async function goToWaypointCard(ownerId, folderId, itemId) {
        window.__closeRailView();
        if (ownerId === appState.currentUser.id) {
            if (appState.currentFolderId !== folderId) openFolder(folderId);
            const it = appState.folders[folderId] && appState.folders[folderId].items.find(i => String(i.id) === String(itemId));
            if (it) peekWaypointCard(folderId, it);
            return;
        }
        const isFreshEntry = !appState.preSharedViewState;
        if (isFreshEntry) appState.preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        const localKeys = await resolveSharedFolderChain(ownerId, folderId);
        if (!localKeys) { if (isFreshEntry) appState.preSharedViewState = null; return; }
        appState.currentFolderId = localKeys[localKeys.length - 1];
        appState.historyStack = localKeys;
        appState.historyIndex = localKeys.length - 1;
        render();
        if (isFreshEntry) window.__announceEnteredCollaboration(localKeys[0]);
        const it = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.find(i => String(i.id) === String(itemId));
        if (it) peekWaypointCard(appState.currentFolderId, it);
    }
    // Reopens a saved conversation (clicked from the AI panel's own chat-list rows, see
    // ChatsListPanel.jsx's row onClick), fully restoring its history — no live AI call, just
    // Stage 2's read path (dotbot_messages, RLS-scoped) replayed into the same turn-rendering
    // ChatThread.jsx uses for live results. openSearchOverlay alone (no separate closeRailView
    // first) is enough — opening the AI view already closes/hides whatever else might be open, and
    // since it's already the active view here (that's how the chat list itself is visible),
    // calling closeRailView first would trigger resetAiSearchState (see app/dotto/lib/panelsHamburger.ts) and
    // reset currentConversationId/chatThreadStore right before this function sets them again —
    // harmless in the end (this function's own assignments below run after and win), but
    // pointless churn to avoid. openSearchOverlay lands on the list view by default (refreshAiPanel
    // -> showAiListView), so this calls showAiChatView() itself, once the real data is actually in
    // place, to bring the conversation on screen.
    async function openSavedChat(conversationId) {
        openSearchOverlay();
        if (!supabase || !appState.currentUser.id) return;
        const { data, error } = await supabase.from('dotbot_messages')
            .select('role, content')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });
        if (error) { console.error('[chats] failed to load conversation:', error); return; }
        appState.currentConversationId = conversationId;
        // append_dotbot_turn always inserts one user row then one assistant row per turn, in that
        // order (supabase/migrations/20260819_add_dotbot_conversations.sql) — created_at ascending
        // naturally yields [user1, assistant1, user2, assistant2, ...], so pairing sequentially
        // here is reliable rather than needing an explicit turn/sequence id on each row.
        const turns = [];
        let pendingUserQuery = null;
        (data || []).forEach(m => {
            if (m.role === 'user') {
                pendingUserQuery = (m.content && m.content.query) || '';
            } else if (m.role === 'assistant' && pendingUserQuery !== null) {
                // fresh: false (the default, omitted) — history must render fully settled
                // instantly, never re-typewriter text that was already delivered in a past
                // session (see ChatTurn's own comment, ChatThread.jsx).
                turns.push({ id: 'turn_' + (appState.idCounter++), query: pendingUserQuery, panels: m.content || [] });
                pendingUserQuery = null;
            }
        });
        window.__setChatThread(turns);
        showAiChatView();
        updateChatThread();
        scrollChatThreadToBottom();
    }
    // ---------- Chats/Waypoints/Collaborations list-panel selection + deletion ----------
    // One shared selection, not three — openHubSubpanel (app/dotto/lib/panelsHamburger.ts) already enforces
    // exactly one hub-subpanel open at a time, so `panel` doubles as the disambiguation a single
    // Backspace handler needs (see dispatchListPanelDelete, called from source-buttons-cursor-
    // mode.js's keydown listener). Vanilla owns this as the source of truth (appState.
    // listPanelSelection, core-state.js — same convention as appState.selectedCardIds for canvas
    // cards), mirrored into React's listPanelSelectionStore via window.__setListPanelSelection
    // purely so the list rows can show a highlight.
    function toggleListPanelSelection(panel, id) {
        const current = appState.listPanelSelection;
        const ids = current.panel === panel ? new Set(current.ids) : new Set();
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        appState.listPanelSelection = { panel, ids };
        window.__setListPanelSelection(appState.listPanelSelection);
    }
    // Shift+click-DRAG "paint select" across a list panel's rows, extending the existing
    // shift+click toggle above — holding Shift and dragging the pointer across multiple rows now
    // toggles every row it passes over (deselecting ones that were already selected, same as a
    // plain shift+click on any one of them would), instead of needing to shift-click each one
    // individually. Each row is only ever toggled ONCE per drag gesture (tracked in `visited`),
    // even if the pointer passes back over it again later in the same drag — otherwise a row
    // straddled twice would just flip back to whatever it started at, silently undoing the touch.
    // No separate "was this a click or a drag" distinction needed: toggling on mousedown and then
    // toggling any NEWLY-entered row on every subsequent mousemove naturally reduces to a plain
    // single toggle for a stationary click (mousemove essentially never fires without real
    // pointer movement), so both cases fall out of the exact same code path.
    // Listens on the STABLE list container (never re-created by React, unlike the row elements
    // themselves, which React re-renders on every store update) via event delegation off
    // e.target/elementFromPoint — rows opt in just by carrying data-select-id, the same id
    // toggleListPanelSelection already uses for that panel, so this works unchanged for any
    // current or future list panel without needing to know its row shape.
    function setupListPanelDragSelect(container, panel) {
        if (!container) return;
        container.addEventListener('mousedown', (e) => {
            if (!e.shiftKey) return;
            const startRow = e.target.closest('[data-select-id]');
            if (!startRow || !container.contains(startRow)) return;
            const visited = new Set();
            const toggleRow = (el) => {
                const row = el && el.closest && el.closest('[data-select-id]');
                if (!row || !container.contains(row) || visited.has(row.dataset.selectId)) return;
                visited.add(row.dataset.selectId);
                toggleListPanelSelection(panel, row.dataset.selectId);
            };
            toggleRow(startRow);
            const onMove = (me) => toggleRow(document.elementFromPoint(me.clientX, me.clientY));
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    }
    setupListPanelDragSelect(document.getElementById('waypoints-list'), 'waypoints');
    setupListPanelDragSelect(document.getElementById('chats-list'), 'chats');
    setupListPanelDragSelect(document.getElementById('hub-collab-list'), 'collaborations');
    function clearListPanelSelection() {
        appState.listPanelSelection = { panel: null, ids: new Set() };
        window.__setListPanelSelection(appState.listPanelSelection);
    }
    // Also clears currentConversationId/the visible chat thread if the deleted set includes the
    // conversation currently open in the search palette — otherwise the next follow-up message
    // would call append_dotbot_turn with a p_conversation_id that no longer exists, which raises
    // and surfaces as a hard 502 instead of gracefully starting a fresh conversation.
    async function deleteSelectedChats(ids) {
        if (!confirm(ids.length === 1 ? 'Delete this chat?' : `Delete ${ids.length} chats?`)) { clearListPanelSelection(); return; }
        const { error } = await supabase.rpc('delete_dotbot_conversations', { p_conversation_ids: ids });
        if (error) console.error('[chats] failed to delete conversations:', error);
        // updateChatThread() alongside setChatThread: without it, #search-chat-thread's
        // 'thread-settled' class (flex:1, globals.css) would linger from the just-deleted
        // conversation, pinning the AI panel's input box to the bottom of what's now a blank
        // thread.
        if (ids.includes(appState.currentConversationId)) { appState.currentConversationId = null; window.__setChatThread([]); updateChatThread(); }
        clearListPanelSelection();
        renderChatsList();
    }
    async function deleteSelectedWaypointRows(ids) {
        const idSet = new Set(ids);
        const rows = (appState.lastWaypointsRows || []).filter(r => idSet.has(waypointRowKey(r)));
        if (!rows.length) { clearListPanelSelection(); return; }
        if (!confirm(rows.length === 1 ? 'Delete this waypoint?' : `Delete ${rows.length} waypoints?`)) { clearListPanelSelection(); return; }
        await Promise.all(rows.map(r => deleteWaypointCardEverywhere(r.owner_id, r.folder_id, r.item_id)));
        clearListPanelSelection();
        renderWaypointsList(appState.waypointsSearchInput ? appState.waypointsSearchInput.value : '');
    }
    // "owned:folderId" ids remove every collaborator via the existing deleteCanvasCollabsForFolder
    // (owner-only, already used elsewhere for folder-deletion cascade — see waypoints-render-
    // loop.js). "shared:id" ids are this user leaving a canvas they don't own, via the new
    // leave_canvas_collaboration RPC. Both id spaces are self-contained once the prefix is
    // stripped (a folder id / the collaboration row's own bigint id) — no row cache needed here,
    // unlike waypoints.
    async function deleteSelectedCollabs(ids) {
        const owned = ids.filter(id => id.startsWith('owned:')).map(id => id.slice('owned:'.length));
        const shared = ids.filter(id => id.startsWith('shared:')).map(id => Number(id.slice('shared:'.length)));
        const count = owned.length + shared.length;
        if (!confirm(count === 1 ? 'Remove this collaboration?' : `Remove ${count} collaborations?`)) { clearListPanelSelection(); return; }
        await Promise.all([
            ...owned.map((folderId) => deleteCanvasCollabsForFolder(folderId)),
            ...shared.map(async (id) => {
                const { error } = await supabase.rpc('leave_canvas_collaboration', { p_id: id });
                if (error) console.error('[collab] failed to leave canvas collaboration:', error);
            }),
        ]);
        clearListPanelSelection();
        renderHubCollabList(appState.hubCollabSearchInput ? appState.hubCollabSearchInput.value : '');
    }
    // Routed from the shared Backspace handler (app/dotto/lib/sourceButtonsCursorMode.ts) — dispatches to
    // whichever of the three panels the current selection actually belongs to.
    function dispatchListPanelDelete(panel, ids) {
        if (panel === 'chats') { deleteSelectedChats(ids); return; }
        if (panel === 'waypoints') { deleteSelectedWaypointRows(ids); return; }
        if (panel === 'collaborations') { deleteSelectedCollabs(ids); return; }
    }
    function hmenuAction(action) {
        window.__closeRailView();
        closeProfilePanel();
        if (action === 'upgrade') {
            openPricingOverlay();
        } else if (action === 'logout') {
            // Flush whatever's still sitting in the debounced save timer (e.g. a pan/zoom just
            // before clicking logout) before navigating away, so the next login restores exactly
            // where this session left off — same as pagehide/visibilitychange do for a plain
            // refresh or tab close.
            window.__saveWorkspaceNow().finally(() => {
                if (supabase) supabase.auth.signOut().finally(() => { window.location.href = '/login'; });
                else window.location.href = '/login';
            });
        }
    }
    drawSettings.addEventListener('click', (e) => e.stopPropagation());

export { backToHubCollabMain, clearListPanelSelection, dispatchListPanelDelete, goToWaypointCard, handleOwnedHubCollabRowClick, hmenuAction, openHubCollabRequestsView, openSavedChat, renderChatsList, renderFilesList, renderHubCollabList, renderSourcesList, renderWaypointsList, resolveSharedFolderChain, respondToHubCollabRequest };

// React → vanilla bridge — used by WaypointsListPanel.jsx/HubCollabListPanel.jsx/
// ChatsListPanel.jsx (app/dotto/), which can't import these directly since public/dotto/*.js
// isn't reachable from app/dotto/.
window.__goToWaypointCard = goToWaypointCard;
window.__openSavedChat = openSavedChat;
window.__openHubCollabRequestsView = openHubCollabRequestsView;
window.__backToHubCollabMain = backToHubCollabMain;
window.__handleOwnedHubCollabRowClick = handleOwnedHubCollabRowClick;
window.__respondToHubCollabRequest = respondToHubCollabRequest;
// Used by app/dotto/lib/sourceButtonsCursorMode.ts's Backspace shortcut (Phase 4.4).
window.__dispatchListPanelDelete = dispatchListPanelDelete;
// Used by app/dotto/lib/panelsHamburger.ts's openRailView/wireRailIcon calls (Phase 4.5).
window.__clearListPanelSelection = clearListPanelSelection;
window.__renderFilesList = renderFilesList;
window.__renderHubCollabList = renderHubCollabList;
window.__renderSourcesList = renderSourcesList;
window.__renderWaypointsList = renderWaypointsList;
// Used by app/dotto/lib/historyAutosave.ts's loadWorkspace (Phase 4.5).
window.__resolveSharedFolderChain = resolveSharedFolderChain;
