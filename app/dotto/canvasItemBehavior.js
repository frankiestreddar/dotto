"use client";

// The "continuous pointer-driven pixel math" pieces of canvas core (CONTRIBUTING.md's category
// name for this — Phase 3 of the vanilla->React consolidation) that have moved out of separate
// vanilla modules and into app/dotto/ so far: setupResizing (from
// public/dotto/resize-shortcuts-init.js), setupDraggingAndClicking (from
// public/dotto/drag-drop-chat.js — the single riskiest closure in the app, done second on
// purpose, once this pattern was proven safe on the smaller one first),
// renderConnectionsLayer/startConnectionDrag (from public/dotto/srs-connections-core.js — SVG
// connection-line rendering + drag-to-link, done third), and
// renderStaticTableHTML/attachStaticTableHoverZones/layoutSourceTableColumns (from
// app/dotto/lib/sourceTable.ts — the Source database page's own rendering/hover-zone geometry,
// done fourth — see that section's own comment further down for why it merges what looked like
// two separate checklist items). All relocations, not rewrites — logic unchanged byte-for-byte
// from the originals. Every already-React card component that owns a resize handle
// (TableCard.jsx, FlashcardCard.jsx, MediaCard.jsx, TypeRightCard.jsx) calls setupResizing
// directly now — no bridge needed, both sides are in app/dotto/ — and setupDraggingAndClicking
// calls startConnectionDrag directly too, for the same reason (its own only caller now lives in
// this same file). The vanilla callers that still need a bridge (attachNoteBody's own call to
// setupResizing, attachUniversalItemBehavior's own call to setupDraggingAndClicking, render()'s
// own calls to renderConnectionsLayer/renderStaticTableHTML/attachStaticTableHoverZones/
// layoutSourceTableColumns, and relayoutSourceTableIfVisible's own call to
// layoutSourceTableColumns — waypoints-render-loop.js and app/dotto/lib/sourceButtonsCursorMode.ts) reach
// these via their own window.__ bridge — bridges whose OWNERSHIP flipped: assigned here (see
// app/dotto-app.jsx) instead of in their old vanilla modules, with vanilla as the caller instead
// of React. Every OTHER vanilla dependency any of these functions still needs (appState,
// saveSnapshot, render, findItemById, makeLayerSVG, isValidConnection, escapeHtml,
// openRowTagPicker, and so on) is reached via its own window.__ bridge (see each one's own
// comment, in the public/dotto/*.js file it actually lives in) since public/dotto/*.js isn't
// reachable from app/dotto/ the other way.

// Correct minimum for one axis (width or height) of a table whose column/row split might be
// UNEVEN — dragging one divider rewrites the WHOLE colWidths/rowHeights array (see
// startTableColResize/startTableRowResize, table-grid-resize.js), and a freshly added
// column/row's own "average of existing" default (see growGridSizingForNewEntry, app/dotto/lib/sourceTable.ts)
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
  const arr =
    Array.isArray(percentages) && percentages.length === count
      ? percentages
      : new Array(count).fill(100 / count);
  const minPct = Math.min(...arr);
  return minPct > 0 ? (unitMinPx * 100) / minPct : count * unitMinPx;
}

// ---------- Element Resize System ----------
// Called every time a card's body is (re)built — including, for a Component-owned kind (see
// CARD_KIND_COMPONENTS, CanvasItemsLayer.jsx), on every render() call, since that kind's own
// layout effect has no dependency array (see the canvas-items-react plan, PHASE2_ROADMAP.md). A
// plain addEventListener would stack a duplicate pointerdown listener on the same persistent
// .resize handle each time instead of replacing it — same fix as setupDraggingAndClicking below:
// abort the previous listener before attaching a fresh one, a no-op on first call.
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
      const tableMinW =
        it.kind === "table"
          ? tableAxisMinPx(it.colWidths, (it.tableData[0] || []).length, window.__TABLE_COL_MIN_PX)
          : minSize;
      const tableMinH =
        it.kind === "table"
          ? tableAxisMinPx(it.rowHeights, (it.tableData || []).length, window.__TABLE_ROW_MIN_PX)
          : minSize;
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
          window.__mirrorItemToSiblingPanes(it.id, (siblingEl) => {
            siblingEl.style.width = it.w + "px";
            siblingEl.style.height = it.h + "px";
          });
        } else if (it.kind === "note") {
          // Width only — dy is ignored entirely. Height is never set here (or anywhere else for
          // notes): it's always automatic, driven by plain CSS auto-sizing at whatever width this
          // drag lands on (see .item.note/.body, globals.css) — the browser reflows the text and
          // resizes the wrapper on its own, live, with no JS measurement needed on every
          // pointermove. Mirrored siblings get the same free ride: their own note body is regular
          // CSS auto-sizing too, so setting only their width is enough to reflow them correctly.
          it.w = Math.max(minSize, Math.round((sw + dx) / 28) * 28);
          el.style.width = it.w + "px";
          window.__mirrorItemToSiblingPanes(it.id, (siblingEl) => {
            siblingEl.style.width = it.w + "px";
          });
        } else {
          it.w = Math.max(tableMinW, Math.round((sw + dx) / 28) * 28);
          it.h = Math.max(tableMinH, Math.round((sh + dy) / 28) * 28);
          el.style.width = it.w + "px";
          el.style.height = it.h + "px";
          window.__mirrorItemToSiblingPanes(it.id, (siblingEl) => {
            siblingEl.style.width = it.w + "px";
            siblingEl.style.height = it.h + "px";
          });
        }
        if (it.kind === "table") {
          window.__distributeTableSizing(it, el);
          window.__mirrorItemToSiblingPanes(it.id, (siblingEl) =>
            window.__distributeTableSizing(it, siblingEl),
          );
        }
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

