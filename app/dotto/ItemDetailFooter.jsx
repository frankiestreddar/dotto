"use client";

import { createPortal } from "react-dom";
import { useItemDetailFooterStore } from "./lib/itemDetailFooterStore";
import usePortalNode from "./usePortalNode";
import {
  deleteDetailDraft,
  startPublishFlow,
  unpublishDetailItem,
  updateDetailItem,
} from "./lib/libraryPublish";

// Portals into #item-detail-footer (content/fragments/hamburger-stack.html, #library-panel — Item
// Detail is a Library view now, not Marketplace/Discover) — a plain positioned div, safe to portal
// into directly (only ever written by renderItemDetailFooter, see that function's own comment).
// The rest of the Item Detail view (title/price/desc fields, canvas preview) and the whole Publish
// Flow view stay vanilla — see app/dotto/lib/itemDetailFooterStore.ts's own comment.
// deployPurchasedTemplate stays a window.__ bridge (app/dotto/lib/marketplace.ts, a different lib
// file); the other 4 buttons below now call app/dotto/lib/libraryPublish.ts's real exports
// directly (same app/dotto/ tree) instead of the window.__ bridges those functions used to be
// reached through.
export default function ItemDetailFooter() {
  const state = useItemDetailFooterStore();
  const portalNode = usePortalNode("item-detail-footer");

  if (!portalNode || !state) return null;

  if (state.sourceFolder === "drafts") {
    return createPortal(
      <>
        <button className="btn-buy btn-secondary" onClick={() => deleteDetailDraft()}>
          Delete
        </button>
        <button className="btn-buy" onClick={() => startPublishFlow()}>
          Publish
        </button>
      </>,
      portalNode,
    );
  }

  if (state.sourceFolder === "published") {
    return createPortal(
      <>
        <button className="btn-buy btn-secondary" onClick={() => unpublishDetailItem()}>
          Unpublish
        </button>
        <button className="btn-buy" disabled={!state.dirty} onClick={() => updateDetailItem()}>
          Update
        </button>
      </>,
      portalNode,
    );
  }

  return createPortal(
    <button className="btn-buy" onClick={() => window.__deployPurchasedTemplate(state.itemId)}>
      Deploy
    </button>,
    portalNode,
  );
}
