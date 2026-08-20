import { appState, supabase } from './core-state.js';
import { renderInlineCanvas } from './live-presence.js';
import { refreshMyLibrary, renderLibrary, switchLibraryFolder } from './marketplace.js';


    // ---------- Library Item Detail View (drafts / published / purchased) ----------

    function openItemDetail(item, sourceFolder) {
        appState.detailItem = item;
        appState.detailSourceFolder = sourceFolder;
        appState.detailOriginal = { title: item.title, description: item.description || '', price: item.price || '' };

        // Keep the marketplace panel open (pinned) while the detail page is showing — Marketplace
        // shares the one rail-wide pinned flag now (see appState.panelPinned.rail, core-state.js).
        appState.panelPinned.rail = true;
        appState.cartPanel.classList.add('open');
        appState.btnCart.classList.add('active');

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
        await refreshMyLibrary();
        closeItemDetail();
        switchLibraryFolder('drafts');
    }

    async function deleteDetailDraft() {
        if (!appState.detailItem || appState.detailSourceFolder !== 'drafts') return;
        const { error } = await supabase.from('marketplace_listings').delete().eq('id', appState.detailItem.id);
        if (error) { console.error('[marketplace] failed to delete draft:', error); return; }
        appState.userLibrary.drafts = appState.userLibrary.drafts.filter(x => x.id !== appState.detailItem.id);
        closeItemDetail();
        renderLibrary();
    }

    function closeItemDetail() {
        appState.detailItem = null; appState.detailSourceFolder = null; appState.detailOriginal = null;
        document.getElementById('item-detail-view').classList.remove('active');
        document.getElementById('view-library').classList.add('active');
        renderLibrary();
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
        canvasWrap.appendChild(renderInlineCanvas(appState.publishFlowItem.nodes || [], false));
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
        await refreshMyLibrary();
        switchLibraryFolder('published');
    }

export { blurPublishFlowName, commitItemDetailDesc, commitItemDetailTitle, confirmPublishFlow, deleteDetailDraft, focusPublishFlowName, onItemDetailFieldChange, openItemDetail, startPublishFlow, unpublishDetailItem, updateDetailItem };

// React → vanilla bridges — used by LibraryPanel.jsx/ItemDetailFooter.jsx (app/dotto/), which
// can't import this directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__openItemDetail = openItemDetail;
window.__deleteDetailDraft = deleteDetailDraft;
window.__startPublishFlow = startPublishFlow;
window.__unpublishDetailItem = unpublishDetailItem;
window.__updateDetailItem = updateDetailItem;
