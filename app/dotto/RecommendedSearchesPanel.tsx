"use client";

import { useLayoutEffect } from "react";
import { useRecommendedSearchesStore } from "./lib/recommendedSearchesStore";
import { buildRecommendedSearchesRows } from "./lib/mnemonicSearchMatching";

// Mounts buildRecommendedSearchesRows's vanilla-built rows into #search-recommended — see
// TranslationPanel.tsx for the full reasoning (identical pattern, different panel/builder).
export default function RecommendedSearchesPanel() {
  const panel = useRecommendedSearchesStore();

  useLayoutEffect(() => {
    const el = document.getElementById("search-recommended");
    if (!el) return;
    el.innerHTML = "";
    if (panel) {
      el.appendChild(buildRecommendedSearchesRows(panel));
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }, [panel]);

  return null;
}
