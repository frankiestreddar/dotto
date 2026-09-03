// setupDraggingAndClicking moved to app/dotto/canvasItemBehavior.js (Phase 3 of the
// vanilla->React consolidation — see the migration plan) — the second "canvas core" piece to live
// inside app/dotto/ instead of being reached via a global-bridge module, following the same
// pattern setupResizing already proved out. dispatchSelectedToChat below is its only remaining
// direct dependent (called from its own up() handler's "drop into active chat" case) —
// self-contained enough (four more of its own dependencies: renderMsgList/renderConvoBody/
// sanitizeFlashcardSnapshot/snapshotItem) that it stayed vanilla for a long time rather than moving
// too, reached from canvasItemBehavior.js via a single window.__dispatchSelectedToChat bridge.
// renderMsgList itself is a real ES import now (same app/dotto/lib tree as
// app/dotto/lib/friendsPresence.ts, once that file was ported too).

import { renderMsgList } from "./friendsPresence";

interface Friend {
  id: string;
  friendshipId: string;
  messages: {
    id: string;
    senderId: string;
    text: string;
    canvasSnapshot: unknown;
    createdAt: string;
  }[];
}
interface AppState {
  activeConvoId: string | null;
  friends: Friend[];
  selectedCardIds: number[];
  currentUser: { id: string | null };
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Dispatch to Chat Interaction ----------
export async function dispatchSelectedToChat(targetIt: { id: number }): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!appState.activeConvoId || !supabase) return;
  const f = appState.friends.find((x) => x.id === appState.activeConvoId);
  if (!f) return;

  window.__saveSnapshot!();

  const itemsToShare: Record<string, unknown>[] = [];
  // If targetIt is selected, we share all selected cards. Otherwise, share just this card.
  const gestureIds = appState.selectedCardIds.includes(targetIt.id)
    ? appState.selectedCardIds.slice()
    : [targetIt.id];
  gestureIds.forEach((id) => {
    const it = window.__findItemById!(id);
    if (it)
      itemsToShare.push(
        window.__sanitizeFlashcardSnapshot!(window.__snapshotItem!(it), gestureIds),
      );
  });

  if (itemsToShare.length === 0) return;

  const text = itemsToShare.length === 1 ? `Shared Node` : `Shared Canvas Collection`;
  const { data, error } = await supabase
    .from("messages")
    .insert({
      friendship_id: f.friendshipId,
      sender_id: appState.currentUser.id,
      body: text,
      canvas_snapshot: itemsToShare,
    })
    .select()
    .single();
  if (error) {
    console.error("[chat] failed to share card:", error);
    return;
  }
  f.messages.push({
    id: data.id,
    senderId: data.sender_id,
    text: data.body,
    canvasSnapshot: data.canvas_snapshot,
    createdAt: data.created_at,
  });

  window.__renderConvoBody?.(f as unknown as Record<string, unknown>);
  renderMsgList("");
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // window.__setupDraggingAndClicking is assigned from app/dotto-app.jsx instead
  // (setupDraggingAndClicking itself lives in app/dotto/canvasItemBehavior.js — see this file's
  // own comment above). Used by canvasItemBehavior.js's own up() handler.
  window.__dispatchSelectedToChat = dispatchSelectedToChat;
}
