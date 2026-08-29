    // canvas/world/dotLayer/cursorOverlay are `let`, not `const` — reassigned by switchActivePane
    // (below) once a second pane's DOM exists (split-screen Stage 4+). ES module `let`-exports are
    // live bindings, so every existing `import { canvas, world } from './core-state.js'` across
    // every vanilla file keeps working with zero changes once this starts actually reassigning
    // them — see the split-screen plan's "core mechanism" section. Every other DOM ref declared
    // alongside them here is genuine singleton app chrome (one instance regardless of pane count)
    // and stays `const`.
    let canvas = document.getElementById('canvas'), world = document.getElementById('world'), dotLayer = document.getElementById('dot-layer'),
        cursorOverlay = document.getElementById('cursor-overlay');
    // btn-back/btn-forward (formerly declared here) no longer exist as singular ids — split-screen
    // Stage 8 moved back/forward to PaneTopBar.jsx, one real per-pane pair of buttons instead of a
    // single shared DOM node.
    const btnAdd = document.getElementById('btn-add'),
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
    // Shared with appState.currentUser just below — captured once here rather than reading
    // window.__DOTTO_USER__ twice, since the object literal itself can't reference
    // appState.currentUser (appState doesn't exist until the literal finishes constructing).
    const initialUser = window.__DOTTO_USER__ || { id: null, username: 'guest', displayName: 'You' };

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
        currentUser: initialUser,
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
        // Canvas tabs (public/dotto/shared-canvases-outline.js's addTab/switchTab/closeTab, see
        // their own comments) — each a lightweight bookmark of a folder location, NOT an
        // independent history/camera context: back/forward (historyStack/historyIndex above) and
        // pan/zoom stay global/shared across all tabs. Starts with exactly one tab pointing at the
        // initial currentFolderId above; nextTabId is a plain incrementing counter for generating
        // each new tab's id.
        tabs: [{ id: 'tab-0', folderId: 'root' }], activeTabId: 'tab-0', nextTabId: 1,
        // Split-screen pane bookkeeping (see switchActivePane/PANE_SCOPED_FIELDS below, and the
        // split-screen plan's "core mechanism" section) — GLOBAL, not itself pane-scoped: this is
        // the bookkeeping ABOUT panes, shared across all of them. activePaneId is which pane is
        // currently "hot" (its PANE_SCOPED_FIELDS values are the live appState.<field> ones right
        // now); panes holds every OTHER (inactive) pane's own saved snapshot, keyed by paneId —
        // the active pane deliberately has no entry here, its values just ARE the live ones.
        // nextPaneId is a plain incrementing counter for generating each new pane's id (Stage 5+,
        // splitPaneWithTab — shared-canvases-outline.js) — same shape as appState.nextTabId, just
        // for panes instead of tabs.
        activePaneId: 0, panes: {}, nextPaneId: 1,
        // Core data mapping of our multiple folder structures
        folders: {
            'root': {
                id: 'root',
                title: 'My First Canvas',
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
        // Shift-click-to-select state for the Chats/Waypoints/Collaborations hamburger list panels
        // — vanilla owns this as the source of truth (same convention as selectedCardIds just
        // above), mirrored into React's listPanelSelectionStore (app/dotto/bridges.js) via
        // window.__setListPanelSelection whenever it changes, purely so those rows can highlight.
        // See toggleListPanelSelection/clearListPanelSelection, hamburger-collab.js.
        listPanelSelection: { panel: null, ids: new Set() },
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
        // ---- Added in a follow-up pass after the Phase 1 module split: these 24 were declared
        // later in the original file (not part of the original ~88-line preamble Step 1 covered),
        // and were only discovered to need the same treatment when the split surfaced them as
        // genuine cross-file writes to an imported binding (a real runtime error, not just a lint
        // concern — ES module imports are read-only, so "drawLayer = 'front'" from a module that
        // only imported it throws "TypeError: Assignment to constant variable" the first time
        // that line actually runs). See PHASE2_ROADMAP.md Phase 1 for the audit that found the
        // rest of these systematically instead of one at a time.
        trendingMarketplace: [
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
    ],
        activeLibraryFolder: null,
        librarySearchQuery: '',
        marketplaceSearchQuery: '',
        selectedMarketItem: null,
        drawColor: '#ffffff', drawLayer: 'front', drawTool: 'pen', drawSize: 3,
        liveSvg: null, livePath: null, drawing: null,
        // Point-by-point pen-tool line in progress (see startPenPolyline/addPenPolylinePoint/
        // finishPenPolyline, srs-connections-core.js) — null whenever no such line is being built.
        // penPolylineMoveHandler holds the persistent window pointermove listener that draws the
        // rubber-band segment between clicks, so it can be torn down when the line finishes.
        penPolyline: null, penPolylineMoveHandler: null,
        hubCollabView: 'main',
        dotbotUpgradePromptedForFullness: false,
        activeConvoId: null,
        msgView: 'main',
        // Tracks the arrow-selected row in #search-command-palette's row list (see
        // command-palette.js's setCommandActive).
        commandActiveIndex: -1,
        dotbotSearchGeneration: 0,
        // The persisted chat thread the next Dotbot message continues, if any — null means the
        // next commenceDotbotSearch call starts a fresh conversation. Set from the orchestrate
        // route's response.conversationId after the first exchange in a session; reset to null in
        // clearSearch() (closing the overlay ends that thread for continuation purposes) unless a
        // saved chat was just explicitly reopened from the sidebar, which sets it directly instead.
        currentConversationId: null,
        preSharedViewState: null,
        // Added in a second follow-up pass: the module split's import graph turned out to be
        // deeply, pervasively circular (147 circular edges across all 29 files, confirmed by
        // simulating the real ES-module evaluation order rather than assuming entry-point
        // textual order) — a consequence of the original monolith's functions freely
        // cross-referencing each other regardless of textual position, which real ES modules
        // don't tolerate the same way classic-script hoisting did. Every one of these names is
        // let/const state that's read from at least one other file; unlike functions (safe under
        // circularity — confirmed empirically that hoisting protects them even when a circular
        // import triggers evaluation "early"), a plain variable read before its own declaring
        // file has reached that specific line throws exactly the "cannot access before
        // initialization" class of error this pass fixes. Moving all of them here is
        // deliberately the conservative, blanket fix rather than proving out which SPECIFIC
        // circular paths are dangerous name-by-name — core-state.js has zero imports of its own,
        // so nothing declared here can ever be mid-evaluation when anything else runs. A handful
        // (see DEPENDENT_ORDER below, right after this object literal closes) depend on another
        // one of these and can't be inlined here — see that comment for why.
        ADD_MENU_DATA: {
        notes: { label: 'Notes', categoryDesc: 'The building blocks of your canvas — headings, notes, tables and media.', items: [
            { kind: 'title', label: 'Heading', icon: '/assets/icons/heading.png' },
            { kind: 'note', label: 'Note', icon: '/assets/icons/note.png' },
            { kind: 'table', label: 'Table', icon: '/assets/icons/table.png' },
            { kind: 'media', label: 'Upload', icon: '/assets/icons/media.png' },
        ]},
        tools: { label: 'Tools', categoryDesc: 'Tools that help you interact with content — read, record, link, and trace.', items: [
            { kind: 'reader', label: 'Reader', icon: '/assets/icons/reader.png' },
            { kind: 'voice', label: 'Voice Recorder', icon: '/assets/icons/voice.png' },
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
            { kind: 'audiotype', label: 'Audio Type', icon: '/assets/icons/audio.png' },
        ]},
        stats: { label: 'Stats', categoryDesc: 'Cards that show stats pulled from a linked card.', items: [
            { kind: 'statcard', statKind: 'progress', label: 'Progress', icon: '/assets/icons/progress.png' },
            { kind: 'statcard', statKind: 'accuracy', label: 'Accuracy', icon: '/assets/icons/accuracy.png' },
        ]},
    },
        userLibrary: {
        purchased: [],
        drafts: [],
        published: [],
        customFolders: []
    },
        addMenuSearchQuery: '',
        undoStack: [],
        redoStack: [],
        swTickInterval: null,
        workspaceSaveTimer: null,
        // Guards against a real, observed data-loss race: loadWorkspace() (history-autosave.js) is
        // an async network round-trip, awaited before the very first render() (resize-shortcuts-
        // init.js) — but the visibilitychange/pagehide listeners that flush an immediate save on
        // tab-hide/close (same file) are registered at plain module-load time, active from the
        // instant the page starts, with no awareness of whether that initial fetch has resolved
        // yet. If the tab was hidden (switched away, minimized, closed) at any point WHILE the
        // fetch was still in flight, saveWorkspaceNow() fired immediately using whatever appState
        // .folders held at that exact moment — the built-in single-root STARTER content, since the
        // real saved data hadn't been applied yet — and upsert has no merge semantics, so that tiny
        // starter payload silently overwrote the user's entire real workspace in the database.
        // false until loadWorkspace's own async work concludes (every one of its exit points sets
        // this true — see its own comment) in every outcome (real data restored, confirmed nothing
        // saved yet, or a load error), at which point appState.folders is known to correctly
        // reflect whatever should actually be persisted; saveWorkspaceNow bails out early while
        // this is still false rather than ever risking a save from pre-load default state.
        workspaceLoaded: false,
        contextMenuTableCtx: null,
        ZOOM_MIN: 0.2,
        ZOOM_MAX: 2,
        DOT_LAYER_MARGIN: 200,
        cameraTweenTimeout: null,
        applyTransformRafId: null,
        SM2_QUALITY: { noclue: 0, wrong: 1, hard: 3, easy: 5 },
        cardClipboard: [],
        clipboardPasteCount: 0,
        sourceAddMenu: document.getElementById('source-add-menu'),
        cellTagPicker: document.getElementById('cell-tag-picker'),
        audioRecordIndicator: document.getElementById('audio-record-indicator'),
        modeToolbar: document.getElementById('mode-toolbar'),
        modePopup: document.getElementById('mode-popup'),
        MODE_ORDER_WEIGHT: { normal: 0, data: 1, select: 2, pen: 3 },
        MODE_HOLD_THRESHOLD_MS: 180,
        modeKeyHoldStart: null,
        // "rail" replaces the old separate menu/messages/cart/profile/add flags — all of them now
        // share one #hamburger-stack shell (see openRailView, panels-hamburger.js), so there's only
        // ever one pinned-or-not state to track, not several independent ones that happened to all
        // mean "is #hamburger-stack pinned open." collab/sourceAdd are unrelated systems (the
        // per-canvas collab flyout, source-add-menu) and keep their own flags.
        panelPinned: { rail: false, collab: false, sourceAdd: false },
        // Which #hamburger-stack view is currently showing — null | 'inbox' | 'search' | 'ai' |
        // 'sources' | 'snippets' | 'snippets2' | 'outline' | 'waypoints' |
        // 'collab' | 'marketplace' | 'library' | 'messages' | 'profile'. Set by openRailView,
        // cleared by closeRailView (panels-hamburger.js).
        activeRailView: null,
        dottoRail: document.getElementById('dotto-rail'),
        btnInbox: document.getElementById('btn-inbox'),
        inboxPanel: document.getElementById('inbox-panel'),
        btnSearch: document.getElementById('btn-search'),
        searchPanel: document.getElementById('search-panel'),
        btnSources: document.getElementById('btn-sources'),
        sourcesPanel: document.getElementById('sources-panel'),
        btnSnippets: document.getElementById('btn-snippets'),
        snippetsPanel: document.getElementById('snippets-panel'),
        // A separate, newer Snippets button from btnSnippets/snippetsPanel above (which is
        // actually Files under the hood — see its own comment, hamburger-stack.html) — the two
        // just happen to share a name and icon, per explicit request.
        btnSnippets2: document.getElementById('btn-snippets2'),
        snippets2Panel: document.getElementById('snippets2-panel'),
        // File-upload popup (U toggles it) — independent of the #hamburger-stack rail-panel
        // system entirely (not a railViewEls/railIconBtns entry, no wireRailIcon call); own
        // open/close, see upload-popup.js.
        uploadPopup: document.getElementById('upload-popup'),
        uploadPopupBtn: document.getElementById('upload-popup-btn'),
        uploadPopupClose: document.getElementById('upload-popup-close'),
        uploadDropzone: document.getElementById('upload-dropzone'),
        uploadDropzoneLabel: document.getElementById('upload-dropzone-label'),
        railBtnAi: document.getElementById('rail-btn-ai'),
        railBtnWaypoints: document.getElementById('rail-btn-waypoints'),
        railBtnCollab: document.getElementById('rail-btn-collab'),
        hamburgerBtn: document.getElementById('btn-menu'),
        outlineMenu: document.getElementById('outline-menu'),
        outlineSearchInput: document.getElementById('outline-search'),
        hamburgerStack: document.getElementById('hamburger-stack'),
        waypointsPanel: document.getElementById('waypoints-panel'),
        waypointsSearchInput: document.getElementById('waypoints-search'),
        hubCollabPanel: document.getElementById('hub-collab-panel'),
        hubCollabSearchInput: document.getElementById('hub-collab-search'),
        incomingCanvasRequests: [],
        acceptedCanvasCollaborations: [],
        ownedCanvasCollaborations: [],
        seenIncomingCanvasRequestIds: null,
        profileBtn: document.getElementById('btn-profile'),
        profilePanel: document.getElementById('profile-panel'),
        // profilePanel is the whole rail view (railViewEls member); profileMainView/
        // profileSettingsView are its two internal sub-views, toggled independently of the outer
        // rail's own open/close state (see showProfileMainView/showProfileSettingsView,
        // profile-achievements-pricing.js) — same shape as aiListView/aiChatView above. Settings'
        // own content (Brightness Theme, Sidebar Mode) moved into profileSettingsView once
        // #settings-panel was removed as its own rail icon, per explicit request.
        profileMainView: document.getElementById('profile-main-view'),
        profileSettingsView: document.getElementById('profile-settings-view'),
        LEVEL_NAMES: [
        'Noob', 'Novice', 'Apprentice', 'Learner', 'Scholar', 'Seeker', 'Thinker', 'Strategist',
        'Specialist', 'Expert', 'Master', 'Savant', 'Polymath', 'Brainiac', 'Prodigy', 'Intellect',
        'Visionary', 'Titan', 'Archon', 'Omniscient',
    ],
        SUB_RANKS_PER_TIER: 9,
        LEVEL_GROWTH_RATE: 1.045,
        LEVEL_BASE_POINTS: 100,
        ACHIEVEMENTS: [
        { id: 'first_block',      statKey: 'blocks_placed',    threshold: 1,     name: 'Place your first block',        spriteIndex: 1 },
        { id: 'three_friends',    statKey: 'friends_added',    threshold: 3,     name: 'Add three friends',              spriteIndex: 2 },
        { id: 'twenty_searches',  statKey: 'ai_searches',      threshold: 20,    name: 'Make twenty AI searches',        spriteIndex: 4 },
        { id: 'fifty_links',      statKey: 'data_links',       threshold: 50,    name: 'Make fifty links in data mode',  spriteIndex: 5 },
        { id: 'hundred_flips',    statKey: 'flashcard_flips',  threshold: 100,   name: 'Flip one hundred cards',         spriteIndex: 6 },
        { id: 'master_250_words', statKey: 'words_mastered',   threshold: 250,   name: 'Master 250 words',               spriteIndex: 7 },
        { id: 'day_in_platform',  statKey: 'platform_seconds', threshold: 86400, name: 'Spend 24 hours in the platform', spriteIndex: 8 },
    ],
        SPRITE_TOTAL_COUNT: 108,
        BLOCKS_CAP: 100,
        searchUsageWarned: false,
        genUsageWarned: false,
        // PRICING_PLANS/PRICING_FEATURE_ROWS moved to app/dotto/PricingOverlay.jsx — Phase 2
        // increment 1 (see PHASE2_ROADMAP.md), pure presentation data with zero coupling to the
        // rest of the app, now owned by the React component that renders it.
        messagesBtn: document.getElementById('btn-messages'),
        messagesPanel: document.getElementById('messages-panel'),
        // Bare shell for now (see wireRailIcon('servers', ...), panels-hamburger.js) — behavior/
        // content not yet decided, same as most of this rail.
        btnServers: document.getElementById('btn-servers'),
        serversPanel: document.getElementById('servers-panel'),
        msgConvo: document.getElementById('msg-convo'),
        msgList: document.getElementById('msg-list'),
        msgSearchInput: document.getElementById('msg-search'),
        // No static #collab-bubble any more (split-screen Stage 8 — every pane renders its own,
        // PaneTopBar.jsx) — starts null, retargeted to whichever pane's own bubble element the user
        // actually clicks/hovers (collabBubblePaneClick/MouseEnter, friends-presence.js) before
        // anything reads it. A mutable object property (not a `let`/`const` binding), so it can be
        // reassigned at runtime like this — see friends-presence.js's own comment.
        collabBubble: null,
        collabPanel: document.getElementById('collab-panel'),
        collabSearchInput: document.getElementById('collab-search'),
        outgoingCanvasInvitePendingIds: new Set(),
        COLLAB_LIST_MAX: 6,
        friends: [],
        incomingRequests: [],
        outgoingPendingIds: new Set(),
        seenIncomingFriendRequestIds: null,
        AFK_THRESHOLD_MS: 5 * 60 * 1000,
        localPresenceStatus: 'online',
        afkTimer: null,
        friendPresenceLastStatus: new Map(),
        friendMessageChannels: new Map(),
        CURSOR_COLORS: ['#F87171', '#FB923C', '#FBBF24', '#4ADE80', '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6'],
        REMOTE_CURSOR_TRAVEL_MS: 220,
        canvasPresenceChannel: null,
        canvasPresenceKey: null,
        remoteCursors: new Map(),
        lastBroadcastSnapshot: null,
        pendingSyncDeltas: null,
        syncBroadcastTimer: null,
        localEditingState: { editing: false, editingTarget: null, caret: null },
        lastPointerClientX: null,
        lastPointerClientY: null,
        cursorBroadcastThrottleId: null,
        itemDragBroadcastThrottleId: null,
        itemResizeBroadcastThrottleId: null,
        caretBroadcastThrottleId: null,
        inlineCanvasDeleteMenuEl: null,
        STATIC_HEADER_PILL_GAP: 8,
        // Was 3.2 (3 full columns + a peek of the 4th before scrolling) — tightened to 2.2 per
        // explicit request that only 2 columns fit the screen before more start scrolling (see
        // layoutSourceTableColumns's `overflowing` check, source-table.js, now numCols > 2).
        STATIC_TABLE_VISIBLE_COLS: 2.2,
        STATIC_TABLE_ROW_GAP: 10,
        STATIC_TABLE_PAGE_PADDING_TOP: 96,
        STATIC_TABLE_PAGE_PADDING_BOTTOM: 16,
        STATIC_TABLE_BOTTOM_MARGIN: 20,
        STATIC_TABLE_UPLOAD_BTN_RESERVE: 35,
        AI_SOURCE_MAX_COLS: 10,
        AI_SOURCE_MAX_ROWS: 150,
        pdfjsLibPromise: null,
        pdfDocCache: new Map(),
        epubjsLibPromise: null,
        epubBookCache: new Map(),
        CLOZE_RE: /\[([^\[\]]+)\]/g,
        shelfRowClickTimer: null,
        searchInput: document.getElementById('search-input'),
        searchCommandPalette: document.getElementById('search-command-palette'),
        searchDotbotAnswer: document.getElementById('search-dotbot-answer'),
        searchTranslation: document.getElementById('search-translation'),
        searchDictionary: document.getElementById('search-dictionary'),
        searchExamples: document.getElementById('search-examples'),
        searchImageResult: document.getElementById('search-image-result'),
        searchSuggestions: document.getElementById('search-suggestions'),
        searchRecommended: document.getElementById('search-recommended'),
        searchDropdown: document.getElementById('search-dropdown'),
        // The persisted multi-turn chat thread, above #search-input-wrap — see ChatThread.jsx/
        // chatThreadStore (app/dotto/bridges.js) and updateChatThread (ai-assistant-suggestions.js).
        searchChatThread: document.getElementById('search-chat-thread'),
        searchSpinner: document.getElementById('search-spinner'),
        searchInputWrap: document.getElementById('search-input-wrap'),
        // AI search shares the permanent rail's one shell now (see openRailView, panels-
        // hamburger.js) — no more #search-overlay-backdrop modal, so no lookup for it. aiPanel is
        // the whole rail view (railViewEls member); aiChatView/aiListView are its two internal
        // sub-views, toggled independently of the outer rail's own open/close state (see
        // showAiListView/showAiChatView, ai-assistant-suggestions.js). aiListHeader is where
        // #search-input-wrap/#search-dropdown live at rest (see the fragment's own comment on
        // #ai-panel) — cached here since showAiChatView/showAiListView reparent those two
        // elements into/out of it directly.
        aiPanel: document.getElementById('ai-panel'),
        aiChatView: document.getElementById('ai-chat-view'),
        aiListView: document.getElementById('ai-list-view'),
        aiListHeader: document.getElementById('ai-list-header'),
        // Notification stack, bottom-left (see pushNotification/showNotification/
        // dismissNotification, stopwatch-search-notifications.js, and app/dotto/NotificationBar.jsx,
        // which owns the entire rendering surface now — no static markup node left to reach via
        // appState; explicit redesign, was a single top-center pill swapping places with
        // #top-bar-center).
        NOTIFICATION_DEFAULT_DURATION_MS: 5000,
        // At most this many visible at once (explicit request) — showNotification drops the
        // oldest (the last entry in visibleNotifications below) once a new arrival would exceed
        // this, rather than growing the stack unbounded. NotificationBar.jsx plays a real
        // slide-out exit animation for whichever entry actually leaves the array this way, rather
        // than it just vanishing — see its own comment.
        NOTIFICATION_MAX_VISIBLE: 3,
        // Notifications pushed while the tab isn't visible wait here (see pushNotification) rather
        // than showing immediately unseen — flushed as a batch (each becomes its own real,
        // independently-timed notification, no artificial stagger) once the tab is visible again.
        notificationQueue: [],
        // Every CURRENTLY visible notification, newest first — {id, config}[], capped at
        // NOTIFICATION_MAX_VISIBLE. Genuinely multiple can be up at once (explicit request:
        // "remove the delay between notifications"), so there's no single "current" one any more.
        visibleNotifications: [],
        searchCardContext: [],
        searchCardConnections: [],
        NON_LATIN_SCRIPT_RE: new RegExp("[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\s\d]"),
        dotbotSuggestDebounceTimer: null,
        dotbotSuggestAbortController: null,
        // Same idea as dotbotSuggestDebounceTimer above, for the slash-command palette's nested
        // shared-tree name search (search_accessible_by_name RPC) — see
        // scheduleSharedCommandSuggestions, command-palette.js.
        commandSuggestDebounceTimer: null,
        dotbotMnemonicPair: { text: null, image: null },
        TYPEWRITER_LOADING_WORDS: ['Thinking', 'Consulting', 'Reasoning', 'Picturing', 'Composing', 'Imagining'],
        typewriterLoadingTimers: new WeakMap(),
        currentTtsAudio: null,
        // selectionToolbarEl removed — React owns the toolbar element now (Phase 2 increment 2,
        // see app/dotto/SelectionToolbar.jsx).
        selectionToolbarRange: null,
        selectionToolbarHostEl: null,
        selectionToolbarRect: null,
        // addToSourcePopupEl removed — React owns the popup element now (Phase 2, see
        // app/dotto/AddToSourcePopup.jsx); reach it via document.getElementById('add-to-source-popup').
        addToSourceTarget: null,
        WAYPOINT_COLLAPSED_W: 28,
        waypointPeekTimer: null,
        sharedOwnerNameCache: {},
        outlineRows: [],
        outlineActiveIndex: -1,
        OUTLINE_MAX_DEPTH: 2,
        OUTLINE_GROUP_MAX_DIST: 30 * 28,
        OUTLINE_RESCUE_MAX_DIST: 10 * 28,
        btnCart: document.getElementById('btn-cart'),
        cartPanel: document.getElementById('cart-panel'),
        libraryBtn: document.getElementById('btn-library'),
        libraryPanel: document.getElementById('library-panel'),
        libraryFolderLabels: { purchased: 'Purchased', drafts: 'Drafts', published: 'Published' },
        detailItem: null,
        detailSourceFolder: null,
        detailOriginal: null,
        publishFlowItem: null,
    };
    appState.dotLayerBaseX = -appState.DOT_LAYER_MARGIN / 2;
    appState.dotLayerBaseY = -appState.DOT_LAYER_MARGIN / 2;
    appState.modeButtons = Array.from(appState.modeToolbar.querySelectorAll('.mode-btn'));
    // The separate popup-panel rows (top-bar.html) — a different, new element from .mode-btn
    // above, deliberately not sharing that class (see the panel's own comment there); kept in
    // sync alongside modeButtons by the same updateModeToolbarUI (source-buttons-cursor-mode.js).
    appState.modePopupRows = Array.from(appState.modeToolbar.querySelectorAll('.mode-popup-row'));
    // Every panel-style rail view, in the same order as their icons top-to-bottom in #dotto-rail
    // (see openRailView/closeRailView, panels-hamburger.js) — replaces the old hubSubpanels (just
    // Waypoints/Collaborations/Chats) now that Marketplace/Library/Messages/Add/Profile/AI search
    // share the exact same "one shell, swap which section is .open" mechanism. Library is a
    // separate rail view from Marketplace (own icon, own panel) — they used to be two tabs sharing
    // one #cart-panel; #cart-panel is now Discover browsing only. #chats-panel is deliberately NOT
    // here — Chats is a sub-view reached from inside the AI view (searchBar), not a top-level rail
    // destination of its own. #inbox-panel/#search-panel/#documents-panel/#sources-panel/
    // #snippets-panel/#servers-panel are bare shells (see
    // wireRailIcon('inbox'/'search'/'documents'/'sources'/'snippets', ...) below) — their own
    // behavior/content hasn't been designed yet.
    appState.railViewEls = [appState.inboxPanel, appState.searchPanel, appState.aiPanel, appState.sourcesPanel, appState.snippetsPanel, appState.snippets2Panel, appState.outlineMenu, appState.waypointsPanel, appState.hubCollabPanel, appState.cartPanel, appState.libraryPanel, appState.messagesPanel, appState.serversPanel, addMenu, appState.profilePanel];
    appState.railIconBtns = [appState.btnInbox, appState.btnSearch, appState.railBtnAi, appState.btnSources, appState.btnSnippets, appState.btnSnippets2, appState.hamburgerBtn, appState.railBtnWaypoints, appState.railBtnCollab, appState.btnCart, appState.libraryBtn, appState.messagesBtn, appState.btnServers, btnAdd, appState.profileBtn];
    appState.TOTAL_SUB_LEVELS = appState.LEVEL_NAMES.length * appState.SUB_RANKS_PER_TIER;
    // Same reason as the block above: can't reference appState.currentUser from inside appState's
    // own object literal, since appState doesn't exist yet until that literal finishes constructing.
    appState.unlockedAchievementIds = new Set(appState.currentUser.unlockedAchievementIds || []);

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

    // Every appState field whose value genuinely belongs to "whichever specific pane you're
    // looking at" — camera position, which folder/tabs it's navigated to, its own back/forward
    // history, and its own selection/cursor-mode — as opposed to app-wide chrome/settings/data
    // that's the same no matter which pane is active. Deliberately does NOT include transient,
    // actively-in-progress interaction state (context menus, an in-progress pen stroke or media
    // recording, an open tag picker, currentEditingEl) — those are momentary and naturally
    // resolve themselves (blur, pointerup) the same way switching windows/apps mid-gesture would
    // in any other app, rather than needing to be preserved across a pane switch. That split is a
    // judgment call made from static reasoning, not yet exercised by real cross-pane interaction —
    // expect this list to need revisiting once Stage 4 (two independently-interactive panes) is
    // actually built and tested live, per the split-screen plan's own review note.
    const PANE_SCOPED_FIELDS = [
        'tx', 'ty', 'scale',
        'currentFolderId', 'historyStack', 'historyIndex',
        'tabs', 'activeTabId', 'nextTabId',
        'selectedCardIds',
        'cardMode', 'modeOverrideKey', 'modeKeyHoldStart',
        'dataLinkPendingId',
        // Added during Stage 3 (live-presence.js/history-autosave.js pane-parameterization),
        // not the original Stage 1 pass — smoothPanTo (history-autosave.js) clears this specific
        // pending timeout at the top of every call before scheduling its own, so it has to track
        // whichever PANE'S tween is in flight, not a single global handle shared by every pane —
        // otherwise switching panes mid-tween and starting a new tween in the newly-active pane
        // would clearTimeout the PREVIOUS pane's still-pending cleanup out from under it, same
        // class of bug the DOM-ref capture fix below addresses.
        'cameraTweenTimeout',
        // Also added during Stage 3 — these four gate live-presence.js's throttled broadcasters
        // (cursor position, dragged-item position, dragged-item resize, caret position) to at most
        // one send per ~50ms. As a single shared global each, one pane's broadcast starts a cooldown
        // that would silently suppress a DIFFERENT pane's legitimate broadcast landing within that
        // same window — unlike canvasPresenceChannel/pendingSyncDeltas/etc (which genuinely need to
        // stay live for a BACKGROUND pane too, real Stage 4+ feature work, not something swap-in-
        // place can express), a throttle window only ever needs to track "whichever pane you're
        // actively pointer-interacting with right now," which swap-in-place already models exactly.
        'cursorBroadcastThrottleId', 'itemDragBroadcastThrottleId', 'itemResizeBroadcastThrottleId',
        'caretBroadcastThrottleId',
    ];
    // Swap-in-place pane switching (see the split-screen plan's "core mechanism" section for the
    // full design rationale — chosen over a Proxy/accessor redirect). Copies the CURRENTLY active
    // pane's live PANE_SCOPED_FIELDS values out into its own saved slot in appState.panes, then —
    // if the target pane already has a saved slot (i.e. it's a real pre-existing pane, not a
    // brand-new one) — copies that pane's saved values into the live appState.<field> slots so
    // every existing reader/writer across the app (appState.tx, appState.selectedCardIds, etc.)
    // transparently sees the newly-active pane's own state with zero changes to those call sites.
    // A brand-new target pane (no saved slot yet) is left with whatever the live fields already
    // hold — its caller (splitPaneWithTab, Stage 5+) is responsible for resetting them to fresh
    // defaults right after, per the plan's "the new pane gets its own camera/selection state from
    // scratch" decision, not this function's job.
    function switchActivePane(paneId) {
        if (paneId === appState.activePaneId) return;
        const outgoing = appState.panes[appState.activePaneId] || (appState.panes[appState.activePaneId] = {});
        PANE_SCOPED_FIELDS.forEach(f => { outgoing[f] = appState[f]; });
        outgoing.canvas = canvas; outgoing.world = world; outgoing.dotLayer = dotLayer; outgoing.cursorOverlay = cursorOverlay;

        const incoming = appState.panes[paneId];
        if (incoming) {
            PANE_SCOPED_FIELDS.forEach(f => { appState[f] = incoming[f]; });
            canvas = incoming.canvas; world = incoming.world; dotLayer = incoming.dotLayer; cursorOverlay = incoming.cursorOverlay;
        }
        // The pane that was just switched TO is the one whose values are now live — it has no
        // saved slot of its own while active, same as activePaneId's own comment says.
        delete appState.panes[paneId];
        appState.activePaneId = paneId;

        // Push the newly-active pane's own tabs/activeTabId into React (TabsBar.jsx) immediately —
        // without this, clicking into an already-existing OTHER pane (not one just created by
        // splitPaneWithTab, which already gets a render() of its own via initializeNewPane) left
        // the tab bar showing whichever pane's tabs it last rendered until something UNRELATED
        // happened to call render() afterward. A real, previously-undiscovered gap: Stage 4/5 never
        // exercised switching back and forth between two pre-existing panes without an intervening
        // navigation in between. window.__renderTabsPanel (shared-canvases-outline.js) is called via
        // a window bridge rather than a direct import — core-state.js is imported BY
        // shared-canvases-outline.js, so importing back would be circular.
        if (window.__renderTabsPanel) window.__renderTabsPanel();
        // Same reasoning, split-screen Stage 8 — the newly-active pane's own back/forward buttons
        // and collaborator bubble (PaneTopBar.jsx) shouldn't have to wait for the next render()
        // frame to reflect its own historyIndex/currentFolderId either.
        if (window.__renderNavArrows) window.__renderNavArrows();
        if (window.__renderCollabPill) window.__renderCollabPill();
        // Lets PaneZoomBar.jsx (explicit request: the zoom bar "should only appear when you're in
        // that current window... current meaning last clicked in") react to which pane is active —
        // nothing else needed a reactive answer to this before now, everything else just reads
        // appState.activePaneId directly off the vanilla side.
        if (window.__setActivePaneId) window.__setActivePaneId(paneId);
        if (window.__renderMediaViewerZoom) window.__renderMediaViewerZoom(paneId);
    }

    // Canvas-LEVEL (not item-level) event listeners — wheel pan/zoom, box-selection pointerdown,
    // context menu, pen-polyline finish, paste-preview tracking, cursor-broadcast pointermove,
    // panel-resize recalc — are each attached exactly ONCE, at their owning vanilla file's own
    // module-load time, directly to whichever DOM node `canvas` happened to be AT THAT MOMENT
    // (pane 0's element, the only one that exists at boot). Reassigning the `canvas`/`world` `let`
    // bindings later (switchActivePane/initializeNewPane) does NOT move these listeners —
    // addEventListener binds to a specific node reference, not a variable — so a brand-new pane's
    // own canvas element never gets any of them unless something explicitly re-attaches them to
    // it. A real bug this way: found via a production-build test where splitting a second pane
    // left it with no working wheel-pan at all, since its own #canvas-{paneId} never had that
    // listener. Each owning file registers its own "attach my canvas-level listener(s) to a given
    // canvas element" function here via registerPaneCanvasListenerSetup, called once at that
    // file's own module-load time ALONGSIDE its existing pane-0 addEventListener call (that
    // original call is untouched — this is purely additive, zero behavior change for pane 0).
    // setupPaneCanvasListeners(paneId), called from initializeNewPane below, then runs every
    // registered setup against that pane's own canvas element, so every new pane picks up the
    // full set automatically without each pane-creation call site needing its own list. Each
    // registered fn receives (canvasEl, paneId) — the paneId matters because most of these
    // handlers aren't pointerdown (wheel, pointermove, contextmenu, transitionend, dblclick), so
    // the capture-phase pointerdown router (PaneGrid.jsx) never runs ahead of them the way it does
    // for a real click — a handler that only reads appState.tx/etc AMBIENTLY, trusting
    // activePaneId already matches, would silently act on the WRONG pane's camera/state if the
    // user e.g. wheels over an inactive pane without clicking it first. Each handler is expected to
    // call switchActivePane(paneId) itself as its own first line (a no-op if already active) rather
    // than relying on that invariant.
    const paneCanvasListenerSetups = [];
    function registerPaneCanvasListenerSetup(fn) {
        paneCanvasListenerSetups.push(fn);
    }
    function setupPaneCanvasListeners(paneId) {
        const canvasEl = document.getElementById(paneElId('canvas', paneId));
        if (!canvasEl) return;
        paneCanvasListenerSetups.forEach(fn => fn(canvasEl, paneId));
    }

    // Finishes bringing a BRAND-NEW pane (one switchActivePane just made active but that had no
    // saved slot, so its live fields/DOM refs are still whatever the PREVIOUS pane's were) up to a
    // real, independent starting state: resolves and assigns this pane's own DOM refs (the `let`
    // canvas/world/dotLayer/cursorOverlay bindings can only be reassigned from within this module,
    // which is why this lives here rather than in the caller) and resets every PANE_SCOPED_FIELDS
    // entry to a fresh default — matching the plan's "the new pane gets its own camera/selection
    // state from scratch" decision, not a copy of whichever pane it split off from. Must be called
    // AFTER switchActivePane(paneId) has already made this pane active (so the reset writes land on
    // the live appState.<field> slots, not some other pane's saved ones) and after that pane's own
    // DOM (PaneCanvasArea.jsx) has actually mounted. Only call this for a pane with NO saved slot —
    // switching back to a pane that already has one (Stage 6's close/reopen, if that's ever
    // supported) should go through the normal switchActivePane restore path instead, not this reset.
    function initializeNewPane(paneId, folderId = 'root') {
        canvas = document.getElementById(paneElId('canvas', paneId));
        world = document.getElementById(paneElId('world', paneId));
        dotLayer = document.getElementById(paneElId('dot-layer', paneId));
        cursorOverlay = document.getElementById(paneElId('cursor-overlay', paneId));
        appState.tx = 0; appState.ty = 0; appState.scale = 1;
        appState.currentFolderId = folderId;
        appState.historyStack = [folderId]; appState.historyIndex = 0;
        appState.tabs = [{ id: 'tab-0', folderId }]; appState.activeTabId = 'tab-0'; appState.nextTabId = 1;
        appState.selectedCardIds = [];
        appState.cardMode = 'normal'; appState.modeOverrideKey = null; appState.modeKeyHoldStart = null;
        appState.dataLinkPendingId = null;
        appState.cameraTweenTimeout = null;
        appState.cursorBroadcastThrottleId = null; appState.itemDragBroadcastThrottleId = null;
        appState.itemResizeBroadcastThrottleId = null; appState.caretBroadcastThrottleId = null;
        setupPaneCanvasListeners(paneId);
        // Sizes this pane's own #dot-layer-{paneId} against the live dotLayer binding (already
        // repointed above) — layoutDotLayer (history-autosave.js, called via this bridge since
        // that file imports FROM this one) otherwise only ever runs once at page load and on
        // window resize, neither of which fires when a pane is split. Without this the new pane's
        // dot grid box has no explicit size at all and never paints anything.
        window.__layoutDotLayer?.();
    }

    // Brings a pane up to a SAVED state loaded from Supabase (loadWorkspace, history-autosave.js —
    // explicit request: "tabs and window splits should persist across refreshes and log out/
    // login"), rather than the fresh-defaults state initializeNewPane resets a brand-new pane to.
    // Does both halves switchActivePane normally splits across two call sites itself: saves the
    // CURRENTLY active pane's own live fields out to its own slot first (so a restore loop calling
    // this once per pane in sequence correctly hands each earlier pane's own already-restored data
    // back to its saved slot before moving on — the exact same "save outgoing, then take over live
    // fields" shape switchActivePane already uses, just inlined here since paneId has no EXISTING
    // saved slot yet for switchActivePane's own restore branch to find), then resolves paneId's own
    // DOM refs directly (paneLayoutStore must already reflect the full restored tree — via
    // window.__setPaneLayout, flushSync'd — before this runs, so PaneCanvasArea.jsx has actually
    // mounted this pane's markup) and applies `savedFields` (whatever subset of tx/ty/scale/
    // currentFolderId/historyStack/historyIndex/tabs/activeTabId/nextTabId the save actually had —
    // each falls back to the same fresh-default initializeNewPane itself uses if missing, so a
    // partially-saved or legacy pane still ends up in a valid state rather than undefined fields).
    // Caller is responsible for the actual render()/renderTabsPanel-equivalent push afterward (via
    // window.__render(), a bridge — same reasoning as initializeNewPane not calling render() itself)
    // and for setting appState.nextPaneId high enough that a future real split can't collide with a
    // restored paneId.
    function restorePaneState(paneId, savedFields = {}) {
        const outgoingId = appState.activePaneId;
        if (outgoingId !== paneId) {
            const outgoing = appState.panes[outgoingId] || (appState.panes[outgoingId] = {});
            PANE_SCOPED_FIELDS.forEach(f => { outgoing[f] = appState[f]; });
            outgoing.canvas = canvas; outgoing.world = world; outgoing.dotLayer = dotLayer; outgoing.cursorOverlay = cursorOverlay;
        }
        canvas = document.getElementById(paneElId('canvas', paneId));
        world = document.getElementById(paneElId('world', paneId));
        dotLayer = document.getElementById(paneElId('dot-layer', paneId));
        cursorOverlay = document.getElementById(paneElId('cursor-overlay', paneId));
        appState.tx = savedFields.tx ?? 0; appState.ty = savedFields.ty ?? 0; appState.scale = savedFields.scale ?? 1;
        appState.currentFolderId = savedFields.currentFolderId || 'root';
        appState.historyStack = savedFields.historyStack || [appState.currentFolderId];
        appState.historyIndex = savedFields.historyIndex || 0;
        appState.tabs = savedFields.tabs || [{ id: 'tab-0', folderId: appState.currentFolderId }];
        appState.activeTabId = savedFields.activeTabId || appState.tabs[0].id;
        appState.nextTabId = savedFields.nextTabId || 1;
        appState.selectedCardIds = [];
        appState.cardMode = 'normal'; appState.modeOverrideKey = null; appState.modeKeyHoldStart = null;
        appState.dataLinkPendingId = null;
        appState.cameraTweenTimeout = null;
        appState.cursorBroadcastThrottleId = null; appState.itemDragBroadcastThrottleId = null;
        appState.itemResizeBroadcastThrottleId = null; appState.caretBroadcastThrottleId = null;
        delete appState.panes[paneId];
        appState.activePaneId = paneId;
        setupPaneCanvasListeners(paneId);
        window.__layoutDotLayer?.();
    }

    // Pane ids (other than excludePaneId, default the live active pane) currently viewing folderId
    // (default the live active pane's own currentFolderId) — an inactive pane's own currentFolderId
    // lives in its saved slot (appState.panes), never a live field, same as switchActivePane's own
    // comment explains; the active pane itself is checked against the live field directly, since it
    // has no saved slot of its own while active. Backs render()'s own "sync siblings on commit"
    // (waypoints-render-loop.js) and mirrorItemToSiblingPanes just below (live, per-pixel/per-
    // keystroke mirroring) — both need exactly this same "who else is looking at this folder"
    // answer, just at different granularities.
    function otherPanesViewingFolder(folderId = appState.currentFolderId, excludePaneId = appState.activePaneId) {
        return window.__listPaneIds().filter((paneId) => {
            if (paneId === excludePaneId) return false;
            const paneFolderId = paneId === appState.activePaneId ? appState.currentFolderId : (appState.panes[paneId] && appState.panes[paneId].currentFolderId);
            return paneFolderId === folderId;
        });
    }

    // Live cross-pane mirroring for anything that mutates a canvas item's DOM directly, DURING a
    // gesture, outside React's own render cycle and outside render()'s own "sync on commit" (see its
    // own comment, waypoints-render-loop.js) — explicit request: "movement is not live, only
    // updating on release... i want it to be fully live. keystroke by keystroke, pixel by pixel
    // movement while dragging." A drag/resize's own pointermove handler (canvasItemBehavior.js) and
    // a contentEditable body's own oninput handler (attachNoteBody/attachWatermarkBody/
    // attachTitleBody, waypoints-render-loop.js) already mutate the ACTIVE pane's own element on
    // every tick/keystroke for local responsiveness — this runs `apply(el, paneId)` against
    // itemId's own wrapper element in every OTHER pane currently viewing the same folder right
    // alongside that, so a sibling pane's copy of the same item updates in the exact same tick
    // rather than waiting for the gesture to end and render() to catch up. Silently no-ops per pane
    // if that pane's own wrapper element doesn't exist (defensive only — every pane viewing a
    // folder should always have one for every one of that folder's items).
    function mirrorItemToSiblingPanes(itemId, apply, folderId = appState.currentFolderId, excludePaneId = appState.activePaneId) {
        otherPanesViewingFolder(folderId, excludePaneId).forEach((paneId) => {
            const el = document.getElementById(itemElId(itemId, paneId));
            if (el) apply(el, paneId);
        });
    }

    // Pane-qualifies one of the 5 canvas-area structural ids (canvas/world/dot-layer/cursor-
    // overlay/items-layer) the same way PaneCanvasArea.jsx's own paneQualifyHtml does when it
    // renders each pane's markup: pane 0 keeps the bare, unqualified id (see canvas/world/dotLayer/
    // cursorOverlay's own comment, above, for why), every other pane gets "-{paneId}" appended.
    // Needed anywhere vanilla code looks up one of these 5 by id directly rather than through the
    // canvas/world/dotLayer/cursorOverlay `let` bindings themselves (e.g. items-layer, which has no
    // binding of its own since only React ever reads it, via CanvasItemsLayer.jsx's portal).
    function paneElId(staticId, paneId = appState.activePaneId) {
        return paneId === 0 ? staticId : `${staticId}-${paneId}`;
    }

    // Reserved space on the left for the permanent hamburger rail (#btn-menu — see --rail-width,
    // globals.css). #canvas's own box already starts to the right of it and #world's containing
    // block is #canvas (both position:absolute, #world is a DOM child) — so #world's coordinate
    // frame is already offset from the raw browser window purely via CSS layout. Every pan/center
    // call site using this must use the REDUCED width, not add the rail back on top of it a second
    // time. Read from the CSS custom property (not hardcoded a second time here) so globals.css
    // stays the single source of truth — safe at module-eval time since dotto-script.js loads via
    // a <Script strategy="afterInteractive"> tag, well after layout.js's blocking globals.css
    // import has applied.
    const RAIL_WIDTH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-width')) || 64;
    // #hamburger-stack open reserves an extra --hmenu-width of space too now (see #canvas's own
    // body:has(#hamburger-stack.open) override, globals.css) — subtracted here the same way
    // RAIL_WIDTH already is, so "center of the visible canvas" stays accurate whether or not a
    // rail panel is currently open, not just when the permanent rail alone is accounted for.
    const HMENU_WIDTH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hmenu-width')) || 300;
    function canvasViewportCenterX() {
        const panelWidth = appState.activeRailView ? HMENU_WIDTH : 0;
        return (window.innerWidth - RAIL_WIDTH - panelWidth) / 2;
    }

    // Canvas item DOM ids are pane-qualified ("item-{paneId}-{itemId}") for split-screen (multiple
    // simultaneously-mounted panes, each with its own copy of any given item's element) — see the
    // split-screen plan. paneId defaults to appState.activePaneId (Stage 4), not a hardcoded 0 —
    // the vast majority of call sites are vanilla code responding to a direct user interaction
    // (a context menu, a resize handle, a tag picker, connection-drag, ...), which by the time it
    // runs is ALWAYS operating on whichever pane is currently active (the capture-phase pointerdown
    // router, PaneGrid.jsx, guarantees that before any such handler ever fires) — so this default is
    // correct for all of them with no per-call-site paneId threading needed, and is exactly the
    // pre-split-screen behavior when there's only one pane (activePaneId is always 0). The one
    // category that genuinely needs an EXPLICIT paneId instead of this default: React card
    // components' own layout effects (NoteCard.jsx, TableCard.jsx, etc.) — a card can re-render for
    // reasons unrelated to its pane being active, so those always pass their own paneId prop
    // through explicitly rather than relying on this default. These three are the ONLY place this
    // id format is spelled out — every lookup/assignment/parse in the app goes through one of them
    // instead of constructing or parsing "item-..." strings inline.
    function itemElId(itemId, paneId = appState.activePaneId) {
        return 'item-' + paneId + '-' + itemId;
    }
    function findItemEl(itemId, paneId = appState.activePaneId) {
        return document.getElementById(itemElId(itemId, paneId));
    }
    function parseItemId(el) {
        const m = el && el.id && el.id.match(/^item-\d+-(\d+)$/);
        return m ? Number(m[1]) : NaN;
    }

export { addMenu, appState, bringCardToFront, btnAdd, canvas, canvasContextMenu, canvasViewportCenterX, contextMenu, cursorOverlay, dotLayer, drawBackBtn, drawColorInput, drawEraserBtn, drawFrontBtn, drawPenBtn, drawSettings, drawSizeInput, effectiveMode, findItemEl, initializeNewPane, itemElId, mirrorItemToSiblingPanes, otherPanesViewingFolder, paneElId, parseItemId, recomputeTopCardZIndex, registerPaneCanvasListenerSetup, restorePaneState, setupPaneCanvasListeners, supabase, switchActivePane, world, zoomControl, zoomFill, zoomThumb, zoomTrack };

// React → vanilla bridge — used by app/dotto/canvasItemBehavior.js (live drag/resize mirroring),
// which can't import this directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__mirrorItemToSiblingPanes = mirrorItemToSiblingPanes;
window.__otherPanesViewingFolder = otherPanesViewingFolder;

// React → vanilla bridge — used by app/dotto/canvasItemBehavior.js's setupResizing (the first
// piece of "canvas core" to move into app/dotto/, see CONTRIBUTING.md/the migration plan's Phase
// 3), which needs to read live camera state (appState.scale, mid-drag) but can't import appState
// directly since public/dotto/*.js isn't reachable from app/dotto/. Returns the SAME live object
// reference every call (appState is mutated in place, never replaced — see this file's own
// comment on why), so callers always see the current value with no separate sync mechanism needed.
window.__getAppState = () => appState;
// Used by app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3's second relocated
// piece), same reasoning as window.__getAppState just above.
window.__bringCardToFront = bringCardToFront;
window.__effectiveMode = effectiveMode;
// Used by every React card component (CanvasCard.jsx, NoteCard.jsx, etc.) to look up its own
// mounted DOM element by item id — see itemElId/findItemEl/parseItemId's own comment above.
window.__findItemEl = findItemEl;
window.__itemElId = itemElId;
window.__parseItemId = parseItemId;
// Used by the PaneGrid capture-phase pointerdown router (split-screen Stage 4+) to make "whichever
// pane is active" track user focus/clicks — see switchActivePane's own comment above. Reachable
// from this stage on, even though nothing calls it with a different paneId yet.
window.__switchActivePane = switchActivePane;
// Split-screen Stage 2: setupDraggingAndClicking/startConnectionDrag (app/dotto/canvasItemBehavior.js)
// used to grab canvas/world via their own fresh document.getElementById("canvas"/"world") calls —
// which happened to work fine with exactly one pane (there was only ever one #canvas/#world to
// find), but silently breaks the moment a second pane's DOM exists (Stage 4+), since a bare
// getElementById would always resolve to whichever pane's markup happens to be first in the
// document, not necessarily the ACTIVE one canvas/world (the `let` bindings above) point to. Same
// live-read reasoning as window.__getAppState — returns the CURRENT value of the `let` binding on
// every call, so callers always see whichever pane is active right now with no separate sync step.
window.__getCanvasEl = () => canvas;
window.__getWorldEl = () => world;
// Used by the debug split-pane trigger (split-screen Stage 4, dotto-app.jsx) to finish bringing a
// brand-new pane up to a real starting state after switchActivePane has made it active — see
// initializeNewPane's own comment above.
window.__initializeNewPane = initializeNewPane;
