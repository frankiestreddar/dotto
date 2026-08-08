"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { imageResultStore } from "./bridges";

// Mounts the mnemonic image panel's 3 mutually-exclusive states into #search-image-result — see
// imageResultStore's own comment in bridges.js. Each state's own build function stays vanilla:
// loading needs a real live node for its typewriter animation, success needs one for its
// drag-to-canvas wiring.
export default function ImageResultPanel() {
  const state = useSyncExternalStore(imageResultStore.subscribe, imageResultStore.getSnapshot, () => null);

  useLayoutEffect(() => {
    const el = document.getElementById("search-image-result");
    if (!el) return;
    el.innerHTML = "";
    if (!state) {
      el.style.display = "none";
      return;
    }
    let node;
    if (state.status === "loading") node = window.__buildImageResultLoading();
    else if (state.status === "error") node = window.__buildImageResultError(state.reason);
    else node = window.__buildImageResultCard(state.imageDataUrl);
    el.appendChild(node);
    el.style.display = "block";
  }, [state]);

  return null;
}
