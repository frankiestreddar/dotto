"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { itemDetailFooterStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Portals into #item-detail-footer (content/fragments/hamburger-stack.html, #library-panel — Item
// Detail is a Library view now, not Marketplace/Discover) — a plain positioned div, safe to portal
// into directly (only ever written by renderItemDetailFooter, see that function's own comment).
// The rest of the Item Detail view (title/price/desc fields, canvas preview) and the whole Publish
// Flow view stay vanilla — see itemDetailFooterStore's comment in bridges.js.
export default function ItemDetailFooter() {
  const state = useSyncExternalStore(itemDetailFooterStore.subscribe, itemDetailFooterStore.getSnapshot, () => null);
  const portalNode = usePortalNode("item-detail-footer");

  if (!portalNode || !state) return null;

  if (state.sourceFolder === "drafts") {
    return createPortal(
      <>
        <button className="btn-buy btn-secondary" onClick={() => window.__deleteDetailDraft()}>Delete</button>
        <button className="btn-buy" onClick={() => window.__startPublishFlow()}>Publish</button>
      </>,
      portalNode,
    );
  }

  if (state.sourceFolder === "published") {
    return createPortal(
      <>
        <button className="btn-buy btn-secondary" onClick={() => window.__unpublishDetailItem()}>Unpublish</button>
        <button className="btn-buy" disabled={!state.dirty} onClick={() => window.__updateDetailItem()}>Update</button>
      </>,
      portalNode,
    );
  }

  return createPortal(
    <button className="btn-buy" onClick={() => window.__deployPurchasedTemplate(state.itemId)}>Deploy</button>,
    portalNode,
  );
}
