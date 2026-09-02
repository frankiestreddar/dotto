import { addMenu, appState, btnAdd, supabase } from './core-state.js';


    // ---------- Blocks panel: Item Detail View (Purchased / My Creations = drafts+published) ----------
    // Was Library's item detail view — relocated here (DOM moved into #add-menu,
    // content/fragments/hamburger-stack.html) along with the rest of "browse your own library
    // content" when Library was repurposed into Plugins. refreshBlocksPanel/createBlocksFolder/etc.
    // (blocks-panel.js) are called via window.__refreshBlocksPanel rather than imported directly —
    // blocks-panel.js itself imports openItemDetail from this file, so a direct import back here
    // would be circular.

    function openItemDetail(item, sourceFolder) {
        appState.detailItem = item;
        appState.detailSourceFolder = sourceFolder;
        appState.detailOriginal = { title: item.title, description: item.description || '', price: item.price || '' };

        // Keep the Blocks panel open (pinned) while the detail page is showing — it shares the one
        // rail-wide pinned flag now (see appState.panelPinned.rail, core-state.js). Both callers (a
        // Blocks row click, or packageSelectedAsTemplate's drag-drop) only ever reach this while
        // the Blocks panel is already the open rail view, so this is just making that state
        // explicit rather than actually switching panels.
        appState.panelPinned.rail = true;
        addMenu.classList.add('open');
        btnAdd.classList.add('active');

        document.getElementById('view-library').classList.remove('active');
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
        canvasWrap.appendChild(window.__renderInlineCanvas(item.nodes || item.canvasSnapshot || [], false));

        renderItemDetailFooter();
    }

    // Real React state now (see app/dotto/ItemDetailFooter.jsx, itemDetailFooterStore) — a
    // natural, self-contained discriminated union, unlike the rest of this view (see that store's
    // own comment in bridges.js for why the form fields stay vanilla).
    function renderItemDetailFooter() {
        window.__setItemDetailFooter({
            sourceFolder: appState.detailSourceFolder,
            itemId: appState.detailItem.id,
            dirty: appState.detailSourceFolder === 'published' ? isDetailDirty() : false
        });
    }

    function isDetailDirty() {
        if (!appState.detailOriginal) return false;
        const title = (document.getElementById('item-detail-title').textContent || '').trim();
        const description = document.getElementById('item-detail-desc').value.trim();
        const price = document.getElementById('item-detail-price').value.trim();
        return title !== appState.detailOriginal.title || description !== appState.detailOriginal.description || price !== appState.detailOriginal.price;
    }

    function onItemDetailFieldChange() {
        if (appState.detailSourceFolder !== 'published') return;
        renderItemDetailFooter();
    }

    // Drafts are private and low-stakes, so title/description edits autosave on blur rather
    // than needing an explicit save action (there's no "Save" button anymore).
    function commitItemDetailTitle() {
        if (appState.detailSourceFolder !== 'drafts' || !appState.detailItem) return;
        const titleEl = document.getElementById('item-detail-title');
        const title = (titleEl.textContent || '').trim() || 'Untitled Draft';
        titleEl.textContent = title;
        if (title === appState.detailItem.title) return;
        appState.detailItem.title = title;
        appState.detailOriginal.title = title;
        supabase.from('marketplace_listings').update({ title }).eq('id', appState.detailItem.id).then(({ error }) => {
            if (error) console.error('[marketplace] failed to save title:', error);
        });
        const cached = appState.userLibrary.drafts.find(x => x.id === appState.detailItem.id);
        if (cached) cached.title = title;
    }

    function commitItemDetailDesc() {
        if (appState.detailSourceFolder !== 'drafts' || !appState.detailItem) return;
        const description = document.getElementById('item-detail-desc').value;
        if (description === appState.detailItem.description) return;
        appState.detailItem.description = description;
        appState.detailOriginal.description = description;
        supabase.from('marketplace_listings').update({ description }).eq('id', appState.detailItem.id).then(({ error }) => {
            if (error) console.error('[marketplace] failed to save description:', error);
        });
        const cached = appState.userLibrary.drafts.find(x => x.id === appState.detailItem.id);
        if (cached) cached.description = description;
    }

    // Published listings are live/public, so edits here are staged locally and only pushed
    // once "Update" is explicitly clicked (that's what the disabled-until-dirty state guards).
    async function updateDetailItem() {
        if (!appState.detailItem || appState.detailSourceFolder !== 'published') return;
        const title = (document.getElementById('item-detail-title').textContent || '').trim() || appState.detailItem.title;
        const description = document.getElementById('item-detail-desc').value.trim();
        const price = document.getElementById('item-detail-price').value.trim() || appState.detailItem.price;

        const { error } = await supabase.from('marketplace_listings').update({ title, description, price_label: price }).eq('id', appState.detailItem.id);
        if (error) { console.error('[marketplace] failed to update listing:', error); return; }

        appState.detailItem.title = title; appState.detailItem.description = description; appState.detailItem.price = price;
        appState.detailOriginal = { title, description, price };
        document.getElementById('item-detail-title').textContent = title;
        const cached = appState.userLibrary.published.find(x => x.id === appState.detailItem.id);
        if (cached) { cached.title = title; cached.description = description; cached.price = price; }
        renderItemDetailFooter();
    }

    async function unpublishDetailItem() {
        if (!appState.detailItem || appState.detailSourceFolder !== 'published') return;
        const { error } = await supabase.from('marketplace_listings').update({ status: 'draft', published_at: null }).eq('id', appState.detailItem.id);
        if (error) { console.error('[marketplace] failed to unpublish:', error); return; }
        await window.__refreshMyLibrary();
        closeItemDetail();
        window.__refreshBlocksPanel();
    }

    // Core delete, shared by deleteDetailDraft (the detail view's own button, drafts only, ItemDetailFooter.jsx's
    // existing gating) and deleteMyCreationItem (blocks-panel.js's new row-level hover delete button, which can
    // target either a draft OR a published item — My Creations is drafts+published combined).
    async function deleteMarketplaceListing(id, folderKey) {
        const { error } = await supabase.from('marketplace_listings').delete().eq('id', id);
        if (error) { console.error('[marketplace] failed to delete listing:', error); return false; }
        appState.userLibrary[folderKey] = appState.userLibrary[folderKey].filter(x => x.id !== id);
        return true;
    }

    async function deleteDetailDraft() {
        if (!appState.detailItem || appState.detailSourceFolder !== 'drafts') return;
        const ok = await deleteMarketplaceListing(appState.detailItem.id, 'drafts');
        if (!ok) return;
        closeItemDetail();
        window.__refreshBlocksPanel();
    }

    // Row-level delete (Blocks panel's hover delete button on a My Creations item, not gated on
    // appState.detailItem/detailSourceFolder the way deleteDetailDraft is — this is called directly
    // from a list row, no need to have clicked into the item detail view first). folderKey is
    // 'drafts' or 'published', resolved by the caller via resolveItemStatus (blocks-panel.js).
    async function deleteMyCreationItem(item, folderKey) {
        const ok = await deleteMarketplaceListing(item.id, folderKey);
        if (ok) window.__refreshBlocksPanel();
    }

    function closeItemDetail() {
        appState.detailItem = null; appState.detailSourceFolder = null; appState.detailOriginal = null;
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('view-library').classList.add('active');
        window.__refreshBlocksPanel();
    }

    // ---------- Publish Flow (draft -> published, no native alert()/prompt() popups) ----------

    function startPublishFlow() {
        if (!appState.detailItem || appState.detailSourceFolder !== 'drafts') return;
        appState.publishFlowItem = appState.detailItem;

        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('publish-flow-view').classList.add('active');

        document.getElementById('publish-flow-name').textContent = appState.publishFlowItem.title || '';
        document.getElementById('publish-flow-price').value = '';
        document.getElementById('publish-flow-tagline').value = '';
        document.getElementById('publish-flow-desc').value = appState.publishFlowItem.description || '';

        const canvasWrap = document.getElementById('publish-flow-canvas-wrap');
        canvasWrap.innerHTML = '';
        canvasWrap.appendChild(window.__renderInlineCanvas(appState.publishFlowItem.nodes || [], false));
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
        if (!appState.publishFlowItem) return;
        const title = (document.getElementById('publish-flow-name').textContent || '').trim() || appState.publishFlowItem.title || 'Untitled Draft';
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
        }).eq('id', appState.publishFlowItem.id);
        if (error) { console.error('[marketplace] failed to publish:', error); return; }

        appState.publishFlowItem = null;
        document.getElementById('publish-flow-view').classList.remove('active');
        document.getElementById('view-library').classList.add('active');
        await window.__refreshMyLibrary();
        window.__refreshBlocksPanel();
    }

export { blurPublishFlowName, commitItemDetailDesc, commitItemDetailTitle, confirmPublishFlow, deleteDetailDraft, deleteMyCreationItem, focusPublishFlowName, onItemDetailFieldChange, openItemDetail, startPublishFlow, unpublishDetailItem, updateDetailItem };

// React → vanilla bridges — used by ItemDetailFooter.jsx (app/dotto/), which can't import this
// directly since public/dotto/*.js isn't reachable from app/dotto/. openItemDetail/
// deleteMyCreationItem are imported directly by blocks-panel.js instead (a plain vanilla-to-vanilla
// import, no circularity in that direction), not bridged here.
window.__openItemDetail = openItemDetail;
window.__deleteDetailDraft = deleteDetailDraft;
window.__startPublishFlow = startPublishFlow;
window.__unpublishDetailItem = unpublishDetailItem;
window.__updateDetailItem = updateDetailItem;
