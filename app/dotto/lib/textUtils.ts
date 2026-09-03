// Small, genuinely self-contained (zero imports) text helpers extracted out of
// ai-assistant-suggestions.js (Phase 4.2 of the vanilla->React consolidation, see
// PHASE4_ROADMAP.md), ported here from public/dotto/text-utils.js as file #8 of the 11-file
// command/search cluster (Phase 4.1 revisit). public/dotto/text-utils.js itself stays in place
// for now — search-orchestration-selection.js (file #11, still vanilla) imports straight from it
// via a real ES import, not a bridge — and gets deleted once that file is ported too, at which
// point this becomes the sole copy.
//
// isLatinScriptText, defined right alongside these two in the original file, was deliberately NOT
// brought along despite being similarly self-contained in spirit — it reads
// appState.NON_LATIN_SCRIPT_RE via window.__getAppState(), which is never assigned outside the
// real running app (nothing in a bare Vitest/jsdom run loads the actual app/dotto-app.jsx that
// sets it), so it can't get the same real unit coverage escapeHtml/stripHtml get here.
//
// truncateCenter, also defined alongside these in the original file, was NOT brought along either
// — it turned out to have zero callers anywhere in the codebase (confirmed via a full grep), so
// extracting it would just be moving dead code. Left in place in ai-assistant-suggestions.js for
// now; worth a real deletion pass later, not bundled into this extraction.

export function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || "").trim();
}

export function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
