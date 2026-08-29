"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { searchSuggestionsStore } from "./bridges";

// Mounts whichever of #search-suggestions' 5 producers is currently active — see
// searchSuggestionsStore's own comment in bridges.js for the full producer list and why this is a
// discriminated union. Every kind's content stays vanilla-built (typewriter reveals, drag-to-
// canvas wiring), same "return null, mutate in an effect" pattern as TranslationPanel.jsx and
// friends — there's no list to key/diff here, just one blob of content wholesale-replaced each
// time. 'mnemonic-error' and 'dotbot-error' intentionally share the same builder
// (window.__buildMnemonicErrorEl) — see renderDotbotOrchestrateError's own comment in
// search-orchestration-selection.js for why they're really the same shape.
export default function SearchSuggestionsPanel() {
  const state = useSyncExternalStore(
    searchSuggestionsStore.subscribe,
    searchSuggestionsStore.getSnapshot,
    () => null,
  );

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
        el.appendChild(window.__buildLiveSuggestionsRows(state.suggestions));
        break;
      case "mnemonic-result": {
        const card = window.__buildMnemonicResultCard();
        el.appendChild(card);
        window.__startMnemonicResultReveal(card, state.content, state.options);
        break;
      }
      case "mnemonic-loading":
        el.appendChild(window.__buildMnemonicLoadingEl());
        break;
      case "mnemonic-error":
      case "dotbot-error":
        el.appendChild(window.__buildMnemonicErrorEl(state.reason));
        break;
      default:
        break;
    }
  }, [state]);

  return null;
}
