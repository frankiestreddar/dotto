// Phase 4.4 port of public/dotto/shelf-search.js (itself a Phase 4.3 split of
// stopwatch-search-notifications.js — see PHASE4_ROADMAP.md): the Shelf/Stack card (aggregating
// connected sources + saved stopwatch sessions, with its own in-card row search), the Filter
// card's tag-toggling, and the top search bar's autogrow + its AI-context "drag cards in as
// context" popup. renderShelfHTML still builds a real HTML string with inline onclick="..."
// attributes (live-presence.js's mini inline-canvas previews render it directly) — those globals
// (startRenameShelfName/shelfSelectSession/handleShelfSourceRowClick/startRenameShelfSourceRow/
// filterShelfRows) keep their exact plain (non-`__`) names, same convention window-bridge.js used
// for them before this port.

interface Item {
  id: number;
  kind: string;
  shelfName?: string;
  shelfSessions?: ShelfSession[];
  shelfSelectedId?: string;
  stackSourceRows?: Record<string, unknown[]>;
  filterMode?: string;
  filterTagIds?: string[];
  [key: string]: unknown;
}

interface ShelfSession {
  sessionId: string;
  label: string;
  payloads: { delta?: { seen?: number } }[];
}

interface CardSnapshot {
  id: number;
  snapshot: Record<string, unknown>;
}

interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  connections?: { fromId: number; toId: number }[];
}

interface AppState {
  shelfRowClickTimer: ReturnType<typeof setTimeout> | null;
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  searchInput?: HTMLTextAreaElement;
  searchCardContext: CardSnapshot[];
  searchCardConnections: { fromId: number; toId: number }[];
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

export function shelfSelectSession(id: number, sessionId: string): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  it.shelfSelectedId = sessionId;
  window.__render?.();
}

// "Stack" in the UI (kind stays 'shelf' internally — see its add-menu entry). Dual-purpose: saved
// stopwatch sessions (below, unchanged) plus a summary of every source card currently feeding it
// (see CardStreamIO.shelf's 'sourceRows' aggregation) — connect a source here, then connect this
// Stack into a flashcard (or any other card that accepts 'content') to play every connected
// source's rows at once.
export function renderShelfHTML(it: Item): string {
  const sessions = it.shelfSessions || [];
  const sourceEntries = Object.keys(it.stackSourceRows || {}).map((sid) => ({
    sourceItemId: Number(sid),
    title: window.__folderTitleForConnectedSource?.(Number(sid)) ?? "",
    count: (it.stackSourceRows?.[sid] || []).length,
  }));
  // Own name lives directly on the item (it.shelfName) rather than a folders[] entry — a Stack
  // has no canvas of its own, it just aggregates streams from whatever's connected (see
  // CardStreamIO.shelf). Unrenamed stacks fall back to the same empty-content + data-placeholder
  // convention as an unrenamed folder/source title (see startRenameFolderCardTitle) rather than a
  // hardcoded string, so the placeholder and the eventual real name render through the exact same
  // markup.
  const nameHTML = it.shelfName
    ? `<div class="shelf-header" onclick="event.stopPropagation(); startRenameShelfName(this, ${it.id})">${window.__escapeHtml?.(it.shelfName)}</div>`
    : `<div class="shelf-header crumb-placeholder" data-placeholder="Stack" onclick="event.stopPropagation(); startRenameShelfName(this, ${it.id})"></div>`;
  // Clicking anywhere in the pill (not just its label) opens that source's own page — the same
  // static-source view its real card opens into (see handleShelfSourceRowClick/openFolder), not
  // just a jump to its card on this canvas. Double-clicking the label renames it in place instead
  // (see startRenameShelfSourceRow); handleShelfSourceRowClick debounces a single click against a
  // pending double-click so a rename's first click doesn't also navigate away first.
  const sourcesHTML = sourceEntries.length
    ? `<div class="shelf-sources">${sourceEntries
        .map(
          (s) => `
                <div class="shelf-source-row" onclick="event.stopPropagation(); handleShelfSourceRowClick(this, ${s.sourceItemId})">
                    <span class="shelf-row-label" data-source-id="${s.sourceItemId}" ondblclick="event.stopPropagation(); startRenameShelfSourceRow(this, ${s.sourceItemId})" title="Double-click to rename">${window.__escapeHtml?.(s.title)}</span>
                    <span class="shelf-row-meta">${s.count} ${s.count === 1 ? "entry" : "entries"}</span>
                </div>`,
        )
        .join("")}</div>`
    : "";
  // Lets you search across whichever connected sources / saved sessions are currently listed —
  // see filterShelfRows, which just show/hides rows on the DOM already built here rather than
  // re-rendering, so it never yanks focus out of the input mid-keystroke. mousedown does BOTH
  // stopPropagation (so clicking/dragging from inside the box never starts a card-drag) AND
  // preventDefault (so it never grabs focus purely from a mousedown that turns into a card drag
  // started elsewhere but happens to end with the pointer over this box — see suppressClick in
  // the card drag handler, which swallows that trailing click before it ever reaches here) —
  // focus is instead granted explicitly on a genuine click via onclick, which only fires for a
  // real, non-drag-suppressed click.
  const searchHTML =
    sourceEntries.length || sessions.length
      ? `<input type="text" class="shelf-search" placeholder="Search..." onmousedown="event.stopPropagation(); event.preventDefault();" onclick="event.stopPropagation(); this.focus();" oninput="filterShelfRows(this)" />`
      : "";
  if (!sessions.length) {
    if (sourceEntries.length) return `${nameHTML}${searchHTML}${sourcesHTML}`;
    return `${nameHTML}<div class="shelf-empty">No sessions saved yet, and nothing connected. Connect a source here to combine it with others for flashcards, or link a stopwatch (that's linked to a game) here, then press Start then Stop on it, to save a session.</div>`;
  }
  const rows = sessions
    .map((s) => {
      const selected = s.sessionId === it.shelfSelectedId;
      const totalSeen = s.payloads.reduce((sum, p) => sum + (p.delta?.seen || 0), 0);
      return `<div class="shelf-row ${selected ? "selected" : ""}" onmousedown="event.stopPropagation()" onclick="shelfSelectSession(${it.id}, '${s.sessionId}')">
                <span class="shelf-row-label">${s.label}</span>
                <span class="shelf-row-meta">${totalSeen} seen</span>
            </div>`;
    })
    .join("");
  return `${nameHTML}${searchHTML}${sourcesHTML}<div class="shelf-rows">${rows}</div>`;
}

