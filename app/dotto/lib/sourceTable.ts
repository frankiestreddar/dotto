// Phase 4.4 port of public/dotto/source-table.js: the on-canvas Table card's legacy string
// renderer (still used by app/dotto/lib/messagingCanvasPreview.ts's mini previews and a table's
// first-ever resize, see renderTableHTML's own comment), cell/keyboard navigation shared by both
// the legacy renderer and the real TableCard.jsx, row/column growth + merging, and the Source
// page's own image/audio-insert + CSV/TSV import pipeline. TableCard.jsx upgraded from window
// bridges to real ES imports (same precedent as stopwatch.ts/gamesFlashcardTyperight.ts/
// MediaCard.jsx), bridges kept for the still-vanilla callers (search-orchestration-selection.js,
// and canvasItemBehavior.js's/static-HTML's own inline-onclick targets) plus
// app/dotto/lib/messagingCanvasPreview.ts/app/dotto/lib/sourceTagsAi.ts/
// app/dotto/lib/tableGridResize.ts (all ported since — the last of these upgraded to a real
// import too, same app/dotto/lib tree).
// Reaches every still-vanilla dependency through window bridges.

import { resolveTableForEdit } from "./drawingConnections";

interface MergedRegion {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
interface Item {
  id: number;
  tableData: string[][];
  userSized?: boolean;
  textAlign?: string;
  rowHeights?: number[];
  colWidths?: number[];
  mergedCells?: MergedRegion[];
  w: number;
  h: number;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  isSource?: boolean;
  items: Item[];
}
interface AppState {
  idCounter: number;
  currentFolderId: string;
  folders: Record<string, FolderObj>;
  lastFocusedCell: { id: number; r: number; c: number } | null;
  audioRecordIndicator: HTMLElement;
  cellAudioRecorder: MediaRecorder | null;
  cellAudioChunks: BlobPart[];
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}
function findItemById(id: number): Item | undefined {
  return window.__findItemById?.(id) as unknown as Item | undefined;
}

// ---------- Table card ----------
export function colgroupHTML(numCols: number): string {
  if (!numCols) return "";
  const pct = (100 / numCols).toFixed(4);
  return (
    "<colgroup>" +
    Array(numCols)
      .fill(0)
      .map(() => `<col style="width:${pct}%">`)
      .join("") +
    "</colgroup>"
  );
}
export function renderTableHTML(it: Item): string {
  const numCols = it.tableData[0].length;
  const cg = it.userSized ? colgroupHTML(numCols) : "";
  const itemElId = window.__itemElId?.(it.id) ?? "";
  const rows = it.tableData
    .map(
      (row, ri) =>
        `<tr>${row
          .map(
            (cell, ci) =>
              `<td contenteditable="true" data-r="${ri}" data-c="${ci}" oninput="updateTableCell(${it.id}, ${ri}, ${ci}, this)" onkeydown="handleTableKeydown(event, ${it.id}, ${ri}, ${ci})" onfocus="broadcastEditingState(true, '#${itemElId} td[data-r=&quot;${ri}&quot;][data-c=&quot;${ci}&quot;]')" onblur="broadcastEditingState(false)">${cell}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="static-table-wrap" style="--cell-align:${it.textAlign || "left"}">
                <div class="static-table-row">
                    <div class="table-rounded"><table class="item-table">${cg}<tbody>${rows}</tbody></table></div>
                </div>
            </div>
            <div class="add-col-zone" onmousedown="event.stopPropagation()"><div class="table-add-btn" onclick="addTableCol(${it.id})" title="Add column">+</div></div>
            <div class="add-row-zone" onmousedown="event.stopPropagation()"><div class="table-add-btn" onclick="addTableRow(${it.id})" title="Add row">+</div></div>
            <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
}
// cellActionsHTML/buildHeaderPillsHTML moved to app/dotto/canvasItemBehavior.js (Phase 3's fourth
// relocated piece — the Source database page's own rendering/hover-zone geometry, see the
// migration plan), alongside tableCellHTML/renderStaticTableHTML/layoutSourceTableColumns/
// attachStaticTableHoverZones just below/further down — the only callers of any of these five are
// each other and render() (app/dotto/lib/waypointsRenderLoop.ts). colgroupHTML just above stays here —
// renderTableHTML (the on-canvas Table card's own legacy preview renderer, still used by
// app/dotto/lib/messagingCanvasPreview.ts) needs it too — reached from the relocated
// renderStaticTableHTML via window.__colgroupHTML.
// A click and drag on a cell should move the whole card, never focus/edit that cell — but the
// browser grabs focus on a contentEditable element the instant mousedown fires, before there's any
// way to know yet whether this gesture is a click or the start of a drag. This tracks real pointer
// movement after mousedown and blurs the cell the moment it crosses TABLE_CELL_DRAG_THRESHOLD_PX,
// handing the gesture over to the wrapper's own whole-card drag system (canvasItemBehavior.js's
// setupDraggingAndClicking, already listening on the same pointerdown via bubbling — completely
// unaffected by anything here, it was already tracking this same gesture in parallel the whole
// time). A plain click (no meaningful movement before mouseup) never blurs anything, so normal
// editing is untouched.
//
// Also handles the folder/waypoint title rename's own "the first click into an unfocused field
// always lands the caret at the end, not wherever you clicked" behavior
// (startRenameFolderCardTitle, app/dotto/lib/waypointsRenderLoop.ts) — but .cell-text is always contentEditable
// here (never toggled on click the way a rename field is), so "was this the very first click into
// an unfocused cell" is detected via document.activeElement at mousedown time, before the
// browser's own focus+click-to-caret handling has run. The deferred placement is itself guarded on
// dragDetected, so a fast drag that starts with a same-tick setTimeout race never re-focuses the
// cell right after the blur above already fired.
const TABLE_CELL_DRAG_THRESHOLD_PX = 4;
// Real inline onmousedown target (canvasItemBehavior.js's .cell-text markup) — plain global, no
// underscore.
export function handleCellMouseDown(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const wasFocused = document.activeElement === el;
  const downX = e.clientX,
    downY = e.clientY;
  let dragDetected = false;
  const onMove = (me: MouseEvent) => {
    if (dragDetected) return;
    if (Math.hypot(me.clientX - downX, me.clientY - downY) > TABLE_CELL_DRAG_THRESHOLD_PX) {
      dragDetected = true;
      el.blur();
      cleanup();
    }
  };
  const cleanup = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", cleanup);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", cleanup);
  if (!wasFocused) {
    setTimeout(() => {
      if (!dragDetected) window.__placeCaretEnd?.(el);
    }, 0);
  }
}
// tableCellHTML/renderStaticTableHTML/layoutSourceTableColumns also moved (see the comment above
// colgroupHTML) — layoutSourceTableColumns' own other caller (relayoutSourceTableIfVisible,
// app/dotto/lib/sourceButtonsCursorMode.ts) now reaches it via window.__layoutSourceTableColumns
// too.
// Real inline oninput target (canvasItemBehavior.js's source-page column-name input markup) —
// plain global, no underscore.
export function renameTableColumn(id: number, colIndex: number, value: string): void {
  const it = findItemById(id);
  if (!it) return;
  it.tableData[0][colIndex] = value;
  window.__scheduleWorkspaceSave?.();
}
// Real inline onkeydown target (canvasItemBehavior.js's source-page column-name input markup) —
// plain global, no underscore.
export function handleColNameKeydown(e: KeyboardEvent, id: number, colIndex: number): void {
  if (e.key === "Enter") {
    e.preventDefault();
    (e.target as HTMLInputElement).blur();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusTableCell(id, 1, colIndex);
    return;
  }
  const it = findItemById(id);
  if (!it) return;
  const target = e.target as HTMLInputElement;
  if (
    e.key === "ArrowRight" &&
    target.selectionStart === target.value.length &&
    colIndex + 1 < it.tableData[0].length
  ) {
    e.preventDefault();
    focusTableCell(id, 0, colIndex + 1);
  } else if (e.key === "ArrowLeft" && target.selectionStart === 0 && colIndex > 0) {
    e.preventDefault();
    focusTableCell(id, 0, colIndex - 1);
  }
}
// Even split by default — unless it.rowHeights (set by dragging an individual row divider, see
// startTableRowResize/app/dotto/lib/tableGridResize.ts) holds one real percentage per row, in which case each
// row gets that percentage of the table's current rendered height instead. Recomputing this off
// the CURRENT wrap.clientHeight every call (rather than caching pixel heights) is what lets a
// custom row split scale for free whenever the corner handle later changes the table's overall
// size — no separate rescaling logic needed there.
export function distributeTableSizing(it: Item, el: HTMLElement): void {
  const wrap = el.querySelector<HTMLElement>(".static-table-wrap");
  const table = el.querySelector<HTMLElement>(".item-table");
  if (!wrap || !table) return;
  const rows = table.querySelectorAll<HTMLElement>("tr");
  if (!rows.length) return;
  const numRows = rows.length;
  const heights =
    Array.isArray(it.rowHeights) && it.rowHeights.length === numRows
      ? it.rowHeights
      : new Array(numRows).fill(100 / numRows);
  const totalHeight = wrap.clientHeight;
  // The LAST row gets whatever's left over (totalHeight minus every other row's already-rounded
  // pixel height) rather than its own independently-computed percentage. Rounding each row
  // separately (heights[i]/100*totalHeight is rarely a whole pixel) can drift the SUM of all rows
  // a hair past totalHeight — .table-rounded's own overflow:hidden then silently clips whatever
  // poked past it, which for the last row means its own bottom border specifically, reading as
  // "the table lost its bottom edge" even though every row is still technically the right height.
  // Giving the last row the exact remainder instead guarantees the total can never exceed
  // totalHeight, so there's nothing left to clip.
  let usedHeight = 0;
  rows.forEach((tr, i) => {
    if (i === rows.length - 1) {
      tr.style.height = Math.max(0, totalHeight - usedHeight) + "px";
    } else {
      const h = Math.round((heights[i] / 100) * totalHeight);
      tr.style.height = h + "px";
      usedHeight += h;
    }
  });
}
// Real inline oninput target (renderTableHTML's own built HTML, and TableCard.jsx's onInput) —
// plain global, no underscore.
export function updateTableCell(id: number, r: number, c: number, el: HTMLElement): void {
  // resolveTableForEdit (not findItemById) — id may belong to a table that lives in a different
  // folder than the one currently open (e.g. a flashcard fed via a source's own subfolder,
  // possibly through a connected Stack — see CardStreamIO.shelf).
  const it = resolveTableForEdit(id) as unknown as Item | undefined;
  if (!it) return;
  it.tableData[r][c] = el.innerHTML;
  window.__scheduleWorkspaceSave?.();
}
// Plain canvas tables only support merged cells (see mergeTableCells below) — a merge region's own
// data lives at its top-left (r1,c1); every other (r,c) it covers has no <td> of its own to focus
// (see TableCard.jsx's render, which skips them). Arrow-key navigation computes a plain (r±1,c±1)
// target with no idea merges even exist, so without this it would land on a "hole" and silently
// fail to focus anything the moment it stepped onto a covered cell.
function resolveTableMergeHome(
  it: Item | undefined,
  r: number,
  c: number,
): { r: number; c: number } {
  const merged = it?.mergedCells;
  if (!merged) return { r, c };
  const region = merged.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
  return region ? { r: region.r1, c: region.c1 } : { r, c };
}
export function focusTableCell(id: number, r: number, c: number, pos?: "start" | "end"): void {
  const home = resolveTableMergeHome(findItemById(id), r, c);
  r = home.r;
  c = home.c;
  const itemElId = window.__itemElId?.(id) ?? "";
  // Source/static tables split their header out into a separate row of plain rename inputs (row 0
  // has no editable <td> at all there) — route keyboard nav there instead when it lands on row 0.
  // Plain canvas table cards have no such input: their header is just the first <tr>'s normal
  // (greyed-out, but real and editable) <td>s, so when no matching input exists here, fall
  // through to the ordinary cell lookup below instead of giving up — that's what was making the
  // top row unreachable by arrow keys there.
  if (r === 0) {
    const input = document.querySelector<HTMLInputElement>(
      `#${itemElId} .col-name-input[data-c="${c}"]`,
    );
    if (input) {
      input.focus();
      const caret = pos === "start" ? 0 : input.value.length;
      input.setSelectionRange(caret, caret);
      return;
    }
  }
  // Source-page (static) tables put the actual editable text in a nested `.cell-text` div (so the
  // hover tag-button/pills can live alongside it without being part of the editable content);
  // plain canvas table cards still edit the `<td>` itself directly.
  const el =
    document.querySelector<HTMLElement>(`#${itemElId} .cell-text[data-r="${r}"][data-c="${c}"]`) ||
    document.querySelector<HTMLElement>(`#${itemElId} td[data-r="${r}"][data-c="${c}"]`);
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(pos === "start");
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
function isCaretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return true;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const testRange = range.cloneRange();
  testRange.selectNodeContents(el);
  testRange.setEnd(range.startContainer, range.startOffset);
  return testRange.toString().length === 0;
}
function isCaretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return true;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const testRange = range.cloneRange();
  testRange.selectNodeContents(el);
  testRange.setStart(range.endContainer, range.endOffset);
  return testRange.toString().length === 0;
}
// Real inline onkeydown target (renderTableHTML's own built HTML, and TableCard.jsx's onKeyDown) —
// plain global, no underscore.
export function handleTableKeydown(e: KeyboardEvent, id: number, r: number, c: number): void {
  // Escape leaves the cell (same "Escape backs out of whatever you're focused in" pattern every
  // other text-editing surface in this app already follows) rather than falling through to
  // whatever the document-level Escape handler does — that one's meant for closing panels/
  // overlays, not blurring a specific field, and wasn't reaching this at all.
  if (e.key === "Escape") {
    e.preventDefault();
    (e.currentTarget as HTMLElement).blur();
    return;
  }
  // Quick cloze markup (see resolveGameFace/hasCloze): highlight a word or phrase inside a source
  // cell and press "[" to wrap it in brackets in place, rather than typing "[" and "]" by hand
  // around the caret. Only intercepts when there's an actual (non-collapsed) selection — a plain
  // "[" keystroke with just a caret still types a literal bracket.
  if (e.key === "[") {
    const sel = window.getSelection();
    const el = e.currentTarget as HTMLElement;
    if (
      sel &&
      sel.rangeCount &&
      !sel.isCollapsed &&
      el.contains(sel.anchorNode) &&
      el.contains(sel.focusNode)
    ) {
      e.preventDefault();
      const range = sel.getRangeAt(0);
      const wrapped = document.createTextNode("[" + range.toString() + "]");
      range.deleteContents();
      range.insertNode(wrapped);
      range.setStartAfter(wrapped);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      updateTableCell(id, r, c, el);
      return;
    }
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) {
      document.execCommand("insertLineBreak");
      return;
    }
    const it = findItemById(id);
    if (!it) return;
    const isStaticTable = !!(e.currentTarget as HTMLElement).closest(".static-table");
    if (isStaticTable) {
      const numCols = it.tableData[0].length;
      let nr = r,
        nc = c + 1;
      if (nc >= numCols) {
        nc = 0;
        nr = r + 1;
      }
      if (nr >= it.tableData.length) addTableRow(id);
      focusTableCell(id, nr, nc);
    } else if (r + 1 < it.tableData.length) {
      focusTableCell(id, r + 1, c);
    } else {
      addTableRow(id);
      focusTableCell(id, r + 1, c);
    }
    return;
  }
  const arrowDeltas: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const delta = arrowDeltas[e.key];
  if (!delta) return;
  if (e.shiftKey) return;
  const el = e.currentTarget as HTMLElement;
  if (e.key === "ArrowLeft" && !isCaretAtStart(el)) return;
  if (e.key === "ArrowRight" && !isCaretAtEnd(el)) return;
  const it = findItemById(id);
  if (!it) return;
  const [dr, dc] = delta;
  const nr = r + dr,
    nc = c + dc;
  if (nr < 0 || nr >= it.tableData.length || nc < 0 || nc >= it.tableData[0].length) return;
  e.preventDefault();
  focusTableCell(id, nr, nc, e.key === "ArrowLeft" ? "end" : "start");
}
// Grows the table's own overall size (it.w/it.h) to fit one more column/row, rather than shrinking
// every existing column/row to make room within the SAME overall size — every EXISTING column/row
// keeps its exact pixel size untouched. The new one's default pixel size is the average of the
// existing entries' current pixel sizes ("relative to the table" rather than an arbitrary fixed
// default), added on top of the table's current size. Percentages are recomputed against the NEW
// (bigger) total so every existing entry's PIXEL size — not its percentage — stays exactly what it
// was. it.userSized-gated: before the table's first corner resize it has no real it.w/it.h yet
// (auto-sized to content, table-layout:auto — see setupResizing, resize-shortcuts-init.js) and
// colWidths/rowHeights aren't rendered at all yet either (see TableCard.jsx's own it.userSized-
// gated colgroup/divider-handle JSX), so there's nothing meaningful to grow until then.
function growGridSizingForNewEntry(
  it: Item,
  current: number[] | undefined,
  count: number,
  totalKey: "w" | "h",
): number[] {
  const existing =
    Array.isArray(current) && current.length === count
      ? current
      : new Array(count).fill(100 / count);
  const oldTotal = it[totalKey];
  const newEntryPx = oldTotal / count;
  const newTotal = oldTotal + newEntryPx;
  it[totalKey] = Math.round(newTotal);
  return [
    ...existing.map((pct) => (((pct / 100) * oldTotal) / newTotal) * 100),
    (newEntryPx / newTotal) * 100,
  ];
}
// Real inline onclick target (renderTableHTML's own built HTML, and TableCard.jsx's onClick) —
// plain global, no underscore.
export function addTableRow(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  window.__saveSnapshot?.();
  if (it.userSized)
    it.rowHeights = growGridSizingForNewEntry(it, it.rowHeights, it.tableData.length, "h");
  it.tableData.push(new Array(it.tableData[0].length).fill(""));
  window.__render?.();
  // Jump the table's own vertical scroller all the way down so the freshly added (empty) row is
  // immediately visible instead of staying scrolled off-screen.
  const itemElId = window.__itemElId?.(id) ?? "";
  const tableRounded = document.querySelector<HTMLElement>(`#${itemElId} .table-rounded`);
  if (tableRounded) tableRounded.scrollTop = tableRounded.scrollHeight;
}
// Real inline onclick target (renderTableHTML's own built HTML, and TableCard.jsx's onClick) —
// plain global, no underscore.
export function addTableCol(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  window.__saveSnapshot?.();
  if (it.userSized)
    it.colWidths = growGridSizingForNewEntry(it, it.colWidths, it.tableData[0].length, "w");
  it.tableData.forEach((row) => row.push(""));
  window.__render?.();
  // Jump the shared horizontal scroller all the way right so the freshly added (empty) column is
  // immediately visible instead of staying scrolled off-screen.
  const itemElId = window.__itemElId?.(id) ?? "";
  const hscroll = document.querySelector<HTMLElement>(`#${itemElId} .static-table-hscroll`);
  if (hscroll) hscroll.scrollLeft = hscroll.scrollWidth;
}
// Merges two adjacent cell regions (plain canvas table cards only — see TableCard.jsx's own "hold
// Option, click a red edge" wiring) into one, combining regionA and regionB into their bounding
// rectangle. Only ever called with two regions TableCard.jsx has already confirmed are rectangle-
// compatible on the shared axis (identical row range for a left-right merge, identical column
// range for a top-bottom merge — see its computeMergeGrid) — this trusts that and doesn't
// re-validate, so it's not safe to call with two arbitrary regions that would produce a
// non-rectangular union.
// The merged region's content is whichever cell was already at its new top-left corner (min(r1),
// min(c1) of the two) — tableData itself is left completely untouched here; the OTHER region's own
// cell data just stops being rendered (TableCard.jsx skips every (r,c) a merge region covers
// besides its own top-left), not deleted, in case merges are ever made reversible later.
export function mergeTableCells(id: number, regionA: MergedRegion, regionB: MergedRegion): void {
  const it = findItemById(id);
  if (!it) return;
  window.__saveSnapshot?.();
  const same = (a: MergedRegion, b: MergedRegion) =>
    a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
  const merged = (it.mergedCells || []).filter((m) => !same(m, regionA) && !same(m, regionB));
  merged.push({
    r1: Math.min(regionA.r1, regionB.r1),
    c1: Math.min(regionA.c1, regionB.c1),
    r2: Math.max(regionA.r2, regionB.r2),
    c2: Math.max(regionA.c2, regionB.c2),
  });
  it.mergedCells = merged;
  window.__render?.();
  window.__scheduleWorkspaceSave?.();
}

