// ---------- Blocks panel (was Essentials/the Add menu; also absorbed "browse your own library
// content" — Purchased/drafts+published/custom folders — from Library, now Plugins, when the two
// were repurposed per explicit request). One folder-tree list — folders, contents indented below
// each, all always shown at once (no drill-down navigation the way Library's old folder-picker/
// items views worked) — styled like the Outline panel. See app/dotto/BlocksPanel.jsx for the
// actual rendering; this file owns the row computation, search, folder CRUD, and drag-into-folder
// interaction.
//
// refreshMyLibrary (app/dotto/lib/marketplace.ts) and openItemDetail/deleteMyCreationItem
// (app/dotto/lib/libraryPublish.ts) are reached via bridges rather than real imports — both of
// those files' own headers already document the reverse edge (they reach
// createBlocksFolder/refreshBlocksPanel/etc. via window.__refreshBlocksPanel rather than a direct
// import specifically because a direct import back would be circular) — kept as a deliberate,
// pre-existing decision rather than newly co-locating and resolving it, since both other files are
// already-shipped and stable.

import { useBlocksViewStore } from "./blocksViewStore";

interface AddMenuItem {
  kind: string;
  statKind?: string;
  label: string;
  icon: string;
}
interface LibraryItem {
  id: string;
  title?: string;
  nodes?: Record<string, unknown>[];
  [key: string]: unknown;
}
interface CustomFolder {
  id: string;
  name: string;
  items: LibraryItem[];
}
interface BlockItemRow {
  rowKind: "block-item";
  kind: string;
  statKind?: string;
  label: string;
  icon: string;
}
interface ContentItemRow {
  rowKind: "content-item";
  item: LibraryItem;
  status: string;
  folderKey: string;
  deletable: boolean;
  draggable: boolean;
}
interface FolderRow {
  rowKind: "folder";
  key: string;
  label: string;
  deletable: boolean;
  count: number;
  collapsed: boolean;
}
interface NewFolderRow {
  rowKind: "new-folder";
}
export type BlocksRow = BlockItemRow | ContentItemRow | FolderRow | NewFolderRow;

