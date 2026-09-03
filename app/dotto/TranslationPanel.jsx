"use client";

import { useLayoutEffect } from "react";
import { useTranslationPanelStore } from "./lib/translationPanelStore";
import { buildTranslationCard } from "./lib/mnemonicSearchMatching";

// Mounts buildTranslationCard's vanilla-built card into #search-translation (content/fragments/
// top-bar.html) whenever the panel data changes. This is a plain side-effect component (no JSX
// children of its own) rather than a portal because #search-translation's style.display is still
// set directly here, matching the original renderTranslationPanel — updateSearchDropdown
// (app/dotto/lib/aiAssistantSuggestions.ts) reads that inline style directly to decide whether
// #search-dropdown itself should be visible, so this has to keep setting it exactly as before,
// not hand that decision to React.
export default function TranslationPanel() {
  const panel = useTranslationPanelStore();

  useLayoutEffect(() => {
    const el = document.getElementById("search-translation");
    if (!el) return;
    el.innerHTML = "";
    if (panel) {
      el.appendChild(buildTranslationCard(panel));
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }, [panel]);

  return null;
}