// ---------- Element Drag and Drop System ----------
// Moved here from public/dotto/drag-drop-chat.js — Phase 3's second relocated piece, following
// the exact pattern setupResizing above already proved out. The single riskiest closure in the
// app (direct camera-state writes inside its own RAF auto-pan loop, findItemEl(id) lookups
// (see core-state.js — pane-qualified since the split-screen prep pass), a world.children scan
// for merge-target detection,
// three separate drop-zone checks) — logic unchanged byte-for-byte, every dependency that still
// lives in public/dotto/*.js reached via a window.__ bridge (see each one's own comment there);
// canvas/world are read live via window.__getCanvasEl()/__getWorldEl() (core-state.js) rather than
// a bare document.getElementById — split-screen Stage 2: canvas/world became `let` bindings
// reassigned by switchActivePane once a second pane's DOM can exist, so a bare getElementById
// would silently resolve to whichever pane's markup happens to be first in the document instead of
// the actually-active one. dispatchSelectedToChat (the "drop into an open chat" case) stayed
// vanilla — self-contained enough behind its own bridge that moving it too wasn't worth it.
//
// Called every time renderLegacyCardInto (waypoints-render-loop.js) populates an item's wrapper
// <div> — which, since the canvas-items-react plan, is a persistent node reused across renders
// rather than recreated from scratch each time (see PHASE2_ROADMAP.md). Re-registering a plain
// addEventListener on every call would stack duplicate pointerdown listeners on the same element
// instead of replacing the old one — e.g. a shift-click toggling selectedCardIds an extra time per
// accumulated duplicate, silently making selection look broken. AbortController is what makes
// repeat calls idempotent: each call aborts the previous listener (a no-op on first mount, when
// there isn't one yet) before attaching a fresh one closing over the current `it`.
export function setupDraggingAndClicking(el, it) {
  el.__dragListenerAbort?.abort();
  const { signal } = (el.__dragListenerAbort = new AbortController());
  el.addEventListener(
    "pointerdown",
    (e) => {
      const appState = window.__getAppState();
      const canvas = window.__getCanvasEl();
      const world = window.__getWorldEl();
      // The game-options panel's own controls (esp. the column-picker <select>s) must never
      // start a card drag — the .game-options-row/.game-options-slot elements' own
      // onmousedown="event.stopPropagation()" only stops the separate 'mousedown' event, not
      // this 'pointerdown' listener, and opening a native <select> popup doesn't reliably fire a
      // matching window 'pointerup' back to end() the drag afterward — so without this check,
      // picking an option left the card permanently glued to the cursor with no pointerup ever
      // arriving to release it. Same exemption pattern already used for '.resize' just above.
      if (e.target.closest(".item-options")) return;
      if (
        e.target.classList.contains("resize") ||
        (appState.currentEditingEl === el && e.target !== el)
      )
        return;
      // Table cell-merge edges (see TableCard.jsx/mergeTableCells, app/dotto/lib/sourceTable.ts) — same
      // exemption reasoning as '.resize'/'.item-options' above: the overlay's OWN React
      // onPointerDown={stopPropagation} can't stop this listener, since it's attached natively
      // on the card wrapper itself and fires during real DOM bubbling, before React's delegated
      // synthetic handlers get a chance to run at all. Only ever the actual e.target while it's
      // genuinely visible/interactive (CSS makes it display:none, and therefore un-hit-testable,
      // whenever body.option-held isn't set), so this check is safe unconditionally.
      if (e.target.closest(".table-merge-edge")) return;
      // The PDF viewer's own page/text-layer (see buildPdfViewer) — click-dragging there has to
      // be native text selection, never a card move. The rest of that card (the bottom nav bar)
      // is deliberately NOT exempted, so it's still draggable.
      if (e.target.closest(".pdf-viewer-page")) return;

      window.__bringCardToFront(it, el);

      // Selection logic happens with Shift Key, or persistently while in Select mode
      if (e.shiftKey || window.__effectiveMode() === "select") {
        e.stopPropagation();
        e.preventDefault();
        if (appState.selectedCardIds.includes(it.id)) {
          appState.selectedCardIds = appState.selectedCardIds.filter((id) => id !== it.id);
        } else {
          appState.selectedCardIds.push(it.id);
        }
        window.__renderSelectedOutlines();
        // Prevent this same interaction from also opening folders/sources, focusing
        // contenteditable bodies, or otherwise "activating" the card - shift-click should ONLY
        // toggle selection.
        const suppressShiftClick = (ce) => {
          ce.stopPropagation();
          ce.preventDefault();
          el.removeEventListener("click", suppressShiftClick, true);
        };
        el.addEventListener("click", suppressShiftClick, true);
        return;
      }

      // Data mode: drag from this card to another to link them. Cards are not otherwise
      // clickable/openable/editable while in this mode.
      if (window.__effectiveMode() === "data") {
        if (
          appState.folders[appState.currentFolderId] &&
          appState.folders[appState.currentFolderId].isSource
        )
          return;
        e.stopPropagation();
        e.preventDefault();
        const suppressDataClick = (ce) => {
          ce.stopPropagation();
          ce.preventDefault();
          el.removeEventListener("click", suppressDataClick, true);
        };
        el.addEventListener("click", suppressDataClick, true);
        startConnectionDrag(e, it, el);
        return;
      }

      if (window.__effectiveMode() === "pen") {
        if (
          appState.folders[appState.currentFolderId] &&
          appState.folders[appState.currentFolderId].isSource
        )
          return;
        e.stopPropagation();
        window.__handlePenPointerDown(e);
        return;
      }
      e.stopPropagation();
      let moved = false;
      const downX = e.clientX,
        downY = e.clientY;

      window.__saveSnapshot();

      // Which card(s) this gesture operates on: the whole selection if the pressed card is part
      // of it, otherwise just this one card.
      const isTargetSelected = appState.selectedCardIds.includes(it.id);
      const gestureIds = isTargetSelected ? appState.selectedCardIds.slice() : [it.id];
      const preDuplicateSelection = appState.selectedCardIds.slice();

      let targetEl = el,
        targetIt = it;
      const startPositions = [];
      const isAltDuplicate =
        e.altKey &&
        !(
          appState.folders[appState.currentFolderId] &&
          appState.folders[appState.currentFolderId].isSource
        );

      if (isAltDuplicate) {
        // Option/Alt held: duplicate the card(s) first, then drag the duplicate(s) away — the
        // original(s) stay exactly where they were.
        const idMap = {};
        gestureIds.forEach((srcId) => {
          const src = window.__findItemById(srcId);
          if (!src) return;
          const clone = window.__deepCloneItem(src);
          appState.topCardZIndex++;
          clone.zIndex = appState.topCardZIndex;
          appState.folders[appState.currentFolderId].items.push(clone);
          idMap[srcId] = clone.id;
          startPositions.push({ id: clone.id, x: clone.x, y: clone.y });
        });
        if (!startPositions.length) {
          appState.undoStack.pop();
          return;
        }
        appState.selectedCardIds = isTargetSelected
          ? gestureIds.map((gid) => idMap[gid]).filter((gid) => gid != null)
          : [];
        window.__render();
        const newTargetId = idMap[it.id];
        targetIt = window.__findItemById(newTargetId);
        targetEl = window.__findItemEl(newTargetId);
        if (!targetIt || !targetEl) {
          const cloneIdSet = new Set(startPositions.map((p) => p.id));
          appState.folders[appState.currentFolderId].items
            .filter((i) => cloneIdSet.has(i.id))
            .forEach(window.__deleteClonedItemFolders);
          appState.folders[appState.currentFolderId].items = appState.folders[
            appState.currentFolderId
          ].items.filter((i) => !cloneIdSet.has(i.id));
          appState.selectedCardIds = preDuplicateSelection;
          appState.undoStack.pop();
          window.__render();
          return;
        }
        window.__bringCardToFront(targetIt, targetEl);
      } else {
        // Cache starting positions of moved cards.
        // If dragging a card that is selected, drag all selected ones. Otherwise, drag only this single card!
        gestureIds.forEach((selId) => {
          const item = window.__findItemById(selId);
          if (item) startPositions.push({ id: selId, x: item.x, y: item.y });
        });
      }

      document.body.classList.add("dragging");
      let sx = e.clientX,
        sy = e.clientY,
        hovered = null;
      let lastClientX = e.clientX,
        lastClientY = e.clientY;
      // Auto-pan-driven displacement, tracked separately from startPositions' own x/y — see
      // autoPanTick below. Kept apart from the real cursor delta (sx/sy) so `up`'s "snap back to
      // original position on an aborted drop" still has startPositions' untouched original
      // coordinates to restore.
      let autoPanAccumX = 0,
        autoPanAccumY = 0;
      const suppressClick = (ce) => {
        ce.stopPropagation();
        ce.preventDefault();
        targetEl.removeEventListener("click", suppressClick, true);
      };

      // Moves every dragged card to (start position) + (real cursor delta since drag start) +
      // (accumulated auto-pan delta) — called on every real pointermove AND every auto-pan tick,
      // so a card keeps moving even while the cursor itself sits still near the edge.
      // window.__mirrorItemToSiblingPanes (core-state.js) pushes that same left/top onto any
      // sibling pane's own copy of this item right in this same tick — explicit request that
      // dragging be fully live pixel-by-pixel across split-screen panes viewing the same folder,
      // not just once the drag ends and render() next runs.
      const applyDraggedPositions = () => {
        const dx = (lastClientX - sx) / appState.scale + autoPanAccumX;
        const dy = (lastClientY - sy) / appState.scale + autoPanAccumY;
        startPositions.forEach((pos) => {
          const selItem = window.__findItemById(pos.id);
          const selEl = window.__findItemEl(pos.id);
          if (selItem && selEl) {
            selItem.x = Math.round((pos.x + dx) / 28) * 28;
            selItem.y = Math.round((pos.y + dy) / 28) * 28;
            selEl.style.left = selItem.x + "px";
            selEl.style.top = selItem.y + "px";
            window.__mirrorItemToSiblingPanes(pos.id, (el) => {
              el.style.left = selItem.x + "px";
              el.style.top = selItem.y + "px";
            });
          }
        });
        window.__broadcastItemDragPositions(startPositions);
      };

      const checkDropTargets = () => {
        // Detect if cursor is over the Blocks panel's dropzone — packaging cards into a draft
        // (packageSelectedAsTemplate) lands in My Creations (Blocks panel, #add-menu) now that
        // "browse your own library content" moved there from Library (now Plugins). #add-menu
        // looked up directly (not via appState), same as #library-dropzone-overlay just below —
        // addMenu is a plain module-level const in core-state.js, not an appState field.
        const blocksPanelEl = document.getElementById("add-menu");
        if (blocksPanelEl.classList.contains("open")) {
          const blocksRect = blocksPanelEl.getBoundingClientRect();
          const overBlocks =
            lastClientX >= blocksRect.left &&
            lastClientX <= blocksRect.right &&
            lastClientY >= blocksRect.top &&
            lastClientY <= blocksRect.bottom;
          document
            .getElementById("library-dropzone-overlay")
            .classList.toggle("active", overBlocks);
        }

        // Detect merging folder highlights
        const r1 = targetEl.getBoundingClientRect();
        let newH = null;
        for (const sib of Array.from(world.children)) {
          if (sib === targetEl || !sib.classList.contains("item")) continue;
          const sibId = window.__parseItemId(sib);
          const sibItem = appState.folders[appState.currentFolderId].items.find(
            (i) => i.id === sibId,
          );
          if (!sibItem || sibItem.kind !== "folder") continue;
          const r2 = sib.getBoundingClientRect();
          if (!(
            r1.right < r2.left ||
            r1.left > r2.right ||
            r1.bottom < r2.top ||
            r1.top > r2.bottom
          )) {
            newH = sib;
            break;
          }
        }
        if (hovered && hovered !== newH) {
          hovered.classList.remove("merging-target");
          targetEl.classList.remove("merging-target");
        }
        if (newH) {
          newH.classList.add("merging-target");
          targetEl.classList.add("merging-target");
        }
        hovered = newH;
      };

      // Auto-pan the canvas while the drag's cursor sits near the viewport's edge, so a drag can
      // reach content well beyond whatever was on-screen when it started — same UX as
      // Figma/Miro: holding near the perimeter keeps scrolling the world underneath the dragged
      // card (dragging the card along with it, via autoPanAccumX/Y) for as long as the cursor
      // stays there. Speed ramps from 0 at EDGE_MARGIN in, up to EDGE_MAX_SPEED right at the
      // edge. Driven by its own rAF loop rather than pointermove, since it has to keep going even
      // while the cursor itself is dead still.
      const EDGE_MARGIN = 60,
        EDGE_MAX_SPEED = 900; // px screen-space from edge / px per second right at the edge
      let autoPanLastT = null,
        autoPanRAFId = null;
      const autoPanTick = (now) => {
        if (autoPanLastT == null) autoPanLastT = now;
        const dt = Math.min((now - autoPanLastT) / 1000, 0.1);
        autoPanLastT = now;
        const rect = canvas.getBoundingClientRect();
        let vx = 0,
          vy = 0;
        if (lastClientX < rect.left + EDGE_MARGIN)
          vx = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientX - rect.left) / EDGE_MARGIN);
        else if (lastClientX > rect.right - EDGE_MARGIN)
          vx = EDGE_MAX_SPEED * (1 - Math.max(0, rect.right - lastClientX) / EDGE_MARGIN);
        if (lastClientY < rect.top + EDGE_MARGIN)
          vy = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientY - rect.top) / EDGE_MARGIN);
        else if (lastClientY > rect.bottom - EDGE_MARGIN)
          vy = EDGE_MAX_SPEED * (1 - Math.max(0, rect.bottom - lastClientY) / EDGE_MARGIN);
        // vx/vy are computed independently per axis, so a corner already blends into an exact
        // diagonal proportional to how close the cursor is to EACH edge (e.g. nearer the top
        // than the left pans more up than left) — this just caps the combined vector's magnitude
        // to EDGE_MAX_SPEED so a corner doesn't pan up to ~41% faster (sqrt(2)x) than a straight
        // edge would; the direction/ratio between vx and vy is untouched, only the overall speed
        // is scaled down.
        const speed = Math.hypot(vx, vy);
        if (speed > EDGE_MAX_SPEED) {
          const k = EDGE_MAX_SPEED / speed;
          vx *= k;
          vy *= k;
        }
        if (vx || vy) {
          const screenDx = vx * dt,
            screenDy = vy * dt;
          appState.tx -= screenDx;
          appState.ty -= screenDy;
          autoPanAccumX += screenDx / appState.scale;
          autoPanAccumY += screenDy / appState.scale;
          moved = true;
          window.__applyTransform();
          applyDraggedPositions();
          checkDropTargets();
        }
        autoPanRAFId = requestAnimationFrame(autoPanTick);
      };
      autoPanRAFId = requestAnimationFrame(autoPanTick);

      const move = (me) => {
        if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) moved = true;
        lastClientX = me.clientX;
        lastClientY = me.clientY;
        applyDraggedPositions();
        checkDropTargets();
      };

      const up = (me) => {
        cancelAnimationFrame(autoPanRAFId);
        document.body.classList.remove("dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (moved) targetEl.addEventListener("click", suppressClick, true);
        if (!moved) {
          if (isAltDuplicate) {
            // Nothing was actually dragged — discard the speculative duplicate(s) and restore
            // the selection exactly as it was.
            const cloneIdSet = new Set(startPositions.map((p) => p.id));
            appState.folders[appState.currentFolderId].items
              .filter((i) => cloneIdSet.has(i.id))
              .forEach(window.__deleteClonedItemFolders);
            appState.folders[appState.currentFolderId].items = appState.folders[
              appState.currentFolderId
            ].items.filter((i) => !cloneIdSet.has(i.id));
            appState.selectedCardIds = preDuplicateSelection;
            appState.undoStack.pop();
            window.__render();
            return;
          }
          if (!hovered) {
            appState.undoStack.pop();
          }
        }

        // Hide dragover templates dropbox overlay
        document.getElementById("library-dropzone-overlay").classList.remove("active");

        // Check Drop zones intersects
        const mX = me.clientX;
        const mY = me.clientY;
        let droppedOnTarget = false;

        // 1. Drop into active Chat
        if (appState.messagesPanel.classList.contains("open")) {
          const rect = appState.messagesPanel.getBoundingClientRect();
          if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
            window.__dispatchSelectedToChat(targetIt);
            droppedOnTarget = true;
          }
        }

        // 2. Drop into Blocks Dropbox (packages the dragged card(s) as a new draft, in My Creations)
        {
          const blocksPanelEl = document.getElementById("add-menu");
          if (blocksPanelEl.classList.contains("open")) {
            const rect = blocksPanelEl.getBoundingClientRect();
            if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
              window.__packageSelectedAsTemplate(targetIt);
              droppedOnTarget = true;
            }
          }
        }

        // 3. Drop into the search box as AI card context
        if (!droppedOnTarget && appState.aiPanel.classList.contains("open")) {
          const rect = appState.aiPanel.getBoundingClientRect();
          if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
            window.__addCardsToSearchContext(gestureIds);
            droppedOnTarget = true;
          }
        }

        if (droppedOnTarget) {
          // Restore original positions! Cards fly back to original coordinates
          startPositions.forEach((pos) => {
            const selItem = window.__findItemById(pos.id);
            if (selItem) {
              selItem.x = pos.x;
              selItem.y = pos.y;
            }
          });
          window.__render();
        } else {
          if (hovered) {
            window.__performMerge(targetIt, hovered);
          } else if (moved) {
            window.__render();
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    { signal },
  );
}