// ---------- Source page: insert image/audio into the focused cell ----------
// Real inline onfocus target (canvasItemBehavior.js's source-page cell markup) — plain global, no
// underscore.
export function setLastFocusedCell(id: number, r: number, c: number): void {
  const appState = getAppState();
  if (appState) appState.lastFocusedCell = { id, r, c };
}
// Appends HTML (an <img>/<audio> tag) to whichever data cell last had focus. Works even if focus
// has since moved to the toolbar button that triggered the insert, since it goes straight through
// the DOM + tableData rather than relying on a live text-selection/caret.
function insertIntoActiveCell(html: string): void {
  const appState = getAppState();
  // lastFocusedCell can go stale (e.g. the user switched to a different source page without
  // focusing a cell there yet) — findItemById is scoped to the *current* folder, so this also
  // catches that case rather than silently doing nothing.
  const it = appState?.lastFocusedCell && findItemById(appState.lastFocusedCell.id);
  const { r, c } = appState?.lastFocusedCell || { r: undefined, c: undefined };
  if (!it || r === undefined || c === undefined || !it.tableData[r] || it.tableData[r][c] == null) {
    alert("Click into a cell first, then use Add to insert an image or audio clip there.");
    return;
  }
  const id = appState!.lastFocusedCell!.id;
  window.__saveSnapshot?.();
  const itemElId = window.__itemElId?.(id) ?? "";
  const td = document.querySelector<HTMLElement>(
    `#${itemElId} .cell-text[data-r="${r}"][data-c="${c}"]`,
  );
  if (td) {
    td.insertAdjacentHTML("beforeend", html);
    it.tableData[r][c] = td.innerHTML;
  } else {
    it.tableData[r][c] = (it.tableData[r][c] || "") + html;
    window.__render?.();
  }
}
// Real inline onclick target (content/fragments/source-add-menu.html) — plain global, no
// underscore.
export function triggerCellImageUpload(): void {
  window.__closeSourceAddMenu?.();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      insertIntoActiveCell(`<img class="cell-media-img" src="${reader.result}">`);
    reader.readAsDataURL(file);
  };
  input.click();
}
// Real inline onclick target (content/fragments/source-add-menu.html) — plain global, no
// underscore.
export function triggerCellAudioUpload(): void {
  window.__closeSourceAddMenu?.();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      insertIntoActiveCell(
        `<audio class="cell-media-audio" controls src="${reader.result}"></audio>`,
      );
    reader.readAsDataURL(file);
  };
  input.click();
}
// Real inline onclick target (content/fragments/source-add-menu.html) — plain global, no
// underscore.
export function startCellAudioRecording(): void {
  window.__closeSourceAddMenu?.();
  const appState = getAppState();
  if (!appState?.lastFocusedCell || !findItemById(appState.lastFocusedCell.id)) {
    alert("Click into a cell first, then use Audio > Record.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Microphone recording isn't supported in this browser.");
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      appState.cellAudioChunks = [];
      appState.cellAudioRecorder = new MediaRecorder(stream);
      appState.cellAudioRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) appState.cellAudioChunks.push(e.data);
      };
      appState.cellAudioRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        appState.audioRecordIndicator.classList.remove("recording");
        const blob = new Blob(appState.cellAudioChunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () =>
          insertIntoActiveCell(
            `<audio class="cell-media-audio" controls src="${reader.result}"></audio>`,
          );
        reader.readAsDataURL(blob);
      };
      appState.cellAudioRecorder.start();
      appState.audioRecordIndicator.classList.add("recording");
    })
    .catch(() => alert("Microphone access was denied or is unavailable."));
}
// Real inline onclick target (content/fragments/audio-record-indicator.html) — plain global, no
// underscore.
export function stopCellAudioRecording(): void {
  const appState = getAppState();
  if (appState?.cellAudioRecorder && appState.cellAudioRecorder.state !== "inactive")
    appState.cellAudioRecorder.stop();
}

