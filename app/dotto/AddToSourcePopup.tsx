"use client";

import { useAddToSourcePopupStore } from "./lib/addToSourcePopupStore";

// The popup element itself — not nested inside any static markup fragment (the original vanilla
// code appended it straight onto document.body), so this renders independently, same as
// PricingOverlay/SelectionToolbar, rather than portaling into a fixed slot. No JSX children and no
// mount effect: renderAddToSourcePopup (app/dotto/lib/searchOrchestrationSelection.ts) builds the
// actual content directly against this div's id once it exists — see useAddToSourcePopupStore's
// own comment for why that's guaranteed by the time it runs.
export default function AddToSourcePopup() {
  const state = useAddToSourcePopupStore();

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
