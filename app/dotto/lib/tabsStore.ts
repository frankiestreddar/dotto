import { createPaneKeyedStore } from "./paneKeyedStore";

// Canvas tabs, next to each pane's own breadcrumb pill (see app/dotto/TabsBar.jsx,
// app/dotto/lib/tabManagement.ts's renderTabsPanel/addTab/switchTab/closeTab) — { tabs: [{id,
// folderId, label}], activeTabId }. Each tab is a lightweight bookmark of a folder location, not
// an independent history/camera context — see renderTabsPanel's own comment for why. Pane-keyed
// since split-screen Stage 7, same reasoning as breadcrumbMapStore — each pane now renders its own
// <TabsBar paneId={paneId}/> instance instead of one shared instance tied to whichever pane
// happens to be active. Migrated from bridges.js's hand-rolled createPaneKeyedStore to real
// Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 9) — not flushSync'd, same
// reasoning as breadcrumbMapStore.
export interface TabInfo {
  id: string;
  folderId: string;
  label: string;
}

export interface TabsState {
  tabs: TabInfo[];
  activeTabId: string | null;
}

export const useTabsStore = createPaneKeyedStore<TabsState>(() => ({
  tabs: [],
  activeTabId: null,
}));
