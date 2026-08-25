// Light/dark theme toggle — used to be its own rail button (#btn-theme-toggle), now a "Colour
// Theme" switch row inside #settings-panel (hamburger-stack.html) instead, per explicit request.
// The actual theme is applied via document.documentElement.dataset.theme, which a small blocking
// inline script in app/layout.js's <head> already sets from localStorage BEFORE this module ever
// loads (this app's vanilla-JS bootstrap, dotto-script.js, loads via
// <Script strategy="afterInteractive"> — well after first paint, too late on its own to avoid a
// flash of the wrong theme). This module never re-derives the theme itself; it only syncs the
// switch to whatever's already applied and handles its change events from here on.
const THEME_STORAGE_KEY = 'dotto-theme';

const themeSwitchInput = document.getElementById('theme-switch-input');
const themeSwitchTrack = document.getElementById('theme-switch-track');

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

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* private browsing, storage disabled, etc. — theme just won't persist across reloads */ }
    syncThemeSwitch(theme);
}

function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

syncThemeSwitch(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

themeSwitchInput.addEventListener('change', () => {
    setTheme(themeSwitchInput.checked ? 'dark' : 'light');
});

// toggleTheme is what the \ keyboard shortcut calls now (srs-connections-core.js) — there's no
// rail button left to .click() the way that shortcut used to.
export { toggleTheme };
