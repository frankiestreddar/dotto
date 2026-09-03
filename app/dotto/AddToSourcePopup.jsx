"use client";

import { useSyncExternalStore } from "react";
import { addToSourcePopupStore } from "./bridges";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const CLOSED_STATE = { isOpen: false, left: 0, top: 0 };

// The popup element itself — not nested inside any static markup fragment (the original vanilla
// code appended it straight onto document.body), so this renders independently, same as
// PricingOverlay/SelectionToolbar, rather than portaling into a fixed slot. No JSX children and no
// mount effect: renderAddToSourcePopup (app/dotto/lib/searchOrchestrationSelection.ts) builds the
// actual content directly against this div's id once it exists — see addToSourcePopupStore's own
// comment in bridges.js for why that's guaranteed by the time it runs.
export default function AddToSourcePopup() {
  const state = useSyncExternalStore(
    addToSourcePopupStore.subscribe,
    addToSourcePopupStore.getSnapshot,
    () => CLOSED_STATE,
  );

  if (!state.isOpen) return null;

  return (
    <div
      id="add-to-source-popup"
      className="add-to-source-popup"
      style={{ display: "flex", left: state.left + "px", top: state.top + "px" }}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
