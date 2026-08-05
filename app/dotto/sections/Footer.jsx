"use client";

import MarkupSection from "./MarkupSection";

// Shell markup for "footer" — small bottom-left version/link text, added directly as a new
// fragment (no equivalent existed in the original Dotto.html) rather than inline JSX, to match
// how every other piece of persistent screen chrome (zoom-control, bottom-toolbars, etc.) is
// already structured: markup fragment + thin section component.
export default function Footer({ html }) {
  return <MarkupSection html={html} />;
}
