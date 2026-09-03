import { create } from "zustand";

// Which pane is currently active — a plain, non-pane-keyed store (there's only ever one answer,
// unlike everything else pane-keyed in this migration). Originally backed PaneZoomBar.jsx's own
// "only show for the pane you last clicked into" requirement, but that was later corrected to
// pure hover-only visibility (see PaneZoomBar.jsx's own comment) — this store currently has no
// real subscribing consumer, kept anyway since switchActivePane (app/dotto/lib/coreState.ts)
// still pushes to it and a future per-pane-active-state need may reach for it again. Migrated
// from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand
// migration plan, batch 9) — not flushSync'd.
export const useActivePaneIdStore = create<number>(() => 0);
