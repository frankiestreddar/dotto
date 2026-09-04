"use client";

import { createPortal } from "react-dom";
import { useMarketDiscoverStore } from "./lib/marketDiscoverStore";
import type { MarketplaceItem } from "./lib/marketplace";
import usePortalNode from "./usePortalNode";

function MarketItemRow({ item }: { item: MarketplaceItem }) {
  return (
    <div className="market-item-row" onClick={() => window.__openMarketDetail!(item)}>
      <div className="market-item-header">
        <div className="market-item-title">{item.title}</div>
        <div className="market-item-price">{item.price}</div>
      </div>
      <div className="market-item-desc">{item.tagline || item.description}</div>
      <div className="market-item-meta">
        <span>by {item.creatorUsername}</span>
        <span>★ 4.9</span>
      </div>
    </div>
  );
}

// Portals into #market-list-container (content/fragments/hamburger-stack.html, #cart-panel) — a
// plain flex-item container, safe to portal into directly, same as #waypoints-list and friends.
export default function MarketDiscoverPanel() {
  const items = useMarketDiscoverStore();
  const portalNode = usePortalNode("market-list-container");

  if (!portalNode) return null;

  if (!items.length) {
    return createPortal(
      <div className="text-xs text-neutral-500 text-center py-6 font-mono">
        No matching templates.
      </div>,
      portalNode,
    );
  }

  return createPortal(
    <>
      <div className="waypoint-folder-header !px-1">Trending</div>
      {items.map((item) => (
        <MarketItemRow key={item.id} item={item} />
      ))}
    </>,
    portalNode,
  );
}
