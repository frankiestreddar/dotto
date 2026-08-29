"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { blocksViewStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Folder row — Essentials/Purchased/My Creations/user-created folders, all always shown at once
// (no drill-down navigation the way Library's old folder-picker/items views worked — see
// blocksViewStore's own comment, bridges.js). data-folder-id is how blocks-panel.js's drag-into-
// folder hit-testing (folderRowElAtPoint) finds a valid drop target under the pointer; only
// present at all for genuinely deletable (i.e. real user-created) folders since those are the only
// valid drop targets anyway (Purchased/Essentials/My Creations never accept a drop, matching the
// explicit request this feature was built against).
//
// Collapse (explicit request) — only offered when the folder actually has something to hide
// (row.count > 0, an empty folder has nothing to collapse). The toggle button sits in the exact
// same spot as folder.png and only shows on row hover, swapping places with the icon via CSS
// (.has-children:hover) rather than being a permanently-visible extra control.
function BlockFolderRow({ row }) {
  const hasChildren = row.count > 0;
  return (
    <div
      className={"blocks-folder-row" + (hasChildren ? " has-children" : "")}
      data-folder-id={row.deletable ? row.key : undefined}
    >
      <img className="blocks-folder-icon" src="/assets/icons/folder.png" alt="" />
      {hasChildren && (
        <button
          type="button"
          className={"blocks-folder-toggle" + (row.collapsed ? " collapsed" : "")}
          onClick={(e) => {
            e.stopPropagation();
            window.__toggleBlocksFolderCollapse(row.key);
          }}
          title={row.collapsed ? "Expand" : "Collapse"}
        >
          <img src="/assets/icons/chevron.png" alt="" />
        </button>
      )}
      <span className="blocks-folder-label">{row.label}</span>
      <span className="blocks-folder-count">{row.count}</span>
      {row.deletable && <RowActions onDelete={() => window.__deleteBlocksFolder(row.key)} />}
    </div>
  );
}

// Essentials item — a block type (or the Canvas/Source entries folded in ahead of them, explicit
// request) you can add to the canvas. Plain click, no hover actions, not draggable — these are
// spawner types, not owned objects, unlike a content-item row below.
function BlockEssentialsRow({ row }) {
  return (
    <div
      className="blocks-item"
      style={{ "--blocks-indent": "16px" }}
      onClick={() => window.__handleBlockItemClick(row.kind, row.statKind)}
    >
      <img className="blocks-item-icon" src={row.icon} alt="" onError={(e) => e.target.remove()} />
      <span className="blocks-item-label">{row.label}</span>
    </div>
  );
}

// Purchased/My-Creations/custom-folder item — a packaged template. No plain onClick: the drag
// handler attached below (window.__setupContentItemDrag, blocks-panel.js) already opens the item
// detail view itself on a release that never crossed the drag threshold, same as the old
// LibraryItemRow's draft rows did — generalized here to every content-item row, not just drafts,
// since drag-into-folder (explicit request) now needs to work for all of them.
function BlockContentRow({ row }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!row.draggable || !ref.current) return;
    // window.__setupContentItemDrag returns a cleanup (removes the listener it just added) — row
    // is a fresh object every computeBlocksRows call (blocks-panel.js), so this effect re-runs on
    // every re-render; without the cleanup, listeners would just keep stacking up on this node.
    return window.__setupContentItemDrag(ref.current, row);
  }, [row]);

  return (
    <div
      ref={ref}
      className="blocks-item blocks-content-item"
      style={{ "--blocks-indent": "16px", cursor: row.draggable ? "grab" : "pointer" }}
    >
      <div className="blocks-item-meta">
        <div className="blocks-item-title">{row.item.title}</div>
        <div className="blocks-item-count">{row.item.count || 0} cards packaged</div>
      </div>
      {row.deletable && <RowActions onDelete={() => window.__deleteBlockContentItem(row)} />}
    </div>
  );
}

function BlockNewFolderRow() {
  return (
    <div className="blocks-new-folder-row" onClick={() => window.__createBlocksFolder()}>
      <span>+</span>
      <span>New folder</span>
    </div>
  );
}

function BlockRow({ row }) {
  if (row.rowKind === "folder") return <BlockFolderRow row={row} />;
  if (row.rowKind === "block-item") return <BlockEssentialsRow row={row} />;
  if (row.rowKind === "content-item") return <BlockContentRow row={row} />;
  return <BlockNewFolderRow />;
}

// Portals into #blocks-list-container (content/fragments/hamburger-stack.html, #add-menu — the
// Blocks panel's real id under the hood, was Essentials/the Add menu before this overhaul). See
// blocksViewStore's own comment (bridges.js) for the row shape/where it's computed.
export default function BlocksPanel() {
  const rows = useSyncExternalStore(
    blocksViewStore.subscribe,
    blocksViewStore.getSnapshot,
    blocksViewStore.getSnapshot,
  );
  const portalNode = usePortalNode("blocks-list-container");

  if (!portalNode) return null;

  return createPortal(
    rows.map((row) => (
      <BlockRow
        key={
          row.rowKind === "folder"
            ? "folder:" + row.key
            : row.rowKind === "content-item"
              ? "item:" + row.folderKey + ":" + row.item.id
              : row.rowKind === "block-item"
                ? "block:" + row.kind + ":" + (row.statKind || "")
                : "new-folder"
        }
        row={row}
      />
    )),
    portalNode,
  );
}