// Show/hide rows in-place by matching their label text against the search box's current value —
// deliberately not a render() (would rebuild the whole card and drop the input's focus/caret
// mid-keystroke). Matches across both connected-source rows and saved-session rows, whichever are
// present.
export function filterShelfRows(inputEl: HTMLInputElement): void {
  const card = inputEl.closest(".item.shelf");
  if (!card) return;
  const q = inputEl.value.trim().toLowerCase();
  card.querySelectorAll(".shelf-source-row, .shelf-row").forEach((rowEl) => {
    const label = rowEl.querySelector(".shelf-row-label");
    const text = label ? (label.textContent || "").toLowerCase() : "";
    (rowEl as HTMLElement).style.display = !q || text.includes(q) ? "" : "none";
  });
}

// Inline-rename a Stack's own name — same contentEditable click-to-edit flow as
// startRenameFolderCardTitle, just writing to it.shelfName directly (a Stack has no folders[]
// entry of its own to write to).
export function startRenameShelfName(nameEl: HTMLElement, itemId: number): void {
  const it = window.__findItemById?.(itemId) as Item | undefined;
  if (!it || nameEl.contentEditable === "true") return;
  window.__saveSnapshot?.();
  const fullTitle = it.shelfName || "";
  const isDefaultTitle = !fullTitle;
  if (isDefaultTitle) {
    nameEl.textContent = "";
    nameEl.setAttribute("data-placeholder", "Stack");
    nameEl.classList.add("crumb-placeholder");
  } else {
    nameEl.textContent = fullTitle;
  }
  nameEl.contentEditable = "true";
  window.__broadcastEditingState?.(true, `#${window.__itemElId?.(it.id)} .shelf-header`);
  nameEl.focus();
  const placeCaretAtEnd = () => {
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  placeCaretAtEnd();
  setTimeout(placeCaretAtEnd, 0);
  nameEl.onblur = () => {
    nameEl.contentEditable = "false";
    window.__broadcastEditingState?.(false);
    nameEl.classList.remove("crumb-placeholder");
    const newTitle = (nameEl.textContent || "").trim();
    if (newTitle) it.shelfName = newTitle;
    window.__render?.();
  };
  nameEl.oninput = () => {
    const liveTitle = nameEl.textContent || "";
    if (liveTitle.trim()) {
      it.shelfName = liveTitle;
      window.__scheduleWorkspaceSave?.();
    }
  };
  nameEl.onkeydown = (ke) => {
    if (ke.key === "Enter") {
      ke.preventDefault();
      nameEl.blur();
    }
    if (ke.key === "Escape") {
      ke.preventDefault();
      nameEl.textContent = isDefaultTitle ? "" : fullTitle;
      nameEl.blur();
    }
  };
}

// Distinguishes a real single click (open the source's own page — see openFolder) from the first
// half of a double-click on its label (rename — see startRenameShelfSourceRow's ondblclick): a
// genuine click opens the source after a short delay, but if a second click lands within that
// window this just cancels the pending navigation and lets ondblclick take over, so renaming a
// row doesn't also navigate away first.
export function handleShelfSourceRowClick(rowEl: HTMLElement, sourceItemId: number): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.shelfRowClickTimer) {
    clearTimeout(appState.shelfRowClickTimer);
    appState.shelfRowClickTimer = null;
    return;
  }
  appState.shelfRowClickTimer = setTimeout(() => {
    appState.shelfRowClickTimer = null;
    const folderId = window.__folderIdForConnectedSource?.(sourceItemId);
    if (folderId) window.__openFolder?.(folderId);
  }, 220);
}

