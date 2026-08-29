// Small, genuinely self-contained (zero imports) text helpers extracted out of
// ai-assistant-suggestions.js (Phase 4.2 of the vanilla->React consolidation, see
// PHASE4_ROADMAP.md). ai-assistant-suggestions.js itself still has real vanilla hub dependents of
// its own, so these can't fully move to app/dotto/lib yet either — that file keeps re-exporting
// both so its own existing callers (games-flashcard-typeright.js, live-presence.js,
// media-pdf-epub.js, search-panel-history.js, search-orchestration-selection.js,
// source-tags-ai.js, stopwatch-search-notifications.js, shared-canvases-outline.js,
// srs-connections-core.js) keep working unchanged. This extraction's own value right now is real
// test coverage (see text-utils.test.ts) for logic that had zero coverage before, and a smaller,
// focused module ready to move wholesale to app/dotto/lib once nothing vanilla needs it directly
// anymore.
//
// isLatinScriptText, defined right alongside these two in the original file, was deliberately
// NOT brought along despite being similarly self-contained in spirit — it reads
// appState.NON_LATIN_SCRIPT_RE, and importing appState from core-state.js turned out to
// transitively trigger core-state.js's own module-level DOM lookups (e.g.
// appState.modeToolbar.querySelectorAll(...)), which throw under Vitest's jsdom environment with
// no real app markup mounted — breaking this whole module's importability in tests, including for
// escapeHtml/stripHtml which don't even touch appState. Left in ai-assistant-suggestions.js for
// now, unmoved and untested via this extraction; a real fixture (or core-state.js becoming less
// side-effect-heavy on import, likely as part of Phase 4.5's own core-state.js work) would be
// needed to extend proper unit coverage to it.
//
// truncateCenter, also defined alongside these in the original file, was NOT brought along either
// — it turned out to have zero callers anywhere in the codebase (confirmed via a full grep), so
// extracting it would just be moving dead code. Left in place in ai-assistant-suggestions.js for
// now; worth a real deletion pass later, not bundled into this extraction.

function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').trim();
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { escapeHtml, stripHtml };
