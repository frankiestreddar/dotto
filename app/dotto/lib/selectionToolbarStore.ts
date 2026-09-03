import { create } from "zustand";

export interface SelectionToolbarState {
  isOpen: boolean;
  left: number;
  top: number;
}

// Text-selection toolbar shell (Phase 2 increment 2) — {isOpen, left, top}, richer than
// pricingOverlayStore's plain boolean since this one also carries the toolbar's already-clamped
// screen position. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 1). See
// app/dotto/lib/searchOrchestrationSelection.ts's showSelectionToolbarFor/hideSelectionToolbar for
// the side that still owns WHEN to show/hide and WHERE.
export const useSelectionToolbarStore = create<SelectionToolbarState>(() => ({
  isOpen: false,
  left: 0,
  top: 0,
}));
