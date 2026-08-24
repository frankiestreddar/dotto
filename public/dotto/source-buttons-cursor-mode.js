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
            appState.modeToolbar.classList.remove('expanded');
            applyCursorMode();
        });
    });
    appState.modeToolbar.addEventListener('mouseenter', () => { appState.modeToolbar.classList.add('expanded'); updateModeToolbarUI(); });
    appState.modeToolbar.addEventListener('mouseleave', () => { appState.modeToolbar.classList.remove('expanded'); updateModeToolbarUI(); });

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

    // Re-run the source table's column sizing whenever the window resizes, since column
    // widths are derived from the (viewport-based) rendered width of the table container.
    window.addEventListener('resize', () => {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !folderObj.isSource) return;
        const tableItem = folderObj.items.find(i => i.kind === 'table');
        const el = document.querySelector('.item.static-table');
        if (tableItem && el) layoutSourceTableColumns(tableItem, el);
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
        appState.modeToolbar.classList.remove('expanded');
        updateModeToolbarUI();
    };

export { applyCursorMode, closeSourceAddMenu, openCellAddMenu };