// Inline-rename a connected source's name from inside the Stack that's aggregating it — writes
// straight back to that source's own folders[folderId].title (via folderIdForConnectedSource),
// the same real property its own card and breadcrumb read/write, so the rename is visible
// everywhere that source appears, not just here.
export function startRenameShelfSourceRow(labelEl: HTMLElement, sourceItemId: number): void {
  const appState = getAppState();
  if (labelEl.contentEditable === "true" || !appState) return;
  const folderId = window.__folderIdForConnectedSource?.(sourceItemId);
  if (!folderId || !appState.folders[folderId]) return;
  window.__saveSnapshot?.();
  const fullTitle = appState.folders[folderId].title || "";
  labelEl.textContent = fullTitle;
  labelEl.contentEditable = "true";
  window.__broadcastEditingState?.(true, `.shelf-row-label[data-source-id="${sourceItemId}"]`);
  labelEl.focus();
  const placeCaretAtEnd = () => {
    const range = document.createRange();
    range.selectNodeContents(labelEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  placeCaretAtEnd();
  setTimeout(placeCaretAtEnd, 0);
  labelEl.onblur = () => {
    labelEl.contentEditable = "false";
    window.__broadcastEditingState?.(false);
    const newTitle = (labelEl.textContent || "").trim();
    if (newTitle) {
      appState.folders[folderId].title = newTitle;
      window.__syncCanvasCollabTitle?.(folderId, newTitle);
    }
    window.__render?.();
  };
  labelEl.oninput = () => {
    const liveTitle = labelEl.textContent || "";
    if (liveTitle.trim()) {
      appState.folders[folderId].title = liveTitle;
      window.__scheduleWorkspaceSave?.();
    }
  };
  labelEl.onkeydown = (ke) => {
    if (ke.key === "Enter") {
      ke.preventDefault();
      labelEl.blur();
    }
    if (ke.key === "Escape") {
      ke.preventDefault();
      labelEl.textContent = fullTitle;
      labelEl.blur();
    }
  };
}

// Filter card: connect a source (or another filter) into it, then it into a flashcard (or
// another source/filter) — see CardStreamIO.filter. Its only real UI is "which tags currently
// flowing through it should pass" plus an AND/OR switch for combining more than one; the
// available tags list is entirely derived from incomingRows (see collectAvailableFilterTags)
// since a filter has no source of its own, only whatever's connected to it right now. (Rendering
// itself moved to FilterCard.jsx, app/dotto/ — a real Component, no mini-preview elsewhere calls
// this kind, unlike Shelf/Stopwatch/Flashcard/Typeright, so there's no renderFilterHTML left to
// keep around.)
export function setFilterMode(id: number, mode: string): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  it.filterMode = mode;
  window.__scheduleWorkspaceSave?.();
  window.__render?.();
}
export function toggleFilterTag(id: number, tagId: string): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  const set = new Set(it.filterTagIds || []);
  if (set.has(tagId)) set.delete(tagId);
  else set.add(tagId);
  it.filterTagIds = Array.from(set);
  window.__scheduleWorkspaceSave?.();
  window.__render?.();
}

