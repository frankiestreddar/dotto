"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { translationPanelStore } from "./bridges";

// Mounts buildTranslationCard's vanilla-built card into #search-translation (content/fragments/
// top-bar.html) whenever the panel data changes — see translationPanelStore's own comment in
// bridges.js for why this is a plain side-effect component (no JSX children of its own) rather
// than a portal. #search-translation's style.display is still set directly here, matching the
// original renderTranslationPanel — updateSearchDropdown (ai-assistant-suggestions.js) reads that
// inline style directly to decide whether #search-dropdown itself should be visible, so this has
// to keep setting it exactly as before, not hand that decision to React.
export default function TranslationPanel() {
  const panel = useSyncExternalStore(translationPanelStore.subscribe, translationPanelStore.getSnapshot, () => null);

  useLayoutEffect(() => {
    const el = document.getElementById("search-translation");
    if (!el) return;
    el.innerHTML = "";
    if (panel) {
      el.appendChild(window.__buildTranslationCard(panel));
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }, [panel]);

  return null;
}
