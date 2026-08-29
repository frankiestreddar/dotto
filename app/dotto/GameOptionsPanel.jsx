"use client";

// Ported from the old renderGameOptionsHTML (public/dotto/games-flashcard-typeright.js — kept
// there, not deleted: renderTypeRightHTML still depends on the string-building version until
// Typeright converts too, see PHASE2_ROADMAP.md's Game options/cloze entry). Shared by
// FlashcardCard.jsx and (once it converts) TypeRightCard.jsx, same as the vanilla version was
// shared by both kinds' own render functions.
//
// cellContentType/colHasAnyCloze/normalizeGameSlot stay vanilla — real parsing/migration logic
// (normalizeGameSlot specifically handles slot formats saved by older, since-removed versions of
// this feature), not boilerplate worth duplicating across the app/public boundary — reached via
// the window.__cellContentType/__colHasAnyCloze/__normalizeGameSlot bridges (cards-misc.js
// established the pattern). setGameColumnSlot/addGameColumnSlot/removeGameColumnSlot were already
// window-bridged for the original inline onclick/onchange attributes.
function optionsForSlot(it, colCount, headers, slot) {
  const options = [];
  for (let i = 0; i < colCount; i++) {
    const name = headers[i] || `Column ${i + 1}`;
    options.push(
      <option key={i} value={String(i)}>
        {name}
      </option>,
    );
    if (window.__colHasAnyCloze(it, i)) {
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
        const type = sampleRow ? window.__cellContentType(cellHtml) : "text";
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
              onChange={(e) => window.setGameColumnSlot(it.id, side, slotIndex, e.target.value)}
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
                onClick={() => window.removeGameColumnSlot(it.id, side, slotIndex)}
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
        onClick={() => window.addGameColumnSlot(it.id, side)}
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
  ).map(window.__normalizeGameSlot);
  const backCols = (
    cfg.backCols && cfg.backCols.length
      ? cfg.backCols
      : [{ col: colCount > 1 ? 1 : 0, mode: "plain" }]
  ).map(window.__normalizeGameSlot);

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
