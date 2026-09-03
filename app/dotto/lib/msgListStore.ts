import { create } from "zustand";

// Messages panel's chat/friend list (app/dotto/lib/friendsPresence.ts's renderMsgList/
// renderMsgRequests) — same two-view shape as hubCollabListStore:
// { view: 'main', requestsCount, matchedFriends, searchResults, query } or
// { view: 'requests', requests }. Genuine JSX rows (see MessagesListPanel.jsx). The actual
// conversation thread (openConvo/renderConvoBody) stays a separate store (msgConvoStore) — part
// of the much larger "Live canvas presence" cluster (PHASE2_ROADMAP.md item 11), not this list.
// Migrated from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's
// Zustand migration plan, batch 6) — not flushSync'd, both entry points are real async Supabase
// calls. Every producer call passes `true` as setState's second (replace) argument, same reasoning
// as hubCollabListStore (batch 4): the two variants have different key sets, so a default
// Object.assign merge could leak a stale field across a view transition.
export interface MsgListChatRow {
  id: string;
  displayName: string;
  avatarId: number;
  avatarUrl: string | null;
  preview: string;
}

export interface MsgListSearchResultRow {
  id: string;
  username: string;
  pending: boolean;
}

export interface MsgListRequestRow {
  id: string;
  username: string;
}

export type MsgListState =
  | {
      view: "main";
      requestsCount: number;
      matchedFriends: MsgListChatRow[];
      searchResults: MsgListSearchResultRow[];
      query: string;
    }
  | { view: "requests"; requests: MsgListRequestRow[] };

export const useMsgListStore = create<MsgListState>(() => ({
  view: "main",
  requestsCount: 0,
  matchedFriends: [],
  searchResults: [],
  query: "",
}));
