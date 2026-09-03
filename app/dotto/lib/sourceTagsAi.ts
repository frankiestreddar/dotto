// Phase 4.5 port of public/dotto/source-tags-ai.js: Dotbot-generated source content (add rows to
// an already-attached source, or create a brand new one) plus the Source page's row-tag system
// (tag definitions, per-row tag assignment, the row tag picker popover, and its rename/delete
// context menu). The last of the 8 vanilla files public/dotto/window-bridge.js used to import
// from — closing this port out empties window-bridge.js entirely (see its own deletion, this
// commit).

import { kindSize } from "./addMenu";
import { escapeHtml, stripHtml } from "./textUtils";
import { resolveTableForEdit } from "./drawingConnections";
import { useCellTagPickerListStore } from "./cellTagPickerListStore";

interface TableItem {
  id: number;
  tableData: string[][];
  tags?: { id: string; name: string; color: string }[];
  cellTags?: Record<number, string[]>;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  title?: string;
  items: { id: number; kind: string; folderId?: string; tableData?: string[][] }[];
}
interface SearchCardContextEntry {
  id: number;
  snapshot: { kind: string; folderId: string };
}
interface AppState {
  searchCardContext: SearchCardContextEntry[];
  folders: Record<string, FolderObj>;
  idCounter: number;
  AI_SOURCE_MAX_COLS: number;
  AI_SOURCE_MAX_ROWS: number;
  tx: number;
  ty: number;
  scale: number;
  currentFolderId: string;
  activeTagRow: { id: number; r: number } | null;
  renamingTagId: string | null;
  contextMenuTagId: string | null;
  cellTagPicker: HTMLElement;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Dotbot-generated source content (see the "sourceAction" panel in
// app/api/dotbot/orchestrate/route.js) ----------
// mirrors MAX_SOURCE_COLS server-side
// mirrors MAX_SOURCE_ROWS server-side

// Pads/truncates one generated row to exactly `width` cells, HTML-escaping each one — the model's
// cell text is plain content, but tableData cells are raw innerHTML (see renderStaticTableHTML),
// so anything with "<"/"&"/etc must be escaped before it's stored.
function aiRowToCells(row: unknown[], width: number): string[] {
  const cells = new Array(width).fill("");
  (row || []).slice(0, width).forEach((c, i) => {
    cells[i] = escapeHtml(String(c == null ? "" : c));
  });
  return cells;
}

// Adds AI-generated rows to an already-attached source (dragged into the search box), found via
// searchCardContext[targetIndex - 1] — targetIndex is 1-based and numbered exactly like the
// "Cards attached to this query" / "Sources attached to this query" blocks the server built the
// prompt from (see commenceDotbotSearch), so it points straight back at the same entry. Only ever
// targets a "source" card (never a bare "table"), since a source snapshot's folderId is a stable,
// global key into `folders` — reachable regardless of which canvas the user has since navigated
// to — while a bare table's id is only meaningful within whichever folder it lived in at drag
// time.
export function applyAiAddRowsToSource(
  targetIndex: number,
  columns: string[] | undefined,
  rows: unknown[][],
): boolean {
  const appState = getAppState();
  const ctx = appState.searchCardContext[(targetIndex || 1) - 1];
  if (!ctx || ctx.snapshot.kind !== "source") return false;
  const folderObj = appState.folders[ctx.snapshot.folderId];
  if (!folderObj) return false;
  window.__saveSnapshot!();
  let tableItem = folderObj.items.find((i) => i.kind === "table") as unknown as
    TableItem | undefined;
  if (!tableItem) {
    tableItem = {
      id: appState.idCounter++,
      x: 28,
      y: 28,
      w: 560,
      h: 360,
      kind: "table",
      tableData: [[""]],
    } as unknown as TableItem;
    folderObj.items.push(tableItem as unknown as FolderObj["items"][number]);
  }
  const isCellEmpty = (c: string) => !stripHtml(c || "").trim();
  const headerBlank = tableItem.tableData[0].every(isCellEmpty);
  let width = tableItem.tableData[0].length;
  // Only ever adopts the model's proposed column names into a still-placeholder header — an
  // existing named source keeps its own columns untouched (see the prompt).
  if (headerBlank && columns && columns.length) {
    width = Math.max(1, Math.min(appState.AI_SOURCE_MAX_COLS, columns.length));
    tableItem.tableData[0] = new Array(width)
      .fill("")
      .map((_, i) => escapeHtml(columns[i] || `Column ${i + 1}`));
    for (let ri = 1; ri < tableItem.tableData.length; ri++) {
      const row = tableItem.tableData[ri];
      tableItem.tableData[ri] = new Array(width).fill("").map((_, ci) => row[ci] || "");
    }
  }
  const newRows = (rows || [])
    .slice(0, appState.AI_SOURCE_MAX_ROWS)
    .map((r) => aiRowToCells(r, width));
  if (!newRows.length) return false;
  // Fills existing blank rows first, then appends the rest — same rule
  // importDelimitedIntoSource uses for CSV/TSV import, so AI-added rows behave the same way as a
  // file import would.
  let ni = 0;
  for (let ri = 1; ri < tableItem.tableData.length && ni < newRows.length; ri++) {
    if (tableItem.tableData[ri].every(isCellEmpty)) {
      tableItem.tableData[ri] = newRows[ni];
      ni++;
    }
  }
  if (ni < newRows.length) tableItem.tableData.push(...newRows.slice(ni));
  window.__render?.();
  window.__scheduleWorkspaceSave!();
  return true;
}

// Creates a brand new source card (via the normal add('source', ...) path, so it gets the same
// undo snapshot/points/placement handling as a manually-added one) seeded with AI-generated
// columns/rows instead of the usual blank 2x4 grid.
export function createSourceFromAI(
  title: string | undefined,
  columns: string[] | undefined,
  rows: unknown[][],
): boolean {
  const appState = getAppState();
  const { w, h } = kindSize("source");
  const cx = window.__canvasViewportCenterX!();
  const cy = window.innerHeight / 2;
  const x = Math.round((((cx - appState.tx) / appState.scale - w / 2) / 28) * 28);
  const y = Math.round((((cy - appState.ty) / appState.scale - h / 2) / 28) * 28);
  window.__add?.("source", x, y);
  const items = appState.folders[appState.currentFolderId].items;
  const created = items[items.length - 1];
  const folderObj = appState.folders[created.folderId!];
  const width = Math.max(
    1,
    Math.min(appState.AI_SOURCE_MAX_COLS, (columns && columns.length) || 2),
  );
  const header = new Array(width)
    .fill("")
    .map((_, i) => escapeHtml((columns && columns[i]) || `Column ${i + 1}`));
  const dataRows = (rows || [])
    .slice(0, appState.AI_SOURCE_MAX_ROWS)
    .map((r) => aiRowToCells(r, width));
  folderObj.title = (title || "New Source").trim().slice(0, 80) || "New Source";
  folderObj.items[0].tableData = [
    header,
    ...(dataRows.length ? dataRows : [new Array(width).fill("")]),
  ];
  window.__render?.();
  window.__scheduleWorkspaceSave!();
  return true;
}

export function triggerSourceUpload(): void {
  window.__closeSourceAddMenu!();
  closeCellTagPicker();
  const input = document.createElement("input");
  // Extensions alone are greyed out by some OS file pickers unless matching MIME types are also
  // listed (extension-only matching isn't reliably honoured everywhere) — so both are included
  // here for every accepted type.
  input.type = "file";
  input.accept =
    ".csv,.tsv,.txt,.apkg,.colpkg,text/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel,application/csv";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()!.toLowerCase();
    if (ext === "apkg" || ext === "colpkg") {
      alert(
        "Anki deck import (.apkg/.colpkg) isn't supported yet — only CSV/TSV files can be imported right now.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      window.__importDelimitedIntoSource!(String(reader.result), ext === "tsv" ? "\t" : ",");
    reader.readAsText(file);
  };
  input.click();
}

// ---------- Source page: tags ----------
// Tag definitions ({id, name, color}) live on the table item itself; which tags are on which row
// is a separate map keyed by row index -> [tagId, ...], kept entirely apart from the cell's own
// text/HTML content (tableData) so tag chips never pollute what extractCardsFromSource/search/etc.
// read out of a cell.
function ensureTableTags(table: TableItem) {
  if (!table.tags) table.tags = [];
  return table.tags;
}
function ensureCellTags(table: TableItem) {
  if (!table.cellTags) table.cellTags = {};
  return table.cellTags;
}

export function tagPillsHTML(table: TableItem, r: number): string {
  const ids = (table.cellTags && table.cellTags[r]) || [];
  if (!ids.length) return "";
  const tags = table.tags || [];
  return ids
    .map((tagId) => {
      const tag = tags.find((t) => t.id === tagId);
      if (!tag) return "";
      return `<span class="tag-chip" style="--chip-color:${tag.color}" title="${escapeHtml(tag.name)}"><span class="tag-chip-name">${escapeHtml(tag.name)}</span></span>`;
    })
    .join("");
}
// Tags belong to the row, but the chips themselves are only ever rendered in the first column's
// cell (renderStaticTableHTML only emits a .cell-tags div there). Matched by [data-origin-table] +
// [data-r] together (not just "#item-${id}" + data-r) so this always picks out the one real row
// unambiguously. Falls back to a full render() if nothing matched — the DOM may simply not exist
// yet.
function refreshCellTagsDom(id: number, r: number): void {
  const it = resolveTableForEdit(id) as unknown as TableItem | undefined;
  if (!it) return;
  const cells = document.querySelectorAll(
    `.item-table td[data-origin-table="${id}"][data-r="${r}"][data-c="0"] .cell-tags`,
  );
  if (!cells.length) {
    window.__render?.();
    return;
  }
  cells.forEach((el) => {
    el.innerHTML = tagPillsHTML(it, r);
  });
}
// Delete/rename affect potentially every row's chips (not just the one being edited in the
// picker), so refresh column 0 across the whole table in one pass.
function refreshAllRowTagsDom(it: TableItem): void {
  it.tableData.slice(1).forEach((_row, dataIdx) => refreshCellTagsDom(it.id, dataIdx + 1));
}

// Row tag picker: a small popover (opened from the tag button that appears, statically
// positioned, to the left of whichever row is currently hovered) listing every tag as a clickable
// row — click toggles it on/off for the current row, highlighting it while selected. The new-tag
// name/colour input always sits at the bottom of the list (not behind an "add tag" toggle), so
// creating a tag is just type-and-Enter.
export function openRowTagPicker(id: number, r: number, btnEl: HTMLElement): void {
  const appState = getAppState();
  const it = resolveTableForEdit(id);
  if (!it) return;
  // 'rail' — a click on a row's own tag button is exactly the kind of "clicked elsewhere on the
  // canvas" interaction that must no longer close an open rail panel (see window.onclick's own
  // comment, app/dotto/lib/sourceButtonsCursorMode.ts).
  window.__closeAllPanels!("rail");
  appState.activeTagRow = { id, r };
  appState.renamingTagId = null;
  closeTagContextMenu();
  (document.getElementById("cell-tag-picker-new-color") as HTMLInputElement).value = "#6366f1";
  (document.getElementById("cell-tag-picker-new-name") as HTMLInputElement).value = "";
  renderCellTagPickerList();
  const rect = btnEl.getBoundingClientRect();
  appState.cellTagPicker.style.left = Math.min(rect.right + 6, window.innerWidth - 210) + "px";
  appState.cellTagPicker.style.top = rect.top + "px";
  appState.cellTagPicker.style.display = "flex";
}
// Real React state now (see app/dotto/CellTagPickerList.jsx, cellTagPickerListStore) — genuine
// JSX rows, same reasoning as the other list panels. Not risky the way the Source table itself is
// (contentEditable, live hover-zone pixel math) — this popover's own rename input is a plain
// <input>, not contentEditable, and its position is a one-shot getBoundingClientRect() on open
// (openRowTagPicker), not continuous. The picker's own show/hide/position and the new-tag row +
// tag-context-menu stay vanilla (static markup, untouched by this conversion).
function renderCellTagPickerList(): void {
  const appState = getAppState();
  if (!appState.activeTagRow) {
    useCellTagPickerListStore.setState({ rows: [], id: null, r: null });
    return;
  }
  const { id, r } = appState.activeTagRow;
  const it = resolveTableForEdit(id) as unknown as TableItem | undefined;
  if (!it) {
    useCellTagPickerListStore.setState({ rows: [], id: null, r: null });
    return;
  }
  const tags = ensureTableTags(it);
  const assigned = new Set(ensureCellTags(it)[r] || []);
  const rows = tags.map((t) => ({
    tagId: t.id,
    name: t.name,
    color: t.color,
    selected: assigned.has(t.id),
    renaming: t.id === appState.renamingTagId,
  }));
  useCellTagPickerListStore.setState({ rows, id, r });
  // The divider above the new-tag input only makes sense once there's something above it — a
  // plain sibling of #cell-tag-picker-list, not something React portals into.
  document
    .getElementById("cell-tag-picker-new-row")!
    .classList.toggle("has-divider", tags.length > 0);
}
export function createTagFromCellPicker(): void {
  const appState = getAppState();
  if (!appState.activeTagRow) return;
  const { id, r } = appState.activeTagRow;
  const it = resolveTableForEdit(id) as unknown as TableItem | undefined;
  if (!it) return;
  const nameInput = document.getElementById("cell-tag-picker-new-name") as HTMLInputElement;
  const colorInput = document.getElementById("cell-tag-picker-new-color") as HTMLInputElement;
  const name = nameInput.value.trim();
  if (!name) return;
  window.__saveSnapshot!();
  const tag = { id: "tag_" + appState.idCounter++, name, color: colorInput.value };
  ensureTableTags(it).push(tag);
  const cellTags = ensureCellTags(it);
  const set = new Set(cellTags[r] || []);
  set.add(tag.id);
  cellTags[r] = Array.from(set);
  refreshCellTagsDom(id, r);
  nameInput.value = "";
  renderCellTagPickerList();
  nameInput.focus();
}
export function toggleCellTag(id: number, r: number, tagId: string): void {
  const it = resolveTableForEdit(id) as unknown as TableItem | undefined;
  if (!it) return;
  closeTagContextMenu();
  window.__saveSnapshot!();
  const cellTags = ensureCellTags(it);
  const set = new Set(cellTags[r] || []);
  if (set.has(tagId)) set.delete(tagId);
  else set.add(tagId);
  if (set.size) cellTags[r] = Array.from(set);
  else delete cellTags[r];
  refreshCellTagsDom(id, r);
  renderCellTagPickerList();
}
// ---------- Tag right-click menu: rename / delete ----------
export function openTagContextMenu(event: MouseEvent, tagId: string): void {
  event.preventDefault();
  event.stopPropagation();
  const appState = getAppState();
  appState.contextMenuTagId = tagId;
  const menu = document.getElementById("tag-context-menu")!;
  menu.style.left = event.clientX + "px";
  menu.style.top = event.clientY + "px";
  menu.style.display = "flex";
}
export function closeTagContextMenu(): void {
  const appState = getAppState();
  const menu = document.getElementById("tag-context-menu");
  if (menu) menu.style.display = "none";
  appState.contextMenuTagId = null;
}
export function startRenameActiveTag(): void {
  const appState = getAppState();
  const tagId = appState.contextMenuTagId;
  closeTagContextMenu();
  if (!tagId) return;
  appState.renamingTagId = tagId;
  renderCellTagPickerList();
}
interface KeydownLikeEvent {
  key: string;
  preventDefault: () => void;
  target: EventTarget | null;
}
// `e` is a real React.KeyboardEvent at its one real call site (CellTagPickerList.jsx's onKeyDown)
// — typed structurally here instead of importing React's own type, since this is a plain .ts
// module with no JSX of its own.
export function handleTagRenameKeydown(e: KeydownLikeEvent, tagId: string): void {
  const appState = getAppState();
  if (e.key === "Enter") {
    e.preventDefault();
    (e.target as HTMLInputElement).blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    appState.renamingTagId = null;
    renderCellTagPickerList();
  }
}
export function commitTagRename(tagId: string, newValue: string): void {
  const appState = getAppState();
  if (appState.renamingTagId !== tagId) return; // already cancelled via Escape
  appState.renamingTagId = null;
  if (!appState.activeTagRow) return;
  const it = resolveTableForEdit(appState.activeTagRow.id) as unknown as TableItem | undefined;
  if (it) {
    const tag = ensureTableTags(it).find((t) => t.id === tagId);
    const trimmed = newValue.trim();
    if (tag && trimmed && trimmed !== tag.name) {
      window.__saveSnapshot!();
      tag.name = trimmed;
      refreshAllRowTagsDom(it);
    }
  }
  renderCellTagPickerList();
}
export function deleteActiveTag(): void {
  const appState = getAppState();
  const tagId = appState.contextMenuTagId;
  closeTagContextMenu();
  if (!tagId || !appState.activeTagRow) return;
  const it = resolveTableForEdit(appState.activeTagRow.id) as unknown as TableItem | undefined;
  if (!it) return;
  window.__saveSnapshot!();
  it.tags = ensureTableTags(it).filter((t) => t.id !== tagId);
  const cellTags = ensureCellTags(it);
  Object.keys(cellTags).forEach((rKey) => {
    const key = Number(rKey);
    cellTags[key] = cellTags[key].filter((id) => id !== tagId);
    if (!cellTags[key].length) delete cellTags[key];
  });
  refreshAllRowTagsDom(it);
  renderCellTagPickerList();
}
// Explicitly resets the row-tag hover state on the affected table (rather than waiting for the
// next mousemove to notice) — see attachStaticTableHoverZones' _resetRowTagHover — so the tag
// button/indent don't linger if the picker was closed by clicking elsewhere on the canvas rather
// than by moving the mouse off the table.
export function closeCellTagPicker(): void {
  const appState = getAppState();
  appState.cellTagPicker.style.display = "none";
  closeTagContextMenu();
  appState.renamingTagId = null;
  if (appState.activeTagRow) {
    // The rendered page's own container is always keyed by the CURRENTLY OPEN source's table id,
    // not necessarily activeTagRow.id.
    const localTable = appState.folders[appState.currentFolderId]?.items.find(
      (i) => i.kind === "table",
    );
    const container = localTable && window.__findItemEl!(localTable.id);
    if (
      container &&
      (container as HTMLElement & { _resetRowTagHover?: () => void })._resetRowTagHover
    ) {
      (container as HTMLElement & { _resetRowTagHover?: () => void })._resetRowTagHover!();
    }
  }
  appState.activeTagRow = null;
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // Vanilla -> React bridges — used by app/dotto/CellTagPickerList.jsx's own TagRow handlers had
  // their bridges dropped once that component was upgraded to a real import (same app/dotto/
  // tree); the ones below have no jsx consumer, only still-vanilla ones.
  // Used by app/dotto/canvasItemBehavior.js's renderStaticTableHTML/attachStaticTableHoverZones
  // (Phase 3's fourth relocated piece), same reasoning as window.__getAppState (app/dotto/lib/coreState.ts).
  window.__openRowTagPicker = openRowTagPicker;
  window.__tagPillsHTML = tagPillsHTML as (table: Record<string, unknown>, r: number) => string;
  // Used by app/dotto/lib/waypointsRenderLoop.ts/sourceButtonsCursorMode.ts/historyAutosave.ts.
  window.__closeCellTagPicker = closeCellTagPicker;
  // Plain (non-`__`) globals — real inline onclick/onkeydown targets in
  // content/fragments/cell-tag-picker.html; window-bridge.js used to set these from this file's
  // own vanilla exports, now set directly instead, same convention every other ported file with
  // real inline-HTML targets already established.
  window.closeCellTagPicker = closeCellTagPicker;
  window.closeTagContextMenu = closeTagContextMenu;
  window.createTagFromCellPicker = createTagFromCellPicker;
  window.deleteActiveTag = deleteActiveTag;
  window.startRenameActiveTag = startRenameActiveTag;
  window.triggerSourceUpload = triggerSourceUpload;
}
