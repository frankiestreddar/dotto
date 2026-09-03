// ---------- Extensions panel (was Library — repurposed per explicit request; "browse your own
// library content" moved to the Blocks panel instead, see BlocksPanel.jsx/blocks-panel.js). Just a
// flat list of installed marketplace extensions, rendered as rectangular pills
// (ExtensionsPanel.jsx) — dummy data for now (see app/dotto/lib/extensionsListStore.ts, seeded
// with two placeholder entries), so there's nothing to actually refresh from Supabase yet. This function
// still exists as the onOpen callback wireRailIcon needs, same convention as every other rail
// panel, ready for real data later. ----------

function refreshExtensionsPanel(): void {
  // Nothing to do yet — extensionsListStore already holds its (static, dummy) data.
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  const appState = window.__getAppState!() as unknown as {
    libraryBtn: HTMLElement;
    libraryPanel: HTMLElement;
  };
  window.__wireRailIcon!(
    "library",
    appState.libraryBtn,
    appState.libraryPanel,
    refreshExtensionsPanel,
  );
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs to poll for both
// window.__getAppState AND window.__wireRailIcon (app/dotto/lib/panelsHamburger.ts) ready before
// wiring, same multi-bridge poll shape app/dotto/lib/profileAchievementsPricing.ts's own
// wireProfileAchievementsPricing established.
export function wireExtensionsPanel(): () => void {
  if (window.__getAppState && window.__wireRailIcon) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState && window.__wireRailIcon) {
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
