import { appState, canvas, supabase } from './core-state.js';
import { saveSnapshot } from './history-autosave.js';
import { openItemDetail } from './library-publish.js';
import { findItemById, importSharedCardsAtScreenPoint, sanitizeFlashcardSnapshot, snapshotItem } from './live-presence.js';
import { closeRailView, openRailView, wireRailIcon } from './panels-hamburger.js';
import { render, renderSelectedOutlines } from './waypoints-render-loop.js';


    // ---------- Template Marketplace (Discover) — browsing other creators' published templates.
    // Library (your own drafts/published/purchased items) is a separate rail panel, below. ----------
    // Restores the browse view, clearing any transient detail drill-down. Nothing is ever lost by
    // calling this — a listing you're browsing is read-only until purchased/published elsewhere.
    function resetMarketplacePanelView() {
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('view-discover').classList.add('active');
    }
    // Marketplace shares the permanent rail's one shell/pinned-state now (see openRailView/
    // wireRailIcon, panels-hamburger.js) — no more of its own positionCartPanel (the shell is
    // already positioned beside the rail) or its own click/hover/pin wiring (wireRailIcon covers
    // that generically). This onOpen callback fires every time the Marketplace icon is clicked.
    async function refreshCartPanel() {
        appState.selectedMarketItem = null;
        resetMarketplacePanelView();
        await refreshMarketplaceListings();
        renderMarketplaceDiscover();
    }
    wireRailIcon('marketplace', appState.btnCart, appState.cartPanel, refreshCartPanel);

    // ---------- Library — your own drafts/published/purchased items. Used to be a tab sharing
    // #cart-panel with Discover; now a fully separate rail icon/panel. ----------
    // Restores the folder-picker view, clearing any transient item-detail/publish-flow drill-down.
    function resetLibraryPanelView() {
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.remove('active');
        document.getElementById('view-library').classList.add('active');
    }
    async function refreshLibraryPanel() {
        resetLibraryPanelView();
        appState.activeLibraryFolder = null;
        await refreshMyLibrary();
        renderLibrary();
    }
    wireRailIcon('library', appState.libraryBtn, appState.libraryPanel, refreshLibraryPanel);
    // Opens the Library panel straight to a specific folder — used after a purchase (jump to
    // Purchased) or after packaging a draft via drag-and-drop (jump to Drafts) — rather than
    // landing on the folder picker and making the user click into it themselves. Passes null as
    // openRailView's own onOpen (skips refreshLibraryPanel's reset-to-folder-picker) since this
    // does the equivalent sequence itself, ending on the requested folder instead.
    async function openLibraryToFolder(folder) {
        openRailView('library', appState.libraryPanel, appState.libraryBtn, null, true);
        resetLibraryPanelView();
        await refreshMyLibrary();
        switchLibraryFolder(folder);
    }

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
        appState.trendingMarketplace = (data || []).map(row => ({
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
        appState.userLibrary.drafts = (mine || []).filter(r => r.status === 'draft').map(marketplaceItemFromRow);
        appState.userLibrary.published = (mine || []).filter(r => r.status === 'published').map(marketplaceItemFromRow);

        const { data: acquired, error: acqErr } = await supabase
            .from('library_items')
            .select('acquired_at, listing:marketplace_listings(id, title, description, tagline, price_label, content)')
            .eq('user_id', appState.currentUser.id)
            .order('acquired_at', { ascending: false });
        if (acqErr) console.error('[marketplace] failed to load purchased items:', acqErr);
        // acquired_at drives the Library panel's "Purchased" folder, sorted most-recent-first —
        // carried through as acquiredAt alongside the usual marketplaceItemFromRow shape.
        appState.userLibrary.purchased = (acquired || []).filter(r => r.listing).map(r => ({ ...marketplaceItemFromRow(r.listing), acquiredAt: r.acquired_at }));
    }

    function switchLibraryFolder(folder) {
        appState.activeLibraryFolder = folder;
        const backRow = document.getElementById('library-back-row');
        backRow.classList.toggle('show', !!folder);
        document.getElementById('library-back-label').textContent = folder ? ('Back to folders') : '';
        renderLibrary();
    }

    function handleMarketplaceSearch(val) {
        appState.marketplaceSearchQuery = val.trim().toLowerCase();
        renderMarketplaceDiscover();
    }

    // Real React state now (see app/dotto/MarketDiscoverPanel.jsx, marketDiscoverStore) —
    // genuine JSX rows, same reasoning as WaypointsListPanel (simple title/price/desc/meta, no
    // per-row widget state). openMarketDetail/the rest of the marketplace/
    // library cluster stay vanilla for now — this is one self-contained slice of a much bigger
    // file, converted incrementally rather than all at once.
    function renderMarketplaceDiscover() {
        const filtered = appState.trendingMarketplace.filter(item => {
            return item.title.toLowerCase().includes(appState.marketplaceSearchQuery) ||
                   item.description.toLowerCase().includes(appState.marketplaceSearchQuery) ||
                   (item.tagline || '').toLowerCase().includes(appState.marketplaceSearchQuery);
        });
        window.__setMarketDiscover(filtered);
    }

    // #market-detail-content's content is real React state now (see app/dotto/MarketDetailPanel.jsx,
    // marketDetailStore) — text fields as real JSX, the canvas preview mounted via a ref (same
    // "vanilla builds live DOM, React just mounts it" pattern as buildFolderInlineCanvas — the
    // preview needs a real live DOM tree of its own, pdf.js-style, not an HTML string). Which VIEW
    // is showing (#view-discover vs #market-detail-view) stays a vanilla classList toggle — that's
    // shared machinery with resetMarketplacePanelView/openItemDetail/startPublishFlow elsewhere in
    // this cluster, not something to partially hand to React without converting all of them together.
    function openMarketDetail(item) {
        appState.selectedMarketItem = item;
        document.getElementById('view-discover').classList.remove('active');
        document.getElementById('market-detail-view').classList.add('active');
        window.__setMarketDetail(item);
    }

    function closeMarketDetail() {
        appState.selectedMarketItem = null;
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('view-discover').classList.add('active');
        window.__setMarketDetail(null);
    }

    async function purchaseCurrentMarketItem() {
        if (!appState.selectedMarketItem) return;

        const alreadyOwns = appState.userLibrary.purchased.some(x => x.id === appState.selectedMarketItem.id);
        if (alreadyOwns) {
            alert("This template snapshot is already inside your Library!");
            closeMarketDetail();
            openLibraryToFolder('purchased');
            return;
        }

        const { error } = await supabase
            .from('library_items')
            .insert({ user_id: appState.currentUser.id, listing_id: appState.selectedMarketItem.id });
        if (error) { console.error('[marketplace] purchase failed:', error); alert('Something went wrong adding this to your library.'); return; }

        alert(`Successfully purchased "${appState.selectedMarketItem.title}" as a customizable template snapshot!`);
        closeMarketDetail();
        openLibraryToFolder('purchased');
    }

    // Real React state now (see app/dotto/LibraryPanel.jsx, libraryViewStore) — genuine JSX rows
    // for all three sub-views (folder picker / item list within a folder / cross-folder search
    // results), same reasoning as the other list panels in this cluster. Drag-out-to-canvas for
    // draft items (makeDraftItemDraggable) and opening the item detail view (openItemDetail,
    // library-publish.js) stay vanilla, invoked from row handlers via window.__* bridges.
    function renderLibrary() {
        if (appState.librarySearchQuery) {
            window.__setLibraryView({ view: 'search', results: computeLibrarySearchResults() });
            return;
        }

        if (!appState.activeLibraryFolder) {
            const fixed = ['purchased', 'drafts', 'published'].map(key => ({
                key, label: appState.libraryFolderLabels[key], count: appState.userLibrary[key].length
            }));
            const custom = appState.userLibrary.customFolders.map(folder => ({
                id: folder.id, name: folder.name, count: folder.items.length
            }));
            window.__setLibraryView({ view: 'folders', fixed, custom });
            return;
        }

        const isCustom = isCustomFolderId(appState.activeLibraryFolder);
        const customFolder = isCustom ? appState.userLibrary.customFolders.find(f => f.id === appState.activeLibraryFolder) : null;
        const list = isCustom ? (customFolder ? customFolder.items : []) : appState.userLibrary[appState.activeLibraryFolder];

        window.__setLibraryView({
            view: 'items',
            folderKey: appState.activeLibraryFolder,
            isCustom,
            customFolders: appState.userLibrary.customFolders.map(f => ({ id: f.id, name: f.name })),
            items: (list || []).map(item => ({ item, status: isCustom ? resolveItemStatus(item) : appState.activeLibraryFolder }))
        });
    }

    // A library item may live in exactly one of these three real folders; custom folders
    // just hold references to items that already belong to one of them.
    function resolveItemStatus(item) {
        if (appState.userLibrary.drafts.some(x => x.id === item.id)) return 'drafts';
        if (appState.userLibrary.published.some(x => x.id === item.id)) return 'published';
        return 'purchased';
    }

    function isCustomFolderId(id) {
        return typeof id === 'string' && id.indexOf('customfolder_') === 0;
    }

    function createCustomFolder() {
        const name = prompt('Name your new library folder:', 'New Folder');
        if (name === null) return;
        const trimmed = name.trim();
        appState.userLibrary.customFolders.push({ id: 'customfolder_' + appState.idCounter++, name: trimmed || 'New Folder', items: [] });
        renderLibrary();
    }

    function addItemToCustomFolderById(folderId, sourceKey, itemId) {
        const folder = appState.userLibrary.customFolders.find(f => f.id === folderId);
        const source = appState.userLibrary[sourceKey];
        if (!folder || !source) return;
        const item = source.find(x => String(x.id) === String(itemId));
        if (!item) return;
        if (folder.items.some(x => String(x.id) === String(itemId))) { renderLibrary(); return; }
        folder.items.push(item);
        renderLibrary();
    }

    function removeFromCustomFolder(folderId, itemId) {
        const folder = appState.userLibrary.customFolders.find(f => f.id === folderId);
        if (!folder) return;
        folder.items = folder.items.filter(x => String(x.id) !== String(itemId));
        renderLibrary();
    }

    function handleLibrarySearch(val) {
        appState.librarySearchQuery = val.trim().toLowerCase();
        renderLibrary();
    }

    function computeLibrarySearchResults() {
        const q = appState.librarySearchQuery;
        const groups = [
            { key: 'purchased', label: appState.libraryFolderLabels.purchased, items: appState.userLibrary.purchased },
            { key: 'drafts', label: appState.libraryFolderLabels.drafts, items: appState.userLibrary.drafts },
            { key: 'published', label: appState.libraryFolderLabels.published, items: appState.userLibrary.published },
            ...appState.userLibrary.customFolders.map(f => ({ key: f.id, label: f.name, items: f.items }))
        ];

        const results = [];
        groups.forEach(g => {
            const folderMatches = g.label.toLowerCase().includes(q);
            g.items.forEach(item => {
                if (folderMatches || (item.title || '').toLowerCase().includes(q)) {
                    const status = ['purchased', 'drafts', 'published'].includes(g.key) ? g.key : resolveItemStatus(item);
                    results.push({ folderKey: g.key, folderLabel: g.label, item, status });
                }
            });
        });
        return results;
    }

    function openLibrarySearchResult(folderKey, item, status) {
        const input = document.getElementById('library-search');
        if (input) input.value = '';
        appState.librarySearchQuery = '';
        switchLibraryFolder(folderKey);
        openItemDetail(item, status);
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
                const panelRect = appState.libraryPanel.getBoundingClientRect();
                const overPanel = ue.clientX >= panelRect.left && ue.clientX <= panelRect.right && ue.clientY >= panelRect.top && ue.clientY <= panelRect.bottom;
                if (overPanel) return;
                const canvasRect = canvas.getBoundingClientRect();
                const overCanvas = ue.clientX >= canvasRect.left && ue.clientX <= canvasRect.right && ue.clientY >= canvasRect.top && ue.clientY <= canvasRect.bottom;
                if (!overCanvas) return;
                importSharedCardsAtScreenPoint(item.nodes, ue.clientX, ue.clientY);
                closeRailView();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }

    function deployPurchasedTemplate(id) {
        const item = appState.userLibrary.purchased.find(x => x.id === id);
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
        closeRailView();
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
        appState.userLibrary.drafts.unshift(newItem);

        // packageSelectedAsTemplate (which called this) only ever fires while a card is dropped
        // onto the Library panel, which is therefore already open — just switch its folder and
        // open the new draft, no need to open the panel itself (unlike openLibraryToFolder, used
        // for the purchase flow, which isn't reached from inside an already-open Library panel).
        switchLibraryFolder('drafts');
        openItemDetail(newItem, 'drafts');
    }

export { addItemToCustomFolderById, closeMarketDetail, deployPurchasedTemplate, handleLibrarySearch, handleMarketplaceSearch, openMarketDetail, packageSelectedAsTemplate, purchaseCurrentMarketItem, refreshMyLibrary, removeFromCustomFolder, renderLibrary, switchLibraryFolder };

// React → vanilla bridges — used by MarketDiscoverPanel.jsx/LibraryPanel.jsx/ItemDetailFooter.jsx
// (app/dotto/), which can't import this directly since public/dotto/*.js isn't reachable from
// app/dotto/.
window.__openMarketDetail = openMarketDetail;
window.__switchLibraryFolder = switchLibraryFolder;
window.__createCustomFolder = createCustomFolder;
window.__addItemToCustomFolderById = addItemToCustomFolderById;
window.__removeFromCustomFolder = removeFromCustomFolder;
window.__makeDraftItemDraggable = makeDraftItemDraggable;
window.__openLibrarySearchResult = openLibrarySearchResult;
window.__deployPurchasedTemplate = deployPurchasedTemplate;
// Used by app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3's second relocated
// piece), same reasoning as window.__getAppState (core-state.js).
window.__packageSelectedAsTemplate = packageSelectedAsTemplate;
