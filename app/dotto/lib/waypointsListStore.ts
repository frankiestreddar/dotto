import { create } from "zustand";
import type { WaypointRow } from "./hamburgerCollab";

// Hamburger menu's Waypoints panel (app/dotto/lib/hamburgerCollab.ts's renderWaypointsList) —
// genuine JSX rows (see WaypointsListPanel.jsx), same reasoning as commandPaletteStore: simple
// icon+label+onclick rows, no per-row widget state worth keeping vanilla. `query` rides along
// just to pick the right empty-state message ("No waypoints yet." vs "No matching waypoints."),
// matching the original. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — not flushSync'd, the fetch it follows is
// async (a real network round-trip), so there's no synchronous DOM read racing it.
export interface WaypointsListState {
  rows: WaypointRow[];
  query: string;
}

export const useWaypointsListStore = create<WaypointsListState>(() => ({ rows: [], query: "" }));
