import { clearSearch } from './ai-assistant-suggestions.js';
import { appState, supabase, switchActivePane } from './core-state.js';
import { ensureCanvasPresenceChannel, openConvo, renderConvoBody } from './live-presence.js';
import { openMessagesPanel } from './messages-schedule.js';
import { closeAllPanels, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { bumpAchievementStat } from './profile-achievements-pricing.js';



    // ---------- Collaborators Pill/Panel Controls ----------
    function getCurrentCollaboratorIds() {
        const folderObj = appState.folders[appState.currentFolderId];
        return (folderObj && folderObj.collaborators) ? folderObj.collaborators : [];
    }
    function closeCollabPanel() { appState.collabPanel.classList.remove('open'); appState.panelPinned.collab = false; }
    function positionCollabPanel() {
        const rect = appState.collabBubble.getBoundingClientRect();
        appState.collabPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 280;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        appState.collabPanel.style.left = leftPos + 'px';
        appState.collabPanel.style.right = 'auto';
    }
    function openCollabPanel(pin) {
        if (!appState.collabBubble.classList.contains('show')) return;
        closeAllPanels('collab');
        clearSearch();
        appState.collabPanel.classList.add('open');
        appState.collabSearchInput.value = '';
        renderCollabList('');
        positionCollabPanel();
        if (pin) { appState.panelPinned.collab = true; }
    }
    // Split-screen Stage 8 — each pane now renders its own collaborator bubble (PaneTopBar.jsx)
    // instead of one shared #collab-bubble, but there's still only ONE flyout panel/#collab-panel;
    // these three wrappers retarget appState.collabBubble (a plain, reassignable object property —
    // see its own comment, core-state.js — unlike canvas/world/etc's `let` bindings) to whichever
    // pane's own bubble element triggered the interaction, activating that pane first if it wasn't
    // already (same "clicking/hovering a pane's own UI focuses that pane" convention every other
    // per-pane interaction in this codebase follows), then reuses openCollabPanel/closeCollabPanel/
    // positionCollabPanel completely unchanged — they only ever read appState.collabBubble, never a
    // literal #collab-bubble id, so no changes were needed inside them at all. React (PaneTopBar.jsx)
    // calls these directly via the window.__ bridges below instead of this module attaching its own
    // listeners to a single static element the way it used to.
    function collabBubblePaneClick(paneId, bubbleEl) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        appState.collabBubble = bubbleEl;
        if (appState.panelPinned.collab) { closeCollabPanel(); }
        else { openCollabPanel(true); }
    }
    function collabBubblePaneMouseEnter(paneId, bubbleEl) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        appState.collabBubble = bubbleEl;
        // Only auto-open on hover when there are no collaborators yet (the "+" affordance);
        // once collaborators exist, hover just reveals the tooltip and click opens the panel.
        if (getCurrentCollaboratorIds().length === 0 && !appState.collabPanel.classList.contains('open')) openCollabPanel(false);
    }
    function collabBubblePaneMouseLeave(bubbleEl) {
        scheduleHoverClose('collab', [bubbleEl, appState.collabPanel], closeCollabPanel);
    }
    // A pane's own collaborator bubble element (PaneTopBar.jsx) is the only thing
    // appState.collabBubble can point to now that every pane renders its own (no more static
    // #collab-bubble) — found by pane id rather than a fixed id. For callers that need to open the
    // ACTIVE pane's own collab panel from somewhere other than a real click/hover on that bubble
    // (e.g. handleOwnedHubCollabRowClick, hamburger-collab.js, which navigates then opens the panel
    // programmatically) rather than duplicating this query at each such call site.
    function activePaneCollabBubbleEl() {
        return document.querySelector('#pane-breadcrumb-pill-' + appState.activePaneId + ' .pane-collab-bubble');
    }
    appState.collabPanel.addEventListener('mouseleave', () => scheduleHoverClose('collab', [appState.collabBubble, appState.collabPanel], closeCollabPanel));
    pinOnInsideClick('collab', [appState.collabPanel]);

    // Who's already accepted (including inherited from an ancestor canvas — see
    // get_effective_collaborators/canvas_access_status), and who has a pending invite at THIS
    // exact folder, for the folder currently open in the per-canvas collab panel — refreshed each
    // time that panel (re)opens (see renderCollabList). folders[id].collaborators itself is the
    // effective-accepted list (kept here rather than a separate variable so the rest of the app —
    // the collab bubble/pill — can keep reading it exactly like before); a pending invite is
    // always level-specific (never inherited), so that part stays an exact-folder query.
    async function refreshCanvasCollabForCurrentFolder() {
        if (!supabase || !appState.currentUser.id) { appState.outgoingCanvasInvitePendingIds = new Set(); return; }
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const [effective, pendingRes] = await Promise.all([
            supabase.rpc('get_effective_collaborators', { p_owner_id: appState.currentUser.id, p_folder_id: appState.currentFolderId }),
            supabase.from('canvas_collaborations').select('collaborator_id')
                .eq('owner_id', appState.currentUser.id).eq('folder_id', appState.currentFolderId).eq('status', 'pending'),
        ]);
        if (effective.error) console.error('[collab] failed to load effective collaborators:', effective.error);
        if (pendingRes.error) console.error('[collab] failed to load pending canvas invites:', pendingRes.error);
        folderObj.collaborators = (effective.data || []).map(r => r.collaborator_id);
        appState.outgoingCanvasInvitePendingIds = new Set((pendingRes.data || []).map(r => r.collaborator_id));
        // ensureCanvasPresenceChannel's "is this folder worth a live channel" check only runs
        // inside render() — which already ran synchronously, BEFORE this async fetch had any real
        // data, on every normal navigation (see openFolder). Nothing else ever re-checked it once
        // the real collaborators list actually landed, so an owner's own client could permanently
        // decide "no collaborators, don't join" off stale/empty data even with a collaborator
        // actively viewing. Re-running it here, now that folderObj.collaborators is current, is
        // what actually catches that — safe to call any time, it always re-resolves against
        // whatever's currently true rather than anything captured earlier.
        ensureCanvasPresenceChannel();
    }
    // A raw insert here fails outright (unique constraint violation) for anyone whose invite
    // already reached a terminal state -- declined, or removed via revoke_canvas_collaboration
    // (status='revoked') -- since canvas_collaborations has no other way to distinguish "never
    // invited" from "invited before, now available again". invite_canvas_collaborator (see
    // 20260808_fix_canvas_collab_reinvite.sql) upserts instead, same insert-on-conflict pattern
    // revoke_canvas_collaboration already uses for its own direction.
    async function sendCanvasCollabInvite(collaboratorId) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const { error } = await supabase.rpc('invite_canvas_collaborator', {
            p_folder_id: appState.currentFolderId, p_folder_title: folderObj.title, p_collaborator_id: collaboratorId,
        });
        if (error) { console.error('[collab] failed to send canvas collaboration invite:', error); return; }
        appState.outgoingCanvasInvitePendingIds.add(collaboratorId);
    }
    // Explicitly blocks this collaborator from THIS exact folder, even if their access here was
    // only inherited from a parent canvas — see revoke_canvas_collaboration. Their access to any
    // sibling canvas (or the parent itself) is untouched.
    async function revokeCanvasCollab(collaboratorId) {
        if (!supabase || !appState.currentUser.id) return;
        const { error } = await supabase.rpc('revoke_canvas_collaboration', { p_folder_id: appState.currentFolderId, p_collaborator_id: collaboratorId });
        if (error) console.error('[collab] failed to remove collaborator:', error);
    }
    // Keeps the Collaborations panel's cached folder_title in sync after a rename — that column is
    // an invite-time snapshot only (see its own comment in 20260726_add_canvas_collaboration.sql),
    // never refreshed on its own. Called from the breadcrumb rename flow (the app's one rename
    // entry point — see the crumb-item span.onblur), which fires the same way whether folderId is
    // owned outright or a shared view the current user is a collaborator on, so this resolves the
    // real owner/folder id exactly like syncWaypointToDb/deleteWaypointFromDb do, then goes through
    // rename_canvas_collaborations (SECURITY DEFINER) rather than a raw table update since a
    // collaborator has no RLS-visible row of their own to satisfy an owner-only update policy with.
    async function syncCanvasCollabTitle(folderId, newTitle) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
        const { error } = await supabase.rpc('rename_canvas_collaborations', {
            p_owner_id: ownerId, p_folder_id: realFolderId, p_new_title: newTitle,
        });
        if (error) console.error('[collab] failed to sync renamed canvas title:', error);
    }

    // Real React state now (see app/dotto/CollabListPanel.jsx, collabListStore) — genuine JSX
    // rows, same reasoning as WaypointsListPanel (no complex per-row widget state — an avatar, a
    // name, a live-presence dot, an Add/Remove/Requested button). Unlike the
    // Hub Collab/Messages panels, this one has no Requests drill-down of its own — adding someone
    // doesn't grant access immediately, it sends a request (like a friend request) that shows as
    // "Requested" here until they accept it from THEIR OWN hamburger Collaborations panel (see
    // renderHubCollabRequests). Someone already collaborating (directly or inherited) shows
    // "Remove" instead, which always acts on this exact folder — removing someone with only
    // inherited access creates an explicit block scoped to just this folder, not a no-op (see
    // revokeCanvasCollab).
    async function renderCollabList(query) {
        await Promise.all([refreshFriendsData(), refreshCanvasCollabForCurrentFolder()]);
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        folderObj.collaborators = folderObj.collaborators || [];
        const q = (query || '').trim().toLowerCase();
        const isCollab = (id) => folderObj.collaborators.includes(id);

        // A live presence dot + clickable name only makes sense for someone who's both an actual
        // collaborator here AND currently present on this exact canvas right now (see
        // remoteCursors/handleCanvasPresenceSync) — not just anyone in the friends list.
        function toRow(f) {
            const added = isCollab(f.id);
            const pending = appState.outgoingCanvasInvitePendingIds.has(f.id);
            return {
                id: f.id, displayName: f.displayName, avatarId: f.avatarId ?? 0, avatarUrl: f.avatarUrl || null,
                added, pending, isPresent: added && appState.remoteCursors.has(f.id),
            };
        }

        // Search covers the whole friends list, no cap. Otherwise (the default view): every
        // current collaborator always shows (regardless of ranking, so Remove is always
        // reachable), then up to COLLAB_LIST_MAX more from recency/conversation — no
        // "Collaborators"/"Recently active"/"Most conversed with" subheadings, just one list.
        if (q) {
            const results = appState.friends.filter(f => f.displayName.toLowerCase().includes(q));
            window.__setCollabList({ rows: results.map(toRow), query: q });
            return;
        }

        const current = folderObj.collaborators.map(id => appState.friends.find(f => f.id === id)).filter(Boolean);
        const seen = new Set(current.map(f => f.id));
        const rest = appState.friends.filter(f => !seen.has(f.id));
        const byRecent = [...rest].sort((a, b) => (a.lastActive ?? 9999) - (b.lastActive ?? 9999));
        const byConversed = [...rest].sort((a, b) => b.messages.length - a.messages.length);
        const merged = current.slice();
        for (let i = 0; merged.length < appState.COLLAB_LIST_MAX && (i < byRecent.length || i < byConversed.length); i++) {
            const r = byRecent[i];
            if (r && !seen.has(r.id)) { seen.add(r.id); merged.push(r); }
            if (merged.length >= appState.COLLAB_LIST_MAX) break;
            const c = byConversed[i];
            if (c && !seen.has(c.id)) { seen.add(c.id); merged.push(c); }
        }
        window.__setCollabList({ rows: merged.map(toRow), query: '' });
    }
    // Wired up from CollabListPanel.jsx's Add/Remove button handler.
    async function handleCollabAddRemoveClick(friendId, added, pending, query) {
        if (pending) return;
        if (added) await revokeCanvasCollab(friendId);
        else await sendCanvasCollabInvite(friendId);
        renderCollabList(query);
    }
    function handleCollabSearch(v) { renderCollabList(v); }

    // Real React state now (see app/dotto/PaneTopBar.jsx, collabPillStore) — genuine JSX, same
    // Avatar.jsx-based reasoning as CollabListPanel. Pane-keyed since split-screen Stage 8 (each
    // pane renders its own bubble now — was a single shared trigger for whichever pane happened to
    // be active). paneId defaults to the live active pane, same reasoning as renderTabsPanel/
    // renderBreadcrumbMapPanel (app/dotto/lib/tabManagement.ts) — this always reads the LIVE
    // appState.currentFolderId/folders/friends, so it's only ever meaningful for whichever pane is
    // currently active; called every render() frame for that pane (so a background pane's own store
    // stays exactly as it was the instant it went inactive, matching what its canvas actually
    // showed), and once more immediately after switchActivePane's own swap (that function's own
    // comment) so the newly active pane's pill doesn't wait a frame to refresh. MUST be flushSync'd
    // (see app/dotto-app.jsx): openCollabPanel, right below, reads collabBubble's `.show` class
    // synchronously right after a caller in hamburger-collab.js calls this.
    function renderCollabPill(paneId = appState.activePaneId) {
        const folderObj = appState.folders[appState.currentFolderId];
        // The root canvas is always private to the user, so no collaborators indicator there —
        // checked by identity (currentFolderId === 'root'), not historyIndex === 0. Those used to
        // coincide, but historyIndex now tracks raw click-order navigation history (back/forward),
        // which can be > 0 while sitting AT root after a cross-tree jump (a waypoint, search, or
        // the hamburger menu can all land you back on root without historyIndex resetting to 0 —
        // see findParentFolderId/the breadcrumb "..", which had the same bug for the same reason).
        // A canvas someone else shared with you isn't yours to invite further collaborators on.
        if (!folderObj || appState.currentFolderId === 'root' || folderObj.isSharedView) {
            closeCollabPanel();
            window.__setCollabPill(paneId, { show: false, collabs: [], moreCount: 0 });
            return;
        }
        const collabIds = folderObj.collaborators || [];
        const collabs = collabIds.map(id => appState.friends.find(f => f.id === id)).filter(Boolean);
        const shown = collabs.slice(0, 3).map(f => ({ id: f.id, avatarId: f.avatarId ?? 0, avatarUrl: f.avatarUrl || null, displayName: f.displayName }));
        window.__setCollabPill(paneId, { show: true, collabs: shown, moreCount: Math.max(0, collabs.length - 3) });
    }

    // `friends` / incoming / outgoing requests are loaded from Supabase
    // (`profiles` + `friendships`) via refreshFriendsData() below, called on
    // script init and again whenever a messages/collab panel is opened.
    // `messages` per friend stays a local-only array for now — chat isn't
    // wired to the `messages` table yet, so anything sent here is transient
    // (lost on reload) until that's built.
 // [{ id: friendshipId, requester: {id, username, displayName} }]
 // profile ids we've already sent a pending request to
    // null until refreshFriendsData's first run — that first run is a baseline (no notifications;
    // whatever's already pending when the app loads isn't "just received"), every run after that
    // notifies for any request id that wasn't in the set yet.

    async function refreshFriendsData() {
        if (!supabase || !appState.currentUser.id) return;

        const { data: accepted, error: acceptedErr } = await supabase
            .from('friendships')
            .select('id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_id, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_id, avatar_url)')
            .eq('status', 'accepted')
            .or(`requester_id.eq.${appState.currentUser.id},addressee_id.eq.${appState.currentUser.id}`);
        if (acceptedErr) console.error('[friends] failed to load friendships:', acceptedErr);

        appState.friends = (accepted || []).map(row => {
            const other = row.requester_id === appState.currentUser.id ? row.addressee : row.requester;
            return {
                id: other.id,
                friendshipId: row.id,
                username: other.username,
                displayName: other.display_name || other.username,
                avatarId: other.avatar_id ?? 0,
                avatarUrl: other.avatar_url || null,
                messages: []
            };
        });
        // This query is already symmetric (requester OR addressee = me), so friends.length is
        // always this user's true total regardless of who sent/accepted — sync it in as an
        // absolute value rather than incrementing, since respondToFriendRequest only runs on the
        // accepting side and would otherwise never move the requester's own count.
        bumpAchievementStat('three_friends', appState.friends.length, true);

        // Loaded in one round trip (not lazily per-conversation) so the chat
        // list's preview text and the collab panel's "most conversed with"
        // sort both reflect real data without an extra fetch each.
        const friendshipIds = appState.friends.map(f => f.friendshipId);
        if (friendshipIds.length) {
            const { data: allMessages, error: messagesErr } = await supabase
                .from('messages')
                .select('id, friendship_id, sender_id, body, canvas_snapshot, created_at')
                .in('friendship_id', friendshipIds)
                .order('created_at', { ascending: true });
            if (messagesErr) console.error('[chat] failed to load messages:', messagesErr);
            const byFriendship = new Map();
            (allMessages || []).forEach(m => {
                if (!byFriendship.has(m.friendship_id)) byFriendship.set(m.friendship_id, []);
                byFriendship.get(m.friendship_id).push({
                    id: m.id, senderId: m.sender_id, text: m.body,
                    canvasSnapshot: m.canvas_snapshot, createdAt: m.created_at
                });
            });
            appState.friends.forEach(f => { f.messages = byFriendship.get(f.friendshipId) || []; });
        }

        const { data: incoming, error: incomingErr } = await supabase
            .from('friendships')
            .select('id, requester:profiles!friendships_requester_id_fkey(id, username, display_name)')
            .eq('status', 'pending')
            .eq('addressee_id', appState.currentUser.id);
        if (incomingErr) console.error('[friends] failed to load incoming requests:', incomingErr);
        appState.incomingRequests = incoming || [];
        if (appState.seenIncomingFriendRequestIds === null) {
            appState.seenIncomingFriendRequestIds = new Set(appState.incomingRequests.map(r => r.id));
        } else {
            appState.incomingRequests.forEach(r => {
                if (appState.seenIncomingFriendRequestIds.has(r.id)) return;
                appState.seenIncomingFriendRequestIds.add(r.id);
                window.pushNotification({
                    type: 'friend_request',
                    message: `@${r.requester.username} sent you a friend request`,
                    actionLabel: 'Accept',
                    onAction: () => respondToFriendRequest(r.id, true),
                    // No dismiss button — Escape hides it without accepting, request stays pending
                    // (see Requests in the Chats panel).
                    sticky: true,
                });
            });
        }

        const { data: outgoing, error: outgoingErr } = await supabase
            .from('friendships')
            .select('addressee_id')
            .eq('status', 'pending')
            .eq('requester_id', appState.currentUser.id);
        if (outgoingErr) console.error('[friends] failed to load outgoing requests:', outgoingErr);
        appState.outgoingPendingIds = new Set((outgoing || []).map(r => r.addressee_id));

        subscribeToAllFriendMessages();
    }

    async function sendFriendRequest(userId) {
        if (!supabase || !appState.currentUser.id) return;
        const { error } = await supabase
            .from('friendships')
            .insert({ requester_id: appState.currentUser.id, addressee_id: userId });
        if (error) { console.error('[friends] failed to send request:', error); return; }
        appState.outgoingPendingIds.add(userId);
    }

    async function respondToFriendRequest(friendshipId, accept) {
        if (!supabase) return;
        const { error } = accept
            ? await supabase.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', friendshipId)
            : await supabase.from('friendships').delete().eq('id', friendshipId);
        if (error) console.error('[friends] failed to respond to request:', error);
    }

    async function searchDiscoverableUsers(query) {
        if (!supabase || !query) return [];
        const { data, error } = await supabase
            .from('profiles')
            .select('id, username, display_name')
            .ilike('username', `%${query}%`)
            .neq('id', appState.currentUser.id)
            .limit(10);
        if (error) { console.error('[friends] failed to search users:', error); return []; }
        const friendIds = new Set(appState.friends.map(f => f.id));
        return (data || [])
            .filter(u => !friendIds.has(u.id))
            .map(u => ({ id: u.id, username: u.username, displayName: u.display_name || u.username }));
    }

    // Exact-match counterpart to searchDiscoverableUsers above, for the slash-command "invite
    // <username>"/"remove <username>" verbs (command-verbs.js) — those need to resolve one exact
    // username typed as a command argument, not a fuzzy list to pick from. Deliberately doesn't
    // require the target to already be a friend (unlike the existing Collaborations-panel invite
    // flow, which only lists friends) — that restriction lives entirely in that panel's own UI,
    // not in invite_canvas_collaborator itself, so a command can bypass it correctly rather than
    // working around a UI-only gate.
    async function resolveUsernameToUserId(username) {
        if (!supabase || !username) return null;
        const { data, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .neq('id', appState.currentUser.id)
            .maybeSingle();
        if (error) { console.error(`[commands] username lookup failed: message=${error.message} code=${error.code}`); return null; }
        return data ? data.id : null;
    }

    function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
    function lastPreview(f) { const m = f.messages[f.messages.length - 1]; return m ? m.text : 'No messages yet'; }

    // 'main' (chat list + "Add a friend" search) / 'requests' (every incoming friend request,
    // Accept/Decline each) — same drill-down pattern as hubCollabView in the Collaborations hub
    // panel, right down to reusing its "Requests" row/count-badge/back-row styling. The Requests
    // row itself only ever shows when there's actually something in it, exactly like that panel.
    // Real React state now (see app/dotto/MessagesListPanel.jsx, msgListStore) — same two-view
    // shape (main list + Requests drill-down) as HubCollabListPanel, genuine JSX rows for the same
    // reason (no complex per-row widget state). The actual conversation thread (openConvo/
    // renderConvoBody, live-presence.js) stays vanilla — that's part of the much larger "Live
    // canvas presence + real-time content sync" cluster (PHASE2_ROADMAP.md item 11), not this
    // list, and needs its own foundation-first pass; a chat row here just calls window.__openConvo.
    async function renderMsgList(query) {
        await refreshFriendsData();
        if (appState.msgView === 'requests') { renderMsgRequests(); return; }
        const q = (query || '').trim().toLowerCase();
        const matchedFriends = appState.friends
            .filter(f => f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
            .map(f => ({ id: f.id, displayName: f.displayName, avatarId: f.avatarId ?? 0, avatarUrl: f.avatarUrl || null, preview: lastPreview(f) }));
        let searchResults = [];
        if (q) {
            const users = await searchDiscoverableUsers(q);
            searchResults = users.map(u => ({ id: u.id, username: u.username, pending: appState.outgoingPendingIds.has(u.id) }));
        }
        window.__setMsgList({ view: 'main', requestsCount: appState.incomingRequests.length, matchedFriends, searchResults, query: q });
    }
    function renderMsgRequests() {
        window.__setMsgList({
            view: 'requests',
            requests: appState.incomingRequests.map(req => ({ id: req.id, username: req.requester.username })),
        });
    }
    // Wired up from MessagesListPanel.jsx's JSX handlers — see that file for the row shapes these
    // feed.
    function openMsgRequestsView() { appState.msgView = 'requests'; renderMsgRequests(); }
    function backToMsgMain() { appState.msgView = 'main'; renderMsgList(appState.msgSearchInput.value); }
    async function handleAddFriendClick(userId, query) {
        if (appState.outgoingPendingIds.has(userId)) return;
        await sendFriendRequest(userId);
        renderMsgList(query);
    }
    async function respondToMsgRequest(id, accept) {
        await respondToFriendRequest(id, accept);
        await refreshFriendsData();
        renderMsgRequests();
    }
    function handleMsgSearch(v) { renderMsgList(v); }

    // Standing subscription per friendship — not just whichever one is currently open — so a
    // message can be caught and turned into a notification (see pushNotification) no matter what
    // you're looking at. This is also the natural hook point for real push notifications later
    // (screen-locked mobile, etc.): that needs a server-side piece (an Edge Function/DB trigger
    // calling Web Push, plus a push-subscription table) that doesn't exist yet, but whatever
    // fires that should live right alongside where this client-side notification fires, since
    // it's the same underlying event.
    //
    // Rebuilt to match the friends list every time refreshFriendsData runs (see its call to this
    // at the end) — diffs against the currently-subscribed set rather than tearing everything
    // down and re-subscribing every time, since that runs fairly often (init, every time a
    // messages/collab panel opens). Each channel's own handler looks up its friend object LIVE
    // (by friendshipId, via friends.find) rather than closing over the `f` reference captured at
    // subscribe time — refreshFriendsData replaces the whole `friends` array with fresh objects
    // on every call, so a closed-over reference would silently go stale.
    // ---------- Friend presence (online / afk / logout) ----------
    // Reuses the SAME per-friendship channel as messages below rather than opening a second one
    // — both participants in a friendship already open a channel with this exact topic, so
    // Realtime Presence naturally scopes "who's here" to just the two of you, no extra
    // infrastructure needed. Each channel is given an explicit presence key (this user's own id)
    // so the other side's entry can be looked up directly by their id in presenceState().
    //
    // Idle detection is ONE shared timer for the whole tab (not per friend) — any mouse/keyboard/
    // pointer activity resets it; AFK_THRESHOLD_MS of silence flips to 'afk'. Whenever that local
    // status actually changes, every open friend channel is re-tracked with it, which is what
    // shows up as a 'sync' event (not 'join'/'leave' — the presence key doesn't change, just its
    // payload) on the other end.
    function setLocalPresenceStatus(status) {
        if (appState.localPresenceStatus === status) return;
        appState.localPresenceStatus = status;
        appState.friendMessageChannels.forEach(channel => channel.track({ status: appState.localPresenceStatus }));
    }
    function resetAfkTimer() {
        setLocalPresenceStatus('online');
        clearTimeout(appState.afkTimer);
        appState.afkTimer = setTimeout(() => setLocalPresenceStatus('afk'), appState.AFK_THRESHOLD_MS);
    }
    ['mousemove', 'mousedown', 'keydown', 'pointerdown', 'wheel', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetAfkTimer, { passive: true });
    });
    resetAfkTimer();

    // friendshipId -> that friend's last known status this session ('online'/'afk'), or null if
    // they're not present in the channel at all (offline) — undefined (never set) means "haven't
    // heard from this channel yet", which is what tells the very first sync apart from a real
    // transition: a friend already online when you load the app shouldn't fire a spurious "came
    // online" notification, only a genuine change after that baseline should.
    function handleFriendPresenceSync(friendshipId, channel) {
        const live = appState.friends.find(x => x.friendshipId === friendshipId);
        if (!live) return;
        const metas = channel.presenceState()[live.id] || []; // presence key = the friend's own user id
        const nowStatus = metas.length ? (metas[0].status || 'online') : null;
        const prev = appState.friendPresenceLastStatus.get(friendshipId);
        if (nowStatus === prev) return;
        appState.friendPresenceLastStatus.set(friendshipId, nowStatus);
        if (prev === undefined) return; // first sync since subscribing — baseline only, not a real transition
        if (nowStatus === 'online') {
            window.pushNotification({
                type: 'friend_online',
                message: `${live.displayName} is online`,
                actionLabel: 'Chat',
                onAction: () => { openMessagesPanel(true); openConvo(live.id); },
            }); // one button, auto-dismisses — no dismiss function
        } else if (nowStatus === null) {
            window.pushNotification({ type: 'friend_offline', message: `${live.displayName} logged off` }); // no buttons, auto-dismisses — no dismiss function
        } else if (nowStatus === 'afk') {
            window.pushNotification({ type: 'friend_afk', message: `${live.displayName} is away` }); // no buttons, auto-dismisses — no dismiss function
        }
    }

 // friendshipId -> realtime channel
    function subscribeToAllFriendMessages() {
        if (!supabase) return;
        const liveFriendshipIds = new Set(appState.friends.map(f => f.friendshipId));

        for (const [friendshipId, channel] of appState.friendMessageChannels) {
            if (!liveFriendshipIds.has(friendshipId)) {
                supabase.removeChannel(channel);
                appState.friendMessageChannels.delete(friendshipId);
                appState.friendPresenceLastStatus.delete(friendshipId);
            }
        }

        appState.friends.forEach(f => {
            if (appState.friendMessageChannels.has(f.friendshipId)) return; // already subscribed
            const friendshipId = f.friendshipId;
            const channel = supabase
                .channel(`messages:${friendshipId}`, { config: { presence: { key: appState.currentUser.id } } })
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `friendship_id=eq.${friendshipId}` }, (payload) => {
                    const m = payload.new;
                    if (m.sender_id === appState.currentUser.id) return; // our own message — already added optimistically by sendMsg
                    const live = appState.friends.find(x => x.friendshipId === friendshipId);
                    if (!live) return; // unfriended (or a stale refresh) since this fired
                    if (live.messages.some(existing => existing.id === m.id)) return; // already have it somehow
                    live.messages.push({ id: m.id, senderId: m.sender_id, text: m.body, canvasSnapshot: m.canvas_snapshot, createdAt: m.created_at });
                    const isActivelyViewing = appState.activeConvoId === live.id && appState.messagesPanel.classList.contains('open');
                    if (isActivelyViewing) {
                        renderConvoBody(live);
                    } else {
                        // renderMsgList only ever runs on open/search/etc. (see its own call
                        // sites) — never just because a message arrived, so the chat list's
                        // preview text (lastPreview) would otherwise keep showing whatever was
                        // last there until the panel is closed and reopened. Refresh it here too,
                        // but only when the list is what's actually showing right now (not the
                        // Requests drill-down, not a conversation) — matches closeConvo's own
                        // "refresh when returning to the list" fix (live-presence.js).
                        if (appState.messagesPanel.classList.contains('open') && appState.msgView === 'main') {
                            renderMsgList(appState.msgSearchInput.value);
                        }
                        window.pushNotification({
                            type: 'chat',
                            message: `${live.displayName}: ${(m.body || '').trim().slice(0, 80) || 'New message'}`,
                            actionLabel: 'Reply',
                            onAction: () => { openMessagesPanel(true); openConvo(live.id); },
                        }); // one button, auto-dismisses — no dismiss function
                    }
                })
                .on('presence', { event: 'sync' }, () => handleFriendPresenceSync(friendshipId, channel))
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') channel.track({ status: appState.localPresenceStatus });
                });
            appState.friendMessageChannels.set(friendshipId, channel);
        });
    }

