"use client";

import MarkupSection from "./MarkupSection";

// Shell markup for "top-bar", migrated verbatim from Dotto.html.
// See content/fragments/top-bar.html for the source HTML.
export default function TopBar({ html }) {
  return <MarkupSection html={html} />;
}
