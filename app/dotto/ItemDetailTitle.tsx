"use client";

import { createPortal } from "react-dom";
import usePortalNode from "./usePortalNode";
import { commitItemDetailTitle, onItemDetailFieldChange } from "./lib/libraryPublish";

// Real React ownership of the Item Detail view's title field — CONTRIBUTING.md's "contentEditable
// fields" category, converted via the decided uncontrolled-ref pattern rather than a rich-text
// library: none of Phase 2's three fields (this one, PublishFlowName.tsx, the Source table's
// cells) do any actual text formatting, just plain-text auto-sizing input, so a library would be
// pure overhead. This component renders its contentEditable div exactly once — no props, no
// state — so React never re-diffs its content out from under an in-progress edit; every read/
// write still goes through document.getElementById('item-detail-title') exactly as before
// (openItemDetail/isDetailDirty/commitItemDetailTitle/updateDetailItem, now
// app/dotto/lib/libraryPublish.ts, same app/dotto/ tree, called via real imports below) since the
// id is preserved and DOM lookups don't care which side created the node.
//
// Portals into #item-detail-title-root (content/fragments/hamburger-stack.html), which carries
// display:contents so the actual #item-detail-title div ends up the effective flex child of
// #item-detail-header, matching the original flat markup's layout exactly.
export default function ItemDetailTitle() {
  const portalNode = usePortalNode("item-detail-title-root");
  if (!portalNode) return null;

  return createPortal(
    <div
      id="item-detail-title"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="Untitled Draft"
      onInput={() => onItemDetailFieldChange()}
      onBlur={() => commitItemDetailTitle()}
    />,
    portalNode,
  );
}
