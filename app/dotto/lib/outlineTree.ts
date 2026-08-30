// Phase 4.4 port of public/dotto/outline-tree.js (itself a Phase 4.3 split of
// shared-canvases-outline.js — see PHASE4_ROADMAP.md): the canvas outline hierarchical builder
// inside the hamburger menu (and the "M" keyboard shortcut / rail-icon toggle that opens it),
// plus the small kind→icon mapping and hover-revealed row-actions markup shared with other
// sidebar list rows. Reaches every still-vanilla dependency through window bridges — most already
// existed, 5 are new as part of this port (__canvasViewportCenterX/__smoothPanTo/
// __flashCanvasElement/__focusTableCell/__expandWaypointCard).

interface Item {
  id: number;
  kind: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  level?: number;
  folderId?: string;
  html?: string;
  embedUrl?: string;
  statKind?: string;
  shelfName?: string;
  name?: string;
  tableData?: string[][];
  [key: string]: unknown;
}

interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  isSource?: boolean;
  lastView?: { tx: number; ty: number; scale: number };
}

interface AppState {
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  tx: number;
  ty: number;
  scale: number;
  OUTLINE_GROUP_MAX_DIST: number;
  OUTLINE_RESCUE_MAX_DIST: number;
  OUTLINE_MAX_DEPTH: number;
  outlineSearchInput?: HTMLInputElement;
  outlineRows: { el: HTMLElement }[];
  outlineActiveIndex: number;
  activeRailView: string | null;
  outlineMenu?: HTMLElement;
  hamburgerBtn?: HTMLElement;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

// ---------- Canvas Outline Hierarchical Builder inside Hamburger Menu ----------
function nearestOf<T extends { x: number; y: number }>(
  list: T[],
  ref: { x: number; y: number },
): T | null {
  let best: T | null = null;
  let bd = Infinity;
  list.forEach((c) => {
    const d = Math.hypot(c.x - ref.x, c.y - ref.y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  });
  return best;
}

// Maps a card kind (+ heading level, for 'title') to its /assets/icons/*.png filename — used by
// the canvas outline tree (outlineIcon, below) and every other place that displays this same kind
// taxonomy as a small icon (Waypoints/Collaborations/Source/Waypoint cards).
export function kindIconFile(kind: string, level?: number): string {
  if (kind === "title") return `heading-${level || 1}.png`;
  const files: Record<string, string> = {
    folder: "canvas.png",
    source: "source.png",
    table: "table.png",
    media: "media.png",
    checklist: "checklist.png",
    watermark: "watermark.png",
    flashcard: "flashcards.png",
    typeright: "typeright.png",
    note: "note.png",
    statcard: "statcard.png",
    stopwatch: "stopwatch.png",
    shelf: "shelf.png",
    waypoint: "waypoint.png",
    filter: "tag-button.png", // no dedicated icon asset yet — closest existing one, since filtering is tag-based
    embed: "embed.png", // no icon asset exists yet either — add public/assets/icons/embed.png; missing files already degrade gracefully throughout this app
    reference: "canvas.png", // no dedicated asset either — closest existing one, same reasoning as filter/embed above
  };
  return files[kind] || "note.png";
}
// Returns a ready-to-insert <span> using kindIconFile as a mask (see .icon-mask) — pass whatever
// extra class sizes/positions it at the call site (e.g. "outline-icon").
export function kindIconHTML(kind: string, level: number | undefined, extraClass: string): string {
  const url = `/assets/icons/${kindIconFile(kind, level)}`;
  return `<span class="${extraClass} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
}
// Hover-revealed action-button overlay shared by every sidebar list row — see .outline-item-
// actions' own comment, globals.css, and RowActions.jsx (the React equivalent every OTHER panel's
// rows use — this file's own rows are still plain HTML strings, so it needs its own literal copy
// of the same markup rather than importing that component). "For now" just a Share button
// (share.png) per explicit request; keep both in sync if this ever changes.
export function rowActionsHTML(): string {
  return '<div class="outline-item-actions"><button type="button" class="outline-item-share-btn" onclick="event.stopPropagation()" title="Share"><img src="/assets/icons/share.png" alt=""></button></div>';
}
function outlineLabel(item: Item): string {
  const appState = getAppState();
  if (item.kind === "folder" || item.kind === "source") {
    return (item.folderId && appState?.folders[item.folderId]?.title) || "Canvas";
  }
  if (item.kind === "table") return "Table";
  if (item.kind === "media") return "Media";
  if (item.kind === "embed")
    return item.embedUrl ? (window.__shortUrl?.(item.embedUrl) ?? "Embed") : "Embed";
  if (item.kind === "checklist") return "Checklist";
  if (item.kind === "watermark") return "Watermark";
  if (item.kind === "flashcard") return "Flashcards";
  if (item.kind === "typeright") return "Typeright";
  if (item.kind === "statcard") return item.statKind === "accuracy" ? "Accuracy" : "Progress";
  if (item.kind === "stopwatch") return "Stopwatch";
  if (item.kind === "shelf") return item.shelfName || "Stack";
  if (item.kind === "filter") return "Filter";
  if (item.kind === "waypoint") return item.name || "New Waypoint";
  if (item.kind === "note") return (item.html || "").replace(/<[^>]*>/g, "").trim() || "Note";
  const txt = (item.html || "").replace(/<[^>]*>/g, "").trim();
  return txt || "(untitled heading)";
}

interface OutlineRow {
  id: number | string;
  rowKind: "source" | "item";
  itemKind: string;
  level?: number;
  indent: number;
  label: string;
  parentFolderId: string;
  targetFolderId?: string;
  hasChildren?: boolean;
  collapsed?: boolean;
}

// Which headings are currently collapsed (explicit request) — a plain module-level Set, same
// "purely ephemeral, nothing else needs to read/write it" reasoning as add-block chord state
// (srs-connections-core.js): not persisted, not appState, resets on reload. Keyed by heading item
// id.
const collapsedOutlineHeadingIds = new Set<number>();
export function toggleOutlineCollapse(id: number): void {
  if (collapsedOutlineHeadingIds.has(id)) collapsedOutlineHeadingIds.delete(id);
  else collapsedOutlineHeadingIds.add(id);
  buildOutline(true);
}

// Computes `folder`'s own items — leaf cards, plus child folders/sources — at the given depth, as
// a flat array of row descriptors pushed onto `rows` (React owns the actual DOM now — see
// OutlinePanel.jsx, app/dotto/ — this function only computes what to show, same "compute then
// push" shape renderSourcesList/renderFilesList already use, hamburger-collab.js). Every row
// (whether it's a canvas, a source, or a plain card) is rendered with the exact same .outline-item
// styling — there is no header/row visual distinction of any kind by design. A child FOLDER's own
// contents are recursed into immediately after its row (one level deeper), up to
// OUTLINE_MAX_DEPTH; a child SOURCE is always a dead-end row — its internal table is never shown
// separately, and clicking it jumps straight into the source instead of centering on its card (see
// below). Waypoints are excluded entirely — they live only in their own Waypoints hub panel (see
// openWaypointsPanel/renderWaypointsList), never here.
//
// Headings give this list structure, based purely on canvas proximity (there's no other
// parent/child relationship recorded anywhere): H2 nests under its nearest H1, H3 under its
// nearest H2 (or H1 if no H2 exists at all) — see h2Parent/h3Parent. Every OTHER card (leaf cards,
// folders, sources) then nests under whichever heading of ANY level is nearest to it, as long as
// that's within OUTLINE_GROUP_MAX_DIST (30 grid squares — beyond this, a card isn't near enough
// to any heading to join it directly) — beyond that it's too far to belong to that heading
// directly, but it can still be "rescued" into the same group as a heading-grouped neighbor
// within OUTLINE_RESCUE_MAX_DIST (10 grid squares — but it still joins whatever heading a nearby,
// already-grouped, card belongs to; repeated to a fixed point, so a rescued card can go on to
// rescue further cards near it, forming one contiguous cluster instead of a hard cutoff at
// exactly 30 squares from the heading itself). Anything left over after that — including every
// card when the folder has no headings at all — is rendered flat, ungrouped, same as before
// headings existed.
function computeOutlineRows(
  folder: FolderObj,
  depth: number,
  visited: Set<string>,
  rows: OutlineRow[],
  ignoreCollapse: boolean,
): boolean {
  const appState = getAppState();
  const items = folder.items || [];
  const titles = items.filter((i) => i.kind === "title");
  const childFolders = items.filter((i) => i.kind === "folder");
  const childSources = items.filter((i) => i.kind === "source");
  const others = items.filter(
    (i) =>
      i.kind !== "title" && i.kind !== "folder" && i.kind !== "source" && i.kind !== "waypoint",
  );
  const any =
    titles.length > 0 || others.length > 0 || childFolders.length > 0 || childSources.length > 0;

  // The canvas point currently centered on screen for this specific folder — live tx/ty/scale for
  // whichever folder is actually being viewed right now, or its saved pan/zoom (folders[id].
  // lastView — see applyFolderView) for any other folder the outline tree recurses into. Same
  // "canvas point centered on screen" inversion smoothPanTo/centerOnContent use elsewhere:
  // screenX = tx + canvasX*scale, so canvasX = (screenX - tx) / scale. null (skip proximity
  // ordering, fall back to natural creation order) for a folder that's neither the live one nor
  // has ever been visited.
  const view =
    folder.id === appState?.currentFolderId
      ? { tx: appState.tx, ty: appState.ty, scale: appState.scale }
      : folder.lastView;
  const centerX = window.__canvasViewportCenterX?.() ?? 0;
  const viewCenter = view
    ? { x: (centerX - view.tx) / view.scale, y: (window.innerHeight / 2 - view.ty) / view.scale }
    : null;
  function sortByProximity<T extends { x: number; y: number }>(list: T[]): T[] {
    if (!viewCenter) return list;
    return list.sort(
      (a, b) =>
        Math.hypot(a.x - viewCenter.x, a.y - viewCenter.y) -
        Math.hypot(b.x - viewCenter.x, b.y - viewCenter.y),
    );
  }

  // Sorting these once, in place, up front is enough to make every downstream listing — top-level
  // orphan headings AND each parent heading's own nested h2s/h3s (both just `.filter()` these same
  // arrays, which preserves source order) — closest-first without needing to re-sort at every
  // recursion level.
  const h1s = sortByProximity(titles.filter((t) => (t.level || 1) === 1));
  const h2s = sortByProximity(titles.filter((t) => (t.level || 1) === 2));
  const h3s = sortByProximity(titles.filter((t) => (t.level || 1) === 3));
  const allHeadings = [...h1s, ...h2s, ...h3s];
  const h2Parent = new Map<number, number>();
  const h3Parent = new Map<number, { level: number; id: number }>();
  h2s.forEach((h2) => {
    if (h1s.length) h2Parent.set(h2.id, nearestOf(h1s, h2)!.id);
  });
  h3s.forEach((h3) => {
    if (h2s.length) h3Parent.set(h3.id, { level: 2, id: nearestOf(h2s, h3)!.id });
    else if (h1s.length) h3Parent.set(h3.id, { level: 1, id: nearestOf(h1s, h3)!.id });
  });

  // ---- Group every non-heading card under its nearest heading (see comment above) ----
  const headingGroups = new Map<number, Item[]>(); // heading id -> item[]
  allHeadings.forEach((h) => headingGroups.set(h.id, []));
  const assignable = [...others, ...childSources, ...childFolders];
  let unassigned: Item[] = [];
  assignable.forEach((item) => {
    if (!allHeadings.length || !appState) {
      unassigned.push(item);
      return;
    }
    const nearest = nearestOf(allHeadings, item)!;
    const dist = Math.hypot(nearest.x - item.x, nearest.y - item.y);
    if (dist <= appState.OUTLINE_GROUP_MAX_DIST) headingGroups.get(nearest.id)!.push(item);
    else unassigned.push(item);
  });
  let changed = true;
  while (changed && unassigned.length && appState) {
    changed = false;
    for (let i = unassigned.length - 1; i >= 0; i--) {
      const item = unassigned[i];
      let rescueHeadingId: number | null = null;
      for (const [hid, groupItems] of headingGroups) {
        if (
          groupItems.some(
            (g) => Math.hypot(g.x - item.x, g.y - item.y) <= appState.OUTLINE_RESCUE_MAX_DIST,
          )
        ) {
          rescueHeadingId = hid;
          break;
        }
      }
      if (rescueHeadingId !== null) {
        headingGroups.get(rescueHeadingId)!.push(item);
        unassigned.splice(i, 1);
        changed = true;
      }
    }
  }
  headingGroups.forEach((group) => sortByProximity(group));
  sortByProximity(unassigned);

  // rowKind distinguishes a source row (click enters it directly via goToOutlineSource,
  // OutlinePanel.jsx) from every other item kind (click lands on the card within its own parent
  // via goToOutlineItem — never drilling into a canvas via the menu itself), matching the old
  // inline onclick's own if/else exactly. targetFolderId only means something for a
  // rowKind:'source' row (the source's own folder id, to open); parentFolderId (`folder.id`, the
  // containing folder this row belongs to) is what goToOutlineItem needs for every other kind.
  function makeRow(item: Item, subIndent: number, extra?: Partial<OutlineRow>) {
    rows.push({
      id: item.id,
      rowKind: item.kind === "source" ? "source" : "item",
      itemKind: item.kind,
      level: item.level,
      indent: (depth + subIndent) * 14,
      label: outlineLabel(item),
      parentFolderId: folder.id,
      targetFolderId: item.folderId,
      ...extra,
    });
  }

  // A non-heading card's own row, plus (for folders) recursing into its nested contents — shared
  // by both grouped-under-a-heading and fully-ungrouped rendering below.
  function makeCardRow(item: Item, subIndent: number) {
    makeRow(item, subIndent);
    if (
      item.kind === "folder" &&
      appState &&
      depth < appState.OUTLINE_MAX_DEPTH &&
      item.folderId &&
      appState.folders[item.folderId] &&
      !visited.has(item.folderId)
    ) {
      visited.add(item.folderId);
      computeOutlineRows(appState.folders[item.folderId], depth + 1, visited, rows, ignoreCollapse);
    }
  }

  // A heading's own nested h2s and directly-attached h3s (h3s whose nearest heading is this h1
  // itself, when it has no h2 children at all — see h3Parent above) are two separate sources,
  // merged and re-sorted together here so they interleave by proximity rather than always listing
  // every h2 subtree before any direct h3.
  //
  // Collapse (explicit request) — only offered when the heading actually has something nested
  // under it (a group item OR a child heading); collapsing hides both. ignoreCollapse (set by
  // handleOutlineSearch while a query is active) makes every heading render fully expanded
  // regardless of its own collapsed state, same "search overrides collapse" behavior the Blocks
  // panel's own folders get (toggleBlocksFolderCollapse's own comment, blocks-panel.js) —
  // otherwise a real match hidden under a collapsed heading could never surface while searching.
  function renderHeadingSubtree(heading: Item, subIndent: number) {
    const groupItems = headingGroups.get(heading.id) || [];
    const level = heading.level || 1;
    let childHeadings: Item[] = [];
    if (level === 1) {
      childHeadings = [
        ...h2s.filter((h2) => h2Parent.get(h2.id) === heading.id),
        ...h3s.filter((h3) => {
          const p = h3Parent.get(h3.id);
          return p && p.level === 1 && p.id === heading.id;
        }),
      ];
    } else if (level === 2) {
      childHeadings = h3s.filter((h3) => {
        const p = h3Parent.get(h3.id);
        return p && p.level === 2 && p.id === heading.id;
      });
    }
    const hasChildren = groupItems.length > 0 || childHeadings.length > 0;
    const collapsed = hasChildren && !ignoreCollapse && collapsedOutlineHeadingIds.has(heading.id);
    makeRow(heading, subIndent, { hasChildren, collapsed });
    if (collapsed) return;
    groupItems.forEach((item) => makeCardRow(item, subIndent + 1));
    sortByProximity(childHeadings).forEach((child) => renderHeadingSubtree(child, subIndent + 1));
  }

  // Top-level entries — every orphan heading (no parent to nest under) plus every fully ungrouped
  // card — combined into one list and ordered by proximity together, rather than rendering all
  // h1s, then all orphan h2s, then all orphan h3s, then all ungrouped cards as fixed,
  // un-interleaved blocks.
  const topLevelRoots = [
    ...h1s.map((h1) => ({ x: h1.x, y: h1.y, render: () => renderHeadingSubtree(h1, 0) })),
    ...h2s
      .filter((h2) => !h2Parent.has(h2.id))
      .map((h2) => ({ x: h2.x, y: h2.y, render: () => renderHeadingSubtree(h2, 0) })),
    ...h3s
      .filter((h3) => !h3Parent.has(h3.id))
      .map((h3) => ({ x: h3.x, y: h3.y, render: () => renderHeadingSubtree(h3, 0) })),
    ...unassigned.map((item) => ({ x: item.x, y: item.y, render: () => makeCardRow(item, 0) })),
  ];
  sortByProximity(topLevelRoots).forEach((root) => root.render());

  return any;
}

// A source folder's own outline — per explicit request, distinct from the tree above (which
// would otherwise just show this folder's single real item, the table itself, as one useless
// "Table" row via outlineLabel's own kind==='table' branch). Instead, every DATA row of the table
// becomes its own outline row, numbered 1/2/3/... (matching `ri`, the same 1-based data-row index
// tableData/focusTableCell/data-r attributes already use everywhere else — tableData[0] is the
// header, so data rows start at index 1) with that row's first-column value as its label,
// stripped of any rich-text markup the same way every other free-text outline label already is
// (e.g. .note's own outlineLabel branch above). Clicking a row focuses that row's first cell
// directly in the live table (focusTableCell, app/dotto/lib/sourceTable.ts — the same primitive arrow-key
// navigation and Enter-to-edit already use) rather than panning/flashing a canvas element the way
// goToOutlineItem does — there's no canvas to pan on a source page, it's a fixed full-viewport
// table, and focusing the cell already scrolls it into view within .table-rounded's own scroll
// container for free.
function computeSourceOutlineRows(folder: FolderObj): OutlineRow[] {
  const tableItem = folder.items.find((i) => i.kind === "table");
  if (!tableItem?.tableData) return [];
  const dataRows = tableItem.tableData.slice(1);
  return dataRows.map((row, dataIdx) => {
    const ri = dataIdx + 1;
    return {
      id: `${tableItem.id}-row-${ri}`,
      rowKind: "sourceRow" as const,
      itemKind: "sourceRow",
      indent: 0,
      number: ri,
      label: window.__stripHtml?.(row[0]) || "Untitled",
      tableItemId: tableItem.id,
      parentFolderId: folder.id,
    } as unknown as OutlineRow;
  });
}
// Row click targets, extracted from the old inline onclick bodies (this file's own
// computeOutlineRows/computeSourceOutlineRows, formerly renderOutlineFolderContents/
// renderSourceOutline, built plain DOM with the click logic inline) — OutlinePanel.jsx
// (app/dotto/, can't import this module directly — public/dotto/*.js isn't reachable from
// app/dotto/) calls these by row kind instead, same reasoning as window.__goToOutlineItem.
export function goToOutlineSource(folderId: string): void {
  const appState = getAppState();
  if (appState?.currentFolderId !== folderId) window.__openFolder?.(folderId);
  window.__closeRailView?.();
}
export function goToOutlineSourceRow(tableItemId: number, rowNumber: number): void {
  window.__focusTableCell?.(tableItemId, rowNumber, 0);
  window.__closeRailView?.();
}

// Computes the full, unfiltered row set for whichever folder is current — shared by buildOutline
// and handleOutlineSearch (both need "everything buildOutline itself would show, fresh" as their
// starting point) rather than duplicating the isSource branch in both places.
function computeCurrentOutlineRows(ignoreCollapse?: boolean): OutlineRow[] {
  const appState = getAppState();
  const rootFolder = appState?.folders[appState.currentFolderId];
  if (!rootFolder) return [];
  if (rootFolder.isSource) return computeSourceOutlineRows(rootFolder);
  const rows: OutlineRow[] = [];
  computeOutlineRows(rootFolder, 0, new Set([rootFolder.id]), rows, !!ignoreCollapse);
  return rows;
}
// preserveState (per explicit request) is what lets render() call this unconditionally on every
// navigation/rename/etc — see its own call site's comment, waypoints-render-loop.js — without
// also constantly resetting an already-open panel's scroll position or blowing away whatever the
// user is actively searching for. false/omitted (every existing caller before this —
// toggleHamburgerMenu's own panel-open callback, the outline search input's own Enter-to-refocus
// flow if any) keeps the original always-start-fresh behavior, which is exactly what a
// just-opened panel should do.
// Pushes into outlineStore (window.__setOutlineState, app/dotto-app.jsx — MUST be flushSync: this
// function's own scrollTop restore below, and toggleHamburgerMenu's setOutlineActive(0) call
// right after this returns, both need OutlinePanel.jsx's real DOM already committed) — React owns
// the row markup now (see OutlinePanel.jsx), this function only computes what to show and hands
// it off, same shape renderSourcesList/renderFilesList already use.
export function buildOutline(preserveState?: boolean): void {
  const appState = getAppState();
  const container = document.getElementById("hmenu-outline-container");
  if (!container || !appState) return;
  const savedScrollTop = preserveState ? container.scrollTop : 0;
  const savedQuery =
    preserveState && appState.outlineSearchInput ? appState.outlineSearchInput.value : "";
  // Fresh open only — clear any search term left over from a previous visit so the input doesn't
  // lie about what's actually showing. A preserveState rebuild instead re-applies savedQuery
  // (below, after the tree exists again) so an in-progress search survives.
  if (!preserveState && appState.outlineSearchInput) appState.outlineSearchInput.value = "";

  window.__setOutlineState?.({ rows: computeCurrentOutlineRows(), query: "" });

  if (preserveState) {
    if (savedQuery) handleOutlineSearch(savedQuery);
    container.scrollTop = savedScrollTop;
  }
}
// Recomputes the full row set fresh (computeCurrentOutlineRows above), then filters it down to
// whatever matches `query` — simpler than the old plain post-render DOM-visibility filter now
// that rows are plain data rather than already-rendered elements: a fresh compute is cheap (this
// is all already-in-memory data, no re-derivation of the grouping/proximity-sort logic itself
// needed, the same "compute then push" shape renderSourcesList/renderFilesList already use for
// their own search). A plain substring match against each row's own label, independent per row,
// is the same simple approach renderWaypointsList's own search (hamburger-collab.js) already
// uses. "All your blocks" here means everything buildOutline itself already reaches — the current
// canvas and its nested folders/sources, up to OUTLINE_MAX_DEPTH — not a cross-canvas search.
// Note: unlike the old DOM-visibility-toggle version, this resets which row is arrow-key-active on
// every keystroke (OutlinePanel.jsx's syncOutlineRows effect re-runs whenever the row list
// changes) rather than only when the visible set actually changes — a minor, accepted behavior
// change (see the migration plan's own "decide + confirm" note).
export function handleOutlineSearch(query: string): void {
  const q = (query || "").trim().toLowerCase();
  // ignoreCollapse while actively searching (q truthy) — otherwise a real match nested under a
  // collapsed heading could never surface, since computeOutlineRows would never even generate its
  // row to filter against. See renderHeadingSubtree's own comment.
  const rows = computeCurrentOutlineRows(!!q);
  const filtered = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  window.__setOutlineState?.({ rows: filtered, query: q });
}

// Navigates the live canvas to a card's containing folder and centers on it. Used for every
// non-source row (leaf cards AND canvas cards alike) — openFolder now goes through
// applyFolderView, so this also benefits from per-folder position memory (see
// navigateToFolder/applyFolderView).
export function goToOutlineItem(folderId: string, itemId: number): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.currentFolderId !== folderId) window.__openFolder?.(folderId);
  const it = appState.folders[folderId]?.items.find((i) => i.id === itemId);
  if (it) {
    const el = window.__findItemEl?.(it.id);
    const w = el ? el.offsetWidth : it.w || 100;
    const h = el ? el.offsetHeight : it.h || 50;
    const centerX = window.__canvasViewportCenterX?.() ?? 0;
    window.__smoothPanTo?.(centerX - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
    if (el && it.kind === "waypoint") window.__expandWaypointCard?.(el, it, { editable: false });
    window.__flashCanvasElement?.(el ?? undefined);
  }
  window.__closeRailView?.();
}
export function setOutlineActive(idx: number): void {
  const appState = getAppState();
  if (!appState?.outlineRows.length) return;
  idx =
    ((idx % appState.outlineRows.length) + appState.outlineRows.length) %
    appState.outlineRows.length;
  appState.outlineRows.forEach((r) => r.el.classList.remove("active"));
  appState.outlineActiveIndex = idx;
  const row = appState.outlineRows[idx];
  row.el.classList.add("active");
  row.el.scrollIntoView({ block: "nearest" });
}
// Feeds real DOM nodes from the React-rendered tree (OutlinePanel.jsx's own useLayoutEffect on
// its row list, app/dotto/) back into appState.outlineRows, in the same order they're displayed —
// srs-connections-core.js's own ArrowUp/ArrowDown/Enter keyboard-nav block (untouched, needs zero
// edits) doesn't care who owns the nodes, only that r.el is a real element it can
// classList.add('active')/scrollIntoView/click() — exactly what it already got from makeRow's own
// appState.outlineRows.push({ el: row }) before this tree became React.
export function syncOutlineRows(elements: ArrayLike<HTMLElement>): void {
  const appState = getAppState();
  if (!appState) return;
  appState.outlineRows = Array.from(elements).map((el) => ({ el }));
  appState.outlineActiveIndex = -1;
}
// "M" keyboard shortcut (srs-connections-core.js) — routes through the same shared rail mechanism
// the outline's own icon uses (openRailView/closeRailView, panels-hamburger.js) rather than
// toggling classes directly, so it correctly closes whichever OTHER rail view might currently be
// open instead of just layering the outline on top of it.
export function toggleHamburgerMenu(): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.activeRailView === "outline") {
    window.__closeRailView?.();
  } else if (appState.outlineMenu && appState.hamburgerBtn) {
    window.__openRailView?.(
      "outline",
      appState.outlineMenu,
      appState.hamburgerBtn,
      () => {
        buildOutline();
        setOutlineActive(0);
      },
      true,
    );
  }
}

window.__kindIconFile = kindIconFile;
// React → vanilla bridges — used by OutlinePanel.jsx (app/dotto/), which can't import this module
// directly since public/dotto/*.js isn't reachable from app/dotto/. Same reasoning as
// window.__goToOutlineItem below.
window.__goToOutlineSource = goToOutlineSource;
window.__goToOutlineSourceRow = goToOutlineSourceRow;
window.__syncOutlineRows = syncOutlineRows;
// React → vanilla bridge — used by FilesListPanel.jsx (app/dotto/) to navigate to (and flash) a
// file's own canvas card on click, same primitive the Outline tree's own non-source rows already
// use for every other card kind.
window.__goToOutlineItem = goToOutlineItem;
window.__toggleOutlineCollapse = toggleOutlineCollapse;
// Vanilla → React bridges — hamburger-collab.js/live-presence.js/search-panel-history.js/
// panels-hamburger.js/window-bridge.js/waypoints-render-loop.js/srs-connections-core.js all
// previously imported these directly.
window.__buildOutline = buildOutline;
window.__kindIconHTML = kindIconHTML;
window.__rowActionsHTML = rowActionsHTML;
// Plain (non-`__`) global — the real inline oninput="handleOutlineSearch(this.value)" target
// (content/fragments/hamburger-stack.html), same shape window.pushNotification/
// window.handleMarketplaceSearch use. Formerly re-exported through window-bridge.js's own
// centralized inline-handler list; now assigned directly here since this is the sole real caller.
window.handleOutlineSearch = handleOutlineSearch;
window.__setOutlineActive = setOutlineActive;
window.__toggleHamburgerMenu = toggleHamburgerMenu;
