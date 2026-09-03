// Phase 4.3 split (was part of resize-shortcuts-init.js, see PHASE4_ROADMAP.md) — the "init"
// concern: the one-time bootstrap sequence that actually gets the app showing real content. Was
// the last file in dotto-script.js's own import order, since everything it calls needed to already
// be wired up by then — ported last among this session's leaf-file batch for the same reason, and
// wired in as the LAST wireX() call in app/dotto-app.jsx's own mount effect list to preserve that
// same ordering guarantee (in particular, window.__applyCursorMode below is called unconditionally,
// not optional-chained, same as the original — this file's own timing assumed it was always ready
// by the time it ran). refreshCanvasCollabForCurrentFolder/refreshFriendsData/renderCollabPill are
// real ES imports now too (same app/dotto/lib tree as app/dotto/lib/friendsPresence.ts, once that
// file was ported) — no bridge needed for that specific dependency.

import {
  refreshCanvasCollabForCurrentFolder,
  refreshFriendsData,
  renderCollabPill,
} from "./friendsPresence";

interface AppState {
  currentFolderId: string;
  folders: Record<string, { isSharedView?: boolean }>;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

function doInit(): void {
  const appState = getAppState();
  // Guarded (not a plain call) since this can fire before wireSrsConnectionsCore()
  // (srsConnectionsCore.ts) has necessarily run yet — harmless if it hasn't: the buttons' 'active'
  // class only affects an initial cosmetic highlight, self-corrects the first time the user
  // actually clicks a draw-layer button.
  window.__updateDrawLayerBtns?.();
  window.__applyCursorMode!();
  // Waits for any saved workspace before the first render, so a returning user's real content
  // shows immediately instead of flashing the built-in starter folders first.
  // window.__loadWorkspace() no-ops instantly if there's no signed-in user or nothing saved yet.
  (async () => {
    const restoredView = await window.__loadWorkspace!();
    window.__render!();
    if (!restoredView) window.__centerOnContent!();
    else window.__applyTransform?.();
    // Same reasoning as the fix inside refreshCanvasCollabForCurrentFolder itself — the very first
    // render() above ran before this had any real data, so a landing folder with an actual
    // collaborator could otherwise start out wrongly deciding "no live channel needed" straight
    // from a fresh page load, not just after a later in-app navigation.
    refreshCanvasCollabForCurrentFolder();
    // A reload that resumed straight back into a shared canvas (see loadWorkspace's own resume
    // logic) reads the same as freshly entering it from the user's point of view — the one-time
    // "Collaborating on..." notification should still fire, not just for the in-session entry
    // points (openSharedCanvas/goToWaypointCard).
    if (
      appState.folders[appState.currentFolderId] &&
      appState.folders[appState.currentFolderId].isSharedView
    ) {
      window.__announceEnteredCollaboration!(appState.currentFolderId);
    }
  })();
  refreshFriendsData().then(() => renderCollabPill());
  window.__refreshDotbotUsage?.();
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (app/dotto-app.jsx), LAST among every other wireX()
// call there — polls for both window.__getAppState AND window.__applyCursorMode
// (app/dotto/lib/sourceButtonsCursorMode.ts) since doInit calls the latter unconditionally, same
// multi-bridge-poll shape app/dotto/lib/profileAchievementsPricing.ts's own
// wireProfileAchievementsPricing established.
export function wireAppInit(): () => void {
  if (window.__getAppState && window.__applyCursorMode) {
    doInit();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState && window.__applyCursorMode) {
      clearInterval(poll);
      doInit();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}
