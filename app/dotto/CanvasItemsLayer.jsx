"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { canvasItemsStore } from "./bridges";
import ChecklistCard from "./ChecklistCard";
import EmbedCard from "./EmbedCard";
import FlashcardCard from "./FlashcardCard";
import NoteCard from "./NoteCard";
import StatcardCard from "./StatcardCard";
import StopwatchCard from "./StopwatchCard";
import TableCard from "./TableCard";
import TitleCard from "./TitleCard";
import WatermarkCard from "./WatermarkCard";

// Module-level, not inline in the hook call below — useSyncExternalStore's getServerSnapshot must
// return a referentially stable value across calls, or React reads it as never settling ("the
// result of getServerSnapshot should be cached to avoid an infinite loop"). A fresh `() => []`
// array literal every render trips that same warning SelectionToolbar.jsx originally had.
const EMPTY_ITEMS = [];

// Kinds converted to a real Component — see PHASE2_ROADMAP.md's migration order. Every other kind
// still renders via the legacy vanilla path (window.__renderLegacyCardBody). Add an entry here the
// same PR a kind's Component ships; nothing else in this file needs to change per kind.
const CARD_KIND_COMPONENTS = { checklist: ChecklistCard, embed: EmbedCard, flashcard: FlashcardCard, note: NoteCard, statcard: StatcardCard, stopwatch: StopwatchCard, table: TableCard, title: TitleCard, watermark: WatermarkCard };

// One canvas item's wrapper <div>. React's job is creating/keying/removing this node and, for
// converted kinds, owning its real JSX children (Component below) — everything else (className,
// style, and, for kinds NOT YET converted, innerHTML/event wiring) is still owned by vanilla code
// (public/dotto/waypoints-render-loop.js), called from a layout effect so it runs synchronously
// before paint, matching the old code's single-pass createElement+build+appendChild (no visible
// empty-card flash on first mount). For a converted kind, the wrapper attrs + universal behavior
// (drag/click, aiGenerated badge, right-click suppression — none of that is kind-specific) still
// run the same way; only the body content becomes real JSX instead of window.__renderLegacyCardBody.
//
// Deliberately NOT memo()'d, and the layout effect below deliberately has NO dependency array —
// both would gate re-running on the `it` prop's object REFERENCE, but appState mutates items in
// place almost everywhere (checklist toggles, embed edits, bringCardToFront's zIndex, drag/resize)
// rather than replacing the object — render() itself, not object identity, is this app's one
// authoritative "something changed, please reflect it" signal (see every render() call site).
// Gating on reference equality was tried first and is WRONG: it silently dropped any update that
// mutated an item in place and called render() without also touching the DOM directly (drag/resize
// self-update the DOM alongside the mutation, which is why those still looked fine) — e.g. pasting
// an embed URL updated `it.embedUrl` correctly but the card never visually reflected it until a
// full page reload rebuilt every object fresh.
//
// That fix had its own side effect worth flagging: every item's function body + effect now re-runs
// on every render() call, no matter which item actually changed — e.g. a running Stopwatch's own
// per-second tick (ensureSwTicking/swTick, history-autosave.js) calls render() for the WHOLE
// canvas, so every OTHER item's layout effect re-runs too. For converted kinds that's harmless
// (React's own reconciler still diffs JSX output and no-ops an unchanged Component). For kinds
// still on window.__renderLegacyCardBody it isn't: that call is a blind `el.innerHTML = ...`
// rebuild with no diffing of its own, so an unrelated item's tick was blowing away e.g. a Shelf
// card's mid-transition selection-highlight state once a second, unprompted. The __lastBodySig
// check below is a cheap, targeted fix for exactly that: skip the rebuild when a fresh
// JSON.stringify(it) matches what was last actually rendered, so a legacy body only rebuilds when
// its own data genuinely changed — real per-item dirty tracking, just derived instead of
// hand-maintained, so no mutation call site needs touching.
function CanvasItem({ it }) {
  const ref = useRef(null);
  const Component = CARD_KIND_COMPONENTS[it.kind];

  useLayoutEffect(() => {
    if (!ref.current) return;
    window.__applyCanvasItemWrapperAttrs(ref.current, it);
    if (!Component) {
      const sig = JSON.stringify(it);
      if (ref.current.__lastBodySig !== sig) {
        ref.current.__lastBodySig = sig;
        window.__renderLegacyCardBody(ref.current, it);
      }
    }
    window.__attachUniversalItemBehavior(ref.current, it);
  });

  return <div ref={ref} id={"item-" + it.id}>{Component ? <Component it={it} /> : null}</div>;
}

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
