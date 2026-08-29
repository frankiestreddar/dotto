import { clearSearch, findParentFolderId, stripHtml } from './ai-assistant-suggestions.js';
import { shortUrl } from './cards-misc.js';
import { appState, canvasViewportCenterX, findItemEl, initializeNewPane, supabase, switchActivePane } from './core-state.js';
import { applyTransform, smoothPanTo } from './history-autosave.js';
import { flashCanvasElement } from './mnemonic-search-matching.js';
import { closeRailView, openRailView } from './panels-hamburger.js';
import { focusTableCell } from './source-table.js';
import { pushNotification } from './stopwatch-search-notifications.js';
import { applyFolderView, centerOnContent, expandWaypointCard, openFolder, render } from './waypoints-render-loop.js';


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
 // { currentFolderId, historyStack, historyIndex } from just before entering the top-level shared canvas — restored by exitSharedCanvas
 // ownerId -> display name, populated wherever it's already known (openSharedCanvas's caller) — see announceEnteredCollaboration/renderHubCollabList
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
        if (ownerName) appState.sharedOwnerNameCache[ownerId] = ownerName;
        const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !data) {
            console.error(`[collab] failed to open shared canvas (owner=${ownerId} folder=${folderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (folder not found?)');
            return;
        }
        const localKey = injectSharedFolder(ownerId, folderId, data);
        if (title) appState.folders[localKey].title = data.title || title;
        const isFreshEntry = !appState.preSharedViewState;
        if (isFreshEntry) appState.preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        appState.currentFolderId = localKey;
        appState.historyStack = [localKey];
        appState.historyIndex = 0;
        closeRailView();
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
        const ownerName = appState.sharedOwnerNameCache[folderObj.sharedOwnerId] || 'someone';
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

    // ---------- Publicly-shared canvases (see set_global_item_visibility/global_items,
    // 20260812_add_global_items.sql, and resolve_global_id/get_public_folder,
    // 20260813_add_global_id_resolution.sql) ----------
    // A second, deliberately much narrower sharing mode alongside the collaboration system above:
    // an owner can mark a specific canvas/source public, after which ANYONE can view it read-only
    // by its exact global id — never by name, and never inherited by nested items automatically.
    // Each nested folder/source has its own independent visibility flag; get_public_folder's own
    // gate is per-(owner,folder), so navigating into a nested item here only works if THAT item
    // was separately marked public too — no cascading, unlike canvas_access_status's inheritance
    // for the private-collaboration case above. Same local-namespaced-key reuse trick as the
    // shared: convention, under its own public: prefix — and, critically, NEVER written back
    // anywhere: saveWorkspaceNow's own filter excludes public: keys the same way it already
    // excludes shared: ones (history-autosave.js), and there is no update_public_folder RPC at
    // all. Leaving and coming back forgets it completely — nothing about a public view is ever
    // persisted, locally or remotely, matching "obtain" on a public item being a one-off,
    // no-lasting-record read (see the slash-command plan's own "obtain" semantics).
    function publicFolderKey(ownerId, folderId) { return `public:${ownerId}:${folderId}`; }
    function parsePublicFolderKey(key) {
        const parts = key.split(':');
        return { ownerId: parts[1], remoteFolderId: parts.slice(2).join(':') };
    }
    // No stripPublicFolderIds/fullyUnwrapPublicFolderId counterpart to the shared: versions above
    // — those exist only because a shared folder's edits get written BACK to the owner's canonical
    // (bare-id) storage via update_shared_folder, which needs the unwrap. A public: id never gets
    // written anywhere, so it never needs unwrapping either.
    function namespacePublicFolderIds(ownerId, items) {
        return (items || []).map(it => (it.kind === 'folder' || it.kind === 'source')
            ? { ...it, folderId: publicFolderKey(ownerId, it.folderId) }
            : it);
    }
    function injectPublicFolder(ownerId, remoteFolderId, data) {
        const localKey = publicFolderKey(ownerId, remoteFolderId);
        const items = namespacePublicFolderIds(ownerId, data.items);
        appState.folders[localKey] = { ...data, items, id: localKey, title: data.title || remoteFolderId, collaborators: [], isPublicView: true, publicOwnerId: ownerId, publicRemoteFolderId: remoteFolderId };
        return localKey;
    }
    async function ensurePublicFolderLoaded(localKey) {
        if (appState.folders[localKey]) return true;
        if (!supabase || !appState.currentUser.id) return false;
        const { ownerId, remoteFolderId } = parsePublicFolderKey(localKey);
        const { data, error } = await supabase.rpc('get_public_folder', { p_owner_id: ownerId, p_folder_id: remoteFolderId });
        if (error || !data) {
            console.error(`[public] failed to load public folder (owner=${ownerId} folder=${remoteFolderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (not public, or deleted?)');
            return false;
        }
        injectPublicFolder(ownerId, remoteFolderId, data);
        return true;
    }
    // Entry point for the future "/source|canvas <id>" obtain command on a public item that isn't
    // the caller's own and isn't shared with them (see command-verbs.js, not built yet — this PR
    // is plumbing only, nothing calls this yet). Unlike openSharedCanvas, never announces a
    // collaboration (this isn't one) — reuses preSharedViewState purely as "where to resume when
    // backing out of someone else's read-only content," the same resume slot a shared view uses,
    // since the two cases need identical resume behavior and there's no reason to duplicate it.
    async function openPublicCanvas(ownerId, folderId, title) {
        if (!supabase || !appState.currentUser.id) return;
        const { data, error } = await supabase.rpc('get_public_folder', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !data) {
            console.error(`[public] failed to open public canvas (owner=${ownerId} folder=${folderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (not public, or deleted?)');
            return;
        }
        const localKey = injectPublicFolder(ownerId, folderId, data);
        if (title) appState.folders[localKey].title = data.title || title;
        const isFreshEntry = !appState.preSharedViewState;
        if (isFreshEntry) appState.preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        appState.currentFolderId = localKey;
        appState.historyStack = [localKey];
        appState.historyIndex = 0;
        closeRailView();
        render();
        centerOnContent();
    }

    // Resolves whichever LOCAL key currently represents (ownerId, folderId) for THIS viewer —
    // their own bare folder id, the shared: namespaced key (if they have collaboration access),
    // or the public: namespaced key (if it's public and they don't otherwise have access) — used
    // by ReferenceCard.jsx (the 'place' command's read-only reference card, command-verbs.js) to
    // find/load whatever it should preview. Deliberately re-checked fresh every time, never
    // cached: a reference card needs to reflect an access change (revoked, or flipped back to
    // private after being placed) the next time it loads, not whatever was true when it was first
    // placed — see the feature plan's own trade-offs note on exactly this. Returns null if none
    // of the three currently apply.
    async function resolveReferenceFolderKey(ownerId, folderId) {
        if (ownerId === appState.currentUser.id) return appState.folders[folderId] ? folderId : null;
        const sKey = sharedFolderKey(ownerId, folderId);
        if (await ensureSharedFolderLoaded(sKey)) return sKey;
        const pKey = publicFolderKey(ownerId, folderId);
        if (await ensurePublicFolderLoaded(pKey)) return pKey;
        return null;
    }

    // Leaves the WHOLE shared tree (not just its top level) and lands on the user's own ACTUAL
    // root — not wherever they happened to be right before entering (that distinction used to
    // matter when this was reachable via the breadcrumb "..", but the breadcrumb map's "Root" row
    // (see renderBreadcrumbMapPanel) is specifically meant as an unconditional "take me home"
    // affordance, always available regardless of how deep into someone else's canvas you are).
    function exitSharedCanvasToRoot() {
        if (!appState.preSharedViewState) return;
        // public: entries (openPublicCanvas above) reuse this same preSharedViewState resume slot
        // and need the identical cleanup — they're never persisted anywhere, so simply dropping
        // them from memory here is the whole story, no server-side "leave" call needed.
        for (const id in appState.folders) { if (id.startsWith('shared:') || id.startsWith('public:')) delete appState.folders[id]; }
        appState.preSharedViewState = null;
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
    // Real React state (see app/dotto/TabsBar.jsx's ActiveTabTrail, breadcrumbMapStore) — a
    // compact "…/parent/current" trail for whichever tab is active now, not a full indented ancestor
    // list, so this only ever needs the last couple of links in the chain plus whether there's
    // more above them. Called straight from render() (waypoints-render-loop.js) on every
    // navigation, same as before. Still walks the full structural chain (buildAncestorChain,
    // including the synthetic Root row pinned in when currently inside a shared tree, since the
    // real ancestor chain never reaches it from there) — just condenses it down to {hasMore, root,
    // parent, current} instead of keeping every intermediate row. `root`/`parent`/`current` all
    // carry `isSyntheticRoot` through untouched, since whichever one ends up being the synthetic
    // Root row still needs breadcrumbMapRowClick to route it to exitSharedCanvasToRoot() rather
    // than a plain openFolder('root').
    // paneId defaults to the live active pane, matching every existing call site (render()) — this
    // always computes off the LIVE appState.currentFolderId/folders regardless of which paneId the
    // result gets pushed to, since render() only ever runs for whichever pane is currently active
    // anyway. Pane-keyed since split-screen Stage 7 (each pane gets its own breadcrumb pill now,
    // explicit request) — writes into that pane's own store slot instead of one shared store, so an
    // inactive pane's last-known trail just sits there correctly until it becomes active again and
    // something navigates within it (no need to recompute it on every OTHER pane's own navigation).
    function renderBreadcrumbMapPanel(paneId = appState.activePaneId) {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) { window.__setBreadcrumbMap(paneId, { hasMore: false, root: null, parent: null, current: null }); return; }
        const showSyntheticRoot = folderObj.isSharedView;
        const chain = [];
        if (showSyntheticRoot) {
            chain.push({ label: appState.folders['root'] ? appState.folders['root'].title : 'Root', folderId: 'root', isSyntheticRoot: true });
        }
        buildAncestorChain(appState.currentFolderId).forEach((id) => {
            const target = appState.folders[id];
            if (!target) return;
            chain.push({ label: target.title || id, folderId: id, isSyntheticRoot: false });
        });
        const current = chain[chain.length - 1] || null;
        const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
        const root = chain.length > 2 ? chain[0] : null;
        window.__setBreadcrumbMap(paneId, { hasMore: chain.length > 2, root, parent, current });
    }

    // Wired up from TabsBar.jsx's ActiveTabTrail ellipsis/parent onClick — a non-current segment's
    // click either exits to root (the synthetic row) or navigates there directly. paneId (split-
    // screen Stage 7 — each pane has its own breadcrumb pill now) activates that pane FIRST if it
    // wasn't already, same "clicking a pane's own UI focuses that pane" convention every other
    // per-pane tab operation below now follows — exitSharedCanvasToRoot/openFolder both navigate
    // via the LIVE appState.currentFolderId, so the target pane needs to actually be live first.
    function breadcrumbMapRowClick(folderId, isSyntheticRoot, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (isSyntheticRoot) exitSharedCanvasToRoot();
        else openFolder(folderId);
    }

    // Tabs (top-bar.html, next to the breadcrumb pill — see app/dotto/TabsBar.jsx) — each a
    // lightweight bookmark of a folder location, NOT an independent history/camera context: back/
    // forward (historyStack/historyIndex) and pan/zoom stay global/shared across all tabs, same as
    // before this feature existed. Switching tabs just re-runs applyFolderView(tab.folderId), the
    // same primitive every other navigation entry point (openFolder, jumpToHistoryIndex,
    // breadcrumbMapRowClick above, goToOutlineItem) already uses — a tab's own "location" really
    // just means "which folder to jump back to when you click it," not a fully isolated view.

    // Pushes appState.tabs/activeTabId into React (TabsBar.jsx) — called after every mutation
    // below, and also from render() on every navigation (same call site as
    // renderBreadcrumbMapPanel, waypoints-render-loop.js), so the active tab's own folderId/label
    // stay in sync no matter how the current folder changed (a folder card click, back/forward,
    // breadcrumb, outline row — render() runs after literally all of them). paneId (split-screen
    // Stage 7) defaults to the live active pane, same reasoning as renderBreadcrumbMapPanel's own
    // default just above — this always reads the LIVE appState.tabs/activeTabId, so it's only ever
    // meaningful for whichever pane is currently active; every mutator below that touches an
    // INACTIVE pane's own tabs activates that pane first (switchActivePane), so by the time this
    // runs appState.tabs/activeTabId already correctly describe the pane paneId names.
    function renderTabsPanel(paneId = appState.activePaneId) {
        const activeTab = appState.tabs.find(t => t.id === appState.activeTabId);
        if (activeTab) activeTab.folderId = appState.currentFolderId;
        const snapshot = appState.tabs.map(t => ({
            id: t.id,
            folderId: t.folderId,
            label: (appState.folders[t.folderId] && appState.folders[t.folderId].title) || 'Untitled',
        }));
        window.__setTabs(paneId, { tabs: snapshot, activeTabId: appState.activeTabId });
    }

    // paneId (split-screen Stage 7 — each pane has its own breadcrumb pill/tab row now, explicit
    // request) activates that pane FIRST if it wasn't already active — same "clicking a pane's own
    // UI focuses that pane" convention PaneGrid.jsx's own capture-phase pointerdown router already
    // uses for clicks on a pane's canvas, extended here to its breadcrumb pill too, since every one
    // of these functions below reads/writes the LIVE appState.tabs/activeTabId/currentFolderId,
    // which only ever describe whichever pane is currently active.
    //
    // New tab starts at the SAME location as whichever tab is currently active — per explicit
    // request — so this is a bookmark copy, not a fresh "go to root" tab the way a real browser's
    // new-tab button would be; there's no location picker/history for it to start from anything
    // else. Already showing the right folder (nothing navigated), so no applyFolderView/render()
    // call needed — just refresh the tab bar's own display.
    function addTab(paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        const activeTab = appState.tabs.find(t => t.id === appState.activeTabId);
        const folderId = activeTab ? activeTab.folderId : appState.currentFolderId;
        const id = 'tab-' + appState.nextTabId++;
        appState.tabs.push({ id, folderId });
        appState.activeTabId = id;
        renderTabsPanel(paneId);
    }

    // Switching TO the already-active tab is a no-op (matches clicking the tab you're already on
    // in a real browser). Otherwise re-navigates the canvas to that tab's own bookmarked folder via
    // applyFolderView — which itself calls render(), which calls renderTabsPanel() again, keeping
    // this store in sync without a second explicit call here.
    function switchTab(tabId, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (tabId === appState.activeTabId) return;
        const tab = appState.tabs.find(t => t.id === tabId);
        if (!tab) return;
        appState.activeTabId = tabId;
        applyFolderView(tab.folderId);
    }

    // Always keeps at least one tab — mirrors real browser tab-bar behavior (closing the last tab
    // closes the window instead; there's no app-level equivalent here, so the last tab simply
    // can't be closed). Closing the ACTIVE tab activates its nearest left neighbor (or the new
    // first tab, if it was leftmost) and navigates there, same "which tab becomes active next"
    // convention most browsers use; closing an inactive tab just removes it, no navigation needed.
    function closeTab(tabId, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        const idx = appState.tabs.findIndex(t => t.id === tabId);
        if (idx === -1 || appState.tabs.length <= 1) return;
        const wasActive = tabId === appState.activeTabId;
        appState.tabs.splice(idx, 1);
        if (wasActive) {
            const next = appState.tabs[Math.max(0, idx - 1)];
            appState.activeTabId = next.id;
            applyFolderView(next.folderId);
        } else {
            renderTabsPanel(paneId);
        }
    }

    // Opens a NEW tab showing one file full-screen and scrollable — explicit request/correction:
    // "a new tab in the app" (not a raw browser tab via window.open), "with the file full screen
    // and scrollable." Rides the EXISTING tab/folderId machinery completely unmodified (a tab is
    // just `{id, folderId}` — see addTab's own comment) by wrapping the file in a synthetic folder
    // (isMediaViewer:true), the same "a folder that renders something totally different from the
    // normal item canvas" precedent folderObj.isSource already established — see render()'s own
    // isMediaViewer branch, waypoints-render-loop.js. Reuses the same synthetic folder (rather than
    // creating a duplicate) if this exact item was already opened this session — repeat clicks just
    // open a fresh tab bookmarked to the same existing location, same as any other tab.
    function openMediaViewerTab(item, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        const folderId = 'media-view-' + item.id;
        if (!appState.folders[folderId]) {
            appState.folders[folderId] = { id: folderId, title: item.mediaName || 'File', isMediaViewer: true, mediaItem: item, items: [], collaborators: [] };
        }
        const id = 'tab-' + appState.nextTabId++;
        appState.tabs.push({ id, folderId });
        appState.activeTabId = id;
        applyFolderView(folderId);
    }

    // Drag-to-reorder (TabsBar.jsx's own pointer-drag handling — this is just the array mutation
    // it calls once it's computed where the dragged tab should land, per explicit request). Pure
    // reorder, no navigation/active-tab change of any kind — dragging a tab around never switches
    // which one is active or touches appState.currentFolderId.
    function reorderTab(tabId, toIndex, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        const fromIndex = appState.tabs.findIndex(t => t.id === tabId);
        if (fromIndex === -1 || toIndex === fromIndex) return;
        const clampedIndex = Math.max(0, Math.min(toIndex, appState.tabs.length - 1));
        const [tab] = appState.tabs.splice(fromIndex, 1);
        appState.tabs.splice(clampedIndex, 0, tab);
        renderTabsPanel(paneId);
    }

    // Split-screen Stage 5 — TabsBar.jsx's own drag-tab-to-edge-to-split gesture (2D pointer drag,
    // escapes the breadcrumb pill once far enough, reveals a drop-zone for whichever pane's edge
    // the cursor is near) calls this once a tab is dropped inside an active zone. targetPaneId is
    // whichever EXISTING pane's box the cursor was over (Stage 6 — TabsBar.jsx hit-tests every
    // current pane's own screen rect, not just the two viewport halves Stage 5 shipped with), so
    // this can either bisect the tab's own pane (the common case) or quarter a DIFFERENT
    // already-open pane while dragging a tab out of the active one's bar. edge is one of
    // 'left'|'right'|'top'|'bottom' against THAT pane's own box, not the viewport's.
    // splitLeafInTree/window.__splitPaneInLayout (bridges.js) do the actual tree surgery — this
    // function's own job is just the tab-bookkeeping side, same shape as closeTab's own "always
    // keep at least one tab" guard/next-active-tab logic (a pane can't be left with zero tabs).
    // The new pane deliberately does NOT inherit its target's camera/selection/history —
    // initializeNewPane resets those to fresh defaults, matching the plan's own "puts that tab in
    // that section" framing (not "clones the source view"). The 4-pane cap (window.__countPanes)
    // is enforced here rather than in TabsBar.jsx alone — TabsBar.jsx also skips edge-detection
    // once the cap is hit (so the drop-zone never even shows), but this is the actual authority,
    // in case anything else ever calls this bridge directly. sourcePaneId (split-screen Stage 7 —
    // each pane has its own tab row now, so a drag can start from ANY pane's own bar, not just
    // whichever happened to be active) activates that pane first, same convention as
    // addTab/switchTab/closeTab/reorderTab just above.
    function splitPaneWithTab(tabId, targetPaneId, edge, sourcePaneId = appState.activePaneId) {
        if (sourcePaneId !== appState.activePaneId) switchActivePane(sourcePaneId);
        if (appState.tabs.length < 2) return;
        if (window.__countPanes() >= 4) return;
        const fromIndex = appState.tabs.findIndex(t => t.id === tabId);
        if (fromIndex === -1) return;
        const [tab] = appState.tabs.splice(fromIndex, 1);
        if (appState.activeTabId === tabId) {
            const next = appState.tabs[Math.max(0, fromIndex - 1)];
            appState.activeTabId = next.id;
            applyFolderView(next.folderId);
        } else {
            renderTabsPanel();
        }

        const newPaneId = appState.nextPaneId++;
        window.__splitPaneInLayout(targetPaneId, newPaneId, edge);
        switchActivePane(newPaneId);
        initializeNewPane(newPaneId, tab.folderId);
        render();
    }

    // Closes a pane and re-merges its space into whichever OTHER pane/pair it was split from — the
    // user's own explicit choice for Stage 6's "what happens when a quartered pane closes" product
    // question ("re-merge into its sibling", not "leave a gap"). closeLeafInTree/
    // window.__closePaneInLayout (bridges.js) computes the resulting tree; this function's own job
    // is the appState side: reassigning activePaneId first if the closed pane WAS active (so
    // switchActivePane still has a live pane to swap OUT of before that pane's own saved slot gets
    // dropped), then dropping its now-orphaned appState.panes slot and its items/tabs/breadcrumb
    // stores. Mirrors closeTab's own "always keep at least one" guard — a pane can't close itself
    // into oblivion.
    function closePane(paneId) {
        if (window.__countPanes() <= 1) return;
        if (appState.activePaneId === paneId) {
            const survivor = window.__listPaneIds().find(id => id !== paneId);
            switchActivePane(survivor);
        }
        window.__closePaneInLayout(paneId);
        delete appState.panes[paneId];
        window.__removePaneItemsStore(paneId);
        window.__removePaneTabsStore(paneId);
    }

    // Back/forward enabled-state, one per pane (split-screen Stage 8 — was a pair of
    // btnBack.disabled/btnForward.disabled assignments in waypoints-render-loop.js's render(),
    // acting on the single shared #btn-back/#btn-forward; PaneTopBar.jsx renders its own back/
    // forward buttons per pane now instead). paneId defaults to the live active pane, same
    // reasoning as renderTabsPanel/renderCollabPill's own default — historyIndex/historyStack only
    // ever describe whichever pane is currently active; called every render() frame for that pane,
    // and once more immediately after switchActivePane's own swap so the newly active pane's arrows
    // don't wait a frame to refresh.
    function renderNavArrows(paneId = appState.activePaneId) {
        window.__setNavHistory(paneId, {
            canGoBack: appState.historyIndex > 0,
            canGoForward: appState.historyIndex < appState.historyStack.length - 1,
        });
    }

    // Steps to an EXISTING position in historyStack (back/forward, breadcrumb "..") — no
    // truncation, no push, just moves the pointer. paneId (split-screen Stage 8 — each pane has its
    // own back/forward buttons now) activates that pane FIRST if it wasn't already, same
    // "clicking a pane's own UI focuses that pane" convention every other per-pane navigation entry
    // point in this file already follows.
    function jumpToHistoryIndex(newIndex, paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        appState.historyIndex = newIndex;
        applyFolderView(appState.historyStack[newIndex]);
        renderNavArrows(paneId);
    }

    // PaneTopBar.jsx's own back/forward buttons (split-screen Stage 8) — were plain
    // btnBack.onclick/btnForward.onclick bodies in resize-shortcuts-init.js, reading/bounds-checking
    // the single shared appState.historyIndex/historyStack directly since there was only ever one
    // pane's worth of nav state visible at a time. Activating the target pane FIRST (same "clicking
    // a pane's own UI focuses that pane" convention as jumpToHistoryIndex itself) is what lets these
    // reuse that exact same bounds-check against the now-live appState.historyIndex/historyStack,
    // rather than needing a paneId-aware version of the bounds check itself.
    function navBack(paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (appState.historyIndex > 0) jumpToHistoryIndex(appState.historyIndex - 1, paneId);
    }
    function navForward(paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (appState.historyIndex < appState.historyStack.length - 1) jumpToHistoryIndex(appState.historyIndex + 1, paneId);
    }

    // ---------- Canvas Outline Hierarchical Builder inside Hamburger Menu ----------
    function nearestOf(list, ref) {
        let best = null, bd = Infinity;
        list.forEach(c => { const d = Math.hypot(c.x - ref.x, c.y - ref.y); if (d < bd) { bd = d; best = c; } });
        return best;
    }
    // Maps a card kind (+ heading level, for 'title') to its /assets/icons/*.png filename — used
    // by the canvas outline tree (outlineIcon, below) and every other place that displays this
    // same kind taxonomy as a small icon (Waypoints/Collaborations/Source/Waypoint cards).
    function kindIconFile(kind, level) {
        if (kind === 'title') return `heading-${level || 1}.png`;
        const files = {
            folder: 'canvas.png', source: 'source.png', table: 'table.png', media: 'media.png',
            checklist: 'checklist.png', watermark: 'watermark.png',
            flashcard: 'flashcards.png', typeright: 'typeright.png', note: 'note.png', statcard: 'statcard.png',
            stopwatch: 'stopwatch.png', shelf: 'shelf.png', waypoint: 'waypoint.png',
            filter: 'tag-button.png', // no dedicated icon asset yet — closest existing one, since filtering is tag-based
            embed: 'embed.png', // no icon asset exists yet either — add public/assets/icons/embed.png; missing files already degrade gracefully throughout this app
            reference: 'canvas.png', // no dedicated asset either — closest existing one, same reasoning as filter/embed above
        };
        return files[kind] || 'note.png';
    }
    // Returns a ready-to-insert <span> using kindIconFile as a mask (see .icon-mask) — pass
    // whatever extra class sizes/positions it at the call site (e.g. "outline-icon").
    function kindIconHTML(kind, level, extraClass) {
        const url = `/assets/icons/${kindIconFile(kind, level)}`;
        return `<span class="${extraClass} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
    }
    // Hover-revealed action-button overlay shared by every sidebar list row — see .outline-item-
    // actions' own comment, globals.css, and RowActions.jsx (the React equivalent every OTHER
    // panel's rows use — this file's own rows are still plain HTML strings, so it needs its own
    // literal copy of the same markup rather than importing that component). "For now" just a Share
    // button (share.png) per explicit request; keep both in sync if this ever changes.
    function rowActionsHTML() {
        return '<div class="outline-item-actions"><button type="button" class="outline-item-share-btn" onclick="event.stopPropagation()" title="Share"><img src="/assets/icons/share.png" alt=""></button></div>';
    }
    function outlineLabel(item) {
        if (item.kind === 'folder' || item.kind === 'source') return (appState.folders[item.folderId] ? appState.folders[item.folderId].title : 'Canvas');
        if (item.kind === 'table') return 'Table';
        if (item.kind === 'media') return 'Media';
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
    
    // Current level (currentFolderId's own contents) plus 2 deeper levels of nested folders —
    // the rolling window is always anchored to the LIVE canvas position, not a separate
    // menu-only drill state. The only way the window ever shifts is by actually navigating the
    // real canvas (via a leaf-item click here, a source-item click here, or anything else that
    // changes currentFolderId) — there is no in-menu-only "focus" concept and no breadcrumb.

   // 30 grid squares — beyond this, a card isn't near enough to any heading to join it directly
  // 10 grid squares — but it still joins whatever heading a nearby (already-grouped) card belongs to

    // Computes `folder`'s own items — leaf cards, plus child folders/sources — at the given depth,
    // as a flat array of row descriptors pushed onto `rows` (React owns the actual DOM now — see
    // OutlinePanel.jsx, app/dotto/ — this function only computes what to show, same "compute then
    // push" shape renderSourcesList/renderFilesList already use, hamburger-collab.js). Every row
    // (whether it's a canvas, a source, or a plain card) is rendered with the exact same
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
    // `rows` is a shared accumulator, appended to in display order (including by the recursive
    // call for a nested folder) — the caller (buildOutline/handleOutlineSearch) checks
    // rows.length for the "nothing here yet" empty state, exactly equivalent to the old boolean
    // return value since every one of titles/others/childFolders/childSources becomes exactly one
    // pushed row.
    //
    // Which headings are currently collapsed (explicit request) — a plain module-level Set, same
    // "purely ephemeral, nothing else needs to read/write it" reasoning as add-block chord state
    // (srs-connections-core.js): not persisted, not appState, resets on reload. Keyed by heading
    // item id.
    const collapsedOutlineHeadingIds = new Set();
    function toggleOutlineCollapse(id) {
        if (collapsedOutlineHeadingIds.has(id)) collapsedOutlineHeadingIds.delete(id);
        else collapsedOutlineHeadingIds.add(id);
        buildOutline(true);
    }
    function computeOutlineRows(folder, depth, visited, rows, ignoreCollapse) {
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
        const viewCenter = view ? { x: (canvasViewportCenterX() - view.tx) / view.scale, y: (window.innerHeight / 2 - view.ty) / view.scale } : null;
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
            if (dist <= appState.OUTLINE_GROUP_MAX_DIST) headingGroups.get(nearest.id).push(item);
            else unassigned.push(item);
        });
        let changed = true;
        while (changed && unassigned.length) {
            changed = false;
            for (let i = unassigned.length - 1; i >= 0; i--) {
                const item = unassigned[i];
                let rescueHeadingId = null;
                for (const [hid, groupItems] of headingGroups) {
                    if (groupItems.some(g => Math.hypot(g.x - item.x, g.y - item.y) <= appState.OUTLINE_RESCUE_MAX_DIST)) { rescueHeadingId = hid; break; }
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

        // rowKind distinguishes a source row (click enters it directly via goToOutlineSource,
        // OutlinePanel.jsx) from every other item kind (click lands on the card within its own
        // parent via goToOutlineItem — never drilling into a canvas via the menu itself), matching
        // the old inline onclick's own if/else exactly. targetFolderId only means something for a
        // rowKind:'source' row (the source's own folder id, to open); parentFolderId (`folder.id`,
        // the containing folder this row belongs to) is what goToOutlineItem needs for every other
        // kind.
        function makeRow(item, subIndent, extra) {
            rows.push({
                id: item.id,
                rowKind: item.kind === 'source' ? 'source' : 'item',
                itemKind: item.kind,
                level: item.level,
                indent: (depth + subIndent) * 14,
                label: outlineLabel(item),
                parentFolderId: folder.id,
                targetFolderId: item.folderId,
                ...extra,
            });
        }

        // A non-heading card's own row, plus (for folders) recursing into its nested contents —
        // shared by both grouped-under-a-heading and fully-ungrouped rendering below.
        function makeCardRow(item, subIndent) {
            makeRow(item, subIndent);
            if (item.kind === 'folder' && depth < appState.OUTLINE_MAX_DEPTH && item.folderId && appState.folders[item.folderId] && !visited.has(item.folderId)) {
                visited.add(item.folderId);
                computeOutlineRows(appState.folders[item.folderId], depth + 1, visited, rows, ignoreCollapse);
            }
        }

        // A heading's own nested h2s and directly-attached h3s (h3s whose nearest heading is
        // this h1 itself, when it has no h2 children at all — see h3Parent above) are two
        // separate sources, merged and re-sorted together here so they interleave by proximity
        // rather than always listing every h2 subtree before any direct h3.
        //
        // Collapse (explicit request) — only offered when the heading actually has something
        // nested under it (a group item OR a child heading); collapsing hides both. ignoreCollapse
        // (set by handleOutlineSearch while a query is active) makes every heading render fully
        // expanded regardless of its own collapsed state, same "search overrides collapse"
        // behavior the Blocks panel's own folders get (toggleBlocksFolderCollapse's own comment,
        // blocks-panel.js) — otherwise a real match hidden under a collapsed heading could never
        // surface while searching.
        function renderHeadingSubtree(heading, subIndent) {
            const groupItems = headingGroups.get(heading.id) || [];
            const level = heading.level || 1;
            let childHeadings = [];
            if (level === 1) {
                childHeadings = [
                    ...h2s.filter(h2 => h2Parent.get(h2.id) === heading.id),
                    ...h3s.filter(h3 => { const p = h3Parent.get(h3.id); return p && p.level === 1 && p.id === heading.id; }),
                ];
            } else if (level === 2) {
                childHeadings = h3s.filter(h3 => { const p = h3Parent.get(h3.id); return p && p.level === 2 && p.id === heading.id; });
            }
            const hasChildren = groupItems.length > 0 || childHeadings.length > 0;
            const collapsed = hasChildren && !ignoreCollapse && collapsedOutlineHeadingIds.has(heading.id);
            makeRow(heading, subIndent, { hasChildren, collapsed });
            if (collapsed) return;
            groupItems.forEach(item => makeCardRow(item, subIndent + 1));
            sortByProximity(childHeadings).forEach(child => renderHeadingSubtree(child, subIndent + 1));
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

    // A source folder's own outline — per explicit request, distinct from the tree above (which
    // would otherwise just show this folder's single real item, the table itself, as one useless
    // "Table" row via outlineLabel's own kind==='table' branch). Instead, every DATA row of the
    // table becomes its own outline row, numbered 1/2/3/... (matching `ri`, the same 1-based data-
    // row index tableData/focusTableCell/data-r attributes already use everywhere else — tableData[0]
    // is the header, so data rows start at index 1) with that row's first-column value as its label,
    // stripped of any rich-text markup the same way every other free-text outline label already is
    // (e.g. .note's own outlineLabel branch above). Clicking a row focuses that row's first cell
    // directly in the live table (focusTableCell, source-table.js — the same primitive arrow-key
    // navigation and Enter-to-edit already use) rather than panning/flashing a canvas element the
    // way goToOutlineItem does — there's no canvas to pan on a source page, it's a fixed full-
    // viewport table, and focusing the cell already scrolls it into view within .table-rounded's own
    // scroll container for free.
    function computeSourceOutlineRows(folder) {
        const tableItem = folder.items.find(i => i.kind === 'table');
        if (!tableItem) return [];
        const dataRows = tableItem.tableData.slice(1);
        return dataRows.map((row, dataIdx) => {
            const ri = dataIdx + 1;
            return { id: `${tableItem.id}-row-${ri}`, rowKind: 'sourceRow', number: ri, label: stripHtml(row[0]) || 'Untitled', tableItemId: tableItem.id };
        });
    }
    // Row click targets, extracted from the old inline onclick bodies (this file's own
    // computeOutlineRows/computeSourceOutlineRows, formerly renderOutlineFolderContents/
    // renderSourceOutline, built plain DOM with the click logic inline) — OutlinePanel.jsx
    // (app/dotto/, can't import this module directly — public/dotto/*.js isn't reachable from
    // app/dotto/) calls these by row kind instead, same reasoning as window.__goToOutlineItem.
    function goToOutlineSource(folderId) {
        if (appState.currentFolderId !== folderId) openFolder(folderId);
        closeRailView();
    }
    function goToOutlineSourceRow(tableItemId, rowNumber) {
        focusTableCell(tableItemId, rowNumber, 0);
        closeRailView();
    }

    // Computes the full, unfiltered row set for whichever folder is current — shared by
    // buildOutline and handleOutlineSearch (both need "everything buildOutline itself would show,
    // fresh" as their starting point) rather than duplicating the isSource branch in both places.
    function computeCurrentOutlineRows(ignoreCollapse) {
        const rootFolder = appState.folders[appState.currentFolderId];
        if (!rootFolder) return [];
        if (rootFolder.isSource) return computeSourceOutlineRows(rootFolder);
        const rows = [];
        computeOutlineRows(rootFolder, 0, new Set([rootFolder.id]), rows, ignoreCollapse);
        return rows;
    }
    // preserveState (per explicit request) is what lets render() call this unconditionally on
    // every navigation/rename/etc — see its own call site's comment, waypoints-render-loop.js —
    // without also constantly resetting an already-open panel's scroll position or blowing away
    // whatever the user is actively searching for. false/omitted (every existing caller before this
    // — toggleHamburgerMenu's own panel-open callback, the outline search input's own Enter-to-
    // refocus flow if any) keeps the original always-start-fresh behavior, which is exactly what a
    // just-opened panel should do.
    // Pushes into outlineStore (window.__setOutlineState, app/dotto-app.jsx — MUST be flushSync:
    // this function's own scrollTop restore below, and toggleHamburgerMenu's setOutlineActive(0)
    // call right after this returns, both need OutlinePanel.jsx's real DOM already committed) —
    // React owns the row markup now (see OutlinePanel.jsx), this function only computes what to
    // show and hands it off, same shape renderSourcesList/renderFilesList already use.
    function buildOutline(preserveState) {
        const container = document.getElementById('hmenu-outline-container');
        if (!container) return;
        const savedScrollTop = preserveState ? container.scrollTop : 0;
        const savedQuery = (preserveState && appState.outlineSearchInput) ? appState.outlineSearchInput.value : '';
        // Fresh open only — clear any search term left over from a previous visit so the input
        // doesn't lie about what's actually showing. A preserveState rebuild instead re-applies
        // savedQuery (below, after the tree exists again) so an in-progress search survives.
        if (!preserveState && appState.outlineSearchInput) appState.outlineSearchInput.value = '';

        window.__setOutlineState({ rows: computeCurrentOutlineRows(), query: '' });

        if (preserveState) {
            if (savedQuery) handleOutlineSearch(savedQuery);
            container.scrollTop = savedScrollTop;
        }
    }
    // Recomputes the full row set fresh (computeCurrentOutlineRows above), then filters it down to
    // whatever matches `query` — simpler than the old plain post-render DOM-visibility filter now
    // that rows are plain data rather than already-rendered elements: a fresh compute is cheap
    // (this is all already-in-memory data, no re-derivation of the grouping/proximity-sort logic
    // itself needed, the same "compute then push" shape renderSourcesList/renderFilesList already
    // use for their own search). A plain substring match against each row's own label, independent
    // per row, is the same simple approach renderWaypointsList's own search (hamburger-collab.js)
    // already uses. "All your blocks" here means everything buildOutline itself already reaches —
    // the current canvas and its nested folders/sources, up to OUTLINE_MAX_DEPTH — not a
    // cross-canvas search.
    // Note: unlike the old DOM-visibility-toggle version, this resets which row is arrow-key-active
    // on every keystroke (OutlinePanel.jsx's syncOutlineRows effect re-runs whenever the row list
    // changes) rather than only when the visible set actually changes — a minor, accepted behavior
    // change (see the migration plan's own "decide + confirm" note).
    function handleOutlineSearch(query) {
        const q = (query || '').trim().toLowerCase();
        // ignoreCollapse while actively searching (q truthy) — otherwise a real match nested under
        // a collapsed heading could never surface, since computeOutlineRows would never even
        // generate its row to filter against. See renderHeadingSubtree's own comment.
        const rows = computeCurrentOutlineRows(!!q);
        const filtered = q ? rows.filter(r => r.label.toLowerCase().includes(q)) : rows;
        window.__setOutlineState({ rows: filtered, query: q });
    }

    // Navigates the live canvas to a card's containing folder and centers on it. Used for every
    // non-source row (leaf cards AND canvas cards alike) — openFolder now goes through
    // applyFolderView, so this also benefits from per-folder position memory (see
    // navigateToFolder/applyFolderView).
    function goToOutlineItem(folderId, itemId) {
        if (appState.currentFolderId !== folderId) openFolder(folderId);
        const it = appState.folders[folderId].items.find(i => i.id === itemId);
        if (it) {
            const el = findItemEl(it.id);
            const w = el ? el.offsetWidth : (it.w || 100);
            const h = el ? el.offsetHeight : (it.h || 50);
            smoothPanTo(canvasViewportCenterX() - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
            if (el && it.kind === 'waypoint') expandWaypointCard(el, it, { editable: false });
            flashCanvasElement(el);
        }
        closeRailView();
    }
    function setOutlineActive(idx) {
        if (!appState.outlineRows.length) return;
        idx = ((idx % appState.outlineRows.length) + appState.outlineRows.length) % appState.outlineRows.length;
        appState.outlineRows.forEach(r => r.el.classList.remove('active'));
        appState.outlineActiveIndex = idx;
        const row = appState.outlineRows[idx];
        row.el.classList.add('active');
        row.el.scrollIntoView({ block: 'nearest' });
    }
    // Feeds real DOM nodes from the React-rendered tree (OutlinePanel.jsx's own useLayoutEffect on
    // its row list, app/dotto/) back into appState.outlineRows, in the same order they're
    // displayed — srs-connections-core.js's own ArrowUp/ArrowDown/Enter keyboard-nav block
    // (untouched, needs zero edits) doesn't care who owns the nodes, only that r.el is a real
    // element it can classList.add('active')/scrollIntoView/click() — exactly what it already got
    // from makeRow's own appState.outlineRows.push({ el: row }) before this tree became React.
    function syncOutlineRows(elements) {
        appState.outlineRows = Array.from(elements).map(el => ({ el }));
        appState.outlineActiveIndex = -1;
    }
    // "M" keyboard shortcut (srs-connections-core.js) — routes through the same shared rail
    // mechanism the outline's own icon uses (openRailView/closeRailView, panels-hamburger.js)
    // rather than toggling classes directly, so it correctly closes whichever OTHER rail view
    // might currently be open instead of just layering the outline on top of it.
    function toggleHamburgerMenu() {
        if (appState.activeRailView === 'outline') { closeRailView(); }
        else { openRailView('outline', appState.outlineMenu, appState.hamburgerBtn, () => { buildOutline(); setOutlineActive(0); }, true); }
    }

export { addTab, announceEnteredCollaboration, breadcrumbMapRowClick, buildOutline, closePane, closeTab, ensurePublicFolderLoaded, ensureSharedFolderLoaded, goToOutlineItem, goToOutlineSource, goToOutlineSourceRow, handleOutlineSearch, jumpToHistoryIndex, kindIconFile, kindIconHTML, namespacePublicFolderIds, namespaceSharedFolderIds, navBack, navForward, openMediaViewerTab, openPublicCanvas, openSharedCanvas, parsePublicFolderKey, parseSharedFolderKey, publicFolderKey, renderBreadcrumbMapPanel, renderNavArrows, renderTabsPanel, reorderTab, resolveReferenceFolderKey, rowActionsHTML, setOutlineActive, sharedFolderKey, splitPaneWithTab, stripSharedFolderIds, switchTab, syncOutlineRows, toggleHamburgerMenu, toggleOutlineCollapse };

window.__kindIconFile = kindIconFile;
window.__openSharedCanvas = openSharedCanvas;
// React → vanilla bridges — used by OutlinePanel.jsx (app/dotto/), which can't import this module
// directly since public/dotto/*.js isn't reachable from app/dotto/. Same reasoning as
// window.__goToOutlineItem below.
window.__goToOutlineSource = goToOutlineSource;
window.__goToOutlineSourceRow = goToOutlineSourceRow;
window.__syncOutlineRows = syncOutlineRows;

// React → vanilla bridge — used by TabsBar.jsx's ActiveTabTrail (app/dotto/), which can't import
// this directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__breadcrumbMapRowClick = breadcrumbMapRowClick;
window.__resolveReferenceFolderKey = resolveReferenceFolderKey;
// React → vanilla bridge — used by TabsBar.jsx (app/dotto/), same reasoning as
// window.__breadcrumbMapRowClick just above.
window.__addTab = addTab;
window.__switchTab = switchTab;
window.__closeTab = closeTab;
window.__reorderTab = reorderTab;
window.__splitPaneWithTab = splitPaneWithTab;
window.__closePane = closePane;
// Called from switchActivePane (core-state.js) via this bridge, not a direct import — see that
// function's own comment for why (core-state.js is imported BY this file, so the reverse would be
// circular).
window.__renderTabsPanel = renderTabsPanel;
// PaneTopBar.jsx's own back/forward buttons (split-screen Stage 8) — same reasoning as
// window.__addTab etc above.
window.__jumpToHistoryIndex = jumpToHistoryIndex;
window.__navBack = navBack;
window.__navForward = navForward;
// React → vanilla bridge — used by FilesListPanel.jsx's onOpen action.
window.__openMediaViewerTab = openMediaViewerTab;
// Called from switchActivePane (core-state.js), same reasoning as window.__renderTabsPanel above.
window.__renderNavArrows = renderNavArrows;
// React → vanilla bridge — used by FilesListPanel.jsx (app/dotto/) to navigate to (and flash) a
// file's own canvas card on click, same primitive the Outline tree's own non-source rows already
// use for every other card kind.
window.__goToOutlineItem = goToOutlineItem;
window.__toggleOutlineCollapse = toggleOutlineCollapse;
