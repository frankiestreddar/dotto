"use client";

import { useSelectionToolbarStore } from "./lib/selectionToolbarStore";
import { openAddToSourcePopup, selectionToolbarLookUp } from "./lib/searchOrchestrationSelection";

export default function SelectionToolbar() {
  // Zustand's own getInitialState() (what useStore's SSR snapshot reads) already matches the
  // store's real initial value ({isOpen: false, left: 0, top: 0}) — no separate module-level
  // fallback constant needed the way the old useSyncExternalStore call required.
  const state = useSelectionToolbarStore();

  if (!state.isOpen) return null;

  return (
    <div
      id="selection-toolbar"
      className="selection-toolbar"
      style={{ display: "flex", left: state.left, top: state.top }}
      // mousedown (not click) is what the browser uses to collapse the current selection —
      // preventing it here is what lets a toolbar button act on the selection that's still
      // highlighted the moment it's clicked, instead of it having already vanished.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={() => openAddToSourcePopup()}
      >
        Add to...
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={() => selectionToolbarLookUp()}
      >
        Look up
      </button>
    </div>
  );
}
