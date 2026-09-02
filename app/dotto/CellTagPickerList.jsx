"use client";

import { useEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cellTagPickerListStore } from "./bridges";
import {
  commitTagRename,
  handleTagRenameKeydown,
  openTagContextMenu,
  toggleCellTag,
} from "./lib/sourceTagsAi";
import usePortalNode from "./usePortalNode";

const EMPTY_STATE = { rows: [], id: null, r: null };

function TagRow({ row, id, r }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (row.renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [row.renaming]);

  if (row.renaming) {
    return (
      <div
        className={"cell-tag-picker-row" + (row.selected ? " selected" : "")}
        data-tag-id={row.tagId}
      >
        <span className="tag-swatch" style={{ background: row.color }} />
        <input
          ref={inputRef}
          type="text"
          className="tag-picker-rename-input"
          defaultValue={row.name}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => handleTagRenameKeydown(e, row.tagId)}
          onBlur={(e) => commitTagRename(row.tagId, e.target.value)}
        />
      </div>
    );
  }

  return (
    <div
      className={"cell-tag-picker-row" + (row.selected ? " selected" : "")}
      data-tag-id={row.tagId}
      onClick={() => toggleCellTag(id, r, row.tagId)}
      onContextMenu={(e) => openTagContextMenu(e, row.tagId)}
    >
      <span className="tag-swatch" style={{ background: row.color }} />
      <span className="tag-picker-name">{row.name}</span>
      <span className="tag-picker-check">✓</span>
    </div>
  );
}

// Portals into #cell-tag-picker-list (content/fragments/cell-tag-picker.html) — a plain flex-item
// container, safe to portal into directly, same as the other list panels. The popover's own show/
// hide/position, the new-tag row, and the tag-context-menu are all plain sibling static markup
// this component never touches.
export default function CellTagPickerList() {
  const state = useSyncExternalStore(
    cellTagPickerListStore.subscribe,
    cellTagPickerListStore.getSnapshot,
    () => EMPTY_STATE,
  );
  const portalNode = usePortalNode("cell-tag-picker-list");

  if (!portalNode) return null;

  return createPortal(
    state.rows.map((row) => <TagRow key={row.tagId} row={row} id={state.id} r={state.r} />),
    portalNode,
  );
}
