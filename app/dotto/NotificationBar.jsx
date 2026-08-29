"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { notificationsStore } from "./bridges";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh array literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_LIST = [];

const GAP_PX = 10;
const BOTTOM_PX = 20;
// How long the shift-up (every existing card's own `bottom` changing, a plain CSS transition)
// takes — the new card's own slide-in is deliberately delayed by this same amount so it starts
// only once the shift has visibly finished, per explicit spec: "existing ones shift upwards and
// the new one slides in" (not simultaneously).
const SHIFT_MS = 250;
// How long a card's own exit (slide-out-left + fade, see the `exiting` prop below) takes to finish
// before it's actually dropped from the DOM — matches .notification-card's own longest transition
// (transform .3s / opacity .3s, globals.css) with a little headroom so it never gets cut short.
const EXIT_MS = 320;

// One card. `bottom` (px, computed by the stack below from every card BELOW it in the list's own
// measured height — i.e. every notification newer than this one) drives its position via a plain
// CSS transition — when a new notification arrives, every existing card's own `bottom` increases
// by the new card's height + gap, and since that's just a transitioned CSS property, the browser
// animates the shift upward for free, no manual animation code needed. `entered` starts false
// (off-screen left, tucked under the rail — transform+opacity per .notification-card's own CSS)
// and flips true after SHIFT_MS, triggering this card's own slide-in transition — the delay is
// what makes the "shift first, THEN slide in" sequencing real rather than both happening at once.
//
// `exiting` (true only for cards NotificationBar is keeping mounted past their removal from the
// store's own list — see its own comment) forces the rendered class back to the un-entered state
// regardless of the `entered` flag above, which — since .notification-card's un-entered CSS IS
// the off-screen-left/faded-out state — reuses the exact same entrance transition in reverse for a
// real slide-out-left exit, no separate exit CSS needed. `entered` itself is never reset to false
// here; this card's own React instance is the SAME one carried over from when it was a normal list
// entry (React matches it by key across NotificationBar's re-render, see the `exiting` map there),
// so its slide-in already happened and won't replay.
function NotificationCard({ entry, bottom, exiting, onMeasure }) {
  const ref = useRef(null);
  const [entered, setEntered] = useState(false);

  // No dependency array — re-measures on every render (e.g. content changing), not just mount.
  // Guarded to a no-op by onMeasure's own "same height, don't bother re-rendering" check
  // (NotificationBar's handleMeasure below), so this can't loop.
  useLayoutEffect(() => {
    if (ref.current) onMeasure(entry.id, ref.current.offsetHeight);
  });

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), SHIFT_MS);
    return () => clearTimeout(t);
  }, []);

  const { config } = entry;
  return (
    <div
      ref={ref}
      className={"notification-card" + (entered && !exiting ? " entered" : "")}
      style={{ bottom }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top-RIGHT (per explicit spec), hover-revealed only — .notification-card:hover's own CSS
          rule shows this; close.png follows the same black-source-PNG tinting convention every
          other raw icon in this file uses. */}
      <button
        type="button"
        className="notification-close-btn"
        title="Close"
        onClick={(e) => {
          e.stopPropagation();
          window.__dismissNotification(entry.id);
        }}
      >
        <img src="/assets/icons/close.png" alt="" />
      </button>
      {config.imageUrl && <img className="notification-image" alt="" src={config.imageUrl} />}
      <div className="notification-text">{config.message}</div>
      {config.actionLabel && (
        <button
          type="button"
          className="notification-action"
          onClick={(e) => {
            e.stopPropagation();
            window.runNotificationAction(entry.id);
          }}
        >
          {config.actionLabel} ↵
        </button>
      )}
    </div>
  );
}

