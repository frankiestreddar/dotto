import { appState } from './core-state.js';

// Independent floating popup toggled by U — not part of the #hamburger-stack rail-panel system
// (no railViewEls/railIconBtns entry, no wireRailIcon), so it gets its own tiny open/close pair
// instead, matching #draw-settings' plain classList-driven toggle rather than openRailView's
// animated slide. A brief detour through looking/moving like one of those sliding panels (closing
// the rail view on open and vice versa, since the two briefly occupied the same screen position)
// was reverted per explicit follow-up request that this go back to being a small floating popup,
// not a sidebar panel — see #upload-popup's own comment, globals.css, for that shape's own
// history. No cross-closing with the rail view any more; the two don't overlap on screen.
const UPLOAD_ACCEPT = 'image/*,video/*,application/pdf,application/epub+zip,.epub';
const DEFAULT_DROPZONE_LABEL = 'Drag a file here, or click to browse';

// The file a click-to-pick or a real drag-and-drop has put "in hand" — nothing touches the canvas
// until #upload-popup-btn is clicked (resetPendingFile below, called on open/close/place, is what
// keeps this from leaking a stale file into a later, unrelated session of the popup).
let pendingFile = null;

function setPendingFile(file) {
    pendingFile = file || null;
    appState.uploadDropzone.classList.toggle('has-file', !!pendingFile);
    appState.uploadDropzoneLabel.textContent = pendingFile ? pendingFile.name : DEFAULT_DROPZONE_LABEL;
    appState.uploadPopupBtn.disabled = !pendingFile;
}
function resetPendingFile() { setPendingFile(null); }

function openUploadPopup() {
    appState.uploadPopup.classList.add('open');
}
function closeUploadPopup() {
    appState.uploadPopup.classList.remove('open');
    resetPendingFile();
}
function toggleUploadPopup() {
    if (appState.uploadPopup.classList.contains('open')) closeUploadPopup();
    else openUploadPopup();
}

resetPendingFile();
appState.uploadPopupClose.addEventListener('click', closeUploadPopup);

// ---------- Dropzone: click-to-pick or drag-and-drop, either way just captures a File ----------
appState.uploadDropzone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = UPLOAD_ACCEPT;
    input.onchange = () => setPendingFile(input.files[0]);
    input.click();
});
// dragover must also preventDefault — without it the browser's own default (rejecting the drop
// entirely) wins, and 'drop' never fires at all.
appState.uploadDropzone.addEventListener('dragover', (e) => { e.preventDefault(); appState.uploadDropzone.classList.add('drag-over'); });
appState.uploadDropzone.addEventListener('dragleave', () => appState.uploadDropzone.classList.remove('drag-over'));
appState.uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    appState.uploadDropzone.classList.remove('drag-over');
    setPendingFile(e.dataTransfer.files[0]);
});

// ---------- Place: creates the canvas item only now, once a file's actually been picked ----------
// Creates a blank 'media' item at the current viewport center, then hands the already-picked file
// straight to processMediaFile (app/dotto/lib/mediaPdfEpub.ts) — the same FileReader/Supabase-
// storage pipeline the Media card's own "Upload" button uses (via triggerMediaUpload, a thin
// wrapper around that same function for ITS OWN picker-then-process flow), not a reimplementation.
// add() (app/dotto/lib/srsConnectionsCore.ts) doesn't return the item it creates, but it's
// synchronous and always pushes onto the end of the current folder's items array, so the last
// entry right after calling it is guaranteed to be the one just added.
appState.uploadPopupBtn.addEventListener('click', () => {
    if (!pendingFile) return;
    const { x, y } = window.__viewportCenterWorldPoint?.() || { x: 0, y: 0 };
    window.__add?.('media', x, y);
    const items = appState.folders[appState.currentFolderId].items;
    window.__processMediaFile(items[items.length - 1].id, pendingFile);
    closeUploadPopup();
});

export { closeUploadPopup, toggleUploadPopup };

// Used by app/dotto/lib/historyAutosave.ts's global Escape keydown handler (Phase 4.5).
window.__closeUploadPopup = closeUploadPopup;
// Used by app/dotto/lib/srsConnectionsCore.ts's global keydown handler's 'u' shortcut (Phase 4.5).
window.__toggleUploadPopup = toggleUploadPopup;
