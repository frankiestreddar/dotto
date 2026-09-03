import { createPaneKeyedStore } from "./paneKeyedStore";

// Collaborators pill, one per pane (split-screen Stage 8) — { show, collabs (up to 3), moreCount
// }, pushed by app/dotto/lib/friendsPresence.ts's renderCollabPill(paneId). MUST be flushSync'd
// (see its producer's own comment): openCollabPanel (app/dotto/lib/friendsPresence.ts) reads the
// triggering bubble element's `.show` class synchronously right after a caller pushes here.
// Migrated from bridges.js's hand-rolled createPaneKeyedStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 9) — see app/dotto/lib/paneKeyedStore.ts for
// the redesigned pane-keyed factory itself.
export interface CollabPillFriend {
  id: string;
  avatarId: number;
  avatarUrl: string | null;
  displayName: string;
}

export interface CollabPillState {
  show: boolean;
  collabs: CollabPillFriend[];
  moreCount: number;
}

export const useCollabPillStore = createPaneKeyedStore<CollabPillState>(() => ({
  show: false,
  collabs: [],
  moreCount: 0,
}));
