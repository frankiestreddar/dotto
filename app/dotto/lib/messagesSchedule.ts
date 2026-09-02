// Phase 4.5 port of public/dotto/messages-schedule.js: the Messages rail-view open/close/refresh
// wrappers around app/dotto/lib/panelsHamburger.ts's shared rail-view shell.
//
// Genuinely circular with app/dotto/lib/friendsPresence.ts (renderMsgList) — both moved to
// app/dotto/lib together so this becomes a real ES import instead of the vanilla-only workaround
// of each file importing the other at its own top level; the binding is only read inside function
// bodies (never at module-evaluation time), same as every other circular pair this migration has
// already carried over safely.

import { renderMsgList } from "./friendsPresence";

interface AppState {
  msgView: string;
  msgSearchInput: HTMLInputElement;
  messagesBtn: HTMLElement;
  messagesPanel: HTMLElement;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Messages Panel Controls ----------
// Messages shares the permanent rail's one shell/pinned-state now (see openRailView/wireRailIcon,
// app/dotto/lib/panelsHamburger.ts) — kept as named, exported functions (unlike Marketplace's
// fully-inlined wireRailIcon call) since openMessagesPanel/closeMessagesPanel have callers outside
// this file (friendsPresence.ts opens straight to a specific conversation from a notification
// action; app/dotto/lib/messagingCanvasPreview.ts closes it from elsewhere).
// Also closes any open conversation (not just the panel around it) — otherwise it stays "open"
// internally at whatever scroll position was left, and reopening the panel later shows that same
// stale state instead of a fresh bottom-of-conversation view.
export function closeMessagesPanel(): void {
  window.__closeRailView?.();
  window.closeConvo?.();
}
function refreshMessagesPanel(): void {
  const appState = getAppState();
  window.closeConvo?.();
  appState.msgView = "main"; // always land on the main list, never mid-Requests from last time
  appState.msgSearchInput.value = "";
  renderMsgList("");
}
export function openMessagesPanel(pin?: boolean): void {
  const appState = getAppState();
  window.__openRailView?.(
    "messages",
    appState.messagesPanel,
    appState.messagesBtn,
    refreshMessagesPanel,
    pin,
  );
  if (pin) appState.msgSearchInput.focus();
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  const appState = getAppState();
  window.__wireRailIcon?.(
    "messages",
    appState.messagesBtn,
    appState.messagesPanel,
    refreshMessagesPanel,
  );
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs both window.__getAppState
// AND window.__wireRailIcon (app/dotto/lib/panelsHamburger.ts) ready before wiring, same
// multi-bridge poll shape app/dotto/lib/profileAchievementsPricing.ts's own wireProfileAchievementsPricing
// established.
export function wireMessagesSchedule(): () => void {
  if (window.__getAppState && window.__wireRailIcon) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState && window.__wireRailIcon) {
      clearInterval(poll);
      doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // Used by app/dotto/lib/messagingCanvasPreview.ts's importSharedCardsAtScreenPoint (Phase 4.5).
  window.__closeMessagesPanel = closeMessagesPanel;
}
