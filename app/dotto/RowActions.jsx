"use client";

// Hover-revealed action-button overlay shared by every sidebar list row (Outline/Waypoints/Chats/
// Sources/Collaborations so far — see .outline-item-actions' own comment, globals.css, for the CSS
// half of this: position:relative on .outline-item, this wrapper absolutely overlaid on its right
// edge, display:none until .outline-item:hover). "For now" just a Share button (share.png) per
// explicit request — more buttons are expected to join it later as siblings inside this same
// wrapper, which is why this is its own small reusable component (used identically from every row
// across every panel) rather than inlined separately in each one.
//
// No onClick wired to the button itself yet — share behavior isn't built. stopPropagation alone is
// what keeps this placeholder from also triggering whatever click/select handler the row underneath
// it has (open a waypoint, switch a chat, navigate a source, etc).
//
// The vanilla-rendered rows (Outline tree/source-page outline, shared-canvases-outline.js; search
// history, search-panel-history.js — imports rowActionsHTML from there) can't use this component
// directly, since they build plain HTML strings — rowActionsHTML() is their equivalent, kept as a
// literal copy of this same markup. Keep both in sync if this ever changes.
export default function RowActions() {
  return (
    <div className="outline-item-actions">
      <button
        type="button"
        className="outline-item-share-btn"
        onClick={(e) => e.stopPropagation()}
        title="Share"
      >
        <img src="/assets/icons/share.png" alt="" />
      </button>
    </div>
  );
}
