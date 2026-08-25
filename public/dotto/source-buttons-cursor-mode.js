import { appState, canvas, contextMenu, drawSettings, effectiveMode } from './core-state.js';
import { linkSelectedCards } from './drawing-connections.js';
import { closeCollabPanel } from './friends-presence.js';
import { dispatchListPanelDelete } from './hamburger-collab.js';
import { hideCanvasContextMenu } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { closeAllPanels } from './panels-hamburger.js';
import { deleteSelectedCards } from './resize-shortcuts-init.js';
import { layoutSourceTableColumns } from './source-table.js';
import { closeCellTagPicker } from './source-tags-ai.js';
import { clearDataLinkPending } from './srs-connections-core.js';


    // ---------- Source page: per-cell Add / Upload / Tags buttons (hover-only, no global toolbars) ----------
    function closeSourceAddMenu() { appState.sourceAddMenu.style.display = 'none'; appState.panelPinned.sourceAdd = false; }
    // Opens the Add (image/audio) menu anchored to the specific cell's button that was
    // clicked, and remembers that cell as the target for the insert actions below.
    function openCellAddMenu(id, r, c, btnEl) {
        const it = findItemById(id); if (!it) return;
        // 'rail' — a click on a cell's own Add button is exactly the kind of "clicked elsewhere
        // on the canvas" interaction that must no longer close an open rail panel (see
        // window.onclick's own comment below).
        closeAllPanels('rail');
        closeCellTagPicker();
        appState.lastFocusedCell = { id, r, c };
        const rect = btnEl.getBoundingClientRect();
        appState.sourceAddMenu.style.left = Math.min(rect.left, window.innerWidth - 190) + 'px';
        appState.sourceAddMenu.style.top = (rect.bottom + 6) + 'px';
        appState.sourceAddMenu.style.display = 'flex';
        appState.panelPinned.sourceAdd = true;
    }

    // ---------- Cursor mode toolbar (normal / data / select / pen) ----------
    function updateModeToolbarUI() {
        const eff = effectiveMode();
        appState.modeButtons.forEach(b => {
            b.classList.toggle('mode-visible', b.dataset.mode === eff);
            b.classList.toggle('active', b.dataset.mode === appState.cardMode);
            // Keep whichever mode is currently pinned anchored at the bottom (order 99 — higher
            // than any natural MODE_ORDER_WEIGHT value, so a future mode's own weight can never
            // collide with this pin), so expanding the pill always grows upward from the same spot.
            b.style.order = b.dataset.mode === appState.cardMode ? '99' : String(appState.MODE_ORDER_WEIGHT[b.dataset.mode]);
        });
        // #mode-popup's own rows (top-bar.html) — per explicit follow-up request the active row no
        // longer sorts to the top; all four always stay in their fixed DOM order, only the
        // highlight moves.
        appState.modePopupRows.forEach(row => {
            row.classList.toggle('active', row.dataset.mode === appState.cardMode);
        });
    }
    // Even-odd ray-casting point-in-polygon test (Jordan curve theorem) — generic over any vertex
    // count, used below for the mode popup's "safe zone" quadrilateral.
    function pointInPolygon(x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    // The "safe zone" quadrilateral covering every straight-line path from anywhere in the
    // mode-toolbar button to anywhere on the popup's own left edge — toolbar's left corners paired
    // with the popup's near corners, live-measured so it tracks either element's actual current
    // size/position rather than any hardcoded pixel guess. Per explicit follow-up request/
    // screenshot: cutting diagonally from the toolbar toward a lower popup row (e.g. Pen mode)
    // used to cross dead space or another rail button's hitbox partway through and close the
    // popup early — this is what lets that diagonal path stay "inside" the whole way.
    function modePopupSafeZone() {
        const t = appState.modeToolbar.getBoundingClientRect();
        const p = appState.modePopup.getBoundingClientRect();
        return [[t.left, t.top], [p.left, p.top], [p.left, p.bottom], [t.left, t.bottom]];
    }
    let modePopupSafeZoneActive = false;
    function handleModePopupSafeMove(e) {
        if (!appState.modeToolbar.classList.contains('expanded')) { stopModePopupSafeZone(); return; }
        if (appState.modeToolbar.contains(e.target)) { stopModePopupSafeZone(); return; } // back over it for real — nothing left to track
        // Landing on another rail button's own hitbox closes the popup outright, even inside the
        // safe zone below — per explicit request that hovering another icon still closes it. Only
        // its real (possibly tightened, see #btn-inbox/#rail-btn-ai, globals.css) hitbox counts as
        // "landing on" it, not just passing near its visual footprint.
        const otherBtn = e.target.closest && e.target.closest('.rail-btn');
        if (otherBtn && !appState.modeToolbar.contains(otherBtn)) { closeModePopup(); return; }
        if (!pointInPolygon(e.clientX, e.clientY, modePopupSafeZone())) closeModePopup();
    }
    function startModePopupSafeZone() {
        if (modePopupSafeZoneActive) return;
        modePopupSafeZoneActive = true;
        document.addEventListener('mousemove', handleModePopupSafeMove);
    }
    function stopModePopupSafeZone() {
        if (!modePopupSafeZoneActive) return;
        modePopupSafeZoneActive = false;
        document.removeEventListener('mousemove', handleModePopupSafeMove);
    }
    function closeModePopup() {
        stopModePopupSafeZone();
        appState.modeToolbar.classList.remove('expanded');
        updateModeToolbarUI();
    }
    function applyCursorMode() {
        const eff = effectiveMode();
        canvas.classList.toggle('mode-data', eff === 'data');
        canvas.classList.toggle('mode-select', eff === 'select');
        canvas.classList.toggle('mode-pen', eff === 'pen');
        // Leaving data mode (for any reason — toolbar click, D/Escape/Shift override) always
        // cancels a half-made click-to-link selection rather than letting it linger and
        // potentially link two unrelated cards later when data mode is re-entered.
        if (eff !== 'data') clearDataLinkPending();
        // #draw-settings (color/size/pen-eraser/front-back — see draw-settings.html) is pen
        // mode's own settings bar, shown only while pen mode is actually active — was gated on
        // the old appState.drawMode boolean via setDrawMode, now folded into this same function
        // every other mode's own canvas-class toggling already goes through.
        drawSettings.style.display = eff === 'pen' ? 'flex' : 'none';
        updateModeToolbarUI();
    }
    appState.modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.cardMode = btn.dataset.mode;
            closeModePopup();
            applyCursorMode();
        });
    });
    // Same click behavior as the .mode-btn handler just above, wired separately since
    // #mode-popup's rows (top-bar.html) are their own distinct elements, not the rail button.
    appState.modePopupRows.forEach(row => {
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.cardMode = row.dataset.mode;
            closeModePopup();
            applyCursorMode();
        });
    });
    appState.modeToolbar.addEventListener('mouseenter', () => { stopModePopupSafeZone(); appState.modeToolbar.classList.add('expanded'); updateModeToolbarUI(); });
    // Doesn't close outright — starts the safe-zone tracker (above) instead, which closes for real
    // once the pointer actually leaves that zone (or lands on another rail button), rather than the
    // instant the pointer leaves the toolbar's own small box.
    appState.modeToolbar.addEventListener('mouseleave', () => { startModePopupSafeZone(); });

    // D / Escape / Shift each work as both a quick switch and a temporary (held) override for
    // the three cursor modes (Data / Normal / Select respectively): pressing and releasing one
    // within MODE_HOLD_THRESHOLD_MS counts as a tap and switches to that mode for good, exactly
    // like clicking its toolbar button — the same as it would happen anyway from the immediate
    // keydown-triggered override, just made to stick around after keyup instead of reverting.
    // Holding it past that threshold keeps it a temporary override, reverting back to whatever
    // mode was active before the key went down the moment it's released. Option/Alt+drag is
    // reserved separately for duplicating cards, so D/Shift are ignored while actively typing in
    // a text field (Escape never types a character, so it's exempt from that check — same as its
    // other, unrelated "close everything" behavior above), and D/Shift both bail out while a
    // meta/ctrl modifier is held so they don't hijack unrelated shortcuts (e.g. Cmd+Z for undo).
    function beginModeOverride(key) {
        if (appState.modeOverrideKey === key) return;
        appState.modeOverrideKey = key;
        appState.modeKeyHoldStart = Date.now();
        applyCursorMode();
    }
    function endModeOverride(key, mode) {
        if (appState.modeOverrideKey !== key) return;
        const elapsed = appState.modeKeyHoldStart !== null ? Date.now() - appState.modeKeyHoldStart : Infinity;
        appState.modeOverrideKey = null;
        appState.modeKeyHoldStart = null;
        if (elapsed < appState.MODE_HOLD_THRESHOLD_MS) appState.cardMode = mode; // quick tap — make the switch stick
        applyCursorMode();
    }
    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
        // Shift+X: a discrete shortcut (not a held-mode override) that links the current
        // multi-selection. Handled first so it never falls through into the Normal-mode
        // override logic below and briefly flips the cursor away from Data-linking context.
        if (!isEditingText && e.shiftKey && (e.key === 'x' || e.key === 'X') && appState.selectedCardIds.length >= 2) {
            e.preventDefault();
            linkSelectedCards();
            return;
        }
        // Deletes whatever's currently selected. List-panel selection (Chats/Waypoints/
        // Collaborations, shift-click — see toggleListPanelSelection, hamburger-collab.js) is
        // checked FIRST and, if present, wins outright: opening the hamburger menu doesn't clear
        // an existing canvas-card selection, so both could genuinely be non-empty at once (e.g.
        // select some cards, then open the menu and shift-click a chat row) — without this
        // ordering a bare Backspace would fire both deletions. Canvas-card selection (shift-click
        // or select-cursor-mode click — see setupDraggingAndClicking) is the only way to delete a
        // card now that the per-card right-click "Delete" menu item is gone.
        if (!isEditingText && e.key === 'Backspace') {
            const sel = appState.listPanelSelection;
            if (sel.panel && sel.ids.size) { e.preventDefault(); dispatchListPanelDelete(sel.panel, Array.from(sel.ids)); return; }
            if (appState.selectedCardIds.length > 0) { e.preventDefault(); deleteSelectedCards(); return; }
        }
        if (!isEditingText && e.key === 'Shift' && !e.metaKey && !e.ctrlKey) { beginModeOverride('shift'); }
        else if (!isEditingText && !e.metaKey && !e.ctrlKey && (e.key === 'd' || e.key === 'D')) { beginModeOverride('d'); }
        else if (e.key === 'Escape') { beginModeOverride('escape'); }
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') endModeOverride('shift', 'select');
        else if (e.key === 'd' || e.key === 'D') endModeOverride('d', 'data');
        else if (e.key === 'Escape') endModeOverride('escape', 'normal');
    });
    window.addEventListener('blur', () => { if (appState.modeOverrideKey) { appState.modeOverrideKey = null; appState.modeKeyHoldStart = null; applyCursorMode(); } });

    // Re-run the source table's column sizing whenever its container's rendered width actually
    // changes, since column widths are derived from it (layoutSourceTableColumns). Shared by two
    // genuinely different triggers: a real window resize, and a rail panel opening/closing (which
    // now also changes the table's available width — see .item.static-table's own
    // body:has(#hamburger-stack.open) override, globals.css — but is a pure CSS transition with
    // no resize event of its own to hook).
    function relayoutSourceTableIfVisible() {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !folderObj.isSource) return;
        const tableItem = folderObj.items.find(i => i.kind === 'table');
        const el = document.querySelector('.item.static-table');
        if (tableItem && el) layoutSourceTableColumns(tableItem, el);
    }
    window.addEventListener('resize', relayoutSourceTableIfVisible);
    // Fires once #canvas's own left/width transition (see its body:has(#hamburger-stack.open)
    // override, globals.css) finishes — not sooner, since reading the container's width mid-
    // transition would just recompute against whatever partial value the animation happened to be
    // at that instant, not the actual end state. e.propertyName is checked so this only reacts
    // once per transition (left and width both finish here, one event each) rather than twice.
    canvas.addEventListener('transitionend', (e) => {
        if (e.target === canvas && e.propertyName === 'width') relayoutSourceTableIfVisible();
    });

    // Deliberately does NOT close the #hamburger-stack rail panel (Search/Outline/Waypoints/
    // Collaborations/Marketplace/Library/Messages/Sources/Files/Queries/Profile/Add) — per
    // explicit request, a rail panel now only closes via Escape (closeAllPanels, history-
    // autosave.js) or by clicking its own already-open icon again (wireRailIcon, panels-
    // hamburger.js), never by clicking anywhere else. clearSearch() (ai-assistant-suggestions.js)
    // is omitted for the same reason — despite its generic name, its only effect is closing the
    // Queries/AI rail view specifically (see its own body), which is exactly the behavior being
    // removed here. Everything else this handler closes (the source-add-menu, cell tag picker,
    // canvas/item context menus, the per-canvas collab flyout, the mode-toolbar's hover-expanded
    // state) is unrelated to that rail-panel system and keeps closing on any outside click as
    // before.
    window.onclick = () => {
        closeSourceAddMenu();
        closeCellTagPicker();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        hideCanvasContextMenu();
        closeCollabPanel();
        closeModePopup();
    };

export { applyCursorMode, closeSourceAddMenu, openCellAddMenu };
