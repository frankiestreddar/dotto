import { createPaneKeyedStore } from "./paneKeyedStore";

// Canvas items layer (see PHASE2_ROADMAP.md's canvas-items-react plan) — the current folder's
// item array, set by render() (app/dotto/lib/waypointsRenderLoop.ts) via
// window.__renderCanvasItems(items, paneId) every time it would previously have wiped and rebuilt
// #world's item divs by hand. React now owns each pane's own #items-layer child of #world (see
// app/dotto/CanvasItemsLayer.jsx) and keys off item.id, so unchanged items are left alone instead
// of being torn down and recreated on every canvas interaction. Pane-keyed since split-screen
// Stage 4 — each pane shows its own folder's items independently.
//
// Migrated from bridges.js's hand-rolled createPaneKeyedStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 10 — the highest-risk store in this whole
// migration alongside paneLayoutStore, done last). Hot path: re-rendered on every canvas
// interaction (drag, resize, checklist toggle, remote realtime update, ...), so this one MUST stay
// flushSync'd (see window.__renderCanvasItems, app/dotto-app.jsx) — at least one caller
// (canvasItemBehavior.js's alt-duplicate-drag) does `render(); findItemEl(id)` immediately
// afterward and depends on that node already existing.
//
// Array-shaped, like chatThreadStore/chatsListStore/achievementsStore/marketDiscoverStore/
// blocksViewStore — every producer call passes `true` as setState's second (replace) argument to
// avoid Zustand's default Object.assign shallow-merge silently turning the array into a plain
// {0:...,1:...} object (see chatThreadStore.ts's own comment for the full mechanics) — especially
// critical here given how hot this path is.
export const useCanvasItemsStore = createPaneKeyedStore<Record<string, unknown>[]>(() => []);
