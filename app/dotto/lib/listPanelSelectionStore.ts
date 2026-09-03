import { create } from "zustand";

// Shift-click-to-select + Backspace-to-delete state for the Chats/Waypoints/Collaborations
// hamburger list panels (app/dotto/lib/hamburgerCollab.ts's toggleListPanelSelection/
// clearListPanelSelection). One shared store, not three — openHubSubpanel
// (app/dotto/lib/panelsHamburger.ts) already enforces exactly one hub-subpanel open at a time, so
// `panel` (which list the ids belong to) doubles as the disambiguation a Backspace handler needs
// for free, no separate "which panel is active" bookkeeping. Collaborations' two row kinds (owned
// vs. shared-with-me) share this same `ids` Set with an "owned:"/"shared:" id prefix to avoid any
// collision between the two id spaces. `ids` is a real Set (not an array) purely for O(1)
// has()/toggle() in each row's render — never mutated in place, always replaced wholesale via
// setState, same as before. Migrated from bridges.js's hand-rolled createStore to real Zustand
// (see PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — not flushSync'd, no synchronous DOM
// read follows a selection toggle either. Consumed by 3 components (WaypointsListPanel.jsx,
// ChatsListPanel.jsx, HubCollabListPanel.jsx), each filtering `ids` down to its own `panel`.
export interface ListPanelSelectionState {
  panel: string | null;
  ids: Set<string>;
}

export const useListPanelSelectionStore = create<ListPanelSelectionState>(() => ({
  panel: null,
  ids: new Set(),
}));
