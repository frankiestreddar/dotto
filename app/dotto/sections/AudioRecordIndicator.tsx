"use client";

import MarkupSection from "./MarkupSection";

// Shell markup for "audio-record-indicator", migrated verbatim from Dotto.html.
// See content/fragments/audio-record-indicator.html for the source HTML.
export default function AudioRecordIndicator({ html }: { html: string }) {
  return <MarkupSection html={html} />;
}
