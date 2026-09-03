"use client";

import MarkupSection from "./MarkupSection";

// Shell markup for "zoom-control", migrated verbatim from Dotto.html.
// See content/fragments/zoom-control.html for the source HTML.
export default function ZoomControl({ html }: { html: string }) {
  return <MarkupSection html={html} />;
}
