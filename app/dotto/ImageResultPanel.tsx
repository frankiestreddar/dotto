"use client";

import { useLayoutEffect } from "react";
import { useImageResultStore } from "./lib/imageResultStore";
import {
  buildImageResultCard,
  buildImageResultError,
  buildImageResultLoading,
} from "./lib/mnemonicSearchMatching";

// Mounts the mnemonic image panel's 3 mutually-exclusive states into #search-image-result — see
// app/dotto/lib/imageResultStore.ts's own comment. Each state's own build function stays vanilla:
// loading needs a real live node for its typewriter animation, success needs one for its
// drag-to-canvas wiring.
export default function ImageResultPanel() {
  const state = useImageResultStore();

  useLayoutEffect(() => {
    const el = document.getElementById("search-image-result");
    if (!el) return;
    el.innerHTML = "";
    if (!state) {
      el.style.display = "none";
      return;
    }
    let node;
    if (state.status === "loading") node = buildImageResultLoading();
    else if (state.status === "error") node = buildImageResultError(state.reason);
    else node = buildImageResultCard(state.imageDataUrl);
    el.appendChild(node);
    el.style.display = "block";
  }, [state]);

  return null;
}
