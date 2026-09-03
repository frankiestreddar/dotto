import { create } from "zustand";
import type { ExamplesPanelData } from "./mnemonicSearchMatching";

// Search-dropdown examples result panel (#search-examples) — same shape/reasoning as
// translationPanelStore. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 2) — see
// app/dotto/lib/mnemonicSearchMatching.ts's renderExamplesPanel for the producer, and
// app/dotto/ExamplesPanel.jsx for the consumer.
export const useExamplesPanelStore = create<ExamplesPanelData | null>(() => null);
