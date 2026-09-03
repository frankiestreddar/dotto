import { create } from "zustand";
import type { MarketplaceItem } from "./marketplace";

// Marketplace "Discover" tab's trending list (app/dotto/lib/marketplace.ts's
// renderMarketplaceDiscover) — the already-filtered array of items. Genuine JSX rows, same
// reasoning as the other list panels. Migrated from bridges.js's hand-rolled createStore to real
// Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 7) — not flushSync'd. Array-
// shaped, like chatThreadStore/chatsListStore/achievementsStore — its one producer call passes
// `true` as setState's second (replace) argument to avoid Zustand's default Object.assign
// shallow-merge silently turning the array into a plain {0:...,1:...} object (see
// chatThreadStore.ts's own comment for the full mechanics).
export const useMarketDiscoverStore = create<MarketplaceItem[]>(() => []);
