import { kindSize } from './add-menu.js';
import { escapeHtml, stripHtml } from './ai-assistant-suggestions.js';
import { appState, canvasViewportCenterX, findItemEl } from './core-state.js';
import { resolveTableForEdit } from './drawing-connections.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { closeAllPanels } from './panels-hamburger.js';
import { closeSourceAddMenu } from './source-buttons-cursor-mode.js';
import { importDelimitedIntoSource } from './source-table.js';
import { add } from './srs-connections-core.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Dotbot-generated source content (see the "sourceAction" panel in
    // app/api/dotbot/orchestrate/route.js) ----------
 // mirrors MAX_SOURCE_COLS server-side
 // mirrors MAX_SOURCE_ROWS server-side

    // Pads/truncates one generated row to exactly `width` cells, HTML-escaping each one — the
    // model's cell text is plain content, but tableData cells are raw innerHTML (see
    // renderStaticTableHTML), so anything with "<"/"&"/etc must be escaped before it's stored.
    function aiRowToCells(row, width) {
        const cells = new Array(width).fill('');
        (row || []).slice(0, width).forEach((c, i) => { cells[i] = escapeHtml(String(c == null ? '' : c)); });
        return cells;
    }

    // Adds AI-generated rows to an already-attached source (dragged into the search box), found
    // via searchCardContext[targetIndex - 1] — targetIndex is 1-based and numbered exactly like
    // the "Cards attached to this query" / "Sources attached to this query" blocks the server
    // built the prompt from (see commenceDotbotSearch), so it points straight back at the same
    // entry. Only ever targets a "source" card (never a bare "table"), since a source snapshot's
    // folderId is a stable, global key into `folders` — reachable regardless of which canvas the
    // user has since navigated to — while a bare table's id is only meaningful within whichever
    // folder it lived in at drag time.
    function applyAiAddRowsToSource(targetIndex, columns, rows) {
        const ctx = appState.searchCardContext[(targetIndex || 1) - 1];
        if (!ctx || ctx.snapshot.kind !== 'source') return false;
        const folderObj = appState.folders[ctx.snapshot.folderId];
        if (!folderObj) return false;
        saveSnapshot();
        let tableItem = folderObj.items.find(i => i.kind === 'table');
        if (!tableItem) {
            tableItem = { id: appState.idCounter++, x: 28, y: 28, w: 560, h: 360, kind: 'table', tableData: [['']] };
            folderObj.items.push(tableItem);
        }
        const isCellEmpty = c => !stripHtml(c || '').trim();
        const headerBlank = tableItem.tableData[0].every(isCellEmpty);
        let width = tableItem.tableData[0].length;
        // Only ever adopts the model's proposed column names into a still-placeholder header —
        // an existing named source keeps its own columns untouched (see the prompt).
        if (headerBlank && columns && columns.length) {
            width = Math.max(1, Math.min(appState.AI_SOURCE_MAX_COLS, columns.length));
            tableItem.tableData[0] = new Array(width).fill('').map((_, i) => escapeHtml(columns[i] || `Column ${i + 1}`));
            for (let ri = 1; ri < tableItem.tableData.length; ri++) {
                const row = tableItem.tableData[ri];
                tableItem.tableData[ri] = new Array(width).fill('').map((_, ci) => row[ci] || '');
            }
        }
        const newRows = (rows || []).slice(0, appState.AI_SOURCE_MAX_ROWS).map(r => aiRowToCells(r, width));
        if (!newRows.length) return false;
        // Fills existing blank rows first, then appends the rest — same rule
        // importDelimitedIntoSource uses for CSV/TSV import, so AI-added rows behave the same way
        // as a file import would.
        let ni = 0;
        for (let ri = 1; ri < tableItem.tableData.length && ni < newRows.length; ri++) {
            if (tableItem.tableData[ri].every(isCellEmpty)) { tableItem.tableData[ri] = newRows[ni]; ni++; }
        }
        if (ni < newRows.length) tableItem.tableData.push(...newRows.slice(ni));
        render();
        scheduleWorkspaceSave();
        return true;
    }

    // Creates a brand new source card (via the normal add('source', ...) path, so it gets the
    // same undo snapshot/points/placement handling as a manually-added one) seeded with
    // AI-generated columns/rows instead of the usual blank 2x4 grid.
    function createSourceFromAI(title, columns, rows) {
        const { w, h } = kindSize('source');
        const cx = canvasViewportCenterX(), cy = window.innerHeight / 2;
        const x = Math.round((((cx - appState.tx) / appState.scale) - w / 2) / 28) * 28;
        const y = Math.round((((cy - appState.ty) / appState.scale) - h / 2) / 28) * 28;
        add('source', x, y);
        const items = appState.folders[appState.currentFolderId].items;
        const created = items[items.length - 1];
        const folderObj = appState.folders[created.folderId];
        const width = Math.max(1, Math.min(appState.AI_SOURCE_MAX_COLS, (columns && columns.length) || 2));
        const header = new Array(width).fill('').map((_, i) => escapeHtml((columns && columns[i]) || `Column ${i + 1}`));
        const dataRows = (rows || []).slice(0, appState.AI_SOURCE_MAX_ROWS).map(r => aiRowToCells(r, width));
        folderObj.title = (title || 'New Source').trim().slice(0, 80) || 'New Source';
        folderObj.items[0].tableData = [header, ...(dataRows.length ? dataRows : [new Array(width).fill('')])];
        render();
        scheduleWorkspaceSave();
        return true;
    }

    function triggerSourceUpload() {
        closeSourceAddMenu(); closeCellTagPicker();
        const input = document.createElement('input');
        // Extensions alone are greyed out by some OS file pickers unless matching MIME types
        // are also listed (extension-only matching isn't reliably honoured everywhere) — so
        // both are included here for every accepted type.
        input.type = 'file';
        input.accept = '.csv,.tsv,.txt,.apkg,.colpkg,text/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel,application/csv';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'apkg' || ext === 'colpkg') {
                alert('Anki deck import (.apkg/.colpkg) isn\'t supported yet — only CSV/TSV files can be imported right now.');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => importDelimitedIntoSource(String(reader.result), ext === 'tsv' ? '\t' : ',');
            reader.readAsText(file);
        };
        input.click();
    }

    // ---------- Source page: tags ----------
    // Tag definitions ({id, name, color}) live on the table item itself; which tags are on
    // which row is a separate map keyed by row index -> [tagId, ...], kept entirely apart from
    // the cell's own text/HTML content (tableData) so tag chips never pollute what
    // extractCardsFromSource/search/etc. read out of a cell.
    function ensureTableTags(table) { if (!table.tags) table.tags = []; return table.tags; }
    function ensureCellTags(table) { if (!table.cellTags) table.cellTags = {}; return table.cellTags; }

    function tagPillsHTML(table, r) {
        const ids = (table.cellTags && table.cellTags[r]) || [];
        if (!ids.length) return '';
        const tags = table.tags || [];
        return ids.map(tagId => {
            const tag = tags.find(t => t.id === tagId);
            if (!tag) return '';
            return `<span class="tag-chip" style="--chip-color:${tag.color}" title="${escapeHtml(tag.name)}"><span class="tag-chip-name">${escapeHtml(tag.name)}</span></span>`;
        }).join('');
    }
    // Tags belong to the row, but the chips themselves are only ever rendered in the first
    // column's cell (renderStaticTableHTML only emits a .cell-tags div there). Matched by
    // [data-origin-table] + [data-r] together (not just "#item-${id}" + data-r) so this always
    // picks out the one real row unambiguously. Falls back to a full render() if nothing
    // matched — the DOM may simply not exist yet.
    function refreshCellTagsDom(id, r) {
        const it = resolveTableForEdit(id); if (!it) return;
        const cells = document.querySelectorAll(`.item-table td[data-origin-table="${id}"][data-r="${r}"][data-c="0"] .cell-tags`);
        if (!cells.length) { render(); return; }
        cells.forEach(el => { el.innerHTML = tagPillsHTML(it, r); });
    }
    // Delete/rename affect potentially every row's chips (not just the one being edited in the
    // picker), so refresh column 0 across the whole table in one pass.
    function refreshAllRowTagsDom(it) {
        it.tableData.slice(1).forEach((row, dataIdx) => refreshCellTagsDom(it.id, dataIdx + 1));
    }

    // Row tag picker: a small popover (opened from the tag button that appears, statically
    // positioned, to the left of whichever row is currently hovered) listing every tag as a
    // clickable row — click toggles it on/off for the current row, highlighting it while
    // selected. The new-tag name/colour input always sits at the bottom of the list (not
    // behind an "add tag" toggle), so creating a tag is just type-and-Enter.
    function openRowTagPicker(id, r, btnEl) {
        const it = resolveTableForEdit(id); if (!it) return;
        // 'rail' — a click on a row's own tag button is exactly the kind of "clicked elsewhere on
        // the canvas" interaction that must no longer close an open rail panel (see
        // window.onclick's own comment, source-buttons-cursor-mode.js).
        closeAllPanels('rail');
        appState.activeTagRow = { id, r };
        appState.renamingTagId = null;
        closeTagContextMenu();
        document.getElementById('cell-tag-picker-new-color').value = '#6366f1';
        document.getElementById('cell-tag-picker-new-name').value = '';
        renderCellTagPickerList();
        const rect = btnEl.getBoundingClientRect();
        appState.cellTagPicker.style.left = Math.min(rect.right + 6, window.innerWidth - 210) + 'px';
        appState.cellTagPicker.style.top = (rect.top) + 'px';
        appState.cellTagPicker.style.display = 'flex';
    }
    // Real React state now (see app/dotto/CellTagPickerList.jsx, cellTagPickerListStore) —
    // genuine JSX rows, same reasoning as the other list panels. Not risky the way the Source
    // table itself is (contentEditable, live hover-zone pixel math) — this popover's own rename
    // input is a plain <input>, not contentEditable, and its position is a one-shot
    // getBoundingClientRect() on open (openRowTagPicker), not continuous. The picker's own
    // show/hide/position and the new-tag row + tag-context-menu stay vanilla (static markup,
    // untouched by this conversion).
    function renderCellTagPickerList() {
        if (!appState.activeTagRow) { window.__setCellTagPickerList({ rows: [], id: null, r: null }); return; }
        const { id, r } = appState.activeTagRow;
        const it = resolveTableForEdit(id); if (!it) { window.__setCellTagPickerList({ rows: [], id: null, r: null }); return; }
        const tags = ensureTableTags(it);
        const assigned = new Set((ensureCellTags(it)[r]) || []);
        const rows = tags.map(t => ({ tagId: t.id, name: t.name, color: t.color, selected: assigned.has(t.id), renaming: t.id === appState.renamingTagId }));
        window.__setCellTagPickerList({ rows, id, r });
        // The divider above the new-tag input only makes sense once there's something above it —
        // a plain sibling of #cell-tag-picker-list, not something React portals into.
        document.getElementById('cell-tag-picker-new-row').classList.toggle('has-divider', tags.length > 0);
    }
    function createTagFromCellPicker() {
        if (!appState.activeTagRow) return;
        const { id, r } = appState.activeTagRow;
        const it = resolveTableForEdit(id); if (!it) return;
        const nameInput = document.getElementById('cell-tag-picker-new-name');
        const colorInput = document.getElementById('cell-tag-picker-new-color');
        const name = nameInput.value.trim();
        if (!name) return;
        saveSnapshot();
        const tag = { id: 'tag_' + appState.idCounter++, name, color: colorInput.value };
        ensureTableTags(it).push(tag);
        const cellTags = ensureCellTags(it);
        const set = new Set(cellTags[r] || []);
        set.add(tag.id);
        cellTags[r] = Array.from(set);
        refreshCellTagsDom(id, r);
        nameInput.value = '';
        renderCellTagPickerList();
        nameInput.focus();
    }
    function toggleCellTag(id, r, tagId) {
        const it = resolveTableForEdit(id); if (!it) return;
        closeTagContextMenu();
        saveSnapshot();
        const cellTags = ensureCellTags(it);
        const set = new Set(cellTags[r] || []);
        if (set.has(tagId)) set.delete(tagId); else set.add(tagId);
        if (set.size) cellTags[r] = Array.from(set); else delete cellTags[r];
        refreshCellTagsDom(id, r);
        renderCellTagPickerList();
    }
    // ---------- Tag right-click menu: rename / delete ----------
    function openTagContextMenu(event, tagId) {
        event.preventDefault();
        event.stopPropagation();
        appState.contextMenuTagId = tagId;
        const menu = document.getElementById('tag-context-menu');
        menu.style.left = event.clientX + 'px';
        menu.style.top = event.clientY + 'px';
        menu.style.display = 'flex';
    }
    function closeTagContextMenu() {
        const menu = document.getElementById('tag-context-menu');
        if (menu) menu.style.display = 'none';
        appState.contextMenuTagId = null;
    }
    function startRenameActiveTag() {
        const tagId = appState.contextMenuTagId;
        closeTagContextMenu();
        if (!tagId) return;
        appState.renamingTagId = tagId;
        renderCellTagPickerList();
    }
    function handleTagRenameKeydown(e, tagId) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); appState.renamingTagId = null; renderCellTagPickerList(); }
    }
    function commitTagRename(tagId, newValue) {
        if (appState.renamingTagId !== tagId) return; // already cancelled via Escape
        appState.renamingTagId = null;
        if (!appState.activeTagRow) return;
        const it = resolveTableForEdit(appState.activeTagRow.id);
        if (it) {
            const tag = ensureTableTags(it).find(t => t.id === tagId);
            const trimmed = newValue.trim();
            if (tag && trimmed && trimmed !== tag.name) {
                saveSnapshot();
                tag.name = trimmed;
                refreshAllRowTagsDom(it);
            }
        }
        renderCellTagPickerList();
    }
    function deleteActiveTag() {
        const tagId = appState.contextMenuTagId;
        closeTagContextMenu();
        if (!tagId || !appState.activeTagRow) return;
        const it = resolveTableForEdit(appState.activeTagRow.id); if (!it) return;
        saveSnapshot();
        it.tags = ensureTableTags(it).filter(t => t.id !== tagId);
        const cellTags = ensureCellTags(it);
        Object.keys(cellTags).forEach(rKey => {
            cellTags[rKey] = cellTags[rKey].filter(id => id !== tagId);
            if (!cellTags[rKey].length) delete cellTags[rKey];
        });
        refreshAllRowTagsDom(it);
        renderCellTagPickerList();
    }
    // Explicitly resets the row-tag hover state on the affected table (rather than waiting for
    // the next mousemove to notice) — see attachStaticTableHoverZones' _resetRowTagHover — so
    // the tag button/indent don't linger if the picker was closed by clicking elsewhere on the
    // canvas rather than by moving the mouse off the table.
    function closeCellTagPicker() {
        appState.cellTagPicker.style.display = 'none';
        closeTagContextMenu();
        appState.renamingTagId = null;
        if (appState.activeTagRow) {
            // The rendered page's own container is always keyed by the CURRENTLY OPEN source's
            // table id, not necessarily activeTagRow.id.
            const localTable = appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].items.find(i => i.kind === 'table');
            const container = localTable && findItemEl(localTable.id);
            if (container && container._resetRowTagHover) container._resetRowTagHover();
        }
        appState.activeTagRow = null;
    }

export { applyAiAddRowsToSource, closeCellTagPicker, closeTagContextMenu, commitTagRename, createSourceFromAI, createTagFromCellPicker, deleteActiveTag, handleTagRenameKeydown, openRowTagPicker, openTagContextMenu, startRenameActiveTag, tagPillsHTML, toggleCellTag, triggerSourceUpload };

// React → vanilla bridges — used by CellTagPickerList.jsx (app/dotto/), which can't import these
// directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__toggleCellTag = toggleCellTag;
window.__openTagContextMenu = openTagContextMenu;
window.__handleTagRenameKeydown = handleTagRenameKeydown;
window.__commitTagRename = commitTagRename;
// Used by app/dotto/canvasItemBehavior.js's renderStaticTableHTML/attachStaticTableHoverZones
// (Phase 3's fourth relocated piece), same reasoning as window.__getAppState (core-state.js).
window.__openRowTagPicker = openRowTagPicker;
window.__tagPillsHTML = tagPillsHTML;
