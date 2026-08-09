"use client";

import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { libraryViewStore } from "./bridges";

const EMPTY_STATE = { view: "folders", fixed: [], custom: [] };

function LibraryFolderList({ fixed, custom }) {
  return (
    <>
      {fixed.map((f) => (
        <div key={f.key} className="lib-folder-row" onClick={() => window.__switchLibraryFolder(f.key)}>
          <span>{f.label}</span>
          <span className="lib-folder-count">{f.count} item{f.count === 1 ? "" : "s"}</span>
        </div>
      ))}
      <div className="library-divider" />
      {custom.map((f) => (
        <div key={f.id} className="lib-folder-row" onClick={() => window.__switchLibraryFolder(f.id)}>
          <span>{f.name}</span>
          <span className="lib-folder-count">{f.count} item{f.count === 1 ? "" : "s"}</span>
        </div>
      ))}
      <div className="lib-new-folder-row" onClick={() => window.__createCustomFolder()}>
        <span>+</span>
        <span>New folder</span>
      </div>
    </>
  );
}

function LibraryItemsEmpty({ folderKey, isCustom }) {
  return (
    <div className="text-xs text-neutral-500 text-center py-12 font-mono">
      No templates inside folder.
      <br />
      <br />
      {folderKey === "drafts" && "Drag elements over marketplace when active to build a blueprint draft!"}
      {isCustom && 'Use the "+ Folder…" picker on any item in Purchased, Drafts, or Published to add it here.'}
    </div>
  );
}

// A draft's row is draggable-out-to-canvas (mirrors the inline-canvas drag-out); every other
// status just opens the item detail view. A custom folder can contain a draft too — status, not
// isCustom, is what decides drag vs. click, same as the vanilla version.
function LibraryItemRow({ entry, folderKey, isCustom, customFolders }) {
  const { item, status } = entry;
  const isDraft = status === "drafts";
  const ref = useRef(null);

  useEffect(() => {
    if (!isDraft || !ref.current) return;
    window.__makeDraftItemDraggable(ref.current, item);
  }, [isDraft, item]);

  const showAddToFolder = !isCustom && customFolders.length > 0;
  const showRemove = isCustom;

  return (
    <div
      ref={ref}
      className="lib-item-card"
      style={isDraft ? { cursor: "grab" } : undefined}
      onClick={isDraft ? undefined : () => window.__openItemDetail(item, status)}
    >
      <div className="lib-item-meta">
        <div className="lib-item-title">{item.title}</div>
        <div className="lib-item-count">{item.count || 0} cards packaged</div>
      </div>
      {showAddToFolder && (
        <select
          className="lib-add-to-folder-select"
          defaultValue=""
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const value = e.target.value;
            if (value) window.__addItemToCustomFolderById(value, folderKey, item.id);
            e.target.value = "";
          }}
        >
          <option value="">+ Folder…</option>
          {customFolders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      )}
      {showRemove && (
        <button
          className="lib-remove-btn"
          title="Remove from folder"
          onClick={(e) => { e.stopPropagation(); window.__removeFromCustomFolder(folderKey, item.id); }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function LibrarySearchResultRow({ r }) {
  return (
    <div
      className="lib-item-card"
      style={{ cursor: "pointer" }}
      onClick={() => window.__openLibrarySearchResult(r.folderKey, r.item, r.status)}
    >
      <div className="lib-item-meta">
        <div className="lib-item-title">{r.item.title}</div>
        <div className="lib-item-count">{r.item.count || 0} cards packaged</div>
        <div className="lib-search-result-folder">in {r.folderLabel}</div>
      </div>
    </div>
  );
}

// Portals into #library-list-container (content/fragments/cart-panel.html) — a plain flex-item
// container, safe to portal into directly, same as #market-list-container and friends.
export default function LibraryPanel() {
  const state = useSyncExternalStore(libraryViewStore.subscribe, libraryViewStore.getSnapshot, () => EMPTY_STATE);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("library-list-container"));
  }, []);

  if (!portalNode) return null;

  if (state.view === "search") {
    if (!state.results.length) {
      return createPortal(<div className="text-xs text-neutral-500 text-center py-12 font-mono">No matches in your library.</div>, portalNode);
    }
    return createPortal(
      state.results.map((r) => <LibrarySearchResultRow key={r.folderKey + ":" + r.item.id} r={r} />),
      portalNode,
    );
  }

  if (state.view === "items") {
    if (!state.items.length) {
      return createPortal(<LibraryItemsEmpty folderKey={state.folderKey} isCustom={state.isCustom} />, portalNode);
    }
    return createPortal(
      state.items.map((entry) => (
        <LibraryItemRow
          key={entry.item.id}
          entry={entry}
          folderKey={state.folderKey}
          isCustom={state.isCustom}
          customFolders={state.customFolders}
        />
      )),
      portalNode,
    );
  }

  return createPortal(<LibraryFolderList fixed={state.fixed} custom={state.custom} />, portalNode);
}