// ---------- Source page: import a file (merges new rows into the source's table) ----------
// Small hand-rolled CSV/TSV parser: handles quoted fields (including escaped "" and embedded
// delimiters/newlines) without pulling in an external library.
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      /* skip, \n (or the loop end) closes the row */
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
// Imports a CSV/TSV's rows into the current source table by column *name*, not position: the
// file's own first line is taken as its header row, matched case-insensitively (and trimmed)
// against the existing table's column names. Matched columns land their values in the right place
// as brand-new rows; existing columns the file doesn't mention are simply left blank on those new
// rows; and any file column that doesn't match an existing one gets appended as a brand-new column
// (named after the file's header), with every row that came before it left blank in that column.
//
// The exception is scaffolding the table already has lying around empty: this is judged per column
// and per row, not as an all-or-nothing "is the whole table blank" check. A column only gets
// claimed-and-renamed by an unmatched file column if it's both nameless (still showing its "Column
// N" placeholder) AND every single one of its existing cells is blank — one filled-in cell
// anywhere in that column takes it out of the running, and a brand-new column is appended instead.
// Likewise, an existing row is only filled in place if EVERY cell in it is blank; a row with data
// in even one cell is left completely alone, and file rows keep going to brand-new rows appended
// at the end once the genuinely blank rows run out.
export function importDelimitedIntoSource(text: string, delim: string): void {
  const rows = parseDelimited(text, delim);
  if (!rows.length) {
    alert("No data found in that file.");
    return;
  }
  const appState = getAppState();
  const folderObj = appState?.folders[appState.currentFolderId];
  if (!folderObj || !folderObj.isSource) return;
  const csvHeader = rows[0].map((h) => (h || "").trim());
  const csvDataRows = rows.length > 1 ? rows.slice(1) : [];
  if (!csvDataRows.length) {
    alert("No data rows found in that file (only a header row).");
    return;
  }
  window.__saveSnapshot?.();
  let tableItem = folderObj.items.find((i) => i.kind === "table");
  if (!tableItem) {
    // No existing table yet — the file's own headers become the new table's columns outright, in
    // the order they appear in the file.
    tableItem = {
      id: appState!.idCounter++,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      kind: "table",
      tableData: [csvHeader.slice()],
    };
    folderObj.items.push(tableItem);
  }
  const isCellEmpty = (c: string) => !(c || "").trim();
  const existingHeader = tableItem.tableData[0];
  const existingDataRows = tableItem.tableData.slice(1);
  // Column-by-column: is every existing cell in this column (across all current data rows)
  // blank? Computed once, up front, off the table as it stood before this import touches
  // anything.
  const columnIsEmpty = existingHeader.map((_, ci) =>
    existingDataRows.every((row) => isCellEmpty(row[ci])),
  );
  const normalize = (s: string) => (s || "").trim().toLowerCase();
  const existingIndexByName = new Map<string, number>();
  existingHeader.forEach((name, i) => {
    const key = normalize(name);
    if (key && !existingIndexByName.has(key)) existingIndexByName.set(key, i);
  });
  // Column slots up for grabs by an unmatched file column: nameless AND entirely empty of data so
  // far, in left-to-right order.
  const unnamedSlots = existingHeader.reduce<number[]>((acc, name, i) => {
    if (!normalize(name) && columnIsEmpty[i]) acc.push(i);
    return acc;
  }, []);
  let unnamedSlotPtr = 0;
  // Map every column in the *file* to a column index in the table: reuse a matching existing
  // column by name; failing that, claim the next eligible unnamed-and-empty slot; failing that,
  // grow the table with a brand-new column named after this file header. Growing the table means
  // pushing a blank cell onto every row that already exists (the header row itself was just grown
  // by name), so the table stays rectangular.
  const csvColToTargetIndex = csvHeader.map((name) => {
    const key = normalize(name);
    if (key && existingIndexByName.has(key)) return existingIndexByName.get(key) as number;
    if (unnamedSlotPtr < unnamedSlots.length) {
      const reuseIndex = unnamedSlots[unnamedSlotPtr++];
      existingHeader[reuseIndex] = name;
      if (key) existingIndexByName.set(key, reuseIndex);
      return reuseIndex;
    }
    const newIndex = existingHeader.length;
    existingHeader.push(name);
    if (key) existingIndexByName.set(key, newIndex);
    tableItem!.tableData.forEach((row, ri) => {
      if (ri > 0) row.push("");
    });
    return newIndex;
  });
  const width = tableItem.tableData[0].length;
  const newRows = csvDataRows.map((csvRow) => {
    const out = new Array(width).fill("");
    csvRow.forEach((cell, ci) => {
      const targetIndex = csvColToTargetIndex[ci];
      if (targetIndex !== undefined) out[targetIndex] = cell;
    });
    return out;
  });
  // Fill existing rows that are entirely blank, in order, before appending anything new — rows
  // with any real content in them are skipped over and left completely alone.
  let ni = 0;
  for (let ri = 1; ri < tableItem.tableData.length && ni < newRows.length; ri++) {
    if (tableItem.tableData[ri].every(isCellEmpty)) {
      tableItem.tableData[ri] = newRows[ni];
      ni++;
    }
  }
  if (ni < newRows.length) tableItem.tableData.push(...newRows.slice(ni));
  window.__render?.();
}

