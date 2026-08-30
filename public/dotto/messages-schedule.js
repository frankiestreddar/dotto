import { appState } from './core-state.js';
import { renderMsgList } from './friends-presence.js';
import { closeConvo } from './live-presence.js';


    // ---------- Messages Panel Controls ----------
    // Messages shares the permanent rail's one shell/pinned-state now (see openRailView/
    // wireRailIcon, app/dotto/lib/panelsHamburger.ts) — kept as named, exported functions (unlike Marketplace's
    // fully-inlined wireRailIcon call) since openMessagesPanel/closeMessagesPanel have callers
    // outside this file (friends-presence.js opens straight to a specific conversation from a
    // notification action; live-presence.js closes it from elsewhere).
    // Also closes any open conversation (not just the panel around it) — otherwise it stays
    // "open" internally at whatever scroll position was left, and reopening the panel later
    // shows that same stale state instead of a fresh bottom-of-conversation view.
    function closeMessagesPanel() { window.__closeRailView(); closeConvo(); }
    function refreshMessagesPanel() {
        closeConvo();
        appState.msgView = 'main'; // always land on the main list, never mid-Requests from last time
        appState.msgSearchInput.value = '';
        renderMsgList('');
    }
    function openMessagesPanel(pin) {
        window.__openRailView('messages', appState.messagesPanel, appState.messagesBtn, refreshMessagesPanel, pin);
        if (pin) appState.msgSearchInput.focus();
    }
    window.__wireRailIcon('messages', appState.messagesBtn, appState.messagesPanel, refreshMessagesPanel);

export { closeMessagesPanel, openMessagesPanel };
