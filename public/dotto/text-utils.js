// Small, genuinely self-contained (zero imports) text helpers extracted out of
// ai-assistant-suggestions.js (Phase 4.2 of the vanilla->React consolidation, see
// PHASE4_ROADMAP.md), themselves ported to app/dotto/lib/textUtils.ts (Phase 4.1 cluster revisit)
// once every app/dotto/ caller could reach them via a real import instead of a bridge. This file
// stays in place only for its 2 remaining real vanilla-to-vanilla ES-import callers
// (search-panel-history.js, search-orchestration-selection.js) — deleted once those two are ported
// too, at which point app/dotto/lib/textUtils.ts becomes the sole copy.
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

// No window.__escapeHtml/__stripHtml bridges anymore — this file's own logic was ported to
// app/dotto/lib/textUtils.ts (Phase 4.1 cluster revisit), and every app/dotto/ caller that used to
// reach these two through the bridge now imports the real copy there directly instead. This file
// stays in place only because search-panel-history.js/search-orchestration-selection.js (still
// vanilla) import it directly (vanilla-to-vanilla ES import, not a bridge) — deleted once those
// two are ported too.
