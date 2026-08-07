"use client";

// Ported from the old inline sentence branch in renderLegacyCardBody (public/dotto/waypoints-
// render-loop.js). Dropped from a Dotbot example-sentence drag — a dedicated read-only card, not a
// note: big target-script text, small transliteration underneath only when the AI supplied one
// (i.e. the script isn't Latin-based), translation below. No contentEditable/onblur wiring, no
// vanilla bridge needed at all — a pure function of `it`, same as StatcardCard.
export default function SentenceCard({ it }) {
  return (
    <>
      <div className="sentence-card-text">{it.text || ""}</div>
      {it.translit && <div className="sentence-card-translit">{it.translit}</div>}
      {it.translation && <div className="sentence-card-translation">{it.translation}</div>}
    </>
  );
}
