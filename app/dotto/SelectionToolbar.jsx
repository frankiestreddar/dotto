"use client";

import { useSyncExternalStore } from "react";
import { selectionToolbarStore } from "./bridges";

export default function SelectionToolbar() {
  const state = useSyncExternalStore(
    selectionToolbarStore.subscribe,
    selectionToolbarStore.getSnapshot,
    () => ({ isOpen: false, left: 0, top: 0 })
  );

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
      <button type="button" className="selection-toolbar-btn" onClick={() => window.openAddToSourcePopup()}>
        Add to...
      </button>
      <button type="button" className="selection-toolbar-btn" onClick={() => window.selectionToolbarLookUp()}>
        Look up
      </button>
    </div>
  );
}
