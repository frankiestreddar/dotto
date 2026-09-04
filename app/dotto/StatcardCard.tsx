"use client";

import type { Item } from "./lib/messagingCanvasPreview";

// Ported from the old renderStatcardHTML (public/dotto/cards-misc.js, now
// app/dotto/lib/cardsMisc.ts — kept there, not inlined here: app/dotto/lib/messagingCanvasPreview.ts's
// mini inline-canvas previews still call it directly for their own simplified rendering, same as
// ChecklistCard's note). See EmbedCard.jsx for the general pattern. The
// simplest conversion yet — a pure function of `it`, no event handlers, no appState coupling, no
// vanilla bridge needed at all.
export default function StatcardCard({ it }: { it: Item }) {
  const label =
    it.statKind === "progress"
      ? "Progress"
      : it.statKind
        ? it.statKind[0].toUpperCase() + it.statKind.slice(1)
        : "Stat";
  const payloads = Object.values(it.streamCache || {});
  let value = "—";
  let caption = "Link a game, stopwatch, or shelf card to see stats.";

  if (it.statKind === "progress" && payloads.length) {
    const seen = payloads.reduce((sum, p) => sum + (p.delta?.seen || 0), 0);
    value = String(seen);
    caption = "Cards Seen";
  } else if (it.statKind === "accuracy" && payloads.length) {
    let right = 0;
    let wrong = 0;
    payloads.forEach((p) => {
      const r = p.delta?.ratings || {};
      right += (r.hard || 0) + (r.easy || 0);
      wrong += (r.noclue || 0) + (r.wrong || 0);
    });
    value = `${right} / ${wrong}`;
    caption = "Right / Wrong";
  }

  return (
    <>
      <div className="statcard-header">{label}</div>
      <div className="statcard-value">{value}</div>
      <div className="statcard-caption">{caption}</div>
    </>
  );
}
