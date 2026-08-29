// Phase 4.3 split (was part of stopwatch-search-notifications.js, see PHASE4_ROADMAP.md) — the
// "stopwatch" concern: the Stopwatch card's own mini HTML preview (used by live-presence.js's
// inline-canvas previews). swFormatTime/swCurrentElapsedMs/swToggleRun/swTogglePause moved to
// app/dotto/lib/stopwatch.ts in Phase 4.4 (see that file's own comment) — reached here via the
// window.swToggleRun/swTogglePause/__swFormatTime/__swCurrentElapsedMs bridges it sets, same
// global names as before the port so this needed no structural change, just redirected calls.

    // ---------- Stopwatch card ----------
    function renderStopwatchHTML(it) {
        return `<div class="sw-row" onmousedown="event.stopPropagation()">
            <button class="sw-btn sw-startstop" onclick="swToggleRun(${it.id})" title="${it.swRunning ? 'Stop' : 'Start'}">${it.swRunning ? '⏹' : '▶'}</button>
            <button class="sw-btn sw-pauseplay" onclick="swTogglePause(${it.id})" ${it.swRunning ? '' : 'disabled'} title="${it.swPaused ? 'Resume' : 'Pause'}">${it.swPaused ? '▶' : '⏸'}</button>
            <div class="sw-time">${window.__swFormatTime(window.__swCurrentElapsedMs(it))}</div>
        </div>`;
    }

export { renderStopwatchHTML };
