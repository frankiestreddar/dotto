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

    // Vertically stacked accordion (see #add-menu-accordion, hamburger-stack.html) — one section
    // per ADD_MENU_DATA category, each a header + its own item list directly beneath it. Exactly
    // one section is ever .expanded (never zero): switchAddTab always both sets the new one and
    // clears every other, so there's no separate "collapse" action that could leave none open.
    // Built once (rows never change at runtime — ADD_MENU_DATA is static), then reused across every
    // open/close of the panel; switching tabs only ever toggles which section has .expanded, no
    // re-render.
    function initAddAccordion() {
        const container = document.getElementById('add-menu-accordion');
        if (!container || container.childElementCount) return;
        Object.entries(appState.ADD_MENU_DATA).forEach(([tabKey, tab]) => {
            const section = document.createElement('div');
            section.className = 'add-accordion-section' + (tabKey === appState.currentAddTab ? ' expanded' : '');
            section.dataset.tab = tabKey;
            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'add-accordion-header';
            header.onclick = () => switchAddTab(tabKey);
            header.innerHTML = '<span class="add-accordion-header-label"></span><svg class="add-accordion-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5"/></svg>';
            header.querySelector('.add-accordion-header-label').textContent = tab.label;
            const content = document.createElement('div');
            content.className = 'add-accordion-content';
            tab.items.forEach(item => {
                const row = buildAddMenuRow(item.icon, item.label);
                row.onclick = () => handleAddItemClick(item.kind, item.statKind);
                content.appendChild(row);
            });
            section.appendChild(header);
            section.appendChild(content);
            container.appendChild(section);
        });
    }
    function switchAddTab(tab) {
        appState.currentAddTab = tab;
        document.querySelectorAll('#add-menu-accordion .add-accordion-section').forEach(s => {
            s.classList.toggle('expanded', s.dataset.tab === tab);
        });
    }
    // Always reopens on the accordion, never mid-search from a previous visit — same convention as
    // every other rail view's onOpen (buildOutline, renderWaypointsList, ...) fully resetting its
    // own transient state on every open rather than just picking up wherever it was left. Also
    // cancels draw mode, if it was on — opening this panel to pick something else is a clear signal
    // the user is done drawing (same behavior the old floating add-menu had).
    function resetAddMenuPanel() {
        if (appState.drawMode) setDrawMode(false);
        initAddAccordion();
        appState.addMenuSearchQuery = '';
        const input = document.getElementById('add-menu-search-input');
        if (input) input.value = '';
        addMenu.classList.remove('searching');
        document.getElementById('add-menu-search-results').innerHTML = '';
    }
    // Filters block types BY NAME across every tab at once (unlike the accordion, which only ever
    // shows one tab's items at a time) — replaces the accordion with a flat matches list for as
    // long as there's a query, same "search overrides the normal view" convention as every other
    // rail panel's own search box.
    function handleAddMenuSearchInput(value) {
        appState.addMenuSearchQuery = value;
        const query = value.trim().toLowerCase();
        addMenu.classList.toggle('searching', !!query);
        const list = document.getElementById('add-menu-search-results');
        list.innerHTML = '';
        if (!query) return;
        const items = Object.values(appState.ADD_MENU_DATA).flatMap(tab => tab.items).filter(item => item.label.toLowerCase().includes(query));
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
        iconEl.onerror = () => iconEl.remove(); // most icon files don't exist yet - see ADD_MENU_DATA's own comment
        const nameEl = document.createElement('div');
        nameEl.className = 'add-menu-row-name';
        nameEl.textContent = name;
        row.appendChild(iconEl);
        row.appendChild(nameEl);
        return row;
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
