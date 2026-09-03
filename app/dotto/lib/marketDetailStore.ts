import { create } from "zustand";
import type { MarketplaceItem } from "./marketplace";

// Marketplace item detail view's content (app/dotto/lib/marketplace.ts's openMarketDetail/
// closeMarketDetail) — the selected item, or null. Text fields as real JSX; the canvas preview
// (renderInlineCanvas) stays vanilla-built, mounted via a ref — see MarketDetailPanel.jsx. Which
// VIEW is showing (#view-discover vs #market-detail-view) stays a vanilla classList toggle,
// shared machinery with switchCartTab/openItemDetail/startPublishFlow elsewhere in this cluster.
// Migrated from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's
// Zustand migration plan, batch 7) — not flushSync'd.
export const useMarketDetailStore = create<MarketplaceItem | null>(() => null);
