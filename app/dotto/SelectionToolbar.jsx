"use client";

import { useSyncExternalStore } from "react";
import { selectionToolbarStore } from "./bridges";

// Module-level, not inline in the hook call below — useSyncExternalStore's getServerSnapshot is
// expected to return a referentially stable value across calls (it's used to detect real changes
// during hydration); a fresh `() => ({...})` object literal every render looks like the snapshot
// changing on every check, which is exactly what triggers React's "getServerSnapshot should be
// cached to avoid an infinite loop" warning.
const CLOSED_STATE = { isOpen: false, left: 0, top: 0 };

export default function SelectionToolbar() {
  const state = useSyncExternalStore(
    selectionToolbarStore.subscribe,
    selectionToolbarStore.getSnapshot,
    () => CLOSED_STATE,
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
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={() => window.openAddToSourcePopup()}
      >
        Add to...
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={() => window.selectionToolbarLookUp()}
      >
        Look up
      </button>
    </div>
  );
}
