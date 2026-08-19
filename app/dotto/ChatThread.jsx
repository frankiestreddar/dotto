"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { chatThreadStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// One turn = the user's own query (rendered here for the first time ever — previously the input's
// value was just cleared after sending, never shown as a message anywhere) + that turn's assistant
// panels, built into its own DOM subtree using the SAME vanilla builder functions the six now-
// inert single-owner panel components (DotbotAnswerPanel.jsx and friends) already used — see each
// of their own files for why every builder stays vanilla (small self-contained widgets with their
// own internal cycling/drag/TTS state, not worth rewriting as JSX). Visual order mirrors the old
// fixed #search-dotbot-answer/#search-translation/#search-dictionary/#search-examples/
// #search-recommended stack (search-overlay.html): a written answer leads, matching
// renderOrchestrateResult's own comment on why dotbot_text always renders first regardless of the
// API panels array's own order.
//
// The effect runs ONCE per mounted instance (empty deps): each turn's `id` is a stable React key
// (see ChatThread below), so a genuinely NEW turn mounts a NEW ChatTurn instance and this fires
// exactly once for it, while an ALREADY-mounted turn re-rendering for an unrelated reason (e.g. a
// sibling turn being appended right after it) does NOT remount this one or refire its effect.
// That's what makes `turn.fresh` safe to read only once, on mount, rather than needing its own
// "already consumed" guard — it's only ever true for the turn that was just live-appended
// (chatThreadStore/__appendChatTurn, search-orchestration-selection.js), never for turns restored
// from history (chatThreadStore/__setChatThread, the sidebar reopen flow), which render with
// `fresh` false/omitted so they show fully settled immediately instead of re-typewriter-ing text
// that was already delivered in a past session.
function ChatTurn({ turn }) {
  const assistantRef = useRef(null);

  useLayoutEffect(() => {
    const el = assistantRef.current;
    if (!el) return;
    const panels = turn.panels || [];
    const textPanel = panels.find((p) => p.type === "dotbot_text");
    const dictPanel = panels.find((p) => p.type === "dictionary") || null;
    const examplesPanel = panels.find((p) => p.type === "examples") || null;
    const translationPanel = panels.find((p) => p.type === "translation") || null;
    const recommendedPanel = panels.find((p) => p.type === "recommended_searches") || null;
    const answerBlocksPanel = panels.find((p) => p.type === "answer_blocks") || null;
    // Same lookup renderOrchestrateResult (search-orchestration-selection.js) already does for
    // the answer_blocks continuation's example pills' own TTS language.
    const answerLanguage =
      (dictPanel && dictPanel.entries && dictPanel.entries[0] && dictPanel.entries[0].language) ||
      (examplesPanel && examplesPanel.language) ||
      "";

    if (textPanel && textPanel.text) {
      const textEl = window.__buildDotbotAnswerTextEl(textPanel.text);
      el.appendChild(textEl);
      if (turn.fresh) {
        // Grows #search-chat-thread (via __updateChatThread), not the old #search-dropdown —
        // startDotbotAnswerReveal's onDone defaults to updateSearchDropdown for the now-inert
        // DotbotAnswerPanel.jsx caller, so this has to be passed explicitly.
        window.__startDotbotAnswerReveal(textEl, textPanel.text, window.__updateChatThread);
      } else {
        textEl.textContent = textPanel.text;
      }
      const blocksWrap = window.__buildAnswerBlocksWrap(answerBlocksPanel, answerLanguage);
      if (blocksWrap) el.appendChild(blocksWrap);
    }
    if (translationPanel && translationPanel.sourceWord && translationPanel.targetWord) {
      el.appendChild(window.__buildTranslationCard(translationPanel));
    }
    if (dictPanel && dictPanel.entries && dictPanel.entries.length) {
      el.appendChild(window.__buildDictionaryCard(dictPanel));
    }
    if (examplesPanel) {
      el.appendChild(window.__buildExamplesCard(examplesPanel));
    }
    if (recommendedPanel && recommendedPanel.queries && recommendedPanel.queries.length) {
      el.appendChild(window.__buildRecommendedSearchesRows(recommendedPanel));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-once, see comment above
  }, []);

  return (
    <div className="dotbot-turn">
      <div className="dotbot-turn-user">{turn.query}</div>
      <div className="dotbot-turn-assistant" ref={assistantRef} />
    </div>
  );
}

// Portals into #search-chat-thread (content/fragments/search-overlay.html) — see chatThreadStore's
// own comment in app/dotto/bridges.js for the full architecture. A genuine JSX list (real turn
// identity, keyed by turn.id) like CanvasResultsPanel.jsx/CommandPalette.jsx, not a single-owner
// side-effect component like DotbotAnswerPanel.jsx and friends, which this retires for AI content.
export default function ChatThread() {
  const turns = useSyncExternalStore(chatThreadStore.subscribe, chatThreadStore.getSnapshot, () => []);
  const portalNode = usePortalNode("search-chat-thread");

  if (!portalNode) return null;

  return createPortal(
    turns.map((turn) => <ChatTurn key={turn.id} turn={turn} />),
    portalNode,
  );
}
