import { create, type StoreApi, type UseBoundStore } from "zustand";

// Pane-keyed variant of a real Zustand store, replacing bridges.js's hand-rolled
// createPaneKeyedStore (Zustand migration plan, batch 9, see PHASE4_ROADMAP.md) — each pane shows
// its own folder's items/tabs/breadcrumb trail/etc. independently, so a single shared store would
// make every pane render whichever pane last pushed to it. Lazily creates one real Zustand store
// the first time a given paneId is asked for, so pane 0 (the only one that exists before any split
// happens) doesn't need anything pre-declared. `defaultValue` is a FACTORY (called fresh per pane,
// not a single shared value) so each pane's own store starts from its own independent object
// rather than every pane accidentally sharing one array/object reference.
//
// `.storeFor(paneId)` returns the same real Zustand hook every time for a given paneId (memoized
// in the Map below) — confirmed safe to call directly in a component's render body, same as every
// existing pane-keyed store consumer already assumed for the old createPaneKeyedStore version
// (CanvasItemsLayer.jsx/TabsBar.jsx/PaneTopBar.jsx/PaneZoomBar.jsx): Zustand's `create()` is a pure
// function with no module-scope singleton, so calling it N times at runtime and memoizing the
// result in a Map is a supported pattern, not a rules-of-hooks violation — a given pane's paneId is
// stable for its component instance's lifetime, so the SAME hook function is called on every
// render of that instance, exactly like any other hook.
export function createPaneKeyedStore<T>(defaultValue: () => T) {
  const stores = new Map<number, UseBoundStore<StoreApi<T>>>();
  function storeFor(paneId: number): UseBoundStore<StoreApi<T>> {
    let store = stores.get(paneId);
    if (!store) {
      store = create<T>(() => defaultValue());
      stores.set(paneId, store);
    }
    return store;
  }
  // Drops a closed pane's store (split-screen Stage 5+) so it doesn't just leak forever.
  function remove(paneId: number): void {
    stores.delete(paneId);
  }
  return { storeFor, remove };
}
