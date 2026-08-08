"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { dotbotAnswerStore } from "./bridges";

// Mounts Dotbot's written answer into #search-dotbot-answer — the short text intro (typewriter-
// revealed, same as before) plus, immediately after, the in-depth answer_blocks continuation
// (prose paragraphs + example pills), both built vanilla and appended into the same container —
// see dotbotAnswerStore's own comment in bridges.js for why these two used to be separate
// exported functions and now aren't. Build/append/reveal happen in that exact order because
// typewriterReveal needs the text element already connected to the DOM.
export default function DotbotAnswerPanel() {
  const answer = useSyncExternalStore(dotbotAnswerStore.subscribe, dotbotAnswerStore.getSnapshot, () => null);

  useLayoutEffect(() => {
    const el = document.getElementById("search-dotbot-answer");
    if (!el) return;
    el.innerHTML = "";
    if (!answer) {
      el.style.display = "none";
      return;
    }
    const textEl = window.__buildDotbotAnswerTextEl(answer.text);
    el.appendChild(textEl);
    el.style.display = "block";
    window.__startDotbotAnswerReveal(textEl, answer.text);
    const blocksWrap = window.__buildAnswerBlocksWrap(answer.answerBlocksPanel, answer.answerBlocksLanguage);
    if (blocksWrap) el.appendChild(blocksWrap);
  }, [answer]);

  return null;
}
