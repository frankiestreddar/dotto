"use client";

// Hover-revealed action-button overlay shared by every sidebar list row (Outline/Waypoints/Chats/
// Sources/Collaborations so far, now also BlocksPanel.jsx — see .outline-item-actions' own
// comment, globals.css, for the CSS half of this: position:relative on the row, this wrapper
// absolutely overlaid on its right edge, display:none until the row is hovered). Share (share.png)
// was the first button per explicit request; Delete and Open (open.png) were both added later as
// siblings inside this same wrapper (this component's own original comment anticipated exactly
// this) — Delete for the Blocks panel's deletable folders/items, Open for the Files panel's "open
// this file in a new tab" row action — wired here rather than duplicated per-caller since every row
// across every panel shares the exact same hover-reveal chrome.
//
// Share still has no onClick wired — share behavior isn't built. Delete/Open only render when the
// caller passes onDelete/onOpen (undefined for every other existing caller, so both are purely
// additive, zero-behavior-change props for them). Open renders FIRST (to the left of Share, in DOM/
// flex order — .outline-item-actions' own right:6px anchors the whole group to the row's right
// edge, but children still flow left-to-right within it) per explicit request. Every button
// stopPropagation()s so it doesn't also trigger whatever click handler the row underneath has (open
// a waypoint, switch a chat, open item detail, etc).
//
// The rows still built as raw HTML strings rather than real JSX (search history,
// app/dotto/lib/searchPanelHistory.ts) can't use this component directly — rowActionsHTML()
// (app/dotto/lib/outlineTree.ts, a real import there now) is their equivalent, kept as a
// literal copy of this same markup (share button only — none of those vanilla rows are deletable or
// openable yet, so rowActionsHTML() didn't need the same onDelete/onOpen extension). Keep both in
// sync if this ever changes.
export default function RowActions({
  onOpen,
  onDelete,
}: { onOpen?: () => void; onDelete?: () => void } = {}) {
  return (
    <div className="outline-item-actions">
      {onOpen && (
        <button
          type="button"
          className="outline-item-open-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Open"
        >
          <img src="/assets/icons/open.png" alt="" />
        </button>
      )}
      <button
        type="button"
        className="outline-item-share-btn"
        onClick={(e) => e.stopPropagation()}
        title="Share"
      >
        <img src="/assets/icons/share.png" alt="" />
      </button>
      {onDelete && (
        <button
          type="button"
          className="outline-item-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          ✕
        </button>
      )}
    </div>
  );
}
