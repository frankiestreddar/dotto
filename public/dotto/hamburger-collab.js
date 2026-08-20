import { openSearchOverlay, scrollChatThreadToBottom, updateChatThread } from './ai-assistant-suggestions.js';
import { addMenu, appState, canvasViewportCenterX, drawSettings, supabase } from './core-state.js';
import { openCollabPanel, renderCollabPill } from './friends-presence.js';
import { saveWorkspaceNow, smoothPanTo } from './history-autosave.js';
import { flashCanvasElement } from './mnemonic-search-matching.js';
import { closeRailView } from './panels-hamburger.js';
import { closeProfilePanel, openPricingOverlay } from './profile-achievements-pricing.js';
import { announceEnteredCollaboration, ensureSharedFolderLoaded, sharedFolderKey } from './shared-canvases-outline.js';
import { pushNotification } from './stopwatch-search-notifications.js';
import { deleteCanvasCollabsForFolder, deleteWaypointCardEverywhere, expandWaypointCard, openFolder, render } from './waypoints-render-loop.js';


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
        // Cached so deleteSelectedWaypointRows can look a selected row back up by its composite
        // key (owner_id/folder_id/item_id can't be safely reverse-parsed OUT of that key string —
        // owner_id is itself a UUID full of hyphens — but re-deriving the same key per cached row
        // and comparing works fine). waypointsListStore (app/dotto/bridges.js) holds the same rows
        // for rendering, but vanilla code can't read a React store back, only push to it.
        appState.lastWaypointsRows = rows;
        window.__setWaypointsList({ rows, query: q });
    }
    // Matches WaypointsListPanel.jsx's own `key={...}` computation exactly — reused here as the
    // shift-click selection id for waypoint rows (see listPanelSelectionStore).
    function waypointRowKey(r) { return `${r.owner_id}-${r.folder_id}-${r.item_id}`; }
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
        smoothPanTo(canvasViewportCenterX() - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
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
        closeRailView();
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
    // Reopens a saved conversation (see ChatsListPanel.jsx's row onClick) in the search palette,
    // fully restoring its history — no live AI call, just Stage 2's read path (dotbot_messages,
    // RLS-scoped) replayed into the same turn-rendering ChatThread.jsx uses for live results.
    // openSearchOverlay doesn't call clearSearch (confirmed directly — see clearSearch's own
    // comment on this), so setting currentConversationId/chatThreadStore right after it here is
    // never immediately wiped out by that reset.
    async function openSavedChat(conversationId) {
        closeRailView();
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
        updateChatThread();
        scrollChatThreadToBottom();
    }
    // ---------- Chats/Waypoints/Collaborations list-panel selection + deletion ----------
    // One shared selection, not three — openHubSubpanel (panels-hamburger.js) already enforces
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
        if (ids.includes(appState.currentConversationId)) { appState.currentConversationId = null; window.__setChatThread([]); }
        clearListPanelSelection();
        renderChatsList();
    }
    async function clearAllChats() {
        if (!confirm("Delete all saved chats? This can't be undone.")) return;
        const { error } = await supabase.rpc('delete_dotbot_conversations', {});
        if (error) console.error('[chats] failed to clear all conversations:', error);
        appState.currentConversationId = null;
        window.__setChatThread([]);
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
    // Routed from the shared Backspace handler (source-buttons-cursor-mode.js) — dispatches to
    // whichever of the three panels the current selection actually belongs to.
    function dispatchListPanelDelete(panel, ids) {
        if (panel === 'chats') { deleteSelectedChats(ids); return; }
        if (panel === 'waypoints') { deleteSelectedWaypointRows(ids); return; }
        if (panel === 'collaborations') { deleteSelectedCollabs(ids); return; }
    }
    function hmenuAction(action) {
        closeRailView();
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

export { backToHubCollabMain, clearAllChats, clearListPanelSelection, dispatchListPanelDelete, goToWaypointCard, handleOwnedHubCollabRowClick, hmenuAction, openHubCollabRequestsView, openSavedChat, renderChatsList, renderHubCollabList, renderWaypointsList, resolveSharedFolderChain, respondToHubCollabRequest };

// React → vanilla bridge — used by WaypointsListPanel.jsx/HubCollabListPanel.jsx/
// ChatsListPanel.jsx (app/dotto/), which can't import these directly since public/dotto/*.js
// isn't reachable from app/dotto/.
window.__goToWaypointCard = goToWaypointCard;
window.__openSavedChat = openSavedChat;
window.__openHubCollabRequestsView = openHubCollabRequestsView;
window.__backToHubCollabMain = backToHubCollabMain;
window.__handleOwnedHubCollabRowClick = handleOwnedHubCollabRowClick;
window.__respondToHubCollabRequest = respondToHubCollabRequest;
window.__toggleListPanelSelection = toggleListPanelSelection;
