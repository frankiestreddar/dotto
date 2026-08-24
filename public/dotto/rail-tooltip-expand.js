// Hold-to-expand rail tooltips — per explicit request: hovering a rail icon shows the small
// name+shortcut pill immediately (plain CSS, see .rail-tooltip in globals.css), same as always.
// If the hover holds for a further 2s, THIS module takes over and runs a three-stage animation on
// that same element (not a second, separate one — an earlier version tried a crossfade to a
// second .rail-tooltip-expanded box, but the user explicitly asked for the tooltip itself to grow
// in place instead): 1) smoothly widen from its current small-pill width out to a fixed 220px,
// during which .rail-tooltip-row's own justify-content:space-between (globals.css) visibly pushes
// the shortcut key away from the name as the row gains room; 2) once that width transition
// finishes, "type" the description (.rail-tooltip-desc's own data-desc attribute) into place one
// character at a time; 3) on every character, re-measure and grow the tooltip's own height to
// match, so the box visibly grows line by line as the text wraps rather than the text overflowing
// or the box jumping to its final height instantly.
//
// Only wired to buttons whose .rail-tooltip actually has this structure (.rail-tooltip-row +
// .rail-tooltip-desc) — the four cursor-mode buttons' tooltips are a single plain descriptive
// sentence with neither, so they're skipped entirely, same as before this feature existed.
//
// Width/height can't be transitioned from `auto` in CSS, so every expansion locks in the CURRENT
// rendered size as an explicit inline px value first (a plain shrink-to-fit box has no other
// starting point to animate from), then sets the real target — .rail-tooltip.expanding's own
// transition (globals.css) is what actually animates between the two.

const EXPAND_DELAY_MS = 2000;
const EXPANDED_WIDTH_PX = 220;
const TYPE_STEP_MS = 16;
// scrollHeight reports the padding-box (content+padding, no border), but .rail-tooltip is
// box-sizing:border-box and its own border is 1px solid (globals.css) — top+bottom border-width
// this makes up the difference so setting style.height to scrollHeight+this doesn't leave the
// box a couple px too short for its own content (border-box height = padding-box + border).
const TOOLTIP_BORDER_PX = 2;

function resetTooltip(state) {
    clearTimeout(state.openTimer);
    state.openTimer = null;
    clearInterval(state.typeInterval);
    state.typeInterval = null;
    state.generation++;
    state.tooltip.classList.remove('expanding');
    state.tooltip.style.width = '';
    state.tooltip.style.height = '';
    state.desc.textContent = '';
}

function typeDescription(state, generation) {
    const fullText = state.desc.dataset.desc || '';
    let i = 0;
    state.typeInterval = setInterval(() => {
        // A reset (pointerleave/click) between ticks bumps generation — bail out rather than
        // keep mutating a tooltip that's already been reverted back to its small-pill state.
        if (generation !== state.generation) { clearInterval(state.typeInterval); return; }
        i++;
        state.desc.textContent = fullText.slice(0, i);
        state.tooltip.style.height = (state.tooltip.scrollHeight + TOOLTIP_BORDER_PX) + 'px';
        if (i >= fullText.length) { clearInterval(state.typeInterval); state.typeInterval = null; }
    }, TYPE_STEP_MS);
}

function beginExpand(state) {
    if (!state.btn.matches(':hover')) return; // defensive — pointerleave should already have cancelled the timer otherwise
    const generation = state.generation;
    const startWidth = state.tooltip.getBoundingClientRect().width;
    const startHeight = state.tooltip.getBoundingClientRect().height;
    state.tooltip.style.width = startWidth + 'px';
    state.tooltip.style.height = startHeight + 'px';
    void state.tooltip.offsetWidth; // force layout so the line above isn't optimized away before the class/width change below
    state.tooltip.classList.add('expanding');
    state.tooltip.style.width = EXPANDED_WIDTH_PX + 'px';
    const onWidthDone = (e) => {
        if (e.propertyName !== 'width') return;
        state.tooltip.removeEventListener('transitionend', onWidthDone);
        if (generation !== state.generation) return; // reset happened mid-transition
        typeDescription(state, generation);
    };
    state.tooltip.addEventListener('transitionend', onWidthDone);
}

function wireRailTooltipExpand(btn) {
    const tooltip = btn.querySelector('.rail-tooltip');
    const desc = tooltip && tooltip.querySelector('.rail-tooltip-desc');
    if (!tooltip || !desc) return; // the four cursor-mode buttons, or anything else without the row+desc structure
    const state = { btn, tooltip, desc, openTimer: null, typeInterval: null, generation: 0 };
    btn.addEventListener('pointerenter', () => {
        if (btn.classList.contains('active')) return; // matches .rail-tooltip's own :not(.active) CSS gating
        state.openTimer = setTimeout(() => beginExpand(state), EXPAND_DELAY_MS);
    });
    btn.addEventListener('pointerleave', () => resetTooltip(state));
    // A click normally opens this button's own panel (adding .active, which hides the tooltip
    // entirely per its own CSS) without necessarily firing pointerleave first — reset here too so
    // a still-expanded tooltip never reappears mid-animation state if the panel closes again while
    // the pointer never actually left the button.
    btn.addEventListener('click', () => resetTooltip(state));
}

document.querySelectorAll('.rail-btn').forEach(wireRailTooltipExpand);
