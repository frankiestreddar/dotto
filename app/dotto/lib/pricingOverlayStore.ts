import { create } from "zustand";

// Pricing/upgrade overlay (Phase 2 increment 1, the first subsystem converted) — a plain boolean.
// Migrated from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's
// Zustand migration plan) — first of the 10 batches, since PricingOverlay.jsx already imported
// the old store directly for its own close button, so half this migration's blast radius was
// already proven. See app/dotto/lib/profileAchievementsPricing.ts's openPricingOverlay/
// closePricingOverlay for the callers (inline onclick="..." attributes, other modules) that still
// trigger this via those two stable entry points.
export const usePricingOverlayStore = create<boolean>(() => false);
