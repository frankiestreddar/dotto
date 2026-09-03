"use client";

import { useLayoutEffect } from "react";
import { useExamplesPanelStore } from "./lib/examplesPanelStore";
import { buildExamplesCard } from "./lib/mnemonicSearchMatching";

// Mounts buildExamplesCard's vanilla-built card into #search-examples — see TranslationPanel.tsx
// for the full reasoning (identical pattern, different panel/builder). buildExamplesCard owns its
// own per-sentence drag-to-canvas wiring and a color-coding toggle button — left fully vanilla.
export default function ExamplesPanel() {
  const panel = useExamplesPanelStore();

  useLayoutEffect(() => {
    const el = document.getElementById("search-examples");
    if (!el) return;
    el.innerHTML = "";
    if (panel) {
      el.appendChild(buildExamplesCard(panel));
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }, [panel]);

  return null;
}
