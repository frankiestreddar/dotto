import { create } from "zustand";
import type { DictionaryPanelData } from "./mnemonicSearchMatching";

// Search-dropdown dictionary result panel (#search-dictionary) — same shape/reasoning as
// translationPanelStore. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 2) — see
// app/dotto/lib/mnemonicSearchMatching.ts's renderDictionaryPanel for the producer, and
// app/dotto/DictionaryPanel.jsx for the consumer.
export const useDictionaryPanelStore = create<DictionaryPanelData | null>(() => null);
