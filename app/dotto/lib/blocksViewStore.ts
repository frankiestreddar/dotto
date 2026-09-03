import { create } from "zustand";
import type { BlocksRow } from "./blocksPanel";

// Blocks panel's list content (app/dotto/lib/blocksPanel.ts's computeBlocksRows/
// refreshBlocksPanel) — a flat row array, same convention as outlineStore/computeOutlineRows.
// Genuine JSX rows — drag-into-folder (setupContentItemDrag) and folder/item CRUD are all real ES
// imports from blocksPanel.ts (see BlocksPanel.jsx); opening the item detail view
// (openItemDetail) still goes through a window.__ bridge, since that one lives in
// app/dotto/lib/libraryPublish.ts and a direct import back would be circular (see blocksPanel.ts's
// own header comment). Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 7) — not flushSync'd. Array-shaped, like
// marketDiscoverStore and the other batch 3/4/5 array stores — its one producer call passes `true`
// as setState's second (replace) argument for the usual Object.assign-merge-breaks-Arrays reason.
export const useBlocksViewStore = create<BlocksRow[]>(() => []);
