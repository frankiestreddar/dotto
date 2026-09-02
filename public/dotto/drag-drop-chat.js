const appState = window.__getAppState();
const supabase = window.__dottoSupabase || null;
import { renderMsgList } from './friends-presence.js';


    // setupDraggingAndClicking moved to app/dotto/canvasItemBehavior.js (Phase 3 of the
    // vanilla->React consolidation — see the migration plan) — the second "canvas core" piece to
    // live inside app/dotto/ instead of being reached via a global-bridge module, following the
    // same pattern setupResizing already proved out. dispatchSelectedToChat below is its only
    // remaining direct dependent (called from its own up() handler's "drop into active chat"
    // case) — self-contained enough (four more of its own dependencies: renderMsgList,
    // renderConvoBody, sanitizeFlashcardSnapshot, snapshotItem) that it stays vanilla rather than
    // moving too, reached via a single window.__dispatchSelectedToChat bridge instead.

    // ---------- Dispatch to Chat Interaction ----------
    async function dispatchSelectedToChat(targetIt) {
        if (!appState.activeConvoId) return;
        const f = appState.friends.find(x => x.id === appState.activeConvoId);
        if (!f) return;

        window.__saveSnapshot();

        let itemsToShare = [];
        // If targetIt is selected, we share all selected cards. Otherwise, share just this card.
        const gestureIds = appState.selectedCardIds.includes(targetIt.id) ? appState.selectedCardIds.slice() : [targetIt.id];
        gestureIds.forEach(id => {
            const it = window.__findItemById(id);
            if (it) itemsToShare.push(window.__sanitizeFlashcardSnapshot(window.__snapshotItem(it), gestureIds));
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

        window.__renderConvoBody(f);
        renderMsgList('');
    }

export { dispatchSelectedToChat };

// window.__setupDraggingAndClicking is now assigned from app/dotto-app.jsx instead
// (setupDraggingAndClicking itself moved to app/dotto/canvasItemBehavior.js — see this file's own
// comment above) — the bridge's direction flipped along with its implementation, same as
// window.__setupResizing before it.
window.__dispatchSelectedToChat = dispatchSelectedToChat;
