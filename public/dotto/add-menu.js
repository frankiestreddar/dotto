import { prepareAdd } from './copy-paste.js';
import { appState } from './core-state.js';
import { toggleDrawFromMenu } from './srs-connections-core.js';


    // ---------- Add menu data ----------
    // icon paths point at /public/assets/icons/<name>.png — most of these files don't exist yet
    // (only heading-1/note/table/waypoint/flashcards were already there for other features); a
    // missing file just shows the row's empty icon slot rather than a broken-image icon (see
    // buildAddMenuRow's onerror), same graceful-degradation pattern as the spritebook.

    // Shaped to match the eventual `marketplace_listings` table (creatorId
    // joins to `profiles`, price is metadata only for now — no real payments).


    function kindLabel(kind) {
        if (kind === 'sentence') return 'Sentence';
        // No longer creatable from the add-menu (removed from ADD_MENU_DATA), but existing
        // checklist cards on canvases keep working — this keeps their label correct everywhere
        // kindLabel is used, rather than falling through to the raw 'checklist' string below.
        if (kind === 'checklist') return 'Checklist';
        for (const tab of Object.values(appState.ADD_MENU_DATA)) {
            const found = tab.items.find(i => i.kind === kind);
            if (found) return found.label;
        }
        return kind;
    }
    // The word typed to search for a block TYPE in canvas search (computeCanvasMatches) — distinct
    // from kindLabel (used for the add-menu/outline, where the singular reads more naturally,
    // e.g. "Add a Flashcard"). A prefix check requires the label be at least as long as whatever's
    // typed, so a kind whose natural spoken/typed form is plural (typing the full word "flashcards"
    // is exactly as likely as "flashcard") needs its OWN plural label here — otherwise typing the
    // trailing "s" would make it one character longer than the singular kindLabel and stop
    // matching entirely, even though every shorter prefix ("f", "flash", "flashcard") still would.
    function searchTypeLabel(kind) {
        if (kind === 'flashcard') return 'Flashcards';
        return kindLabel(kind);
    }
    function searchKindLabel(it) {
        if (it.kind === 'title') return 'H' + (it.level || 1);
        if (it.kind === 'folder') return 'Canvas';
        if (appState.ADD_MENU_DATA.tools.items.some(i => i.kind === it.kind)) return 'Tool';
        if (appState.ADD_MENU_DATA.games.items.some(i => i.kind === it.kind)) return 'Game';
        return kindLabel(it.kind);
    }
    function kindSize(kind) {
        if (kind === 'title') return { w: 100, h: 50 };
        if (kind === 'folder') return { w: 448, h: 280 };
        if (kind === 'source') return { w: 7 * 28, h: 2 * 28 }; // 2x7 grid cells (see #dot-layer's 28px spacing)
        if (kind === 'table') return { w: 280, h: 180 };
        if (kind === 'media') return { w: 240, h: 160 };
        if (kind === 'bookmark') return { w: 200, h: 90 };
        if (kind === 'checklist') return { w: 220, h: 160 }; // no longer creatable, kept for existing cards — see kindLabel
        if (kind === 'embed') return { w: 320, h: 220 };
        if (kind === 'watermark') return { w: 200, h: 80 };
        if (kind === 'flashcard') return { w: 15 * 28, h: 10 * 28 };
        if (kind === 'typeright') return { w: 15 * 28, h: 8 * 28 };
        if (kind === 'statcard') return { w: 180, h: 110 };
        if (kind === 'stopwatch') return { w: 220, h: 70 };
        if (kind === 'shelf') return { w: 220, h: 170 };
        if (kind === 'filter') return { w: 220, h: 140 };
        if (kind === 'sentence') return { w: 220, h: 130 };
        if (kind === 'waypoint') return { w: 28, h: 28 }; // 1 grid cell (see #dot-layer's 28px spacing) — collapsed size; .item.waypoint.expanded overrides via CSS, not this
        return { w: 200, h: 112 };
    }

    function switchAddTab(tab) {
        appState.currentAddTab = tab;
        document.querySelectorAll('#add-menu-tabs .add-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        renderAddMenuList();
    }
    // The round search pill (see add-menu.html) swaps the 5 category pills for a text input that
    // filters block types BY NAME across every tab at once, rather than one tab at a time — the
    // pill itself never hides (no data-tab attribute, so #add-menu-tabs.searching's hiding rule
    // skips it), so clicking it again always toggles back out to the tabs.
    function toggleAddMenuSearch() {
        appState.addMenuSearching = !appState.addMenuSearching;
        document.getElementById('add-menu-tabs').classList.toggle('searching', appState.addMenuSearching);
        document.getElementById('add-menu-search-btn').classList.toggle('active', appState.addMenuSearching);
        if (appState.addMenuSearching) {
            appState.addMenuSearchQuery = '';
            const input = document.getElementById('add-menu-search-input');
            input.value = '';
            input.focus();
            renderAddMenuList();
        } else {
            switchAddTab(appState.currentAddTab); // restores whichever tab was active before searching (and re-renders)
        }
    }
    function handleAddMenuSearchInput(value) {
        appState.addMenuSearchQuery = value;
        renderAddMenuList();
    }
    function renderAddMenuList() {
        const list = document.getElementById('add-menu-list');
        list.innerHTML = '';
        let items;
        if (appState.addMenuSearching) {
            const query = appState.addMenuSearchQuery.trim().toLowerCase();
            // Empty query shows nothing rather than every block type across all 5 tabs (21 items
            // wouldn't fit the fixed, non-scrolling 5-row list anyway — see #add-menu-list).
            items = query
                ? Object.values(appState.ADD_MENU_DATA).flatMap(tab => tab.items).filter(item => item.label.toLowerCase().includes(query))
                : [];
        } else {
            items = appState.ADD_MENU_DATA[appState.currentAddTab].items;
        }
        items.forEach(item => {
            const row = buildAddMenuRow(item.icon, item.label);
            row.onclick = () => handleAddItemClick(item.kind, item.statKind);
            list.appendChild(row);
        });
    }
    function buildAddMenuRow(icon, name) {
        const row = document.createElement('div');
        row.className = 'add-menu-row';
        const iconEl = document.createElement('img');
        iconEl.className = 'add-menu-row-icon';
        iconEl.src = icon;
        iconEl.alt = '';
        iconEl.onerror = () => iconEl.remove(); // most icon files don't exist yet \u2014 see ADD_MENU_DATA's own comment
        const nameEl = document.createElement('div');
        nameEl.className = 'add-menu-row-name';
        nameEl.textContent = name;
        row.appendChild(iconEl);
        row.appendChild(nameEl);
        return row;
    }
    function handleAddItemClick(kind, statKind) {
        if (kind === 'drawing') { toggleDrawFromMenu(); return; }
        prepareAdd(kind, statKind);
    }
    function newSourceClicked() {
        prepareAdd('source');
    }

export { handleAddMenuSearchInput, kindLabel, kindSize, newSourceClicked, searchKindLabel, searchTypeLabel, switchAddTab, toggleAddMenuSearch };
