import { addMenu, appState, btnAdd, supabase } from './core-state.js';
import { saveSnapshot } from './history-autosave.js';
import { openItemDetail } from './library-publish.js';
import { findItemById, sanitizeFlashcardSnapshot, snapshotItem } from './live-presence.js';
import { closeRailView, openRailView, wireRailIcon } from './panels-hamburger.js';
import { render, renderSelectedOutlines } from './waypoints-render-loop.js';


    // ---------- Template Marketplace (Discover) — browsing other creators' published templates.
    // "Browse your own library content" (drafts/published/purchased/custom folders) moved to the
    // Blocks panel (blocks-panel.js) when Library was repurposed into Plugins — see that file for
    // all of it. Everything below here is Discover/purchase-flow only, untouched by that move. ----------
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

    // Opens the Blocks panel (rail-pinned) and refreshes it — used after a purchase so the newly-
    // bought item shows up in its always-visible Purchased folder. Was openLibraryToFolder('purchased'),
    // back when Library had its own folder-drilldown view to jump straight to; Blocks shows every
    // folder's contents at once now, so there's no specific folder to navigate to, just a refresh.
    // window.__refreshBlocksPanel (not a direct import) — blocks-panel.js imports refreshMyLibrary
    // from this file, so importing back here would be circular.
    function openBlocksAfterPurchase() {
        openRailView('add', addMenu, btnAdd, () => window.__refreshBlocksPanel(), true);
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
    // Populates userLibrary.{drafts,published,purchased} from Supabase — called by
    // refreshBlocksPanel (blocks-panel.js) every time the Blocks panel opens, same as it used to be
    // called by Library's own refreshLibraryPanel.
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
        // acquired_at drives the Blocks panel's Purchased folder, sorted most-recent-first —
        // carried through as acquiredAt alongside the usual marketplaceItemFromRow shape.
        appState.userLibrary.purchased = (acquired || []).filter(r => r.listing).map(r => ({ ...marketplaceItemFromRow(r.listing), acquiredAt: r.acquired_at }));
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
            openBlocksAfterPurchase();
            return;
        }

        const { error } = await supabase
            .from('library_items')
            .insert({ user_id: appState.currentUser.id, listing_id: appState.selectedMarketItem.id });
        if (error) { console.error('[marketplace] purchase failed:', error); alert('Something went wrong adding this to your library.'); return; }

        alert(`Successfully purchased "${appState.selectedMarketItem.title}" as a customizable template snapshot!`);
        closeMarketDetail();
        openBlocksAfterPurchase();
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

    // Cards dropped onto the Blocks panel's dropzone are saved as a draft row right away (rather
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
        // onto the Blocks panel, which is therefore already open — just open the new draft, no
        // need to open the panel itself.
        openItemDetail(newItem, 'drafts');
    }

export { closeMarketDetail, deployPurchasedTemplate, handleMarketplaceSearch, openMarketDetail, packageSelectedAsTemplate, purchaseCurrentMarketItem, refreshMyLibrary };

// React → vanilla bridges — used by MarketDiscoverPanel.jsx/ItemDetailFooter.jsx (app/dotto/),
// which can't import this directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__openMarketDetail = openMarketDetail;
window.__deployPurchasedTemplate = deployPurchasedTemplate;
// Used by app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3's second relocated
// piece), same reasoning as window.__getAppState (core-state.js).
window.__packageSelectedAsTemplate = packageSelectedAsTemplate;
