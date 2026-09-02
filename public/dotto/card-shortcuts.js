import { appState, contextMenu, parseItemId } from './core-state.js';
import { cascadeDeleteFolderContents, deleteWaypointFromDb, render, renderSelectedOutlines } from './waypoints-render-loop.js';

// Phase 4.3 split (was part of resize-shortcuts-init.js, see PHASE4_ROADMAP.md) — the "shortcuts"
// concern: global keyboard shortcuts and the multi-select delete action they (and the context
// menu) both trigger.

// Global Option/Alt-held tracking, toggling .option-held on <body> — gates the table cell-edge
// "hold Option, click a red edge to merge" overlays (see TableCard.jsx/mergeTableCells,
// app/dotto/lib/sourceTable.ts) via plain CSS :hover, since CSS itself has no way to detect a held modifier
// key on its own. Genuinely global rather than scoped to any one table: there's no natural
// per-element scope for "is a key currently held," and every table on the canvas should react to
// it the same way regardless of which one (if any) the cursor happens to be over. keyup and
// window blur both clear it, so releasing the key while focus is elsewhere (an input field
// swallowing the keyup, alt-tabbing away entirely) can never leave it stuck on.
document.addEventListener('keydown', (e) => { if (e.altKey) document.body.classList.add('option-held'); });
document.addEventListener('keyup', (e) => { if (!e.altKey) document.body.classList.remove('option-held'); });
window.addEventListener('blur', () => document.body.classList.remove('option-held'));

function findNextFreeSlot(folderId) {
    const items = appState.folders[folderId].items;
    let x = 28;
    while (items.some(i => Math.abs(i.x - x) < 28 && Math.abs(i.y - 28) < 28)) { x += 28 * 8; }
    return x;
}

// Deletes the current multi-selection (see the Backspace keydown handler) — confirms once,
// combined, first if any of them would lose irrecoverable data (a Source's spaced-repetition
// memory, a Shelf's saved review sessions, or a table's own SM-2 progress). This is now the only
// way to delete a card — the old per-card right-click "Delete" menu item is gone (see the
// oncontextmenu change above).
function deleteSelectedCards() {
    if (!appState.selectedCardIds.length) return;
    const items = appState.selectedCardIds.map(id => window.__findItemById(id)).filter(Boolean);
    if (!items.length) return;
    const hasSource = items.some(it => it.kind === 'source');
    const hasShelf = items.some(it => it.kind === 'shelf');
    const hasSrsTable = items.some(it => it.kind === 'table' && it.srsMeta && Object.keys(it.srsMeta).length);
    if (hasSource || hasShelf || hasSrsTable) {
        const parts = [];
        if (hasSource) parts.push("a Source's permanently stored spaced-repetition memory (intervals, ease factors, due dates, streaks)");
        if (hasShelf) parts.push("a Shelf's permanently stored review session history");
        if (hasSrsTable) parts.push("a table's permanently stored spaced-repetition progress");
        if (!confirm(`Deleting will erase ${parts.join(', ')} for good. Delete anyway?`)) return;
    }
    window.__saveSnapshot();
    const idSet = new Set(appState.selectedCardIds);
    const removedWaypoints = items.filter(it => it.kind === 'waypoint');
    // Nested canvases/sources being deleted along with everything inside them (their own
    // waypoints, their own collaborators, and any further-nested canvases in turn) — see
    // cascadeDeleteFolderContents.
    const removedFolders = items.filter(it => (it.kind === 'folder' || it.kind === 'source') && it.folderId);
    appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter(i => !idSet.has(i.id));
    appState.selectedCardIds = [];
    render();
    renderSelectedOutlines();
    removedWaypoints.forEach(it => deleteWaypointFromDb(appState.currentFolderId, it.id));
    removedFolders.forEach(it => cascadeDeleteFolderContents(it.folderId));
}
function setTableAlign(align) {
    const id = parseInt(contextMenu.dataset.id);
    const it = window.__findItemById(id); if (!it) return;
    window.__saveSnapshot();
    it.textAlign = align;
    render();
    contextMenu.style.display = 'none'; appState.contextMenuItemId = null;
}

