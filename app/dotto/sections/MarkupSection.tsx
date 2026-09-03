"use client";

// Shared primitive used by every named shell-section component below.
// Renders a chunk of the original Dotto markup verbatim via
// dangerouslySetInnerHTML, so real DOM elements with the original ids/
// classes/inline event handlers exist exactly as they did in Dotto.html.
// This introduces one extra wrapper <div> per section versus the original
// (which had these as direct children of <body>); that's confirmed safe —
// none of the original CSS or script traverses upward from these
// container ids (checked for `body >`, `:nth-child`, `.closest()` /
// `.parentElement` usage against them), so it does not change behavior.
export default function MarkupSection({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
