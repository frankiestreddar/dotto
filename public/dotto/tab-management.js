import { findParentFolderId } from './ai-assistant-suggestions.js';
import { appState, switchActivePane } from './core-state.js';
import { exitSharedCanvasToRoot } from './shared-and-public-canvas-loading.js';
import { applyFolderView, openFolder } from './waypoints-render-loop.js';

// Phase 4.3 split (was part of shared-canvases-outline.js, see PHASE4_ROADMAP.md) — the
// "tab-management" concern: PaneTopBar.jsx's whole per-pane top-bar navigation surface —
// breadcrumb trail, tabs, and back/forward history — all keyed by paneId and all reading/writing
// the LIVE appState.currentFolderId/tabs/historyStack for whichever pane is currently active.

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
    // btnBack.onclick/btnForward.onclick bodies in resize-shortcuts-init.js (Phase 4.3, before
    // that, this was the app's very first cursor-mode/init module — see PHASE2_ROADMAP.md),
    // reading/bounds-checking the single shared appState.historyIndex/historyStack directly since
    // there was only ever one pane's worth of nav state visible at a time. Activating the target
    // pane FIRST (same "clicking a pane's own UI focuses that pane" convention as
    // jumpToHistoryIndex itself) is what lets these reuse that exact same bounds-check against the
    // now-live appState.historyIndex/historyStack, rather than needing a paneId-aware version of
    // the bounds check itself.
    function navBack(paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (appState.historyIndex > 0) jumpToHistoryIndex(appState.historyIndex - 1, paneId);
    }
    function navForward(paneId = appState.activePaneId) {
        if (paneId !== appState.activePaneId) switchActivePane(paneId);
        if (appState.historyIndex < appState.historyStack.length - 1) jumpToHistoryIndex(appState.historyIndex + 1, paneId);
    }

export { addTab, breadcrumbMapRowClick, closeTab, jumpToHistoryIndex, navBack, navForward, openMediaViewerTab, renderBreadcrumbMapPanel, renderNavArrows, renderTabsPanel, reorderTab, switchTab };

window.__breadcrumbMapRowClick = breadcrumbMapRowClick;
// React → vanilla bridge — used by TabsBar.jsx (app/dotto/), same reasoning as
// window.__breadcrumbMapRowClick just above.
window.__addTab = addTab;
window.__switchTab = switchTab;
window.__closeTab = closeTab;
window.__reorderTab = reorderTab;
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
