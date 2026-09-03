import { create } from "zustand";
import type { AnswerBlocksPanelData } from "./mnemonicSearchMatching";

export interface DotbotAnswerState {
  text: string;
  answerBlocksPanel: AnswerBlocksPanelData | null;
  answerBlocksLanguage: string;
}

// { text, answerBlocksPanel, answerBlocksLanguage } | null — combines what were originally two
// separate vanilla functions (renderDotbotAnswerPanel/renderAnswerBlocksPanel) into one store:
// the second always ran immediately after the first, appending into the SAME container the first
// had just cleared, so they were never really two independent panels — see
// app/dotto/DotbotAnswerPanel.jsx and renderDotbotAnswerPanel's own comment
// (app/dotto/lib/mnemonicSearchMatching.ts). Migrated from bridges.js's hand-rolled createStore to
// real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 2).
export const useDotbotAnswerStore = create<DotbotAnswerState | null>(() => null);
