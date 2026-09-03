import { create } from "zustand";
import type { TranslationPanelData } from "./mnemonicSearchMatching";

// Search-dropdown translation result panel (#search-translation) — single-owner static
// container, unlike searchSuggestionsStore, which is shared by multiple producers and needs its
// own discriminated-union design. null means "nothing to show" (matches the panel's own
// display:none default). Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 2) — see
// app/dotto/lib/mnemonicSearchMatching.ts's renderTranslationPanel for the producer, and
// app/dotto/TranslationPanel.jsx for the consumer (a plain side-effect component, not a portal —
// see that file's own comment for why).
export const useTranslationPanelStore = create<TranslationPanelData | null>(() => null);
