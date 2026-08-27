"use client";

// The "continuous pointer-driven pixel math" pieces of canvas core (CONTRIBUTING.md's category
// name for this — Phase 3 of the vanilla->React consolidation) that have moved out of separate
// vanilla modules and into app/dotto/ so far: setupResizing (from
// public/dotto/resize-shortcuts-init.js) and setupDraggingAndClicking (from
// public/dotto/drag-drop-chat.js — the single riskiest closure in the app, done second on
// purpose, once this pattern was proven safe on the smaller one first). Both are relocations, not
// rewrites — logic unchanged byte-for-byte from the originals. Every already-React card component
// that owns a resize handle (TableCard.jsx, FlashcardCard.jsx, MediaCard.jsx, TypeRightCard.jsx)
// calls setupResizing directly now — no bridge needed, both sides are in app/dotto/ — and
// CanvasItem's own layout effect (CanvasItemsLayer.jsx, via attachUniversalItemBehavior's
// window.__setupDraggingAndClicking call) reaches setupDraggingAndClicking the same way once that
// wiring is updated. The two vanilla callers that still need a bridge (attachNoteBody's own call
// to setupResizing, and attachUniversalItemBehavior's own call to setupDraggingAndClicking, both
// waypoints-render-loop.js) reach these via window.__setupResizing/window.__setupDraggingAndClicking
// — bridges whose OWNERSHIP flipped: assigned here (see app/dotto-app.jsx) instead of in their old
// vanilla modules, with vanilla as the caller instead of React. Every OTHER vanilla dependency
// either function still needs (appState, saveSnapshot, render, findItemById, and so on) is reached
// via its own window.__ bridge (see each one's own comment, in the public/dotto/*.js file it
// actually lives in) since public/dotto/*.js isn't reachable from app/dotto/ the other way.

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

