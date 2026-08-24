import { appState } from './core-state.js';

// Light/dark theme toggle — #btn-theme-toggle (top-bar.html, bottom of the rail, under the
// cursor-mode selector). The actual theme is applied via document.documentElement.dataset.theme,
// which a small blocking inline script in app/layout.js's <head> already sets from localStorage
// BEFORE this module ever loads (this app's vanilla-JS bootstrap, dotto-script.js, loads via
// <Script strategy="afterInteractive"> — well after first paint, too late on its own to avoid a
// flash of the wrong theme). This module never re-derives the theme itself; it only syncs the
// button's icon to whatever's already applied and handles clicks from here on.
const THEME_STORAGE_KEY = 'dotto-theme';

const themeIcon = appState.btnThemeToggle.querySelector('.rail-icon-img');
const themeTooltip = appState.btnThemeToggle.querySelector('.rail-tooltip');

// Icon (and tooltip text) show the theme clicking the button would SWITCH TO, per explicit
// request — light.png/"Light mode" while dark mode is active, dark.png/"Dark mode" while light
// mode is active — the opposite of a plain state indicator.
function syncThemeIcon(theme) {
    const switchTo = theme === 'light' ? 'dark' : 'light';
    themeIcon.src = `/assets/icons/${switchTo}.png`;
    themeTooltip.firstChild.textContent = switchTo === 'light' ? 'Light mode' : 'Dark mode';
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* private browsing, storage disabled, etc. — theme just won't persist across reloads */ }
    syncThemeIcon(theme);
}

syncThemeIcon(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

appState.btnThemeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});
