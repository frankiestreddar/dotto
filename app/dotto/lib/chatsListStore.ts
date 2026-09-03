import { create } from "zustand";

// Hamburger menu's Chats panel (app/dotto/lib/hamburgerCollab.ts's renderChatsList) — a plain
// array of { id, title, updated_at } rows (see ChatsListPanel.jsx), no search/query state (v1: no
// search box, unlike Waypoints/Collaborations — a saved-chat list is likely short enough not to
// need one yet). Row click reopens that conversation in the search palette — see
// app/dotto/lib/hamburgerCollab.ts's openSavedChat. Migrated from bridges.js's hand-rolled
// createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — not
// flushSync'd, its producer is a real async Supabase call, so there's no synchronous DOM read
// racing it. Array-shaped, like chatThreadStore — every producer call passes `true` as setState's
// second (replace) argument to avoid Zustand's default Object.assign shallow-merge silently
// turning the array into a plain {0:...,1:...} object (see chatThreadStore.ts's own comment for
// the full mechanics).
export interface ChatListRow {
  id: string;
  title: string;
  updated_at: string;
}

export const useChatsListStore = create<ChatListRow[]>(() => []);
