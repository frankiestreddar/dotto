import { refreshAiPanel, resetAiSearchState } from './ai-assistant-suggestions.js';
import { appState } from './core-state.js';
import { closeCollabPanel } from './friends-presence.js';
import { clearListPanelSelection, renderFilesList, renderHubCollabList, renderSourcesList, renderWaypointsList } from './hamburger-collab.js';
import { buildOutline } from './outline-tree.js';
import { closeSourceAddMenu } from './source-buttons-cursor-mode.js';


    // ---------- Hover/Pin Panel Helper ----------
    // Used by the add-menu and the per-canvas collaborator flyout ('add'/'collab' — see
    // app/dotto/lib/copyPaste.ts/friends-presence.js): hovering the trigger opens them temporarily (closing
    // again once the pointer leaves both the button and the panel), while clicking pins the panel
    // open until the user clicks elsewhere. The permanent rail (below) no longer uses this at all
    // — every rail icon is click-only now, so there's nothing for it to hover-close.
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
    // Add/Profile/the hamburger outline used to each have their own except-key here ('cart'/
    // 'messages'/'add'/'profile'/'menu'); now that they all share one shell there's only one to skip.
    function closeAllPanels(except) {
        if (except !== 'rail') closeRailView();
        if (except !== 'collab') closeCollabPanel();
        if (except !== 'sourceAdd') closeSourceAddMenu();
    }
    // Any panel that owns its own keyboard input while open — same set closeAllPanels() knows
    // about, plus the search dropdown — should win over any OTHER global single-key shortcut
    // (game-card shortcuts in card-shortcuts.js, the Space/"/"/m/n shortcuts in
    // srs-connections-core.js) even when nothing inside that panel happens to be focused yet.
    // Without this, typing a normal sentence while e.g. the Waypoints panel is open (cursor
    // resting on the panel, no input actually clicked into) would silently do nothing for most
    // letters, then hijack focus to the AI search box the instant a space or "/" was typed —
    // reading as "if you start typing, it starts inputting in the text box." Outline/Waypoints/
    // Collaborations/Marketplace/Library/Messages/Add/Profile all share one rail shell now (see
    // appState.railViewEls, core-state.js) — checking the whole list covers all of them in one go
    // instead of naming each one individually.
    function isAnyUiPanelOpen() {
        return appState.railViewEls.some(el => el && el.classList.contains('open'))
            || appState.collabPanel.classList.contains('open')
            || appState.sourceAddMenu.style.display === 'flex'
            || (appState.searchDropdown && appState.searchDropdown.classList.contains('visible'))
            || (appState.searchChatThread && appState.searchChatThread.classList.contains('visible'));
    }

    // ---------- Permanent rail: one shared sliding shell, many trigger icons ----------
    // Every panel-style rail icon (outline, Waypoints, Collaborations, Marketplace, Library,
    // Messages, Profile, AI search) shares ONE #hamburger-stack shell and ONE pinned state
    // (appState.panelPinned.rail) — opening any of them closes whichever other one was showing,
    // for free, just by hiding every other railViewEls sibling and un-.active-ing every other
    // railIconBtns entry. Click-only — hovering a rail icon does nothing; only a real click opens,
    // switches, or (clicking the already-active icon again) closes a panel. `onOpen` is that
    // view's own refresh call (renderWaypointsList, buildOutline, refreshAiPanel, etc.), called
    // every time so content is never stale.
    // resetAiSearchState (ai-assistant-suggestions.js) is called here specifically when the AI
    // view is the one being navigated AWAY from (activeRailView was 'ai', the new key isn't) —
    // opening AI itself, or re-clicking it while it's already active, must never reset an
    // in-progress conversation. Checked BEFORE activeRailView is reassigned below, since the
    // check needs the OLD value.
    let railCloseTimeoutId = null;
    function openRailView(key, viewEl, btn, onOpen, pin) {
        clearListPanelSelection();
        clearTimeout(railCloseTimeoutId);
        if (appState.activeRailView === 'ai' && key !== 'ai') resetAiSearchState();
        // 'closing' is removed here too, not just 'open' — in case this same view was still
        // mid fade-out (see closeRailView below) when it (or another icon) got clicked again;
        // without this it would stay stuck at opacity:0 despite being freshly reopened.
        appState.railViewEls.forEach(el => { if (el && el !== viewEl) el.classList.remove('open', 'closing'); });
        appState.railIconBtns.forEach(b => { if (b && b !== btn) b.classList.remove('active'); });
        viewEl.classList.remove('closing');
        viewEl.classList.add('open');
        btn.classList.add('active');
        appState.hamburgerStack.classList.add('open');
        appState.activeRailView = key;
        if (onOpen) onOpen(pin);
        if (pin) appState.panelPinned.rail = true;
    }
    // Same resetAiSearchState reasoning as openRailView above, for the "close the rail entirely"
    // direction (Escape, clicking outside, etc.) — if AI was the view showing, reset it; checked
    // before activeRailView is cleared below.
    // The shell itself (#hamburger-stack) slides away over .3s (see its own `left` transition,
    // globals.css) the instant 'open' is removed below — but the view el's OWN display:none (see
    // .hmenu-panel/.hub-subpanel) would normally apply in that same synchronous tick, making the
    // content vanish instantly instead of sliding away with the shell. 'closing' (opacity
    // transition, same .3s duration — see globals.css) keeps it visible and fading for exactly as
    // long as the slide takes, then 'open'/'closing' are both dropped together so display:none
    // applies only once the fade has actually finished.
    function closeRailView() {
        if (appState.activeRailView === 'ai') resetAiSearchState();
        clearTimeout(railCloseTimeoutId);
        const closingEls = appState.railViewEls.filter(el => el && el.classList.contains('open'));
        closingEls.forEach(el => el.classList.add('closing'));
        appState.railIconBtns.forEach(b => b && b.classList.remove('active'));
        appState.hamburgerStack.classList.remove('open');
        appState.activeRailView = null;
        appState.panelPinned.rail = false;
        clearListPanelSelection();
        railCloseTimeoutId = setTimeout(() => {
            closingEls.forEach(el => el.classList.remove('open', 'closing'));
        }, 300);
    }
    // Wires one rail icon's click-only open/switch/close — the same listener every trigger button
    // in the app already used individually before this (compare the old per-panel wiring that
    // used to live in marketplace.js/messages-schedule.js/profile-achievements-pricing.js), now
    // written once instead of duplicated per file. No mouseenter/mouseleave — hovering a rail icon
    // previews/switches nothing regardless of whether some other panel is already open or not
    // (a hover-switches-panels version of this was tried and explicitly reverted); only a click
    // ever opens, switches, or closes a panel. The one thing that DOES change while a panel is
    // open is the tooltip, suppressed via body:has(#hamburger-stack.open) in globals.css — that
    // part is deliberate and stays.
    function wireRailIcon(key, btn, viewEl, onOpen) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (appState.activeRailView === key) {
                closeRailView();
                // Closing removes .active, which immediately re-satisfies .rail-tooltip's own
                // :not(.active):hover CSS rule (globals.css) — without this, the tooltip would pop
                // up right away as a side effect of the click, even though the pointer never
                // actually left the button and re-hovered it. .tooltip-hold-hidden overrides that
                // rule back to hidden (see its own comment, globals.css) until a real pointerleave
                // below actually happens, per explicit bug report.
                btn.classList.add('tooltip-hold-hidden');
            } else { openRailView(key, viewEl, btn, onOpen, true); }
        });
        btn.addEventListener('pointerleave', () => btn.classList.remove('tooltip-hold-hidden'));
    }
    appState.hamburgerStack.addEventListener('click', (e) => e.stopPropagation());

    // refreshAiPanel is a plain function reference (ai-assistant-suggestions.js) — wired here,
    // alongside every other rail icon, rather than that file calling wireRailIcon on itself at its
    // own module top level, which would risk a circular-import timing issue (panels-hamburger.js
    // also imports from that file). A function reference used only inside a later event-listener
    // callback carries no such risk.
    // #inbox-panel/#search-panel/#snippets2-panel have no content/refresh logic of their own yet
    // (see their own comments, hamburger-stack.html) — no onOpen callback needed until that's
    // designed. #snippets-panel (Files) is no longer one of these — see renderFilesList's own
    // comment, hamburger-collab.js.
    wireRailIcon('inbox', appState.btnInbox, appState.inboxPanel, null);
    wireRailIcon('search', appState.btnSearch, appState.searchPanel, null);
    wireRailIcon('sources', appState.btnSources, appState.sourcesPanel, () => renderSourcesList(''));
    wireRailIcon('snippets', appState.btnSnippets, appState.snippetsPanel, () => renderFilesList(''));
    wireRailIcon('snippets2', appState.btnSnippets2, appState.snippets2Panel, null);
    wireRailIcon('servers', appState.btnServers, appState.serversPanel, null);
    wireRailIcon('ai', appState.railBtnAi, appState.aiPanel, refreshAiPanel);
    wireRailIcon('outline', appState.hamburgerBtn, appState.outlineMenu, buildOutline);
    wireRailIcon('waypoints', appState.railBtnWaypoints, appState.waypointsPanel, () => renderWaypointsList(''));
    wireRailIcon('collab', appState.railBtnCollab, appState.hubCollabPanel, () => { appState.hubCollabView = 'main'; renderHubCollabList(''); });

    function handleWaypointsSearch(v) { renderWaypointsList(v); }
    function handleHubCollabSearch(v) { renderHubCollabList(v); }
    function handleSourcesSearch(v) { renderSourcesList(v); }
    function handleFilesSearch(v) { renderFilesList(v); }

export { closeAllPanels, closeRailView, handleFilesSearch, handleHubCollabSearch, handleSourcesSearch, handleWaypointsSearch, isAnyUiPanelOpen, openRailView, pinOnInsideClick, scheduleHoverClose, wireRailIcon };

// Used by app/dotto/lib/copyPaste.ts's prepareAdd (Phase 4.4).
window.__closeRailView = closeRailView;