// #search-input is a <textarea> that grows line by line as typed text wraps, up to 4 lines (94px)
// — its resting (1-line) height, 34px, matches #search-panel-search's own height, per explicit
// follow-up request; see #search-input's own min/max-height comment, globals.css, for the padding
// math behind both those numbers. Repositions #search-dropdown to stay glued 7px below the input
// at whatever height it's currently at.
export function autoGrowSearchInput(): void {
  const appState = getAppState();
  const input = appState?.searchInput;
  if (!input) return;
  const minH = 34;
  let h: number;
  // With no typed value, the box is always exactly 1 (text) line tall — measuring scrollHeight
  // here would instead reflect the animated placeholder's current wrapped shape (a <textarea>'s
  // placeholder wraps like real content when the value is empty), which has nothing to do with
  // what the user has actually typed.
  if (!input.value) {
    h = minH;
  } else {
    input.style.height = "auto";
    // #search-input itself is borderless now (the wrap owns the border — see globals.css), so
    // scrollHeight's content+padding measurement already matches what style.height
    // (box-sizing:border-box) needs — no border-compensation offset required.
    h = Math.max(minH, Math.min(94, input.scrollHeight));
  }
  input.style.height = h + "px";
  // #search-dropdown is a normal flex-flow sibling now, not absolutely positioned against the
  // wrap's height (see globals.css) — it just follows in flow, no synced top needed.
  // style.height='auto' above forces a reflow that resets scrollTop to 0 — once content no longer
  // fits (capped at 100px), that leaves the caret's actual line scrolled out of view after every
  // keystroke. Pin back to the bottom, where the caret always is (typing never happens mid-text
  // via a mouse click without also refocusing/reflowing here).
  if (input.scrollHeight > input.clientHeight) input.scrollTop = input.scrollHeight;
}

// ---------- Card context: cards dragged into the search box as AI context ----------
// Persists across searches (unlike the text input, which clears after every search) so follow-up
// questions about the same attached cards don't require redragging — only cleared by the global
// outside-click handler, alongside every other ephemeral search-state reset.

// Adds `ids` (a drag gesture's card ids — a single card or a multi-selection) to the persistent
// card-context set. Each is snapshotted and sanitized exactly like a marketplace/chat export (see
// sanitizeFlashcardSnapshot) using the OTHER ids in this same call as the batch, so a flashcard
// dragged together with its source keeps real data, but dragged alone it's generic-ified — same
// source-of-truth rule either way. Connections between two cards that are both part of this drag
// are copied across too, so the link itself (not just the two cards) survives into the popup
// preview.
export function addCardsToSearchContext(ids: number[]): void {
  const appState = getAppState();
  const folder = appState?.folders[appState.currentFolderId];
  if (!appState || !folder) return;
  ids.forEach((id) => {
    if (appState.searchCardContext.some((c) => c.id === id)) return;
    const it = window.__findItemById?.(id);
    if (!it) return;
    const snapshot = window.__sanitizeFlashcardSnapshot?.(window.__snapshotItem?.(it) ?? {}, ids);
    if (snapshot) appState.searchCardContext.push({ id, snapshot });
  });
  const conns = window.__ensureConnections?.(folder) ?? [];
  conns.forEach((c) => {
    if (!ids.includes(c.fromId) || !ids.includes(c.toId)) return;
    if (appState.searchCardConnections.some((sc) => sc.fromId === c.fromId && sc.toId === c.toId))
      return;
    appState.searchCardConnections.push({ fromId: c.fromId, toId: c.toId });
  });
}

