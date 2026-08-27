"use client";

// setupResizing moved here from public/dotto/resize-shortcuts-init.js — Phase 3 of the
// vanilla->React consolidation (CONTRIBUTING.md's "continuous pointer-driven pixel math"
// category), the first "canvas core" piece done: relocating this closure out of a separate
// vanilla module and into app/dotto/, called directly (a real import, not a window.__ bridge) by
// every already-React card component that owns a resize handle (TableCard.jsx, FlashcardCard.jsx,
// MediaCard.jsx, TypeRightCard.jsx). The one remaining vanilla caller (attachNoteBody,
// waypoints-render-loop.js — reached itself via NoteCard.jsx's own layout effect) still needs a
// bridge, but that bridge's OWNERSHIP flipped: window.__setupResizing is now assigned here (see
// app/dotto-app.jsx) instead of in resize-shortcuts-init.js, with vanilla as the caller instead of
// React. The logic itself is unchanged byte-for-byte from the original — this is a relocation, not
// a rewrite: appState/saveSnapshot/renderTableHTML/distributeTableSizing/broadcastItemResize/
// scheduleWorkspaceSave all still live in public/dotto/*.js and are reached via window.__ bridges
// (see each one's own comment, in core-state.js/history-autosave.js/source-table.js/
// live-presence.js) since public/dotto/*.js isn't reachable from app/dotto/ the other way.

// Correct minimum for one axis (width or height) of a table whose column/row split might be
// UNEVEN — dragging one divider rewrites the WHOLE colWidths/rowHeights array (see
// startTableColResize/startTableRowResize, resize-shortcuts-init.js), and a freshly added
// column/row's own "average of existing" default (see growGridSizingForNewEntry, source-table.js)
// can leave the split uneven even without any single entry being individually dragged. Just
// checking count*unitMinPx (assuming every entry gets an equal share) isn't enough on its own: if
// one entry's percentage share is smaller than that assumption, the table-wide total could already
// be at that naive floor while THAT one entry is still below its own minimum — invisibly, if it's
// an empty cell with no text content pushing back against the too-small height the browser would
// otherwise silently honor (a non-empty cell's own text needing more room masks exactly this,
// which is why it only ever showed up on empty ones). Solving "smallestSharePct/100 * axisTotal >=
// unitMinPx" for axisTotal gives the true floor: whatever axisTotal makes the SMALLEST-share entry
// exactly hit its own minimum is the binding constraint for the whole axis, since every other
// (larger-share) entry is automatically well above its own minimum at that same total.
function tableAxisMinPx(percentages, count, unitMinPx) {
  if (!count) return unitMinPx;
  const arr = Array.isArray(percentages) && percentages.length === count ? percentages : new Array(count).fill(100 / count);
  const minPct = Math.min(...arr);
  return minPct > 0 ? (unitMinPx * 100) / minPct : count * unitMinPx;
}

