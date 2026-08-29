"use client";

import {
  addGameColumnSlot,
  cellContentType,
  colHasAnyCloze,
  normalizeGameSlot,
  removeGameColumnSlot,
  setGameColumnSlot,
} from "./lib/gamesFlashcardTyperight";

// Ported from the old renderGameOptionsHTML — a separate, still-string-building copy of that
// function now lives internally in app/dotto/lib/gamesFlashcardTyperight.ts (Phase 4.4), kept
// there rather than deleted: renderFlashcardHTML/renderTypeRightHTML in that same file still
// depend on it for live-presence.js's mini previews, which build a real HTML string rather than
// mounting this component (see PHASE2_ROADMAP.md's Game options/cloze entry). Shared by
// FlashcardCard.jsx and TypeRightCard.jsx, same as the vanilla version was shared by both kinds'
// own render functions.
//
// cellContentType/colHasAnyCloze/normalizeGameSlot/setGameColumnSlot/addGameColumnSlot/
// removeGameColumnSlot are real ES imports now that both this component and their real
// implementation (app/dotto/lib/gamesFlashcardTyperight.ts) live in the same app/dotto/ tree — the
// window.__cellContentType/etc bridges these previously went through (cards-misc.js established
// the pattern) still exist too, only because still-vanilla callers elsewhere need them.
function optionsForSlot(it, colCount, headers, slot) {
  const options = [];
  for (let i = 0; i < colCount; i++) {
    const name = headers[i] || `Column ${i + 1}`;
    options.push(
      <option key={i} value={String(i)}>
        {name}
      </option>,
    );
    if (colHasAnyCloze(it, i)) {
      options.push(
        <optgroup key={i + "-cloze"} label={`${name} — cloze`}>
          <option value={`${i}:blank`}>Blank</option>
          <option value={`${i}:extract`}>[...]</option>
        </optgroup>,
      );
    }
  }
  return options;
}

function GameOptionsSide({ it, label, side, slots, colCount, headers, sampleRow }) {
  return (
    <div className="game-options-side">
      <div className="game-options-side-label">{label}</div>
      {slots.map((slot, slotIndex) => {
        const cellHtml = ((sampleRow && sampleRow.cells) || [])[slot.col] || "";
        const type = sampleRow ? cellContentType(cellHtml) : "text";
        const glyph =
          type === "image" ? "🖼" : type === "audio" ? "🔊" : slot.mode !== "plain" ? "[…]" : "Aa";
        const selectValue = slot.mode === "plain" ? String(slot.col) : `${slot.col}:${slot.mode}`;
        return (
          <div
            className="game-options-slot"
            key={slotIndex}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <select
              className="game-options-select"
              value={selectValue}
              onChange={(e) => setGameColumnSlot(it.id, side, slotIndex, e.target.value)}
            >
              {optionsForSlot(it, colCount, headers, slot)}
            </select>
            <span className="game-options-col-glyph" title={type}>
              {glyph}
            </span>
            {slots.length > 1 && (
              <button
                type="button"
                className="game-options-remove-slot"
                onClick={() => removeGameColumnSlot(it.id, side, slotIndex)}
                title="Remove"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="game-options-add-slot"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => addGameColumnSlot(it.id, side)}
      >
        + Add column
      </button>
    </div>
  );
}

export default function GameOptionsPanel({ it }) {
  const headers = it.gameHeaders || [];
  const sampleRow = it.cards && it.cards[0];
  const colCount = headers.length || (sampleRow && sampleRow.cells ? sampleRow.cells.length : 0);

  if (!colCount) {
    return (
      <>
        <div className="game-options-head">Options</div>
        <div className="game-options-empty">Connect a source to configure front/back columns.</div>
      </>
    );
  }

  const cfg = it.gameConfig || {};
  const frontCols = (
    cfg.frontCols && cfg.frontCols.length ? cfg.frontCols : [{ col: 0, mode: "plain" }]
  ).map(normalizeGameSlot);
  const backCols = (
    cfg.backCols && cfg.backCols.length
      ? cfg.backCols
      : [{ col: colCount > 1 ? 1 : 0, mode: "plain" }]
  ).map(normalizeGameSlot);

  return (
    <>
      <div className="game-options-head">Options</div>
      <div className="game-options-body">
        <GameOptionsSide
          it={it}
          label="Front"
          side="front"
          slots={frontCols}
          colCount={colCount}
          headers={headers}
          sampleRow={sampleRow}
        />
        <GameOptionsSide
          it={it}
          label="Back"
          side="back"
          slots={backCols}
          colCount={colCount}
          headers={headers}
          sampleRow={sampleRow}
        />
      </div>
    </>
  );
}