// React -> vanilla bridges (see the identical pattern/comment in app/dotto/lib/cardsMisc.ts) — used by
// TableCard.jsx (app/dotto/), now real ES imports there instead (same precedent as
// stopwatch.ts/gamesFlashcardTyperight.ts/MediaCard.jsx) — kept declared/assigned here since
// still-vanilla callers need them too.
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__distributeTableSizing = distributeTableSizing;
  window.__mergeTableCells = mergeTableCells;
  // Used by app/dotto/canvasItemBehavior.js's setupResizing (a table's first-ever resize rebuilds
  // its body via this legacy string-renderer before switching to userSized layout — see that
  // function's own comment), same reasoning as window.__getAppState (app/dotto/lib/coreState.ts).
  window.__renderTableHTML = renderTableHTML;
  // Shared with the relocated renderStaticTableHTML (app/dotto/canvasItemBehavior.js — see the
  // comment above colgroupHTML's own definition) — the on-canvas Table card's own legacy preview
  // renderer (renderTableHTML, just above) also still needs this directly, same-module, unbridged.
  window.__colgroupHTML = colgroupHTML;
  // Used by app/dotto/lib/outlineTree.ts's goToOutlineSourceRow (Phase 4.4).
  window.__focusTableCell = focusTableCell;
  // Used by app/dotto/lib/sourceTagsAi.ts's triggerSourceUpload (Phase 4.5).
  window.__importDelimitedIntoSource = importDelimitedIntoSource;
  // Plain (non-`__`) globals — real inline onclick/oninput/onkeydown/onmousedown/onfocus targets
  // built into renderTableHTML's own HTML string, canvasItemBehavior.js's source-page markup, and
  // static HTML fragments (source-add-menu.html/audio-record-indicator.html), same shape
  // window.pushNotification/window.handleMarketplaceSearch use. Formerly re-exported through
  // window-bridge.js's own centralized inline-handler list.
  window.updateTableCell = updateTableCell;
  window.handleTableKeydown = handleTableKeydown;
  window.addTableCol = addTableCol;
  window.addTableRow = addTableRow;
  window.handleCellMouseDown = handleCellMouseDown;
  window.renameTableColumn = renameTableColumn;
  window.handleColNameKeydown = handleColNameKeydown;
  window.setLastFocusedCell = setLastFocusedCell;
  window.triggerCellImageUpload = triggerCellImageUpload;
  window.triggerCellAudioUpload = triggerCellAudioUpload;
  window.startCellAudioRecording = startCellAudioRecording;
  window.stopCellAudioRecording = stopCellAudioRecording;
}
