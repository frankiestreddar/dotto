import { createPaneKeyedStore } from "./paneKeyedStore";

// Back/forward enabled-state, one per pane (split-screen Stage 8) — { canGoBack, canGoForward },
// pushed by app/dotto/lib/tabManagement.ts's renderNavArrows(paneId) (called from render()'s
// per-frame loop for the active pane, and from jumpToHistoryIndex/switchActivePane for immediate
// feedback). Replaces the old singular #btn-back/#btn-forward .disabled assignments
// (app/dotto/lib/waypointsRenderLoop.ts) now that PaneTopBar.jsx renders its own back/forward
// buttons per pane. Migrated from bridges.js's hand-rolled createPaneKeyedStore to real Zustand
// (see PHASE4_ROADMAP.md's Zustand migration plan, batch 9) — not flushSync'd.
export interface NavHistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export const useNavHistoryStore = createPaneKeyedStore<NavHistoryState>(() => ({
  canGoBack: false,
  canGoForward: false,
}));
