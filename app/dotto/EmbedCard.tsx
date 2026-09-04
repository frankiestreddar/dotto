"use client";

import { editEmbed, shortUrl, toEmbeddableUrl } from "./lib/cardsMisc";
import type { Item } from "./lib/messagingCanvasPreview";

// First card kind converted to a real Component (canvas-items-react plan, PHASE2_ROADMAP.md) —
// see CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS. Ported from the old renderEmbedHTML
// (public/dotto/cards-misc.js, now app/dotto/lib/cardsMisc.ts) with the same behavior, just as
// JSX instead of a template string. editEmbed is called from other places too (renderChecklistHTML
// has no relation to this, but the same file also backs a real inline onclick target elsewhere),
// so it stays a real export here rather than being inlined.
export default function EmbedCard({ it }: { it: Item }) {
  if (!it.embedUrl) {
    return (
      <div
        className="embed-empty"
        onClick={(e) => {
          e.stopPropagation();
          editEmbed(it.id);
        }}
      >
        <div className="embed-icon">🌐</div>
        <div className="embed-title">New Embed</div>
        <div className="embed-hint">Click to add a website or code embed link</div>
      </div>
    );
  }

  return (
    <>
      {/* Dedicated drag handle, separate from the iframe below it — a cross-origin iframe is its
          own browsing context and never dispatches pointerdown (or any DOM event) to the parent
          page for interactions inside it, a hard browser security boundary. Without a handle
          outside the iframe, a filled embed card would have no draggable surface at all once a
          URL is set. */}
      <div className="embed-header">
        <span className="embed-header-url">{shortUrl(it.embedUrl)}</span>
        <div
          className="embed-edit"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            editEmbed(it.id);
          }}
          title="Edit embed link"
        >
          ✎
        </div>
      </div>
      {/* sandbox is permissive enough for common embeds (allow-scripts + allow-same-origin
          together is what most real embed widgets need) rather than maximally locked down — this
          is showing the user's own chosen URL, not arbitrary untrusted content. referrerPolicy is
          deliberately not "no-referrer" — YouTube's player needs the referrer (alongside the
          origin param toEmbeddableUrl's withYoutubeOrigin sets) to pass its own embedding-origin
          check, or it throws "Error 153" instead of loading. */}
      <iframe
        className="embed-frame"
        src={toEmbeddableUrl(it.embedUrl)}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </>
  );
}
