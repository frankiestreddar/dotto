import { CARD_KINDS, DEFAULT_CARD_SIZE } from './card-kinds.js';
import { appState } from './core-state.js';


    // ---------- Block-kind metadata helpers ----------
    // The Add-menu UI itself (grid/search/wiring) moved to blocks-panel.js when Essentials was
    // repurposed into the Blocks panel (explicit request) — these three pure lookups are kept here
    // since app/dotto/lib/copyPaste.ts/live-presence.js/srs-connections-core.js/source-tags-ai.js all still
    // import them independently of anything panel-related.

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

export { kindLabel, kindSize, searchKindLabel };

// Used by app/dotto/lib/copyPaste.ts's placementGhostWorldPos (Phase 4.4).
window.__kindSize = kindSize;