// Notification stack, bottom-left — explicit redesign (was a single top-center pill, one at a
// time, swapping places with #top-bar-center — see notificationsStore's own comment, bridges.js,
// for the full "before" picture and why; briefly a top-right stack sliding in from the right
// before an earlier follow-up remirrored it to bottom-left, sliding from the left — same
// underlying store/engine, just repositioned). Fully React-owned: no portal into static markup,
// this component renders its own fixed-position stack directly.
// Anchored bottom-left, sliding out from the left "under the sidebar, not over" (see
// .notification-stack's own z-index comment, globals.css — kept BELOW #dotto-rail's z-index so
// the rail always wins the overlap during a card's slide-in/out, rather than momentarily
// covering it) — newest notification lands at the anchor (closest to the corner), and arriving
// notifications push every EXISTING (older) one upward to make room, per explicit spec.
// Height is "auto" per explicit spec — every card's real height can differ (message length,
// whether it has an image/action button), so `bottom` offsets are computed here from each card's
// own MEASURED height (via NotificationCard's own useLayoutEffect + onMeasure below) rather than
// an assumed fixed row height, which would either clip content or leave uneven gaps.
export default function NotificationBar() {
  const list = useSyncExternalStore(
    notificationsStore.subscribe,
    notificationsStore.getSnapshot,
    () => EMPTY_LIST,
  );
  const [heights, setHeights] = useState({});
  // Entries that have already left `list` (evicted past NOTIFICATION_MAX_VISIBLE, dismissed, or
  // auto-expired — the reason doesn't matter, they all exit the same way) but are still playing
  // their exit animation — {id, entry, bottom}[], `bottom` frozen at wherever that card was sitting
  // the moment it left `list`, so it holds its slot and slides out sideways from there rather than
  // jumping anywhere first. Rendered with the SAME key as when it was a normal list entry (see the
  // JSX below), so React treats it as the same component instance rather than a fresh mount — see
  // NotificationCard's own comment on why that's what makes `exiting` reuse the entrance
  // transition in reverse for free.
  const [exitingEntries, setExitingEntries] = useState([]);
  const prevListRef = useRef([]);
  const lastBottomsRef = useRef({});
  const exitTimersRef = useRef({});

  // Diffs the incoming store list against the previous one to find whatever just fell off (however
  // it left — see exitingEntries' own comment) and hands each one a one-shot exit slot.
  useEffect(() => {
    const newIds = new Set(list.map((e) => e.id));
    const removed = prevListRef.current.filter((e) => !newIds.has(e.id));
    if (removed.length) {
      setExitingEntries((prev) => {
        const already = new Set(prev.map((x) => x.entry.id));
        const additions = removed
          .filter((e) => !already.has(e.id))
          .map((e) => ({ entry: e, bottom: lastBottomsRef.current[e.id] ?? BOTTOM_PX }));
        return additions.length ? prev.concat(additions) : prev;
      });
      removed.forEach((e) => {
        if (exitTimersRef.current[e.id]) return; // already scheduled for removal
        exitTimersRef.current[e.id] = setTimeout(() => {
          setExitingEntries((prev) => prev.filter((x) => x.entry.id !== e.id));
          delete exitTimersRef.current[e.id];
        }, EXIT_MS);
      });
    }
    prevListRef.current = list;
  }, [list]);

  useEffect(
    () => () => {
      Object.values(exitTimersRef.current).forEach(clearTimeout);
    },
    [],
  );

  const handleMeasure = (id, h) => {
    setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
  };

  // list[0] is newest (see showNotification, notifications.js) — it gets the
  // anchor position, every older entry after it accumulates upward from there. Exiting cards are
  // NOT part of this pass — they keep the frozen position captured when they left `list` (below),
  // independent of however the remaining real entries reflow. Computed unconditionally (even when
  // there's nothing to show) so the ref-sync effect right after it stays an unconditional hook
  // call too — this component only ever returns null AFTER every hook above has run.
  let cumulative = BOTTOM_PX;
  const bottoms = {};
  list.forEach((entry) => {
    bottoms[entry.id] = cumulative;
    cumulative += (heights[entry.id] || 0) + GAP_PX;
  });

  // Keeps lastBottomsRef in sync with wherever each card is CURRENTLY sitting, so that if it's
  // removed from `list` on some later render, the diffing effect above can freeze it at its real
  // last position instead of falling back to BOTTOM_PX. A plain ref mutation, not setState —
  // nothing needs to re-render off of this, it's only ever read later from inside that other
  // effect — and refs may only be written from an effect/event handler, never during render itself.
  useLayoutEffect(() => {
    Object.assign(lastBottomsRef.current, bottoms);
  });

  if (!list.length && !exitingEntries.length) return null;

  return (
    <div className="notification-stack">
      {list.map((entry) => (
        <NotificationCard
          key={entry.id}
          entry={entry}
          bottom={bottoms[entry.id]}
          onMeasure={handleMeasure}
        />
      ))}
      {exitingEntries.map(({ entry, bottom }) => (
        <NotificationCard
          key={entry.id}
          entry={entry}
          bottom={bottom}
          exiting
          onMeasure={handleMeasure}
        />
      ))}
    </div>
  );
}
