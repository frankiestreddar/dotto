import { describe, expect, it, vi } from "vitest";
import { pricingOverlayStore } from "./bridges";

// First real test in the repo (Phase 4.0 — proves the Vitest/RTL toolchain works end to end).
// pricingOverlayStore is a real, already-shipped createStore() instance (bridges.js) with zero
// prior test coverage — this exercises the actual subscribe/set/getSnapshot contract every other
// store in bridges.js relies on, not a throwaway placeholder.
describe("createStore (via pricingOverlayStore)", () => {
  it("getSnapshot reflects the current value after set", () => {
    pricingOverlayStore.set(true);
    expect(pricingOverlayStore.getSnapshot()).toBe(true);
    pricingOverlayStore.set(false);
    expect(pricingOverlayStore.getSnapshot()).toBe(false);
  });

  it("notifies subscribers on set, and stops after unsubscribing", () => {
    const listener = vi.fn();
    const unsubscribe = pricingOverlayStore.subscribe(listener);

    pricingOverlayStore.set(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    pricingOverlayStore.set(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
