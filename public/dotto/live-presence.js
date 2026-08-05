import { searchKindLabel } from './add-menu.js';
import { countSourceEntries, escapeHtml, stripHtml } from './ai-assistant-suggestions.js';
import { renderChecklistHTML, renderStatcardHTML, shortUrl } from './cards-misc.js';
import { appState, canvas, cursorOverlay, supabase } from './core-state.js';
import { ensureConnections } from './drawing-connections.js';
import { closeCollabPanel, friends, initials } from './friends-presence.js';
import { defaultFlashcardDeck, renderFlashcardHTML, renderTypeRightHTML } from './games-flashcard-typeright.js';
import { saveSnapshot, smoothPanTo } from './history-autosave.js';
import { renderMediaHTML } from './media-pdf-epub.js';
import { closeMessagesPanel, messagesPanel, msgConvo, msgList, msgSearchInput } from './messages-schedule.js';
import { awardUserPoints, renderAvatarInto } from './profile-achievements-pricing.js';
import { kindIconHTML, namespaceSharedFolderIds, parseSharedFolderKey, stripSharedFolderIds } from './shared-canvases-outline.js';
import { renderTableHTML } from './source-table.js';
import { CardStreamIO } from './srs-connections-core.js';
import { renderShelfHTML, renderStopwatchHTML } from './stopwatch-search-notifications.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Live canvas presence (Figma-style cursors) + real-time content sync ----------
    // Distinct from #collab-bubble/#collab-panel (inviting a collaborator to a canvas) and
    // #hub-collab-panel (the hamburger Collaborations list) — this is live presence for whoever is
    // CURRENTLY looking at a canvas, not the invite/access-management UI (same kind of naming
    // collision the codebase already disambiguates between hub-collab-panel and collab-panel).
    //
    // One realtime channel per (owner id, real folder id) pair — both the owner's own view and
    // every collaborator's shared:owner:folderId view resolve to the identical channel name
    // independently (see resolvePresenceFolderKey), so everyone currently on that exact canvas ends
    // up on the same channel regardless of whose canvas it actually is. Reuses the exact same
    // combined presence+broadcast-on-one-channel shape as subscribeToAllFriendMessages above.
    //
    // No per-user color exists anywhere else in the app — same "small fixed indexed palette" shape
    // as the word-alignment highlight colors (.align-hl-0..5 in globals.css), just keyed by user id
    // instead of alignment-pair index, so the same person always gets the same color across
    // reloads/sessions with no server-side storage needed.
    const CURSOR_COLORS = ['#F87171', '#FB923C', '#FBBF24', '#4ADE80', '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6'];
    function assignCursorColor(userId) {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
        return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
    }
    // How long the floating-cursor <-> typing-indicator "travel" animation runs for (see
    // showRemoteTypingIndicator/travelCursorBackToPointer's .remote-presence-travel handling) —
    // must match the transition duration set on that class in globals.css, since the JS uses this
    // same value to know when it's safe to remove the class again.
    const REMOTE_CURSOR_TRAVEL_MS = 220;
    // {ownerId, folderId} for whatever folder is currently open, whether it's this user's own or a
    // shared:owner:folderId view — mirrors parseSharedFolderKey's own logic so every viewer of the
    // exact same real canvas computes the identical channel name independently.
    function resolvePresenceFolderKey() {
        if (appState.currentFolderId.startsWith('shared:')) {
            const { ownerId, remoteFolderId } = parseSharedFolderKey(appState.currentFolderId);
            return { ownerId, folderId: remoteFolderId };
        }
        return { ownerId: appState.currentUser.id, folderId: appState.currentFolderId };
    }

    let canvasPresenceChannel = null;
    let canvasPresenceKey = null; // "ownerId:folderId" this channel is currently joined to, or null
    let remoteCursors = new Map(); // userId -> { el, x, y, caretX, caretY, ... }, x/y in canvas-space
    // Per-item JSON snapshot of whatever was last actually broadcast for the currently-joined
    // folder (plus its title) — the baseline the content-sync diff below compares against. Also
    // updated (not just read) when an incoming remote change is applied, which is what stops that
    // same change from being immediately re-diffed and echoed straight back out.
    let lastBroadcastSnapshot = null; // { title, items: Map<id, jsonString> }
    let pendingSyncDeltas = null; // { title?, upserts: Map<id,item>, deletes: Set<id> } since last flush
    let syncBroadcastTimer = null;
    // This client's own current editing state — kept locally (not read back from presence) so a
    // freshly-joined collaborator can be caught up via the presence 'join' handler below, and so
    // broadcastCaretPosition knows what selector to re-measure without needing it passed in on
    // every call. See broadcastEditingState for why this is BROADCAST, not tracked.
    let localEditingState = { editing: false, editingTarget: null, caret: null };

    function teardownCanvasPresenceChannel() {
        if (canvasPresenceChannel) supabase.removeChannel(canvasPresenceChannel);
        canvasPresenceChannel = null;
        canvasPresenceKey = null;
        lastBroadcastSnapshot = null;
        pendingSyncDeltas = null;
        localEditingState = { editing: false, editingTarget: null, caret: null };
        clearTimeout(syncBroadcastTimer);
        remoteCursors.forEach(entry => entry.el.remove());
        remoteCursors.clear();
    }
    // Diffing/broadcasting always works in CANONICAL (un-namespaced) item form — never the local
    // shared: wrapping a collaborator's own folders dict uses (see namespaceSharedFolderIds/
    // stripSharedFolderIds) — so a broadcast is meaningful to every viewer regardless of whether
    // they're the owner or a collaborator, and so the wrapping itself never gets diffed as if it
    // were a real content change.
    function canonicalItem(it) {
        return stripSharedFolderIds([it])[0];
    }
    function snapshotFolderForBroadcast(folderObj) {
        const items = new Map();
        (folderObj.items || []).forEach(it => items.set(it.id, JSON.stringify(canonicalItem(it))));
        return { title: folderObj.title, items };
    }
    // Called near the top of render() — already the one place every mutation across the entire
    // app funnels through (every card kind, every field edit), so this never needs threading
    // through the ~100+ individual mutation call sites elsewhere. No-ops unless the resolved
    // (owner,folder) pair actually changed since the last call.
    function ensureCanvasPresenceChannel() {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!supabase || !appState.currentUser.id || !folderObj) { teardownCanvasPresenceChannel(); return; }
        // Only a shared: view (someone else's canvas) or an owned folder that currently has
        // collaborators is ever worth a live channel — a private canvas nobody else can reach gets
        // no realtime overhead at all.
        const eligible = folderObj.isSharedView || (folderObj.collaborators && folderObj.collaborators.length > 0);
        if (!eligible) { teardownCanvasPresenceChannel(); return; }
        const { ownerId, folderId } = resolvePresenceFolderKey();
        const key = `${ownerId}:${folderId}`;
        if (key === canvasPresenceKey) return;
        teardownCanvasPresenceChannel();
        canvasPresenceKey = key;
        lastBroadcastSnapshot = snapshotFolderForBroadcast(folderObj);
        const channel = supabase.channel(`presence:${ownerId}:${folderId}`, { config: { presence: { key: appState.currentUser.id } } })
            .on('presence', { event: 'sync' }, () => handleCanvasPresenceSync(channel))
            .on('presence', { event: 'leave' }, ({ key: leftUserId }) => removeRemoteCursor(leftUserId))
            // A newly-joined collaborator has no way to know we're already mid-edit (the 'editing'
            // broadcast below only fires on a state CHANGE, not to catch up latecomers) — so if
            // we're actively editing when someone else joins, resend our current state just for
            // them. Cheap (only fires while genuinely editing) and self-contained.
            .on('presence', { event: 'join' }, ({ key: joinedUserId }) => {
                if (joinedUserId !== appState.currentUser.id && localEditingState.editing) {
                    channel.send({ type: 'broadcast', event: 'editing', payload: { userId: appState.currentUser.id, editing: true, editingTarget: localEditingState.editingTarget, caret: localEditingState.caret || computeLocalCaret() } });
                }
            })
            .on('broadcast', { event: 'cursor' }, ({ payload }) => handleRemoteCursorBroadcast(payload))
            .on('broadcast', { event: 'item-drag' }, ({ payload }) => handleRemoteItemDrag(payload))
            .on('broadcast', { event: 'item-resize' }, ({ payload }) => handleRemoteItemResize(payload))
            .on('broadcast', { event: 'editing' }, ({ payload }) => handleRemoteEditingBroadcast(payload))
            .on('broadcast', { event: 'caret' }, ({ payload }) => handleRemoteCaretBroadcast(payload))
            .on('broadcast', { event: 'selection' }, ({ payload }) => handleRemoteSelectionBroadcast(payload))
            .on('broadcast', { event: 'sync' }, ({ payload }) => applyRemoteSyncBroadcast(payload))
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Identity only — never re-tracked after this. Editing state deliberately lives
                    // entirely in broadcasts (see broadcastEditingState) instead, since presence.track()
                    // re-calls proved unreliable for fast-changing state: confirmed live (2-client
                    // Realtime test) that re-tracking the same key can leave stale older metas sitting
                    // alongside the fresh one in presenceState() indefinitely, with no reliable way to
                    // tell which is current. Identity fields never change after this single initial
                    // track(), so that ambiguity never matters here.
                    channel.track({
                        displayName: appState.currentUser.displayName, avatarId: appState.currentUser.avatarId ?? 0,
                        avatarUrl: appState.currentUser.avatarUrl || null, color: assignCursorColor(appState.currentUser.id),
                    });
                }
            });
        canvasPresenceChannel = channel;
    }

    // ---- Cursors: presence (identity/join/leave only — editing state is pure broadcast, see
    // broadcastEditingState) + broadcast (high-frequency position/caret/editing) ----
    function handleCanvasPresenceSync(channel) {
        const state = channel.presenceState();
        const seenIds = new Set();
        Object.keys(state).forEach(userId => {
            if (userId === appState.currentUser.id) return; // never render our own cursor
            seenIds.add(userId);
            const metas = state[userId];
            const meta = metas[metas.length - 1];
            if (!meta) return;
            let entry = remoteCursors.get(userId);
            if (!entry) {
                const el = document.createElement('div');
                el.className = 'remote-cursor';
                el.innerHTML = `<svg class="remote-cursor-pointer" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15 L12 22 L15 20.5 L12 13.5 L19 13.5 Z"/></svg>
                <div class="remote-cursor-label"><span class="remote-cursor-avatar"></span><span class="remote-cursor-name"></span></div>`;
                cursorOverlay.appendChild(el);
                entry = {
                    el, x: 0, y: 0, editingTarget: null, highlightedEl: null, typingCaretEl: null, typingLabelEl: null,
                    caretX: null, caretY: null, caretHeight: null, selectionRects: [], selectionEls: [],
                    isTyping: false, travelTimer: null,
                };
                remoteCursors.set(userId, entry);
            }
            entry.color = meta.color || '#999';
            entry.displayName = meta.displayName;
            entry.avatarId = meta.avatarId;
            entry.avatarUrl = meta.avatarUrl;
            entry.el.style.color = entry.color;
            entry.el.querySelector('.remote-cursor-name').textContent = entry.displayName || '';
            renderAvatarInto(entry.el.querySelector('.remote-cursor-avatar'), { id: entry.avatarId ?? 0, url: entry.avatarUrl || null }, initials(entry.displayName || '?'));
            applyRemoteCursorMode(entry);
        });
        remoteCursors.forEach((entry, userId) => { if (!seenIds.has(userId)) removeRemoteCursor(userId); });
    }
    // The single place that decides, fresh every time it runs, whether a remote collaborator shows
    // as a normal floating cursor or as an in-place "typing here" indicator — the two are mutually
    // exclusive, matching Figma-style presence (you see their cursor most of the time; the moment
    // they start typing anywhere, it's replaced by their name+avatar above a blinking colored
    // caret pinned to the exact field, then reverts the instant they stop). Always fully re-derived
    // (never incrementally patched) — called from presence sync, render() (edit targets get
    // rebuilt from scratch), and applyTransform() (everything here is screen-space positioned) —
    // so it can't get stuck showing a stale state if a step gets missed somewhere.
    function applyRemoteCursorMode(entry) {
        const target = entry.editingTarget ? document.querySelector(entry.editingTarget) : null;
        const isTyping = !!target;
        // Only a REAL mode flip (not just this same mode being repositioned again — e.g. every
        // frame while the LOCAL user pans/zooms, via repositionAllRemoteCursors) should trigger
        // the travel animation below; comparing against the last mode is what tells the two apart.
        const modeChanged = entry.isTyping !== isTyping;
        entry.isTyping = isTyping;
        if (isTyping) {
            showRemoteTypingIndicator(entry, target, modeChanged);
            if (modeChanged) entry.el.style.display = 'none';
        } else {
            if (modeChanged) travelCursorBackToPointer(entry);
            else { entry.el.style.display = ''; positionRemoteCursor(entry); }
            hideRemoteTypingIndicator(entry);
        }
        // Independent of the cursor-vs-typing-indicator mode above — a live text selection can
        // coexist with either (selecting text also focuses the field, so entry.editingTarget is
        // usually set too, but this doesn't rely on that either way).
        positionSelectionHighlight(entry);
    }
    // Renders/repositions the tinted highlight rect(s) for a remote collaborator's live text
    // selection — one <div> per entry.selectionRects entry (Range.getClientRects() can return
    // several, one per visual line a selection spans), reused across updates rather than
    // recreated every broadcast/reposition. Colored via entry.color (see assignCursorColor) —
    // same currentColor convention as .remote-cursor/.remote-typing-caret — through
    // background:currentColor + fixed opacity in CSS (see .remote-selection-highlight).
    function positionSelectionHighlight(entry) {
        const rects = entry.selectionRects || [];
        while (entry.selectionEls.length < rects.length) {
            const el = document.createElement('div');
            el.className = 'remote-selection-highlight';
            cursorOverlay.appendChild(el);
            entry.selectionEls.push(el);
        }
        while (entry.selectionEls.length > rects.length) {
            entry.selectionEls.pop().remove();
        }
        entry.selectionEls.forEach((el, i) => {
            const r = rects[i];
            el.style.color = entry.color;
            el.style.left = (appState.tx + r.x * appState.scale) + 'px';
            el.style.top = (appState.ty + r.y * appState.scale) + 'px';
            el.style.width = (r.w * appState.scale) + 'px';
            el.style.height = (r.h * appState.scale) + 'px';
        });
    }
    // travel (bool): true only on a genuine cursor->typing mode flip (see applyRemoteCursorMode),
    // never on a same-mode reposition — makes the indicator visibly glide in from wherever the
    // floating cursor last was, instead of popping straight to its destination.
    function showRemoteTypingIndicator(entry, target, travel) {
        const isNew = !entry.typingCaretEl;
        if (!entry.typingCaretEl) {
            entry.typingCaretEl = document.createElement('div');
            entry.typingCaretEl.className = 'remote-typing-caret';
            cursorOverlay.appendChild(entry.typingCaretEl);
        }
        if (!entry.typingLabelEl) {
            entry.typingLabelEl = document.createElement('div');
            entry.typingLabelEl.className = 'remote-editing-label';
            entry.typingLabelEl.innerHTML = `<span class="remote-cursor-avatar"></span><span class="remote-cursor-name"></span>`;
            cursorOverlay.appendChild(entry.typingLabelEl);
        }
        // Tracked by direct element reference (not just re-queried from the selector later) so
        // goToCollaboratorCursor can jump to it — no persistent outline/border is drawn on it
        // anymore (per explicit request: the block itself should stay plain; only the blinking
        // caret + name/avatar pill indicate typing, positioned at the real caret, not the block).
        entry.highlightedEl = target;
        entry.typingCaretEl.style.color = entry.color;
        entry.typingLabelEl.style.color = entry.color;
        entry.typingLabelEl.querySelector('.remote-cursor-name').textContent = entry.displayName || '';
        renderAvatarInto(entry.typingLabelEl.querySelector('.remote-cursor-avatar'), { id: entry.avatarId ?? 0, url: entry.avatarUrl || null }, initials(entry.displayName || '?'));
        if (travel && isNew) {
            // Snap both straight to wherever the floating cursor just was (no transition yet —
            // .remote-presence-travel isn't applied until after this instant jump is committed),
            // then let positionTypingIndicator below move them to their REAL target under that
            // class, which is what actually animates. Without this, a freshly-created element has
            // no "previous" position for the CSS transition to animate FROM, so it would just
            // appear at the destination immediately regardless of the transition being set.
            entry.typingCaretEl.style.display = '';
            entry.typingLabelEl.style.display = '';
            entry.typingCaretEl.style.left = entry.el.style.left;
            entry.typingCaretEl.style.top = entry.el.style.top;
            entry.typingLabelEl.style.left = entry.el.style.left;
            entry.typingLabelEl.style.top = entry.el.style.top;
            void entry.typingCaretEl.offsetWidth; // forces the snap above to paint before the class below re-enables a transition
            entry.typingCaretEl.classList.add('remote-presence-travel');
            entry.typingLabelEl.classList.add('remote-presence-travel');
            clearTimeout(entry.travelTimer);
            entry.travelTimer = setTimeout(() => {
                if (entry.typingCaretEl) entry.typingCaretEl.classList.remove('remote-presence-travel');
                if (entry.typingLabelEl) entry.typingLabelEl.classList.remove('remote-presence-travel');
            }, REMOTE_CURSOR_TRAVEL_MS);
        }
        positionTypingIndicator(entry, target);
    }
    // Split out from showRemoteTypingIndicator so an incoming 'caret' broadcast (see
    // handleRemoteCaretBroadcast) can reposition the existing indicator without recreating it or
    // re-touching the label's text/avatar — called on every caret move while still editing, not
    // just once on entering typing mode.
    function positionTypingIndicator(entry, target) {
        if (!entry.typingCaretEl || !entry.typingLabelEl) return;
        target = target || entry.highlightedEl;
        let left, top, height;
        if (entry.caretX != null && entry.caretY != null) {
            // The typist's actual measured caret position (see getCaretScreenRect/
            // broadcastCaretPosition), converted through OUR OWN live tx/ty/scale — same
            // projection positionRemoteCursor uses for the floating cursor.
            left = appState.tx + entry.caretX * appState.scale;
            top = appState.ty + entry.caretY * appState.scale;
            height = entry.caretHeight != null ? Math.max(12, entry.caretHeight * appState.scale) : 18;
        } else if (target) {
            // No caret broadcast has landed yet (right after entering typing mode) — approximate
            // with the target's own top-left corner for one frame until the real position arrives.
            const canvasRect = canvas.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            left = targetRect.left - canvasRect.left + 2;
            top = targetRect.top - canvasRect.top + 2;
            height = Math.max(12, Math.min(20, targetRect.height - 4));
        } else {
            return;
        }
        entry.typingCaretEl.style.display = '';
        entry.typingCaretEl.style.left = left + 'px';
        entry.typingCaretEl.style.top = top + 'px';
        entry.typingCaretEl.style.height = height + 'px';
        // display must be set before reading offsetWidth/offsetHeight below — both are 0 while
        // display:none, which would center on 0 (i.e. not center at all) on the very first paint.
        entry.typingLabelEl.style.display = '';
        entry.typingLabelEl.style.left = (left - entry.typingLabelEl.offsetWidth / 2) + 'px';
        entry.typingLabelEl.style.top = (top - entry.typingLabelEl.offsetHeight - 4) + 'px';
    }
    function hideRemoteTypingIndicator(entry) {
        entry.highlightedEl = null;
        entry.caretX = null; entry.caretY = null; entry.caretHeight = null;
        if (entry.typingCaretEl) { entry.typingCaretEl.remove(); entry.typingCaretEl = null; }
        if (entry.typingLabelEl) { entry.typingLabelEl.remove(); entry.typingLabelEl = null; }
    }
    function removeRemoteCursor(userId) {
        const entry = remoteCursors.get(userId);
        if (!entry) return;
        clearTimeout(entry.travelTimer);
        clearTimeout(entry.editingBlurTimer);
        hideRemoteTypingIndicator(entry);
        entry.selectionEls.forEach(el => el.remove());
        entry.el.remove();
        remoteCursors.delete(userId);
    }
    function positionRemoteCursor(entry) {
        entry.el.style.left = (appState.tx + entry.x * appState.scale) + 'px';
        entry.el.style.top = (appState.ty + entry.y * appState.scale) + 'px';
    }
    // Mirror of showRemoteTypingIndicator's travel case, for the reverse (typing -> cursor) mode
    // flip: snap the floating cursor to wherever the typing indicator currently sits (no
    // transition), make it visible, then let positionRemoteCursor below move it to its REAL
    // (live mouse) target under .remote-presence-travel — same "instant jump into place, THEN
    // animate away" trick, so it reads as one continuous glide-and-morph rather than the caret
    // vanishing and the cursor popping up already at the far side of the canvas.
    function travelCursorBackToPointer(entry) {
        entry.el.style.display = '';
        if (entry.typingCaretEl) {
            entry.el.classList.remove('remote-presence-travel');
            entry.el.style.left = entry.typingCaretEl.style.left;
            entry.el.style.top = entry.typingCaretEl.style.top;
            void entry.el.offsetWidth; // forces the snap above to paint before the class below re-enables a transition
            entry.el.classList.add('remote-presence-travel');
            clearTimeout(entry.travelTimer);
            entry.travelTimer = setTimeout(() => entry.el.classList.remove('remote-presence-travel'), REMOTE_CURSOR_TRAVEL_MS);
        }
        positionRemoteCursor(entry);
    }
    // Called from applyTransform() too (see below) so every remote cursor/typing-indicator stays
    // visually anchored to the right spot while YOU pan/zoom, not just when a new broadcast/sync
    // arrives.
    function repositionAllRemoteCursors() {
        remoteCursors.forEach(applyRemoteCursorMode);
    }
    // Pans to wherever a collaborator's cursor currently is — clicking their name in the
    // collaborator panel (#collab-panel, see renderCollabList) does this so you can see what
    // they're doing. remoteCursors only has an entry for someone currently present on THIS exact
    // canvas (see handleCanvasPresenceSync) — a no-op if they're not, since there's nowhere real
    // to jump to.
    function goToCollaboratorCursor(userId) {
        const entry = remoteCursors.get(userId);
        if (!entry) return;
        closeCollabPanel();
        const targetScale = Math.max(appState.scale, 1);
        if (entry.highlightedEl) {
            // Currently typing somewhere — jump to what they're actually editing, not their last
            // known mouse position (irrelevant right now, since the cursor itself is hidden while
            // they're typing — see applyRemoteCursorMode).
            const rect = entry.highlightedEl.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            const cx = (rect.left + rect.width / 2 - canvasRect.left - appState.tx) / appState.scale;
            const cy = (rect.top + rect.height / 2 - canvasRect.top - appState.ty) / appState.scale;
            smoothPanTo(window.innerWidth / 2 - cx * targetScale, window.innerHeight / 2 - cy * targetScale, targetScale);
            // A one-off navigation flash, distinct from (and not drawn during) normal typing — the
            // block itself otherwise stays plain per the current design, so the color is set just
            // for this brief animation rather than left on the element.
            const flashEl = entry.highlightedEl;
            flashEl.style.setProperty('--remote-edit-color', entry.color);
            flashEl.classList.add('remote-editing-highlight--flash');
            setTimeout(() => { flashEl.classList.remove('remote-editing-highlight--flash'); flashEl.style.removeProperty('--remote-edit-color'); }, 1200);
        } else {
            smoothPanTo(window.innerWidth / 2 - entry.x * targetScale, window.innerHeight / 2 - entry.y * targetScale, targetScale);
        }
    }
    function handleRemoteCursorBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry) return; // presence sync hasn't created their node yet — the next broadcast will land once it has
        entry.x = payload.x; entry.y = payload.y;
        positionRemoteCursor(entry);
    }
    // Live, purely-visual position streaming while someone else is actively dragging a card — see
    // the throttled send in setupDraggingAndClicking's own `move` handler below. Deliberately
    // DOM-only: this never touches folders[currentFolderId].items itself, so it can't race with
    // (or get overwritten by) anything else touching the real data model. The item's actual
    // position only gets durably committed once the dragger releases and their own render() call
    // picks it up as a normal item-upsert through the existing content-sync diff (see
    // queueSyncDiff/applyRemoteSyncBroadcast) — this is just what makes the drag itself visible
    // in between, instead of the card only jumping to its new spot once dropped.
    function handleRemoteItemDrag(payload) {
        if (!payload || payload.userId === appState.currentUser.id || !Array.isArray(payload.items)) return;
        payload.items.forEach(({ id, x, y }) => {
            const el = document.getElementById('item-' + id);
            if (!el) return;
            el.style.left = x + 'px';
            el.style.top = y + 'px';
        });
    }
    // lastPointerClientX/Y track raw SCREEN position, updated on every real pointermove
    // regardless of the broadcast throttle below — needed because panning without moving the
    // mouse (trackpad two-finger scroll, ctrl+scroll zoom, the zoom slider, any animated
    // smoothPanTo jump) changes which canvas-space point sits under a perfectly stationary
    // on-screen cursor. Re-broadcasting from applyTransform() (see below) using these, rather
    // than only on 'pointermove', is what keeps a collaborator's cursor tracking live WHILE
    // someone pans instead of appearing frozen until they next actually move the mouse.
    let lastPointerClientX = null, lastPointerClientY = null;
    let cursorBroadcastThrottleId = null;
    function broadcastCursorPositionThrottled() {
        if (!canvasPresenceChannel || lastPointerClientX == null || cursorBroadcastThrottleId) return;
        cursorBroadcastThrottleId = setTimeout(() => { cursorBroadcastThrottleId = null; }, 50);
        const rect = canvas.getBoundingClientRect();
        canvasPresenceChannel.send({
            type: 'broadcast', event: 'cursor',
            payload: { userId: appState.currentUser.id, x: (lastPointerClientX - rect.left - appState.tx) / appState.scale, y: (lastPointerClientY - rect.top - appState.ty) / appState.scale },
        });
    }
    canvas.addEventListener('pointermove', (e) => {
        lastPointerClientX = e.clientX; lastPointerClientY = e.clientY;
        broadcastCursorPositionThrottled();
    });
    // Streams a dragged card's LIVE position to everyone else on this canvas (see the `move`
    // handler in setupDraggingAndClicking) — same throttle shape as the cursor broadcast above, so
    // a drag reads as smooth, continuous movement on other screens rather than a jump-to-final-
    // position once dropped. Purely visual on the receiving end (see handleRemoteItemDrag) — the
    // position only becomes durable once the drop itself triggers a normal render()/content-sync.
    let itemDragBroadcastThrottleId = null;
    function broadcastItemDragPositions(startPositions) {
        if (!canvasPresenceChannel || itemDragBroadcastThrottleId) return;
        itemDragBroadcastThrottleId = setTimeout(() => { itemDragBroadcastThrottleId = null; }, 50);
        const items = startPositions.map(pos => {
            const it = findItemById(pos.id);
            return it ? { id: it.id, x: it.x, y: it.y } : null;
        }).filter(Boolean);
        if (!items.length) return;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'item-drag', payload: { userId: appState.currentUser.id, items } });
    }
    // Live, purely-visual size streaming while someone else is actively dragging a card's resize
    // handle — see the throttled send in setupResizing's own `move` handler below. Same DOM-only
    // shape as handleRemoteItemDrag: the item's actual w/h only becomes durable once the drag ends
    // and scheduleWorkspaceSave's normal content-sync diff picks it up.
    function handleRemoteItemResize(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const el = document.getElementById('item-' + payload.id);
        if (!el) return;
        el.style.width = payload.w + 'px';
        el.style.height = payload.h + 'px';
    }
    let itemResizeBroadcastThrottleId = null;
    function broadcastItemResize(id, w, h) {
        if (!canvasPresenceChannel || itemResizeBroadcastThrottleId) return;
        itemResizeBroadcastThrottleId = setTimeout(() => { itemResizeBroadcastThrottleId = null; }, 50);
        canvasPresenceChannel.send({ type: 'broadcast', event: 'item-resize', payload: { userId: appState.currentUser.id, id, w, h } });
    }
    // Applies an incoming 'editing' broadcast — see broadcastEditingState for why this is a plain
    // broadcast rather than presence.track(). The broadcast itself now carries the caret position
    // measured at the exact moment editing started (see computeLocalCaret), not just the target
    // selector — previously the indicator had no caret position at all until the NEXT keystroke's
    // separate 'caret' broadcast landed, so it visibly appeared at the wrong (target top-left)
    // spot for a beat and then jumped once real typing began. Carrying it in the same message
    // means the very first paint is already in the right place.
    function handleRemoteEditingBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry) return; // presence sync hasn't created their node yet — the join-time catch-up resend covers this once it has
        clearTimeout(entry.editingBlurTimer);
        if (payload.editing) {
            entry.editingTarget = payload.editingTarget || null;
            if (payload.caret) {
                entry.caretX = payload.caret.x; entry.caretY = payload.caret.y; entry.caretHeight = payload.caret.height;
            } else {
                entry.caretX = null; entry.caretY = null; entry.caretHeight = null;
            }
            applyRemoteCursorMode(entry);
        } else {
            // Don't drop back to the floating cursor immediately — a blur is very often followed
            // almost right away by a focus on a DIFFERENT field (tabbing/clicking between table
            // cells), and applying this instantly would flash the floating cursor (with its own
            // travel animation, see applyRemoteCursorMode) in between the two, for a switch that
            // should just read as a direct jump from the old field to the new one. This short
            // grace period lets a fast-following 'editing:true' cancel it (via the clearTimeout
            // above) before it ever takes effect.
            entry.editingBlurTimer = setTimeout(() => {
                entry.editingTarget = null;
                entry.caretX = null; entry.caretY = null; entry.caretHeight = null;
                applyRemoteCursorMode(entry);
            }, 150);
        }
    }
    function handleRemoteCaretBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry || !entry.editingTarget) return;
        entry.caretX = payload.x; entry.caretY = payload.y; entry.caretHeight = payload.height;
        positionTypingIndicator(entry);
    }
    function handleRemoteSelectionBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry) return; // presence sync hasn't created their node yet — the next broadcast will land once it has
        entry.selectionRects = Array.isArray(payload.rects) ? payload.rects : [];
        positionSelectionHighlight(entry);
    }
    // Measures where the blinking caret should actually sit — the real caret position within a
    // contentEditable field via the Selection Range API (falling back to a temporary zero-width
    // marker node when the collapsed range yields no client rect, e.g. an empty line — a standard
    // workaround for that DOM quirk), or an approximate proportional position within a plain
    // <input> (Typeright's answer box), where Selection ranges don't apply the same way.
    function getCaretScreenRect(el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            const rect = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
            const val = el.value || '';
            const pos = el.selectionEnd != null ? el.selectionEnd : val.length;
            const ratio = val.length ? pos / val.length : 0;
            return { left: rect.left + padL + (rect.width - padL - padR) * ratio, top: rect.top, height: rect.height };
        }
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            if (el.contains(range.startContainer)) {
                const r = range.cloneRange();
                // Collapse to the END, not the start — for a real (non-collapsed) selection, the
                // typing indicator/caret should land at the end of the highlighted segment, same
                // place a native caret would sit after you finish dragging a selection. A no-op for
                // an already-collapsed range (start === end), so this doesn't affect plain typing.
                r.collapse(false);
                const rects = r.getClientRects();
                if (rects.length) return rects[0];
                const marker = document.createElement('span');
                marker.textContent = '​';
                r.insertNode(marker);
                const rect = marker.getBoundingClientRect();
                const parent = marker.parentNode;
                parent.removeChild(marker);
                parent.normalize();
                return rect;
            }
        }
        return el.getBoundingClientRect();
    }
    // Measures the caret position for whatever's currently being edited (see localEditingState),
    // in the same canvas-space coordinates handleRemoteCursorBroadcast/positionRemoteCursor use.
    // Returns null if there's nothing to measure (not editing, or the target's gone from the DOM).
    function computeLocalCaret() {
        if (!localEditingState.editingTarget) return null;
        const el = document.querySelector(localEditingState.editingTarget);
        if (!el) return null;
        const rect = getCaretScreenRect(el);
        const canvasRect = canvas.getBoundingClientRect();
        return {
            x: (rect.left - canvasRect.left - appState.tx) / appState.scale,
            y: (rect.top - canvasRect.top - appState.ty) / appState.scale,
            height: rect.height / appState.scale,
        };
    }
    // Re-measures and broadcasts the caret position on every subsequent selectionchange (typing,
    // arrow keys, clicking elsewhere within the same field all move the caret and fire it) via the
    // throttled listener below — the INITIAL position at edit-start is instead carried directly in
    // the 'editing' broadcast itself (see broadcastEditingState), so this only ever needs to cover
    // movement AFTER that first paint.
    function broadcastCaretPosition() {
        if (!canvasPresenceChannel) return;
        const caret = computeLocalCaret();
        if (!caret) return;
        localEditingState.caret = caret;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'caret', payload: { userId: appState.currentUser.id, ...caret } });
    }
    // Measures the current live text SELECTION (not just the caret) within whatever's being
    // edited — same canvas-space coordinates/projection as computeLocalCaret, but one rect per
    // visual line the selection spans (Range.getClientRects(), plural — a real selection can wrap
    // across multiple lines) rather than a single collapsed point. Returns an empty array when
    // there's nothing to highlight (no selection, collapsed to a caret, or somehow outside the
    // current editing target) — broadcastLocalSelection still sends that empty array rather than
    // skipping the send, so a collaborator's screen reliably clears a previously-shown highlight
    // the instant the selection collapses, not just when a new one appears.
    function computeLocalSelectionRects() {
        if (!localEditingState.editingTarget) return [];
        const el = document.querySelector(localEditingState.editingTarget);
        if (!el) return [];
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return [];
        const canvasRect = canvas.getBoundingClientRect();
        return Array.from(range.getClientRects()).map(r => ({
            x: (r.left - canvasRect.left - appState.tx) / appState.scale,
            y: (r.top - canvasRect.top - appState.ty) / appState.scale,
            w: r.width / appState.scale,
            h: r.height / appState.scale,
        }));
    }
    // Broadcasts the current user's own live text selection so every collaborator sees the exact
    // range highlighted, tinted in this user's assigned color (see assignCursorColor) — the
    // selection equivalent of the caret/typing indicator above, rendered on the receiving end by
    // handleRemoteSelectionBroadcast/positionSelectionHighlight.
    function broadcastLocalSelection() {
        if (!canvasPresenceChannel) return;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'selection', payload: { userId: appState.currentUser.id, rects: computeLocalSelectionRects() } });
    }
    let caretBroadcastThrottleId = null;
    document.addEventListener('selectionchange', () => {
        if (!canvasPresenceChannel || !localEditingState.editing || caretBroadcastThrottleId) return;
        caretBroadcastThrottleId = setTimeout(() => { caretBroadcastThrottleId = null; }, 50);
        broadcastCaretPosition();
        broadcastLocalSelection();
    });
    // Broadcasts (not tracks — see the SUBSCRIBED callback above for why) an editing-state change —
    // called from every inline text-edit start/end pair (waypoint rename, breadcrumb title rename,
    // note/title/watermark body editing, table cells, game inputs) so a remote viewer sees this
    // replace their floating cursor with an in-place typing indicator while any of those are
    // focused, and revert back the instant it's blurred (see applyRemoteCursorMode). A no-op
    // wherever there's no active presence channel (a private, non-shared canvas), so nothing needs
    // to guard these calls itself.
    //
    // targetSelector (optional) is a CSS selector identifying the EXACT element being typed into —
    // e.g. "#item-123" for a whole card, or '#item-123 .cell-text[data-r="2"][data-c="1"]' for one
    // specific table cell — used to show a blinking caret + name/avatar label at that element's
    // actual caret position (see showRemoteTypingIndicator/getCaretScreenRect), instead of the
    // normal floating cursor. Omit it for edits that aren't a real canvas element worth pinning to
    // (e.g. the breadcrumb title, which lives in the top bar, not on the canvas) — that case just
    // keeps showing the plain floating cursor throughout.
    function broadcastEditingState(isEditing, targetSelector) {
        localEditingState = { editing: isEditing, editingTarget: isEditing ? (targetSelector || null) : null, caret: null };
        // Measured synchronously, in the SAME tick focus/placeCaretEnd already ran in at each call
        // site, and sent as part of this very message — see computeLocalCaret's caller comment for
        // why this (not a follow-up 'caret' broadcast) is what fixes the initial-position jump.
        if (isEditing && localEditingState.editingTarget) localEditingState.caret = computeLocalCaret();
        if (!canvasPresenceChannel) return;
        canvasPresenceChannel.send({
            type: 'broadcast', event: 'editing',
            payload: { userId: appState.currentUser.id, editing: isEditing, editingTarget: localEditingState.editingTarget, caret: localEditingState.caret },
        });
        // Blurring normally collapses/moves the selection too (which the selectionchange listener
        // above would already catch), but that's not guaranteed for every call site — explicit and
        // immediate here so a collaborator's screen never has to wait for a maybe-not-firing event
        // to clear a stale highlight.
        if (!isEditing) canvasPresenceChannel.send({ type: 'broadcast', event: 'selection', payload: { userId: appState.currentUser.id, rects: [] } });
    }

    // ---- Content sync: diff-and-broadcast on render(), not per-mutation-site instrumentation ----
    // Every mutation in the app already ends in a render() call — rather than threading a
    // broadcast through the ~100+ individual mutation sites across every card kind, this hooks
    // into that one existing universal signal instead. Deliberately whole-item, last-write-wins,
    // not a per-field merge/OT/CRDT — if two people edit the exact same item at the exact same
    // moment, whichever change lands last simply overwrites the other. A real conflict-free merge
    // would mean replacing the entire load/edit/save data model, a separate, much larger effort.
    //
    // NOTE (pre-existing, not introduced by this feature): new item ids come from this client's own
    // local `idCounter++`, seeded from each user's own workspace row independently — two different
    // people adding a new card to the same shared folder at nearly the same moment could in theory
    // generate the same numeric id and collide once merged. This risk already existed today via
    // the existing debounced update_shared_folder save; real-time sync just makes concurrent edits
    // (and so this pre-existing edge case) more likely to actually happen. Worth a proper fix
    // (namespaced/UUID ids) if it turns out to matter in practice — out of scope here.
    function queueSyncDiff(folderObj) {
        if (!canvasPresenceChannel || !lastBroadcastSnapshot) return;
        if (!pendingSyncDeltas) pendingSyncDeltas = { upserts: new Map(), deletes: new Set() };
        const seenIds = new Set();
        (folderObj.items || []).forEach(rawIt => {
            seenIds.add(rawIt.id);
            const it = canonicalItem(rawIt);
            const json = JSON.stringify(it);
            if (lastBroadcastSnapshot.items.get(it.id) !== json) {
                pendingSyncDeltas.upserts.set(it.id, it);
                pendingSyncDeltas.deletes.delete(it.id);
                lastBroadcastSnapshot.items.set(it.id, json);
            }
        });
        lastBroadcastSnapshot.items.forEach((json, id) => {
            if (!seenIds.has(id)) {
                pendingSyncDeltas.deletes.add(id);
                pendingSyncDeltas.upserts.delete(id);
                lastBroadcastSnapshot.items.delete(id);
            }
        });
        if (folderObj.title !== lastBroadcastSnapshot.title) {
            pendingSyncDeltas.title = folderObj.title;
            lastBroadcastSnapshot.title = folderObj.title;
        }
        // Short debounce so a burst of render() calls from one user action (e.g. typing, which
        // re-renders per keystroke in some card kinds) coalesces into one broadcast instead of one
        // per keystroke.
        clearTimeout(syncBroadcastTimer);
        syncBroadcastTimer = setTimeout(flushSyncDiff, 120);
    }
    function flushSyncDiff() {
        if (!canvasPresenceChannel || !pendingSyncDeltas) return;
        const payload = { upserts: Array.from(pendingSyncDeltas.upserts.values()), deletes: Array.from(pendingSyncDeltas.deletes) };
        if (pendingSyncDeltas.title !== undefined) payload.title = pendingSyncDeltas.title;
        pendingSyncDeltas = null;
        if (!payload.upserts.length && !payload.deletes.length && payload.title === undefined) return;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'sync', payload });
    }
    // Applies an incoming remote change directly into local state and re-renders — also updates
    // lastBroadcastSnapshot to match (critical: this is what stops the render() this triggers from
    // re-diffing this exact change as "new" and immediately echoing it straight back out).
    function applyRemoteSyncBroadcast(payload) {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !payload) return;
        let changed = false;
        if (payload.title !== undefined && payload.title !== folderObj.title) {
            folderObj.title = payload.title;
            if (lastBroadcastSnapshot) lastBroadcastSnapshot.title = payload.title;
            changed = true;
        }
        (payload.upserts || []).forEach(canonicalRemoteItem => {
            // Incoming items always arrive canonical (un-namespaced) — see queueSyncDiff. If THIS
            // client's own view of this folder is itself a shared: one, its local items need the
            // same local-only wrapping every other item here already has (see
            // namespaceSharedFolderIds) to stay internally consistent; the owner's own view uses
            // the canonical form directly.
            const remoteItem = folderObj.isSharedView ? namespaceSharedFolderIds(folderObj.sharedOwnerId, [canonicalRemoteItem])[0] : canonicalRemoteItem;
            const idx = folderObj.items.findIndex(it => it.id === remoteItem.id);
            if (idx === -1) folderObj.items.push(remoteItem);
            else folderObj.items[idx] = remoteItem;
            if (lastBroadcastSnapshot) lastBroadcastSnapshot.items.set(remoteItem.id, JSON.stringify(canonicalRemoteItem));
            changed = true;
        });
        (payload.deletes || []).forEach(id => {
            const idx = folderObj.items.findIndex(it => it.id === id);
            if (idx !== -1) folderObj.items.splice(idx, 1);
            if (lastBroadcastSnapshot) lastBroadcastSnapshot.items.delete(id);
            changed = true;
        });
        if (changed) render();
    }

    function openConvo(friendId) {
        appState.activeConvoId = friendId;
        const f = friends.find(x => x.id === friendId);
        if (!f) return;
        renderAvatarInto(document.getElementById('msg-convo-avatar'), { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
        document.getElementById('msg-convo-title').textContent = f.displayName;
        // #msg-convo (and #msg-convo-body inside it) is display:none until the 'open' class is
        // added — made visible BEFORE renderConvoBody runs, since setting scrollTop on a still-
        // hidden 0-height element is a no-op that doesn't stick once it becomes visible
        // afterward (this is what silently broke the always-start-at-the-bottom reset).
        document.getElementById('msg-search-wrap').style.display = 'none';
        msgList.style.display = 'none';
        msgConvo.classList.add('open');
        renderConvoBody(f);
    }
    
    function renderMsgSnapshotCard(item) {
        const card = document.createElement('div');
        card.className = 'msg-snapshot-card';
        
        const header = document.createElement('div');
        header.className = 'snap-header';
        header.textContent = searchKindLabel(item);
        card.appendChild(header);

        if (item.kind === 'title') {
            const titleEl = document.createElement('div');
            titleEl.className = 'snap-title';
            titleEl.innerHTML = item.html || 'Untitled Title';
            card.appendChild(titleEl);
        } else if (item.kind === 'table') {
            const tableWrap = document.createElement('div');
            tableWrap.className = 'overflow-x-auto';
            const table = document.createElement('table');
            table.className = 'snap-table';
            const tbody = document.createElement('tbody');
            item.tableData.forEach(row => {
                const tr = document.createElement('tr');
                row.forEach(cell => {
                    const td = document.createElement('td');
                    td.innerHTML = cell;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            card.appendChild(tableWrap);
        } else if (item.kind === 'checklist') {
            const rowsWrap = document.createElement('div');
            rowsWrap.className = 'flex flex-col gap-1';
            item.tasks.forEach(t => {
                const row = document.createElement('div');
                row.className = 'snap-checklist-row';
                row.innerHTML = `<input type="checkbox" ${t.done ? 'checked' : ''} disabled>
                    <span class="snap-checklist-text" style="${t.done ? 'text-decoration:line-through;opacity:.5;' : ''}">${escapeHtml(t.text || 'Task')}</span>`;
                rowsWrap.appendChild(row);
            });
            card.appendChild(rowsWrap);
        } else if (item.kind === 'bookmark') {
            card.innerHTML += `<div class="flex items-center gap-2"><span class="text-sm">🔖</span><span class="font-semibold truncate">${escapeHtml(item.html || shortUrl(item.bookmarkUrl) || 'Link')}</span></div>`;
        } else if (item.kind === 'embed') {
            card.innerHTML += `<div class="flex items-center gap-2"><span class="text-sm">🌐</span><span class="font-semibold truncate">${escapeHtml(item.embedUrl ? shortUrl(item.embedUrl) : 'Embed')}</span></div>`;
        } else if (item.kind === 'media') {
            if (item.mediaSrc) {
                const tag = item.mediaType === 'video' ? `<video src="${item.mediaSrc}" class="w-full h-24 object-cover rounded" muted controls></video>` : `<img src="${item.mediaSrc}" class="w-full h-24 object-cover rounded"/>`;
                card.innerHTML += tag;
            } else {
                card.innerHTML += `<div class="text-[11px] text-slate-500 italic">Empty media card</div>`;
            }
        } else if (item.kind === 'watermark') {
            card.innerHTML += `<div class="text-xs opacity-50 italic">${escapeHtml(item.html || 'Watermark text')}</div>`;
        } else {
            // Default note / text card
            const body = document.createElement('div');
            body.className = 'snap-body';
            body.innerHTML = item.html || '<span class="text-slate-500 italic">Empty note</span>';
            card.appendChild(body);
        }
        return card;
    }

    // Small icon per card kind, used inside the mini inline-canvas squares
    function miniIconForKind(kind) {
        const icons = { title: 'T', table: '⊞', checklist: '☑', bookmark: '🔖', embed: '🌐', media: '▣', watermark: '≈', flashcard: '⟲', folder: '↗', source: '▶', statcard: '📈', stopwatch: '⏱️', shelf: '🗄️' };
        return icons[kind] || '≡';
    }
    // Deep-clones an item for sharing (chat) or packaging (marketplace draft). Folder/source
    // items additionally embed a self-contained, recursive copy of their own nested contents
    // (snapshotChildren/snapshotTitle) — a plain clone only carries a dangling folderId, which
    // means nothing once the snapshot leaves the account that made it (a friend viewing a
    // shared card, or a marketplace listing viewed by its buyer, has no access to the sharer's
    // live `folders`). Embedding the contents directly is what lets renderInlineCanvas click
    // into a nested folder/source card and actually show something, for anyone who views it.
    function snapshotItem(it) {
        const clone = JSON.parse(JSON.stringify(it));
        if ((it.kind === 'folder' || it.kind === 'source') && appState.folders[it.folderId]) {
            clone.snapshotChildren = appState.folders[it.folderId].items.map(snapshotItem);
            clone.snapshotTitle = appState.folders[it.folderId].title;
        }
        return clone;
    }

    // Same source-of-truth rule as the live disconnect reset in propagateCanvasStreams, applied
    // at export time: a flashcard snapshot leaving the canvas (marketplace, chat, search card
    // context) only gets to keep real word data if the table/source/folder it's actually
    // connected to on the LIVE canvas is also part of this same export batch. Otherwise the
    // clone is neutered to the generic placeholder deck — the live canvas item is never touched,
    // only the copy. Call right after snapshotItem(it), passing every id in the same gesture.
    function sanitizeFlashcardSnapshot(snapshot, batchItemIds) {
        if (snapshot.kind !== 'flashcard' && snapshot.kind !== 'typeright') return snapshot;
        const folder = appState.folders[appState.currentFolderId];
        const conns = folder ? ensureConnections(folder) : [];
        const sourceComesToo = conns.some(c => {
            const otherId = c.fromId === snapshot.id ? c.toId : (c.toId === snapshot.id ? c.fromId : null);
            if (!otherId || !batchItemIds.includes(otherId)) return false;
            const other = folder.items.find(i => i.id === otherId);
            return other && CardStreamIO[other.kind] && (CardStreamIO[other.kind].outputs || []).includes('content');
        });
        if (!sourceComesToo) {
            if (snapshot.kind === 'flashcard') {
                snapshot.cards = defaultFlashcardDeck();
                snapshot.fcOrder = [];
                snapshot.fcIndex = 0;
                snapshot.fcFlipped = false;
                snapshot.fcStats = {};
                snapshot.fcSeenCount = 0;
            } else {
                snapshot.cards = [];
                snapshot.trOrder = [];
                snapshot.trIndex = 0;
                snapshot.trInput = '';
                snapshot.trChecked = false;
                snapshot.trStats = {};
                snapshot.trSeenCount = 0;
            }
        }
        return snapshot;
    }

    function miniLabelForItem(item) {
        if (item.kind === 'table') return 'Table';
        if (item.kind === 'checklist') return 'Checklist';
        if (item.kind === 'flashcard') return 'Flashcards';
        if (item.kind === 'typeright') return 'Typeright';
        if (item.kind === 'statcard') return item.statKind === 'accuracy' ? 'Accuracy' : 'Progress';
        if (item.kind === 'stopwatch') return 'Stopwatch';
        if (item.kind === 'shelf') return item.shelfName || 'Stack';
        if (item.kind === 'bookmark') return item.html || (item.bookmarkUrl ? shortUrl(item.bookmarkUrl) : 'Link');
        if (item.kind === 'folder' || item.kind === 'source') return (appState.folders[item.folderId] && appState.folders[item.folderId].title) || 'Folder';
        const text = stripHtml(item.html || '');
        return text ? text.slice(0, 24) : (item.kind ? item.kind[0].toUpperCase() + item.kind.slice(1) : 'Card');
    }

    // Builds a read-only replica of a card exactly as it appears on the real canvas
    // (same classes/markup/content as the main render() loop), for use inside the
    // inline chat canvas preview. No editing handlers are attached.
    function renderRealCardPreview(it) {
        const el = document.createElement('div');
        el.className = `item ${it.kind}`;

        if (it.kind === 'folder') {
            const f = appState.folders[it.folderId];
            el.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;"><span style="opacity:0.8;">↗</span>${f ? f.title : 'Folder'}</div>
                <div style="font-size:12px;opacity:0.6;">${f ? f.items.length : 0} items</div>
            </div>`;
        } else if (it.kind === 'source') {
            const f = appState.folders[it.folderId];
            const count = countSourceEntries(it.folderId);
            el.innerHTML = `${kindIconHTML('source', null, 'source-card-icon')}
            <div class="source-card-info">
                <span class="source-card-title">${f ? f.title : ''}</span>
                <span class="source-card-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
            </div>`;
        } else if (it.kind === 'title') {
            el.style.fontSize = titleFontSize(it.level || 1) + 'px';
            el.innerHTML = `<div class="body">${it.html || ''}</div>`;
        } else if (it.kind === 'table') {
            el.innerHTML = renderTableHTML(it);
            if (it.userSized) el.classList.add('sized');
        } else if (it.kind === 'media') {
            el.innerHTML = renderMediaHTML(it);
        } else if (it.kind === 'bookmark') {
            el.innerHTML = `<div class="bookmark-icon">🔖</div>
                <div class="bookmark-title">${it.html || (it.bookmarkUrl ? shortUrl(it.bookmarkUrl) : 'New Bookmark')}</div>`;
        } else if (it.kind === 'embed') {
            // Static placeholder, not a live iframe — this renders into mini inline-canvas
            // previews (folder cards, chat/marketplace snapshots) where several might be on
            // screen at once, unlike the single live card in render() (see renderEmbedHTML).
            el.innerHTML = `<div class="embed-icon">🌐</div>
                <div class="embed-title">${it.embedUrl ? shortUrl(it.embedUrl) : 'New Embed'}</div>`;
        } else if (it.kind === 'checklist') {
            el.innerHTML = renderChecklistHTML(it);
        } else if (it.kind === 'watermark') {
            el.innerHTML = `<div class="body watermark-text">${it.html || ''}</div>`;
        } else if (it.kind === 'flashcard') {
            el.innerHTML = renderFlashcardHTML(it);
        } else if (it.kind === 'typeright') {
            el.innerHTML = renderTypeRightHTML(it);
        } else if (it.kind === 'statcard') {
            el.innerHTML = renderStatcardHTML(it);
        } else if (it.kind === 'stopwatch') {
            el.innerHTML = renderStopwatchHTML(it);
        } else if (it.kind === 'shelf') {
            el.innerHTML = renderShelfHTML(it);
        } else {
            el.innerHTML = `<div class="body">${it.html || ''}</div>`;
        }
        return el;
    }

    // Renders a set of shared cards as a real pannable/zoomable mini canvas, preserving
    // their relative x/y layout.
    // The viewer is read-only (pan + zoom only, no editing or moving cards). Dragging the
    // handle above it out onto the main app canvas imports the cards there.
    // Renders a set of packaged/shared cards as a small read-only canvas preview. Visually
    // identical everywhere it's used (chat, marketplace, drafts, publish flow) — the only
    // functional difference draggableOut controls is whether the top-left tab lets you drag the
    // currently-shown cards out onto your real canvas (chat only; marketplace/draft previews are
    // look-only). Clicking a folder/source card drills into its own packaged contents (see
    // snapshotChildren on snapshotItem) using a navigation stack local to this one widget, with
    // its own back/forward arrows — independent of, and without touching, the real app's canvas
    // navigation. No other card kind is clickable.
    // A single shared floating "Delete" row, reused by every renderInlineCanvas instance that
    // passes onDelete (currently only the search card-context popup) — deliberately separate
    // from the real per-card #context-menu / contextMenuItemId, since these mini previews aren't
    // real canvas items.
    let inlineCanvasDeleteMenuEl = null;
    function showInlineCanvasDeleteMenu(x, y, onConfirm) {
        if (!inlineCanvasDeleteMenuEl) {
            inlineCanvasDeleteMenuEl = document.createElement('div');
            inlineCanvasDeleteMenuEl.id = 'inline-canvas-delete-menu';
            inlineCanvasDeleteMenuEl.className = 'inline-canvas-delete-menu';
            inlineCanvasDeleteMenuEl.innerHTML = `<div class="menu-item">Delete</div>`;
            document.body.appendChild(inlineCanvasDeleteMenuEl);
            document.addEventListener('pointerdown', (e) => {
                if (!inlineCanvasDeleteMenuEl.contains(e.target)) inlineCanvasDeleteMenuEl.style.display = 'none';
            });
        }
        inlineCanvasDeleteMenuEl.style.left = x + 'px';
        inlineCanvasDeleteMenuEl.style.top = y + 'px';
        inlineCanvasDeleteMenuEl.style.display = 'flex';
        inlineCanvasDeleteMenuEl.querySelector('.menu-item').onclick = (e) => {
            e.stopPropagation();
            inlineCanvasDeleteMenuEl.style.display = 'none';
            onConfirm();
        };
    }

    // `connections` ({fromId,toId}[]) and `onDelete` (itemId => void) are optional, used only by
    // the search card-context popup (see openSearchCardsModal): connections draw simple
    // non-interactive lines between the top-level items they reference (never inside a drilled-
    // into folder/source level, which is a different, unrelated item set), and onDelete — when
    // provided — wires a right-click "Delete" row onto each top-level mini card.
    function renderInlineCanvas(items, draggableOut, connections, onDelete) {
        if (draggableOut === undefined) draggableOut = true;
        const wrap = document.createElement('div');
        wrap.className = 'msg-inline-canvas-wrap';

        const viewport = document.createElement('div');
        viewport.className = 'msg-inline-canvas';
        const world = document.createElement('div');
        world.className = 'msg-inline-canvas-world';
        viewport.appendChild(world);
        wrap.appendChild(viewport);

        let navStack = [{ items, isSource: false, title: null }];
        let navIndex = 0;

        let dragTab = null;
        if (draggableOut) {
            dragTab = document.createElement('div');
            dragTab.className = 'msg-inline-canvas-drag-tab';
            dragTab.innerHTML = `<span>⠿</span>`;
            dragTab.title = 'Drag onto your canvas';
            viewport.appendChild(dragTab);
        }

        const navBar = document.createElement('div');
        navBar.className = 'msg-inline-canvas-nav';
        navBar.innerHTML = `<button class="msg-inline-canvas-nav-btn" data-dir="back" title="Back">‹</button><button class="msg-inline-canvas-nav-btn" data-dir="fwd" title="Forward">›</button>`;
        viewport.appendChild(navBar);
        const navBackBtn = navBar.querySelector('[data-dir="back"]');
        const navFwdBtn = navBar.querySelector('[data-dir="fwd"]');

        const zoomBar = document.createElement('div');
        zoomBar.className = 'msg-inline-canvas-zoom';
        zoomBar.innerHTML = `<div class="msg-inline-canvas-zoom-track">
            <div class="msg-inline-canvas-zoom-fill"></div>
            <div class="msg-inline-canvas-zoom-thumb"></div>
        </div>`;
        viewport.appendChild(zoomBar);
        const zoomTrackMini = zoomBar.querySelector('.msg-inline-canvas-zoom-track');
        const zoomFillMini = zoomBar.querySelector('.msg-inline-canvas-zoom-fill');
        const zoomThumbMini = zoomBar.querySelector('.msg-inline-canvas-zoom-thumb');

        // ---- Pan (drag) & zoom (slider only; no wheel/pinch response) — normal levels only ----
        const MINI_ZOOM_MIN = 0.2, MINI_ZOOM_MAX = 2, MINI_ZOOM_FIT_MIN = 0.4, MINI_ZOOM_FIT_PADDING = 24;
        let vZoom = 1, vPanX = 0, vPanY = 0, contentW = 1, contentH = 1;
        function applyView() {
            world.style.transform = `translate(${vPanX}px, ${vPanY}px) scale(${vZoom})`;
            viewport.style.backgroundPosition = `${vPanX}px ${vPanY}px`;
            viewport.style.backgroundSize = `${28 * vZoom}px ${28 * vZoom}px`;
        }
        function updateZoomBarUI() {
            const pct = Math.max(0, Math.min(1, (vZoom - MINI_ZOOM_MIN) / (MINI_ZOOM_MAX - MINI_ZOOM_MIN)));
            const trackW = zoomTrackMini.clientWidth;
            const x = pct * trackW;
            zoomFillMini.style.width = x + 'px';
            zoomThumbMini.style.left = x + 'px';
        }
        // Default zoom fits all of the level's content in the viewport with a little padding,
        // never going below MINI_ZOOM_FIT_MIN (40%) even if the content is too big to fully fit —
        // it'll just spill past the edges/need panning at that floor rather than shrink further.
        function centerView() {
            const rect = viewport.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const fitZoom = Math.min(
                (rect.width - MINI_ZOOM_FIT_PADDING * 2) / contentW,
                (rect.height - MINI_ZOOM_FIT_PADDING * 2) / contentH
            );
            vZoom = Math.max(MINI_ZOOM_FIT_MIN, Math.min(MINI_ZOOM_MAX, fitZoom));
            vPanX = (rect.width - contentW * vZoom) / 2;
            vPanY = (rect.height - contentH * vZoom) / 2;
            applyView();
            updateZoomBarUI();
        }

        function updateNavUI() {
            navBackBtn.disabled = navIndex === 0;
            navFwdBtn.disabled = navIndex === navStack.length - 1;
        }

        function renderCurrentLevel() {
            const level = navStack[navIndex];
            world.innerHTML = '';
            updateNavUI();

            if (level.isSource) {
                viewport.classList.add('is-source');
                zoomBar.style.display = 'none';
                world.style.width = '100%';
                world.style.height = '100%';
                world.style.transform = 'translate(0,0) scale(1)';
                renderSourcePreview(level);
                return;
            }
            viewport.classList.remove('is-source');
            zoomBar.style.display = '';
            world.style.width = '';
            world.style.height = '';

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            level.items.forEach(it => {
                const w = it.w || 100, h = it.h || 60;
                minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
                maxX = Math.max(maxX, it.x + w); maxY = Math.max(maxY, it.y + h);
            });
            contentW = Math.max(1, maxX - minX);
            contentH = Math.max(1, maxY - minY);

            const isTopLevel = navIndex === 0;
            const centers = {};
            level.items.forEach(it => {
                const w = it.w || 100, h = it.h || 60;
                // Render the actual card (same markup, text and sizing as the real canvas item)
                const mini = renderRealCardPreview(it);
                mini.style.position = 'absolute';
                mini.style.left = (it.x - minX) + 'px';
                mini.style.top = (it.y - minY) + 'px';
                if (it.kind !== 'title') {
                    mini.style.width = w + 'px';
                    mini.style.height = h + 'px';
                }
                mini.title = miniLabelForItem(it);
                centers[it.id] = { x: (it.x - minX) + w / 2, y: (it.y - minY) + h / 2 };

                const openable = (it.kind === 'folder' || it.kind === 'source') && Array.isArray(it.snapshotChildren);
                if (openable) {
                    mini.style.pointerEvents = 'auto';
                    mini.style.cursor = 'pointer';
                    mini.addEventListener('click', (e) => { e.stopPropagation(); openInlineLevel(it); });
                } else {
                    mini.style.pointerEvents = 'none';
                }
                if (isTopLevel && onDelete) {
                    mini.style.pointerEvents = 'auto';
                    mini.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showInlineCanvasDeleteMenu(e.clientX, e.clientY, () => { onDelete(it.id); });
                    });
                }
                world.appendChild(mini);
            });

            if (isTopLevel && connections && connections.length) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'msg-inline-canvas-connections');
                svg.style.position = 'absolute';
                svg.style.left = '0'; svg.style.top = '0';
                svg.style.width = contentW + 'px'; svg.style.height = contentH + 'px';
                svg.style.overflow = 'visible';
                svg.style.pointerEvents = 'none';
                connections.forEach(c => {
                    const a = centers[c.fromId], b = centers[c.toId];
                    if (!a || !b) return;
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
                    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
                    line.setAttribute('stroke', 'var(--brand)');
                    line.setAttribute('stroke-width', '2');
                    svg.appendChild(line);
                });
                world.appendChild(svg);
            }

            requestAnimationFrame(centerView);
        }

        function openInlineLevel(it) {
            // Drilling in truncates any forward history, same convention as the main app's own
            // back/forward stack.
            navStack = navStack.slice(0, navIndex + 1);
            navStack.push({ items: it.snapshotChildren || [], isSource: it.kind === 'source', title: it.snapshotTitle || miniLabelForItem(it) });
            navIndex++;
            renderCurrentLevel();
        }
        navBackBtn.addEventListener('click', (e) => { e.stopPropagation(); if (navIndex > 0) { navIndex--; renderCurrentLevel(); } });
        navFwdBtn.addEventListener('click', (e) => { e.stopPropagation(); if (navIndex < navStack.length - 1) { navIndex++; renderCurrentLevel(); } });

        // ---- Source level: a plain drag-to-scroll (vertical only) table, no click functionality
        // at all — mirrors how source pages behave in the real app (no pan/zoom, no dot grid).
        function renderSourcePreview(level) {
            const tableItem = (level.items || []).find(i => i.kind === 'table');
            const scroller = document.createElement('div');
            scroller.className = 'msg-inline-canvas-source-scroll';
            if (tableItem) {
                const tableWrap = document.createElement('div');
                tableWrap.className = 'msg-inline-canvas-source-table';
                tableWrap.innerHTML = renderTableHTML(tableItem);
                tableWrap.style.pointerEvents = 'none';
                scroller.appendChild(tableWrap);
            }
            world.appendChild(scroller);

            let scrollDragging = false, scrollStartY = 0, startScrollTop = 0;
            scroller.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                scrollDragging = true;
                scrollStartY = e.clientY;
                startScrollTop = scroller.scrollTop;
                scroller.setPointerCapture(e.pointerId);
            });
            scroller.addEventListener('pointermove', (e) => {
                if (!scrollDragging) return;
                scroller.scrollTop = startScrollTop - (e.clientY - scrollStartY);
            });
            scroller.addEventListener('pointerup', () => { scrollDragging = false; });
            scroller.addEventListener('pointercancel', () => { scrollDragging = false; });
        }

        // Panning only starts on true background clicks — not on an openable card (that's a
        // click-to-open instead), and not on a source level (that scrolls instead of panning).
        let panning = false, panStartX = 0, panStartY = 0, startPanX = 0, startPanY = 0;
        viewport.addEventListener('pointerdown', (e) => {
            if (navStack[navIndex].isSource) return;
            if (e.target.closest('.item, .msg-inline-canvas-drag-tab, .msg-inline-canvas-nav, .msg-inline-canvas-zoom')) return;
            e.stopPropagation();
            panning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            startPanX = vPanX; startPanY = vPanY;
            viewport.setPointerCapture(e.pointerId);
        });
        viewport.addEventListener('pointermove', (e) => {
            if (!panning) return;
            vPanX = startPanX + (e.clientX - panStartX);
            vPanY = startPanY + (e.clientY - panStartY);
            applyView();
        });
        viewport.addEventListener('pointerup', () => { panning = false; });
        viewport.addEventListener('pointercancel', () => { panning = false; });

        // Zoom slider — identical range/behavior to the main canvas zoom control, just horizontal
        function setZoomFromClientX(clientX) {
            const rect = zoomTrackMini.getBoundingClientRect();
            let pct = (clientX - rect.left) / rect.width;
            pct = Math.max(0, Math.min(1, pct));
            const newZoom = MINI_ZOOM_MIN + pct * (MINI_ZOOM_MAX - MINI_ZOOM_MIN);
            const vpRect = viewport.getBoundingClientRect();
            const cx = vpRect.width / 2, cy = vpRect.height / 2;
            const worldX = (cx - vPanX) / vZoom, worldY = (cy - vPanY) / vZoom;
            vPanX = cx - worldX * newZoom;
            vPanY = cy - worldY * newZoom;
            vZoom = newZoom;
            applyView();
            updateZoomBarUI();
        }
        zoomTrackMini.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            zoomTrackMini.classList.add('dragging');
            setZoomFromClientX(e.clientX);
            const move = (me) => setZoomFromClientX(me.clientX);
            const up = () => {
                zoomTrackMini.classList.remove('dragging');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        // ---- Drag the top-left tab out of the chat onto the main app canvas, importing whichever
        // level is currently shown ----
        if (dragTab) dragTab.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            let dragStarted = false, dragGhost = null;
            const startX = e.clientX, startY = e.clientY;
            const move = (me) => {
                if (!dragStarted) {
                    if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
                    dragStarted = true;
                    const n = navStack[navIndex].items.length;
                    dragGhost = document.createElement('div');
                    dragGhost.className = 'inline-canvas-drag-ghost';
                    dragGhost.textContent = `${n} card${n === 1 ? '' : 's'} — drop onto your canvas`;
                    document.body.appendChild(dragGhost);
                }
                dragGhost.style.left = (me.clientX + 14) + 'px';
                dragGhost.style.top = (me.clientY + 14) + 'px';
            };
            const up = (ue) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (dragGhost) { dragGhost.remove(); }
                if (!dragStarted) return;
                const panelRect = messagesPanel.getBoundingClientRect();
                const overPanel = ue.clientX >= panelRect.left && ue.clientX <= panelRect.right && ue.clientY >= panelRect.top && ue.clientY <= panelRect.bottom;
                if (overPanel) return; // dropped back inside the chat panel, no-op
                const canvasRect = canvas.getBoundingClientRect();
                const overCanvas = ue.clientX >= canvasRect.left && ue.clientX <= canvasRect.right && ue.clientY >= canvasRect.top && ue.clientY <= canvasRect.bottom;
                if (!overCanvas) return;
                importSharedCardsAtScreenPoint(navStack[navIndex].items, ue.clientX, ue.clientY);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        renderCurrentLevel();
        return wrap;
    }

    // Drops a shared set of cards onto the working canvas at the given screen point,
    // preserving their relative layout
    function importSharedCardsAtScreenPoint(items, clientX, clientY) {
        saveSnapshot();
        const rect = canvas.getBoundingClientRect();
        const dropX = Math.round(((clientX - rect.left - appState.tx) / appState.scale) / 28) * 28;
        const dropY = Math.round(((clientY - rect.top - appState.ty) / appState.scale) / 28) * 28;
        let minX = Infinity, minY = Infinity;
        items.forEach(it => { minX = Math.min(minX, it.x); minY = Math.min(minY, it.y); });
        items.forEach(it => {
            const clone = JSON.parse(JSON.stringify(it));
            clone.id = appState.idCounter++;
            clone.x = dropX + (it.x - minX);
            clone.y = dropY + (it.y - minY);
            appState.folders[appState.currentFolderId].items.push(clone);
        });
        render();
        closeMessagesPanel();
    }

    function openSharedCanvasView(items) {
        const overlay = document.getElementById('canvas-modal-overlay');
        const body = document.getElementById('canvas-modal-body');
        document.getElementById('canvas-modal-title').textContent = 'Shared Card';
        body.innerHTML = '';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '10px';
        items.forEach(item => body.appendChild(renderMsgSnapshotCard(item)));
        overlay.classList.add('open');
    }
    function closeSharedCanvasView() {
        document.getElementById('canvas-modal-overlay').classList.remove('open');
    }

    function renderConvoBody(f) {
        const body = document.getElementById('msg-convo-body');
        body.innerHTML = '';
        if (!f.messages.length) {
            const empty = document.createElement('div');
            empty.className = 'msg-empty';
            empty.textContent = 'Say hi to ' + f.displayName.split(' ')[0] + '!';
            body.appendChild(empty);
        } else {
            f.messages.forEach(m => {
                const isMine = m.senderId === appState.currentUser.id;
                const wrapper = document.createElement('div');
                wrapper.className = 'flex flex-col ' + (isMine ? 'items-end' : 'items-start') + ' w-full';

                if (m.canvasSnapshot) {
                    if (m.canvasSnapshot.length > 1) {
                        wrapper.appendChild(renderInlineCanvas(m.canvasSnapshot));
                    } else {
                        const snapBox = document.createElement('div');
                        snapBox.className = 'msg-canvas-snapshot';
                        snapBox.appendChild(renderMsgSnapshotCard(m.canvasSnapshot[0]));
                        snapBox.onclick = () => openSharedCanvasView(m.canvasSnapshot);
                        wrapper.appendChild(snapBox);
                    }
                } else {
                    const b = document.createElement('div');
                    b.className = 'msg-bubble ' + (isMine ? 'me' : 'them');
                    b.textContent = m.text;
                    wrapper.appendChild(b);
                }

                // Prepended (not appended) so the DOM ends up newest-message-first — paired
                // with #msg-convo-body's flex-direction:column-reverse, that's what pins the
                // view to the bottom (newest message) and makes new messages push the older
                // ones up, rather than the conversation growing downward from the top.
                body.insertBefore(wrapper, body.firstChild);
            });
        }
        body.scrollTop = 0;
    }
    function closeConvo() {
        msgConvo.classList.remove('open');
        appState.activeConvoId = null;
        // No unsubscribe here — messages are subscribed per-friendship globally now (see
        // subscribeToAllFriendMessages), not per open conversation.
        document.getElementById('msg-search-wrap').style.display = '';
        msgList.style.display = '';
    }
    async function sendMsg() {
        const input = document.getElementById('msg-convo-input');
        const text = input.value.trim();
        if (!text || !appState.activeConvoId) return;
        const f = friends.find(x => x.id === appState.activeConvoId);
        if (!f) return;
        input.value = '';
        updateMsgSendState();
        const { data, error } = await supabase
            .from('messages')
            .insert({ friendship_id: f.friendshipId, sender_id: appState.currentUser.id, body: text })
            .select()
            .single();
        if (error) { console.error('[chat] failed to send message:', error); return; }
        f.messages.push({ id: data.id, senderId: data.sender_id, text: data.body, canvasSnapshot: data.canvas_snapshot, createdAt: data.created_at });
        renderConvoBody(f);
        awardUserPoints('send_chat_message', 2);
    }
    // Send button lights up brand-purple once there's actually something to send, instead of
    // staying the same dim grey whether the box is empty or full.
    function updateMsgSendState() {
        const input = document.getElementById('msg-convo-input');
        document.getElementById('msg-convo-send').classList.toggle('has-text', input.value.trim().length > 0);
    }
    // Stops keys from leaking out to other keyboard shortcuts while typing a message — except
    // Escape, which must still bubble up to the global handler so it can close the panel even
    // while this input has focus (increasingly common now that typing anywhere auto-focuses it).
    document.getElementById('msg-convo-input').addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.getElementById('msg-convo-input').addEventListener('input', updateMsgSendState);
    // Typing anywhere while a conversation is open (without having clicked into the message box
    // first) focuses it and lets the same keystroke land there — so you can just start typing a
    // reply the moment a chat opens, rather than needing to click the input first.
    document.addEventListener('keydown', (e) => {
        if (!msgConvo.classList.contains('open')) return;
        const input = document.getElementById('msg-convo-input');
        if (document.activeElement === input) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length !== 1) return; // only real printable characters — not Enter/Escape/arrows/Tab/etc.
        input.focus();
    });
    msgSearchInput.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });

    function titleFontSize(level) { return level === 3 ? 18 : level === 2 ? 22 : 28; }
    function setTitleLevel(id, level) {
        const it = appState.folders[appState.currentFolderId].items.find(i => i.id === id);
        if (!it) return;
        saveSnapshot();
        it.level = parseInt(level);
        const el = document.getElementById('item-' + id);
        if (el) el.style.fontSize = titleFontSize(it.level) + 'px';
    }

    function rgbToHex(rgb) {
        if (!rgb) return '#ffffff';
        if (rgb.startsWith('#')) return rgb;
        const m = rgb.match(/\d+/g);
        if (!m) return '#ffffff';
        return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
    }
    function syncColorPicker(bodyEl) {
        const picker = bodyEl.closest('.item').querySelector('.format-bar input[type=color]');
        if (!picker) return;
        try {
            let val = document.queryCommandValue('foreColor');
            let hex = rgbToHex(val);
            if (!val || hex === '#000000') {
                const sel = window.getSelection();
                let node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : bodyEl;
                if (node.nodeType === 3) node = node.parentElement;
                if (node && bodyEl.contains(node)) {
                    hex = rgbToHex(getComputedStyle(node).color);
                } else {
                    hex = rgbToHex(getComputedStyle(bodyEl).color);
                }
            }
            picker.value = hex;
        } catch (e) {}
    }

    function findItemById(id) {
        return appState.folders[appState.currentFolderId].items.find(i => i.id === id);
    }
    function placeCaretEnd(el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

export { broadcastCursorPositionThrottled, broadcastEditingState, broadcastItemDragPositions, broadcastItemResize, closeConvo, closeSharedCanvasView, ensureCanvasPresenceChannel, findItemById, goToCollaboratorCursor, importSharedCardsAtScreenPoint, miniLabelForItem, openConvo, placeCaretEnd, queueSyncDiff, remoteCursors, renderConvoBody, renderInlineCanvas, renderRealCardPreview, repositionAllRemoteCursors, sanitizeFlashcardSnapshot, sendMsg, setTitleLevel, snapshotItem, syncColorPicker, titleFontSize };
