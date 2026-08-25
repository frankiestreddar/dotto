import { appState } from './core-state.js';
import { processMediaFile } from './media-pdf-epub.js';
import { closeRailView } from './panels-hamburger.js';
import { add, viewportCenterWorldPoint } from './srs-connections-core.js';

// Independent floating popup toggled by U — not part of the #hamburger-stack rail-panel system
// (no railViewEls/railIconBtns entry, no wireRailIcon), so it gets its own tiny open/close pair
// instead, matching #draw-settings' plain classList-driven toggle rather than openRailView's
// animated slide. Per explicit follow-up request it now slides/fades the same way that shell's
// own panels do anyway (see #upload-popup's own comment, globals.css) — just via a parallel
// implementation, not by actually joining that shared system. closeRailView() on open (and
// closeUploadPopup() called from openRailView, panels-hamburger.js, on the way in) keeps the two
// mutually exclusive now that they occupy the same screen position.
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
    closeRailView();
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
// straight to processMediaFile (media-pdf-epub.js) — the same FileReader/Supabase-storage pipeline
// the Media card's own "Upload" button uses (via triggerMediaUpload, a thin wrapper around that
// same function for ITS OWN picker-then-process flow), not a reimplementation.
// add() (srs-connections-core.js) doesn't return the item it creates, but it's synchronous and
// always pushes onto the end of the current folder's items array, so the last entry right after
// calling it is guaranteed to be the one just added.
appState.uploadPopupBtn.addEventListener('click', () => {
    if (!pendingFile) return;
    const { x, y } = viewportCenterWorldPoint();
    add('media', x, y);
    const items = appState.folders[appState.currentFolderId].items;
    processMediaFile(items[items.length - 1].id, pendingFile);
    closeUploadPopup();
});

export { closeUploadPopup, toggleUploadPopup };
