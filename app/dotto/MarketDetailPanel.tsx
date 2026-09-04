"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMarketDetailStore } from "./lib/marketDetailStore";
import type { MarketplaceItem } from "./lib/marketplace";
import { renderInlineCanvas } from "./lib/messagingCanvasPreview";
import usePortalNode from "./usePortalNode";

// renderInlineCanvas builds a whole live DOM subtree (its own pan/zoom/nav state) — same "vanilla
// function builds live DOM, React just mounts it" pattern as CanvasCard's buildFolderInlineCanvas.
// Keyed by the item itself in the parent (see below) so a different item mounts a fresh preview
// rather than reusing a stale one.
function InlineCanvasPreview({ item }: { item: MarketplaceItem }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const mount = ref.current;
    if (!mount || !item.canvasSnapshot || !item.canvasSnapshot.length) return;
    // Preview only — draggableOut=false so this can't be dragged onto the user's own canvas.
    mount.appendChild(renderInlineCanvas(item.canvasSnapshot as never[], false));
  }, [item]);

  return <div ref={ref} />;
}

// Portals into #market-detail-content (content/fragments/hamburger-stack.html, #cart-panel) — a
// plain scroll-area container, safe to portal into directly, same as the other panels this wave.
export default function MarketDetailPanel() {
  const item = useMarketDetailStore();
  const portalNode = usePortalNode("market-detail-content");

  if (!portalNode || !item) return null;

  const fullDesc = `${item.description}\n\nIncludes multiple interactive notes, tables, flashcard maps and customized language learning layouts. Supports real-time reference updates.`;

  return createPortal(
    <>
      <div className="detail-title">{item.title}</div>
      <div className="detail-creator">Created by {item.creatorUsername}</div>
      <div className="detail-price">{item.price}</div>
      <div className="detail-desc">{fullDesc}</div>
      <InlineCanvasPreview key={item.id} item={item} />
    </>,
    portalNode,
  );
}
