import { createPaneKeyedStore } from "./paneKeyedStore";

// Media-viewer full-screen zoom, one per pane (mirrors navHistoryStore/collabPillStore's own
// per-pane reasoning) — { show, zoom }. show is true only while that pane's own CURRENT folder is
// a synthetic isMediaViewer one (window.__openMediaViewerTab, app/dotto/lib/tabManagement.ts);
// zoom is a plain multiplier (1 = 100%, i.e. the document at exactly the window's own width).
// Pushed by renderMediaViewerZoom(paneId)/setMediaViewerZoom (app/dotto/lib/waypointsRenderLoop.ts).
// zoom itself actually lives on the synthetic folder object (folderObj.viewerZoom), not here —
// this store is just the React-facing mirror of it, same "vanilla owns the real data, this is the
// push target" split every other pane-keyed store follows. Migrated from bridges.js's hand-rolled
// createPaneKeyedStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 9)
// — not flushSync'd.
export interface MediaViewerZoomState {
  show: boolean;
  zoom: number;
}

export const useMediaViewerZoomStore = createPaneKeyedStore<MediaViewerZoomState>(() => ({
  show: false,
  zoom: 1,
}));
