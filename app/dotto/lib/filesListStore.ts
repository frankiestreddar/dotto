import { create } from "zustand";

// Hamburger menu's Files panel (app/dotto/lib/hamburgerCollab.ts's renderFilesList) —
// structurally identical to sourcesListStore just above (copied from it per explicit request),
// one row per uploaded kind:'media' item account-wide (current-canvas ones sorted first). See
// FilesListPanel.jsx. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — not flushSync'd, same reasoning as
// sourcesListStore.
export interface FileListRow {
  id: number;
  folderId: string;
  itemId: number;
  title: string;
  onCanvas: boolean;
  mediaSrc: string;
}

export interface FilesListState {
  rows: FileListRow[];
  query: string;
}

export const useFilesListStore = create<FilesListState>(() => ({ rows: [], query: "" }));
