// Light/dark theme toggle — used to be its own rail button (#btn-theme-toggle), now a "Colour
// Theme" switch row inside #profile-settings-view (hamburger-stack.html) instead, per explicit
// request — moved there from #settings-panel once Settings' own rail icon was removed and its
// content repurposed as a sub-view of the Profile panel (see that fragment's own comment).
// The actual theme is applied via document.documentElement.dataset.theme, which a small blocking
// inline script in app/layout.js's <head> already sets BEFORE this module ever loads (this app's
// vanilla-JS bootstrap, dotto-script.js, loads via <Script strategy="afterInteractive"> — well
// after first paint, too late on its own to avoid a flash of the wrong theme).
//
// Explicit request: the site should follow the OS's own light/dark preference live, but a choice
// made here (via the switch below) or via the \ shortcut (toggleTheme, app/dotto/lib/srsConnectionsCore.ts)
// always wins over that until... well, forever, in practice — there's no UI to CLEAR an explicit
// choice and go back to following the system, only to flip it to the other explicit value, so
// once set it stays set. localStorage's THEME_STORAGE_KEY holding a value AT ALL is what "an
// explicit override exists" means (see layout.js's own bootstrap script, which reads it the exact
// same way) — this module never re-derives the theme on load, it only syncs the switch to
// whatever <html data-theme> already is and handles explicit changes plus live system-preference
// changes from here on.
const THEME_STORAGE_KEY = 'dotto-theme';

const themeSwitchInput = document.getElementById('theme-switch-input');
const themeSwitchTrack = document.getElementById('theme-switch-track');

function hasExplicitOverride() {
    try { return localStorage.getItem(THEME_STORAGE_KEY) != null; } catch (e) { return false; }
}

// Unlike the old rail button (which showed the theme clicking it would SWITCH TO), this switch is
// a plain state indicator by normal convention — "on" means dark mode is the one currently
// active. light.png/dark.png (either side of the switch, hamburger-stack.html) don't need any JS
// sync of their own; they're fixed labels, not theme-dependent.
// themeSwitchTrack's own .on class (not themeSwitchInput.checked) is what the thumb's slide
// transition (globals.css) actually keys off — an earlier version relied purely on a :checked
// sibling-combinator CSS selector, which never actually transitioned in practice; toggling a real
// class here instead is the same explicit pattern every other toggle in this app already uses.
// themeSwitchInput.checked is still kept in sync too (set below), since the checkbox itself is
// what real keyboard/click/focus interaction actually happens on.
function syncThemeSwitch(theme) {
    const isDark = theme === 'dark';
    themeSwitchInput.checked = isDark;
    themeSwitchTrack.classList.toggle('on', isDark);
}

// Applies a theme WITHOUT recording it as an explicit override — used only by the live
// system-preference listener below, so a later OS change (or a page reload) keeps following the
// system rather than getting stuck on whatever it last matched.
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    syncThemeSwitch(theme);
}

// Explicit user action (the switch, or \ via toggleTheme) — persists an override that future
// system-preference changes won't undo.
function setTheme(theme) {
    applyTheme(theme);
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* private browsing, storage disabled, etc. — theme just won't persist across reloads */ }
}

function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

syncThemeSwitch(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

themeSwitchInput.addEventListener('change', () => {
    setTheme(themeSwitchInput.checked ? 'dark' : 'light');
});

// Live-follow the OS preference for the rest of this session, but only for as long as no explicit
// override exists — matches layout.js's own bootstrap script, just applied live instead of only
// once at first paint. Once setTheme (above) ever runs, this listener still fires on further OS
// changes but becomes a no-op every time, per hasExplicitOverride's own check.
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (hasExplicitOverride()) return;
        applyTheme(e.matches ? 'light' : 'dark');
    });
}

// toggleTheme is what the \ keyboard shortcut calls now (app/dotto/lib/srsConnectionsCore.ts,
// Phase 4.5) — there's no rail button left to .click() the way that shortcut used to.
export { toggleTheme };
window.__toggleTheme = toggleTheme;
