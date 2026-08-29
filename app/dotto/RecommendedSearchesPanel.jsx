"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { recommendedSearchesStore } from "./bridges";

// Mounts buildRecommendedSearchesRows's vanilla-built rows into #search-recommended — see
// TranslationPanel.jsx for the full reasoning (identical pattern, different panel/builder).
export default function RecommendedSearchesPanel() {
  const panel = useSyncExternalStore(
    recommendedSearchesStore.subscribe,
    recommendedSearchesStore.getSnapshot,
    () => null,
  );

  useLayoutEffect(() => {
    const el = document.getElementById("search-recommended");
    if (!el) return;
    el.innerHTML = "";
    if (panel) {
      el.appendChild(window.__buildRecommendedSearchesRows(panel));
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }, [panel]);

  return null;
}
