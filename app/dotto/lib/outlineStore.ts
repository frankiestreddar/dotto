import { create } from "zustand";
import type { OutlineRow } from "./outlineTree";

// Hamburger menu's Outline panel (app/dotto/lib/outlineTree.ts's buildOutline/
// handleOutlineSearch) — one row per canvas card/heading/nested-canvas/source (or, on a source
// page, one row per data row — see computeOutlineRows/computeSourceOutlineRows for the row
// shapes). Genuine JSX rows (see OutlinePanel.jsx). Migrated from bridges.js's hand-rolled
// createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 4) — MUST
// stay flushSync'd at every producer call site: buildOutline's own scrollTop restore, and
// toggleHamburgerMenu's setOutlineActive(0) call right after buildOutline() returns, both need
// OutlinePanel.jsx's real DOM (and its own layout effect, which calls window.__syncOutlineRows)
// already committed.
export interface OutlineState {
  rows: OutlineRow[];
  query: string;
}

export const useOutlineStore = create<OutlineState>(() => ({ rows: [], query: "" }));
