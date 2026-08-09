"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { canvasItemsStore, scheduleModeStore, SCHEDULE_MODE_OFF } from "./bridges";
import usePortalNode from "./usePortalNode";
import CanvasCard from "./CanvasCard";
import ChecklistCard from "./ChecklistCard";
import EmbedCard from "./EmbedCard";
import FilterCard from "./FilterCard";
import FlashcardCard from "./FlashcardCard";
import MediaCard from "./MediaCard";
import NoteCard from "./NoteCard";
import ScheduleModeCardBody from "./ScheduleModeCardBody";
import SentenceCard from "./SentenceCard";
import ShelfCard from "./ShelfCard";
import SourceCard from "./SourceCard";
import StatcardCard from "./StatcardCard";
import StopwatchCard from "./StopwatchCard";
import TableCard from "./TableCard";
import TitleCard from "./TitleCard";
import TypeRightCard from "./TypeRightCard";
import WatermarkCard from "./WatermarkCard";
import WaypointCard from "./WaypointCard";

// Module-level, not inline in the hook call below — useSyncExternalStore's getServerSnapshot must
// return a referentially stable value across calls, or React reads it as never settling ("the
// result of getServerSnapshot should be cached to avoid an infinite loop"). A fresh `() => []`
// array literal every render trips that same warning SelectionToolbar.jsx originally had.
const EMPTY_ITEMS = [];

// Every card kind maps to a real Component now — see PHASE2_ROADMAP.md's migration order for how
// each one got here. A future new kind gets added here (and nowhere else in this file).
const CARD_KIND_COMPONENTS = {
  checklist: ChecklistCard,
  embed: EmbedCard,
  filter: FilterCard,
  flashcard: FlashcardCard,
  folder: CanvasCard,
  media: MediaCard,
  note: NoteCard,
  sentence: SentenceCard,
  shelf: ShelfCard,
  source: SourceCard,
  statcard: StatcardCard,
  stopwatch: StopwatchCard,
  table: TableCard,
  title: TitleCard,
  typeright: TypeRightCard,
  watermark: WatermarkCard,
  waypoint: WaypointCard,
};

// One canvas item's wrapper <div>. React's job is creating/keying/removing this node and owning
// its real JSX children (Component) — className/style/event wiring for the wrapper itself is
// still owned by vanilla code (public/dotto/waypoints-render-loop.js), called from a layout effect
// so it runs synchronously before paint, matching the old code's single-pass
// createElement+build+appendChild (no visible empty-card flash on first mount). None of that
// (drag/click, aiGenerated badge, right-click suppression) is kind-specific.
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
// canvas, so every OTHER item's layout effect re-runs too. Harmless here (React's own reconciler
// still diffs each Component's JSX output and no-ops an unchanged one), but individual Components
// with an expensive rebuild of their own (CanvasCard's inline preview, MediaCard's PDF/EPUB
// viewer) gate that specific work behind their own dependency array — see their own comments.
function CanvasItem({ it }) {
  const ref = useRef(null);
  const Component = CARD_KIND_COMPONENTS[it.kind];
  // Single-canvas Schedule Mode (public/dotto/schedule-view-canvas.js) swaps this item's real
  // per-kind Component for a simplified schedule row while it's one of today's scheduled items on
  // the currently-shown canvas — see scheduleModeStore's own comment in bridges.js for why the
  // wrapper <div> below staying the exact same DOM node either way is load-bearing for the
  // slide-in/out animation. Every other item (not a key in itemsById) keeps rendering its real
  // Component untouched — it just fades via CSS opacity, driven by the wrapper's own className
  // (applyScheduleModeWrapperAttrs, called from the layout effect below like any other wrapper
  // attr), not by anything here.
  const scheduleMode = useSyncExternalStore(scheduleModeStore.subscribe, scheduleModeStore.getSnapshot, () => SCHEDULE_MODE_OFF);
  const scheduleSlot = scheduleMode.active ? scheduleMode.itemsById.get(it.id) : null;

  useLayoutEffect(() => {
    if (!ref.current) return;
    window.__applyCanvasItemWrapperAttrs(ref.current, it);
    window.__attachUniversalItemBehavior(ref.current, it);
  });

  return (
    <div ref={ref} id={"item-" + it.id}>
      {scheduleSlot ? <ScheduleModeCardBody it={it} slot={scheduleSlot} /> : Component ? <Component it={it} /> : null}
    </div>
  );
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
  const portalNode = usePortalNode("items-layer");

  if (!portalNode) return null;
  return createPortal(items.map((it) => <CanvasItem key={it.id} it={it} />), portalNode);
}
