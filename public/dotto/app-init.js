const appState = window.__getAppState();
import { refreshCanvasCollabForCurrentFolder, refreshFriendsData, renderCollabPill } from './friends-presence.js';
import { refreshDotbotUsage } from './profile-achievements-pricing.js';

// Phase 4.3 split (was part of resize-shortcuts-init.js, see PHASE4_ROADMAP.md) — the "init"
// concern: the one-time bootstrap sequence that actually gets the app showing real content, run
// as this module's own side effect on load (the last file in dotto-script.js's import order that
// needs to be, since everything it calls must already be wired up).

// Guarded (not a plain call — see BSD-sed-line-start-limitation precedent) since this fires
// before wireSrsConnectionsCore() (srsConnectionsCore.ts) has necessarily run yet — harmless if it
// hasn't: the buttons' 'active' class only affects an initial cosmetic highlight, self-corrects the
// first time the user actually clicks a draw-layer button.
window.__updateDrawLayerBtns?.();
window.__applyCursorMode();
// Waits for any saved workspace before the first render, so a returning user's real content shows
// immediately instead of flashing the built-in starter folders first. window.__loadWorkspace() no-ops
// instantly if there's no signed-in user or nothing saved yet.
(async () => {
    const restoredView = await window.__loadWorkspace();
    window.__render();
    if (!restoredView) window.__centerOnContent();
    else window.__applyTransform();
    // Same reasoning as the fix inside refreshCanvasCollabForCurrentFolder itself — the very first
    // render() above ran before this had any real data, so a landing folder with an actual
    // collaborator could otherwise start out wrongly deciding "no live channel needed" straight
    // from a fresh page load, not just after a later in-app navigation.
    refreshCanvasCollabForCurrentFolder();
    // A reload that resumed straight back into a shared canvas (see loadWorkspace's own resume
    // logic) reads the same as freshly entering it from the user's point of view — the one-time
    // "Collaborating on..." notification should still fire, not just for the in-session entry
    // points (openSharedCanvas/goToWaypointCard).
    if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSharedView) window.__announceEnteredCollaboration(appState.currentFolderId);
})();
refreshFriendsData().then(() => renderCollabPill());
refreshDotbotUsage();
