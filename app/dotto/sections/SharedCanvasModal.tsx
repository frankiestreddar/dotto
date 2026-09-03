"use client";

import MarkupSection from "./MarkupSection";

// Shell markup for "canvas-modal", migrated verbatim from Dotto.html.
// See content/fragments/canvas-modal.html for the source HTML.
export default function SharedCanvasModal({ html }: { html: string }) {
  return <MarkupSection html={html} />;
}
