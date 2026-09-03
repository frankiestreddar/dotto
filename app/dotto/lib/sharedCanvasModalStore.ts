import { create } from "zustand";
import type { Item } from "./messagingCanvasPreview";

// Shared Card preview modal's body (app/dotto/lib/messagingCanvasPreview.ts's
// openSharedCanvasView) — { items } | null. Genuine JSX list, each item's own card content
// ref-mounted the same way as MsgConvo's canvas-snapshot messages (renderMsgSnapshotCard) — see
// SharedCanvasModalBody.jsx. The modal shell's own open/close class toggle and title text stay
// vanilla (plain attribute writes on the shell, not on anything React portals into). Migrated
// from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand
// migration plan, batch 6) — not flushSync'd, no caller reads the DOM synchronously right after.
export interface SharedCanvasModalState {
  items: Item[];
}

export const useSharedCanvasModalStore = create<SharedCanvasModalState | null>(() => null);