interface AppState {
  ADD_MENU_DATA: Record<string, { label: string; categoryDesc: string; items: AddMenuItem[] }>;
  userLibrary: {
    purchased: LibraryItem[];
    drafts: LibraryItem[];
    published: LibraryItem[];
    customFolders: CustomFolder[];
  };
  addMenuSearchQuery: string;
  cardMode: string;
  idCounter: number;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// Canvas/Source fold into the Essentials folder as ordinary first-two items now (explicit
// request) — both were already thin wrappers around prepareAdd('folder')/prepareAdd('source')
// (see the old New Canvas/New Source pinned rows this replaces), so they slot into the exact same
// { kind, label, icon } shape every other ADD_MENU_DATA item already has, routed through the same
// handleBlockItemClick below.
function buildEssentialsItems(): AddMenuItem[] {
  const appState = getAppState();
  const items: AddMenuItem[] = [
    { kind: "folder", label: "Canvas", icon: "/assets/icons/canvas.png" },
    { kind: "source", label: "Source", icon: "/assets/icons/source.png" },
  ];
  Object.values(appState.ADD_MENU_DATA).forEach((tab) => {
    tab.items.forEach((item) => items.push(item));
  });
  return items;
}

// A library item may live in exactly one of these three real folders; custom folders (and My
// Creations, see below) just hold references to items that already belong to one of them — this
// is what lets a dragged-in item know which real appState.userLibrary array it actually came from.
function resolveItemStatus(item: LibraryItem): string {
  const appState = getAppState();
  if (appState.userLibrary.drafts.some((x) => x.id === item.id)) return "drafts";
  if (appState.userLibrary.published.some((x) => x.id === item.id)) return "published";
  return "purchased";
}

function isCustomFolderId(id: unknown): id is string {
  return typeof id === "string" && id.indexOf("customfolder_") === 0;
}

// Which folders are currently collapsed (explicit request) — a plain module-level Set, same
// "purely ephemeral, nothing else needs to read/write it" reasoning as add-block chord state
// (app/dotto/lib/srsConnectionsCore.ts): not persisted, not appState, resets on reload. Keyed by
// folder key ('essentials'/'purchased'/'my-creations'/a customfolder_ id).
const collapsedBlocksFolders = new Set<string>();

// Pushes one folder's header row + its (already-computed) item rows, collapsing the latter when
// the folder is collapsed — unless a live search query is active, in which case collapse is
// ignored entirely so a match hidden under a collapsed folder still surfaces (same "search
// overrides collapse" behavior the Outline panel's own headings get, see
// toggleOutlineCollapse's own comment, app/dotto/lib/outlineTree.ts). A folder only shows its
// collapse toggle at all when it actually has items (BlocksPanel.jsx checks row.count > 0) — an
// empty folder has nothing to hide.
function pushFolderSection(
  rows: BlocksRow[],
  key: string,
  label: string,
  deletable: boolean,
  itemRows: ContentItemRow[] | BlockItemRow[],
  q: string,
): void {
  if (q && !itemRows.length) return;
  const collapsed = !q && collapsedBlocksFolders.has(key);
  rows.push({ rowKind: "folder", key, label, deletable, count: itemRows.length, collapsed });
  if (!collapsed) itemRows.forEach((r) => rows.push(r));
}

export function toggleBlocksFolderCollapse(key: string): void {
  if (collapsedBlocksFolders.has(key)) collapsedBlocksFolders.delete(key);
  else collapsedBlocksFolders.add(key);
  pushBlocksView();
}

// Flattens Essentials/Purchased/My-Creations/custom folders into one row array — each row knows
// its own folder, matching computeOutlineRows' convention (a flat list with per-row indent info,
// not a tree walk in the renderer). Folders (and their items) whose label doesn't match a live
// search query are omitted entirely, same as the old Essentials grid / Library search both did.
export function computeBlocksRows(query: string): BlocksRow[] {
  const appState = getAppState();
  const q = (query || "").trim().toLowerCase();
  const rows: BlocksRow[] = [];

  const essentialsItems = buildEssentialsItems().filter(
    (it) => !q || it.label.toLowerCase().includes(q),
  );
  pushFolderSection(
    rows,
    "essentials",
    "Essentials",
    false,
    essentialsItems.map((it) => ({
      rowKind: "block-item",
      kind: it.kind,
      statKind: it.statKind,
      label: it.label,
      icon: it.icon,
    })),
    q,
  );

  const purchasedItems = appState.userLibrary.purchased.filter(
    (it) => !q || (it.title || "").toLowerCase().includes(q),
  );
  pushFolderSection(
    rows,
    "purchased",
    "Purchased",
    false,
    purchasedItems.map((item) => ({
      rowKind: "content-item",
      item,
      status: "purchased",
      folderKey: "purchased",
      deletable: false,
      draggable: true,
    })),
    q,
  );

  // My Creations = drafts + published combined (no separate Published folder, explicit request) —
  // resolveItemStatus per item is still what decides draft-vs-published-only behavior downstream
  // (e.g. whether Publish or Unpublish/Update shows in the detail view footer).
  const myCreationEntries = [
    ...appState.userLibrary.drafts.map((item) => ({ item, status: "drafts" })),
    ...appState.userLibrary.published.map((item) => ({ item, status: "published" })),
  ].filter(({ item }) => !q || (item.title || "").toLowerCase().includes(q));
  pushFolderSection(
    rows,
    "my-creations",
    "My Creations",
    false,
    myCreationEntries.map(({ item, status }) => ({
      rowKind: "content-item",
      item,
      status,
      folderKey: "my-creations",
      deletable: true,
      draggable: true,
    })),
    q,
  );

  appState.userLibrary.customFolders.forEach((folder) => {
    const items = folder.items.filter((it) => !q || (it.title || "").toLowerCase().includes(q));
    pushFolderSection(
      rows,
      folder.id,
      folder.name,
      true,
      items.map((item) => ({
        rowKind: "content-item",
        item,
        status: resolveItemStatus(item),
        folderKey: folder.id,
        deletable: true,
        draggable: true,
      })),
      q,
    );
  });

  if (!q) rows.push({ rowKind: "new-folder" });

  return rows;
}

function pushBlocksView(): void {
  const appState = getAppState();
  useBlocksViewStore.setState(computeBlocksRows(appState.addMenuSearchQuery), true);
}

// The onOpen callback for window.__wireRailIcon('add', ...) below — replaces resetAddMenuPanel
// (add-menu.js). Always reopens showing every row, never mid-search from a previous visit (same
// convention as every other rail view's onOpen). Refreshes userLibrary from Supabase every open,
// same as Library's own refreshLibraryPanel used to — but pushes the view BEFORE that network
// round-trip too, not just after: Essentials (static ADD_MENU_DATA, no network involved at all)
// used to render instantly the old grid never had to wait on anything, and gating the very first
// paint behind refreshMyLibrary's await would show a blank panel for however long that fetch
// takes. The second push (after refreshMyLibrary resolves) is what brings Purchased/My Creations
// up to date; Essentials/custom folders just re-render identically that second time.
export async function refreshBlocksPanel(): Promise<void> {
  const appState = getAppState();
  if (appState.cardMode === "pen") {
    appState.cardMode = "normal";
    window.__applyCursorMode!();
  }
  // Reset back to the row list, same as the old Library's own resetLibraryPanelView did — without
  // this, reopening Blocks after having clicked into an item's detail view (or a publish flow)
  // left the panel stuck showing that sub-view instead of the list, since
  // openItemDetail/startPublishFlow (library-publish.js) only ever toggle these classes ON, they
  // don't know when the panel gets closed and reopened later to toggle them back off themselves.
  document.getElementById("item-detail-view")!.classList.remove("active");
  document.getElementById("publish-flow-view")!.classList.remove("active");
  document.getElementById("view-library")!.classList.add("active");
  appState.addMenuSearchQuery = "";
  const input = document.getElementById("add-menu-search-input") as HTMLInputElement | null;
  if (input) input.value = "";
  pushBlocksView();
  await window.__refreshMyLibrary?.();
  pushBlocksView();
}

export function handleBlocksSearchInput(value: string): void {
  const appState = getAppState();
  appState.addMenuSearchQuery = value;
  pushBlocksView();
}

export function handleBlockItemClick(kind: string, statKind?: string): void {
  window.prepareAdd!(kind, statKind);
}

export function createBlocksFolder(): void {
  const appState = getAppState();
  const name = prompt("Name your new folder:", "New Folder");
  if (name === null) return;
  const trimmed = name.trim();
  appState.userLibrary.customFolders.push({
    id: "customfolder_" + appState.idCounter++,
    name: trimmed || "New Folder",
    items: [],
  });
  pushBlocksView();
}

// Only ever reachable for a real user-created folder — Purchased/Essentials/My Creations aren't
// customFolders entries at all, so isCustomFolderId guards them out even if somehow called
// directly (BlocksPanel.jsx's own row.deletable already keeps the delete button from rendering
// for those, this is the second line of defense).
export function deleteBlocksFolder(folderId: string): void {
  if (!isCustomFolderId(folderId)) return;
  const appState = getAppState();
  appState.userLibrary.customFolders = appState.userLibrary.customFolders.filter(
    (f) => f.id !== folderId,
  );
  pushBlocksView();
}

function addItemToCustomFolderById(
  folderId: string,
  sourceKey: "purchased" | "drafts" | "published",
  itemId: string | number,
): void {
  const appState = getAppState();
  const folder = appState.userLibrary.customFolders.find((f) => f.id === folderId);
  const source = appState.userLibrary[sourceKey];
  if (!folder || !source) return;
  const item = source.find((x) => String(x.id) === String(itemId));
  if (!item) return;
  if (folder.items.some((x) => String(x.id) === String(itemId))) {
    pushBlocksView();
    return;
  }
  folder.items.push(item);
  pushBlocksView();
}

function removeFromCustomFolder(folderId: string, itemId: string | number): void {
  const appState = getAppState();
  const folder = appState.userLibrary.customFolders.find((f) => f.id === folderId);
  if (!folder) return;
  folder.items = folder.items.filter((x) => String(x.id) !== String(itemId));
  pushBlocksView();
}

// Dispatches a content-item row's delete button — My Creations items get a real, destructive
// delete (__deleteMyCreationItem, app/dotto/lib/libraryPublish.ts — actually deletes the
// underlying draft/published marketplace listing); custom-folder items just lose their reference
// to that folder (removeFromCustomFolder, non-destructive — the item still exists in
// Purchased/My Creations). Purchased/Essentials rows never reach this at all (row.deletable is
// false, no button rendered).
export function deleteBlockContentItem(row: ContentItemRow): void {
  if (row.folderKey === "my-creations") {
    // Only ever "drafts" or "published" here — myCreationEntries (computeBlocksRows) is the only
    // producer of a folderKey: 'my-creations' row, and it only ever assigns one of those two.
    window.__deleteMyCreationItem?.(row.item, row.status as "drafts" | "published");
    return;
  }
  if (isCustomFolderId(row.folderKey)) removeFromCustomFolder(row.folderKey, row.item.id);
}

// ---------- Drag-into-folder (explicit request) ----------
// Every draggable content-item row (Purchased/My-Creations/custom-folder items — not Essentials
// rows, which are spawner types, not owned objects) gets this single pointerdown/move/up handler,
// doing double duty for a plain click (open item detail — same as every content row used to do)
// and a real drag (drop onto a custom-folder row to file it there, or — drafts only, preserving
// the exact old behavior — drop onto the canvas to import its packaged cards). One consolidated
// handler rather than two separate listeners on the same row: a second independent pointerdown
// listener would race the first (both call stopPropagation/track movement), which is what this
// avoids by construction. Modeled on canvasItemBehavior.js's checkDropTargets (rect-overlap
// hover-highlight, then act on drop) and the old makeDraftItemDraggable this supersedes — not
// native HTML5 DnD, nothing else in this codebase uses that.
function folderRowElAtPoint(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  const folderRow =
    el && (el as HTMLElement).closest<HTMLElement>(".blocks-folder-row[data-folder-id]");
  if (!folderRow) return null;
  return isCustomFolderId(folderRow.dataset.folderId) ? folderRow : null;
}
function updateFolderDropHighlight(x: number, y: number): void {
  const targetRow = folderRowElAtPoint(x, y);
  document
    .querySelectorAll<HTMLElement>(".blocks-folder-row.block-folder-drop-target")
    .forEach((el) => {
      if (el !== targetRow) el.classList.remove("block-folder-drop-target");
    });
  if (targetRow) targetRow.classList.add("block-folder-drop-target");
}
function clearFolderDropHighlight(): void {
  document
    .querySelectorAll<HTMLElement>(".blocks-folder-row.block-folder-drop-target")
    .forEach((el) => el.classList.remove("block-folder-drop-target"));
}

// Returns a cleanup function that removes this specific listener — required because
// BlocksPanel.jsx calls this again on every re-render (row is a fresh object each time
// computeBlocksRows runs, so its own useEffect's [row] dependency never stays referentially
// equal), and without an explicit cleanup those pointerdown listeners would just keep stacking up
// on the same DOM node forever, each stale closure still capturing its own now-outdated
// item/status.
export function setupContentItemDrag(div: HTMLElement, row: ContentItemRow): () => void {
  const { item, status } = row;
  div.style.cursor = "grab";
  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest?.(".outline-item-actions")) return; // let the hover delete/share buttons work normally
    e.stopPropagation();
    let dragStarted = false;
    let dragGhost: HTMLElement | null = null;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (me: PointerEvent) => {
      if (!dragStarted) {
        if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
        dragStarted = true;
        dragGhost = document.createElement("div");
        dragGhost.className = "inline-canvas-drag-ghost";
        dragGhost.textContent = item.title || "Untitled";
        document.body.appendChild(dragGhost);
      }
      dragGhost!.style.left = me.clientX + 14 + "px";
      dragGhost!.style.top = me.clientY + 14 + "px";
      updateFolderDropHighlight(me.clientX, me.clientY);
    };
    const up = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragGhost) dragGhost.remove();
      clearFolderDropHighlight();
      if (!dragStarted) {
        window.__openItemDetail?.(item, status);
        return;
      }

      const targetRow = folderRowElAtPoint(ue.clientX, ue.clientY);
      if (targetRow) {
        addItemToCustomFolderById(
          targetRow.dataset.folderId!,
          status as "purchased" | "drafts" | "published",
          item.id,
        );
        return;
      }
      // Draft-only, mirrors the old makeDraftItemDraggable exactly: drop onto the canvas to
      // import this draft's packaged cards. Purchased/published items don't get this — the detail
      // view's own Deploy button is how a purchased item reaches the canvas.
      if (status !== "drafts") return;
      const addMenu = window.__getAddMenuEl?.();
      if (!addMenu) return;
      const panelRect = addMenu.getBoundingClientRect();
      const overPanel =
        ue.clientX >= panelRect.left &&
        ue.clientX <= panelRect.right &&
        ue.clientY >= panelRect.top &&
        ue.clientY <= panelRect.bottom;
      if (overPanel) return;
      const canvasRect = window.__getCanvasEl?.()?.getBoundingClientRect();
      if (!canvasRect) return;
      const overCanvas =
        ue.clientX >= canvasRect.left &&
        ue.clientX <= canvasRect.right &&
        ue.clientY >= canvasRect.top &&
        ue.clientY <= canvasRect.bottom;
      if (overCanvas) {
        window.__importSharedCardsAtScreenPoint?.(item.nodes, ue.clientX, ue.clientY);
        window.__closeRailView?.();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  div.addEventListener("pointerdown", onPointerDown);
  return () => div.removeEventListener("pointerdown", onPointerDown);
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  const addMenu = window.__getAddMenuEl?.();
  const btnAdd = window.__getBtnAddEl?.();
  if (!addMenu || !btnAdd) return;
  window.__wireRailIcon!("add", btnAdd, addMenu, refreshBlocksPanel);
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs to poll for
// window.__getAppState, window.__wireRailIcon (app/dotto/lib/panelsHamburger.ts), AND
// window.__getAddMenuEl/__getBtnAddEl (app/dotto/lib/coreState.ts) ready before wiring, same
// multi-bridge poll shape app/dotto/lib/profileAchievementsPricing.ts's own
// wireProfileAchievementsPricing established.
export function wireBlocksPanel(): () => void {
  const ready = () =>
    !!(
      window.__getAppState &&
      window.__wireRailIcon &&
      window.__getAddMenuEl &&
      window.__getBtnAddEl
    );
  if (ready()) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (ready()) {
      clearInterval(poll);
      doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // Plain (non-`__`) global — real inline oninput target in content/fragments/hamburger-stack.html.
  window.handleBlocksSearchInput = handleBlocksSearchInput;
  // Vanilla -> React bridge — used by app/dotto/lib/marketplace.ts/libraryPublish.ts (still
  // reached via bridge rather than a real import — see this file's own header comment for why).
  // handleBlockItemClick/createBlocksFolder/deleteBlocksFolder/toggleBlocksFolderCollapse/
  // deleteBlockContentItem/setupContentItemDrag have no bridge — BlocksPanel.jsx (their only real
  // consumer) imports them directly instead, same app/dotto/ tree.
  window.__refreshBlocksPanel = refreshBlocksPanel;
}