// ---------- Element Drag and Drop System ----------
// Moved here from public/dotto/drag-drop-chat.js — Phase 3's second relocated piece, following
// the exact pattern setupResizing above already proved out. The single riskiest closure in the
// app (direct camera-state writes inside its own RAF auto-pan loop, bare
// document.getElementById('item-'+id) lookups, a world.children scan for merge-target detection,
// three separate drop-zone checks) — logic unchanged byte-for-byte, every dependency that still
// lives in public/dotto/*.js reached via a window.__ bridge (see each one's own comment there);
// canvas/world are just resolved by id (document.getElementById('canvas'/'world')) rather than
// bridged, same as any other React component reaching a static DOM node by id (e.g. TableCard.jsx
// resolving its own wrapper). dispatchSelectedToChat (the "drop into an open chat" case) stayed
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
      const canvas = document.getElementById("canvas");
      const world = document.getElementById("world");
      // The game-options panel's own controls (esp. the column-picker <select>s) must never
      // start a card drag — the .game-options-row/.game-options-slot elements' own
      // onmousedown="event.stopPropagation()" only stops the separate 'mousedown' event, not
      // this 'pointerdown' listener, and opening a native <select> popup doesn't reliably fire a
      // matching window 'pointerup' back to end() the drag afterward — so without this check,
      // picking an option left the card permanently glued to the cursor with no pointerup ever
      // arriving to release it. Same exemption pattern already used for '.resize' just above.
      if (e.target.closest(".item-options")) return;
      if (e.target.classList.contains("resize") || (appState.currentEditingEl === el && e.target !== el)) return;
      // Table cell-merge edges (see TableCard.jsx/mergeTableCells, source-table.js) — same
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
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
        e.stopPropagation();
        e.preventDefault();
        const suppressDataClick = (ce) => {
          ce.stopPropagation();
          ce.preventDefault();
          el.removeEventListener("click", suppressDataClick, true);
        };
        el.addEventListener("click", suppressDataClick, true);
        window.__startConnectionDrag(e, it, el);
        return;
      }

      if (window.__effectiveMode() === "pen") {
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
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
      const isAltDuplicate = e.altKey && !(appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource);

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
        appState.selectedCardIds = isTargetSelected ? gestureIds.map((gid) => idMap[gid]).filter((gid) => gid != null) : [];
        window.__render();
        const newTargetId = idMap[it.id];
        targetIt = window.__findItemById(newTargetId);
        targetEl = document.getElementById("item-" + newTargetId);
        if (!targetIt || !targetEl) {
          const cloneIdSet = new Set(startPositions.map((p) => p.id));
          appState.folders[appState.currentFolderId].items.filter((i) => cloneIdSet.has(i.id)).forEach(window.__deleteClonedItemFolders);
          appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter((i) => !cloneIdSet.has(i.id));
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
      const applyDraggedPositions = () => {
        const dx = (lastClientX - sx) / appState.scale + autoPanAccumX;
        const dy = (lastClientY - sy) / appState.scale + autoPanAccumY;
        startPositions.forEach((pos) => {
          const selItem = window.__findItemById(pos.id);
          const selEl = document.getElementById("item-" + pos.id);
          if (selItem && selEl) {
            selItem.x = Math.round((pos.x + dx) / 28) * 28;
            selItem.y = Math.round((pos.y + dy) / 28) * 28;
            selEl.style.left = selItem.x + "px";
            selEl.style.top = selItem.y + "px";
          }
        });
        window.__broadcastItemDragPositions(startPositions);
      };

      const checkDropTargets = () => {
        // Detect if cursor is over the Library panel's dropzone — packaging cards into a draft
        // (packageSelectedAsTemplate) lands in your own Library, so this targets that panel now
        // rather than Marketplace/Discover.
        const libraryPanelOpen = appState.libraryPanel.classList.contains("open");
        if (libraryPanelOpen) {
          const libraryRect = appState.libraryPanel.getBoundingClientRect();
          const overLibrary = lastClientX >= libraryRect.left && lastClientX <= libraryRect.right && lastClientY >= libraryRect.top && lastClientY <= libraryRect.bottom;
          document.getElementById("library-dropzone-overlay").classList.toggle("active", overLibrary);
        }

        // Detect merging folder highlights
        const r1 = targetEl.getBoundingClientRect();
        let newH = null;
        for (const sib of Array.from(world.children)) {
          if (sib === targetEl || !sib.classList.contains("item")) continue;
          const sibId = parseInt(sib.id.replace("item-", ""));
          const sibItem = appState.folders[appState.currentFolderId].items.find((i) => i.id === sibId);
          if (!sibItem || sibItem.kind !== "folder") continue;
          const r2 = sib.getBoundingClientRect();
          if (!(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom)) {
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
        if (lastClientX < rect.left + EDGE_MARGIN) vx = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientX - rect.left) / EDGE_MARGIN);
        else if (lastClientX > rect.right - EDGE_MARGIN) vx = EDGE_MAX_SPEED * (1 - Math.max(0, rect.right - lastClientX) / EDGE_MARGIN);
        if (lastClientY < rect.top + EDGE_MARGIN) vy = -EDGE_MAX_SPEED * (1 - Math.max(0, lastClientY - rect.top) / EDGE_MARGIN);
        else if (lastClientY > rect.bottom - EDGE_MARGIN) vy = EDGE_MAX_SPEED * (1 - Math.max(0, rect.bottom - lastClientY) / EDGE_MARGIN);
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
            appState.folders[appState.currentFolderId].items.filter((i) => cloneIdSet.has(i.id)).forEach(window.__deleteClonedItemFolders);
            appState.folders[appState.currentFolderId].items = appState.folders[appState.currentFolderId].items.filter((i) => !cloneIdSet.has(i.id));
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

        // 2. Drop into Library Dropbox (packages the dragged card(s) as a new draft)
        if (appState.libraryPanel.classList.contains("open")) {
          const rect = appState.libraryPanel.getBoundingClientRect();
          if (mX >= rect.left && mX <= rect.right && mY >= rect.top && mY <= rect.bottom) {
            window.__packageSelectedAsTemplate(targetIt);
            droppedOnTarget = true;
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
