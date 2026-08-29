"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { dictionaryPanelStore } from "./bridges";

// Mounts buildDictionaryCard's vanilla-built card into #search-dictionary — see TranslationPanel.jsx
// for the full reasoning (identical pattern, different panel/builder). buildDictionaryCard owns a
// real internal widget (multi-sense cycling via a closured `index`, hover-reveal side arrows, its
// own drag-to-canvas wiring) — left fully vanilla rather than rewritten as JSX for this pass.
export default function DictionaryPanel() {
  const panel = useSyncExternalStore(
    dictionaryPanelStore.subscribe,
    dictionaryPanelStore.getSnapshot,
    () => null,
  );

  useLayoutEffect(() => {
    const el = document.getElementById("search-dictionary");
    if (!el) return;
    el.innerHTML = "";
    if (panel) {
      el.appendChild(window.__buildDictionaryCard(panel));
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }, [panel]);

  return null;
}
