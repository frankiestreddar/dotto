"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { notificationStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Renders the search-bar notification's content (image/message/action button) — the queue engine
// and the staged CSS-class choreography that shows/hides this bar both stay fully vanilla (see
// notificationStore's own comment in bridges.js for why). Portals into #search-notification-root
// (content/fragments/top-bar.html) rather than rendering independently the way PricingOverlay/
// SelectionToolbar do, since this piece is structurally coupled to sit exactly inside
// #search-input-wrap (it replaces #search-input's visible content in place while showing) — same
// "React needs a portal into a fixed slot inside otherwise-static markup" reasoning as
// CanvasItemsLayer's #items-layer. #search-notification itself stays position:absolute against
// #search-input-wrap regardless of the portal-root div sitting between them (an unstyled static
// wrapper doesn't create a new containing block), so no extra layout handling is needed here.
export default function NotificationBar() {
  const config = useSyncExternalStore(notificationStore.subscribe, notificationStore.getSnapshot, () => null);
  const portalNode = usePortalNode("search-notification-root");

  if (!portalNode) return null;

  return createPortal(
    <div id="search-notification" onClick={(e) => e.stopPropagation()}>
      <img id="search-notification-image" alt="" src={config?.imageUrl || undefined} />
      <div id="search-notification-text">{config?.message || ""}</div>
      <button
        id="search-notification-action"
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
