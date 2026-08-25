// Sidebar Mode dropdown — #settings-panel's own <select> (hamburger-stack.html, was a switch until
// an explicit follow-up request changed it to a dropdown) between the two rail-panel layout
// behaviors this app has had this session: panels overlaying the canvas (the original behavior) vs.
// reserving their own screen space and pushing the canvas/source-table over (the current default —
// see #canvas's and .item.static-table's own
// body:has(#hamburger-stack.open):not([data-sidebar-mode="overlay"]) overrides, globals.css).
const SIDEBAR_MODE_STORAGE_KEY = 'dotto-sidebar-mode';

const sidebarModeSelect = document.getElementById('sidebar-mode-select');

// Only 'overlay' ever needs to be recorded on <body>; its absence already means "push" (the
// default) — the CSS overrides above are written as :not([data-sidebar-mode="overlay"]) rather
// than checking for an explicit "push" value, for exactly that reason.
function setSidebarMode(mode) {
    if (mode === 'overlay') document.body.dataset.sidebarMode = 'overlay';
    else delete document.body.dataset.sidebarMode;
    try { localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, mode); } catch (e) { /* private browsing, storage disabled, etc. — choice just won't persist across reloads */ }
    sidebarModeSelect.value = mode;
}

let initialMode = 'push';
try { if (localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY) === 'overlay') initialMode = 'overlay'; } catch (e) { /* private browsing, storage disabled, etc. — falls back to the push default */ }
setSidebarMode(initialMode);

sidebarModeSelect.addEventListener('change', () => {
    setSidebarMode(sidebarModeSelect.value === 'overlay' ? 'overlay' : 'push');
});
