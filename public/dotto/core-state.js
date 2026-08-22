    const canvas = document.getElementById('canvas'), world = document.getElementById('world'), dotLayer = document.getElementById('dot-layer'),
        cursorOverlay = document.getElementById('cursor-overlay'),
        btnBack = document.getElementById('btn-back'),
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
        drawMode: false, drawColor: '#ffffff', drawLayer: 'front', drawTool: 'pen', drawSize: 3,
        liveSvg: null, livePath: null, drawing: null,
        hubCollabView: 'main',
        dotbotUpgradePromptedForFullness: false,
        activeConvoId: null,
        msgView: 'main',
        // Tracks the arrow-selected row in #search-command-palette's row list (see
        // command-palette.js's setCommandActive).
        commandActiveIndex: -1,
        dotbotAlignedRegistry: [],
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
    },
        currentAddTab: 'notes',
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
        contextMenuTableCtx: null,
        ZOOM_MIN: 0.2,
        ZOOM_MAX: 2,
        DOT_LAYER_MARGIN: 200,
        cameraTweenTimeout: null,
        applyTransformRafId: null,
        SM2_QUALITY: { noclue: 0, wrong: 1, hard: 3, easy: 5 },
        cardClipboard: [],
        clipboardPasteCount: 0,
        addToolbar: document.getElementById('add-toolbar'),
        sourceAddMenu: document.getElementById('source-add-menu'),
        cellTagPicker: document.getElementById('cell-tag-picker'),
        audioRecordIndicator: document.getElementById('audio-record-indicator'),
        modeToolbar: document.getElementById('mode-toolbar'),
        MODE_ORDER_WEIGHT: { normal: 0, data: 1, select: 2 },
        MODE_HOLD_THRESHOLD_MS: 180,
        modeKeyHoldStart: null,
        // "rail" replaces the old separate menu/messages/cart/profile/add flags — all of them now
        // share one #hamburger-stack shell (see openRailView, panels-hamburger.js), so there's only
        // ever one pinned-or-not state to track, not several independent ones that happened to all
        // mean "is #hamburger-stack pinned open." collab/sourceAdd are unrelated systems (the
        // per-canvas collab flyout, source-add-menu) and keep their own flags.
        panelPinned: { rail: false, collab: false, sourceAdd: false },
        // Which #hamburger-stack view is currently showing — null | 'ai' | 'outline' | 'waypoints'
        // | 'collab' | 'marketplace' | 'messages' | 'profile'. Set by openRailView, cleared by
        // closeRailView (panels-hamburger.js).
        activeRailView: null,
        dottoRail: document.getElementById('dotto-rail'),
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
        msgConvo: document.getElementById('msg-convo'),
        msgList: document.getElementById('msg-list'),
        msgSearchInput: document.getElementById('msg-search'),
        collabBubble: document.getElementById('collab-bubble'),
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
        STATIC_TABLE_VISIBLE_COLS: 3.2,
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
        searchCardPill: document.getElementById('search-card-pill'),
        searchCardPillLabel: document.getElementById('search-card-pill-label'),
        // AI search shares the permanent rail's one shell now (see openRailView, panels-
        // hamburger.js) — no more #search-overlay-backdrop modal, so no lookup for it. aiPanel is
        // the whole rail view (railViewEls member); aiChatView/aiHistoryView are its two internal
        // sub-views, toggled independently of the outer rail's own open/close state (see
        // showAiHistoryView/showAiChatView, ai-assistant-suggestions.js).
        aiPanel: document.getElementById('ai-panel'),
        aiChatView: document.getElementById('ai-chat-view'),
        aiHistoryView: document.getElementById('ai-history-view'),
        // Notifications live in the top bar now, not the search box (see showNotification/
        // dismissCurrentNotification, stopwatch-search-notifications.js) — #top-bar-center slides
        // up and out while #notification-pill slides down into its slot, and back on dismiss.
        topBarCenter: document.getElementById('top-bar-center'),
        notificationPill: document.getElementById('notification-pill'),
        NOTIFICATION_DEFAULT_DURATION_MS: 5000,
        NOTIF_SLIDE_MS: 300,
        // Small pause between one of #top-bar-center/#notification-pill fully finishing its slide
        // away and the other starting to slide in — so they never cross paths mid-transition, one
        // fully leaves before the other arrives (see showNotification/dismissCurrentNotification).
        NOTIF_STAGGER_MS: 150,
        notificationQueue: [],
        currentNotification: null,
        notificationTimer: null,
        notificationStageTimer: null,
        // notifImageEl/notifTextEl/notifActionBtn removed — React owns the notification bar's
        // content now (Phase 2, see app/dotto/NotificationBar.jsx).
        NOTIFICATION_QUEUE_GAP_MS: 5000,
        lastNotificationCloseTime: 0,
        searchCardContext: [],
        searchCardConnections: [],
        NON_LATIN_SCRIPT_RE: new RegExp("[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\s\d]"),
        ALIGN_HL_COLOR_COUNT: 6,
        dotbotAlignHighlightOn: true,
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
    // Every panel-style rail view, in the same order as their icons top-to-bottom in #dotto-rail
    // (see openRailView/closeRailView, panels-hamburger.js) — replaces the old hubSubpanels (just
    // Waypoints/Collaborations/Chats) now that Marketplace/Library/Messages/Add/Profile/AI search
    // share the exact same "one shell, swap which section is .open" mechanism. Library is a
    // separate rail view from Marketplace (own icon, own panel) — they used to be two tabs sharing
    // one #cart-panel; #cart-panel is now Discover browsing only. #chats-panel is deliberately NOT
    // here — Chats is a sub-view reached from inside the AI view (searchBar), not a top-level rail
    // destination of its own.
    appState.railViewEls = [appState.aiPanel, appState.outlineMenu, appState.waypointsPanel, appState.hubCollabPanel, appState.cartPanel, appState.libraryPanel, appState.messagesPanel, addMenu, appState.profilePanel];
    appState.railIconBtns = [appState.railBtnAi, appState.hamburgerBtn, appState.railBtnWaypoints, appState.railBtnCollab, appState.btnCart, appState.libraryBtn, appState.messagesBtn, btnAdd, appState.profileBtn];
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
    function canvasViewportCenterX() { return (window.innerWidth - RAIL_WIDTH) / 2; }

export { addMenu, appState, bringCardToFront, btnAdd, btnBack, btnForward, canvas, canvasContextMenu, canvasViewportCenterX, contextMenu, cursorOverlay, dotLayer, drawBackBtn, drawColorInput, drawEraserBtn, drawFrontBtn, drawPenBtn, drawSettings, drawSizeInput, effectiveMode, recomputeTopCardZIndex, supabase, world, zoomControl, zoomFill, zoomThumb, zoomTrack };
