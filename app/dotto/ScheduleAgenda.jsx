"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { scheduleAgendaStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_AGENDA = { hours: [], events: [] };

// One scheduled event's real-looking card preview. renderRealCardPreview builds a whole live DOM
// node (any card kind can be scheduled) — same "vanilla function builds live DOM, React just
// mounts it" pattern as CanvasCard's buildFolderInlineCanvas. Dependency array is [it, w, h], not
// [it.id]/[ev.id]: `it`/`ev` are the same live, in-place-mutated references
// renderScheduleAgenda reads off appState each call (see that function's own comment), so as long
// as the item itself and its scheduled size haven't changed, the already-built preview is left
// alone rather than torn down and rebuilt — renderScheduleAgenda only ever runs on entering the
// view or shifting the date, not on unrelated canvas activity, so this never needs to guard
// against the kind of thrash the __lastBodySig/MediaCard fixes were for.
function AgendaEventCard({ it, ev, top, w, h }) {
  const wrapRef = useRef(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.innerHTML = "";
    const card = window.__renderRealCardPreview(it);
    card.style.position = "relative";
    if (it.kind !== "title") {
      card.style.width = w + "px";
      card.style.height = h + "px";
    }
    // No dragging/moving (renderRealCardPreview never wires that up — it's a real-looking but
    // otherwise inert clone by default), but folder/source cards can still be clicked into, and a
    // note's text can still be edited directly — same as the original inline branch this was
    // lifted from.
    if (it.kind === "folder" || it.kind === "source") {
      card.style.cursor = "pointer";
      card.addEventListener("click", (e) => {
        e.stopPropagation();
        window.__exitScheduleViewMode();
        window.__openFolder(it.folderId);
      });
    } else if (it.kind === "note") {
      const body = card.querySelector(".body");
      if (body) {
        body.contentEditable = "true";
        body.style.cursor = "text";
        body.addEventListener("pointerdown", (e) => e.stopPropagation());
        body.addEventListener("blur", () => {
          it.html = body.innerHTML;
          window.__scheduleWorkspaceSave();
        });
      }
    }
    wrap.appendChild(card);
  }, [it, w, h]);

  return <div className="schedule-view-card-wrap" style={{ top: top + "px", width: w + "px" }} ref={wrapRef} />;
}

// Portals the current agenda's hour markers + event cards into #schedule-view-hours/#schedule-
// view-stack (content/fragments/canvas-area.html) — both plain, unstyled grouping divs (every
// real layout rule targets their CHILDREN, position:absolute against the shared, always-real
// #schedule-view-inner ancestor — see globals.css), so portaling one level "into" them instead of
// replacing them outright is a no-op for layout, same reasoning as #items-layer.
// #schedule-view-date's textContent and #schedule-view-inner's height are deliberately left
// vanilla (see renderScheduleAgenda in public/dotto/messages-schedule.js) — trivial, no
// list-diffing involved, not worth a third portal.
export default function ScheduleAgenda() {
  const { hours, events } = useSyncExternalStore(scheduleAgendaStore.subscribe, scheduleAgendaStore.getSnapshot, () => EMPTY_AGENDA);
  const hoursNode = usePortalNode("schedule-view-hours");
  const stackNode = usePortalNode("schedule-view-stack");

  if (!hoursNode || !stackNode) return null;

  return (
    <>
      {createPortal(
        hours.map((h) => (
          <div key={h.hour} className="schedule-view-hour" style={{ top: h.top + "px" }}>
            {h.label}
          </div>
        )),
        hoursNode,
      )}
      {createPortal(
        events.length ? (
          events.map(({ it, ev, top, w, h }) => <AgendaEventCard key={ev.id} it={it} ev={ev} top={top} w={w} h={h} />)
        ) : (
          <div id="schedule-view-empty">
            Nothing scheduled for this day on this canvas.
            <br />
            <br />
            Right-click any card (or a selection of cards) and choose &quot;Schedule&quot; to add one.
          </div>
        ),
        stackNode,
      )}
    </>
  );
}
