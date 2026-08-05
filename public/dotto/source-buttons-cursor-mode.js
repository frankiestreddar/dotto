import { clearSearch } from './ai-assistant-suggestions.js';
import { closeAddMenu } from './copy-paste.js';
import { appState, canvas, contextMenu, effectiveMode } from './core-state.js';
import { linkSelectedCards } from './drawing-connections.js';
import { closeCollabPanel } from './friends-presence.js';
import { hideCanvasContextMenu } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { closeCartPanel } from './marketplace.js';
import { closeMessagesPanel } from './messages-schedule.js';
import { closeAllPanels, closeHamburgerMenu, panelPinned } from './panels-hamburger.js';
import { closeProfilePanel } from './profile-achievements-pricing.js';
import { deleteSelectedCards } from './resize-shortcuts-init.js';
import { closeBreadcrumbMapPanel } from './shared-canvases-outline.js';
import { layoutSourceTableColumns } from './source-table.js';
import { closeCellTagPicker } from './source-tags-ai.js';
import { clearDataLinkPending } from './srs-connections-core.js';


    // ---------- Source page: per-cell Add / Upload / Tags buttons (hover-only, no global toolbars) ----------
    const sourceAddMenu = document.getElementById('source-add-menu');
    const cellTagPicker = document.getElementById('cell-tag-picker');
    const audioRecordIndicator = document.getElementById('audio-record-indicator');
    function closeSourceAddMenu() { sourceAddMenu.style.display = 'none'; panelPinned.sourceAdd = false; }
    // Opens the Add (image/audio) menu anchored to the specific cell's button that was
    // clicked, and remembers that cell as the target for the insert actions below.
    function openCellAddMenu(id, r, c, btnEl) {
        const it = findItemById(id); if (!it) return;
        closeAllPanels(null);
        closeCellTagPicker();
        appState.lastFocusedCell = { id, r, c };
        const rect = btnEl.getBoundingClientRect();
        sourceAddMenu.style.left = Math.min(rect.left, window.innerWidth - 190) + 'px';
        sourceAddMenu.style.top = (rect.bottom + 6) + 'px';
        sourceAddMenu.style.display = 'flex';
        panelPinned.sourceAdd = true;
    }

    // ---------- Cursor mode toolbar (normal / data / select) ----------
    const modeToolbar = document.getElementById('mode-toolbar');
    const scheduleToolbar = document.getElementById('schedule-toolbar');
    const modeButtons = Array.from(modeToolbar.querySelectorAll('.mode-btn'));
    const MODE_ORDER_WEIGHT = { normal: 0, data: 1, select: 2 };
    function updateModeToolbarUI() {
        const eff = effectiveMode();
        modeButtons.forEach(b => {
            b.classList.toggle('mode-visible', b.dataset.mode === eff);
            b.classList.toggle('active', b.dataset.mode === appState.cardMode);
            // Keep whichever mode is currently pinned anchored at the bottom (order 3),
            // so expanding the pill always grows upward from the same spot.
            b.style.order = b.dataset.mode === appState.cardMode ? '3' : String(MODE_ORDER_WEIGHT[b.dataset.mode]);
        });
    }
    function applyCursorMode() {
        const eff = effectiveMode();
        canvas.classList.toggle('mode-data', eff === 'data');
        canvas.classList.toggle('mode-select', eff === 'select');
        // Leaving data mode (for any reason — toolbar click, D/Escape/Shift override) always
        // cancels a half-made click-to-link selection rather than letting it linger and
        // potentially link two unrelated cards later when data mode is re-entered.
        if (eff !== 'data') clearDataLinkPending();
        updateModeToolbarUI();
    }
    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.cardMode = btn.dataset.mode;
            modeToolbar.classList.remove('expanded');
            applyCursorMode();
        });
    });
    modeToolbar.addEventListener('mouseenter', () => { modeToolbar.classList.add('expanded'); updateModeToolbarUI(); });
    modeToolbar.addEventListener('mouseleave', () => { modeToolbar.classList.remove('expanded'); updateModeToolbarUI(); });

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
    const MODE_HOLD_THRESHOLD_MS = 180;
    let modeKeyHoldStart = null;
    function beginModeOverride(key) {
        if (appState.modeOverrideKey === key) return;
        appState.modeOverrideKey = key;
        modeKeyHoldStart = Date.now();
        applyCursorMode();
    }
    function endModeOverride(key, mode) {
        if (appState.modeOverrideKey !== key) return;
        const elapsed = modeKeyHoldStart !== null ? Date.now() - modeKeyHoldStart : Infinity;
        appState.modeOverrideKey = null;
        modeKeyHoldStart = null;
        if (elapsed < MODE_HOLD_THRESHOLD_MS) appState.cardMode = mode; // quick tap — make the switch stick
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
        // Deletes whatever's currently selected (shift-click or select-cursor-mode click — see
        // setupDraggingAndClicking) — the only way to delete a card now that the per-card
        // right-click "Delete" menu item is gone.
        if (!isEditingText && e.key === 'Backspace' && appState.selectedCardIds.length > 0) {
            e.preventDefault();
            deleteSelectedCards();
            return;
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
    window.addEventListener('blur', () => { if (appState.modeOverrideKey) { appState.modeOverrideKey = null; modeKeyHoldStart = null; applyCursorMode(); } });

    // Re-run the source table's column sizing whenever the window resizes, since column
    // widths are derived from the (viewport-based) rendered width of the table container.
    window.addEventListener('resize', () => {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj || !folderObj.isSource) return;
        const tableItem = folderObj.items.find(i => i.kind === 'table');
        const el = document.querySelector('.item.static-table');
        if (tableItem && el) layoutSourceTableColumns(tableItem, el);
    });
    
    window.onclick = () => {
        closeAddMenu();
        closeSourceAddMenu();
        closeCellTagPicker();
        contextMenu.style.display = 'none';
        appState.contextMenuItemId = null;
        hideCanvasContextMenu();
        closeHamburgerMenu();
        closeMessagesPanel();
        closeCartPanel();
        closeProfilePanel();
        closeCollabPanel();
        closeBreadcrumbMapPanel();
        clearSearch();
        modeToolbar.classList.remove('expanded');
        updateModeToolbarUI();
    };

export { applyCursorMode, audioRecordIndicator, cellTagPicker, closeSourceAddMenu, modeToolbar, openCellAddMenu, scheduleToolbar, sourceAddMenu };
