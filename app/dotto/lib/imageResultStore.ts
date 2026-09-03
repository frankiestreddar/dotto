import { create } from "zustand";

export type ImageResultState =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "success"; imageDataUrl: string };

// { status: 'loading' | 'error' | 'success', reason, imageDataUrl } | null — the mnemonic image
// result panel's three mutually-exclusive states, see app/dotto/ImageResultPanel.jsx. Migrated
// from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand
// migration plan, batch 2) — see app/dotto/lib/mnemonicSearchMatching.ts's
// renderImageResultLoading/renderImageResultError/renderImageResultPanel for the producers.
export const useImageResultStore = create<ImageResultState | null>(() => null);