export function removeSearchCardContextItem(id: number): void {
  const appState = getAppState();
  if (!appState) return;
  appState.searchCardContext = appState.searchCardContext.filter((c) => c.id !== id);
  appState.searchCardConnections = appState.searchCardConnections.filter(
    (c) => c.fromId !== id && c.toId !== id,
  );
  if (!appState.searchCardContext.length) {
    closeSearchCardsModal();
    return;
  }
  if (document.getElementById("search-cards-modal-overlay")?.classList.contains("open"))
    openSearchCardsModal();
}

// Clears every attached card at once, unlike removeSearchCardContextItem which only drops one —
// no longer reachable from the search box's own UI (the card-context pill it used to hang off is
// gone, per explicit request), still exported/wired in case something else calls it.
export function clearSearchCardContext(): void {
  const appState = getAppState();
  if (!appState) return;
  appState.searchCardContext = [];
  appState.searchCardConnections = [];
  closeSearchCardsModal();
}

// Packs a flat set of snapshots into a neat grid (ceil(sqrt(n)) columns, uniform spacing derived
// from the largest card's own w/h) purely for the popup preview — mutates copies only, never the
// stored snapshot's original x/y (which is meaningless outside its original canvas anyway) or
// anything on the live canvas.
function layoutSnapshotsInGrid(snapshots: Record<string, unknown>[]): Record<string, unknown>[] {
  const n = snapshots.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const maxW = Math.max(100, ...snapshots.map((s) => (s.w as number) || 100));
  const maxH = Math.max(60, ...snapshots.map((s) => (s.h as number) || 60));
  const gap = 40;
  return snapshots.map((s, i) => ({
    ...s,
    x: (i % cols) * (maxW + gap),
    y: Math.floor(i / cols) * (maxH + gap),
  }));
}

export function openSearchCardsModal(): void {
  const appState = getAppState();
  if (!appState?.searchCardContext.length) return;
  const laidOut = layoutSnapshotsInGrid(appState.searchCardContext.map((c) => c.snapshot));
  const body = document.getElementById("search-cards-modal-body");
  if (!body) return;
  body.innerHTML = "";
  const canvasNode = window.__renderInlineCanvas?.(
    laidOut,
    false,
    appState.searchCardConnections,
    (id: number) => removeSearchCardContextItem(id),
  );
  if (canvasNode) body.appendChild(canvasNode);
  document.getElementById("search-cards-modal-overlay")?.classList.add("open");
}
export function closeSearchCardsModal(): void {
  document.getElementById("search-cards-modal-overlay")?.classList.remove("open");
}

// Not inline-HTML onclick targets for these two (see window-bridge.js's own header comment for
// why those live there instead) — window.__addCardsToSearchContext is used by
// app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3). Every other export below
// keeps the exact plain (non-`__`) global name window-bridge.js used for it before this port:
// startRenameShelfName/shelfSelectSession/handleShelfSourceRowClick/startRenameShelfSourceRow/
// filterShelfRows are real inline onclick="..." targets inside renderShelfHTML's own built HTML
// string above; closeSearchCardsModal is a real inline onclick target
// (content/fragments/canvas-modal.html); setFilterMode/toggleFilterTag are called from
// FilterCard.jsx (app/dotto/) via the same plain global convention window.pushNotification uses;
// openSearchCardsModal/clearSearchCardContext have no confirmed remaining caller (same as before
// this port — the original file's own comment already flagged clearSearchCardContext as kept
// "in case something else calls it").
window.__addCardsToSearchContext = addCardsToSearchContext;
window.startRenameShelfName = startRenameShelfName;
window.shelfSelectSession = shelfSelectSession;
window.handleShelfSourceRowClick = handleShelfSourceRowClick;
window.startRenameShelfSourceRow = startRenameShelfSourceRow;
window.filterShelfRows = filterShelfRows;
window.closeSearchCardsModal = closeSearchCardsModal;
window.setFilterMode = setFilterMode;
window.toggleFilterTag = toggleFilterTag;
window.openSearchCardsModal = openSearchCardsModal;
window.clearSearchCardContext = clearSearchCardContext;
// Used by ai-assistant-suggestions.js/search-orchestration-selection.js (multiple call sites
// each), which previously imported this directly.
window.__autoGrowSearchInput = autoGrowSearchInput;
// Used by live-presence.js's mini inline-canvas previews, which previously imported this directly.
window.__renderShelfHTML = renderShelfHTML;
