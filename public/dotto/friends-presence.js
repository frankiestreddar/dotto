import { clearSearch, escapeHtml } from './ai-assistant-suggestions.js';
import { appState, supabase } from './core-state.js';
import { ensureCanvasPresenceChannel, goToCollaboratorCursor, openConvo, remoteCursors, renderConvoBody } from './live-presence.js';
import { messagesPanel, msgList, msgSearchInput, openMessagesPanel } from './messages-schedule.js';
import { closeAllPanels, panelPinned, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { bumpAchievementStat, renderAvatarInto } from './profile-achievements-pricing.js';
import { pushNotification } from './stopwatch-search-notifications.js';


    // ---------- Collaborators Pill/Panel Controls ----------
    const collabBubble = document.getElementById('collab-bubble'), collabPanel = document.getElementById('collab-panel');
    const collabSearchInput = document.getElementById('collab-search');
    function getCurrentCollaboratorIds() {
        const folderObj = appState.folders[appState.currentFolderId];
        return (folderObj && folderObj.collaborators) ? folderObj.collaborators : [];
    }
    function closeCollabPanel() { collabPanel.classList.remove('open'); panelPinned.collab = false; }
    function positionCollabPanel() {
        const rect = collabBubble.getBoundingClientRect();
        collabPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 280;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        collabPanel.style.left = leftPos + 'px';
        collabPanel.style.right = 'auto';
    }
    function openCollabPanel(pin) {
        if (!collabBubble.classList.contains('show')) return;
        closeAllPanels('collab');
        clearSearch();
        collabPanel.classList.add('open');
        collabSearchInput.value = '';
        renderCollabList('');
        positionCollabPanel();
        if (pin) { panelPinned.collab = true; }
    }
    collabBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.collab) { closeCollabPanel(); }
        else { openCollabPanel(true); }
    });
    collabBubble.addEventListener('mouseenter', () => {
        // Only auto-open on hover when there are no collaborators yet (the "+" affordance);
        // once collaborators exist, hover just reveals the tooltip and click opens the panel.
        if (getCurrentCollaboratorIds().length === 0 && !collabPanel.classList.contains('open')) openCollabPanel(false);
    });
    collabBubble.addEventListener('mouseleave', () => scheduleHoverClose('collab', [collabBubble, collabPanel], closeCollabPanel));
    collabPanel.addEventListener('mouseleave', () => scheduleHoverClose('collab', [collabBubble, collabPanel], closeCollabPanel));
    pinOnInsideClick('collab', [collabPanel]);

    // Who's already accepted (including inherited from an ancestor canvas — see
    // get_effective_collaborators/canvas_access_status), and who has a pending invite at THIS
    // exact folder, for the folder currently open in the per-canvas collab panel — refreshed each
    // time that panel (re)opens (see renderCollabList). folders[id].collaborators itself is the
    // effective-accepted list (kept here rather than a separate variable so the rest of the app —
    // the collab bubble/pill — can keep reading it exactly like before); a pending invite is
    // always level-specific (never inherited), so that part stays an exact-folder query.
    let outgoingCanvasInvitePendingIds = new Set();
    async function refreshCanvasCollabForCurrentFolder() {
        if (!supabase || !appState.currentUser.id) { outgoingCanvasInvitePendingIds = new Set(); return; }
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
        outgoingCanvasInvitePendingIds = new Set((pendingRes.data || []).map(r => r.collaborator_id));
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
    async function sendCanvasCollabInvite(collaboratorId) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const { error } = await supabase.from('canvas_collaborations').insert({
            owner_id: appState.currentUser.id, folder_id: appState.currentFolderId,
            folder_title: folderObj.title, collaborator_id: collaboratorId,
        });
        if (error) { console.error('[collab] failed to send canvas collaboration invite:', error); return; }
        outgoingCanvasInvitePendingIds.add(collaboratorId);
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

    const COLLAB_LIST_MAX = 6;
    async function renderCollabList(query) {
        await Promise.all([refreshFriendsData(), refreshCanvasCollabForCurrentFolder()]);
        const list = document.getElementById('collab-list');
        list.innerHTML = '';
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        folderObj.collaborators = folderObj.collaborators || [];
        const q = (query || '').trim().toLowerCase();
        const isCollab = (id) => folderObj.collaborators.includes(id);

        // Adding someone doesn't grant access immediately — it sends a request (like a friend
        // request) that shows as "Requested" until they accept it from their own hamburger
        // Collaborations panel (see renderHubCollabRequests). Someone already collaborating
        // (directly or inherited) shows "Remove" instead, which always acts on this exact folder
        // — removing someone with only inherited access creates an explicit block scoped to just
        // this folder, not a no-op (see revokeCanvasCollab).
        function addRow(f) {
            const row = document.createElement('div');
            row.className = 'collab-row';
            const added = isCollab(f.id);
            const pending = outgoingCanvasInvitePendingIds.has(f.id);
            const label = added ? 'Remove' : pending ? 'Requested' : 'Add';
            // A live presence dot + clickable name only makes sense for someone who's both an
            // actual collaborator here AND currently present on this exact canvas right now (see
            // remoteCursors/handleCanvasPresenceSync) — not just anyone in the friends list.
            const isPresent = added && remoteCursors.has(f.id);
            row.innerHTML = `<div class="collab-row-avatar"></div>
                <div class="collab-row-meta"><div class="collab-row-name${isPresent ? ' collab-row-name-live' : ''}">${escapeHtml(f.displayName)}${isPresent ? '<span class="collab-row-live-dot"></span>' : ''}</div></div>
                <button class="collab-add-btn ${added ? 'added' : ''} ${pending ? 'pending' : ''}" ${pending ? 'disabled' : ''}>${label}</button>`;
            renderAvatarInto(row.querySelector('.collab-row-avatar'), { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
            if (isPresent) {
                row.querySelector('.collab-row-name').onclick = (e) => {
                    e.stopPropagation();
                    goToCollaboratorCursor(f.id);
                };
            }
            row.querySelector('.collab-add-btn').onclick = async (e) => {
                e.stopPropagation();
                if (pending) return;
                if (added) await revokeCanvasCollab(f.id);
                else await sendCanvasCollabInvite(f.id);
                renderCollabList(query);
            };
            list.appendChild(row);
        }

        // Search covers the whole friends list, no cap. Otherwise (the default view): every
        // current collaborator always shows (regardless of ranking, so Remove is always
        // reachable), then up to COLLAB_LIST_MAX more from recency/conversation — no
        // "Collaborators"/"Recently active"/"Most conversed with" subheadings, just one list.
        if (q) {
            const results = friends.filter(f => f.displayName.toLowerCase().includes(q));
            if (results.length) results.forEach(f => addRow(f));
            else {
                const empty = document.createElement('div');
                empty.className = 'collab-empty';
                empty.textContent = 'No friends found.';
                list.appendChild(empty);
            }
            return;
        }

        const current = folderObj.collaborators.map(id => friends.find(f => f.id === id)).filter(Boolean);
        const seen = new Set(current.map(f => f.id));
        const rest = friends.filter(f => !seen.has(f.id));
        const byRecent = [...rest].sort((a, b) => (a.lastActive ?? 9999) - (b.lastActive ?? 9999));
        const byConversed = [...rest].sort((a, b) => b.messages.length - a.messages.length);
        const merged = current.slice();
        for (let i = 0; merged.length < COLLAB_LIST_MAX && (i < byRecent.length || i < byConversed.length); i++) {
            const r = byRecent[i];
            if (r && !seen.has(r.id)) { seen.add(r.id); merged.push(r); }
            if (merged.length >= COLLAB_LIST_MAX) break;
            const c = byConversed[i];
            if (c && !seen.has(c.id)) { seen.add(c.id); merged.push(c); }
        }
        if (!merged.length) {
            const empty = document.createElement('div');
            empty.className = 'collab-empty';
            empty.textContent = 'No friends yet.';
            list.appendChild(empty);
            return;
        }
        merged.forEach(f => addRow(f));
    }
    function handleCollabSearch(v) { renderCollabList(v); }

    function renderCollabPill() {
        const folderObj = appState.folders[appState.currentFolderId];
        // The root canvas is always private to the user, so no collaborators indicator there —
        // checked by identity (currentFolderId === 'root'), not historyIndex === 0. Those used to
        // coincide, but historyIndex now tracks raw click-order navigation history (back/forward),
        // which can be > 0 while sitting AT root after a cross-tree jump (a waypoint, search, or
        // the hamburger menu can all land you back on root without historyIndex resetting to 0 —
        // see findParentFolderId/the breadcrumb "..", which had the same bug for the same reason).
        // A canvas someone else shared with you isn't yours to invite further collaborators on.
        if (!folderObj || appState.currentFolderId === 'root' || folderObj.isSharedView) {
            collabBubble.classList.remove('show');
            closeCollabPanel();
            return;
        }
        collabBubble.classList.add('show');
        const collabIds = folderObj.collaborators || [];
        const collabs = collabIds.map(id => friends.find(f => f.id === id)).filter(Boolean);
        const content = document.getElementById('collab-content');
        const tooltip = document.getElementById('collab-tooltip');
        if (collabs.length === 0) {
            content.innerHTML = `<button id="collab-add-btn" title="Add collaborators" onclick="event.stopPropagation(); openCollabPanel(true);">+</button>`;
            tooltip.textContent = '';
        } else {
            tooltip.textContent = collabs.length + (collabs.length === 1 ? ' collaborator' : ' collaborators');
            const shown = collabs.slice(0, 3);
            let html = '<div class="collab-avatars">';
            shown.forEach((f, i) => { html += `<div class="collab-avatar" data-idx="${i}"></div>`; });
            if (collabs.length > 3) html += `<div class="collab-avatar collab-more">+${collabs.length - 3}</div>`;
            html += '</div>';
            content.innerHTML = html;
            content.querySelectorAll('.collab-avatar[data-idx]').forEach(el => {
                const f = shown[parseInt(el.dataset.idx, 10)];
                renderAvatarInto(el, { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
            });
        }
    }

    // `friends` / incoming / outgoing requests are loaded from Supabase
    // (`profiles` + `friendships`) via refreshFriendsData() below, called on
    // script init and again whenever a messages/collab panel is opened.
    // `messages` per friend stays a local-only array for now — chat isn't
    // wired to the `messages` table yet, so anything sent here is transient
    // (lost on reload) until that's built.
    let friends = [];
    let incomingRequests = []; // [{ id: friendshipId, requester: {id, username, displayName} }]
    let outgoingPendingIds = new Set(); // profile ids we've already sent a pending request to
    // null until refreshFriendsData's first run — that first run is a baseline (no notifications;
    // whatever's already pending when the app loads isn't "just received"), every run after that
    // notifies for any request id that wasn't in the set yet.
    let seenIncomingFriendRequestIds = null;

    async function refreshFriendsData() {
        if (!supabase || !appState.currentUser.id) return;

        const { data: accepted, error: acceptedErr } = await supabase
            .from('friendships')
            .select('id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_id, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_id, avatar_url)')
            .eq('status', 'accepted')
            .or(`requester_id.eq.${appState.currentUser.id},addressee_id.eq.${appState.currentUser.id}`);
        if (acceptedErr) console.error('[friends] failed to load friendships:', acceptedErr);

        friends = (accepted || []).map(row => {
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
        bumpAchievementStat('three_friends', friends.length, true);

        // Loaded in one round trip (not lazily per-conversation) so the chat
        // list's preview text and the collab panel's "most conversed with"
        // sort both reflect real data without an extra fetch each.
        const friendshipIds = friends.map(f => f.friendshipId);
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
            friends.forEach(f => { f.messages = byFriendship.get(f.friendshipId) || []; });
        }

        const { data: incoming, error: incomingErr } = await supabase
            .from('friendships')
            .select('id, requester:profiles!friendships_requester_id_fkey(id, username, display_name)')
            .eq('status', 'pending')
            .eq('addressee_id', appState.currentUser.id);
        if (incomingErr) console.error('[friends] failed to load incoming requests:', incomingErr);
        incomingRequests = incoming || [];
        if (seenIncomingFriendRequestIds === null) {
            seenIncomingFriendRequestIds = new Set(incomingRequests.map(r => r.id));
        } else {
            incomingRequests.forEach(r => {
                if (seenIncomingFriendRequestIds.has(r.id)) return;
                seenIncomingFriendRequestIds.add(r.id);
                pushNotification({
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
        outgoingPendingIds = new Set((outgoing || []).map(r => r.addressee_id));

        subscribeToAllFriendMessages();
    }

    async function sendFriendRequest(userId) {
        if (!supabase || !appState.currentUser.id) return;
        const { error } = await supabase
            .from('friendships')
            .insert({ requester_id: appState.currentUser.id, addressee_id: userId });
        if (error) { console.error('[friends] failed to send request:', error); return; }
        outgoingPendingIds.add(userId);
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
        const friendIds = new Set(friends.map(f => f.id));
        return (data || [])
            .filter(u => !friendIds.has(u.id))
            .map(u => ({ id: u.id, username: u.username, displayName: u.display_name || u.username }));
    }

    function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
    function lastPreview(f) { const m = f.messages[f.messages.length - 1]; return m ? m.text : 'No messages yet'; }

    // 'main' (chat list + "Add a friend" search) / 'requests' (every incoming friend request,
    // Accept/Decline each) — same drill-down pattern as hubCollabView in the Collaborations hub
    // panel, right down to reusing its "Requests" row/count-badge/back-row styling. The Requests
    // row itself only ever shows when there's actually something in it, exactly like that panel.
    async function renderMsgList(query) {
        await refreshFriendsData();
        if (appState.msgView === 'requests') { renderMsgRequests(); return; }
        msgList.innerHTML = '';
        const q = (query || '').trim().toLowerCase();

        if (incomingRequests.length) {
            const reqRow = document.createElement('div');
            reqRow.className = 'outline-item requests-row';
            reqRow.innerHTML = `<span class="outline-label">Requests</span><span class="requests-count">${incomingRequests.length}</span>`;
            reqRow.onclick = (e) => { e.stopPropagation(); appState.msgView = 'requests'; renderMsgRequests(); };
            msgList.appendChild(reqRow);
        }

        const matchedFriends = friends.filter(f => f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q));
        if (matchedFriends.length) {
            const label = document.createElement('div');
            label.className = 'msg-section-label';
            label.textContent = 'Chats';
            msgList.appendChild(label);
            matchedFriends.forEach(f => {
                const row = document.createElement('div');
                row.className = 'msg-chat-row';
                row.innerHTML = `<div class="msg-avatar"></div>
                    <div class="msg-chat-meta"><div class="msg-chat-name">${escapeHtml(f.displayName)}</div><div class="msg-chat-preview">${escapeHtml(lastPreview(f))}</div></div>`;
                renderAvatarInto(row.querySelector('.msg-avatar'), { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
                row.onclick = () => openConvo(f.id);
                msgList.appendChild(row);
            });
        }

        let searchResults = [];
        if (q) {
            searchResults = await searchDiscoverableUsers(q);
            if (searchResults.length) {
                const label = document.createElement('div');
                label.className = 'msg-section-label';
                label.textContent = 'Add a friend';
                msgList.appendChild(label);
                searchResults.forEach(u => {
                    const row = document.createElement('div');
                    row.className = 'msg-add-row';
                    const pending = outgoingPendingIds.has(u.id);
                    row.innerHTML = `<div class="msg-chat-meta"><div class="msg-chat-name">@${escapeHtml(u.username)}</div></div>
                        <button class="msg-add-btn" ${pending ? 'disabled' : ''}>${pending ? 'Requested' : 'Add'}</button>`;
                    row.querySelector('.msg-add-btn').onclick = async (e) => {
                        e.stopPropagation();
                        if (outgoingPendingIds.has(u.id)) return;
                        await sendFriendRequest(u.id);
                        renderMsgList(query);
                    };
                    msgList.appendChild(row);
                });
            }
        }

        if (!matchedFriends.length && !searchResults.length) {
            const empty = document.createElement('div');
            empty.className = 'msg-empty';
            empty.textContent = q ? 'No chats or usernames found.' : 'No conversations yet.';
            msgList.appendChild(empty);
        }
    }
    function renderMsgRequests() {
        msgList.innerHTML = '';
        const backRow = document.createElement('div');
        backRow.className = 'requests-back-row';
        backRow.innerHTML = `<span>&larr;</span><span>Requests</span>`;
        backRow.onclick = (e) => { e.stopPropagation(); appState.msgView = 'main'; renderMsgList(msgSearchInput.value); };
        msgList.appendChild(backRow);

        if (!incomingRequests.length) {
            const empty = document.createElement('div');
            empty.className = 'msg-empty';
            empty.textContent = 'No pending requests.';
            msgList.appendChild(empty);
            return;
        }
        incomingRequests.forEach(req => {
            const row = document.createElement('div');
            row.className = 'msg-add-row';
            row.innerHTML = `<div class="msg-chat-meta"><div class="msg-chat-name">@${escapeHtml(req.requester.username)}</div></div>
                <div style="display:flex;gap:6px;">
                    <button class="msg-add-btn msg-req-accept">Accept</button>
                    <button class="msg-add-btn msg-req-decline">Decline</button>
                </div>`;
            row.querySelector('.msg-req-accept').onclick = async (e) => {
                e.stopPropagation();
                await respondToFriendRequest(req.id, true);
                await refreshFriendsData();
                renderMsgRequests();
            };
            row.querySelector('.msg-req-decline').onclick = async (e) => {
                e.stopPropagation();
                await respondToFriendRequest(req.id, false);
                await refreshFriendsData();
                renderMsgRequests();
            };
            msgList.appendChild(row);
        });
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
    const AFK_THRESHOLD_MS = 5 * 60 * 1000;
    let localPresenceStatus = 'online';
    let afkTimer = null;
    function setLocalPresenceStatus(status) {
        if (localPresenceStatus === status) return;
        localPresenceStatus = status;
        friendMessageChannels.forEach(channel => channel.track({ status: localPresenceStatus }));
    }
    function resetAfkTimer() {
        setLocalPresenceStatus('online');
        clearTimeout(afkTimer);
        afkTimer = setTimeout(() => setLocalPresenceStatus('afk'), AFK_THRESHOLD_MS);
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
    let friendPresenceLastStatus = new Map();
    function handleFriendPresenceSync(friendshipId, channel) {
        const live = friends.find(x => x.friendshipId === friendshipId);
        if (!live) return;
        const metas = channel.presenceState()[live.id] || []; // presence key = the friend's own user id
        const nowStatus = metas.length ? (metas[0].status || 'online') : null;
        const prev = friendPresenceLastStatus.get(friendshipId);
        if (nowStatus === prev) return;
        friendPresenceLastStatus.set(friendshipId, nowStatus);
        if (prev === undefined) return; // first sync since subscribing — baseline only, not a real transition
        if (nowStatus === 'online') {
            pushNotification({
                type: 'friend_online',
                message: `${live.displayName} is online`,
                actionLabel: 'Chat',
                onAction: () => { openMessagesPanel(true); openConvo(live.id); },
            }); // one button, auto-dismisses — no dismiss function
        } else if (nowStatus === null) {
            pushNotification({ type: 'friend_offline', message: `${live.displayName} logged off` }); // no buttons, auto-dismisses — no dismiss function
        } else if (nowStatus === 'afk') {
            pushNotification({ type: 'friend_afk', message: `${live.displayName} is away` }); // no buttons, auto-dismisses — no dismiss function
        }
    }

    let friendMessageChannels = new Map(); // friendshipId -> realtime channel
    function subscribeToAllFriendMessages() {
        if (!supabase) return;
        const liveFriendshipIds = new Set(friends.map(f => f.friendshipId));

        for (const [friendshipId, channel] of friendMessageChannels) {
            if (!liveFriendshipIds.has(friendshipId)) {
                supabase.removeChannel(channel);
                friendMessageChannels.delete(friendshipId);
                friendPresenceLastStatus.delete(friendshipId);
            }
        }

        friends.forEach(f => {
            if (friendMessageChannels.has(f.friendshipId)) return; // already subscribed
            const friendshipId = f.friendshipId;
            const channel = supabase
                .channel(`messages:${friendshipId}`, { config: { presence: { key: appState.currentUser.id } } })
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `friendship_id=eq.${friendshipId}` }, (payload) => {
                    const m = payload.new;
                    if (m.sender_id === appState.currentUser.id) return; // our own message — already added optimistically by sendMsg
                    const live = friends.find(x => x.friendshipId === friendshipId);
                    if (!live) return; // unfriended (or a stale refresh) since this fired
                    if (live.messages.some(existing => existing.id === m.id)) return; // already have it somehow
                    live.messages.push({ id: m.id, senderId: m.sender_id, text: m.body, canvasSnapshot: m.canvas_snapshot, createdAt: m.created_at });
                    const isActivelyViewing = appState.activeConvoId === live.id && messagesPanel.classList.contains('open');
                    if (isActivelyViewing) {
                        renderConvoBody(live);
                    } else {
                        pushNotification({
                            type: 'chat',
                            message: `${live.displayName}: ${(m.body || '').trim().slice(0, 80) || 'New message'}`,
                            actionLabel: 'Reply',
                            onAction: () => { openMessagesPanel(true); openConvo(live.id); },
                        }); // one button, auto-dismisses — no dismiss function
                    }
                })
                .on('presence', { event: 'sync' }, () => handleFriendPresenceSync(friendshipId, channel))
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') channel.track({ status: localPresenceStatus });
                });
            friendMessageChannels.set(friendshipId, channel);
        });
    }

export { closeCollabPanel, collabPanel, friends, handleCollabSearch, handleMsgSearch, initials, openCollabPanel, refreshCanvasCollabForCurrentFolder, refreshFriendsData, renderCollabPill, renderMsgList, syncCanvasCollabTitle };