// ---------- Hover-scoped game card shortcuts ----------
// Whichever game card the mouse is currently sitting over gets its own keyboard shortcuts — Space
// to flip a flashcard (was F; freed up per explicit request once F became the rail shortcut for
// Files, app/dotto/lib/srsConnectionsCore.ts — the two collided since this handler isn't gated on
// !anyPanelOpen), 1-4 for its rating row once flipped, Enter to advance a Typeright card once
// it's been checked (the ONLY way to do that from the keyboard, since the input itself goes
// disabled right after checking — see renderTypeRightHTML — and so can no longer receive its own
// onkeydown). Read live via the :hover pseudo-class rather than tracked mouseenter/mouseleave
// state, since render() rebuilds every .item element from scratch on every change anyway.
function hoveredGameCard() {
    const el = document.querySelector('.item.flashcard:hover, .item.typeright:hover');
    if (!el) return null;
    const it = window.__findItemById(parseItemId(el));
    return it && (it.kind === 'flashcard' || it.kind === 'typeright') ? it : null;
}
document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    // An actually-focused field always wins — this is also what keeps this handler from
    // double-firing Enter while someone's still typing in a Typeright input, since that input
    // has its own onkeydown for the pre-check Enter-to-submit path (see renderTypeRightHTML);
    // this one only ever needs to cover the POST-check state, where the input has gone disabled
    // and can't hold focus anymore.
    const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
    if (isEditingText) return;
    if (window.__isAnyUiPanelOpen()) return;
    if (window.__hasVisibleNotifications()) return; // its own Enter/Escape handling should win, not compete
    const it = hoveredGameCard();
    if (!it) return;
    if (it.kind === 'flashcard') {
        if (e.key === ' ') { e.preventDefault(); window.fcFlip(it.id); return; }
        if (it.fcFlipped && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
            e.preventDefault();
            window.fcRate(it.id, ['noclue', 'wrong', 'hard', 'easy'][Number(e.key) - 1]);
        }
    } else if (it.kind === 'typeright') {
        if (e.key === 'Enter' && it.trChecked) { e.preventDefault(); window.trNext(it.id); }
    }
});

// Left/Right arrow keys turn the page while hovering a PDF card — per explicit request. EPUB is
// deliberately NOT included here: it renders as one continuous scroll (epub.js's 'scrolled-doc'
// flow, see buildEpubViewer's own comment, app/dotto/lib/mediaPdfEpub.ts) rather than discrete pages, so
// there's no page concept for arrow keys to move between — extending this to EPUB would mean
// switching it to a paginated flow first, which wasn't asked for here. Same :hover-based lookup
// as hoveredGameCard above, for the same reason (render() rebuilds every .item element from
// scratch on every change, so tracked mouseenter/mouseleave state would need constant re-wiring
// for no benefit over just reading live :hover). A media card's own wrapper is only ever
// class="item media" regardless of mediaType (applyItemWrapperAttrs, waypoints-render-loop.js) —
// pdf/epub/image/video all share that one kind — so this reads it.mediaType off the found item
// rather than being able to select on kind alone the way hoveredGameCard's flashcard/typeright
// split can.
function hoveredPdfCard() {
    const el = document.querySelector('.item.media:hover');
    if (!el) return null;
    const it = window.__findItemById(parseItemId(el));
    return (it && it.kind === 'media' && it.mediaType === 'pdf') ? { it, el } : null;
}
document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const active = document.activeElement;
    const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
    if (isEditingText) return;
    if (window.__isAnyUiPanelOpen()) return;
    if (window.__hasVisibleNotifications()) return;
    const hovered = hoveredPdfCard();
    if (!hovered) return;
    // Reuses buildPdfViewer's own prevBtn/nextBtn click handlers directly (bounds-checking,
    // it.docPage persistence, scheduleWorkspaceSave, and the actual re-render all already live
    // there, on goToPage — a purely local closure with nothing exported to call instead) rather
    // than duplicating that logic here. .pdf-viewer-nav-btn is the same class on both buttons;
    // DOM order (prev, page label, next — see buildPdfViewer) is what tells them apart.
    const navBtns = hovered.el.querySelectorAll('.pdf-viewer-nav-btn');
    const btn = e.key === 'ArrowLeft' ? navBtns[0] : navBtns[1];
    if (btn) { e.preventDefault(); btn.click(); }
});

export { deleteSelectedCards, findNextFreeSlot, setTableAlign };

// Used by app/dotto/lib/copyPaste.ts's cutSelectedCards (Phase 4.4).
window.__deleteSelectedCards = deleteSelectedCards;
