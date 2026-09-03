import { create } from "zustand";
import type { IncomingCanvasRequest, OwnedCanvasCollab } from "./hamburgerCollab";

// Hamburger menu's Collaborations panel (app/dotto/lib/hamburgerCollab.ts's renderHubCollabList/
// renderHubCollabRequests) — two views sharing #hub-collab-list, same as the vanilla version:
// { view: 'main', requestsCount, ownedShown, sharedShown, query } or
// { view: 'requests', requests }. Genuine JSX rows (see HubCollabListPanel.jsx), same reasoning as
// waypointsListStore. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — not flushSync'd, both entry points are
// real async Supabase calls, so there's no synchronous DOM read to race.
export type HubCollabListState =
  | {
      view: "main";
      requestsCount: number;
      ownedShown: (OwnedCanvasCollab & { liveTitle: string })[];
      sharedShown: (IncomingCanvasRequest & { liveTitle: string })[];
      query: string;
    }
  | { view: "requests"; requests: IncomingCanvasRequest[] };

export const useHubCollabListStore = create<HubCollabListState>(() => ({
  view: "main",
  requestsCount: 0,
  ownedShown: [],
  sharedShown: [],
  query: "",
}));
