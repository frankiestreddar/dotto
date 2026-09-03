// Independent floating popup toggled by U — not part of the #hamburger-stack rail-panel system
// (no railViewEls/railIconBtns entry, no wireRailIcon), so it gets its own tiny open/close pair
// instead, matching #draw-settings' plain classList-driven toggle rather than openRailView's
// animated slide. A brief detour through looking/moving like one of those sliding panels (closing
// the rail view on open and vice versa, since the two briefly occupied the same screen position)
// was reverted per explicit follow-up request that this go back to being a small floating popup,
// not a sidebar panel — see #upload-popup's own comment, globals.css, for that shape's own
// history. No cross-closing with the rail view any more; the two don't overlap on screen.

interface AppState {
  uploadPopup: HTMLElement;
  uploadPopupBtn: HTMLButtonElement;
  uploadPopupClose: HTMLElement;
  uploadDropzone: HTMLElement;
  uploadDropzoneLabel: HTMLElement;
  folders: Record<string, { items: { id: number }[] }>;
  currentFolderId: string;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

const UPLOAD_ACCEPT = "image/*,video/*,application/pdf,application/epub+zip,.epub";
const DEFAULT_DROPZONE_LABEL = "Drag a file here, or click to browse";

// The file a click-to-pick or a real drag-and-drop has put "in hand" — nothing touches the canvas
// until #upload-popup-btn is clicked (resetPendingFile below, called on open/close/place, is what
// keeps this from leaking a stale file into a later, unrelated session of the popup).
let pendingFile: File | null = null;

function setPendingFile(file: File | null | undefined) {
  const appState = getAppState();
  pendingFile = file || null;
  appState.uploadDropzone.classList.toggle("has-file", !!pendingFile);
  appState.uploadDropzoneLabel.textContent = pendingFile
    ? pendingFile.name
    : DEFAULT_DROPZONE_LABEL;
  appState.uploadPopupBtn.disabled = !pendingFile;
}
function resetPendingFile() {
  setPendingFile(null);
}

function openUploadPopup() {
  getAppState().uploadPopup.classList.add("open");
}
export function closeUploadPopup(): void {
  const appState = getAppState();
  appState.uploadPopup.classList.remove("open");
  resetPendingFile();
}
export function toggleUploadPopup(): void {
  const appState = getAppState();
  if (appState.uploadPopup.classList.contains("open")) closeUploadPopup();
  else openUploadPopup();
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  const appState = getAppState();
  resetPendingFile();
  appState.uploadPopupClose.addEventListener("click", closeUploadPopup);

  // ---------- Dropzone: click-to-pick or drag-and-drop, either way just captures a File ----------
  appState.uploadDropzone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = UPLOAD_ACCEPT;
    input.onchange = () => setPendingFile(input.files?.[0]);
    input.click();
  });
  // dragover must also preventDefault — without it the browser's own default (rejecting the drop
  // entirely) wins, and 'drop' never fires at all.
  appState.uploadDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    appState.uploadDropzone.classList.add("drag-over");
  });
  appState.uploadDropzone.addEventListener("dragleave", () =>
    appState.uploadDropzone.classList.remove("drag-over"),
  );
  appState.uploadDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    appState.uploadDropzone.classList.remove("drag-over");
    setPendingFile(e.dataTransfer?.files[0]);
  });

  // ---------- Place: creates the canvas item only now, once a file's actually been picked ----------
  // Creates a blank 'media' item at the current viewport center, then hands the already-picked
  // file straight to processMediaFile (app/dotto/lib/mediaPdfEpub.ts) — the same FileReader/
  // Supabase-storage pipeline the Media card's own "Upload" button uses (via triggerMediaUpload, a
  // thin wrapper around that same function for ITS OWN picker-then-process flow), not a
  // reimplementation. add() (app/dotto/lib/srsConnectionsCore.ts) doesn't return the item it
  // creates, but it's synchronous and always pushes onto the end of the current folder's items
  // array, so the last entry right after calling it is guaranteed to be the one just added.
  appState.uploadPopupBtn.addEventListener("click", () => {
    if (!pendingFile) return;
    const { x, y } = window.__viewportCenterWorldPoint?.() || { x: 0, y: 0 };
    window.__add?.("media", x, y);
    const items = appState.folders[appState.currentFolderId].items;
    window.__processMediaFile?.(items[items.length - 1].id, pendingFile);
    closeUploadPopup();
  });
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs live appState right at
// wire time (to attach the dropzone/close/place listeners), same single-readiness-check shape
// app/dotto/lib/cardShortcuts.ts's own wireCardShortcuts established.
export function wireUploadPopup(): () => void {
  if (window.__getAppState) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState) {
      clearInterval(poll);
      doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // Used by app/dotto/lib/historyAutosave.ts's global Escape keydown handler.
  window.__closeUploadPopup = closeUploadPopup;
  // Used by app/dotto/lib/srsConnectionsCore.ts's global keydown handler's 'u' shortcut.
  window.__toggleUploadPopup = toggleUploadPopup;
}
