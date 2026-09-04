"use client";

import { useLayoutEffect } from "react";
import { useSearchSuggestionsStore } from "./lib/searchSuggestionsStore";
import { buildLiveSuggestionsRows } from "./lib/aiAssistantSuggestions";
import {
  buildMnemonicErrorEl,
  buildMnemonicLoadingEl,
  buildMnemonicResultCard,
  startMnemonicResultReveal,
} from "./lib/mnemonicSearchMatching";

// Mounts whichever of #search-suggestions' 5 producers is currently active — see
// app/dotto/lib/searchSuggestionsStore.ts's own comment for the full producer list and why this is a
// discriminated union. Every kind's content stays vanilla-built (typewriter reveals, drag-to-
// canvas wiring), same "return null, mutate in an effect" pattern as TranslationPanel.tsx and
// friends — there's no list to key/diff here, just one blob of content wholesale-replaced each
// time. 'mnemonic-error' and 'dotbot-error' intentionally share the same builder
// (buildMnemonicErrorEl) — see renderDotbotOrchestrateError's own comment in
// app/dotto/lib/searchOrchestrationSelection.ts for why they're really the same shape.
export default function SearchSuggestionsPanel() {
  const state = useSearchSuggestionsStore();

  useLayoutEffect(() => {
    const el = document.getElementById("search-suggestions");
    if (!el) return;
    el.innerHTML = "";
    if (!state) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";

    switch (state.kind) {
      case "live-suggestions":
        el.appendChild(buildLiveSuggestionsRows(state.suggestions));
        break;
      case "mnemonic-result": {
        const card = buildMnemonicResultCard();
        el.appendChild(card);
        startMnemonicResultReveal(card, state.content, state.options);
        break;
      }
      case "mnemonic-loading":
        el.appendChild(buildMnemonicLoadingEl());
        break;
      case "mnemonic-error":
      case "dotbot-error":
        el.appendChild(buildMnemonicErrorEl(state.reason));
        break;
      default:
        break;
    }
  }, [state]);

  return null;
}
