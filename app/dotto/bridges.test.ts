import { describe, expect, it, vi } from "vitest";
import { paneLayoutStore } from "./bridges";

// First real test in the repo (Phase 4.0 — proves the Vitest/RTL toolchain works end to end).
// Originally targeted pricingOverlayStore; retargeted to paneLayoutStore once pricingOverlayStore
// migrated to real Zustand (Zustand migration plan, batch 1, see PHASE4_ROADMAP.md) —
// paneLayoutStore is the store scheduled to migrate last (batch 10), so this file needs exactly
// this one retarget for the whole migration, staying green through every batch in between; this
// file (and the createStore/createPaneKeyedStore mechanism it tests) is deleted outright once
// batch 10 lands. Exercises the actual subscribe/set/getSnapshot contract every other
// still-not-yet-migrated store in bridges.js relies on, not a throwaway placeholder.
describe("createStore (via paneLayoutStore)", () => {
  it("getSnapshot reflects the current value after set", () => {
    paneLayoutStore.set({ type: "leaf", paneId: 1 });
    expect(paneLayoutStore.getSnapshot()).toEqual({ type: "leaf", paneId: 1 });
    paneLayoutStore.set({ type: "leaf", paneId: 0 });
    expect(paneLayoutStore.getSnapshot()).toEqual({ type: "leaf", paneId: 0 });
  });

  it("notifies subscribers on set, and stops after unsubscribing", () => {
    const listener = vi.fn();
    const unsubscribe = paneLayoutStore.subscribe(listener);

    paneLayoutStore.set({ type: "leaf", paneId: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    paneLayoutStore.set({ type: "leaf", paneId: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
