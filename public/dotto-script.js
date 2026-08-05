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

    // ---------- Add menu data ----------
    // icon paths point at /public/assets/icons/<name>.png — most of these files don't exist yet
    // (only heading-1/note/table/waypoint/flashcards were already there for other features); a
    // missing file just shows the row's empty icon slot rather than a broken-image icon (see
    // buildAddMenuRow's onerror), same graceful-degradation pattern as the spritebook.
    const ADD_MENU_DATA = {
        notes: { label: 'Notes', categoryDesc: 'The building blocks of your canvas — headings, notes, tables, drawings and media.', items: [
            { kind: 'title', label: 'Heading', icon: '/assets/icons/heading-1.png' },
            { kind: 'note', label: 'Note', icon: '/assets/icons/note.png' },
            { kind: 'table', label: 'Table', icon: '/assets/icons/table.png' },
            { kind: 'drawing', label: 'Drawing', icon: '/assets/icons/drawing.png' },
            { kind: 'media', label: 'Upload', icon: '/assets/icons/media.png' },
        ]},
        tools: { label: 'Tools', categoryDesc: 'Tools that help you interact with content — read, record, link, and trace.', items: [
            { kind: 'reader', label: 'Reader', icon: '/assets/icons/reader.png' },
            { kind: 'voice', label: 'Voice Recorder', icon: '/assets/icons/voice.png' },
            { kind: 'bookmark', label: 'Bookmark', icon: '/assets/icons/bookmark.png' },
            { kind: 'watermark', label: 'Watermark', icon: '/assets/icons/watermark.png' },
        ]},
        utilities: { label: 'Utilities', categoryDesc: 'Workflow helpers — track tasks, time, history, and navigation.', items: [
            { kind: 'embed', label: 'Embed', icon: '/assets/icons/embed.png' },
            { kind: 'stopwatch', label: 'Stopwatch', icon: '/assets/icons/stopwatch.png' },
            { kind: 'shelf', label: 'Stack', icon: '/assets/icons/shelf.png' },
            { kind: 'filter', label: 'Filter', icon: '/assets/icons/filter.png' },
            { kind: 'waypoint', label: 'Waypoint', icon: '/assets/icons/waypoint.png' },
        ]},
        games: { label: 'Games', categoryDesc: 'Interactive exercises to practice a language.', items: [
            { kind: 'flashcard', label: 'Flashcard', icon: '/assets/icons/flashcards.png' },
            { kind: 'typeright', label: 'Typeright', icon: '/assets/icons/typeright.png' },
            { kind: 'blanks', label: 'Blanks', icon: '/assets/icons/blanks.png' },
            { kind: 'match', label: 'Match', icon: '/assets/icons/match.png' },
            { kind: 'audiotype', label: 'Audio Type', icon: '/assets/icons/audiotype.png' },
        ]},
        stats: { label: 'Stats', categoryDesc: 'Cards that show stats pulled from a linked card.', items: [
            { kind: 'statcard', statKind: 'progress', label: 'Progress', icon: '/assets/icons/progress.png' },
            { kind: 'statcard', statKind: 'accuracy', label: 'Accuracy', icon: '/assets/icons/accuracy.png' },
        ]},
    };
    let currentAddTab = 'notes';

    // Shaped to match the eventual `marketplace_listings` table (creatorId
    // joins to `profiles`, price is metadata only for now — no real payments).
    let trendingMarketplace = [
        { id: 'm1', title: 'Spanish Conjugation Matrix', price: '$4.99', creatorId: 'u101', creatorUsername: 'LanguagePros', description: 'Complete map of irregular roots and structural tables. Perfect for conjugation visual tracking.',
          canvasSnapshot: [
            { id: 'p1a', x: 0, y: 0, w: 200, h: 50, kind: 'title', level: 2, html: 'Irregular Verbs' },
            { id: 'p1b', x: 0, y: 70, w: 280, h: 180, kind: 'table', tableData: [['Verb', 'Yo', 'Tú'], ['ser', 'soy', 'eres'], ['ir', 'voy', 'vas'], ['tener', 'tengo', 'tienes']] },
            { id: 'p1c', x: 310, y: 70, w: 200, h: 112, kind: 'note', html: 'Practice these daily — focus on stem changes.' }
          ] },
        { id: 'm2', title: 'React Performance Blueprint', price: '$8.00', creatorId: 'u102', creatorUsername: 'TechArchitect', description: 'Performance tracing models, custom hook trackers and render speed visual pathways.',
          canvasSnapshot: [
            { id: 'p2a', x: 0, y: 0, w: 220, h: 50, kind: 'title', level: 2, html: 'Render Pipeline' },
            { id: 'p2b', x: 0, y: 70, w: 220, h: 112, kind: 'note', html: 'Memoize expensive components with React.memo.' },
            { id: 'p2c', x: 250, y: 70, w: 220, h: 160, kind: 'checklist', tasks: [{ id: 1, text: 'Profile with DevTools', done: true }, { id: 2, text: 'Audit re-renders', done: false }, { id: 3, text: 'Add useMemo hooks', done: false }] }
          ] },
        { id: 'm3', title: 'Organic Chemistry Pathways', price: '$5.50', creatorId: 'u103', creatorUsername: 'ScienceVisuals', description: 'Advanced drawings with organic pathways designed to trigger visual memory pathways.',
          canvasSnapshot: [
            { id: 'p3a', x: 0, y: 0, w: 220, h: 50, kind: 'title', level: 2, html: 'Reaction Pathways' },
            { id: 'p3b', x: 0, y: 70, w: 280, h: 180, kind: 'table', tableData: [['Reactant', 'Product'], ['Alkene', 'Alcohol'], ['Alcohol', 'Ketone']] }
          ] },
        { id: 'm4', title: 'Business Model Canvas Pack', price: '$3.00', creatorId: 'u104', creatorUsername: 'CorpStrategy', description: 'Classic analytical matrix layouts formatted directly onto interactive tables for strategy.',
          canvasSnapshot: [
            { id: 'p4a', x: 0, y: 0, w: 220, h: 50, kind: 'title', level: 2, html: 'Business Model' },
            { id: 'p4b', x: 0, y: 70, w: 220, h: 112, kind: 'note', html: 'Key Partners' },
            { id: 'p4c', x: 250, y: 70, w: 220, h: 112, kind: 'note', html: 'Revenue Streams' }
          ] }
    ];

    let userLibrary = {
        purchased: [],
        drafts: [],
        published: [],
        customFolders: []
    };
    let activeCartTab = 'discover';
    let activeLibraryFolder = null;
    let librarySearchQuery = '';
    let marketplaceSearchQuery = '';
    let selectedMarketItem = null;

    function kindLabel(kind) {
        if (kind === 'sentence') return 'Sentence';
        // No longer creatable from the add-menu (removed from ADD_MENU_DATA), but existing
        // checklist cards on canvases keep working — this keeps their label correct everywhere
        // kindLabel is used, rather than falling through to the raw 'checklist' string below.
        if (kind === 'checklist') return 'Checklist';
        for (const tab of Object.values(ADD_MENU_DATA)) {
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
        if (ADD_MENU_DATA.tools.items.some(i => i.kind === it.kind)) return 'Tool';
        if (ADD_MENU_DATA.games.items.some(i => i.kind === it.kind)) return 'Game';
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
        currentAddTab = tab;
        document.querySelectorAll('#add-menu-tabs .add-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        renderAddMenuList();
    }
    // The round search pill (see add-menu.html) swaps the 5 category pills for a text input that
    // filters block types BY NAME across every tab at once, rather than one tab at a time — the
    // pill itself never hides (no data-tab attribute, so #add-menu-tabs.searching's hiding rule
    // skips it), so clicking it again always toggles back out to the tabs.
    let addMenuSearching = false;
    let addMenuSearchQuery = '';
    function toggleAddMenuSearch() {
        addMenuSearching = !addMenuSearching;
        document.getElementById('add-menu-tabs').classList.toggle('searching', addMenuSearching);
        document.getElementById('add-menu-search-btn').classList.toggle('active', addMenuSearching);
        if (addMenuSearching) {
            addMenuSearchQuery = '';
            const input = document.getElementById('add-menu-search-input');
            input.value = '';
            input.focus();
            renderAddMenuList();
        } else {
            switchAddTab(currentAddTab); // restores whichever tab was active before searching (and re-renders)
        }
    }
    function handleAddMenuSearchInput(value) {
        addMenuSearchQuery = value;
        renderAddMenuList();
    }
    function renderAddMenuList() {
        const list = document.getElementById('add-menu-list');
        list.innerHTML = '';
        let items;
        if (addMenuSearching) {
            const query = addMenuSearchQuery.trim().toLowerCase();
            // Empty query shows nothing rather than every block type across all 5 tabs (21 items
            // wouldn't fit the fixed, non-scrolling 5-row list anyway — see #add-menu-list).
            items = query
                ? Object.values(ADD_MENU_DATA).flatMap(tab => tab.items).filter(item => item.label.toLowerCase().includes(query))
                : [];
        } else {
            items = ADD_MENU_DATA[currentAddTab].items;
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

    // ---------- Undo / Redo ----------
    let undoStack = [], redoStack = [];

    // ---------- Stopwatch live ticking ----------
    let swTickInterval = null;
    function ensureSwTicking() {
        const hasRunning = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.some(i => i.kind === 'stopwatch' && i.swRunning && !i.swPaused);
        if (hasRunning && !swTickInterval) {
            swTickInterval = setInterval(swTick, 1000);
        } else if (!hasRunning && swTickInterval) {
            clearInterval(swTickInterval); swTickInterval = null;
        }
    }
    function swTick() {
        if (!appState.folders[appState.currentFolderId]) return;
        if (appState.currentEditingEl) {
            // Don't yank focus away from whatever text the user is editing — just patch the
            // visible timer digits directly instead of a full re-render.
            appState.folders[appState.currentFolderId].items.forEach(it => {
                if (it.kind === 'stopwatch' && it.swRunning) {
                    const el = document.getElementById('item-' + it.id);
                    const timeEl = el && el.querySelector('.sw-time');
                    if (timeEl) timeEl.textContent = swFormatTime(swCurrentElapsedMs(it));
                }
            });
            return;
        }
        render();
    }

    function saveSnapshot() {
        undoStack.push(JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }));
        if (undoStack.length > 60) undoStack.shift();
        redoStack = [];
    }

    // ---------- Workspace autosave ----------
    // Persists the same { folders, idCounter } shape saveSnapshot() already
    // uses for undo, so loading it back is just the undo/redo restore path
    // reused at startup. Debounced so continuous typing doesn't hammer
    // Supabase on every keystroke; flushed immediately on tab hide/close so
    // "close the window" can't lose more than the debounce window.
    let workspaceSaveTimer = null;
    function scheduleWorkspaceSave() {
        if (!supabase || !appState.currentUser.id) return;
        // Live presence/content-sync — see the "Live canvas presence" section further down. This,
        // not render(), is the real universal "something changed" signal: render() itself always
        // calls this first, but a lot of mutations (committing a text edit on blur, rating a
        // flashcard, etc.) call ONLY this, never render() — so anchoring on render() alone silently
        // missed every one of those for sync purposes, even though the change was saved/undoable
        // fine locally. This is a strict superset of what render()-anchoring caught.
        const folderObj = appState.folders[appState.currentFolderId];
        if (folderObj) { ensureCanvasPresenceChannel(); queueSyncDiff(folderObj); }
        clearTimeout(workspaceSaveTimer);
        workspaceSaveTimer = setTimeout(saveWorkspaceNow, 800);
    }
    async function saveWorkspaceNow() {
        clearTimeout(workspaceSaveTimer);
        if (!supabase || !appState.currentUser.id) return;

        // shared:owner:folderId entries (see openSharedCanvas) are someone else's canvas fetched
        // on demand, not this user's own — they must never be written into this user's own
        // workspace row, only patched back to the OWNER's via update_shared_folder below. While
        // one is open, the "resume here" fields also fall back to wherever this user's own
        // navigation was just before entering it (preSharedViewState), not the shared key itself,
        // since that key wouldn't mean anything on a fresh load without re-fetching.
        const localFolders = {};
        for (const id in appState.folders) { if (!id.startsWith('shared:')) localFolders[id] = appState.folders[id]; }
        const resumeFolderId = preSharedViewState ? preSharedViewState.currentFolderId : appState.currentFolderId;
        const resumeStack = preSharedViewState ? preSharedViewState.historyStack : appState.historyStack;
        const resumeIndex = preSharedViewState ? preSharedViewState.historyIndex : appState.historyIndex;
        // A shared canvas isn't reachable from resumeFolderId alone (it's someone else's tree,
        // fetched on demand — see the comment above) — so a refresh/reload used to always silently
        // drop back to wherever this user's own navigation was just before entering, kicking them
        // out of the collaboration entirely. Persisting just enough to re-fetch and re-enter it
        // (see loadWorkspace's own resume logic, which walks this back via
        // resolveSharedFolderChain) fixes that — this doesn't replace resumeFolderId/resumeStack
        // above, which still correctly describe where to land if the shared view can't be resumed
        // for any reason (e.g. access was revoked in the meantime).
        const activeShared = appState.folders[appState.currentFolderId];
        const lastSharedView = (activeShared && activeShared.isSharedView)
            ? { ownerId: activeShared.sharedOwnerId, folderId: activeShared.sharedRemoteFolderId }
            : null;

        const { error } = await supabase.from('workspaces').upsert({
            user_id: appState.currentUser.id,
            // historyStack/historyIndex are saved alongside folders so the full
            // breadcrumb trail (root -> ... -> current folder) survives a reload —
            // saving only the leaf folder id previously made whatever nested
            // canvas you were last in look like the root on reload. tx/ty/scale (the current
            // pan/zoom, always live/up to date on these module-level vars) ride along the same
            // way — panning/zooming alone doesn't call scheduleWorkspaceSave (only render() does,
            // to avoid saving on every single drag/wheel frame), but every save that DOES happen
            // for any other reason captures wherever the camera currently is, and pagehide/
            // visibilitychange below call this directly so a plain refresh or tab close always
            // gets one in first.
            data: { folders: localFolders, idCounter: appState.idCounter, historyStack: resumeStack, historyIndex: resumeIndex, scheduledEvents, tx: appState.tx, ty: appState.ty, scale: appState.scale, lastSharedView },
            current_folder_id: resumeFolderId,
            updated_at: new Date().toISOString()
        });
        if (error) console.error('[workspace] save failed:', error);

        // A currently-open shared canvas is saved separately — patches just that one folder in
        // the OWNER's own workspace row (see update_shared_folder), never this user's own.
        const openShared = appState.folders[appState.currentFolderId];
        if (openShared && openShared.isSharedView) {
            const { isSharedView, sharedOwnerId, sharedRemoteFolderId, id, ...folderData } = openShared;
            // The owner's canonical storage always uses bare, un-namespaced folder ids — this
            // local folders dict's shared: wrapping (see injectSharedFolder) must never leak back
            // into it, or it compounds into a permanently corrupt double-wrapped id on the next
            // fetch (see namespaceSharedFolderIds/stripSharedFolderIds).
            folderData.items = stripSharedFolderIds(folderData.items);
            const { error: sharedErr } = await supabase.rpc('update_shared_folder', {
                p_owner_id: sharedOwnerId, p_folder_id: sharedRemoteFolderId, p_new_folder_data: folderData,
            });
            if (sharedErr) console.error('[collab] failed to save shared canvas:', sharedErr);
        }
    }
    // Returns true if a saved camera position (tx/ty/scale) was restored — the caller should
    // skip its own default centerOnContent() in that case, the same way applyFolderView already
    // prefers a folder's own saved lastView over re-centering when one exists.
    async function loadWorkspace() {
        if (!supabase || !appState.currentUser.id) return false;
        const { data, error } = await supabase
            .from('workspaces')
            .select('data, current_folder_id')
            .eq('user_id', appState.currentUser.id)
            .maybeSingle();
        if (error) { console.error('[workspace] load failed:', error); return false; }
        if (!data) return false; // first-ever login — keep the built-in starter content
        appState.folders = data.data.folders;
        appState.idCounter = data.data.idCounter;
        recomputeTopCardZIndex();
        if (Array.isArray(data.data.scheduledEvents)) scheduledEvents = data.data.scheduledEvents;

        const savedStack = data.data.historyStack;
        if (Array.isArray(savedStack) && savedStack.length && savedStack[0] === 'root' &&
            savedStack.every(id => appState.folders[id]) &&
            Number.isInteger(data.data.historyIndex) && data.data.historyIndex >= 0 && data.data.historyIndex < savedStack.length) {
            appState.historyStack = savedStack;
            appState.historyIndex = data.data.historyIndex;
            appState.currentFolderId = appState.historyStack[appState.historyIndex];
        } else if (data.current_folder_id && appState.folders[data.current_folder_id]) {
            // Older save made before historyStack was persisted — best effort:
            // still show root as root rather than treating the leaf as root.
            appState.currentFolderId = data.current_folder_id;
            appState.historyStack = appState.currentFolderId === 'root' ? ['root'] : ['root', appState.currentFolderId];
            appState.historyIndex = appState.historyStack.length - 1;
        }

        // Resume a collaboration session across a reload instead of it silently kicking the user
        // back to their own canvas — currentFolderId/historyStack/historyIndex above are already
        // this user's own correct resume position at this point, exactly what preSharedViewState
        // needs to fall back to if the shared view can't be re-entered for any reason (e.g. access
        // was revoked while away). Re-walks the whole chain (not just the leaf folder) via the
        // same helper a cross-user waypoint jump uses, so any nested position is restored exactly,
        // not just the collaboration's top level.
        if (data.data.lastSharedView && data.data.lastSharedView.ownerId && data.data.lastSharedView.folderId) {
            const { ownerId, folderId } = data.data.lastSharedView;
            preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
            const localKeys = await resolveSharedFolderChain(ownerId, folderId);
            if (localKeys) {
                appState.currentFolderId = localKeys[localKeys.length - 1];
                appState.historyStack = localKeys;
                appState.historyIndex = localKeys.length - 1;
            } else {
                preSharedViewState = null; // couldn't resume — stay on this user's own canvas instead
            }
        }

        if (typeof data.data.tx === 'number' && typeof data.data.ty === 'number' && typeof data.data.scale === 'number') {
            appState.tx = data.data.tx; appState.ty = data.data.ty; appState.scale = data.data.scale;
            return true;
        }
        return false; // older save made before tx/ty/scale was persisted — nothing to restore
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWorkspaceNow(); });
    window.addEventListener('pagehide', () => saveWorkspaceNow());

    // Paste anywhere in the app (note bodies, table cells, checklist items, titles, etc.) is
    // always plain text — it takes on whatever formatting is already active at the cursor
    // (bold/italic/color from the format bar, or none), never the styling/markup carried over
    // from wherever it was copied from. Scoped to contentEditable only: plain <input>/<textarea>
    // elements already paste as plain text natively, nothing to intercept there.
    document.addEventListener('paste', (e) => {
        const target = e.target.closest ? e.target.closest('[contenteditable="true"]') : null;
        if (!target) return;
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    });
    function afterHistoryChange() {
        if (!appState.folders[appState.currentFolderId]) {
            appState.currentFolderId = 'root';
            appState.historyStack = [appState.currentFolderId];
            appState.historyIndex = 0;
            render();
            centerOnContent();
            return;
        }
        // currentFolderId is still valid, so the navigation path the user actually
        // took to get here is still accurate — leave historyStack/historyIndex
        // alone. Overwriting it with a single-entry stack (the old behavior) made
        // whatever folder you were undoing/redoing inside of look like the root.
        render();
    }
    function undo() {
        if (!undoStack.length) return;
        redoStack.push(JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }));
        const state = JSON.parse(undoStack.pop());
        appState.folders = state.folders; appState.idCounter = state.idCounter;
        afterHistoryChange();
    }
    function redo() {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify({ folders: appState.folders, idCounter: appState.idCounter }));
        const state = JSON.parse(redoStack.pop());
        appState.folders = state.folders; appState.idCounter = state.idCounter;
        afterHistoryChange();
    }
    // Set by openTableCellContextMenu when a source-table cell is right-clicked, so the
    // canvas context menu knows which table/row/column "Delete column"/"Delete row" (and
    // their hover highlights) should act on. Cleared whenever the menu closes or blank
    // canvas space is right-clicked instead.
    let contextMenuTableCtx = null;
    function hideCanvasContextMenu() {
        canvasContextMenu.style.display = 'none';
        clearContextDeleteHighlight();
        contextMenuTableCtx = null;
    }
    function showCanvasContextMenu(clientX, clientY) {
        canvasContextMenu.style.display = 'flex';
        canvasContextMenu.style.left = clientX + 'px';
        canvasContextMenu.style.top = clientY + 'px';
        document.getElementById('canvas-ctx-undo').classList.toggle('disabled', undoStack.length === 0);
        document.getElementById('canvas-ctx-redo').classList.toggle('disabled', redoStack.length === 0);
        const hasCellCtx = !!contextMenuTableCtx;
        document.getElementById('canvas-ctx-del-col').style.display = hasCellCtx ? 'block' : 'none';
        document.getElementById('canvas-ctx-del-row').style.display = hasCellCtx ? 'block' : 'none';
    }
    canvas.addEventListener('contextmenu', (e) => {
        // Only show the undo/redo menu when right-clicking blank canvas space
        // (cards handle their own contextmenu and stop it from bubbling here).
        e.preventDefault();
        e.stopPropagation();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        contextMenuTableCtx = null;
        showCanvasContextMenu(e.clientX, e.clientY);
    });
    // Right-clicking a source-table data cell shows the same undo/redo menu plus
    // "Delete column"/"Delete row" for that cell's column/row.
    function openTableCellContextMenu(e, tableId, r, c) {
        e.preventDefault();
        e.stopPropagation();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        contextMenuTableCtx = { tableId, r, c };
        showCanvasContextMenu(e.clientX, e.clientY);
    }
    function clearContextDeleteHighlight() {
        document.querySelectorAll('.ctx-del-highlight').forEach(el => el.classList.remove('ctx-del-highlight'));
    }
    function highlightContextColumn(on) {
        clearContextDeleteHighlight();
        if (!on || !contextMenuTableCtx) return;
        const { tableId, c } = contextMenuTableCtx;
        document.querySelectorAll(`#item-${tableId} .item-table td[data-c="${c}"]`).forEach(td => td.classList.add('ctx-del-highlight'));
        const slot = document.querySelector(`#item-${tableId} .col-name-slot[data-c="${c}"]`);
        if (slot) slot.classList.add('ctx-del-highlight');
    }
    // Matched by [data-origin-table] rather than scoped to "#item-${tableId}" like the column
    // highlight above — a foreign row's tableId is never the id of anything actually in the DOM
    // (the one rendered top-level container is always the LOCAL table's own id), and its data-r
    // can collide with a local row sharing the same index, so both origin and row index are
    // needed together to pick out the right <td>s.
    function highlightContextRow(on) {
        clearContextDeleteHighlight();
        if (!on || !contextMenuTableCtx) return;
        const { tableId, r } = contextMenuTableCtx;
        document.querySelectorAll(`.item-table td[data-origin-table="${tableId}"][data-r="${r}"]`).forEach(td => td.classList.add('ctx-del-highlight'));
    }
    // Removing a column shifts every column after it down by one in the row data. Tags now
    // live on the row as a whole (not per cell), so they're untouched by column changes — no
    // remapping needed here anymore.
    function deleteContextColumn() {
        const ctx = contextMenuTableCtx;
        hideCanvasContextMenu();
        if (!ctx) return;
        const it = findItemById(ctx.tableId);
        if (!it || it.tableData[0].length <= 1) return;
        saveSnapshot();
        it.tableData.forEach(row => row.splice(ctx.c, 1));
        render();
    }
    // Removing a row shifts every row after it up by one (data rows only — the header row at
    // index 0 is never deletable here), remapping the row-tag map (keyed by row index) the
    // same way.
    function deleteContextRow() {
        const ctx = contextMenuTableCtx;
        hideCanvasContextMenu();
        if (!ctx) return;
        const it = resolveTableForEdit(ctx.tableId);
        if (!it || ctx.r === 0 || it.tableData.length <= 2) return;
        saveSnapshot();
        it.tableData.splice(ctx.r, 1);
        if (it.cellTags) {
            const remapped = {};
            Object.keys(it.cellTags).forEach(key => {
                const kr = Number(key);
                if (kr === ctx.r) return;
                remapped[kr > ctx.r ? kr - 1 : kr] = it.cellTags[key];
            });
            it.cellTags = remapped;
        }
        render();
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Every hover/pin panel (menu, messages, cart, profile, add, collab, sourceAdd —
            // see closeAllPanels) plus every standalone modal/overlay in the app, all in one go.
            closeAllPanels();
            if (document.getElementById('search-cards-modal-overlay').classList.contains('open')) closeSearchCardsModal();
            closeSharedCanvasView();
            closeDotbotUpgradeModal();
            closePricingOverlay();
            closeCellTagPicker();
            if (dotbotScheduleConversation) cancelDotbotScheduleConversation();
            clearSearch();
            if (searchInput) searchInput.blur();
            if (drawMode) setDrawMode(false);
            if (appState.addingKind) cancelAddingKind();
            if (scheduleViewMode) exitScheduleViewMode();
            // Escape switching the cursor back to Normal mode (tap vs. hold, same as the
            // other mode keys) is handled by the dedicated keydown/keyup pair further below —
            // this listener only handles Escape's other, unrelated "close everything" duties.
        }
        if (!(e.metaKey || e.ctrlKey)) return;
        const active = document.activeElement;
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (e.key === 'z' || e.key === 'Z') {
            if (isEditingText) return;
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
            return;
        }
        // Copy/Cut/Paste whatever's currently selected (shift-click or select-cursor-mode click
        // — see setupDraggingAndClicking) as whole cards — the same independent copy an Alt-drag
        // duplicate produces (see deepCloneItem/copySelectedCards), just reachable without a
        // drag. isEditingText/shiftKey/altKey are all excluded so this never steals an ordinary
        // text copy/cut/paste happening inside a note body, table cell, or title, and Cmd+X never
        // fires alongside Shift+X's unrelated "link selected cards" shortcut.
        if (!isEditingText && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C') && appState.selectedCardIds.length > 0) {
            e.preventDefault();
            copySelectedCards();
            return;
        }
        if (!isEditingText && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X') && appState.selectedCardIds.length > 0) {
            e.preventDefault();
            cutSelectedCards();
            return;
        }
        if (!isEditingText && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V') && cardClipboard.length > 0) {
            e.preventDefault();
            pasteClipboardCards();
            return;
        }
    });

    const ZOOM_MIN = 0.2, ZOOM_MAX = 2;
    // #dot-layer's own CSS left/top (see layoutDotLayer) — a fixed, viewport-independent offset,
    // NOT part of the scale/translate transform below. Needed to correctly phase-align the dot
    // pattern with world-space coordinates (see wrapPhase's comment) — this constant never
    // actually changes across resizes (only the box's width/height do, to stay big enough to
    // cover the viewport), so it's safe to compute once rather than re-derive on every resize.
    const DOT_LAYER_MARGIN = 200; // must comfortably exceed the largest possible phase-wrap wobble (28 * ZOOM_MAX)
    const dotLayerBaseX = -DOT_LAYER_MARGIN / 2, dotLayerBaseY = -DOT_LAYER_MARGIN / 2;
    // The dot grid is sized generously beyond the viewport (see layoutDotLayer) so it always
    // fully covers the screen even at ZOOM_MIN, the most zoomed-out the pattern itself is ever
    // actually drawn at (it tracks the real `scale` directly now — see applyTransform — so cards
    // and the grid they sit on always stay in exact proportion at any zoom level; it used to be
    // clamped to a separate, higher floor purely to keep this element's own pre-sized box
    // smaller, which visibly desynced the two below that floor). Since it's a fixed-size element,
    // though, panning it by the *raw* tx/ty (which grow without bound the further you pan) would
    // eventually carry it right off past that padding — but for an infinitely-repeating pattern,
    // shifting by any whole multiple of one tile's period (28 local units, i.e. 28*scale screen
    // px) looks completely identical to not shifting it at all. So only the sub-tile-period
    // *remainder* of tx/ty is ever applied as this element's own translate, keeping it
    // essentially stationary (just wobbling within one tile width/height) regardless of how far
    // tx/ty themselves have wandered.
    //
    // Crucially, that remainder has to be taken relative to the element's OWN base position
    // (dotLayerBaseX/Y), not tx/ty in isolation: the element sits at (dotLayerBaseX, dotLayerBaseY)
    // via plain CSS left/top (outside the transform entirely), so its rendered position after
    // `translate(d) scale(s)` is (dotLayerBaseX + d + local*s) versus a card's
    // (tx + local*s) — for those to land on the same screen pixel for every grid-aligned
    // `local`, d must equal (tx - dotLayerBaseX), and only the *wrapped* remainder of THAT
    // (mod period) — not of tx alone — is what's actually safe to substitute in (wrapping tx
    // alone silently drops the constant dotLayerBaseX offset, which is what let the two drift
    // out of phase by an amount that grew with zoom instead of being a fixed, harmless pixel
    // wobble).
    function wrapPhase(v, period) { return ((v % period) + period) % period; }
    function applyTransform() {
        world.style.transform = `translate(${appState.tx}px, ${appState.ty}px) scale(${appState.scale})`;
        // background-size on #dot-layer is a fixed 28px (see CSS) and never touched here — the
        // zoom is applied purely through this `scale()`, a compositor-only operation, so the
        // tile is only ever rasterized once and simply scaled smoothly from there on, instead
        // of being re-rasterized at a new size on every change (which is what caused the jitter
        // when this used to be done via background-size/background-position directly).
        // Same `scale` the cards themselves use (see world.style.transform above) — no separate
        // floor — so a card's position on the grid stays exact at every zoom level, not just
        // above some threshold.
        const period = 28 * appState.scale;
        const dx = wrapPhase(appState.tx - dotLayerBaseX, period);
        const dy = wrapPhase(appState.ty - dotLayerBaseY, period);
        dotLayer.style.transform = `translate(${dx}px, ${dy}px) scale(${appState.scale})`;
        updateZoomUI();
        updateContextMenuPosition();
        repositionAllRemoteCursors();
        // Keeps OUR OWN cursor broadcast live while panning/zooming without any real mouse
        // movement (see lastPointerClientX/Y's comment) — repositionAllRemoteCursors above only
        // repositions everyone ELSE's cursor on our screen using our new tx/ty; this is the
        // symmetric other half, telling THEM where ours now is.
        broadcastCursorPositionThrottled();
    }
    // Eases the camera to a new pan/zoom instead of snapping — used by every "jump to X"
    // navigation (goToCanvasItem, goToOutlineItem, goToWaypointCard) so the canvas visibly pans
    // there rather than teleporting. Sets an inline `transition` on #world/#dot-layer just long
    // enough to cover one ease, then clears it back to '' — never left on permanently, since
    // normal real-time dragging/pinch-zooming needs tx/ty/scale to apply instantly, not ease.
    // Using an inline style (rather than a toggled CSS class) keeps this one function fully
    // self-contained and lets each call site pick its own duration without needing multiple CSS
    // variants.
    let cameraTweenTimeout = null;
    function smoothPanTo(targetTx, targetTy, targetScale, durationMs = 450) {
        const transitionValue = `transform ${durationMs / 1000}s ease`;
        world.style.transition = transitionValue;
        dotLayer.style.transition = transitionValue;
        appState.tx = targetTx; appState.ty = targetTy; appState.scale = targetScale;
        applyTransform();
        clearTimeout(cameraTweenTimeout);
        cameraTweenTimeout = setTimeout(() => {
            world.style.transition = '';
            dotLayer.style.transition = '';
        }, durationMs + 20);
    }
    // Keeps the dot-layer element itself big enough (and positioned) to always cover the
    // screen no matter the current pan phase, at ZOOM_MIN — the smallest the pattern is ever
    // actually rendered at now that it tracks the real scale directly (scale() only ever grows it
    // bigger from there, which just over-covers further, never under-covers) — recomputed on load
    // and on window resize. Since transform-origin is 0 0 (the box's own top-left, not its
    // center), scaling stretches it away from that corner rather than from the middle, so the
    // box's local size is chosen such that its rendered size at the floor comes out to exactly
    // viewport+margin, which makes the *always-constant* `-margin/2` a valid static left/top for
    // every viewport size.
    function layoutDotLayer() {
        const w = window.innerWidth, h = window.innerHeight;
        const boxW = (w + DOT_LAYER_MARGIN) / ZOOM_MIN;
        const boxH = (h + DOT_LAYER_MARGIN) / ZOOM_MIN;
        dotLayer.style.width = boxW + 'px';
        dotLayer.style.height = boxH + 'px';
        dotLayer.style.left = dotLayerBaseX + 'px';
        dotLayer.style.top = dotLayerBaseY + 'px';
    }
    layoutDotLayer();
    window.addEventListener('resize', layoutDotLayer);
    // Trackpad pinch-to-zoom fires `wheel` events far faster than the display can actually
    // repaint (often 60-120/sec). Batching every call through here so at most one
    // applyTransform() happens per animation frame — tx/ty/scale themselves are still updated
    // synchronously and immediately on every event, so the zoom's own math (each event
    // anchoring off the latest values) is completely unaffected; only how often the visuals
    // actually get applied changes.
    let applyTransformRafId = null;
    function scheduleApplyTransform() {
        if (applyTransformRafId !== null) return;
        applyTransformRafId = requestAnimationFrame(() => { applyTransformRafId = null; applyTransform(); });
    }
    function updateContextMenuPosition() {
        if (contextMenu.style.display !== 'flex' || appState.contextMenuItemId == null) return;
        const it = findItemById(appState.contextMenuItemId);
        const el = document.getElementById('item-' + appState.contextMenuItemId);
        if (!it || !el) { contextMenu.style.display = 'none'; appState.contextMenuItemId = null; return; }
        const w = el.offsetWidth;
        contextMenu.style.left = (appState.tx + (it.x + w) * appState.scale + 8) + 'px';
        contextMenu.style.top = (appState.ty + it.y * appState.scale) + 'px';
    }
    function updateZoomUI() {
        const pct = Math.max(0, Math.min(1, (appState.scale - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)));
        const h = zoomTrack.clientHeight;
        const y = pct * h;
        zoomFill.style.height = y + 'px';
        zoomThumb.style.bottom = y + 'px';
    }

    // ---------- Drawing mode ----------
    let drawMode = false, drawColor = '#ffffff', drawLayer = 'front', drawTool = 'pen', drawSize = 3;
    let liveSvg = null, livePath = null, drawing = null;

    function pathToPoints(d) {
        const nums = d.match(/-?\d+(\.\d+)?/g);
        if (!nums) return [];
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
        return pts;
    }
    function distToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
    }
    function pathNearPoint(d, px, py, radius) {
        const pts = pathToPoints(d);
        if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= radius;
        for (let i = 0; i < pts.length - 1; i++) {
            if (distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= radius) return true;
        }
        return false;
    }
    function pointsToPath(pts) {
        if (!pts.length) return '';
        return 'M' + pts[0][0] + ',' + pts[0][1] + ' ' + pts.slice(1).map(p => 'L' + p[0] + ',' + p[1]).join(' ');
    }
    function makeLayerSVG(zIndex) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `position:absolute;top:0;left:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:${zIndex};`;
        return svg;
    }
    function ensureDrawings(folder) { if (!folder.drawings) folder.drawings = []; return folder.drawings; }

    // ---------- Card connections ("Data Conduit" links) ----------
    // Generic, scalable across any card type/count: a connection is just {id, fromId, toId}
    // stored per-folder. Any card kind can be a link target; today only 'flashcard' consumes
    // incoming data, but new consumers can hook into applyConnections() below.
    function ensureConnections(folder) { if (!folder.connections) folder.connections = []; return folder.connections; }
    // Shared by every place a new data-mode link gets created (Shift+X batch-link, click-to-link,
    // drag-to-link) so the fifty_links achievement counts all three the same way.
    function createConnection(conns, fromId, toId) {
        const conn = { id: 'conn_' + appState.idCounter++, fromId, toId };
        conns.push(conn);
        bumpAchievementStat('fifty_links');
        return conn;
    }

    // Keyboard shortcut for linking a multi-selection: select several cards (Shift-click, or
    // Select mode), then press Shift+X to wire them up without having to drag each connection
    // by hand. The first-selected card becomes the source; a connection is drawn from it to
    // every other selected card (a no-op for pairs that are already connected).
    function linkSelectedCards() {
        if (!appState.folders[appState.currentFolderId] || appState.folders[appState.currentFolderId].isSource) return;
        if (appState.selectedCardIds.length < 2) return;
        saveSnapshot();
        const conns = ensureConnections(appState.folders[appState.currentFolderId]);
        const [sourceId, ...targetIds] = appState.selectedCardIds;
        let madeAny = false;
        targetIds.forEach(targetId => {
            const exists = conns.some(c => c.fromId === sourceId && c.toId === targetId);
            if (!exists && isValidConnection(sourceId, targetId)) {
                createConnection(conns, sourceId, targetId);
                madeAny = true;
            }
        });
        if (!madeAny) { undoStack.pop(); return; }
        render();
    }

    // ---- Connector geometry: lines must exit exactly at a card's edge and never cut
    // through the interior of any card (their own endpoints or an unrelated card sitting
    // between them). ----
    function itemRect(item) { return { x: item.x, y: item.y, w: item.w || 100, h: item.h || 60 }; }
    function itemCenter(item) { const r = itemRect(item); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

    // Where the ray from a card's center towards `to` crosses that card's own boundary.
    function rectEdgePoint(box, from, to) {
        const dx = to.x - from.x, dy = to.y - from.y;
        if (!dx && !dy) return { x: from.x, y: from.y };
        let best = null;
        const consider = (t, x, y) => { if (t > 1e-6 && (best === null || t < best.t)) best = { t, x, y }; };
        if (dx !== 0) {
            let t = (box.x - from.x) / dx, y = from.y + t * dy;
            if (y >= box.y - 0.5 && y <= box.y + box.h + 0.5) consider(t, box.x, y);
            t = (box.x + box.w - from.x) / dx; y = from.y + t * dy;
            if (y >= box.y - 0.5 && y <= box.y + box.h + 0.5) consider(t, box.x + box.w, y);
        }
        if (dy !== 0) {
            let t = (box.y - from.y) / dy, x = from.x + t * dx;
            if (x >= box.x - 0.5 && x <= box.x + box.w + 0.5) consider(t, x, box.y);
            t = (box.y + box.h - from.y) / dy; x = from.x + t * dx;
            if (x >= box.x - 0.5 && x <= box.x + box.w + 0.5) consider(t, x, box.y + box.h);
        }
        return best ? { x: best.x, y: best.y } : { x: from.x, y: from.y };
    }
    // Does the segment (x1,y1)-(x2,y2) pass through the interior of `rect` (shrunk by
    // `margin` so lines that merely graze a boundary don't count as a collision)?
    function segmentHitsRect(x1, y1, x2, y2, rect, margin) {
        const xmin = rect.x + margin, ymin = rect.y + margin, xmax = rect.x + rect.w - margin, ymax = rect.y + rect.h - margin;
        if (xmax <= xmin || ymax <= ymin) return false;
        let t0 = 0, t1 = 1;
        const dx = x2 - x1, dy = y2 - y1;
        const p = [-dx, dx, -dy, dy], q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return false; }
            else {
                const r = q[i] / p[i];
                if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
                else { if (r < t0) return false; if (r < t1) t1 = r; }
            }
        }
        return t1 > t0 + 1e-6;
    }
    function pathAvoidsObstacles(points, obstacles, margin) {
        for (let i = 0; i < points.length - 1; i++) {
            for (const rect of obstacles) {
                if (segmentHitsRect(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, rect, margin)) return false;
            }
        }
        return true;
    }
    // Builds the point list for a connector: exits fromItem's edge, (optionally) enters
    // toItem's edge, and bends around any obstacle card whose interior the straight line
    // would otherwise cross.
    function computeConnectorPoints(fromItem, toTarget, isToItem, obstacles) {
        const fromBox = itemRect(fromItem), fromCenter = itemCenter(fromItem);
        const toCenter = isToItem ? itemCenter(toTarget) : toTarget;
        const p0 = rectEdgePoint(fromBox, fromCenter, toCenter);
        const p1 = isToItem ? rectEdgePoint(itemRect(toTarget), toCenter, fromCenter) : toCenter;
        const margin = 6;
        if (pathAvoidsObstacles([p0, p1], obstacles, margin)) return [p0, p1];
        const elbowA = { x: p0.x, y: p1.y }, elbowB = { x: p1.x, y: p0.y };
        if (pathAvoidsObstacles([p0, elbowA, p1], obstacles, margin)) return [p0, elbowA, p1];
        if (pathAvoidsObstacles([p0, elbowB, p1], obstacles, margin)) return [p0, elbowB, p1];
        return [p0, p1]; // dense clutter - best effort straight line
    }
    function pointsToLinePath(points) {
        return 'M' + points.map(p => p.x + ',' + p.y).join(' L');
    }

    // What data a source card can feed a connected consumer. Currently reads a table
    // (either the card itself, or the table inside a linked folder/source), returning
    // rows as {front, back} pairs. Extend this to support more source kinds as needed.
    // Resolves the actual 'table' item backing any of {table, source, folder} — the single
    // source-of-truth record for a deck's content AND its SM-2 memory state (interval,
    // easeFactor, dueDate, repetitions). Downstream cards (flashcard, statcard, shelf) never
    // store this data themselves — they only ever read/write it through this table, via the
    // streaming connection pipeline below.
    function findLinkedTable(fromItem) {
        if (fromItem.kind === 'table') return fromItem;
        if ((fromItem.kind === 'folder' || fromItem.kind === 'source') && fromItem.folderId && appState.folders[fromItem.folderId]) {
            return appState.folders[fromItem.folderId].items.find(i => i.kind === 'table') || null;
        }
        return null;
    }
    // Global lookup by table item id, regardless of which folder it lives in — unlike
    // findItemById (scoped to whichever folder is currently open), this is what lets a
    // flashcard's srsUpdate (fed via a source, possibly through a connected Stack card — see
    // CardStreamIO.shelf) reach a table that belongs to a DIFFERENT source's own subfolder than
    // whatever's currently on screen (see applySrsUpdateStream).
    function findTableById(tableId) {
        for (const fid in appState.folders) {
            const f = appState.folders[fid];
            const found = f && f.items && f.items.find(i => i.kind === 'table' && i.id === tableId);
            if (found) return found;
        }
        return null;
    }
    // item.stackSourceRows (see CardStreamIO.shelf/.source) is keyed by payload.originId, which
    // for a 'sourceRows' stream is the SOURCE CARD's own item id (see CardStreamIO.source's
    // getOutput: makeStreamPayload(item.id, 'sourceRows', ...)) — NOT its nested table's id. A
    // Stack can only ever be fed by a source connected to it on the SAME open canvas (connections
    // only exist within one folder's own items+connections — see isValidConnection), so
    // findItemById (scoped to currentFolderId) is exactly the right lookup here, no global search
    // needed.
    function connectedSourceCard(sourceItemId) {
        return findItemById(sourceItemId);
    }
    // A source card's own display name IS its nested subfolder's title (folders[it.folderId] —
    // same property its own card and the breadcrumb read/write) — used by a Stack card (see
    // renderShelfHTML) to show which sources it's currently aggregating.
    function folderTitleForConnectedSource(sourceItemId) {
        const srcCard = connectedSourceCard(sourceItemId);
        return (srcCard && appState.folders[srcCard.folderId] && appState.folders[srcCard.folderId].title) || 'Source';
    }
    // Same lookup as folderTitleForConnectedSource, but returns the folder id itself rather than
    // its title — used by startRenameShelfSourceRow to find what to actually write a rename back
    // to, and by handleShelfSourceRowClick to jump the canvas to the actual card.
    function folderIdForConnectedSource(sourceItemId) {
        const srcCard = connectedSourceCard(sourceItemId);
        return srcCard ? srcCard.folderId : null;
    }
    // Used by every source-table cell/tag/row editing function so they transparently work
    // regardless of which folder the target table actually lives in — findTableById is a strict
    // superset of findItemById for this purpose, checked first since it's the one that actually
    // needs to reach outside the current folder.
    function resolveTableForEdit(id) {
        return findTableById(id) || findItemById(id);
    }

    // ---------- SM-2 Spaced Repetition ----------
    // Per-row memory state lives on the table itself (table.srsMeta[rowIndex]), keyed by the
    // row's position in tableData — never on the flashcard/statcard/shelf that merely displays
    // it, so the schedule survives deleting and recreating any downstream card.
    function defaultSrsState() {
        return { interval: 1, easeFactor: 2.5, dueDate: Date.now(), repetitions: 0 };
    }
    function ensureSrsMeta(table) {
        if (!table.srsMeta) table.srsMeta = {};
        return table.srsMeta;
    }
    function getSrsForRow(table, rowIndex) {
        const meta = ensureSrsMeta(table);
        if (!meta[rowIndex]) meta[rowIndex] = defaultSrsState();
        return meta[rowIndex];
    }
    // Maps our four grading buttons onto the classic SM-2 0-5 quality scale.
    const SM2_QUALITY = { noclue: 0, wrong: 1, hard: 3, easy: 5 };
    // Classic SM-2: given a card's current {interval, easeFactor, repetitions} and a 0-5
    // quality score, returns the updated memory state (mutates and returns `card`).
    function calculateSM2(card, quality) {
        if (quality < 3) {
            // Incorrect answers reset repetition streak and interval
            card.repetitions = 0;
            card.interval = 1;
        } else {
            // Correct answers advance the streak and interval
            if (card.repetitions === 0) {
                card.interval = 1;
            } else if (card.repetitions === 1) {
                card.interval = 6;
            } else {
                card.interval = Math.round(card.interval * card.easeFactor);
            }
            card.repetitions++;
        }
        // Adjust the Ease Factor based on SM-2 formula
        card.easeFactor = card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (card.easeFactor < 1.3) card.easeFactor = 1.3; // Cap it so it doesn't break
        // Calculate next due date timestamp
        card.dueDate = Date.now() + card.interval * 24 * 60 * 60 * 1000;
        return card;
    }

    // Returns { rows, headers } (or null) rather than a bare rows array — `headers` is the
    // table's own header row (plain text, one per column) and each row now also carries `cells`
    // (the RAW per-column HTML, every column, not just front/back) alongside the existing
    // front/back/rowIndex/etc — so a downstream game card can apply its OWN per-side column
    // selection (see gameConfig/resolveGameFace) instead of only ever seeing column 0/1 flattened
    // to plain text. `front`/`back` (column 0/1, stripped) are kept exactly as before so every
    // existing consumer that destructures {rows} the old way keeps working unchanged.
    function extractCardsFromSource(fromItem) {
        const table = findLinkedTable(fromItem);
        if (!table || !table.tableData || table.tableData.length < 2) return null;
        const rows = [];
        table.tableData.forEach((r, rowIndex) => {
            if (rowIndex === 0) return; // header row
            if (!r.some(c => stripHtml(c || '').trim() !== '')) return; // skip blank rows
            rows.push({
                front: stripHtml(r[0] || ''),
                back: stripHtml((r.length > 1 ? r[1] : r[0]) || ''),
                cells: r.slice(),
                rowIndex,
                // originTableId lets a downstream consumer (an srsUpdate flowing back, or a
                // filter card) always find its way back to the REAL table this row came from —
                // essential once rows can flow through a filter or a merged source and no longer
                // necessarily share the receiving card's own findLinkedTable() result. tags is
                // the row's tag ids on ITS OWN table (see ensureCellTags) — a filter card matches
                // against these; they mean nothing outside the context of originTableId.
                originTableId: table.id,
                tags: (table.cellTags && table.cellTags[rowIndex]) || [],
                srs: Object.assign({}, getSrsForRow(table, rowIndex))
            });
        });
        if (!rows.length) return null;
        return { rows, headers: table.tableData[0].map(h => stripHtml(h || '')) };
    }

    // Applies an inbound 'srsUpdate' payload (pushed back by a downstream flashcard after a
    // grading action) onto the source-of-truth table's per-row memory state. Routes by
    // originTableId when the payload carries one (set on every row by extractCardsFromSource) —
    // that's the row's REAL home table, which is no longer necessarily this receiving item's own
    // findLinkedTable() result once a filter card or a merged source sits in between; falls back
    // to the old direct-link behavior for payloads that predate that field.
    function applySrsUpdateStream(item, payload) {
        if (payload.streamType !== 'srsUpdate') return;
        const { rowIndex, srs, originTableId } = payload.delta || {};
        if (rowIndex == null || !srs) return;
        const table = (originTableId != null && findTableById(originTableId)) || findLinkedTable(item);
        if (!table) return;
        // "Mastered" = the SM-2 interval (in days — see calculateSM2) crossing 90+. masteredCounted
        // rides along in this same row-meta blob (persisted with the rest of the workspace JSON via
        // scheduleWorkspaceSave) so a word is only ever counted toward master_250_words once, even
        // if a later wrong answer drops its interval back down and it re-crosses 90 again later.
        const meta = ensureSrsMeta(table);
        const prev = meta[rowIndex];
        if (prev && prev.masteredCounted) {
            srs.masteredCounted = true;
        } else if (srs.interval >= 90) {
            srs.masteredCounted = true;
            bumpAchievementStat('master_250_words');
        }
        meta[rowIndex] = srs;
    }

    // CanvasStreamPayload — the single standardized message shape every card kind uses to
    // talk to any other card kind over a connection. Consumers must only branch on
    // `streamType`/`delta` shape — never on which kind produced or will receive it.
    function makeStreamPayload(originId, streamType, delta) {
        return { originId, streamType, timestamp: Date.now(), delta: delta || {} };
    }
    // Per-rating difference between two cumulative `ratings` tallies (e.g. a flashcard's
    // lifetime counts) — used to turn a session's live/baseline snapshot into a session-scoped
    // delta, the same way `seen` counts are diffed.
    function diffRatings(live, base) {
        const keys = ['noclue', 'wrong', 'hard', 'easy'];
        const out = {};
        keys.forEach(k => { out[k] = ((live && live[k]) || 0) - ((base && base[k]) || 0); });
        return out;
    }

    // Sums the current 'performance' output of every card a source/table/folder card feeds
    // content to (i.e. every game connected downstream of it), into one combined payload.
    // This is how a stats card linked to a shared data source shows totals across *all*
    // games built on top of it, without the source ever inspecting what kind those games are
    // — it just asks each connected card's own registered IO for its current performance
    // output, exactly like propagateCanvasStreams itself does.
    function aggregateDownstreamPerformance(sourceItem, ctx) {
        if (!ctx || !ctx.conns || !ctx.items) return null;
        const downstreamConns = ctx.conns.filter(c => c.fromId === sourceItem.id);
        if (!downstreamConns.length) return null;
        let seenTotal = 0;
        const ratingsTotal = { noclue: 0, wrong: 0, hard: 0, easy: 0 };
        let any = false;
        downstreamConns.forEach(c => {
            const gameItem = ctx.items.find(i => i.id === c.toId);
            if (!gameItem) return;
            const gameIO = CardStreamIO[gameItem.kind];
            if (!gameIO || !gameIO.outputs || !gameIO.outputs.includes('performance') || !gameIO.getOutput) return;
            let perf = gameIO.getOutput(gameItem, ctx);
            if (!perf) return;
            if (!Array.isArray(perf)) perf = [perf];
            perf.forEach(p => {
                if (!p || p.streamType !== 'performance') return;
                any = true;
                seenTotal += (p.delta && p.delta.seen) || 0;
                const r = (p.delta && p.delta.ratings) || {};
                Object.keys(ratingsTotal).forEach(k => { ratingsTotal[k] += r[k] || 0; });
            });
        });
        if (!any) return null;
        return makeStreamPayload(sourceItem.id, 'performance', { seen: seenTotal, ratings: ratingsTotal });
    }

    // Shared by CardStreamIO.filter's getOutput and the filter card's own on-canvas row count —
    // a row passes through if it has at least one selected tag ("or", the default) or every
    // selected tag ("and"). No tags selected at all means everything passes through unfiltered.
    function applyFilterToRows(item, rows) {
        const selected = item.filterTagIds || [];
        if (!selected.length) return rows;
        return rows.filter(r => {
            const rowTags = (r && r.tags) || [];
            return item.filterMode === 'and' ? selected.every(t => rowTags.includes(t)) : selected.some(t => rowTags.includes(t));
        });
    }
    // Every distinct tag currently seen across a filter card's incoming rows, resolved (via each
    // row's originTableId) to its real {id, name, color} definition on whichever source it came
    // from — a filter has no source of its own, so the only tags it can ever offer are whatever
    // is actually flowing into it right now.
    function collectAvailableFilterTags(rows) {
        const seen = new Map();
        (rows || []).forEach(r => {
            const originTable = r.originTableId != null ? findTableById(r.originTableId) : null;
            if (!originTable) return;
            (r.tags || []).forEach(tagId => {
                if (seen.has(tagId)) return;
                const tag = (originTable.tags || []).find(t => t.id === tagId);
                if (tag) seen.set(tagId, tag);
            });
        });
        return Array.from(seen.values());
    }

    // CardStreamIO — interface table for the canvas's data-conduit connections. Each entry
    // describes one card kind's stream capabilities: `inputs`/`outputs` list the
    // CanvasStreamPayload streamTypes it can consume/produce; `onStream` is called for every
    // inbound payload whose streamType is in `inputs`; `getOutput` produces this card's current
    // outbound payload(s) (return a single payload, an array of payloads, or null/undefined).
    // Cards must react only to `payload.streamType` / `payload.delta` — never to
    // `fromItem.kind` or `toItem.kind` — so any future card kind can be wired to any other
    // without touching propagateCanvasStreams or this table's call sites.
    const CardStreamIO = {
        table: {
            inputs: ['srsUpdate'],
            outputs: ['content', 'performance'],
            onStream: applySrsUpdateStream,
            getOutput(item, ctx) {
                const extracted = extractCardsFromSource(item);
                const out = [];
                if (extracted && extracted.rows.length) out.push(makeStreamPayload(item.id, 'content', { rows: extracted.rows, headers: extracted.headers }));
                const perf = aggregateDownstreamPerformance(item, ctx);
                if (perf) out.push(perf);
                return out.length ? out : null;
            }
        },
        // Distinct from table/folder below (not a shared object) because it also emits a
        // 'sourceRows' output — its OWN rows only, deliberately a SEPARATE streamType from
        // 'content' — for a connected Stack card (kind:'shelf', see CardStreamIO.shelf below) to
        // aggregate across several sources at once. A source no longer ACCEPTS 'sourceRows' as an
        // input (that's what used to let two sources merge directly into each other — removed;
        // aggregating multiple sources now only ever happens via a Stack in between), so
        // source-to-source connections are rejected by isValidConnection's ordinary type-matching
        // rule with no special-casing needed.
        source: {
            inputs: ['srsUpdate'],
            outputs: ['content', 'performance', 'sourceRows'],
            onStream: applySrsUpdateStream,
            getOutput(item, ctx) {
                const extracted = extractCardsFromSource(item);
                const ownRows = extracted ? extracted.rows : [];
                const out = [];
                if (ownRows.length) {
                    out.push(makeStreamPayload(item.id, 'content', { rows: ownRows, headers: extracted.headers }));
                    out.push(makeStreamPayload(item.id, 'sourceRows', { rows: ownRows }));
                }
                const perf = aggregateDownstreamPerformance(item, ctx);
                if (perf) out.push(perf);
                return out.length ? out : null;
            }
        },
        folder: {
            inputs: ['srsUpdate'],
            outputs: ['content', 'performance'],
            onStream: applySrsUpdateStream,
            getOutput(item, ctx) {
                const extracted = extractCardsFromSource(item);
                const out = [];
                if (extracted && extracted.rows.length) out.push(makeStreamPayload(item.id, 'content', { rows: extracted.rows, headers: extracted.headers }));
                const perf = aggregateDownstreamPerformance(item, ctx);
                if (perf) out.push(perf);
                return out.length ? out : null;
            }
        },
        // A pass-through content filter: connect a source into it, then it into a flashcard (or
        // another filter, or another source), and only rows matching the selected tags flow
        // onward — never touches the upstream table directly, so the same source can feed
        // several differently-filtered subdecks at once. incomingRows accumulates inbound
        // 'content' rows, reset once per render (see propagateCanvasStreams) rather than
        // consumed/cleared inside getOutput — getOutput can be called once per downstream
        // connection in the same render, and clearing it there would starve every call after the
        // first.
        filter: {
            inputs: ['content'],
            outputs: ['content'],
            onStream(item, payload) {
                if (payload.streamType !== 'content' || !payload.delta || !Array.isArray(payload.delta.rows)) return;
                item.incomingRows = (item.incomingRows || []).concat(payload.delta.rows);
                // Passed straight through to whatever this filter feeds (see getOutput below) so a
                // game card downstream of a filter still sees real column names, not just "Column N".
                if (payload.delta.headers) item.incomingHeaders = payload.delta.headers;
            },
            getOutput(item) {
                const filtered = applyFilterToRows(item, item.incomingRows || []);
                return filtered.length ? makeStreamPayload(item.id, 'content', { rows: filtered, headers: item.incomingHeaders }) : null;
            }
        },
        flashcard: {
            inputs: ['content'],
            outputs: ['performance', 'srsUpdate'],
            onStream(item, payload) {
                if (payload.streamType !== 'content') return;
                const rows = payload.delta.rows;
                if (rows && rows.length) {
                    // Only reset shuffle order / position when the underlying deck actually
                    // changed shape (rows added/removed/edited) — NOT when only the SM-2 srs
                    // fields changed (e.g. because we just streamed our own grading update back
                    // up to the source and it echoed back down), which would otherwise yank the
                    // user back to card #1 every single time they rate a card.
                    const prevKey = (item.cards || []).map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const newKey = rows.map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const structuralChange = prevKey !== newKey;
                    item.cards = rows;
                    if (structuralChange) { item.fcOrder = []; item.fcIndex = 0; item.fcFlipped = false; }
                }
                // Real column names for the right-click options panel (see renderGameOptionsHTML)
                // — falls back to "Column N" labels there when this is empty (e.g. no source
                // linked yet, or a chain that doesn't preserve header names).
                if (payload.delta.headers) item.gameHeaders = payload.delta.headers;
            },
            getOutput(item) {
                const out = [makeStreamPayload(item.id, 'performance', {
                    seen: item.fcSeenCount || 0,
                    totalCards: (item.cards || []).length,
                    ratings: Object.assign({ noclue: 0, wrong: 0, hard: 0, easy: 0 }, item.fcStats || {})
                })];
                // Re-broadcasts the most recently graded card's new SM-2 state so the source
                // table (the system of record) stays in sync on every propagation pass.
                if (item.pendingSrsUpdate) out.push(makeStreamPayload(item.id, 'srsUpdate', item.pendingSrsUpdate));
                return out;
            }
        },
        // Typeright: see one side, type the other — same streaming shape as flashcard (content
        // in, performance/srsUpdate out), just its own tr*-prefixed play state (trIndex/trOrder/
        // trInput/trStats) instead of fc*, since it's a distinct gameplay loop (typed-answer
        // grading, not flip+rate).
        typeright: {
            inputs: ['content'],
            outputs: ['performance', 'srsUpdate'],
            onStream(item, payload) {
                if (payload.streamType !== 'content') return;
                const rows = payload.delta.rows;
                if (rows && rows.length) {
                    const prevKey = (item.cards || []).map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const newKey = rows.map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const structuralChange = prevKey !== newKey;
                    item.cards = rows;
                    if (structuralChange) { item.trOrder = []; item.trIndex = 0; item.trInput = ''; item.trChecked = false; }
                }
                if (payload.delta.headers) item.gameHeaders = payload.delta.headers;
            },
            getOutput(item) {
                const out = [makeStreamPayload(item.id, 'performance', {
                    seen: item.trSeenCount || 0,
                    totalCards: (item.cards || []).length,
                    ratings: Object.assign({ noclue: 0, wrong: 0, hard: 0, easy: 0 }, item.trStats || {})
                })];
                if (item.pendingSrsUpdate) out.push(makeStreamPayload(item.id, 'srsUpdate', item.pendingSrsUpdate));
                return out;
            }
        },
        statcard: {
            inputs: ['performance'],
            onStream(item, payload) {
                item.streamCache = item.streamCache || {};
                const existing = item.streamCache[payload.originId];
                // A stopwatch re-broadcasts several sessions for the same origin at once (so a
                // connected shelf can catch all of them); a plain stats card should only ever
                // keep the most recent one. This is decided purely from the payload shape
                // (`delta.sessionStartedAt`), never from what kind sent it — if either payload
                // isn't session-scoped (no sessionStartedAt), there's no ambiguity and the
                // newest write simply wins, same as before.
                if (existing) {
                    const incomingStart = payload.delta && payload.delta.sessionStartedAt;
                    const existingStart = existing.delta && existing.delta.sessionStartedAt;
                    if (incomingStart != null && existingStart != null && incomingStart < existingStart) return;
                }
                item.streamCache[payload.originId] = payload;
            }
        },
        stopwatch: {
            inputs: ['performance'],
            outputs: ['performance'],
            onStream(item, payload) {
                if (payload.streamType !== 'performance' || !item.swSessionActive) return;
                item.swSessionLive[payload.originId] = payload.delta;
                if (!item.swSessionBaseline[payload.originId]) item.swSessionBaseline[payload.originId] = payload.delta;
            },
            getOutput(item) {
                const payloads = [];
                if (item.swSessionActive) {
                    Object.keys(item.swSessionLive).forEach(originId => {
                        const live = item.swSessionLive[originId] || {};
                        const base = item.swSessionBaseline[originId] || {};
                        payloads.push(makeStreamPayload(originId, 'performance', {
                            seen: (live.seen || 0) - (base.seen || 0), totalCards: live.totalCards,
                            ratings: diffRatings(live.ratings, base.ratings),
                            sessionId: item.swSessionId, sessionStartedAt: item.swSessionStartedAt, final: false
                        }));
                    });
                } else if (item.swSessions && item.swSessions.length) {
                    // Re-broadcast every session still held in the 3-slot buffer (not just the
                    // latest) so a shelf connected at any point can catch ones it missed. A
                    // plain stats card linked straight to the stopwatch sees all of these too,
                    // but its own onStream keeps only the one with the newest sessionStartedAt.
                    item.swSessions.forEach(session => {
                        session.payloads.forEach(p => {
                            payloads.push(makeStreamPayload(p.originId, 'performance', Object.assign({}, p.delta, { sessionId: session.sessionId, sessionStartedAt: session.startedAt, final: true })));
                        });
                    });
                }
                return payloads;
            }
        },
        // "Stack" in the UI (kind stays 'shelf' internally — see the naming note near its
        // add-menu entry). Dual-purpose: the original job (archiving stopwatch session
        // performance data, below) is untouched; it ALSO now accepts 'sourceRows' from any number
        // of directly-connected source cards and re-emits their combined rows as one 'content'
        // stream, so a flashcard (or filter, or anything else that accepts 'content') plugged
        // into a Stack plays every connected source's rows at once — the same aggregation
        // source-to-source merging used to do, just via an explicit hub card instead of two
        // sources linking directly to each other. stackSourceRows is reset once per render (see
        // propagateCanvasStreams), same pattern as source.mergeCache used to be.
        shelf: {
            inputs: ['performance', 'sourceRows'],
            outputs: ['performance', 'content'],
            onStream(item, payload) {
                if (payload.streamType === 'sourceRows') {
                    item.stackSourceRows = item.stackSourceRows || {};
                    item.stackSourceRows[payload.originId] = payload.delta.rows || [];
                    return;
                }
                if (payload.streamType !== 'performance' || !payload.delta || !payload.delta.final || !payload.delta.sessionId) return;
                item.shelfSessions = item.shelfSessions || [];
                const sid = payload.delta.sessionId;
                let session = item.shelfSessions.find(s => s.sessionId === sid);
                if (!session) {
                    session = { sessionId: sid, savedAt: Date.now(), payloads: [], label: 'Session ' + (item.shelfSessions.length + 1) };
                    item.shelfSessions.push(session);
                    item.shelfSelectedId = session.sessionId;
                }
                const cleanDelta = Object.assign({}, payload.delta);
                delete cleanDelta.final; delete cleanDelta.sessionId;
                const existing = session.payloads.find(p => p.originId === payload.originId);
                if (existing) existing.delta = cleanDelta; else session.payloads.push({ originId: payload.originId, delta: cleanDelta });
            },
            getOutput(item) {
                const out = [];
                const session = (item.shelfSessions || []).find(s => s.sessionId === item.shelfSelectedId);
                if (session) session.payloads.forEach(p => out.push(makeStreamPayload(p.originId, 'performance', p.delta)));
                const combinedRows = [].concat(...Object.values(item.stackSourceRows || {}));
                if (combinedRows.length) out.push(makeStreamPayload(item.id, 'content', { rows: combinedRows }));
                return out.length ? out : null;
            }
        },
    };

    // Gatekeeper for every connection-creation entry point (drag-to-link and multi-select
    // link). Rejects a prospective fromId -> toId edge before it's ever added to
    // folder.connections, so propagateCanvasStreams never has to deal with a self-link, a
    // stream-type mismatch, or a cycle. All three checks are driven purely by CardStreamIO's
    // declared inputs/outputs and the existing connection graph — never by card kind — so any
    // new card kind just needs to declare its inputs/outputs correctly to be validated for free.
    // A Stack (kind:'shelf' — see its add-menu entry) holds exactly one kind of thing at a
    // time: either stopwatch sessions or source rows, never both mixed together (its own UI,
    // renderShelfHTML, already renders these as two entirely separate sections). Returns null
    // for any card kind that doesn't feed a shelf meaningfully at all (isValidConnection's
    // ordinary type-matching rule already handles those).
    function shelfInputCategory(kind) {
        if (kind === 'stopwatch') return 'sessions';
        const cfg = CardStreamIO[kind];
        if (cfg && cfg.outputs && cfg.outputs.includes('sourceRows')) return 'sources';
        return null;
    }
    function isValidConnection(fromId, toId) {
        // Rule 1: no self-links.
        if (fromId === toId) return false;

        const folder = appState.folders[appState.currentFolderId];
        if (!folder) return false;
        const fromItem = folder.items.find(i => i.id === fromId);
        const toItem = folder.items.find(i => i.id === toId);
        if (!fromItem || !toItem) return false;

        // Rule 2: type matching. Either card kind must be missing from CardStreamIO, or
        // missing outputs/inputs entirely, to be blocked outright; otherwise at least one of
        // the source's outputs must be accepted by the target's inputs.
        const fromConfig = CardStreamIO[fromItem.kind];
        const toConfig = CardStreamIO[toItem.kind];
        if (!fromConfig || !toConfig || !fromConfig.outputs || !toConfig.inputs) return false;
        const hasMatchingType = fromConfig.outputs.some(outType => toConfig.inputs.includes(outType));
        if (!hasMatchingType) return false;

        const conns = ensureConnections(folder);

        // Rule 2.5: a Stack already fed by one category (sessions or sources — see
        // shelfInputCategory) rejects a new connection from the OTHER category outright, even
        // though the streamType-level check above would otherwise allow it.
        if (toItem.kind === 'shelf') {
            const newCategory = shelfInputCategory(fromItem.kind);
            if (newCategory) {
                const existingCategories = new Set(
                    conns.filter(c => c.toId === toId)
                        .map(c => {
                            const other = folder.items.find(i => i.id === c.fromId);
                            return other ? shelfInputCategory(other.kind) : null;
                        })
                        .filter(Boolean)
                );
                if (existingCategories.size && !existingCategories.has(newCategory)) return false;
            }
        }

        // Rule 3: no circular dependencies. If a path already exists from toId back to
        // fromId through the current connection graph, adding fromId -> toId would close a
        // loop, so walk forward from toId (BFS) and bail if we ever land back on fromId.
        let currentTargets = [toId];
        const visited = new Set();
        while (currentTargets.length > 0) {
            const nextId = currentTargets.shift();
            if (nextId === fromId) return false; // Loop detected!
            if (!visited.has(nextId)) {
                visited.add(nextId);
                const children = conns.filter(c => c.fromId === nextId).map(c => c.toId);
                currentTargets.push(...children);
            }
        }
        return true;
    }

    // Cancels a click-to-link gesture already in progress (see handleDataModeClick), removing
    // the "armed" highlight from whichever card was first-clicked. Safe to call even when
    // nothing is pending.
    function clearDataLinkPending() {
        if (appState.dataLinkPendingId != null) {
            const prevEl = document.getElementById('item-' + appState.dataLinkPendingId);
            if (prevEl) prevEl.classList.remove('link-source-armed');
        }
        appState.dataLinkPendingId = null;
    }
    // The click-based counterpart to dragging a connection line from one card to another (see
    // startConnectionDrag) — called when a data-mode gesture on `it` turns out to be a plain
    // click rather than a drag. First click arms `it` as the pending link source (highlighted via
    // .link-source-armed, re-applied every render — see the main render loop); a second click on
    // a DIFFERENT card completes the link exactly as a drag between them would, subject to the
    // same isValidConnection rules. Clicking the already-armed card again cancels it instead of
    // linking it to itself.
    function handleDataModeClick(it, el) {
        if (appState.dataLinkPendingId == null) {
            appState.dataLinkPendingId = it.id;
            el.classList.add('link-source-armed');
            return;
        }
        const fromId = appState.dataLinkPendingId;
        clearDataLinkPending();
        if (fromId === it.id) return; // clicked the armed card again — just cancel
        if (!isValidConnection(fromId, it.id)) return;
        saveSnapshot();
        const conns = ensureConnections(appState.folders[appState.currentFolderId]);
        createConnection(conns, fromId, it.id);
        render();
    }

    // Generic, scalable across any number of card kinds/connections: walks every connection,
    // asks the source card's registered IO for its current output payload(s), and — purely by
    // matching payload.streamType against the target card's declared input capability, never by
    // checking either card's identity/kind — delivers matching payloads to the target's onStream.
    // Multiple passes let short connection chains (A -> B -> C) settle within one render.
    function propagateCanvasStreams(folderObj) {
        const items = folderObj.items;
        const conns = ensureConnections(folderObj);
        const ctx = { folderObj, items, conns };
        const PASSES = 4;
        // Stat cards never persist their own data — they only ever reflect whatever's
        // currently flowing to them. Clearing the cache before each render's propagation
        // (rather than only ever merging into it) is what lets a connected shelf's session
        // selector actually change what a stat card shows: without this, once a session's
        // data landed in streamCache it would stick there forever, since the onStream 'keep
        // newest' guard below exists to dedupe *within* one delivery pass, not to pin the
        // card to whichever session happened to arrive first across separate renders.
        items.forEach(it => {
            if (it.kind === 'statcard') it.streamCache = {};
            // Same reasoning as statcard.streamCache above, for the two other content-aggregating
            // kinds: both only ever reflect what's CURRENTLY flowing in, recomputed fresh every
            // render — reset here (not consumed inside getOutput) so a getOutput called more than
            // once per render (once per downstream connection) always sees the same accumulated
            // set instead of the first caller draining it for everyone after.
            if (it.kind === 'shelf') it.stackSourceRows = {};
            if (it.kind === 'filter') it.incomingRows = [];
        });
        // Delivers whatever `sender` currently outputs to `receiver`'s input, purely by
        // matching declared streamTypes — never by kind. Called both ways per connection
        // below so a card the user drew as the *target* of a link (e.g. a flashcard fed by a
        // source) can still push data of a different streamType back the other way (e.g. an
        // 'srsUpdate' flowing from flashcard -> source) over that same connection, without
        // requiring the user to draw a second link in reverse.
        function deliver(sender, receiver) {
            if (!sender || !receiver) return;
            const senderIO = CardStreamIO[sender.kind];
            const receiverIO = CardStreamIO[receiver.kind];
            if (!senderIO || !senderIO.getOutput || !receiverIO || !receiverIO.inputs || !receiverIO.onStream) return;
            let payloads = senderIO.getOutput(sender, ctx);
            if (!payloads) return;
            if (!Array.isArray(payloads)) payloads = [payloads];
            payloads.forEach(payload => {
                if (payload && receiverIO.inputs.includes(payload.streamType)) {
                    receiverIO.onStream(receiver, payload, ctx);
                }
            });
        }
        for (let pass = 0; pass < PASSES; pass++) {
            conns.forEach(c => {
                const fromItem = items.find(i => i.id === c.fromId);
                const toItem = items.find(i => i.id === c.toId);
                deliver(fromItem, toItem);
                deliver(toItem, fromItem);
            });
        }

        // Source-of-truth integrity: a flashcard's real word data is only ever supposed to
        // exist while it's actively fed by a connected table/source/folder. If that connection
        // is gone (line deleted, source deleted, etc — this check doesn't care how, it just
        // looks at the current graph) but the deck still carries real content from a past
        // connection (a rowIndex/srs field is the tell), collapse it back to the generic
        // placeholder deck rather than letting real language data linger detached from its
        // source. Checked every render, not on a specific event, so it's robust to any path
        // that can sever the link.
        items.forEach(it => {
            if (it.kind !== 'flashcard' && it.kind !== 'typeright') return;
            const cards = it.cards || [];
            const looksReal = cards.some(c => c && (c.rowIndex != null || c.srs));
            if (!looksReal) return;
            const stillFed = conns.some(c => {
                const otherId = c.fromId === it.id ? c.toId : (c.toId === it.id ? c.fromId : null);
                if (!otherId) return false;
                const other = items.find(i => i.id === otherId);
                return other && CardStreamIO[other.kind] && (CardStreamIO[other.kind].outputs || []).includes('content');
            });
            if (!stillFed) {
                if (it.kind === 'flashcard') {
                    it.cards = defaultFlashcardDeck();
                    it.fcOrder = [];
                    it.fcIndex = 0;
                    it.fcFlipped = false;
                    it.fcStats = {};
                    it.fcSeenCount = 0;
                } else {
                    it.cards = [];
                    it.trOrder = [];
                    it.trIndex = 0;
                    it.trInput = '';
                    it.trChecked = false;
                    it.trStats = {};
                    it.trSeenCount = 0;
                }
            }
        });
    }

    function applyConnections(folderObj) {
        propagateCanvasStreams(folderObj);
    }

    function renderConnectionsLayer(folderObj, currentItems) {
        const layer = makeLayerSVG(1);
        layer.classList.add('connections-layer');
        const validIds = new Set(currentItems.map(i => i.id));
        const conns = ensureConnections(folderObj);
        folderObj.connections = conns.filter(c => validIds.has(c.fromId) && validIds.has(c.toId));
        folderObj.connections.forEach(c => {
            const fromItem = currentItems.find(i => i.id === c.fromId);
            const toItem = currentItems.find(i => i.id === c.toId);
            if (!fromItem || !toItem) return;
            const obstacles = currentItems.filter(i => i.id !== fromItem.id && i.id !== toItem.id).map(itemRect);
            const points = computeConnectorPoints(fromItem, toItem, true, obstacles);
            const d = pointsToLinePath(points);

            const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            visible.setAttribute('d', d);
            visible.setAttribute('stroke', 'var(--brand)');
            visible.setAttribute('stroke-width', '2');
            visible.setAttribute('fill', 'none');
            visible.setAttribute('stroke-linejoin', 'round');
            visible.style.pointerEvents = 'none';

            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hit.setAttribute('d', d);
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', '14');
            hit.setAttribute('fill', 'none');
            hit.style.pointerEvents = 'stroke';
            hit.style.cursor = 'pointer';
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = 'Click to remove this connection';
            hit.appendChild(title);
            hit.addEventListener('pointerdown', (e) => e.stopPropagation());
            hit.addEventListener('click', (e) => {
                e.stopPropagation();
                saveSnapshot();
                folderObj.connections = folderObj.connections.filter(x => x.id !== c.id);
                render();
            });

            layer.appendChild(visible);
            layer.appendChild(hit);
        });
        return layer;
    }

    // Drag-to-link: in Data mode (or with X held), dragging from a card draws a
    // live preview line to the pointer; dropping on another card creates a persistent
    // connection between them.
    function startConnectionDrag(e, it, el) {
        saveSnapshot();
        const downX = e.clientX, downY = e.clientY;
        let moved = false;
        const rect = canvas.getBoundingClientRect();
        const previewSvg = makeLayerSVG(500);
        const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        previewPath.setAttribute('stroke', 'var(--brand)');
        previewPath.setAttribute('stroke-width', '2');
        previewPath.setAttribute('stroke-dasharray', '6 4');
        previewPath.setAttribute('fill', 'none');
        previewPath.setAttribute('stroke-linejoin', 'round');
        previewPath.style.pointerEvents = 'none';
        previewSvg.appendChild(previewPath);
        world.appendChild(previewSvg);

        let hoveredTarget = null;
        const allItems = appState.folders[appState.currentFolderId] ? appState.folders[appState.currentFolderId].items : [];
        const updatePreview = (clientX, clientY) => {
            const wx = (clientX - rect.left - appState.tx) / appState.scale, wy = (clientY - rect.top - appState.ty) / appState.scale;
            const obstacles = allItems.filter(i => i.id !== it.id && i.id !== hoveredTarget).map(itemRect);
            const points = computeConnectorPoints(it, { x: wx, y: wy }, false, obstacles);
            previewPath.setAttribute('d', pointsToLinePath(points));
        };
        updatePreview(e.clientX, e.clientY);

        const move = (me) => {
            if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) moved = true;
            document.querySelectorAll('.item.link-target-hover, .item.link-target-invalid').forEach(x => x.classList.remove('link-target-hover', 'link-target-invalid'));
            const under = document.elementFromPoint(me.clientX, me.clientY);
            const cardEl = under && under.closest && under.closest('.item');
            const id = cardEl ? parseInt(cardEl.id.replace('item-', '')) : NaN;
            const candidate = (!isNaN(id) && id !== it.id) ? id : null;
            // Only ever treat a hovered card as a droppable target if the link would actually
            // be allowed (rules 1-3 below); otherwise flag it so the user gets live feedback
            // that dropping here won't do anything, instead of silently doing nothing on drop.
            hoveredTarget = candidate != null && isValidConnection(it.id, candidate) ? candidate : null;
            if (cardEl && candidate != null) cardEl.classList.add(hoveredTarget != null ? 'link-target-hover' : 'link-target-invalid');
            updatePreview(me.clientX, me.clientY);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            previewSvg.remove();
            document.querySelectorAll('.item.link-target-hover, .item.link-target-invalid').forEach(x => x.classList.remove('link-target-hover', 'link-target-invalid'));
            if (hoveredTarget != null && isValidConnection(it.id, hoveredTarget)) {
                const conns = ensureConnections(appState.folders[appState.currentFolderId]);
                createConnection(conns, it.id, hoveredTarget);
                render();
            } else if (!moved) {
                // No real drag happened — this was a plain click, so hand off to the
                // click-to-link flow instead of just discarding the gesture (see
                // handleDataModeClick). The speculative snapshot taken at the top of this
                // function was only for a potential drag that didn't happen;
                // handleDataModeClick takes its own snapshot, only at the moment it actually
                // creates a connection.
                undoStack.pop();
                handleDataModeClick(it, el);
            } else {
                undoStack.pop();
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }


    function setDrawMode(on) {
        drawMode = on;
        btnAdd.classList.toggle('active', drawMode);
        canvas.classList.toggle('crosshair', drawMode || !!appState.addingKind);
        drawSettings.style.display = drawMode ? 'flex' : 'none';
        if (drawMode) { appState.addingKind = null; appState.addingStatKind = null; addMenu.style.display = 'none'; removePlacementGhost(); }
    }
    function cancelAddingKind() {
        appState.addingKind = null;
        appState.addingStatKind = null;
        canvas.classList.remove('crosshair');
        removePlacementGhost();
    }

    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');

        if (!isEditingText && outlineMenu.classList.contains('open')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOutlineActive(outlineActiveIndex + 1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setOutlineActive(outlineActiveIndex - 1); return; }
            if (e.key === 'Enter') {
                e.preventDefault();
                const row = outlineRows[outlineActiveIndex] || outlineRows[0];
                if (row) row.el.click();
                return;
            }
        }

        if (!isEditingText && e.key === ' ') { e.preventDefault(); if (searchInput) searchInput.focus(); return; }
        if (!isEditingText && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); toggleHamburgerMenu(); return; }
        // Debug shortcut for tweaking the notification entrance/exit animation — fires a plain
        // notification with no buttons on every press. Remove once done tweaking.
        if (!isEditingText && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); pushNotification({ type: 'debug', message: 'this is an example notification' }); return; }
    });

    function toggleDrawFromMenu() { addMenu.style.display = 'none'; setDrawMode(!drawMode); }
    drawColorInput.oninput = (e) => { drawColor = e.target.value; };
    drawSizeInput.oninput = (e) => { drawSize = parseInt(e.target.value); };
    function updateDrawToolBtns() {
        drawPenBtn.classList.toggle('active', drawTool === 'pen');
        drawEraserBtn.classList.toggle('active', drawTool === 'eraser');
    }
    drawPenBtn.onclick = (e) => { e.stopPropagation(); drawTool = 'pen'; updateDrawToolBtns(); };
    drawEraserBtn.onclick = (e) => { e.stopPropagation(); drawTool = 'eraser'; updateDrawToolBtns(); };
    function updateDrawLayerBtns() {
        drawFrontBtn.classList.toggle('active', drawLayer === 'front');
        drawBackBtn.classList.toggle('active', drawLayer === 'back');
    }
    drawFrontBtn.onclick = (e) => { e.stopPropagation(); drawLayer = 'front'; updateDrawLayerBtns(); };
    drawBackBtn.onclick = (e) => { e.stopPropagation(); drawLayer = 'back'; updateDrawLayerBtns(); };

    function startDrawStroke(e) {
        const rect = canvas.getBoundingClientRect();

        if (drawTool === 'eraser') {
            saveSnapshot();
            const dwList = ensureDrawings(appState.folders[appState.currentFolderId]);
            const eraseRadius = Math.max(drawSize, 8) / 2;
            const eraseAt = (wx, wy) => {
                for (let i = dwList.length - 1; i >= 0; i--) {
                    if (pathNearPoint(dwList[i].d, wx, wy, eraseRadius + (dwList[i].width || 3) / 2)) {
                        dwList.splice(i, 1);
                        render();
                    }
                }
            };
            const toWorld = (ce) => [(ce.clientX - rect.left - appState.tx) / appState.scale, (ce.clientY - rect.top - appState.ty) / appState.scale];
            const [wx0, wy0] = toWorld(e);
            eraseAt(wx0, wy0);
            const move = (me) => { const [wx, wy] = toWorld(me); eraseAt(wx, wy); };
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
            return;
        }

        saveSnapshot();
        const wx = (e.clientX - rect.left - appState.tx) / appState.scale, wy = (e.clientY - rect.top - appState.ty) / appState.scale;
        drawing = { points: [[wx, wy]], color: drawColor, layer: drawLayer, width: drawSize };
        liveSvg = makeLayerSVG(drawLayer === 'back' ? 0 : 2);
        livePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        livePath.setAttribute('stroke', drawColor);
        livePath.setAttribute('stroke-width', String(drawSize));
        livePath.setAttribute('fill', 'none');
        livePath.setAttribute('stroke-linecap', 'round');
        livePath.setAttribute('stroke-linejoin', 'round');
        liveSvg.appendChild(livePath);
        if (drawLayer === 'back') world.insertBefore(liveSvg, world.firstChild); else world.appendChild(liveSvg);

        const move = (me) => {
            const wx2 = (me.clientX - rect.left - appState.tx) / appState.scale, wy2 = (me.clientY - rect.top - appState.ty) / appState.scale;
            drawing.points.push([wx2, wy2]);
            livePath.setAttribute('d', pointsToPath(drawing.points));
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (drawing.points.length > 1) {
                ensureDrawings(appState.folders[appState.currentFolderId]).push({ color: drawing.color, layer: drawing.layer, d: pointsToPath(drawing.points), width: drawing.width });
            } else {
                undoStack.pop();
            }
            if (liveSvg) liveSvg.remove();
            liveSvg = null; livePath = null; drawing = null;
            render();
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    canvas.addEventListener('pointerdown', (e) => {
        if (e.target !== canvas) return;
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;

        // Clicking blank canvas cancels a click-to-link gesture in progress (see
        // handleDataModeClick) rather than leaving it armed indefinitely.
        if (appState.dataLinkPendingId != null) clearDataLinkPending();

        if (drawMode) { startDrawStroke(e); return; }

        if (appState.addingKind) {
            const rect = canvas.getBoundingClientRect();
            const { w, h } = kindSize(appState.addingKind);
            const x = Math.round((((e.clientX - rect.left - appState.tx) / appState.scale) - w / 2) / 28) * 28;
            const y = Math.round((((e.clientY - rect.top - appState.ty) / appState.scale) - h / 2) / 28) * 28;
            add(appState.addingKind, x, y, appState.addingStatKind);
            appState.addingKind = null; appState.addingStatKind = null; canvas.classList.remove('crosshair');
            removePlacementGhost();
            return;
        }
        if(appState.currentEditingEl) { appState.currentEditingEl.classList.remove('editing'); appState.currentEditingEl.querySelector('.body').contentEditable = false; appState.currentEditingEl = null; broadcastEditingState(false); }
        
        // Multi-selection: Shift+drag (or Select mode) on empty canvas draws a selection window instead of panning
        if (e.shiftKey || effectiveMode() === 'select') {
            startBoxSelection(e);
            return;
        }
        appState.selectedCardIds = [];
        renderSelectedOutlines();

        let startX = e.clientX - appState.tx, startY = e.clientY - appState.ty;
        document.body.classList.add('dragging');
        const move = (me) => { appState.tx = me.clientX - startX; appState.ty = me.clientY - startY; applyTransform(); };
        const up = () => { document.body.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });

    canvas.addEventListener('wheel', (e) => {
        if (scheduleViewMode) return; // let the agenda's own vertical-only scroll handle it natively
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
        const bodyEl = e.target.closest && e.target.closest('.item.note .body');
        if (bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight) return;
        e.preventDefault();
        if (e.ctrlKey) {
            const factor = Math.pow(1.1, -e.deltaY / 60);
            const mouseX = e.clientX - appState.tx, mouseY = e.clientY - appState.ty;
            const newScale = Math.min(Math.max(appState.scale * factor, ZOOM_MIN), ZOOM_MAX);
            appState.tx = e.clientX - (mouseX * (newScale / appState.scale));
            appState.ty = e.clientY - (mouseY * (newScale / appState.scale));
            appState.scale = newScale;
        } else {
            appState.tx -= e.deltaX;
            appState.ty -= e.deltaY;
        }
        scheduleApplyTransform();
    }, { passive: false });

    function setZoomFromClientY(clientY) {
        const rect = zoomTrack.getBoundingClientRect();
        let pct = 1 - (clientY - rect.top) / rect.height;
        pct = Math.max(0, Math.min(1, pct));
        const newScale = ZOOM_MIN + pct * (ZOOM_MAX - ZOOM_MIN);
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const worldX = (cx - appState.tx) / appState.scale, worldY = (cy - appState.ty) / appState.scale;
        appState.tx = cx - worldX * newScale;
        appState.ty = cy - worldY * newScale;
        appState.scale = newScale;
        applyTransform();
    }
    zoomTrack.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        zoomTrack.classList.add('dragging');
        setZoomFromClientY(e.clientY);
        const move = (me) => setZoomFromClientY(me.clientY);
        const up = () => {
            zoomTrack.classList.remove('dragging');
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
    // Double-clicking the zoom bar jumps straight back to 100%, anchored on the current
    // viewport center (same centering math as dragging the slider itself).
    zoomTrack.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const newScale = 1;
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const worldX = (cx - appState.tx) / appState.scale, worldY = (cy - appState.ty) / appState.scale;
        appState.tx = cx - worldX * newScale;
        appState.ty = cy - worldY * newScale;
        appState.scale = newScale;
        applyTransform();
    });

    function add(kind, x = 100, y = 100, statKind = null) {
        saveSnapshot();
        const { w, h } = kindSize(kind);
        const base = { id: appState.idCounter++, x, y, w, h, kind };
        if (kind === 'title') { base.html = ''; base.level = 1; }
        else if (kind === 'folder') {
            const fid = 'folder-' + appState.idCounter++;
            appState.folders[fid] = { id: fid, title: 'New Canvas', items: [], drawings: [], collaborators: [] };
            base.folderId = fid;
        }
        else if (kind === 'source') {
            const fid = 'folder-' + appState.idCounter++;
            appState.folders[fid] = { id: fid, title: 'New Source', isSource: true, items: [
                // Header cells start blank — "Column 1"/"Column 2" show only as placeholder
                // text (see renderStaticTableHTML) until the user actually names them.
                { id: appState.idCounter++, x: 28, y: 28, w: 560, h: 360, kind: 'table', tableData: [['', ''], ['', ''], ['', ''], ['', '']] }
            ], drawings: [], collaborators: [] };
            base.folderId = fid;
        }
        else if (kind === 'table') { base.tableData = [['', '', ''], ['', '', ''], ['', '', '']]; base.w = null; base.h = null; }
        else if (kind === 'media') { base.mediaType = null; base.mediaSrc = null; base.mediaName = null; }
        else if (kind === 'bookmark') { base.html = ''; base.bookmarkUrl = ''; }
        else if (kind === 'checklist') { base.tasks = []; } // no longer creatable, kept for existing cards — see kindLabel
        else if (kind === 'embed') { base.embedUrl = ''; }
        else if (kind === 'watermark') { base.html = ''; }
        else if (kind === 'flashcard') { base.cards = defaultFlashcardDeck(); base.fcMode = 'shuffle'; base.fcOrder = []; base.fcIndex = 0; base.fcFlipped = false; base.fcStats = {}; base.fcSeenCount = 0; }
        else if (kind === 'typeright') { base.cards = []; base.trMode = 'shuffle'; base.trOrder = []; base.trIndex = 0; base.trInput = ''; base.trChecked = false; base.trStats = {}; base.trSeenCount = 0; }
        else if (kind === 'statcard') { base.statKind = statKind || 'progress'; base.streamCache = {}; }
        else if (kind === 'stopwatch') {
            base.swRunning = false; base.swPaused = false; base.swElapsedMs = 0; base.swLastResumeAt = null;
            base.swSessionActive = false; base.swSessionId = null; base.swSessionStartedAt = null;
            base.swSessionLive = {}; base.swSessionBaseline = {}; base.swSessions = [];
        }
        else if (kind === 'shelf') { base.shelfSessions = []; base.shelfSelectedId = null; }
        else if (kind === 'filter') { base.filterTagIds = []; base.filterMode = 'or'; base.incomingRows = []; }
        else if (kind === 'waypoint') { base.creatorId = appState.currentUser.id; }
        else { base.html = (kind === 'note') ? '' : `<strong>${kindLabel(kind)}</strong>`; }
        appState.folders[appState.currentFolderId].items.push(base);
        render();
        awardUserPoints('add_canvas_block', 5);
        bumpAchievementStat('first_block');
        if (kind === 'waypoint') syncWaypointToDb(appState.currentFolderId, base);
    }

    // Deep-clones a LIVE canvas item for a true, independent duplicate (Alt-drag). Critically,
    // for a 'folder'/'source' item this also clones the folder it points to into a brand-new
    // folders[] entry (recursively, for any folders/sources nested inside it), so the copy gets
    // its own separate data. A bare JSON.parse(JSON.stringify(it)) deep-copies the item's own
    // fields (x/y/w/h/etc) but NOT the folder it merely points to by id — without this, the
    // duplicate's folderId is the exact same string as the original's, so both cards resolve to
    // the identical folders[folderId] object and editing rows/notes/drawings in either one
    // changes both. (Unrelated to snapshotItem() above, which builds a self-contained copy for
    // sharing OUTSIDE this account — this one stays local and reuses a fresh folder id instead.)
    function deepCloneItem(it) {
        const clone = JSON.parse(JSON.stringify(it));
        clone.id = appState.idCounter++;
        if ((clone.kind === 'folder' || clone.kind === 'source') && clone.folderId && appState.folders[clone.folderId]) {
            const srcFolder = appState.folders[clone.folderId];
            const newFid = 'folder-' + appState.idCounter++;
            const newFolder = JSON.parse(JSON.stringify(srcFolder));
            newFolder.id = newFid;
            newFolder.collaborators = []; // a duplicate starts with no collaborators of its own
            delete newFolder.isSharedView; delete newFolder.sharedOwnerId; delete newFolder.sharedRemoteFolderId;
            newFolder.items = srcFolder.items.map(deepCloneItem); // recursive — nested folders/sources get their own fresh folder ids too
            appState.folders[newFid] = newFolder;
            clone.folderId = newFid;
        }
        return clone;
    }

    // Undoes deepCloneItem's folders[] side effect for a duplicate that's being discarded before
    // it ever really landed (Alt-drag released without moving, or the drop target vanished) —
    // recursively, since a cloned folder/source can itself contain freshly-cloned nested
    // folders/sources, each with their own new folders[] entry. Without this, canceling a
    // speculative duplicate would still leave its brand-new (now unreferenced-by-any-item)
    // folder data behind forever, quietly bloating every future workspace save.
    function deleteClonedItemFolders(item) {
        if (!item || (item.kind !== 'folder' && item.kind !== 'source') || !item.folderId) return;
        const folderObj = appState.folders[item.folderId];
        if (!folderObj) return;
        (folderObj.items || []).forEach(deleteClonedItemFolders);
        delete appState.folders[item.folderId];
    }

    // ---------- Copy / Cut / Paste (Cmd/Ctrl+C / X / V — see the keydown handler above) ----------
    // Independent of the OS clipboard — an in-memory snapshot of whatever was selected at copy
    // time. A folder/source card's real content lives in folders[] keyed by a live id that a Cut
    // would otherwise delete out from under it (see cascadeDeleteFolderContents) before any
    // Paste happens, so the snapshot has to carry a fully independent copy of that subtree, not
    // just a folderId pointing at data that may no longer exist by paste time. Reset (and its
    // cascading paste offset re-armed) every time something new is copied or cut; NOT cleared by
    // pasting, so Cmd+V can be pressed repeatedly to stamp down more copies, same as any normal
    // clipboard.
    let cardClipboard = [];
    let clipboardPasteCount = 0;

    // Self-contained capture of a card for cardClipboard — same embed-nested-contents idea as
    // snapshotItem (used for external chat/marketplace sharing), kept as its own function since
    // that one is optimized for a read-only, cross-account view (renderInlineCanvas), while this
    // one needs to round-trip back into real, live folders[] data via materializeClipboardItem.
    function snapshotItemForClipboard(it) {
        const clone = JSON.parse(JSON.stringify(it));
        if ((it.kind === 'folder' || it.kind === 'source') && it.folderId && appState.folders[it.folderId]) {
            const srcFolder = appState.folders[it.folderId];
            clone.clipboardFolder = JSON.parse(JSON.stringify(srcFolder));
            clone.clipboardFolder.items = srcFolder.items.map(snapshotItemForClipboard); // recursive — nested folders/sources capture their own subtree too
        }
        return clone;
    }
    // Reverse of snapshotItemForClipboard — turns a captured snapshot into a real, freshly id'd
    // canvas item, recreating a brand-new folders[] entry (recursively) for any folder/source
    // content it carries. Same fresh-id/dropped-sharing-fields handling as deepCloneItem's
    // Alt-drag duplicate, just sourced from a stored snapshot instead of a still-live item.
    function materializeClipboardItem(snap) {
        const clone = JSON.parse(JSON.stringify(snap));
        clone.id = appState.idCounter++;
        delete clone.clipboardFolder;
        if (snap.clipboardFolder) {
            const newFid = 'folder-' + appState.idCounter++;
            const newFolder = JSON.parse(JSON.stringify(snap.clipboardFolder));
            newFolder.id = newFid;
            newFolder.collaborators = []; // a paste starts with no collaborators of its own, same as an Alt-drag duplicate
            delete newFolder.isSharedView; delete newFolder.sharedOwnerId; delete newFolder.sharedRemoteFolderId;
            newFolder.items = snap.clipboardFolder.items.map(materializeClipboardItem); // recursive — nested folders/sources get their own fresh ids too
            appState.folders[newFid] = newFolder;
            clone.folderId = newFid;
        }
        return clone;
    }
    function copySelectedCards() {
        if (!appState.selectedCardIds.length) return;
        const items = appState.selectedCardIds.map(id => findItemById(id)).filter(Boolean);
        if (!items.length) return;
        cardClipboard = items.map(snapshotItemForClipboard);
        clipboardPasteCount = 0;
    }
    function cutSelectedCards() {
        if (!appState.selectedCardIds.length) return;
        copySelectedCards();
        if (!cardClipboard.length) return;
        deleteSelectedCards(); // its own confirm()/saveSnapshot()/cascade cleanup — see its own comment
    }
    function pasteClipboardCards() {
        if (!cardClipboard.length || !appState.folders[appState.currentFolderId]) return;
        saveSnapshot();
        clipboardPasteCount++;
        const offset = clipboardPasteCount * 28; // cascades further with each repeated paste, so stamping Cmd+V several times doesn't stack copies exactly on top of each other
        const pasted = cardClipboard.map(snap => {
            const clone = materializeClipboardItem(snap);
            clone.x = (clone.x || 0) + offset;
            clone.y = (clone.y || 0) + offset;
            appState.topCardZIndex++; clone.zIndex = appState.topCardZIndex;
            return clone;
        });
        appState.folders[appState.currentFolderId].items.push(...pasted);
        appState.selectedCardIds = pasted.map(it => it.id);
        render();
        renderSelectedOutlines();
    }

    function removePlacementGhost() {
        if (appState.placementGhost) { appState.placementGhost.remove(); appState.placementGhost = null; }
    }
    function showPlacementGhost(kind) {
        removePlacementGhost();
        const { w, h } = kindSize(kind);
        appState.placementGhost = document.createElement('div');
        appState.placementGhost.id = 'placement-ghost';
        appState.placementGhost.className = `item ${kind}`;
        appState.placementGhost.style.width = w + 'px';
        appState.placementGhost.style.height = h + 'px';
        appState.placementGhost.style.opacity = '0.5';
        appState.placementGhost.style.background = 'transparent';
        appState.placementGhost.style.pointerEvents = 'none';
        appState.placementGhost.style.zIndex = '999';
        world.appendChild(appState.placementGhost);
        appState.placementGhost.style.left = '-9999px';
        appState.placementGhost.style.top = '-9999px';
    }
    canvas.addEventListener('pointermove', (e) => {
        if (!appState.addingKind || !appState.placementGhost) return;
        const rect = canvas.getBoundingClientRect();
        const { w, h } = kindSize(appState.addingKind);
        const x = Math.round((((e.clientX - rect.left - appState.tx) / appState.scale) - w / 2) / 28) * 28;
        const y = Math.round((((e.clientY - rect.top - appState.ty) / appState.scale) - h / 2) / 28) * 28;
        appState.placementGhost.style.left = x + 'px';
        appState.placementGhost.style.top = y + 'px';
    });

    function prepareAdd(kind, statKind) { appState.addingKind = kind; appState.addingStatKind = statKind || null; addMenu.style.display = 'none'; panelPinned.add = false; canvas.classList.add('crosshair'); setDrawMode(false); showPlacementGhost(kind); }
    const addToolbar = document.getElementById('add-toolbar');
    function closeAddMenu() { addMenu.style.display = 'none'; panelPinned.add = false; }
    function openAddMenu(pin) {
        if (drawMode) setDrawMode(false);
        closeAllPanels('add');
        addMenu.style.display = 'flex';
        // Always reopens showing tabs, never mid-search from a previous visit.
        if (addMenuSearching) {
            addMenuSearching = false;
            document.getElementById('add-menu-tabs').classList.remove('searching');
            document.getElementById('add-menu-search-btn').classList.remove('active');
        }
        switchAddTab(currentAddTab);
        if (pin) panelPinned.add = true;
    }
    // addMenuActions (New Canvas/New Source) sits visually beside #add-menu, not inside it (see
    // globals.css), with real dead space in between both it and the panel, and between the panel
    // and addToolbar — scheduleHoverClose's 80ms grace period already tolerates a brief gap
    // between listed hoverEls, but only if EVERY zone the pointer might legitimately be heading
    // towards is actually in that list. Leaving addMenuActions out of it meant reaching those
    // buttons (or just crossing the gap towards them) wasn't recognized as "still relevant
    // hovering" at all, so the panel could close out from under the pointer on the way there.
    const addMenuActions = document.getElementById('add-menu-actions');
    const addMenuHoverEls = [addToolbar, addMenu, addMenuActions];
    addToolbar.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.add) { closeAddMenu(); }
        else { openAddMenu(true); }
    });
    addToolbar.addEventListener('mouseenter', () => { if (addMenu.style.display !== 'flex') openAddMenu(false); });
    addToolbar.addEventListener('mouseleave', () => scheduleHoverClose('add', addMenuHoverEls, closeAddMenu));
    addMenu.addEventListener('mouseleave', () => scheduleHoverClose('add', addMenuHoverEls, closeAddMenu));
    addMenuActions.addEventListener('mouseleave', () => scheduleHoverClose('add', addMenuHoverEls, closeAddMenu));

    // ---------- Source page: per-cell Add / Upload / Tags buttons (hover-only, no global toolbars) ----------
    const sourceAddMenu = document.getElementById('source-add-menu');
    const cellTagPicker = document.getElementById('cell-tag-picker');
    const audioRecordIndicator = document.getElementById('audio-record-indicator');
    function closeSourceAddMenu() { sourceAddMenu.style.display = 'none'; panelPinned.sourceAdd = false; }
    // Opens the Add (image/audio) menu anchored to the specific cell's button that was
    // clicked, and remembers that cell as the target for the insert actions below.
    function openCellAddMenu(id, r, c, btnEl) {
        const it = findItemById(id); if (!it) return;
        closeAllPanels(null);
        closeCellTagPicker();
        appState.lastFocusedCell = { id, r, c };
        const rect = btnEl.getBoundingClientRect();
        sourceAddMenu.style.left = Math.min(rect.left, window.innerWidth - 190) + 'px';
        sourceAddMenu.style.top = (rect.bottom + 6) + 'px';
        sourceAddMenu.style.display = 'flex';
        panelPinned.sourceAdd = true;
    }

    // ---------- Cursor mode toolbar (normal / data / select) ----------
    const modeToolbar = document.getElementById('mode-toolbar');
    const scheduleToolbar = document.getElementById('schedule-toolbar');
    const modeButtons = Array.from(modeToolbar.querySelectorAll('.mode-btn'));
    const MODE_ORDER_WEIGHT = { normal: 0, data: 1, select: 2 };
    function updateModeToolbarUI() {
        const eff = effectiveMode();
        modeButtons.forEach(b => {
            b.classList.toggle('mode-visible', b.dataset.mode === eff);
            b.classList.toggle('active', b.dataset.mode === appState.cardMode);
            // Keep whichever mode is currently pinned anchored at the bottom (order 3),
            // so expanding the pill always grows upward from the same spot.
            b.style.order = b.dataset.mode === appState.cardMode ? '3' : String(MODE_ORDER_WEIGHT[b.dataset.mode]);
        });
    }
    function applyCursorMode() {
        const eff = effectiveMode();
        canvas.classList.toggle('mode-data', eff === 'data');
        canvas.classList.toggle('mode-select', eff === 'select');
        // Leaving data mode (for any reason — toolbar click, D/Escape/Shift override) always
        // cancels a half-made click-to-link selection rather than letting it linger and
        // potentially link two unrelated cards later when data mode is re-entered.
        if (eff !== 'data') clearDataLinkPending();
        updateModeToolbarUI();
    }
    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.cardMode = btn.dataset.mode;
            modeToolbar.classList.remove('expanded');
            applyCursorMode();
        });
    });
    modeToolbar.addEventListener('mouseenter', () => { modeToolbar.classList.add('expanded'); updateModeToolbarUI(); });
    modeToolbar.addEventListener('mouseleave', () => { modeToolbar.classList.remove('expanded'); updateModeToolbarUI(); });

    // D / Escape / Shift each work as both a quick switch and a temporary (held) override for
    // the three cursor modes (Data / Normal / Select respectively): pressing and releasing one
    // within MODE_HOLD_THRESHOLD_MS counts as a tap and switches to that mode for good, exactly
    // like clicking its toolbar button — the same as it would happen anyway from the immediate
    // keydown-triggered override, just made to stick around after keyup instead of reverting.
    // Holding it past that threshold keeps it a temporary override, reverting back to whatever
    // mode was active before the key went down the moment it's released. Option/Alt+drag is
    // reserved separately for duplicating cards, so D/Shift are ignored while actively typing in
    // a text field (Escape never types a character, so it's exempt from that check — same as its
    // other, unrelated "close everything" behavior above), and D/Shift both bail out while a
    // meta/ctrl modifier is held so they don't hijack unrelated shortcuts (e.g. Cmd+Z for undo).
    const MODE_HOLD_THRESHOLD_MS = 180;
    let modeKeyHoldStart = null;
    function beginModeOverride(key) {
        if (appState.modeOverrideKey === key) return;
        appState.modeOverrideKey = key;
        modeKeyHoldStart = Date.now();
        applyCursorMode();
    }
    function endModeOverride(key, mode) {
        if (appState.modeOverrideKey !== key) return;
        const elapsed = modeKeyHoldStart !== null ? Date.now() - modeKeyHoldStart : Infinity;
        appState.modeOverrideKey = null;
        modeKeyHoldStart = null;
        if (elapsed < MODE_HOLD_THRESHOLD_MS) appState.cardMode = mode; // quick tap — make the switch stick
        applyCursorMode();
    }
    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        // Shift+X: a discrete shortcut (not a held-mode override) that links the current
        // multi-selection. Handled first so it never falls through into the Normal-mode
        // override logic below and briefly flips the cursor away from Data-linking context.
        if (!isEditingText && e.shiftKey && (e.key === 'x' || e.key === 'X') && appState.selectedCardIds.length >= 2) {
            e.preventDefault();
            linkSelectedCards();
            return;
        }
        // Deletes whatever's currently selected (shift-click or select-cursor-mode click — see
        // setupDraggingAndClicking) — the only way to delete a card now that the per-card
        // right-click "Delete" menu item is gone.
        if (!isEditingText && e.key === 'Backspace' && appState.selectedCardIds.length > 0) {
            e.preventDefault();
            deleteSelectedCards();
            return;
        }
        if (!isEditingText && e.key === 'Shift' && !e.metaKey && !e.ctrlKey) { beginModeOverride('shift'); }
        else if (!isEditingText && !e.metaKey && !e.ctrlKey && (e.key === 'd' || e.key === 'D')) { beginModeOverride('d'); }
        else if (e.key === 'Escape') { beginModeOverride('escape'); }
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') endModeOverride('shift', 'select');
        else if (e.key === 'd' || e.key === 'D') endModeOverride('d', 'data');
        else if (e.key === 'Escape') endModeOverride('escape', 'normal');
    });
    window.addEventListener('blur', () => { if (appState.modeOverrideKey) { appState.modeOverrideKey = null; modeKeyHoldStart = null; applyCursorMode(); } });

    // Re-run the source table's column sizing whenever the window resizes, since column
    // widths are derived from the (viewport-based) rendered width of the table container.
    window.addEventListener('resize', () => {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !folderObj.isSource) return;
        const tableItem = folderObj.items.find(i => i.kind === 'table');
        const el = document.querySelector('.item.static-table');
        if (tableItem && el) layoutSourceTableColumns(tableItem, el);
    });
    
    window.onclick = () => {
        closeAddMenu();
        closeSourceAddMenu();
        closeCellTagPicker();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        hideCanvasContextMenu();
        closeHamburgerMenu();
        closeMessagesPanel();
        closeCartPanel();
        closeProfilePanel();
        closeCollabPanel();
        closeBreadcrumbMapPanel();
        clearSearch();
        modeToolbar.classList.remove('expanded');
        updateModeToolbarUI();
    };

    // ---------- Hover/Pin Panel Helper ----------
    // Panels can be opened two ways: hovering the trigger button opens them temporarily
    // (closing again once the pointer leaves both the button and the panel), while
    // clicking the trigger button "pins" the panel open until the user clicks elsewhere
    // on the canvas. Only one panel is ever open at a time - opening any panel (via
    // hover or click) swaps out whichever panel was previously open.
    const panelPinned = { menu: false, messages: false, cart: false, add: false, profile: false, collab: false, sourceAdd: false, breadcrumbMap: false };
    function scheduleHoverClose(name, hoverEls, closeFn) {
        setTimeout(() => {
            if (panelPinned[name]) return;
            const stillOver = hoverEls.some(el => el && el.matches(':hover'));
            if (!stillOver) closeFn();
        }, 80);
    }
    // A panel that only opened via hover (never pinned by clicking its trigger button) still
    // closes as soon as the pointer leaves it — but clicking ANYTHING inside it promotes it to
    // pinned right then, same as if the trigger button itself had been clicked, so it now stays
    // open until an outside click/Escape instead of closing on mouseleave. Capture phase so this
    // fires before whatever the click itself does (including a handler that closes the panel,
    // e.g. a menu action — pinning a panel the same tick it closes is harmless). Not wired up for
    // #add-menu/#source-add-menu, which are getting different, separate treatment.
    function pinOnInsideClick(name, els) {
        els.forEach(el => {
            if (!el) return;
            el.addEventListener('click', () => { panelPinned[name] = true; }, true);
        });
    }
    function closeAllPanels(except) {
        if (except !== 'menu') closeHamburgerMenu();
        if (except !== 'messages') closeMessagesPanel();
        if (except !== 'cart') closeCartPanel();
        if (except !== 'profile') closeProfilePanel();
        if (except !== 'add') closeAddMenu();
        if (except !== 'collab') closeCollabPanel();
        if (except !== 'sourceAdd') closeSourceAddMenu();
        if (except !== 'breadcrumbMap') closeBreadcrumbMapPanel();
    }

    // ---------- Hamburger Menu Controls ----------
    const hamburgerBtn = document.getElementById('btn-menu'), outlineMenu = document.getElementById('outline-menu'), accountMenu = document.getElementById('account-menu'), hamburgerStack = document.getElementById('hamburger-stack');
    // Each of these is its own separate view of the same menu (see openWaypointsPanel /
    // openHubCollabPanel below) — closing the hamburger by any existing path (outside click,
    // Escape, re-clicking the button) needs to close whichever one is actually showing, so all are
    // reset here alongside #account-menu/#outline-menu rather than needing their own separate
    // close path. Named hub-collab (not just "collab") to avoid colliding with the pre-existing
    // #collab-panel/collabPanel (the per-canvas "add a collaborator" flyout off the top bar) — a
    // completely different feature that happens to share the English word.
    const waypointsPanel = document.getElementById('waypoints-panel'), waypointsSearchInput = document.getElementById('waypoints-search');
    const hubCollabPanel = document.getElementById('hub-collab-panel'), hubCollabSearchInput = document.getElementById('hub-collab-search');
    const hubSubpanels = [waypointsPanel, hubCollabPanel];
    function closeHamburgerMenu() {
        outlineMenu.classList.remove('open');
        accountMenu.classList.remove('open');
        hubSubpanels.forEach(p => p.classList.remove('open'));
        hamburgerBtn.classList.remove('active');
        panelPinned.menu = false;
    }
    function positionHamburgerMenu() {
        const rect = hamburgerBtn.getBoundingClientRect();
        hamburgerStack.style.top = (rect.bottom + 10) + 'px';
        const stackWidth = 240;
        let leftPos = rect.left;
        if (leftPos + stackWidth > window.innerWidth - 20) leftPos = window.innerWidth - stackWidth - 20;
        if (leftPos < 20) leftPos = 20;
        hamburgerStack.style.left = leftPos + 'px';
        hamburgerStack.style.right = 'auto';
    }
    function openHamburgerMenu(pin) {
        closeAllPanels('menu');
        clearSearch();
        outlineMenu.classList.add('open');
        accountMenu.classList.add('open');
        hamburgerBtn.classList.add('active');
        buildOutline();
        positionHamburgerMenu();
        if (pin) panelPinned.menu = true;
    }
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.menu) { closeHamburgerMenu(); }
        else { openHamburgerMenu(true); }
    });
    const hamburgerHoverEls = [hamburgerBtn, outlineMenu, accountMenu, ...hubSubpanels];
    hamburgerBtn.addEventListener('mouseenter', () => { if (!outlineMenu.classList.contains('open') && !hubSubpanels.some(p => p.classList.contains('open'))) openHamburgerMenu(false); });
    hamburgerBtn.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu));
    outlineMenu.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu));
    accountMenu.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu));
    hubSubpanels.forEach(p => p.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu)));
    pinOnInsideClick('menu', [outlineMenu, accountMenu, ...hubSubpanels]);
    document.getElementById('hamburger-stack').addEventListener('click', (e) => e.stopPropagation());
    // Shared by the three open*Panel functions below — swaps #account-menu/#outline-menu out for
    // just the one requested panel.
    function openHubSubpanel(panel, searchInputEl, renderFn) {
        outlineMenu.classList.remove('open');
        accountMenu.classList.remove('open');
        hubSubpanels.forEach(p => { if (p !== panel) p.classList.remove('open'); });
        panel.classList.add('open');
        hamburgerBtn.classList.add('active');
        positionHamburgerMenu();
        panelPinned.menu = true;
        searchInputEl.value = '';
        renderFn('');
    }
    function openWaypointsPanel() { openHubSubpanel(waypointsPanel, waypointsSearchInput, renderWaypointsList); }
    function openHubCollabPanel() {
        hubCollabView = 'main'; // always land on the main list, never mid-Requests from last time
        openHubSubpanel(hubCollabPanel, hubCollabSearchInput, renderHubCollabList);
    }
    function handleWaypointsSearch(v) { renderWaypointsList(v); }
    function handleHubCollabSearch(v) { renderHubCollabList(v); }

    // ---------- Hamburger "Collaborations" panel ----------
    // Two views sharing #hub-collab-list: the main list (a "Requests" row with a pending-count
    // badge, then every canvas someone has shared with this user — click to enter via
    // openSharedCanvas) and the Requests view (every pending invite, Accept/Decline each) —
    // swapped via hubCollabView rather than a separate hub-subpanel, since it's a drill-down
    // within Collaborations, not a distinct top-level hamburger menu item.
    let hubCollabView = 'main';
    let incomingCanvasRequests = []; // [{id, folderId, folderTitle, ownerId, ownerName}]
    let acceptedCanvasCollaborations = []; // [{id, folderId, folderTitle, ownerId, ownerName, ownerAvatarId, ownerAvatarUrl}] — shared WITH this user
    let ownedCanvasCollaborations = []; // [{folderId, folderTitle, collaborators:[{id,username,displayName,avatarId,avatarUrl}]}] — shared BY this user
    // Same baseline-then-diff pattern as seenIncomingFriendRequestIds — null until the first
    // refresh (baseline, no notifications), every run after that notifies for any request id
    // that wasn't in the set yet.
    let seenIncomingCanvasRequestIds = null;
    async function refreshCanvasCollabData() {
        if (!supabase || !appState.currentUser.id) { incomingCanvasRequests = []; acceptedCanvasCollaborations = []; ownedCanvasCollaborations = []; return; }
        const [sharedWithMeRes, ownedRes] = await Promise.all([
            supabase.from('canvas_collaborations')
                .select('id, folder_id, folder_title, status, owner:profiles!canvas_collaborations_owner_id_fkey(id, username, display_name, avatar_id, avatar_url)')
                .eq('collaborator_id', appState.currentUser.id)
                .in('status', ['pending', 'accepted']),
            supabase.from('canvas_collaborations')
                .select('folder_id, folder_title, collaborator:profiles!canvas_collaborations_collaborator_id_fkey(id, username, display_name, avatar_id, avatar_url)')
                .eq('owner_id', appState.currentUser.id)
                .eq('status', 'accepted'),
        ]);
        if (sharedWithMeRes.error) console.error('[collab] failed to load canvas collaborations:', sharedWithMeRes.error);
        if (ownedRes.error) console.error('[collab] failed to load owned canvas collaborations:', ownedRes.error);

        const rows = (sharedWithMeRes.data || []).map(r => ({
            id: r.id, folderId: r.folder_id, folderTitle: r.folder_title,
            ownerId: r.owner.id, ownerName: r.owner.display_name || r.owner.username,
            ownerAvatarId: r.owner.avatar_id ?? 0, ownerAvatarUrl: r.owner.avatar_url || null, status: r.status,
        }));
        incomingCanvasRequests = rows.filter(r => r.status === 'pending');
        acceptedCanvasCollaborations = rows.filter(r => r.status === 'accepted');
        if (seenIncomingCanvasRequestIds === null) {
            seenIncomingCanvasRequestIds = new Set(incomingCanvasRequests.map(r => r.id));
        } else {
            incomingCanvasRequests.forEach(r => {
                if (seenIncomingCanvasRequestIds.has(r.id)) return;
                seenIncomingCanvasRequestIds.add(r.id);
                pushNotification({
                    type: 'collab_request',
                    message: `${r.ownerName} invited you to collaborate on "${r.folderTitle}"`,
                    actionLabel: 'Accept',
                    onAction: () => respondToCanvasCollabRequest(r.id, true),
                    // No dismiss button — Escape hides it without accepting, request stays pending
                    // (see Requests in the Collaborations hub panel).
                    sticky: true,
                });
            });
        }

        const byFolder = new Map();
        (ownedRes.data || []).forEach(r => {
            if (!byFolder.has(r.folder_id)) byFolder.set(r.folder_id, { folderId: r.folder_id, folderTitle: r.folder_title, collaborators: [] });
            byFolder.get(r.folder_id).collaborators.push({
                id: r.collaborator.id, username: r.collaborator.username,
                displayName: r.collaborator.display_name || r.collaborator.username,
                avatarId: r.collaborator.avatar_id ?? 0, avatarUrl: r.collaborator.avatar_url || null,
            });
        });
        ownedCanvasCollaborations = Array.from(byFolder.values());
    }
    async function respondToCanvasCollabRequest(id, accept) {
        if (!supabase) return;
        const { error } = await supabase.rpc('respond_to_canvas_collaboration', { p_id: id, p_accept: accept });
        if (error) console.error('[collab] failed to respond to canvas collaboration request:', error);
    }
    // Both directions in one flat list (own canvases with collaborators, and canvases others
    // shared with this user) — no subheading distinguishing them, same "no separate subheadings"
    // convention as the per-canvas panel; the row content itself (avatars vs. an Open button)
    // makes which is which obvious.
    async function renderHubCollabList(query) {
        await refreshCanvasCollabData();
        if (hubCollabView === 'requests') { renderHubCollabRequests(); return; }
        const list = document.getElementById('hub-collab-list');
        list.innerHTML = '';

        if (incomingCanvasRequests.length) {
            const reqRow = document.createElement('div');
            reqRow.className = 'outline-item requests-row';
            reqRow.innerHTML = `<span class="outline-label">Requests</span><span class="requests-count">${incomingCanvasRequests.length}</span>`;
            reqRow.onclick = (e) => { e.stopPropagation(); hubCollabView = 'requests'; renderHubCollabRequests(); };
            list.appendChild(reqRow);
        }

        const q = (query || '').trim().toLowerCase();
        // Own canvases that have since been deleted shouldn't show here even if their
        // canvas_collaborations rows are somehow still lingering (e.g. deleteCanvasCollabsForFolder's
        // revoke call failed silently — see its own error handling) — folders[] is this user's own
        // COMPLETE tree, loaded in full up front (see loadWorkspace), so absence here reliably means
        // "no longer exists," no extra round trip needed. Opportunistically retries the cleanup for
        // any match found, since we're the owner and can actually fix it from here.
        const ownedCandidates = ownedCanvasCollaborations.filter(c => !q || c.folderTitle.toLowerCase().includes(q));
        const ownedShown = ownedCandidates.filter(c => {
            if (appState.folders[c.folderId]) return true;
            deleteCanvasCollabsForFolder(c.folderId);
            return false;
        });
        // Canvases shared WITH this user aren't necessarily loaded locally yet (a friend's canvas
        // isn't fetched until actually opened — see openSharedCanvas), so existence has to be
        // verified server-side instead: get_shared_folder returns null data (with no error) once
        // access is confirmed but the folder itself is gone — same defensive-cleanup reasoning as
        // above, covering both "canvas deleted" and "access actually revoked but the status column
        // update didn't land" in one check. A collaborator has no permission to delete the owner's
        // row themselves (see canvas_collaborations' RLS), so this only filters the display here;
        // the owner's own next panel render is what actually cleans up their row.
        const sharedCandidates = acceptedCanvasCollaborations.filter(c => !q || c.folderTitle.toLowerCase().includes(q));
        const sharedStillExists = await Promise.all(sharedCandidates.map(async (c) => {
            if (appState.folders[sharedFolderKey(c.ownerId, c.folderId)]) return true; // already loaded locally this session
            const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: c.ownerId, p_folder_id: c.folderId });
            return !error && data != null;
        }));
        const sharedShown = sharedCandidates.filter((c, i) => sharedStillExists[i]);
        if (!ownedShown.length && !sharedShown.length) {
            const empty = document.createElement('div');
            empty.className = 'outline-empty';
            empty.textContent = q ? 'No matching canvases.' : 'No collaborations yet.';
            list.appendChild(empty);
            return;
        }

        // Both row types now share the exact same shape — icon, title + "Owned by ..." subtext,
        // avatar(s) on the right — so which is which reads from the subtext alone, not from one
        // having an avatar stack and the other a button.
        //
        // Own canvas that has collaborators — up to 3 avatars (same convention as the per-canvas
        // collab bubble), hover shows the exact count, clicking navigates there AND opens its
        // collaborator panel (since managing it is the obvious next step from here). Title prefers
        // the LIVE in-memory folders[c.folderId].title over the DB row's own folder_title, which
        // is only a snapshot taken at invite time (see canvas_collaborations' own schema comment)
        // — this is always loaded already since it's one of this user's own canvases, so there's
        // no reason to ever show a stale title here.
        ownedShown.forEach(c => {
            const row = document.createElement('div');
            row.className = 'outline-item hub-collab-canvas-row';
            const liveTitle = (appState.folders[c.folderId] && appState.folders[c.folderId].title) || c.folderTitle;
            const shown = c.collaborators.slice(0, 3);
            let avatarsHtml = '<div class="collab-avatars">';
            shown.forEach((f, i) => { avatarsHtml += `<div class="collab-avatar" data-idx="${i}"></div>`; });
            if (c.collaborators.length > 3) avatarsHtml += `<div class="collab-avatar collab-more">+${c.collaborators.length - 3}</div>`;
            avatarsHtml += '</div>';
            row.innerHTML = `${outlineIcon('folder')}
                <div class="hub-collab-row-meta">
                    <span class="outline-label">${escapeHtml(liveTitle)}</span>
                    <span class="hub-collab-row-owner">Owned by you</span>
                </div>
                <span class="hub-collab-avatars-tooltip">${c.collaborators.length} ${c.collaborators.length === 1 ? 'Collaborator' : 'Collaborators'}</span>
                ${avatarsHtml}`;
            row.querySelectorAll('.collab-avatar[data-idx]').forEach(el => {
                const f = shown[parseInt(el.dataset.idx, 10)];
                renderAvatarInto(el, { id: f.avatarId, url: f.avatarUrl }, initials(f.displayName));
            });
            row.onclick = (e) => {
                e.stopPropagation();
                openFolder(c.folderId); // our own canvas — plain local navigation, no fetch needed
                renderCollabPill(); // sets the bubble's .show class synchronously so the line below doesn't no-op
                openCollabPanel(true);
            };
            list.appendChild(row);
        });
        // Canvas someone else shared with this user — single avatar (the owner). Title prefers the
        // live folders['shared:owner:folderId'].title when that folder has already been loaded
        // this session (i.e. it's been visited at least once), same staleness reasoning as above,
        // falling back to the DB snapshot for one that hasn't been opened yet — a full live title
        // for a canvas never even loaded locally would need the owner's own rename to actively
        // push an update, which is a separate, larger piece of work than this.
        sharedShown.forEach(c => {
            const row = document.createElement('div');
            row.className = 'outline-item hub-collab-canvas-row';
            const sharedKey = sharedFolderKey(c.ownerId, c.folderId);
            const liveTitle = (appState.folders[sharedKey] && appState.folders[sharedKey].title) || c.folderTitle;
            row.innerHTML = `${outlineIcon('folder')}
                <div class="hub-collab-row-meta">
                    <span class="outline-label">${escapeHtml(liveTitle)}</span>
                    <span class="hub-collab-row-owner">Owned by ${escapeHtml(c.ownerName)}</span>
                </div>
                <div class="collab-avatars"><div class="collab-avatar" data-owner></div></div>`;
            renderAvatarInto(row.querySelector('.collab-avatar[data-owner]'), { id: c.ownerAvatarId, url: c.ownerAvatarUrl }, initials(c.ownerName));
            row.onclick = (e) => { e.stopPropagation(); openSharedCanvas(c.ownerId, c.folderId, c.folderTitle, c.ownerName); };
            list.appendChild(row);
        });
    }
    function renderHubCollabRequests() {
        const list = document.getElementById('hub-collab-list');
        list.innerHTML = '';
        const backRow = document.createElement('div');
        backRow.className = 'requests-back-row';
        backRow.innerHTML = `<span>&larr;</span><span>Requests</span>`;
        backRow.onclick = (e) => { e.stopPropagation(); hubCollabView = 'main'; renderHubCollabList(hubCollabSearchInput.value); };
        list.appendChild(backRow);

        if (!incomingCanvasRequests.length) {
            const empty = document.createElement('div');
            empty.className = 'outline-empty';
            empty.textContent = 'No pending requests.';
            list.appendChild(empty);
            return;
        }
        incomingCanvasRequests.forEach(req => {
            const row = document.createElement('div');
            row.className = 'msg-add-row';
            row.innerHTML = `<div class="msg-chat-meta"><div class="msg-chat-name">${escapeHtml(req.folderTitle)}</div><div class="collab-row-sub">from ${escapeHtml(req.ownerName)}</div></div>
                <div style="display:flex;gap:6px;">
                    <button class="msg-add-btn hub-collab-accept">Accept</button>
                    <button class="msg-add-btn hub-collab-decline">Decline</button>
                </div>`;
            row.querySelector('.hub-collab-accept').onclick = async (e) => {
                e.stopPropagation();
                await respondToCanvasCollabRequest(req.id, true);
                await refreshCanvasCollabData();
                renderHubCollabRequests();
            };
            row.querySelector('.hub-collab-decline').onclick = async (e) => {
                e.stopPropagation();
                await respondToCanvasCollabRequest(req.id, false);
                await refreshCanvasCollabData();
                renderHubCollabRequests();
            };
            list.appendChild(row);
        });
    }
    // Queries the global `waypoints` table (see the 20260729 migration) rather than scanning
    // locally-loaded `folders` — a friend's canvas 300 layers deep isn't loaded client-side until
    // you actually navigate into it, but a waypoint you dropped there still needs to show up and
    // be jumpable-to from here, platform-wide. RLS on that table already restricts this to
    // waypoints THIS user created, so there's no need to filter by creator client-side too.
    async function renderWaypointsList(query) {
        const list = document.getElementById('waypoints-list');
        list.innerHTML = '';
        if (!supabase || !appState.currentUser.id) return;
        const q = (query || '').trim().toLowerCase();
        const { data, error } = await supabase.from('waypoints')
            .select('owner_id, folder_id, item_id, name')
            .eq('creator_id', appState.currentUser.id)
            .order('updated_at', { ascending: false });
        if (error) { console.error('[waypoints] failed to load waypoints:', error); return; }
        const rows = (data || []).filter(r => !q || (r.name || 'New Waypoint').toLowerCase().includes(q));
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'outline-empty';
            empty.textContent = q ? 'No matching waypoints.' : 'No waypoints yet.';
            list.appendChild(empty);
            return;
        }
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'outline-item';
            row.innerHTML = `${outlineIcon('waypoint')}<span class="outline-label">${escapeHtml(r.name || 'New Waypoint')}</span>`;
            row.onclick = (e) => { e.stopPropagation(); goToWaypointCard(r.owner_id, r.folder_id, r.item_id); };
            list.appendChild(row);
        });
    }
    // Pans to and briefly expands (read-only "peek") a waypoint card already present in the
    // CURRENTLY open folder's DOM — shared by both branches of goToWaypointCard below.
    function peekWaypointCard(folderId, it) {
        const el = document.getElementById('item-' + it.id);
        const w = el ? el.offsetWidth : (it.w || 28);
        const h = el ? el.offsetHeight : (it.h || 28);
        smoothPanTo(window.innerWidth / 2 - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
        if (el) expandWaypointCard(el, it, { editable: false });
        flashCanvasElement(el);
    }
    // Navigates to a waypoint card, possibly on a completely different user's canvas and
    // arbitrarily deep inside it. Own-canvas waypoints are already fully loaded locally
    // (loadWorkspace loads this user's whole tree up front), so that's just a normal openFolder;
    // a friend's waypoint needs its whole access path fetched and injected level by level first
    // (get_folder_ancestor_chain + ensureSharedFolderLoaded per level) so that once there,
    // findParentFolderId/the breadcrumb "up" navigation work exactly like a hand-drilled visit —
    // same reasoning as openSharedCanvas/ensureSharedFolderLoaded above, just resolving every
    // level of the path in one shot instead of one openFolder click at a time.
    // Walks the ancestor chain from the top of ownerId's shared tree down to folderId (via
    // get_folder_ancestor_chain) and loads every level along the way, same as clicking down into
    // each one by hand would — used both for a waypoint landing deep inside someone else's canvas
    // and for resuming a shared session after a page reload (see loadWorkspace). Returns the
    // array of local (shared:owner:id) keys in root-to-target order, or null if any level failed
    // to resolve/load.
    async function resolveSharedFolderChain(ownerId, folderId) {
        if (!supabase || !appState.currentUser.id) return null;
        const { data: chain, error } = await supabase.rpc('get_folder_ancestor_chain', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !chain || !chain.length) { console.error('[collab] failed to resolve shared folder path:', error); return null; }
        const localKeys = [];
        for (const fid of chain) {
            const key = sharedFolderKey(ownerId, fid);
            if (!(await ensureSharedFolderLoaded(key))) return null;
            localKeys.push(key);
        }
        return localKeys;
    }
    async function goToWaypointCard(ownerId, folderId, itemId) {
        closeHamburgerMenu();
        if (ownerId === appState.currentUser.id) {
            if (appState.currentFolderId !== folderId) openFolder(folderId);
            const it = appState.folders[folderId] && appState.folders[folderId].items.find(i => String(i.id) === String(itemId));
            if (it) peekWaypointCard(folderId, it);
            return;
        }
        const isFreshEntry = !preSharedViewState;
        if (isFreshEntry) preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        const localKeys = await resolveSharedFolderChain(ownerId, folderId);
        if (!localKeys) { if (isFreshEntry) preSharedViewState = null; return; }
        appState.currentFolderId = localKeys[localKeys.length - 1];
        appState.historyStack = localKeys;
        appState.historyIndex = localKeys.length - 1;
        render();
        if (isFreshEntry) announceEnteredCollaboration(localKeys[0]);
        const it = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.find(i => String(i.id) === String(itemId));
        if (it) peekWaypointCard(appState.currentFolderId, it);
    }
    function hmenuAction(action) {
        console.log('[Menu] action:', action);
        closeHamburgerMenu();
        closeProfilePanel();
        if (action === 'upgrade') {
            openPricingOverlay();
        } else if (action === 'logout') {
            // Flush whatever's still sitting in the debounced save timer (e.g. a pan/zoom just
            // before clicking logout) before navigating away, so the next login restores exactly
            // where this session left off — same as pagehide/visibilitychange do for a plain
            // refresh or tab close.
            saveWorkspaceNow().finally(() => {
                if (supabase) supabase.auth.signOut().finally(() => { window.location.href = '/login'; });
                else window.location.href = '/login';
            });
        }
    }
    drawSettings.addEventListener('click', (e) => e.stopPropagation());
    addMenu.addEventListener('click', (e) => e.stopPropagation());

    // ---------- Profile Panel Controls ----------
    const profileBtn = document.getElementById('btn-profile'), profilePanel = document.getElementById('profile-panel');

    // 20-tier / 9-sub-rank (180 total sub-level) progression system — canonical source is
    // lib/leveling.js (calculateUserLevel); duplicated here verbatim because this is a classic,
    // non-module script (see app/dotto-app.jsx) that can't import it. Keep the two in sync.
    const LEVEL_NAMES = [
        'Noob', 'Novice', 'Apprentice', 'Learner', 'Scholar', 'Seeker', 'Thinker', 'Strategist',
        'Specialist', 'Expert', 'Master', 'Savant', 'Polymath', 'Brainiac', 'Prodigy', 'Intellect',
        'Visionary', 'Titan', 'Archon', 'Omniscient',
    ];
    const SUB_RANKS_PER_TIER = 9;
    const TOTAL_SUB_LEVELS = LEVEL_NAMES.length * SUB_RANKS_PER_TIER; // 180
    const LEVEL_GROWTH_RATE = 1.045;
    const LEVEL_BASE_POINTS = 100;
    function scoreRequiredForLevel(level) {
        if (level <= 1) return 0;
        return Math.floor(LEVEL_BASE_POINTS * (Math.pow(LEVEL_GROWTH_RATE, level - 1) - 1) / (LEVEL_GROWTH_RATE - 1));
    }
    function calculateUserLevel(score) {
        const totalScore = Math.max(0, Math.floor(score || 0));
        let absoluteLevel = 1;
        for (let level = 2; level <= TOTAL_SUB_LEVELS; level++) {
            if (totalScore >= scoreRequiredForLevel(level)) absoluteLevel = level;
            else break;
        }
        const tierIndex = Math.floor((absoluteLevel - 1) / SUB_RANKS_PER_TIER);
        const subRank = ((absoluteLevel - 1) % SUB_RANKS_PER_TIER) + 1;
        const tierName = LEVEL_NAMES[tierIndex];
        const currentThreshold = scoreRequiredForLevel(absoluteLevel);
        const isMaxLevel = absoluteLevel >= TOTAL_SUB_LEVELS;
        const nextThreshold = isMaxLevel ? currentThreshold : scoreRequiredForLevel(absoluteLevel + 1);
        const currentLevelScore = totalScore - currentThreshold;
        const nextLevelScore = nextThreshold - currentThreshold;
        const progressPercentage = isMaxLevel ? 100 : Math.max(0, Math.min(100, (currentLevelScore / nextLevelScore) * 100));
        return { totalScore, absoluteLevel, tierIndex, tierName, subRank, displayName: `${tierName} ${subRank}`, currentLevelScore, nextLevelScore, progressPercentage };
    }
    // Centralized score-award entry point for every client-side action that grants points (chat
    // message, canvas block, flashcard flip, ...) — mirrors lib/leveling.js's awardUserPoints,
    // duplicated for the same no-import-system reason as calculateUserLevel above. Re-renders the
    // profile level display live on success so the user sees the change immediately, without
    // needing a page refresh.
    async function awardUserPoints(actionType, points) {
        if (!supabase || !appState.currentUser.id) return { ok: false, reason: 'no_session' };
        const oldLevel = calculateUserLevel(appState.currentUser.totalScore);
        const { data, error } = await supabase.rpc('award_user_points', { p_user_id: appState.currentUser.id, p_action_type: actionType, p_points: points });
        if (error) { console.error('[leveling] award_user_points failed:', error); return { ok: false, reason: 'error' }; }
        appState.currentUser.totalScore = data;
        renderProfileLevel();
        const newLevel = calculateUserLevel(appState.currentUser.totalScore);
        if (newLevel.absoluteLevel > oldLevel.absoluteLevel) {
            pushNotification({ type: 'level_up', message: `Level up! You're now ${newLevel.displayName}` }); // no buttons, auto-dismisses — no dismiss function
        }
        return { ok: true, totalScore: data };
    }
    // Populates #profile-level-pill's text (e.g. "Noob 1") and per-tier colour from
    // currentUser.totalScore — called once on init (below) and again after awardUserPoints so it
    // updates live. One CSS rule can't express 20 different tier colours, so the pill's
    // background/text colour is generated here instead of hardcoded per tier: an even hue step
    // per tier around the wheel (360/20 = 18°) keeps every tier visually distinct without hand
    // -picking 20 hex values, and automatically stays distinct if LEVEL_NAMES ever grows/shrinks.
    function levelTierColor(tierIndex) {
        const hue = Math.round((tierIndex * 360) / LEVEL_NAMES.length);
        return `hsl(${hue}, 62%, 38%)`;
    }
    function renderProfileLevel() {
        if (!appState.currentUser.id) return;
        const lvl = calculateUserLevel(appState.currentUser.totalScore);
        const pillEl = document.getElementById('profile-level-pill');
        if (!pillEl) return;
        const textEl = pillEl.querySelector('.profile-level-pill-text');
        if (textEl) textEl.textContent = lvl.displayName;
        pillEl.style.background = levelTierColor(lvl.tierIndex);
        pillEl.style.color = '#fff';
    }
    // Populates the flame+day-count streak pill from currentUser.loginStreak, computed
    // server-side once per page load (see bump_login_streak / app/page.js) — there's nothing to
    // recompute client-side, this just displays it.
    function renderProfileStreak() {
        if (!appState.currentUser.id) return;
        const el = document.getElementById('profile-streak-count');
        if (el) el.textContent = appState.currentUser.loginStreak || 0;
    }
    // `avatar` is { id, url } — url is the saved custom avatar-builder composite (Supabase
    // Storage public URL, once a user completes /avatar-setup) and always wins when present;
    // id falls back to the older static /assets/avatar/avatar-{n}.png set (0 = default
    // silhouette) for accounts that haven't built a custom avatar. Falls back to initials if the
    // resolved src fails to load.
    function renderAvatarInto(el, avatar, fallbackText) {
        if (!el) return;
        const src = (avatar && avatar.url) ? avatar.url : `/assets/avatar/avatar-${(avatar && avatar.id) || 0}.png`;
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.onerror = () => { el.innerHTML = ''; el.textContent = fallbackText; };
        el.innerHTML = '';
        el.appendChild(img);
    }
    if (appState.currentUser.id) {
        document.getElementById('profile-username').textContent = appState.currentUser.displayName;
        const avatar = { id: appState.currentUser.avatarId ?? 0, url: appState.currentUser.avatarUrl || null };
        renderAvatarInto(document.getElementById('profile-avatar'), avatar, initials(appState.currentUser.displayName));
        renderAvatarInto(document.getElementById('profile-avatar-sm'), avatar, initials(appState.currentUser.displayName));
        renderProfileLevel();
        renderProfileStreak();
    }

    // ---------- Achievements ----------
    // Backs the spritebook below: each of the first 8 sprite slots is tied to one achievement,
    // tracked server-side via the generic bump_achievement_stat RPC (see
    // supabase/migrations/20260730_add_achievements.sql) rather than one bespoke column/RPC per
    // achievement. statKey/threshold are client-defined constants passed straight to the RPC —
    // not security-sensitive, same trust level as awardUserPoints' p_points above.
    const ACHIEVEMENTS = [
        { id: 'first_block',      statKey: 'blocks_placed',    threshold: 1,     name: 'Place your first block',        spriteIndex: 1 },
        { id: 'three_friends',    statKey: 'friends_added',    threshold: 3,     name: 'Add three friends',              spriteIndex: 2 },
        { id: 'five_scheduled',   statKey: 'blocks_scheduled', threshold: 5,     name: 'Schedule five blocks',           spriteIndex: 3 },
        { id: 'twenty_searches',  statKey: 'ai_searches',      threshold: 20,    name: 'Make twenty AI searches',        spriteIndex: 4 },
        { id: 'fifty_links',      statKey: 'data_links',       threshold: 50,    name: 'Make fifty links in data mode',  spriteIndex: 5 },
        { id: 'hundred_flips',    statKey: 'flashcard_flips',  threshold: 100,   name: 'Flip one hundred cards',         spriteIndex: 6 },
        { id: 'master_250_words', statKey: 'words_mastered',   threshold: 250,   name: 'Master 250 words',               spriteIndex: 7 },
        { id: 'day_in_platform',  statKey: 'platform_seconds', threshold: 86400, name: 'Spend 24 hours in the platform', spriteIndex: 8 },
    ];
    const unlockedAchievementIds = new Set(appState.currentUser.unlockedAchievementIds || []);

    // Bumps one achievement's stat counter and, if it just crossed its threshold, unlocks it: the
    // spritebook re-renders live and two notifications queue up in order — "Achievement unlocked!
    // (name)" then "Sprite N will spawn soon". The actual on-canvas spawn isn't implemented yet
    // (deliberately deferred to a follow-up pass) — this only announces it.
    //
    // delta/absolute mirror bump_achievement_stat's two counter modes: plain incrementing tallies
    // (the default) for most achievements, vs. `absolute` for stats where the caller already knows
    // its own true current total (e.g. three_friends passes friends.length, which is symmetric
    // regardless of who sent/accepted the request, so it just needs to be synced in, never
    // regressed).
    async function bumpAchievementStat(achievementId, delta = 1, absolute = false) {
        if (!supabase || !appState.currentUser.id) return;
        if (unlockedAchievementIds.has(achievementId)) return; // already unlocked — stop paying for RPC calls
        const def = ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!def) return;
        const { data, error } = await supabase.rpc('bump_achievement_stat', {
            p_user_id: appState.currentUser.id, p_stat_key: def.statKey, p_achievement_id: def.id,
            p_threshold: def.threshold, p_delta: delta, p_absolute: absolute,
        });
        if (error) { console.error('[achievements] bump_achievement_stat failed:', error); return; }
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.newly_unlocked) {
            unlockedAchievementIds.add(def.id);
            const grid = document.getElementById('profile-sprite-grid');
            if (grid) renderSpriteGrid(grid, SPRITE_TOTAL_COUNT);
            pushNotification({ type: 'achievement_unlock', message: `Achievement unlocked! (${def.name})` });
            pushNotification({ type: 'achievement_unlock', message: `Sprite ${def.spriteIndex} will spawn soon` });
        }
    }

    // Static asset grid, dropped into /public/sprites by hand: the first 8 cells are the
    // achievement-tied sprites above, each showing its own locked/unlocked art
    // (sprite-N-locked.png / sprite-N.png) based on unlockedAchievementIds; every cell after that
    // has no achievement at all, so it always shows the shared unknown-sprite.png regardless of
    // any state. A cell with a missing file just shows its empty placeholder space rather than a
    // broken-image icon. Always renders the full set (no separate compact/expanded view) — the
    // block itself just grows to fill the panel and scrolls internally (see
    // #profile-spritebook-block/positionProfilePanel).
    const SPRITE_TOTAL_COUNT = 108;
    function renderSpriteGrid(container, count) {
        container.innerHTML = '';
        for (let i = 1; i <= count; i++) {
            const cell = document.createElement('div');
            cell.className = 'profile-sprite-cell';
            const img = document.createElement('img');
            img.src = i > ACHIEVEMENTS.length ? '/sprites/unknown-sprite.png'
                : unlockedAchievementIds.has(ACHIEVEMENTS[i - 1].id) ? `/sprites/sprite-${i}.png` : `/sprites/sprite-${i}-locked.png`;
            img.alt = '';
            img.onerror = () => img.remove();
            cell.appendChild(img);
            container.appendChild(cell);
        }
    }
    // Active-time-only platform-usage tracker for the day_in_platform achievement — only ever
    // advances while the tab is actually visible/focused at the moment each tick fires (no
    // idle/backgrounded time counted), and bumpAchievementStat already no-ops once unlocked, so
    // this stops calling the RPC entirely once the 24h mark is reached.
    setInterval(() => {
        if (document.visibilityState === 'visible') bumpAchievementStat('day_in_platform', 60);
    }, 60000);
    renderSpriteGrid(document.getElementById('profile-sprite-grid'), SPRITE_TOTAL_COUNT);
    function closeProfilePanel() { profilePanel.classList.remove('open'); profileBtn.classList.remove('active'); panelPinned.profile = false; }
    // Panel height is set explicitly (not just left to CSS) so #profile-spritebook-block's
    // flex:1 has an actual constrained container to grow into and scroll within, filling from
    // the button down to a fixed margin above the bottom of the viewport — same margin
    // convention as #hamburger-stack.
    function positionProfilePanel() {
        const rect = profileBtn.getBoundingClientRect();
        const top = rect.bottom + 10;
        profilePanel.style.top = top + 'px';
        const panelWidth = 240;
        let leftPos = rect.right - panelWidth;
        if (leftPos < 20) leftPos = 20;
        profilePanel.style.left = leftPos + 'px';
        profilePanel.style.right = 'auto';
        profilePanel.style.height = (window.innerHeight - top - 20) + 'px';
    }
    // Keeps the panel's explicit height (see positionProfilePanel) matching the viewport if the
    // window is resized while it's open — otherwise it'd be stuck at whatever height was current
    // at open time.
    window.addEventListener('resize', () => { if (profilePanel.classList.contains('open')) positionProfilePanel(); });
    function openProfilePanel(pin) {
        closeAllPanels('profile');
        profilePanel.classList.add('open');
        profileBtn.classList.add('active');
        positionProfilePanel();
        refreshDotbotUsage();
        // Always start at the top of the sprite grid, not wherever it happened to be scrolled to
        // last time the panel was open.
        const sbScroll = document.getElementById('profile-spritebook-scroll');
        if (sbScroll) sbScroll.scrollTop = 0;
        if (pin) panelPinned.profile = true;
    }

    function ordinalSuffix(n) {
        const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }
    function formatResetTime(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    function formatResetDate(d) {
        const day = d.getDate();
        return `${d.toLocaleDateString(undefined, { month: 'long' })} ${day}${ordinalSuffix(day)}`;
    }
    // Total cards across every canvas the user has, regardless of which one is currently open —
    // a pure client-side count (no new column), since the whole workspace is already loaded in
    // memory. Never resets; the only way down is deleting cards (or, eventually, upgrading).
    const BLOCKS_CAP = 100;
    function totalBlocksUsed() {
        return Object.values(appState.folders).reduce((sum, f) => sum + (f.items ? f.items.length : 0), 0);
    }

    // Fills all three usage bars — split across the two independent credit pools (search: 30
    // per 6h, generation: 100 per month — see lib/dotbot.js) plus the client-computed blocks
    // count. Bar-only, no numbers anywhere; each fills UP as usage goes up. Mirrors each RPC's
    // own lazy-reset logic purely for display, without writing anything.
    let dotbotUpgradePromptedForFullness = false;
    // Same "warn once per cycle" pattern as dotbotUpgradePromptedForFullness above — reset back
    // to false once the credits actually reset (searchExpired/genExpired below), so the next
    // cycle can warn again.
    let searchUsageWarned = false, genUsageWarned = false;
    function setUsageFillWidth(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }
    // Tooltips directly follow the cursor rather than sitting pinned above the row (see the
    // position:absolute/no-transition setup on .profile-usage-tooltip) — offset a few px up and
    // left (see .profile-usage-tooltip's translateX(-100%)) so the cursor itself isn't sitting
    // directly on top of the text it points at.
    document.querySelectorAll('.profile-usage-row').forEach(row => {
        const tooltip = row.querySelector('.profile-usage-tooltip');
        if (!tooltip) return;
        row.addEventListener('mousemove', (e) => {
            const rect = row.getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left - 12) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
        });
    });
    async function refreshDotbotUsage() {
        const searchFill = document.getElementById('profile-usage-search-fill');
        if (!searchFill || !supabase || !appState.currentUser.id) return;
        const blocksFillEl = document.getElementById('profile-usage-blocks-fill');
        const genFillEl = document.getElementById('profile-usage-generation-fill');
        // Every time the panel opens, the bars should visibly fill up from empty — not animate
        // from wherever they happened to be left last time. Snap to 0% instantly (transition
        // disabled for this one write) before the real target widths below animate in normally.
        const allFills = [searchFill, blocksFillEl, genFillEl];
        allFills.forEach(el => { el.style.transition = 'none'; el.style.width = '0%'; });
        void searchFill.offsetWidth; // commit the instant 0% before re-enabling the transition
        allFills.forEach(el => { el.style.transition = ''; });

        const { data, error } = await supabase
            .from('profiles')
            .select('search_credits_remaining, search_credits_reset_at, generation_credits_remaining, generation_credits_reset_at')
            .eq('id', appState.currentUser.id)
            .single();
        if (error || !data) return;

        const sixHoursMs = 6 * 60 * 60 * 1000;
        const searchResetAt = new Date(data.search_credits_reset_at);
        const searchExpired = Date.now() - searchResetAt.getTime() >= sixHoursMs;
        const searchRemaining = searchExpired ? 30 : data.search_credits_remaining;
        const searchUsedPct = ((30 - searchRemaining) / 30) * 100;
        setUsageFillWidth('profile-usage-search-fill', searchUsedPct);
        const nextSearchReset = new Date((searchExpired ? Date.now() : searchResetAt.getTime()) + sixHoursMs);
        document.getElementById('profile-usage-search-tooltip').textContent = `Resets at ${formatResetTime(nextSearchReset)}`;
        if (searchExpired) searchUsageWarned = false;
        if (!searchUsageWarned && searchUsedPct >= 75) {
            searchUsageWarned = true;
            pushNotification({ type: 'usage_update', message: `75% of your search limit used. Resets at ${formatResetTime(nextSearchReset)}`, actionLabel: 'Upgrade', onAction: openDotbotUpgradeModal });
        }

        const monthMs = 30 * 24 * 60 * 60 * 1000;
        const genResetAt = new Date(data.generation_credits_reset_at);
        const genExpired = Date.now() - genResetAt.getTime() >= monthMs;
        const genRemaining = genExpired ? 100 : data.generation_credits_remaining;
        const genUsedPct = ((100 - genRemaining) / 100) * 100;
        setUsageFillWidth('profile-usage-generation-fill', genUsedPct);
        const nextGenReset = new Date((genExpired ? Date.now() : genResetAt.getTime()) + monthMs);
        document.getElementById('profile-usage-generation-tooltip').textContent = `Resets ${formatResetDate(nextGenReset)}`;
        if (genExpired) genUsageWarned = false;
        if (!genUsageWarned && genUsedPct >= 75) {
            genUsageWarned = true;
            pushNotification({ type: 'usage_update', message: `75% of your generation limit used. Resets ${formatResetDate(nextGenReset)}`, actionLabel: 'Upgrade', onAction: openDotbotUpgradeModal });
        }

        const blocksUsed = totalBlocksUsed();
        setUsageFillWidth('profile-usage-blocks-fill', (blocksUsed / BLOCKS_CAP) * 100);
        document.getElementById('profile-usage-blocks-tooltip').textContent = `${blocksUsed}/${BLOCKS_CAP}`;

        if (searchRemaining <= 0) {
            if (!dotbotUpgradePromptedForFullness) { dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
        } else {
            dotbotUpgradePromptedForFullness = false;
        }
    }
    function openDotbotUpgradeModal() { document.getElementById('dotbot-upgrade-overlay').classList.add('open'); }
    function closeDotbotUpgradeModal() { document.getElementById('dotbot-upgrade-overlay').classList.remove('open'); }

    // ---------- Pricing / upgrade page ----------
    // Full-screen 3-tier comparison (Free/Pro/Polyglot) — opened from the profile menu's "Try
    // Dotto Pro" button (see hmenuAction) and the paid-tier-ad notification's "Upgrade" button
    // (see the ad notification setup further down). Placeholder prices/taglines/features — no
    // real billing/subscription system exists in this codebase yet, so the paid CTAs surface a
    // "coming soon" notification instead of pretending to start a real checkout.
    const PRICING_PLANS = [
        { id: 'free', name: 'Free', price: '$0', period: '/mo', tagline: 'Get started with the basics.', cta: 'Current Plan', current: true },
        { id: 'pro', name: 'Pro', price: '$9', period: '/mo', tagline: 'For learners leveling up fast.', cta: 'Upgrade to Pro', featured: true },
        { id: 'polyglot', name: 'Polyglot', price: '$19', period: '/mo', tagline: 'Go all in on every language.', cta: 'Upgrade to Polyglot' },
    ];
    // Each row's `values` is [free, pro, polyglot] — same index lines up across all three cards.
    // A falsy value means that plan doesn't get this feature; it's still shown (greyed, with a
    // dash) using whichever plan's value is truthy, so the row reads the same across all 3 cards.
    const PRICING_FEATURE_ROWS = [
        { values: ['100 canvas blocks', '500 canvas blocks', 'Unlimited canvas blocks'] },
        { values: ['30 Dotbot searches / 6h', '150 Dotbot searches / 6h', 'Unlimited Dotbot searches'] },
        { values: ['100 Dotbot generations / mo', '500 Dotbot generations / mo', 'Unlimited Dotbot generations'] },
        { values: ['Unlimited canvases & waypoints', 'Unlimited canvases & waypoints', 'Unlimited canvases & waypoints'] },
        { values: ['Friends & collaboration', 'Friends & collaboration', 'Friends & collaboration'] },
        { values: [null, 'Priority support', 'Priority support'] },
        { values: [null, null, 'Early access to new features'] },
    ];
    function renderPricingOverlay() {
        const container = document.getElementById('pricing-cards');
        if (!container) return;
        container.innerHTML = '';
        PRICING_PLANS.forEach((plan, i) => {
            const card = document.createElement('div');
            card.className = 'pricing-card' + (plan.featured ? ' pricing-card-featured' : '');
            const featuresHtml = PRICING_FEATURE_ROWS.map(row => {
                const value = row.values[i];
                const label = value || row.values.find(Boolean);
                const excluded = !value;
                return `<li class="${excluded ? 'pricing-feature-excluded' : ''}"><span class="pricing-feature-icon">${excluded ? '–' : '✓'}</span>${escapeHtml(label)}</li>`;
            }).join('');
            card.innerHTML = `
                ${plan.featured ? '<div class="pricing-card-badge">Most Popular</div>' : ''}
                <div class="pricing-card-name">${escapeHtml(plan.name)}</div>
                <div class="pricing-card-price"><span class="pricing-card-price-amount">${escapeHtml(plan.price)}</span><span class="pricing-card-price-period">${escapeHtml(plan.period)}</span></div>
                <div class="pricing-card-tagline">${escapeHtml(plan.tagline)}</div>
                <button class="pricing-card-cta" type="button" ${plan.current ? 'disabled' : ''}>${escapeHtml(plan.cta)}</button>
                <div class="pricing-card-divider"></div>
                <ul class="pricing-card-features">${featuresHtml}</ul>
            `;
            if (!plan.current) card.querySelector('.pricing-card-cta').onclick = () => startPlanUpgrade(plan.id);
            container.appendChild(card);
        });
    }
    function openPricingOverlay() {
        closeAllPanels(null);
        closeProfilePanel();
        renderPricingOverlay();
        document.getElementById('pricing-overlay').classList.add('open');
    }
    function closePricingOverlay() {
        const el = document.getElementById('pricing-overlay');
        if (el) el.classList.remove('open');
    }
    function startPlanUpgrade(planId) {
        closePricingOverlay();
        pushNotification({ type: 'upgrade_unavailable', message: "Upgrades aren't available yet — check back soon!" }); // no buttons, auto-dismisses
    }
    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Once the button is showing the power icon (:hover only — see the CSS swap, which is
        // deliberately not also tied to .active/panel-open), clicking it logs out instead of
        // toggling the panel — that's the whole point of the swap. A genuine mouse click can
        // only land while the cursor is over the button, so :hover is already true in normal
        // use; the toggle-panel branch mainly exists so a keyboard-only "click" (Enter with no
        // prior hover) opens the panel on its first activation rather than logging out blind.
        if (profileBtn.matches(':hover')) { hmenuAction('logout'); }
        else { openProfilePanel(true); }
    });
    profileBtn.addEventListener('mouseenter', () => { if (!profilePanel.classList.contains('open')) openProfilePanel(false); });
    profileBtn.addEventListener('mouseleave', () => scheduleHoverClose('profile', [profileBtn, profilePanel], closeProfilePanel));
    profilePanel.addEventListener('mouseleave', () => scheduleHoverClose('profile', [profileBtn, profilePanel], closeProfilePanel));
    pinOnInsideClick('profile', [profilePanel]);

    // ---------- Messages Panel Controls ----------
    const messagesBtn = document.getElementById('btn-messages'), messagesPanel = document.getElementById('messages-panel');
    const msgConvo = document.getElementById('msg-convo'), msgList = document.getElementById('msg-list');
    const msgSearchInput = document.getElementById('msg-search');
    // Also closes any open conversation (not just the panel around it) — otherwise it stays
    // "open" internally at whatever scroll position was left, and reopening the panel later
    // shows that same stale state instead of a fresh bottom-of-conversation view.
    function closeMessagesPanel() { messagesPanel.classList.remove('open'); messagesBtn.classList.remove('active'); panelPinned.messages = false; closeConvo(); }
    function positionMessagesPanel() {
        const rect = messagesBtn.getBoundingClientRect();
        messagesPanel.style.bottom = 'auto';
        messagesPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 320;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        messagesPanel.style.left = leftPos + 'px';
        messagesPanel.style.right = 'auto';
    }
    function openMessagesPanel(pin) {
        closeAllPanels('messages');
        clearSearch();
        messagesPanel.classList.add('open');
        messagesBtn.classList.add('active');
        closeConvo();
        msgView = 'main'; // always land on the main list, never mid-Requests from last time
        msgSearchInput.value = '';
        renderMsgList('');
        positionMessagesPanel();
        if (pin) { msgSearchInput.focus(); panelPinned.messages = true; }
    }
    messagesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.messages) { closeMessagesPanel(); }
        else { openMessagesPanel(true); }
    });
    messagesBtn.addEventListener('mouseenter', () => { if (!messagesPanel.classList.contains('open')) openMessagesPanel(false); });
    messagesBtn.addEventListener('mouseleave', () => scheduleHoverClose('messages', [messagesBtn, messagesPanel], closeMessagesPanel));
    messagesPanel.addEventListener('mouseleave', () => scheduleHoverClose('messages', [messagesBtn, messagesPanel], closeMessagesPanel));
    pinOnInsideClick('messages', [messagesPanel]);

    // ---------- Schedule: data + shared date helpers ----------
    // Scheduling itself happens conversationally through Dotbot (see the "Dotbot Scheduling
    // Conversation" section below); the schedule button instead puts the whole canvas into a
    // read-only agenda view (see "Schedule View Mode") for browsing what's scheduled.
    let scheduledEvents = []; // { id, itemId, folderId, title, date: 'YYYY-MM-DD', time: 'HH:MM' }
    let scheduleViewDate = new Date();

    const scheduleBtn = document.getElementById('btn-schedule');

    function pad2(n) { return String(n).padStart(2, '0'); }
    function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function formatDateLabel(d) {
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function formatTimeLabel(time) {
        const [h, m] = time.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        return `${h12}:${pad2(m)} ${period}`;
    }
    // scheduledEvents can reference items in any folder (you can schedule a card, navigate
    // away, and still see it in the agenda), so lookups here can't rely on findItemById
    // (which only searches the current folder).
    function findItemInFolder(folderId, itemId) {
        const f = appState.folders[folderId];
        return f ? f.items.find(i => i.id === itemId) : null;
    }

    // ---------- Schedule View Mode ----------
    // Clicking the schedule button turns the current canvas into a read-only timeline: unscheduled
    // cards disappear, scheduled ones from *this* canvas appear as real cards positioned against
    // an hour-marked timeline (see renderScheduleAgenda), on the same dotted grid as the normal
    // canvas. They can't be dragged/moved, but folder/source cards can still be clicked into and
    // notes can still be edited in place. No horizontal scroll, no free panning — only vertical
    // scroll, and only once the timeline is taller than the viewport.
    let scheduleViewMode = false;
    let scheduleViewSavedTransform = null;
    const scheduleView = document.getElementById('schedule-view');
    const scheduleViewCanvasEl = document.getElementById('schedule-view-canvas');
    const scheduleViewInner = document.getElementById('schedule-view-inner');
    const scheduleViewHours = document.getElementById('schedule-view-hours');
    const scheduleViewStack = document.getElementById('schedule-view-stack');

    // Drag-to-scroll (vertical only), same feel as panning the real canvas — set up once since
    // this is a single persistent DOM element, not rebuilt on every render.
    let scheduleScrollDragging = false, scheduleScrollStartY = 0, scheduleScrollStartTop = 0;
    scheduleViewCanvasEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.item')) return; // let clicks/edits on a real card through untouched
        scheduleScrollDragging = true;
        scheduleScrollStartY = e.clientY;
        scheduleScrollStartTop = scheduleViewCanvasEl.scrollTop;
        scheduleViewCanvasEl.setPointerCapture(e.pointerId);
    });
    scheduleViewCanvasEl.addEventListener('pointermove', (e) => {
        if (!scheduleScrollDragging) return;
        scheduleViewCanvasEl.scrollTop = scheduleScrollStartTop - (e.clientY - scheduleScrollStartY);
    });
    scheduleViewCanvasEl.addEventListener('pointerup', () => { scheduleScrollDragging = false; });
    scheduleViewCanvasEl.addEventListener('pointercancel', () => { scheduleScrollDragging = false; });

    function toggleScheduleViewMode() {
        if (scheduleViewMode) exitScheduleViewMode(); else enterScheduleViewMode();
    }
    function enterScheduleViewMode() {
        if (scheduleViewMode) return;
        closeAllPanels(null);
        scheduleViewMode = true;
        scheduleBtn.classList.add('active');
        canvas.classList.add('schedule-view-mode');
        // Mirrors the exact mechanism render() already uses to hide these same three toolbars
        // for source pages (see the folderObj.isSource branch) — they're toggled via inline
        // style there, which a stylesheet rule can never win against, so schedule view mode has
        // to hide them the same way rather than through a CSS class. The schedule toolbar itself
        // is deliberately left alone: it's what toggles the mode back off.
        modeToolbar.style.display = 'none';
        addToolbar.style.display = 'none';
        zoomControl.style.display = 'none';
        scheduleViewSavedTransform = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.scale = 1; appState.tx = 0; appState.ty = 0;
        applyTransform();
        scheduleViewDate = new Date();
        scheduleView.classList.add('active');
        renderScheduleAgenda();
    }
    function exitScheduleViewMode() {
        if (!scheduleViewMode) return;
        scheduleViewMode = false;
        scheduleBtn.classList.remove('active');
        canvas.classList.remove('schedule-view-mode');
        modeToolbar.style.display = '';
        addToolbar.style.display = '';
        zoomControl.style.display = '';
        scheduleView.classList.remove('active');
        if (scheduleViewSavedTransform) {
            ({ tx: appState.tx, ty: appState.ty, scale: appState.scale } = scheduleViewSavedTransform);
            scheduleViewSavedTransform = null;
            applyTransform();
        }
    }
    scheduleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleScheduleViewMode(); });

    function scheduleAgendaShift(unit, delta) {
        const d = new Date(scheduleViewDate);
        if (unit === 'day') d.setDate(d.getDate() + delta);
        else if (unit === 'week') d.setDate(d.getDate() + delta * 7);
        else if (unit === 'month') d.setMonth(d.getMonth() + delta);
        scheduleViewDate = d;
        renderScheduleAgenda();
    }

    function formatHourLabel(h) {
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        return `${h12} ${period}`;
    }

    const SCHEDULE_HOUR_ROW = 96; // px per hour in the timeline

    function renderScheduleAgenda() {
        document.getElementById('schedule-view-date').textContent = formatDateLabel(scheduleViewDate);
        const key = dateKey(scheduleViewDate);
        // Scoped to the current canvas only — matches every other schedule entry point
        // (scheduling itself always records the folderId you were in at the time).
        const folderObj = appState.folders[appState.currentFolderId];
        const list = (folderObj ? folderObj.items : [])
            .map(it => ({ it, ev: scheduledEvents.find(e => e.folderId === appState.currentFolderId && e.itemId === it.id && e.date === key) }))
            .filter(x => x.ev)
            .sort((a, b) => a.ev.time.localeCompare(b.ev.time));

        scheduleViewHours.innerHTML = '';
        scheduleViewStack.innerHTML = '';

        if (!list.length) {
            scheduleViewInner.style.height = '100%';
            scheduleViewStack.innerHTML = `<div id="schedule-view-empty">Nothing scheduled for this day on this canvas.<br><br>Right-click any card (or a selection of cards) and choose "Schedule" to add one.</div>`;
            return;
        }

        let firstHour = 23, lastHour = 0;
        list.forEach(({ ev }) => {
            const h = parseInt(ev.time.split(':')[0], 10);
            firstHour = Math.min(firstHour, h);
            lastHour = Math.max(lastHour, h);
        });

        const totalHeight = (lastHour - firstHour + 1) * SCHEDULE_HOUR_ROW + 40;
        scheduleViewInner.style.height = totalHeight + 'px';

        for (let h = firstHour; h <= lastHour; h++) {
            const marker = document.createElement('div');
            marker.className = 'schedule-view-hour';
            marker.style.top = ((h - firstHour) * SCHEDULE_HOUR_ROW) + 'px';
            marker.textContent = formatHourLabel(h);
            scheduleViewHours.appendChild(marker);
        }

        list.forEach(({ it, ev }) => {
            const [h, m] = ev.time.split(':').map(Number);
            const top = ((h + m / 60) - firstHour) * SCHEDULE_HOUR_ROW;
            const w = Math.min(it.w || 220, 420), hgt = it.h || 100;

            const wrap = document.createElement('div');
            wrap.className = 'schedule-view-card-wrap';
            wrap.style.top = top + 'px';
            wrap.style.width = w + 'px';

            const card = renderRealCardPreview(it);
            card.style.position = 'relative';
            if (it.kind !== 'title') { card.style.width = w + 'px'; card.style.height = hgt + 'px'; }
            wrap.appendChild(card);

            // No dragging/moving (renderRealCardPreview never wires that up — it's a real-looking
            // but otherwise inert clone by default), but folder/source cards can still be clicked
            // into, and a note's text can still be edited directly.
            if (it.kind === 'folder' || it.kind === 'source') {
                card.style.cursor = 'pointer';
                card.addEventListener('click', (e) => { e.stopPropagation(); exitScheduleViewMode(); openFolder(it.folderId); });
            } else if (it.kind === 'note') {
                const body = card.querySelector('.body');
                if (body) {
                    body.contentEditable = 'true';
                    body.style.cursor = 'text';
                    body.addEventListener('pointerdown', (e) => e.stopPropagation());
                    body.addEventListener('blur', () => { it.html = body.innerHTML; scheduleWorkspaceSave(); });
                }
            }

            scheduleViewStack.appendChild(wrap);
        });
    }

    // ---------- Dotbot Scheduling Conversation ----------
    // Dragging a card (or a multi-card selection) onto the schedule button hands off to Dotbot
    // in the search box rather than opening a date/time form directly — Dotbot asks when, the
    // next thing you type in the search box is read as the answer instead of a search query.
    let dotbotScheduleConversation = null; // { itemIds: [...] } while awaiting the user's reply

    // `previewEl`, when given, is shown above the (typed-out) message — a real card preview for
    // a single item, or an inline-canvas preview for several (see startScheduleConversation) — so
    // you can see exactly what you're scheduling while Dotbot asks when. The dropdown/search box
    // naturally grows to fit it since nothing here constrains its height.
    function renderDotbotPrompt(text, previewEl) {
        searchSuggestions.innerHTML = '';
        if (previewEl) searchSuggestions.appendChild(previewEl);
        const msg = document.createElement('div');
        msg.className = 'search-suggestion-item dotbot-prompt-msg';
        searchSuggestions.appendChild(msg);
        searchResults.style.display = 'none';
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        typewriterReveal(msg, text, updateSearchDropdown);
    }

    // Starts the "when would you like to schedule X for?" Dotbot conversation for an arbitrary
    // set of item ids — entry point is now dragging a card (or the active multi-selection) onto
    // the schedule button (see its drop-zone check in setupDraggingAndClicking's drag `up`
    // handler), replacing the old right-click "Schedule" context-menu option.
    function startScheduleConversation(itemIds) {
        if (!itemIds.length) return;
        dotbotScheduleConversation = { itemIds };
        closeAllPanels(null);
        const it = findItemById(itemIds[0]);
        const label = itemIds.length === 1 ? (miniLabelForItem(it) || 'this card') : `these ${itemIds.length} cards`;

        // Show exactly what's being scheduled: the real card itself for one, an inline-canvas
        // preview for several.
        let previewEl = null;
        if (itemIds.length === 1 && it) {
            previewEl = document.createElement('div');
            previewEl.className = 'dotbot-schedule-card-preview';
            const mini = renderRealCardPreview(it);
            mini.style.position = 'relative';
            mini.style.width = (it.w || 220) + 'px';
            mini.style.height = (it.kind === 'title' ? 'auto' : (it.h || 100) + 'px');
            previewEl.appendChild(mini);
        } else if (itemIds.length > 1) {
            previewEl = renderInlineCanvas(itemIds.map(id => findItemById(id)).filter(Boolean), false);
        }

        renderDotbotPrompt(`When would you like to schedule ${label} for?`, previewEl);
        searchInput.value = '';
        autoGrowSearchInput();
        searchInput.focus();
    }
    function cancelDotbotScheduleConversation() {
        if (!dotbotScheduleConversation) return;
        dotbotScheduleConversation = null;
        clearSearch();
    }
    function submitDotbotScheduleAnswer(text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const parsed = parseScheduleDateTime(trimmed);
        if (!parsed) {
            renderDotbotPrompt(`Sorry, I didn't catch a date/time there — try something like "tomorrow at 3pm" or "next monday 9am".`);
            searchInput.value = '';
            autoGrowSearchInput();
            return;
        }
        const { itemIds } = dotbotScheduleConversation;
        itemIds.forEach(id => {
            const it = findItemById(id);
            if (!it) return;
            const existing = scheduledEvents.find(e => e.itemId === id && e.folderId === appState.currentFolderId);
            if (existing) { existing.date = parsed.date; existing.time = parsed.time; existing.title = miniLabelForItem(it); }
            else {
                scheduledEvents.push({ id: 'ev_' + appState.idCounter++, itemId: id, folderId: appState.currentFolderId, title: miniLabelForItem(it), date: parsed.date, time: parsed.time });
                bumpAchievementStat('five_scheduled');
            }
        });
        scheduleWorkspaceSave();
        const when = formatDateLabel(new Date(parsed.date + 'T00:00:00')) + ' at ' + formatTimeLabel(parsed.time);
        const count = itemIds.length;
        dotbotScheduleConversation = null;
        renderDotbotPrompt(`Done — ${count === 1 ? "that's" : `all ${count} are`} scheduled for ${when}.`);
        searchInput.value = '';
        autoGrowSearchInput();
    }

    // ---------- Scheduled-card due-time notifications ----------
    // Purely client-side (no server push infra — real screen-locked mobile reminders would need
    // the same Edge Function/Web Push piece described alongside subscribeToAllFriendMessages
    // above): polls scheduledEvents against the clock every 20s while the tab is open, gated by
    // the same visible-tab/held-while-away rules as every other notification (see
    // pushNotification/tryShowNextNotification). notifiedScheduledEventIds is in-memory only —
    // resets on reload, so a still-due, still-undismissed event can notify again next session,
    // which is the right trade-off until this has real server-side persistence.
    let notifiedScheduledEventIds = new Set();
    function checkDueScheduledEvents() {
        const now = new Date();
        const nowKey = dateKey(now);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        scheduledEvents.forEach(ev => {
            if (notifiedScheduledEventIds.has(ev.id)) return;
            if (ev.date !== nowKey) return;
            const [h, m] = ev.time.split(':').map(Number);
            if (h * 60 + m > nowMinutes) return; // not due yet
            notifiedScheduledEventIds.add(ev.id);
            pushNotification({
                type: 'scheduled_card',
                message: `Time for "${ev.title}"`,
                actionLabel: 'Go',
                onAction: () => goToOutlineItem(ev.folderId, ev.itemId),
                // No dismiss button — Escape hides it; the reminder itself isn't cleared, so it's
                // still visible in schedule view either way.
                sticky: true, // does not self-dismiss
            });
        });
    }
    setInterval(checkDueScheduledEvents, 20000);

    // ---------- Day-change notification (3am cutoff, not midnight) ----------
    // "Today" for stats purposes runs 3am-to-3am rather than midnight-to-midnight — this is
    // purely a clock/calendar concept (nothing here actually resets anything; every system with
    // its own daily/rolling window — login streak, Dotbot credits — already tracks its own
    // independent boundary, see their own migrations). This just tells the user a new day has
    // started while they're sitting there. Checked every minute against a local day-bucket key
    // rather than scheduling one big setTimeout for the literal next 3am — the tab can be closed/
    // reopened, the system clock can change, DST can shift things — a cheap periodic recheck is
    // simple and self-correcting where a single long-lived timer wouldn't be.
    function statsDayKey(d) {
        const bucket = new Date(d);
        if (bucket.getHours() < 3) bucket.setDate(bucket.getDate() - 1);
        return dateKey(bucket);
    }
    let lastStatsDayKey = statsDayKey(new Date()); // baseline on load — only an actual crossing notifies, not "today" itself
    setInterval(() => {
        const nowKey = statsDayKey(new Date());
        if (nowKey === lastStatsDayKey) return;
        lastStatsDayKey = nowKey;
        pushNotification({ type: 'day_change', message: 'A new day has started' }); // no buttons, auto-dismisses — no dismiss function
    }, 60000);

    // ---------- Paid-tier ad notification ----------
    // No real subscription/tier system exists (see the pricing page comment above — everyone is
    // effectively on the free plan right now), so this can't gate on "already paid" the way a
    // real ad would. It just shows once per session, a few minutes in, as a soft nudge toward the
    // pricing page — cadence and copy are both placeholders, same as the pricing page's own
    // content, easy to retune once there's a real plan for it to point at.
    setTimeout(() => {
        pushNotification({
            type: 'paid_tier_ad',
            message: 'Unlock more with Dotto Pro — higher limits, priority support, and more.',
            actionLabel: 'Upgrade',
            onAction: openPricingOverlay,
            durationMs: 10000,
        });
    }, 3 * 60 * 1000);

    // A small deterministic parser (no AI call needed) for the kinds of casual date/time
    // replies people actually type: "tomorrow at 3pm", "next monday 9am", "in 2 days",
    // "friday at noon", explicit "2026-07-25", or "july 25".
    const SCHEDULE_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const SCHEDULE_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    function parseScheduleDateTime(input) {
        let rest = input.trim().toLowerCase();
        if (!rest) return null;

        // Date phrases are matched (and their matched text removed from `rest`) before the time
        // is ever searched for — otherwise a bare number that's actually part of a date phrase
        // (the "3" in "in 3 days at 11am") gets misread as the time.
        const dateBase = new Date();
        dateBase.setHours(0, 0, 0, 0);
        let dateFound = false;

        if (/\btoday\b/.test(rest)) { rest = rest.replace(/\btoday\b/, ''); dateFound = true; }
        else if (/\btomorrow\b/.test(rest)) { dateBase.setDate(dateBase.getDate() + 1); rest = rest.replace(/\btomorrow\b/, ''); dateFound = true; }
        else if (/\bnext week\b/.test(rest)) { dateBase.setDate(dateBase.getDate() + 7); rest = rest.replace(/\bnext week\b/, ''); dateFound = true; }
        else if (/\bnext month\b/.test(rest)) { dateBase.setMonth(dateBase.getMonth() + 1); rest = rest.replace(/\bnext month\b/, ''); dateFound = true; }
        else {
            const inMatch = rest.match(/\bin\s+(\d+)\s*(day|days|week|weeks|month|months)\b/);
            const wdIdx = SCHEDULE_WEEKDAYS.findIndex(w => rest.includes(w));
            const isoMatch = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
            const monthIdx = SCHEDULE_MONTHS.findIndex(m => rest.includes(m));
            if (inMatch) {
                const n = parseInt(inMatch[1], 10);
                const unit = inMatch[2];
                if (unit.startsWith('day')) dateBase.setDate(dateBase.getDate() + n);
                else if (unit.startsWith('week')) dateBase.setDate(dateBase.getDate() + n * 7);
                else dateBase.setMonth(dateBase.getMonth() + n);
                rest = rest.replace(inMatch[0], '');
                dateFound = true;
            } else if (wdIdx !== -1) {
                // "next <weekday>" means the same upcoming occurrence as "<weekday>" alone in
                // ordinary usage — "next" only needs to push a whole week further out in the one
                // case where the plain weekday would otherwise mean *today*.
                const isNext = /\bnext\b/.test(rest);
                const cur = dateBase.getDay();
                let diff = (wdIdx - cur + 7) % 7;
                if (diff === 0 && isNext) diff = 7;
                dateBase.setDate(dateBase.getDate() + diff);
                rest = rest.replace(/\bnext\b/, '').replace(new RegExp(`\\b${SCHEDULE_WEEKDAYS[wdIdx]}\\b`), '');
                dateFound = true;
            } else if (isoMatch) {
                dateBase.setFullYear(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
                rest = rest.replace(isoMatch[0], '');
                dateFound = true;
            } else if (monthIdx !== -1) {
                const dayMatch = rest.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
                if (dayMatch) {
                    const day = parseInt(dayMatch[1], 10);
                    const candidate = new Date(dateBase.getFullYear(), monthIdx, day);
                    if (candidate < dateBase) candidate.setFullYear(candidate.getFullYear() + 1);
                    dateBase.setTime(candidate.getTime());
                    rest = rest.replace(SCHEDULE_MONTHS[monthIdx], '').replace(dayMatch[0], '');
                    dateFound = true;
                }
            }
        }

        // Whatever's left after stripping the matched date phrase is searched for a time.
        rest = rest.replace(/\bat\b/g, '').trim();
        let time = null;
        if (/\bnoon\b/.test(rest)) time = '12:00';
        else if (/\bmidnight\b/.test(rest)) time = '00:00';
        else {
            const timeMatch = rest.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm)?\b/);
            if (timeMatch) {
                let h = parseInt(timeMatch[1], 10);
                const min = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
                const ampm = timeMatch[4];
                if (ampm === 'pm' && h < 12) h += 12;
                if (ampm === 'am' && h === 12) h = 0;
                if (h <= 23 && min <= 59) time = pad2(h) + ':' + pad2(min);
            }
        }

        if (!dateFound && !time) return null;
        return { date: dateKey(dateBase), time: time || '09:00' };
    }

    // ---------- Collaborators Pill/Panel Controls ----------
    const collabBubble = document.getElementById('collab-bubble'), collabPanel = document.getElementById('collab-panel');
    const collabSearchInput = document.getElementById('collab-search');
    function getCurrentCollaboratorIds() {
        const folderObj = appState.folders[appState.currentFolderId];
        return (folderObj && folderObj.collaborators) ? folderObj.collaborators : [];
    }
    function closeCollabPanel() { collabPanel.classList.remove('open'); panelPinned.collab = false; }
    function positionCollabPanel() {
        const rect = collabBubble.getBoundingClientRect();
        collabPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 280;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        collabPanel.style.left = leftPos + 'px';
        collabPanel.style.right = 'auto';
    }
    function openCollabPanel(pin) {
        if (!collabBubble.classList.contains('show')) return;
        closeAllPanels('collab');
        clearSearch();
        collabPanel.classList.add('open');
        collabSearchInput.value = '';
        renderCollabList('');
        positionCollabPanel();
        if (pin) { panelPinned.collab = true; }
    }
    collabBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.collab) { closeCollabPanel(); }
        else { openCollabPanel(true); }
    });
    collabBubble.addEventListener('mouseenter', () => {
        // Only auto-open on hover when there are no collaborators yet (the "+" affordance);
        // once collaborators exist, hover just reveals the tooltip and click opens the panel.
        if (getCurrentCollaboratorIds().length === 0 && !collabPanel.classList.contains('open')) openCollabPanel(false);
    });
    collabBubble.addEventListener('mouseleave', () => scheduleHoverClose('collab', [collabBubble, collabPanel], closeCollabPanel));
    collabPanel.addEventListener('mouseleave', () => scheduleHoverClose('collab', [collabBubble, collabPanel], closeCollabPanel));
    pinOnInsideClick('collab', [collabPanel]);

    // Who's already accepted (including inherited from an ancestor canvas — see
    // get_effective_collaborators/canvas_access_status), and who has a pending invite at THIS
    // exact folder, for the folder currently open in the per-canvas collab panel — refreshed each
    // time that panel (re)opens (see renderCollabList). folders[id].collaborators itself is the
    // effective-accepted list (kept here rather than a separate variable so the rest of the app —
    // the collab bubble/pill — can keep reading it exactly like before); a pending invite is
    // always level-specific (never inherited), so that part stays an exact-folder query.
    let outgoingCanvasInvitePendingIds = new Set();
    async function refreshCanvasCollabForCurrentFolder() {
        if (!supabase || !appState.currentUser.id) { outgoingCanvasInvitePendingIds = new Set(); return; }
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const [effective, pendingRes] = await Promise.all([
            supabase.rpc('get_effective_collaborators', { p_owner_id: appState.currentUser.id, p_folder_id: appState.currentFolderId }),
            supabase.from('canvas_collaborations').select('collaborator_id')
                .eq('owner_id', appState.currentUser.id).eq('folder_id', appState.currentFolderId).eq('status', 'pending'),
        ]);
        if (effective.error) console.error('[collab] failed to load effective collaborators:', effective.error);
        if (pendingRes.error) console.error('[collab] failed to load pending canvas invites:', pendingRes.error);
        folderObj.collaborators = (effective.data || []).map(r => r.collaborator_id);
        outgoingCanvasInvitePendingIds = new Set((pendingRes.data || []).map(r => r.collaborator_id));
        // ensureCanvasPresenceChannel's "is this folder worth a live channel" check only runs
        // inside render() — which already ran synchronously, BEFORE this async fetch had any real
        // data, on every normal navigation (see openFolder). Nothing else ever re-checked it once
        // the real collaborators list actually landed, so an owner's own client could permanently
        // decide "no collaborators, don't join" off stale/empty data even with a collaborator
        // actively viewing. Re-running it here, now that folderObj.collaborators is current, is
        // what actually catches that — safe to call any time, it always re-resolves against
        // whatever's currently true rather than anything captured earlier.
        ensureCanvasPresenceChannel();
    }
    async function sendCanvasCollabInvite(collaboratorId) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const { error } = await supabase.from('canvas_collaborations').insert({
            owner_id: appState.currentUser.id, folder_id: appState.currentFolderId,
            folder_title: folderObj.title, collaborator_id: collaboratorId,
        });
        if (error) { console.error('[collab] failed to send canvas collaboration invite:', error); return; }
        outgoingCanvasInvitePendingIds.add(collaboratorId);
    }
    // Explicitly blocks this collaborator from THIS exact folder, even if their access here was
    // only inherited from a parent canvas — see revoke_canvas_collaboration. Their access to any
    // sibling canvas (or the parent itself) is untouched.
    async function revokeCanvasCollab(collaboratorId) {
        if (!supabase || !appState.currentUser.id) return;
        const { error } = await supabase.rpc('revoke_canvas_collaboration', { p_folder_id: appState.currentFolderId, p_collaborator_id: collaboratorId });
        if (error) console.error('[collab] failed to remove collaborator:', error);
    }
    // Keeps the Collaborations panel's cached folder_title in sync after a rename — that column is
    // an invite-time snapshot only (see its own comment in 20260726_add_canvas_collaboration.sql),
    // never refreshed on its own. Called from the breadcrumb rename flow (the app's one rename
    // entry point — see the crumb-item span.onblur), which fires the same way whether folderId is
    // owned outright or a shared view the current user is a collaborator on, so this resolves the
    // real owner/folder id exactly like syncWaypointToDb/deleteWaypointFromDb do, then goes through
    // rename_canvas_collaborations (SECURITY DEFINER) rather than a raw table update since a
    // collaborator has no RLS-visible row of their own to satisfy an owner-only update policy with.
    async function syncCanvasCollabTitle(folderId, newTitle) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
        const { error } = await supabase.rpc('rename_canvas_collaborations', {
            p_owner_id: ownerId, p_folder_id: realFolderId, p_new_title: newTitle,
        });
        if (error) console.error('[collab] failed to sync renamed canvas title:', error);
    }

    const COLLAB_LIST_MAX = 6;
    async function renderCollabList(query) {
        await Promise.all([refreshFriendsData(), refreshCanvasCollabForCurrentFolder()]);
        const list = document.getElementById('collab-list');
        list.innerHTML = '';
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        folderObj.collaborators = folderObj.collaborators || [];
        const q = (query || '').trim().toLowerCase();
        const isCollab = (id) => folderObj.collaborators.includes(id);

        // Adding someone doesn't grant access immediately — it sends a request (like a friend
        // request) that shows as "Requested" until they accept it from their own hamburger
        // Collaborations panel (see renderHubCollabRequests). Someone already collaborating
        // (directly or inherited) shows "Remove" instead, which always acts on this exact folder
        // — removing someone with only inherited access creates an explicit block scoped to just
        // this folder, not a no-op (see revokeCanvasCollab).
        function addRow(f) {
            const row = document.createElement('div');
            row.className = 'collab-row';
            const added = isCollab(f.id);
            const pending = outgoingCanvasInvitePendingIds.has(f.id);
            const label = added ? 'Remove' : pending ? 'Requested' : 'Add';
            // A live presence dot + clickable name only makes sense for someone who's both an
            // actual collaborator here AND currently present on this exact canvas right now (see
            // remoteCursors/handleCanvasPresenceSync) — not just anyone in the friends list.
            const isPresent = added && remoteCursors.has(f.id);
            row.innerHTML = `<div class="collab-row-avatar"></div>
                <div class="collab-row-meta"><div class="collab-row-name${isPresent ? ' collab-row-name-live' : ''}">${escapeHtml(f.displayName)}${isPresent ? '<span class="collab-row-live-dot"></span>' : ''}</div></div>
                <button class="collab-add-btn ${added ? 'added' : ''} ${pending ? 'pending' : ''}" ${pending ? 'disabled' : ''}>${label}</button>`;
            renderAvatarInto(row.querySelector('.collab-row-avatar'), { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
            if (isPresent) {
                row.querySelector('.collab-row-name').onclick = (e) => {
                    e.stopPropagation();
                    goToCollaboratorCursor(f.id);
                };
            }
            row.querySelector('.collab-add-btn').onclick = async (e) => {
                e.stopPropagation();
                if (pending) return;
                if (added) await revokeCanvasCollab(f.id);
                else await sendCanvasCollabInvite(f.id);
                renderCollabList(query);
            };
            list.appendChild(row);
        }

        // Search covers the whole friends list, no cap. Otherwise (the default view): every
        // current collaborator always shows (regardless of ranking, so Remove is always
        // reachable), then up to COLLAB_LIST_MAX more from recency/conversation — no
        // "Collaborators"/"Recently active"/"Most conversed with" subheadings, just one list.
        if (q) {
            const results = friends.filter(f => f.displayName.toLowerCase().includes(q));
            if (results.length) results.forEach(f => addRow(f));
            else {
                const empty = document.createElement('div');
                empty.className = 'collab-empty';
                empty.textContent = 'No friends found.';
                list.appendChild(empty);
            }
            return;
        }

        const current = folderObj.collaborators.map(id => friends.find(f => f.id === id)).filter(Boolean);
        const seen = new Set(current.map(f => f.id));
        const rest = friends.filter(f => !seen.has(f.id));
        const byRecent = [...rest].sort((a, b) => (a.lastActive ?? 9999) - (b.lastActive ?? 9999));
        const byConversed = [...rest].sort((a, b) => b.messages.length - a.messages.length);
        const merged = current.slice();
        for (let i = 0; merged.length < COLLAB_LIST_MAX && (i < byRecent.length || i < byConversed.length); i++) {
            const r = byRecent[i];
            if (r && !seen.has(r.id)) { seen.add(r.id); merged.push(r); }
            if (merged.length >= COLLAB_LIST_MAX) break;
            const c = byConversed[i];
            if (c && !seen.has(c.id)) { seen.add(c.id); merged.push(c); }
        }
        if (!merged.length) {
            const empty = document.createElement('div');
            empty.className = 'collab-empty';
            empty.textContent = 'No friends yet.';
            list.appendChild(empty);
            return;
        }
        merged.forEach(f => addRow(f));
    }
    function handleCollabSearch(v) { renderCollabList(v); }

    function renderCollabPill() {
        const folderObj = appState.folders[appState.currentFolderId];
        // The root canvas is always private to the user, so no collaborators indicator there —
        // checked by identity (currentFolderId === 'root'), not historyIndex === 0. Those used to
        // coincide, but historyIndex now tracks raw click-order navigation history (back/forward),
        // which can be > 0 while sitting AT root after a cross-tree jump (a waypoint, search, or
        // the hamburger menu can all land you back on root without historyIndex resetting to 0 —
        // see findParentFolderId/the breadcrumb "..", which had the same bug for the same reason).
        // A canvas someone else shared with you isn't yours to invite further collaborators on.
        if (!folderObj || appState.currentFolderId === 'root' || folderObj.isSharedView) {
            collabBubble.classList.remove('show');
            closeCollabPanel();
            return;
        }
        collabBubble.classList.add('show');
        const collabIds = folderObj.collaborators || [];
        const collabs = collabIds.map(id => friends.find(f => f.id === id)).filter(Boolean);
        const content = document.getElementById('collab-content');
        const tooltip = document.getElementById('collab-tooltip');
        if (collabs.length === 0) {
            content.innerHTML = `<button id="collab-add-btn" title="Add collaborators" onclick="event.stopPropagation(); openCollabPanel(true);">+</button>`;
            tooltip.textContent = '';
        } else {
            tooltip.textContent = collabs.length + (collabs.length === 1 ? ' collaborator' : ' collaborators');
            const shown = collabs.slice(0, 3);
            let html = '<div class="collab-avatars">';
            shown.forEach((f, i) => { html += `<div class="collab-avatar" data-idx="${i}"></div>`; });
            if (collabs.length > 3) html += `<div class="collab-avatar collab-more">+${collabs.length - 3}</div>`;
            html += '</div>';
            content.innerHTML = html;
            content.querySelectorAll('.collab-avatar[data-idx]').forEach(el => {
                const f = shown[parseInt(el.dataset.idx, 10)];
                renderAvatarInto(el, { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
            });
        }
    }

    // `friends` / incoming / outgoing requests are loaded from Supabase
    // (`profiles` + `friendships`) via refreshFriendsData() below, called on
    // script init and again whenever a messages/collab panel is opened.
    // `messages` per friend stays a local-only array for now — chat isn't
    // wired to the `messages` table yet, so anything sent here is transient
    // (lost on reload) until that's built.
    let friends = [];
    let incomingRequests = []; // [{ id: friendshipId, requester: {id, username, displayName} }]
    let outgoingPendingIds = new Set(); // profile ids we've already sent a pending request to
    // null until refreshFriendsData's first run — that first run is a baseline (no notifications;
    // whatever's already pending when the app loads isn't "just received"), every run after that
    // notifies for any request id that wasn't in the set yet.
    let seenIncomingFriendRequestIds = null;
    let activeConvoId = null;

    async function refreshFriendsData() {
        if (!supabase || !appState.currentUser.id) return;

        const { data: accepted, error: acceptedErr } = await supabase
            .from('friendships')
            .select('id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_id, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_id, avatar_url)')
            .eq('status', 'accepted')
            .or(`requester_id.eq.${appState.currentUser.id},addressee_id.eq.${appState.currentUser.id}`);
        if (acceptedErr) console.error('[friends] failed to load friendships:', acceptedErr);

        friends = (accepted || []).map(row => {
            const other = row.requester_id === appState.currentUser.id ? row.addressee : row.requester;
            return {
                id: other.id,
                friendshipId: row.id,
                username: other.username,
                displayName: other.display_name || other.username,
                avatarId: other.avatar_id ?? 0,
                avatarUrl: other.avatar_url || null,
                messages: []
            };
        });
        // This query is already symmetric (requester OR addressee = me), so friends.length is
        // always this user's true total regardless of who sent/accepted — sync it in as an
        // absolute value rather than incrementing, since respondToFriendRequest only runs on the
        // accepting side and would otherwise never move the requester's own count.
        bumpAchievementStat('three_friends', friends.length, true);

        // Loaded in one round trip (not lazily per-conversation) so the chat
        // list's preview text and the collab panel's "most conversed with"
        // sort both reflect real data without an extra fetch each.
        const friendshipIds = friends.map(f => f.friendshipId);
        if (friendshipIds.length) {
            const { data: allMessages, error: messagesErr } = await supabase
                .from('messages')
                .select('id, friendship_id, sender_id, body, canvas_snapshot, created_at')
                .in('friendship_id', friendshipIds)
                .order('created_at', { ascending: true });
            if (messagesErr) console.error('[chat] failed to load messages:', messagesErr);
            const byFriendship = new Map();
            (allMessages || []).forEach(m => {
                if (!byFriendship.has(m.friendship_id)) byFriendship.set(m.friendship_id, []);
                byFriendship.get(m.friendship_id).push({
                    id: m.id, senderId: m.sender_id, text: m.body,
                    canvasSnapshot: m.canvas_snapshot, createdAt: m.created_at
                });
            });
            friends.forEach(f => { f.messages = byFriendship.get(f.friendshipId) || []; });
        }

        const { data: incoming, error: incomingErr } = await supabase
            .from('friendships')
            .select('id, requester:profiles!friendships_requester_id_fkey(id, username, display_name)')
            .eq('status', 'pending')
            .eq('addressee_id', appState.currentUser.id);
        if (incomingErr) console.error('[friends] failed to load incoming requests:', incomingErr);
        incomingRequests = incoming || [];
        if (seenIncomingFriendRequestIds === null) {
            seenIncomingFriendRequestIds = new Set(incomingRequests.map(r => r.id));
        } else {
            incomingRequests.forEach(r => {
                if (seenIncomingFriendRequestIds.has(r.id)) return;
                seenIncomingFriendRequestIds.add(r.id);
                pushNotification({
                    type: 'friend_request',
                    message: `@${r.requester.username} sent you a friend request`,
                    actionLabel: 'Accept',
                    onAction: () => respondToFriendRequest(r.id, true),
                    // No dismiss button — Escape hides it without accepting, request stays pending
                    // (see Requests in the Chats panel).
                    sticky: true,
                });
            });
        }

        const { data: outgoing, error: outgoingErr } = await supabase
            .from('friendships')
            .select('addressee_id')
            .eq('status', 'pending')
            .eq('requester_id', appState.currentUser.id);
        if (outgoingErr) console.error('[friends] failed to load outgoing requests:', outgoingErr);
        outgoingPendingIds = new Set((outgoing || []).map(r => r.addressee_id));

        subscribeToAllFriendMessages();
    }

    async function sendFriendRequest(userId) {
        if (!supabase || !appState.currentUser.id) return;
        const { error } = await supabase
            .from('friendships')
            .insert({ requester_id: appState.currentUser.id, addressee_id: userId });
        if (error) { console.error('[friends] failed to send request:', error); return; }
        outgoingPendingIds.add(userId);
    }

    async function respondToFriendRequest(friendshipId, accept) {
        if (!supabase) return;
        const { error } = accept
            ? await supabase.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', friendshipId)
            : await supabase.from('friendships').delete().eq('id', friendshipId);
        if (error) console.error('[friends] failed to respond to request:', error);
    }

    async function searchDiscoverableUsers(query) {
        if (!supabase || !query) return [];
        const { data, error } = await supabase
            .from('profiles')
            .select('id, username, display_name')
            .ilike('username', `%${query}%`)
            .neq('id', appState.currentUser.id)
            .limit(10);
        if (error) { console.error('[friends] failed to search users:', error); return []; }
        const friendIds = new Set(friends.map(f => f.id));
        return (data || [])
            .filter(u => !friendIds.has(u.id))
            .map(u => ({ id: u.id, username: u.username, displayName: u.display_name || u.username }));
    }

    function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
    function lastPreview(f) { const m = f.messages[f.messages.length - 1]; return m ? m.text : 'No messages yet'; }

    // 'main' (chat list + "Add a friend" search) / 'requests' (every incoming friend request,
    // Accept/Decline each) — same drill-down pattern as hubCollabView in the Collaborations hub
    // panel, right down to reusing its "Requests" row/count-badge/back-row styling. The Requests
    // row itself only ever shows when there's actually something in it, exactly like that panel.
    let msgView = 'main';
    async function renderMsgList(query) {
        await refreshFriendsData();
        if (msgView === 'requests') { renderMsgRequests(); return; }
        msgList.innerHTML = '';
        const q = (query || '').trim().toLowerCase();

        if (incomingRequests.length) {
            const reqRow = document.createElement('div');
            reqRow.className = 'outline-item requests-row';
            reqRow.innerHTML = `<span class="outline-label">Requests</span><span class="requests-count">${incomingRequests.length}</span>`;
            reqRow.onclick = (e) => { e.stopPropagation(); msgView = 'requests'; renderMsgRequests(); };
            msgList.appendChild(reqRow);
        }

        const matchedFriends = friends.filter(f => f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q));
        if (matchedFriends.length) {
            const label = document.createElement('div');
            label.className = 'msg-section-label';
            label.textContent = 'Chats';
            msgList.appendChild(label);
            matchedFriends.forEach(f => {
                const row = document.createElement('div');
                row.className = 'msg-chat-row';
                row.innerHTML = `<div class="msg-avatar"></div>
                    <div class="msg-chat-meta"><div class="msg-chat-name">${escapeHtml(f.displayName)}</div><div class="msg-chat-preview">${escapeHtml(lastPreview(f))}</div></div>`;
                renderAvatarInto(row.querySelector('.msg-avatar'), { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
                row.onclick = () => openConvo(f.id);
                msgList.appendChild(row);
            });
        }

        let searchResults = [];
        if (q) {
            searchResults = await searchDiscoverableUsers(q);
            if (searchResults.length) {
                const label = document.createElement('div');
                label.className = 'msg-section-label';
                label.textContent = 'Add a friend';
                msgList.appendChild(label);
                searchResults.forEach(u => {
                    const row = document.createElement('div');
                    row.className = 'msg-add-row';
                    const pending = outgoingPendingIds.has(u.id);
                    row.innerHTML = `<div class="msg-chat-meta"><div class="msg-chat-name">@${escapeHtml(u.username)}</div></div>
                        <button class="msg-add-btn" ${pending ? 'disabled' : ''}>${pending ? 'Requested' : 'Add'}</button>`;
                    row.querySelector('.msg-add-btn').onclick = async (e) => {
                        e.stopPropagation();
                        if (outgoingPendingIds.has(u.id)) return;
                        await sendFriendRequest(u.id);
                        renderMsgList(query);
                    };
                    msgList.appendChild(row);
                });
            }
        }

        if (!matchedFriends.length && !searchResults.length) {
            const empty = document.createElement('div');
            empty.className = 'msg-empty';
            empty.textContent = q ? 'No chats or usernames found.' : 'No conversations yet.';
            msgList.appendChild(empty);
        }
    }
    function renderMsgRequests() {
        msgList.innerHTML = '';
        const backRow = document.createElement('div');
        backRow.className = 'requests-back-row';
        backRow.innerHTML = `<span>&larr;</span><span>Requests</span>`;
        backRow.onclick = (e) => { e.stopPropagation(); msgView = 'main'; renderMsgList(msgSearchInput.value); };
        msgList.appendChild(backRow);

        if (!incomingRequests.length) {
            const empty = document.createElement('div');
            empty.className = 'msg-empty';
            empty.textContent = 'No pending requests.';
            msgList.appendChild(empty);
            return;
        }
        incomingRequests.forEach(req => {
            const row = document.createElement('div');
            row.className = 'msg-add-row';
            row.innerHTML = `<div class="msg-chat-meta"><div class="msg-chat-name">@${escapeHtml(req.requester.username)}</div></div>
                <div style="display:flex;gap:6px;">
                    <button class="msg-add-btn msg-req-accept">Accept</button>
                    <button class="msg-add-btn msg-req-decline">Decline</button>
                </div>`;
            row.querySelector('.msg-req-accept').onclick = async (e) => {
                e.stopPropagation();
                await respondToFriendRequest(req.id, true);
                await refreshFriendsData();
                renderMsgRequests();
            };
            row.querySelector('.msg-req-decline').onclick = async (e) => {
                e.stopPropagation();
                await respondToFriendRequest(req.id, false);
                await refreshFriendsData();
                renderMsgRequests();
            };
            msgList.appendChild(row);
        });
    }
    function handleMsgSearch(v) { renderMsgList(v); }

    // Standing subscription per friendship — not just whichever one is currently open — so a
    // message can be caught and turned into a notification (see pushNotification) no matter what
    // you're looking at. This is also the natural hook point for real push notifications later
    // (screen-locked mobile, etc.): that needs a server-side piece (an Edge Function/DB trigger
    // calling Web Push, plus a push-subscription table) that doesn't exist yet, but whatever
    // fires that should live right alongside where this client-side notification fires, since
    // it's the same underlying event.
    //
    // Rebuilt to match the friends list every time refreshFriendsData runs (see its call to this
    // at the end) — diffs against the currently-subscribed set rather than tearing everything
    // down and re-subscribing every time, since that runs fairly often (init, every time a
    // messages/collab panel opens). Each channel's own handler looks up its friend object LIVE
    // (by friendshipId, via friends.find) rather than closing over the `f` reference captured at
    // subscribe time — refreshFriendsData replaces the whole `friends` array with fresh objects
    // on every call, so a closed-over reference would silently go stale.
    // ---------- Friend presence (online / afk / logout) ----------
    // Reuses the SAME per-friendship channel as messages below rather than opening a second one
    // — both participants in a friendship already open a channel with this exact topic, so
    // Realtime Presence naturally scopes "who's here" to just the two of you, no extra
    // infrastructure needed. Each channel is given an explicit presence key (this user's own id)
    // so the other side's entry can be looked up directly by their id in presenceState().
    //
    // Idle detection is ONE shared timer for the whole tab (not per friend) — any mouse/keyboard/
    // pointer activity resets it; AFK_THRESHOLD_MS of silence flips to 'afk'. Whenever that local
    // status actually changes, every open friend channel is re-tracked with it, which is what
    // shows up as a 'sync' event (not 'join'/'leave' — the presence key doesn't change, just its
    // payload) on the other end.
    const AFK_THRESHOLD_MS = 5 * 60 * 1000;
    let localPresenceStatus = 'online';
    let afkTimer = null;
    function setLocalPresenceStatus(status) {
        if (localPresenceStatus === status) return;
        localPresenceStatus = status;
        friendMessageChannels.forEach(channel => channel.track({ status: localPresenceStatus }));
    }
    function resetAfkTimer() {
        setLocalPresenceStatus('online');
        clearTimeout(afkTimer);
        afkTimer = setTimeout(() => setLocalPresenceStatus('afk'), AFK_THRESHOLD_MS);
    }
    ['mousemove', 'mousedown', 'keydown', 'pointerdown', 'wheel', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetAfkTimer, { passive: true });
    });
    resetAfkTimer();

    // friendshipId -> that friend's last known status this session ('online'/'afk'), or null if
    // they're not present in the channel at all (offline) — undefined (never set) means "haven't
    // heard from this channel yet", which is what tells the very first sync apart from a real
    // transition: a friend already online when you load the app shouldn't fire a spurious "came
    // online" notification, only a genuine change after that baseline should.
    let friendPresenceLastStatus = new Map();
    function handleFriendPresenceSync(friendshipId, channel) {
        const live = friends.find(x => x.friendshipId === friendshipId);
        if (!live) return;
        const metas = channel.presenceState()[live.id] || []; // presence key = the friend's own user id
        const nowStatus = metas.length ? (metas[0].status || 'online') : null;
        const prev = friendPresenceLastStatus.get(friendshipId);
        if (nowStatus === prev) return;
        friendPresenceLastStatus.set(friendshipId, nowStatus);
        if (prev === undefined) return; // first sync since subscribing — baseline only, not a real transition
        if (nowStatus === 'online') {
            pushNotification({
                type: 'friend_online',
                message: `${live.displayName} is online`,
                actionLabel: 'Chat',
                onAction: () => { openMessagesPanel(true); openConvo(live.id); },
            }); // one button, auto-dismisses — no dismiss function
        } else if (nowStatus === null) {
            pushNotification({ type: 'friend_offline', message: `${live.displayName} logged off` }); // no buttons, auto-dismisses — no dismiss function
        } else if (nowStatus === 'afk') {
            pushNotification({ type: 'friend_afk', message: `${live.displayName} is away` }); // no buttons, auto-dismisses — no dismiss function
        }
    }

    let friendMessageChannels = new Map(); // friendshipId -> realtime channel
    function subscribeToAllFriendMessages() {
        if (!supabase) return;
        const liveFriendshipIds = new Set(friends.map(f => f.friendshipId));

        for (const [friendshipId, channel] of friendMessageChannels) {
            if (!liveFriendshipIds.has(friendshipId)) {
                supabase.removeChannel(channel);
                friendMessageChannels.delete(friendshipId);
                friendPresenceLastStatus.delete(friendshipId);
            }
        }

        friends.forEach(f => {
            if (friendMessageChannels.has(f.friendshipId)) return; // already subscribed
            const friendshipId = f.friendshipId;
            const channel = supabase
                .channel(`messages:${friendshipId}`, { config: { presence: { key: appState.currentUser.id } } })
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `friendship_id=eq.${friendshipId}` }, (payload) => {
                    const m = payload.new;
                    if (m.sender_id === appState.currentUser.id) return; // our own message — already added optimistically by sendMsg
                    const live = friends.find(x => x.friendshipId === friendshipId);
                    if (!live) return; // unfriended (or a stale refresh) since this fired
                    if (live.messages.some(existing => existing.id === m.id)) return; // already have it somehow
                    live.messages.push({ id: m.id, senderId: m.sender_id, text: m.body, canvasSnapshot: m.canvas_snapshot, createdAt: m.created_at });
                    const isActivelyViewing = activeConvoId === live.id && messagesPanel.classList.contains('open');
                    if (isActivelyViewing) {
                        renderConvoBody(live);
                    } else {
                        pushNotification({
                            type: 'chat',
                            message: `${live.displayName}: ${(m.body || '').trim().slice(0, 80) || 'New message'}`,
                            actionLabel: 'Reply',
                            onAction: () => { openMessagesPanel(true); openConvo(live.id); },
                        }); // one button, auto-dismisses — no dismiss function
                    }
                })
                .on('presence', { event: 'sync' }, () => handleFriendPresenceSync(friendshipId, channel))
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') channel.track({ status: localPresenceStatus });
                });
            friendMessageChannels.set(friendshipId, channel);
        });
    }

    // ---------- Live canvas presence (Figma-style cursors) + real-time content sync ----------
    // Distinct from #collab-bubble/#collab-panel (inviting a collaborator to a canvas) and
    // #hub-collab-panel (the hamburger Collaborations list) — this is live presence for whoever is
    // CURRENTLY looking at a canvas, not the invite/access-management UI (same kind of naming
    // collision the codebase already disambiguates between hub-collab-panel and collab-panel).
    //
    // One realtime channel per (owner id, real folder id) pair — both the owner's own view and
    // every collaborator's shared:owner:folderId view resolve to the identical channel name
    // independently (see resolvePresenceFolderKey), so everyone currently on that exact canvas ends
    // up on the same channel regardless of whose canvas it actually is. Reuses the exact same
    // combined presence+broadcast-on-one-channel shape as subscribeToAllFriendMessages above.
    //
    // No per-user color exists anywhere else in the app — same "small fixed indexed palette" shape
    // as the word-alignment highlight colors (.align-hl-0..5 in globals.css), just keyed by user id
    // instead of alignment-pair index, so the same person always gets the same color across
    // reloads/sessions with no server-side storage needed.
    const CURSOR_COLORS = ['#F87171', '#FB923C', '#FBBF24', '#4ADE80', '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6'];
    function assignCursorColor(userId) {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
        return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
    }
    // How long the floating-cursor <-> typing-indicator "travel" animation runs for (see
    // showRemoteTypingIndicator/travelCursorBackToPointer's .remote-presence-travel handling) —
    // must match the transition duration set on that class in globals.css, since the JS uses this
    // same value to know when it's safe to remove the class again.
    const REMOTE_CURSOR_TRAVEL_MS = 220;
    // {ownerId, folderId} for whatever folder is currently open, whether it's this user's own or a
    // shared:owner:folderId view — mirrors parseSharedFolderKey's own logic so every viewer of the
    // exact same real canvas computes the identical channel name independently.
    function resolvePresenceFolderKey() {
        if (appState.currentFolderId.startsWith('shared:')) {
            const { ownerId, remoteFolderId } = parseSharedFolderKey(appState.currentFolderId);
            return { ownerId, folderId: remoteFolderId };
        }
        return { ownerId: appState.currentUser.id, folderId: appState.currentFolderId };
    }

    let canvasPresenceChannel = null;
    let canvasPresenceKey = null; // "ownerId:folderId" this channel is currently joined to, or null
    let remoteCursors = new Map(); // userId -> { el, x, y, caretX, caretY, ... }, x/y in canvas-space
    // Per-item JSON snapshot of whatever was last actually broadcast for the currently-joined
    // folder (plus its title) — the baseline the content-sync diff below compares against. Also
    // updated (not just read) when an incoming remote change is applied, which is what stops that
    // same change from being immediately re-diffed and echoed straight back out.
    let lastBroadcastSnapshot = null; // { title, items: Map<id, jsonString> }
    let pendingSyncDeltas = null; // { title?, upserts: Map<id,item>, deletes: Set<id> } since last flush
    let syncBroadcastTimer = null;
    // This client's own current editing state — kept locally (not read back from presence) so a
    // freshly-joined collaborator can be caught up via the presence 'join' handler below, and so
    // broadcastCaretPosition knows what selector to re-measure without needing it passed in on
    // every call. See broadcastEditingState for why this is BROADCAST, not tracked.
    let localEditingState = { editing: false, editingTarget: null, caret: null };

    function teardownCanvasPresenceChannel() {
        if (canvasPresenceChannel) supabase.removeChannel(canvasPresenceChannel);
        canvasPresenceChannel = null;
        canvasPresenceKey = null;
        lastBroadcastSnapshot = null;
        pendingSyncDeltas = null;
        localEditingState = { editing: false, editingTarget: null, caret: null };
        clearTimeout(syncBroadcastTimer);
        remoteCursors.forEach(entry => entry.el.remove());
        remoteCursors.clear();
    }
    // Diffing/broadcasting always works in CANONICAL (un-namespaced) item form — never the local
    // shared: wrapping a collaborator's own folders dict uses (see namespaceSharedFolderIds/
    // stripSharedFolderIds) — so a broadcast is meaningful to every viewer regardless of whether
    // they're the owner or a collaborator, and so the wrapping itself never gets diffed as if it
    // were a real content change.
    function canonicalItem(it) {
        return stripSharedFolderIds([it])[0];
    }
    function snapshotFolderForBroadcast(folderObj) {
        const items = new Map();
        (folderObj.items || []).forEach(it => items.set(it.id, JSON.stringify(canonicalItem(it))));
        return { title: folderObj.title, items };
    }
    // Called near the top of render() — already the one place every mutation across the entire
    // app funnels through (every card kind, every field edit), so this never needs threading
    // through the ~100+ individual mutation call sites elsewhere. No-ops unless the resolved
    // (owner,folder) pair actually changed since the last call.
    function ensureCanvasPresenceChannel() {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!supabase || !appState.currentUser.id || !folderObj) { teardownCanvasPresenceChannel(); return; }
        // Only a shared: view (someone else's canvas) or an owned folder that currently has
        // collaborators is ever worth a live channel — a private canvas nobody else can reach gets
        // no realtime overhead at all.
        const eligible = folderObj.isSharedView || (folderObj.collaborators && folderObj.collaborators.length > 0);
        if (!eligible) { teardownCanvasPresenceChannel(); return; }
        const { ownerId, folderId } = resolvePresenceFolderKey();
        const key = `${ownerId}:${folderId}`;
        if (key === canvasPresenceKey) return;
        teardownCanvasPresenceChannel();
        canvasPresenceKey = key;
        lastBroadcastSnapshot = snapshotFolderForBroadcast(folderObj);
        const channel = supabase.channel(`presence:${ownerId}:${folderId}`, { config: { presence: { key: appState.currentUser.id } } })
            .on('presence', { event: 'sync' }, () => handleCanvasPresenceSync(channel))
            .on('presence', { event: 'leave' }, ({ key: leftUserId }) => removeRemoteCursor(leftUserId))
            // A newly-joined collaborator has no way to know we're already mid-edit (the 'editing'
            // broadcast below only fires on a state CHANGE, not to catch up latecomers) — so if
            // we're actively editing when someone else joins, resend our current state just for
            // them. Cheap (only fires while genuinely editing) and self-contained.
            .on('presence', { event: 'join' }, ({ key: joinedUserId }) => {
                if (joinedUserId !== appState.currentUser.id && localEditingState.editing) {
                    channel.send({ type: 'broadcast', event: 'editing', payload: { userId: appState.currentUser.id, editing: true, editingTarget: localEditingState.editingTarget, caret: localEditingState.caret || computeLocalCaret() } });
                }
            })
            .on('broadcast', { event: 'cursor' }, ({ payload }) => handleRemoteCursorBroadcast(payload))
            .on('broadcast', { event: 'item-drag' }, ({ payload }) => handleRemoteItemDrag(payload))
            .on('broadcast', { event: 'item-resize' }, ({ payload }) => handleRemoteItemResize(payload))
            .on('broadcast', { event: 'editing' }, ({ payload }) => handleRemoteEditingBroadcast(payload))
            .on('broadcast', { event: 'caret' }, ({ payload }) => handleRemoteCaretBroadcast(payload))
            .on('broadcast', { event: 'selection' }, ({ payload }) => handleRemoteSelectionBroadcast(payload))
            .on('broadcast', { event: 'sync' }, ({ payload }) => applyRemoteSyncBroadcast(payload))
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Identity only — never re-tracked after this. Editing state deliberately lives
                    // entirely in broadcasts (see broadcastEditingState) instead, since presence.track()
                    // re-calls proved unreliable for fast-changing state: confirmed live (2-client
                    // Realtime test) that re-tracking the same key can leave stale older metas sitting
                    // alongside the fresh one in presenceState() indefinitely, with no reliable way to
                    // tell which is current. Identity fields never change after this single initial
                    // track(), so that ambiguity never matters here.
                    channel.track({
                        displayName: appState.currentUser.displayName, avatarId: appState.currentUser.avatarId ?? 0,
                        avatarUrl: appState.currentUser.avatarUrl || null, color: assignCursorColor(appState.currentUser.id),
                    });
                }
            });
        canvasPresenceChannel = channel;
    }

    // ---- Cursors: presence (identity/join/leave only — editing state is pure broadcast, see
    // broadcastEditingState) + broadcast (high-frequency position/caret/editing) ----
    function handleCanvasPresenceSync(channel) {
        const state = channel.presenceState();
        const seenIds = new Set();
        Object.keys(state).forEach(userId => {
            if (userId === appState.currentUser.id) return; // never render our own cursor
            seenIds.add(userId);
            const metas = state[userId];
            const meta = metas[metas.length - 1];
            if (!meta) return;
            let entry = remoteCursors.get(userId);
            if (!entry) {
                const el = document.createElement('div');
                el.className = 'remote-cursor';
                el.innerHTML = `<svg class="remote-cursor-pointer" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15 L12 22 L15 20.5 L12 13.5 L19 13.5 Z"/></svg>
                <div class="remote-cursor-label"><span class="remote-cursor-avatar"></span><span class="remote-cursor-name"></span></div>`;
                cursorOverlay.appendChild(el);
                entry = {
                    el, x: 0, y: 0, editingTarget: null, highlightedEl: null, typingCaretEl: null, typingLabelEl: null,
                    caretX: null, caretY: null, caretHeight: null, selectionRects: [], selectionEls: [],
                    isTyping: false, travelTimer: null,
                };
                remoteCursors.set(userId, entry);
            }
            entry.color = meta.color || '#999';
            entry.displayName = meta.displayName;
            entry.avatarId = meta.avatarId;
            entry.avatarUrl = meta.avatarUrl;
            entry.el.style.color = entry.color;
            entry.el.querySelector('.remote-cursor-name').textContent = entry.displayName || '';
            renderAvatarInto(entry.el.querySelector('.remote-cursor-avatar'), { id: entry.avatarId ?? 0, url: entry.avatarUrl || null }, initials(entry.displayName || '?'));
            applyRemoteCursorMode(entry);
        });
        remoteCursors.forEach((entry, userId) => { if (!seenIds.has(userId)) removeRemoteCursor(userId); });
    }
    // The single place that decides, fresh every time it runs, whether a remote collaborator shows
    // as a normal floating cursor or as an in-place "typing here" indicator — the two are mutually
    // exclusive, matching Figma-style presence (you see their cursor most of the time; the moment
    // they start typing anywhere, it's replaced by their name+avatar above a blinking colored
    // caret pinned to the exact field, then reverts the instant they stop). Always fully re-derived
    // (never incrementally patched) — called from presence sync, render() (edit targets get
    // rebuilt from scratch), and applyTransform() (everything here is screen-space positioned) —
    // so it can't get stuck showing a stale state if a step gets missed somewhere.
    function applyRemoteCursorMode(entry) {
        const target = entry.editingTarget ? document.querySelector(entry.editingTarget) : null;
        const isTyping = !!target;
        // Only a REAL mode flip (not just this same mode being repositioned again — e.g. every
        // frame while the LOCAL user pans/zooms, via repositionAllRemoteCursors) should trigger
        // the travel animation below; comparing against the last mode is what tells the two apart.
        const modeChanged = entry.isTyping !== isTyping;
        entry.isTyping = isTyping;
        if (isTyping) {
            showRemoteTypingIndicator(entry, target, modeChanged);
            if (modeChanged) entry.el.style.display = 'none';
        } else {
            if (modeChanged) travelCursorBackToPointer(entry);
            else { entry.el.style.display = ''; positionRemoteCursor(entry); }
            hideRemoteTypingIndicator(entry);
        }
        // Independent of the cursor-vs-typing-indicator mode above — a live text selection can
        // coexist with either (selecting text also focuses the field, so entry.editingTarget is
        // usually set too, but this doesn't rely on that either way).
        positionSelectionHighlight(entry);
    }
    // Renders/repositions the tinted highlight rect(s) for a remote collaborator's live text
    // selection — one <div> per entry.selectionRects entry (Range.getClientRects() can return
    // several, one per visual line a selection spans), reused across updates rather than
    // recreated every broadcast/reposition. Colored via entry.color (see assignCursorColor) —
    // same currentColor convention as .remote-cursor/.remote-typing-caret — through
    // background:currentColor + fixed opacity in CSS (see .remote-selection-highlight).
    function positionSelectionHighlight(entry) {
        const rects = entry.selectionRects || [];
        while (entry.selectionEls.length < rects.length) {
            const el = document.createElement('div');
            el.className = 'remote-selection-highlight';
            cursorOverlay.appendChild(el);
            entry.selectionEls.push(el);
        }
        while (entry.selectionEls.length > rects.length) {
            entry.selectionEls.pop().remove();
        }
        entry.selectionEls.forEach((el, i) => {
            const r = rects[i];
            el.style.color = entry.color;
            el.style.left = (appState.tx + r.x * appState.scale) + 'px';
            el.style.top = (appState.ty + r.y * appState.scale) + 'px';
            el.style.width = (r.w * appState.scale) + 'px';
            el.style.height = (r.h * appState.scale) + 'px';
        });
    }
    // travel (bool): true only on a genuine cursor->typing mode flip (see applyRemoteCursorMode),
    // never on a same-mode reposition — makes the indicator visibly glide in from wherever the
    // floating cursor last was, instead of popping straight to its destination.
    function showRemoteTypingIndicator(entry, target, travel) {
        const isNew = !entry.typingCaretEl;
        if (!entry.typingCaretEl) {
            entry.typingCaretEl = document.createElement('div');
            entry.typingCaretEl.className = 'remote-typing-caret';
            cursorOverlay.appendChild(entry.typingCaretEl);
        }
        if (!entry.typingLabelEl) {
            entry.typingLabelEl = document.createElement('div');
            entry.typingLabelEl.className = 'remote-editing-label';
            entry.typingLabelEl.innerHTML = `<span class="remote-cursor-avatar"></span><span class="remote-cursor-name"></span>`;
            cursorOverlay.appendChild(entry.typingLabelEl);
        }
        // Tracked by direct element reference (not just re-queried from the selector later) so
        // goToCollaboratorCursor can jump to it — no persistent outline/border is drawn on it
        // anymore (per explicit request: the block itself should stay plain; only the blinking
        // caret + name/avatar pill indicate typing, positioned at the real caret, not the block).
        entry.highlightedEl = target;
        entry.typingCaretEl.style.color = entry.color;
        entry.typingLabelEl.style.color = entry.color;
        entry.typingLabelEl.querySelector('.remote-cursor-name').textContent = entry.displayName || '';
        renderAvatarInto(entry.typingLabelEl.querySelector('.remote-cursor-avatar'), { id: entry.avatarId ?? 0, url: entry.avatarUrl || null }, initials(entry.displayName || '?'));
        if (travel && isNew) {
            // Snap both straight to wherever the floating cursor just was (no transition yet —
            // .remote-presence-travel isn't applied until after this instant jump is committed),
            // then let positionTypingIndicator below move them to their REAL target under that
            // class, which is what actually animates. Without this, a freshly-created element has
            // no "previous" position for the CSS transition to animate FROM, so it would just
            // appear at the destination immediately regardless of the transition being set.
            entry.typingCaretEl.style.display = '';
            entry.typingLabelEl.style.display = '';
            entry.typingCaretEl.style.left = entry.el.style.left;
            entry.typingCaretEl.style.top = entry.el.style.top;
            entry.typingLabelEl.style.left = entry.el.style.left;
            entry.typingLabelEl.style.top = entry.el.style.top;
            void entry.typingCaretEl.offsetWidth; // forces the snap above to paint before the class below re-enables a transition
            entry.typingCaretEl.classList.add('remote-presence-travel');
            entry.typingLabelEl.classList.add('remote-presence-travel');
            clearTimeout(entry.travelTimer);
            entry.travelTimer = setTimeout(() => {
                if (entry.typingCaretEl) entry.typingCaretEl.classList.remove('remote-presence-travel');
                if (entry.typingLabelEl) entry.typingLabelEl.classList.remove('remote-presence-travel');
            }, REMOTE_CURSOR_TRAVEL_MS);
        }
        positionTypingIndicator(entry, target);
    }
    // Split out from showRemoteTypingIndicator so an incoming 'caret' broadcast (see
    // handleRemoteCaretBroadcast) can reposition the existing indicator without recreating it or
    // re-touching the label's text/avatar — called on every caret move while still editing, not
    // just once on entering typing mode.
    function positionTypingIndicator(entry, target) {
        if (!entry.typingCaretEl || !entry.typingLabelEl) return;
        target = target || entry.highlightedEl;
        let left, top, height;
        if (entry.caretX != null && entry.caretY != null) {
            // The typist's actual measured caret position (see getCaretScreenRect/
            // broadcastCaretPosition), converted through OUR OWN live tx/ty/scale — same
            // projection positionRemoteCursor uses for the floating cursor.
            left = appState.tx + entry.caretX * appState.scale;
            top = appState.ty + entry.caretY * appState.scale;
            height = entry.caretHeight != null ? Math.max(12, entry.caretHeight * appState.scale) : 18;
        } else if (target) {
            // No caret broadcast has landed yet (right after entering typing mode) — approximate
            // with the target's own top-left corner for one frame until the real position arrives.
            const canvasRect = canvas.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            left = targetRect.left - canvasRect.left + 2;
            top = targetRect.top - canvasRect.top + 2;
            height = Math.max(12, Math.min(20, targetRect.height - 4));
        } else {
            return;
        }
        entry.typingCaretEl.style.display = '';
        entry.typingCaretEl.style.left = left + 'px';
        entry.typingCaretEl.style.top = top + 'px';
        entry.typingCaretEl.style.height = height + 'px';
        // display must be set before reading offsetWidth/offsetHeight below — both are 0 while
        // display:none, which would center on 0 (i.e. not center at all) on the very first paint.
        entry.typingLabelEl.style.display = '';
        entry.typingLabelEl.style.left = (left - entry.typingLabelEl.offsetWidth / 2) + 'px';
        entry.typingLabelEl.style.top = (top - entry.typingLabelEl.offsetHeight - 4) + 'px';
    }
    function hideRemoteTypingIndicator(entry) {
        entry.highlightedEl = null;
        entry.caretX = null; entry.caretY = null; entry.caretHeight = null;
        if (entry.typingCaretEl) { entry.typingCaretEl.remove(); entry.typingCaretEl = null; }
        if (entry.typingLabelEl) { entry.typingLabelEl.remove(); entry.typingLabelEl = null; }
    }
    function removeRemoteCursor(userId) {
        const entry = remoteCursors.get(userId);
        if (!entry) return;
        clearTimeout(entry.travelTimer);
        clearTimeout(entry.editingBlurTimer);
        hideRemoteTypingIndicator(entry);
        entry.selectionEls.forEach(el => el.remove());
        entry.el.remove();
        remoteCursors.delete(userId);
    }
    function positionRemoteCursor(entry) {
        entry.el.style.left = (appState.tx + entry.x * appState.scale) + 'px';
        entry.el.style.top = (appState.ty + entry.y * appState.scale) + 'px';
    }
    // Mirror of showRemoteTypingIndicator's travel case, for the reverse (typing -> cursor) mode
    // flip: snap the floating cursor to wherever the typing indicator currently sits (no
    // transition), make it visible, then let positionRemoteCursor below move it to its REAL
    // (live mouse) target under .remote-presence-travel — same "instant jump into place, THEN
    // animate away" trick, so it reads as one continuous glide-and-morph rather than the caret
    // vanishing and the cursor popping up already at the far side of the canvas.
    function travelCursorBackToPointer(entry) {
        entry.el.style.display = '';
        if (entry.typingCaretEl) {
            entry.el.classList.remove('remote-presence-travel');
            entry.el.style.left = entry.typingCaretEl.style.left;
            entry.el.style.top = entry.typingCaretEl.style.top;
            void entry.el.offsetWidth; // forces the snap above to paint before the class below re-enables a transition
            entry.el.classList.add('remote-presence-travel');
            clearTimeout(entry.travelTimer);
            entry.travelTimer = setTimeout(() => entry.el.classList.remove('remote-presence-travel'), REMOTE_CURSOR_TRAVEL_MS);
        }
        positionRemoteCursor(entry);
    }
    // Called from applyTransform() too (see below) so every remote cursor/typing-indicator stays
    // visually anchored to the right spot while YOU pan/zoom, not just when a new broadcast/sync
    // arrives.
    function repositionAllRemoteCursors() {
        remoteCursors.forEach(applyRemoteCursorMode);
    }
    // Pans to wherever a collaborator's cursor currently is — clicking their name in the
    // collaborator panel (#collab-panel, see renderCollabList) does this so you can see what
    // they're doing. remoteCursors only has an entry for someone currently present on THIS exact
    // canvas (see handleCanvasPresenceSync) — a no-op if they're not, since there's nowhere real
    // to jump to.
    function goToCollaboratorCursor(userId) {
        const entry = remoteCursors.get(userId);
        if (!entry) return;
        closeCollabPanel();
        const targetScale = Math.max(appState.scale, 1);
        if (entry.highlightedEl) {
            // Currently typing somewhere — jump to what they're actually editing, not their last
            // known mouse position (irrelevant right now, since the cursor itself is hidden while
            // they're typing — see applyRemoteCursorMode).
            const rect = entry.highlightedEl.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            const cx = (rect.left + rect.width / 2 - canvasRect.left - appState.tx) / appState.scale;
            const cy = (rect.top + rect.height / 2 - canvasRect.top - appState.ty) / appState.scale;
            smoothPanTo(window.innerWidth / 2 - cx * targetScale, window.innerHeight / 2 - cy * targetScale, targetScale);
            // A one-off navigation flash, distinct from (and not drawn during) normal typing — the
            // block itself otherwise stays plain per the current design, so the color is set just
            // for this brief animation rather than left on the element.
            const flashEl = entry.highlightedEl;
            flashEl.style.setProperty('--remote-edit-color', entry.color);
            flashEl.classList.add('remote-editing-highlight--flash');
            setTimeout(() => { flashEl.classList.remove('remote-editing-highlight--flash'); flashEl.style.removeProperty('--remote-edit-color'); }, 1200);
        } else {
            smoothPanTo(window.innerWidth / 2 - entry.x * targetScale, window.innerHeight / 2 - entry.y * targetScale, targetScale);
        }
    }
    function handleRemoteCursorBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry) return; // presence sync hasn't created their node yet — the next broadcast will land once it has
        entry.x = payload.x; entry.y = payload.y;
        positionRemoteCursor(entry);
    }
    // Live, purely-visual position streaming while someone else is actively dragging a card — see
    // the throttled send in setupDraggingAndClicking's own `move` handler below. Deliberately
    // DOM-only: this never touches folders[currentFolderId].items itself, so it can't race with
    // (or get overwritten by) anything else touching the real data model. The item's actual
    // position only gets durably committed once the dragger releases and their own render() call
    // picks it up as a normal item-upsert through the existing content-sync diff (see
    // queueSyncDiff/applyRemoteSyncBroadcast) — this is just what makes the drag itself visible
    // in between, instead of the card only jumping to its new spot once dropped.
    function handleRemoteItemDrag(payload) {
        if (!payload || payload.userId === appState.currentUser.id || !Array.isArray(payload.items)) return;
        payload.items.forEach(({ id, x, y }) => {
            const el = document.getElementById('item-' + id);
            if (!el) return;
            el.style.left = x + 'px';
            el.style.top = y + 'px';
        });
    }
    // lastPointerClientX/Y track raw SCREEN position, updated on every real pointermove
    // regardless of the broadcast throttle below — needed because panning without moving the
    // mouse (trackpad two-finger scroll, ctrl+scroll zoom, the zoom slider, any animated
    // smoothPanTo jump) changes which canvas-space point sits under a perfectly stationary
    // on-screen cursor. Re-broadcasting from applyTransform() (see below) using these, rather
    // than only on 'pointermove', is what keeps a collaborator's cursor tracking live WHILE
    // someone pans instead of appearing frozen until they next actually move the mouse.
    let lastPointerClientX = null, lastPointerClientY = null;
    let cursorBroadcastThrottleId = null;
    function broadcastCursorPositionThrottled() {
        if (!canvasPresenceChannel || lastPointerClientX == null || cursorBroadcastThrottleId) return;
        cursorBroadcastThrottleId = setTimeout(() => { cursorBroadcastThrottleId = null; }, 50);
        const rect = canvas.getBoundingClientRect();
        canvasPresenceChannel.send({
            type: 'broadcast', event: 'cursor',
            payload: { userId: appState.currentUser.id, x: (lastPointerClientX - rect.left - appState.tx) / appState.scale, y: (lastPointerClientY - rect.top - appState.ty) / appState.scale },
        });
    }
    canvas.addEventListener('pointermove', (e) => {
        lastPointerClientX = e.clientX; lastPointerClientY = e.clientY;
        broadcastCursorPositionThrottled();
    });
    // Streams a dragged card's LIVE position to everyone else on this canvas (see the `move`
    // handler in setupDraggingAndClicking) — same throttle shape as the cursor broadcast above, so
    // a drag reads as smooth, continuous movement on other screens rather than a jump-to-final-
    // position once dropped. Purely visual on the receiving end (see handleRemoteItemDrag) — the
    // position only becomes durable once the drop itself triggers a normal render()/content-sync.
    let itemDragBroadcastThrottleId = null;
    function broadcastItemDragPositions(startPositions) {
        if (!canvasPresenceChannel || itemDragBroadcastThrottleId) return;
        itemDragBroadcastThrottleId = setTimeout(() => { itemDragBroadcastThrottleId = null; }, 50);
        const items = startPositions.map(pos => {
            const it = findItemById(pos.id);
            return it ? { id: it.id, x: it.x, y: it.y } : null;
        }).filter(Boolean);
        if (!items.length) return;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'item-drag', payload: { userId: appState.currentUser.id, items } });
    }
    // Live, purely-visual size streaming while someone else is actively dragging a card's resize
    // handle — see the throttled send in setupResizing's own `move` handler below. Same DOM-only
    // shape as handleRemoteItemDrag: the item's actual w/h only becomes durable once the drag ends
    // and scheduleWorkspaceSave's normal content-sync diff picks it up.
    function handleRemoteItemResize(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const el = document.getElementById('item-' + payload.id);
        if (!el) return;
        el.style.width = payload.w + 'px';
        el.style.height = payload.h + 'px';
    }
    let itemResizeBroadcastThrottleId = null;
    function broadcastItemResize(id, w, h) {
        if (!canvasPresenceChannel || itemResizeBroadcastThrottleId) return;
        itemResizeBroadcastThrottleId = setTimeout(() => { itemResizeBroadcastThrottleId = null; }, 50);
        canvasPresenceChannel.send({ type: 'broadcast', event: 'item-resize', payload: { userId: appState.currentUser.id, id, w, h } });
    }
    // Applies an incoming 'editing' broadcast — see broadcastEditingState for why this is a plain
    // broadcast rather than presence.track(). The broadcast itself now carries the caret position
    // measured at the exact moment editing started (see computeLocalCaret), not just the target
    // selector — previously the indicator had no caret position at all until the NEXT keystroke's
    // separate 'caret' broadcast landed, so it visibly appeared at the wrong (target top-left)
    // spot for a beat and then jumped once real typing began. Carrying it in the same message
    // means the very first paint is already in the right place.
    function handleRemoteEditingBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry) return; // presence sync hasn't created their node yet — the join-time catch-up resend covers this once it has
        clearTimeout(entry.editingBlurTimer);
        if (payload.editing) {
            entry.editingTarget = payload.editingTarget || null;
            if (payload.caret) {
                entry.caretX = payload.caret.x; entry.caretY = payload.caret.y; entry.caretHeight = payload.caret.height;
            } else {
                entry.caretX = null; entry.caretY = null; entry.caretHeight = null;
            }
            applyRemoteCursorMode(entry);
        } else {
            // Don't drop back to the floating cursor immediately — a blur is very often followed
            // almost right away by a focus on a DIFFERENT field (tabbing/clicking between table
            // cells), and applying this instantly would flash the floating cursor (with its own
            // travel animation, see applyRemoteCursorMode) in between the two, for a switch that
            // should just read as a direct jump from the old field to the new one. This short
            // grace period lets a fast-following 'editing:true' cancel it (via the clearTimeout
            // above) before it ever takes effect.
            entry.editingBlurTimer = setTimeout(() => {
                entry.editingTarget = null;
                entry.caretX = null; entry.caretY = null; entry.caretHeight = null;
                applyRemoteCursorMode(entry);
            }, 150);
        }
    }
    function handleRemoteCaretBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry || !entry.editingTarget) return;
        entry.caretX = payload.x; entry.caretY = payload.y; entry.caretHeight = payload.height;
        positionTypingIndicator(entry);
    }
    function handleRemoteSelectionBroadcast(payload) {
        if (!payload || payload.userId === appState.currentUser.id) return;
        const entry = remoteCursors.get(payload.userId);
        if (!entry) return; // presence sync hasn't created their node yet — the next broadcast will land once it has
        entry.selectionRects = Array.isArray(payload.rects) ? payload.rects : [];
        positionSelectionHighlight(entry);
    }
    // Measures where the blinking caret should actually sit — the real caret position within a
    // contentEditable field via the Selection Range API (falling back to a temporary zero-width
    // marker node when the collapsed range yields no client rect, e.g. an empty line — a standard
    // workaround for that DOM quirk), or an approximate proportional position within a plain
    // <input> (Typeright's answer box), where Selection ranges don't apply the same way.
    function getCaretScreenRect(el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            const rect = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
            const val = el.value || '';
            const pos = el.selectionEnd != null ? el.selectionEnd : val.length;
            const ratio = val.length ? pos / val.length : 0;
            return { left: rect.left + padL + (rect.width - padL - padR) * ratio, top: rect.top, height: rect.height };
        }
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            if (el.contains(range.startContainer)) {
                const r = range.cloneRange();
                // Collapse to the END, not the start — for a real (non-collapsed) selection, the
                // typing indicator/caret should land at the end of the highlighted segment, same
                // place a native caret would sit after you finish dragging a selection. A no-op for
                // an already-collapsed range (start === end), so this doesn't affect plain typing.
                r.collapse(false);
                const rects = r.getClientRects();
                if (rects.length) return rects[0];
                const marker = document.createElement('span');
                marker.textContent = '​';
                r.insertNode(marker);
                const rect = marker.getBoundingClientRect();
                const parent = marker.parentNode;
                parent.removeChild(marker);
                parent.normalize();
                return rect;
            }
        }
        return el.getBoundingClientRect();
    }
    // Measures the caret position for whatever's currently being edited (see localEditingState),
    // in the same canvas-space coordinates handleRemoteCursorBroadcast/positionRemoteCursor use.
    // Returns null if there's nothing to measure (not editing, or the target's gone from the DOM).
    function computeLocalCaret() {
        if (!localEditingState.editingTarget) return null;
        const el = document.querySelector(localEditingState.editingTarget);
        if (!el) return null;
        const rect = getCaretScreenRect(el);
        const canvasRect = canvas.getBoundingClientRect();
        return {
            x: (rect.left - canvasRect.left - appState.tx) / appState.scale,
            y: (rect.top - canvasRect.top - appState.ty) / appState.scale,
            height: rect.height / appState.scale,
        };
    }
    // Re-measures and broadcasts the caret position on every subsequent selectionchange (typing,
    // arrow keys, clicking elsewhere within the same field all move the caret and fire it) via the
    // throttled listener below — the INITIAL position at edit-start is instead carried directly in
    // the 'editing' broadcast itself (see broadcastEditingState), so this only ever needs to cover
    // movement AFTER that first paint.
    function broadcastCaretPosition() {
        if (!canvasPresenceChannel) return;
        const caret = computeLocalCaret();
        if (!caret) return;
        localEditingState.caret = caret;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'caret', payload: { userId: appState.currentUser.id, ...caret } });
    }
    // Measures the current live text SELECTION (not just the caret) within whatever's being
    // edited — same canvas-space coordinates/projection as computeLocalCaret, but one rect per
    // visual line the selection spans (Range.getClientRects(), plural — a real selection can wrap
    // across multiple lines) rather than a single collapsed point. Returns an empty array when
    // there's nothing to highlight (no selection, collapsed to a caret, or somehow outside the
    // current editing target) — broadcastLocalSelection still sends that empty array rather than
    // skipping the send, so a collaborator's screen reliably clears a previously-shown highlight
    // the instant the selection collapses, not just when a new one appears.
    function computeLocalSelectionRects() {
        if (!localEditingState.editingTarget) return [];
        const el = document.querySelector(localEditingState.editingTarget);
        if (!el) return [];
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return [];
        const canvasRect = canvas.getBoundingClientRect();
        return Array.from(range.getClientRects()).map(r => ({
            x: (r.left - canvasRect.left - appState.tx) / appState.scale,
            y: (r.top - canvasRect.top - appState.ty) / appState.scale,
            w: r.width / appState.scale,
            h: r.height / appState.scale,
        }));
    }
    // Broadcasts the current user's own live text selection so every collaborator sees the exact
    // range highlighted, tinted in this user's assigned color (see assignCursorColor) — the
    // selection equivalent of the caret/typing indicator above, rendered on the receiving end by
    // handleRemoteSelectionBroadcast/positionSelectionHighlight.
    function broadcastLocalSelection() {
        if (!canvasPresenceChannel) return;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'selection', payload: { userId: appState.currentUser.id, rects: computeLocalSelectionRects() } });
    }
    let caretBroadcastThrottleId = null;
    document.addEventListener('selectionchange', () => {
        if (!canvasPresenceChannel || !localEditingState.editing || caretBroadcastThrottleId) return;
        caretBroadcastThrottleId = setTimeout(() => { caretBroadcastThrottleId = null; }, 50);
        broadcastCaretPosition();
        broadcastLocalSelection();
    });
    // Broadcasts (not tracks — see the SUBSCRIBED callback above for why) an editing-state change —
    // called from every inline text-edit start/end pair (waypoint rename, breadcrumb title rename,
    // note/title/watermark body editing, table cells, game inputs) so a remote viewer sees this
    // replace their floating cursor with an in-place typing indicator while any of those are
    // focused, and revert back the instant it's blurred (see applyRemoteCursorMode). A no-op
    // wherever there's no active presence channel (a private, non-shared canvas), so nothing needs
    // to guard these calls itself.
    //
    // targetSelector (optional) is a CSS selector identifying the EXACT element being typed into —
    // e.g. "#item-123" for a whole card, or '#item-123 .cell-text[data-r="2"][data-c="1"]' for one
    // specific table cell — used to show a blinking caret + name/avatar label at that element's
    // actual caret position (see showRemoteTypingIndicator/getCaretScreenRect), instead of the
    // normal floating cursor. Omit it for edits that aren't a real canvas element worth pinning to
    // (e.g. the breadcrumb title, which lives in the top bar, not on the canvas) — that case just
    // keeps showing the plain floating cursor throughout.
    function broadcastEditingState(isEditing, targetSelector) {
        localEditingState = { editing: isEditing, editingTarget: isEditing ? (targetSelector || null) : null, caret: null };
        // Measured synchronously, in the SAME tick focus/placeCaretEnd already ran in at each call
        // site, and sent as part of this very message — see computeLocalCaret's caller comment for
        // why this (not a follow-up 'caret' broadcast) is what fixes the initial-position jump.
        if (isEditing && localEditingState.editingTarget) localEditingState.caret = computeLocalCaret();
        if (!canvasPresenceChannel) return;
        canvasPresenceChannel.send({
            type: 'broadcast', event: 'editing',
            payload: { userId: appState.currentUser.id, editing: isEditing, editingTarget: localEditingState.editingTarget, caret: localEditingState.caret },
        });
        // Blurring normally collapses/moves the selection too (which the selectionchange listener
        // above would already catch), but that's not guaranteed for every call site — explicit and
        // immediate here so a collaborator's screen never has to wait for a maybe-not-firing event
        // to clear a stale highlight.
        if (!isEditing) canvasPresenceChannel.send({ type: 'broadcast', event: 'selection', payload: { userId: appState.currentUser.id, rects: [] } });
    }

    // ---- Content sync: diff-and-broadcast on render(), not per-mutation-site instrumentation ----
    // Every mutation in the app already ends in a render() call — rather than threading a
    // broadcast through the ~100+ individual mutation sites across every card kind, this hooks
    // into that one existing universal signal instead. Deliberately whole-item, last-write-wins,
    // not a per-field merge/OT/CRDT — if two people edit the exact same item at the exact same
    // moment, whichever change lands last simply overwrites the other. A real conflict-free merge
    // would mean replacing the entire load/edit/save data model, a separate, much larger effort.
    //
    // NOTE (pre-existing, not introduced by this feature): new item ids come from this client's own
    // local `idCounter++`, seeded from each user's own workspace row independently — two different
    // people adding a new card to the same shared folder at nearly the same moment could in theory
    // generate the same numeric id and collide once merged. This risk already existed today via
    // the existing debounced update_shared_folder save; real-time sync just makes concurrent edits
    // (and so this pre-existing edge case) more likely to actually happen. Worth a proper fix
    // (namespaced/UUID ids) if it turns out to matter in practice — out of scope here.
    function queueSyncDiff(folderObj) {
        if (!canvasPresenceChannel || !lastBroadcastSnapshot) return;
        if (!pendingSyncDeltas) pendingSyncDeltas = { upserts: new Map(), deletes: new Set() };
        const seenIds = new Set();
        (folderObj.items || []).forEach(rawIt => {
            seenIds.add(rawIt.id);
            const it = canonicalItem(rawIt);
            const json = JSON.stringify(it);
            if (lastBroadcastSnapshot.items.get(it.id) !== json) {
                pendingSyncDeltas.upserts.set(it.id, it);
                pendingSyncDeltas.deletes.delete(it.id);
                lastBroadcastSnapshot.items.set(it.id, json);
            }
        });
        lastBroadcastSnapshot.items.forEach((json, id) => {
            if (!seenIds.has(id)) {
                pendingSyncDeltas.deletes.add(id);
                pendingSyncDeltas.upserts.delete(id);
                lastBroadcastSnapshot.items.delete(id);
            }
        });
        if (folderObj.title !== lastBroadcastSnapshot.title) {
            pendingSyncDeltas.title = folderObj.title;
            lastBroadcastSnapshot.title = folderObj.title;
        }
        // Short debounce so a burst of render() calls from one user action (e.g. typing, which
        // re-renders per keystroke in some card kinds) coalesces into one broadcast instead of one
        // per keystroke.
        clearTimeout(syncBroadcastTimer);
        syncBroadcastTimer = setTimeout(flushSyncDiff, 120);
    }
    function flushSyncDiff() {
        if (!canvasPresenceChannel || !pendingSyncDeltas) return;
        const payload = { upserts: Array.from(pendingSyncDeltas.upserts.values()), deletes: Array.from(pendingSyncDeltas.deletes) };
        if (pendingSyncDeltas.title !== undefined) payload.title = pendingSyncDeltas.title;
        pendingSyncDeltas = null;
        if (!payload.upserts.length && !payload.deletes.length && payload.title === undefined) return;
        canvasPresenceChannel.send({ type: 'broadcast', event: 'sync', payload });
    }
    // Applies an incoming remote change directly into local state and re-renders — also updates
    // lastBroadcastSnapshot to match (critical: this is what stops the render() this triggers from
    // re-diffing this exact change as "new" and immediately echoing it straight back out).
    function applyRemoteSyncBroadcast(payload) {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !payload) return;
        let changed = false;
        if (payload.title !== undefined && payload.title !== folderObj.title) {
            folderObj.title = payload.title;
            if (lastBroadcastSnapshot) lastBroadcastSnapshot.title = payload.title;
            changed = true;
        }
        (payload.upserts || []).forEach(canonicalRemoteItem => {
            // Incoming items always arrive canonical (un-namespaced) — see queueSyncDiff. If THIS
            // client's own view of this folder is itself a shared: one, its local items need the
            // same local-only wrapping every other item here already has (see
            // namespaceSharedFolderIds) to stay internally consistent; the owner's own view uses
            // the canonical form directly.
            const remoteItem = folderObj.isSharedView ? namespaceSharedFolderIds(folderObj.sharedOwnerId, [canonicalRemoteItem])[0] : canonicalRemoteItem;
            const idx = folderObj.items.findIndex(it => it.id === remoteItem.id);
            if (idx === -1) folderObj.items.push(remoteItem);
            else folderObj.items[idx] = remoteItem;
            if (lastBroadcastSnapshot) lastBroadcastSnapshot.items.set(remoteItem.id, JSON.stringify(canonicalRemoteItem));
            changed = true;
        });
        (payload.deletes || []).forEach(id => {
            const idx = folderObj.items.findIndex(it => it.id === id);
            if (idx !== -1) folderObj.items.splice(idx, 1);
            if (lastBroadcastSnapshot) lastBroadcastSnapshot.items.delete(id);
            changed = true;
        });
        if (changed) render();
    }

    function openConvo(friendId) {
        activeConvoId = friendId;
        const f = friends.find(x => x.id === friendId);
        if (!f) return;
        renderAvatarInto(document.getElementById('msg-convo-avatar'), { id: f.avatarId ?? 0, url: f.avatarUrl || null }, initials(f.displayName));
        document.getElementById('msg-convo-title').textContent = f.displayName;
        // #msg-convo (and #msg-convo-body inside it) is display:none until the 'open' class is
        // added — made visible BEFORE renderConvoBody runs, since setting scrollTop on a still-
        // hidden 0-height element is a no-op that doesn't stick once it becomes visible
        // afterward (this is what silently broke the always-start-at-the-bottom reset).
        document.getElementById('msg-search-wrap').style.display = 'none';
        msgList.style.display = 'none';
        msgConvo.classList.add('open');
        renderConvoBody(f);
    }
    
    function renderMsgSnapshotCard(item) {
        const card = document.createElement('div');
        card.className = 'msg-snapshot-card';
        
        const header = document.createElement('div');
        header.className = 'snap-header';
        header.textContent = searchKindLabel(item);
        card.appendChild(header);

        if (item.kind === 'title') {
            const titleEl = document.createElement('div');
            titleEl.className = 'snap-title';
            titleEl.innerHTML = item.html || 'Untitled Title';
            card.appendChild(titleEl);
        } else if (item.kind === 'table') {
            const tableWrap = document.createElement('div');
            tableWrap.className = 'overflow-x-auto';
            const table = document.createElement('table');
            table.className = 'snap-table';
            const tbody = document.createElement('tbody');
            item.tableData.forEach(row => {
                const tr = document.createElement('tr');
                row.forEach(cell => {
                    const td = document.createElement('td');
                    td.innerHTML = cell;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            card.appendChild(tableWrap);
        } else if (item.kind === 'checklist') {
            const rowsWrap = document.createElement('div');
            rowsWrap.className = 'flex flex-col gap-1';
            item.tasks.forEach(t => {
                const row = document.createElement('div');
                row.className = 'snap-checklist-row';
                row.innerHTML = `<input type="checkbox" ${t.done ? 'checked' : ''} disabled>
                    <span class="snap-checklist-text" style="${t.done ? 'text-decoration:line-through;opacity:.5;' : ''}">${escapeHtml(t.text || 'Task')}</span>`;
                rowsWrap.appendChild(row);
            });
            card.appendChild(rowsWrap);
        } else if (item.kind === 'bookmark') {
            card.innerHTML += `<div class="flex items-center gap-2"><span class="text-sm">🔖</span><span class="font-semibold truncate">${escapeHtml(item.html || shortUrl(item.bookmarkUrl) || 'Link')}</span></div>`;
        } else if (item.kind === 'embed') {
            card.innerHTML += `<div class="flex items-center gap-2"><span class="text-sm">🌐</span><span class="font-semibold truncate">${escapeHtml(item.embedUrl ? shortUrl(item.embedUrl) : 'Embed')}</span></div>`;
        } else if (item.kind === 'media') {
            if (item.mediaSrc) {
                const tag = item.mediaType === 'video' ? `<video src="${item.mediaSrc}" class="w-full h-24 object-cover rounded" muted controls></video>` : `<img src="${item.mediaSrc}" class="w-full h-24 object-cover rounded"/>`;
                card.innerHTML += tag;
            } else {
                card.innerHTML += `<div class="text-[11px] text-slate-500 italic">Empty media card</div>`;
            }
        } else if (item.kind === 'watermark') {
            card.innerHTML += `<div class="text-xs opacity-50 italic">${escapeHtml(item.html || 'Watermark text')}</div>`;
        } else {
            // Default note / text card
            const body = document.createElement('div');
            body.className = 'snap-body';
            body.innerHTML = item.html || '<span class="text-slate-500 italic">Empty note</span>';
            card.appendChild(body);
        }
        return card;
    }

    // Small icon per card kind, used inside the mini inline-canvas squares
    function miniIconForKind(kind) {
        const icons = { title: 'T', table: '⊞', checklist: '☑', bookmark: '🔖', embed: '🌐', media: '▣', watermark: '≈', flashcard: '⟲', folder: '↗', source: '▶', statcard: '📈', stopwatch: '⏱️', shelf: '🗄️' };
        return icons[kind] || '≡';
    }
    // Deep-clones an item for sharing (chat) or packaging (marketplace draft). Folder/source
    // items additionally embed a self-contained, recursive copy of their own nested contents
    // (snapshotChildren/snapshotTitle) — a plain clone only carries a dangling folderId, which
    // means nothing once the snapshot leaves the account that made it (a friend viewing a
    // shared card, or a marketplace listing viewed by its buyer, has no access to the sharer's
    // live `folders`). Embedding the contents directly is what lets renderInlineCanvas click
    // into a nested folder/source card and actually show something, for anyone who views it.
    function snapshotItem(it) {
        const clone = JSON.parse(JSON.stringify(it));
        if ((it.kind === 'folder' || it.kind === 'source') && appState.folders[it.folderId]) {
            clone.snapshotChildren = appState.folders[it.folderId].items.map(snapshotItem);
            clone.snapshotTitle = appState.folders[it.folderId].title;
        }
        return clone;
    }

    // Same source-of-truth rule as the live disconnect reset in propagateCanvasStreams, applied
    // at export time: a flashcard snapshot leaving the canvas (marketplace, chat, search card
    // context) only gets to keep real word data if the table/source/folder it's actually
    // connected to on the LIVE canvas is also part of this same export batch. Otherwise the
    // clone is neutered to the generic placeholder deck — the live canvas item is never touched,
    // only the copy. Call right after snapshotItem(it), passing every id in the same gesture.
    function sanitizeFlashcardSnapshot(snapshot, batchItemIds) {
        if (snapshot.kind !== 'flashcard' && snapshot.kind !== 'typeright') return snapshot;
        const folder = appState.folders[appState.currentFolderId];
        const conns = folder ? ensureConnections(folder) : [];
        const sourceComesToo = conns.some(c => {
            const otherId = c.fromId === snapshot.id ? c.toId : (c.toId === snapshot.id ? c.fromId : null);
            if (!otherId || !batchItemIds.includes(otherId)) return false;
            const other = folder.items.find(i => i.id === otherId);
            return other && CardStreamIO[other.kind] && (CardStreamIO[other.kind].outputs || []).includes('content');
        });
        if (!sourceComesToo) {
            if (snapshot.kind === 'flashcard') {
                snapshot.cards = defaultFlashcardDeck();
                snapshot.fcOrder = [];
                snapshot.fcIndex = 0;
                snapshot.fcFlipped = false;
                snapshot.fcStats = {};
                snapshot.fcSeenCount = 0;
            } else {
                snapshot.cards = [];
                snapshot.trOrder = [];
                snapshot.trIndex = 0;
                snapshot.trInput = '';
                snapshot.trChecked = false;
                snapshot.trStats = {};
                snapshot.trSeenCount = 0;
            }
        }
        return snapshot;
    }

    function miniLabelForItem(item) {
        if (item.kind === 'table') return 'Table';
        if (item.kind === 'checklist') return 'Checklist';
        if (item.kind === 'flashcard') return 'Flashcards';
        if (item.kind === 'typeright') return 'Typeright';
        if (item.kind === 'statcard') return item.statKind === 'accuracy' ? 'Accuracy' : 'Progress';
        if (item.kind === 'stopwatch') return 'Stopwatch';
        if (item.kind === 'shelf') return item.shelfName || 'Stack';
        if (item.kind === 'bookmark') return item.html || (item.bookmarkUrl ? shortUrl(item.bookmarkUrl) : 'Link');
        if (item.kind === 'folder' || item.kind === 'source') return (appState.folders[item.folderId] && appState.folders[item.folderId].title) || 'Folder';
        const text = stripHtml(item.html || '');
        return text ? text.slice(0, 24) : (item.kind ? item.kind[0].toUpperCase() + item.kind.slice(1) : 'Card');
    }

    // Builds a read-only replica of a card exactly as it appears on the real canvas
    // (same classes/markup/content as the main render() loop), for use inside the
    // inline chat canvas preview. No editing handlers are attached.
    function renderRealCardPreview(it) {
        const el = document.createElement('div');
        el.className = `item ${it.kind}`;

        if (it.kind === 'folder') {
            const f = appState.folders[it.folderId];
            el.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;"><span style="opacity:0.8;">↗</span>${f ? f.title : 'Folder'}</div>
                <div style="font-size:12px;opacity:0.6;">${f ? f.items.length : 0} items</div>
            </div>`;
        } else if (it.kind === 'source') {
            const f = appState.folders[it.folderId];
            const count = countSourceEntries(it.folderId);
            el.innerHTML = `${kindIconHTML('source', null, 'source-card-icon')}
            <div class="source-card-info">
                <span class="source-card-title">${f ? f.title : ''}</span>
                <span class="source-card-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
            </div>`;
        } else if (it.kind === 'title') {
            el.style.fontSize = titleFontSize(it.level || 1) + 'px';
            el.innerHTML = `<div class="body">${it.html || ''}</div>`;
        } else if (it.kind === 'table') {
            el.innerHTML = renderTableHTML(it);
            if (it.userSized) el.classList.add('sized');
        } else if (it.kind === 'media') {
            el.innerHTML = renderMediaHTML(it);
        } else if (it.kind === 'bookmark') {
            el.innerHTML = `<div class="bookmark-icon">🔖</div>
                <div class="bookmark-title">${it.html || (it.bookmarkUrl ? shortUrl(it.bookmarkUrl) : 'New Bookmark')}</div>`;
        } else if (it.kind === 'embed') {
            // Static placeholder, not a live iframe — this renders into mini inline-canvas
            // previews (folder cards, chat/marketplace snapshots) where several might be on
            // screen at once, unlike the single live card in render() (see renderEmbedHTML).
            el.innerHTML = `<div class="embed-icon">🌐</div>
                <div class="embed-title">${it.embedUrl ? shortUrl(it.embedUrl) : 'New Embed'}</div>`;
        } else if (it.kind === 'checklist') {
            el.innerHTML = renderChecklistHTML(it);
        } else if (it.kind === 'watermark') {
            el.innerHTML = `<div class="body watermark-text">${it.html || ''}</div>`;
        } else if (it.kind === 'flashcard') {
            el.innerHTML = renderFlashcardHTML(it);
        } else if (it.kind === 'typeright') {
            el.innerHTML = renderTypeRightHTML(it);
        } else if (it.kind === 'statcard') {
            el.innerHTML = renderStatcardHTML(it);
        } else if (it.kind === 'stopwatch') {
            el.innerHTML = renderStopwatchHTML(it);
        } else if (it.kind === 'shelf') {
            el.innerHTML = renderShelfHTML(it);
        } else {
            el.innerHTML = `<div class="body">${it.html || ''}</div>`;
        }
        return el;
    }

    // Renders a set of shared cards as a real pannable/zoomable mini canvas, preserving
    // their relative x/y layout.
    // The viewer is read-only (pan + zoom only, no editing or moving cards). Dragging the
    // handle above it out onto the main app canvas imports the cards there.
    // Renders a set of packaged/shared cards as a small read-only canvas preview. Visually
    // identical everywhere it's used (chat, marketplace, drafts, publish flow) — the only
    // functional difference draggableOut controls is whether the top-left tab lets you drag the
    // currently-shown cards out onto your real canvas (chat only; marketplace/draft previews are
    // look-only). Clicking a folder/source card drills into its own packaged contents (see
    // snapshotChildren on snapshotItem) using a navigation stack local to this one widget, with
    // its own back/forward arrows — independent of, and without touching, the real app's canvas
    // navigation. No other card kind is clickable.
    // A single shared floating "Delete" row, reused by every renderInlineCanvas instance that
    // passes onDelete (currently only the search card-context popup) — deliberately separate
    // from the real per-card #context-menu / contextMenuItemId, since these mini previews aren't
    // real canvas items.
    let inlineCanvasDeleteMenuEl = null;
    function showInlineCanvasDeleteMenu(x, y, onConfirm) {
        if (!inlineCanvasDeleteMenuEl) {
            inlineCanvasDeleteMenuEl = document.createElement('div');
            inlineCanvasDeleteMenuEl.id = 'inline-canvas-delete-menu';
            inlineCanvasDeleteMenuEl.className = 'inline-canvas-delete-menu';
            inlineCanvasDeleteMenuEl.innerHTML = `<div class="menu-item">Delete</div>`;
            document.body.appendChild(inlineCanvasDeleteMenuEl);
            document.addEventListener('pointerdown', (e) => {
                if (!inlineCanvasDeleteMenuEl.contains(e.target)) inlineCanvasDeleteMenuEl.style.display = 'none';
            });
        }
        inlineCanvasDeleteMenuEl.style.left = x + 'px';
        inlineCanvasDeleteMenuEl.style.top = y + 'px';
        inlineCanvasDeleteMenuEl.style.display = 'flex';
        inlineCanvasDeleteMenuEl.querySelector('.menu-item').onclick = (e) => {
            e.stopPropagation();
            inlineCanvasDeleteMenuEl.style.display = 'none';
            onConfirm();
        };
    }

    // `connections` ({fromId,toId}[]) and `onDelete` (itemId => void) are optional, used only by
    // the search card-context popup (see openSearchCardsModal): connections draw simple
    // non-interactive lines between the top-level items they reference (never inside a drilled-
    // into folder/source level, which is a different, unrelated item set), and onDelete — when
    // provided — wires a right-click "Delete" row onto each top-level mini card.
    function renderInlineCanvas(items, draggableOut, connections, onDelete) {
        if (draggableOut === undefined) draggableOut = true;
        const wrap = document.createElement('div');
        wrap.className = 'msg-inline-canvas-wrap';

        const viewport = document.createElement('div');
        viewport.className = 'msg-inline-canvas';
        const world = document.createElement('div');
        world.className = 'msg-inline-canvas-world';
        viewport.appendChild(world);
        wrap.appendChild(viewport);

        let navStack = [{ items, isSource: false, title: null }];
        let navIndex = 0;

        let dragTab = null;
        if (draggableOut) {
            dragTab = document.createElement('div');
            dragTab.className = 'msg-inline-canvas-drag-tab';
            dragTab.innerHTML = `<span>⠿</span>`;
            dragTab.title = 'Drag onto your canvas';
            viewport.appendChild(dragTab);
        }

        const navBar = document.createElement('div');
        navBar.className = 'msg-inline-canvas-nav';
        navBar.innerHTML = `<button class="msg-inline-canvas-nav-btn" data-dir="back" title="Back">‹</button><button class="msg-inline-canvas-nav-btn" data-dir="fwd" title="Forward">›</button>`;
        viewport.appendChild(navBar);
        const navBackBtn = navBar.querySelector('[data-dir="back"]');
        const navFwdBtn = navBar.querySelector('[data-dir="fwd"]');

        const zoomBar = document.createElement('div');
        zoomBar.className = 'msg-inline-canvas-zoom';
        zoomBar.innerHTML = `<div class="msg-inline-canvas-zoom-track">
            <div class="msg-inline-canvas-zoom-fill"></div>
            <div class="msg-inline-canvas-zoom-thumb"></div>
        </div>`;
        viewport.appendChild(zoomBar);
        const zoomTrackMini = zoomBar.querySelector('.msg-inline-canvas-zoom-track');
        const zoomFillMini = zoomBar.querySelector('.msg-inline-canvas-zoom-fill');
        const zoomThumbMini = zoomBar.querySelector('.msg-inline-canvas-zoom-thumb');

        // ---- Pan (drag) & zoom (slider only; no wheel/pinch response) — normal levels only ----
        const MINI_ZOOM_MIN = 0.2, MINI_ZOOM_MAX = 2, MINI_ZOOM_FIT_MIN = 0.4, MINI_ZOOM_FIT_PADDING = 24;
        let vZoom = 1, vPanX = 0, vPanY = 0, contentW = 1, contentH = 1;
        function applyView() {
            world.style.transform = `translate(${vPanX}px, ${vPanY}px) scale(${vZoom})`;
            viewport.style.backgroundPosition = `${vPanX}px ${vPanY}px`;
            viewport.style.backgroundSize = `${28 * vZoom}px ${28 * vZoom}px`;
        }
        function updateZoomBarUI() {
            const pct = Math.max(0, Math.min(1, (vZoom - MINI_ZOOM_MIN) / (MINI_ZOOM_MAX - MINI_ZOOM_MIN)));
            const trackW = zoomTrackMini.clientWidth;
            const x = pct * trackW;
            zoomFillMini.style.width = x + 'px';
            zoomThumbMini.style.left = x + 'px';
        }
        // Default zoom fits all of the level's content in the viewport with a little padding,
        // never going below MINI_ZOOM_FIT_MIN (40%) even if the content is too big to fully fit —
        // it'll just spill past the edges/need panning at that floor rather than shrink further.
        function centerView() {
            const rect = viewport.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const fitZoom = Math.min(
                (rect.width - MINI_ZOOM_FIT_PADDING * 2) / contentW,
                (rect.height - MINI_ZOOM_FIT_PADDING * 2) / contentH
            );
            vZoom = Math.max(MINI_ZOOM_FIT_MIN, Math.min(MINI_ZOOM_MAX, fitZoom));
            vPanX = (rect.width - contentW * vZoom) / 2;
            vPanY = (rect.height - contentH * vZoom) / 2;
            applyView();
            updateZoomBarUI();
        }

        function updateNavUI() {
            navBackBtn.disabled = navIndex === 0;
            navFwdBtn.disabled = navIndex === navStack.length - 1;
        }

        function renderCurrentLevel() {
            const level = navStack[navIndex];
            world.innerHTML = '';
            updateNavUI();

            if (level.isSource) {
                viewport.classList.add('is-source');
                zoomBar.style.display = 'none';
                world.style.width = '100%';
                world.style.height = '100%';
                world.style.transform = 'translate(0,0) scale(1)';
                renderSourcePreview(level);
                return;
            }
            viewport.classList.remove('is-source');
            zoomBar.style.display = '';
            world.style.width = '';
            world.style.height = '';

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            level.items.forEach(it => {
                const w = it.w || 100, h = it.h || 60;
                minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
                maxX = Math.max(maxX, it.x + w); maxY = Math.max(maxY, it.y + h);
            });
            contentW = Math.max(1, maxX - minX);
            contentH = Math.max(1, maxY - minY);

            const isTopLevel = navIndex === 0;
            const centers = {};
            level.items.forEach(it => {
                const w = it.w || 100, h = it.h || 60;
                // Render the actual card (same markup, text and sizing as the real canvas item)
                const mini = renderRealCardPreview(it);
                mini.style.position = 'absolute';
                mini.style.left = (it.x - minX) + 'px';
                mini.style.top = (it.y - minY) + 'px';
                if (it.kind !== 'title') {
                    mini.style.width = w + 'px';
                    mini.style.height = h + 'px';
                }
                mini.title = miniLabelForItem(it);
                centers[it.id] = { x: (it.x - minX) + w / 2, y: (it.y - minY) + h / 2 };

                const openable = (it.kind === 'folder' || it.kind === 'source') && Array.isArray(it.snapshotChildren);
                if (openable) {
                    mini.style.pointerEvents = 'auto';
                    mini.style.cursor = 'pointer';
                    mini.addEventListener('click', (e) => { e.stopPropagation(); openInlineLevel(it); });
                } else {
                    mini.style.pointerEvents = 'none';
                }
                if (isTopLevel && onDelete) {
                    mini.style.pointerEvents = 'auto';
                    mini.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showInlineCanvasDeleteMenu(e.clientX, e.clientY, () => { onDelete(it.id); });
                    });
                }
                world.appendChild(mini);
            });

            if (isTopLevel && connections && connections.length) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'msg-inline-canvas-connections');
                svg.style.position = 'absolute';
                svg.style.left = '0'; svg.style.top = '0';
                svg.style.width = contentW + 'px'; svg.style.height = contentH + 'px';
                svg.style.overflow = 'visible';
                svg.style.pointerEvents = 'none';
                connections.forEach(c => {
                    const a = centers[c.fromId], b = centers[c.toId];
                    if (!a || !b) return;
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
                    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
                    line.setAttribute('stroke', 'var(--brand)');
                    line.setAttribute('stroke-width', '2');
                    svg.appendChild(line);
                });
                world.appendChild(svg);
            }

            requestAnimationFrame(centerView);
        }

        function openInlineLevel(it) {
            // Drilling in truncates any forward history, same convention as the main app's own
            // back/forward stack.
            navStack = navStack.slice(0, navIndex + 1);
            navStack.push({ items: it.snapshotChildren || [], isSource: it.kind === 'source', title: it.snapshotTitle || miniLabelForItem(it) });
            navIndex++;
            renderCurrentLevel();
        }
        navBackBtn.addEventListener('click', (e) => { e.stopPropagation(); if (navIndex > 0) { navIndex--; renderCurrentLevel(); } });
        navFwdBtn.addEventListener('click', (e) => { e.stopPropagation(); if (navIndex < navStack.length - 1) { navIndex++; renderCurrentLevel(); } });

        // ---- Source level: a plain drag-to-scroll (vertical only) table, no click functionality
        // at all — mirrors how source pages behave in the real app (no pan/zoom, no dot grid).
        function renderSourcePreview(level) {
            const tableItem = (level.items || []).find(i => i.kind === 'table');
            const scroller = document.createElement('div');
            scroller.className = 'msg-inline-canvas-source-scroll';
            if (tableItem) {
                const tableWrap = document.createElement('div');
                tableWrap.className = 'msg-inline-canvas-source-table';
                tableWrap.innerHTML = renderTableHTML(tableItem);
                tableWrap.style.pointerEvents = 'none';
                scroller.appendChild(tableWrap);
            }
            world.appendChild(scroller);

            let scrollDragging = false, scrollStartY = 0, startScrollTop = 0;
            scroller.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                scrollDragging = true;
                scrollStartY = e.clientY;
                startScrollTop = scroller.scrollTop;
                scroller.setPointerCapture(e.pointerId);
            });
            scroller.addEventListener('pointermove', (e) => {
                if (!scrollDragging) return;
                scroller.scrollTop = startScrollTop - (e.clientY - scrollStartY);
            });
            scroller.addEventListener('pointerup', () => { scrollDragging = false; });
            scroller.addEventListener('pointercancel', () => { scrollDragging = false; });
        }

        // Panning only starts on true background clicks — not on an openable card (that's a
        // click-to-open instead), and not on a source level (that scrolls instead of panning).
        let panning = false, panStartX = 0, panStartY = 0, startPanX = 0, startPanY = 0;
        viewport.addEventListener('pointerdown', (e) => {
            if (navStack[navIndex].isSource) return;
            if (e.target.closest('.item, .msg-inline-canvas-drag-tab, .msg-inline-canvas-nav, .msg-inline-canvas-zoom')) return;
            e.stopPropagation();
            panning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            startPanX = vPanX; startPanY = vPanY;
            viewport.setPointerCapture(e.pointerId);
        });
        viewport.addEventListener('pointermove', (e) => {
            if (!panning) return;
            vPanX = startPanX + (e.clientX - panStartX);
            vPanY = startPanY + (e.clientY - panStartY);
            applyView();
        });
        viewport.addEventListener('pointerup', () => { panning = false; });
        viewport.addEventListener('pointercancel', () => { panning = false; });

        // Zoom slider — identical range/behavior to the main canvas zoom control, just horizontal
        function setZoomFromClientX(clientX) {
            const rect = zoomTrackMini.getBoundingClientRect();
            let pct = (clientX - rect.left) / rect.width;
            pct = Math.max(0, Math.min(1, pct));
            const newZoom = MINI_ZOOM_MIN + pct * (MINI_ZOOM_MAX - MINI_ZOOM_MIN);
            const vpRect = viewport.getBoundingClientRect();
            const cx = vpRect.width / 2, cy = vpRect.height / 2;
            const worldX = (cx - vPanX) / vZoom, worldY = (cy - vPanY) / vZoom;
            vPanX = cx - worldX * newZoom;
            vPanY = cy - worldY * newZoom;
            vZoom = newZoom;
            applyView();
            updateZoomBarUI();
        }
        zoomTrackMini.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            zoomTrackMini.classList.add('dragging');
            setZoomFromClientX(e.clientX);
            const move = (me) => setZoomFromClientX(me.clientX);
            const up = () => {
                zoomTrackMini.classList.remove('dragging');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        // ---- Drag the top-left tab out of the chat onto the main app canvas, importing whichever
        // level is currently shown ----
        if (dragTab) dragTab.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            let dragStarted = false, dragGhost = null;
            const startX = e.clientX, startY = e.clientY;
            const move = (me) => {
                if (!dragStarted) {
                    if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
                    dragStarted = true;
                    const n = navStack[navIndex].items.length;
                    dragGhost = document.createElement('div');
                    dragGhost.className = 'inline-canvas-drag-ghost';
                    dragGhost.textContent = `${n} card${n === 1 ? '' : 's'} — drop onto your canvas`;
                    document.body.appendChild(dragGhost);
                }
                dragGhost.style.left = (me.clientX + 14) + 'px';
                dragGhost.style.top = (me.clientY + 14) + 'px';
            };
            const up = (ue) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (dragGhost) { dragGhost.remove(); }
                if (!dragStarted) return;
                const panelRect = messagesPanel.getBoundingClientRect();
                const overPanel = ue.clientX >= panelRect.left && ue.clientX <= panelRect.right && ue.clientY >= panelRect.top && ue.clientY <= panelRect.bottom;
                if (overPanel) return; // dropped back inside the chat panel, no-op
                const canvasRect = canvas.getBoundingClientRect();
                const overCanvas = ue.clientX >= canvasRect.left && ue.clientX <= canvasRect.right && ue.clientY >= canvasRect.top && ue.clientY <= canvasRect.bottom;
                if (!overCanvas) return;
                importSharedCardsAtScreenPoint(navStack[navIndex].items, ue.clientX, ue.clientY);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        renderCurrentLevel();
        return wrap;
    }

    // Drops a shared set of cards onto the working canvas at the given screen point,
    // preserving their relative layout
    function importSharedCardsAtScreenPoint(items, clientX, clientY) {
        saveSnapshot();
        const rect = canvas.getBoundingClientRect();
        const dropX = Math.round(((clientX - rect.left - appState.tx) / appState.scale) / 28) * 28;
        const dropY = Math.round(((clientY - rect.top - appState.ty) / appState.scale) / 28) * 28;
        let minX = Infinity, minY = Infinity;
        items.forEach(it => { minX = Math.min(minX, it.x); minY = Math.min(minY, it.y); });
        items.forEach(it => {
            const clone = JSON.parse(JSON.stringify(it));
            clone.id = appState.idCounter++;
            clone.x = dropX + (it.x - minX);
            clone.y = dropY + (it.y - minY);
            appState.folders[appState.currentFolderId].items.push(clone);
        });
        render();
        closeMessagesPanel();
    }

    function openSharedCanvasView(items) {
        const overlay = document.getElementById('canvas-modal-overlay');
        const body = document.getElementById('canvas-modal-body');
        document.getElementById('canvas-modal-title').textContent = 'Shared Card';
        body.innerHTML = '';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '10px';
        items.forEach(item => body.appendChild(renderMsgSnapshotCard(item)));
        overlay.classList.add('open');
    }
    function closeSharedCanvasView() {
        document.getElementById('canvas-modal-overlay').classList.remove('open');
    }

    function renderConvoBody(f) {
        const body = document.getElementById('msg-convo-body');
        body.innerHTML = '';
        if (!f.messages.length) {
            const empty = document.createElement('div');
            empty.className = 'msg-empty';
            empty.textContent = 'Say hi to ' + f.displayName.split(' ')[0] + '!';
            body.appendChild(empty);
        } else {
            f.messages.forEach(m => {
                const isMine = m.senderId === appState.currentUser.id;
                const wrapper = document.createElement('div');
                wrapper.className = 'flex flex-col ' + (isMine ? 'items-end' : 'items-start') + ' w-full';

                if (m.canvasSnapshot) {
                    if (m.canvasSnapshot.length > 1) {
                        wrapper.appendChild(renderInlineCanvas(m.canvasSnapshot));
                    } else {
                        const snapBox = document.createElement('div');
                        snapBox.className = 'msg-canvas-snapshot';
                        snapBox.appendChild(renderMsgSnapshotCard(m.canvasSnapshot[0]));
                        snapBox.onclick = () => openSharedCanvasView(m.canvasSnapshot);
                        wrapper.appendChild(snapBox);
                    }
                } else {
                    const b = document.createElement('div');
                    b.className = 'msg-bubble ' + (isMine ? 'me' : 'them');
                    b.textContent = m.text;
                    wrapper.appendChild(b);
                }

                // Prepended (not appended) so the DOM ends up newest-message-first — paired
                // with #msg-convo-body's flex-direction:column-reverse, that's what pins the
                // view to the bottom (newest message) and makes new messages push the older
                // ones up, rather than the conversation growing downward from the top.
                body.insertBefore(wrapper, body.firstChild);
            });
        }
        body.scrollTop = 0;
    }
    function closeConvo() {
        msgConvo.classList.remove('open');
        activeConvoId = null;
        // No unsubscribe here — messages are subscribed per-friendship globally now (see
        // subscribeToAllFriendMessages), not per open conversation.
        document.getElementById('msg-search-wrap').style.display = '';
        msgList.style.display = '';
    }
    async function sendMsg() {
        const input = document.getElementById('msg-convo-input');
        const text = input.value.trim();
        if (!text || !activeConvoId) return;
        const f = friends.find(x => x.id === activeConvoId);
        if (!f) return;
        input.value = '';
        updateMsgSendState();
        const { data, error } = await supabase
            .from('messages')
            .insert({ friendship_id: f.friendshipId, sender_id: appState.currentUser.id, body: text })
            .select()
            .single();
        if (error) { console.error('[chat] failed to send message:', error); return; }
        f.messages.push({ id: data.id, senderId: data.sender_id, text: data.body, canvasSnapshot: data.canvas_snapshot, createdAt: data.created_at });
        renderConvoBody(f);
        awardUserPoints('send_chat_message', 2);
    }
    // Send button lights up brand-purple once there's actually something to send, instead of
    // staying the same dim grey whether the box is empty or full.
    function updateMsgSendState() {
        const input = document.getElementById('msg-convo-input');
        document.getElementById('msg-convo-send').classList.toggle('has-text', input.value.trim().length > 0);
    }
    // Stops keys from leaking out to other keyboard shortcuts while typing a message — except
    // Escape, which must still bubble up to the global handler so it can close the panel even
    // while this input has focus (increasingly common now that typing anywhere auto-focuses it).
    document.getElementById('msg-convo-input').addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.getElementById('msg-convo-input').addEventListener('input', updateMsgSendState);
    // Typing anywhere while a conversation is open (without having clicked into the message box
    // first) focuses it and lets the same keystroke land there — so you can just start typing a
    // reply the moment a chat opens, rather than needing to click the input first.
    document.addEventListener('keydown', (e) => {
        if (!msgConvo.classList.contains('open')) return;
        const input = document.getElementById('msg-convo-input');
        if (document.activeElement === input) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length !== 1) return; // only real printable characters — not Enter/Escape/arrows/Tab/etc.
        input.focus();
    });
    msgSearchInput.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });

    function titleFontSize(level) { return level === 3 ? 18 : level === 2 ? 22 : 28; }
    function setTitleLevel(id, level) {
        const it = appState.folders[appState.currentFolderId].items.find(i => i.id === id);
        if (!it) return;
        saveSnapshot();
        it.level = parseInt(level);
        const el = document.getElementById('item-' + id);
        if (el) el.style.fontSize = titleFontSize(it.level) + 'px';
    }

    function rgbToHex(rgb) {
        if (!rgb) return '#ffffff';
        if (rgb.startsWith('#')) return rgb;
        const m = rgb.match(/\d+/g);
        if (!m) return '#ffffff';
        return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
    }
    function syncColorPicker(bodyEl) {
        const picker = bodyEl.closest('.item').querySelector('.format-bar input[type=color]');
        if (!picker) return;
        try {
            let val = document.queryCommandValue('foreColor');
            let hex = rgbToHex(val);
            if (!val || hex === '#000000') {
                const sel = window.getSelection();
                let node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : bodyEl;
                if (node.nodeType === 3) node = node.parentElement;
                if (node && bodyEl.contains(node)) {
                    hex = rgbToHex(getComputedStyle(node).color);
                } else {
                    hex = rgbToHex(getComputedStyle(bodyEl).color);
                }
            }
            picker.value = hex;
        } catch (e) {}
    }

    function findItemById(id) {
        return appState.folders[appState.currentFolderId].items.find(i => i.id === id);
    }
    function placeCaretEnd(el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // ---------- Table card ----------
    function colgroupHTML(numCols) {
        if (!numCols) return '';
        const pct = (100 / numCols).toFixed(4);
        return '<colgroup>' + Array(numCols).fill(0).map(() => `<col style="width:${pct}%">`).join('') + '</colgroup>';
    }
    function renderTableHTML(it) {
        const numCols = it.tableData[0].length;
        const cg = it.userSized ? colgroupHTML(numCols) : '';
        const rows = it.tableData.map((row, ri) =>
            `<tr>${row.map((cell, ci) => `<td contenteditable="true" data-r="${ri}" data-c="${ci}" oninput="updateTableCell(${it.id}, ${ri}, ${ci}, this)" onkeydown="handleTableKeydown(event, ${it.id}, ${ri}, ${ci})" onfocus="broadcastEditingState(true, '#item-${it.id} td[data-r=&quot;${ri}&quot;][data-c=&quot;${ci}&quot;]')" onblur="broadcastEditingState(false)">${cell}</td>`).join('')}</tr>`
        ).join('');
        return `<div class="static-table-wrap" style="--cell-align:${it.textAlign || 'left'}">
                <div class="static-table-row">
                    <div class="table-rounded"><table class="item-table">${cg}<tbody>${rows}</tbody></table></div>
                </div>
            </div>
            <div class="add-col-zone" onmousedown="event.stopPropagation()"><div class="table-add-btn" onclick="addTableCol(${it.id})" title="Add column">+</div></div>
            <div class="add-row-zone" onmousedown="event.stopPropagation()"><div class="table-add-btn" onclick="addTableRow(${it.id})" title="Add row">+</div></div>
            <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
    }
    // The first row of a source table's data is its column names, not a data record. It's
    // rendered entirely separately from the <table> as its own row of independent, fully
    // rounded pill cells (one plain rename-inline <input> each) sitting above the table body
    // — so it never gets mixed up with the actual rows beneath it (which
    // extractCardsFromSource/getSrsForRow etc. still treat as starting at index 1). The pill
    // row and the table share one real horizontal scroller (.static-table-hscroll) rather than
    // being synced via JS, so they move together natively; the upload button floats in a
    // separate non-scrolling overlay on top of it. Column widths and the overlay are wired up
    // afterward by layoutSourceTableColumns once this is in the DOM.
    function cellActionsHTML(itemId, r, c) {
        return `<div class="cell-actions" onmousedown="event.stopPropagation()">
                            <button class="cell-icon-btn cell-add-btn" onclick="event.stopPropagation(); openCellAddMenu(${itemId}, ${r}, ${c}, this)" title="Add image or audio"><img src="assets/icons/add-btn.png" alt=""></button>
                        </div>`;
    }
    // Renders a source table's column-name pill row (`colOptsFn(ci)` returns
    // `{ oninput, onkeydown? }` for column `ci`).
    function buildHeaderPillsHTML(colNames, colOptsFn) {
        return colNames.map((name, ci) => {
            const { oninput, onkeydown = '' } = colOptsFn(ci);
            return `
            <div class="col-name-slot" data-c="${ci}">
                <div class="col-name-pill">
                    <input type="text" class="col-name-input" data-c="${ci}" value="${escapeHtml(stripHtml(name || ''))}" placeholder="Column ${ci + 1}" oninput="${oninput}"${onkeydown ? ` onkeydown="${onkeydown}"` : ''}>
                </div>
            </div>`;
        }).join('');
    }
    // Renders one plain-text source-table cell (cell-inner/cell-text/cell-tags-actions-wrap).
    function tableCellHTML(cell, r, c, opts) {
        const { originTableId, oninput, onkeydown = '', onfocus = '', onblur = '', oncontextmenu = '', tagsAndActionsHTML = '' } = opts;
        return `<td data-origin-table="${originTableId}" data-r="${r}" data-c="${c}"${oncontextmenu ? ` oncontextmenu="${oncontextmenu}"` : ''}>
                    <div class="cell-inner">
                        <div class="cell-text" contenteditable="true" data-r="${r}" data-c="${c}" oninput="${oninput}"${onkeydown ? ` onkeydown="${onkeydown}"` : ''}${onfocus ? ` onfocus="${onfocus}"` : ''}${onblur ? ` onblur="${onblur}"` : ''}>${cell}</div>
                        ${tagsAndActionsHTML}
                    </div>
                </td>`;
    }
    // `folderId` param kept for callers, though nothing in here needs it anymore now that
    // source-to-source merging is gone — a source's rows only ever aggregate elsewhere now, via
    // a Stack card (see CardStreamIO.shelf) reading its 'sourceRows' output.
    function renderStaticTableHTML(it, folderId) {
        const numCols = it.tableData[0].length;
        const cg = colgroupHTML(numCols);
        const headerPills = buildHeaderPillsHTML(it.tableData[0], (ci) => ({
            oninput: `renameTableColumn(${it.id}, ${ci}, this.value)`,
            onkeydown: `handleColNameKeydown(event, ${it.id}, ${ci})`,
        }));
        const rows = it.tableData.slice(1).map((row, dataIdx) => {
            const ri = dataIdx + 1;
            return `<tr data-origin-table="${it.id}">${row.map((cell, ci) => tableCellHTML(cell, ri, ci, {
                originTableId: it.id,
                oninput: `updateTableCell(${it.id}, ${ri}, ${ci}, this)`,
                onkeydown: `handleTableKeydown(event, ${it.id}, ${ri}, ${ci})`,
                onfocus: `setLastFocusedCell(${it.id}, ${ri}, ${ci}); broadcastEditingState(true, '#item-${it.id} .cell-text[data-r=&quot;${ri}&quot;][data-c=&quot;${ci}&quot;]')`,
                onblur: `broadcastEditingState(false)`,
                oncontextmenu: `openTableCellContextMenu(event, ${it.id}, ${ri}, ${ci})`,
                tagsAndActionsHTML: ci === 0
                    ? `<div class="cell-tags-actions-wrap"><div class="cell-tags">${tagPillsHTML(it, ri)}</div>${cellActionsHTML(it.id, ri, ci)}</div>`
                    : cellActionsHTML(it.id, ri, ci),
            })).join('')}</tr>`;
        }).join('');
        return `<div class="static-table-wrap" style="--cell-align:${it.textAlign || 'left'}">
                <div class="static-table-header-overlay">
                    <div class="static-table-header-fade"></div>
                    <button class="static-table-upload-btn" onclick="event.stopPropagation(); triggerSourceUpload()" title="Import a file (CSV, Anki deck, ...) — new rows are merged into this table"><img src="assets/icons/upload-btn.png" alt=""></button>
                </div>
                <div class="static-table-scroller-row">
                    <div class="static-table-hscroll">
                        <div class="static-table-header-track">${headerPills}</div>
                        <div class="static-table-row">
                            <div class="table-rounded"><table class="item-table">${cg}<tbody>${rows}</tbody></table></div>
                        </div>
                    </div>
                    <div class="static-table-row-tag-strip-wrap">
                        <div class="row-tag-strip" onmousedown="event.stopPropagation()" title="Tags"><div class="add-btn"><img src="assets/icons/tag-button.png" alt=""></div></div>
                    </div>
                    <div class="static-table-col-strip-wrap">
                        <div class="add-col-strip" onmousedown="event.stopPropagation()" onclick="addTableCol(${it.id})" title="Add column"><div class="add-btn">+</div></div>
                    </div>
                </div>
                <div class="add-row-strip" onmousedown="event.stopPropagation()">
                    <div class="add-row-btn" onclick="addTableRow(${it.id})" title="Add row"><div class="add-btn">+</div></div>
                </div>
            </div>`;
    }
    // Sizes every column (the header pill slots and the table's own <col>s) to an identical
    // width derived from the container's (viewport-based) rendered width: with 3 or fewer
    // columns they simply divide up the full width, but past 3 columns each column is pinned
    // to containerWidth/VISIBLE_COLS regardless of how many there are, so 3 full columns plus
    // roughly a fifth of the next one show at once and the table scrolls horizontally.
    // Each header pill's *slot* always gets the exact same width as its table column, and
    // slots sit flush against each other with no gap/margin of their own — that's what keeps
    // the header perfectly aligned with the table no matter how many columns exist. The
    // visible pill inside each slot is simply drawn narrower (by GAP px) than its slot, which
    // is what creates the gap between pills without ever touching their positions. This also
    // sizes and shows/hides the fixed upload-button overlay and its fade-out.
    const STATIC_HEADER_PILL_GAP = 8;
    const STATIC_TABLE_VISIBLE_COLS = 3.2; // 3 full columns + ~1/5 of a 4th once overflowing
    const STATIC_TABLE_ROW_GAP = 10; // must match .static-table-hscroll's column-direction gap
    const STATIC_TABLE_PAGE_PADDING_TOP = 96; // must match .item.static-table's padding-top
    const STATIC_TABLE_PAGE_PADDING_BOTTOM = 16; // must match .item.static-table's padding-bottom
    const STATIC_TABLE_BOTTOM_MARGIN = 20; // extra breathing room below the table before it scrolls
    const STATIC_TABLE_UPLOAD_BTN_RESERVE = 35; // permanent extra shrink on the last header pill so the fixed upload button never covers its text
    function layoutSourceTableColumns(it, el, reserve) {
        const wrap = el.querySelector('.static-table-wrap');
        const table = el.querySelector('.item-table');
        const tableRounded = el.querySelector('.table-rounded');
        const headerTrack = el.querySelector('.static-table-header-track');
        const headerOverlay = el.querySelector('.static-table-header-overlay');
        const headerFade = el.querySelector('.static-table-header-fade');
        const colStripWrap = el.querySelector('.static-table-col-strip-wrap');
        const rowTagStripWrap = el.querySelector('.static-table-row-tag-strip-wrap');
        if (!wrap || !table || !headerTrack) return;
        const numCols = (it.tableData[0] || []).length;
        if (!numCols) return;
        const fullContainerWidth = wrap.clientWidth;
        if (!fullContainerWidth || fullContainerWidth <= 0) return;
        const overflowing = numCols > 3;

        // The header pill row always sizes itself off the FULL container width — it never
        // reacts to `reserve`. The add-column hover shrink is meant to only nudge the table's
        // own cells out of the way for the floating button, not the name pills above them.
        const headerColWidth = fullContainerWidth / (overflowing ? STATIC_TABLE_VISIBLE_COLS : numCols);
        const headerTotalWidth = headerColWidth * numCols;
        headerTrack.style.width = headerTotalWidth + 'px';
        const headerSlots = headerTrack.querySelectorAll('.col-name-slot');
        headerSlots.forEach((slot, i) => {
            // The slot itself always stays exactly the width of its table column (for
            // alignment) — only the *visible pill* inside it is drawn narrower, both for the
            // normal inter-pill gap and, on the rightmost one, permanently reserving extra
            // room so the fixed upload button never sits on top of its text.
            slot.style.width = headerColWidth + 'px';
            const isLast = i === headerSlots.length - 1;
            const pill = slot.querySelector('.col-name-pill');
            if (pill) pill.style.width = Math.max(headerColWidth - STATIC_HEADER_PILL_GAP - (isLast ? STATIC_TABLE_UPLOAD_BTN_RESERVE : 0), 24) + 'px';
        });

        // `reserve` (px) is how much room to genuinely give up on the right — used while the
        // add-column button is hovered/revealed and the table is scrolled all the way to its
        // right edge, so the table body redraws narrower and shows its own right border in the
        // gap, rather than just having that sliver of content silently scrolled out of view
        // underneath the button. Every column but the last always uses the same width as the
        // header pills (fullContainerWidth-based, never reserve-adjusted) — only the *last*
        // column gets narrowed by the flat `reserve` amount. That keeps the shrink a constant
        // number of pixels no matter how many columns the table has, instead of scaling up with
        // column count.
        const colWidth = fullContainerWidth / (overflowing ? STATIC_TABLE_VISIBLE_COLS : numCols);
        const totalWidth = colWidth * numCols;
        const shrink = reserve || 0;
        table.style.width = (totalWidth - shrink) + 'px';
        const cols = table.querySelectorAll(':scope > colgroup > col');
        cols.forEach((col, i) => {
            const isLast = i === cols.length - 1;
            col.style.width = (isLast ? Math.max(colWidth - shrink, 24) : colWidth) + 'px';
        });
        // table-rounded gets the same explicit total width as the table itself, so it never
        // has any horizontal overflow of its own to clip (see the CSS note above on why that
        // matters) — the *outer* .static-table-hscroll is what actually scrolls it.
        if (tableRounded) tableRounded.style.width = (totalWidth - shrink) + 'px';

        // The table body's max-height is computed precisely off the real header height (rather
        // than a rough guess), so it expands to fill the available space — leaving a fixed
        // STATIC_TABLE_BOTTOM_MARGIN gap below it — before it needs to start scrolling.
        if (tableRounded) {
            const availableWrapHeight = window.innerHeight - STATIC_TABLE_PAGE_PADDING_TOP - STATIC_TABLE_PAGE_PADDING_BOTTOM - STATIC_TABLE_BOTTOM_MARGIN;
            const maxTableHeight = Math.max(0, availableWrapHeight - headerTrack.offsetHeight - STATIC_TABLE_ROW_GAP);
            tableRounded.style.maxHeight = maxTableHeight + 'px';
        }

        // The overlay doesn't scroll, so it just needs to match the header row's own height
        // once (not per column) to sit correctly over it.
        if (headerOverlay) headerOverlay.style.height = headerTrack.offsetHeight + 'px';
        // The fade under the upload button is now always on, regardless of column count.
        if (headerFade) headerFade.classList.add('visible');
        // Keep the add-column overlay confined to the body's vertical span only — it starts
        // right below the header track (offset by the hscroll's own column-gap) so it can
        // never sit on top of, or intercept clicks/hover on, the header pill row above it.
        if (colStripWrap) colStripWrap.style.top = (headerTrack.offsetHeight + STATIC_TABLE_ROW_GAP) + 'px';
        // Same vertical confinement as the add-column overlay, so the row-tag button can never
        // appear over (or intercept hover on) the header pill row above it either.
        if (rowTagStripWrap) rowTagStripWrap.style.top = (headerTrack.offsetHeight + STATIC_TABLE_ROW_GAP) + 'px';
    }
    function renameTableColumn(id, colIndex, value) {
        const it = findItemById(id); if (!it) return;
        it.tableData[0][colIndex] = value;
        scheduleWorkspaceSave();
    }
    function handleColNameKeydown(e, id, colIndex) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); focusTableCell(id, 1, colIndex); return; }
        const it = findItemById(id); if (!it) return;
        if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length && colIndex + 1 < it.tableData[0].length) {
            e.preventDefault(); focusTableCell(id, 0, colIndex + 1);
        } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0 && colIndex > 0) {
            e.preventDefault(); focusTableCell(id, 0, colIndex - 1);
        }
    }
    function distributeTableSizing(it, el) {
        const wrap = el.querySelector('.static-table-wrap');
        const table = el.querySelector('.item-table');
        if (!wrap || !table) return;
        const rows = table.querySelectorAll('tr');
        if (!rows.length) return;
        const rowH = wrap.clientHeight / rows.length;
        rows.forEach(tr => { tr.style.height = rowH + 'px'; });
    }
    function attachStaticTableHoverZones(container, tableItem) {
        const wrap = container.querySelector('.static-table-wrap');
        const rowStrip = container.querySelector('.add-row-strip');
        const tableRounded = container.querySelector('.table-rounded');
        const colStripWrap = container.querySelector('.static-table-col-strip-wrap');
        const colBtn = container.querySelector('.add-col-strip');
        const rowBtn = container.querySelector('.add-row-btn');
        const hscroll = container.querySelector('.static-table-hscroll');
        const rowTagStripWrap = container.querySelector('.static-table-row-tag-strip-wrap');
        const rowTagBtn = container.querySelector('.row-tag-strip');
        if (!wrap || !rowStrip || !tableRounded) return;
        const THRESH = 60;
        const BTN_SIZE = 28;
        const COL_STRIP_WIDTH = 36; // must match .static-table-col-strip-wrap's revealed width
        const COL_SHRINK_AMOUNT = 35; // flat px the table narrows by — see layoutSourceTableColumns
        const SCROLL_END_BUFFER = 25; // how close to the true right edge counts as "there"
        const SCROLL_START_BUFFER = 30; // how close to the true left edge counts as "there" (for the row-tag indent)
        let colHoverActive = false;
        // Unlike colHoverActive above, this tracks *which row* (its <tr>), not just a boolean —
        // the row-tag button's position is only ever recomputed when this reference changes
        // (a different row is now under the cursor), never on every mousemove tick, which is
        // what keeps it "static" rather than continuously trailing the cursor like the
        // add-column button does.
        let hoveredRowEl = null;
        // The one `.cell-inner` (first cell of whichever row) currently shifted to make room
        // for the tag button, if any — tracked so it can be un-shifted the moment the hovered
        // row changes or the table scrolls away from its left edge.
        let indentedInner = null;
        const updateRowTagBtnPos = () => {
            if (!hoveredRowEl || !rowTagBtn || !rowTagStripWrap) return;
            const rRect = hoveredRowEl.getBoundingClientRect();
            const stripRect = rowTagStripWrap.getBoundingClientRect();
            const top = Math.max(0, Math.min(rRect.top - stripRect.top + rRect.height / 2 - BTN_SIZE / 2, stripRect.height - BTN_SIZE));
            rowTagBtn.style.top = top + 'px';
        };
        // The table only actually shrinks (rather than just having the button float over the
        // top of it) once it's scrolled all the way to its right edge — shrinking it while
        // scrolled elsewhere would move content the user isn't even looking at, for no benefit.
        const isScrolledToRightEdge = () => !hscroll || hscroll.scrollLeft + hscroll.clientWidth >= hscroll.scrollWidth - SCROLL_END_BUFFER;
        // Mirror of the above for the row-tag button on the left: the hovered row's first cell
        // only actually makes room (shifts its content in from the left) once the table is
        // scrolled all the way to ITS left edge. Scrolled anywhere else, that column isn't
        // necessarily even the leftmost thing on screen, so the button just floats over the
        // top of whatever's currently visible there instead.
        const isScrolledToLeftEdge = () => !hscroll || hscroll.scrollLeft <= SCROLL_START_BUFFER;
        const updateColShrink = () => {
            if (tableItem) layoutSourceTableColumns(tableItem, container, (colHoverActive && isScrolledToRightEdge()) ? COL_SHRINK_AMOUNT : 0);
        };
        // Applies (or removes) the "make room" shift on the hovered row's first cell only,
        // re-evaluating both which row is hovered and the current scroll position each time.
        const updateRowIndent = () => {
            if (indentedInner) {
                indentedInner.classList.remove('row-tag-shift');
                indentedInner = null;
            }
            if (hoveredRowEl && isScrolledToLeftEdge()) {
                const firstCell = hoveredRowEl.querySelector('td[data-c="0"]');
                const inner = firstCell && firstCell.querySelector('.cell-inner');
                if (inner) {
                    inner.classList.add('row-tag-shift');
                    indentedInner = inner;
                }
            }
        };
        const onMove = (e) => {
            // Frozen entirely while ANY row-tag picker on this page is open — the tagged row's
            // button/indent must stay exactly as they were until the picker closes, not chase
            // the cursor onto whatever other row it happens to pass over in the meantime.
            if (appState.activeTagRow) return;
            // "Add column" needs to react to the *visible* right edge of the table area
            // (wrap's own rect), not table-rounded's actual content edge — once a table has
            // more than 3 columns, table-rounded is wider than the viewport, so its real edge
            // can be scrolled far off-screen. Vertical bounds still come from table-rounded
            // since its height always matches what's actually on screen.
            //
            // The hotspot that *triggers* the zone only ever starts right at (or past) the
            // table's true right edge — never inside it — since the last column already has
            // its own per-cell "add" button, and the two shouldn't compete for the same hover
            // real estate. But the strip/button, once shown, still visually sits inside that
            // edge (see layoutSourceTableColumns' `reserve`), so moving the cursor onto the
            // button itself is checked for separately below and treated as "still in the
            // zone" regardless — otherwise it'd vanish the instant you tried to reach it.
            const wRect = wrap.getBoundingClientRect();
            const tRect = tableRounded.getBoundingClientRect();
            const hoveredEl = document.elementFromPoint(e.clientX, e.clientY);
            const overColStrip = !!(hoveredEl && colStripWrap && colStripWrap.contains(hoveredEl));
            const strictlyPastRightEdge = e.clientY >= tRect.top && e.clientY <= tRect.bottom && e.clientX >= wRect.right && e.clientX <= wRect.right + THRESH;
            const nearRight = strictlyPastRightEdge || overColStrip;
            const nearBottom = e.clientX >= tRect.left && e.clientX <= tRect.right && e.clientY >= tRect.bottom && e.clientY <= tRect.bottom + THRESH;
            wrap.classList.toggle('show-col', nearRight);
            rowStrip.classList.toggle('show-row', nearBottom);
            // The table only actually needs to redraw narrower right when the hover state
            // flips (not on every pixel of mouse movement), so this only re-runs the column
            // layout on that transition — shrinking the last column's width by a flat
            // COL_SHRINK_AMOUNT (only when already scrolled to the right edge) so the table
            // visibly gets out of the way and shows its own right border in the gap. Otherwise
            // the button just slides in over the top of the table's existing content.
            // Restores back to full width the moment the cursor leaves the zone.
            if (nearRight !== colHoverActive) {
                colHoverActive = nearRight;
                updateColShrink();
            }
            // Keep each "+" button tracking the cursor along whichever axis it slides
            // within — top for the column button (it moves up/down the right edge), left for
            // the row button (it moves left/right along the bottom edge) — so it always sits
            // right where the cursor is, the whole time that edge is hovered.
            if (nearRight && colBtn && colStripWrap) {
                const csRect = colStripWrap.getBoundingClientRect();
                const top = Math.max(0, Math.min(e.clientY - csRect.top - BTN_SIZE / 2, csRect.height - BTN_SIZE));
                colBtn.style.top = top + 'px';
            }
            if (nearBottom && rowBtn) {
                const rsRect = rowStrip.getBoundingClientRect();
                const left = Math.max(0, Math.min(e.clientX - rsRect.left - BTN_SIZE / 2, rsRect.width - BTN_SIZE));
                rowBtn.style.left = left + 'px';
            }
            // Row-tag button: figure out which data row (if any) the cursor is currently over
            // — via the actual element under the pointer (already looked up above) rather than
            // a fixed geometric zone, since "any cell of the row" (not just its left edge)
            // should trigger it. Only acts when that row actually changes, so the button
            // doesn't jitter or chase the cursor while it stays within the same row.
            // Once revealed, the button itself floats (as a positioned overlay) on top of the
            // table's own left edge, so once the cursor moves onto it, elementFromPoint no
            // longer returns a <td> at all — it returns the button. Without this check that
            // read as "cursor left every row" and hid the button out from under itself the
            // instant you tried to reach it. Treat hovering the strip/button as "still on
            // whichever row was last active" instead of re-deriving anything from it.
            const onRowTagStrip = hoveredEl && rowTagStripWrap && rowTagStripWrap.contains(hoveredEl);
            if (!onRowTagStrip) {
                const rowTd = hoveredEl && hoveredEl.closest ? hoveredEl.closest('td[data-r]') : null;
                const rowEl = (rowTd && tableRounded.contains(rowTd)) ? rowTd.closest('tr') : null;
                if (rowEl !== hoveredRowEl) {
                    hoveredRowEl = rowEl;
                    wrap.classList.toggle('show-row-tag', !!rowEl);
                    if (rowEl && rowTagBtn) {
                        const r = Number(rowTd.dataset.r);
                        const originTableId = rowTd.dataset.originTable ? Number(rowTd.dataset.originTable) : tableItem.id;
                        rowTagBtn.onclick = (ev) => { ev.stopPropagation(); openRowTagPicker(originTableId, r, rowTagBtn); };
                        updateRowTagBtnPos();
                    }
                    updateRowIndent();
                }
            }
        };
        // Dismisses the row-tag button and un-indents its cell outright — used both when the
        // cursor leaves the table entirely and (see the scroll listeners below) the instant
        // any scrolling happens, rather than trying to keep the button/indent alive and just
        // repositioning them: a row sliding around under a now-stale button is more confusing
        // than the button just going away until you hover a row again.
        const dismissRowTagHover = () => {
            // Stays put while this table's row-tag picker is open (see openRowTagPicker /
            // closeCellTagPicker) — the cursor leaving the table to go interact with the
            // picker's popover shouldn't un-indent the row it's currently tagging.
            if (appState.activeTagRow && appState.activeTagRow.id === tableItem.id) return;
            if (hoveredRowEl) {
                hoveredRowEl = null;
                wrap.classList.remove('show-row-tag');
                updateRowIndent();
            }
        };
        // Exposed so closeCellTagPicker can force a reset the moment the picker closes,
        // rather than waiting for a mousemove that may not come for a while if it was closed
        // by clicking elsewhere on the canvas.
        container._resetRowTagHover = () => {
            hoveredRowEl = null;
            wrap.classList.remove('show-row-tag');
            updateRowIndent();
        };
        const onLeave = () => {
            wrap.classList.remove('show-col');
            rowStrip.classList.remove('show-row');
            if (colHoverActive) {
                colHoverActive = false;
                updateColShrink();
            }
            dismissRowTagHover();
        };
        container.addEventListener('mousemove', onMove);
        container.addEventListener('mouseleave', onLeave);
        // If the user scrolls the table horizontally while the "add column" zone is still
        // engaged (e.g. they scroll to the end while hovering there), re-check whether it
        // should shrink now rather than waiting for the next hover-state transition. Any
        // horizontal scroll also immediately dismisses the row-tag button/indent.
        if (hscroll) hscroll.addEventListener('scroll', () => {
            if (colHoverActive) updateColShrink();
            dismissRowTagHover();
        });
        // Any vertical scroll (inside table-rounded) also immediately dismisses the row-tag
        // button/indent, rather than trying to keep tracking the row that moved under it.
        if (tableRounded) tableRounded.addEventListener('scroll', () => { dismissRowTagHover(); });
    }
    function updateTableCell(id, r, c, el) {
        // resolveTableForEdit (not findItemById) — id may belong to a table that lives in a
        // different folder than the one currently open (e.g. a flashcard fed via a source's own
        // subfolder, possibly through a connected Stack — see CardStreamIO.shelf).
        const it = resolveTableForEdit(id); if (!it) return;
        it.tableData[r][c] = el.innerHTML;
        scheduleWorkspaceSave();
    }
    function focusTableCell(id, r, c, pos) {
        // Row 0 no longer has editable table cells at all — it's the header's row of plain
        // rename inputs — so route there instead when keyboard nav lands on it.
        if (r === 0) {
            const input = document.querySelector(`#item-${id} .col-name-input[data-c="${c}"]`);
            if (!input) return;
            input.focus();
            const caret = pos === 'start' ? 0 : input.value.length;
            input.setSelectionRange(caret, caret);
            return;
        }
        // Source-page (static) tables put the actual editable text in a nested `.cell-text`
        // div (so the hover tag-button/pills can live alongside it without being part of the
        // editable content); plain canvas table cards still edit the `<td>` itself directly.
        const el = document.querySelector(`#item-${id} .cell-text[data-r="${r}"][data-c="${c}"]`) || document.querySelector(`#item-${id} td[data-r="${r}"][data-c="${c}"]`);
        if (!el) return;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(pos === 'start');
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    function isCaretAtStart(el) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return false;
        const testRange = range.cloneRange();
        testRange.selectNodeContents(el);
        testRange.setEnd(range.startContainer, range.startOffset);
        return testRange.toString().length === 0;
    }
    function isCaretAtEnd(el) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return false;
        const testRange = range.cloneRange();
        testRange.selectNodeContents(el);
        testRange.setStart(range.endContainer, range.endOffset);
        return testRange.toString().length === 0;
    }
    function handleTableKeydown(e, id, r, c) {
        // Quick cloze markup (see resolveGameFace/hasCloze): highlight a word or phrase inside a
        // source cell and press "[" to wrap it in brackets in place, rather than typing "[" and
        // "]" by hand around the caret. Only intercepts when there's an actual (non-collapsed)
        // selection — a plain "[" keystroke with just a caret still types a literal bracket.
        if (e.key === '[') {
            const sel = window.getSelection();
            const el = e.currentTarget;
            if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
                e.preventDefault();
                const range = sel.getRangeAt(0);
                const wrapped = document.createTextNode('[' + range.toString() + ']');
                range.deleteContents();
                range.insertNode(wrapped);
                range.setStartAfter(wrapped);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                updateTableCell(id, r, c, el);
                return;
            }
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                document.execCommand('insertLineBreak');
                return;
            }
            const it = findItemById(id); if (!it) return;
            const isStaticTable = !!e.currentTarget.closest('.static-table');
            if (isStaticTable) {
                const numCols = it.tableData[0].length;
                let nr = r, nc = c + 1;
                if (nc >= numCols) { nc = 0; nr = r + 1; }
                if (nr >= it.tableData.length) addTableRow(id);
                focusTableCell(id, nr, nc);
            } else if (r + 1 < it.tableData.length) {
                focusTableCell(id, r + 1, c);
            } else {
                addTableRow(id);
                focusTableCell(id, r + 1, c);
            }
            return;
        }
        const arrowDeltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        const delta = arrowDeltas[e.key];
        if (!delta) return;
        if (e.shiftKey) return; 
        const el = e.currentTarget;
        if (e.key === 'ArrowLeft' && !isCaretAtStart(el)) return;
        if (e.key === 'ArrowRight' && !isCaretAtEnd(el)) return;
        const it = findItemById(id); if (!it) return;
        const [dr, dc] = delta;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= it.tableData.length || nc < 0 || nc >= it.tableData[0].length) return;
        e.preventDefault();
        focusTableCell(id, nr, nc, e.key === 'ArrowLeft' ? 'end' : 'start');
    }
    function addTableRow(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tableData.push(new Array(it.tableData[0].length).fill(''));
        render();
        // Jump the table's own vertical scroller all the way down so the freshly added
        // (empty) row is immediately visible instead of staying scrolled off-screen.
        const tableRounded = document.querySelector(`#item-${id} .table-rounded`);
        if (tableRounded) tableRounded.scrollTop = tableRounded.scrollHeight;
    }
    function addTableCol(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tableData.forEach(row => row.push(''));
        render();
        // Jump the shared horizontal scroller all the way right so the freshly added
        // (empty) column is immediately visible instead of staying scrolled off-screen.
        const hscroll = document.querySelector(`#item-${id} .static-table-hscroll`);
        if (hscroll) hscroll.scrollLeft = hscroll.scrollWidth;
    }

    // ---------- Source page: insert image/audio into the focused cell ----------
    function setLastFocusedCell(id, r, c) { appState.lastFocusedCell = { id, r, c }; }
    // Appends HTML (an <img>/<audio> tag) to whichever data cell last had focus. Works even
    // if focus has since moved to the toolbar button that triggered the insert, since it goes
    // straight through the DOM + tableData rather than relying on a live text-selection/caret.
    function insertIntoActiveCell(html) {
        // lastFocusedCell can go stale (e.g. the user switched to a different source page
        // without focusing a cell there yet) — findItemById is scoped to the *current* folder,
        // so this also catches that case rather than silently doing nothing.
        const it = appState.lastFocusedCell && findItemById(appState.lastFocusedCell.id);
        const { r, c } = appState.lastFocusedCell || {};
        if (!it || !it.tableData[r] || it.tableData[r][c] == null) {
            alert('Click into a cell first, then use Add to insert an image or audio clip there.');
            return;
        }
        const id = appState.lastFocusedCell.id;
        saveSnapshot();
        const td = document.querySelector(`#item-${id} .cell-text[data-r="${r}"][data-c="${c}"]`);
        if (td) {
            td.insertAdjacentHTML('beforeend', html);
            it.tableData[r][c] = td.innerHTML;
        } else {
            it.tableData[r][c] = (it.tableData[r][c] || '') + html;
            render();
        }
    }
    function triggerCellImageUpload() {
        closeSourceAddMenu();
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = () => insertIntoActiveCell(`<img class="cell-media-img" src="${reader.result}">`);
            reader.readAsDataURL(file);
        };
        input.click();
    }
    function triggerCellAudioUpload() {
        closeSourceAddMenu();
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'audio/*';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = () => insertIntoActiveCell(`<audio class="cell-media-audio" controls src="${reader.result}"></audio>`);
            reader.readAsDataURL(file);
        };
        input.click();
    }
    function startCellAudioRecording() {
        closeSourceAddMenu();
        if (!appState.lastFocusedCell || !findItemById(appState.lastFocusedCell.id)) { alert('Click into a cell first, then use Audio > Record.'); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Microphone recording isn\'t supported in this browser.'); return; }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            appState.cellAudioChunks = [];
            appState.cellAudioRecorder = new MediaRecorder(stream);
            appState.cellAudioRecorder.ondataavailable = (e) => { if (e.data && e.data.size) appState.cellAudioChunks.push(e.data); };
            appState.cellAudioRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                audioRecordIndicator.classList.remove('recording');
                const blob = new Blob(appState.cellAudioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => insertIntoActiveCell(`<audio class="cell-media-audio" controls src="${reader.result}"></audio>`);
                reader.readAsDataURL(blob);
            };
            appState.cellAudioRecorder.start();
            audioRecordIndicator.classList.add('recording');
        }).catch(() => alert('Microphone access was denied or is unavailable.'));
    }
    function stopCellAudioRecording() {
        if (appState.cellAudioRecorder && appState.cellAudioRecorder.state !== 'inactive') appState.cellAudioRecorder.stop();
    }

    // ---------- Source page: import a file (merges new rows into the source's table) ----------
    // Small hand-rolled CSV/TSV parser: handles quoted fields (including escaped "" and
    // embedded delimiters/newlines) without pulling in an external library.
    function parseDelimited(text, delim) {
        const rows = [];
        let row = [], field = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
                else field += ch;
            } else if (ch === '"') inQuotes = true;
            else if (ch === delim) { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (ch === '\r') { /* skip, \n (or the loop end) closes the row */ }
            else field += ch;
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }
        return rows.filter(r => r.some(c => c.trim() !== ''));
    }
    // Imports a CSV/TSV's rows into the current source table by column *name*, not position:
    // the file's own first line is taken as its header row, matched case-insensitively (and
    // trimmed) against the existing table's column names. Matched columns land their values in
    // the right place as brand-new rows; existing columns the file doesn't mention are simply
    // left blank on those new rows; and any file column that doesn't match an existing one gets
    // appended as a brand-new column (named after the file's header), with every row that came
    // before it left blank in that column.
    //
    // The exception is scaffolding the table already has lying around empty: this is judged
    // per column and per row, not as an all-or-nothing "is the whole table blank" check. A
    // column only gets claimed-and-renamed by an unmatched file column if it's both nameless
    // (still showing its "Column N" placeholder) AND every single one of its existing cells is
    // blank — one filled-in cell anywhere in that column takes it out of the running, and a
    // brand-new column is appended instead. Likewise, an existing row is only filled in place
    // if EVERY cell in it is blank; a row with data in even one cell is left completely alone,
    // and file rows keep going to brand-new rows appended at the end once the genuinely blank
    // rows run out.
    function importDelimitedIntoSource(text, delim) {
        const rows = parseDelimited(text, delim);
        if (!rows.length) { alert('No data found in that file.'); return; }
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !folderObj.isSource) return;
        const csvHeader = rows[0].map(h => (h || '').trim());
        const csvDataRows = rows.length > 1 ? rows.slice(1) : [];
        if (!csvDataRows.length) { alert('No data rows found in that file (only a header row).'); return; }
        saveSnapshot();
        let tableItem = folderObj.items.find(i => i.kind === 'table');
        if (!tableItem) {
            // No existing table yet — the file's own headers become the new table's columns
            // outright, in the order they appear in the file.
            tableItem = { id: appState.idCounter++, x: 0, y: 0, w: 0, h: 0, kind: 'table', tableData: [csvHeader.slice()] };
            folderObj.items.push(tableItem);
        }
        const isCellEmpty = c => !(c || '').trim();
        const existingHeader = tableItem.tableData[0];
        const existingDataRows = tableItem.tableData.slice(1);
        // Column-by-column: is every existing cell in this column (across all current data
        // rows) blank? Computed once, up front, off the table as it stood before this import
        // touches anything.
        const columnIsEmpty = existingHeader.map((_, ci) => existingDataRows.every(row => isCellEmpty(row[ci])));
        const normalize = s => (s || '').trim().toLowerCase();
        const existingIndexByName = new Map();
        existingHeader.forEach((name, i) => {
            const key = normalize(name);
            if (key && !existingIndexByName.has(key)) existingIndexByName.set(key, i);
        });
        // Column slots up for grabs by an unmatched file column: nameless AND entirely empty
        // of data so far, in left-to-right order.
        const unnamedSlots = existingHeader.reduce((acc, name, i) => {
            if (!normalize(name) && columnIsEmpty[i]) acc.push(i);
            return acc;
        }, []);
        let unnamedSlotPtr = 0;
        // Map every column in the *file* to a column index in the table: reuse a matching
        // existing column by name; failing that, claim the next eligible unnamed-and-empty
        // slot; failing that, grow the table with a brand-new column named after this file
        // header. Growing the table means pushing a blank cell onto every row that already
        // exists (the header row itself was just grown by name), so the table stays
        // rectangular.
        const csvColToTargetIndex = csvHeader.map((name) => {
            const key = normalize(name);
            if (key && existingIndexByName.has(key)) return existingIndexByName.get(key);
            if (unnamedSlotPtr < unnamedSlots.length) {
                const reuseIndex = unnamedSlots[unnamedSlotPtr++];
                existingHeader[reuseIndex] = name;
                if (key) existingIndexByName.set(key, reuseIndex);
                return reuseIndex;
            }
            const newIndex = existingHeader.length;
            existingHeader.push(name);
            if (key) existingIndexByName.set(key, newIndex);
            tableItem.tableData.forEach((row, ri) => { if (ri > 0) row.push(''); });
            return newIndex;
        });
        const width = tableItem.tableData[0].length;
        const newRows = csvDataRows.map(csvRow => {
            const out = new Array(width).fill('');
            csvRow.forEach((cell, ci) => {
                const targetIndex = csvColToTargetIndex[ci];
                if (targetIndex !== undefined) out[targetIndex] = cell;
            });
            return out;
        });
        // Fill existing rows that are entirely blank, in order, before appending anything new
        // — rows with any real content in them are skipped over and left completely alone.
        let ni = 0;
        for (let ri = 1; ri < tableItem.tableData.length && ni < newRows.length; ri++) {
            if (tableItem.tableData[ri].every(isCellEmpty)) {
                tableItem.tableData[ri] = newRows[ni];
                ni++;
            }
        }
        if (ni < newRows.length) tableItem.tableData.push(...newRows.slice(ni));
        render();
    }

    // ---------- Dotbot-generated source content (see the "sourceAction" panel in
    // app/api/dotbot/orchestrate/route.js) ----------
    const AI_SOURCE_MAX_COLS = 10; // mirrors MAX_SOURCE_COLS server-side
    const AI_SOURCE_MAX_ROWS = 150; // mirrors MAX_SOURCE_ROWS server-side

    // Pads/truncates one generated row to exactly `width` cells, HTML-escaping each one — the
    // model's cell text is plain content, but tableData cells are raw innerHTML (see
    // renderStaticTableHTML), so anything with "<"/"&"/etc must be escaped before it's stored.
    function aiRowToCells(row, width) {
        const cells = new Array(width).fill('');
        (row || []).slice(0, width).forEach((c, i) => { cells[i] = escapeHtml(String(c == null ? '' : c)); });
        return cells;
    }

    // Adds AI-generated rows to an already-attached source (dragged into the search box), found
    // via searchCardContext[targetIndex - 1] — targetIndex is 1-based and numbered exactly like
    // the "Cards attached to this query" / "Sources attached to this query" blocks the server
    // built the prompt from (see commenceDotbotSearch), so it points straight back at the same
    // entry. Only ever targets a "source" card (never a bare "table"), since a source snapshot's
    // folderId is a stable, global key into `folders` — reachable regardless of which canvas the
    // user has since navigated to — while a bare table's id is only meaningful within whichever
    // folder it lived in at drag time.
    function applyAiAddRowsToSource(targetIndex, columns, rows) {
        const ctx = searchCardContext[(targetIndex || 1) - 1];
        if (!ctx || ctx.snapshot.kind !== 'source') return false;
        const folderObj = appState.folders[ctx.snapshot.folderId];
        if (!folderObj) return false;
        saveSnapshot();
        let tableItem = folderObj.items.find(i => i.kind === 'table');
        if (!tableItem) {
            tableItem = { id: appState.idCounter++, x: 28, y: 28, w: 560, h: 360, kind: 'table', tableData: [['']] };
            folderObj.items.push(tableItem);
        }
        const isCellEmpty = c => !stripHtml(c || '').trim();
        const headerBlank = tableItem.tableData[0].every(isCellEmpty);
        let width = tableItem.tableData[0].length;
        // Only ever adopts the model's proposed column names into a still-placeholder header —
        // an existing named source keeps its own columns untouched (see the prompt).
        if (headerBlank && columns && columns.length) {
            width = Math.max(1, Math.min(AI_SOURCE_MAX_COLS, columns.length));
            tableItem.tableData[0] = new Array(width).fill('').map((_, i) => escapeHtml(columns[i] || `Column ${i + 1}`));
            for (let ri = 1; ri < tableItem.tableData.length; ri++) {
                const row = tableItem.tableData[ri];
                tableItem.tableData[ri] = new Array(width).fill('').map((_, ci) => row[ci] || '');
            }
        }
        const newRows = (rows || []).slice(0, AI_SOURCE_MAX_ROWS).map(r => aiRowToCells(r, width));
        if (!newRows.length) return false;
        // Fills existing blank rows first, then appends the rest — same rule
        // importDelimitedIntoSource uses for CSV/TSV import, so AI-added rows behave the same way
        // as a file import would.
        let ni = 0;
        for (let ri = 1; ri < tableItem.tableData.length && ni < newRows.length; ri++) {
            if (tableItem.tableData[ri].every(isCellEmpty)) { tableItem.tableData[ri] = newRows[ni]; ni++; }
        }
        if (ni < newRows.length) tableItem.tableData.push(...newRows.slice(ni));
        render();
        scheduleWorkspaceSave();
        return true;
    }

    // Creates a brand new source card (via the normal add('source', ...) path, so it gets the
    // same undo snapshot/points/placement handling as a manually-added one) seeded with
    // AI-generated columns/rows instead of the usual blank 2x4 grid.
    function createSourceFromAI(title, columns, rows) {
        const { w, h } = kindSize('source');
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const x = Math.round((((cx - appState.tx) / appState.scale) - w / 2) / 28) * 28;
        const y = Math.round((((cy - appState.ty) / appState.scale) - h / 2) / 28) * 28;
        add('source', x, y);
        const items = appState.folders[appState.currentFolderId].items;
        const created = items[items.length - 1];
        const folderObj = appState.folders[created.folderId];
        const width = Math.max(1, Math.min(AI_SOURCE_MAX_COLS, (columns && columns.length) || 2));
        const header = new Array(width).fill('').map((_, i) => escapeHtml((columns && columns[i]) || `Column ${i + 1}`));
        const dataRows = (rows || []).slice(0, AI_SOURCE_MAX_ROWS).map(r => aiRowToCells(r, width));
        folderObj.title = (title || 'New Source').trim().slice(0, 80) || 'New Source';
        folderObj.items[0].tableData = [header, ...(dataRows.length ? dataRows : [new Array(width).fill('')])];
        render();
        scheduleWorkspaceSave();
        return true;
    }

    function triggerSourceUpload() {
        closeSourceAddMenu(); closeCellTagPicker();
        const input = document.createElement('input');
        // Extensions alone are greyed out by some OS file pickers unless matching MIME types
        // are also listed (extension-only matching isn't reliably honoured everywhere) — so
        // both are included here for every accepted type.
        input.type = 'file';
        input.accept = '.csv,.tsv,.txt,.apkg,.colpkg,text/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel,application/csv';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'apkg' || ext === 'colpkg') {
                alert('Anki deck import (.apkg/.colpkg) isn\'t supported yet — only CSV/TSV files can be imported right now.');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => importDelimitedIntoSource(String(reader.result), ext === 'tsv' ? '\t' : ',');
            reader.readAsText(file);
        };
        input.click();
    }

    // ---------- Source page: tags ----------
    // Tag definitions ({id, name, color}) live on the table item itself; which tags are on
    // which row is a separate map keyed by row index -> [tagId, ...], kept entirely apart from
    // the cell's own text/HTML content (tableData) so tag chips never pollute what
    // extractCardsFromSource/search/etc. read out of a cell.
    function ensureTableTags(table) { if (!table.tags) table.tags = []; return table.tags; }
    function ensureCellTags(table) { if (!table.cellTags) table.cellTags = {}; return table.cellTags; }

    function tagPillsHTML(table, r) {
        const ids = (table.cellTags && table.cellTags[r]) || [];
        if (!ids.length) return '';
        const tags = table.tags || [];
        return ids.map(tagId => {
            const tag = tags.find(t => t.id === tagId);
            if (!tag) return '';
            return `<span class="tag-chip" style="--chip-color:${tag.color}" title="${escapeHtml(tag.name)}"><span class="tag-chip-name">${escapeHtml(tag.name)}</span></span>`;
        }).join('');
    }
    // Tags belong to the row, but the chips themselves are only ever rendered in the first
    // column's cell (renderStaticTableHTML only emits a .cell-tags div there). Matched by
    // [data-origin-table] + [data-r] together (not just "#item-${id}" + data-r) so this always
    // picks out the one real row unambiguously. Falls back to a full render() if nothing
    // matched — the DOM may simply not exist yet.
    function refreshCellTagsDom(id, r) {
        const it = resolveTableForEdit(id); if (!it) return;
        const cells = document.querySelectorAll(`.item-table td[data-origin-table="${id}"][data-r="${r}"][data-c="0"] .cell-tags`);
        if (!cells.length) { render(); return; }
        cells.forEach(el => { el.innerHTML = tagPillsHTML(it, r); });
    }
    // Delete/rename affect potentially every row's chips (not just the one being edited in the
    // picker), so refresh column 0 across the whole table in one pass.
    function refreshAllRowTagsDom(it) {
        it.tableData.slice(1).forEach((row, dataIdx) => refreshCellTagsDom(it.id, dataIdx + 1));
    }

    // Row tag picker: a small popover (opened from the tag button that appears, statically
    // positioned, to the left of whichever row is currently hovered) listing every tag as a
    // clickable row — click toggles it on/off for the current row, highlighting it while
    // selected. The new-tag name/colour input always sits at the bottom of the list (not
    // behind an "add tag" toggle), so creating a tag is just type-and-Enter.
    function openRowTagPicker(id, r, btnEl) {
        const it = resolveTableForEdit(id); if (!it) return;
        closeAllPanels(null);
        appState.activeTagRow = { id, r };
        appState.renamingTagId = null;
        closeTagContextMenu();
        document.getElementById('cell-tag-picker-new-color').value = '#6366f1';
        document.getElementById('cell-tag-picker-new-name').value = '';
        renderCellTagPickerList();
        const rect = btnEl.getBoundingClientRect();
        cellTagPicker.style.left = Math.min(rect.right + 6, window.innerWidth - 210) + 'px';
        cellTagPicker.style.top = (rect.top) + 'px';
        cellTagPicker.style.display = 'flex';
    }
    function renderCellTagPickerList() {
        if (!appState.activeTagRow) return;
        const { id, r } = appState.activeTagRow;
        const it = resolveTableForEdit(id); if (!it) return;
        const tags = ensureTableTags(it);
        const assigned = new Set((ensureCellTags(it)[r]) || []);
        const list = document.getElementById('cell-tag-picker-list');
        list.innerHTML = tags.map(t => {
            if (t.id === appState.renamingTagId) {
                return `<div class="cell-tag-picker-row${assigned.has(t.id) ? ' selected' : ''}" data-tag-id="${t.id}">
                    <span class="tag-swatch" style="background:${t.color}"></span>
                    <input type="text" class="tag-picker-rename-input" value="${escapeHtml(t.name)}" onclick="event.stopPropagation()" onkeydown="handleTagRenameKeydown(event, '${t.id}')" onblur="commitTagRename('${t.id}', this.value)">
                </div>`;
            }
            return `<div class="cell-tag-picker-row${assigned.has(t.id) ? ' selected' : ''}" data-tag-id="${t.id}" onclick="toggleCellTag(${id}, ${r}, '${t.id}')" oncontextmenu="openTagContextMenu(event, '${t.id}')">
                <span class="tag-swatch" style="background:${t.color}"></span>
                <span class="tag-picker-name">${escapeHtml(t.name)}</span>
                <span class="tag-picker-check">✓</span>
            </div>`;
        }).join('');
        // The divider above the new-tag input only makes sense once there's something above it.
        document.getElementById('cell-tag-picker-new-row').classList.toggle('has-divider', tags.length > 0);
        if (appState.renamingTagId) {
            const input = list.querySelector('.tag-picker-rename-input');
            if (input) { input.focus(); input.select(); }
        }
    }
    function createTagFromCellPicker() {
        if (!appState.activeTagRow) return;
        const { id, r } = appState.activeTagRow;
        const it = resolveTableForEdit(id); if (!it) return;
        const nameInput = document.getElementById('cell-tag-picker-new-name');
        const colorInput = document.getElementById('cell-tag-picker-new-color');
        const name = nameInput.value.trim();
        if (!name) return;
        saveSnapshot();
        const tag = { id: 'tag_' + appState.idCounter++, name, color: colorInput.value };
        ensureTableTags(it).push(tag);
        const cellTags = ensureCellTags(it);
        const set = new Set(cellTags[r] || []);
        set.add(tag.id);
        cellTags[r] = Array.from(set);
        refreshCellTagsDom(id, r);
        nameInput.value = '';
        renderCellTagPickerList();
        nameInput.focus();
    }
    function toggleCellTag(id, r, tagId) {
        const it = resolveTableForEdit(id); if (!it) return;
        closeTagContextMenu();
        saveSnapshot();
        const cellTags = ensureCellTags(it);
        const set = new Set(cellTags[r] || []);
        if (set.has(tagId)) set.delete(tagId); else set.add(tagId);
        if (set.size) cellTags[r] = Array.from(set); else delete cellTags[r];
        refreshCellTagsDom(id, r);
        renderCellTagPickerList();
    }
    // ---------- Tag right-click menu: rename / delete ----------
    function openTagContextMenu(event, tagId) {
        event.preventDefault();
        event.stopPropagation();
        appState.contextMenuTagId = tagId;
        const menu = document.getElementById('tag-context-menu');
        menu.style.left = event.clientX + 'px';
        menu.style.top = event.clientY + 'px';
        menu.style.display = 'flex';
    }
    function closeTagContextMenu() {
        const menu = document.getElementById('tag-context-menu');
        if (menu) menu.style.display = 'none';
        appState.contextMenuTagId = null;
    }
    function startRenameActiveTag() {
        const tagId = appState.contextMenuTagId;
        closeTagContextMenu();
        if (!tagId) return;
        appState.renamingTagId = tagId;
        renderCellTagPickerList();
    }
    function handleTagRenameKeydown(e, tagId) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); appState.renamingTagId = null; renderCellTagPickerList(); }
    }
    function commitTagRename(tagId, newValue) {
        if (appState.renamingTagId !== tagId) return; // already cancelled via Escape
        appState.renamingTagId = null;
        if (!appState.activeTagRow) return;
        const it = resolveTableForEdit(appState.activeTagRow.id);
        if (it) {
            const tag = ensureTableTags(it).find(t => t.id === tagId);
            const trimmed = newValue.trim();
            if (tag && trimmed && trimmed !== tag.name) {
                saveSnapshot();
                tag.name = trimmed;
                refreshAllRowTagsDom(it);
            }
        }
        renderCellTagPickerList();
    }
    function deleteActiveTag() {
        const tagId = appState.contextMenuTagId;
        closeTagContextMenu();
        if (!tagId || !appState.activeTagRow) return;
        const it = resolveTableForEdit(appState.activeTagRow.id); if (!it) return;
        saveSnapshot();
        it.tags = ensureTableTags(it).filter(t => t.id !== tagId);
        const cellTags = ensureCellTags(it);
        Object.keys(cellTags).forEach(rKey => {
            cellTags[rKey] = cellTags[rKey].filter(id => id !== tagId);
            if (!cellTags[rKey].length) delete cellTags[rKey];
        });
        refreshAllRowTagsDom(it);
        renderCellTagPickerList();
    }
    // Explicitly resets the row-tag hover state on the affected table (rather than waiting for
    // the next mousemove to notice) — see attachStaticTableHoverZones' _resetRowTagHover — so
    // the tag button/indent don't linger if the picker was closed by clicking elsewhere on the
    // canvas rather than by moving the mouse off the table.
    function closeCellTagPicker() {
        cellTagPicker.style.display = 'none';
        closeTagContextMenu();
        appState.renamingTagId = null;
        if (appState.activeTagRow) {
            // The rendered page's own container is always keyed by the CURRENTLY OPEN source's
            // table id, not necessarily activeTagRow.id.
            const localTable = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.find(i => i.kind === 'table');
            const container = localTable && document.getElementById('item-' + localTable.id);
            if (container && container._resetRowTagHover) container._resetRowTagHover();
        }
        appState.activeTagRow = null;
    }

    // ---------- Media card ----------
    function renderMediaHTML(it) {
        if (it.mediaUploading) {
            return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--ink-soft);width:100%;">
                <div style="font-size:13px;">Uploading ${escapeHtml(it.mediaName || 'file')}…</div>
            </div>`;
        }
        if (!it.mediaSrc) {
            return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--ink-soft);width:100%;">
                <div style="font-size:13px;">Add photo, video, PDF, or EPUB</div>
                <div style="display:flex;gap:6px;" onmousedown="event.stopPropagation()">
                    <button class="format-btn" style="width:auto;padding:0 10px;" onclick="setMediaFromLink(${it.id})">Link</button>
                    <button class="format-btn" style="width:auto;padding:0 10px;" onclick="triggerMediaUpload(${it.id})">Upload</button>
                </div>
            </div>`;
        }
        const tag = it.mediaType === 'video'
            ? `<video src="${it.mediaSrc}" controls></video>`
            : `<img src="${it.mediaSrc}"/>`;
        return `<div class="media-change-btn" onmousedown="event.stopPropagation()" onclick="clearMedia(${it.id})" title="Remove media">✕</div>${tag}
            <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
    }
    // Probes an <img>/<video>'s real intrinsic dimensions, regardless of whether src is a data:
    // URL (upload) or a remote URL (paste-a-link) — only reads width/height metadata, never pixel
    // data, so CORS (which would block the latter) never applies here. Async by nature (the
    // element has to actually start loading first), so callers render once immediately with
    // whatever size the item already has, then again once this resolves.
    function measureMediaNaturalSize(src, isVideo, cb) {
        if (isVideo) {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.onloadedmetadata = () => cb(v.videoWidth, v.videoHeight);
            v.onerror = () => cb(0, 0);
            v.src = src;
        } else {
            const img = new Image();
            img.onload = () => cb(img.naturalWidth, img.naturalHeight);
            img.onerror = () => cb(0, 0);
            img.src = src;
        }
    }
    // Fits the media's real aspect ratio into a reasonable default card footprint — previously
    // every media card was a fixed 240x160 box with object-fit:cover force-cropping whatever was
    // set into it, silently losing part of the image/video instead of showing it true to shape.
    // Only ever caps the longer edge (never upscales a small image past its native size), so the
    // ratio itself is always exact, not just approximated.
    function computeMediaCardSize(naturalW, naturalH) {
        if (!naturalW || !naturalH) return { w: 240, h: 160 }; // fallback if measurement ever fails
        const scale = Math.min(320 / naturalW, 320 / naturalH, 1);
        return { w: Math.round(naturalW * scale), h: Math.round(naturalH * scale) };
    }
    function setMediaFromLink(id) {
        const url = prompt('Paste an image or video URL:');
        if (!url) return;
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        const isVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
        it.mediaType = isVideo ? 'video' : 'image';
        it.mediaSrc = url.trim();
        render();
        measureMediaNaturalSize(it.mediaSrc, isVideo, (w, h) => {
            const live = findItemById(id);
            if (!live || live.mediaSrc !== it.mediaSrc) return; // cleared/changed again before this resolved
            Object.assign(live, computeMediaCardSize(w, h));
            render();
        });
    }
    function triggerMediaUpload(id) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*,video/*,application/pdf,application/epub+zip,.epub';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
            const isEpub = file.type === 'application/epub+zip' || /\.epub$/i.test(file.name);
            if (isPdf || isEpub) { uploadDocumentToStorage(id, file, isPdf ? 'pdf' : 'epub'); return; }
            const reader = new FileReader();
            reader.onload = () => {
                const it = findItemById(id); if (!it) return;
                saveSnapshot();
                const isVideo = file.type.startsWith('video');
                it.mediaType = isVideo ? 'video' : 'image';
                it.mediaSrc = reader.result;
                render();
                measureMediaNaturalSize(it.mediaSrc, isVideo, (w, h) => {
                    const live = findItemById(id);
                    if (!live || live.mediaSrc !== it.mediaSrc) return;
                    Object.assign(live, computeMediaCardSize(w, h));
                    render();
                });
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
    // PDFs/EPUBs go through real Supabase Storage rather than the data: URL path images/video use
    // above — see the 20260805_add_documents_storage migration's own comment for why (a multi-MB
    // file base64-embedded directly in the item's JSON would bloat every single workspace
    // autosave). w/h get a fixed page-shaped default (not aspect-ratio-derived like
    // computeMediaCardSize — a document doesn't have one single "natural" ratio the way an image
    // does) — the user can still resize the card normally afterward.
    async function uploadDocumentToStorage(id, file, docType) {
        const it = findItemById(id); if (!it) return;
        if (!supabase || !appState.currentUser.id) { alert('Sign in to upload documents.'); return; }
        saveSnapshot();
        it.mediaType = docType; it.mediaSrc = null; it.mediaName = file.name; it.mediaUploading = true;
        // PDFs default a bit bigger than the base 340x440 (425x550) — a page of real body text
        // needs to be legibly sized at a glance without resizing by hand every time, but not so
        // big it dominates the canvas by default (now that cards are drag-to-resize anyway, see
        // setupResizing). EPUBs keep the smaller default; their own reflowable viewer doesn't
        // have the same "a whole page has to fit and stay readable" constraint a fixed-size PDF
        // page render does.
        if (docType === 'pdf') { it.w = 425; it.h = 550; } else { it.w = 340; it.h = 440; }
        render();
        const path = `${appState.currentUser.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
        const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined });
        const live = findItemById(id);
        if (!live) return; // card got deleted while the upload was in flight
        if (error) {
            console.error('[media] document upload failed:', error);
            live.mediaUploading = false; live.mediaType = null; live.mediaName = null;
            render();
            alert('Upload failed — try again.');
            return;
        }
        const { data } = supabase.storage.from('documents').getPublicUrl(path);
        live.mediaSrc = data.publicUrl;
        live.mediaUploading = false;
        render();
    }
    function clearMedia(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.mediaType = null; it.mediaSrc = null; it.mediaName = null;
        it.docPage = null; it.epubLocation = null;
        render();
    }

    // ---------- PDF viewer (media card, mediaType:'pdf') ----------
    // pdf.js ships a real ES module build (see public/vendor/pdfjs, copied from the pdfjs-dist
    // package — this classic, non-bundled script can't `import` straight from node_modules) —
    // loaded via dynamic import() rather than a <script> tag, and only on first actual use, so the
    // ~1.7MB library+worker never loads for a session that never touches a PDF card. A singleton
    // promise (not re-imported per card) so switching between multiple PDF cards only pays the
    // load cost once per session.
    let pdfjsLibPromise = null;
    function loadPdfjs() {
        if (!pdfjsLibPromise) {
            pdfjsLibPromise = import('/vendor/pdfjs/pdf.min.mjs').then(lib => {
                lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
                return lib;
            });
        }
        return pdfjsLibPromise;
    }
    // render() wipes and rebuilds #world's entire DOM on essentially every interaction anywhere on
    // the canvas (see the main render loop) — a PDF card's own view gets destroyed and rebuilt
    // right along with everything else, but the actual PARSED document (the expensive fetch +
    // parse step) must NOT be re-fetched every single time that happens, so it's cached here by
    // src, independent of the DOM lifecycle. Same reasoning as buildFolderInlineCanvas/
    // renderTableHTML already rebuilding their own presentational DOM from scratch on every
    // render() — only the network+parse cost specifically needs to survive that, not the DOM.
    const pdfDocCache = new Map(); // mediaSrc -> Promise<PDFDocumentProxy>
    function getCachedPdfDoc(src) {
        if (!pdfDocCache.has(src)) {
            // getDocument only accepts a DocumentInitParameters object (`function getDocument(e={})`
            // in the vendored build) — it does NOT special-case a bare string into { url } the way
            // older pdf.js versions did, so passing `src` directly throws "expected either `data`,
            // `range`, or `url` parameter" (every property read off the raw string comes back
            // undefined).
            pdfDocCache.set(src, loadPdfjs().then(lib => lib.getDocument({ url: src }).promise));
        }
        return pdfDocCache.get(src);
    }
    // Builds a live PDF viewer: the current page rasterized to a <canvas>, with pdf.js's own
    // TextLayer — genuinely selectable, positioned <span>s, not an image of text — laid invisibly
    // on top of it in exact alignment. That's what makes the existing "select text -> Add to
    // source"/"Look up" toolbar (see the document-level selectionchange listener further down)
    // work on a PDF exactly like it already does on any other card's text — the only change needed
    // there is broadening its host check to also accept .pdf-text-layer alongside
    // [contenteditable="true"]. Current page number persists on it.docPage (survives the DOM
    // rebuild the same way every other card kind's live state does — e.g. flashcard's fcIndex).
    function buildPdfViewer(it) {
        const wrap = document.createElement('div');
        wrap.className = 'pdf-viewer';
        wrap.onclick = (e) => e.stopPropagation();
        // A tightly-fitted wrapper sized to exactly the rendered page's own w/h — canvas and
        // textLayer both anchor to ITS corner, not .pdf-viewer's, since .pdf-viewer centers its
        // content via flex (so canvas alone isn't flush at 0,0 within it) and the text layer's
        // position:absolute needs a positioned ancestor that IS exactly page-sized for its spans
        // to land in the right place over the canvas.
        const page = document.createElement('div');
        // The generic per-card drag-to-move system listens for 'pointerdown', not 'mousedown' —
        // see setupDraggingAndClicking's own exemption list (`.item-options`, `.resize`), which
        // .pdf-viewer-page is now also on, for the exact same reason: without it, click-dragging
        // to select text anywhere over the document started moving the whole card instead of
        // letting the browser's native text-selection drag happen. The nav bar below is
        // deliberately NOT exempted — it's the card's actual drag handle now that the document
        // itself can't be.
        page.className = 'pdf-viewer-page';
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-viewer-canvas';
        const textLayer = document.createElement('div');
        textLayer.className = 'pdf-text-layer';
        page.append(canvas, textLayer);
        const nav = document.createElement('div');
        nav.className = 'pdf-viewer-nav';
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button'; prevBtn.className = 'pdf-viewer-nav-btn'; prevBtn.textContent = '‹';
        const pageLabel = document.createElement('span');
        pageLabel.className = 'pdf-viewer-page-label';
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button'; nextBtn.className = 'pdf-viewer-nav-btn'; nextBtn.textContent = '›';
        nav.append(prevBtn, pageLabel, nextBtn);
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize';
        resizeHandle.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg>';
        wrap.append(page, nav, resizeHandle);

        let pdfDoc = null;
        let pageNum = it.docPage || 1;
        let renderTask = null;

        async function renderPage() {
            if (!pdfDoc) return;
            pageNum = Math.max(1, Math.min(pageNum, pdfDoc.numPages));
            pageLabel.textContent = `${pageNum} / ${pdfDoc.numPages}`;
            const pdfPage = await pdfDoc.getPage(pageNum);
            const baseViewport = pdfPage.getViewport({ scale: 1 });
            // The PDF page's own true aspect ratio (independent of whatever size the card
            // currently happens to be) — setupResizing's media branch locks dragging to this
            // instead of the card's current (possibly still-default, not-yet-page-shaped) w/h.
            it.docAspectRatio = baseViewport.width / baseViewport.height;
            // Keep the card's own box exactly the right shape for its content, width-anchored —
            // recomputed every render (a no-op once it already matches) rather than only once, so
            // this both corrects an upload's still-default, not-yet-page-shaped box on first load
            // AND self-heals any minor grid-snap rounding drift from a resize drag. Without this,
            // the box and the actual page could end up a slightly different shape, which is what
            // made resizing look like it was cropping the page instead of scaling it uniformly —
            // the page was always rendered at ITS OWN correct ratio, but the surrounding box
            // (with overflow:auto) wasn't guaranteed to match it.
            const cardEl = wrap.closest('.item');
            if (cardEl) {
                const wantedH = Math.max(112, Math.round((it.w / it.docAspectRatio) / 28) * 28);
                if (wantedH !== it.h) { it.h = wantedH; cardEl.style.height = it.h + 'px'; }
            }
            // Fit the page's own natural width to whatever the card currently measures — read
            // fresh on every call rather than assumed, so a resized card (or one reopened at a
            // different width) always renders sharp instead of stretched.
            const targetWidth = wrap.clientWidth || 320;
            const scale = targetWidth / baseViewport.width;
            const viewport = pdfPage.getViewport({ scale });
            page.style.width = viewport.width + 'px'; page.style.height = viewport.height + 'px';
            // Canvas *display* size (CSS px, logical) stays at the viewport's own size — only the
            // backing pixel buffer is rendered larger, by devicePixelRatio, and the render call
            // scales its drawing into that larger buffer via `transform`. Without this, a Retina/
            // HiDPI screen (dpr 2-3x) stretches a 1x-resolution buffer to fill the same CSS box,
            // which is exactly what "pixelated" looks like — same standard fix pdf.js's own
            // reference viewer/examples use.
            const outputScale = window.devicePixelRatio || 1;
            canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
            // Feeds pdf.js's own --total-scale-factor:calc(var(--scale-factor) * var(--user-unit))
            // chain (see .pdf-text-layer's CSS) — the same mechanism pdf.js's reference viewer uses
            // to size each text span correctly at the current zoom. Deliberately the LOGICAL scale,
            // not multiplied by outputScale — text-layer spans position themselves in the same CSS
            // coordinate space the canvas is DISPLAYED at, not its backing buffer's pixel count.
            textLayer.style.setProperty('--scale-factor', scale);
            if (renderTask) renderTask.cancel();
            renderTask = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform });
            try { await renderTask.promise; } catch (e) { return; } // canceled by a newer renderPage() call — the newer one owns the canvas now
            textLayer.innerHTML = '';
            const lib = await loadPdfjs();
            const layer = new lib.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textLayer, viewport });
            await layer.render();
        }
        function goToPage(n) {
            if (!pdfDoc || n < 1 || n > pdfDoc.numPages) return;
            pageNum = n;
            it.docPage = pageNum;
            scheduleWorkspaceSave();
            renderPage();
        }
        prevBtn.onclick = (e) => { e.stopPropagation(); goToPage(pageNum - 1); };
        nextBtn.onclick = (e) => { e.stopPropagation(); goToPage(pageNum + 1); };

        // Dragging the card's own resize handle (see setupResizing) changes wrap's real measured
        // size, but nothing about that re-fits the already-rendered page to it — without this,
        // the page just sat at whatever size it was last rendered at, clipped or gapped by
        // .pdf-viewer-page's overflow:auto rather than actually rescaling. Debounced rather than
        // re-rendering on every single resize tick (a real re-render awaits a page fetch + canvas
        // paint + text-layer rebuild — too slow to run on every pixel of a drag), so it re-fits
        // shortly after the size settles instead of mid-drag.
        let resizeSettleTimer = null;
        const resizeObserver = new ResizeObserver(() => {
            if (resizeSettleTimer) clearTimeout(resizeSettleTimer);
            resizeSettleTimer = setTimeout(renderPage, 150);
        });
        resizeObserver.observe(wrap);

        getCachedPdfDoc(it.mediaSrc).then(doc => { pdfDoc = doc; renderPage(); }).catch(err => {
            console.error('[media] pdf load failed:', err);
            wrap.innerHTML = '<div style="padding:12px;color:var(--ink-soft);font-size:13px;">Couldn\'t load this PDF.</div>';
        });

        return wrap;
    }

    // ---------- EPUB viewer (media card, mediaType:'epub') ----------
    // epubjs ships classic UMD builds (see public/vendor/epub), not a real ES module, so this
    // loads them as plain <script> tags instead of import() — jszip first (epub.js expects
    // window.JSZip to already exist), then epub.js itself, which then exposes window.ePub. A
    // singleton promise so multiple EPUB cards only pay the script-load cost once per session.
    let epubjsLibPromise = null;
    function loadEpubjs() {
        if (!epubjsLibPromise) {
            epubjsLibPromise = new Promise((resolve, reject) => {
                const jszip = document.createElement('script');
                jszip.src = '/vendor/epub/jszip.min.js';
                jszip.onload = () => {
                    const epub = document.createElement('script');
                    epub.src = '/vendor/epub/epub.min.js';
                    epub.onload = () => resolve(window.ePub);
                    epub.onerror = reject;
                    document.head.appendChild(epub);
                };
                jszip.onerror = reject;
                document.head.appendChild(jszip);
            });
        }
        return epubjsLibPromise;
    }
    // Parsed Book objects (the expensive fetch+unzip+parse step) persist across render()'s
    // frequent full DOM rebuilds, same reasoning as pdfDocCache above. The Rendition itself can't
    // be cached the same way — it's attached to a specific container element that genuinely gets
    // destroyed on every rebuild — so it's always recreated fresh against the cached Book instead.
    const epubBookCache = new Map(); // mediaSrc -> Promise<Book>
    function getCachedEpubBook(src) {
        if (!epubBookCache.has(src)) {
            epubBookCache.set(src, loadEpubjs().then(ePub => ePub(src)));
        }
        return epubBookCache.get(src);
    }
    function buildEpubViewer(it) {
        const wrap = document.createElement('div');
        wrap.className = 'epub-viewer';
        wrap.onclick = (e) => e.stopPropagation();
        const container = document.createElement('div');
        container.className = 'epub-viewer-container';
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize';
        resizeHandle.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg>';
        wrap.append(container, resizeHandle);

        getCachedEpubBook(it.mediaSrc).then(book => {
            // scrolled-doc: one continuous scroll, not paginated — sidesteps needing our own
            // page-turn UI (see buildPdfViewer's nav) inside an already-small canvas card.
            const rendition = book.renderTo(container, { width: '100%', height: '100%', flow: 'scrolled-doc' });
            rendition.display(it.epubLocation || undefined);
            rendition.on('relocated', (location) => {
                it.epubLocation = location.start.cfi;
                scheduleWorkspaceSave();
            });
            // Feeds the SAME selection-toolbar "Add to source"/"Look up" flow used everywhere else
            // in the app (see showSelectionToolbarFor). epub.js renders each chapter inside its
            // own same-origin iframe (needed for per-book CSS isolation), so the main document's
            // own selectionchange listener never sees these selections at all — a selectionchange
            // firing on an iframe's own Document doesn't bubble to the parent document even when
            // same-origin — this is the equivalent hook on epub.js's own side, which already emits
            // a real DOM Range via its own in-iframe selectionchange listener.
            rendition.on('selectedRange', (range) => {
                const iframeEl = container.querySelector('iframe');
                if (!iframeEl) return;
                const iframeRect = iframeEl.getBoundingClientRect();
                const rangeRect = range.getBoundingClientRect();
                showSelectionToolbarFor(range, container, {
                    left: iframeRect.left + rangeRect.left, top: iframeRect.top + rangeRect.top,
                    width: rangeRect.width, height: rangeRect.height,
                });
            });
        }).catch(err => {
            console.error('[media] epub load failed:', err);
            wrap.innerHTML = '<div style="padding:12px;color:var(--ink-soft);font-size:13px;">Couldn\'t load this EPUB.</div>';
        });

        return wrap;
    }

    // ---------- Bookmark card ----------
    function shortUrl(url) {
        try { return new URL(url).hostname; } catch (e) { return url.slice(0, 24); }
    }
    function editBookmark(id) {
        const it = findItemById(id); if (!it) return;
        const url = prompt('Bookmark URL:', it.bookmarkUrl || 'https://');
        if (url === null) return;
        const label = prompt('Bookmark title (optional):', it.html || '');
        saveSnapshot();
        it.bookmarkUrl = url.trim();
        it.html = (label || '').trim();
        render();
    }

    // ---------- Embed card ----------
    // Rewrites common "watch"/share links into their dedicated iframe-embeddable equivalents.
    // YouTube/Vimeo deliberately block their normal watch/player page from being framed elsewhere
    // (X-Frame-Options/CSP frame-ancestors — an anti-clickjacking measure) and only allow embedding
    // through a separate /embed/ (YouTube) or player.vimeo.com (Vimeo) path — a plain pasted
    // "youtube.com/watch?v=..." link renders blank otherwise, which is exactly the confusing
    // failure mode this exists to avoid. Only rewrites the iframe's actual src — it.embedUrl itself
    // stays exactly what the user pasted, so re-opening editEmbed shows their original familiar
    // link, not a rewritten one. Anything not matching a known watch-link pattern passes through
    // unchanged (CodePen/JSFiddle/Gist links already use their own embeddable URL shape once
    // copied as an "embed" link, so those need no rewriting).
    // YouTube's IFrame player uses this to verify which site is embedding it as part of its own
    // postMessage handshake — omitting it (or stripping the referrer entirely, see renderEmbedHTML's
    // referrerpolicy below) is exactly what produces YouTube's "Error 153: video player
    // configuration error" instead of the video actually loading.
    function withYoutubeOrigin(embedUrl) {
        const u = new URL(embedUrl);
        u.searchParams.set('origin', window.location.origin);
        return u.toString();
    }
    function toEmbeddableUrl(rawUrl) {
        let u;
        try { u = new URL(rawUrl); } catch (e) { return rawUrl; }
        const host = u.hostname.replace(/^www\.|^m\./, '');
        if (host === 'youtube.com') {
            if (u.pathname === '/watch' && u.searchParams.get('v')) {
                const start = parseInt(u.searchParams.get('t'), 10);
                return withYoutubeOrigin(`https://www.youtube.com/embed/${u.searchParams.get('v')}${start ? '?start=' + start : ''}`);
            }
            const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
            if (shorts) return withYoutubeOrigin(`https://www.youtube.com/embed/${shorts[1]}`);
            if (u.pathname.startsWith('/embed/')) return withYoutubeOrigin(rawUrl); // already an embed link — still needs origin set
        } else if (host === 'youtu.be' && u.pathname.length > 1) {
            return withYoutubeOrigin(`https://www.youtube.com/embed/${u.pathname.slice(1)}`);
        } else if (host === 'vimeo.com') {
            const id = u.pathname.match(/^\/(\d+)/);
            if (id) return `https://player.vimeo.com/video/${id[1]}`;
        }
        return rawUrl;
    }
    // Embeds an external website or embeddable code snippet (CodePen/JSFiddle/Gist-style links)
    // live via <iframe> — the first iframe in this codebase (no prior card kind used one; media
    // embeds video/images via native <video>/<img> instead). sandbox is permissive enough to cover
    // common embeds (allow-scripts + allow-same-origin together is what most real embed widgets
    // need to actually function) rather than maximally locked down — this is showing the user's
    // own chosen URL, not arbitrary untrusted content injected by someone else. allow +
    // allowfullscreen cover what video embeds (YouTube/Vimeo) specifically need for their own play/
    // fullscreen controls to work. referrerpolicy is deliberately NOT "no-referrer" — YouTube's
    // player needs the referrer (alongside the origin param from withYoutubeOrigin above) to
    // complete its own embedding-origin check, and stripping it produces "Error 153: video player
    // configuration error" instead of the video loading; strict-origin-when-cross-origin still only
    // ever leaks this app's bare origin, never the full page URL. Even after toEmbeddableUrl's
    // rewriting, some sites still refuse to be framed at all and will just show blank inside the
    // iframe — that's a property of the target site, not something fixable from here.
    function renderEmbedHTML(it) {
        if (!it.embedUrl) {
            return `<div class="embed-empty">
                <div class="embed-icon">🌐</div>
                <div class="embed-title">New Embed</div>
                <div class="embed-hint">Click to add a website or code embed link</div>
            </div>`;
        }
        // .embed-header is a dedicated drag handle, separate from the iframe below it — a
        // cross-origin iframe is its own browsing context and NEVER dispatches pointerdown (or
        // any DOM event) to the parent page for interactions inside it, a hard browser security
        // boundary, not something this app can intercept. Without a handle outside the iframe,
        // a filled embed card (iframe filling the whole body) would have no draggable surface at
        // all once a URL is set. This also means the iframe itself is never covered by anything —
        // every click/drag/scroll directly on it always reaches the embedded page untouched,
        // which is the whole point of embedding it live in the first place.
        return `<div class="embed-header">
                <span class="embed-header-url">${escapeHtml(shortUrl(it.embedUrl))}</span>
                <div class="embed-edit" onmousedown="event.stopPropagation()" onclick="editEmbed(${it.id})" title="Edit embed link">✎</div>
            </div>
            <iframe class="embed-frame" src="${escapeHtml(toEmbeddableUrl(it.embedUrl))}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    }
    function editEmbed(id) {
        const it = findItemById(id); if (!it) return;
        const url = prompt('Embed URL (website or embeddable code snippet link):', it.embedUrl || 'https://');
        if (url === null) return;
        saveSnapshot();
        it.embedUrl = url.trim();
        render();
    }

    // ---------- Checklist card ----------
    function renderStatcardHTML(it) {
        const label = it.statKind === 'progress' ? 'Progress' : (it.statKind ? it.statKind[0].toUpperCase() + it.statKind.slice(1) : 'Stat');
        const cache = it.streamCache || {};
        const payloads = Object.values(cache);
        let value = '—', caption = 'Link a game, stopwatch, or shelf card to see stats.';
        if (it.statKind === 'progress' && payloads.length) {
            const seen = payloads.reduce((sum, p) => sum + ((p.delta && p.delta.seen) || 0), 0);
            value = String(seen);
            caption = 'Cards Seen';
        } else if (it.statKind === 'accuracy' && payloads.length) {
            let right = 0, wrong = 0;
            payloads.forEach(p => {
                const r = (p.delta && p.delta.ratings) || {};
                right += (r.hard || 0) + (r.easy || 0);
                wrong += (r.noclue || 0) + (r.wrong || 0);
            });
            value = `${right} / ${wrong}`;
            caption = 'Right / Wrong';
        }
        return `<div class="statcard-header">${label}</div>
            <div class="statcard-value">${value}</div>
            <div class="statcard-caption">${caption}</div>`;
    }
    function renderChecklistHTML(it) {
        const total = it.tasks.length, done = it.tasks.filter(t => t.done).length;
        const pct = total ? Math.round(done / total * 100) : 0;
        const rows = it.tasks.map(t => `
            <div class="checklist-row">
                <input type="checkbox" ${t.done ? 'checked' : ''} onmousedown="event.stopPropagation()" onchange="toggleTask(${it.id}, ${t.id})">
                <span class="checklist-text" contenteditable="true" onmousedown="event.stopPropagation()" oninput="updateTaskText(${it.id}, ${t.id}, this)" style="${t.done ? 'text-decoration:line-through;opacity:.5;' : ''}">${t.text}</span>
                <input type="date" class="checklist-date" value="${t.deadline || ''}" onmousedown="event.stopPropagation()" onchange="updateTaskDeadline(${it.id}, ${t.id}, this)">
                <span class="checklist-remove" onmousedown="event.stopPropagation()" onclick="removeTask(${it.id}, ${t.id})">✕</span>
            </div>`).join('');
        return `<div class="checklist-progress"><div class="checklist-fill" style="width:${pct}%"></div></div>
            <div class="checklist-rows">${rows}</div>
            <div class="checklist-add" onmousedown="event.stopPropagation()" onclick="addTask(${it.id})">+ Add task</div>`;
    }
    function addTask(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tasks.push({ id: appState.idCounter++, text: '', done: false, deadline: '' });
        render();
    }
    function toggleTask(id, tid) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        const t = it.tasks.find(x => x.id === tid); if (t) t.done = !t.done;
        render();
    }
    function updateTaskText(id, tid, el) {
        const it = findItemById(id); if (!it) return;
        const t = it.tasks.find(x => x.id === tid); if (t) t.text = el.textContent;
        scheduleWorkspaceSave();
    }
    function updateTaskDeadline(id, tid, el) {
        const it = findItemById(id); if (!it) return;
        const t = it.tasks.find(x => x.id === tid); if (t) t.deadline = el.value;
        scheduleWorkspaceSave();
    }
    function removeTask(id, tid) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tasks = it.tasks.filter(x => x.id !== tid);
        render();
    }

    // ---------- Game options (right-click front/back column config) ----------
    // Shared by every game card kind that has a real front/back notion today (flashcard,
    // typeright). A row's raw per-column HTML (row.cells, see extractCardsFromSource) came from
    // either plain typed text or a media insert (triggerCellImageUpload/setMediaFromLink tag
    // <img class="cell-media-img">; triggerCellAudioUpload/startCellAudioRecording tag
    // <audio class="cell-media-audio">) — this is the one place that turns that raw HTML back
    // into a content-type so the options panel can show it and Typeright can filter on it.
    function cellContentType(html) {
        if (!html) return 'text';
        if (/<img\b/i.test(html)) return 'image';
        if (/<audio\b/i.test(html)) return 'audio';
        return 'text';
    }
    // Cloze deletion: a text cell containing [bracketed] word(s) — e.g. "Yo [como] manzanas" —
    // can be shown three ways once a column is picked in the options panel's dropdown: the plain
    // column name (brackets removed, the word itself kept — "Yo como manzanas"), an indented
    // "Blank" variant (the bracketed word replaced by a blank — "Yo [...] manzanas"), or an
    // indented "[...]" variant (just the bracketed word/phrase alone — "como"). A column with no
    // brackets anywhere only ever gets the plain option.
    const CLOZE_RE = /\[([^\[\]]+)\]/g;
    function hasCloze(text) {
        CLOZE_RE.lastIndex = 0;
        return CLOZE_RE.test(text || '');
    }
    function clozeBlankText(text) {
        return text.replace(/\[([^\[\]]+)\]/g, '[...]');
    }
    function clozeAnswerText(text) {
        const answers = [];
        text.replace(/\[([^\[\]]+)\]/g, (m, g1) => { answers.push(g1.trim()); return m; });
        return answers.join(', ');
    }
    // Removes just the bracket punctuation, keeping the enclosed word/phrase in place — the
    // plain dropdown option's own transform, so a cloze-authored cell still reads as ordinary
    // prose when neither the Blank nor the [...] variant is specifically chosen for it. A no-op
    // for a column with no brackets at all.
    function clozeUnwrapText(text) {
        return text.replace(/\[([^\[\]]+)\]/g, '$1');
    }
    // Which column(s) feed a given side, as slot objects {col, mode} — `it.gameConfig` (set via
    // the dropdowns in renderGameOptionsHTML/setGameColumnSlot/addGameColumnSlot below) is
    // {frontCols:[{col,mode},...], backCols:[...]}, mode one of 'plain' (default), 'blank',
    // 'extract'. When unset, falls back to EXACTLY the old hardcoded behavior (front = column 0,
    // back = column 1, or column 0 again if there's only one column, mode 'plain') so a
    // flashcard that never had its options opened looks identical to before.
    // Coerces one gameConfig entry into a real {col, mode} slot — entries saved by an earlier
    // version of this feature (a bare column-index number, or a {col,cloze}/{col,cloze,extract}
    // object from since-removed variants) are still sitting in already-persisted workspaces, and
    // reading/mutating one of those as if it were already a slot object silently no-ops (you
    // can't assign .col onto a primitive number) — which is exactly what made cards render blank
    // and dropdown changes appear to do nothing for anyone who'd configured a game before this.
    function normalizeGameSlot(entry) {
        if (entry && typeof entry === 'object') {
            const col = Number.isFinite(entry.col) ? entry.col : 0;
            if (entry.mode === 'plain' || entry.mode === 'blank' || entry.mode === 'extract') return { col, mode: entry.mode };
            if (entry.extract) return { col, mode: 'extract' };
            if (entry.cloze) return { col, mode: 'blank' };
            return { col, mode: 'plain' };
        }
        return { col: Number(entry) || 0, mode: 'plain' };
    }
    function effectiveGameSlots(it, side, colCount) {
        const cfg = it.gameConfig;
        if (cfg && Array.isArray(cfg[side + 'Cols']) && cfg[side + 'Cols'].length) return cfg[side + 'Cols'].map(normalizeGameSlot);
        const col = side === 'front' ? 0 : (colCount > 1 ? 1 : 0);
        return [{ col, mode: 'plain' }];
    }
    // Whether at least one row currently on this card has [bracket] syntax in column `i` — the
    // options panel's own Blank/[...] dropdown entries (see renderGameOptionsHTML) only appear
    // under a column that passes this, checked across every row rather than just a sample one.
    function colHasAnyCloze(it, i) {
        return (it.cards || []).some(row => Array.isArray(row.cells) && hasCloze(stripHtml(row.cells[i] || '')));
    }
    // Resolves one row + one side into an ordered list of {col, type, text, html} blocks — one
    // per selected column, so multiple text columns (e.g. Chinese characters + pinyin) stack as
    // separate lines, and an image/audio column renders as its own media element. mode:'plain'
    // (the default, top-level dropdown option) shows the column's text with any [bracket]
    // punctuation removed but the enclosed word kept; mode:'blank' (the indented "Blank" option)
    // shows the sentence with the bracketed word replaced by "[...]"; mode:'extract' (the
    // indented "[...]" option) shows just the bracketed word/phrase alone. Which mode applies is
    // a direct per-slot choice, not inferred from front/back side.
    function resolveGameFace(it, row, side) {
        // The placeholder deck (defaultFlashcardDeck, shown before any source is linked) has
        // plain {front, back} strings with no `cells` — render that as a single text block
        // rather than trying to apply column selection to data that has no columns.
        if (!Array.isArray(row.cells)) {
            return [{ col: 0, type: 'text', text: row[side] || '', html: row[side] || '' }];
        }
        const cells = row.cells;
        const slots = effectiveGameSlots(it, side, cells.length);
        return slots.map(slot => {
            const i = slot.col;
            const html = cells[i] || '';
            const type = cellContentType(html);
            if (type === 'text') {
                const text = stripHtml(html);
                if (slot.mode === 'blank') return { col: i, type: 'text', text: clozeBlankText(text), html };
                if (slot.mode === 'extract') return { col: i, type: 'text', text: clozeAnswerText(text), html };
                return { col: i, type: 'text', text: clozeUnwrapText(text), html };
            }
            return { col: i, type, text: stripHtml(html), html };
        });
    }
    // Which column indices have a non-plain mode set, across both sides of this game card — a
    // row must have [bracket] syntax in EVERY one of these columns to be included in the game at
    // all (Blank/[...] only make sense for rows that actually have brackets there; plain mode
    // never filters, since it works fine on ordinary rows too).
    function gameClozeFilterCols(it) {
        const cfg = it.gameConfig;
        if (!cfg) return [];
        const cols = new Set();
        (cfg.frontCols || []).concat(cfg.backCols || []).forEach(slot => { if (slot && slot.mode && slot.mode !== 'plain') cols.add(slot.col); });
        return Array.from(cols);
    }
    // The row list an actual game (flashcard, typeright) iterates over — it.cards filtered down
    // by every cloze-toggled column's presence requirement. Shared by both kinds' own
    // fcPlayableCards/trPlayableCards (typeright layers its own additional "answer side must be
    // text" rule on top of this).
    function gamePlayableCards(it) {
        const clozeCols = gameClozeFilterCols(it);
        const cards = it.cards || [];
        if (!clozeCols.length) return cards;
        return cards.filter(row => {
            if (!Array.isArray(row.cells)) return true; // placeholder deck — no columns to check
            return clozeCols.every(ci => hasCloze(stripHtml(row.cells[ci] || '')));
        });
    }
    function renderGameFaceBlocksHTML(blocks) {
        if (!blocks || !blocks.length) return '';
        return blocks.map(b => {
            if (b.type === 'image' || b.type === 'audio') return b.html;
            return `<div class="game-face-line">${escapeHtml(b.text)}</div>`;
        }).join('');
    }
    function openGameOptionsPanel(id) {
        const it = findItemById(id); if (!it) return;
        it.optionsOpen = true;
        render();
    }
    function closeGameOptionsPanel(id) {
        const it = findItemById(id); if (!it) return;
        it.optionsOpen = false;
        render();
    }
    // Materializes it.gameConfig from the same implicit default effectiveGameSlots computes on
    // the fly (front=column 0, back=column 1 or 0, cloze off) — needed before any of the
    // mutators below can edit a specific slot, since there's nothing to index into until it's
    // real.
    function ensureGameConfigDefaults(it) {
        const sampleCells = (it.cards && it.cards[0] && it.cards[0].cells) || [];
        const defaultBack = () => [{ col: sampleCells.length > 1 ? 1 : 0, mode: 'plain' }];
        if (!it.gameConfig) it.gameConfig = { frontCols: [{ col: 0, mode: 'plain' }], backCols: defaultBack() };
        if (!Array.isArray(it.gameConfig.frontCols) || !it.gameConfig.frontCols.length) it.gameConfig.frontCols = [{ col: 0, mode: 'plain' }];
        if (!Array.isArray(it.gameConfig.backCols) || !it.gameConfig.backCols.length) it.gameConfig.backCols = defaultBack();
        // Migrates any slot saved in an older format (see normalizeGameSlot) into a real object
        // IN PLACE, so the mutators below (which do e.g. slot.col = ...) always have an actual
        // object to mutate rather than silently no-oping on a primitive.
        it.gameConfig.frontCols = it.gameConfig.frontCols.map(normalizeGameSlot);
        it.gameConfig.backCols = it.gameConfig.backCols.map(normalizeGameSlot);
        return it.gameConfig;
    }
    function gameColumnCount(it) {
        return (it.gameHeaders && it.gameHeaders.length) || ((it.cards && it.cards[0] && it.cards[0].cells) || []).length;
    }
    // Replaces the column (and mode) assigned to one dropdown slot — a plain column pick encodes
    // as value="<col>", the indented Blank/[...] variants (see renderGameOptionsHTML) as
    // value="<col>:blank" / "<col>:extract".
    function setGameColumnSlot(id, side, slotIndex, value) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        ensureGameConfigDefaults(it);
        const [colStr, variant] = String(value).split(':');
        const slot = it.gameConfig[side + 'Cols'][slotIndex];
        slot.col = Number(colStr);
        slot.mode = (variant === 'blank' || variant === 'extract') ? variant : 'plain';
        scheduleWorkspaceSave();
        render();
    }
    // Adds another dropdown to a side, defaulting to the first column not already used on that
    // side (falls back to column 0) — this is what lets a side stack more than one column (e.g.
    // characters + pinyin), and applies equally to Front and Back.
    function addGameColumnSlot(id, side) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        ensureGameConfigDefaults(it);
        const cols = it.gameConfig[side + 'Cols'];
        const colCount = gameColumnCount(it);
        const used = new Set(cols.map(s => s.col));
        let next = 0;
        for (let i = 0; i < colCount; i++) { if (!used.has(i)) { next = i; break; } }
        cols.push({ col: next, mode: 'plain' });
        scheduleWorkspaceSave();
        render();
    }
    // Removes one dropdown from a side — a side always keeps at least one, since an empty side
    // has nothing to show.
    function removeGameColumnSlot(id, side, slotIndex) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        ensureGameConfigDefaults(it);
        const cols = it.gameConfig[side + 'Cols'];
        if (cols.length > 1) cols.splice(slotIndex, 1);
        scheduleWorkspaceSave();
        render();
    }
    // Builds the sliding "Options" face swapped in over a game card's normal content on
    // right-click (see the .item-face/.item-options CSS and the oncontextmenu handler in the
    // main render loop). Two sections, Front and Back, each a list of column-picker dropdowns
    // (one per currently stacked column on that side) plus an "add column" button to stack
    // another. A column with at least one [bracket] entry anywhere in the deck gets an indented
    // "[Cloze]" option under its plain name (see colHasAnyCloze) — picking it turns cloze mode
    // on for that slot, which restricts the whole game to rows with brackets in that column and
    // shows the blanked sentence on Front / just the bracketed word on Back (see
    // resolveGameFace). No close button — the panel closes by clicking anywhere outside the card
    // (see the document-level pointerdown listener
    // near setupDraggingAndClicking) or by right-clicking again.
    function renderGameOptionsHTML(it) {
        const headers = it.gameHeaders || [];
        const sampleRow = it.cards && it.cards[0];
        const colCount = headers.length || (sampleRow && sampleRow.cells ? sampleRow.cells.length : 0);
        if (!colCount) {
            return `<div class="game-options-head">Options</div>
                <div class="game-options-empty">Connect a source to configure front/back columns.</div>`;
        }
        const cfg = it.gameConfig || {};
        const frontCols = (cfg.frontCols && cfg.frontCols.length ? cfg.frontCols : [{ col: 0, mode: 'plain' }]).map(normalizeGameSlot);
        const backCols = (cfg.backCols && cfg.backCols.length ? cfg.backCols : [{ col: colCount > 1 ? 1 : 0, mode: 'plain' }]).map(normalizeGameSlot);
        // Every column gets its own plain (top-level) option; a column with at least one
        // [bracket] entry anywhere in the deck (see colHasAnyCloze) ALSO gets an <optgroup>
        // right after it holding "Blank" and "[...]". Real nested <option>s indent natively in
        // every browser's dropdown popup — no CSS/whitespace hack needed — and critically, the
        // CLOSED select still shows only the selected option's own short text, never the group
        // label, so picking one of these never leaves stray indentation sitting in the collapsed
        // pill.
        const optionsHTML = (slot) => {
            let html = '';
            for (let i = 0; i < colCount; i++) {
                const name = escapeHtml(headers[i] || `Column ${i + 1}`);
                html += `<option value="${i}"${i === slot.col && slot.mode === 'plain' ? ' selected' : ''}>${name}</option>`;
                if (colHasAnyCloze(it, i)) {
                    html += `<optgroup label="${name} — cloze">`;
                    html += `<option value="${i}:blank"${i === slot.col && slot.mode === 'blank' ? ' selected' : ''}>Blank</option>`;
                    html += `<option value="${i}:extract"${i === slot.col && slot.mode === 'extract' ? ' selected' : ''}>[...]</option>`;
                    html += `</optgroup>`;
                }
            }
            return html;
        };
        const sideHTML = (label, side, slots) => {
            const slotsHTML = slots.map((slot, slotIndex) => {
                const cellHtml = (sampleRow && sampleRow.cells || [])[slot.col] || '';
                const type = sampleRow ? cellContentType(cellHtml) : 'text';
                const glyph = type === 'image' ? '🖼' : type === 'audio' ? '🔊' : (slot.mode !== 'plain' ? '[…]' : 'Aa');
                return `<div class="game-options-slot" onmousedown="event.stopPropagation()">
                    <select class="game-options-select" onchange="setGameColumnSlot(${it.id}, '${side}', ${slotIndex}, this.value)">${optionsHTML(slot)}</select>
                    <span class="game-options-col-glyph" title="${type}">${glyph}</span>
                    ${slots.length > 1 ? `<button type="button" class="game-options-remove-slot" onclick="removeGameColumnSlot(${it.id}, '${side}', ${slotIndex})" title="Remove">×</button>` : ''}
                </div>`;
            }).join('');
            return `<div class="game-options-side">
                <div class="game-options-side-label">${label}</div>
                ${slotsHTML}
                <button type="button" class="game-options-add-slot" onmousedown="event.stopPropagation()" onclick="addGameColumnSlot(${it.id}, '${side}')">+ Add column</button>
            </div>`;
        };
        return `<div class="game-options-head">Options</div>
            <div class="game-options-body">
                ${sideHTML('Front', 'front', frontCols)}
                ${sideHTML('Back', 'back', backCols)}
            </div>`;
    }
    // No close button on the options panel itself — same "outside click closes it" convention
    // already used by showInlineCanvasDeleteMenu's own document-level pointerdown listener.
    document.addEventListener('pointerdown', (e) => {
        document.querySelectorAll('.item.options-open').forEach(el => {
            if (!el.contains(e.target)) closeGameOptionsPanel(Number(el.id.replace('item-', '')));
        });
    });

    // ---------- Flashcard app ----------
    // Cards live directly on the item (it.cards = [{front, back}, ...]).
    // This is a placeholder data source ready to be swapped out by the new linking feature.
    function defaultFlashcardDeck() {
        return [
            { front: 'Front of card 1', back: 'Back of card 1' },
            { front: 'Front of card 2', back: 'Back of card 2' },
            { front: 'Front of card 3', back: 'Back of card 3' }
        ];
    }
    function shuffleArr(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    // Cloze-toggled columns (see renderGameOptionsHTML's Cloze toggle / gameClozeFilterCols)
    // restrict the deck the same way for flashcards as for Typeright — a filtered view of
    // it.cards, not it.cards directly.
    function fcPlayableCards(it) {
        return gamePlayableCards(it);
    }
    function ensureFcOrder(it, playable) {
        const rows = playable.map((_, i) => i);
        const valid = it.fcOrder && it.fcOrder.length === rows.length && it.fcOrder.every(i => rows.includes(i));
        if (!valid) {
            it.fcOrder = it.fcMode === 'shuffle' ? shuffleArr(rows) : rows.slice();
            it.fcIndex = 0;
        }
        if (it.fcIndex >= it.fcOrder.length) it.fcIndex = 0;
    }
    function fcCurrentRow(it, playable) {
        ensureFcOrder(it, playable);
        if (!it.fcOrder.length) return null;
        return playable[it.fcOrder[it.fcIndex]];
    }
    function fcCardName(it) {
        return 'Flashcards';
    }
    function renderFlashcardHTML(it) {
        const title = fcCardName(it);
        const options = renderGameOptionsHTML(it);
        if (!it.cards || !it.cards.length) {
            return `<div class="item-face">
                <div class="fc-top" onmousedown="event.stopPropagation()">
                    <div class="fc-title">${title}</div>
                </div>
                <div class="fc-empty">No cards yet.</div>
            </div>
            <div class="item-options">${options}</div>`;
        }
        const playable = fcPlayableCards(it);
        if (!playable.length) {
            return `<div class="item-face">
                <div class="fc-top" onmousedown="event.stopPropagation()">
                    <div class="fc-title">${title}</div>
                </div>
                <div class="fc-empty">No playable entries — check the Cloze columns in Options.</div>
            </div>
            <div class="item-options">${options}</div>`;
        }
        const row = fcCurrentRow(it, playable);
        const front = row ? renderGameFaceBlocksHTML(resolveGameFace(it, row, 'front')) : '(no data rows)';
        const back = row ? renderGameFaceBlocksHTML(resolveGameFace(it, row, 'back')) : '';
        const total = it.fcOrder.length;
        const pos = total ? it.fcIndex + 1 : 0;
        return `<div class="item-face">
                <div class="fc-top" onmousedown="event.stopPropagation()">
                    <div class="fc-title">${title}</div>
                    <div class="fc-top-right">
                        <button class="fc-mode-btn" onclick="fcToggleMode(${it.id})" title="Toggle shuffle / ordered">${it.fcMode === 'shuffle' ? 'Shuffle ON' : 'Shuffle OFF'}</button>
                        <div class="fc-progress">${pos}/${total}</div>
                    </div>
                </div>
                <div class="fc-card ${it.fcFlipped ? 'flipped' : ''}" onmousedown="event.stopPropagation()" onclick="fcFlip(${it.id})">
                    <div class="fc-face fc-front">${front || '(empty)'}</div>
                    <div class="fc-face fc-back">${back || '(empty)'}</div>
                </div>
                <div class="fc-actions" onmousedown="event.stopPropagation()">
                    <button class="fc-flip-btn" style="display:${it.fcFlipped ? 'none' : 'flex'}" onclick="fcFlip(${it.id})">Flip</button>
                    <div class="fc-rate-row" style="display:${it.fcFlipped ? 'flex' : 'none'}">
                        <button class="fc-rate-btn fc-rate-noclue" onclick="fcRate(${it.id}, 'noclue')">Not a clue</button>
                        <button class="fc-rate-btn fc-rate-wrong" onclick="fcRate(${it.id}, 'wrong')">Got it wrong</button>
                        <button class="fc-rate-btn fc-rate-hard" onclick="fcRate(${it.id}, 'hard')">Had to think</button>
                        <button class="fc-rate-btn fc-rate-easy" onclick="fcRate(${it.id}, 'easy')">Easy</button>
                    </div>
                </div>
                <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>
            </div>
            <div class="item-options">${options}</div>`;
    }
    function fcFlip(id) {
        const it = findItemById(id); if (!it) return;
        it.fcFlipped = !it.fcFlipped;
        const el = document.getElementById('item-' + id);
        const card = el && el.querySelector('.fc-card');
        if (card) card.classList.toggle('flipped', it.fcFlipped);
        const flipBtn = el && el.querySelector('.fc-flip-btn');
        const rateRow = el && el.querySelector('.fc-rate-row');
        if (flipBtn) flipBtn.style.display = it.fcFlipped ? 'none' : 'flex';
        if (rateRow) rateRow.style.display = it.fcFlipped ? 'flex' : 'none';
        // Only on the reveal flip, not the flip back — otherwise toggling back and forth would
        // farm points for free.
        if (it.fcFlipped) { awardUserPoints('flip_flashcard', 1); bumpAchievementStat('hundred_flips'); }
        // Reuses the same generic item-sync pipeline every other field change already goes
        // through (see scheduleWorkspaceSave/queueSyncDiff) — no special-casing needed since
        // renderFlashcardHTML already reads it.fcFlipped correctly on a fresh render, which is
        // exactly what a receiving collaborator's applyRemoteSyncBroadcast triggers.
        scheduleWorkspaceSave();
    }
    function fcRate(id, rating) {
        const it = findItemById(id); if (!it) return;
        it.fcStats = it.fcStats || {};
        it.fcStats[rating] = (it.fcStats[rating] || 0) + 1;
        it.fcSeenCount = (it.fcSeenCount || 0) + 1;

        // ---- SM-2: the flashcard is just the visual interface — it computes the new memory
        // state locally (for instant feedback) but the source table is the system of record.
        // The result is queued as `pendingSrsUpdate` and pushed upstream through the normal
        // streaming connection pipeline on the next render (see CardStreamIO.flashcard).
        const playable = fcPlayableCards(it);
        const card = fcCurrentRow(it, playable);
        if (card) {
            const quality = SM2_QUALITY[rating];
            const nextSrs = calculateSM2(Object.assign({}, card.srs || defaultSrsState()), quality);
            card.srs = nextSrs;
            // originTableId (carried on every card since extractCardsFromSource set it) makes
            // sure this update finds its way back to the row's real home table even when a
            // filter card or a merged source sits between this flashcard and it.
            if (card.rowIndex != null) it.pendingSrsUpdate = { rowIndex: card.rowIndex, srs: nextSrs, originTableId: card.originTableId };
        }

        ensureFcOrder(it, playable);
        if (it.fcOrder.length) it.fcIndex = (it.fcIndex + 1) % it.fcOrder.length;
        it.fcFlipped = false;
        render();
    }
    function fcToggleMode(id) {
        const it = findItemById(id); if (!it) return;
        const playable = fcPlayableCards(it);
        ensureFcOrder(it, playable);
        const rows = playable.map((_, i) => i);
        if (it.fcMode === 'shuffle') {
            const curOrig = it.fcOrder[it.fcIndex];
            const startPos = rows.indexOf(curOrig);
            it.fcOrder = rows.slice(startPos).concat(rows.slice(0, startPos));
            it.fcIndex = 0;
            it.fcMode = 'ordered';
        } else {
            const curOrig = it.fcOrder[it.fcIndex];
            const rest = shuffleArr(rows.filter(r => r !== curOrig));
            it.fcOrder = [curOrig, ...rest];
            it.fcIndex = 0;
            it.fcMode = 'shuffle';
        }
        it.fcFlipped = false;
        render();
    }

    // ---------- Typeright app ----------
    // Classic edit-distance between two strings — used by gradeTypedAnswer below to recognize a
    // near-miss typo rather than grading it as flatly wrong.
    function levenshteinDistance(a, b) {
        const m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[m][n];
    }
    // Unicode NFD + stripping the Combining Diacritical Marks block (U+0300-U+036F) — "como" and
    // "cómo" normalize to the same string, so a missing/wrong accent grades as "nearly" rather
    // than fully wrong. Built from an explicit \uXXXX escape range (never a raw high-codepoint
    // character in the source), same convention isLatinScriptText uses elsewhere in this file.
    function stripDiacritics(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    // Three-tier grade for a typed answer against the correct one — drives both the input's
    // color feedback and which SM-2 bucket the attempt counts toward (see trCheck):
    // 'correct' (exact, case-insensitive), 'nearly' (right except accents, or a small typo),
    // 'wrong' otherwise.
    function gradeTypedAnswer(typed, answer) {
        const t = typed.trim().toLowerCase();
        const a = answer.trim().toLowerCase();
        if (!t) return 'wrong';
        if (t === a) return 'correct';
        if (stripDiacritics(t) === stripDiacritics(a)) return 'nearly'; // right, just missing/wrong accents
        const maxLen = Math.max(t.length, a.length);
        const typoThreshold = Math.max(1, Math.floor(maxLen * 0.25)); // scales gently with answer length
        if (levenshteinDistance(t, a) <= typoThreshold) return 'nearly';
        return 'wrong';
    }
    // See one side (front columns), type the other (back columns) — see resolveGameFace/
    // gameConfig above. Only rows whose resolved BACK side is entirely text are playable (you
    // can't type an answer that's an image or audio clip), so the deck here is always a filtered
    // view of it.cards, not it.cards directly.
    function trPlayableCards(it) {
        return gamePlayableCards(it).filter(row => resolveGameFace(it, row, 'back').every(b => b.type === 'text'));
    }
    function ensureTrOrder(it, playable) {
        const rows = playable.map((_, i) => i);
        const valid = it.trOrder && it.trOrder.length === rows.length && it.trOrder.every(i => rows.includes(i));
        if (!valid) {
            it.trOrder = it.trMode === 'shuffle' ? shuffleArr(rows) : rows.slice();
            it.trIndex = 0;
        }
        if (it.trIndex >= it.trOrder.length) it.trIndex = 0;
    }
    function trCurrentCard(it, playable) {
        ensureTrOrder(it, playable);
        if (!it.trOrder.length) return null;
        return playable[it.trOrder[it.trIndex]];
    }
    function renderTypeRightHTML(it) {
        const options = renderGameOptionsHTML(it);
        if (!it.cards || !it.cards.length) {
            return `<div class="item-face">
                    <div class="tr-top" onmousedown="event.stopPropagation()"><div class="tr-title">Typeright</div></div>
                    <div class="tr-empty">Connect a source to play.</div>
                </div>
                <div class="item-options">${options}</div>`;
        }
        const playable = trPlayableCards(it);
        if (!playable.length) {
            return `<div class="item-face">
                    <div class="tr-top" onmousedown="event.stopPropagation()"><div class="tr-title">Typeright</div></div>
                    <div class="tr-empty">No playable entries — the answer side must be text.</div>
                </div>
                <div class="item-options">${options}</div>`;
        }
        const card = trCurrentCard(it, playable);
        const promptHTML = card ? renderGameFaceBlocksHTML(resolveGameFace(it, card, 'front')) : '';
        const total = it.trOrder.length;
        const pos = total ? it.trIndex + 1 : 0;
        const checked = !!it.trChecked;
        const correctAnswer = card ? resolveGameFace(it, card, 'back').map(b => b.text).join(' ') : '';
        // Grade colors the INPUT itself (green/orange/red) — no separate feedback pill below it.
        const grade = checked ? it.trLastGrade : null;
        const inputGradeClass = grade ? ` tr-input-${grade}` : '';
        return `<div class="item-face" onmouseenter="trFocusInput(${it.id})">
                <div class="tr-top" onmousedown="event.stopPropagation()">
                    <div class="tr-title">Typeright</div>
                    <div class="fc-top-right">
                        <button class="fc-mode-btn" onclick="trToggleMode(${it.id})" title="Toggle shuffle / ordered">${it.trMode === 'shuffle' ? 'Shuffle ON' : 'Shuffle OFF'}</button>
                        <div class="fc-progress">${pos}/${total}</div>
                    </div>
                </div>
                <div class="tr-prompt" onmousedown="event.stopPropagation()">${promptHTML || '(empty)'}</div>
                <div class="tr-answer-row" onmousedown="event.stopPropagation()">
                    <input type="text" class="tr-input${inputGradeClass}" placeholder="Type the answer…" value="${escapeHtml(it.trInput || '')}" oninput="trUpdateInput(${it.id}, this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault(); ${checked ? `trNext(${it.id})` : `trCheck(${it.id})`};}" onfocus="broadcastEditingState(true, '#item-${it.id} .tr-input')" onblur="broadcastEditingState(false)" ${checked ? 'disabled' : ''}>
                    ${checked ? `<button class="tr-next-btn" onclick="trNext(${it.id})">Next</button>` : `<button class="tr-check-btn" onclick="trCheck(${it.id})">Check</button>`}
                </div>
                ${checked && grade !== 'correct' ? `<div class="tr-answer-reveal">Answer: ${escapeHtml(correctAnswer)}</div>` : ''}
                <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>
            </div>
            <div class="item-options">${options}</div>`;
    }
    function trUpdateInput(id, value) {
        const it = findItemById(id); if (!it) return;
        it.trInput = value;
        // Live per-keystroke sync — same reasoning/pattern as the note/title body oninput fixes
        // and fcFlip: renderTypeRightHTML already reads it.trInput correctly on a fresh render, so
        // this is all that's needed for a collaborator to see typing happen in real time. This is
        // the general pattern any NEW card kind should follow for live collaboration too — call
        // scheduleWorkspaceSave() on every meaningful state change (including live text input, not
        // just on submit/commit) and make sure the kind's own render function reads that state
        // back out — no per-kind sync code to write, the existing generic item-diff pipeline
        // (queueSyncDiff/applyRemoteSyncBroadcast) picks it up automatically.
        scheduleWorkspaceSave();
    }
    // Auto-focuses the answer input the moment the card is hovered — "always ready to type"
    // rather than needing an extra click first. Fires again after trNext rebuilds the card for
    // the next question (see below); render() replaces the whole element, so a plain mouseenter
    // that already fired once when the cursor first arrived won't fire again on its own just
    // because the DOM node underneath it was swapped out. No-ops while the input is disabled
    // (mid-feedback, right after checking) or already focused.
    function trFocusInput(id) {
        const el = document.getElementById('item-' + id);
        const input = el && el.querySelector('.tr-input');
        if (input && !input.disabled && document.activeElement !== input) input.focus();
    }
    function trCheck(id) {
        const it = findItemById(id); if (!it || it.trChecked) return;
        const playable = trPlayableCards(it);
        const card = trCurrentCard(it, playable);
        if (!card) return;
        const correctAnswer = resolveGameFace(it, card, 'back').map(b => b.text).join(' ');
        // 'correct' | 'nearly' (typo, or right minus accents) | 'wrong' — colors the input
        // itself (see renderTypeRightHTML), no separate feedback pill.
        const grade = gradeTypedAnswer(it.trInput || '', correctAnswer);
        it.trStats = it.trStats || {};
        // Collapses the 3-tier grade onto SM-2's rating buckets — "nearly" counts as "hard"
        // (recalled it, imperfectly) rather than fully right or fully wrong.
        const rating = grade === 'correct' ? 'easy' : grade === 'nearly' ? 'hard' : 'wrong';
        it.trStats[rating] = (it.trStats[rating] || 0) + 1;
        it.trSeenCount = (it.trSeenCount || 0) + 1;
        it.trLastGrade = grade;
        it.trChecked = true;

        // ---- Same SM-2 pipeline as flashcard's fcRate.
        const quality = SM2_QUALITY[rating];
        const nextSrs = calculateSM2(Object.assign({}, card.srs || defaultSrsState()), quality);
        card.srs = nextSrs;
        if (card.rowIndex != null) it.pendingSrsUpdate = { rowIndex: card.rowIndex, srs: nextSrs, originTableId: card.originTableId };

        awardUserPoints('typeright_check', 1);
        render();
    }
    function trNext(id) {
        const it = findItemById(id); if (!it) return;
        const playable = trPlayableCards(it);
        ensureTrOrder(it, playable);
        if (it.trOrder.length) it.trIndex = (it.trIndex + 1) % it.trOrder.length;
        it.trInput = '';
        it.trChecked = false;
        it.trLastGrade = null;
        render();
        // Both ways trNext can fire (clicking "Next", or pressing Enter while hovering — see the
        // hover-scoped card shortcuts) only happen with the cursor already on this card, so
        // restoring focus to the freshly-rendered next question's input is always the right call
        // here, not just a hover-triggered nicety.
        trFocusInput(id);
    }
    function trToggleMode(id) {
        const it = findItemById(id); if (!it) return;
        const playable = trPlayableCards(it);
        ensureTrOrder(it, playable);
        const rows = playable.map((_, i) => i);
        if (it.trMode === 'shuffle') {
            const curOrig = it.trOrder[it.trIndex];
            const startPos = rows.indexOf(curOrig);
            it.trOrder = rows.slice(startPos).concat(rows.slice(0, startPos));
            it.trIndex = 0;
            it.trMode = 'ordered';
        } else {
            const curOrig = it.trOrder[it.trIndex];
            const rest = shuffleArr(rows.filter(r => r !== curOrig));
            it.trOrder = [curOrig, ...rest];
            it.trIndex = 0;
            it.trMode = 'shuffle';
        }
        it.trInput = '';
        it.trChecked = false;
        render();
    }

    // ---------- Stopwatch card ----------
    function swFormatTime(ms) {
        const totalSec = Math.floor(Math.max(0, ms) / 1000);
        const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }
    function swCurrentElapsedMs(it) {
        if (it.swRunning && !it.swPaused && it.swLastResumeAt) return it.swElapsedMs + (Date.now() - it.swLastResumeAt);
        return it.swElapsedMs;
    }
    function swToggleRun(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        if (!it.swRunning) {
            it.swRunning = true; it.swPaused = false; it.swLastResumeAt = Date.now();
            it.swSessionActive = true;
            it.swSessionId = 'sess_' + (appState.idCounter++);
            it.swSessionStartedAt = Date.now();
            it.swSessionLive = {}; it.swSessionBaseline = {};
        } else {
            if (!it.swPaused && it.swLastResumeAt) it.swElapsedMs += Date.now() - it.swLastResumeAt;
            const finishedDurationMs = it.swElapsedMs;
            it.swRunning = false; it.swPaused = false; it.swLastResumeAt = null;
            if (it.swSessionActive) {
                const payloads = Object.keys(it.swSessionLive).map(originId => {
                    const live = it.swSessionLive[originId] || {};
                    const base = it.swSessionBaseline[originId] || {};
                    return { originId, delta: { seen: (live.seen || 0) - (base.seen || 0), totalCards: live.totalCards, ratings: diffRatings(live.ratings, base.ratings) } };
                });
                const session = { sessionId: it.swSessionId, startedAt: it.swSessionStartedAt, endedAt: Date.now(), durationMs: finishedDurationMs, payloads };
                // Stopwatches keep only the 3 most-recent sessions behind the scenes (most
                // recent first); a connected shelf card archives them permanently as they
                // stream through, so it can hold unlimited history even though the stopwatch
                // itself only ever remembers the last 3.
                it.swSessions = it.swSessions || [];
                it.swSessions.unshift(session);
                if (it.swSessions.length > 3) it.swSessions.length = 3;
            }
            it.swSessionActive = false;
            it.swElapsedMs = 0; // Stop always resets the timer, ready for the next run.
        }
        render();
    }
    function swTogglePause(id) {
        const it = findItemById(id); if (!it || !it.swRunning) return;
        saveSnapshot();
        if (it.swPaused) { it.swPaused = false; it.swLastResumeAt = Date.now(); }
        else { if (it.swLastResumeAt) it.swElapsedMs += Date.now() - it.swLastResumeAt; it.swPaused = true; it.swLastResumeAt = null; }
        render();
    }
    function renderStopwatchHTML(it) {
        return `<div class="sw-row" onmousedown="event.stopPropagation()">
            <button class="sw-btn sw-startstop" onclick="swToggleRun(${it.id})" title="${it.swRunning ? 'Stop' : 'Start'}">${it.swRunning ? '⏹' : '▶'}</button>
            <button class="sw-btn sw-pauseplay" onclick="swTogglePause(${it.id})" ${it.swRunning ? '' : 'disabled'} title="${it.swPaused ? 'Resume' : 'Pause'}">${it.swPaused ? '▶' : '⏸'}</button>
            <div class="sw-time">${swFormatTime(swCurrentElapsedMs(it))}</div>
        </div>`;
    }

    function shelfSelectSession(id, sessionId) {
        const it = findItemById(id); if (!it) return;
        it.shelfSelectedId = sessionId;
        render();
    }
    // "Stack" in the UI (kind stays 'shelf' internally — see its add-menu entry). Dual-purpose:
    // saved stopwatch sessions (below, unchanged) plus a summary of every source card currently
    // feeding it (see CardStreamIO.shelf's 'sourceRows' aggregation) — connect a source here, then
    // connect this Stack into a flashcard (or any other card that accepts 'content') to play every
    // connected source's rows at once.
    function renderShelfHTML(it) {
        const sessions = it.shelfSessions || [];
        const sourceEntries = Object.keys(it.stackSourceRows || {}).map(sid => ({
            sourceItemId: Number(sid),
            title: folderTitleForConnectedSource(Number(sid)),
            count: (it.stackSourceRows[sid] || []).length,
        }));
        // Own name lives directly on the item (it.shelfName) rather than a folders[] entry — a
        // Stack has no canvas of its own, it just aggregates streams from whatever's connected
        // (see CardStreamIO.shelf). Unrenamed stacks fall back to the same empty-content +
        // data-placeholder convention as an unrenamed folder/source title (see
        // startRenameFolderCardTitle) rather than a hardcoded string, so the placeholder and the
        // eventual real name render through the exact same markup.
        const nameHTML = it.shelfName
            ? `<div class="shelf-header" onclick="event.stopPropagation(); startRenameShelfName(this, ${it.id})">${escapeHtml(it.shelfName)}</div>`
            : `<div class="shelf-header crumb-placeholder" data-placeholder="Stack" onclick="event.stopPropagation(); startRenameShelfName(this, ${it.id})"></div>`;
        // Clicking anywhere in the pill (not just its label) opens that source's own page — the
        // same static-source view its real card opens into (see handleShelfSourceRowClick/
        // openFolder), not just a jump to its card on this canvas. Double-clicking the label
        // renames it in place instead (see startRenameShelfSourceRow); handleShelfSourceRowClick
        // debounces a single click against a pending double-click so a rename's first click
        // doesn't also navigate away first.
        const sourcesHTML = sourceEntries.length
            ? `<div class="shelf-sources">${sourceEntries.map(s => `
                <div class="shelf-source-row" onclick="event.stopPropagation(); handleShelfSourceRowClick(this, ${s.sourceItemId})">
                    <span class="shelf-row-label" data-source-id="${s.sourceItemId}" ondblclick="event.stopPropagation(); startRenameShelfSourceRow(this, ${s.sourceItemId})" title="Double-click to rename">${escapeHtml(s.title)}</span>
                    <span class="shelf-row-meta">${s.count} ${s.count === 1 ? 'entry' : 'entries'}</span>
                </div>`).join('')}</div>`
            : '';
        // Lets you search across whichever connected sources / saved sessions are currently
        // listed — see filterShelfRows, which just show/hides rows on the DOM already built here
        // rather than re-rendering, so it never yanks focus out of the input mid-keystroke.
        // mousedown does BOTH stopPropagation (so clicking/dragging from inside the box never
        // starts a card-drag) AND preventDefault (so it never grabs focus purely from a mousedown
        // that turns into a card drag started elsewhere but happens to end with the pointer over
        // this box — see suppressClick in the card drag handler, which swallows that trailing
        // click before it ever reaches here) — focus is instead granted explicitly on a genuine
        // click via onclick, which only fires for a real, non-drag-suppressed click.
        const searchHTML = (sourceEntries.length || sessions.length)
            ? `<input type="text" class="shelf-search" placeholder="Search..." onmousedown="event.stopPropagation(); event.preventDefault();" onclick="event.stopPropagation(); this.focus();" oninput="filterShelfRows(this)" />`
            : '';
        if (!sessions.length) {
            if (sourceEntries.length) return `${nameHTML}${searchHTML}${sourcesHTML}`;
            return `${nameHTML}<div class="shelf-empty">No sessions saved yet, and nothing connected. Connect a source here to combine it with others for flashcards, or link a stopwatch (that's linked to a game) here, then press Start then Stop on it, to save a session.</div>`;
        }
        const rows = sessions.map(s => {
            const selected = s.sessionId === it.shelfSelectedId;
            const totalSeen = s.payloads.reduce((sum, p) => sum + ((p.delta && p.delta.seen) || 0), 0);
            return `<div class="shelf-row ${selected ? 'selected' : ''}" onmousedown="event.stopPropagation()" onclick="shelfSelectSession(${it.id}, '${s.sessionId}')">
                <span class="shelf-row-label">${s.label}</span>
                <span class="shelf-row-meta">${totalSeen} seen</span>
            </div>`;
        }).join('');
        return `${nameHTML}${searchHTML}${sourcesHTML}<div class="shelf-rows">${rows}</div>`;
    }
    // Show/hide rows in-place by matching their label text against the search box's current
    // value — deliberately not a render() (would rebuild the whole card and drop the input's
    // focus/caret mid-keystroke). Matches across both connected-source rows and saved-session
    // rows, whichever are present.
    function filterShelfRows(inputEl) {
        const card = inputEl.closest('.item.shelf');
        if (!card) return;
        const q = inputEl.value.trim().toLowerCase();
        card.querySelectorAll('.shelf-source-row, .shelf-row').forEach(rowEl => {
            const label = rowEl.querySelector('.shelf-row-label');
            const text = label ? label.textContent.toLowerCase() : '';
            rowEl.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
    }
    // Inline-rename a Stack's own name — same contentEditable click-to-edit flow as
    // startRenameFolderCardTitle, just writing to it.shelfName directly (a Stack has no
    // folders[] entry of its own to write to).
    function startRenameShelfName(nameEl, itemId) {
        const it = findItemById(itemId);
        if (!it || nameEl.contentEditable === 'true') return;
        saveSnapshot();
        const fullTitle = it.shelfName || '';
        const isDefaultTitle = !fullTitle;
        if (isDefaultTitle) {
            nameEl.textContent = '';
            nameEl.setAttribute('data-placeholder', 'Stack');
            nameEl.classList.add('crumb-placeholder');
        } else {
            nameEl.textContent = fullTitle;
        }
        nameEl.contentEditable = true;
        broadcastEditingState(true, `#item-${it.id} .shelf-header`);
        nameEl.focus();
        const placeCaretAtEnd = () => {
            const range = document.createRange();
            range.selectNodeContents(nameEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        placeCaretAtEnd();
        setTimeout(placeCaretAtEnd, 0);
        nameEl.onblur = () => {
            nameEl.contentEditable = false;
            broadcastEditingState(false);
            nameEl.classList.remove('crumb-placeholder');
            const newTitle = nameEl.textContent.trim();
            if (newTitle) it.shelfName = newTitle;
            render();
        };
        nameEl.oninput = () => {
            const liveTitle = nameEl.textContent;
            if (liveTitle.trim()) { it.shelfName = liveTitle; scheduleWorkspaceSave(); }
        };
        nameEl.onkeydown = (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
            if (ke.key === 'Escape') { ke.preventDefault(); nameEl.textContent = isDefaultTitle ? '' : fullTitle; nameEl.blur(); }
        };
    }
    // Distinguishes a real single click (open the source's own page — see openFolder) from the
    // first half of a double-click on its label (rename — see startRenameShelfSourceRow's
    // ondblclick): a genuine click opens the source after a short delay, but if a second click
    // lands within that window this just cancels the pending navigation and lets ondblclick take
    // over, so renaming a row doesn't also navigate away first.
    let shelfRowClickTimer = null;
    function handleShelfSourceRowClick(rowEl, sourceItemId) {
        if (shelfRowClickTimer) { clearTimeout(shelfRowClickTimer); shelfRowClickTimer = null; return; }
        shelfRowClickTimer = setTimeout(() => {
            shelfRowClickTimer = null;
            const folderId = folderIdForConnectedSource(sourceItemId);
            if (folderId) openFolder(folderId);
        }, 220);
    }
    // Inline-rename a connected source's name from inside the Stack that's aggregating it —
    // writes straight back to that source's own folders[folderId].title (via
    // folderIdForConnectedSource), the same real property its own card and breadcrumb read/write,
    // so the rename is visible everywhere that source appears, not just here.
    function startRenameShelfSourceRow(labelEl, sourceItemId) {
        if (labelEl.contentEditable === 'true') return;
        const folderId = folderIdForConnectedSource(sourceItemId);
        if (!appState.folders[folderId]) return;
        saveSnapshot();
        const fullTitle = appState.folders[folderId].title;
        labelEl.textContent = fullTitle;
        labelEl.contentEditable = true;
        broadcastEditingState(true, `.shelf-row-label[data-source-id="${sourceItemId}"]`);
        labelEl.focus();
        const placeCaretAtEnd = () => {
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        placeCaretAtEnd();
        setTimeout(placeCaretAtEnd, 0);
        labelEl.onblur = () => {
            labelEl.contentEditable = false;
            broadcastEditingState(false);
            const newTitle = labelEl.textContent.trim();
            if (newTitle) { appState.folders[folderId].title = newTitle; syncCanvasCollabTitle(folderId, newTitle); }
            render();
        };
        labelEl.oninput = () => {
            const liveTitle = labelEl.textContent;
            if (liveTitle.trim()) { appState.folders[folderId].title = liveTitle; scheduleWorkspaceSave(); }
        };
        labelEl.onkeydown = (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); labelEl.blur(); }
            if (ke.key === 'Escape') { ke.preventDefault(); labelEl.textContent = fullTitle; labelEl.blur(); }
        };
    }

    // Filter card: connect a source (or another filter) into it, then it into a flashcard (or
    // another source/filter) — see CardStreamIO.filter. Its only real UI is "which tags currently
    // flowing through it should pass" plus an AND/OR switch for combining more than one; the
    // available tags list is entirely derived from incomingRows (see collectAvailableFilterTags)
    // since a filter has no source of its own, only whatever's connected to it right now.
    function renderFilterHTML(it) {
        const rows = it.incomingRows || [];
        if (!rows.length) {
            return `<div class="filter-header">Filter</div><div class="filter-empty">Connect a source (or another filter) to see its tags here.</div>`;
        }
        const availableTags = collectAvailableFilterTags(rows);
        const selected = new Set(it.filterTagIds || []);
        const mode = it.filterMode === 'and' ? 'and' : 'or';
        const tagsHTML = availableTags.length
            ? availableTags.map(t => `<span class="filter-tag-chip${selected.has(t.id) ? ' selected' : ''}" style="--chip-color:${t.color}" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); toggleFilterTag(${it.id}, '${t.id}')">${escapeHtml(t.name)}</span>`).join('')
            : `<span class="filter-empty-tags">No tags on the connected rows yet.</span>`;
        const outCount = applyFilterToRows(it, rows).length;
        return `<div class="filter-header">
                <span>Filter</span>
                <div class="filter-mode-toggle" onmousedown="event.stopPropagation()">
                    <button class="filter-mode-btn${mode === 'or' ? ' active' : ''}" onclick="event.stopPropagation(); setFilterMode(${it.id}, 'or')">OR</button>
                    <button class="filter-mode-btn${mode === 'and' ? ' active' : ''}" onclick="event.stopPropagation(); setFilterMode(${it.id}, 'and')">AND</button>
                </div>
            </div>
            <div class="filter-tags">${tagsHTML}</div>
            <div class="filter-count">${rows.length} in → ${outCount} out</div>`;
    }
    function setFilterMode(id, mode) {
        const it = findItemById(id); if (!it) return;
        it.filterMode = mode;
        scheduleWorkspaceSave();
        render();
    }
    function toggleFilterTag(id, tagId) {
        const it = findItemById(id); if (!it) return;
        const set = new Set(it.filterTagIds || []);
        if (set.has(tagId)) set.delete(tagId); else set.add(tagId);
        it.filterTagIds = Array.from(set);
        scheduleWorkspaceSave();
        render();
    }

    // ---------- Search & AI Gen ----------
    const searchInput = document.getElementById('search-input'), searchResults = document.getElementById('search-results'),
        searchDotbotAnswer = document.getElementById('search-dotbot-answer'),
        searchTranslation = document.getElementById('search-translation'),
        searchDictionary = document.getElementById('search-dictionary'), searchExamples = document.getElementById('search-examples'),
        searchImageResult = document.getElementById('search-image-result'),
        searchSuggestions = document.getElementById('search-suggestions'), searchRecommended = document.getElementById('search-recommended'),
        searchDropdown = document.getElementById('search-dropdown'), searchSpinner = document.getElementById('search-spinner'),
        searchInputWrap = document.getElementById('search-input-wrap'), searchCardPill = document.getElementById('search-card-pill'),
        searchCardPillLabel = document.getElementById('search-card-pill-label'), searchSpaceHint = document.getElementById('search-space-hint');

    // ---------- Notifications ----------
    // Generic engine — notifications queue up and are shown one at a time IN the search bar
    // itself (see #search-notification, which takes #search-input's place while one's showing),
    // optionally growing the bar taller (e.g. to fit an image), with an optional action button
    // triggerable by click OR Enter. Non-sticky ones auto-dismiss after `durationMs`; sticky ones
    // need an explicit dismiss (Escape, or the action button itself). Deferred while the user is
    // actively typing in the search box — retried on blur — so a notification never interrupts
    // something they're mid-typing.
    //
    // No notification has a visible dismiss button — Escape always dismisses whatever's showing
    // (see the notification keydown handler below), so even a sticky one always has a way out
    // without needing its own dedicated button for it.
    //
    // pushNotification({
    //   type,             // string id for the notification kind (e.g. 'chat', 'friend_request') —
    //                     // informational/for any future per-type styling, not used by the engine itself
    //   message,          // main text
    //   imageUrl,         // optional
    //   actionLabel,      // optional — shows the primary button (its rendered text gets an enter-
    //                     // arrow glyph appended, see showNotification); click or Enter activates it
    //   onAction,         // called when the primary button is activated
    //   sticky,           // default false — no auto-dismiss timer at all; needs actionLabel or
    //                     // Escape to ever go away
    //   durationMs,       // default 5000 (5 seconds) — auto-dismiss delay when not sticky
    //   grows,            // default false — let the bar grow taller than its normal single-line
    //                     // height for this one (see .notification-grows), instead of staying compact
    // })
    //
    // The only notification type from the original list with nothing behind it now is platform
    // tips, dropped entirely (no content for them) — achievements now have a real trigger too (see
    // bumpAchievementStat). Everything else — including the 3am day-change, which isn't a "reset"
    // of anything, just a clock boundary, and the paid-tier ad, which points at a
    // placeholder-content pricing page rather than a real subscription system — is wired to a
    // real trigger (see the pushNotification call sites in refreshCanvasCollabData/
    // refreshFriendsData/subscribeToAllFriendMessages/handleFriendPresenceSync/awardUserPoints/
    // refreshDotbotUsage/checkDueScheduledEvents/the day-change interval/the ad timer/
    // bumpAchievementStat below).
    const NOTIFICATION_DEFAULT_DURATION_MS = 5000;
    // Entrance/exit choreography timing — see the CSS block above #search-notification in
    // globals.css for the actual animations these durations drive (must stay in sync: the fast
    // flash is 2 iterations of a 0.2s keyframe, the slide is a 0.3s transition).
    const NOTIF_FLASH_MS = 400;
    const NOTIF_SLIDE_MS = 300;
    let notificationQueue = [];
    let currentNotification = null;
    let notificationTimer = null;
    // Bumped at the start of every enter/exit sequence — a pending setTimeout from an older
    // sequence checks this before acting, so it can't step on a newer sequence's state (e.g. the
    // user dismisses a notification mid-entrance, or the queue advances to the next one before a
    // stale timeout fires).
    let notificationSeq = 0;
    const notifImageEl = document.getElementById('search-notification-image'),
        notifTextEl = document.getElementById('search-notification-text'),
        notifActionBtn = document.getElementById('search-notification-action');

    // Time from when a notification settles (fully slid in) until its exit sequence STARTS, given
    // its configured `durationMs` — reserves NOTIF_FLASH_MS+NOTIF_SLIDE_MS at the end for the
    // pre-exit flash + slide-away so the notification's TOTAL time on screen still roughly
    // matches durationMs, rather than durationMs being purely the settled dwell time on top of
    // the exit animation. Clamped so a very short durationMs still gets at least as long to settle
    // as its own entrance took.
    function computeNotificationDismissDelay(durationMs) {
        const exitReserve = NOTIF_FLASH_MS + NOTIF_SLIDE_MS;
        return Math.max(durationMs - exitReserve, exitReserve);
    }

    // Minimum idle time between one notification fully closing and the next one opening, so a
    // backlog of queued notifications doesn't read as one continuous flicker. 0 means "no
    // notification has ever closed yet" — the very first one of the session shows with no
    // artificial gap. Set right when a notification finishes closing (see dismissCurrentNotification).
    const NOTIFICATION_QUEUE_GAP_MS = 5000;
    let lastNotificationCloseTime = 0;

    function pushNotification(config) {
        notificationQueue.push(config);
        tryShowNextNotification();
    }
    function tryShowNextNotification() {
        if (currentNotification || !notificationQueue.length) return;
        // Held while the tab isn't actually visible (another tab/app, backgrounded, screen
        // locked) — retried by the visibilitychange listener below the moment it's visible
        // again, so queued notifications come through one at a time from there rather than
        // firing unseen while away.
        if (document.visibilityState !== 'visible') return;
        if (document.activeElement === searchInput) return; // don't interrupt active typing — searchInput's blur listener retries this
        if (lastNotificationCloseTime) {
            const elapsed = Date.now() - lastNotificationCloseTime;
            if (elapsed < NOTIFICATION_QUEUE_GAP_MS) {
                // Re-checks everything above (visibility, focus, remaining gap) once it fires,
                // rather than assuming this is still the right moment — self-correcting if the tab
                // gets backgrounded or the gap gets pushed out again in the meantime.
                setTimeout(tryShowNextNotification, NOTIFICATION_QUEUE_GAP_MS - elapsed);
                return;
            }
        }
        showNotification(notificationQueue.shift());
    }
    // Entrance: (1) the border flashes 2 quick pulses while the bar still looks completely
    // normal, (2) #search-input/#search-space-hint slide up and out while #search-notification
    // slides up into view (both driven by the same .notifying toggle — see globals.css), (3) once
    // settled, a slow continuous pulse plays until the exit sequence begins.
    function showNotification(config) {
        currentNotification = config;
        const seq = ++notificationSeq;
        searchInputWrap.classList.toggle('notification-grows', !!config.grows);

        if (config.imageUrl) notifImageEl.src = config.imageUrl;
        else notifImageEl.removeAttribute('src');
        notifTextEl.textContent = config.message || '';
        // The enter-arrow suffix mirrors #search-space-hint's own "Enter" pill (same size/color —
        // see globals.css) so the button visually reads as "press Enter to do this", not a
        // separately-styled call-to-action button.
        notifActionBtn.textContent = config.actionLabel ? `${config.actionLabel} ↵` : '';
        notifActionBtn.classList.toggle('visible', !!config.actionLabel);

        searchInputWrap.classList.add('notif-flash');
        setTimeout(() => {
            if (seq !== notificationSeq) return; // superseded mid-flash (e.g. dismissed already)
            searchInputWrap.classList.remove('notif-flash');
            searchInputWrap.classList.add('notifying', 'notif-clipping');
            updateSearchSpaceHint(); // starts its slide-out now, in lockstep with #search-input
            setTimeout(() => {
                if (seq !== notificationSeq) return;
                searchInputWrap.classList.add('notif-pulse-slow');
            }, NOTIF_SLIDE_MS);
        }, NOTIF_FLASH_MS);

        clearTimeout(notificationTimer);
        const durationMs = config.durationMs || NOTIFICATION_DEFAULT_DURATION_MS;
        if (!config.sticky) notificationTimer = setTimeout(dismissCurrentNotification, computeNotificationDismissDelay(durationMs));
    }
    // Click OR Enter (see the keydown handler below) — a no-op if this notification has no
    // action configured, so a stray Enter press can't dismiss a sticky plain notification.
    function runNotificationAction() {
        if (!currentNotification || !currentNotification.actionLabel) return;
        const cb = currentNotification.onAction;
        dismissCurrentNotification();
        if (cb) cb();
    }
    // Exit: (1) the border flashes 2 quick pulses again while the notification is still fully on
    // screen, (2) it slides back down and away while #search-input/#search-space-hint slide back
    // into place (the exact reverse of showNotification's entrance) — only once that settles is
    // the queue allowed to advance to the next notification, so a back-to-back pair never
    // overlaps or snaps between each other mid-animation.
    function dismissCurrentNotification() {
        if (!currentNotification) return;
        clearTimeout(notificationTimer);
        currentNotification = null;
        const seq = ++notificationSeq; // supersedes any pending entrance-sequence timeouts
        searchInputWrap.classList.remove('notif-pulse-slow');
        searchInputWrap.classList.add('notif-flash');
        setTimeout(() => {
            if (seq !== notificationSeq) return;
            // 'notifying' comes off now, flipping the reverse slide's target transform (see
            // .notif-clipping's own comment in globals.css) — but 'notif-clipping' deliberately
            // stays on through that whole slide so the content stays clipped to the box the entire
            // time, instead of spending its last 0.3s visible outside the border.
            searchInputWrap.classList.remove('notif-flash', 'notifying');
            updateSearchSpaceHint(); // may need to reappear now that the box is back to normal — slides back in alongside #search-input
            setTimeout(() => {
                if (seq !== notificationSeq) return;
                searchInputWrap.classList.remove('notification-grows', 'notif-clipping');
                lastNotificationCloseTime = Date.now();
                tryShowNextNotification();
            }, NOTIF_SLIDE_MS);
        }, NOTIF_FLASH_MS);
    }
    searchInput.addEventListener('blur', tryShowNextNotification);
    document.addEventListener('keydown', (e) => {
        if (!currentNotification) return;
        const active = document.activeElement;
        // Some OTHER field being actively edited (a waypoint rename, a table cell, etc.) wins —
        // Enter/Escape apply to that as usual rather than surprise-triggering the notification
        // sitting in the background.
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (isEditingText) return;
        if (e.key === 'Enter') { e.preventDefault(); runNotificationAction(); }
        // No dismiss button exists, so this is the only way to close a notification without
        // triggering its action — always just hides it, no callback (dismissCurrentNotification
        // itself never calls one), which is exactly what every real notification wants here.
        else if (e.key === 'Escape') { e.preventDefault(); dismissCurrentNotification(); }
    });
    // Notifications only ever DISPLAY while the tab is actually visible (see
    // tryShowNextNotification) — this is what makes that true both ways: hides/holds new ones the
    // instant the tab is backgrounded (another tab, another app, screen lock, ...), and freezes
    // the CURRENTLY showing one's auto-dismiss timer too, so nothing can silently finish counting
    // down while nobody's there to see it. Coming back re-arms it at its full duration (not
    // whatever was left) and then tries to advance the queue, so anything that piled up while away
    // still comes through one at a time from here rather than all at once.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (currentNotification && !currentNotification.sticky) {
                const durationMs = currentNotification.durationMs || NOTIFICATION_DEFAULT_DURATION_MS;
                clearTimeout(notificationTimer);
                notificationTimer = setTimeout(dismissCurrentNotification, computeNotificationDismissDelay(durationMs));
            }
            tryShowNextNotification();
        } else {
            clearTimeout(notificationTimer);
        }
    });

    // Faint "Enter" pill on the right of the search box — visible only while it's both empty and
    // NOT focused (the hint is for the "press Enter to open it" case; once it's actually focused
    // that action no longer applies — pressing Enter at that point closes it instead, see the
    // search-input keydown handler further down). Called from handleSearchInput/clearSearch (on
    // every value change) and on focus/blur, plus once here for the correct state on first load
    // (the markup itself defaults to visible for a flash-free first paint, but that default is
    // only actually right if the box starts empty and unfocused).
    function updateSearchSpaceHint() {
        if (!searchSpaceHint || !searchInput) return;
        const focused = document.activeElement === searchInput;
        const notifying = searchInputWrap.classList.contains('notifying');
        searchSpaceHint.classList.toggle('visible', !focused && !notifying && searchInput.value.trim() === '');
    }
    updateSearchSpaceHint();

    // #search-input is a <textarea> that grows line by line as typed text wraps, up to 4 lines
    // (100px) — or 3 text lines + the card-context pill's own line (80px) when cards are
    // attached, since the pill counts toward the same 4-line budget. Repositions #search-dropdown
    // to stay glued 7px below the input at whatever height it's currently at.
    function autoGrowSearchInput() {
        // The pill (when shown) claims its own line by pushing padding-bottom from 10px to 30px
        // (see #search-input.has-pill in globals.css) — that alone shrinks the available TEXT
        // budget from 4 lines to 3 within the very same 100px overall cap (10 top pad + 3*20 text
        // + 30 bottom pad/pill = 100, vs. 10 + 4*20 + 10 = 100 with no pill), so the cap itself
        // never changes, only the minimum (1 empty text line, plus the pill's own line when
        // present).
        const hasPill = typeof searchCardContext !== 'undefined' && searchCardContext.length > 0;
        const minH = hasPill ? 60 : 40;
        let h;
        // With no typed value, the box is always exactly 1 (text) line tall — measuring
        // scrollHeight here would instead reflect the animated placeholder's current wrapped
        // shape (a <textarea>'s placeholder wraps like real content when the value is empty),
        // which has nothing to do with what the user has actually typed.
        if (!searchInput.value) {
            h = minH;
        } else {
            searchInput.style.height = 'auto';
            // #search-input itself is borderless now (the wrap owns the border — see globals.css),
            // so scrollHeight's content+padding measurement already matches what style.height
            // (box-sizing:border-box) needs — no border-compensation offset required.
            h = Math.max(minH, Math.min(100, searchInput.scrollHeight));
        }
        searchInput.style.height = h + 'px';
        searchDropdown.style.top = (searchInputWrap.offsetHeight + 7) + 'px';
        // style.height='auto' above forces a reflow that resets scrollTop to 0 — once content
        // no longer fits (capped at 100px), that leaves the caret's actual line scrolled out of
        // view after every keystroke. Pin back to the bottom, where the caret always is (typing
        // never happens mid-text via a mouse click without also refocusing/reflowing here).
        if (searchInput.scrollHeight > searchInput.clientHeight) searchInput.scrollTop = searchInput.scrollHeight;
    }

    // ---------- Card context: cards dragged into the search box as AI context ----------
    // Persists across searches (unlike the text input, which clears after every search) so
    // follow-up questions about the same attached cards don't require redragging — only cleared
    // by the global outside-click handler, alongside every other ephemeral search-state reset.
    let searchCardContext = []; // { id, snapshot }
    let searchCardConnections = []; // { fromId, toId } — copied across from the live folder for
    // any pair that was dragged in together, so a data-mode link between two dragged cards
    // survives into the popup preview.

    function renderSearchCardPill() {
        if (!searchCardPill) return;
        const n = searchCardContext.length;
        searchCardPill.classList.toggle('visible', n > 0);
        searchInput.classList.toggle('has-pill', n > 0);
        searchCardPillLabel.textContent = n > 0 ? `${n} card${n === 1 ? '' : 's'}` : '';
        autoGrowSearchInput();
    }

    // Adds `ids` (a drag gesture's card ids — a single card or a multi-selection) to the
    // persistent card-context set. Each is snapshotted and sanitized exactly like a
    // marketplace/chat export (see sanitizeFlashcardSnapshot) using the OTHER ids in this same
    // call as the batch, so a flashcard dragged together with its source keeps real data, but
    // dragged alone it's generic-ified — same source-of-truth rule either way. Connections
    // between two cards that are both part of this drag are copied across too, so the link
    // itself (not just the two cards) survives into the popup preview.
    function addCardsToSearchContext(ids) {
        const folder = appState.folders[appState.currentFolderId];
        if (!folder) return;
        ids.forEach(id => {
            if (searchCardContext.some(c => c.id === id)) return;
            const it = findItemById(id);
            if (!it) return;
            searchCardContext.push({ id, snapshot: sanitizeFlashcardSnapshot(snapshotItem(it), ids) });
        });
        const conns = ensureConnections(folder);
        conns.forEach(c => {
            if (!ids.includes(c.fromId) || !ids.includes(c.toId)) return;
            if (searchCardConnections.some(sc => sc.fromId === c.fromId && sc.toId === c.toId)) return;
            searchCardConnections.push({ fromId: c.fromId, toId: c.toId });
        });
        renderSearchCardPill();
    }

    function removeSearchCardContextItem(id) {
        searchCardContext = searchCardContext.filter(c => c.id !== id);
        searchCardConnections = searchCardConnections.filter(c => c.fromId !== id && c.toId !== id);
        renderSearchCardPill();
        if (!searchCardContext.length) { closeSearchCardsModal(); return; }
        if (document.getElementById('search-cards-modal-overlay').classList.contains('open')) openSearchCardsModal();
    }

    // The pill's hover-reveal "✕" — clears every attached card at once, unlike
    // removeSearchCardContextItem which only drops one.
    function clearSearchCardContext() {
        searchCardContext = [];
        searchCardConnections = [];
        renderSearchCardPill();
        closeSearchCardsModal();
    }

    // Packs a flat set of snapshots into a neat grid (ceil(sqrt(n)) columns, uniform spacing
    // derived from the largest card's own w/h) purely for the popup preview — mutates copies
    // only, never the stored snapshot's original x/y (which is meaningless outside its original
    // canvas anyway) or anything on the live canvas.
    function layoutSnapshotsInGrid(snapshots) {
        const n = snapshots.length;
        const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
        const maxW = Math.max(100, ...snapshots.map(s => s.w || 100));
        const maxH = Math.max(60, ...snapshots.map(s => s.h || 60));
        const gap = 40;
        return snapshots.map((s, i) => Object.assign({}, s, {
            x: (i % cols) * (maxW + gap),
            y: Math.floor(i / cols) * (maxH + gap),
        }));
    }

    function openSearchCardsModal() {
        if (!searchCardContext.length) return;
        const laidOut = layoutSnapshotsInGrid(searchCardContext.map(c => c.snapshot));
        const body = document.getElementById('search-cards-modal-body');
        body.innerHTML = '';
        body.appendChild(renderInlineCanvas(laidOut, false, searchCardConnections, (id) => removeSearchCardContextItem(id)));
        document.getElementById('search-cards-modal-overlay').classList.add('open');
    }
    function closeSearchCardsModal() {
        document.getElementById('search-cards-modal-overlay').classList.remove('open');
    }

    // ---------- Animated Placeholder (types out & deletes a looping series of suggestions) ----------
    (function animateSearchPlaceholder() {
        const suggestions = [
            'find anything in your canvas...',
            'ask me how to conjugate verbs...',
            'generate a mnemonic for ananas...'
        ];
        const TYPE_SPEED = 60, DELETE_SPEED = 45, PAUSE_AFTER_TYPE = 2400, PAUSE_AFTER_DELETE = 800;
        let sIndex = 0, charIndex = 0, deleting = false;
        function tick() {
            const current = suggestions[sIndex];
            if (!deleting) {
                charIndex++;
                searchInput.placeholder = current.slice(0, charIndex);
                if (charIndex >= current.length) {
                    deleting = true;
                    setTimeout(tick, PAUSE_AFTER_TYPE);
                    return;
                }
                setTimeout(tick, TYPE_SPEED);
            } else {
                charIndex--;
                searchInput.placeholder = current.slice(0, charIndex);
                if (charIndex <= 0) {
                    deleting = false;
                    sIndex = (sIndex + 1) % suggestions.length;
                    setTimeout(tick, PAUSE_AFTER_DELETE);
                    return;
                }
                setTimeout(tick, DELETE_SPEED);
            }
        }
        tick();
    })();

    let searchActiveIndex = -1;
    function setSearchActive(idx) {
        const items = Array.from(searchResults.querySelectorAll('.search-result-item'));
        if (!items.length) return;
        idx = ((idx % items.length) + items.length) % items.length;
        items.forEach(el => el.classList.remove('active'));
        searchActiveIndex = idx;
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
    }
    function stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return (div.textContent || '').trim();
    }
    // "Entries" for a source card's count badge: data rows only (tableData[0] is the column-name
    // header row, never a real entry), only rows with at least one non-blank cell.
    function countSourceEntries(folderId) {
        const f = appState.folders[folderId];
        const tableItem = f && (f.items || []).find(i => i.kind === 'table');
        if (!tableItem || !tableItem.tableData) return 0;
        return tableItem.tableData.slice(1).filter(row => row.some(cell => stripHtml(cell))).length;
    }
    // The TRUE structural parent of a folder — the folder that actually contains a
    // folder/source card pointing at it — not "whatever we happened to navigate from before
    // this" (that's historyStack/historyIndex, a separate, purely click-order concept used only
    // for the back/forward buttons). Folders don't store their own parent, so this is a reverse
    // lookup; used by the breadcrumb's ".." so it reflects real canvas hierarchy regardless of
    // how you arrived here (drilling in, a waypoint jump, search, the hamburger menu, ...).
    // Root has no parent (nothing ever points at it), so this naturally returns null for it.
    function findParentFolderId(folderId) {
        for (const fid in appState.folders) {
            const f = appState.folders[fid];
            if ((f.items || []).some(it => (it.kind === 'folder' || it.kind === 'source') && it.folderId === folderId)) return fid;
        }
        return null;
    }
    function getItemSearchText(it) {
        if (it.kind === 'folder' || it.kind === 'source') return appState.folders[it.folderId] ? appState.folders[it.folderId].title : '';
        if (it.kind === 'waypoint') return it.name || '';
        if (it.kind === 'table') return it.tableData.map(row => row.map(c => stripHtml(c)).join(' ')).join(' ');
        if (it.kind === 'checklist') return (it.tasks || []).map(t => t.text).join(' ');
        if (it.kind === 'bookmark') return it.html || (it.bookmarkUrl ? shortUrl(it.bookmarkUrl) : '');
        if (it.kind === 'embed') return it.embedUrl || '';
        return stripHtml(it.html);
    }
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    // True when `s` is entirely Latin-script (+ digits/whitespace/common punctuation) -- used to
    // suppress a dictionary/example transliteration line even if the model returns one anyway.
    // The prompt already tells it to omit transliteration/romanization for already-Latin words
    // (see lib/dotbot.js), but that is a request, not a guarantee -- this is a client-side backstop
    // so a stray romaji-style line never shows up next to plain English/Spanish/French/etc. text,
    // regardless of how reliably any given model actually follows that instruction. Built from
    // explicit \uXXXX escapes (never raw high-codepoint characters in the source) covering Basic
    // Latin + Latin-1 Supplement + Latin Extended A/B (U+0000-U+024F), Latin Extended Additional
    // (U+1E00-U+1EFF, Vietnamese diacritics), and General Punctuation (U+2000-U+206F) -- anything
    // outside those ranges (plus \s/\d) left over after stripping means a non-Latin script is
    // actually present.
    const NON_LATIN_SCRIPT_RE = new RegExp("[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\s\d]");
    function isLatinScriptText(s) {
        if (!s) return true;
        return !NON_LATIN_SCRIPT_RE.test(s);
    }
    function speakerIconHTML(extraClass) {
        const url = '/assets/icons/speaker.png';
        return `<span class="${extraClass || ''} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
    }
    // Must match the .align-hl-0..N palette in globals.css.
    const ALIGN_HL_COLOR_COUNT = 6;
    // Global on/off switch for word-alignment color-coding, toggled via the examples panel's
    // hover-slide toggle button (see buildExamplesCard) — affects every aligned sentence
    // currently on screen (examples panel AND any embedded answerBlocks example pills, since
    // both share the exact same highlighting mechanism), not just the panel the toggle button
    // lives on. `dotbotAlignedRegistry` tracks every {el, str, alignment, pick} currently
    // rendered so toggling can re-render them in place without needing to re-fetch or rebuild
    // whole cards — cleared at the top of renderOrchestrateResult each time a fresh result comes
    // in, so it never grows to reference stale, long-gone elements.
    let dotbotAlignHighlightOn = true;
    let dotbotAlignedRegistry = [];
    function applyAlignHighlightToggle(on) {
        dotbotAlignHighlightOn = on;
        dotbotAlignedRegistry.forEach(entry => {
            entry.el.innerHTML = alignedSentenceHTML(entry.str, entry.alignment, entry.pick);
        });
    }
    // Wraps whichever alignment phrases actually appear verbatim in `str` with color-coded
    // highlight spans — one color per entry in the `alignment` array (see lib/dotbot.js's
    // ALIGNMENT_SCHEMA for the {sourcePhrase, targetPhrase} contract this backs). `pickPhrase`
    // selects which side of each pair applies to THIS string (sourcePhrase for the original
    // sentence, targetPhrase for its translation) — calling this once per side with the same
    // `alignment` array naturally gives a matching pair the same color on both sides, since the
    // color is just that pair's own index in the array. A phrase that isn't found verbatim (the
    // model didn't follow the exact-substring contract) is silently skipped rather than guessed
    // at — same "never trust structured output blindly" posture as the rest of this codebase.
    // Matches are found in array order and never allowed to overlap an already-claimed range, so
    // an earlier pair's match always wins over a later, overlapping one.
    function alignedSentenceHTML(str, alignment, pickPhrase) {
        str = str || '';
        if (!dotbotAlignHighlightOn || !alignment || !alignment.length) return escapeHtml(str);
        const claims = [];
        const lowerStr = str.toLowerCase();
        alignment.forEach((pair, i) => {
            const phrase = pair && pickPhrase(pair);
            if (!phrase) return;
            // Case-insensitive search (sentence-initial capitalization shouldn't silently break
            // an otherwise-correct alignment pair) — the ORIGINAL casing from `str` is still
            // what actually gets sliced out and rendered below, only the search ignores case.
            const idx = lowerStr.indexOf(phrase.toLowerCase());
            if (idx === -1) return;
            const end = idx + phrase.length;
            if (claims.some(c => idx < c.end && end > c.start)) return; // overlaps an earlier, already-claimed match
            claims.push({ start: idx, end, colorIdx: i % ALIGN_HL_COLOR_COUNT });
        });
        if (!claims.length) return escapeHtml(str);
        claims.sort((a, b) => a.start - b.start);
        let html = '', cursor = 0;
        claims.forEach(c => {
            html += escapeHtml(str.slice(cursor, c.start));
            html += `<span class="align-hl align-hl-${c.colorIdx}">${escapeHtml(str.slice(c.start, c.end))}</span>`;
            cursor = c.end;
        });
        html += escapeHtml(str.slice(cursor));
        return html;
    }
    // Builds the {text, romanization, translation} elements for one example sentence, with
    // word-alignment highlighting applied to both text and translation — shared by the examples
    // panel (buildExamplesCard) and the "example" blocks inside an in-depth grammar/explanation
    // answer (see renderAnswerBlocks), so both use identical highlighting logic. Returns the
    // elements rather than appending them anywhere, since each caller lays them out differently
    // (the examples panel puts a TTS button alongside the text; answer blocks render as a
    // standalone pill) — translitEl/translationEl are null when that line doesn't apply (see
    // isLatinScriptText and the "differs from the sentence itself" rule, both unchanged from
    // before this shared alignment behavior).
    function buildAlignedSentenceEls(s) {
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-example-sentence';
        textEl.innerHTML = alignedSentenceHTML(s.text, s.alignment, (p) => p.sourcePhrase);
        dotbotAlignedRegistry.push({ el: textEl, str: s.text, alignment: s.alignment, pick: (p) => p.sourcePhrase });
        let translitEl = null;
        if (s.romanization && !isLatinScriptText(s.text)) {
            translitEl = document.createElement('div');
            translitEl.className = 'dotbot-example-translit';
            translitEl.textContent = s.romanization;
        }
        let translationEl = null;
        if (s.translation && s.translation !== s.text) {
            translationEl = document.createElement('div');
            translationEl.className = 'dotbot-example-translation';
            translationEl.innerHTML = alignedSentenceHTML(s.translation, s.alignment, (p) => p.targetPhrase);
            dotbotAlignedRegistry.push({ el: translationEl, str: s.translation, alignment: s.alignment, pick: (p) => p.targetPhrase });
        }
        return { textEl, translitEl, translationEl };
    }
    function truncateCenter(str, max) {
        if (str.length < max) return str;
        const tail = 4;
        const head = max - 3 - tail;
        return str.slice(0, head) + '...' + str.slice(str.length - tail);
    }

    let dotbotSuggestDebounceTimer = null;
    let dotbotSuggestAbortController = null;
    // Bumped once by commenceSearchOrMnemonic every time a search is actually submitted — lets a
    // live-suggestion fetch that was already in flight (see scheduleLiveSuggestions) detect that a
    // submit happened while it was waiting, even in the edge case where its response arrives
    // right as/after Enter is pressed (too late for the abort() below to actually cancel it) —
    // otherwise it would clobber the "thinking..." loading state with a stale suggestions list.
    let dotbotSearchGeneration = 0;

    function clearSearch() {
        if (!searchInput) return;
        searchInput.value = '';
        autoGrowSearchInput();
        updateSearchSpaceHint();
        searchDotbotAnswer.innerHTML = ''; searchDotbotAnswer.style.display = 'none';
        searchResults.innerHTML = ''; searchResults.style.display = 'none';
        if (searchTranslation) { searchTranslation.innerHTML = ''; searchTranslation.style.display = 'none'; }
        searchDictionary.innerHTML = ''; searchDictionary.style.display = 'none';
        searchExamples.innerHTML = ''; searchExamples.style.display = 'none';
        if (searchImageResult) { searchImageResult.innerHTML = ''; searchImageResult.style.display = 'none'; }
        searchSuggestions.innerHTML = ''; searchSuggestions.style.display = 'none';
        if (searchRecommended) { searchRecommended.innerHTML = ''; searchRecommended.style.display = 'none'; }
        updateSearchDropdown();
    }
    function updateSearchDropdown() {
        if (!searchDropdown) return;
        const panels = [searchDotbotAnswer, searchResults, searchTranslation, searchDictionary, searchExamples, searchImageResult, searchSuggestions, searchRecommended].filter(Boolean);
        const visible = panels.some(el => el.style.display !== 'none');
        searchDropdown.classList.toggle('visible', visible);
    }

    // Hides the panels that hold a *completed* search's result (Dotbot's answer, dictionary,
    // examples) — called whenever the box is re-opened or typed into again, so a prior search's
    // result doesn't linger on screen underneath/alongside the live typing state. Deliberately
    // separate from clearSearch(), which also wipes the input value and suggestions — this only
    // clears the "result" panels.
    function hideDotbotResultPanels() {
        searchDotbotAnswer.innerHTML = ''; searchDotbotAnswer.style.display = 'none';
        if (searchTranslation) { searchTranslation.innerHTML = ''; searchTranslation.style.display = 'none'; }
        searchDictionary.innerHTML = ''; searchDictionary.style.display = 'none';
        searchExamples.innerHTML = ''; searchExamples.style.display = 'none';
        if (searchImageResult) { searchImageResult.innerHTML = ''; searchImageResult.style.display = 'none'; }
        if (searchRecommended) { searchRecommended.innerHTML = ''; searchRecommended.style.display = 'none'; }
    }

    function handleSearchInput(value) {
        autoGrowSearchInput();
        updateSearchSpaceHint();
        if (dotbotScheduleConversation) return; // typing the "when" reply — not a search query
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        hideDotbotResultPanels();
        if (value.trim() === "") {
            handleSearchFocus();
            return;
        }
        const matches = folderObj.isSource ? computeSourceMatches(value) : computeCanvasMatches(value);
        renderCanvasResultsPanel(matches, folderObj.isSource);
        scheduleLiveSuggestions(value, folderObj.isSource);
        updateSearchDropdown();
    }

    // Focusing the box no longer drops a static suggestion list on you — instead the border
    // itself pulses (see .idle-pulsing / the search-idle-chase rects in globals.css) for as long
    // as the box is focused and nothing's been submitted yet, replaced by the existing loading
    // ring the moment a search actually commences (see commenceSearchOrMnemonic/
    // commenceDotbotSearch, which remove this class right before they run).
    function handleSearchFocus() {
        updateSearchSpaceHint();
        closeAllPanels(null);
        if (dotbotScheduleConversation) return; // keep Dotbot's prompt showing, not generic suggestions
        hideDotbotResultPanels();
        searchInputWrap.classList.add('idle-pulsing');
        const v = searchInput.value.trim();
        if (v !== "") return;
        searchSuggestions.innerHTML = '';
        searchSuggestions.style.display = 'none';
        searchResults.style.display = 'none';
        updateSearchDropdown();
    }

    // ---------- Live AI-generated suggestions (free, debounced — see /api/dotbot/suggest) ----------
    function scheduleLiveSuggestions(value, isSourceFolder) {
        clearTimeout(dotbotSuggestDebounceTimer);
        if (dotbotSuggestAbortController) dotbotSuggestAbortController.abort();
        const q = value.trim();
        if (q.length < 2) { searchSuggestions.innerHTML = ''; searchSuggestions.style.display = 'none'; updateSearchDropdown(); return; }
        const generationAtScheduleTime = dotbotSearchGeneration;
        dotbotSuggestDebounceTimer = setTimeout(async () => {
            dotbotSuggestAbortController = new AbortController();
            let suggestions = [];
            try {
                const res = await fetch('/api/dotbot/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, isSourceFolder }),
                    signal: dotbotSuggestAbortController.signal
                });
                const data = await res.json();
                if (searchInput.value.trim() !== q) return; // stale — a newer keystroke already moved on
                // A search may have been SUBMITTED (Enter) while this fetch was in flight — that
                // shows its own "thinking..." loading state in this same #search-suggestions
                // element, which these stale suggestions would otherwise clobber the instant this
                // response lands, even though abort() above didn't catch it in time.
                if (generationAtScheduleTime !== dotbotSearchGeneration) return;
                suggestions = data.suggestions || [];
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.error('[dotbot/suggest] failed:', e);
            }
            renderLiveSuggestions(suggestions);
        }, 200);
    }
    // No more hardcoded "Generate a mnemonic for X"/"Generate an image for this" rows here —
    // /api/dotbot/suggest's own prompt (see DOTBOT_SUGGEST_SYSTEM_PROMPT in lib/dotbot.js) now
    // recommends a mnemonic-generation suggestion as one of these AI-suggested completions
    // itself, specifically when the typed text looks like a single word/short phrase worth one —
    // clicking any suggestion here already routes through commenceSearchOrMnemonic, so a
    // suggested "generate a mnemonic for X" string is picked up correctly with no special-casing.
    function renderLiveSuggestions(suggestions) {
        searchSuggestions.innerHTML = '';
        suggestions.slice(0, 4).forEach(text => {
            const div = document.createElement('div');
            div.className = 'search-suggestion-item';
            div.textContent = text;
            div.onclick = (e) => { e.stopPropagation(); searchInput.value = text; autoGrowSearchInput(); commenceSearchOrMnemonic(text); };
            searchSuggestions.appendChild(div);
        });

        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
    }

    // ---------- Dotbot (AI assistant embedded in the search box) ----------
    // Credit costs are intentionally never shown here or anywhere in this UI —
    // deduction happens entirely server-side (see app/api/dotbot/*), the client
    // just gets back a result or a friendly "no_credits" reason.
    function dotbotErrorMessage(reason) {
        if (reason === 'no_credits') return "You're out of Dotbot credits for today — more tomorrow!";
        if (reason === 'not_configured') return "Dotbot isn't set up yet.";
        if (reason === 'unauthenticated') return 'Log in to talk to Dotbot.';
        return 'Something went wrong — try again.';
    }
    // Reveals `text` inside `el` a character at a time (a blinking caret via the dotbot-typing
    // class while it runs). Plain textContent throughout — no HTML involved, so newlines are
    // handled with CSS white-space:pre-wrap rather than injecting <br> mid-animation, and there's
    // nothing to escape. Bails cleanly if `el` gets removed from the DOM mid-animation (e.g. the
    // search box was cleared/navigated away from before typing finished).
    function typewriterReveal(el, text, onDone) {
        el.textContent = '';
        el.classList.add('dotbot-typing');
        let i = 0;
        // Scaled to a ~700ms total reveal regardless of length, clamped to a sensible per-char
        // range — a flat 12ms/char was adding up to 1.5-2+ seconds of pure animation on top of
        // the network round trip for a longer answer, which read as the app still being slow
        // even after the response had already arrived.
        const msPerChar = Math.max(4, Math.min(12, 700 / Math.max(text.length, 1)));
        (function step() {
            if (!el.isConnected) return;
            i++;
            el.textContent = text.slice(0, i);
            if (i < text.length) { setTimeout(step, msPerChar); }
            else { el.classList.remove('dotbot-typing'); if (onDone) onDone(); }
        })();
    }
    // Mirrors the pointer-drag pattern used to drag a shared chat card onto the
    // canvas (see the draggableOut branch in renderInlineCanvas), but for a single
    // synthetic Dotbot result rather than an array of existing canvas items.
    // `opts.cellImageHtml`, when set, is an <img ...> tag this drag can ALSO land directly
    // inside a source page's table cell (see insertImageIntoCellAt) if it's released over one —
    // otherwise (or if released over blank canvas) it falls through to the normal
    // canvasItemTemplate drop.
    function setupDotbotResultDrag(card, canvasItemTemplate, opts) {
        opts = opts || {};
        card.classList.add('dotbot-draggable');
        card.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            let dragStarted = false, dragGhost = null;
            const startX = e.clientX, startY = e.clientY;
            const move = (me) => {
                if (!dragStarted) {
                    if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
                    dragStarted = true;
                    dragGhost = document.createElement('div');
                    dragGhost.className = 'inline-canvas-drag-ghost';
                    dragGhost.textContent = 'drop onto your canvas';
                    document.body.appendChild(dragGhost);
                }
                dragGhost.style.left = (me.clientX + 14) + 'px';
                dragGhost.style.top = (me.clientY + 14) + 'px';
                if (opts.cellImageHtml) {
                    const overCell = me.target && me.target.closest && me.target.closest('.cell-text');
                    dragGhost.textContent = overCell ? 'drop into this entry' : 'drop onto your canvas';
                }
            };
            const up = (ue) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (dragGhost) dragGhost.remove();
                if (!dragStarted) return;
                if (opts.cellImageHtml) {
                    const dropEl = document.elementFromPoint(ue.clientX, ue.clientY);
                    const cellTextEl = dropEl && dropEl.closest ? dropEl.closest('.cell-text') : null;
                    const tdEl = cellTextEl && cellTextEl.closest('td[data-origin-table]');
                    if (tdEl) {
                        const r = Number(cellTextEl.dataset.r), c = Number(cellTextEl.dataset.c), tableId = Number(tdEl.dataset.originTable);
                        if (Number.isFinite(r) && Number.isFinite(c) && Number.isFinite(tableId) && insertImageIntoCellAt(tableId, r, c, opts.cellImageHtml)) {
                            clearSearch();
                            return;
                        }
                    }
                }
                const canvasRect = canvas.getBoundingClientRect();
                const overCanvas = ue.clientX >= canvasRect.left && ue.clientX <= canvasRect.right && ue.clientY >= canvasRect.top && ue.clientY <= canvasRect.bottom;
                if (!overCanvas) return;
                // opts.onDrop lets a caller replace the default single-template import — used by
                // the mnemonic story/image cards so dragging either one brings BOTH in (see
                // importMnemonicPairAtScreenPoint).
                if (opts.onDrop) opts.onDrop(ue.clientX, ue.clientY);
                else importDotbotResultAtScreenPoint(canvasItemTemplate, ue.clientX, ue.clientY);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }
    // Drops a generated image straight into a source table cell (see setupDotbotResultDrag's
    // cellImageHtml option) — appends to whatever's already in the cell, same as
    // triggerCellImageUpload/insertIntoActiveCell do for a manually-uploaded image, just
    // addressed by an explicit (tableId, r, c) from the drop point rather than lastFocusedCell.
    function insertImageIntoCellAt(tableId, r, c, imgHtml) {
        const table = findItemById(tableId);
        if (!table || !table.tableData || !table.tableData[r] || table.tableData[r][c] == null) return false;
        saveSnapshot();
        const cellEl = document.querySelector(`#item-${tableId} .cell-text[data-r="${r}"][data-c="${c}"]`);
        if (cellEl) {
            cellEl.insertAdjacentHTML('beforeend', imgHtml);
            table.tableData[r][c] = cellEl.innerHTML;
        } else {
            table.tableData[r][c] = (table.tableData[r][c] || '') + imgHtml;
        }
        scheduleWorkspaceSave();
        render();
        return true;
    }
    function importDotbotResultAtScreenPoint(template, clientX, clientY) {
        saveSnapshot();
        const rect = canvas.getBoundingClientRect();
        const dropX = Math.round(((clientX - rect.left - appState.tx) / appState.scale) / 28) * 28;
        const dropY = Math.round(((clientY - rect.top - appState.ty) / appState.scale) / 28) * 28;
        // Every caller of this function is Dotbot/AI-originated content (dictionary/answer/
        // mnemonic story/image, and now individual example sentences) — aiGenerated:true here
        // covers the "Generated content may be inaccurate" badge for all of them in one place,
        // with no per-call-site changes needed.
        const item = {
            id: appState.idCounter++,
            x: dropX, y: dropY,
            w: template.w, h: template.h,
            kind: template.kind || 'note',
            html: template.html,
            aiGenerated: true,
        };
        if (template.kind === 'sentence') {
            item.text = template.text || '';
            item.translit = template.translit || '';
            item.translation = template.translation || '';
        }
        appState.folders[appState.currentFolderId].items.push(item);
        render();
        clearSearch();
    }

    // ---------- Mnemonic story / image (explicit, separate actions — not part of the
    // orchestrated search flow below, so kept simple: one result, no multi-panel handling) ----------
    // Dragging EITHER the story card or the image card onto the canvas brings in BOTH as separate
    // blocks (user can delete the one they don't want afterward) — see
    // importMnemonicPairAtScreenPoint. Whichever templates exist here at drop time get placed;
    // reset to {text:null,image:null} at the start of every new mnemonic (renderMnemonicLoading/
    // renderOwnMnemonicThenImage) so a stale pairing from a previous word never leaks in.
    let dotbotMnemonicPair = { text: null, image: null };
    function importMnemonicPairAtScreenPoint(clientX, clientY) {
        const pair = dotbotMnemonicPair;
        if (!pair.text && !pair.image) return;
        saveSnapshot();
        const rect = canvas.getBoundingClientRect();
        const dropX = Math.round(((clientX - rect.left - appState.tx) / appState.scale) / 28) * 28;
        const dropY = Math.round(((clientY - rect.top - appState.ty) / appState.scale) / 28) * 28;
        function place(template, x, y) {
            appState.folders[appState.currentFolderId].items.push({
                id: appState.idCounter++,
                x, y,
                w: template.w, h: template.h,
                kind: template.kind || 'note',
                html: template.html,
                aiGenerated: true,
            });
        }
        if (pair.text) place(pair.text, dropX, dropY);
        // Offset to the right of the story block so the two never fully overlap; falls back to
        // the same drop point when there's no story block to offset from (e.g. story failed).
        if (pair.image) place(pair.image, dropX + (pair.text ? pair.text.w + 20 : 0), dropY);
        render();
        clearSearch();
    }
    function renderMnemonicResultCard(content, options) {
        options = options || {};
        searchSuggestions.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'search-suggestion-item dotbot-result-card';
        searchSuggestions.appendChild(card);
        function finish() {
            if (options.canvasItem) {
                dotbotMnemonicPair.text = options.canvasItem;
                setupDotbotResultDrag(card, options.canvasItem, { onDrop: importMnemonicPairAtScreenPoint });
            }
            updateSearchDropdown();
        }
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        if (content.typeText !== undefined) typewriterReveal(card, content.typeText, finish);
        else { card.innerHTML = content.html; finish(); }
    }
    // A terminal-style typing loop for "AI is working" states: types one word out character by
    // character, holds briefly, deletes it, then moves to the next — looping — with a solid
    // rectangular block cursor at the caret (not a thin blinking line) that blinks the way a
    // terminal cursor does. One timer per active loading element (keyed by the element itself)
    // so more than one panel (story + image) can run this at once without stepping on each
    // other, and each stops cleanly the moment its own element is replaced/removed.
    const TYPEWRITER_LOADING_WORDS = ['Thinking', 'Consulting', 'Reasoning', 'Picturing', 'Composing', 'Imagining'];
    const typewriterLoadingTimers = new WeakMap();
    function stopTypewriterLoading(el) {
        const timer = typewriterLoadingTimers.get(el);
        if (timer) clearTimeout(timer);
        typewriterLoadingTimers.delete(el);
    }
    function startTypewriterLoading(el) {
        el.innerHTML = `<span class="typewriter-loading-text"></span><span class="typewriter-loading-cursor"></span>`;
        const textEl = el.querySelector('.typewriter-loading-text');
        let wordIndex = 0, charIndex = 0, deleting = false;
        const step = () => {
            if (!el.isConnected) { stopTypewriterLoading(el); return; }
            const word = TYPEWRITER_LOADING_WORDS[wordIndex] + '...';
            let delay;
            if (!deleting) {
                charIndex++;
                textEl.textContent = word.slice(0, charIndex);
                if (charIndex >= word.length) { deleting = true; delay = 900; }
                else delay = 55;
            } else {
                charIndex--;
                textEl.textContent = word.slice(0, charIndex);
                if (charIndex <= 0) { deleting = false; wordIndex = (wordIndex + 1) % TYPEWRITER_LOADING_WORDS.length; delay = 300; }
                else delay = 30;
            }
            typewriterLoadingTimers.set(el, setTimeout(step, delay));
        };
        step();
    }
    function renderMnemonicLoading() {
        dotbotMnemonicPair = { text: null, image: null };
        searchSuggestions.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'search-suggestion-item typewriter-loading';
        searchSuggestions.appendChild(loading);
        startTypewriterLoading(loading);
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
    }
    function renderMnemonicError(reason) {
        searchSuggestions.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'search-suggestion-item';
        errEl.textContent = dotbotErrorMessage(reason);
        searchSuggestions.appendChild(errEl);
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        if (reason === 'no_credits') { dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }
    // The generated image gets its OWN dedicated panel (#search-image-result — see the
    // fragment/CSS) rather than sharing #search-suggestions with the story card, so a story and
    // its image can both stay visible together instead of the image render wiping the story off
    // screen. Draggable onto the canvas as its own note (same as before) — see
    // setupDotbotResultDrag — and, via its cellImageHtml, straight into a source page's table
    // cell too.
    function renderImageResultLoading() {
        if (!searchImageResult) return;
        searchImageResult.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'search-suggestion-item search-image-loading typewriter-loading';
        searchImageResult.appendChild(loading);
        startTypewriterLoading(loading);
        searchImageResult.style.display = 'block';
        updateSearchDropdown();
    }
    function renderImageResultError(reason) {
        if (!searchImageResult) return;
        searchImageResult.innerHTML = `<div class="search-suggestion-item search-image-loading">${escapeHtml(dotbotErrorMessage(reason))}</div>`;
        searchImageResult.style.display = 'block';
        updateSearchDropdown();
        if (reason === 'no_credits') { dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }
    function renderImageResultPanel(imageDataUrl) {
        if (!searchImageResult) return;
        searchImageResult.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'search-suggestion-item dotbot-result-card search-image-result-card';
        card.innerHTML = `<img src="${imageDataUrl}" alt="" style="max-width:100%;border-radius:8px;display:block;">`;
        searchImageResult.appendChild(card);
        searchImageResult.style.display = 'block';
        // 448x252 = exactly 16:9 (both are *28, matching the canvas's own placement grid) — the
        // generated image is 16:9 too (see app/api/dotbot/image/route.js), so this box shows it
        // in full rather than the old square box cropping a widescreen image down to a square.
        dotbotMnemonicPair.image = { w: 448, h: 252, html: `<img src="${imageDataUrl}" style="max-width:100%;height:100%;object-fit:cover;border-radius:8px;">` };
        setupDotbotResultDrag(
            card,
            dotbotMnemonicPair.image,
            { cellImageHtml: `<img class="cell-media-img" src="${imageDataUrl}">`, onDrop: importMnemonicPairAtScreenPoint }
        );
        updateSearchDropdown();
    }
    async function generateMnemonicImage(imageScene) {
        renderImageResultLoading();
        try {
            const res = await fetch('/api/dotbot/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_scene: imageScene })
            });
            const data = await res.json();
            if (!res.ok) { renderImageResultError(data.error); return; }
            refreshDotbotUsage();
            renderImageResultPanel(data.imageDataUrl);
        } catch (e) {
            console.error('[dotbot] image failed:', e);
            renderImageResultError('error');
        }
    }
    // The "my mnemonic for X is Y" flow (see parseMnemonicIntent) — the user already supplied
    // their own mnemonic text, so there's no AI text generation step (no separate image_scene
    // either — their raw text doubles as the scene description), but it still needs to show as a
    // text card above the image (every mnemonic path must show text then image, no exceptions —
    // see commenceSearchOrMnemonic) rather than jumping straight to the image alone.
    function renderOwnMnemonicThenImage(mnemonicText) {
        dotbotMnemonicPair = { text: null, image: null };
        renderMnemonicResultCard({ typeText: mnemonicText }, { canvasItem: { w: 260, h: 160, html: mnemonicText } });
        generateMnemonicImage(mnemonicText);
    }
    // The combined "generate a mnemonic for X" flow (see parseMnemonicIntent) — writes the story
    // first, then automatically continues straight into generating its image, no extra click
    // needed. The story keeps using its own existing card (search-suggestions, with the
    // typewriter reveal); the image lands in the separate panel above.
    async function generateMnemonicStoryAndImage(word) {
        renderMnemonicLoading();
        let sentence, imageScene;
        try {
            const res = await fetch('/api/dotbot/mnemonic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word })
            });
            const data = await res.json();
            if (!res.ok) { renderMnemonicError(data.error); return; }
            refreshDotbotUsage();
            sentence = data.sentence;
            imageScene = data.image_scene;
        } catch (e) {
            console.error('[dotbot] mnemonic failed:', e);
            renderMnemonicError('error');
            return;
        }
        renderMnemonicResultCard({ typeText: sentence }, { canvasItem: { w: 260, h: 160, html: sentence } });
        // image_scene (a short literal action description — see DOTBOT_MNEMONIC_SYSTEM_PROMPT) is
        // what actually drives the image, not the displayed "sentence" — deliberately free of the
        // "Imagine ..." framing, which makes a worse image prompt than a plain scene description.
        generateMnemonicImage(imageScene);
    }
    // Recognizes two ways of asking for a mnemonic straight from the search bar (see the Enter-
    // to-submit handler): "generate/make/create a mnemonic (story) for X" (or bare "mnemonic for
    // X") writes a fresh story then its image; "my mnemonic for X is Y" treats Y as the user's
    // OWN mnemonic and skips straight to generating an image for it. Returns null for anything
    // else, which falls through to the normal orchestrated search.
    function parseMnemonicIntent(query) {
        const q = query.trim().replace(/[?!.]+$/, '');
        let m = q.match(/^my\s+mnemonic\s+for\s+(.+?)\s+is\s+(.+)$/i);
        if (m) return { type: 'own', word: m[1].trim(), mnemonicText: m[2].trim() };
        // Anchored on the core "mnemonic ... for X" phrase rather than enumerating every possible
        // verb — matches "generate/make/create/give me/write me/can you make me/etc. a mnemonic
        // (story) for X" anywhere in the query, so odd phrasings still route to the real
        // generator instead of falling through to a plain-text (no image) response.
        m = q.match(/mnemonic(?:\s+story)?\s+for\s+(.+)$/i);
        if (m) return { type: 'generate', word: m[1].trim() };
        // A bare "mnemonic X" / "mnemonic: X" / "mnemonic - X" with no "for" at all.
        m = q.match(/^mnemonic\s*[:\-]?\s+(.+)$/i);
        if (m) return { type: 'generate', word: m[1].trim() };
        return null;
    }
    // Shared by every way a query gets submitted (Enter, clicking a suggestion/recommended-search
    // row) — routes a mnemonic-shaped query to the right generation flow, or falls through to the
    // normal orchestrated search for everything else. Also where the idle border pulse (see
    // handleSearchFocus) hands off to the real loading state, since this is the one place every
    // submission path passes through.
    function commenceSearchOrMnemonic(query) {
        searchInputWrap.classList.remove('idle-pulsing');
        // Cancel any live-suggestion fetch still in flight from typing, and mark every response
        // from before this point as stale (see scheduleLiveSuggestions) — otherwise a suggestions
        // list that was already loading can land right as/after this submit and overwrite the
        // "thinking..." loading state it's about to show.
        dotbotSearchGeneration++;
        clearTimeout(dotbotSuggestDebounceTimer);
        if (dotbotSuggestAbortController) dotbotSuggestAbortController.abort();
        const intent = parseMnemonicIntent(query);
        if (intent && intent.type === 'generate') { generateMnemonicStoryAndImage(intent.word); return; }
        if (intent && intent.type === 'own') { renderOwnMnemonicThenImage(intent.mnemonicText); return; }
        commenceDotbotSearch(query);
    }

    // ---------- Canvas / source-row local matching (instant, no AI) ----------
    // Scored so the results panel (capped to 4 — see renderCanvasResultsPanel) shows the most
    // relevant and/or recent matches: exact match > starts-with > plain substring, tie-broken by
    // item id (idCounter only ever increases, so a higher id is a more recently created item).
    // Word-prefix matching, not substring — a query only matches if it's a prefix of the item's
    // whole text OR a prefix of one of its individual words, never merely contained partway
    // through one (e.g. "a" matches a note reading "and", but "n" no longer does just because
    // "and" happens to contain an "n"). Also matches by block TYPE: typing any PREFIX of a kind's
    // name (e.g. "n"/"no"/"not"/"note", not just the full word) surfaces every item of that kind,
    // regardless of its content — the highest-priority tier below, since asking for a whole
    // category is a stronger signal than any partial text match.
    function computeCanvasMatches(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const folderObj = appState.folders[appState.currentFolderId];
        const matches = [];
        (folderObj.items || []).forEach(it => {
            const text = getItemSearchText(it);
            const lower = text ? text.toLowerCase() : '';
            let score = 0;
            if (searchTypeLabel(it.kind).toLowerCase().startsWith(q)) score = 4;
            else if (lower === q) score = 3;
            else if (lower && lower.startsWith(q)) score = 2;
            else if (lower && lower.split(/[^\p{L}\p{N}]+/u).some(w => w && w.startsWith(q))) score = 1;
            if (!score) return;
            matches.push({ it, text, score });
        });
        matches.sort((a, b) => b.score - a.score || b.it.id - a.it.id);
        return matches.slice(0, 4);
    }
    function computeSourceMatches(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const folderObj = appState.folders[appState.currentFolderId];
        const tableItem = (folderObj.items || []).find(i => i.kind === 'table');
        if (!tableItem) return [];
        const matches = [];
        tableItem.tableData.forEach((row, ri) => {
            row.forEach((cell) => {
                const text = stripHtml(cell);
                if (!text) return;
                const lower = text.toLowerCase();
                const idx = lower.indexOf(q);
                if (idx === -1) return;
                matches.push({ ri, text, score: lower === q ? 3 : idx === 0 ? 2 : 1, tableId: tableItem.id });
            });
        });
        const seenRows = new Set();
        return matches
            .sort((a, b) => b.score - a.score)
            .filter(m => { if (seenRows.has(m.ri)) return false; seenRows.add(m.ri); return true; })
            .sort((a, b) => a.ri - b.ri)
            .slice(0, 4);
    }
    // Renders whichever ranked+capped match list it's given — hides entirely on zero matches
    // (no "No matches" placeholder anymore). `index` is this row's position (0-based) in the
    // capped max-4 list — shown as a 1-4 pill on the right, and pressing that digit key while the
    // dropdown is open clicks the row exactly like a mouse click would (see the keydown handler
    // near ArrowDown/ArrowUp/Enter further down).
    function renderMatchRow(m, isSourceFolder, index) {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        const indexPill = `<span class="search-result-index-pill">${index + 1}</span>`;
        if (isSourceFolder) {
            div.innerHTML = `<span class="search-result-kind">Row ${m.ri + 1}</span><span class="search-result-text">${escapeHtml(m.text.slice(0, 60))}</span>${indexPill}`;
            div.onclick = (e) => { e.stopPropagation(); goToSourceRow(m.tableId, m.ri); };
        } else {
            div.innerHTML = `${kindIconHTML(m.it.kind, m.it.level, 'search-result-kind-icon')}<span class="search-result-text">${escapeHtml((m.text || '(untitled)').slice(0, 60))}</span>${indexPill}`;
            div.onclick = (e) => { e.stopPropagation(); goToCanvasItem(m.it.id); };
        }
        return div;
    }
    function renderCanvasResultsPanel(matches, isSourceFolder) {
        searchResults.innerHTML = '';
        if (!matches.length) { searchResults.style.display = 'none'; searchActiveIndex = -1; return; }
        matches.forEach((m, i) => {
            const div = renderMatchRow(m, isSourceFolder, i);
            div.dataset.index = i;
            searchResults.appendChild(div);
        });
        searchResults.style.display = 'block';
        searchActiveIndex = -1;
    }
    function goToCanvasItem(id) {
        const it = findItemById(id);
        if (!it) return;
        const el = document.getElementById('item-' + id);
        const w = (it.kind === 'title' ? (el ? el.offsetWidth : 100) : it.w) || 0;
        const h = (it.kind === 'title' ? (el ? el.offsetHeight : 50) : it.h) || 0;
        const cx = it.x + w / 2, cy = it.y + h / 2;
        const targetScale = Math.max(appState.scale, 1);
        smoothPanTo(window.innerWidth / 2 - cx * targetScale, window.innerHeight / 2 - cy * targetScale, targetScale);
        clearSearch();
        if (el) {
            if (it.kind === 'waypoint') expandWaypointCard(el, it, { editable: false });
            flashCanvasElement(el);
        }
    }
    // Same brief highlight every "jump to this item" action lands on it with — search results
    // (above), the hamburger menu's Waypoints panel (peekWaypointCard), and its Outline panel
    // (goToOutlineItem) all share this one flash instead of each re-implementing it.
    function flashCanvasElement(el) {
        if (!el) return;
        el.classList.add('search-flash');
        setTimeout(() => el.classList.remove('search-flash'), 1000);
    }
    function goToSourceRow(tableId, rowIndex) {
        clearSearch();
        // Row 0 (column names) now lives in its own header-pill row entirely separate from
        // the table, so it needs its own lookup rather than a single tr:nth-child across both.
        const target = rowIndex === 0
            ? document.querySelector(`#item-${tableId} .static-table-header-track`)
            : document.querySelector(`#item-${tableId} .item-table tbody tr:nth-child(${rowIndex})`);
        if (!target) return;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.add('row-flash');
        setTimeout(() => target.classList.remove('row-flash'), 1000);
    }

    // ---------- Dictionary / examples panel builders — draggable onto the canvas like any
    // other Dotbot result. ----------
    // Speaks a dictionary entry's headword aloud via Edge TTS (server-side, /api/dotbot/tts —
    // Microsoft Edge's Read Aloud service, unofficial and free, not credit-gated). Replaced the
    // browser's own speechSynthesis: voice quality/availability varied wildly across machines,
    // whereas Edge TTS gives every user the same real neural voice regardless of what's installed
    // locally, and entry.language (a BCP-47 code from the AI) picks a matching voice server-side.
    let currentTtsAudio = null;
    // Shared by every TTS button in the AI results (dictionary headword, dictionary/examples
    // sentences) — speakDictionaryWord below is now a thin wrapper over this.
    async function speakText(text, language, btnEl) {
        if (!text || !text.trim()) return;
        if (currentTtsAudio) { currentTtsAudio.pause(); currentTtsAudio = null; } // stop any previous playback first
        if (btnEl) btnEl.classList.add('loading');
        try {
            const res = await fetch('/api/dotbot/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, language })
            });
            if (!res.ok) throw new Error('tts request failed: ' + res.status);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            currentTtsAudio = audio;
            audio.addEventListener('ended', () => URL.revokeObjectURL(url));
            audio.addEventListener('error', () => URL.revokeObjectURL(url));
            await audio.play();
        } catch (e) {
            console.error('[dotbot] tts failed:', e);
        } finally {
            if (btnEl) btnEl.classList.remove('loading');
        }
    }
    function speakDictionaryWord(entry, btnEl) {
        if (!entry || !entry.word) return;
        return speakText(entry.word, entry.language, btnEl);
    }
    // One card, showing one sense/entry at a time. The drag payload uses getters so dragging
    // always reflects whichever entry is currently on screen, not just whichever was first
    // rendered.
    // Returns a `.dotbot-dictionary-wrap` (position:relative) containing the card itself plus,
    // only when there's more than one sense to cycle through, a `.dotbot-dictionary-arrows`
    // sidebar living OUTSIDE the card on its right edge — hidden under the card by default and
    // sliding out on hover of the wrap (see CSS), rather than living inside the card as before.
    // The "1/3" counter stays inside the card, pinned to its top-right corner. Grammar info is
    // now a set of separate small pills (word/language/one-per-tag) rather than one combined
    // uppercase part-of-speech string — see lib/dotbot.js's "grammarTags". Entries no longer
    // carry a translation of the word/definition into the user's language at all (that's the
    // separate translation panel now — see buildTranslationCard) and no longer carry their own
    // example sentences — see renderOrchestrateResult, which renders "examples" independently.
    function buildDictionaryCard(panel) {
        const entries = (panel.entries || []).slice(0, 5);
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-dictionary-wrap';
        const card = document.createElement('div');
        card.className = 'dotbot-dictionary-card';
        wrap.appendChild(card);
        if (!entries.length) return wrap;
        let index = 0;

        let countEl = null;
        if (entries.length > 1) {
            countEl = document.createElement('span');
            countEl.className = 'dotbot-dictionary-count';
            card.appendChild(countEl);
        }

        const main = document.createElement('div');
        main.className = 'dotbot-dictionary-main';
        card.appendChild(main);

        const headRow = document.createElement('div');
        headRow.className = 'dotbot-dictionary-head-row';
        const wordEl = document.createElement('span');
        wordEl.className = 'dotbot-dictionary-word';
        const audioBtn = document.createElement('button');
        audioBtn.className = 'tts-btn dotbot-dictionary-audio-btn';
        audioBtn.type = 'button';
        audioBtn.title = 'Play pronunciation';
        audioBtn.innerHTML = speakerIconHTML();
        audioBtn.onclick = (e) => { e.stopPropagation(); speakDictionaryWord(entries[index], audioBtn); };
        const ipaEl = document.createElement('span');
        ipaEl.className = 'dotbot-dictionary-ipa';
        // Word, audio button, and IPA transcription all cluster directly next to each other
        // (not pushed to opposite ends of the row) since they're all "about the headword itself".
        headRow.appendChild(wordEl);
        headRow.appendChild(audioBtn);
        headRow.appendChild(ipaEl);
        main.appendChild(headRow);

        const translitEl = document.createElement('div');
        translitEl.className = 'dotbot-dictionary-translit';
        main.appendChild(translitEl);
        const tagsEl = document.createElement('div');
        tagsEl.className = 'dotbot-dictionary-tags';
        main.appendChild(tagsEl);
        const defEl = document.createElement('div');
        defEl.className = 'dotbot-dictionary-def';
        main.appendChild(defEl);

        if (entries.length > 1) {
            const arrowsEl = document.createElement('div');
            arrowsEl.className = 'dotbot-dictionary-arrows';
            const upBtn = document.createElement('button');
            upBtn.type = 'button'; upBtn.className = 'dotbot-dictionary-arrow dotbot-dictionary-arrow-up'; upBtn.textContent = '▲'; upBtn.title = 'Previous sense';
            const downBtn = document.createElement('button');
            downBtn.type = 'button'; downBtn.className = 'dotbot-dictionary-arrow dotbot-dictionary-arrow-down'; downBtn.textContent = '▼'; downBtn.title = 'Next sense';
            upBtn.onclick = (e) => { e.stopPropagation(); index = (index - 1 + entries.length) % entries.length; renderEntry(); };
            downBtn.onclick = (e) => { e.stopPropagation(); index = (index + 1) % entries.length; renderEntry(); };
            arrowsEl.appendChild(upBtn); arrowsEl.appendChild(downBtn);
            wrap.appendChild(arrowsEl); // sibling of `card`, outside it — see .dotbot-dictionary-wrap's hover-slide CSS
        }

        function renderEntry() {
            const entry = entries[index];
            wordEl.textContent = entry.word || '';
            // Suppressed for already-Latin-script words even if the model filled in a
            // transliteration anyway — see isLatinScriptText.
            const showTranslit = entry.transliteration && !isLatinScriptText(entry.word);
            translitEl.textContent = showTranslit ? entry.transliteration : '';
            translitEl.style.display = showTranslit ? 'block' : 'none';
            ipaEl.textContent = entry.ipa ? `/${entry.ipa}/` : '';
            ipaEl.style.display = entry.ipa ? 'inline-block' : 'none';
            tagsEl.innerHTML = '';
            (entry.grammarTags || []).forEach(tag => {
                const pill = document.createElement('span');
                pill.className = 'dotbot-dictionary-tag-pill';
                pill.textContent = tag;
                tagsEl.appendChild(pill);
            });
            tagsEl.style.display = (entry.grammarTags && entry.grammarTags.length) ? 'flex' : 'none';
            defEl.textContent = entry.definition || '';
            if (countEl) countEl.textContent = `${index + 1}/${entries.length}`;
            updateSearchDropdown();
        }
        renderEntry();

        setupDotbotResultDrag(card, {
            w: 240, h: 140,
            get html() {
                const entry = entries[index];
                const tags = (entry.grammarTags && entry.grammarTags.length) ? `(${entry.grammarTags.join(', ')}) ` : '';
                return [entry.word, entry.transliteration, entry.ipa ? `/${entry.ipa}/` : '', `${tags}${entry.definition}`]
                    .filter(Boolean).join('<br>');
            }
        });
        return wrap;
    }
    // `panel.sentences` is a list of {text, translation, romanization, alignment} — translation
    // is only rendered when it actually differs from the sentence itself (i.e. the sentence
    // isn't already English), and romanization only when the model filled it in AND the sentence
    // isn't already Latin script (isLatinScriptText is a client-side backstop on top of the
    // model's own instruction to omit it). Text/translation both get word-alignment highlighting
    // via the shared buildAlignedSentenceEls (see its own comment for the {sourcePhrase,
    // targetPhrase} contract). Each sentence is its own drag handle (not the whole card) —
    // dropped individually onto the canvas as a dedicated 'sentence' card, not a plain note.
    // `panel.language` (the standalone examples panel's own language field) is passed to each
    // sentence's own TTS button so it's spoken correctly rather than falling back to the default
    // English voice.
    // Returns a `.dotbot-examples-wrap` (position:relative) containing the card plus a
    // color-coding on/off toggle button living OUTSIDE it on the right edge, hidden under the
    // card by default and sliding out on hover (same hover-slide mechanic as the dictionary
    // card's nav arrows) — see .dotbot-examples-toggle in globals.css. The toggle is a grey
    // circle when highlighting is off and an rgb-gradient circle when it's on, and flips the
    // SAME global dotbotAlignHighlightOn switch that answerBlocks example pills also read (see
    // applyAlignHighlightToggle) — one switch for all word-alignment highlighting on screen, not
    // just this panel's own sentences.
    function buildExamplesCard(panel) {
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-examples-wrap';
        const card = document.createElement('div');
        card.className = 'dotbot-examples-card';
        wrap.appendChild(card);
        const language = panel.language || '';
        (panel.sentences || []).forEach(s => {
            const wrap = document.createElement('div');
            wrap.className = 'dotbot-example-sentence-wrap';
            const { textEl, translitEl, translationEl } = buildAlignedSentenceEls(s);
            const textRow = document.createElement('div');
            textRow.className = 'dotbot-example-sentence-row';
            const speakBtn = document.createElement('button');
            speakBtn.className = 'tts-btn dotbot-example-audio-btn';
            speakBtn.type = 'button';
            speakBtn.title = 'Play pronunciation';
            speakBtn.innerHTML = speakerIconHTML();
            speakBtn.onclick = (e) => { e.stopPropagation(); speakText(s.text, language, speakBtn); };
            textRow.appendChild(textEl);
            textRow.appendChild(speakBtn);
            wrap.appendChild(textRow);
            if (translitEl) wrap.appendChild(translitEl);
            if (translationEl) wrap.appendChild(translationEl);
            setupDotbotResultDrag(wrap, {
                kind: 'sentence',
                w: 220, h: 130,
                text: s.text || '',
                translit: s.romanization || '',
                translation: translationEl ? s.translation : '',
                html: [s.text, s.romanization, translationEl ? s.translation : ''].filter(Boolean).join(' — '),
            });
            card.appendChild(wrap);
        });
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'dotbot-examples-toggle';
        toggleBtn.title = 'Toggle word color-coding';
        const syncToggleIcon = () => toggleBtn.classList.toggle('is-on', dotbotAlignHighlightOn);
        syncToggleIcon();
        toggleBtn.onclick = (e) => { e.stopPropagation(); applyAlignHighlightToggle(!dotbotAlignHighlightOn); syncToggleIcon(); };
        wrap.appendChild(toggleBtn);
        return wrap;
    }
    // A small, focused panel for direct translation-style queries ("how do you say X in Y",
    // "what does X mean") — see the "translation" field in lib/dotbot.js. Just a word pill with
    // its language labeled above it, an arrow, then an identical pill+label for the translated
    // word — deliberately simpler than the dictionary card (no IPA/audio/grammar info, that's
    // what the dictionary panel above the arrow... below, rather, is for when it's also present).
    function buildTranslationCard(panel) {
        const card = document.createElement('div');
        card.className = 'dotbot-translation-card';
        const buildSide = (word, language) => {
            const side = document.createElement('div');
            side.className = 'dotbot-translation-side';
            const langEl = document.createElement('div');
            langEl.className = 'dotbot-translation-lang';
            langEl.textContent = language || '';
            const pillEl = document.createElement('div');
            pillEl.className = 'dotbot-translation-pill';
            pillEl.textContent = word || '';
            side.appendChild(langEl);
            side.appendChild(pillEl);
            return side;
        };
        card.appendChild(buildSide(panel.sourceWord, panel.sourceLanguage));
        const arrowEl = document.createElement('div');
        arrowEl.className = 'dotbot-translation-arrow';
        arrowEl.textContent = '→';
        card.appendChild(arrowEl);
        card.appendChild(buildSide(panel.targetWord, panel.targetLanguage));
        setupDotbotResultDrag(card, {
            w: 220, h: 100,
            html: `${panel.sourceLanguage}: ${panel.sourceWord} → ${panel.targetLanguage}: ${panel.targetWord}`,
        });
        return card;
    }
    function renderTranslationPanel(panel) {
        if (!searchTranslation) return;
        searchTranslation.innerHTML = '';
        if (!panel || !panel.sourceWord || !panel.targetWord) { searchTranslation.style.display = 'none'; return; }
        searchTranslation.appendChild(buildTranslationCard(panel));
        searchTranslation.style.display = 'block';
    }
    function renderDictionaryPanel(panel) {
        searchDictionary.innerHTML = '';
        if (!panel || !panel.entries || !panel.entries.length) { searchDictionary.style.display = 'none'; return; }
        searchDictionary.appendChild(buildDictionaryCard(panel));
        searchDictionary.style.display = 'block';
    }
    function renderExamplesPanel(panel) {
        searchExamples.innerHTML = '';
        if (!panel) { searchExamples.style.display = 'none'; return; }
        searchExamples.appendChild(buildExamplesCard(panel));
        searchExamples.style.display = 'block';
    }
    // Shown below Dotbot's answer only when it couldn't help with the query (canHelp:false) —
    // gives the user 3 generic searches to click instead of a dead end. Same row markup/click
    // idiom as every other suggestion row in the app: fill the box, commence the search.
    function renderRecommendedSearchesPanel(panel) {
        if (!searchRecommended) return;
        searchRecommended.innerHTML = '';
        if (!panel || !panel.queries || !panel.queries.length) { searchRecommended.style.display = 'none'; return; }
        panel.queries.forEach(q => {
            const div = document.createElement('div');
            div.className = 'search-suggestion-item';
            div.textContent = q;
            div.onclick = (e) => { e.stopPropagation(); searchInput.value = q; autoGrowSearchInput(); commenceSearchOrMnemonic(q); };
            searchRecommended.appendChild(div);
        });
        searchRecommended.style.display = 'block';
    }
    // Dotbot's written answer — just another panel like dictionary/examples, not a chat surface.
    // Height grows naturally with the (typed-out) text as it wraps; draggable onto the canvas
    // like any other Dotbot result.
    function renderDotbotAnswerPanel(text) {
        searchDotbotAnswer.innerHTML = '';
        if (!text) { searchDotbotAnswer.style.display = 'none'; return; }
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-answer-text dotbot-result-card';
        searchDotbotAnswer.appendChild(textEl); // append BEFORE typewriterReveal — it checks
        // el.isConnected on its first tick and silently no-ops forever otherwise.
        searchDotbotAnswer.style.display = 'block';
        setupDotbotResultDrag(textEl, { w: 240, h: 140, html: text });
        typewriterReveal(textEl, text, updateSearchDropdown);
    }
    // The in-depth continuation of a grammar/explanation answer — an ordered sequence of prose
    // paragraphs and highlighted example-sentence pills (see the "answerBlocks" field in
    // lib/dotbot.js), appended into the SAME #search-dotbot-answer container as the short
    // dotbotText intro above it (never a separate panel), so it visually reads as one continuous
    // answer. Rendered instantly, not via typewriterReveal — coordinating a character-by-character
    // reveal across mixed prose/highlighted-example content isn't worth the complexity here.
    // `language` (the dictionary entry's or standalone examples panel's own language, whichever
    // this response actually has — see renderOrchestrateResult) powers each example pill's own
    // TTS button, same convention as buildExamplesCard.
    function renderAnswerBlocksPanel(panel, language) {
        if (!panel || !panel.blocks || !panel.blocks.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-answer-blocks';
        panel.blocks.forEach(b => {
            if (b.type === 'text') {
                const p = document.createElement('div');
                p.className = 'dotbot-answer-block-text';
                p.textContent = b.content || '';
                wrap.appendChild(p);
            } else if (b.type === 'example') {
                const pill = document.createElement('div');
                pill.className = 'dotbot-answer-example-pill';
                const { textEl, translitEl, translationEl } = buildAlignedSentenceEls(b);
                const textRow = document.createElement('div');
                textRow.className = 'dotbot-example-sentence-row';
                const speakBtn = document.createElement('button');
                speakBtn.className = 'tts-btn dotbot-example-audio-btn';
                speakBtn.type = 'button';
                speakBtn.title = 'Play pronunciation';
                speakBtn.innerHTML = speakerIconHTML();
                speakBtn.onclick = (e) => { e.stopPropagation(); speakText(b.text, language, speakBtn); };
                textRow.appendChild(textEl);
                textRow.appendChild(speakBtn);
                pill.appendChild(textRow);
                if (translitEl) pill.appendChild(translitEl);
                if (translationEl) pill.appendChild(translationEl);
                setupDotbotResultDrag(pill, {
                    kind: 'sentence',
                    w: 220, h: 130,
                    text: b.text || '',
                    translit: b.romanization || '',
                    translation: translationEl ? b.translation : '',
                    html: [b.text, b.romanization, translationEl ? b.translation : ''].filter(Boolean).join(' — '),
                });
                wrap.appendChild(pill);
            }
        });
        if (!wrap.children.length) return;
        searchDotbotAnswer.appendChild(wrap);
        searchDotbotAnswer.style.display = 'block';
    }

    // ---------- Orchestrated search: one AI call decides which panels are useful. Canvas
    // results keep the fixed slot they already rendered into synchronously, before the network
    // call even started, to avoid layout jank. A written Dotbot answer (when it has one) is
    // the top/first panel in the stack; dictionary/examples are preferred over writing text
    // where possible, so they're common even without an answer panel above them. The search bar
    // itself never moves. ----------
    function renderDotbotOrchestrateError(reason) {
        const msg = dotbotErrorMessage(reason);
        searchSuggestions.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'search-suggestion-item';
        errEl.textContent = msg;
        searchSuggestions.appendChild(errEl);
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        if (reason === 'no_credits') { dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }

    // A short, plain-text description of one attached card for the AI's context block — reuses
    // the same text-extraction rules as getItemSearchText/stripHtml, but written against a
    // snapshot's own fields (tableData/tasks/cards/html) rather than assuming a live item, since
    // card-context entries are always snapshots (see addCardsToSearchContext).
    // Structured (not prose) source info for the AI's "Sources attached to this query" block —
    // only "source" cards resolve (a plain "table" or "folder" card is never AI-editable, see
    // applyAiAddRowsToSource) since that function needs snapshot.folderId to reach the LIVE
    // folder later, and only a source snapshot carries one.
    function sourceContextForAI(snapshot) {
        if (snapshot.kind !== 'source') return null;
        const table = (snapshot.snapshotChildren || []).find(c => c.kind === 'table');
        if (!table) return null;
        return {
            headers: (table.tableData[0] || []).map(c => stripHtml(c || '')),
            rowCount: Math.max(0, (table.tableData || []).length - 1),
        };
    }

    function describeCardForAI(snapshot) {
        const label = miniLabelForItem(snapshot);
        let text;
        if (snapshot.kind === 'table' || snapshot.kind === 'source' || snapshot.kind === 'folder') {
            const table = snapshot.kind === 'table' ? snapshot : (snapshot.snapshotChildren || []).find(c => c.kind === 'table');
            text = table ? (table.tableData || []).map(row => row.map(c => stripHtml(c || '')).join(' ')).join(' | ') : (snapshot.snapshotTitle || '');
        } else if (snapshot.kind === 'checklist') {
            text = (snapshot.tasks || []).map(t => t.text).join('; ');
        } else if (snapshot.kind === 'flashcard' || snapshot.kind === 'typeright') {
            text = (snapshot.cards || []).map(c => `${c.front} - ${c.back}`).join('; ');
        } else if (snapshot.kind === 'bookmark') {
            text = snapshot.html || snapshot.bookmarkUrl || '';
        } else if (snapshot.kind === 'embed') {
            text = snapshot.embedUrl || '';
        } else if (snapshot.kind === 'filter') {
            const tagCount = (snapshot.filterTagIds || []).length;
            text = tagCount ? `filters by ${tagCount} tag(s), match ${(snapshot.filterMode || 'or').toUpperCase()}` : 'no tags selected yet';
        } else {
            text = stripHtml(snapshot.html || '');
        }
        return `[${label}] ${text}`.trim();
    }

    async function commenceDotbotSearch(query) {
        query = (query || '').trim();
        if (!query || dotbotScheduleConversation) return;
        searchInputWrap.classList.remove('idle-pulsing'); // redundant when reached via commenceSearchOrMnemonic, needed for direct callers like selectionToolbarLookUp
        dotbotSearchGeneration++; // same reasoning — redundant via commenceSearchOrMnemonic, needed for direct callers
        bumpAchievementStat('twenty_searches');
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const matches = folderObj.isSource ? computeSourceMatches(query) : computeCanvasMatches(query);
        renderCanvasResultsPanel(matches, folderObj.isSource); // instant, sync — visible before the spinner even shows
        searchDotbotAnswer.innerHTML = ''; searchDotbotAnswer.style.display = 'none';
        searchDictionary.innerHTML = ''; searchDictionary.style.display = 'none';
        searchExamples.innerHTML = ''; searchExamples.style.display = 'none';
        if (searchImageResult) { searchImageResult.innerHTML = ''; searchImageResult.style.display = 'none'; }
        searchSuggestions.innerHTML = ''; searchSuggestions.style.display = 'none';
        if (searchRecommended) { searchRecommended.innerHTML = ''; searchRecommended.style.display = 'none'; }
        clearTimeout(dotbotSuggestDebounceTimer);
        if (dotbotSuggestAbortController) dotbotSuggestAbortController.abort();
        searchSpinner.classList.add('visible');
        searchInputWrap.classList.add('loading');
        try {
            const res = await fetch('/api/dotbot/orchestrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    canvasMatches: matches.map(m => folderObj.isSource
                        ? { id: m.ri, kind: 'row', label: m.text.slice(0, 60) }
                        : { id: m.it.id, kind: m.it.kind, label: (m.text || '').slice(0, 60) }),
                    isSourceFolder: folderObj.isSource,
                    cardContext: searchCardContext.length ? searchCardContext.map(c => describeCardForAI(c.snapshot)) : undefined,
                    cardConnections: searchCardConnections.length ? searchCardConnections.map(c => {
                        const from = searchCardContext.find(sc => sc.id === c.fromId);
                        const to = searchCardContext.find(sc => sc.id === c.toId);
                        return `${from ? miniLabelForItem(from.snapshot) : c.fromId} -> ${to ? miniLabelForItem(to.snapshot) : c.toId}`;
                    }) : undefined,
                    // Numbered the same way as cardContext above (both mapped from searchCardContext
                    // in the same order) so the server can tell the model "source #N" and get back a
                    // targetIndex that points at the right live card — see applyAiAddRowsToSource.
                    sourceContext: searchCardContext.length ? searchCardContext.map((c, i) => {
                        const info = sourceContextForAI(c.snapshot);
                        return info ? Object.assign({ index: i + 1 }, info) : null;
                    }).filter(Boolean) : undefined
                })
            });
            const data = await res.json();
            searchSpinner.classList.remove('visible');
            searchInputWrap.classList.remove('loading');
            searchInput.blur(); // forces the border back to its plain unfocused state, not whatever :focus/:hover would otherwise show
            searchInput.value = '';
            autoGrowSearchInput();
            if (!res.ok) { renderDotbotOrchestrateError(data.error); return; }
            refreshDotbotUsage();
            renderOrchestrateResult(data.panels || []);
        } catch (e) {
            searchSpinner.classList.remove('visible');
            searchInputWrap.classList.remove('loading');
            searchInput.blur();
            searchInput.value = '';
            autoGrowSearchInput();
            console.error('[dotbot/orchestrate] failed:', e);
            renderDotbotOrchestrateError('error');
        }
    }

    function renderOrchestrateResult(panels) {
        // Fresh per result — every aligned sentence element built below (dictionary's examples,
        // and any answerBlocks example pills) registers itself here so the examples panel's
        // color-coding toggle can re-render them in place (see applyAlignHighlightToggle); a
        // stale registry would otherwise keep referencing long-gone elements from a prior search.
        dotbotAlignedRegistry = [];
        const textPanel = panels.find(p => p.type === 'dotbot_text');
        renderDotbotAnswerPanel(textPanel ? textPanel.text : null);
        // Its own small panel, shown above the dictionary panel — only for direct
        // translation-style queries (see lib/dotbot.js's "translation" field).
        renderTranslationPanel(panels.find(p => p.type === 'translation') || null);
        const dictPanel = panels.find(p => p.type === 'dictionary') || null;
        renderDictionaryPanel(dictPanel);
        // Always rendered independently now — dictionary entries no longer carry their own
        // sentences (see buildDictionaryCard), so "examples" is the one place they come from
        // whether or not a dictionary panel is also present.
        const examplesPanel = panels.find(p => p.type === 'examples') || null;
        renderExamplesPanel(examplesPanel);
        // The in-depth continuation of a grammar/explanation answer, appended below the short
        // dotbotText intro (see renderAnswerBlocksPanel) — reuses whichever language this
        // response's dictionary/examples panel already carries so its example pills' TTS
        // buttons speak correctly, rather than needing their own separate language field.
        const answerLanguage = (dictPanel && dictPanel.entries && dictPanel.entries[0] && dictPanel.entries[0].language) || (examplesPanel && examplesPanel.language) || '';
        renderAnswerBlocksPanel(panels.find(p => p.type === 'answer_blocks') || null, answerLanguage);
        renderRecommendedSearchesPanel(panels.find(p => p.type === 'recommended_searches') || null);
        // Applies the mutation directly rather than rendering a confirmation panel of its own —
        // "dotbotText" above already reads as the confirmation (see the prompt), and the change
        // is immediately visible on the actual card/canvas.
        const sourceActionPanel = panels.find(p => p.type === 'source_action');
        if (sourceActionPanel) {
            if (sourceActionPanel.action === 'create_source') createSourceFromAI(sourceActionPanel.title, sourceActionPanel.columns, sourceActionPanel.rows);
            else if (sourceActionPanel.action === 'add_rows') applyAiAddRowsToSource(sourceActionPanel.targetIndex, sourceActionPanel.columns, sourceActionPanel.rows);
        }
        updateSearchDropdown();
    }

    // ---------- Text selection toolbar (copy / paste / look up / add to source) ----------
    // Fires on every selection change anywhere in the document; only reacts when the selection
    // is non-empty AND lives inside an actual editable surface — [contenteditable="true"] is the
    // only kind of element CSS grants user-select:text to at all (see the global `*{user-select:
    // none}` reset plus its `[contenteditable="true"], input, textarea{user-select:text}`
    // override in globals.css), so this can't fire for arbitrary page chrome.
    let selectionToolbarEl = null;
    let selectionToolbarRange = null; // cloned Range, captured at the moment the toolbar shows
    let selectionToolbarHostEl = null; // the [contenteditable] element the selection lives in
    let selectionToolbarRect = null; // last shown position, reused to place the add-to-source popup nearby
    function ensureSelectionToolbarEl() {
        if (selectionToolbarEl) return selectionToolbarEl;
        selectionToolbarEl = document.createElement('div');
        selectionToolbarEl.id = 'selection-toolbar';
        selectionToolbarEl.className = 'selection-toolbar';
        // mousedown (not click) is what the browser uses to collapse the current selection —
        // preventing it here is what lets a toolbar button act on the selection that's still
        // highlighted the moment it's clicked, instead of it having already vanished.
        selectionToolbarEl.onmousedown = (e) => e.preventDefault();
        // Two independently-styled pill buttons (not one shared bordered bar) — the outer
        // element is just a positioning wrapper (see .selection-toolbar's CSS).
        selectionToolbarEl.innerHTML = `
            <button type="button" class="selection-toolbar-btn" data-action="add">Add to...</button>
            <button type="button" class="selection-toolbar-btn" data-action="lookup">Look up</button>
        `;
        selectionToolbarEl.querySelector('[data-action="add"]').onclick = () => openAddToSourcePopup();
        selectionToolbarEl.querySelector('[data-action="lookup"]').onclick = () => selectionToolbarLookUp();
        document.body.appendChild(selectionToolbarEl);
        return selectionToolbarEl;
    }
    function hideSelectionToolbar() {
        if (selectionToolbarEl) selectionToolbarEl.style.display = 'none';
        selectionToolbarRange = null;
        selectionToolbarHostEl = null;
    }
    function currentSelectionText() {
        return selectionToolbarRange ? selectionToolbarRange.toString() : '';
    }
    // Shared by both selection sources: the plain document-level listener below (contentEditable
    // cards and PDF text layers — both live in the main document) and buildEpubViewer's
    // rendition.on('selectedRange', ...) hook (EPUB content lives inside its own same-origin
    // iframe, whose Range coordinates are relative to THAT iframe, not the main page — rectOverride
    // lets that caller supply the already-offset page-relative rect instead of range.getBoundingClientRect()).
    function showSelectionToolbarFor(range, host, rectOverride) {
        selectionToolbarRange = range;
        selectionToolbarHostEl = host;
        const toolbar = ensureSelectionToolbarEl();
        const rect = rectOverride || range.getBoundingClientRect();
        selectionToolbarRect = rect;
        toolbar.style.display = 'flex';
        // Clamped so a selection near the top/left edge of the screen doesn't push the toolbar
        // off-screen — same 20px-from-edge convention used elsewhere (positionHamburgerMenu etc).
        const toolbarWidth = 150; // rough estimate ahead of layout (two small pills); good enough for clamping
        let left = Math.round(rect.left + rect.width / 2 - toolbarWidth / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));
        toolbar.style.left = left + 'px';
        toolbar.style.top = Math.max(8, Math.round(rect.top - 40)) + 'px';
    }
    document.addEventListener('selectionchange', () => {
        // A selectionchange firing because the user is typing inside the add-to-source popup's
        // own search box isn't a text highlight to react to.
        if (addToSourcePopupEl && addToSourcePopupEl.style.display !== 'none') return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideSelectionToolbar(); return; }
        const anchorEl = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        // .pdf-text-layer alongside the usual [contenteditable] — pdf.js's TextLayer renders real,
        // positioned, selectable <span>s directly into the main document (no iframe involved for
        // PDFs, unlike EPUB above), so it Just Works here once recognized as a valid host — see
        // buildPdfViewer.
        const host = anchorEl && anchorEl.closest && anchorEl.closest('[contenteditable="true"], .pdf-text-layer');
        if (!host) { hideSelectionToolbar(); return; }
        showSelectionToolbarFor(sel.getRangeAt(0).cloneRange(), host);
    });
    // Outside click hides it — same convention as the game options panel's own document-level
    // pointerdown listener.
    document.addEventListener('pointerdown', (e) => {
        if (selectionToolbarEl && selectionToolbarEl.style.display !== 'none' && !selectionToolbarEl.contains(e.target)) hideSelectionToolbar();
    });
    // Always phrased as an explicit meaning/translation question — never just the bare selected
    // text — so the orchestrate model reliably returns the "dictionary" panel (its own prompt,
    // see lib/dotbot.js, only fills that panel "for a word/phrase meaning question"; a bare
    // word or phrase alone doesn't reliably read as one). Shown in the search bar exactly as
    // sent, matching how recommended-search pills elsewhere already show full natural-language
    // questions rather than bare words.
    function selectionToolbarLookUp() {
        const text = currentSelectionText().trim();
        hideSelectionToolbar();
        if (!text || !searchInput) return;
        const query = `What does "${text}" mean?`;
        searchInput.value = query;
        autoGrowSearchInput();
        commenceDotbotSearch(query);
        searchInput.focus();
    }

    // ---------- Add to source popup ----------
    // Every source is a folder with isSource:true holding exactly one 'table' item (see
    // add()'s 'source' branch) — `folders` is a flat map of EVERY folder in the account (not
    // nested), so this is a full account-wide list, not just the current canvas.
    let addToSourcePopupEl = null;
    let addToSourceTarget = null; // {folder, table} — the currently chosen destination
    function findAllSourceFolders() {
        return Object.values(appState.folders).filter(f => f.isSource && f.items.some(i => i.kind === 'table'));
    }
    // Picks the default destination, in priority order: (1) we're editing inside a source's own
    // table already, (2) the item being edited IS a source card, (3) the item being edited is
    // connected (a drawn canvas connection) to a source card, (4) the geometrically nearest
    // source card in the same folder, (5) the first source anywhere in the account.
    function findDefaultSourceForItem(hostEl) {
        const folder = appState.folders[appState.currentFolderId];
        if (!folder) return null;
        const tableOf = (f) => f && f.items.find(i => i.kind === 'table');
        if (folder.isSource) {
            const table = tableOf(folder);
            if (table) return { folder, table };
        }
        const itemEl = hostEl && hostEl.closest ? hostEl.closest('.item') : null;
        const itemId = itemEl && itemEl.id ? Number(itemEl.id.replace('item-', '')) : null;
        const it = itemId != null ? folder.items.find(i => i.id === itemId) : null;
        if (it && it.kind === 'source') {
            const table = tableOf(appState.folders[it.folderId]);
            if (table) return { folder: appState.folders[it.folderId], table };
        }
        if (it) {
            const conns = ensureConnections(folder);
            const connectedIds = conns.filter(c => c.fromId === it.id || c.toId === it.id)
                .map(c => c.fromId === it.id ? c.toId : c.fromId);
            for (const cid of connectedIds) {
                const other = folder.items.find(i => i.id === cid);
                if (other && other.kind === 'source') {
                    const table = tableOf(appState.folders[other.folderId]);
                    if (table) return { folder: appState.folders[other.folderId], table };
                }
            }
        }
        if (it) {
            const sources = folder.items.filter(i => i.kind === 'source' && tableOf(appState.folders[i.folderId]));
            if (sources.length) {
                let best = null, bestDist = Infinity;
                sources.forEach(s => {
                    const dx = (s.x || 0) - (it.x || 0), dy = (s.y || 0) - (it.y || 0);
                    const d = dx * dx + dy * dy;
                    if (d < bestDist) { bestDist = d; best = s; }
                });
                if (best) return { folder: appState.folders[best.folderId], table: tableOf(appState.folders[best.folderId]) };
            }
        }
        const anySourceFolder = findAllSourceFolders()[0];
        return anySourceFolder ? { folder: anySourceFolder, table: tableOf(anySourceFolder) } : null;
    }
    function ensureAddToSourcePopupEl() {
        if (addToSourcePopupEl) return addToSourcePopupEl;
        addToSourcePopupEl = document.createElement('div');
        addToSourcePopupEl.id = 'add-to-source-popup';
        addToSourcePopupEl.className = 'add-to-source-popup';
        addToSourcePopupEl.onmousedown = (e) => e.stopPropagation();
        document.body.appendChild(addToSourcePopupEl);
        return addToSourcePopupEl;
    }
    function closeAddToSourcePopup() {
        if (addToSourcePopupEl) addToSourcePopupEl.style.display = 'none';
        addToSourceTarget = null;
    }
    document.addEventListener('pointerdown', (e) => {
        if (addToSourcePopupEl && addToSourcePopupEl.style.display !== 'none' && !addToSourcePopupEl.contains(e.target)) closeAddToSourcePopup();
    });
    // Rebuilt from scratch on every change (source search, source pick) — this popup's whole
    // state is small and short-lived, same tradeoff renderGameOptionsHTML makes.
    // Reuses the SAME markup/classes a real source page renders its column-pill row and data
    // row with (buildHeaderPillsHTML's .col-name-slot/.col-name-pill/.col-name-input,
    // renderStaticTableHTML's .table-rounded/.item-table/.cell-inner/.cell-text, colgroupHTML)
    // so this entry looks pixel-identical to one row of the real thing — just without that
    // system's dynamic pixel-based column-width/scroll JS (layoutSourceTableColumns), which is
    // wired to a real mounted card's own resize lifecycle; equal percentage widths here (via
    // colgroupHTML itself, already percentage-based) give the same aligned look for a fixed-width
    // popup with a normal number of columns.
    function renderAddToSourcePopup(prefillText) {
        const popup = ensureAddToSourcePopupEl();
        const target = addToSourceTarget;
        const table = target ? target.table : null;
        const headers = table ? table.tableData[0].map(h => stripHtml(h || '')) : [];
        const numCols = headers.length;
        const pillWidth = numCols ? (100 / numCols).toFixed(4) : 100;
        const pillsHTML = headers.map((h, i) => `
            <div class="col-name-slot" style="width:${pillWidth}%">
                <div class="col-name-pill"><input type="text" class="col-name-input" readonly value="${escapeHtml(h)}" placeholder="Column ${i + 1}"></div>
            </div>`).join('');
        const cg = colgroupHTML(numCols);
        const cellsHTML = headers.map((_, i) => `
            <td>
                <div class="cell-inner">
                    <div class="cell-text add-to-source-cell-input" contenteditable="true" data-col="${i}">${i === 0 ? escapeHtml(prefillText || '') : ''}</div>
                </div>
            </td>`).join('');
        const entryHTML = numCols
            ? `<div class="add-to-source-entry">
                   <div class="add-to-source-entry-table">
                       <div class="static-table-header-track">${pillsHTML}</div>
                       <div class="static-table-row"><div class="table-rounded"><table class="item-table">${cg}<tbody><tr>${cellsHTML}</tr></tbody></table></div></div>
                   </div>
                   <button type="button" class="add-to-source-add-btn" title="Add entry"><img src="/assets/icons/add-btn.png" alt="Add"></button>
               </div>`
            : `<div class="add-to-source-empty">This source has no columns yet — open it to add one first.</div>`;
        popup.innerHTML = `
            <input type="text" class="add-to-source-search" placeholder="Search sources by name…" value="${target ? escapeHtml(target.folder.title) : ''}">
            <div class="add-to-source-results"></div>
            ${target ? entryHTML : `<div class="add-to-source-empty">No sources yet — create one from the Add menu first.</div>`}
        `;
        const searchEl = popup.querySelector('.add-to-source-search');
        const resultsEl = popup.querySelector('.add-to-source-results');
        searchEl.onmousedown = (e) => e.stopPropagation();
        searchEl.oninput = () => {
            const q = searchEl.value.trim().toLowerCase();
            if (!q) { resultsEl.innerHTML = ''; resultsEl.classList.remove('open'); return; }
            const matches = findAllSourceFolders().filter(f => f.title.toLowerCase().includes(q)).slice(0, 8);
            resultsEl.innerHTML = matches.length
                ? matches.map(f => `<div class="add-to-source-result" data-fid="${f.id}">${escapeHtml(f.title)}</div>`).join('')
                : `<div class="add-to-source-result add-to-source-no-match">No matches</div>`;
            resultsEl.classList.add('open');
            resultsEl.querySelectorAll('.add-to-source-result[data-fid]').forEach(row => {
                row.onclick = () => {
                    const f = appState.folders[row.dataset.fid];
                    addToSourceTarget = { folder: f, table: f.items.find(i => i.kind === 'table') };
                    renderAddToSourcePopup(prefillText);
                };
            });
        };
        const addBtn = popup.querySelector('.add-to-source-add-btn');
        if (addBtn) {
            addBtn.onclick = () => {
                // .innerHTML (not .value/.textContent) — matches how a real source cell is
                // stored (see updateTableCell: it.tableData[r][c] = el.innerHTML).
                const cells = Array.from(popup.querySelectorAll('.add-to-source-cell-input')).map(el => el.innerHTML);
                if (!cells.some(c => stripHtml(c).trim())) return;
                // saveSnapshot/scheduleWorkspaceSave both operate on the whole `folders` object,
                // not just the current one (see their own definitions) — safe to call here even
                // when the target source lives in a folder other than the one open right now.
                saveSnapshot();
                addToSourceTarget.table.tableData.push(cells);
                scheduleWorkspaceSave();
                if (appState.currentFolderId === addToSourceTarget.folder.id) render();
                closeAddToSourcePopup();
            };
        }
        popup.style.display = 'flex';
    }
    function openAddToSourcePopup() {
        const text = currentSelectionText();
        const host = selectionToolbarHostEl;
        const rect = selectionToolbarRect;
        hideSelectionToolbar();
        addToSourceTarget = findDefaultSourceForItem(host);
        renderAddToSourcePopup(text);
        const popup = addToSourcePopupEl;
        const popupWidth = 280;
        let left = rect ? Math.round(rect.left) : window.innerWidth / 2 - popupWidth / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
        const estPopupHeight = 280; // rough estimate ahead of layout, same tradeoff as toolbarWidth above
        const top = rect ? Math.max(8, Math.min(window.innerHeight - estPopupHeight - 8, Math.round(rect.bottom + 10))) : window.innerHeight / 2 - estPopupHeight / 2;
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
    }

    if (searchInput) {
        // Clicking the input again after it already has focus (e.g. right after a completed
        // search, which doesn't blur it) doesn't re-fire the browser's own `focus` event — so
        // onfocus="handleSearchFocus()" alone would silently do nothing until the next keystroke.
        // Calling it here too makes a click always reopen the initial-suggestion state.
        searchInput.addEventListener('click', (e) => { e.stopPropagation(); handleSearchFocus(); });
        searchInput.addEventListener('blur', updateSearchSpaceHint);
        // Clicking/tabbing away without submitting stops the idle pulse (see handleSearchFocus) —
        // Escape's own searchInput.blur() call elsewhere routes through this same listener too.
        searchInput.addEventListener('blur', () => searchInputWrap.classList.remove('idle-pulsing'));
        searchInput.addEventListener('keydown', (e) => {
            if (dotbotScheduleConversation) {
                if (e.key === 'Enter') { e.preventDefault(); submitDotbotScheduleAnswer(searchInput.value); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelDotbotScheduleConversation(); }
                return;
            }
            if (e.key === 'Escape') { clearSearch(); return; }
            // Mirrors the global Enter-to-open shortcut (see the document-level keydown handler,
            // which only fires while nothing's focused) — once the box itself is focused and still
            // empty, Enter closes it back up instead of submitting, so the same key toggles the
            // search bar open/closed depending on which state it's already in. Checked before the
            // general Enter-submits-search handler below, so a non-empty box still submits as usual.
            if (e.key === 'Enter' && searchInput.value.trim() === '') { e.preventDefault(); clearSearch(); searchInput.blur(); return; }
            if (e.key === 'ArrowDown' && searchResults.style.display === 'block') { e.preventDefault(); setSearchActive(searchActiveIndex + 1); return; }
            if (e.key === 'ArrowUp' && searchResults.style.display === 'block') { e.preventDefault(); setSearchActive(searchActiveIndex - 1); return; }
            // 1-4 pick a visible result directly (see the pill on each row — always max 4 shown,
            // see the .slice(0, 4) in matchesFor), the same one-key jump ArrowDown+Enter would
            // take several presses to reach. Only hijacks the digit when there's actually a
            // matching row to jump to — e.g. pressing "3" with only 2 results showing still types
            // a normal "3" into the query, same as it would with the dropdown closed entirely.
            if (['1', '2', '3', '4'].includes(e.key) && searchResults.style.display === 'block') {
                const items = Array.from(searchResults.querySelectorAll('.search-result-item'));
                const target = items[Number(e.key) - 1];
                if (target) { e.preventDefault(); target.click(); return; }
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                // Arrowed down to a specific canvas match — Enter jumps to that, same as clicking it.
                if (searchResults.style.display === 'block' && searchActiveIndex >= 0) {
                    const items = Array.from(searchResults.querySelectorAll('.search-result-item'));
                    const target = items[searchActiveIndex];
                    if (target) { target.click(); return; }
                }
                // Otherwise, Enter on whatever's typed commences a Dotbot search — or, for a
                // mnemonic-shaped query ("generate a mnemonic for X" / "my mnemonic for X is
                // Y"), routes straight into story+image generation instead (see
                // commenceSearchOrMnemonic/parseMnemonicIntent).
                const value = searchInput.value.trim();
                if (value) commenceSearchOrMnemonic(value);
            }
        });
    }

    // ---------- Waypoint card expand/collapse ----------
    // Three entry points, all sharing the same expand/collapse machinery: hovering the card
    // (read-only, stays open until mouseleave — see the waypoint branch in render()), a direct
    // click (editable — stays open until Enter/Escape/blur, and marks the card with
    // .waypoint-editing so hover/mouseleave leave it alone while typing is in progress), and a
    // jump from the Waypoints hub panel/search/hamburger menu (read-only "peek" — auto-collapses
    // after a couple seconds, unless a hover takes over first). Mirrors the contentEditable
    // placeholder/commit/revert pattern used for the canvas-title breadcrumb rename elsewhere in
    // this file: empty text node + data-placeholder + .crumb-placeholder for "New Waypoint" until
    // the first real keystroke, Enter commits via blur, Escape reverts the visible text then
    // blurs.
    const WAYPOINT_COLLAPSED_W = 28; // .item.waypoint's own base width — see globals.css
    // Width can't transition smoothly to/from CSS `width:auto` directly — browsers just snap
    // instead of animating when one end of a `width` transition is auto — so expanding measures
    // the natural (content-based) width first and drives an explicit px-to-px transition instead
    // of relying on the CSS class alone. `.expanded` is only removed once the width transition
    // has actually finished (not immediately) so the name text — which the CSS keys off that
    // same class — stays visible and gets naturally clipped away by overflow:hidden as the box
    // narrows, instead of vanishing in one frame while the box is still wide. Reads/writes the
    // CURRENT live width (via getBoundingClientRect, not an assumption of "at rest") so calling
    // either of these mid-transition — e.g. a hover collapse interrupted by a re-hover — reverses
    // smoothly from wherever the box actually is, not just from its resting states.
    // getBoundingClientRect() returns SCREEN-space pixels (post #world's own scale(scale)
    // transform), but el.style.width is a LOCAL/world-space CSS pixel value that gets scaled
    // AGAIN when the browser renders it — the two only coincide at exactly scale===1. Every
    // measurement below divides by `scale` to convert back to local space before assigning it as
    // a width, otherwise the zoom factor gets applied twice (e.g. at scale 1.5 a card sized
    // itself as if it were 1.5x too wide, then THAT got rendered 1.5x again).
    function expandWaypointCardWidth(el) {
        clearTimeout(el.__waypointWidthTimer);
        const startW = el.getBoundingClientRect().width / appState.scale;
        el.classList.add('expanded');
        el.style.width = ''; // let width:auto take over just long enough to measure the natural size
        const targetW = el.getBoundingClientRect().width / appState.scale;
        el.style.width = startW + 'px';
        void el.offsetWidth; // commit the start point before animating to the target
        el.style.width = targetW + 'px';
    }
    function collapseWaypointCardWidth(el) {
        clearTimeout(el.__waypointWidthTimer);
        el.style.width = (el.getBoundingClientRect().width / appState.scale) + 'px';
        void el.offsetWidth;
        el.style.width = WAYPOINT_COLLAPSED_W + 'px';
        el.__waypointWidthTimer = setTimeout(() => {
            el.classList.remove('expanded');
            el.style.width = '';
        }, 200); // matches .item.waypoint's own .18s width transition + a small buffer
    }
    let waypointPeekTimer = null;
    function expandWaypointCard(el, it, opts) {
        const nameEl = el.querySelector('.waypoint-card-name');
        if (!nameEl) return;
        if (opts && opts.editable) {
            el.classList.add('waypoint-editing');
            // A pending __waypointWidthTimer means a collapse is actively mid-shrink right now
            // (see collapseWaypointCardWidth) — .expanded is still true at this exact moment, but
            // el.style.width is some in-between, still-animating value, not the settled full
            // width. Treated the same as "not expanded yet" below (snap open fresh) rather than
            // freezing at whatever half-collapsed width happened to be live on this click.
            const wasCollapsing = !!el.__waypointWidthTimer;
            clearTimeout(el.__waypointWidthTimer);

            // Content must be set BEFORE the width:auto measurement below, not after — otherwise
            // the box measures/snaps to fit empty content first (all .waypoint-card-name has at
            // that point), then jumps a second time once the real name lands, instead of landing
            // on its final width in one step.
            const isDefaultName = !it.name;
            if (isDefaultName) { nameEl.textContent = ''; nameEl.setAttribute('data-placeholder', 'New Waypoint'); nameEl.classList.add('crumb-placeholder'); }
            else { nameEl.textContent = it.name; }

            // If a hover/peek already had it expanded, leave el.style.width completely alone —
            // it's already pinned to the exact content+padding width (see
            // expandWaypointCardWidth), and the whole point here is that clicking to edit must
            // not change the width at all, not even to the same value via a recompute. Only a
            // genuinely collapsed card (clicked directly, with no prior hover) needs to actually
            // open — instantly, no transition, since it's otherwise still animating open under
            // overflow:hidden while the caret is already (correctly) at the end, so the end of
            // the text — and the caret sitting on it — would only become visible progressively as
            // the box widens, reading as the caret itself lagging into place instead of landing
            // there instantly.
            if (wasCollapsing || !el.classList.contains('expanded')) {
                el.classList.add('waypoint-no-anim');
                el.classList.add('expanded');
                el.style.width = ''; // hand width back to the CSS class (width:auto) for this one instant snap
                void el.offsetWidth; // commit the instant width jump before re-enabling the transition
                el.classList.remove('waypoint-no-anim');
            }

            nameEl.contentEditable = true;
            broadcastEditingState(true);
            // contentEditable flips to true DURING this same click's dispatch, so the click still
            // has a pending default action that places the caret at the click coordinates — that
            // runs AFTER this handler returns and silently undoes a synchronous placement here
            // (same issue as the breadcrumb title rename above). Deferring to a fresh macrotask
            // runs after that default action has settled, so this placement is what actually
            // sticks; the synchronous call is just so there's no flash of a wrong caret position
            // first.
            placeCaretEnd(nameEl);
            setTimeout(() => placeCaretEnd(nameEl), 0);
            nameEl.onblur = () => {
                nameEl.contentEditable = false;
                broadcastEditingState(false);
                nameEl.classList.remove('crumb-placeholder');
                it.name = nameEl.textContent.trim();
                el.classList.remove('waypoint-editing');
                collapseWaypointCardWidth(el);
                scheduleWorkspaceSave();
                syncWaypointToDb(appState.currentFolderId, it);
            };
            nameEl.onkeydown = (ke) => {
                if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
                if (ke.key === 'Escape') { ke.preventDefault(); nameEl.textContent = isDefaultName ? '' : it.name; nameEl.blur(); }
            };
            // Without this the box only ever re-measures at snap-open and on blur (see below) —
            // it'd sit at whatever width it started editing with the entire time you type, only
            // snapping to fit the real content once you click away. Reusing expandWaypointCardWidth
            // itself (rather than duplicating its measure-then-animate logic) keeps every keystroke
            // animating smoothly to the new natural width exactly like the initial snap-open does.
            nameEl.oninput = () => expandWaypointCardWidth(el);
        } else {
            nameEl.textContent = it.name || 'New Waypoint';
            expandWaypointCardWidth(el);
            clearTimeout(waypointPeekTimer);
            // A hover has no fixed duration — mouseleave collapses it instead (see render()) — so
            // only the nav-triggered peek gets a timer.
            if (!(opts && opts.hover)) {
                waypointPeekTimer = setTimeout(() => collapseWaypointCardWidth(el), (opts && opts.peekMs) || 2000);
            }
        }
    }

    // Mirrors one waypoint item into the global `waypoints` table (see the 20260729 migration) —
    // the source of truth for the hamburger Waypoints panel, which lists EVERY waypoint this user
    // has ever dropped across their own canvases and any canvas shared with them, regardless of
    // whether that canvas's folder data happens to be loaded locally right now (a friend's canvas
    // 300 layers deep isn't fetched until you actually navigate into it — see
    // renderWaypointsList/goToWaypointCard below). Fire-and-forget; the canvas item itself already
    // holds the real data (name, position), this is just a searchable/global index of it, keyed by
    // the REAL (non shared:-namespaced) owner+folder id since that's what's stable across users.
    async function syncWaypointToDb(folderId, it) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
        const { error } = await supabase.from('waypoints').upsert({
            creator_id: appState.currentUser.id, owner_id: ownerId, folder_id: realFolderId, item_id: String(it.id),
            name: it.name || 'New Waypoint',
        }, { onConflict: 'owner_id,folder_id,item_id' });
        if (error) console.error('[waypoints] failed to sync waypoint:', error);
    }
    async function deleteWaypointFromDb(folderId, itemId) {
        if (!supabase || !appState.currentUser.id) return;
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
        const { error } = await supabase.from('waypoints').delete()
            .eq('owner_id', ownerId).eq('folder_id', realFolderId).eq('item_id', String(itemId));
        if (error) console.error('[waypoints] failed to remove waypoint:', error);
    }

    // Revokes every pending/accepted collaborator on ONE exact folder — reuses
    // revoke_canvas_collaboration, the same RPC the Collaborations panel's own per-collaborator
    // "remove" button already calls (see revokeCanvasCollab), rather than a new bulk-delete RPC.
    // "Revoked" (not a hard delete of the row) is enough for the folder to disappear from both the
    // owner's and every collaborator's Collaborations list: both of refreshCanvasCollabData's
    // queries filter to status in ('pending','accepted') (see renderHubCollabList). Owner-only —
    // revoke_canvas_collaboration is auth.uid()-scoped with no owner-id parameter, so this can only
    // run against a canvas the current user actually owns; see cascadeDeleteFolderContents below
    // for why that's always true everywhere this gets called from.
    async function deleteCanvasCollabsForFolder(folderId) {
        if (!supabase || !appState.currentUser.id) return;
        const { data, error } = await supabase.from('canvas_collaborations').select('collaborator_id')
            .eq('owner_id', appState.currentUser.id).eq('folder_id', folderId).in('status', ['pending', 'accepted']);
        if (error) { console.error('[collab] failed to look up collaborators for deleted folder:', error); return; }
        await Promise.all((data || []).map(r =>
            supabase.rpc('revoke_canvas_collaboration', { p_folder_id: folderId, p_collaborator_id: r.collaborator_id })
        ));
    }

    // Recursively cleans up everything a deleted folder/source card owned: nested waypoints
    // (removed from the creator's global Waypoints list, same as a directly-deleted waypoint card
    // — see deleteSelectedCards), collaborators on this canvas AND every nested canvas inside it
    // (removed from the Collaborations list, see deleteCanvasCollabsForFolder above), and finally
    // the orphaned folders[] entry itself (the same structural cleanup deleteClonedItemFolders does
    // for a canceled duplicate, just also handling the two DB-backed concerns above along the way).
    // Skips the collaborator cleanup step entirely while folderObj.isSharedView is true — that only
    // happens at the ROOT of this recursion (a nested folder inside a tree you own is never itself
    // a shared view — sharing doesn't work by embedding a foreign owner's canvas inside your own),
    // and it means the current user is a collaborator, not the real owner, deleting content inside
    // someone else's shared canvas. revoke_canvas_collaboration has no permission path for that (see
    // its own comment), so there's nothing safe to do here but skip — any collaborators the real
    // owner added to that specific nested canvas are left for the owner to clean up themselves.
    async function cascadeDeleteFolderContents(folderId) {
        const folderObj = appState.folders[folderId];
        if (!folderObj) return;
        for (const item of (folderObj.items || [])) {
            if (item.kind === 'waypoint') {
                deleteWaypointFromDb(folderId, item.id);
            } else if ((item.kind === 'folder' || item.kind === 'source') && item.folderId) {
                await cascadeDeleteFolderContents(item.folderId);
            }
        }
        if (!folderObj.isSharedView) {
            await deleteCanvasCollabsForFolder(folderId);
        }
        delete appState.folders[folderId];
    }

    // Static, real-content preview for a folder card's body — same mini-card rendering
    // (renderRealCardPreview) as renderInlineCanvas's marketplace/chat preview, but with no
    // interactivity of its own: no pan, no zoom slider, no in-place drill-down. The whole card
    // is a single click target (see the 'folder' branch in render()) — dragging it moves the
    // card on the real canvas like any other card, it does not pan this preview. Content is
    // auto zoomed-to-fit and centered, floored at 25% so a very large/sprawling nested canvas
    // still reads as *something* rather than shrinking to illegibility. Reads
    // folders[folderId].items live (not a snapshot) since render() rebuilds this fresh on every
    // call anyway.
    function buildFolderInlineCanvas(folderId) {
        const viewport = document.createElement('div');
        viewport.className = 'msg-inline-canvas';
        const world = document.createElement('div');
        world.className = 'msg-inline-canvas-world';
        viewport.appendChild(world);

        const MINI_ZOOM_MAX = 2, MINI_ZOOM_FIT_MIN = 0.25, MINI_ZOOM_FIT_PADDING = 24;
        let contentW = 1, contentH = 1;
        function centerView() {
            const rect = viewport.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const fitZoom = Math.min(
                (rect.width - MINI_ZOOM_FIT_PADDING * 2) / contentW,
                (rect.height - MINI_ZOOM_FIT_PADDING * 2) / contentH
            );
            const vZoom = Math.max(MINI_ZOOM_FIT_MIN, Math.min(MINI_ZOOM_MAX, fitZoom));
            const vPanX = (rect.width - contentW * vZoom) / 2;
            const vPanY = (rect.height - contentH * vZoom) / 2;
            world.style.transform = `translate(${vPanX}px, ${vPanY}px) scale(${vZoom})`;
            viewport.style.backgroundPosition = `${vPanX}px ${vPanY}px`;
            viewport.style.backgroundSize = `${28 * vZoom}px ${28 * vZoom}px`;
        }

        const items = (appState.folders[folderId] && appState.folders[folderId].items) || [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(it => {
            const w = it.w || 100, h = it.h || 60;
            minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
            maxX = Math.max(maxX, it.x + w); maxY = Math.max(maxY, it.y + h);
        });
        if (!items.length) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
        contentW = Math.max(1, maxX - minX);
        contentH = Math.max(1, maxY - minY);

        items.forEach(it => {
            const w = it.w || 100, h = it.h || 60;
            const mini = renderRealCardPreview(it);
            mini.style.position = 'absolute';
            mini.style.left = (it.x - minX) + 'px';
            mini.style.top = (it.y - minY) + 'px';
            if (it.kind !== 'title') {
                mini.style.width = w + 'px';
                mini.style.height = h + 'px';
            }
            mini.style.pointerEvents = 'none';
            mini.title = miniLabelForItem(it);
            world.appendChild(mini);
        });

        requestAnimationFrame(centerView);
        return viewport;
    }

    // Inline-rename a folder card's title, right on the card — same contentEditable
    // click-to-edit flow as the breadcrumb rename (see the crumb-item span.onclick further down),
    // just parameterized on `it.folderId` instead of always being currentFolderId. Writes to the
    // exact same folders[folderId].title the breadcrumb writes to, so the two stay in sync for
    // free — no separate propagation needed, they're just two editors of the same property.
    // Guarded on folders[it.folderId] existing at all: a folder card nested INSIDE a canvas
    // someone else shared with you is a static, non-drillable preview (see the sharing scope note
    // in 20260726_add_canvas_collaboration.sql) with no local data to rename in the first place.
    function startRenameFolderCardTitle(titleEl, it, editingClass) {
        editingClass = editingClass || 'folder-card-title';
        const folderId = it.folderId;
        if (!appState.folders[folderId] || titleEl.contentEditable === 'true') return;
        saveSnapshot();
        const fullTitle = appState.folders[folderId].title;
        const isDefaultTitle = fullTitle === 'New Canvas' || fullTitle === 'New Source';
        if (isDefaultTitle) {
            titleEl.textContent = '';
            titleEl.setAttribute('data-placeholder', fullTitle);
            titleEl.classList.add('crumb-placeholder'); // same empty-state placeholder convention as the breadcrumb
        } else {
            titleEl.textContent = fullTitle;
        }
        titleEl.contentEditable = true;
        broadcastEditingState(true, `#item-${it.id} .${editingClass}`);
        titleEl.focus();
        // Same caret-at-end-on-a-deferred-macrotask dance as the breadcrumb rename — see its own
        // comment for why the deferral is load-bearing (a pending native click-to-caret action
        // would otherwise silently override this).
        const placeCaretAtEnd = () => {
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        };
        placeCaretAtEnd();
        setTimeout(placeCaretAtEnd, 0);
        titleEl.onblur = () => {
            titleEl.contentEditable = false;
            broadcastEditingState(false);
            titleEl.classList.remove('crumb-placeholder');
            const newTitle = titleEl.textContent.trim();
            if (newTitle) { appState.folders[folderId].title = newTitle; syncCanvasCollabTitle(folderId, newTitle); }
            render();
        };
        titleEl.oninput = () => {
            const liveTitle = titleEl.textContent;
            if (liveTitle.trim()) { appState.folders[folderId].title = liveTitle; scheduleWorkspaceSave(); }
        };
        titleEl.onkeydown = (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); titleEl.blur(); }
            if (ke.key === 'Escape') { ke.preventDefault(); titleEl.textContent = isDefaultTitle ? '' : fullTitle; titleEl.blur(); }
        };
    }

    // ---------- Main Canvas Render Loop ----------
    function render() {
        scheduleWorkspaceSave();
        clearSearch();
        world.innerHTML = '';
        if(!appState.folders[appState.currentFolderId]) return;
        const folderObj = appState.folders[appState.currentFolderId];
        // Waypoints are private to whoever dropped them — even on a canvas shared with (or by)
        // other people, only the creator ever sees their own waypoint cards (see the 20260729
        // migration/renderWaypointsList). Legacy items from before creatorId existed default to
        // the folder's owner, which is always correct for your own canvases and the conservative
        // choice for shared ones (owner still sees it, collaborators don't, rather than everyone).
        const folderOwnerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
        const currentItems = folderObj.items.filter(it => it.kind !== 'waypoint' || (it.creatorId || folderOwnerId) === appState.currentUser.id);
        breadcrumbs.innerHTML = '';
        // ".." opens the full breadcrumb map (see openBreadcrumbMapPanel) rather than jumping
        // straight to the parent — shown whenever there's anywhere to go: a real structural
        // parent (see findParentFolderId — reflects the true canvas hierarchy, not navigation
        // history, so this is correct regardless of how this folder was reached: drilling in, a
        // waypoint jump, search, or the hamburger menu), or, within a shared tree, always (since
        // the map's own "Root" row is what gets you home from there — see
        // renderBreadcrumbMapPanel).
        const parentFolderId = findParentFolderId(appState.currentFolderId);
        if (parentFolderId || folderObj.isSharedView) {
            const dots = document.createElement('span');
            dots.textContent = '..';
            dots.className = 'crumb-item';
            dots.onclick = (e) => {
                e.stopPropagation();
                openBreadcrumbMapPanel();
            };
            breadcrumbs.appendChild(dots);
            breadcrumbs.appendChild(document.createTextNode(' / '));
        }
        {
            const id = appState.currentFolderId;
            const span = document.createElement('span');
            span.textContent = truncateCenter(appState.folders[id].title, 12);
            span.className = 'crumb-item';
            span.onclick = (e) => {
                e.stopPropagation();
                // The handler stays attached for the whole edit session (needed so a later click
                // outside of it, via the blur handler, can commit) — without this guard, EVERY
                // click while already editing (e.g. clicking elsewhere in the text to reposition
                // the caret, completely normal mid-edit behavior) would re-run the "enter edit
                // mode" logic below from scratch: resetting the text back to the last-committed
                // title (discarding whatever had been typed since) and recomputing a caret
                // position against that now-mismatched text. That's the actual bug behind the
                // caret seeming to land in the wrong place — once already editing, just let the
                // click behave as an ordinary native contentEditable click (reposition the caret
                // where clicked) and do nothing else.
                if (span.contentEditable === 'true') return;
                saveSnapshot();
                const fullTitle = appState.folders[id].title;
                // Still-default, never-renamed titles start truly empty with the default shown
                // only as a CSS placeholder (see .crumb-placeholder:empty::before) — typing the
                // first character replaces it outright, rather than editing "New Canvas" as if
                // it were real text the user would need to select/delete first.
                const isDefaultTitle = fullTitle === 'New Canvas' || fullTitle === 'New Source';
                if (isDefaultTitle) {
                    span.textContent = '';
                    span.setAttribute('data-placeholder', fullTitle);
                    span.classList.add('crumb-placeholder');
                } else {
                    span.textContent = fullTitle;
                }
                span.contentEditable = true;
                broadcastEditingState(true);
                span.focus();
                // Entering edit mode always puts the caret at the end (not wherever the click
                // that triggered entry happened to land) — a click once already editing (see the
                // early return above) repositions it normally via the browser's own native
                // click-to-caret behavior instead.
                //
                // contentEditable flips to true DURING this same click's dispatch, so the click
                // still has a pending default action that places the caret at the original click
                // coordinates — that default action runs AFTER this handler returns, so it wins
                // over (silently undoes) a selection set synchronously here. Deferring to a
                // fresh macrotask runs after that default action has already settled, so this
                // explicit placement is what actually sticks.
                const placeCaretAtEnd = () => {
                    const range = document.createRange();
                    range.selectNodeContents(span);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                };
                placeCaretAtEnd();
                setTimeout(placeCaretAtEnd, 0);
                span.onblur = () => {
                    span.contentEditable = false;
                    broadcastEditingState(false);
                    span.classList.remove('crumb-placeholder');
                    const newTitle = span.textContent.trim();
                    if (newTitle) { appState.folders[id].title = newTitle; syncCanvasCollabTitle(id, newTitle); }
                    render();
                };
                // Live per-keystroke sync (not a full render() — that would wipe/rebuild #world
                // mid-edit and risk disrupting the caret, which this rename flow already has
                // fragile positioning logic for; scheduleWorkspaceSave() alone is enough to reach
                // collaborators without touching this card's own DOM at all).
                span.oninput = () => {
                    const liveTitle = span.textContent;
                    if (liveTitle.trim()) { appState.folders[id].title = liveTitle; scheduleWorkspaceSave(); }
                };
                span.onkeydown = (ke) => {
                    if (ke.key === 'Enter') { ke.preventDefault(); span.blur(); }
                    if (ke.key === 'Escape') { ke.preventDefault(); span.textContent = isDefaultTitle ? '' : fullTitle; span.blur(); }
                };
            };
            breadcrumbs.appendChild(span);
        }

        renderCollabPill();

        if (folderObj.isSource) {
            canvas.classList.add('static-source');
            addToolbar.style.display = 'none';
            modeToolbar.style.display = 'none';
            scheduleToolbar.style.display = 'none';
            zoomControl.style.display = 'none';
            appState.tx = 0; appState.ty = 0; appState.scale = 1; applyTransform();
            let tableItem = folderObj.items.find(i => i.kind === 'table');
            if (!tableItem) {
                tableItem = { id: appState.idCounter++, x: 0, y: 0, w: 0, h: 0, kind: 'table', tableData: [['', ''], ['', ''], ['', ''], ['', '']] };
                folderObj.items.push(tableItem);
            }
            const el = document.createElement('div');
            el.className = 'item table static-table';
            el.id = 'item-' + tableItem.id;
            el.innerHTML = renderStaticTableHTML(tableItem, appState.currentFolderId);
            world.appendChild(el);
            attachStaticTableHoverZones(el, tableItem);
            layoutSourceTableColumns(tableItem, el);
            btnBack.disabled = appState.historyIndex === 0; btnForward.disabled = appState.historyIndex === appState.historyStack.length - 1;
            return;
        }
        canvas.classList.remove('static-source');
        addToolbar.style.display = 'flex';
        modeToolbar.style.display = '';
        scheduleToolbar.style.display = '';
        zoomControl.style.display = '';
        closeSourceAddMenu(); closeCellTagPicker();

        applyConnections(folderObj);

        const backLayer = makeLayerSVG(0);
        const frontLayer = makeLayerSVG(2);
        ensureDrawings(folderObj).forEach(dw => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', dw.d);
            path.setAttribute('stroke', dw.color);
            path.setAttribute('stroke-width', String(dw.width || 3));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            (dw.layer === 'back' ? backLayer : frontLayer).appendChild(path);
        });
        world.appendChild(backLayer);
        world.appendChild(renderConnectionsLayer(folderObj, currentItems));

        currentItems.forEach(it => {
            const el = document.createElement('div');
            el.className = `item ${it.kind}`;
            el.id = 'item-' + it.id;
            el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
            if (it.zIndex) el.style.zIndex = it.zIndex;
            // Re-applied on every render (rather than left as a one-off class toggle) since
            // render() rebuilds every item's element from scratch — see handleDataModeClick.
            if (appState.dataLinkPendingId === it.id) el.classList.add('link-source-armed');
            if (it.optionsOpen) el.classList.add('options-open');
            if (it.kind !== 'title' && it.kind !== 'waypoint') {
                if (it.kind === 'table' && !it.userSized) {
                    // Sizing handled automatically
                } else {
                    el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
                }
            }
            
            if (it.kind === 'folder') {
                el.innerHTML = '';
                const folderTitleEl = document.createElement('div');
                folderTitleEl.className = 'folder-card-title';
                const liveTitle = appState.folders[it.folderId] ? appState.folders[it.folderId].title : '';
                folderTitleEl.textContent = liveTitle;
                folderTitleEl.title = liveTitle; // native tooltip for whatever the ellipsis truncates
                el.appendChild(folderTitleEl);
                const folderPreviewWrap = document.createElement('div');
                folderPreviewWrap.className = 'folder-card-preview';
                folderPreviewWrap.appendChild(buildFolderInlineCanvas(it.folderId));
                el.appendChild(folderPreviewWrap);
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (e.target.closest('.folder-card-title')) { startRenameFolderCardTitle(folderTitleEl, it); return; }
                    openFolder(it.folderId);
                };
            } else if (it.kind === 'source') {
                const nestedTitle = appState.folders[it.folderId] ? appState.folders[it.folderId].title : '';
                const nestedCount = countSourceEntries(it.folderId);
                el.innerHTML = `${kindIconHTML('source', null, 'source-card-icon')}
                <div class="source-card-info">
                    <span class="source-card-title" title="${escapeHtml(nestedTitle)}">${escapeHtml(nestedTitle)}</span>
                    <span class="source-card-count">${nestedCount} ${nestedCount === 1 ? 'entry' : 'entries'}</span>
                </div>`;
                const sourceTitleEl = el.querySelector('.source-card-title');
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (e.target.closest('.source-card-title')) { startRenameFolderCardTitle(sourceTitleEl, it, 'source-card-title'); return; }
                    openFolder(it.folderId);
                };
            } else if (it.kind === 'title') {
                el.style.fontSize = titleFontSize(it.level || 1) + 'px';
                el.innerHTML = `<div class="format-bar" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()">
                    <select class="format-select" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" onchange="setTitleLevel(${it.id}, this.value)">
                        <option value="1" ${(it.level||1)===1?'selected':''}>H1</option>
                        <option value="2" ${(it.level||1)===2?'selected':''}>H2</option>
                        <option value="3" ${(it.level||1)===3?'selected':''}>H3</option>
                    </select>
                    <input type="color" class="text-color-swatch" oninput="document.execCommand('foreColor', false, this.value)"/>
                </div>
                <div class="body" data-placeholder="Title..."></div>`;
                const b = el.querySelector('.body'); b.innerHTML = it.html || '';
                b.onblur = (e) => { if(e.relatedTarget && (e.relatedTarget.closest('.format-bar'))) return; el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); scheduleWorkspaceSave(); };
                // Commits + syncs on every keystroke, not just on blur — otherwise a collaborator
                // watching this card only ever sees the FINAL text once you click away, never the
                // actual typing happen. scheduleWorkspaceSave() itself already debounces the real
                // broadcast (~120ms, see queueSyncDiff) so this doesn't flood the channel per
                // character, just makes it feel genuinely live.
                b.oninput = () => { it.html = b.innerHTML; scheduleWorkspaceSave(); };
                b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
                b.onfocus = () => syncColorPicker(b);
                b.addEventListener('keyup', () => syncColorPicker(b));
                b.addEventListener('click', () => syncColorPicker(b));
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.currentEditingEl !== el) saveSnapshot();
                    el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#item-' + it.id); } appState.currentEditingEl = el;
                };
            } else if (it.kind === 'table') {
                el.innerHTML = renderTableHTML(it);
                if (it.userSized) { el.classList.add('sized'); requestAnimationFrame(() => distributeTableSizing(it, el)); }
                setupResizing(el, it);
            } else if (it.kind === 'media') {
                // pdf/epub need real live DOM (canvas contexts, iframes, event handlers) built by
                // JS, not an HTML string like the plain image/video/empty states below.
                if (it.mediaSrc && it.mediaType === 'pdf') {
                    el.innerHTML = '';
                    el.appendChild(buildPdfViewer(it));
                } else if (it.mediaSrc && it.mediaType === 'epub') {
                    el.innerHTML = '';
                    el.appendChild(buildEpubViewer(it));
                } else {
                    el.innerHTML = renderMediaHTML(it);
                }
                // A no-op until there's real content to resize (renderMediaHTML's empty/uploading
                // states have no .resize handle at all yet — see setupResizing's own early return).
                setupResizing(el, it);
            } else if (it.kind === 'bookmark') {
                el.innerHTML = `<div class="bookmark-icon">🔖</div>
                    <div class="bookmark-title">${it.html || (it.bookmarkUrl ? shortUrl(it.bookmarkUrl) : 'New Bookmark')}</div>
                    <div class="bookmark-edit" onmousedown="event.stopPropagation()" onclick="editBookmark(${it.id})" title="Edit link">✎</div>`;
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (e.target.closest('.bookmark-edit')) return;
                    if (it.bookmarkUrl) window.open(it.bookmarkUrl, '_blank');
                    else editBookmark(it.id);
                };
            } else if (it.kind === 'embed') {
                el.innerHTML = renderEmbedHTML(it);
                if (!it.embedUrl) {
                    el.onclick = (e) => { e.stopPropagation(); editEmbed(it.id); };
                }
            } else if (it.kind === 'waypoint') {
                el.innerHTML = `${kindIconHTML('waypoint', null, 'waypoint-card-icon')}<span class="waypoint-card-name"></span>`;
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (el.classList.contains('waypoint-editing')) return; // already editing — let the native click just reposition the caret
                    expandWaypointCard(el, it, { editable: true });
                };
                el.addEventListener('mouseenter', () => {
                    if (el.classList.contains('waypoint-editing')) return;
                    expandWaypointCard(el, it, { editable: false, hover: true });
                });
                el.addEventListener('mouseleave', () => {
                    // Typing in progress, or being actively dragged (see below) — stays open
                    // regardless of the mouse either way.
                    if (el.classList.contains('waypoint-editing') || el.classList.contains('waypoint-dragging')) return;
                    collapseWaypointCardWidth(el);
                });
                // Dragging a card around the canvas should show it expanded the whole time it's
                // being moved. It's almost always already expanded by this point anyway (you have
                // to be hovering it to pick it up), but this both guarantees it (e.g. a very fast
                // mousedown-drag before the hover-triggered expand above has settled) and — via
                // .waypoint-dragging above — keeps it that way for the whole drag even in the rare
                // case the cursor doesn't track exactly over the moving card. Only acts once real
                // movement crosses the same 3px threshold setupDraggingAndClicking's own drag
                // detection uses, so a plain click-to-rename (no movement at all) is unaffected.
                el.addEventListener('pointerdown', (e) => {
                    if (el.classList.contains('waypoint-editing')) return;
                    const downX = e.clientX, downY = e.clientY;
                    const onMove = (me) => {
                        if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) {
                            el.classList.add('waypoint-dragging');
                            if (!el.classList.contains('expanded')) expandWaypointCard(el, it, { editable: false, hover: true });
                            window.removeEventListener('pointermove', onMove);
                        }
                    };
                    const onUp = () => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        el.classList.remove('waypoint-dragging');
                        // The card moves WITH the cursor during a drag, so it's normally still
                        // directly under it at drop — but if it isn't for some reason, there's no
                        // future mouseleave to catch it (one may already have fired, and been
                        // ignored, mid-drag), so check and collapse explicitly here instead.
                        if (!el.classList.contains('waypoint-editing') && !el.matches(':hover')) collapseWaypointCardWidth(el);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                });
            } else if (it.kind === 'checklist') {
                el.innerHTML = renderChecklistHTML(it);
            } else if (it.kind === 'watermark') {
                el.innerHTML = `<div class="body watermark-text" data-placeholder="Type to trace...">${it.html || ''}</div>`;
                const b = el.querySelector('.watermark-text');
                b.onblur = (e) => { el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); scheduleWorkspaceSave(); };
                // Live per-keystroke commit+sync — see the identical comment on the title body above.
                b.oninput = () => { it.html = b.innerHTML; scheduleWorkspaceSave(); };
                b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.currentEditingEl !== el) saveSnapshot();
                    el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#item-' + it.id); } appState.currentEditingEl = el;
                };
            } else if (it.kind === 'flashcard') {
                el.innerHTML = renderFlashcardHTML(it);
                setupResizing(el, it);
            } else if (it.kind === 'typeright') {
                el.innerHTML = renderTypeRightHTML(it);
                setupResizing(el, it);
            } else if (it.kind === 'statcard') {
                el.innerHTML = renderStatcardHTML(it);
            } else if (it.kind === 'stopwatch') {
                el.innerHTML = renderStopwatchHTML(it);
            } else if (it.kind === 'shelf') {
                el.innerHTML = renderShelfHTML(it);
            } else if (it.kind === 'filter') {
                el.innerHTML = renderFilterHTML(it);
            } else if (it.kind === 'sentence') {
                // Dropped from a Dotbot example-sentence drag (see importDotbotResultAtScreenPoint)
                // — a dedicated read-only card, not a note: big target-script text, small
                // transliteration underneath only when the AI supplied one (i.e. the script isn't
                // Latin-based), translation below. No contentEditable/onblur wiring — uneditable,
                // like bookmark/statcard/stopwatch/shelf above.
                el.innerHTML = `<div class="sentence-card-text">${escapeHtml(it.text || '')}</div>
                    ${it.translit ? `<div class="sentence-card-translit">${escapeHtml(it.translit)}</div>` : ''}
                    ${it.translation ? `<div class="sentence-card-translation">${escapeHtml(it.translation)}</div>` : ''}`;
            } else {
                el.innerHTML = `<div class="format-bar" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()">
                    <button class="format-btn" onmousedown="document.execCommand('bold')">B</button>
                    <button class="format-btn" onmousedown="document.execCommand('italic')">I</button>
                    <button class="format-btn" onmousedown="document.execCommand('underline')">U</button>
                    <input type="color" class="text-color-swatch" oninput="document.execCommand('foreColor', false, this.value)"/>
                </div>
                <div class="body" data-placeholder="Note..."></div><div class="more-btn" style="display:none;">${(it.expanded ? 'Collapse' : 'More…')}</div><div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
                const b = el.querySelector('.body'); b.innerHTML = it.html || '';
                const moreBtn = el.querySelector('.more-btn');
                const isClipped = () => b.scrollHeight > b.clientHeight || b.scrollWidth > b.clientWidth;
                el.classList.toggle('expanded', !!it.expanded);
                if (moreBtn) {
                    requestAnimationFrame(() => { moreBtn.style.display = (it.expanded || isClipped()) ? 'block' : 'none'; });
                    moreBtn.onclick = (e) => {
                        e.stopPropagation();
                        // Expanding makes the note taller, so it can newly overlap neighboring
                        // cards it didn't before — bring it to front the same way a direct click
                        // would, rather than leaving it to whatever z-index it last had (see the
                        // now-removed hardcoded z-index:50 on .item.note.expanded in globals.css,
                        // which broke as soon as any other card's real click-driven z-index
                        // caught up to/passed 50).
                        bringCardToFront(it, el);
                        clearTimeout(el.__noteHeightTimer);
                        const expanding = !it.expanded;
                        it.expanded = expanding;
                        moreBtn.textContent = expanding ? 'Collapse' : 'More…';
                        // No render() here — a full rebuild would replace `el` already in its
                        // final state, with nothing to actually transition from/to (the "sudden
                        // jump" this fixes). Instead this animates the live element directly,
                        // mirroring expandWaypointCardWidth/collapseWaypointCardWidth's technique
                        // elsewhere in this file: CSS can't smoothly transition to/from
                        // height:auto (browsers snap instantly), so it measures the real target
                        // height in pixels first and animates between two concrete values,
                        // handing back to the CSS class (.item.note.expanded's height:auto
                        // !important) only once the transition has actually settled.
                        // setProperty(..., 'important') is needed because render() unconditionally
                        // applies a plain inline it.h+'px' height to every card (so a collapsed
                        // note keeps its own resized height) — a plain inline style can't
                        // out-rank that, but an !important one briefly can.
                        const startH = el.getBoundingClientRect().height / appState.scale;
                        if (expanding) {
                            el.classList.add('expanded');
                            el.style.removeProperty('height'); // let height:auto take over just long enough to measure the natural target
                            const targetH = el.getBoundingClientRect().height / appState.scale;
                            // .item.note.expanded .body{overflow:visible} takes effect the instant
                            // .expanded was added above — well before the card's own height has
                            // caught up — so without this, the full text pops into view immediately
                            // (nothing left to clip it) while just the card's border/background
                            // animates open underneath, which is the "sudden switch" this fixes.
                            // Pinning a plain (non-important — the class's own overflow rule isn't
                            // !important, unlike its height rule) inline overflow:hidden here keeps
                            // the body clipped to whatever height the card currently has at each
                            // frame — .body has no explicit height of its own (flex:1 1 auto, and
                            // it's the only normal-flow child left now that format-bar/more-btn/
                            // resize are all position:absolute), so it already exactly tracks the
                            // card's own animating height without needing a separate animation.
                            b.style.overflow = 'hidden';
                            el.style.setProperty('height', startH + 'px', 'important');
                            void el.offsetHeight; // commit the start point before animating
                            el.style.setProperty('height', targetH + 'px', 'important');
                            el.__noteHeightTimer = setTimeout(() => {
                                el.style.removeProperty('height');
                                b.style.removeProperty('overflow'); // hand back to .expanded .body{overflow:visible} now that the card has caught up to full size
                            }, 200); // matches .item.note's own .15s height transition + a small buffer
                        } else {
                            // Same reasoning as the expand branch, in reverse: .expanded (and so
                            // .body{overflow:visible}) is still in effect for the whole shrink
                            // animation below, right up until the timeout removes it — without
                            // clipping here too, the text would hang fully visible below the
                            // shrinking card instead of being clipped away progressively.
                            b.style.overflow = 'hidden';
                            el.style.setProperty('height', startH + 'px', 'important');
                            void el.offsetHeight;
                            el.style.setProperty('height', (it.h || startH) + 'px', 'important');
                            el.__noteHeightTimer = setTimeout(() => {
                                el.classList.remove('expanded');
                                // Unlike the expand branch, there's no CSS fallback for the resting
                                // collapsed height (no class sets it — render() normally does, via
                                // a plain, non-important inline it.h+'px') — so this re-applies that
                                // same value at normal priority rather than just clearing it, or
                                // the card would end up with no height at all until the next
                                // unrelated render().
                                el.style.removeProperty('height');
                                el.style.height = (it.h || startH) + 'px';
                                // .expanded is already gone by this point, so this now falls back
                                // to .item.note .body{overflow-y:auto} (the normal collapsed rule),
                                // not the expanded one.
                                b.style.removeProperty('overflow');
                                moreBtn.style.display = (it.expanded || isClipped()) ? 'block' : 'none';
                            }, 200);
                        }
                        scheduleWorkspaceSave();
                    };
                }
                b.onblur = (e) => { if(e.relatedTarget && (e.relatedTarget.closest('.format-bar') || e.relatedTarget.closest('.resize') || e.relatedTarget.closest('.more-btn'))) return; el.classList.remove('editing'); it.html = b.innerHTML; appState.currentEditingEl = null; b.contentEditable = false; broadcastEditingState(false); b.scrollTop = 0; if (moreBtn) moreBtn.style.display = (it.expanded || isClipped()) ? 'block' : 'none'; scheduleWorkspaceSave(); };
                // Live per-keystroke commit+sync — see the identical comment on the title body above.
                b.oninput = () => { it.html = b.innerHTML; scheduleWorkspaceSave(); };
                b.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); b.blur(); } };
                b.onfocus = () => syncColorPicker(b);
                b.addEventListener('keyup', () => syncColorPicker(b));
                b.addEventListener('click', () => syncColorPicker(b));
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.currentEditingEl !== el) saveSnapshot();
                    el.classList.add('editing'); if (!b.isContentEditable) { b.contentEditable = true; placeCaretEnd(b); broadcastEditingState(true, '#item-' + it.id); } appState.currentEditingEl = el;
                };
                setupResizing(el, it);
            }
            // Kind-agnostic — covers every drag-to-canvas Dotbot result (dictionary/answer/
            // mnemonic story/image, all still kind:'note', plus the new 'sentence' cards), since
            // importDotbotResultAtScreenPoint sets aiGenerated:true on all of them in one place.
            if (it.aiGenerated) {
                const badge = document.createElement('div');
                badge.className = 'item-ai-badge';
                badge.textContent = 'Generated content may be inaccurate';
                el.appendChild(badge);
            }
            // Per-card right-click menu: table cards get the shared #context-menu align-pill
            // (Schedule/Delete are gone — see startScheduleConversation/deleteSelectedCards);
            // flashcard/typeright game cards instead slide their own in-card options panel into
            // view (see openGameOptionsPanel/renderGameOptionsHTML) — only these two kinds have a
            // real front/back notion today, so other game-category placeholders (blanks/match/
            // audiotype) get no right-click menu, same as any other non-table kind. Right-clicking
            // again while the panel is already open toggles it back to the normal card view,
            // rather than just re-opening (already-open) options.
            el.oncontextmenu = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (it.kind === 'flashcard' || it.kind === 'typeright') {
                    if (it.optionsOpen) closeGameOptionsPanel(it.id); else openGameOptionsPanel(it.id);
                    return;
                }
                if (it.kind !== 'table') return;
                contextMenu.style.display = 'flex';
                appState.contextMenuItemId = it.id;
                updateContextMenuPosition();
                contextMenu.dataset.id = it.id;
                const pill = document.getElementById('align-pill');
                pill.style.display = 'flex';
                pill.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.align === (it.textAlign || 'left')));
            };
            setupDraggingAndClicking(el, it);
            world.appendChild(el);
        });

        world.appendChild(frontLayer);
        if (appState.addingKind && appState.placementGhost) world.appendChild(appState.placementGhost);
        btnBack.disabled = appState.historyIndex === 0; btnForward.disabled = appState.historyIndex === appState.historyStack.length - 1;
        
        // Sync visual selected outlines state
        renderSelectedOutlines();
        ensureSwTicking();
        // world.innerHTML was just wiped and rebuilt above — any element a remote collaborator was
        // shown editing (see applyRemoteCursorMode) is a fresh DOM node now, so the highlight/
        // caret/label all need reapplying (or the cursor needs to reappear, if that target no
        // longer exists at all — e.g. the card was deleted out from under them).
        repositionAllRemoteCursors();
    }

    function renderSelectedOutlines() {
        document.querySelectorAll('.item').forEach(el => {
            const idStr = el.id.replace('item-', '');
            if (idStr.startsWith('folder-')) return; // ignore static compiler assets
            const id = parseInt(idStr);
            el.classList.toggle('selected', appState.selectedCardIds.includes(id));
        });
    }

    // Shift+drag on empty canvas: draw a selection window and select any card
    // that overlaps it even slightly, adding to whatever is already selected.
    function startBoxSelection(e) {
        const rect = canvas.getBoundingClientRect();
        const baseSelection = appState.selectedCardIds.slice();
        const startClientX = e.clientX, startClientY = e.clientY;

        const box = document.createElement('div');
        box.id = 'selection-box';
        box.style.cssText = 'position:fixed;border:1px dashed var(--brand);border-radius:5px;background:rgba(99,102,241,0.05);z-index:1500;pointer-events:none;';
        document.body.appendChild(box);

        const updateBoxRect = (curX, curY) => {
            const x = Math.min(startClientX, curX), y = Math.min(startClientY, curY);
            const w = Math.abs(curX - startClientX), h = Math.abs(curY - startClientY);
            box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
            return { x, y, w, h };
        };
        updateBoxRect(startClientX, startClientY);

        const move = (me) => {
            const { x, y, w, h } = updateBoxRect(me.clientX, me.clientY);
            // Convert the screen-space selection window into world coordinates
            const wx0 = (x - rect.left - appState.tx) / appState.scale, wy0 = (y - rect.top - appState.ty) / appState.scale;
            const wx1 = (x + w - rect.left - appState.tx) / appState.scale, wy1 = (y + h - rect.top - appState.ty) / appState.scale;

            const items = (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items) || [];
            const hitIds = items.filter(it => {
                const ix0 = it.x, iy0 = it.y, ix1 = it.x + (it.w || 0), iy1 = it.y + (it.h || 0);
                // Any overlap at all counts as a hit (even a sliver)
                return ix0 < wx1 && ix1 > wx0 && iy0 < wy1 && iy1 > wy0;
            }).map(it => it.id);

            appState.selectedCardIds = Array.from(new Set([...baseSelection, ...hitIds]));
            renderSelectedOutlines();
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            box.remove();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    function performMerge(source, targetEl) {
        const tid = parseInt(targetEl.id.replace('item-', ''));
        const target = appState.folders[appState.currentFolderId].items.find(i => i.id === tid);
        if(!target || target.kind !== 'folder') return;
        saveSnapshot();
        source.x = findNextFreeSlot(target.folderId);
        source.y = 28;
        appState.folders[target.folderId].items.push(source);
        appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => i.id !== source.id);
        openFolder(target.folderId);
    }

    function centerOnContent() {
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
        const items = appState.folders[appState.currentFolderId] ? appState.folders[appState.currentFolderId].items : [];
        appState.scale = 1;
        if (!items.length) {
            appState.tx = window.innerWidth / 2; appState.ty = window.innerHeight / 2;
            applyTransform();
            return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(it => {
            const w = it.kind === 'title' ? (it.w || 100) : it.w;
            const h = it.kind === 'title' ? (it.h || 50) : it.h;
            minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
            maxX = Math.max(maxX, it.x + w); maxY = Math.max(maxY, it.y + h);
        });
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        appState.tx = window.innerWidth / 2 - cx;
        appState.ty = window.innerHeight / 2 - cy;
        applyTransform();
    }

    // Shared by every navigation entry point (opening a folder, back/forward, breadcrumb ".."):
    // saves the OUTGOING folder's pan/zoom as folders[id].lastView (skipped for sources, which
    // never remember one), switches currentFolderId, re-renders, then either restores the
    // incoming folder's saved view or centers fresh on first-ever visit. Source folders always
    // reset regardless — render() itself unconditionally forces tx/ty/scale back to a fixed
    // 0/0/1 static transform for them (see the `folderObj.isSource` branch inside render()), so
    // there's nothing to restore or center for a source here.
    function applyFolderView(folderId) {
        const outgoing = appState.folders[appState.currentFolderId];
        if (outgoing && !outgoing.isSource) outgoing.lastView = { tx: appState.tx, ty: appState.ty, scale: appState.scale };
        appState.currentFolderId = folderId;
        render();
        const target = appState.folders[folderId];
        if (target && !target.isSource) {
            if (target.lastView) {
                appState.tx = target.lastView.tx; appState.ty = target.lastView.ty; appState.scale = target.lastView.scale;
                applyTransform();
            } else {
                centerOnContent();
            }
        }
        // Fire-and-forget — updates the collab bubble/pill once it resolves rather than blocking
        // navigation on a round trip. renderCollabPill() itself already no-ops for root/shared
        // canvases, so this is harmless even when it doesn't apply.
        refreshCanvasCollabForCurrentFolder().then(renderCollabPill);
    }

    // Drills into a folder/source, pushing new history (truncating any forward history, same as
    // clicking a link in a browser). A shared: key not yet fetched (see below) is loaded first —
    // every existing call site already just fires this without awaiting it (a normal click
    // handler), which still works fine now that it's async.
    async function openFolder(folderId) {
        if (folderId.startsWith('shared:') && !appState.folders[folderId] && !(await ensureSharedFolderLoaded(folderId))) return;
        appState.historyStack = appState.historyStack.slice(0, appState.historyIndex + 1);
        appState.historyStack.push(folderId);
        appState.historyIndex++;
        applyFolderView(folderId);
    }

    // ---------- Live-shared canvases (accepted canvas_collaborations — see the hamburger
    // Collaborations panel) ----------
    // A canvas someone else owns isn't part of this user's own folder tree at all — it's fetched
    // on demand (get_shared_folder RPC) and dropped into the SAME `folders` map everything else
    // already reads from, under a key namespaced by owner+remote id (folder ids are only unique
    // within one user's own id sequence, so a bare folder id could collide with one of ours).
    // That reuse is what lets render()/openFolder/the outline/etc. all work on it completely
    // unmodified. saveWorkspaceNow strips shared: keys back out before persisting to this user's
    // own workspace row, and instead patches just that one folder back via update_shared_folder
    // when one is currently open — see that function.
    //
    // A folder/source nested inside a shared canvas is itself shared too (inherited access — see
    // canvas_access_status in the 20260727 migration), so it needs to be reachable the exact same
    // way as the top-level one: fetched on demand under its own shared:owner:id key. That's why
    // every folder/source item's `folderId` gets rewritten to that namespaced form the moment its
    // OWN containing folder is fetched (see injectSharedFolder) — so a later openFolder() on one
    // of those items resolves to a shared: key too, and ensureSharedFolderLoaded fetches it lazily
    // the first time it's actually navigated into, exactly like the entry point was.
    let preSharedViewState = null; // { currentFolderId, historyStack, historyIndex } from just before entering the top-level shared canvas — restored by exitSharedCanvas
    const sharedOwnerNameCache = {}; // ownerId -> display name, populated wherever it's already known (openSharedCanvas's caller) — see announceEnteredCollaboration/renderHubCollabList
    function sharedFolderKey(ownerId, folderId) { return `shared:${ownerId}:${folderId}`; }
    function parseSharedFolderKey(key) {
        const parts = key.split(':');
        return { ownerId: parts[1], remoteFolderId: parts.slice(2).join(':') };
    }
    // A 'folder'/'source' kind item's own .folderId points at whichever child folder IT opens —
    // namespaceSharedFolderIds/stripSharedFolderIds are exact inverses of each other for
    // rewriting those references across the shared/canonical boundary. The owner's real,
    // canonical storage (workspaces.data->folders) ALWAYS uses bare, un-namespaced folder ids;
    // the shared: prefix is a purely LOCAL, this-client-only device (see sharedFolderKey) so a
    // collaborator's own `folders` dict doesn't collide with their own folder ids. Any data
    // crossing that boundary in EITHER direction must be rewritten accordingly — get it wrong and
    // a shared: value leaks into the owner's canonical data, which then gets wrapped AGAIN on the
    // next fetch, compounding into a genuinely corrupt, permanently-broken folder id (confirmed
    // live: "no accepted collaboration covers this canvas" on a folder id like
    // "shared:OWNER:shared:OWNER:folder-42" — exactly this bug, from update_shared_folder
    // previously saving the still-namespaced form straight back to the owner's own row).
    // Strips however MANY layers of shared: wrapping happen to be present, not just one — some
    // existing data already has 2+ layers baked in from before this fix existed, and this needs to
    // fully self-heal that on the next read/write it goes through, not just avoid making it worse.
    function fullyUnwrapFolderId(folderId) {
        while (typeof folderId === 'string' && folderId.startsWith('shared:')) folderId = parseSharedFolderKey(folderId).remoteFolderId;
        return folderId;
    }
    function stripSharedFolderIds(items) {
        return (items || []).map(it => (it.kind === 'folder' || it.kind === 'source')
            ? { ...it, folderId: fullyUnwrapFolderId(it.folderId) }
            : it);
    }
    // Always strips first, THEN wraps exactly once — makes this idempotent/self-healing no matter
    // how many layers of historical corruption the input already carries (see the comment above).
    function namespaceSharedFolderIds(ownerId, items) {
        return stripSharedFolderIds(items).map(it => (it.kind === 'folder' || it.kind === 'source')
            ? { ...it, folderId: sharedFolderKey(ownerId, it.folderId) }
            : it);
    }
    // Drops one fetched folder into `folders` under its namespaced key, rewriting its own child
    // folder/source items' folderId references to the same namespaced form (see comment above).
    // Also kicks off (fire-and-forget) fetching who else besides this user has access, for the
    // Returns the local key it was stored under.
    function injectSharedFolder(ownerId, remoteFolderId, data) {
        const localKey = sharedFolderKey(ownerId, remoteFolderId);
        const items = namespaceSharedFolderIds(ownerId, data.items);
        appState.folders[localKey] = { ...data, items, id: localKey, title: data.title || remoteFolderId, collaborators: [], isSharedView: true, sharedOwnerId: ownerId, sharedRemoteFolderId: remoteFolderId };
        return localKey;
    }
    async function ensureSharedFolderLoaded(localKey) {
        if (appState.folders[localKey]) return true;
        if (!supabase || !appState.currentUser.id) return false;
        const { ownerId, remoteFolderId } = parseSharedFolderKey(localKey);
        const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: ownerId, p_folder_id: remoteFolderId });
        // A PostgrestError's own useful fields (message/code/details/hint) don't always show up
        // when the error object itself is logged directly (some log viewers just print "{}") —
        // spelling them out explicitly as a string here means the real reason is always visible
        // regardless of how this ends up being viewed.
        if (error || !data) {
            console.error(`[collab] failed to load shared folder (owner=${ownerId} folder=${remoteFolderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (folder not found?)');
            return false;
        }
        injectSharedFolder(ownerId, remoteFolderId, data);
        return true;
    }
    // `ownerName` is only known at the entry point (whoever linked you here already has it —
    // e.g. the hamburger Collaborations list) — cached so the pill can show it for any nested
    // folder fetched later within the same tree too, without a further profile lookup.
    async function openSharedCanvas(ownerId, folderId, title, ownerName) {
        if (!supabase || !appState.currentUser.id) return;
        if (ownerName) sharedOwnerNameCache[ownerId] = ownerName;
        const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !data) {
            console.error(`[collab] failed to open shared canvas (owner=${ownerId} folder=${folderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (folder not found?)');
            return;
        }
        const localKey = injectSharedFolder(ownerId, folderId, data);
        if (title) appState.folders[localKey].title = data.title || title;
        const isFreshEntry = !preSharedViewState;
        if (isFreshEntry) preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        appState.currentFolderId = localKey;
        appState.historyStack = [localKey];
        appState.historyIndex = 0;
        closeHamburgerMenu();
        render();
        centerOnContent();
        if (isFreshEntry) announceEnteredCollaboration(localKey);
    }
    // Replaces the old persistent "Collaborating with X" pill under the search bar — fires ONCE,
    // right when a collaboration session actually starts (fresh entry only, never on every render
    // while already in one — see callers), rather than a permanent fixture for as long as you're
    // in it. Awaits a fresh get_effective_collaborators fetch itself (rather than reusing
    // injectSharedFolder's own fire-and-forget one) so the "and N others" count is accurate the
    // very first time this shows, not whatever was last known.
    async function announceEnteredCollaboration(localKey) {
        const folderObj = appState.folders[localKey];
        if (!folderObj) return;
        const ownerName = sharedOwnerNameCache[folderObj.sharedOwnerId] || 'someone';
        let othersCount = 0;
        if (supabase && appState.currentUser.id) {
            const { data: rows, error } = await supabase.rpc('get_effective_collaborators', { p_owner_id: folderObj.sharedOwnerId, p_folder_id: folderObj.sharedRemoteFolderId });
            if (!error) othersCount = (rows || []).filter(r => r.collaborator_id !== appState.currentUser.id).length;
        }
        if (!appState.folders[localKey]) return; // navigated away again before this resolved
        pushNotification({
            type: 'entered_collaboration',
            message: `Collaborating on "${folderObj.title}" with ${ownerName}${othersCount > 0 ? ` and ${othersCount} ${othersCount === 1 ? 'other' : 'others'}` : ''}.`,
        });
    }
    // Leaves the WHOLE shared tree (not just its top level) and lands on the user's own ACTUAL
    // root — not wherever they happened to be right before entering (that distinction used to
    // matter when this was reachable via the breadcrumb "..", but the breadcrumb map's "Root" row
    // (see renderBreadcrumbMapPanel) is specifically meant as an unconditional "take me home"
    // affordance, always available regardless of how deep into someone else's canvas you are).
    function exitSharedCanvasToRoot() {
        if (!preSharedViewState) return;
        for (const id in appState.folders) { if (id.startsWith('shared:')) delete appState.folders[id]; }
        preSharedViewState = null;
        appState.currentFolderId = 'root';
        appState.historyStack = ['root'];
        appState.historyIndex = 0;
        render();
        if (appState.folders['root'] && appState.folders['root'].lastView) {
            const lv = appState.folders['root'].lastView;
            appState.tx = lv.tx; appState.ty = lv.ty; appState.scale = lv.scale;
            applyTransform();
        } else {
            centerOnContent();
        }
    }
    // Structural ancestor chain from root down to folderId — walks findParentFolderId repeatedly
    // (the REAL canvas hierarchy), not historyStack (linear click-order navigation history, which
    // can diverge from it — see the comment on the ".." breadcrumb). Works unmodified for a
    // shared: key too (findParentFolderId already does, per injectSharedFolder's consistent
    // rewriting), naturally stopping at whichever folder has no parent — true root for an owned
    // tree, or the top-level shared entry point for one entered via openSharedCanvas/a waypoint.
    function buildAncestorChain(folderId) {
        const chain = [folderId];
        let id = folderId;
        while (true) {
            const parent = findParentFolderId(id);
            if (!parent) break;
            chain.unshift(parent);
            id = parent;
        }
        return chain;
    }
    const breadcrumbMapPanel = document.getElementById('breadcrumb-map-panel');
    const breadcrumbMapList = document.getElementById('breadcrumb-map-list');
    function closeBreadcrumbMapPanel() { breadcrumbMapPanel.classList.remove('open'); panelPinned.breadcrumbMap = false; }
    function positionBreadcrumbMapPanel() {
        const rect = breadcrumbs.getBoundingClientRect();
        breadcrumbMapPanel.style.top = (rect.bottom + 8) + 'px';
        let leftPos = rect.left;
        const panelWidth = breadcrumbMapPanel.offsetWidth || 220;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        breadcrumbMapPanel.style.left = leftPos + 'px';
    }
    function openBreadcrumbMapPanel() {
        closeAllPanels('breadcrumbMap');
        clearSearch();
        renderBreadcrumbMapPanel();
        breadcrumbMapPanel.classList.add('open');
        positionBreadcrumbMapPanel();
        panelPinned.breadcrumbMap = true;
    }
    // Always shows the user's own root at the top (pinned there via a synthetic row when
    // currently inside a shared tree, since the real ancestor chain never reaches it from there —
    // see buildAncestorChain), then the current path indented to show the real nesting — the
    // collaboration's own top-level entry sits at the SAME indent as Root (both are top-level
    // entry points into their own tree), with its own nested levels indented further below it.
    function renderBreadcrumbMapPanel() {
        breadcrumbMapList.innerHTML = '';
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const showSyntheticRoot = folderObj.isSharedView;
        function addRow(label, indent, folderId, isCurrent) {
            const row = document.createElement('div');
            row.className = 'breadcrumb-map-row' + (isCurrent ? ' current' : '');
            row.style.setProperty('--map-indent', (indent * 16) + 'px');
            row.textContent = label;
            if (!isCurrent) {
                row.onclick = (e) => {
                    e.stopPropagation();
                    closeBreadcrumbMapPanel();
                    if (folderId === 'root' && showSyntheticRoot) exitSharedCanvasToRoot();
                    else openFolder(folderId);
                };
            }
            breadcrumbMapList.appendChild(row);
        }
        if (showSyntheticRoot) addRow(appState.folders['root'] ? appState.folders['root'].title : 'Root', 0, 'root', false);
        buildAncestorChain(appState.currentFolderId).forEach((id, idx) => {
            const target = appState.folders[id];
            if (!target) return;
            addRow(target.title || id, idx, id, id === appState.currentFolderId);
        });
    }
    pinOnInsideClick('breadcrumbMap', [breadcrumbMapPanel]);

    // Steps to an EXISTING position in historyStack (back/forward, breadcrumb "..") — no
    // truncation, no push, just moves the pointer.
    function jumpToHistoryIndex(newIndex) {
        appState.historyIndex = newIndex;
        applyFolderView(appState.historyStack[newIndex]);
    }

    // ---------- Canvas Outline Hierarchical Builder inside Hamburger Menu ----------
    function nearestOf(list, ref) {
        let best = null, bd = Infinity;
        list.forEach(c => { const d = Math.hypot(c.x - ref.x, c.y - ref.y); if (d < bd) { bd = d; best = c; } });
        return best;
    }
    // Maps a card kind (+ heading level, for 'title') to its /assets/icons/*.png filename —
    // shared by the canvas outline tree (outlineIcon, below) and the search-results type
    // indicator (renderMatchRow), since both display the same kind taxonomy as a small icon.
    function kindIconFile(kind, level) {
        if (kind === 'title') return `heading-${level || 1}.png`;
        const files = {
            folder: 'canvas.png', source: 'source.png', table: 'table.png', media: 'media.png',
            bookmark: 'bookmark.png', checklist: 'checklist.png', watermark: 'watermark.png',
            flashcard: 'flashcards.png', typeright: 'typeright.png', note: 'note.png', statcard: 'statcard.png',
            stopwatch: 'stopwatch.png', shelf: 'shelf.png', waypoint: 'waypoint.png',
            filter: 'tag-button.png', // no dedicated icon asset yet — closest existing one, since filtering is tag-based
            embed: 'embed.png', // no icon asset exists yet either — add public/assets/icons/embed.png; missing files already degrade gracefully throughout this app
        };
        return files[kind] || 'note.png';
    }
    // Returns a ready-to-insert <span> using kindIconFile as a mask (see .icon-mask) — pass
    // whatever extra class sizes/positions it at the call site (e.g. "outline-icon").
    function kindIconHTML(kind, level, extraClass) {
        const url = `/assets/icons/${kindIconFile(kind, level)}`;
        return `<span class="${extraClass} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
    }
    function outlineIcon(kind, level) {
        return kindIconHTML(kind, level, 'outline-icon');
    }
    function outlineLabel(item) {
        if (item.kind === 'folder' || item.kind === 'source') return (appState.folders[item.folderId] ? appState.folders[item.folderId].title : 'Canvas');
        if (item.kind === 'table') return 'Table';
        if (item.kind === 'media') return 'Media';
        if (item.kind === 'bookmark') return item.html ? stripHtml(item.html) : 'Bookmark';
        if (item.kind === 'embed') return item.embedUrl ? shortUrl(item.embedUrl) : 'Embed';
        if (item.kind === 'checklist') return 'Checklist';
        if (item.kind === 'watermark') return 'Watermark';
        if (item.kind === 'flashcard') return 'Flashcards';
        if (item.kind === 'typeright') return 'Typeright';
        if (item.kind === 'statcard') return item.statKind === 'accuracy' ? 'Accuracy' : 'Progress';
        if (item.kind === 'stopwatch') return 'Stopwatch';
        if (item.kind === 'shelf') return item.shelfName || 'Stack';
        if (item.kind === 'filter') return 'Filter';
        if (item.kind === 'waypoint') return item.name || 'New Waypoint';
        if (item.kind === 'note') return (item.html || '').replace(/<[^>]*>/g, '').trim() || 'Note';
        const txt = (item.html || '').replace(/<[^>]*>/g, '').trim();
        return txt || '(untitled heading)';
    }
    
    let outlineRows = [], outlineActiveIndex = -1;
    // Current level (currentFolderId's own contents) plus 2 deeper levels of nested folders —
    // the rolling window is always anchored to the LIVE canvas position, not a separate
    // menu-only drill state. The only way the window ever shifts is by actually navigating the
    // real canvas (via a leaf-item click here, a source-item click here, or anything else that
    // changes currentFolderId) — there is no in-menu-only "focus" concept and no breadcrumb.
    const OUTLINE_MAX_DEPTH = 2;

    const OUTLINE_GROUP_MAX_DIST = 30 * 28;   // 30 grid squares — beyond this, a card isn't near enough to any heading to join it directly
    const OUTLINE_RESCUE_MAX_DIST = 10 * 28;  // 10 grid squares — but it still joins whatever heading a nearby (already-grouped) card belongs to

    // Renders `folder`'s own items — leaf cards, plus child folders/sources — at the given depth.
    // Every row (whether it's a canvas, a source, or a plain card) uses the exact same
    // .outline-item styling — there is no header/row visual distinction of any kind by design.
    // A child FOLDER's own contents are recursed into immediately after its row (one level
    // deeper), up to OUTLINE_MAX_DEPTH; a child SOURCE is always a dead-end row — its internal
    // table is never shown separately, and clicking it jumps straight into the source instead of
    // centering on its card (see below). Waypoints are excluded entirely — they live only in
    // their own Waypoints hub panel (see openWaypointsPanel/renderWaypointsList), never here.
    //
    // Headings give this list structure, based purely on canvas proximity (there's no other
    // parent/child relationship recorded anywhere): H2 nests under its nearest H1, H3 under its
    // nearest H2 (or H1 if no H2 exists at all) — see h2Parent/h3Parent. Every OTHER card
    // (leaf cards, folders, sources) then nests under whichever heading of ANY level is nearest
    // to it, as long as that's within OUTLINE_GROUP_MAX_DIST — beyond that it's too far to
    // belong to that heading directly, but it can still be "rescued" into the same group as a
    // heading-grouped neighbor within OUTLINE_RESCUE_MAX_DIST (repeated to a fixed point, so a
    // rescued card can go on to rescue further cards near it, forming one contiguous cluster
    // instead of a hard cutoff at exactly 30 squares from the heading itself). Anything left
    // over after that — including every card when the folder has no headings at all — is
    // rendered flat, ungrouped, same as before headings existed.
    // Returns true if anything was rendered, for the "nothing here yet" empty state.
    function renderOutlineFolderContents(container, folder, depth, visited) {
        const items = folder.items || [];
        const titles = items.filter(i => i.kind === 'title');
        const childFolders = items.filter(i => i.kind === 'folder');
        const childSources = items.filter(i => i.kind === 'source');
        const others = items.filter(i => i.kind !== 'title' && i.kind !== 'folder' && i.kind !== 'source' && i.kind !== 'waypoint');
        const any = titles.length > 0 || others.length > 0 || childFolders.length > 0 || childSources.length > 0;

        // The canvas point currently centered on screen for this specific folder — live tx/ty/
        // scale for whichever folder is actually being viewed right now, or its saved pan/zoom
        // (folders[id].lastView — see applyFolderView) for any other folder the outline tree
        // recurses into. Same "canvas point centered on screen" inversion smoothPanTo/
        // centerOnContent use elsewhere: screenX = tx + canvasX*scale, so canvasX = (screenX -
        // tx) / scale. null (skip proximity ordering, fall back to natural creation order) for a
        // folder that's neither the live one nor has ever been visited.
        const view = (folder.id === appState.currentFolderId) ? { tx: appState.tx, ty: appState.ty, scale: appState.scale } : folder.lastView;
        const viewCenter = view ? { x: (window.innerWidth / 2 - view.tx) / view.scale, y: (window.innerHeight / 2 - view.ty) / view.scale } : null;
        function sortByProximity(list) {
            if (!viewCenter) return list;
            return list.sort((a, b) => Math.hypot(a.x - viewCenter.x, a.y - viewCenter.y) - Math.hypot(b.x - viewCenter.x, b.y - viewCenter.y));
        }

        // Sorting these once, in place, up front is enough to make every downstream listing —
        // top-level orphan headings AND each parent heading's own nested h2s/h3s (both just
        // `.filter()` these same arrays, which preserves source order) — closest-first without
        // needing to re-sort at every recursion level.
        const h1s = sortByProximity(titles.filter(t => (t.level || 1) === 1));
        const h2s = sortByProximity(titles.filter(t => (t.level || 1) === 2));
        const h3s = sortByProximity(titles.filter(t => (t.level || 1) === 3));
        const allHeadings = [...h1s, ...h2s, ...h3s];
        const h2Parent = new Map(), h3Parent = new Map();
        h2s.forEach(h2 => { if (h1s.length) h2Parent.set(h2.id, nearestOf(h1s, h2).id); });
        h3s.forEach(h3 => {
            if (h2s.length) h3Parent.set(h3.id, { level: 2, id: nearestOf(h2s, h3).id });
            else if (h1s.length) h3Parent.set(h3.id, { level: 1, id: nearestOf(h1s, h3).id });
        });

        // ---- Group every non-heading card under its nearest heading (see comment above) ----
        const headingGroups = new Map(); // heading id -> item[]
        allHeadings.forEach(h => headingGroups.set(h.id, []));
        const assignable = [...others, ...childSources, ...childFolders];
        let unassigned = [];
        assignable.forEach(item => {
            if (!allHeadings.length) { unassigned.push(item); return; }
            const nearest = nearestOf(allHeadings, item);
            const dist = Math.hypot(nearest.x - item.x, nearest.y - item.y);
            if (dist <= OUTLINE_GROUP_MAX_DIST) headingGroups.get(nearest.id).push(item);
            else unassigned.push(item);
        });
        let changed = true;
        while (changed && unassigned.length) {
            changed = false;
            for (let i = unassigned.length - 1; i >= 0; i--) {
                const item = unassigned[i];
                let rescueHeadingId = null;
                for (const [hid, groupItems] of headingGroups) {
                    if (groupItems.some(g => Math.hypot(g.x - item.x, g.y - item.y) <= OUTLINE_RESCUE_MAX_DIST)) { rescueHeadingId = hid; break; }
                }
                if (rescueHeadingId) {
                    headingGroups.get(rescueHeadingId).push(item);
                    unassigned.splice(i, 1);
                    changed = true;
                }
            }
        }
        headingGroups.forEach(group => sortByProximity(group));
        sortByProximity(unassigned);

        function makeRow(item, subIndent) {
            const row = document.createElement('div');
            row.className = 'outline-item';
            row.style.setProperty('--outline-indent', ((depth + subIndent) * 14) + 'px');
            row.innerHTML = `${outlineIcon(item.kind, item.level)}<span class="outline-label">${escapeHtml(outlineLabel(item))}</span>`;
            row.onclick = (e) => {
                e.stopPropagation();
                if (item.kind === 'source') {
                    // Sources are entered directly (they just show a table) rather than centered
                    // on as a card — unlike every other item kind, including canvases.
                    if (appState.currentFolderId !== item.folderId) openFolder(item.folderId);
                    closeHamburgerMenu();
                } else {
                    // Canvas cards and leaf cards alike: land on this item within its OWN direct
                    // parent (`folder`, the containing folder this row belongs to) — never
                    // drilling into a canvas via the menu itself.
                    goToOutlineItem(folder.id, item.id);
                }
            };
            container.appendChild(row);
            outlineRows.push({ el: row });
        }

        // A non-heading card's own row, plus (for folders) recursing into its nested contents —
        // shared by both grouped-under-a-heading and fully-ungrouped rendering below.
        function makeCardRow(item, subIndent) {
            makeRow(item, subIndent);
            if (item.kind === 'folder' && depth < OUTLINE_MAX_DEPTH && item.folderId && appState.folders[item.folderId] && !visited.has(item.folderId)) {
                visited.add(item.folderId);
                renderOutlineFolderContents(container, appState.folders[item.folderId], depth + 1, visited);
            }
        }

        // A heading's own nested h2s and directly-attached h3s (h3s whose nearest heading is
        // this h1 itself, when it has no h2 children at all — see h3Parent above) are two
        // separate sources, merged and re-sorted together here so they interleave by proximity
        // rather than always listing every h2 subtree before any direct h3.
        function renderHeadingSubtree(heading, subIndent) {
            makeRow(heading, subIndent);
            (headingGroups.get(heading.id) || []).forEach(item => makeCardRow(item, subIndent + 1));
            const level = heading.level || 1;
            let children = [];
            if (level === 1) {
                children = [
                    ...h2s.filter(h2 => h2Parent.get(h2.id) === heading.id),
                    ...h3s.filter(h3 => { const p = h3Parent.get(h3.id); return p && p.level === 1 && p.id === heading.id; }),
                ];
            } else if (level === 2) {
                children = h3s.filter(h3 => { const p = h3Parent.get(h3.id); return p && p.level === 2 && p.id === heading.id; });
            }
            sortByProximity(children).forEach(child => renderHeadingSubtree(child, subIndent + 1));
        }

        // Top-level entries — every orphan heading (no parent to nest under) plus every fully
        // ungrouped card — combined into one list and ordered by proximity together, rather than
        // rendering all h1s, then all orphan h2s, then all orphan h3s, then all ungrouped cards
        // as fixed, un-interleaved blocks.
        const topLevelRoots = [
            ...h1s.map(h1 => ({ x: h1.x, y: h1.y, render: () => renderHeadingSubtree(h1, 0) })),
            ...h2s.filter(h2 => !h2Parent.has(h2.id)).map(h2 => ({ x: h2.x, y: h2.y, render: () => renderHeadingSubtree(h2, 0) })),
            ...h3s.filter(h3 => !h3Parent.has(h3.id)).map(h3 => ({ x: h3.x, y: h3.y, render: () => renderHeadingSubtree(h3, 0) })),
            ...unassigned.map(item => ({ x: item.x, y: item.y, render: () => makeCardRow(item, 0) })),
        ];
        sortByProximity(topLevelRoots).forEach(root => root.render());

        return any;
    }

    function buildOutline() {
        const container = document.getElementById('hmenu-outline-container');
        if (!container) return;
        container.innerHTML = '';
        container.scrollTop = 0; // buildOutline only ever runs when the menu is being opened — always start at the top
        outlineRows = []; outlineActiveIndex = -1;

        const rootFolder = appState.folders[appState.currentFolderId];
        const any = rootFolder ? renderOutlineFolderContents(container, rootFolder, 0, new Set([rootFolder.id])) : false;

        if (!any) {
            const empty = document.createElement('div');
            empty.className = 'outline-empty';
            empty.textContent = 'Nothing here yet.';
            container.appendChild(empty);
        }
    }

    // Navigates the live canvas to a card's containing folder and centers on it. Used for every
    // non-source row (leaf cards AND canvas cards alike) — openFolder now goes through
    // applyFolderView, so this also benefits from per-folder position memory (see
    // navigateToFolder/applyFolderView).
    function goToOutlineItem(folderId, itemId) {
        if (appState.currentFolderId !== folderId) openFolder(folderId);
        const it = appState.folders[folderId].items.find(i => i.id === itemId);
        if (it) {
            const el = document.getElementById('item-' + it.id);
            const w = el ? el.offsetWidth : (it.w || 100);
            const h = el ? el.offsetHeight : (it.h || 50);
            smoothPanTo(window.innerWidth / 2 - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
            if (el && it.kind === 'waypoint') expandWaypointCard(el, it, { editable: false });
            flashCanvasElement(el);
        }
        closeHamburgerMenu();
    }
    function setOutlineActive(idx) {
        if (!outlineRows.length) return;
        idx = ((idx % outlineRows.length) + outlineRows.length) % outlineRows.length;
        outlineRows.forEach(r => r.el.classList.remove('active'));
        outlineActiveIndex = idx;
        const row = outlineRows[idx];
        row.el.classList.add('active');
        row.el.scrollIntoView({ block: 'nearest' });
    }
    function toggleHamburgerMenu() {
        const willOpen = !outlineMenu.classList.contains('open');
        outlineMenu.classList.toggle('open', willOpen);
        accountMenu.classList.toggle('open', willOpen);
        hamburgerBtn.classList.toggle('active', willOpen);
        if(willOpen) {
            buildOutline();
            setOutlineActive(0);
        }
    }

    // ---------- Element Drag and Drop System ----------
    function setupDraggingAndClicking(el, it) {
        el.addEventListener('pointerdown', (e) => {
            // The game-options panel's own controls (esp. the column-picker <select>s) must
            // never start a card drag — the .game-options-row/.game-options-slot elements'
            // onmousedown="event.stopPropagation()" only stops the separate 'mousedown' event,
            // not this 'pointerdown' listener, and opening a native <select> popup doesn't
            // reliably fire a matching window 'pointerup' back to end() the drag afterward —
            // so without this check, picking an option left the card permanently glued to the
            // cursor with no pointerup ever arriving to release it. Same exemption pattern
            // already used for '.resize' just above.
            if (e.target.closest('.item-options')) return;
            if (e.target.classList.contains('resize') || (appState.currentEditingEl === el && e.target !== el)) return;
            // The PDF viewer's own page/text-layer (see buildPdfViewer) — click-dragging there has
            // to be native text selection, never a card move. The rest of that card (the bottom
            // nav bar) is deliberately NOT exempted, so it's still draggable.
            if (e.target.closest('.pdf-viewer-page')) return;

            bringCardToFront(it, el);

            // Selection logic happens with Shift Key, or persistently while in Select mode
            if (e.shiftKey || effectiveMode() === 'select') {
                e.stopPropagation();
                e.preventDefault();
                if (appState.selectedCardIds.includes(it.id)) {
                    appState.selectedCardIds = appState.selectedCardIds.filter(id => id !== it.id);
                } else {
                    appState.selectedCardIds.push(it.id);
                }
                renderSelectedOutlines();
                // Prevent this same interaction from also opening folders/sources,
                // focusing contenteditable bodies, or otherwise "activating" the card -
                // shift-click should ONLY toggle selection.
                const suppressShiftClick = (ce) => { ce.stopPropagation(); ce.preventDefault(); el.removeEventListener('click', suppressShiftClick, true); };
                el.addEventListener('click', suppressShiftClick, true);
                return;
            }

            // Data mode: drag from this card to another to link them. Cards are not
            // otherwise clickable/openable/editable while in this mode.
            if (effectiveMode() === 'data') {
                if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
                e.stopPropagation();
                e.preventDefault();
                const suppressDataClick = (ce) => { ce.stopPropagation(); ce.preventDefault(); el.removeEventListener('click', suppressDataClick, true); };
                el.addEventListener('click', suppressDataClick, true);
                startConnectionDrag(e, it, el);
                return;
            }

            if (drawMode) {
                if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
                e.stopPropagation();
                startDrawStroke(e);
                return;
            }
            e.stopPropagation();
            let moved = false;
            const downX = e.clientX, downY = e.clientY;

            saveSnapshot();

            // Which card(s) this gesture operates on: the whole selection if the pressed
            // card is part of it, otherwise just this one card.
            const isTargetSelected = appState.selectedCardIds.includes(it.id);
            const gestureIds = isTargetSelected ? appState.selectedCardIds.slice() : [it.id];
            const preDuplicateSelection = appState.selectedCardIds.slice();

            let targetEl = el, targetIt = it;
            const startPositions = [];
            const isAltDuplicate = e.altKey && !(appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource);

            if (isAltDuplicate) {
                // Option/Alt held: duplicate the card(s) first, then drag the duplicate(s)
                // away — the original(s) stay exactly where they were.
                const idMap = {};
                gestureIds.forEach(srcId => {
                    const src = findItemById(srcId);
                    if (!src) return;
                    const clone = deepCloneItem(src);
                    appState.topCardZIndex++; clone.zIndex = appState.topCardZIndex;
                    appState.folders[appState.currentFolderId].items.push(clone);
                    idMap[srcId] = clone.id;
                    startPositions.push({ id: clone.id, x: clone.x, y: clone.y });
                });
                if (!startPositions.length) { undoStack.pop(); return; }
                appState.selectedCardIds = isTargetSelected ? gestureIds.map(gid => idMap[gid]).filter(gid => gid != null) : [];
                render();
                const newTargetId = idMap[it.id];
                targetIt = findItemById(newTargetId);
                targetEl = document.getElementById('item-' + newTargetId);
                if (!targetIt || !targetEl) {
                    const cloneIdSet = new Set(startPositions.map(p => p.id));
                    appState.folders[appState.currentFolderId].items.filter(i => cloneIdSet.has(i.id)).forEach(deleteClonedItemFolders);
                    appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !cloneIdSet.has(i.id));
                    appState.selectedCardIds = preDuplicateSelection;
                    undoStack.pop();
                    render();
                    return;
                }
                bringCardToFront(targetIt, targetEl);
            } else {
                // Cache starting positions of moved cards.
                // If dragging a card that is selected, drag all selected ones. Otherwise, drag only this single card!
                gestureIds.forEach(selId => {
                    const item = findItemById(selId);
                    if (item) startPositions.push({ id: selId, x: item.x, y: item.y });
                });
            }

            document.body.classList.add('dragging');
            let sx = e.clientX, sy = e.clientY, hovered = null;
            let lastClientX = e.clientX, lastClientY = e.clientY;
            // Auto-pan-driven displacement, tracked separately from startPositions' own x/y —
            // see autoPanTick below. Kept apart from the real cursor delta (sx/sy) so `up`'s
            // "snap back to original position on an aborted drop" still has startPositions'
            // untouched original coordinates to restore.
            let autoPanAccumX = 0, autoPanAccumY = 0;
            const suppressClick = (ce) => { ce.stopPropagation(); ce.preventDefault(); targetEl.removeEventListener('click', suppressClick, true); };

            // Moves every dragged card to (start position) + (real cursor delta since drag
            // start) + (accumulated auto-pan delta) — called on every real pointermove AND every
            // auto-pan tick, so a card keeps moving even while the cursor itself sits still near
            // the edge.
            const applyDraggedPositions = () => {
                const dx = (lastClientX - sx) / appState.scale + autoPanAccumX;
                const dy = (lastClientY - sy) / appState.scale + autoPanAccumY;
                startPositions.forEach(pos => {
                    const selItem = findItemById(pos.id);
                    const selEl = document.getElementById('item-' + pos.id);
                    if (selItem && selEl) {
                        selItem.x = Math.round((pos.x + dx) / 28) * 28;
                        selItem.y = Math.round((pos.y + dy) / 28) * 28;
                        selEl.style.left = selItem.x + 'px';
                        selEl.style.top = selItem.y + 'px';
                    }
                });
                broadcastItemDragPositions(startPositions);
            };

            const checkDropTargets = () => {
                // Detect if cursor is over cart panel dropzone
                const cartPanelOpen = cartPanel.classList.contains('open');
                if (cartPanelOpen) {
                    const cartRect = cartPanel.getBoundingClientRect();
                    const overCart = (lastClientX >= cartRect.left && lastClientX <= cartRect.right && lastClientY >= cartRect.top && lastClientY <= cartRect.bottom);
                    document.getElementById('cart-dropzone-overlay').classList.toggle('active', overCart);
                }

                // Detect if cursor is over the schedule button (drag-to-schedule drop target —
                // see the matching drop check in `up` below)
                const scheduleRect = scheduleBtn.getBoundingClientRect();
                const overSchedule = (lastClientX >= scheduleRect.left && lastClientX <= scheduleRect.right && lastClientY >= scheduleRect.top && lastClientY <= scheduleRect.bottom);
                scheduleBtn.classList.toggle('drag-hover', overSchedule);

                // Detect merging folder highlights
                const r1 = targetEl.getBoundingClientRect();
                let newH = null;
                for (const sib of Array.from(world.children)) {
                    if (sib === targetEl || !sib.classList.contains('item')) continue;
                    const sibId = parseInt(sib.id.replace('item-', ''));
                    const sibItem = appState.folders[appState.currentFolderId].items.find(i => i.id === sibId);
                    if (!sibItem || sibItem.kind !== 'folder') continue;
                    const r2 = sib.getBoundingClientRect();
                    if (!(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom)) { newH = sib; break; }
                }
                if (hovered && hovered !== newH) { hovered.classList.remove('merging-target'); targetEl.classList.remove('merging-target'); }
                if (newH) { newH.classList.add('merging-target'); targetEl.classList.add('merging-target'); }
                hovered = newH;
            };

            // Auto-pan the canvas while the drag's cursor sits near the viewport's edge, so a
            // drag can reach content well beyond whatever was on-screen when it started — same
            // UX as Figma/Miro: holding near the perimeter keeps scrolling the world underneath
            // the dragged card (dragging the card along with it, via autoPanAccumX/Y) for as long
            // as the cursor stays there. Speed ramps from 0 at EDGE_MARGIN in, up to
            // EDGE_MAX_SPEED right at the edge. Driven by its own rAF loop rather than
            // pointermove, since it has to keep going even while the cursor itself is dead still.
            const EDGE_MARGIN = 60, EDGE_MAX_SPEED = 900; // px screen-space from edge / px per second right at the edge
            let autoPanLastT = null, autoPanRAFId = null;
            const autoPanTick = (now) => {
                if (autoPanLastT == null) autoPanLastT = now;
                const dt = Math.min((now - autoPanLastT) / 1000, 0.1);
                autoPanLastT = now;
                const rect = canvas.getBoundingClientRect();
                let vx = 0, vy = 0;
                if (lastClientX < rect.left + EDGE_MARGIN) vx = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientX - rect.left) / EDGE_MARGIN);
                else if (lastClientX > rect.right - EDGE_MARGIN) vx = EDGE_MAX_SPEED * (1 - Math.max(0, rect.right - lastClientX) / EDGE_MARGIN);
                if (lastClientY < rect.top + EDGE_MARGIN) vy = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientY - rect.top) / EDGE_MARGIN);
                else if (lastClientY > rect.bottom - EDGE_MARGIN) vy = EDGE_MAX_SPEED * (1 - Math.max(0, rect.bottom - lastClientY) / EDGE_MARGIN);
                // vx/vy are computed independently per axis, so a corner already blends into an
                // exact diagonal proportional to how close the cursor is to EACH edge (e.g. nearer
                // the top than the left pans more up than left) — this just caps the combined
                // vector's magnitude to EDGE_MAX_SPEED so a corner doesn't pan up to ~41% faster
                // (sqrt(2)x) than a straight edge would; the direction/ratio between vx and vy is
                // untouched, only the overall speed is scaled down.
                const speed = Math.hypot(vx, vy);
                if (speed > EDGE_MAX_SPEED) {
                    const k = EDGE_MAX_SPEED / speed;
                    vx *= k; vy *= k;
                }
                if (vx || vy) {
                    const screenDx = vx * dt, screenDy = vy * dt;
                    appState.tx -= screenDx; appState.ty -= screenDy;
                    autoPanAccumX += screenDx / appState.scale;
                    autoPanAccumY += screenDy / appState.scale;
                    moved = true;
                    applyTransform();
                    applyDraggedPositions();
                    checkDropTargets();
                }
                autoPanRAFId = requestAnimationFrame(autoPanTick);
            };
            autoPanRAFId = requestAnimationFrame(autoPanTick);

            const move = (me) => {
                if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) moved = true;
                lastClientX = me.clientX; lastClientY = me.clientY;
                applyDraggedPositions();
                checkDropTargets();
            };

            const up = (me) => {
                cancelAnimationFrame(autoPanRAFId);
                document.body.classList.remove('dragging');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (moved) targetEl.addEventListener('click', suppressClick, true);
                if (!moved) {
                    if (isAltDuplicate) {
                        // Nothing was actually dragged — discard the speculative
                        // duplicate(s) and restore the selection exactly as it was.
                        const cloneIdSet = new Set(startPositions.map(p => p.id));
                        appState.folders[appState.currentFolderId].items.filter(i => cloneIdSet.has(i.id)).forEach(deleteClonedItemFolders);
                        appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !cloneIdSet.has(i.id));
                        appState.selectedCardIds = preDuplicateSelection;
                        undoStack.pop();
                        render();
                        return;
                    }
                    if (!hovered) { undoStack.pop(); }
                }

                // Hide dragover templates dropbox overlay
                document.getElementById('cart-dropzone-overlay').classList.remove('active');
                scheduleBtn.classList.remove('drag-hover');

                // Check Drop zones intersects
                const mX = me.clientX;
                const mY = me.clientY;
                let droppedOnTarget = false;

                // 1. Drop into active Chat
                if (messagesPanel.classList.contains('open')) {
                    const rect = messagesPanel.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        dispatchSelectedToChat(targetIt);
                        droppedOnTarget = true;
                    }
                }

                // 2. Drop into Template Marketplace Dropbox
                if (cartPanel.classList.contains('open')) {
                    const rect = cartPanel.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        packageSelectedAsTemplate(targetIt);
                        droppedOnTarget = true;
                    }
                }

                // 3. Drop into the search box as AI card context
                if (!droppedOnTarget) {
                    const searchBarEl = document.getElementById('search-bar');
                    const rect = searchBarEl.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        addCardsToSearchContext(gestureIds);
                        droppedOnTarget = true;
                    }
                }

                // 4. Drop onto the Schedule button — starts the schedule conversation for
                // whichever card(s) were being dragged (replaces the old right-click "Schedule"
                // context-menu option).
                if (!droppedOnTarget) {
                    const rect = scheduleBtn.getBoundingClientRect();
                    if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
                        startScheduleConversation(gestureIds);
                        droppedOnTarget = true;
                    }
                }

                if (droppedOnTarget) {
                    // Restore original positions! Cards fly back to original coordinates
                    startPositions.forEach(pos => {
                        const selItem = findItemById(pos.id);
                        if (selItem) {
                            selItem.x = pos.x;
                            selItem.y = pos.y;
                        }
                    });
                    render();
                } else {
                    if (hovered) {
                        performMerge(targetIt, hovered);
                    } else if (moved) {
                        render();
                    }
                }
            };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        });
    }

    // ---------- Dispatch to Chat Interaction ----------
    async function dispatchSelectedToChat(targetIt) {
        if (!activeConvoId) return;
        const f = friends.find(x => x.id === activeConvoId);
        if (!f) return;

        saveSnapshot();

        let itemsToShare = [];
        // If targetIt is selected, we share all selected cards. Otherwise, share just this card.
        const gestureIds = appState.selectedCardIds.includes(targetIt.id) ? appState.selectedCardIds.slice() : [targetIt.id];
        gestureIds.forEach(id => {
            const it = findItemById(id);
            if (it) itemsToShare.push(sanitizeFlashcardSnapshot(snapshotItem(it), gestureIds));
        });

        if (itemsToShare.length === 0) return;

        const text = itemsToShare.length === 1 ? `Shared Node` : `Shared Canvas Collection`;
        const { data, error } = await supabase
            .from('messages')
            .insert({ friendship_id: f.friendshipId, sender_id: appState.currentUser.id, body: text, canvas_snapshot: itemsToShare })
            .select()
            .single();
        if (error) { console.error('[chat] failed to share card:', error); return; }
        f.messages.push({ id: data.id, senderId: data.sender_id, text: data.body, canvasSnapshot: data.canvas_snapshot, createdAt: data.created_at });

        renderConvoBody(f);
        renderMsgList('');
    }

    // ---------- Template Marketplace Features ----------
    const btnCart = document.getElementById('btn-cart'), cartPanel = document.getElementById('cart-panel');
    function closeCartPanel() { cartPanel.classList.remove('open'); btnCart.classList.remove('active'); panelPinned.cart = false; }
    function positionCartPanel() {
        const rect = btnCart.getBoundingClientRect();
        cartPanel.style.bottom = 'auto';
        cartPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 380;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        cartPanel.style.left = leftPos + 'px';
        cartPanel.style.right = 'auto';
    }
    // Restores whichever tab (discover/library) was last active, clearing any transient
    // detail/publish-flow view. Nothing is ever lost by calling this — drafts are persisted
    // to the database the moment they're created, so there's no "discard" state to worry about.
    function resetCartPanelToTabView() {
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.remove('active');
        document.getElementById('view-discover').classList.toggle('active', activeCartTab === 'discover');
        document.getElementById('view-library').classList.toggle('active', activeCartTab === 'library');
    }
    async function openCartPanel(pin) {
        closeAllPanels('cart');
        clearSearch();
        cartPanel.classList.add('open');
        btnCart.classList.add('active');
        // Positioned immediately (depends only on the button's rect, not on panel content), so
        // it never flashes at its unpositioned default in the top-left corner while the first
        // fetch of the session (the slow one — nothing's cached yet) is still in flight.
        positionCartPanel();
        selectedMarketItem = null;
        resetCartPanelToTabView();
        await Promise.all([refreshMarketplaceListings(), refreshMyLibrary()]);
        renderMarketplaceDiscover();
        renderLibrary();
        if (pin) panelPinned.cart = true;
    }
    btnCart.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.cart) { closeCartPanel(); }
        else { openCartPanel(true); }
    });
    btnCart.addEventListener('mouseenter', () => { if (!cartPanel.classList.contains('open')) openCartPanel(false); });
    btnCart.addEventListener('mouseleave', () => scheduleHoverClose('cart', [btnCart, cartPanel], closeCartPanel));
    cartPanel.addEventListener('mouseleave', () => scheduleHoverClose('cart', [btnCart, cartPanel], closeCartPanel));
    pinOnInsideClick('cart', [cartPanel]);

    // Listings are cached in trendingMarketplace / userLibrary.{purchased,drafts,published}
    // (same shape and variable names the render functions below already
    // expect) and refreshed from Supabase whenever the relevant tab opens.
    // userLibrary.customFolders stays local/session-only — organizing a
    // library into custom folders isn't backed by a table yet.
    function marketplaceItemFromRow(row) {
        const content = row.content || [];
        return {
            id: row.id,
            title: row.title,
            description: row.description || '',
            tagline: row.tagline || '',
            price: row.price_label,
            count: content.length,
            nodes: content,
            canvasSnapshot: content
        };
    }
    async function refreshMarketplaceListings() {
        if (!supabase) return;
        const { data, error } = await supabase
            .from('marketplace_listings')
            .select('id, title, description, tagline, price_label, content, creator:profiles!marketplace_listings_creator_id_fkey(username)')
            .eq('status', 'published')
            .order('created_at', { ascending: false });
        if (error) { console.error('[marketplace] failed to load listings:', error); return; }
        trendingMarketplace = (data || []).map(row => ({
            ...marketplaceItemFromRow(row),
            creatorUsername: row.creator?.username || 'Unknown'
        }));
    }
    async function refreshMyLibrary() {
        if (!supabase || !appState.currentUser.id) return;
        const { data: mine, error: mineErr } = await supabase
            .from('marketplace_listings')
            .select('id, title, description, tagline, price_label, status, content')
            .eq('creator_id', appState.currentUser.id)
            .order('created_at', { ascending: false });
        if (mineErr) console.error('[marketplace] failed to load my listings:', mineErr);
        userLibrary.drafts = (mine || []).filter(r => r.status === 'draft').map(marketplaceItemFromRow);
        userLibrary.published = (mine || []).filter(r => r.status === 'published').map(marketplaceItemFromRow);

        const { data: acquired, error: acqErr } = await supabase
            .from('library_items')
            .select('acquired_at, listing:marketplace_listings(id, title, description, tagline, price_label, content)')
            .eq('user_id', appState.currentUser.id)
            .order('acquired_at', { ascending: false });
        if (acqErr) console.error('[marketplace] failed to load purchased items:', acqErr);
        // acquired_at drives the Library panel's "Purchased" folder, sorted most-recent-first —
        // carried through as acquiredAt alongside the usual marketplaceItemFromRow shape.
        userLibrary.purchased = (acquired || []).filter(r => r.listing).map(r => ({ ...marketplaceItemFromRow(r.listing), acquiredAt: r.acquired_at }));
    }

    async function switchCartTab(tab) {
        activeCartTab = tab;
        document.getElementById('tab-discover-btn').classList.toggle('active', tab === 'discover');
        document.getElementById('tab-library-btn').classList.toggle('active', tab === 'library');

        document.getElementById('view-discover').classList.toggle('active', tab === 'discover');
        document.getElementById('view-library').classList.toggle('active', tab === 'library');
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.remove('active');

        if (tab === 'discover') { await refreshMarketplaceListings(); renderMarketplaceDiscover(); }
        else { activeLibraryFolder = null; document.getElementById('library-back-row').classList.remove('show'); await refreshMyLibrary(); renderLibrary(); }
    }

    const libraryFolderLabels = { purchased: 'Purchased', drafts: 'Drafts', published: 'Published' };
    function switchLibraryFolder(folder) {
        activeLibraryFolder = folder;
        const backRow = document.getElementById('library-back-row');
        backRow.classList.toggle('show', !!folder);
        document.getElementById('library-back-label').textContent = folder ? ('Back to folders') : '';
        renderLibrary();
    }

    function handleMarketplaceSearch(val) {
        marketplaceSearchQuery = val.trim().toLowerCase();
        renderMarketplaceDiscover();
    }

    function renderMarketplaceDiscover() {
        const container = document.getElementById('market-list-container');
        container.innerHTML = '';
        
        const filtered = trendingMarketplace.filter(item => {
            return item.title.toLowerCase().includes(marketplaceSearchQuery) ||
                   item.description.toLowerCase().includes(marketplaceSearchQuery) ||
                   (item.tagline || '').toLowerCase().includes(marketplaceSearchQuery);
        });

        if (!filtered.length) {
            container.innerHTML = '<div class="text-xs text-neutral-500 text-center py-6 font-mono">No matching templates.</div>';
            return;
        }

        const label = document.createElement('div');
        label.className = 'waypoint-folder-header !px-1';
        label.textContent = 'Trending';
        container.appendChild(label);

        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'market-item-row';
            div.innerHTML = `
                <div class="market-item-header">
                    <div class="market-item-title">${escapeHtml(item.title)}</div>
                    <div class="market-item-price">${item.price}</div>
                </div>
                <div class="market-item-desc">${escapeHtml(item.tagline || item.description)}</div>
                <div class="market-item-meta">
                    <span>by ${escapeHtml(item.creatorUsername)}</span>
                    <span>★ 4.9</span>
                </div>
            `;
            div.onclick = () => openMarketDetail(item);
            container.appendChild(div);
        });
    }

    function openMarketDetail(item) {
        selectedMarketItem = item;
        document.getElementById('view-discover').classList.remove('active');
        document.getElementById('market-detail-view').classList.add('active');
        
        const content = document.getElementById('market-detail-content');
        content.innerHTML = `
            <div class="detail-title">${escapeHtml(item.title)}</div>
            <div class="detail-creator">Created by ${escapeHtml(item.creatorUsername)}</div>
            <div class="detail-price">${item.price}</div>
            <div class="detail-desc">${escapeHtml(item.description)}\n\nIncludes multiple interactive notes, tables, flashcard maps and customized language learning layouts. Supports real-time reference updates.</div>
        `;

        if (item.canvasSnapshot && item.canvasSnapshot.length) {
            // Preview only — pass draggableOut=false so this can't be dragged onto the user's own canvas
            content.appendChild(renderInlineCanvas(item.canvasSnapshot, false));
        }
    }

    function closeMarketDetail() {
        selectedMarketItem = null;
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('view-discover').classList.add('active');
    }

    async function purchaseCurrentMarketItem() {
        if (!selectedMarketItem) return;

        const alreadyOwns = userLibrary.purchased.some(x => x.id === selectedMarketItem.id);
        if (alreadyOwns) {
            alert("This template snapshot is already inside your Library!");
            closeMarketDetail();
            switchCartTab('library');
            return;
        }

        const { error } = await supabase
            .from('library_items')
            .insert({ user_id: appState.currentUser.id, listing_id: selectedMarketItem.id });
        if (error) { console.error('[marketplace] purchase failed:', error); alert('Something went wrong adding this to your library.'); return; }

        alert(`Successfully purchased "${selectedMarketItem.title}" as a customizable template snapshot!`);
        closeMarketDetail();
        switchCartTab('library');
        switchLibraryFolder('purchased');
    }

    function renderLibrary() {
        const container = document.getElementById('library-list-container');
        container.innerHTML = '';

        if (librarySearchQuery) {
            renderLibrarySearchResults(container);
            return;
        }

        if (!activeLibraryFolder) {
            ['purchased', 'drafts', 'published'].forEach(key => {
                const row = document.createElement('div');
                row.className = 'lib-folder-row';
                row.innerHTML = `<span>${libraryFolderLabels[key]}</span><span class="lib-folder-count">${userLibrary[key].length} item${userLibrary[key].length === 1 ? '' : 's'}</span>`;
                row.onclick = () => switchLibraryFolder(key);
                container.appendChild(row);
            });

            const divider = document.createElement('div');
            divider.className = 'library-divider';
            container.appendChild(divider);

            userLibrary.customFolders.forEach(folder => {
                const row = document.createElement('div');
                row.className = 'lib-folder-row';
                row.innerHTML = `<span>${escapeHtml(folder.name)}</span><span class="lib-folder-count">${folder.items.length} item${folder.items.length === 1 ? '' : 's'}</span>`;
                row.onclick = () => switchLibraryFolder(folder.id);
                container.appendChild(row);
            });

            const newFolderRow = document.createElement('div');
            newFolderRow.className = 'lib-new-folder-row';
            newFolderRow.innerHTML = `<span>+</span><span>New folder</span>`;
            newFolderRow.onclick = () => createCustomFolder();
            container.appendChild(newFolderRow);
            return;
        }

        const isCustom = isCustomFolderId(activeLibraryFolder);
        const customFolder = isCustom ? userLibrary.customFolders.find(f => f.id === activeLibraryFolder) : null;
        const list = isCustom ? (customFolder ? customFolder.items : []) : userLibrary[activeLibraryFolder];

        if (!list || !list.length) {
            container.innerHTML = `<div class="text-xs text-neutral-500 text-center py-12 font-mono">
                No templates inside folder. <br><br>
                ${activeLibraryFolder === 'drafts' ? 'Drag elements over marketplace when active to build a blueprint draft!' : ''}
                ${isCustom ? 'Use the "+ Folder…" picker on any item in Purchased, Drafts, or Published to add it here.' : ''}
            </div>`;
            return;
        }

        list.forEach(item => {
            const div = document.createElement('div');
            div.className = 'lib-item-card';

            const addToFolderControl = (!isCustom && userLibrary.customFolders.length)
                ? `<select class="lib-add-to-folder-select" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" onchange="if(this.value){addItemToCustomFolderById(this.value, '${activeLibraryFolder}', '${item.id}');} this.value='';">
                    <option value="">+ Folder…</option>
                    ${userLibrary.customFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
                </select>`
                : '';

            const removeControl = isCustom
                ? `<button class="lib-remove-btn" title="Remove from folder" onclick="event.stopPropagation(); removeFromCustomFolder('${activeLibraryFolder}', '${item.id}')">✕</button>`
                : '';

            div.innerHTML = `
                <div class="lib-item-meta">
                    <div class="lib-item-title">${escapeHtml(item.title)}</div>
                    <div class="lib-item-count">${item.count || 0} cards packaged</div>
                </div>
                ${addToFolderControl}
                ${removeControl}
            `;
            const status = isCustom ? resolveItemStatus(item) : activeLibraryFolder;
            if (status === 'drafts') makeDraftItemDraggable(div, item);
            else makeLibItemClickable(div, item, status);
            container.appendChild(div);
        });
    }

    // A library item may live in exactly one of these three real folders; custom folders
    // just hold references to items that already belong to one of them.
    function resolveItemStatus(item) {
        if (userLibrary.drafts.some(x => x.id === item.id)) return 'drafts';
        if (userLibrary.published.some(x => x.id === item.id)) return 'published';
        return 'purchased';
    }

    function makeLibItemClickable(div, item, status) {
        div.addEventListener('click', (e) => {
            if (e.target.closest('select') || e.target.closest('.lib-remove-btn')) return;
            openItemDetail(item, status);
        });
    }

    function isCustomFolderId(id) {
        return typeof id === 'string' && id.indexOf('customfolder_') === 0;
    }

    function createCustomFolder() {
        const name = prompt('Name your new library folder:', 'New Folder');
        if (name === null) return;
        const trimmed = name.trim();
        userLibrary.customFolders.push({ id: 'customfolder_' + appState.idCounter++, name: trimmed || 'New Folder', items: [] });
        renderLibrary();
    }

    function addItemToCustomFolderById(folderId, sourceKey, itemId) {
        const folder = userLibrary.customFolders.find(f => f.id === folderId);
        const source = userLibrary[sourceKey];
        if (!folder || !source) return;
        const item = source.find(x => String(x.id) === String(itemId));
        if (!item) return;
        if (folder.items.some(x => String(x.id) === String(itemId))) { renderLibrary(); return; }
        folder.items.push(item);
        renderLibrary();
    }

    function removeFromCustomFolder(folderId, itemId) {
        const folder = userLibrary.customFolders.find(f => f.id === folderId);
        if (!folder) return;
        folder.items = folder.items.filter(x => String(x.id) !== String(itemId));
        renderLibrary();
    }

    function handleLibrarySearch(val) {
        librarySearchQuery = val.trim().toLowerCase();
        renderLibrary();
    }

    function renderLibrarySearchResults(container) {
        const q = librarySearchQuery;
        const groups = [
            { key: 'purchased', label: libraryFolderLabels.purchased, items: userLibrary.purchased },
            { key: 'drafts', label: libraryFolderLabels.drafts, items: userLibrary.drafts },
            { key: 'published', label: libraryFolderLabels.published, items: userLibrary.published },
            ...userLibrary.customFolders.map(f => ({ key: f.id, label: f.name, items: f.items }))
        ];

        const results = [];
        groups.forEach(g => {
            const folderMatches = g.label.toLowerCase().includes(q);
            g.items.forEach(item => {
                if (folderMatches || (item.title || '').toLowerCase().includes(q)) {
                    results.push({ folderKey: g.key, folderLabel: g.label, item });
                }
            });
        });

        if (!results.length) {
            container.innerHTML = '<div class="text-xs text-neutral-500 text-center py-12 font-mono">No matches in your library.</div>';
            return;
        }

        results.forEach(({ folderKey, folderLabel, item }) => {
            const div = document.createElement('div');
            div.className = 'lib-item-card';
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <div class="lib-item-meta">
                    <div class="lib-item-title">${escapeHtml(item.title)}</div>
                    <div class="lib-item-count">${item.count || 0} cards packaged</div>
                    <div class="lib-search-result-folder">in ${escapeHtml(folderLabel)}</div>
                </div>
            `;
            div.onclick = () => {
                const input = document.getElementById('library-search');
                if (input) input.value = '';
                librarySearchQuery = '';
                const status = ['purchased', 'drafts', 'published'].includes(folderKey) ? folderKey : resolveItemStatus(item);
                switchLibraryFolder(folderKey);
                openItemDetail(item, status);
            };
            container.appendChild(div);
        });
    }

    // Lets a saved draft's card in the library list be dragged out onto the main
    // canvas, dropping in its packaged cards (mirrors the inline-canvas drag-out).
    function makeDraftItemDraggable(div, item) {
        div.style.cursor = 'grab';
        div.addEventListener('pointerdown', (e) => {
            if (e.target.closest('select') || e.target.closest('.lib-remove-btn')) return;
            e.stopPropagation();
            let dragStarted = false, dragGhost = null;
            const startX = e.clientX, startY = e.clientY;
            const move = (me) => {
                if (!dragStarted) {
                    if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
                    dragStarted = true;
                    dragGhost = document.createElement('div');
                    dragGhost.className = 'inline-canvas-drag-ghost';
                    dragGhost.textContent = `${item.count || item.nodes.length} card${item.count === 1 ? '' : 's'} — drop onto your canvas`;
                    document.body.appendChild(dragGhost);
                }
                dragGhost.style.left = (me.clientX + 14) + 'px';
                dragGhost.style.top = (me.clientY + 14) + 'px';
            };
            const up = (ue) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (dragGhost) dragGhost.remove();
                if (!dragStarted) { openItemDetail(item, 'drafts'); return; }
                const panelRect = cartPanel.getBoundingClientRect();
                const overPanel = ue.clientX >= panelRect.left && ue.clientX <= panelRect.right && ue.clientY >= panelRect.top && ue.clientY <= panelRect.bottom;
                if (overPanel) return;
                const canvasRect = canvas.getBoundingClientRect();
                const overCanvas = ue.clientX >= canvasRect.left && ue.clientX <= canvasRect.right && ue.clientY >= canvasRect.top && ue.clientY <= canvasRect.bottom;
                if (!overCanvas) return;
                importSharedCardsAtScreenPoint(item.nodes, ue.clientX, ue.clientY);
                closeCartPanel();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }

    function deployPurchasedTemplate(id) {
        const item = userLibrary.purchased.find(x => x.id === id);
        if (!item) return;
        
        saveSnapshot();
        const startX = Math.round((appState.tx + 200) / 28) * 28;
        const startY = Math.round((appState.ty + 200) / 28) * 28;
        
        // Spawn cards on canvas
        appState.folders[appState.currentFolderId].items.push({
            id: appState.idCounter++,
            x: startX,
            y: startY,
            w: 224,
            h: 112,
            kind: 'note',
            html: `<strong>${item.title} Note Block</strong><br>Newly deployed blueprint package.`
        });

        render();
        closeCartPanel();
    }

    function packageSelectedAsTemplate(targetIt) {
        let itemsToPackage = [];
        // If targetIt is selected, package all selected cards. Otherwise, package just this single card.
        const gestureIds = appState.selectedCardIds.includes(targetIt.id) ? appState.selectedCardIds.slice() : [targetIt.id];
        gestureIds.forEach(id => {
            const it = findItemById(id);
            if (it) itemsToPackage.push(sanitizeFlashcardSnapshot(snapshotItem(it), gestureIds));
        });

        if (itemsToPackage.length === 0) return;

        createDraftFromItems(itemsToPackage);

        // Clear selection to avoid visual clutter
        appState.selectedCardIds = [];
        renderSelectedOutlines();
    }

    // Cards dropped onto the marketplace panel are saved as a draft row right away (rather
    // than held only in local state), so there's nothing left to lose if the panel gets
    // closed (e.g. clicking outside it) before the user is done editing it.
    async function createDraftFromItems(items) {
        if (!supabase || !appState.currentUser.id) return;
        const { data, error } = await supabase.from('marketplace_listings').insert({
            creator_id: appState.currentUser.id,
            title: 'Untitled Draft',
            description: '',
            tagline: '',
            content: items,
            status: 'draft'
        }).select('id, title, description, tagline, price_label, status, content').single();
        if (error) { console.error('[marketplace] failed to create draft:', error); return; }

        const newItem = marketplaceItemFromRow(data);
        userLibrary.drafts.unshift(newItem);

        activeCartTab = 'library';
        activeLibraryFolder = 'drafts';
        document.getElementById('tab-discover-btn').classList.remove('active');
        document.getElementById('tab-library-btn').classList.add('active');
        document.getElementById('library-back-row').classList.add('show');
        document.getElementById('library-back-label').textContent = 'Back to folders';

        openItemDetail(newItem, 'drafts');
    }

    // ---------- Library Item Detail View (drafts / published / purchased) ----------
    let detailItem = null;
    let detailSourceFolder = null;
    let detailOriginal = null;

    function openItemDetail(item, sourceFolder) {
        detailItem = item;
        detailSourceFolder = sourceFolder;
        detailOriginal = { title: item.title, description: item.description || '', price: item.price || '' };

        // Keep the marketplace panel open (pinned) while the detail page is showing
        panelPinned.cart = true;
        cartPanel.classList.add('open');
        btnCart.classList.add('active');

        document.getElementById('view-discover').classList.remove('active');
        document.getElementById('view-library').classList.remove('active');
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.remove('active');
        document.getElementById('item-detail-view').classList.add('active');

        const view = document.getElementById('item-detail-view');
        view.classList.toggle('status-draft', sourceFolder === 'drafts');
        view.classList.toggle('status-published', sourceFolder === 'published');
        view.classList.toggle('status-purchased', sourceFolder === 'purchased');

        const isOwner = sourceFolder !== 'purchased';

        const titleEl = document.getElementById('item-detail-title');
        titleEl.textContent = item.title || '';
        titleEl.contentEditable = isOwner ? 'true' : 'false';

        const priceEl = document.getElementById('item-detail-price');
        priceEl.value = item.price || '';
        priceEl.disabled = !isOwner;

        const descEl = document.getElementById('item-detail-desc');
        descEl.value = item.description || '';
        descEl.disabled = !isOwner;
        descEl.placeholder = isOwner ? 'Add a description...' : '';

        const canvasWrap = document.getElementById('item-detail-canvas-wrap');
        canvasWrap.innerHTML = '';
        canvasWrap.appendChild(renderInlineCanvas(item.nodes || item.canvasSnapshot || [], false));

        renderItemDetailFooter();
    }

    function renderItemDetailFooter() {
        const footer = document.getElementById('item-detail-footer');
        if (detailSourceFolder === 'drafts') {
            footer.innerHTML = `
                <button class="btn-buy btn-secondary" onclick="deleteDetailDraft()">Delete</button>
                <button class="btn-buy" onclick="startPublishFlow()">Publish</button>`;
        } else if (detailSourceFolder === 'published') {
            footer.innerHTML = `
                <button class="btn-buy btn-secondary" onclick="unpublishDetailItem()">Unpublish</button>
                <button class="btn-buy" id="item-detail-update-btn" ${isDetailDirty() ? '' : 'disabled'} onclick="updateDetailItem()">Update</button>`;
        } else {
            footer.innerHTML = `<button class="btn-buy" onclick="deployPurchasedTemplate('${detailItem.id}')">Deploy</button>`;
        }
    }

    function isDetailDirty() {
        if (!detailOriginal) return false;
        const title = (document.getElementById('item-detail-title').textContent || '').trim();
        const description = document.getElementById('item-detail-desc').value.trim();
        const price = document.getElementById('item-detail-price').value.trim();
        return title !== detailOriginal.title || description !== detailOriginal.description || price !== detailOriginal.price;
    }

    function onItemDetailFieldChange() {
        if (detailSourceFolder !== 'published') return;
        const btn = document.getElementById('item-detail-update-btn');
        if (btn) btn.disabled = !isDetailDirty();
    }

    // Drafts are private and low-stakes, so title/description edits autosave on blur rather
    // than needing an explicit save action (there's no "Save" button anymore).
    function commitItemDetailTitle() {
        if (detailSourceFolder !== 'drafts' || !detailItem) return;
        const titleEl = document.getElementById('item-detail-title');
        const title = (titleEl.textContent || '').trim() || 'Untitled Draft';
        titleEl.textContent = title;
        if (title === detailItem.title) return;
        detailItem.title = title;
        detailOriginal.title = title;
        supabase.from('marketplace_listings').update({ title }).eq('id', detailItem.id).then(({ error }) => {
            if (error) console.error('[marketplace] failed to save title:', error);
        });
        const cached = userLibrary.drafts.find(x => x.id === detailItem.id);
        if (cached) cached.title = title;
    }

    function commitItemDetailDesc() {
        if (detailSourceFolder !== 'drafts' || !detailItem) return;
        const description = document.getElementById('item-detail-desc').value;
        if (description === detailItem.description) return;
        detailItem.description = description;
        detailOriginal.description = description;
        supabase.from('marketplace_listings').update({ description }).eq('id', detailItem.id).then(({ error }) => {
            if (error) console.error('[marketplace] failed to save description:', error);
        });
        const cached = userLibrary.drafts.find(x => x.id === detailItem.id);
        if (cached) cached.description = description;
    }

    // Published listings are live/public, so edits here are staged locally and only pushed
    // once "Update" is explicitly clicked (that's what the disabled-until-dirty state guards).
    async function updateDetailItem() {
        if (!detailItem || detailSourceFolder !== 'published') return;
        const title = (document.getElementById('item-detail-title').textContent || '').trim() || detailItem.title;
        const description = document.getElementById('item-detail-desc').value.trim();
        const price = document.getElementById('item-detail-price').value.trim() || detailItem.price;

        const { error } = await supabase.from('marketplace_listings').update({ title, description, price_label: price }).eq('id', detailItem.id);
        if (error) { console.error('[marketplace] failed to update listing:', error); return; }

        detailItem.title = title; detailItem.description = description; detailItem.price = price;
        detailOriginal = { title, description, price };
        document.getElementById('item-detail-title').textContent = title;
        const cached = userLibrary.published.find(x => x.id === detailItem.id);
        if (cached) { cached.title = title; cached.description = description; cached.price = price; }
        renderItemDetailFooter();
    }

    async function unpublishDetailItem() {
        if (!detailItem || detailSourceFolder !== 'published') return;
        const { error } = await supabase.from('marketplace_listings').update({ status: 'draft', published_at: null }).eq('id', detailItem.id);
        if (error) { console.error('[marketplace] failed to unpublish:', error); return; }
        await refreshMyLibrary();
        closeItemDetail();
        switchLibraryFolder('drafts');
    }

    async function deleteDetailDraft() {
        if (!detailItem || detailSourceFolder !== 'drafts') return;
        const { error } = await supabase.from('marketplace_listings').delete().eq('id', detailItem.id);
        if (error) { console.error('[marketplace] failed to delete draft:', error); return; }
        userLibrary.drafts = userLibrary.drafts.filter(x => x.id !== detailItem.id);
        closeItemDetail();
        renderLibrary();
    }

    function closeItemDetail() {
        detailItem = null; detailSourceFolder = null; detailOriginal = null;
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('view-library').classList.add('active');
        renderLibrary();
    }

    // ---------- Publish Flow (draft -> published, no native alert()/prompt() popups) ----------
    let publishFlowItem = null;

    function startPublishFlow() {
        if (!detailItem || detailSourceFolder !== 'drafts') return;
        publishFlowItem = detailItem;

        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.add('active');

        document.getElementById('publish-flow-name').textContent = publishFlowItem.title || '';
        document.getElementById('publish-flow-price').value = '';
        document.getElementById('publish-flow-tagline').value = '';
        document.getElementById('publish-flow-desc').value = publishFlowItem.description || '';

        const canvasWrap = document.getElementById('publish-flow-canvas-wrap');
        canvasWrap.innerHTML = '';
        canvasWrap.appendChild(renderInlineCanvas(publishFlowItem.nodes || [], false));
    }

    // Clicking into the name field always jumps the caret (and visible scroll) to the end,
    // so you can see what you're typing; blurring resets the scroll to the start, so the
    // beginning of the name is what's visible while not editing.
    function focusPublishFlowName() {
        const el = document.getElementById('publish-flow-name');
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        el.scrollLeft = el.scrollWidth;
    }
    function blurPublishFlowName() {
        document.getElementById('publish-flow-name').scrollLeft = 0;
    }

    async function confirmPublishFlow() {
        if (!publishFlowItem) return;
        const title = (document.getElementById('publish-flow-name').textContent || '').trim() || publishFlowItem.title || 'Untitled Draft';
        const price = document.getElementById('publish-flow-price').value.trim() || 'Free';
        const tagline = document.getElementById('publish-flow-tagline').value.trim();
        const description = document.getElementById('publish-flow-desc').value.trim();

        const { error } = await supabase.from('marketplace_listings').update({
            status: 'published',
            title,
            price_label: price,
            tagline,
            description,
            published_at: new Date().toISOString()
        }).eq('id', publishFlowItem.id);
        if (error) { console.error('[marketplace] failed to publish:', error); return; }

        publishFlowItem = null;
        document.getElementById('publish-flow-view').classList.remove('active');
        document.getElementById('view-library').classList.add('active');
        await refreshMyLibrary();
        switchLibraryFolder('published');
    }

    // ---------- Element Resize System ----------
    function setupResizing(el, it) {
        const handle = el.querySelector('.resize');
        if(!handle) return;
        const b = el.querySelector('.body'), moreBtn = el.querySelector('.more-btn');
        handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            // stopPropagation alone only stops the drag system's own listener from firing — it
            // does nothing to the browser's own native default action for a mousedown-and-drag,
            // which for a media card is "start a text selection" if the drag happens to sweep
            // near/across the invisible PDF text layer sitting nearby. preventDefault suppresses
            // that native default outright, so dragging this handle is only ever a resize.
            e.preventDefault();
            saveSnapshot();
            if (it.kind === 'table' && !it.userSized) {
                it.w = el.offsetWidth; it.h = el.offsetHeight;
                it.userSized = true;
                el.classList.add('sized');
                el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
                el.innerHTML = renderTableHTML(it);
                setupResizing(el, it);
                distributeTableSizing(it, el);
            }
            let sx = e.clientX, sy = e.clientY, sw = it.w, sh = it.h;
            const minSize = it.kind === 'table' ? 56 : 112;
            // Media cards (image/video/PDF/EPUB) resize proportionally, preserving their content's
            // real aspect ratio, instead of each axis independently the way table/note/flashcard
            // do — locked to the PDF page's own true ratio if it's known yet (see renderPage's
            // it.docAspectRatio), otherwise whatever ratio the card is currently at (correct
            // already for images/video, since computeMediaCardSize set w/h from the media's own
            // natural dimensions; an arbitrary starting point for EPUB, which has no fixed "page"
            // shape to lock to, but still scales proportionally from wherever it starts).
            const aspectRatio = it.kind === 'media' ? (it.docAspectRatio || (sw / sh)) : null;
            const move = (me) => {
                const dx = (me.clientX - sx) / appState.scale, dy = (me.clientY - sy) / appState.scale;
                if (aspectRatio) {
                    // Follow whichever axis the cursor moved more along; derive the other from
                    // the locked ratio rather than letting both drift independently.
                    let newW, newH;
                    if (Math.abs(dx) >= Math.abs(dy)) { newW = sw + dx; newH = newW / aspectRatio; }
                    else { newH = sh + dy; newW = newH * aspectRatio; }
                    it.w = Math.max(minSize, Math.round(newW / 28) * 28);
                    it.h = Math.max(minSize, Math.round(newH / 28) * 28);
                } else {
                    it.w = Math.max(minSize, Math.round((sw + dx) / 28) * 28);
                    it.h = Math.max(minSize, Math.round((sh + dy) / 28) * 28);
                }
                el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
                if (it.kind === 'table') distributeTableSizing(it, el);
                if (b && moreBtn) moreBtn.style.display = (it.expanded || b.scrollHeight > b.clientHeight || b.scrollWidth > b.clientWidth) ? 'block' : 'none';
                // Live visual streaming while dragging — see handleRemoteItemResize/broadcastItemResize.
                // Purely DOM-only on the receiving end, same as item-drag; the real w/h is only
                // committed once scheduleWorkspaceSave below runs on release.
                broadcastItemResize(it.id, it.w, it.h);
            };
            // Previously never called scheduleWorkspaceSave() at all — a resize wasn't synced live
            // to collaborators OR promptly persisted; it only ever reached the DB once some
            // unrelated later action happened to trigger a save.
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); scheduleWorkspaceSave(); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        });
    }

    function findNextFreeSlot(folderId) {
        const items = appState.folders[folderId].items;
        let x = 28;
        while (items.some(i => Math.abs(i.x - x) < 28 && Math.abs(i.y - 28) < 28)) { x += 28 * 8; }
        return x;
    }

    // Deletes the current multi-selection (see the Backspace keydown handler) — confirms once,
    // combined, first if any of them would lose irrecoverable data (a Source's spaced-repetition
    // memory, a Shelf's saved review sessions, or a table's own SM-2 progress). This is now the
    // only way to delete a card — the old per-card right-click "Delete" menu item is gone (see
    // the oncontextmenu change above).
    function deleteSelectedCards() {
        if (!appState.selectedCardIds.length) return;
        const items = appState.selectedCardIds.map(id => findItemById(id)).filter(Boolean);
        if (!items.length) return;
        const hasSource = items.some(it => it.kind === 'source');
        const hasShelf = items.some(it => it.kind === 'shelf');
        const hasSrsTable = items.some(it => it.kind === 'table' && it.srsMeta && Object.keys(it.srsMeta).length);
        if (hasSource || hasShelf || hasSrsTable) {
            const parts = [];
            if (hasSource) parts.push("a Source's permanently stored spaced-repetition memory (intervals, ease factors, due dates, streaks)");
            if (hasShelf) parts.push("a Shelf's permanently stored review session history");
            if (hasSrsTable) parts.push("a table's permanently stored spaced-repetition progress");
            if (!confirm(`Deleting will erase ${parts.join(', ')} for good. Delete anyway?`)) return;
        }
        saveSnapshot();
        const idSet = new Set(appState.selectedCardIds);
        const removedWaypoints = items.filter(it => it.kind === 'waypoint');
        // Nested canvases/sources being deleted along with everything inside them (their own
        // waypoints, their own collaborators, and any further-nested canvases in turn) — see
        // cascadeDeleteFolderContents.
        const removedFolders = items.filter(it => (it.kind === 'folder' || it.kind === 'source') && it.folderId);
        appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !idSet.has(i.id));
        appState.selectedCardIds = [];
        render();
        renderSelectedOutlines();
        removedWaypoints.forEach(it => deleteWaypointFromDb(appState.currentFolderId, it.id));
        removedFolders.forEach(it => cascadeDeleteFolderContents(it.folderId));
    }
    function setTableAlign(align) {
        const id = parseInt(contextMenu.dataset.id);
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.textAlign = align;
        render();
        contextMenu.style.display = 'none'; appState.contextMenuItemId = null;
    }

    // ---------- Hover-scoped game card shortcuts ----------
    // Whichever game card the mouse is currently sitting over gets its own keyboard shortcuts —
    // F to flip a flashcard, 1-4 for its rating row once flipped, Enter to advance a Typeright
    // card once it's been checked (the ONLY way to do that from the keyboard, since the input
    // itself goes disabled right after checking — see renderTypeRightHTML — and so can no longer
    // receive its own onkeydown). Read live via the :hover pseudo-class rather than tracked
    // mouseenter/mouseleave state, since render() rebuilds every .item element from scratch on
    // every change anyway.
    function hoveredGameCard() {
        const el = document.querySelector('.item.flashcard:hover, .item.typeright:hover');
        if (!el) return null;
        const it = findItemById(Number(el.id.replace('item-', '')));
        return it && (it.kind === 'flashcard' || it.kind === 'typeright') ? it : null;
    }
    // Any panel that owns its own keyboard input while open — same set closeAllPanels() knows
    // about, plus the search dropdown/outline menu — wins over a hovered card's shortcuts even
    // if the cursor happens to still be sitting over that card underneath it.
    function isAnyUiPanelOpen() {
        return outlineMenu.classList.contains('open')
            || accountMenu.classList.contains('open')
            || messagesPanel.classList.contains('open')
            || cartPanel.classList.contains('open')
            || profilePanel.classList.contains('open')
            || collabPanel.classList.contains('open')
            || addMenu.style.display === 'flex'
            || sourceAddMenu.style.display === 'flex'
            || (searchDropdown && searchDropdown.classList.contains('visible'));
    }
    document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const active = document.activeElement;
        // An actually-focused field always wins — this is also what keeps this handler from
        // double-firing Enter while someone's still typing in a Typeright input, since that
        // input has its own onkeydown for the pre-check Enter-to-submit path (see
        // renderTypeRightHTML); this one only ever needs to cover the POST-check state, where
        // the input has gone disabled and can't hold focus anymore.
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        if (isEditingText) return;
        if (isAnyUiPanelOpen()) return;
        if (currentNotification) return; // its own Enter/Escape handling should win, not compete
        const it = hoveredGameCard();
        if (!it) return;
        if (it.kind === 'flashcard') {
            if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fcFlip(it.id); return; }
            if (it.fcFlipped && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
                e.preventDefault();
                fcRate(it.id, ['noclue', 'wrong', 'hard', 'easy'][Number(e.key) - 1]);
            }
        } else if (it.kind === 'typeright') {
            if (e.key === 'Enter' && it.trChecked) { e.preventDefault(); trNext(it.id); }
        }
    });


    btnBack.onclick = () => { if(appState.historyIndex > 0) jumpToHistoryIndex(appState.historyIndex - 1); };
    btnForward.onclick = () => { if(appState.historyIndex < appState.historyStack.length - 1) jumpToHistoryIndex(appState.historyIndex + 1); };
    
    updateDrawLayerBtns();
    switchAddTab('notes');
    applyCursorMode();
    // Waits for any saved workspace before the first render, so a returning
    // user's real content shows immediately instead of flashing the built-in
    // starter folders first. loadWorkspace() no-ops instantly if there's no
    // signed-in user or nothing saved yet.
    (async () => {
        const restoredView = await loadWorkspace();
        render();
        if (!restoredView) centerOnContent();
        else applyTransform();
        // Same reasoning as the fix inside refreshCanvasCollabForCurrentFolder itself — the very
        // first render() above ran before this had any real data, so a landing folder with an
        // actual collaborator could otherwise start out wrongly deciding "no live channel needed"
        // straight from a fresh page load, not just after a later in-app navigation.
        refreshCanvasCollabForCurrentFolder();
        // A reload that resumed straight back into a shared canvas (see loadWorkspace's own
        // resume logic) reads the same as freshly entering it from the user's point of view — the
        // one-time "Collaborating on..." notification should still fire, not just for the
        // in-session entry points (openSharedCanvas/goToWaypointCard).
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSharedView) announceEnteredCollaboration(appState.currentFolderId);
    })();
    refreshFriendsData().then(() => renderCollabPill());
    refreshDotbotUsage();
