// Small, genuinely self-contained (zero imports) text helpers extracted out of
// ai-assistant-suggestions.js (Phase 4.2 of the vanilla->React consolidation, see
// PHASE4_ROADMAP.md). ai-assistant-suggestions.js itself moved to app/dotto/lib/aiAssistantSuggestions.ts
// in its own Phase 4.5 port, at which point this file started setting its own
// window.__escapeHtml/__stripHtml bridges directly (genuinely pure/zero-import, so it can safely
// do so, same convention srs-algorithm.js already established) — the real remaining vanilla
// callers (search-panel-history.js, search-orchestration-selection.js, source-tags-ai.js) now
// import straight from here instead of through ai-assistant-suggestions.js's old re-export. This
// extraction's own value right now is real test coverage (see text-utils.test.ts) for logic that
// had zero coverage before, and a smaller, focused module ready to move wholesale to app/dotto/lib
// once nothing vanilla needs it directly anymore.
//
// isLatinScriptText, defined right alongside these two in the original file, was deliberately
// NOT brought along despite being similarly self-contained in spirit — it reads
// appState.NON_LATIN_SCRIPT_RE. At the time this was written, appState reached here via a real
// `import { appState } from './core-state.js'`, which transitively triggered core-state.js's own
// module-level DOM lookups (e.g. appState.modeToolbar.querySelectorAll(...)) — those throw under
// Vitest's jsdom environment with no real app markup mounted, breaking this whole module's
// importability in tests, including for escapeHtml/stripHtml which don't even touch appState.
// core-state.js's own Phase 4.5 port (app/dotto/lib/coreState.ts) did make its own DOM lookups
// safely deferred (guarded behind ensureCoreState(), not run merely on import/evaluation) — but
// that port also removed the real-import path entirely: every vanilla caller, including
// ai-assistant-suggestions.js, now reaches appState via the window.__getAppState() bridge instead,
// and that bridge is simply never assigned outside the real running app (nothing in a bare
// Vitest/jsdom run loads the actual app/dotto-app.jsx that sets it). isLatinScriptText still can't
// get real unit coverage this way — same practical outcome, different specific mechanism now. A
// real fixture (stubbing window.__getAppState for the test) would be needed to extend proper
// coverage to it.
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

// Sets its own bridges directly — genuinely pure/zero-import, same convention srs-algorithm.js
// already established. Used by app/dotto/lib/outlineTree.ts/app/dotto/lib/srsConnectionsCore.ts
// (window.__stripHtml) and app/dotto/canvasItemBehavior.js's renderStaticTableHTML
// (window.__escapeHtml), plus app/dotto/lib/aiAssistantSuggestions.ts itself, none of which can
// import this directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__escapeHtml = escapeHtml;
window.__stripHtml = stripHtml;
