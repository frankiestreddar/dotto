// Sidebar Display Mode toggle — #settings-panel's own switch (hamburger-stack.html) between the
// two rail-panel layout behaviors this app has had this session: panels overlaying the canvas (the
// original behavior) vs. reserving their own screen space and pushing the canvas/source-table over
// (the current default — see #canvas's and .item.static-table's own
// body:has(#hamburger-stack.open):not([data-sidebar-mode="overlay"]) overrides, globals.css). Per
// explicit request. Same structure as theme-toggle.js: a plain checkbox for real keyboard/click/
// focus accessibility, with a separate JS-toggled .on class on the switch's own track driving the
// actual visual slide (a pure :checked CSS selector was tried for the Brightness Theme switch and
// never actually transitioned — see theme-toggle.js's own history — so this one starts with the
// working pattern from the start instead of repeating that detour).
const SIDEBAR_MODE_STORAGE_KEY = 'dotto-sidebar-mode';

const sidebarModeSwitchInput = document.getElementById('sidebar-mode-switch-input');
const sidebarModeSwitchTrack = document.getElementById('sidebar-mode-switch-track');

// "Push" (own screen real estate, the default) is the checked/on state — "Overlay" is off. Only
// 'overlay' ever needs to be recorded on <body>; its absence already means "push" (the default),
// mirroring how data-theme only exists in the "light" case being meaningfully different — except
// here dark/push is the default either way, so this reads more directly as "is overlay mode on".
function syncSidebarModeSwitch(mode) {
    const isPush = mode !== 'overlay';
    sidebarModeSwitchInput.checked = isPush;
    sidebarModeSwitchTrack.classList.toggle('on', isPush);
}

function setSidebarMode(mode) {
    if (mode === 'overlay') document.body.dataset.sidebarMode = 'overlay';
    else delete document.body.dataset.sidebarMode;
    try { localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, mode); } catch (e) { /* private browsing, storage disabled, etc. — choice just won't persist across reloads */ }
    syncSidebarModeSwitch(mode);
}

let initialMode = 'push';
try { if (localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY) === 'overlay') initialMode = 'overlay'; } catch (e) { /* private browsing, storage disabled, etc. — falls back to the push default */ }
setSidebarMode(initialMode);

sidebarModeSwitchInput.addEventListener('change', () => {
    setSidebarMode(sidebarModeSwitchInput.checked ? 'push' : 'overlay');
});
