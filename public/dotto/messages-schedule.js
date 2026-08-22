import { appState } from './core-state.js';
import { renderMsgList } from './friends-presence.js';
import { closeConvo } from './live-presence.js';
import { closeRailView, openRailView, wireRailIcon } from './panels-hamburger.js';


    // ---------- Messages Panel Controls ----------
    // Messages shares the permanent rail's one shell/pinned-state now (see openRailView/
    // wireRailIcon, panels-hamburger.js) — kept as named, exported functions (unlike Marketplace's
    // fully-inlined wireRailIcon call) since openMessagesPanel/closeMessagesPanel have callers
    // outside this file (friends-presence.js opens straight to a specific conversation from a
    // notification action; live-presence.js closes it from elsewhere).
    // Also closes any open conversation (not just the panel around it) — otherwise it stays
    // "open" internally at whatever scroll position was left, and reopening the panel later
    // shows that same stale state instead of a fresh bottom-of-conversation view.
    function closeMessagesPanel() { closeRailView(); closeConvo(); }
    function refreshMessagesPanel() {
        closeConvo();
        appState.msgView = 'main'; // always land on the main list, never mid-Requests from last time
        appState.msgSearchInput.value = '';
        renderMsgList('');
    }
    function openMessagesPanel(pin) {
        openRailView('messages', appState.messagesPanel, appState.messagesBtn, refreshMessagesPanel, pin);
        if (pin) appState.msgSearchInput.focus();
    }
    wireRailIcon('messages', appState.messagesBtn, appState.messagesPanel, refreshMessagesPanel);

    // ---------- Shared date-key helper ----------
    // Originally written for the (now-removed) Schedule feature, kept here since
    // dotbot-schedule-notifications.js's statsDayKey (the "day changed at 3am" tracker, a generic
    // notification unrelated to scheduling) still calls dateKey for its own, unrelated purpose.
    function pad2(n) { return String(n).padStart(2, '0'); }
    function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

export { closeMessagesPanel, dateKey, openMessagesPanel };
