"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { marketDiscoverStore } from "./bridges";

const EMPTY_ITEMS = [];

function MarketItemRow({ item }) {
  return (
    <div className="market-item-row" onClick={() => window.__openMarketDetail(item)}>
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

// Portals into #market-list-container (content/fragments/cart-panel.html) — a plain flex-item
// container, safe to portal into directly, same as #waypoints-list and friends.
export default function MarketDiscoverPanel() {
  const items = useSyncExternalStore(marketDiscoverStore.subscribe, marketDiscoverStore.getSnapshot, () => EMPTY_ITEMS);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("market-list-container"));
  }, []);

  if (!portalNode) return null;

  if (!items.length) {
    return createPortal(<div className="text-xs text-neutral-500 text-center py-6 font-mono">No matching templates.</div>, portalNode);
  }

  return createPortal(
    <>
      <div className="waypoint-folder-header !px-1">Trending</div>
      {items.map((item) => <MarketItemRow key={item.id} item={item} />)}
    </>,
    portalNode,
  );
}
