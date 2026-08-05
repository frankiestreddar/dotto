import { clearSearch } from './ai-assistant-suggestions.js';
import { closeAddMenu } from './copy-paste.js';
import { appState } from './core-state.js';
import { closeCollabPanel } from './friends-presence.js';
import { renderHubCollabList, renderWaypointsList } from './hamburger-collab.js';
import { closeCartPanel } from './marketplace.js';
import { closeMessagesPanel } from './messages-schedule.js';
import { closeProfilePanel } from './profile-achievements-pricing.js';
import { buildOutline, closeBreadcrumbMapPanel } from './shared-canvases-outline.js';
import { closeSourceAddMenu } from './source-buttons-cursor-mode.js';


    // ---------- Hover/Pin Panel Helper ----------
    // Panels can be opened two ways: hovering the trigger button opens them temporarily
    // (closing again once the pointer leaves both the button and the panel), while
    // clicking the trigger button "pins" the panel open until the user clicks elsewhere
    // on the canvas. Only one panel is ever open at a time - opening any panel (via
    // hover or click) swaps out whichever panel was previously open.
    const panelPinned = { menu: false, messages: false, cart: false, add: false, profile: false, collab: false, sourceAdd: false, breadcrumbMap: false };
    function scheduleHoverClose(name, hoverEls, closeFn) {
        setTimeout(() => {
            if (panelPinned[name]) return;
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
            el.addEventListener('click', () => { panelPinned[name] = true; }, true);
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
        if (except !== 'breadcrumbMap') closeBreadcrumbMapPanel();
    }

    // ---------- Hamburger Menu Controls ----------
    const hamburgerBtn = document.getElementById('btn-menu'), outlineMenu = document.getElementById('outline-menu'), accountMenu = document.getElementById('account-menu'), hamburgerStack = document.getElementById('hamburger-stack');
    // Each of these is its own separate view of the same menu (see openWaypointsPanel /
    // openHubCollabPanel below) — closing the hamburger by any existing path (outside click,
    // Escape, re-clicking the button) needs to close whichever one is actually showing, so all are
    // reset here alongside #account-menu/#outline-menu rather than needing their own separate
    // close path. Named hub-collab (not just "collab") to avoid colliding with the pre-existing
    // #collab-panel/collabPanel (the per-canvas "add a collaborator" flyout off the top bar) — a
    // completely different feature that happens to share the English word.
    const waypointsPanel = document.getElementById('waypoints-panel'), waypointsSearchInput = document.getElementById('waypoints-search');
    const hubCollabPanel = document.getElementById('hub-collab-panel'), hubCollabSearchInput = document.getElementById('hub-collab-search');
    const hubSubpanels = [waypointsPanel, hubCollabPanel];
    function closeHamburgerMenu() {
        outlineMenu.classList.remove('open');
        accountMenu.classList.remove('open');
        hubSubpanels.forEach(p => p.classList.remove('open'));
        hamburgerBtn.classList.remove('active');
        panelPinned.menu = false;
    }
    function positionHamburgerMenu() {
        const rect = hamburgerBtn.getBoundingClientRect();
        hamburgerStack.style.top = (rect.bottom + 10) + 'px';
        const stackWidth = 240;
        let leftPos = rect.left;
        if (leftPos + stackWidth > window.innerWidth - 20) leftPos = window.innerWidth - stackWidth - 20;
        if (leftPos < 20) leftPos = 20;
        hamburgerStack.style.left = leftPos + 'px';
        hamburgerStack.style.right = 'auto';
    }
    function openHamburgerMenu(pin) {
        closeAllPanels('menu');
        clearSearch();
        outlineMenu.classList.add('open');
        accountMenu.classList.add('open');
        hamburgerBtn.classList.add('active');
        buildOutline();
        positionHamburgerMenu();
        if (pin) panelPinned.menu = true;
    }
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelPinned.menu) { closeHamburgerMenu(); }
        else { openHamburgerMenu(true); }
    });
    const hamburgerHoverEls = [hamburgerBtn, outlineMenu, accountMenu, ...hubSubpanels];
    hamburgerBtn.addEventListener('mouseenter', () => { if (!outlineMenu.classList.contains('open') && !hubSubpanels.some(p => p.classList.contains('open'))) openHamburgerMenu(false); });
    hamburgerBtn.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu));
    outlineMenu.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu));
    accountMenu.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu));
    hubSubpanels.forEach(p => p.addEventListener('mouseleave', () => scheduleHoverClose('menu', hamburgerHoverEls, closeHamburgerMenu)));
    pinOnInsideClick('menu', [outlineMenu, accountMenu, ...hubSubpanels]);
    document.getElementById('hamburger-stack').addEventListener('click', (e) => e.stopPropagation());
    // Shared by the three open*Panel functions below — swaps #account-menu/#outline-menu out for
    // just the one requested panel.
    function openHubSubpanel(panel, searchInputEl, renderFn) {
        outlineMenu.classList.remove('open');
        accountMenu.classList.remove('open');
        hubSubpanels.forEach(p => { if (p !== panel) p.classList.remove('open'); });
        panel.classList.add('open');
        hamburgerBtn.classList.add('active');
        positionHamburgerMenu();
        panelPinned.menu = true;
        searchInputEl.value = '';
        renderFn('');
    }
    function openWaypointsPanel() { openHubSubpanel(waypointsPanel, waypointsSearchInput, renderWaypointsList); }
    function openHubCollabPanel() {
        appState.hubCollabView = 'main'; // always land on the main list, never mid-Requests from last time
        openHubSubpanel(hubCollabPanel, hubCollabSearchInput, renderHubCollabList);
    }
    function handleWaypointsSearch(v) { renderWaypointsList(v); }
    function handleHubCollabSearch(v) { renderHubCollabList(v); }

export { accountMenu, closeAllPanels, closeHamburgerMenu, hamburgerBtn, handleHubCollabSearch, handleWaypointsSearch, hubCollabSearchInput, openHubCollabPanel, openWaypointsPanel, outlineMenu, panelPinned, pinOnInsideClick, scheduleHoverClose };
