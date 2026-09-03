import { create } from "zustand";

// Hamburger menu's Sources panel (app/dotto/lib/hamburgerCollab.ts's renderSourcesList) — one row
// per source folder account-wide (current-canvas ones sorted first). Genuine JSX rows (see
// SourcesListPanel.jsx), same reasoning as chatsListStore. Migrated from bridges.js's hand-rolled
// createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — not
// flushSync'd, no synchronous DOM read follows it (it's called from render() itself, not a click
// handler expecting an immediate reflection).
export interface SourceListRow {
  id: string;
  folderId: string;
  title: string;
  globalId: string | undefined;
  onCanvas: boolean;
  active: boolean;
}

export interface SourcesListState {
  rows: SourceListRow[];
  query: string;
}

export const useSourcesListStore = create<SourcesListState>(() => ({ rows: [], query: "" }));
