import { createPaneKeyedStore } from "./paneKeyedStore";

// Compact "…/parent/current" breadcrumb trail for a pane's own active tab (see
// app/dotto/TabsBar.jsx's ActiveTabTrail, app/dotto/lib/tabManagement.ts's
// renderBreadcrumbMapPanel) — each of `root`/`parent`/`current` either null or {label, folderId,
// isSyntheticRoot}. Pane-keyed since split-screen Stage 7 (each pane gets its own breadcrumb pill
// now — was a single shared store, which only ever reflected whichever pane was CURRENTLY active,
// so an inactive pane's own pill had nothing correct to show). Migrated from bridges.js's
// hand-rolled createPaneKeyedStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration
// plan, batch 9) — not flushSync'd, same reasoning as chatsListStore/waypointsListStore: no
// synchronous DOM read follows a navigation-driven update.
export interface BreadcrumbNode {
  label: string;
  folderId: string;
  isSyntheticRoot: boolean;
}

export interface BreadcrumbMapState {
  hasMore: boolean;
  root: BreadcrumbNode | null;
  parent: BreadcrumbNode | null;
  current: BreadcrumbNode | null;
}

export const useBreadcrumbMapStore = createPaneKeyedStore<BreadcrumbMapState>(() => ({
  hasMore: false,
  root: null,
  parent: null,
  current: null,
}));
