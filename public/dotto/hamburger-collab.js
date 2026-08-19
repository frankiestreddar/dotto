import { addMenu, appState, drawSettings, supabase } from './core-state.js';
import { openCollabPanel, renderCollabPill } from './friends-presence.js';
import { saveWorkspaceNow, smoothPanTo } from './history-autosave.js';
import { flashCanvasElement } from './mnemonic-search-matching.js';
import { closeHamburgerMenu } from './panels-hamburger.js';
import { closeProfilePanel, openPricingOverlay } from './profile-achievements-pricing.js';
import { announceEnteredCollaboration, ensureSharedFolderLoaded, sharedFolderKey } from './shared-canvases-outline.js';
import { pushNotification } from './stopwatch-search-notifications.js';
import { deleteCanvasCollabsForFolder, expandWaypointCard, openFolder, render } from './waypoints-render-loop.js';


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
        if (sharedWithMeRes.error) console.error('[collab] failed to load canvas collaborations:', sharedWithMeRes.error);
        if (ownedRes.error) console.error('[collab] failed to load owned canvas collaborations:', ownedRes.error);

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
                pushNotification({
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
            if (appState.folders[sharedFolderKey(c.ownerId, c.folderId)]) return true; // already loaded locally this session
            const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: c.ownerId, p_folder_id: c.folderId });
            return !error && data != null;
        }));
        const sharedShown = sharedCandidates.filter((c, i) => sharedStillExists[i]).map(c => {
            const sharedKey = sharedFolderKey(c.ownerId, c.folderId);
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
        renderCollabPill(); // sets the bubble's .show class synchronously so the line below doesn't no-op
        openCollabPanel(true);
    }
    async function respondToHubCollabRequest(id, accept) {
        await respondToCanvasCollabRequest(id, accept);
        await refreshCanvasCollabData();
        renderHubCollabRequests();
    }
    // Queries the global `waypoints` table (see the 20260729 migration) rather than scanning
    // locally-loaded `folders` — a friend's canvas 300 layers deep isn't loaded client-side until
    // you actually navigate into it, but a waypoint you dropped there still needs to show up and
    // be jumpable-to from here, platform-wide. RLS on that table already restricts this to
    // waypoints THIS user created, so there's no need to filter by creator client-side too.
    // Real React state now (see app/dotto/WaypointsListPanel.jsx, waypointsListStore) — genuine
    // JSX rows, same as CanvasResultsPanel, since there's no complex per-row widget state (just an
    // icon, a label, an onclick). No flushSync needed on the bridge (unlike the search panels):
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
        window.__setWaypointsList({ rows, query: q });
    }
    // Hamburger menu's Chats panel — every saved Dotbot conversation belonging to this user, most
    // recently updated first. Same fresh-fetch-every-open pattern as renderWaypointsList right
    // above (RLS already scopes this to the caller's own rows via owner_id = auth.uid() — see
    // supabase/migrations/20260819_add_dotbot_conversations.sql — no client-side filtering needed
    // beyond that). No search box for v1 (unlike waypoints), so no query param here.
    async function renderChatsList() {
        if (!supabase || !appState.currentUser.id) { window.__setChatsList([]); return; }
        const { data, error } = await supabase.from('dotbot_conversations')
            .select('id, title, updated_at')
            .eq('owner_id', appState.currentUser.id)
            .order('updated_at', { ascending: false });
        if (error) { console.error('[chats] failed to load conversations:', error); window.__setChatsList([]); return; }
        window.__setChatsList(data || []);
    }
    // Pans to and briefly expands (read-only "peek") a waypoint card already present in the
    // CURRENTLY open folder's DOM — shared by both branches of goToWaypointCard below.
    function peekWaypointCard(folderId, it) {
        const el = document.getElementById('item-' + it.id);
        const w = el ? el.offsetWidth : (it.w || 28);
        const h = el ? el.offsetHeight : (it.h || 28);
        smoothPanTo(window.innerWidth / 2 - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
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
            const key = sharedFolderKey(ownerId, fid);
            if (!(await ensureSharedFolderLoaded(key))) return null;
            localKeys.push(key);
        }
        return localKeys;
    }
    async function goToWaypointCard(ownerId, folderId, itemId) {
        closeHamburgerMenu();
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
        if (isFreshEntry) announceEnteredCollaboration(localKeys[0]);
        const it = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.find(i => String(i.id) === String(itemId));
        if (it) peekWaypointCard(appState.currentFolderId, it);
    }
    function hmenuAction(action) {
        closeHamburgerMenu();
        closeProfilePanel();
        if (action === 'upgrade') {
            openPricingOverlay();
        } else if (action === 'logout') {
            // Flush whatever's still sitting in the debounced save timer (e.g. a pan/zoom just
            // before clicking logout) before navigating away, so the next login restores exactly
            // where this session left off — same as pagehide/visibilitychange do for a plain
            // refresh or tab close.
            saveWorkspaceNow().finally(() => {
                if (supabase) supabase.auth.signOut().finally(() => { window.location.href = '/login'; });
                else window.location.href = '/login';
            });
        }
    }
    drawSettings.addEventListener('click', (e) => e.stopPropagation());
    addMenu.addEventListener('click', (e) => e.stopPropagation());

export { backToHubCollabMain, goToWaypointCard, handleOwnedHubCollabRowClick, hmenuAction, openHubCollabRequestsView, renderChatsList, renderHubCollabList, renderWaypointsList, resolveSharedFolderChain, respondToHubCollabRequest };

// React → vanilla bridge — used by WaypointsListPanel.jsx/HubCollabListPanel.jsx (app/dotto/),
// which can't import these directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__goToWaypointCard = goToWaypointCard;
window.__openHubCollabRequestsView = openHubCollabRequestsView;
window.__backToHubCollabMain = backToHubCollabMain;
window.__handleOwnedHubCollabRowClick = handleOwnedHubCollabRowClick;
window.__respondToHubCollabRequest = respondToHubCollabRequest;
