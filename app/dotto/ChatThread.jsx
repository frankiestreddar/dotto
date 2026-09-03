"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { chatThreadStore } from "./bridges";
import usePortalNode from "./usePortalNode";
import { updateChatThread } from "./lib/aiAssistantSuggestions";
import {
  buildAnswerBlocksWrap,
  buildDictionaryCard,
  buildDotbotAnswerTextEl,
  buildExamplesCard,
  buildRecommendedSearchesRows,
  buildTranslationCard,
  startSequencedTurnReveal,
  stripInlineMarkers,
} from "./lib/mnemonicSearchMatching";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh array literal as the getServerSnapshot fallback trips React's "should be cached" warning
// (a new [] every render never === the previous one, so useSyncExternalStore treats it as an
// unstable snapshot and loops).
const EMPTY_TURNS = [];

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
// (chatThreadStore/__appendChatTurn, app/dotto/lib/searchOrchestrationSelection.ts), never for turns restored
// from history (chatThreadStore/__setChatThread, the sidebar reopen flow), which render with
// `fresh` false/omitted so they show fully settled immediately instead of re-typewriter-ing text
// that was already delivered in a past session.
function ChatTurn({ turn }) {
  const assistantRef = useRef(null);

  useLayoutEffect(() => {
    const el = assistantRef.current;
    if (!el) return;
    // Guards against duplicated content if this effect ever runs more than once against the same
    // DOM node — the concrete case being React StrictMode's dev-only mount->cleanup->mount effect
    // double-invocation, which reuses the same underlying element across both mounts. Without this,
    // the second run would append a full second copy of every panel on top of the first (exactly
    // what showed up as a "doubled up response" — the whole answer, translation, dictionary, and
    // example cards each appearing twice). Matches the same defensive `el.innerHTML = ""` every
    // single-owner panel component (DotbotAnswerPanel.jsx and friends) already does at the top of
    // its own effect, for the same reason. Any in-flight typewriter reveal from a first run whose
    // textEl gets cleared out here stops itself on its own very next tick — typewriterReveal
    // already checks `el.isConnected` before continuing.
    el.innerHTML = "";
    const panels = turn.panels || [];
    const textPanel = panels.find((p) => p.type === "dotbot_text");
    const dictPanel = panels.find((p) => p.type === "dictionary") || null;
    const examplesPanel = panels.find((p) => p.type === "examples") || null;
    const translationPanel = panels.find((p) => p.type === "translation") || null;
    const recommendedPanel = panels.find((p) => p.type === "recommended_searches") || null;
    const answerBlocksPanel = panels.find((p) => p.type === "answer_blocks") || null;
    // Same lookup renderOrchestrateResult (app/dotto/lib/searchOrchestrationSelection.ts) already does for
    // the answer_blocks continuation's example pills' own TTS language.
    const answerLanguage =
      (dictPanel && dictPanel.entries && dictPanel.entries[0] && dictPanel.entries[0].language) ||
      (examplesPanel && examplesPanel.language) ||
      "";

    if (turn.fresh) {
      // Simulated top-to-bottom sequenced reveal: answer text types out with any
      // {{dictionary:N}}/{{example:N}}/{{translation}} marker resolving to an inline widget after a
      // brief placeholder pulse, then answerBlocks/remaining cards/recommended-searches stagger in
      // — see startSequencedTurnReveal (app/dotto/lib/mnemonicSearchMatching.ts). Only ever runs
      // for a turn that was just live-appended, never for history restored from the sidebar (see
      // this function's own comment above on why `fresh` is safe to read once, on mount).
      startSequencedTurnReveal(el, panels, updateChatThread);
    } else {
      // History-restored turn: every panel already exists, so it renders in its final settled
      // state immediately — no typewriter, no placeholder pulse, no stagger. Exactly what this
      // effect always did before the sequenced reveal existed.
      if (textPanel && textPanel.text) {
        // Strip any {{dictionary:N}}/{{example:N}}/{{translation}} marker that made it into the
        // stored text — this static branch never resolves markers into widgets (only
        // startSequencedTurnReveal does), so a raw marker left in would show as literal syntax.
        const cleanText = stripInlineMarkers(textPanel.text);
        const textEl = buildDotbotAnswerTextEl(cleanText);
        el.appendChild(textEl);
        textEl.textContent = cleanText;
        const blocksWrap = buildAnswerBlocksWrap(answerBlocksPanel, answerLanguage);
        if (blocksWrap) el.appendChild(blocksWrap);
      }
      if (translationPanel && translationPanel.sourceWord && translationPanel.targetWord) {
        el.appendChild(buildTranslationCard(translationPanel));
      }
      if (dictPanel && dictPanel.entries && dictPanel.entries.length) {
        el.appendChild(buildDictionaryCard(dictPanel));
      }
      if (examplesPanel) {
        el.appendChild(buildExamplesCard(examplesPanel));
      }
      if (recommendedPanel && recommendedPanel.queries && recommendedPanel.queries.length) {
        el.appendChild(buildRecommendedSearchesRows(recommendedPanel));
      }
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
// identity, keyed by turn.id) like CommandPalette.jsx, not a single-owner side-effect component
// like DotbotAnswerPanel.jsx and friends, which this retires for AI content.
export default function ChatThread() {
  const turns = useSyncExternalStore(
    chatThreadStore.subscribe,
    chatThreadStore.getSnapshot,
    () => EMPTY_TURNS,
  );
  const portalNode = usePortalNode("search-chat-thread");

  if (!portalNode) return null;

  // DOM order is newest-turn-first (reversed from chatThreadStore's chronological-ascending
  // order) — paired with #search-chat-thread's flex-direction:column-reverse (globals.css),
  // that's what pins the view to the bottom (newest turn) and pushes older ones upward as they
  // arrive, same technique MsgConvo.jsx already uses for the Messages panel. Reversed here in
  // render only — chatThreadStore itself, and every other reader of it (openSavedChat's
  // turn-building, etc.), still keeps plain chronological order; keying by turn.id means
  // reordering existing turns on screen moves their DOM nodes rather than remounting them, so an
  // in-progress reveal on an older turn is unaffected by a new turn being appended above/below it.
  return createPortal(
    turns
      .slice()
      .reverse()
      .map((turn) => <ChatTurn key={turn.id} turn={turn} />),
    portalNode,
  );
}
