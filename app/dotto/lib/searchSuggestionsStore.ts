import { create } from "zustand";
import type { MnemonicTemplate } from "./mnemonicSearchMatching";

// #search-suggestions — shared by 5 different producers across 3 files (live AI suggestions in
// app/dotto/lib/aiAssistantSuggestions.ts, the mnemonic story/loading/error trio in
// app/dotto/lib/mnemonicSearchMatching.ts, and the orchestrate error in
// app/dotto/lib/searchOrchestrationSelection.ts), so this holds a small discriminated union
// rather than one plain value — only ONE of them is ever shown at a time, unlike the ported
// notification stack (app/dotto/lib/notificationsStore.ts), which is a genuine multi-item stack.
// See SearchSuggestionsPanel.jsx for how each kind is built. Unlike commandPaletteStore, this one
// is NOT a portal (every kind's content stays 100% vanilla-built, mounted the same "return null,
// mutate in an effect" way as TranslationPanel.jsx/DictionaryPanel.jsx/etc.) — so, same as those,
// direct DOM clears from elsewhere are harmless as long as they only ever touch this SPECIFIC
// node's children (never true for #search-command-palette, see commandPaletteStore.ts). Migrated
// from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand
// migration plan, batch 3) — every producer still wraps its setState call in flushSync,
// same reasoning as before: updateSearchDropdown (app/dotto/lib/aiAssistantSuggestions.ts) reads
// #search-suggestions' real DOM node's style.display synchronously right after.
export type SearchSuggestionsState =
  | { kind: "live-suggestions"; suggestions: string[] }
  | {
      kind: "mnemonic-result";
      content: { typeText?: string; html?: string };
      options: { canvasItem?: MnemonicTemplate } | null;
    }
  | { kind: "mnemonic-loading" }
  | { kind: "mnemonic-error"; reason: string }
  | { kind: "dotbot-error"; reason: string };

export const useSearchSuggestionsStore = create<SearchSuggestionsState | null>(() => null);
