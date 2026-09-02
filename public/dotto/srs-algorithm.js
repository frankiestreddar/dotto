// SM-2 spaced-repetition algorithm — extracted out of srs-connections-core.js (Phase 4.2 of the
// vanilla->React consolidation, see PHASE4_ROADMAP.md). Genuinely pure (no imports, no appState/
// DOM touch) — none of the three functions here have a real vanilla caller left as of
// srs-connections-core.js's own Phase 4.5 port to app/dotto/lib/srsConnectionsCore.ts (which
// reaches these the same way every other TS file does, via the window.__calculateSM2/
// __defaultSrsState/__diffRatings bridges set directly below), same as
// app/dotto/lib/gamesFlashcardTyperight.ts's fcRate/trCheck (calculateSM2/defaultSrsState) and
// app/dotto/lib/stopwatch.ts's swToggleRun (diffRatings). Simply hasn't been moved to
// app/dotto/lib itself yet — low priority given real test coverage (srs-algorithm.test.ts)
// already exists regardless of which side of the vanilla/React line this lives on.

// ---------- SM-2 Spaced Repetition ----------
// Per-row memory state lives on the table itself (table.srsMeta[rowIndex]), keyed by the row's
// position in tableData — never on the flashcard/statcard/shelf that merely displays it, so the
// schedule survives deleting and recreating any downstream card.
function defaultSrsState() {
    return { interval: 1, easeFactor: 2.5, dueDate: Date.now(), repetitions: 0 };
}

// Maps our four grading buttons onto the classic SM-2 0-5 quality scale.
// Classic SM-2: given a card's current {interval, easeFactor, repetitions} and a 0-5 quality
// score, returns the updated memory state (mutates and returns `card`).
function calculateSM2(card, quality) {
    if (quality < 3) {
        // Incorrect answers reset repetition streak and interval
        card.repetitions = 0;
        card.interval = 1;
    } else {
        // Correct answers advance the streak and interval
        if (card.repetitions === 0) {
            card.interval = 1;
        } else if (card.repetitions === 1) {
            card.interval = 6;
        } else {
            card.interval = Math.round(card.interval * card.easeFactor);
        }
        card.repetitions++;
    }
    // Adjust the Ease Factor based on SM-2 formula
    card.easeFactor = card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (card.easeFactor < 1.3) card.easeFactor = 1.3; // Cap it so it doesn't break
    // Calculate next due date timestamp
    card.dueDate = Date.now() + card.interval * 24 * 60 * 60 * 1000;
    return card;
}

// Per-rating difference between two cumulative `ratings` tallies (e.g. a flashcard's lifetime
// counts) — used to turn a session's live/baseline snapshot into a session-scoped delta, the same
// way `seen` counts are diffed.
function diffRatings(live, base) {
    const keys = ['noclue', 'wrong', 'hard', 'easy'];
    const out = {};
    keys.forEach(k => { out[k] = ((live && live[k]) || 0) - ((base && base[k]) || 0); });
    return out;
}

export { calculateSM2, defaultSrsState, diffRatings };

// Set directly here (rather than re-exported from srs-connections-core.js, which is gone as of
// its own Phase 4.5 port to app/dotto/lib/srsConnectionsCore.ts) since this file is genuinely
// pure/zero-import and can safely set its own bridges. Used by
// app/dotto/lib/gamesFlashcardTyperight.ts's fcRate/trCheck (calculateSM2/defaultSrsState),
// app/dotto/lib/stopwatch.ts's swToggleRun (diffRatings), and
// app/dotto/lib/srsConnectionsCore.ts's own ensureSrsMeta/getSrsForRow (defaultSrsState).
window.__calculateSM2 = calculateSM2;
window.__defaultSrsState = defaultSrsState;
window.__diffRatings = diffRatings;
