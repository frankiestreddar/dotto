import { escapeHtml, stripHtml } from './ai-assistant-suggestions.js';
import { appState } from './core-state.js';
import { resolveTableForEdit } from './drawing-connections.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { closeSourceAddMenu } from './source-buttons-cursor-mode.js';
import { openRowTagPicker, tagPillsHTML } from './source-tags-ai.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Table card ----------
    function colgroupHTML(numCols) {
        if (!numCols) return '';
        const pct = (100 / numCols).toFixed(4);
        return '<colgroup>' + Array(numCols).fill(0).map(() => `<col style="width:${pct}%">`).join('') + '</colgroup>';
    }
    function renderTableHTML(it) {
        const numCols = it.tableData[0].length;
        const cg = it.userSized ? colgroupHTML(numCols) : '';
        const rows = it.tableData.map((row, ri) =>
            `<tr>${row.map((cell, ci) => `<td contenteditable="true" data-r="${ri}" data-c="${ci}" oninput="updateTableCell(${it.id}, ${ri}, ${ci}, this)" onkeydown="handleTableKeydown(event, ${it.id}, ${ri}, ${ci})" onfocus="broadcastEditingState(true, '#item-${it.id} td[data-r=&quot;${ri}&quot;][data-c=&quot;${ci}&quot;]')" onblur="broadcastEditingState(false)">${cell}</td>`).join('')}</tr>`
        ).join('');
        return `<div class="static-table-wrap" style="--cell-align:${it.textAlign || 'left'}">
                <div class="static-table-row">
                    <div class="table-rounded"><table class="item-table">${cg}<tbody>${rows}</tbody></table></div>
                </div>
            </div>
            <div class="add-col-zone" onmousedown="event.stopPropagation()"><div class="table-add-btn" onclick="addTableCol(${it.id})" title="Add column">+</div></div>
            <div class="add-row-zone" onmousedown="event.stopPropagation()"><div class="table-add-btn" onclick="addTableRow(${it.id})" title="Add row">+</div></div>
            <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
    }
    // The first row of a source table's data is its column names, not a data record. It's
    // rendered entirely separately from the <table> as its own row of independent, fully
    // rounded pill cells (one plain rename-inline <input> each) sitting above the table body
    // — so it never gets mixed up with the actual rows beneath it (which
    // extractCardsFromSource/getSrsForRow etc. still treat as starting at index 1). The pill
    // row and the table share one real horizontal scroller (.static-table-hscroll) rather than
    // being synced via JS, so they move together natively; the upload button floats in a
    // separate non-scrolling overlay on top of it. Column widths and the overlay are wired up
    // afterward by layoutSourceTableColumns once this is in the DOM.
    function cellActionsHTML(itemId, r, c) {
        return `<div class="cell-actions" onmousedown="event.stopPropagation()">
                            <button class="cell-icon-btn cell-add-btn" onclick="event.stopPropagation(); openCellAddMenu(${itemId}, ${r}, ${c}, this)" title="Add image or audio"><img src="assets/icons/add-btn.png" alt=""></button>
                        </div>`;
    }
    // Renders a source table's column-name pill row (`colOptsFn(ci)` returns
    // `{ oninput, onkeydown? }` for column `ci`).
    function buildHeaderPillsHTML(colNames, colOptsFn) {
        return colNames.map((name, ci) => {
            const { oninput, onkeydown = '' } = colOptsFn(ci);
            return `
            <div class="col-name-slot" data-c="${ci}">
                <div class="col-name-pill">
                    <input type="text" class="col-name-input" data-c="${ci}" value="${escapeHtml(stripHtml(name || ''))}" placeholder="Column ${ci + 1}" oninput="${oninput}"${onkeydown ? ` onkeydown="${onkeydown}"` : ''}>
                </div>
            </div>`;
        }).join('');
    }
    // Renders one plain-text source-table cell (cell-inner/cell-text/cell-tags-actions-wrap).
    function tableCellHTML(cell, r, c, opts) {
        const { originTableId, oninput, onkeydown = '', onfocus = '', onblur = '', oncontextmenu = '', tagsAndActionsHTML = '' } = opts;
        return `<td data-origin-table="${originTableId}" data-r="${r}" data-c="${c}"${oncontextmenu ? ` oncontextmenu="${oncontextmenu}"` : ''}>
                    <div class="cell-inner">
                        <div class="cell-text" contenteditable="true" data-r="${r}" data-c="${c}" oninput="${oninput}"${onkeydown ? ` onkeydown="${onkeydown}"` : ''}${onfocus ? ` onfocus="${onfocus}"` : ''}${onblur ? ` onblur="${onblur}"` : ''}>${cell}</div>
                        ${tagsAndActionsHTML}
                    </div>
                </td>`;
    }
    // `folderId` param kept for callers, though nothing in here needs it anymore now that
    // source-to-source merging is gone — a source's rows only ever aggregate elsewhere now, via
    // a Stack card (see CardStreamIO.shelf) reading its 'sourceRows' output.
    function renderStaticTableHTML(it, folderId) {
        const numCols = it.tableData[0].length;
        const cg = colgroupHTML(numCols);
        const headerPills = buildHeaderPillsHTML(it.tableData[0], (ci) => ({
            oninput: `renameTableColumn(${it.id}, ${ci}, this.value)`,
            onkeydown: `handleColNameKeydown(event, ${it.id}, ${ci})`,
        }));
        const rows = it.tableData.slice(1).map((row, dataIdx) => {
            const ri = dataIdx + 1;
            return `<tr data-origin-table="${it.id}">${row.map((cell, ci) => tableCellHTML(cell, ri, ci, {
                originTableId: it.id,
                oninput: `updateTableCell(${it.id}, ${ri}, ${ci}, this)`,
                onkeydown: `handleTableKeydown(event, ${it.id}, ${ri}, ${ci})`,
                onfocus: `setLastFocusedCell(${it.id}, ${ri}, ${ci}); broadcastEditingState(true, '#item-${it.id} .cell-text[data-r=&quot;${ri}&quot;][data-c=&quot;${ci}&quot;]')`,
                onblur: `broadcastEditingState(false)`,
                oncontextmenu: `openTableCellContextMenu(event, ${it.id}, ${ri}, ${ci})`,
                tagsAndActionsHTML: ci === 0
                    ? `<div class="cell-tags-actions-wrap"><div class="cell-tags">${tagPillsHTML(it, ri)}</div>${cellActionsHTML(it.id, ri, ci)}</div>`
                    : cellActionsHTML(it.id, ri, ci),
            })).join('')}</tr>`;
        }).join('');
        return `<div class="static-table-wrap" style="--cell-align:${it.textAlign || 'left'}">
                <div class="static-table-header-overlay">
                    <div class="static-table-header-fade"></div>
                    <button class="static-table-upload-btn" onclick="event.stopPropagation(); triggerSourceUpload()" title="Import a file (CSV, Anki deck, ...) — new rows are merged into this table"><img src="assets/icons/upload-btn.png" alt=""></button>
                </div>
                <div class="static-table-scroller-row">
                    <div class="static-table-hscroll">
                        <div class="static-table-header-track">${headerPills}</div>
                        <div class="static-table-row">
                            <div class="table-rounded"><table class="item-table">${cg}<tbody>${rows}</tbody></table></div>
                        </div>
                    </div>
                    <div class="static-table-row-tag-strip-wrap">
                        <div class="row-tag-strip" onmousedown="event.stopPropagation()" title="Tags"><div class="add-btn"><img src="assets/icons/tag-button.png" alt=""></div></div>
                    </div>
                    <div class="static-table-col-strip-wrap">
                        <div class="add-col-strip" onmousedown="event.stopPropagation()" onclick="addTableCol(${it.id})" title="Add column"><div class="add-btn">+</div></div>
                    </div>
                </div>
                <div class="add-row-strip" onmousedown="event.stopPropagation()">
                    <div class="add-row-btn" onclick="addTableRow(${it.id})" title="Add row"><div class="add-btn">+</div></div>
                </div>
            </div>`;
    }
    // Sizes every column (the header pill slots and the table's own <col>s) to an identical
    // width derived from the container's (viewport-based) rendered width: with 3 or fewer
    // columns they simply divide up the full width, but past 3 columns each column is pinned
    // to containerWidth/VISIBLE_COLS regardless of how many there are, so 3 full columns plus
    // roughly a fifth of the next one show at once and the table scrolls horizontally.
    // Each header pill's *slot* always gets the exact same width as its table column, and
    // slots sit flush against each other with no gap/margin of their own — that's what keeps
    // the header perfectly aligned with the table no matter how many columns exist. The
    // visible pill inside each slot is simply drawn narrower (by GAP px) than its slot, which
    // is what creates the gap between pills without ever touching their positions. This also
    // sizes and shows/hides the fixed upload-button overlay and its fade-out.
 // 3 full columns + ~1/5 of a 4th once overflowing
 // must match .static-table-hscroll's column-direction gap
 // must match .item.static-table's padding-top
 // must match .item.static-table's padding-bottom
 // extra breathing room below the table before it scrolls
 // permanent extra shrink on the last header pill so the fixed upload button never covers its text
    function layoutSourceTableColumns(it, el, reserve) {
        const wrap = el.querySelector('.static-table-wrap');
        const table = el.querySelector('.item-table');
        const tableRounded = el.querySelector('.table-rounded');
        const headerTrack = el.querySelector('.static-table-header-track');
        const headerOverlay = el.querySelector('.static-table-header-overlay');
        const headerFade = el.querySelector('.static-table-header-fade');
        const colStripWrap = el.querySelector('.static-table-col-strip-wrap');
        const rowTagStripWrap = el.querySelector('.static-table-row-tag-strip-wrap');
        if (!wrap || !table || !headerTrack) return;
        const numCols = (it.tableData[0] || []).length;
        if (!numCols) return;
        const fullContainerWidth = wrap.clientWidth;
        if (!fullContainerWidth || fullContainerWidth <= 0) return;
        const overflowing = numCols > 3;

        // The header pill row always sizes itself off the FULL container width — it never
        // reacts to `reserve`. The add-column hover shrink is meant to only nudge the table's
        // own cells out of the way for the floating button, not the name pills above them.
        const headerColWidth = fullContainerWidth / (overflowing ? appState.STATIC_TABLE_VISIBLE_COLS : numCols);
        const headerTotalWidth = headerColWidth * numCols;
        headerTrack.style.width = headerTotalWidth + 'px';
        const headerSlots = headerTrack.querySelectorAll('.col-name-slot');
        headerSlots.forEach((slot, i) => {
            // The slot itself always stays exactly the width of its table column (for
            // alignment) — only the *visible pill* inside it is drawn narrower, both for the
            // normal inter-pill gap and, on the rightmost one, permanently reserving extra
            // room so the fixed upload button never sits on top of its text.
            slot.style.width = headerColWidth + 'px';
            const isLast = i === headerSlots.length - 1;
            const pill = slot.querySelector('.col-name-pill');
            if (pill) pill.style.width = Math.max(headerColWidth - appState.STATIC_HEADER_PILL_GAP - (isLast ? appState.STATIC_TABLE_UPLOAD_BTN_RESERVE : 0), 24) + 'px';
        });

        // `reserve` (px) is how much room to genuinely give up on the right — used while the
        // add-column button is hovered/revealed and the table is scrolled all the way to its
        // right edge, so the table body redraws narrower and shows its own right border in the
        // gap, rather than just having that sliver of content silently scrolled out of view
        // underneath the button. Every column but the last always uses the same width as the
        // header pills (fullContainerWidth-based, never reserve-adjusted) — only the *last*
        // column gets narrowed by the flat `reserve` amount. That keeps the shrink a constant
        // number of pixels no matter how many columns the table has, instead of scaling up with
        // column count.
        const colWidth = fullContainerWidth / (overflowing ? appState.STATIC_TABLE_VISIBLE_COLS : numCols);
        const totalWidth = colWidth * numCols;
        const shrink = reserve || 0;
        table.style.width = (totalWidth - shrink) + 'px';
        const cols = table.querySelectorAll(':scope > colgroup > col');
        cols.forEach((col, i) => {
            const isLast = i === cols.length - 1;
            col.style.width = (isLast ? Math.max(colWidth - shrink, 24) : colWidth) + 'px';
        });
        // table-rounded gets the same explicit total width as the table itself, so it never
        // has any horizontal overflow of its own to clip (see the CSS note above on why that
        // matters) — the *outer* .static-table-hscroll is what actually scrolls it.
        if (tableRounded) tableRounded.style.width = (totalWidth - shrink) + 'px';

        // The table body's max-height is computed precisely off the real header height (rather
        // than a rough guess), so it expands to fill the available space — leaving a fixed
        // STATIC_TABLE_BOTTOM_MARGIN gap below it — before it needs to start scrolling.
        if (tableRounded) {
            const availableWrapHeight = window.innerHeight - appState.STATIC_TABLE_PAGE_PADDING_TOP - appState.STATIC_TABLE_PAGE_PADDING_BOTTOM - appState.STATIC_TABLE_BOTTOM_MARGIN;
            const maxTableHeight = Math.max(0, availableWrapHeight - headerTrack.offsetHeight - appState.STATIC_TABLE_ROW_GAP);
            tableRounded.style.maxHeight = maxTableHeight + 'px';
        }

        // The overlay doesn't scroll, so it just needs to match the header row's own height
        // once (not per column) to sit correctly over it.
        if (headerOverlay) headerOverlay.style.height = headerTrack.offsetHeight + 'px';
        // The fade under the upload button is now always on, regardless of column count.
        if (headerFade) headerFade.classList.add('visible');
        // Keep the add-column overlay confined to the body's vertical span only — it starts
        // right below the header track (offset by the hscroll's own column-gap) so it can
        // never sit on top of, or intercept clicks/hover on, the header pill row above it.
        if (colStripWrap) colStripWrap.style.top = (headerTrack.offsetHeight + appState.STATIC_TABLE_ROW_GAP) + 'px';
        // Same vertical confinement as the add-column overlay, so the row-tag button can never
        // appear over (or intercept hover on) the header pill row above it either.
        if (rowTagStripWrap) rowTagStripWrap.style.top = (headerTrack.offsetHeight + appState.STATIC_TABLE_ROW_GAP) + 'px';
    }
    function renameTableColumn(id, colIndex, value) {
        const it = findItemById(id); if (!it) return;
        it.tableData[0][colIndex] = value;
        scheduleWorkspaceSave();
    }
    function handleColNameKeydown(e, id, colIndex) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); focusTableCell(id, 1, colIndex); return; }
        const it = findItemById(id); if (!it) return;
        if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length && colIndex + 1 < it.tableData[0].length) {
            e.preventDefault(); focusTableCell(id, 0, colIndex + 1);
        } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0 && colIndex > 0) {
            e.preventDefault(); focusTableCell(id, 0, colIndex - 1);
        }
    }
    // Even split by default — unless it.rowHeights (set by dragging an individual row divider,
    // see startTableRowResize/resize-shortcuts-init.js) holds one real percentage per row, in
    // which case each row gets that percentage of the table's current rendered height instead.
    // Recomputing this off the CURRENT wrap.clientHeight every call (rather than caching pixel
    // heights) is what lets a custom row split scale for free whenever the corner handle later
    // changes the table's overall size — no separate rescaling logic needed there.
    function distributeTableSizing(it, el) {
        const wrap = el.querySelector('.static-table-wrap');
        const table = el.querySelector('.item-table');
        if (!wrap || !table) return;
        const rows = table.querySelectorAll('tr');
        if (!rows.length) return;
        const numRows = rows.length;
        const heights = (Array.isArray(it.rowHeights) && it.rowHeights.length === numRows) ? it.rowHeights : new Array(numRows).fill(100 / numRows);
        const totalHeight = wrap.clientHeight;
        rows.forEach((tr, i) => { tr.style.height = (heights[i] / 100 * totalHeight) + 'px'; });
    }
    function attachStaticTableHoverZones(container, tableItem) {
        const wrap = container.querySelector('.static-table-wrap');
        const rowStrip = container.querySelector('.add-row-strip');
        const tableRounded = container.querySelector('.table-rounded');
        const colStripWrap = container.querySelector('.static-table-col-strip-wrap');
        const colBtn = container.querySelector('.add-col-strip');
        const rowBtn = container.querySelector('.add-row-btn');
        const hscroll = container.querySelector('.static-table-hscroll');
        const rowTagStripWrap = container.querySelector('.static-table-row-tag-strip-wrap');
        const rowTagBtn = container.querySelector('.row-tag-strip');
        if (!wrap || !rowStrip || !tableRounded) return;
        const THRESH = 60;
        const BTN_SIZE = 28;
        const COL_STRIP_WIDTH = 36; // must match .static-table-col-strip-wrap's revealed width
        const COL_SHRINK_AMOUNT = 35; // flat px the table narrows by — see layoutSourceTableColumns
        const SCROLL_END_BUFFER = 25; // how close to the true right edge counts as "there"
        const SCROLL_START_BUFFER = 30; // how close to the true left edge counts as "there" (for the row-tag indent)
        let colHoverActive = false;
        // Unlike colHoverActive above, this tracks *which row* (its <tr>), not just a boolean —
        // the row-tag button's position is only ever recomputed when this reference changes
        // (a different row is now under the cursor), never on every mousemove tick, which is
        // what keeps it "static" rather than continuously trailing the cursor like the
        // add-column button does.
        let hoveredRowEl = null;
        // The one `.cell-inner` (first cell of whichever row) currently shifted to make room
        // for the tag button, if any — tracked so it can be un-shifted the moment the hovered
        // row changes or the table scrolls away from its left edge.
        let indentedInner = null;
        const updateRowTagBtnPos = () => {
            if (!hoveredRowEl || !rowTagBtn || !rowTagStripWrap) return;
            const rRect = hoveredRowEl.getBoundingClientRect();
            const stripRect = rowTagStripWrap.getBoundingClientRect();
            const top = Math.max(0, Math.min(rRect.top - stripRect.top + rRect.height / 2 - BTN_SIZE / 2, stripRect.height - BTN_SIZE));
            rowTagBtn.style.top = top + 'px';
        };
        // The table only actually shrinks (rather than just having the button float over the
        // top of it) once it's scrolled all the way to its right edge — shrinking it while
        // scrolled elsewhere would move content the user isn't even looking at, for no benefit.
        const isScrolledToRightEdge = () => !hscroll || hscroll.scrollLeft + hscroll.clientWidth >= hscroll.scrollWidth - SCROLL_END_BUFFER;
        // Mirror of the above for the row-tag button on the left: the hovered row's first cell
        // only actually makes room (shifts its content in from the left) once the table is
        // scrolled all the way to ITS left edge. Scrolled anywhere else, that column isn't
        // necessarily even the leftmost thing on screen, so the button just floats over the
        // top of whatever's currently visible there instead.
        const isScrolledToLeftEdge = () => !hscroll || hscroll.scrollLeft <= SCROLL_START_BUFFER;
        const updateColShrink = () => {
            if (tableItem) layoutSourceTableColumns(tableItem, container, (colHoverActive && isScrolledToRightEdge()) ? COL_SHRINK_AMOUNT : 0);
        };
        // Applies (or removes) the "make room" shift on the hovered row's first cell only,
        // re-evaluating both which row is hovered and the current scroll position each time.
        const updateRowIndent = () => {
            if (indentedInner) {
                indentedInner.classList.remove('row-tag-shift');
                indentedInner = null;
            }
            if (hoveredRowEl && isScrolledToLeftEdge()) {
                const firstCell = hoveredRowEl.querySelector('td[data-c="0"]');
                const inner = firstCell && firstCell.querySelector('.cell-inner');
                if (inner) {
                    inner.classList.add('row-tag-shift');
                    indentedInner = inner;
                }
            }
        };
        const onMove = (e) => {
            // Frozen entirely while ANY row-tag picker on this page is open — the tagged row's
            // button/indent must stay exactly as they were until the picker closes, not chase
            // the cursor onto whatever other row it happens to pass over in the meantime.
            if (appState.activeTagRow) return;
            // "Add column" needs to react to the *visible* right edge of the table area
            // (wrap's own rect), not table-rounded's actual content edge — once a table has
            // more than 3 columns, table-rounded is wider than the viewport, so its real edge
            // can be scrolled far off-screen. Vertical bounds still come from table-rounded
            // since its height always matches what's actually on screen.
            //
            // The hotspot that *triggers* the zone only ever starts right at (or past) the
            // table's true right edge — never inside it — since the last column already has
            // its own per-cell "add" button, and the two shouldn't compete for the same hover
            // real estate. But the strip/button, once shown, still visually sits inside that
            // edge (see layoutSourceTableColumns' `reserve`), so moving the cursor onto the
            // button itself is checked for separately below and treated as "still in the
            // zone" regardless — otherwise it'd vanish the instant you tried to reach it.
            const wRect = wrap.getBoundingClientRect();
            const tRect = tableRounded.getBoundingClientRect();
            const hoveredEl = document.elementFromPoint(e.clientX, e.clientY);
            const overColStrip = !!(hoveredEl && colStripWrap && colStripWrap.contains(hoveredEl));
            const strictlyPastRightEdge = e.clientY >= tRect.top && e.clientY <= tRect.bottom && e.clientX >= wRect.right && e.clientX <= wRect.right + THRESH;
            const nearRight = strictlyPastRightEdge || overColStrip;
            const nearBottom = e.clientX >= tRect.left && e.clientX <= tRect.right && e.clientY >= tRect.bottom && e.clientY <= tRect.bottom + THRESH;
            wrap.classList.toggle('show-col', nearRight);
            rowStrip.classList.toggle('show-row', nearBottom);
            // The table only actually needs to redraw narrower right when the hover state
            // flips (not on every pixel of mouse movement), so this only re-runs the column
            // layout on that transition — shrinking the last column's width by a flat
            // COL_SHRINK_AMOUNT (only when already scrolled to the right edge) so the table
            // visibly gets out of the way and shows its own right border in the gap. Otherwise
            // the button just slides in over the top of the table's existing content.
            // Restores back to full width the moment the cursor leaves the zone.
            if (nearRight !== colHoverActive) {
                colHoverActive = nearRight;
                updateColShrink();
            }
            // Keep each "+" button tracking the cursor along whichever axis it slides
            // within — top for the column button (it moves up/down the right edge), left for
            // the row button (it moves left/right along the bottom edge) — so it always sits
            // right where the cursor is, the whole time that edge is hovered.
            if (nearRight && colBtn && colStripWrap) {
                const csRect = colStripWrap.getBoundingClientRect();
                const top = Math.max(0, Math.min(e.clientY - csRect.top - BTN_SIZE / 2, csRect.height - BTN_SIZE));
                colBtn.style.top = top + 'px';
            }
            if (nearBottom && rowBtn) {
                const rsRect = rowStrip.getBoundingClientRect();
                const left = Math.max(0, Math.min(e.clientX - rsRect.left - BTN_SIZE / 2, rsRect.width - BTN_SIZE));
                rowBtn.style.left = left + 'px';
            }
            // Row-tag button: figure out which data row (if any) the cursor is currently over
            // — via the actual element under the pointer (already looked up above) rather than
            // a fixed geometric zone, since "any cell of the row" (not just its left edge)
            // should trigger it. Only acts when that row actually changes, so the button
            // doesn't jitter or chase the cursor while it stays within the same row.
            // Once revealed, the button itself floats (as a positioned overlay) on top of the
            // table's own left edge, so once the cursor moves onto it, elementFromPoint no
            // longer returns a <td> at all — it returns the button. Without this check that
            // read as "cursor left every row" and hid the button out from under itself the
            // instant you tried to reach it. Treat hovering the strip/button as "still on
            // whichever row was last active" instead of re-deriving anything from it.
            const onRowTagStrip = hoveredEl && rowTagStripWrap && rowTagStripWrap.contains(hoveredEl);
            if (!onRowTagStrip) {
                const rowTd = hoveredEl && hoveredEl.closest ? hoveredEl.closest('td[data-r]') : null;
                const rowEl = (rowTd && tableRounded.contains(rowTd)) ? rowTd.closest('tr') : null;
                if (rowEl !== hoveredRowEl) {
                    hoveredRowEl = rowEl;
                    wrap.classList.toggle('show-row-tag', !!rowEl);
                    if (rowEl && rowTagBtn) {
                        const r = Number(rowTd.dataset.r);
                        const originTableId = rowTd.dataset.originTable ? Number(rowTd.dataset.originTable) : tableItem.id;
                        rowTagBtn.onclick = (ev) => { ev.stopPropagation(); openRowTagPicker(originTableId, r, rowTagBtn); };
                        updateRowTagBtnPos();
                    }
                    updateRowIndent();
                }
            }
        };
        // Dismisses the row-tag button and un-indents its cell outright — used both when the
        // cursor leaves the table entirely and (see the scroll listeners below) the instant
        // any scrolling happens, rather than trying to keep the button/indent alive and just
        // repositioning them: a row sliding around under a now-stale button is more confusing
        // than the button just going away until you hover a row again.
        const dismissRowTagHover = () => {
            // Stays put while this table's row-tag picker is open (see openRowTagPicker /
            // closeCellTagPicker) — the cursor leaving the table to go interact with the
            // picker's popover shouldn't un-indent the row it's currently tagging.
            if (appState.activeTagRow && appState.activeTagRow.id === tableItem.id) return;
            if (hoveredRowEl) {
                hoveredRowEl = null;
                wrap.classList.remove('show-row-tag');
                updateRowIndent();
            }
        };
        // Exposed so closeCellTagPicker can force a reset the moment the picker closes,
        // rather than waiting for a mousemove that may not come for a while if it was closed
        // by clicking elsewhere on the canvas.
        container._resetRowTagHover = () => {
            hoveredRowEl = null;
            wrap.classList.remove('show-row-tag');
            updateRowIndent();
        };
        const onLeave = () => {
            wrap.classList.remove('show-col');
            rowStrip.classList.remove('show-row');
            if (colHoverActive) {
                colHoverActive = false;
                updateColShrink();
            }
            dismissRowTagHover();
        };
        container.addEventListener('mousemove', onMove);
        container.addEventListener('mouseleave', onLeave);
        // If the user scrolls the table horizontally while the "add column" zone is still
        // engaged (e.g. they scroll to the end while hovering there), re-check whether it
        // should shrink now rather than waiting for the next hover-state transition. Any
        // horizontal scroll also immediately dismisses the row-tag button/indent.
        if (hscroll) hscroll.addEventListener('scroll', () => {
            if (colHoverActive) updateColShrink();
            dismissRowTagHover();
        });
        // Any vertical scroll (inside table-rounded) also immediately dismisses the row-tag
        // button/indent, rather than trying to keep tracking the row that moved under it.
        if (tableRounded) tableRounded.addEventListener('scroll', () => { dismissRowTagHover(); });
    }
    function updateTableCell(id, r, c, el) {
        // resolveTableForEdit (not findItemById) — id may belong to a table that lives in a
        // different folder than the one currently open (e.g. a flashcard fed via a source's own
        // subfolder, possibly through a connected Stack — see CardStreamIO.shelf).
        const it = resolveTableForEdit(id); if (!it) return;
        it.tableData[r][c] = el.innerHTML;
        scheduleWorkspaceSave();
    }
    function focusTableCell(id, r, c, pos) {
        // Row 0 no longer has editable table cells at all — it's the header's row of plain
        // rename inputs — so route there instead when keyboard nav lands on it.
        if (r === 0) {
            const input = document.querySelector(`#item-${id} .col-name-input[data-c="${c}"]`);
            if (!input) return;
            input.focus();
            const caret = pos === 'start' ? 0 : input.value.length;
            input.setSelectionRange(caret, caret);
            return;
        }
        // Source-page (static) tables put the actual editable text in a nested `.cell-text`
        // div (so the hover tag-button/pills can live alongside it without being part of the
        // editable content); plain canvas table cards still edit the `<td>` itself directly.
        const el = document.querySelector(`#item-${id} .cell-text[data-r="${r}"][data-c="${c}"]`) || document.querySelector(`#item-${id} td[data-r="${r}"][data-c="${c}"]`);
        if (!el) return;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(pos === 'start');
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    function isCaretAtStart(el) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return false;
        const testRange = range.cloneRange();
        testRange.selectNodeContents(el);
        testRange.setEnd(range.startContainer, range.startOffset);
        return testRange.toString().length === 0;
    }
    function isCaretAtEnd(el) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return false;
        const testRange = range.cloneRange();
        testRange.selectNodeContents(el);
        testRange.setStart(range.endContainer, range.endOffset);
        return testRange.toString().length === 0;
    }
    function handleTableKeydown(e, id, r, c) {
        // Quick cloze markup (see resolveGameFace/hasCloze): highlight a word or phrase inside a
        // source cell and press "[" to wrap it in brackets in place, rather than typing "[" and
        // "]" by hand around the caret. Only intercepts when there's an actual (non-collapsed)
        // selection — a plain "[" keystroke with just a caret still types a literal bracket.
        if (e.key === '[') {
            const sel = window.getSelection();
            const el = e.currentTarget;
            if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
                e.preventDefault();
                const range = sel.getRangeAt(0);
                const wrapped = document.createTextNode('[' + range.toString() + ']');
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
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                document.execCommand('insertLineBreak');
                return;
            }
            const it = findItemById(id); if (!it) return;
            const isStaticTable = !!e.currentTarget.closest('.static-table');
            if (isStaticTable) {
                const numCols = it.tableData[0].length;
                let nr = r, nc = c + 1;
                if (nc >= numCols) { nc = 0; nr = r + 1; }
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
        const arrowDeltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        const delta = arrowDeltas[e.key];
        if (!delta) return;
        if (e.shiftKey) return; 
        const el = e.currentTarget;
        if (e.key === 'ArrowLeft' && !isCaretAtStart(el)) return;
        if (e.key === 'ArrowRight' && !isCaretAtEnd(el)) return;
        const it = findItemById(id); if (!it) return;
        const [dr, dc] = delta;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= it.tableData.length || nc < 0 || nc >= it.tableData[0].length) return;
        e.preventDefault();
        focusTableCell(id, nr, nc, e.key === 'ArrowLeft' ? 'end' : 'start');
    }
    function addTableRow(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tableData.push(new Array(it.tableData[0].length).fill(''));
        render();
        // Jump the table's own vertical scroller all the way down so the freshly added
        // (empty) row is immediately visible instead of staying scrolled off-screen.
        const tableRounded = document.querySelector(`#item-${id} .table-rounded`);
        if (tableRounded) tableRounded.scrollTop = tableRounded.scrollHeight;
    }
    function addTableCol(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tableData.forEach(row => row.push(''));
        render();
        // Jump the shared horizontal scroller all the way right so the freshly added
        // (empty) column is immediately visible instead of staying scrolled off-screen.
        const hscroll = document.querySelector(`#item-${id} .static-table-hscroll`);
        if (hscroll) hscroll.scrollLeft = hscroll.scrollWidth;
    }

    // ---------- Source page: insert image/audio into the focused cell ----------
    function setLastFocusedCell(id, r, c) { appState.lastFocusedCell = { id, r, c }; }
    // Appends HTML (an <img>/<audio> tag) to whichever data cell last had focus. Works even
    // if focus has since moved to the toolbar button that triggered the insert, since it goes
    // straight through the DOM + tableData rather than relying on a live text-selection/caret.
    function insertIntoActiveCell(html) {
        // lastFocusedCell can go stale (e.g. the user switched to a different source page
        // without focusing a cell there yet) — findItemById is scoped to the *current* folder,
        // so this also catches that case rather than silently doing nothing.
        const it = appState.lastFocusedCell && findItemById(appState.lastFocusedCell.id);
        const { r, c } = appState.lastFocusedCell || {};
        if (!it || !it.tableData[r] || it.tableData[r][c] == null) {
            alert('Click into a cell first, then use Add to insert an image or audio clip there.');
            return;
        }
        const id = appState.lastFocusedCell.id;
        saveSnapshot();
        const td = document.querySelector(`#item-${id} .cell-text[data-r="${r}"][data-c="${c}"]`);
        if (td) {
            td.insertAdjacentHTML('beforeend', html);
            it.tableData[r][c] = td.innerHTML;
        } else {
            it.tableData[r][c] = (it.tableData[r][c] || '') + html;
            render();
        }
    }
    function triggerCellImageUpload() {
        closeSourceAddMenu();
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = () => insertIntoActiveCell(`<img class="cell-media-img" src="${reader.result}">`);
            reader.readAsDataURL(file);
        };
        input.click();
    }
    function triggerCellAudioUpload() {
        closeSourceAddMenu();
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'audio/*';
        input.onchange = () => {
            const file = input.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = () => insertIntoActiveCell(`<audio class="cell-media-audio" controls src="${reader.result}"></audio>`);
            reader.readAsDataURL(file);
        };
        input.click();
    }
    function startCellAudioRecording() {
        closeSourceAddMenu();
        if (!appState.lastFocusedCell || !findItemById(appState.lastFocusedCell.id)) { alert('Click into a cell first, then use Audio > Record.'); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Microphone recording isn\'t supported in this browser.'); return; }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            appState.cellAudioChunks = [];
            appState.cellAudioRecorder = new MediaRecorder(stream);
            appState.cellAudioRecorder.ondataavailable = (e) => { if (e.data && e.data.size) appState.cellAudioChunks.push(e.data); };
            appState.cellAudioRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                appState.audioRecordIndicator.classList.remove('recording');
                const blob = new Blob(appState.cellAudioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => insertIntoActiveCell(`<audio class="cell-media-audio" controls src="${reader.result}"></audio>`);
                reader.readAsDataURL(blob);
            };
            appState.cellAudioRecorder.start();
            appState.audioRecordIndicator.classList.add('recording');
        }).catch(() => alert('Microphone access was denied or is unavailable.'));
    }
    function stopCellAudioRecording() {
        if (appState.cellAudioRecorder && appState.cellAudioRecorder.state !== 'inactive') appState.cellAudioRecorder.stop();
    }

    // ---------- Source page: import a file (merges new rows into the source's table) ----------
    // Small hand-rolled CSV/TSV parser: handles quoted fields (including escaped "" and
    // embedded delimiters/newlines) without pulling in an external library.
    function parseDelimited(text, delim) {
        const rows = [];
        let row = [], field = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
                else field += ch;
            } else if (ch === '"') inQuotes = true;
            else if (ch === delim) { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (ch === '\r') { /* skip, \n (or the loop end) closes the row */ }
            else field += ch;
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }
        return rows.filter(r => r.some(c => c.trim() !== ''));
    }
    // Imports a CSV/TSV's rows into the current source table by column *name*, not position:
    // the file's own first line is taken as its header row, matched case-insensitively (and
    // trimmed) against the existing table's column names. Matched columns land their values in
    // the right place as brand-new rows; existing columns the file doesn't mention are simply
    // left blank on those new rows; and any file column that doesn't match an existing one gets
    // appended as a brand-new column (named after the file's header), with every row that came
    // before it left blank in that column.
    //
    // The exception is scaffolding the table already has lying around empty: this is judged
    // per column and per row, not as an all-or-nothing "is the whole table blank" check. A
    // column only gets claimed-and-renamed by an unmatched file column if it's both nameless
    // (still showing its "Column N" placeholder) AND every single one of its existing cells is
    // blank — one filled-in cell anywhere in that column takes it out of the running, and a
    // brand-new column is appended instead. Likewise, an existing row is only filled in place
    // if EVERY cell in it is blank; a row with data in even one cell is left completely alone,
    // and file rows keep going to brand-new rows appended at the end once the genuinely blank
    // rows run out.
    function importDelimitedIntoSource(text, delim) {
        const rows = parseDelimited(text, delim);
        if (!rows.length) { alert('No data found in that file.'); return; }
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !folderObj.isSource) return;
        const csvHeader = rows[0].map(h => (h || '').trim());
        const csvDataRows = rows.length > 1 ? rows.slice(1) : [];
        if (!csvDataRows.length) { alert('No data rows found in that file (only a header row).'); return; }
        saveSnapshot();
        let tableItem = folderObj.items.find(i => i.kind === 'table');
        if (!tableItem) {
            // No existing table yet — the file's own headers become the new table's columns
            // outright, in the order they appear in the file.
            tableItem = { id: appState.idCounter++, x: 0, y: 0, w: 0, h: 0, kind: 'table', tableData: [csvHeader.slice()] };
            folderObj.items.push(tableItem);
        }
        const isCellEmpty = c => !(c || '').trim();
        const existingHeader = tableItem.tableData[0];
        const existingDataRows = tableItem.tableData.slice(1);
        // Column-by-column: is every existing cell in this column (across all current data
        // rows) blank? Computed once, up front, off the table as it stood before this import
        // touches anything.
        const columnIsEmpty = existingHeader.map((_, ci) => existingDataRows.every(row => isCellEmpty(row[ci])));
        const normalize = s => (s || '').trim().toLowerCase();
        const existingIndexByName = new Map();
        existingHeader.forEach((name, i) => {
            const key = normalize(name);
            if (key && !existingIndexByName.has(key)) existingIndexByName.set(key, i);
        });
        // Column slots up for grabs by an unmatched file column: nameless AND entirely empty
        // of data so far, in left-to-right order.
        const unnamedSlots = existingHeader.reduce((acc, name, i) => {
            if (!normalize(name) && columnIsEmpty[i]) acc.push(i);
            return acc;
        }, []);
        let unnamedSlotPtr = 0;
        // Map every column in the *file* to a column index in the table: reuse a matching
        // existing column by name; failing that, claim the next eligible unnamed-and-empty
        // slot; failing that, grow the table with a brand-new column named after this file
        // header. Growing the table means pushing a blank cell onto every row that already
        // exists (the header row itself was just grown by name), so the table stays
        // rectangular.
        const csvColToTargetIndex = csvHeader.map((name) => {
            const key = normalize(name);
            if (key && existingIndexByName.has(key)) return existingIndexByName.get(key);
            if (unnamedSlotPtr < unnamedSlots.length) {
                const reuseIndex = unnamedSlots[unnamedSlotPtr++];
                existingHeader[reuseIndex] = name;
                if (key) existingIndexByName.set(key, reuseIndex);
                return reuseIndex;
            }
            const newIndex = existingHeader.length;
            existingHeader.push(name);
            if (key) existingIndexByName.set(key, newIndex);
            tableItem.tableData.forEach((row, ri) => { if (ri > 0) row.push(''); });
            return newIndex;
        });
        const width = tableItem.tableData[0].length;
        const newRows = csvDataRows.map(csvRow => {
            const out = new Array(width).fill('');
            csvRow.forEach((cell, ci) => {
                const targetIndex = csvColToTargetIndex[ci];
                if (targetIndex !== undefined) out[targetIndex] = cell;
            });
            return out;
        });
        // Fill existing rows that are entirely blank, in order, before appending anything new
        // — rows with any real content in them are skipped over and left completely alone.
        let ni = 0;
        for (let ri = 1; ri < tableItem.tableData.length && ni < newRows.length; ri++) {
            if (tableItem.tableData[ri].every(isCellEmpty)) {
                tableItem.tableData[ri] = newRows[ni];
                ni++;
            }
        }
        if (ni < newRows.length) tableItem.tableData.push(...newRows.slice(ni));
        render();
    }

export { addTableCol, addTableRow, attachStaticTableHoverZones, colgroupHTML, distributeTableSizing, handleColNameKeydown, handleTableKeydown, importDelimitedIntoSource, layoutSourceTableColumns, renameTableColumn, renderStaticTableHTML, renderTableHTML, setLastFocusedCell, startCellAudioRecording, stopCellAudioRecording, triggerCellAudioUpload, triggerCellImageUpload, updateTableCell };

// React → vanilla bridge (see the identical pattern/comment in cards-misc.js) — used by
// TableCard.jsx (app/dotto/), which can't import this directly since public/dotto/*.js isn't
// reachable from app/dotto/.
window.__distributeTableSizing = distributeTableSizing;
