import { userLibrary } from './add-menu.js';
import { supabase } from './core-state.js';
import { renderInlineCanvas } from './live-presence.js';
import { btnCart, cartPanel, refreshMyLibrary, renderLibrary, switchLibraryFolder } from './marketplace.js';
import { panelPinned } from './panels-hamburger.js';


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

export { blurPublishFlowName, commitItemDetailDesc, commitItemDetailTitle, confirmPublishFlow, deleteDetailDraft, focusPublishFlowName, onItemDetailFieldChange, openItemDetail, startPublishFlow, unpublishDetailItem, updateDetailItem };
