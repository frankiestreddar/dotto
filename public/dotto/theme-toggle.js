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

// Icon reflects the CURRENTLY active theme (light.png while light mode is on, dark.png while
// dark mode is on) — reads as a state indicator, same as every other rail icon, rather than
// "click this icon to get the other theme."
function syncThemeIcon(theme) {
    themeIcon.src = theme === 'light' ? '/assets/icons/light.png' : '/assets/icons/dark.png';
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
