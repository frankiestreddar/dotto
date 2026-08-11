import { clearSearch } from './ai-assistant-suggestions.js';
import { closeAddMenu } from './copy-paste.js';
import { appState } from './core-state.js';
import { closeCollabPanel } from './friends-presence.js';
import { renderHubCollabList, renderWaypointsList } from './hamburger-collab.js';
import { closeCartPanel } from './marketplace.js';
import { closeMessagesPanel } from './messages-schedule.js';
import { closeProfilePanel } from './profile-achievements-pricing.js';
import { buildOutline } from './shared-canvases-outline.js';
import { closeSourceAddMenu } from './source-buttons-cursor-mode.js';


    // ---------- Hover/Pin Panel Helper ----------
    // Panels can be opened two ways: hovering the trigger button opens them temporarily
    // (closing again once the pointer leaves both the button and the panel), while
    // clicking the trigger button "pins" the panel open until the user clicks elsewhere
    // on the canvas. Only one panel is ever open at a time - opening any panel (via
    // hover or click) swaps out whichever panel was previously open.
    function scheduleHoverClose(name, hoverEls, closeFn) {
        setTimeout(() => {
            if (appState.panelPinned[name]) return;
            const stillOver = hoverEls.some(el => el && el.matches(':hover'));
            if (!stillOver) closeFn();
        }, 80);
    }
    // A panel that only opened via hover (never pinned by clicking its trigger button) still
    // closes as soon as the pointer leaves it — but clicking ANYTHING inside it promotes it to
    // pinned right then, same as if the trigger button itself had been clicked, so it now stays
    // open until an outside click/Escape instead of closing on mouseleave. Capture phase so this
    // fires before whatever the click itself does (including a handler that closes the panel,
    // e.g. a menu action — pinning a panel the same tick it closes is harmless). Not wired up for
    // #add-menu/#source-add-menu, which are getting different, separate treatment.
    function pinOnInsideClick(name, els) {
        els.forEach(el => {
            if (!el) return;
            el.addEventListener('click', () => { appState.panelPinned[name] = true; }, true);
        });
    }
    function closeAllPanels(except) {
        if (except !== 'menu') closeHamburgerMenu();
        if (except !== 'messages') closeMessagesPanel();
        if (except !== 'cart') closeCartPanel();
        if (except !== 'profile') closeProfilePanel();
        if (except !== 'add') closeAddMenu();
        if (except !== 'collab') closeCollabPanel();
        if (except !== 'sourceAdd') closeSourceAddMenu();
    }

    // ---------- Hamburger Menu Controls ----------
    // Each of these is its own separate view of the same menu (see openWaypointsPanel /
    // openHubCollabPanel below) — closing the hamburger by any existing path (outside click,
    // Escape, re-clicking the button) needs to close whichever one is actually showing, so all are
    // reset here alongside #account-menu/#outline-menu rather than needing their own separate
    // close path. Named hub-collab (not just "collab") to avoid colliding with the pre-existing
    // #collab-panel/collabPanel (the per-canvas "add a collaborator" flyout off the top bar) — a
    // completely different feature that happens to share the English word.
    // hmenu-full is what distinguishes the two shapes the panel can take (see #hamburger-stack's
    // own comment, globals.css): a full-height sidebar pinned open by a click (square corners,
    // one continuous shell, #btn-menu's icon swaps) vs. a short hover preview that leaves the top
    // bar completely alone. Applied to both the panel and the button together since each one's
    // CSS keys off it independently — the panel's own shape, and the button's icon swap.
    function closeHamburgerMenu() {
        appState.outlineMenu.classList.remove('open');
        appState.accountMenu.classList.remove('open');
        appState.hubSubpanels.forEach(p => p.classList.remove('open'));
        appState.hamburgerBtn.classList.remove('active');
        appState.hamburgerStack.classList.remove('open', 'hmenu-full');
        appState.hamburgerBtn.classList.remove('hmenu-full');
        appState.panelPinned.menu = false;
    }
    function openHamburgerMenu(pin) {
        closeAllPanels('menu');
        clearSearch();
        appState.outlineMenu.classList.add('open');
        appState.accountMenu.classList.add('open');
        appState.hamburgerBtn.classList.add('active');
        appState.hamburgerStack.classList.add('open');
        buildOutline();
        if (pin) {
            appState.panelPinned.menu = true;
            appState.hamburgerStack.classList.add('hmenu-full');
            appState.hamburgerBtn.classList.add('hmenu-full');
        }
    }
    appState.hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (appState.panelPinned.menu) { closeHamburgerMenu(); }
        else { openHamburgerMenu(true); }
    });
    appState.hamburgerBtn.addEventListener('mouseenter', () => { if (!appState.outlineMenu.classList.contains('open') && !appState.hubSubpanels.some(p => p.classList.contains('open'))) openHamburgerMenu(false); });
    appState.hamburgerBtn.addEventListener('mouseleave', () => scheduleHoverClose('menu', appState.hamburgerHoverEls, closeHamburgerMenu));
    appState.outlineMenu.addEventListener('mouseleave', () => scheduleHoverClose('menu', appState.hamburgerHoverEls, closeHamburgerMenu));
    appState.accountMenu.addEventListener('mouseleave', () => scheduleHoverClose('menu', appState.hamburgerHoverEls, closeHamburgerMenu));
    appState.hubSubpanels.forEach(p => p.addEventListener('mouseleave', () => scheduleHoverClose('menu', appState.hamburgerHoverEls, closeHamburgerMenu)));
    pinOnInsideClick('menu', [appState.outlineMenu, appState.accountMenu, ...appState.hubSubpanels]);
    document.getElementById('hamburger-stack').addEventListener('click', (e) => e.stopPropagation());
    // Notion-style edge peek: hovering the leftmost 20px of the whole screen previews the menu,
    // not just hovering the button. A real hit-target element the same width would sit in front
    // of the canvas and silently block clicks/drags on any card panned into that strip, so this
    // tracks pointer position passively instead (same idea as the cursor-broadcast pointermove
    // listener in history-autosave.js) — nothing here ever intercepts a pointer event. Edge-
    // triggered (only acts when crossing the 20px line, not on every pointermove past it), and
    // reuses the exact same guard the button's own mouseenter uses so hovering the edge while a
    // sub-panel (Waypoints/Collaborations) is already open doesn't reset it back to the main view.
    let nearLeftEdge = false;
    window.addEventListener('pointermove', (e) => {
        const inZone = e.clientX < 20;
        if (inZone === nearLeftEdge) return;
        nearLeftEdge = inZone;
        if (inZone) {
            if (!appState.outlineMenu.classList.contains('open') && !appState.hubSubpanels.some(p => p.classList.contains('open'))) openHamburgerMenu(false);
        } else {
            scheduleHoverClose('menu', appState.hamburgerHoverEls, closeHamburgerMenu);
        }
    });
    // Shared by the three open*Panel functions below — swaps #account-menu/#outline-menu out for
    // just the one requested panel. Always pins (a sub-panel is only ever reached by clicking an
    // #account-menu row, which requires the sidebar to already be open) — see openWaypointsPanel/
    // openHubCollabPanel below.
    function openHubSubpanel(panel, searchInputEl, renderFn) {
        appState.outlineMenu.classList.remove('open');
        appState.accountMenu.classList.remove('open');
        appState.hubSubpanels.forEach(p => { if (p !== panel) p.classList.remove('open'); });
        panel.classList.add('open');
        appState.hamburgerBtn.classList.add('active');
        appState.hamburgerStack.classList.add('open', 'hmenu-full');
        appState.hamburgerBtn.classList.add('hmenu-full');
        appState.panelPinned.menu = true;
        searchInputEl.value = '';
        renderFn('');
    }
    function openWaypointsPanel() { openHubSubpanel(appState.waypointsPanel, appState.waypointsSearchInput, renderWaypointsList); }
    function openHubCollabPanel() {
        appState.hubCollabView = 'main'; // always land on the main list, never mid-Requests from last time
        openHubSubpanel(appState.hubCollabPanel, appState.hubCollabSearchInput, renderHubCollabList);
    }
    function handleWaypointsSearch(v) { renderWaypointsList(v); }
    function handleHubCollabSearch(v) { renderHubCollabList(v); }

export { closeAllPanels, closeHamburgerMenu, handleHubCollabSearch, handleWaypointsSearch, openHubCollabPanel, openWaypointsPanel, pinOnInsideClick, scheduleHoverClose };