// ---------- Connections layer: SVG rendering + drag-to-link ----------
// Moved here from public/dotto/srs-connections-core.js — Phase 3's third relocated piece,
// following the exact pattern setupResizing/setupDraggingAndClicking already proved out. Unlike
// those two (a per-item pointer listener attached to an existing React-owned wrapper node), this
// pair builds/returns a whole vanilla SVG subtree — render() (waypoints-render-loop.js, still
// vanilla, untouched) wipes and rebuilds every #world child but #items-layer on every call, and
// inserts whatever this returns before #items-layer, exactly as it always has; only WHERE the
// building logic lives changed, not how it's invoked or how its result gets used. Logic unchanged
// byte-for-byte. applyConnections/propagateCanvasStreams (srs-connections-core.js) stayed put
// entirely untouched — despite the name, propagateCanvasStreams is card-to-card data-flow (SRS
// scoring, connected-card streams), not rendering or pointer math, so it was never actually part
// of this category.
//
// Called every render() — rebuilds the whole connections layer from scratch each time (folder-wide
// state, not per-item), unlike setupResizing/setupDraggingAndClicking's per-item idempotent
// listener pattern; there's nothing to make idempotent here since a stale layer is always fully
// discarded by render()'s own wipe before this is even called again.
export function renderConnectionsLayer(folderObj, currentItems) {
  const layer = window.__makeLayerSVG(1);
  layer.classList.add("connections-layer");
  const validIds = new Set(currentItems.map((i) => i.id));
  const conns = window.__ensureConnections(folderObj);
  folderObj.connections = conns.filter((c) => validIds.has(c.fromId) && validIds.has(c.toId));
  folderObj.connections.forEach((c) => {
    const fromItem = currentItems.find((i) => i.id === c.fromId);
    const toItem = currentItems.find((i) => i.id === c.toId);
    if (!fromItem || !toItem) return;
    const obstacles = currentItems
      .filter((i) => i.id !== fromItem.id && i.id !== toItem.id)
      .map(window.__itemRect);
    const points = window.__computeConnectorPoints(fromItem, toItem, true, obstacles);
    const d = window.__pointsToLinePath(points);

    const visible = document.createElementNS("http://www.w3.org/2000/svg", "path");
    visible.setAttribute("d", d);
    visible.setAttribute("stroke", "var(--brand)");
    visible.setAttribute("stroke-width", "2");
    visible.setAttribute("fill", "none");
    visible.setAttribute("stroke-linejoin", "round");
    visible.style.pointerEvents = "none";

    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d);
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "14");
    hit.setAttribute("fill", "none");
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = "pointer";
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = "Click to remove this connection";
    hit.appendChild(title);
    hit.addEventListener("pointerdown", (e) => e.stopPropagation());
    hit.addEventListener("click", (e) => {
      e.stopPropagation();
      window.__saveSnapshot();
      folderObj.connections = folderObj.connections.filter((x) => x.id !== c.id);
      window.__render();
    });

    layer.appendChild(visible);
    layer.appendChild(hit);
  });
  return layer;
}

