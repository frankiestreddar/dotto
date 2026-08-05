    const canvas = document.getElementById('canvas'), world = document.getElementById('world'), dotLayer = document.getElementById('dot-layer'),
        cursorOverlay = document.getElementById('cursor-overlay'),
        breadcrumbs = document.getElementById('breadcrumbs'), btnBack = document.getElementById('btn-back'),
        btnForward = document.getElementById('btn-forward'), btnAdd = document.getElementById('btn-add'),
        addMenu = document.getElementById('add-menu'), contextMenu = document.getElementById('context-menu'),
        zoomTrack = document.getElementById('zoom-track'), zoomFill = document.getElementById('zoom-fill'),
        zoomThumb = document.getElementById('zoom-thumb'), zoomControl = document.getElementById('zoom-control'),
        drawSettings = document.getElementById('draw-settings'),
        drawColorInput = document.getElementById('draw-color'),
        drawFrontBtn = document.getElementById('draw-front-btn'), drawBackBtn = document.getElementById('draw-back-btn'),
        drawPenBtn = document.getElementById('draw-pen-btn'), drawEraserBtn = document.getElementById('draw-eraser-btn'),
        drawSizeInput = document.getElementById('draw-size'),
        canvasContextMenu = document.getElementById('canvas-context-menu');
    
    const supabase = window.__dottoSupabase || null;

    // Every piece of shared, cross-function mutable app state, consolidated into one owned
    // object rather than scattered top-level `let`s — see PHASE2_ROADMAP.md Phase 1. This is
    // what makes the eventual real-ES-module split possible at all: an ES module import is a
    // read-only live binding (you can't do `import { tx } from './x.js'; tx = 5;`), so every
    // piece of state that gets reassigned (not just mutated in place) from outside the module
    // that declares it has to live as a property of something that module still owns, like
    // this object, rather than as its own top-level binding.
    const appState = {
        // Set by dotto-app.jsx before this script runs (see app/dotto-app.jsx). Declared first
        // since profile-panel setup further down reads currentUser immediately.
        currentUser: window.__DOTTO_USER__ || { id: null, username: 'guest', displayName: 'You' },
        tx: 0, ty: 0, scale: 1, idCounter: 10, currentEditingEl: null,
        contextMenuItemId: null,
        // Source-page table state: which data cell last had focus (so the bottom-bar Add menu
        // knows where to insert images/audio), which cell's tag picker is currently open, and
        // the in-progress MediaRecorder session (if any) for the Audio > Record option.
        lastFocusedCell: null,
        activeTagRow: null,
        renamingTagId: null, // tag currently being renamed inline in the tag picker list, if any
        contextMenuTagId: null, // tag the right-click context menu (rename/delete) is currently targeting
        cellAudioRecorder: null, cellAudioChunks: [],
        historyStack: ['root'], historyIndex: 0, currentFolderId: 'root',
        // Core data mapping of our multiple folder structures
        folders: {
            'root': {
                id: 'root',
                title: 'Home',
                items: [
                    { id: 1, x: 100, y: 150, w: 308, h: 140, kind: 'note', html: 'Welcome to Dotter!<br>Explore the app, report any bugs, and learn some languages!' },
                ],
                drawings: []
            }
        },
        addingKind: null,
        addingStatKind: null, // optional variant config threaded through to add() for kinds like 'statcard' that come in multiple flavors (e.g. Progress vs Accuracy)
        placementGhost: null,
        selectedCardIds: [],
        // The card "armed" by a first click in data mode, awaiting a second click on a different
        // card to complete the link — see handleDataModeClick/clearDataLinkPending. Click-to-link is
        // a second way to create the exact same {fromId,toId} connection that dragging between two
        // cards already does (see startConnectionDrag), for when dragging across a large canvas
        // distance is inconvenient.
        dataLinkPendingId: null,
        // ---- Card interaction modes: 'normal' (move/click), 'data' (draw connections), 'select' (multi-select) ----
        cardMode: 'normal',
        modeOverrideKey: null, // 'shift' | 'd' | 'escape' | null — temporary override while a mode key is held
        topCardZIndex: 10,
    };
    function effectiveMode() {
        if (appState.modeOverrideKey === 'shift') return 'select';
        if (appState.modeOverrideKey === 'd') return 'data';
        if (appState.modeOverrideKey === 'escape') return 'normal';
        return appState.cardMode;
    }
    function bringCardToFront(it, el) {
        if (!it) return;
        appState.topCardZIndex++;
        it.zIndex = appState.topCardZIndex;
        if (el) el.style.zIndex = appState.topCardZIndex;
    }
    // Every card's zIndex is persisted with the workspace, but topCardZIndex itself always
    // restarts at its hardcoded default above on a fresh page load — so without this, a card
    // that reached e.g. zIndex 87 in a past session would still outrank anything freshly
    // clicked this session until the new session's counter happened to climb back past 87 on
    // its own. Called right after `folders` is populated from persisted/remote data (see
    // loadWorkspace) so "click brings to front" is guaranteed to actually mean "in front of
    // literally everything," not just everything clicked so far this session.
    function recomputeTopCardZIndex() {
        let max = appState.topCardZIndex;
        Object.values(appState.folders).forEach(f => {
            (f && f.items || []).forEach(it => { if (typeof it.zIndex === 'number' && it.zIndex > max) max = it.zIndex; });
        });
        appState.topCardZIndex = max;
    }


export { addMenu, appState, breadcrumbs, bringCardToFront, btnAdd, btnBack, btnForward, canvas, canvasContextMenu, contextMenu, cursorOverlay, dotLayer, drawBackBtn, drawColorInput, drawEraserBtn, drawFrontBtn, drawPenBtn, drawSettings, drawSizeInput, effectiveMode, recomputeTopCardZIndex, supabase, world, zoomControl, zoomFill, zoomThumb, zoomTrack };
