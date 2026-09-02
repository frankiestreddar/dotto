import { create } from "zustand";

// Phase 4.4 port of public/dotto/notifications.js (itself a Phase 4.3 split of
// stopwatch-search-notifications.js, see PHASE4_ROADMAP.md) — the first real Zustand store in
// this codebase (per the Phase 4 plan's locked-in decision), replacing bridges.js's hand-rolled
// createStore for this one subsystem. Every other existing createStore-based store keeps working
// unchanged for now; they migrate to Zustand individually as their own owning file gets ported,
// same incremental approach as every other Phase 4 step so far.
//
// The "before" picture (kept for history, since NotificationBar.jsx's own comment points here):
// this used to be a single top-center pill, one notification at a time, with an enforced gap
// between them, swapping places with #top-bar-center. Explicit redesign: "should appear in the
// top right, sliding in from the right... if another notification appears, existing ones smoothly
// shift down, then the new notification slides in. remove the delay between notifications" — a
// genuine multi-item stack, no queue/gap/single-"current"-one, later repositioned again to
// bottom-left sliding in from the left (see NotificationBar.jsx's own comment for that second
// move) — same underlying engine both times, just restyled.

export interface NotificationConfig {
  type: string;
  message: string;
  imageUrl?: string;
  actionLabel?: string;
  onAction?: () => void;
  sticky?: boolean;
  durationMs?: number;
}

export interface NotificationEntry {
  id: number;
  config: NotificationConfig;
}

// Genuinely multiple can be up at once (explicit request: "remove the delay between
// notifications" — no queue, no gap, no single "current" one) — see showNotification/
// dismissNotification below. Held (queued, not shown) while the tab isn't actually visible; the
// visibilitychange listener wireNotifications sets up flushes them the moment it's visible again.
const NOTIFICATION_MAX_VISIBLE = 3;
const NOTIFICATION_DEFAULT_DURATION_MS = 5000;

let nextNotificationId = 1;

interface NotificationsState {
  visibleNotifications: NotificationEntry[];
  notificationQueue: NotificationConfig[];
  pushNotification: (config: NotificationConfig) => void;
  dismissNotification: (id: number) => void;
  runNotificationAction: (id: number) => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  visibleNotifications: [],
  notificationQueue: [],
  pushNotification: (config) => {
    if (document.visibilityState !== "visible") {
      set((s) => ({ notificationQueue: [...s.notificationQueue, config] }));
      return;
    }
    showNotification(config);
  },
  // Click (NotificationBar.jsx's own action button onClick) or Enter (see wireNotifications'
  // keydown handler below, which always targets the TOPMOST/newest notification) — id-scoped so
  // triggering one notification's action can never accidentally dismiss a DIFFERENT one still in
  // the stack.
  runNotificationAction: (id) => {
    const entry = get().visibleNotifications.find((n) => n.id === id);
    if (!entry || !entry.config.actionLabel) return;
    const cb = entry.config.onAction;
    get().dismissNotification(id);
    cb?.();
  },
  dismissNotification: (id) => {
    set((s) => {
      const next = s.visibleNotifications.filter((n) => n.id !== id);
      if (next.length === s.visibleNotifications.length) return s; // already gone
      return { visibleNotifications: next };
    });
  },
}));

// Newest first — "new ones push existing down" (NotificationBar.jsx renders top to bottom in
// array order). Sliced to NOTIFICATION_MAX_VISIBLE — dropping whichever entry falls off the end
// (the oldest, per explicit request) rather than growing the stack unbounded; NotificationBar.jsx
// detects that drop and plays a real slide-out exit for it instead of it just vanishing.
function showNotification(config: NotificationConfig) {
  const id = nextNotificationId++;
  const entry: NotificationEntry = { id, config };
  useNotificationsStore.setState((s) => ({
    visibleNotifications: [entry, ...s.visibleNotifications].slice(0, NOTIFICATION_MAX_VISIBLE),
  }));
  if (!config.sticky) {
    const durationMs = config.durationMs || NOTIFICATION_DEFAULT_DURATION_MS;
    setTimeout(() => useNotificationsStore.getState().dismissNotification(id), durationMs);
  }
}

// Global keydown (Enter/Escape act on the topmost/newest notification) and visibilitychange
// (flush anything queued while backgrounded, each becoming its own real, independently-timed
// notification — no artificial stagger between them, per explicit request) — called once from
// DottoApp's own mount effect (app/dotto-app.jsx), same lifetime/wiring shape as
// wireDayChangeAndAdNotifications. Idempotent via AbortController (same pattern established in
// canvasItemBehavior.js, Phase 3) so a second call (React Strict Mode) can't stack listeners.
let listenerAbort: AbortController | null = null;
export function wireNotifications(): () => void {
  listenerAbort?.abort();
  const controller = new AbortController();
  listenerAbort = controller;
  const { signal } = controller;

  document.addEventListener(
    "keydown",
    (e) => {
      const { visibleNotifications, runNotificationAction, dismissNotification } =
        useNotificationsStore.getState();
      if (!visibleNotifications.length) return;
      const active = document.activeElement;
      // Some OTHER field being actively edited (a waypoint rename, a table cell, etc.) wins —
      // Enter/Escape apply to that as usual rather than surprise-triggering the notification
      // stack sitting in the background.
      const isEditingText =
        active &&
        ((active as HTMLElement).isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "SELECT" ||
          active.tagName === "TEXTAREA");
      if (isEditingText) return;
      const topId = visibleNotifications[0].id;
      if (e.key === "Enter") {
        e.preventDefault();
        runNotificationAction(topId);
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismissNotification(topId);
      }
    },
    { signal },
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "visible") return;
      const queued = useNotificationsStore.getState().notificationQueue;
      if (!queued.length) return;
      useNotificationsStore.setState({ notificationQueue: [] });
      queued.forEach(showNotification);
    },
    { signal },
  );

  return () => controller.abort();
}

// Not an inline-HTML onclick target (see window-bridge.js's own header comment for why those live
// there instead) — plain vanilla-callable bridges for the still-vanilla files that push/query
// notifications (command-verbs.js, command-palette.js, hamburger-collab.js, friends-presence.js,
// app/dotto/lib/srsConnectionsCore.ts, card-shortcuts.js) plus app/dotto/lib/profileAchievementsPricing.ts,
// app/dotto/lib/dayChangeAndAdNotifications.ts, app/dotto/lib/sharedAndPublicCanvasLoading.ts, and
// PricingOverlay.jsx, which already called window.pushNotification even before this port (see
// vanillaBridges.d.ts).
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.pushNotification = (config) => useNotificationsStore.getState().pushNotification(config);
  // card-shortcuts.js's hover-scoped game-card/PDF-page-turn shortcuts gate on this — "its own
  // Enter/Escape handling should win, not compete" — same reasoning the keydown handler above uses.
  window.__hasVisibleNotifications = () =>
    useNotificationsStore.getState().visibleNotifications.length > 0;
}
