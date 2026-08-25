// Tracks the pointer's last known viewport position and can force the browser to re-issue/repaint
// the native cursor on demand (refreshCustomCursor) — needed because changing what
// `cursor: var(--cursor-pointer)` resolves to (globals.css, e.g. toggling theme) doesn't repaint
// the actual on-screen cursor image until the next real mousemove; several browsers render nothing
// at all in the meantime rather than the stale old image, so switching theme with the mouse
// stationary made the cursor visibly vanish until moved. Dispatching a synthetic mousemove at the
// pointer's own last position (no real movement needed) is what nudges the browser into
// re-evaluating/repainting it immediately instead — the standard workaround for this browser quirk.
let lastCursorX = null;
let lastCursorY = null;

window.addEventListener('pointermove', (e) => { lastCursorX = e.clientX; lastCursorY = e.clientY; }, { passive: true });

function refreshCustomCursor() {
    if (lastCursorX === null) return; // pointer hasn't moved yet this session — nothing to nudge
    // rAF so the dispatch lands after the style recalc from whatever just changed --cursor-pointer
    // (e.g. the data-theme attribute flip) has actually been committed, not before it.
    requestAnimationFrame(() => {
        const target = document.elementFromPoint(lastCursorX, lastCursorY) || document;
        target.dispatchEvent(new MouseEvent('mousemove', { clientX: lastCursorX, clientY: lastCursorY, bubbles: true, cancelable: true }));
    });
}

export { refreshCustomCursor };
