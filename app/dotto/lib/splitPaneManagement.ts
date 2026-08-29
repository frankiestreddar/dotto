// Phase 4.4 port of public/dotto/split-pane-management.js (itself a Phase 4.3 split of
// shared-canvases-outline.js — see PHASE4_ROADMAP.md). Genuinely leaf-portable: nothing vanilla
// ever imported this file directly (only via window.__splitPaneWithTab/__closePane, already
// React-callable bridges — TabsBar.jsx's drag-to-split gesture and PaneTopBar.jsx's close button),
// so porting it needed zero caller updates anywhere else, just the bridge's own source flipping
// from vanilla to TS. Every one of its own dependencies (appState, initializeNewPane,
// switchActivePane, renderTabsPanel, applyFolderView, render, plus the pane-layout-tree helpers in
// bridges.js) was already reachable through an existing window bridge except applyFolderView,
// which got a new one (window.__applyFolderView, waypoints-render-loop.js) as part of this port —
// same "add the missing bridge, don't restructure the vanilla side" approach every prior port used.

interface Tab {
  id: string;
  folderId: string;
}

interface AppState {
  activePaneId: number;
  tabs: Tab[];
  activeTabId: string;
  nextPaneId: number;
  panes: Record<number, unknown>;
}

// Split-screen Stage 5 — TabsBar.jsx's own drag-tab-to-edge-to-split gesture (2D pointer drag,
// escapes the breadcrumb pill once far enough, reveals a drop-zone for whichever pane's edge the
// cursor is near) calls this once a tab is dropped inside an active zone. targetPaneId is
// whichever EXISTING pane's box the cursor was over (Stage 6 — TabsBar.jsx hit-tests every current
// pane's own screen rect, not just the two viewport halves Stage 5 shipped with), so this can
// either bisect the tab's own pane (the common case) or quarter a DIFFERENT already-open pane
// while dragging a tab out of the active one's bar. edge is one of 'left'|'right'|'top'|'bottom'
// against THAT pane's own box, not the viewport's.
// splitLeafInTree/window.__splitPaneInLayout (bridges.js) do the actual tree surgery — this
// function's own job is just the tab-bookkeeping side, same shape as closeTab's own "always keep
// at least one tab" guard/next-active-tab logic (a pane can't be left with zero tabs). The new
// pane deliberately does NOT inherit its target's camera/selection/history — initializeNewPane
// resets those to fresh defaults, matching the plan's own "puts that tab in that section" framing
// (not "clones the source view"). The 4-pane cap (window.__countPanes) is enforced here rather
// than in TabsBar.jsx alone — TabsBar.jsx also skips edge-detection once the cap is hit (so the
// drop-zone never even shows), but this is the actual authority, in case anything else ever calls
// this bridge directly. sourcePaneId (split-screen Stage 7 — each pane has its own tab row now, so
// a drag can start from ANY pane's own bar, not just whichever happened to be active) activates
// that pane first, same convention as addTab/switchTab/closeTab/reorderTab in app/dotto/lib/tabManagement.ts.
export function splitPaneWithTab(
  tabId: string,
  targetPaneId: number,
  edge: "left" | "right" | "top" | "bottom",
  sourcePaneId?: number,
): void {
  const appState = window.__getAppState?.() as unknown as AppState | undefined;
  if (!appState) return;
  const source = sourcePaneId ?? appState.activePaneId;
  if (source !== appState.activePaneId) window.__switchActivePane?.(source);
  if (appState.tabs.length < 2) return;
  if ((window.__countPanes?.() ?? 0) >= 4) return;
  const fromIndex = appState.tabs.findIndex((t) => t.id === tabId);
  if (fromIndex === -1) return;
  const [tab] = appState.tabs.splice(fromIndex, 1);
  if (appState.activeTabId === tabId) {
    const next = appState.tabs[Math.max(0, fromIndex - 1)];
    appState.activeTabId = next.id;
    window.__applyFolderView?.(next.folderId);
  } else {
    window.__renderTabsPanel?.();
  }

  const newPaneId = appState.nextPaneId++;
  window.__splitPaneInLayout?.(targetPaneId, newPaneId, edge);
  window.__switchActivePane?.(newPaneId);
  window.__initializeNewPane?.(newPaneId, tab.folderId);
  window.__render?.();
}

// Closes a pane and re-merges its space into whichever OTHER pane/pair it was split from — the
// user's own explicit choice for Stage 6's "what happens when a quartered pane closes" product
// question ("re-merge into its sibling", not "leave a gap"). closeLeafInTree/
// window.__closePaneInLayout (bridges.js) computes the resulting tree; this function's own job is
// the appState side: reassigning activePaneId first if the closed pane WAS active (so
// switchActivePane still has a live pane to swap OUT of before that pane's own saved slot gets
// dropped), then dropping its now-orphaned appState.panes slot and its items/tabs/breadcrumb
// stores. Mirrors closeTab's own "always keep at least one" guard — a pane can't close itself into
// oblivion.
export function closePane(paneId: number): void {
  const appState = window.__getAppState?.() as unknown as AppState | undefined;
  if (!appState) return;
  if ((window.__countPanes?.() ?? 0) <= 1) return;
  if (appState.activePaneId === paneId) {
    const survivor = window.__listPaneIds?.()?.find((id) => id !== paneId);
    if (survivor !== undefined) window.__switchActivePane?.(survivor);
  }
  window.__closePaneInLayout?.(paneId);
  delete appState.panes[paneId];
  window.__removePaneItemsStore?.(paneId);
  window.__removePaneTabsStore?.(paneId);
}

window.__splitPaneWithTab = splitPaneWithTab;
window.__closePane = closePane;
