import { appState } from './core-state.js';
import { triggerMediaUpload } from './media-pdf-epub.js';
import { add, viewportCenterWorldPoint } from './srs-connections-core.js';

// Independent floating popup toggled by U — not part of the #hamburger-stack rail-panel system
// (no railViewEls/railIconBtns entry, no wireRailIcon), so it gets its own tiny open/close pair
// instead, matching #draw-settings' plain classList-driven toggle rather than openRailView's
// animated slide.
function openUploadPopup() { appState.uploadPopup.classList.add('open'); }
function closeUploadPopup() { appState.uploadPopup.classList.remove('open'); }
function toggleUploadPopup() {
    if (appState.uploadPopup.classList.contains('open')) closeUploadPopup();
    else openUploadPopup();
}

appState.uploadPopupClose.addEventListener('click', closeUploadPopup);
// Creates a blank 'media' item at the current viewport center, then hands it straight to
// triggerMediaUpload (media-pdf-epub.js) — the same upload flow a Media card's own "Upload"
// button already uses (native file picker, image/video/PDF/EPUB branching, Supabase storage for
// documents), so this popup is just a second entry point into it rather than a reimplementation.
// add() (srs-connections-core.js) doesn't return the item it creates, but it's synchronous and
// always pushes onto the end of the current folder's items array, so the last entry right after
// calling it is guaranteed to be the one just added.
appState.uploadPopupBtn.addEventListener('click', () => {
    const { x, y } = viewportCenterWorldPoint();
    add('media', x, y);
    const items = appState.folders[appState.currentFolderId].items;
    triggerMediaUpload(items[items.length - 1].id);
});

export { closeUploadPopup, toggleUploadPopup };