export { activePaneCollabBubbleEl, backToMsgMain, closeCollabPanel, collabBubblePaneClick, collabBubblePaneMouseEnter, collabBubblePaneMouseLeave, handleAddFriendClick, handleCollabAddRemoveClick, handleCollabSearch, handleMsgSearch, initials, openCollabPanel, openMsgRequestsView, refreshCanvasCollabForCurrentFolder, refreshFriendsData, renderCollabPill, renderMsgList, resolveUsernameToUserId, respondToMsgRequest, syncCanvasCollabTitle };

// React → vanilla bridge — used by MessagesListPanel.jsx/CollabListPanel.jsx/PaneTopBar.jsx
// (app/dotto/), which can't import these directly since public/dotto/*.js isn't reachable from
// app/dotto/.
window.__openMsgRequestsView = openMsgRequestsView;
window.__backToMsgMain = backToMsgMain;
window.__handleAddFriendClick = handleAddFriendClick;
window.__handleCollabAddRemoveClick = handleCollabAddRemoveClick;
window.__respondToMsgRequest = respondToMsgRequest;
window.__openCollabPanel = openCollabPanel;
// PaneTopBar.jsx's own collaborator bubble onClick/onMouseEnter/onMouseLeave — see
// collabBubblePaneClick's own comment above for why these replace the old singular
// appState.collabBubble.addEventListener(...) wiring this file used to attach itself.
window.__collabBubblePaneClick = collabBubblePaneClick;
window.__collabBubblePaneMouseEnter = collabBubblePaneMouseEnter;
window.__collabBubblePaneMouseLeave = collabBubblePaneMouseLeave;
// Called from switchActivePane (core-state.js) via this bridge, not a direct import — that
// function is imported BY this file, so the reverse would be circular (same reasoning as
// window.__renderTabsPanel, app/dotto/lib/tabManagement.ts).
window.__renderCollabPill = renderCollabPill;
// Used by app/dotto/lib/shelfSearch.ts's startRenameShelfSourceRow (Phase 4.4).
window.__syncCanvasCollabTitle = syncCanvasCollabTitle;
// Used by app/dotto/lib/sourceButtonsCursorMode.ts's window.onclick handler (Phase 4.4).
window.__closeCollabPanel = closeCollabPanel;

// No window.__initials bridge — Avatar.jsx (app/dotto/) reimplements this directly instead (see
// its own comment for why: plain string logic with no vanilla-only dependency, and needing it to
// work on React's very first commit, before dotto-script.js is guaranteed loaded, ruled out a
// bridge here specifically).
