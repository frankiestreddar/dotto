import { refreshAiPanel, resetAiSearchState } from './ai-assistant-suggestions.js';
import { closeAddMenu } from './copy-paste.js';
import { appState } from './core-state.js';
import { closeCollabPanel } from './friends-presence.js';
import { clearListPanelSelection, renderHubCollabList, renderWaypointsList } from './hamburger-collab.js';
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
    // 'rail' covers every panel-style rail icon (see openRailView below) — Marketplace/Messages/
    // Profile/the hamburger outline used to each have their own except-key here ('cart'/
    // 'messages'/'profile'/'menu'); now that they all share one shell there's only one to skip.
    function closeAllPanels(except) {
        if (except !== 'rail') closeRailView();
        if (except !== 'add') closeAddMenu();
        if (except !== 'collab') closeCollabPanel();
        if (except !== 'sourceAdd') closeSourceAddMenu();
    }

    // ---------- Permanent rail: one shared sliding shell, many trigger icons ----------
    // Every panel-style rail icon (outline, Waypoints, Collaborations, Marketplace, Messages,
    // Profile, AI search) shares ONE #hamburger-stack shell and ONE pinned state
    // (appState.panelPinned.rail) — opening any of them closes whichever other one was showing,
    // for free, just by hiding every other railViewEls sibling and un-.active-ing every other
    // railIconBtns entry. hmenu-full is what distinguishes the two shapes the shell can take (see
    // #hamburger-stack's own comment, globals.css): a full-height sidebar pinned open by a click
    // vs. a short hover preview. `onOpen` is that view's own refresh call (renderWaypointsList,
    // buildOutline, refreshAiPanel, etc.), passed the same `pin` this call itself received —
    // called every time, even on a hover preview, so content is never stale.
    // resetAiSearchState (ai-assistant-suggestions.js) is called here specifically when the AI
    // view is the one being navigated AWAY from (activeRailView was 'ai', the new key isn't) —
    // opening AI itself, or re-hovering/re-clicking it while it's already active, must never reset
    // an in-progress conversation. Checked BEFORE activeRailView is reassigned below, since the
    // check needs the OLD value.
    function openRailView(key, viewEl, btn, onOpen, pin) {
        clearListPanelSelection();
        if (appState.activeRailView === 'ai' && key !== 'ai') resetAiSearchState();
        appState.railViewEls.forEach(el => { if (el && el !== viewEl) el.classList.remove('open'); });
        appState.railIconBtns.forEach(b => { if (b && b !== btn) b.classList.remove('active'); });
        viewEl.classList.add('open');
        btn.classList.add('active');
        appState.hamburgerStack.classList.add('open');
        appState.activeRailView = key;
        if (onOpen) onOpen(pin);
        if (pin) {
            appState.panelPinned.rail = true;
            appState.hamburgerStack.classList.add('hmenu-full');
            btn.classList.add('hmenu-full');
        }
    }
    // Same resetAiSearchState reasoning as openRailView above, for the "close the rail entirely"
    // direction (Escape, clicking outside, etc.) — if AI was the view showing, reset it; checked
    // before activeRailView is cleared below.
    function closeRailView() {
        if (appState.activeRailView === 'ai') resetAiSearchState();
        appState.railViewEls.forEach(el => el && el.classList.remove('open'));
        appState.railIconBtns.forEach(b => b && b.classList.remove('active', 'hmenu-full'));
        appState.hamburgerStack.classList.remove('open', 'hmenu-full');
        appState.activeRailView = null;
        appState.panelPinned.rail = false;
        clearListPanelSelection();
    }
    // Wires one rail icon's hover-preview/click-pin behavior — the same three listeners every
    // trigger button in the app already used individually before this (compare the old per-panel
    // wiring that used to live in marketplace.js/messages-schedule.js/profile-achievements-
    // pricing.js), now written once instead of duplicated per file.
    function wireRailIcon(key, btn, viewEl, onOpen) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (appState.panelPinned.rail && appState.activeRailView === key) { closeRailView(); }
            else { openRailView(key, viewEl, btn, onOpen, true); }
        });
        btn.addEventListener('mouseenter', () => { if (appState.activeRailView !== key) openRailView(key, viewEl, btn, onOpen, false); });
        btn.addEventListener('mouseleave', () => scheduleHoverClose('rail', appState.railHoverEls, closeRailView));
    }
    appState.railViewEls.forEach(el => { if (el) el.addEventListener('mouseleave', () => scheduleHoverClose('rail', appState.railHoverEls, closeRailView)); });
    pinOnInsideClick('rail', appState.railViewEls);
    appState.hamburgerStack.addEventListener('click', (e) => e.stopPropagation());
    // No more "Notion-style edge peek" pointermove hack here — every rail icon is a permanent,
    // always-visible element (see #dotto-rail's own comment, globals.css) that already receives
    // genuine mouseenter/mouseleave events, covering everything the old hack simulated.

    // refreshAiPanel is a plain function reference (ai-assistant-suggestions.js) — wired here,
    // alongside every other rail icon, rather than that file calling wireRailIcon on itself at its
    // own module top level, which would risk a circular-import timing issue (panels-hamburger.js
    // also imports from that file). A function reference used only inside a later event-listener
    // callback carries no such risk.
    wireRailIcon('ai', appState.railBtnAi, appState.aiPanel, refreshAiPanel);
    wireRailIcon('outline', appState.hamburgerBtn, appState.outlineMenu, buildOutline);
    wireRailIcon('waypoints', appState.railBtnWaypoints, appState.waypointsPanel, () => renderWaypointsList(''));
    wireRailIcon('collab', appState.railBtnCollab, appState.hubCollabPanel, () => { appState.hubCollabView = 'main'; renderHubCollabList(''); });

    function handleWaypointsSearch(v) { renderWaypointsList(v); }
    function handleHubCollabSearch(v) { renderHubCollabList(v); }

export { closeAllPanels, closeRailView, handleHubCollabSearch, handleWaypointsSearch, openRailView, pinOnInsideClick, scheduleHoverClose, wireRailIcon };
