import { clearSearch, escapeHtml } from './ai-assistant-suggestions.js';
import { appState, canvas, supabase } from './core-state.js';
import { saveSnapshot } from './history-autosave.js';
import { openItemDetail } from './library-publish.js';
import { findItemById, importSharedCardsAtScreenPoint, renderInlineCanvas, sanitizeFlashcardSnapshot, snapshotItem } from './live-presence.js';
import { closeAllPanels, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { render, renderSelectedOutlines } from './waypoints-render-loop.js';


    // ---------- Template Marketplace Features ----------
    function closeCartPanel() { appState.cartPanel.classList.remove('open'); appState.btnCart.classList.remove('active'); appState.panelPinned.cart = false; }
    function positionCartPanel() {
        const rect = appState.btnCart.getBoundingClientRect();
        appState.cartPanel.style.bottom = 'auto';
        appState.cartPanel.style.top = (rect.bottom + 10) + 'px';
        const panelWidth = 380;
        const btnCenter = rect.left + rect.width / 2;
        let leftPos = btnCenter - panelWidth / 2;
        if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
        if (leftPos < 20) leftPos = 20;
        appState.cartPanel.style.left = leftPos + 'px';
        appState.cartPanel.style.right = 'auto';
    }
    // Restores whichever tab (discover/library) was last active, clearing any transient
    // detail/publish-flow view. Nothing is ever lost by calling this — drafts are persisted
    // to the database the moment they're created, so there's no "discard" state to worry about.
    function resetCartPanelToTabView() {
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.remove('active');
        document.getElementById('view-discover').classList.toggle('active', appState.activeCartTab === 'discover');
        document.getElementById('view-library').classList.toggle('active', appState.activeCartTab === 'library');
    }
    async function openCartPanel(pin) {
        closeAllPanels('cart');
        clearSearch();
        appState.cartPanel.classList.add('open');
        appState.btnCart.classList.add('active');
        // Positioned immediately (depends only on the button's rect, not on panel content), so
        // it never flashes at its unpositioned default in the top-left corner while the first
        // fetch of the session (the slow one — nothing's cached yet) is still in flight.
        positionCartPanel();
        appState.selectedMarketItem = null;
        resetCartPanelToTabView();
        await Promise.all([refreshMarketplaceListings(), refreshMyLibrary()]);
        renderMarketplaceDiscover();
        renderLibrary();
        if (pin) appState.panelPinned.cart = true;
    }
    appState.btnCart.addEventListener('click', (e) => {
        e.stopPropagation();
        if (appState.panelPinned.cart) { closeCartPanel(); }
        else { openCartPanel(true); }
    });
    appState.btnCart.addEventListener('mouseenter', () => { if (!appState.cartPanel.classList.contains('open')) openCartPanel(false); });
    appState.btnCart.addEventListener('mouseleave', () => scheduleHoverClose('cart', [appState.btnCart, appState.cartPanel], closeCartPanel));
    appState.cartPanel.addEventListener('mouseleave', () => scheduleHoverClose('cart', [appState.btnCart, appState.cartPanel], closeCartPanel));
    pinOnInsideClick('cart', [appState.cartPanel]);

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

    async function switchCartTab(tab) {
        appState.activeCartTab = tab;
        document.getElementById('tab-discover-btn').classList.toggle('active', tab === 'discover');
        document.getElementById('tab-library-btn').classList.toggle('active', tab === 'library');

        document.getElementById('view-discover').classList.toggle('active', tab === 'discover');
        document.getElementById('view-library').classList.toggle('active', tab === 'library');
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.remove('active');

        if (tab === 'discover') { await refreshMarketplaceListings(); renderMarketplaceDiscover(); }
        else { appState.activeLibraryFolder = null; document.getElementById('library-back-row').classList.remove('show'); await refreshMyLibrary(); renderLibrary(); }
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

    function renderMarketplaceDiscover() {
        const container = document.getElementById('market-list-container');
        container.innerHTML = '';
        
        const filtered = appState.trendingMarketplace.filter(item => {
            return item.title.toLowerCase().includes(appState.marketplaceSearchQuery) ||
                   item.description.toLowerCase().includes(appState.marketplaceSearchQuery) ||
                   (item.tagline || '').toLowerCase().includes(appState.marketplaceSearchQuery);
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
        appState.selectedMarketItem = item;
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
        appState.selectedMarketItem = null;
        document.getElementById('market-detail-view').classList.remove('active');
        document.getElementById('view-discover').classList.add('active');
    }

    async function purchaseCurrentMarketItem() {
        if (!appState.selectedMarketItem) return;

        const alreadyOwns = appState.userLibrary.purchased.some(x => x.id === appState.selectedMarketItem.id);
        if (alreadyOwns) {
            alert("This template snapshot is already inside your Library!");
            closeMarketDetail();
            switchCartTab('library');
            return;
        }

        const { error } = await supabase
            .from('library_items')
            .insert({ user_id: appState.currentUser.id, listing_id: appState.selectedMarketItem.id });
        if (error) { console.error('[marketplace] purchase failed:', error); alert('Something went wrong adding this to your library.'); return; }

        alert(`Successfully purchased "${appState.selectedMarketItem.title}" as a customizable template snapshot!`);
        closeMarketDetail();
        switchCartTab('library');
        switchLibraryFolder('purchased');
    }

    function renderLibrary() {
        const container = document.getElementById('library-list-container');
        container.innerHTML = '';

        if (appState.librarySearchQuery) {
            renderLibrarySearchResults(container);
            return;
        }

        if (!appState.activeLibraryFolder) {
            ['purchased', 'drafts', 'published'].forEach(key => {
                const row = document.createElement('div');
                row.className = 'lib-folder-row';
                row.innerHTML = `<span>${appState.libraryFolderLabels[key]}</span><span class="lib-folder-count">${appState.userLibrary[key].length} item${appState.userLibrary[key].length === 1 ? '' : 's'}</span>`;
                row.onclick = () => switchLibraryFolder(key);
                container.appendChild(row);
            });

            const divider = document.createElement('div');
            divider.className = 'library-divider';
            container.appendChild(divider);

            appState.userLibrary.customFolders.forEach(folder => {
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

        const isCustom = isCustomFolderId(appState.activeLibraryFolder);
        const customFolder = isCustom ? appState.userLibrary.customFolders.find(f => f.id === appState.activeLibraryFolder) : null;
        const list = isCustom ? (customFolder ? customFolder.items : []) : appState.userLibrary[appState.activeLibraryFolder];

        if (!list || !list.length) {
            container.innerHTML = `<div class="text-xs text-neutral-500 text-center py-12 font-mono">
                No templates inside folder. <br><br>
                ${appState.activeLibraryFolder === 'drafts' ? 'Drag elements over marketplace when active to build a blueprint draft!' : ''}
                ${isCustom ? 'Use the "+ Folder…" picker on any item in Purchased, Drafts, or Published to add it here.' : ''}
            </div>`;
            return;
        }

        list.forEach(item => {
            const div = document.createElement('div');
            div.className = 'lib-item-card';

            const addToFolderControl = (!isCustom && appState.userLibrary.customFolders.length)
                ? `<select class="lib-add-to-folder-select" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" onchange="if(this.value){addItemToCustomFolderById(this.value, '${appState.activeLibraryFolder}', '${item.id}');} this.value='';">
                    <option value="">+ Folder…</option>
                    ${appState.userLibrary.customFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
                </select>`
                : '';

            const removeControl = isCustom
                ? `<button class="lib-remove-btn" title="Remove from folder" onclick="event.stopPropagation(); removeFromCustomFolder('${appState.activeLibraryFolder}', '${item.id}')">✕</button>`
                : '';

            div.innerHTML = `
                <div class="lib-item-meta">
                    <div class="lib-item-title">${escapeHtml(item.title)}</div>
                    <div class="lib-item-count">${item.count || 0} cards packaged</div>
                </div>
                ${addToFolderControl}
                ${removeControl}
            `;
            const status = isCustom ? resolveItemStatus(item) : appState.activeLibraryFolder;
            if (status === 'drafts') makeDraftItemDraggable(div, item);
            else makeLibItemClickable(div, item, status);
            container.appendChild(div);
        });
    }

    // A library item may live in exactly one of these three real folders; custom folders
    // just hold references to items that already belong to one of them.
    function resolveItemStatus(item) {
        if (appState.userLibrary.drafts.some(x => x.id === item.id)) return 'drafts';
        if (appState.userLibrary.published.some(x => x.id === item.id)) return 'published';
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

    function renderLibrarySearchResults(container) {
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
                appState.librarySearchQuery = '';
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
                const panelRect = appState.cartPanel.getBoundingClientRect();
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
        appState.userLibrary.drafts.unshift(newItem);

        appState.activeCartTab = 'library';
        appState.activeLibraryFolder = 'drafts';
        document.getElementById('tab-discover-btn').classList.remove('active');
        document.getElementById('tab-library-btn').classList.add('active');
        document.getElementById('library-back-row').classList.add('show');
        document.getElementById('library-back-label').textContent = 'Back to folders';

        openItemDetail(newItem, 'drafts');
    }

export { addItemToCustomFolderById, closeCartPanel, closeMarketDetail, deployPurchasedTemplate, handleLibrarySearch, handleMarketplaceSearch, packageSelectedAsTemplate, purchaseCurrentMarketItem, refreshMyLibrary, removeFromCustomFolder, renderLibrary, switchCartTab, switchLibraryFolder };