// Drag-to-link: in Data mode (or with X held), dragging from a card draws a live preview line to
// the pointer; dropping on another card creates a persistent connection between them. Its only
// caller is setupDraggingAndClicking's own 'data' mode branch above — a plain function call now
// that both live in this same file, no bridge needed for that direction at all anymore.
function startConnectionDrag(e, it, el) {
  window.__saveSnapshot();
  const appState = window.__getAppState();
  const canvas = window.__getCanvasEl();
  const world = window.__getWorldEl();
  const downX = e.clientX,
    downY = e.clientY;
  let moved = false;
  const rect = canvas.getBoundingClientRect();
  const previewSvg = window.__makeLayerSVG(500);
  const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  previewPath.setAttribute("stroke", "var(--brand)");
  previewPath.setAttribute("stroke-width", "2");
  previewPath.setAttribute("stroke-dasharray", "6 4");
  previewPath.setAttribute("fill", "none");
  previewPath.setAttribute("stroke-linejoin", "round");
  previewPath.style.pointerEvents = "none";
  previewSvg.appendChild(previewPath);
  world.appendChild(previewSvg);

  let hoveredTarget = null;
  const allItems = appState.folders[appState.currentFolderId]
    ? appState.folders[appState.currentFolderId].items
    : [];
  const updatePreview = (clientX, clientY) => {
    const wx = (clientX - rect.left - appState.tx) / appState.scale,
      wy = (clientY - rect.top - appState.ty) / appState.scale;
    const obstacles = allItems
      .filter((i) => i.id !== it.id && i.id !== hoveredTarget)
      .map(window.__itemRect);
    const points = window.__computeConnectorPoints(it, { x: wx, y: wy }, false, obstacles);
    previewPath.setAttribute("d", window.__pointsToLinePath(points));
  };
  updatePreview(e.clientX, e.clientY);

  const move = (me) => {
    if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) moved = true;
    document
      .querySelectorAll(".item.link-target-hover, .item.link-target-invalid")
      .forEach((x) => x.classList.remove("link-target-hover", "link-target-invalid"));
    const under = document.elementFromPoint(me.clientX, me.clientY);
    const cardEl = under && under.closest && under.closest(".item");
    const id = cardEl ? window.__parseItemId(cardEl) : NaN;
    const candidate = !isNaN(id) && id !== it.id ? id : null;
    // Only ever treat a hovered card as a droppable target if the link would actually be allowed
    // (rules 1-3 in isValidConnection); otherwise flag it so the user gets live feedback that
    // dropping here won't do anything, instead of silently doing nothing on drop.
    hoveredTarget =
      candidate != null && window.__isValidConnection(it.id, candidate) ? candidate : null;
    if (cardEl && candidate != null)
      cardEl.classList.add(hoveredTarget != null ? "link-target-hover" : "link-target-invalid");
    updatePreview(me.clientX, me.clientY);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    previewSvg.remove();
    document
      .querySelectorAll(".item.link-target-hover, .item.link-target-invalid")
      .forEach((x) => x.classList.remove("link-target-hover", "link-target-invalid"));
    if (hoveredTarget != null && window.__isValidConnection(it.id, hoveredTarget)) {
      const conns = window.__ensureConnections(appState.folders[appState.currentFolderId]);
      window.__createConnection(conns, it.id, hoveredTarget);
      window.__render();
    } else if (!moved) {
      // No real drag happened — this was a plain click, so hand off to the click-to-link flow
      // instead of just discarding the gesture (see handleDataModeClick). The speculative
      // snapshot taken at the top of this function was only for a potential drag that didn't
      // happen; handleDataModeClick takes its own snapshot, only at the moment it actually
      // creates a connection.
      appState.undoStack.pop();
      window.__handleDataModeClick(it, el);
    } else {
      appState.undoStack.pop();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// ---------- Source database page: rendering + hover-zone geometry ----------
// Moved here from public/dotto/source-table.js (deleted in Phase 4.4, ported to app/dotto/lib/sourceTable.ts) — Phase 3's fourth relocated piece (the Source
// database page's own rendering/hover-zone geometry, previously listed as two separate-looking
// checklist items — "connection-dragging"'s own SVG rendering and Phase 4's "Source database
// page's own rendering" — that turned out to name the exact same code, merged into one pass here).
// Unlike the first three pieces, none of this is reached via React at all: render()
// (waypoints-render-loop.js, still vanilla, untouched) builds this whole page as one big
// `document.createElement('div')` appended straight to #world when the current folder isSource,
// completely bypassing CanvasItemsLayer.jsx (it explicitly calls window.__renderCanvasItems([])
// right after — see that call site's own comment). Logic unchanged byte-for-byte.
//
// cellActionsHTML/buildHeaderPillsHTML/tableCellHTML are pure HTML-string builders used only by
// renderStaticTableHTML just below; their inline onclick/oninput/onkeydown attribute strings
// (addTableCol/updateTableCell/handleTableKeydown/etc.) still resolve exactly as before against
// plain window.fnName globals (window-bridge.js) at click time, regardless of which module built
// the string — moving the STRING BUILDER doesn't touch how the resulting HTML behaves once
// parsed, which is what makes this piece markedly lower-risk than setupDraggingAndClicking despite
// being comparable in size.
function cellActionsHTML(itemId, r, c) {
  return `<div class="cell-actions" onmousedown="event.stopPropagation()">
                            <button class="cell-icon-btn cell-add-btn" onclick="event.stopPropagation(); openCellAddMenu(${itemId}, ${r}, ${c}, this)" title="Add image or audio"><img src="assets/icons/add-btn.png" alt=""></button>
                        </div>`;
}

// Renders a source table's column-name pill row (`colOptsFn(ci)` returns
// `{ oninput, onkeydown? }` for column `ci`).
function buildHeaderPillsHTML(colNames, colOptsFn) {
  return colNames
    .map((name, ci) => {
      const { oninput, onkeydown = "" } = colOptsFn(ci);
      return `
            <div class="col-name-slot" data-c="${ci}">
                <div class="col-name-pill">
                    <input type="text" class="col-name-input" data-c="${ci}" value="${window.__escapeHtml(window.__stripHtml(name || ""))}" placeholder="Column ${ci + 1}" oninput="${oninput}"${onkeydown ? ` onkeydown="${onkeydown}"` : ""}>
                </div>
            </div>`;
    })
    .join("");
}

// Renders one plain-text source-table cell (cell-inner/cell-text/cell-tags-actions-wrap).
function tableCellHTML(cell, r, c, opts) {
  const {
    originTableId,
    oninput,
    onkeydown = "",
    onfocus = "",
    onblur = "",
    oncontextmenu = "",
    tagsAndActionsHTML = "",
  } = opts;
  return `<td data-origin-table="${originTableId}" data-r="${r}" data-c="${c}"${oncontextmenu ? ` oncontextmenu="${oncontextmenu}"` : ""}>
                    <div class="cell-inner">
                        <div class="cell-text" contenteditable="true" data-r="${r}" data-c="${c}" onmousedown="handleCellMouseDown(event)" oninput="${oninput}"${onkeydown ? ` onkeydown="${onkeydown}"` : ""}${onfocus ? ` onfocus="${onfocus}"` : ""}${onblur ? ` onblur="${onblur}"` : ""}>${cell}</div>
                        ${tagsAndActionsHTML}
                    </div>
                </td>`;
}

// `folderId` param kept for callers, though nothing in here needs it anymore now that
// source-to-source merging is gone — a source's rows only ever aggregate elsewhere now, via a
// Stack card (see CardStreamIO.shelf) reading its 'sourceRows' output.
export function renderStaticTableHTML(it, folderId) {
  const numCols = it.tableData[0].length;
  const cg = window.__colgroupHTML(numCols);
  const headerPills = buildHeaderPillsHTML(it.tableData[0], (ci) => ({
    oninput: `renameTableColumn(${it.id}, ${ci}, this.value)`,
    onkeydown: `handleColNameKeydown(event, ${it.id}, ${ci})`,
  }));
  const rows = it.tableData
    .slice(1)
    .map((row, dataIdx) => {
      const ri = dataIdx + 1;
      return `<tr data-origin-table="${it.id}">${row
        .map((cell, ci) =>
          tableCellHTML(cell, ri, ci, {
            originTableId: it.id,
            oninput: `updateTableCell(${it.id}, ${ri}, ${ci}, this)`,
            onkeydown: `handleTableKeydown(event, ${it.id}, ${ri}, ${ci})`,
            onfocus: `setLastFocusedCell(${it.id}, ${ri}, ${ci}); broadcastEditingState(true, '#${window.__itemElId(it.id)} .cell-text[data-r=&quot;${ri}&quot;][data-c=&quot;${ci}&quot;]')`,
            onblur: `broadcastEditingState(false)`,
            oncontextmenu: `openTableCellContextMenu(event, ${it.id}, ${ri}, ${ci})`,
            tagsAndActionsHTML:
              ci === 0
                ? `<div class="cell-tags-actions-wrap"><div class="cell-tags">${window.__tagPillsHTML(it, ri)}</div>${cellActionsHTML(it.id, ri, ci)}</div>`
                : cellActionsHTML(it.id, ri, ci),
          }),
        )
        .join("")}</tr>`;
    })
    .join("");
  return `<div class="static-table-wrap" style="--cell-align:${it.textAlign || "left"}">
                <div class="static-table-header-overlay">
                    <div class="static-table-header-fade"></div>
                    <button class="static-table-upload-btn" onclick="event.stopPropagation(); triggerSourceUpload()" title="Import a file (CSV, Anki deck, ...) — new rows are merged into this table"><img src="assets/icons/upload-btn.png" alt=""></button>
                </div>
                <div class="static-table-scroller-row">
                    <div class="static-table-hscroll">
                        <div class="static-table-header-track">${headerPills}</div>
                        <div class="static-table-row">
                            <div class="table-rounded"><table class="item-table">${cg}<tbody>${rows}</tbody></table></div>
                        </div>
                    </div>
                    <div class="static-table-row-tag-strip-wrap">
                        <div class="row-tag-strip" onmousedown="event.stopPropagation()" title="Tags"><div class="add-btn"><img src="assets/icons/tag-button.png" alt=""></div></div>
                    </div>
                    <div class="static-table-col-strip-wrap">
                        <div class="add-col-strip" onmousedown="event.stopPropagation()" onclick="addTableCol(${it.id})" title="Add column"><div class="add-btn">+</div></div>
                    </div>
                </div>
                <div class="add-row-strip" onmousedown="event.stopPropagation()">
                    <div class="add-row-btn" onclick="addTableRow(${it.id})" title="Add row"><div class="add-btn">+</div></div>
                </div>
            </div>`;
}

// Sizes every column (the header pill slots and the table's own <col>s) to an identical width
// derived from the container's (viewport-based) rendered width: with 2 or fewer columns they
// simply divide up the full width, but past 2 columns each column is pinned to
// containerWidth/VISIBLE_COLS regardless of how many there are, so 2 full columns plus roughly a
// fifth of the next one show at once and the table scrolls horizontally — was 3 columns before it
// scrolled, tightened to 2 per explicit request that 2 columns fit the screen and anything past
// that scroll instead.
// Each header pill's *slot* always gets the exact same width as its table column, and slots sit
// flush against each other with no gap/margin of their own — that's what keeps the header
// perfectly aligned with the table no matter how many columns exist. The visible pill inside each
// slot is simply drawn narrower (by GAP px) than its slot, which is what creates the gap between
// pills without ever touching their positions. This also sizes and shows/hides the fixed
// upload-button overlay and its fade-out.
export function layoutSourceTableColumns(it, el, reserve) {
  const appState = window.__getAppState();
  const wrap = el.querySelector(".static-table-wrap");
  const table = el.querySelector(".item-table");
  const tableRounded = el.querySelector(".table-rounded");
  const headerTrack = el.querySelector(".static-table-header-track");
  const headerOverlay = el.querySelector(".static-table-header-overlay");
  const headerFade = el.querySelector(".static-table-header-fade");
  const colStripWrap = el.querySelector(".static-table-col-strip-wrap");
  const rowTagStripWrap = el.querySelector(".static-table-row-tag-strip-wrap");
  if (!wrap || !table || !headerTrack) return;
  const numCols = (it.tableData[0] || []).length;
  if (!numCols) return;
  const fullContainerWidth = wrap.clientWidth;
  if (!fullContainerWidth || fullContainerWidth <= 0) return;
  const overflowing = numCols > 2;

  // The header pill row always sizes itself off the FULL container width — it never reacts to
  // `reserve`. The add-column hover shrink is meant to only nudge the table's own cells out of
  // the way for the floating button, not the name pills above them.
  const headerColWidth =
    fullContainerWidth / (overflowing ? appState.STATIC_TABLE_VISIBLE_COLS : numCols);
  const headerTotalWidth = headerColWidth * numCols;
  headerTrack.style.width = headerTotalWidth + "px";
  const headerSlots = headerTrack.querySelectorAll(".col-name-slot");
  headerSlots.forEach((slot, i) => {
    // The slot itself always stays exactly the width of its table column (for alignment) — only
    // the *visible pill* inside it is drawn narrower, both for the normal inter-pill gap and, on
    // the rightmost one, permanently reserving extra room so the fixed upload button never sits
    // on top of its text.
    slot.style.width = headerColWidth + "px";
    const isLast = i === headerSlots.length - 1;
    const pill = slot.querySelector(".col-name-pill");
    if (pill)
      pill.style.width =
        Math.max(
          headerColWidth -
            appState.STATIC_HEADER_PILL_GAP -
            (isLast ? appState.STATIC_TABLE_UPLOAD_BTN_RESERVE : 0),
          24,
        ) + "px";
  });

  // `reserve` (px) is how much room to genuinely give up on the right — used while the
  // add-column button is hovered/revealed and the table is scrolled all the way to its right
  // edge, so the table body redraws narrower and shows its own right border in the gap, rather
  // than just having that sliver of content silently scrolled out of view underneath the button.
  // Every column but the last always uses the same width as the header pills
  // (fullContainerWidth-based, never reserve-adjusted) — only the *last* column gets narrowed by
  // the flat `reserve` amount. That keeps the shrink a constant number of pixels no matter how
  // many columns the table has, instead of scaling up with column count.
  const colWidth =
    fullContainerWidth / (overflowing ? appState.STATIC_TABLE_VISIBLE_COLS : numCols);
  const totalWidth = colWidth * numCols;
  const shrink = reserve || 0;
  table.style.width = totalWidth - shrink + "px";
  const cols = table.querySelectorAll(":scope > colgroup > col");
  cols.forEach((col, i) => {
    const isLast = i === cols.length - 1;
    col.style.width = (isLast ? Math.max(colWidth - shrink, 24) : colWidth) + "px";
  });
  // table-rounded gets the same explicit total width as the table itself, so it never has any
  // horizontal overflow of its own to clip (see the CSS note above on why that matters) — the
  // *outer* .static-table-hscroll is what actually scrolls it.
  if (tableRounded) tableRounded.style.width = totalWidth - shrink + "px";

  // The table body's max-height is computed precisely off the real header height (rather than a
  // rough guess), so it expands to fill the available space — leaving a fixed
  // STATIC_TABLE_BOTTOM_MARGIN gap below it — before it needs to start scrolling.
  if (tableRounded) {
    const availableWrapHeight =
      window.innerHeight -
      appState.STATIC_TABLE_PAGE_PADDING_TOP -
      appState.STATIC_TABLE_PAGE_PADDING_BOTTOM -
      appState.STATIC_TABLE_BOTTOM_MARGIN;
    const maxTableHeight = Math.max(
      0,
      availableWrapHeight - headerTrack.offsetHeight - appState.STATIC_TABLE_ROW_GAP,
    );
    tableRounded.style.maxHeight = maxTableHeight + "px";
  }

  // The overlay doesn't scroll, so it just needs to match the header row's own height once (not
  // per column) to sit correctly over it.
  if (headerOverlay) headerOverlay.style.height = headerTrack.offsetHeight + "px";
  // The fade under the upload button is now always on, regardless of column count.
  if (headerFade) headerFade.classList.add("visible");
  // Keep the add-column overlay confined to the body's vertical span only — it starts right below
  // the header track (offset by the hscroll's own column-gap) so it can never sit on top of, or
  // intercept clicks/hover on, the header pill row above it.
  if (colStripWrap)
    colStripWrap.style.top = headerTrack.offsetHeight + appState.STATIC_TABLE_ROW_GAP + "px";
  // Same vertical confinement as the add-column overlay, so the row-tag button can never appear
  // over (or intercept hover on) the header pill row above it either.
  if (rowTagStripWrap)
    rowTagStripWrap.style.top = headerTrack.offsetHeight + appState.STATIC_TABLE_ROW_GAP + "px";
}

export function attachStaticTableHoverZones(container, tableItem) {
  const appState = window.__getAppState();
  const wrap = container.querySelector(".static-table-wrap");
  const rowStrip = container.querySelector(".add-row-strip");
  const tableRounded = container.querySelector(".table-rounded");
  const colStripWrap = container.querySelector(".static-table-col-strip-wrap");
  const colBtn = container.querySelector(".add-col-strip");
  const rowBtn = container.querySelector(".add-row-btn");
  const hscroll = container.querySelector(".static-table-hscroll");
  const rowTagStripWrap = container.querySelector(".static-table-row-tag-strip-wrap");
  const rowTagBtn = container.querySelector(".row-tag-strip");
  if (!wrap || !rowStrip || !tableRounded) return;
  const THRESH = 60;
  const BTN_SIZE = 28;
  const COL_SHRINK_AMOUNT = 35; // flat px the table narrows by — see layoutSourceTableColumns
  const SCROLL_END_BUFFER = 25; // how close to the true right edge counts as "there"
  const SCROLL_START_BUFFER = 30; // how close to the true left edge counts as "there" (for the row-tag indent)
  let colHoverActive = false;
  // Unlike colHoverActive above, this tracks *which row* (its <tr>), not just a boolean — the
  // row-tag button's position is only ever recomputed when this reference changes (a different
  // row is now under the cursor), never on every mousemove tick, which is what keeps it "static"
  // rather than continuously trailing the cursor like the add-column button does.
  let hoveredRowEl = null;
  // The one `.cell-inner` (first cell of whichever row) currently shifted to make room for the
  // tag button, if any — tracked so it can be un-shifted the moment the hovered row changes or
  // the table scrolls away from its left edge.
  let indentedInner = null;
  const updateRowTagBtnPos = () => {
    if (!hoveredRowEl || !rowTagBtn || !rowTagStripWrap) return;
    const rRect = hoveredRowEl.getBoundingClientRect();
    const stripRect = rowTagStripWrap.getBoundingClientRect();
    const top = Math.max(
      0,
      Math.min(
        rRect.top - stripRect.top + rRect.height / 2 - BTN_SIZE / 2,
        stripRect.height - BTN_SIZE,
      ),
    );
    rowTagBtn.style.top = top + "px";
  };
  // The table only actually shrinks (rather than just having the button float over the top of
  // it) once it's scrolled all the way to its right edge — shrinking it while scrolled elsewhere
  // would move content the user isn't even looking at, for no benefit.
  const isScrolledToRightEdge = () =>
    !hscroll || hscroll.scrollLeft + hscroll.clientWidth >= hscroll.scrollWidth - SCROLL_END_BUFFER;
  // Mirror of the above for the row-tag button on the left: the hovered row's first cell only
  // actually makes room (shifts its content in from the left) once the table is scrolled all the
  // way to ITS left edge. Scrolled anywhere else, that column isn't necessarily even the leftmost
  // thing on screen, so the button just floats over the top of whatever's currently visible there
  // instead.
  const isScrolledToLeftEdge = () => !hscroll || hscroll.scrollLeft <= SCROLL_START_BUFFER;
  const updateColShrink = () => {
    if (tableItem)
      layoutSourceTableColumns(
        tableItem,
        container,
        colHoverActive && isScrolledToRightEdge() ? COL_SHRINK_AMOUNT : 0,
      );
  };
  // Applies (or removes) the "make room" shift on the hovered row's first cell only, re-evaluating
  // both which row is hovered and the current scroll position each time.
  const updateRowIndent = () => {
    if (indentedInner) {
      indentedInner.classList.remove("row-tag-shift");
      indentedInner = null;
    }
    if (hoveredRowEl && isScrolledToLeftEdge()) {
      const firstCell = hoveredRowEl.querySelector('td[data-c="0"]');
      const inner = firstCell && firstCell.querySelector(".cell-inner");
      if (inner) {
        inner.classList.add("row-tag-shift");
        indentedInner = inner;
      }
    }
  };
  const onMove = (e) => {
    // Frozen entirely while ANY row-tag picker on this page is open — the tagged row's
    // button/indent must stay exactly as they were until the picker closes, not chase the cursor
    // onto whatever other row it happens to pass over in the meantime.
    if (appState.activeTagRow) return;
    // "Add column" needs to react to the *visible* right edge of the table area (wrap's own
    // rect), not table-rounded's actual content edge — once a table has more than 2 columns,
    // table-rounded is wider than the viewport, so its real edge can be scrolled far off-screen.
    // Vertical bounds still come from table-rounded since its height always matches what's
    // actually on screen.
    //
    // The hotspot that *triggers* the zone only ever starts right at (or past) the table's true
    // right edge — never inside it — since the last column already has its own per-cell "add"
    // button, and the two shouldn't compete for the same hover real estate. But the strip/button,
    // once shown, still visually sits inside that edge (see layoutSourceTableColumns' `reserve`),
    // so moving the cursor onto the button itself is checked for separately below and treated as
    // "still in the zone" regardless — otherwise it'd vanish the instant you tried to reach it.
    const wRect = wrap.getBoundingClientRect();
    const tRect = tableRounded.getBoundingClientRect();
    const hoveredEl = document.elementFromPoint(e.clientX, e.clientY);
    const overColStrip = !!(hoveredEl && colStripWrap && colStripWrap.contains(hoveredEl));
    const strictlyPastRightEdge =
      e.clientY >= tRect.top &&
      e.clientY <= tRect.bottom &&
      e.clientX >= wRect.right &&
      e.clientX <= wRect.right + THRESH;
    const nearRight = strictlyPastRightEdge || overColStrip;
    const nearBottom =
      e.clientX >= tRect.left &&
      e.clientX <= tRect.right &&
      e.clientY >= tRect.bottom &&
      e.clientY <= tRect.bottom + THRESH;
    wrap.classList.toggle("show-col", nearRight);
    rowStrip.classList.toggle("show-row", nearBottom);
    // The table only actually needs to redraw narrower right when the hover state flips (not on
    // every pixel of mouse movement), so this only re-runs the column layout on that transition —
    // shrinking the last column's width by a flat COL_SHRINK_AMOUNT (only when already scrolled
    // to the right edge) so the table visibly gets out of the way and shows its own right border
    // in the gap. Otherwise the button just slides in over the top of the table's existing
    // content. Restores back to full width the moment the cursor leaves the zone.
    if (nearRight !== colHoverActive) {
      colHoverActive = nearRight;
      updateColShrink();
    }
    // Keep each "+" button tracking the cursor along whichever axis it slides within — top for
    // the column button (it moves up/down the right edge), left for the row button (it moves
    // left/right along the bottom edge) — so it always sits right where the cursor is, the whole
    // time that edge is hovered.
    if (nearRight && colBtn && colStripWrap) {
      const csRect = colStripWrap.getBoundingClientRect();
      const top = Math.max(
        0,
        Math.min(e.clientY - csRect.top - BTN_SIZE / 2, csRect.height - BTN_SIZE),
      );
      colBtn.style.top = top + "px";
    }
    if (nearBottom && rowBtn) {
      const rsRect = rowStrip.getBoundingClientRect();
      const left = Math.max(
        0,
        Math.min(e.clientX - rsRect.left - BTN_SIZE / 2, rsRect.width - BTN_SIZE),
      );
      rowBtn.style.left = left + "px";
    }
    // Row-tag button: figure out which data row (if any) the cursor is currently over — via the
    // actual element under the pointer (already looked up above) rather than a fixed geometric
    // zone, since "any cell of the row" (not just its left edge) should trigger it. Only acts
    // when that row actually changes, so the button doesn't jitter or chase the cursor while it
    // stays within the same row. Once revealed, the button itself floats (as a positioned
    // overlay) on top of the table's own left edge, so once the cursor moves onto it,
    // elementFromPoint no longer returns a <td> at all — it returns the button. Without this
    // check that read as "cursor left every row" and hid the button out from under itself the
    // instant you tried to reach it. Treat hovering the strip/button as "still on whichever row
    // was last active" instead of re-deriving anything from it.
    const onRowTagStrip = hoveredEl && rowTagStripWrap && rowTagStripWrap.contains(hoveredEl);
    if (!onRowTagStrip) {
      const rowTd = hoveredEl && hoveredEl.closest ? hoveredEl.closest("td[data-r]") : null;
      const rowEl = rowTd && tableRounded.contains(rowTd) ? rowTd.closest("tr") : null;
      if (rowEl !== hoveredRowEl) {
        hoveredRowEl = rowEl;
        wrap.classList.toggle("show-row-tag", !!rowEl);
        if (rowEl && rowTagBtn) {
          const r = Number(rowTd.dataset.r);
          const originTableId = rowTd.dataset.originTable
            ? Number(rowTd.dataset.originTable)
            : tableItem.id;
          rowTagBtn.onclick = (ev) => {
            ev.stopPropagation();
            window.__openRowTagPicker(originTableId, r, rowTagBtn);
          };
          updateRowTagBtnPos();
        }
        updateRowIndent();
      }
    }
  };
  // Dismisses the row-tag button and un-indents its cell outright — used both when the cursor
  // leaves the table entirely and (see the scroll listeners below) the instant any scrolling
  // happens, rather than trying to keep the button/indent alive and just repositioning them: a
  // row sliding around under a now-stale button is more confusing than the button just going away
  // until you hover a row again.
  const dismissRowTagHover = () => {
    // Stays put while this table's row-tag picker is open (see openRowTagPicker/
    // closeCellTagPicker) — the cursor leaving the table to go interact with the picker's popover
    // shouldn't un-indent the row it's currently tagging.
    if (appState.activeTagRow && appState.activeTagRow.id === tableItem.id) return;
    if (hoveredRowEl) {
      hoveredRowEl = null;
      wrap.classList.remove("show-row-tag");
      updateRowIndent();
    }
  };
  // Exposed so closeCellTagPicker can force a reset the moment the picker closes, rather than
  // waiting for a mousemove that may not come for a while if it was closed by clicking elsewhere
  // on the canvas. A plain property on the DOM node itself, not a module export — works
  // unmodified regardless of which module this function lives in (closeCellTagPicker,
  // source-tags-ai.js, still vanilla, calls it via container._resetRowTagHover(), same as always).
  container._resetRowTagHover = () => {
    hoveredRowEl = null;
    wrap.classList.remove("show-row-tag");
    updateRowIndent();
  };
  const onLeave = () => {
    wrap.classList.remove("show-col");
    rowStrip.classList.remove("show-row");
    if (colHoverActive) {
      colHoverActive = false;
      updateColShrink();
    }
    dismissRowTagHover();
  };
  container.addEventListener("mousemove", onMove);
  container.addEventListener("mouseleave", onLeave);
  // If the user scrolls the table horizontally while the "add column" zone is still engaged (e.g.
  // they scroll to the end while hovering there), re-check whether it should shrink now rather
  // than waiting for the next hover-state transition. Any horizontal scroll also immediately
  // dismisses the row-tag button/indent.
  if (hscroll)
    hscroll.addEventListener("scroll", () => {
      if (colHoverActive) updateColShrink();
      dismissRowTagHover();
    });
  // Any vertical scroll (inside table-rounded) also immediately dismisses the row-tag
  // button/indent, rather than trying to keep tracking the row that moved under it.
  if (tableRounded)
    tableRounded.addEventListener("scroll", () => {
      dismissRowTagHover();
    });
}
