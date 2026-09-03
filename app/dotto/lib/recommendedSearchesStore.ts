import { create } from "zustand";
import type { RecommendedPanelData } from "./mnemonicSearchMatching";

// Search-dropdown "what could I ask next" panel (#search-recommended) — same shape/reasoning as
// translationPanelStore. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 2) — see
// app/dotto/lib/mnemonicSearchMatching.ts's renderRecommendedSearchesPanel for the producer, and
// app/dotto/RecommendedSearchesPanel.jsx for the consumer.
export const useRecommendedSearchesStore = create<RecommendedPanelData | null>(() => null);