// ---------- Element Resize System ----------
// Called every time a card's body is (re)built — including, for a Component-owned kind (see
// CARD_KIND_COMPONENTS, CanvasItemsLayer.jsx), on every render() call, since that kind's own
// layout effect has no dependency array (see the canvas-items-react plan, PHASE2_ROADMAP.md). A
// plain addEventListener would stack a duplicate pointerdown listener on the same persistent
// .resize handle each time instead of replacing it — same fix as setupDraggingAndClicking
// (public/dotto/drag-drop-chat.js, not yet moved): abort the previous listener before attaching a
// fresh one, a no-op on first call.
export function setupResizing(el, it) {
  const handle = el.querySelector(".resize");
  if (!handle) return;
  handle.__resizeListenerAbort?.abort();
  const { signal } = (handle.__resizeListenerAbort = new AbortController());
  handle.addEventListener(
    "pointerdown",
    (e) => {
      e.stopPropagation();
      // stopPropagation alone only stops the drag system's own listener from firing — it does
      // nothing to the browser's own native default action for a mousedown-and-drag, which for a
      // media card is "start a text selection" if the drag happens to sweep near/across the
      // invisible PDF text layer sitting nearby. preventDefault suppresses that native default
      // outright, so dragging this handle is only ever a resize.
      e.preventDefault();
      window.__saveSnapshot();
      const appState = window.__getAppState();
      if (it.kind === "table" && !it.userSized) {
        it.w = el.offsetWidth;
        it.h = el.offsetHeight;
        it.userSized = true;
        el.classList.add("sized");
        el.style.width = it.w + "px";
        el.style.height = it.h + "px";
        el.innerHTML = window.__renderTableHTML(it);
        setupResizing(el, it);
        window.__distributeTableSizing(it, el);
      }
      let sx = e.clientX,
        sy = e.clientY,
        sw = it.w,
        sh = it.h;
      const minSize = it.kind === "table" ? 56 : 112;
      // A table's real minimum width/height isn't a flat constant the way every other kind's is
      // — it depends on how many columns/rows it actually has (every column needs at least
      // TABLE_COL_MIN_PX, every row at least TABLE_ROW_MIN_PX, the exact same floors the
      // per-column/row divider drag already enforces) AND, since that split can be uneven, on how
      // the CURRENT colWidths/rowHeights actually divide up the space — see tableAxisMinPx's own
      // comment above for why a plain count*unitMinPx isn't enough on its own once the split
      // isn't perfectly even. The flat 56px minSize above didn't account for any of that:
      // shrinking a 5-column table's OVERALL width down to 56px asked every column to fit in
      // ~11px, far under their own CSS min-width:40px — the cells refused to actually shrink that
      // far (browsers don't let a cell go below its own min-width), but the WRAPPER did, so the
      // now-too-small wrapper's own overflow:hidden clipped whatever of the (still full-sized)
      // cells stuck out past it — including, for whichever cell that clip cut through, its own
      // border. Flooring it.w/it.h at the table's actual per-column/row space requirement means
      // the wrapper can never ask for less room than the cells genuinely need, so there's nothing
      // left for it to clip.
      const tableMinW = it.kind === "table" ? tableAxisMinPx(it.colWidths, (it.tableData[0] || []).length, window.__TABLE_COL_MIN_PX) : minSize;
      const tableMinH = it.kind === "table" ? tableAxisMinPx(it.rowHeights, (it.tableData || []).length, window.__TABLE_ROW_MIN_PX) : minSize;
      // Media cards (image/video/PDF/EPUB) resize proportionally, preserving their content's real
      // aspect ratio, instead of each axis independently the way table/flashcard do (or
      // width-only the way note does, just below) — locked to the PDF page's own true ratio if
      // it's known yet (see renderPage's it.docAspectRatio), otherwise whatever ratio the card is
      // currently at (correct already for images/video, since computeMediaCardSize set w/h from
      // the media's own natural dimensions; an arbitrary starting point for EPUB, which has no
      // fixed "page" shape to lock to, but still scales proportionally from wherever it starts).
      const aspectRatio = it.kind === "media" ? it.docAspectRatio || sw / sh : null;
      const move = (me) => {
        const dx = (me.clientX - sx) / appState.scale,
          dy = (me.clientY - sy) / appState.scale;
        if (aspectRatio) {
          // Follow whichever axis the cursor moved more along; derive the other from the locked
          // ratio rather than letting both drift independently.
          let newW, newH;
          if (Math.abs(dx) >= Math.abs(dy)) {
            newW = sw + dx;
            newH = newW / aspectRatio;
          } else {
            newH = sh + dy;
            newW = newH * aspectRatio;
          }
          it.w = Math.max(minSize, Math.round(newW / 28) * 28);
          it.h = Math.max(minSize, Math.round(newH / 28) * 28);
          el.style.width = it.w + "px";
          el.style.height = it.h + "px";
        } else if (it.kind === "note") {
          // Width only — dy is ignored entirely. Height is never set here (or anywhere else for
          // notes): it's always automatic, driven by plain CSS auto-sizing at whatever width this
          // drag lands on (see .item.note/.body, globals.css) — the browser reflows the text and
          // resizes the wrapper on its own, live, with no JS measurement needed on every
          // pointermove.
          it.w = Math.max(minSize, Math.round((sw + dx) / 28) * 28);
          el.style.width = it.w + "px";
        } else {
          it.w = Math.max(tableMinW, Math.round((sw + dx) / 28) * 28);
          it.h = Math.max(tableMinH, Math.round((sh + dy) / 28) * 28);
          el.style.width = it.w + "px";
          el.style.height = it.h + "px";
        }
        if (it.kind === "table") window.__distributeTableSizing(it, el);
        // Live visual streaming while dragging — see handleRemoteItemResize/broadcastItemResize.
        // Purely DOM-only on the receiving end, same as item-drag; the real w/h is only committed
        // once scheduleWorkspaceSave below runs on release. For notes, it.h at this point is
        // whatever attachNoteBody's ResizeObserver last measured — close enough mid-drag, and it
        // settles exactly once that observer's next callback fires.
        window.__broadcastItemResize(it.id, it.w, it.h);
      };
      // Previously never called scheduleWorkspaceSave() at all — a resize wasn't synced live to
      // collaborators OR promptly persisted; it only ever reached the DB once some unrelated
      // later action happened to trigger a save.
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.__scheduleWorkspaceSave();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    { signal },
  );
}
