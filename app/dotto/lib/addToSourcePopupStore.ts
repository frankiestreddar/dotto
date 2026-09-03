import { create } from "zustand";

// Add-to-source popup (app/dotto/lib/searchOrchestrationSelection.ts) — same shape as
// useSelectionToolbarStore (app/dotto/lib/selectionToolbarStore.ts), for the same reason: this
// popup isn't nested inside any static markup fragment (the original code appended it straight
// onto document.body), so it doesn't need a portal — React renders it independently, same as
// PricingOverlay/SelectionToolbar. The popup's actual CONTENT (source search, the entry row, its
// own drag-free inline editing) stays fully vanilla, built by renderAddToSourcePopup directly
// against document.getElementById('add-to-source-popup') — see AddToSourcePopup.jsx and
// openAddToSourcePopup's own comment for why no mount effect is needed: this store's setState
// call is flushSync'd, so the div already exists by the time openAddToSourcePopup calls
// renderAddToSourcePopup right after. Migrated from bridges.js's hand-rolled createStore to real
// Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 3).
export interface AddToSourcePopupState {
  isOpen: boolean;
  left: number;
  top: number;
}

export const useAddToSourcePopupStore = create<AddToSourcePopupState>(() => ({
  isOpen: false,
  left: 0,
  top: 0,
}));
