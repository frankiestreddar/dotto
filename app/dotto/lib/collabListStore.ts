import { create } from "zustand";

// Per-canvas Collaborations flyout (app/dotto/lib/friendsPresence.ts's renderCollabList) — one
// row per friend, shown/searchable in this canvas's own collaborator picker. No Requests
// drill-down of its own (unlike hubCollabListStore/msgListStore) — adding someone here sends a
// request that shows as "Requested" until accepted from THEIR OWN hamburger Collaborations panel.
// Genuine JSX rows, same reasoning as the others. Migrated from bridges.js's hand-rolled
// createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 6) — not
// flushSync'd, both refreshFriendsData/refreshCanvasCollabForCurrentFolder producers are real
// async Supabase calls.
export interface CollabListRow {
  id: string;
  displayName: string;
  avatarId: number;
  avatarUrl: string | null;
  added: boolean;
  pending: boolean;
  isPresent: boolean;
}

export interface CollabListState {
  rows: CollabListRow[];
  query: string;
}

export const useCollabListStore = create<CollabListState>(() => ({ rows: [], query: "" }));
