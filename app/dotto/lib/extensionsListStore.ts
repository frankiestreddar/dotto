import { create } from "zustand";

// Extensions panel's list content (was Library's own role before the Blocks/Extensions
// repurposing — see blocksViewStore's own comment; was going to be called "Plugins" before an
// explicit follow-up rename) — just a flat array of installed extensions, rendered as
// rectangular pills rather than item cards (explicit request). Currently seeded with two dummy
// entries (app/dotto/lib/blocksPanel.ts has no real extension system to back this yet, and has no
// producer call for this store at all) — see ExtensionsPanel.jsx. Migrated from bridges.js's
// hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan,
// batch 7).
export interface ExtensionListItem {
  id: string;
  label: string;
}

export const useExtensionsListStore = create<ExtensionListItem[]>(() => [
  { id: "extension-1", label: "Plugin 1" },
  { id: "extension-2", label: "Plugin 2" },
]);
