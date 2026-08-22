"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { notificationStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Renders a notification's content (image/message/action button) — the queue engine and the
// slide-in/slide-out choreography that shows/hides the pill around this both stay fully vanilla
// (see notificationStore's own comment in bridges.js for why). Portals into #notification-root
// (content/fragments/top-bar.html), an empty marker nested inside #notification-pill — the pill
// itself is static markup, not React-rendered, since the vanilla engine (showNotification/
// dismissCurrentNotification, stopwatch-search-notifications.js) needs a stable, always-present
// node to toggle its .notif-active class on directly, the same "React needs a portal into a fixed
// slot inside otherwise-static markup" reasoning as CanvasItemsLayer's #items-layer.
export default function NotificationBar() {
  const config = useSyncExternalStore(notificationStore.subscribe, notificationStore.getSnapshot, () => null);
  const portalNode = usePortalNode("notification-root");

  if (!portalNode) return null;

  return createPortal(
    <div id="notification-content" onClick={(e) => e.stopPropagation()}>
      <img id="notification-image" alt="" src={config?.imageUrl || undefined} />
      <div id="notification-text">{config?.message || ""}</div>
      <button
        id="notification-action"
        type="button"
        className={config?.actionLabel ? "visible" : ""}
        onClick={() => window.runNotificationAction()}
      >
        {config?.actionLabel ? `${config.actionLabel} ↵` : ""}
      </button>
    </div>,
    portalNode,
  );
}
