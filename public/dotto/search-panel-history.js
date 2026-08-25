import { escapeHtml } from './ai-assistant-suggestions.js';

// Recent-search-terms list for #search-panel (hamburger-stack.html) — per explicit request, a
// plain history of what's been typed into #search-panel-search, shown as rows in
// #search-panel-content below it. There's no real search execution behind this box yet (see that
// panel's own markup comment), so "history" here just means "what was submitted," not results —
// submitting (Enter, non-empty) records the term and re-renders the list; clicking a past term
// re-fills the box with it rather than running anything, since there's nothing to run yet.
const HISTORY_STORAGE_KEY = 'dotto-search-history';
const MAX_HISTORY = 20;

const searchInput = document.getElementById('search-panel-search');
const historyList = document.getElementById('search-panel-content');

function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(q => typeof q === 'string') : [];
    } catch (e) { return []; } // private browsing, storage disabled, corrupt JSON, etc.
}

let history = loadHistory();

function saveHistory() {
    try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)); } catch (e) { /* private browsing, storage disabled, etc. — history just won't persist across reloads */ }
}

function renderHistory() {
    historyList.innerHTML = history.map(q => `
        <div class="search-history-row" data-query="${escapeHtml(q)}">
            <img class="search-history-icon" src="/assets/icons/search.png" alt="">
            <span class="search-history-query">${escapeHtml(q)}</span>
        </div>
    `).join('');
    historyList.querySelectorAll('.search-history-row').forEach(row => {
        row.addEventListener('click', () => {
            searchInput.value = row.dataset.query;
            searchInput.focus();
        });
    });
}

function addToHistory(query) {
    const trimmed = query.trim();
    if (!trimmed) return;
    // Case-insensitive dedup, moved to the front rather than left in its old spot — same
    // "most-recent-first, no repeats" convention browser address-bar/search histories use.
    history = [trimmed, ...history.filter(q => q.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_HISTORY);
    saveHistory();
    renderHistory();
}

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addToHistory(searchInput.value);
});

renderHistory();
