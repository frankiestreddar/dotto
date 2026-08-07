"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { canvasItemsStore } from "./bridges";

// Module-level, not inline in the hook call below — useSyncExternalStore's getServerSnapshot must
// return a referentially stable value across calls, or React reads it as never settling ("the
// result of getServerSnapshot should be cached to avoid an infinite loop"). A fresh `() => []`
// array literal every render trips that same warning SelectionToolbar.jsx originally had.
const EMPTY_ITEMS = [];

// One canvas item's wrapper <div>. React's only job here is creating/keying/removing this node —
// everything inside it (className, style, innerHTML, event wiring) is still owned by vanilla code
// (public/dotto/waypoints-render-loop.js's renderLegacyCardInto, via window.__renderLegacyCardInto),
// called from a layout effect so it runs synchronously before paint, matching the old code's
// single-pass createElement+build+appendChild (no visible empty-card flash on first mount).
//
// Wrapped in memo() so an item whose `it` object reference is unchanged since the last render()
// call (the common case — appState mutates items in place, e.g. drag/resize/bringCardToFront)
// skips re-running entirely: no re-render, no re-run of the layout effect, no rebuilt innerHTML.
// That's the actual fix for render()'s old full-teardown-every-call cost — see the canvas-items-
// react plan in PHASE2_ROADMAP.md. Items whose reference DOES change (added, or replaced wholesale
// by a remote sync — see live-presence.js's applyRemoteSyncBroadcast) re-run normally.
const CanvasItem = memo(function CanvasItem({ it }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (ref.current) window.__renderLegacyCardInto(ref.current, it);
  }, [it]);

  return <div ref={ref} id={"item-" + it.id} />;
});

// Portals the current folder's item cards into #items-layer, a stable child of #world added to
// content/fragments/canvas-area.html (see that file's comment) specifically so React never has to
// own #world itself — #world has several other direct children managed imperatively outside of
// React (drawing/connection SVG layers, the placement ghost, connection-drag preview) that this
// must not disturb.
export default function CanvasItemsLayer() {
  const items = useSyncExternalStore(canvasItemsStore.subscribe, canvasItemsStore.getSnapshot, () => EMPTY_ITEMS);
  // #items-layer is part of #world's static markup (rendered elsewhere via dangerouslySetInnerHTML)
  // so it doesn't exist in the DOM yet on this component's own first render — only resolvable once,
  // after mount. The one-extra-render cost the lint rule warns about here is unavoidable for
  // exactly that reason (there's no synchronous way to read a DOM node that doesn't exist until
  // this component's own first commit has happened) and is otherwise harmless: it happens once, on
  // initial mount, well before the vanilla render() loop's first real call (see the flushSync
  // caller in app/dotto-app.jsx) — see that comment for why later calls are unaffected.
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("items-layer"));
  }, []);

  if (!portalNode) return null;
  return createPortal(items.map((it) => <CanvasItem key={it.id} it={it} />), portalNode);
}
