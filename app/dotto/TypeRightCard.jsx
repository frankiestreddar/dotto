"use client";

import { useLayoutEffect, useRef } from "react";
import GameOptionsPanel from "./GameOptionsPanel";

// Ported from the old renderTypeRightHTML (public/dotto/games-flashcard-typeright.js — kept there,
// not deleted: live-presence.js's mini previews still call it). See FlashcardCard.jsx for the
// general pattern (game logic/SM-2 stays vanilla, reached via window bridges;
// window.__setupResizing owns the resize handle from this component's own layout effect, safe to
// call on every render() call — no dependency array, matching every converted kind — because of
// the AbortController fix that PR made).
//
// The answer input is a real controlled value (value={it.trInput}), unlike Checklist's date field
// — trNext/trToggleMode reset it to '' and DO call render(), so a fresh render needs to actually
// show that reset; an uncontrolled defaultValue would only apply once, on first mount, and never
// clear on the same persistent input node. Typing itself never calls render() (trUpdateInput only
// schedules an autosave, to avoid a render mid-keystroke) — safe either way, per the same "mutate
// in place, next real render reads current data" reasoning as the rest of this migration.
export default function TypeRightCard({ it }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (ref.current) window.__setupResizing(ref.current, it);
  });

  if (!it.cards || !it.cards.length) {
    return (
      <>
        <div className="item-face">
          <div className="tr-top" onMouseDown={(e) => e.stopPropagation()}>
            <div className="tr-title">Typeright</div>
          </div>
          <div className="tr-empty">Connect a source to play.</div>
        </div>
        <div className="item-options">
          <GameOptionsPanel it={it} />
        </div>
      </>
    );
  }

  const playable = window.__trPlayableCards(it);
  if (!playable.length) {
    return (
      <>
        <div className="item-face">
          <div className="tr-top" onMouseDown={(e) => e.stopPropagation()}>
            <div className="tr-title">Typeright</div>
          </div>
          <div className="tr-empty">No playable entries — the answer side must be text.</div>
        </div>
        <div className="item-options">
          <GameOptionsPanel it={it} />
        </div>
      </>
    );
  }

  const card = window.__trCurrentCard(it, playable);
  const promptHTML = card ? window.__renderGameFaceBlocksHTML(window.__resolveGameFace(it, card, "front")) : "";
  const total = it.trOrder.length;
  const pos = total ? it.trIndex + 1 : 0;
  const checked = !!it.trChecked;
  const correctAnswer = card ? window.__resolveGameFace(it, card, "back").map((b) => b.text).join(" ") : "";
  const grade = checked ? it.trLastGrade : null;
  const inputClassName = "tr-input" + (grade ? ` tr-input-${grade}` : "");

  return (
    <>
      <div className="item-face" ref={ref} onMouseEnter={() => window.trFocusInput(it.id)}>
        <div className="tr-top" onMouseDown={(e) => e.stopPropagation()}>
          <div className="tr-title">Typeright</div>
          <div className="fc-top-right">
            <button type="button" className="fc-mode-btn" onClick={() => window.trToggleMode(it.id)} title="Toggle shuffle / ordered">
              {it.trMode === "shuffle" ? "Shuffle ON" : "Shuffle OFF"}
            </button>
            <div className="fc-progress">
              {pos}/{total}
            </div>
          </div>
        </div>
        <div className="tr-prompt" onMouseDown={(e) => e.stopPropagation()} dangerouslySetInnerHTML={{ __html: promptHTML || "(empty)" }} />
        <div className="tr-answer-row" onMouseDown={(e) => e.stopPropagation()}>
          <input
            type="text"
            className={inputClassName}
            placeholder="Type the answer…"
            value={it.trInput || ""}
            onChange={(e) => window.trUpdateInput(it.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (checked) window.trNext(it.id);
                else window.trCheck(it.id);
              }
            }}
            onFocus={() => window.broadcastEditingState(true, `#item-${it.id} .tr-input`)}
            onBlur={() => window.broadcastEditingState(false)}
            disabled={checked}
          />
          {checked ? (
            <button type="button" className="tr-next-btn" onClick={() => window.trNext(it.id)}>
              Next
            </button>
          ) : (
            <button type="button" className="tr-check-btn" onClick={() => window.trCheck(it.id)}>
              Check
            </button>
          )}
        </div>
        {checked && grade !== "correct" && <div className="tr-answer-reveal">Answer: {correctAnswer}</div>}
        <div className="resize">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
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
