"use client";

import { useLayoutEffect } from "react";
import { useDotbotAnswerStore } from "./lib/dotbotAnswerStore";
import {
  buildAnswerBlocksWrap,
  buildDotbotAnswerTextEl,
  startDotbotAnswerReveal,
} from "./lib/mnemonicSearchMatching";

// Mounts Dotbot's written answer into #search-dotbot-answer — the short text intro (typewriter-
// revealed, same as before) plus, immediately after, the in-depth answer_blocks continuation
// (prose paragraphs + example pills), both built vanilla and appended into the same container —
// see app/dotto/lib/dotbotAnswerStore.ts's own comment for why these two used to be separate
// exported functions and now aren't. Build/append/reveal happen in that exact order because
// typewriterReveal needs the text element already connected to the DOM.
export default function DotbotAnswerPanel() {
  const answer = useDotbotAnswerStore();

  useLayoutEffect(() => {
    const el = document.getElementById("search-dotbot-answer");
    if (!el) return;
    el.innerHTML = "";
    if (!answer) {
      el.style.display = "none";
      return;
    }
    const textEl = buildDotbotAnswerTextEl(answer.text);
    el.appendChild(textEl);
    el.style.display = "block";
    startDotbotAnswerReveal(textEl, answer.text);
    const blocksWrap = buildAnswerBlocksWrap(answer.answerBlocksPanel, answer.answerBlocksLanguage);
    if (blocksWrap) el.appendChild(blocksWrap);
  }, [answer]);

  return null;
}
