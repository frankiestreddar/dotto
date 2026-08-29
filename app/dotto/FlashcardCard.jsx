"use client";

import { useLayoutEffect, useRef } from "react";
import { setupResizing } from "./canvasItemBehavior";
import GameOptionsPanel from "./GameOptionsPanel";

// Ported from the old renderFlashcardHTML (public/dotto/games-flashcard-typeright.js — kept there,
// not deleted: fcFlip/fcRate/fcToggleMode/fcPlayableCards/etc. are real game logic + SM-2 scoring,
// not rendering, and stay vanilla regardless). fcFlip/fcRate/fcToggleMode were already
// window-bridged for the original inline onclick attributes; fcCurrentRow/fcPlayableCards/
// resolveGameFace/renderGameFaceBlocksHTML got new bridges (see that file's own comment) since
// this component calls them directly, not just its GameOptionsPanel.
//
// setupResizing (canvasItemBehavior.js) still owns the resize handle — called directly here via a
// layout effect, same as attachWatermarkBody/attachUniversalItemBehavior; it's idempotent
// (AbortController fix) specifically so calling it on every render() call here — this effect has
// no dependency array, matching every other converted kind — doesn't stack duplicate pointerdown
// listeners on the persistent .resize handle.
//
// fcFlip deliberately does NOT go through this component's own re-render to animate the flip — it
// directly toggles the .fc-card/.fc-flip-btn/.fc-rate-row DOM (see its own comment) rather than
// calling render(), a holdover from when that was the only way to avoid a full innerHTML rebuild
// interrupting the CSS flip transition. Left as-is rather than "simplified" to rely on React's own
// diffing instead — it still works correctly (mutate it.fcFlipped in place, any later real render
// reads the current value, same reasoning as the rest of this migration), and changing it isn't
// this PR's job.
export default function FlashcardCard({ it }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (ref.current) setupResizing(ref.current, it);
  });

  const title = "Flashcards";

  if (!it.cards || !it.cards.length) {
    return (
      <>
        <div className="item-face">
          <div className="fc-top" onMouseDown={(e) => e.stopPropagation()}>
            <div className="fc-title">{title}</div>
          </div>
          <div className="fc-empty">No cards yet.</div>
        </div>
        <div className="item-options">
          <GameOptionsPanel it={it} />
        </div>
      </>
    );
  }

  const playable = window.__fcPlayableCards(it);
  if (!playable.length) {
    return (
      <>
        <div className="item-face">
          <div className="fc-top" onMouseDown={(e) => e.stopPropagation()}>
            <div className="fc-title">{title}</div>
          </div>
          <div className="fc-empty">No playable entries — check the Cloze columns in Options.</div>
        </div>
        <div className="item-options">
          <GameOptionsPanel it={it} />
        </div>
      </>
    );
  }

  const row = window.__fcCurrentRow(it, playable);
  const front = row
    ? window.__renderGameFaceBlocksHTML(window.__resolveGameFace(it, row, "front"))
    : "(no data rows)";
  const back = row
    ? window.__renderGameFaceBlocksHTML(window.__resolveGameFace(it, row, "back"))
    : "";
  const total = it.fcOrder.length;
  const pos = total ? it.fcIndex + 1 : 0;

  return (
    <>
      <div className="item-face" ref={ref}>
        <div className="fc-top" onMouseDown={(e) => e.stopPropagation()}>
          <div className="fc-title">{title}</div>
          <div className="fc-top-right">
            <button
              type="button"
              className="fc-mode-btn"
              onClick={() => window.fcToggleMode(it.id)}
              title="Toggle shuffle / ordered"
            >
              {it.fcMode === "shuffle" ? "Shuffle ON" : "Shuffle OFF"}
            </button>
            <div className="fc-progress">
              {pos}/{total}
            </div>
          </div>
        </div>
        <div
          className={"fc-card" + (it.fcFlipped ? " flipped" : "")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => window.fcFlip(it.id)}
        >
          <div
            className="fc-face fc-front"
            dangerouslySetInnerHTML={{ __html: front || "(empty)" }}
          />
          <div
            className="fc-face fc-back"
            dangerouslySetInnerHTML={{ __html: back || "(empty)" }}
          />
        </div>
        <div className="fc-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="fc-flip-btn"
            style={{ display: it.fcFlipped ? "none" : "flex" }}
            onClick={() => window.fcFlip(it.id)}
          >
            Flip
          </button>
          <div className="fc-rate-row" style={{ display: it.fcFlipped ? "flex" : "none" }}>
            <button
              type="button"
              className="fc-rate-btn fc-rate-noclue"
              onClick={() => window.fcRate(it.id, "noclue")}
            >
              Not a clue
            </button>
            <button
              type="button"
              className="fc-rate-btn fc-rate-wrong"
              onClick={() => window.fcRate(it.id, "wrong")}
            >
              Got it wrong
            </button>
            <button
              type="button"
              className="fc-rate-btn fc-rate-hard"
              onClick={() => window.fcRate(it.id, "hard")}
            >
              Had to think
            </button>
            <button
              type="button"
              className="fc-rate-btn fc-rate-easy"
              onClick={() => window.fcRate(it.id, "easy")}
            >
              Easy
            </button>
          </div>
        </div>
        <div className="resize">
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M10 2L2 10M10 6L6 10M10 10L10 10" />
          </svg>
        </div>
      </div>
      <div className="item-options">
        <GameOptionsPanel it={it} />
      </div>
    </>
  );
}
