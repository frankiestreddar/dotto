import { CARD_KINDS, DEFAULT_CARD_SIZE } from './card-kinds.js';
import { prepareAdd } from './copy-paste.js';
import { addMenu, appState, btnAdd } from './core-state.js';
import { closeRailView, wireRailIcon } from './panels-hamburger.js';
import { setDrawMode } from './srs-connections-core.js';


    // ---------- Add menu data ----------
    // icon paths point at /public/assets/icons/<name>.png — most of these files don't exist yet
    // (only heading-1/note/table/waypoint/flashcards were already there for other features); a
    // missing file just shows the row's empty icon slot rather than a broken-image icon (see
    // buildAddMenuRow's onerror), same graceful-degradation pattern as the spritebook.

    // Shaped to match the eventual `marketplace_listings` table (creatorId
    // joins to `profiles`, price is metadata only for now — no real payments).


    function kindLabel(kind) {
        // sentence/checklist: no longer creatable from the add-menu (checklist removed from
        // ADD_MENU_DATA; sentence was never in it), but existing cards of both kinds on canvases
        // keep working — this keeps their label correct everywhere kindLabel is used, rather than
        // falling through to the raw kind string below. See card-kinds.js for why only these two
        // specials live in the shared registry and not e.g. flashcard's label (a different, and
        // differently-valued, special case belongs to miniLabelForItem instead).
        if (CARD_KINDS[kind]?.label) return CARD_KINDS[kind].label;
        for (const tab of Object.values(appState.ADD_MENU_DATA)) {
            const found = tab.items.find(i => i.kind === kind);
            if (found) return found.label;
        }
        return kind;
    }
    function searchKindLabel(it) {
        if (it.kind === 'title') return 'H' + (it.level || 1);
        if (it.kind === 'folder') return 'Canvas';
        if (appState.ADD_MENU_DATA.tools.items.some(i => i.kind === it.kind)) return 'Tool';
        if (appState.ADD_MENU_DATA.games.items.some(i => i.kind === it.kind)) return 'Game';
        return kindLabel(it.kind);
    }
    function kindSize(kind) {
        return CARD_KINDS[kind]?.defaultSize || DEFAULT_CARD_SIZE;
    }

    // Flat scrollable grid of every block type across every ADD_MENU_DATA category combined — no
    // tabs, no grouping, just one continuous list of square tiles (2 per row, see
    // .add-grid-tile/#add-menu-grid, globals.css). Built once (tiles never change at runtime —
    // ADD_MENU_DATA is static), then reused across every open/close of the panel.
    function initAddGrid() {
        const container = document.getElementById('add-menu-grid');
        if (!container || container.childElementCount) return;
        Object.values(appState.ADD_MENU_DATA).forEach(tab => {
            tab.items.forEach(item => {
                container.appendChild(buildAddMenuTile(item.icon, item.label, item.kind, item.statKind));
            });
        });
    }
    // Always reopens showing every tile, never mid-search from a previous visit — same convention
    // as every other rail view's onOpen (buildOutline, renderWaypointsList, ...) fully resetting
    // its own transient state on every open rather than just picking up wherever it was left. Also
    // cancels draw mode, if it was on — opening this panel to pick something else is a clear signal
    // the user is done drawing (same behavior the old floating add-menu had).
    function resetAddMenuPanel() {
        if (appState.drawMode) setDrawMode(false);
        initAddGrid();
        appState.addMenuSearchQuery = '';
        const input = document.getElementById('add-menu-search-input');
        if (input) input.value = '';
        handleAddMenuSearchInput('');
    }
    // Filters the grid BY NAME in place (toggling which tiles are hidden) rather than swapping in
    // a separate results list — every tile already lives in the one flat grid, so there's nothing
    // to rebuild, just which of the already-built tiles currently show.
    function handleAddMenuSearchInput(value) {
        appState.addMenuSearchQuery = value;
        const query = value.trim().toLowerCase();
        const grid = document.getElementById('add-menu-grid');
        if (!grid) return;
        let anyVisible = false;
        grid.querySelectorAll('.add-grid-tile').forEach(tile => {
            const match = !query || tile.dataset.label.includes(query);
            tile.classList.toggle('add-grid-tile-hidden', !match);
            if (match) anyVisible = true;
        });
        const existingEmpty = grid.querySelector('.add-grid-empty');
        if (existingEmpty) existingEmpty.remove();
        if (query && !anyVisible) {
            const empty = document.createElement('div');
            empty.className = 'add-grid-empty';
            empty.textContent = 'No matching blocks.';
            grid.appendChild(empty);
        }
    }
    // New Canvas/New Source (always-visible rows above the grid, see hamburger-stack.html).
    function buildAddMenuRow(icon, name) {
        const row = document.createElement('div');
        row.className = 'add-menu-row';
        const iconEl = document.createElement('img');
        iconEl.className = 'add-menu-row-icon';
        iconEl.src = icon;
        iconEl.alt = '';
        iconEl.onerror = () => iconEl.remove(); // most icon files don't exist yet - see ADD_MENU_DATA's own comment
        const nameEl = document.createElement('div');
        nameEl.className = 'add-menu-row-name';
        nameEl.textContent = name;
        row.appendChild(iconEl);
        row.appendChild(nameEl);
        return row;
    }
    // One square block-type tile in the grid — icon above, label below, dataset.label carrying
    // the lowercased name handleAddMenuSearchInput filters against.
    function buildAddMenuTile(icon, name, kind, statKind) {
        const tile = document.createElement('div');
        tile.className = 'add-grid-tile';
        tile.dataset.label = name.toLowerCase();
        const iconEl = document.createElement('img');
        iconEl.className = 'add-grid-tile-icon';
        iconEl.src = icon;
        iconEl.alt = '';
        iconEl.onerror = () => iconEl.remove(); // most icon files don't exist yet - see ADD_MENU_DATA's own comment
        const nameEl = document.createElement('div');
        nameEl.className = 'add-grid-tile-name';
        nameEl.textContent = name;
        tile.appendChild(iconEl);
        tile.appendChild(nameEl);
        tile.onclick = () => handleAddItemClick(kind, statKind);
        return tile;
    }
    function handleAddItemClick(kind, statKind) {
        if (kind === 'drawing') { closeRailView(); setDrawMode(!appState.drawMode); return; }
        prepareAdd(kind, statKind);
    }
    function newSourceClicked() {
        prepareAdd('source');
    }
    wireRailIcon('add', btnAdd, addMenu, resetAddMenuPanel);

export { handleAddMenuSearchInput, kindLabel, kindSize, newSourceClicked, searchKindLabel };
