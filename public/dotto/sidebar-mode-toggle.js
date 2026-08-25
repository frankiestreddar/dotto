// Sidebar Mode dropdown — #settings-panel's own fully custom trigger+popup (hamburger-stack.html;
// was a native <select> until an explicit follow-up request to not use "the standard html
// dropdown"), toggling between the two rail-panel layout behaviors this app has had this session:
// panels overlaying the canvas (the original behavior) vs. reserving their own screen space and
// pushing the canvas/source-table over (the current default — see #canvas's and .item.static-table's
// own body:has(#hamburger-stack.open):not([data-sidebar-mode="overlay"]) overrides, globals.css).
const SIDEBAR_MODE_STORAGE_KEY = 'dotto-sidebar-mode';
const MODE_LABELS = { push: 'Push', overlay: 'Overlay' };

const trigger = document.getElementById('sidebar-mode-trigger');
const triggerLabel = document.getElementById('sidebar-mode-trigger-label');
const popup = document.getElementById('sidebar-mode-popup');
const rows = Array.from(popup.querySelectorAll('.settings-dropdown-row'));

function closeDropdown() { popup.classList.remove('open'); }
function toggleDropdown() { popup.classList.toggle('open'); }

// Only 'overlay' ever needs to be recorded on <body>; its absence already means "push" (the
// default) — the CSS overrides above are written as :not([data-sidebar-mode="overlay"]) rather
// than checking for an explicit "push" value, for exactly that reason.
function setSidebarMode(mode) {
    if (mode === 'overlay') document.body.dataset.sidebarMode = 'overlay';
    else delete document.body.dataset.sidebarMode;
    try { localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, mode); } catch (e) { /* private browsing, storage disabled, etc. — choice just won't persist across reloads */ }
    triggerLabel.textContent = MODE_LABELS[mode];
    rows.forEach(row => row.classList.toggle('active', row.dataset.mode === mode));
}

let initialMode = 'push';
try { if (localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY) === 'overlay') initialMode = 'overlay'; } catch (e) { /* private browsing, storage disabled, etc. — falls back to the push default */ }
setSidebarMode(initialMode);

trigger.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });
rows.forEach(row => {
    row.addEventListener('click', (e) => {
        e.stopPropagation();
        setSidebarMode(row.dataset.mode);
        closeDropdown();
    });
});
// A capture-phase listener (not the usual bubble phase) specifically because #settings-panel's own
// onclick="event.stopPropagation()" (hamburger-stack.html) would otherwise swallow a click on any
// OTHER settings row before it ever reached a plain document-level bubble listener — capture fires
// on the way DOWN to the target, before that stopPropagation (called during the bubble phase back
// up) ever runs, so this still sees every click regardless.
document.addEventListener('click', (e) => {
    if (!popup.classList.contains('open')) return;
    if (trigger.contains(e.target) || popup.contains(e.target)) return;
    closeDropdown();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); });
