import { appState } from './core-state.js';

// ---------- Extensions panel (was Library — repurposed per explicit request; "browse your own
// library content" moved to the Blocks panel instead, see blocks-panel.js). Just a flat list of
// installed marketplace extensions, rendered as rectangular pills (ExtensionsPanel.jsx) — dummy
// data for now (extensionsListStore, bridges.js, seeded with two placeholder entries), so there's
// nothing to actually refresh from Supabase yet. This function still exists as the onOpen callback
// wireRailIcon needs, same convention as every other rail panel, ready for real data later. ----------
function refreshExtensionsPanel() {
    // Nothing to do yet — extensionsListStore already holds its (static, dummy) data.
}

window.__wireRailIcon('library', appState.libraryBtn, appState.libraryPanel, refreshExtensionsPanel);

export { refreshExtensionsPanel };
