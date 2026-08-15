"use client";

import MarkupSection from "./MarkupSection";

// Shell markup for "search-overlay" — the centered command-palette overlay, split out of
// top-bar.html so it can be a top-level fixed overlay instead of a top-bar grid cell.
// See content/fragments/search-overlay.html for the source HTML.
export default function SearchOverlay({ html }) {
  return <MarkupSection html={html} />;
}
