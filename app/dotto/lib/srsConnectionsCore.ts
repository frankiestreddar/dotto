// Phase 4.5 port of public/dotto/srs-connections-core.js. calculateSM2/defaultSrsState/
// diffRatings (SM-2 spaced repetition) were already extracted to srs-algorithm.js in Phase 4.2 and
// stay there — genuinely pure, zero-import, and still needed by a still-vanilla caller
// (srs-algorithm.js itself now sets window.__calculateSM2/__defaultSrsState/__diffRatings
// directly, since it can safely set its own bridges). What's left here: the canvas data-conduit
// connection system (isValidConnection/CardStreamIO/propagateCanvasStreams), click-to-link
// (handleDataModeClick), canvas item creation (add/createNewSource/deepCloneItem), the pen/eraser
// drawing tool, the zoom-track drag/dblclick handlers, the draw toolbar, and the single largest
// piece: the global keydown handler backing every one-letter rail shortcut in the app. Reaches
// every still-vanilla dependency through window bridges; wires its real, module-load-time-only DOM
// listeners (global keydown, draw toolbar clicks/inputs, zoom-track drag/dblclick, canvas-level
// pointerdown/dblclick/wheel) via wireSrsConnectionsCore(), using the same bridge-readiness-poll
// wireX() pattern every other Phase 4.4/4.5 port with real DOM wiring has used. appState.CardStreamIO
// is assigned inside that same wire step (it mutates the live appState object, so it can't run at
// module-evaluation time the way it used to at vanilla module-load time — appState doesn't exist
// yet then).

interface SrsState {
  interval: number;
  easeFactor: number;
  dueDate: number;
  repetitions: number;
  masteredCounted?: boolean;
  [key: string]: unknown;
}
interface Item {
  id: number;
  kind: string;
  x: number;
  y: number;
  w?: number | null;
  h?: number | null;
  folderId?: string;
  [key: string]: unknown;
}
interface Connection {
  id: string;
  fromId: number;
  toId: number;
}
interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  connections?: Connection[];
  drawings?: Record<string, unknown>[];
  isSource?: boolean;
  globalId?: string;
  [key: string]: unknown;
}
interface StreamPayload {
  originId: number | string;
  streamType: string;
  timestamp: number;
  delta: Record<string, unknown>;
}
interface CardStreamCtx {
  folderObj: FolderObj;
  items: Item[];
  conns: Connection[];
}
interface CardStreamIOConfig {
  inputs?: string[];
  outputs?: string[];
  onStream?: (item: Item, payload: StreamPayload, ctx: CardStreamCtx) => void;
  getOutput?: (item: Item, ctx: CardStreamCtx) => StreamPayload | StreamPayload[] | null;
}
interface AppState {
  idCounter: number;
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  currentUser: { id: string | null };
  dataLinkPendingId: number | null;
  selectedCardIds: number[];
  CardStreamIO: Record<string, CardStreamIOConfig>;
  addingKind: string | null;
  addingStatKind: string | null;
  drawColor: string;
  drawSize: number;
  drawTool: string;
  drawLayer: string;
  penPolyline: {
    points: { x: number; y: number; handleOut: [number, number] | null }[];
    color: string;
    layer: string;
    width: number;
  } | null;
  penPolylineMoveHandler: ((e: PointerEvent) => void) | null;
  liveSvg: SVGSVGElement | null;
  livePath: SVGPathElement | null;
  drawing: { points: [number, number][]; color: string; layer: string; width: number } | null;
  undoStack: unknown[];
  tx: number;
  ty: number;
  scale: number;
  ZOOM_MIN: number;
  ZOOM_MAX: number;
  currentEditingEl: HTMLElement | null;
  outlineMenu: HTMLElement;
  outlineActiveIndex: number;
  outlineRows: { el: HTMLElement }[];
  activeRailView: string | null;
  lastWaypointsRows: { owner_id: string; folder_id: string; item_id: string }[] | null;
  btnInbox: HTMLElement;
  btnSearch: HTMLElement;
  btnSources: HTMLElement;
  btnSnippets: HTMLElement;
  btnSnippets2: HTMLElement;
  railBtnWaypoints: HTMLElement;
  railBtnCollab: HTMLElement;
  profileBtn: HTMLElement;
  messagesBtn: HTMLElement;
  btnServers: HTMLElement;
  btnCart: HTMLElement;
  libraryBtn: HTMLElement;
  [key: string]: unknown;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

function ensureSrsMeta(table: Item): Record<number, SrsState> {
  if (!table.srsMeta) table.srsMeta = {};
  return table.srsMeta as Record<number, SrsState>;
}
function getSrsForRow(table: Item, rowIndex: number): SrsState {
  const meta = ensureSrsMeta(table);
  if (!meta[rowIndex]) meta[rowIndex] = window.__defaultSrsState?.() as SrsState;
  return meta[rowIndex];
}
// Returns { rows, headers } (or null) rather than a bare rows array — `headers` is the table's own
// header row (plain text, one per column) and each row now also carries `cells` (the RAW
// per-column HTML, every column, not just front/back) alongside the existing
// front/back/rowIndex/etc — so a downstream game card can apply its OWN per-side column selection
// (see gameConfig/resolveGameFace) instead of only ever seeing column 0/1 flattened to plain text.
// `front`/`back` (column 0/1, stripped) are kept exactly as before so every existing consumer that
// destructures {rows} the old way keeps working unchanged.
function extractCardsFromSource(
  fromItem: Item,
): { rows: Record<string, unknown>[]; headers: string[] } | null {
  const table = window.__findLinkedTable?.(fromItem) as Item | null | undefined;
  const tableData = table?.tableData as string[][] | undefined;
  if (!table || !tableData || tableData.length < 2) return null;
  const rows: Record<string, unknown>[] = [];
  tableData.forEach((r, rowIndex) => {
    if (rowIndex === 0) return; // header row
    if (!r.some((c) => (window.__stripHtml?.(c || "") || "").trim() !== "")) return; // skip blank rows
    rows.push({
      front: window.__stripHtml?.(r[0] || ""),
      back: window.__stripHtml?.((r.length > 1 ? r[1] : r[0]) || ""),
      cells: r.slice(),
      rowIndex,
      // originTableId lets a downstream consumer (an srsUpdate flowing back, or a filter card)
      // always find its way back to the REAL table this row came from — essential once rows can
      // flow through a filter or a merged source and no longer necessarily share the receiving
      // card's own findLinkedTable() result. tags is the row's tag ids on ITS OWN table (see
      // ensureCellTags) — a filter card matches against these; they mean nothing outside the
      // context of originTableId.
      originTableId: table.id,
      tags: ((table.cellTags as Record<number, number[]> | undefined) || {})[rowIndex] || [],
      srs: Object.assign({}, getSrsForRow(table, rowIndex)),
    });
  });
  if (!rows.length) return null;
  return { rows, headers: tableData[0].map((h) => window.__stripHtml?.(h || "") || "") };
}

// Applies an inbound 'srsUpdate' payload (pushed back by a downstream flashcard after a grading
// action) onto the source-of-truth table's per-row memory state. Routes by originTableId when the
// payload carries one (set on every row by extractCardsFromSource) — that's the row's REAL home
// table, which is no longer necessarily this receiving item's own findLinkedTable() result once a
// filter card or a merged source sits in between; falls back to the old direct-link behavior for
// payloads that predate that field.
function applySrsUpdateStream(item: Item, payload: StreamPayload): void {
  if (payload.streamType !== "srsUpdate") return;
  const { rowIndex, srs, originTableId } = (payload.delta || {}) as {
    rowIndex?: number;
    srs?: SrsState;
    originTableId?: number;
  };
  if (rowIndex == null || !srs) return;
  const table =
    (originTableId != null && (window.__findTableById?.(originTableId) as Item | null)) ||
    (window.__findLinkedTable?.(item) as Item | null | undefined);
  if (!table) return;
  // "Mastered" = the SM-2 interval (in days — see calculateSM2) crossing 90+. masteredCounted
  // rides along in this same row-meta blob (persisted with the rest of the workspace JSON via
  // scheduleWorkspaceSave) so a word is only ever counted toward master_250_words once, even if a
  // later wrong answer drops its interval back down and it re-crosses 90 again later.
  const meta = ensureSrsMeta(table);
  const prev = meta[rowIndex];
  if (prev && prev.masteredCounted) {
    srs.masteredCounted = true;
  } else if ((srs.interval as number) >= 90) {
    srs.masteredCounted = true;
    window.__bumpAchievementStat?.("master_250_words");
  }
  meta[rowIndex] = srs;
}

// CanvasStreamPayload — the single standardized message shape every card kind uses to talk to any
// other card kind over a connection. Consumers must only branch on `streamType`/`delta` shape —
// never on which kind produced or will receive it.
function makeStreamPayload(
  originId: number | string,
  streamType: string,
  delta?: Record<string, unknown>,
): StreamPayload {
  return { originId, streamType, timestamp: Date.now(), delta: delta || {} };
}

// Sums the current 'performance' output of every card a source/table/folder card feeds content to
// (i.e. every game connected downstream of it), into one combined payload. This is how a stats
// card linked to a shared data source shows totals across *all* games built on top of it, without
// the source ever inspecting what kind those games are — it just asks each connected card's own
// registered IO for its current performance output, exactly like propagateCanvasStreams itself
// does.
function aggregateDownstreamPerformance(
  sourceItem: Item,
  ctx: CardStreamCtx | undefined,
): StreamPayload | null {
  if (!ctx || !ctx.conns || !ctx.items) return null;
  const downstreamConns = ctx.conns.filter((c) => c.fromId === sourceItem.id);
  if (!downstreamConns.length) return null;
  let seenTotal = 0;
  const ratingsTotal: Record<string, number> = { noclue: 0, wrong: 0, hard: 0, easy: 0 };
  let any = false;
  downstreamConns.forEach((c) => {
    const gameItem = ctx.items.find((i) => i.id === c.toId);
    if (!gameItem) return;
    const appState = getAppState();
    const gameIO = appState?.CardStreamIO[gameItem.kind];
    if (!gameIO || !gameIO.outputs || !gameIO.outputs.includes("performance") || !gameIO.getOutput)
      return;
    let perf = gameIO.getOutput(gameItem, ctx);
    if (!perf) return;
    if (!Array.isArray(perf)) perf = [perf];
    perf.forEach((p) => {
      if (!p || p.streamType !== "performance") return;
      any = true;
      seenTotal += (p.delta && (p.delta.seen as number)) || 0;
      const r = (p.delta && (p.delta.ratings as Record<string, number>)) || {};
      Object.keys(ratingsTotal).forEach((k) => {
        ratingsTotal[k] += r[k] || 0;
      });
    });
  });
  if (!any) return null;
  return makeStreamPayload(sourceItem.id, "performance", {
    seen: seenTotal,
    ratings: ratingsTotal,
  });
}

// Shared by CardStreamIO.filter's getOutput and the filter card's own on-canvas row count — a row
// passes through if it has at least one selected tag ("or", the default) or every selected tag
// ("and"). No tags selected at all means everything passes through unfiltered.
export function applyFilterToRows(
  item: Item,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const selected = (item.filterTagIds as number[]) || [];
  if (!selected.length) return rows;
  return rows.filter((r) => {
    const rowTags = (r && (r.tags as number[])) || [];
    return item.filterMode === "and"
      ? selected.every((t) => rowTags.includes(t))
      : selected.some((t) => rowTags.includes(t));
  });
}
// Every distinct tag currently seen across a filter card's incoming rows, resolved (via each row's
// originTableId) to its real {id, name, color} definition on whichever source it came from — a
// filter has no source of its own, so the only tags it can ever offer are whatever is actually
// flowing into it right now.
export function collectAvailableFilterTags(
  rows: Record<string, unknown>[] | undefined,
): { id: number; name: string; color?: string }[] {
  const seen = new Map<number, { id: number; name: string; color?: string }>();
  (rows || []).forEach((r) => {
    const originTableId = r.originTableId as number | undefined;
    const originTable =
      originTableId != null ? (window.__findTableById?.(originTableId) as Item | null) : null;
    if (!originTable) return;
    ((r.tags as number[]) || []).forEach((tagId) => {
      if (seen.has(tagId)) return;
      const tag = ((originTable.tags as { id: number; name: string; color?: string }[]) || []).find(
        (t) => t.id === tagId,
      );
      if (tag) seen.set(tagId, tag);
    });
  });
  return Array.from(seen.values());
}

// Gatekeeper for every connection-creation entry point (drag-to-link and multi-select link).
// Rejects a prospective fromId -> toId edge before it's ever added to folder.connections, so
// propagateCanvasStreams never has to deal with a self-link, a stream-type mismatch, or a cycle.
// All three checks are driven purely by CardStreamIO's declared inputs/outputs and the existing
// connection graph — never by card kind — so any new card kind just needs to declare its
// inputs/outputs correctly to be validated for free. A Stack (kind:'shelf' — see its add-menu
// entry) holds exactly one kind of thing at a time: either stopwatch sessions or source rows,
// never both mixed together (its own UI, renderShelfHTML, already renders these as two entirely
// separate sections). Returns null for any card kind that doesn't feed a shelf meaningfully at all
// (isValidConnection's ordinary type-matching rule already handles those).
function shelfInputCategory(kind: string): string | null {
  if (kind === "stopwatch") return "sessions";
  const appState = getAppState();
  const cfg = appState?.CardStreamIO[kind];
  if (cfg && cfg.outputs && cfg.outputs.includes("sourceRows")) return "sources";
  return null;
}
export function isValidConnection(fromId: number, toId: number): boolean {
  // Rule 1: no self-links.
  if (fromId === toId) return false;

  const appState = getAppState();
  const folder = appState?.folders[appState.currentFolderId];
  if (!folder) return false;
  const fromItem = folder.items.find((i) => i.id === fromId);
  const toItem = folder.items.find((i) => i.id === toId);
  if (!fromItem || !toItem) return false;

  // Rule 2: type matching. Either card kind must be missing from CardStreamIO, or missing
  // outputs/inputs entirely, to be blocked outright; otherwise at least one of the source's
  // outputs must be accepted by the target's inputs.
  const fromConfig = appState!.CardStreamIO[fromItem.kind];
  const toConfig = appState!.CardStreamIO[toItem.kind];
  if (!fromConfig || !toConfig || !fromConfig.outputs || !toConfig.inputs) return false;
  const hasMatchingType = fromConfig.outputs.some((outType) => toConfig.inputs!.includes(outType));
  if (!hasMatchingType) return false;

  const conns = (window.__ensureConnections?.(folder) as Connection[]) || [];

  // Rule 2.5: a Stack already fed by one category (sessions or sources — see shelfInputCategory)
  // rejects a new connection from the OTHER category outright, even though the streamType-level
  // check above would otherwise allow it.
  if (toItem.kind === "shelf") {
    const newCategory = shelfInputCategory(fromItem.kind);
    if (newCategory) {
      const existingCategories = new Set(
        conns
          .filter((c) => c.toId === toId)
          .map((c) => {
            const other = folder.items.find((i) => i.id === c.fromId);
            return other ? shelfInputCategory(other.kind) : null;
          })
          .filter(Boolean),
      );
      if (existingCategories.size && !existingCategories.has(newCategory)) return false;
    }
  }

  // Rule 3: no circular dependencies. If a path already exists from toId back to fromId through
  // the current connection graph, adding fromId -> toId would close a loop, so walk forward from
  // toId (BFS) and bail if we ever land back on fromId.
  let currentTargets = [toId];
  const visited = new Set<number>();
  while (currentTargets.length > 0) {
    const nextId = currentTargets.shift()!;
    if (nextId === fromId) return false; // Loop detected!
    if (!visited.has(nextId)) {
      visited.add(nextId);
      const children = conns.filter((c) => c.fromId === nextId).map((c) => c.toId);
      currentTargets.push(...children);
    }
  }
  return true;
}

// Cancels a click-to-link gesture already in progress (see handleDataModeClick), removing the
// "armed" highlight from whichever card was first-clicked. Safe to call even when nothing is
// pending.
export function clearDataLinkPending(): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.dataLinkPendingId != null) {
    const prevEl = window.__findItemEl?.(appState.dataLinkPendingId);
    if (prevEl) prevEl.classList.remove("link-source-armed");
  }
  appState.dataLinkPendingId = null;
}
// The click-based counterpart to dragging a connection line from one card to another (see
// startConnectionDrag) — called when a data-mode gesture on `it` turns out to be a plain click
// rather than a drag. First click arms `it` as the pending link source (highlighted via
// .link-source-armed, re-applied every render — see the main render loop); a second click on a
// DIFFERENT card completes the link exactly as a drag between them would, subject to the same
// isValidConnection rules. Clicking the already-armed card again cancels it instead of linking it
// to itself.
export function handleDataModeClick(it: Item, el: HTMLElement): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.dataLinkPendingId == null) {
    appState.dataLinkPendingId = it.id;
    el.classList.add("link-source-armed");
    return;
  }
  const fromId = appState.dataLinkPendingId;
  clearDataLinkPending();
  if (fromId === it.id) return; // clicked the armed card again — just cancel
  if (!isValidConnection(fromId, it.id)) return;
  window.__saveSnapshot?.();
  const conns = window.__ensureConnections?.(appState.folders[appState.currentFolderId]) as
    Connection[] | undefined;
  if (conns) window.__createConnection?.(conns, fromId, it.id);
  window.__render?.();
}

// Generic, scalable across any number of card kinds/connections: walks every connection, asks the
// source card's registered IO for its current output payload(s), and — purely by matching
// payload.streamType against the target card's declared input capability, never by checking either
// card's identity/kind — delivers matching payloads to the target's onStream. Multiple passes let
// short connection chains (A -> B -> C) settle within one render.
function propagateCanvasStreams(folderObj: FolderObj): void {
  const appState = getAppState();
  if (!appState) return;
  const items = folderObj.items;
  const conns = (window.__ensureConnections?.(folderObj) as Connection[]) || [];
  const ctx: CardStreamCtx = { folderObj, items, conns };
  const PASSES = 4;
  // Stat cards never persist their own data — they only ever reflect whatever's currently flowing
  // to them. Clearing the cache before each render's propagation (rather than only ever merging
  // into it) is what lets a connected shelf's session selector actually change what a stat card
  // shows: without this, once a session's data landed in streamCache it would stick there forever,
  // since the onStream 'keep newest' guard below exists to dedupe *within* one delivery pass, not
  // to pin the card to whichever session happened to arrive first across separate renders.
  items.forEach((it) => {
    if (it.kind === "statcard") it.streamCache = {};
    // Same reasoning as statcard.streamCache above, for the two other content-aggregating kinds:
    // both only ever reflect what's CURRENTLY flowing in, recomputed fresh every render — reset
    // here (not consumed inside getOutput) so a getOutput called more than once per render (once
    // per downstream connection) always sees the same accumulated set instead of the first caller
    // draining it for everyone after.
    if (it.kind === "shelf") it.stackSourceRows = {};
    if (it.kind === "filter") it.incomingRows = [];
  });
  // Delivers whatever `sender` currently outputs to `receiver`'s input, purely by matching
  // declared streamTypes — never by kind. Called both ways per connection below so a card the user
  // drew as the *target* of a link (e.g. a flashcard fed by a source) can still push data of a
  // different streamType back the other way (e.g. an 'srsUpdate' flowing from flashcard -> source)
  // over that same connection, without requiring the user to draw a second link in reverse.
  function deliver(sender: Item | undefined, receiver: Item | undefined): void {
    if (!sender || !receiver) return;
    const senderIO = appState!.CardStreamIO[sender.kind];
    const receiverIO = appState!.CardStreamIO[receiver.kind];
    if (
      !senderIO ||
      !senderIO.getOutput ||
      !receiverIO ||
      !receiverIO.inputs ||
      !receiverIO.onStream
    )
      return;
    let payloads = senderIO.getOutput(sender, ctx);
    if (!payloads) return;
    if (!Array.isArray(payloads)) payloads = [payloads];
    payloads.forEach((payload) => {
      if (payload && receiverIO.inputs!.includes(payload.streamType)) {
        receiverIO.onStream!(receiver, payload, ctx);
      }
    });
  }
  for (let pass = 0; pass < PASSES; pass++) {
    conns.forEach((c) => {
      const fromItem = items.find((i) => i.id === c.fromId);
      const toItem = items.find((i) => i.id === c.toId);
      deliver(fromItem, toItem);
      deliver(toItem, fromItem);
    });
  }

  // Source-of-truth integrity: a flashcard's real word data is only ever supposed to exist while
  // it's actively fed by a connected table/source/folder. If that connection is gone (line
  // deleted, source deleted, etc — this check doesn't care how, it just looks at the current
  // graph) but the deck still carries real content from a past connection (a rowIndex/srs field is
  // the tell), collapse it back to the generic placeholder deck rather than letting real language
  // data linger detached from its source. Checked every render, not on a specific event, so it's
  // robust to any path that can sever the link.
  items.forEach((it) => {
    if (it.kind !== "flashcard" && it.kind !== "typeright") return;
    const cards = (it.cards as Record<string, unknown>[]) || [];
    const looksReal = cards.some((c) => c && (c.rowIndex != null || c.srs));
    if (!looksReal) return;
    const stillFed = conns.some((c) => {
      const otherId = c.fromId === it.id ? c.toId : c.toId === it.id ? c.fromId : null;
      if (!otherId) return false;
      const other = items.find((i) => i.id === otherId);
      return (
        other &&
        appState!.CardStreamIO[other.kind] &&
        (appState!.CardStreamIO[other.kind].outputs || []).includes("content")
      );
    });
    if (!stillFed) {
      if (it.kind === "flashcard") {
        it.cards = window.__defaultFlashcardDeck?.();
        it.fcOrder = [];
        it.fcIndex = 0;
        it.fcFlipped = false;
        it.fcStats = {};
        it.fcSeenCount = 0;
      } else {
        it.cards = [];
        it.trOrder = [];
        it.trIndex = 0;
        it.trInput = "";
        it.trChecked = false;
        it.trStats = {};
        it.trSeenCount = 0;
      }
    }
  });
}

export function applyConnections(folderObj: FolderObj): void {
  propagateCanvasStreams(folderObj);
}

export function cancelAddingKind(): void {
  const appState = getAppState();
  if (!appState) return;
  appState.addingKind = null;
  appState.addingStatKind = null;
  window.__getCanvasEl?.()?.classList.remove("crosshair");
  window.removePlacementGhost?.();
}

// Keyed by appState.activeRailView (see openRailView/wireRailIcon, panelsHamburger.ts) — used by
// the Enter-focuses-search-box handler below. 'search'/'ai' added per explicit follow-up request
// that every side panel's search box show/respond to this — both panels' own search boxes didn't
// exist yet when this map (and its "AI/Profile don't [have one]" comment further down) was first
// written.
const RAIL_PANEL_SEARCH_INPUT_ID: Record<string, string> = {
  outline: "outline-search",
  waypoints: "waypoints-search",
  collab: "hub-collab-search",
  marketplace: "market-search",
  // 'library' (was 'library-search') removed — Extensions (was Library) is a flat list of
  // installed-extension pills with no search box of its own, same as Profile never having had one
  // — Enter is simply a no-op for it now, per this handler's own comment below.
  messages: "msg-search",
  add: "add-menu-search-input",
  search: "search-panel-search",
  ai: "search-input",
  sources: "sources-panel-search",
  snippets: "files-panel-search",
};

// 'a'-prefix add-block chord — pressing 'a' then a second letter within ADD_CHORD_TIMEOUT_MS arms
// a placement ghost for that block kind (prepareAdd, copyPaste.ts — the exact same click-to-place
// flow the Blocks panel's own rows use, handleBlockItemClick -> prepareAdd), letting the next
// canvas click choose where it lands, rather than dropping it at the viewport centre immediately —
// per explicit follow-up request. "Just to test" the idea per the original explicit request — only
// 'n' (note) and 'h' (heading) are wired up so far; add more entries to ADD_CHORD_KEYS as they're
// decided. A leader-key chord like this has no existing precedent elsewhere in the app to reuse.
// addChordArmed/addChordTimer are plain module-level state, not appState — purely ephemeral input
// state with nothing else in the app needing to read it, same reasoning modePopupSafeZoneActive
// (sourceButtonsCursorMode.ts) stays a local closure too rather than living on shared state.
const ADD_CHORD_TIMEOUT_MS = 1000;
const ADD_CHORD_KEYS: Record<string, string> = { n: "note", h: "title" };
let addChordArmed = false;
let addChordTimer: ReturnType<typeof setTimeout> | null = null;

function handleGlobalKeydown(e: KeyboardEvent): void {
  const appState = getAppState();
  if (!appState) return;
  const active = document.activeElement as HTMLElement | null;
  const isEditingText = !!(
    active &&
    (active.isContentEditable ||
      active.tagName === "INPUT" ||
      active.tagName === "SELECT" ||
      active.tagName === "TEXTAREA")
  );

  // Checked before every other single-letter branch below so a chord's own second key (e.g. 'n',
  // separately bound below to a debug notification test; 'h', separately bound to Library/#btnCart)
  // is consumed HERE instead of also falling through to that unrelated shortcut. Any key that
  // ISN'T a registered chord entry just cancels the chord silently and falls through to whatever
  // it would normally do instead — 'a' then 'w' still opens Waypoints, it doesn't add anything,
  // since the chord only ever intercepts its own recognized second keys.
  if (!isEditingText && addChordArmed) {
    addChordArmed = false;
    if (addChordTimer) clearTimeout(addChordTimer);
    const chordKind = ADD_CHORD_KEYS[e.key.toLowerCase()];
    if (chordKind) {
      e.preventDefault();
      window.prepareAdd?.(chordKind);
      return;
    }
  } else if (!isEditingText && (e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    addChordArmed = true;
    if (addChordTimer) clearTimeout(addChordTimer);
    addChordTimer = setTimeout(() => {
      addChordArmed = false;
    }, ADD_CHORD_TIMEOUT_MS);
    return;
  }

  if (!isEditingText && appState.outlineMenu.classList.contains("open")) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      window.__setOutlineActive?.(appState.outlineActiveIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      window.__setOutlineActive?.(appState.outlineActiveIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = appState.outlineRows[appState.outlineActiveIndex] || appState.outlineRows[0];
      if (row) row.el.click();
      return;
    }
  }

  // Every single-key shortcut below is only meant to fire when nothing else is going on — not just
  // "no input is focused" (isEditingText), but also "no side panel is currently open"
  // (anyPanelOpen). Without that second check, typing a normal sentence while e.g. the Waypoints
  // panel is open (cursor resting on the panel, no input actually clicked into yet) did nothing
  // for most letters, then hijacked focus to the AI search box the instant a space or "/" was
  // typed — reading as "if you start typing, it starts inputting in the text box." Once some other
  // panel is already open, reaching a DIFFERENT one now always means clicking its rail icon rather
  // than one of these letter shortcuts still firing.
  const anyPanelOpen = window.__isAnyUiPanelOpen?.() ?? false;
  // Space opens the Explain panel (AI chat, part of #hamburger-stack — see
  // openRailView/openSearchOverlay) empty. openSearchOverlay shows the panel THEN focuses the
  // input — focusing an element inside a still-hidden (display:none) subtree is a silent no-op, so
  // that order is load-bearing, not stylistic. "/" used to ALSO open this same panel (pre-filling a
  // slash command — see command-parser.js) before Search got its own rail icon; now "/" opens
  // Search instead (below, alongside the other letter shortcuts), so that pre-fill trick no longer
  // applies here at all — typing "/" manually once the Explain panel is already open still works
  // exactly as before, this was only ever about the global keyboard shortcut.
  if (!isEditingText && !anyPanelOpen && (e.key === "q" || e.key === "Q")) {
    e.preventDefault();
    window.__openSearchOverlay?.();
    return;
  }
  if (!isEditingText && (e.key === "o" || e.key === "O")) {
    e.preventDefault();
    window.__toggleHamburgerMenu?.();
    return;
  }
  // Debug shortcut for tweaking the notification entrance/exit animation — fires a plain
  // notification with no buttons on every press. Remove once done tweaking.
  if (!isEditingText && !anyPanelOpen && (e.key === "n" || e.key === "N")) {
    e.preventDefault();
    window.pushNotification?.({ type: "debug", message: "this is an example notification" });
    return;
  }
  // One-letter shortcuts for the rest of the rail (see each icon's own .rail-tooltip-key,
  // top-bar.html) — .click() re-triggers the exact same wireRailIcon listener
  // (panelsHamburger.ts) a real click would, open/switch/close toggle included, rather than
  // duplicating that logic here per icon. 'o' above (Outline, was 'm' before a follow-up request
  // reassigned it) is the one pre-existing exception, going through window.__toggleHamburgerMenu()
  // directly instead — left as-is rather than converted, since it predates this block and already
  // works. None of these reuse a letter that already means something else globally (checked
  // against every existing e.key === '<letter>' in this codebase before picking). 'F' (Files, was
  // Snippets) used to collide with card-shortcuts.js's hover-scoped flip-flashcard shortcut (only
  // while hovering a flashcard, but still a real collision since that handler isn't gated on
  // !anyPanelOpen) — resolved per explicit request by moving flip-flashcard to Space instead,
  // freeing 'F' up cleanly. Sources was 'S' with no prior collision, then reassigned to 'K' (also
  // no prior collision) once 'S' was wanted for the newer, separate Snippets button
  // (appState.btnSnippets2, distinct from appState.btnSnippets/Files). 'J' (Friends) was free again
  // — the Friends rail button/panel it opened was removed entirely per explicit request (a
  // never-implemented stub, unrelated to the real friend-list/friend-request data model
  // friends-presence.js still provides for Collaborations/Messages) — now reused for Servers (see
  // that shortcut's own line, below).
  // Collaborations is 'C' (was 'G', reassigned per explicit request — the bare 'c'/'C'
  // copy-selected-cards shortcut that used to collide with it was removed from historyAutosave.ts
  // at the same time, specifically to free this letter up cleanly, no fallback ambiguity). Routes
  // (was Inbox, renamed per explicit request — its own internal ids/appState fields stayed
  // btnInbox/inboxPanel, same convention as every other rename this session, e.g. Files staying
  // #btn-snippets under the hood) is 'R' (was 'I', freed up by the rename), Messages is 'M' (freed
  // up once Outline moved to 'O' above), Marketplace is 'H' (was ';', reassigned per explicit
  // request) and Search is 'Tab' (was '/', reassigned per explicit request — swapped with
  // Profile/You below, which moved off Tab in the same request, since renamed onto 'Y'). Note this
  // does mean Tab no longer moves focus between elements anywhere outside a text field
  // (isEditingText only guards contentEditable/INPUT/SELECT/TEXTAREA, not e.g. a focused button) —
  // an explicit tradeoff, not an oversight.
  // Deliberately NOT gated on !anyPanelOpen (unlike 'n' above, and unlike an earlier version of
  // these same lines) — these are meant to jump straight from one open panel to another, not just
  // open one from a clean slate. openRailView (via .click(), same as toggleHamburgerMenu's own
  // openRailView call above) already closes whatever else is open before opening the new one, so
  // switching panels this way is already safe; isEditingText alone is enough to stop them firing
  // while actually typing in a focused field.
  if (!isEditingText && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    appState.btnInbox.click();
    return;
  }
  if (!isEditingText && e.key === "Tab") {
    e.preventDefault();
    appState.btnSearch.click();
    return;
  }
  // Not a panel, and no longer even a rail button — the theme toggle moved into a "Colour Theme"
  // switch inside #profile-settings-view (per explicit request, formerly #settings-panel before
  // Settings' own rail icon was removed), so this calls theme-toggle.js's own toggleTheme()
  // directly instead of .click()-ing an element that no longer exists.
  if (!isEditingText && e.key === "\\") {
    e.preventDefault();
    window.__toggleTheme?.();
    return;
  }
  // Was 'P' — reassigned to 'Y' per explicit request (Profile itself renamed "You" in the same
  // request), freeing 'P' back up in turn for Plugins (was Extensions/Library, below).
  if (!isEditingText && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    appState.profileBtn.click();
    return;
  }
  if (!isEditingText && (e.key === "w" || e.key === "W")) {
    e.preventDefault();
    appState.railBtnWaypoints.click();
    return;
  }
  if (!isEditingText && (e.key === "c" || e.key === "C")) {
    e.preventDefault();
    appState.railBtnCollab.click();
    return;
  }
  // Was 'J' (Friends) — reassigned to 'S' per explicit request, freeing 'S' back up in turn for
  // Snippets2's own move to 'X' below (delete/cut, historyAutosave.ts's bare 'X', is guarded off
  // whenever something's selected — see that shortcut's own comment for why).
  if (!isEditingText && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    appState.btnServers.click();
    return;
  }
  if (!isEditingText && (e.key === "h" || e.key === "H")) {
    e.preventDefault();
    appState.btnCart.click();
    return;
  }
  // Was 'L' (Library), then 'E' (Extensions) — reassigned to 'P' when Extensions was renamed back
  // to Plugins per explicit follow-up request, reusing the 'P' that Profile's own rename to "You"
  // (moving to 'Y', above) just freed up; 'E'/'L' are both unbound now.
  if (!isEditingText && (e.key === "p" || e.key === "P")) {
    e.preventDefault();
    appState.libraryBtn.click();
    return;
  }
  if (!isEditingText && (e.key === "m" || e.key === "M")) {
    e.preventDefault();
    appState.messagesBtn.click();
    return;
  }
  // Was 'E' (Essentials) — reassigned to 'B' when Essentials was renamed Blocks per explicit
  // request. 'E' was reused above for Extensions for a while, then freed up again once that panel
  // reverted to Plugins/'P' (above) — currently unbound.
  if (!isEditingText && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    window.__getBtnAddEl?.()?.click();
    return;
  }
  // Sources was 'S' (reassigned to 'K' per explicit request, freeing 'S' up for the newer,
  // separate Snippets button below).
  if (!isEditingText && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    appState.btnSources.click();
    return;
  }
  if (!isEditingText && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    appState.btnSnippets.click();
    return;
  }
  // appState.btnSnippets2 is the newer, separate Snippets button (see its own comment,
  // core-state.js) — not appState.btnSnippets, which is actually Files under the hood. Was 'S'
  // (freed up per explicit request for Servers, above) — reassigned to 'X', which collides with
  // the bare delete/cut shortcut (historyAutosave.ts, fires whenever selectedCardIds is
  // non-empty) whenever something's actually selected; resolved the same way the Z/Cmd+Z collision
  // below was — this handler backs off and lets cut own the key exactly when cut is live
  // (something selected), only opening Snippets otherwise.
  if (!isEditingText && appState.selectedCardIds.length === 0 && (e.key === "x" || e.key === "X")) {
    e.preventDefault();
    appState.btnSnippets2.click();
    return;
  }
  // Was bare 'z'/'Z', then briefly Cmd/Ctrl+, (matching the Preferences/Settings convention most
  // other apps use) — simplified to bare ',' per a follow-up explicit request. No collision to
  // guard against: nothing else in this codebase binds a bare ',' key, and Cmd/Ctrl+Z (undo/redo,
  // historyAutosave.ts) no longer overlaps with this shortcut at all now that Z itself is free of
  // it too. Settings is no longer its own rail icon (moved into a sub-view of the Profile panel,
  // per an earlier explicit request) — this opens Profile and jumps straight to that sub-view in
  // one step (profileBtn's own click handler, via wireRailIcon, runs synchronously —
  // refreshProfilePanel resets to the main view first, and showProfileSettingsView right after
  // switches it back to settings before anything paints) rather than requiring a second click once
  // there.
  if (!isEditingText && e.key === ",") {
    e.preventDefault();
    appState.profileBtn.click();
    window.__showProfileSettingsView?.();
    return;
  }
  // Not a rail icon (see upload-popup.js) — toggleUploadPopup() is a plain classList toggle on its
  // own independent #upload-popup, not an openRailView('...', ...).click() call like every
  // shortcut above it.
  if (!isEditingText && (e.key === "u" || e.key === "U")) {
    e.preventDefault();
    window.__toggleUploadPopup?.();
    return;
  }
  // Finishes an in-progress point-by-point pen line without leaving pen mode (unlike Escape, which
  // also switches back to Normal mode via the separate tap/hold override logic in
  // sourceButtonsCursorMode.ts) — lets you place the next line right away.
  if (
    !isEditingText &&
    window.__effectiveMode?.() === "pen" &&
    appState.penPolyline &&
    e.key === "Enter"
  ) {
    e.preventDefault();
    finishPenPolyline();
    return;
  }
  // Enter, while some panel is open and nothing is actually focused yet, jumps straight into that
  // panel's own search box (per explicit request, replacing an earlier "typing any character jumps
  // into the search box" design — Enter is one single, deliberate key to reach for, rather than
  // every keystroke being intercepted). Also what the "Enter" hint badge inside each search box
  // (.hub-subpanel-search-hint/#search-input-hint, globals.css) is advertising, per a later
  // explicit follow-up request. RAIL_PANEL_SEARCH_INPUT_ID only covers panels that actually have a
  // search box of their own (Profile doesn't), so Enter is simply a no-op here for that one, same
  // as it always was.
  if (!isEditingText && anyPanelOpen && e.key === "Enter") {
    const searchId = appState.activeRailView
      ? RAIL_PANEL_SEARCH_INPUT_ID[appState.activeRailView]
      : undefined;
    const input = searchId && document.getElementById(searchId);
    if (input) {
      e.preventDefault();
      input.focus();
    }
  }
  // 1-9 then 0 jump straight to the first 10 rows of the Waypoints panel — matching whatever it's
  // currently showing (see sortWaypointRowsByProximity/appState.lastWaypointsRows,
  // hamburger-collab.js, and the same-index .outline-item-key badges WaypointRow draws,
  // WaypointsListPanel.jsx), only while that panel specifically is open. window.__goToWaypointCard
  // is the exact same bridge each row's own onClick already calls.
  if (!isEditingText && appState.activeRailView === "waypoints" && /^[0-9]$/.test(e.key)) {
    const idx = e.key === "0" ? 9 : Number(e.key) - 1;
    const row = appState.lastWaypointsRows && appState.lastWaypointsRows[idx];
    if (row) {
      e.preventDefault();
      window.__goToWaypointCard?.(row.owner_id, row.folder_id, row.item_id);
    }
  }
}

function updateDrawToolBtns(): void {
  const appState = getAppState();
  if (!appState) return;
  window.__getDrawPenBtnEl?.()?.classList.toggle("active", appState.drawTool === "pen");
  window.__getDrawEraserBtnEl?.()?.classList.toggle("active", appState.drawTool === "eraser");
}
export function updateDrawLayerBtns(): void {
  const appState = getAppState();
  if (!appState) return;
  window.__getDrawFrontBtnEl?.()?.classList.toggle("active", appState.drawLayer === "front");
  window.__getDrawBackBtnEl?.()?.classList.toggle("active", appState.drawLayer === "back");
}

const PEN_CLICK_THRESHOLD_PX = 4;
function toWorldPoint(e: { clientX: number; clientY: number }, rect: DOMRect): [number, number] {
  const appState = getAppState()!;
  return [
    (e.clientX - rect.left - appState.tx) / appState.scale,
    (e.clientY - rect.top - appState.ty) / appState.scale,
  ];
}
function makeLivePath(
  color: string,
  size: number,
  layer: string,
): { svg: SVGSVGElement; path: SVGPathElement } {
  const svg = window.__makeLayerSVG?.(layer === "back" ? 0 : 2) as SVGSVGElement;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement;
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", String(size));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  const world = window.__getWorldEl?.();
  if (layer === "back") world?.insertBefore(svg, world.firstChild);
  else world?.appendChild(svg);
  return { svg, path };
}

// ---------- Pen tool: point-by-point line ----------
// Reworked from the old Add-menu "Drawing" toggle (setDrawMode/appState.drawMode) into a real
// cursor mode — see applyCursorMode, sourceButtonsCursorMode.ts, for how pen mode itself is
// entered/exited now (appState.cardMode === 'pen', same mechanism data/select already use). Each
// point is {x, y, handleOut} — handleOut (world coords, or null) is the Illustrator-style bezier
// handle a click-DRAG pulls out when placing the 2nd point onwards (see handlePenPointerDown's own
// comment below), curving the segment back to the previous point; penPointsToPath
// (drawing-connections.js) is what actually turns this into an SVG path, straight-line M/L
// segments where neither endpoint has a handle, C (cubic bezier) where either does. A rubber-band
// segment from the last placed point to the current mouse position keeps rendering between clicks
// via this persistent window pointermove listener (unlike a freehand stroke's own move listener
// below, which only lives for the duration of one drag) — stashed on appState so finishPenPolyline
// can remove exactly this one. If the last placed point has its own handleOut, this preview
// already curves toward the mouse using it, so the segment doesn't visually "snap" from straight
// to curved the instant the next point actually lands.
function startPenPolyline(wx: number, wy: number): void {
  const appState = getAppState()!;
  window.__saveSnapshot?.();
  appState.penPolyline = {
    points: [{ x: wx, y: wy, handleOut: null }],
    color: appState.drawColor,
    layer: appState.drawLayer,
    width: appState.drawSize,
  };
  const { svg, path } = makeLivePath(appState.drawColor, appState.drawSize, appState.drawLayer);
  appState.liveSvg = svg;
  appState.livePath = path;
  const canvas = window.__getCanvasEl?.();
  const rect = canvas!.getBoundingClientRect();
  const move = (me: PointerEvent) => {
    const [mx, my] = toWorldPoint(me, rect);
    appState.livePath!.setAttribute(
      "d",
      window.__penPointsToPath?.(
        appState.penPolyline!.points.concat([{ x: mx, y: my, handleOut: null }]),
      ) || "",
    );
  };
  appState.penPolylineMoveHandler = move;
  window.addEventListener("pointermove", move as EventListener);
}
function addPenPolylinePoint(wx: number, wy: number, handleOut: [number, number] | null): void {
  const appState = getAppState()!;
  appState.penPolyline!.points.push({ x: wx, y: wy, handleOut: handleOut || null });
  appState.livePath!.setAttribute(
    "d",
    window.__penPointsToPath?.(appState.penPolyline!.points) || "",
  );
}
// Commits the in-progress polyline (>=2 points) or discards it (a stray single click, undoing the
// saveSnapshot from startPenPolyline since nothing was actually drawn) — called on Enter (stays in
// pen mode, see the keydown handler above), Escape (historyAutosave.ts's global handler — pen mode
// itself is exited separately, by the pre-existing Escape-tap-switches-to-normal-mode logic in
// sourceButtonsCursorMode.ts), double-click (below), and whenever the pen/eraser/layer toolbar
// buttons switch mid-line (above).
export function finishPenPolyline(): void {
  const appState = getAppState();
  if (!appState || !appState.penPolyline) return;
  window.removeEventListener("pointermove", appState.penPolylineMoveHandler as EventListener);
  appState.penPolylineMoveHandler = null;
  if (appState.penPolyline.points.length > 1) {
    const folder = appState.folders[appState.currentFolderId];
    (window.__ensureDrawings?.(folder) as Record<string, unknown>[] | undefined)?.push({
      color: appState.penPolyline.color,
      layer: appState.penPolyline.layer,
      d: window.__penPointsToPath?.(appState.penPolyline.points),
      width: appState.penPolyline.width,
    });
  } else {
    appState.undoStack.pop();
  }
  if (appState.liveSvg) appState.liveSvg.remove();
  appState.liveSvg = null;
  appState.livePath = null;
  appState.penPolyline = null;
  window.__render?.();
}

// ---------- Pen tool: eraser + freehand/point-by-point disambiguation ----------
// A single pointerdown gesture becomes ONE of three things: continuous eraseAt-on-drag (pen
// sub-tool is 'eraser', unchanged from before this rework), a freehand stroke (pen sub-tool,
// pointer moves past PEN_CLICK_THRESHOLD_PX before release), or the next point of a point-by-point
// line (pen sub-tool, released with barely any movement — either starting a brand new polyline,
// or, if one is already in progress, just extending it — see addPenPolylinePoint above). Freehand
// vs. click is decided lazily inside the move handler rather than up front, so
// window.__saveSnapshot() only ever fires once we know which real action is actually happening.
export function handlePenPointerDown(e: PointerEvent): void {
  const appState = getAppState()!;
  const canvas = window.__getCanvasEl?.();
  const rect = canvas!.getBoundingClientRect();

  if (appState.drawTool === "eraser") {
    window.__saveSnapshot?.();
    const dwList = window.__ensureDrawings?.(appState.folders[appState.currentFolderId]) as
      { d: string; width?: number }[] | undefined;
    const eraseRadius = Math.max(appState.drawSize, 8) / 2;
    const eraseAt = (wx: number, wy: number) => {
      if (!dwList) return;
      for (let i = dwList.length - 1; i >= 0; i--) {
        if (
          window.__pathNearPoint?.(dwList[i].d, wx, wy, eraseRadius + (dwList[i].width || 3) / 2)
        ) {
          dwList.splice(i, 1);
          window.__render?.();
        }
      }
    };
    const [wx0, wy0] = toWorldPoint(e, rect);
    eraseAt(wx0, wy0);
    const move = (me: PointerEvent) => {
      const [wx, wy] = toWorldPoint(me, rect);
      eraseAt(wx, wy);
    };
    const up = () => {
      window.removeEventListener("pointermove", move as EventListener);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move as EventListener);
    window.addEventListener("pointerup", up);
    return;
  }

  const [wx0, wy0] = toWorldPoint(e, rect);

  // Already mid-polyline: every subsequent placement extends it — no freehand branch is reachable
  // until this one finishes. Unlike the very first point (never curvable — see
  // startPenPolyline/the module comment above), THIS placement's own drag distance now matters
  // again, Illustrator-pen-tool style: release within PEN_CLICK_THRESHOLD_PX of the down position
  // and it's a plain corner point (identical to before this existed), drag past it and the release
  // position becomes this point's handleOut, curving the segment back to the previous point — with
  // a live curve preview during the drag itself, same threshold/live-preview pattern as the
  // freehand-vs-click disambiguation just below.
  if (appState.penPolyline) {
    const downX2 = e.clientX,
      downY2 = e.clientY;
    let dragging2 = false;
    const move2 = (me: PointerEvent) => {
      if (!dragging2) {
        if (Math.hypot(me.clientX - downX2, me.clientY - downY2) < PEN_CLICK_THRESHOLD_PX) return;
        dragging2 = true;
      }
      const [mx, my] = toWorldPoint(me, rect);
      appState.livePath!.setAttribute(
        "d",
        window.__penPointsToPath?.(
          appState.penPolyline!.points.concat([{ x: wx0, y: wy0, handleOut: [mx, my] }]),
        ) || "",
      );
    };
    const up2 = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", move2 as EventListener);
      window.removeEventListener("pointerup", up2 as EventListener);
      if (!dragging2) {
        addPenPolylinePoint(wx0, wy0, null);
        return;
      }
      const [ux, uy] = toWorldPoint(ue, rect);
      addPenPolylinePoint(wx0, wy0, [ux, uy]);
    };
    window.addEventListener("pointermove", move2 as EventListener);
    window.addEventListener("pointerup", up2 as EventListener);
    return;
  }

  const downX = e.clientX,
    downY = e.clientY;
  let dragStarted = false;
  const move = (me: PointerEvent) => {
    if (!dragStarted) {
      if (Math.hypot(me.clientX - downX, me.clientY - downY) < PEN_CLICK_THRESHOLD_PX) return;
      dragStarted = true;
      window.__saveSnapshot?.();
      appState.drawing = {
        points: [[wx0, wy0]],
        color: appState.drawColor,
        layer: appState.drawLayer,
        width: appState.drawSize,
      };
      const { svg, path } = makeLivePath(appState.drawColor, appState.drawSize, appState.drawLayer);
      appState.liveSvg = svg;
      appState.livePath = path;
    }
    const [wx, wy] = toWorldPoint(me, rect);
    appState.drawing!.points.push([wx, wy]);
    appState.livePath!.setAttribute("d", window.__pointsToPath?.(appState.drawing!.points) || "");
  };
  const up = () => {
    window.removeEventListener("pointermove", move as EventListener);
    window.removeEventListener("pointerup", up);
    if (dragStarted) {
      if (appState.drawing!.points.length > 1) {
        const folder = appState.folders[appState.currentFolderId];
        (window.__ensureDrawings?.(folder) as Record<string, unknown>[] | undefined)?.push({
          color: appState.drawing!.color,
          layer: appState.drawing!.layer,
          d: window.__pointsToPath?.(appState.drawing!.points),
          width: appState.drawing!.width,
        });
      } else {
        appState.undoStack.pop();
      }
      if (appState.liveSvg) appState.liveSvg.remove();
      appState.liveSvg = null;
      appState.livePath = null;
      appState.drawing = null;
      window.__render?.();
    } else {
      // A genuine click, no drag — the first point of a new point-by-point line.
      startPenPolyline(wx0, wy0);
    }
  };
  window.addEventListener("pointermove", move as EventListener);
  window.addEventListener("pointerup", up);
}
// Canvas-level (not item-level) interaction listeners — pen-polyline finish, box-select/pan/
// add-placement pointerdown, wheel pan/zoom — wrapped in a reusable setup function (split-screen
// Stage 4: see registerPaneCanvasListenerSetup, core-state.js) so every pane's own canvas element
// gets them, not just pane 0's. switchActivePane(paneId) is each handler's own first line rather
// than trusting appState.activePaneId ambiently — none of these are pointerdown-gated the way
// item-level gestures are (wheel especially: it never goes through the capture-phase pointerdown
// router at all), so a user interacting with an inactive pane needs this call to correctly
// redirect appState.tx/etc to THIS pane before anything else here reads or writes them. canvasEl
// (not the ambient canvas getter) is used for geometry/identity checks specific to this pane
// (e.target/getBoundingClientRect/classList) — after switchActivePane runs, the ambient canvas and
// canvasEl refer to the same element anyway, but using canvasEl directly avoids depending on that
// being true yet.
function setupCanvasLevelInteractionListeners(canvasEl: HTMLElement, paneId: number): void {
  // Second click of the double-click already added its own point via the pointerdown handler above
  // (landing at, or very near, the finish location) — accepted as the tradeoff most
  // polyline-editor UIs make rather than special-casing it away.
  canvasEl.addEventListener("dblclick", () => {
    window.__switchActivePane?.(paneId);
    const appState = getAppState();
    if (appState?.penPolyline) finishPenPolyline();
  });
  canvasEl.addEventListener("pointerdown", (e) => {
    if (e.target !== canvasEl) return;
    window.__switchActivePane?.(paneId);
    const appState = getAppState();
    if (!appState) return;
    if (
      appState.folders[appState.currentFolderId] &&
      appState.folders[appState.currentFolderId].isSource
    )
      return;

    // Clicking blank canvas cancels a click-to-link gesture in progress (see
    // handleDataModeClick) rather than leaving it armed indefinitely.
    if (appState.dataLinkPendingId != null) clearDataLinkPending();

    if (window.__effectiveMode?.() === "pen") {
      handlePenPointerDown(e);
      return;
    }

    if (appState.addingKind) {
      const rect = canvasEl.getBoundingClientRect();
      const { w, h } = window.__kindSize?.(appState.addingKind) || { w: 0, h: 0 };
      const x =
        Math.round(((e.clientX - rect.left - appState.tx) / appState.scale - w / 2) / 28) * 28;
      const y =
        Math.round(((e.clientY - rect.top - appState.ty) / appState.scale - h / 2) / 28) * 28;
      add(appState.addingKind, x, y, appState.addingStatKind);
      appState.addingKind = null;
      appState.addingStatKind = null;
      canvasEl.classList.remove("crosshair");
      window.removePlacementGhost?.();
      return;
    }
    if (appState.currentEditingEl) {
      appState.currentEditingEl.classList.remove("editing");
      (appState.currentEditingEl.querySelector(".body") as HTMLElement | null)!.contentEditable =
        "false";
      appState.currentEditingEl = null;
      window.__broadcastEditingState?.(false);
    }

    // Multi-selection: Shift+drag (or Select mode) on empty canvas draws a selection window instead of panning
    if (e.shiftKey || window.__effectiveMode?.() === "select") {
      window.__startBoxSelection?.(e);
      return;
    }
    appState.selectedCardIds = [];
    window.__renderSelectedOutlines?.();

    const startX = e.clientX - appState.tx,
      startY = e.clientY - appState.ty;
    document.body.classList.add("dragging");
    const move = (me: PointerEvent) => {
      appState.tx = me.clientX - startX;
      appState.ty = me.clientY - startY;
      window.__applyTransform?.();
    };
    const up = () => {
      document.body.classList.remove("dragging");
      window.removeEventListener("pointermove", move as EventListener);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move as EventListener);
    window.addEventListener("pointerup", up);
  });

  canvasEl.addEventListener(
    "wheel",
    (e) => {
      window.__switchActivePane?.(paneId);
      const appState = getAppState();
      if (!appState) return;
      if (
        appState.folders[appState.currentFolderId] &&
        appState.folders[appState.currentFolderId].isSource
      )
        return;
      const target = e.target as HTMLElement;
      const bodyEl = target.closest && (target.closest(".item.note .body") as HTMLElement | null);
      if (bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight) return;
      // EPUB cards render as one continuous scroll (epub.js's 'scrolled-doc' flow,
      // buildEpubViewer, mediaPdfEpub.ts) — per explicit request, scrolling over one should scroll
      // the book itself, not pan the canvas underneath it. Unlike the note-body check just above,
      // this doesn't verify actual overflow first: epub.js renders each chapter inside its own
      // same-origin iframe (see buildEpubViewer's own comment on why — CSS isolation), so the
      // element that actually scrolls is somewhere inside that iframe's own document, not reliably
      // measurable as a plain scrollHeight/clientHeight check on .epub-viewer-container from here.
      // A book is essentially always going to have more content than fits in a small canvas card
      // anyway, so unconditionally deferring to the book's own native scroll — worst case, a wheel
      // over a book so short it needed no scrolling now just does nothing, instead of the previous
      // behavior of unexpectedly panning the whole canvas — is an acceptable simplification over
      // fragile cross-frame overflow probing.
      if (target.closest && target.closest(".epub-viewer")) return;
      e.preventDefault();
      if (e.ctrlKey) {
        const factor = Math.pow(1.1, -e.deltaY / 60);
        const mouseX = e.clientX - appState.tx,
          mouseY = e.clientY - appState.ty;
        const newScale = Math.min(
          Math.max(appState.scale * factor, appState.ZOOM_MIN),
          appState.ZOOM_MAX,
        );
        appState.tx = e.clientX - mouseX * (newScale / appState.scale);
        appState.ty = e.clientY - mouseY * (newScale / appState.scale);
        appState.scale = newScale;
      } else {
        appState.tx -= e.deltaX;
        appState.ty -= e.deltaY;
      }
      window.__scheduleApplyTransform?.();
    },
    { passive: false },
  );
}

function setZoomFromClientY(clientY: number): void {
  const appState = getAppState()!;
  const zoomTrack = window.__getZoomTrackEl?.();
  const rect = zoomTrack!.getBoundingClientRect();
  let pct = 1 - (clientY - rect.top) / rect.height;
  pct = Math.max(0, Math.min(1, pct));
  const newScale = appState.ZOOM_MIN + pct * (appState.ZOOM_MAX - appState.ZOOM_MIN);
  const cx = window.__canvasViewportCenterX?.() ?? 0,
    cy = window.innerHeight / 2;
  const worldX = (cx - appState.tx) / appState.scale,
    worldY = (cy - appState.ty) / appState.scale;
  appState.tx = cx - worldX * newScale;
  appState.ty = cy - worldY * newScale;
  appState.scale = newScale;
  window.__applyTransform?.();
}
// The world-space point currently at the center of the screen — same inverse-of-applyTransform
// math the zoom dblclick handler below already used inline (now shared, since the 'place' command,
// command-verbs.js, needs the identical "where's the middle of the viewport right now"
// computation to know where to drop a reference card).
export function viewportCenterWorldPoint(): { x: number; y: number } {
  const appState = getAppState()!;
  const cx = window.__canvasViewportCenterX?.() ?? 0,
    cy = window.innerHeight / 2;
  return { x: (cx - appState.tx) / appState.scale, y: (cy - appState.ty) / appState.scale };
}

export function add(kind: string, x = 100, y = 100, statKind: string | null = null): void {
  const appState = getAppState();
  if (!appState) return;
  window.__saveSnapshot?.();
  const { w, h } = window.__kindSize?.(kind) || { w: 0, h: 0 };
  const base: Item = { id: appState.idCounter++, x, y, w, h, kind };
  if (kind === "title") {
    base.html = "";
    base.level = 1;
  } else if (kind === "folder") {
    const fid = "folder-" + appState.idCounter++;
    // globalId: see global-ids.js — assigned at creation, same as every other id here (fully
    // local/synchronous), registered with the server lazily on the next autosave.
    appState.folders[fid] = {
      id: fid,
      title: "New Canvas",
      items: [],
      drawings: [],
      collaborators: [],
      globalId: window.__generateGlobalId?.(),
    };
    base.folderId = fid;
  } else if (kind === "source") {
    const fid = "folder-" + appState.idCounter++;
    appState.folders[fid] = {
      id: fid,
      title: "New Source",
      isSource: true,
      items: [
        // Header cells start blank — "Column 1"/"Column 2" show only as placeholder text (see
        // renderStaticTableHTML) until the user actually names them.
        {
          id: appState.idCounter++,
          x: 28,
          y: 28,
          w: 560,
          h: 360,
          kind: "table",
          tableData: [
            ["", ""],
            ["", ""],
            ["", ""],
            ["", ""],
          ],
        },
      ],
      drawings: [],
      collaborators: [],
      globalId: window.__generateGlobalId?.(),
    };
    base.folderId = fid;
  } else if (kind === "table") {
    base.tableData = [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ];
    base.w = null;
    base.h = null;
  } else if (kind === "media") {
    base.mediaType = null;
    base.mediaSrc = null;
    base.mediaName = null;
  } else if (kind === "checklist") {
    base.tasks = []; // no longer creatable, kept for existing cards — see kindLabel
  } else if (kind === "embed") {
    base.embedUrl = "";
  } else if (kind === "watermark") {
    base.html = "";
  } else if (kind === "flashcard") {
    base.cards = window.__defaultFlashcardDeck?.();
    base.fcMode = "shuffle";
    base.fcOrder = [];
    base.fcIndex = 0;
    base.fcFlipped = false;
    base.fcStats = {};
    base.fcSeenCount = 0;
  } else if (kind === "typeright") {
    base.cards = [];
    base.trMode = "shuffle";
    base.trOrder = [];
    base.trIndex = 0;
    base.trInput = "";
    base.trChecked = false;
    base.trStats = {};
    base.trSeenCount = 0;
  } else if (kind === "statcard") {
    base.statKind = statKind || "progress";
    base.streamCache = {};
  } else if (kind === "stopwatch") {
    base.swRunning = false;
    base.swPaused = false;
    base.swElapsedMs = 0;
    base.swLastResumeAt = null;
    base.swSessionActive = false;
    base.swSessionId = null;
    base.swSessionStartedAt = null;
    base.swSessionLive = {};
    base.swSessionBaseline = {};
    base.swSessions = [];
  } else if (kind === "shelf") {
    base.shelfSessions = [];
    base.shelfSelectedId = null;
  } else if (kind === "filter") {
    base.filterTagIds = [];
    base.filterMode = "or";
    base.incomingRows = [];
  } else if (kind === "waypoint") {
    base.creatorId = appState.currentUser.id;
  } else {
    base.html = kind === "note" ? "" : `<strong>${window.__kindLabel?.(kind)}</strong>`;
  }
  appState.folders[appState.currentFolderId].items.push(base);
  window.__render?.();
  window.__awardUserPoints?.("add_canvas_block", 5);
  window.__bumpAchievementStat?.("first_block");
  if (kind === "waypoint") window.__syncWaypointToDb?.(appState.currentFolderId, base);
}

// "New Source" button in the Sources rail panel (window.__createNewSource, SourcesListPanel.jsx —
// per explicit request that it "adds it to both the list and your canvas in current viewport").
// Same underlying add('source', x, y) the Add-menu's own "New Source" row (newSourceClicked ->
// prepareAdd('source')) eventually calls too, just supplying viewport-centre coordinates itself,
// grid-snapped the same way the click-to-place flow's own math does (the canvas pointerdown
// handler above), rather than arming a placement ghost and waiting for the user's next canvas
// click. render() (inside add()) already refreshes everything reading off
// appState.folders[appState.currentFolderId].items, including the new source's own linking item —
// the panel's own list just needs its own render hook wired to pick that up too, see
// panelsHamburger.ts/hamburger-collab.js.
export function createNewSource(): void {
  const { w, h } = window.__kindSize?.("source") || { w: 0, h: 0 };
  const center = viewportCenterWorldPoint();
  const x = Math.round((center.x - w / 2) / 28) * 28;
  const y = Math.round((center.y - h / 2) / 28) * 28;
  add("source", x, y);
}
// Deep-clones a LIVE canvas item for a true, independent duplicate (Alt-drag). Critically, for a
// 'folder'/'source' item this also clones the folder it points to into a brand-new folders[]
// entry (recursively, for any folders/sources nested inside it), so the copy gets its own separate
// data. A bare JSON.parse(JSON.stringify(it)) deep-copies the item's own fields (x/y/w/h/etc) but
// NOT the folder it merely points to by id — without this, the duplicate's folderId is the exact
// same string as the original's, so both cards resolve to the identical folders[folderId] object
// and editing rows/notes/drawings in either one changes both. (Unrelated to snapshotItem() in
// canvasPresence.ts, which builds a self-contained copy for sharing OUTSIDE this account — this
// one stays local and reuses a fresh folder id instead.)
export function deepCloneItem(it: Item): Item {
  const appState = getAppState()!;
  const clone: Item = JSON.parse(JSON.stringify(it));
  clone.id = appState.idCounter++;
  if (
    (clone.kind === "folder" || clone.kind === "source") &&
    clone.folderId &&
    appState.folders[clone.folderId]
  ) {
    const srcFolder = appState.folders[clone.folderId];
    const newFid = "folder-" + appState.idCounter++;
    const newFolder: FolderObj = JSON.parse(JSON.stringify(srcFolder));
    newFolder.id = newFid;
    newFolder.collaborators = []; // a duplicate starts with no collaborators of its own
    newFolder.globalId = window.__generateGlobalId?.(); // a duplicate is independent content, not the same shareable item
    delete newFolder.isSharedView;
    delete newFolder.sharedOwnerId;
    delete newFolder.sharedRemoteFolderId;
    newFolder.items = srcFolder.items.map(deepCloneItem); // recursive — nested folders/sources get their own fresh folder ids too
    appState.folders[newFid] = newFolder;
    clone.folderId = newFid;
  }
  return clone;
}

// Undoes deepCloneItem's folders[] side effect for a duplicate that's being discarded before it
// ever really landed (Alt-drag released without moving, or the drop target vanished) —
// recursively, since a cloned folder/source can itself contain freshly-cloned nested
// folders/sources, each with their own new folders[] entry. Without this, canceling a speculative
// duplicate would still leave its brand-new (now unreferenced-by-any-item) folder data behind
// forever, quietly bloating every future workspace save.
export function deleteClonedItemFolders(item: Item | undefined): void {
  const appState = getAppState();
  if (!appState || !item || (item.kind !== "folder" && item.kind !== "source") || !item.folderId)
    return;
  const folderObj = appState.folders[item.folderId];
  if (!folderObj) return;
  (folderObj.items || []).forEach(deleteClonedItemFolders);
  delete appState.folders[item.folderId];
}

// Relocated here from core-state.js's appState object literal (same as the vanilla original) — it
// needs functions this file already owns, and core-state.js must never import anything (see its
// own comment on why: any import there re-creates the exact circular-evaluation hazard this whole
// pass exists to eliminate, this time for appState itself). Assigned inside doWire() (below), not
// at module top level — it mutates the live appState object, which doesn't exist yet at
// module-evaluation time.
function buildCardStreamIO(): Record<string, CardStreamIOConfig> {
  return {
    table: {
      inputs: ["srsUpdate"],
      outputs: ["content", "performance"],
      onStream: applySrsUpdateStream,
      getOutput(item, ctx) {
        const extracted = extractCardsFromSource(item);
        const out: StreamPayload[] = [];
        if (extracted && extracted.rows.length)
          out.push(
            makeStreamPayload(item.id, "content", {
              rows: extracted.rows,
              headers: extracted.headers,
            }),
          );
        const perf = aggregateDownstreamPerformance(item, ctx);
        if (perf) out.push(perf);
        return out.length ? out : null;
      },
    },
    // Distinct from table/folder below (not a shared object) because it also emits a 'sourceRows'
    // output — its OWN rows only, deliberately a SEPARATE streamType from 'content' — for a
    // connected Stack card (kind:'shelf', see CardStreamIO.shelf below) to aggregate across
    // several sources at once. A source no longer ACCEPTS 'sourceRows' as an input (that's what
    // used to let two sources merge directly into each other — removed; aggregating multiple
    // sources now only ever happens via a Stack in between), so source-to-source connections are
    // rejected by isValidConnection's ordinary type-matching rule with no special-casing needed.
    source: {
      inputs: ["srsUpdate"],
      outputs: ["content", "performance", "sourceRows"],
      onStream: applySrsUpdateStream,
      getOutput(item, ctx) {
        const extracted = extractCardsFromSource(item);
        const ownRows = extracted ? extracted.rows : [];
        const out: StreamPayload[] = [];
        if (ownRows.length) {
          out.push(
            makeStreamPayload(item.id, "content", { rows: ownRows, headers: extracted!.headers }),
          );
          out.push(makeStreamPayload(item.id, "sourceRows", { rows: ownRows }));
        }
        const perf = aggregateDownstreamPerformance(item, ctx);
        if (perf) out.push(perf);
        return out.length ? out : null;
      },
    },
    folder: {
      inputs: ["srsUpdate"],
      outputs: ["content", "performance"],
      onStream: applySrsUpdateStream,
      getOutput(item, ctx) {
        const extracted = extractCardsFromSource(item);
        const out: StreamPayload[] = [];
        if (extracted && extracted.rows.length)
          out.push(
            makeStreamPayload(item.id, "content", {
              rows: extracted.rows,
              headers: extracted.headers,
            }),
          );
        const perf = aggregateDownstreamPerformance(item, ctx);
        if (perf) out.push(perf);
        return out.length ? out : null;
      },
    },
    // A pass-through content filter: connect a source into it, then it into a flashcard (or
    // another filter, or another source), and only rows matching the selected tags flow onward —
    // never touches the upstream table directly, so the same source can feed several
    // differently-filtered subdecks at once. incomingRows accumulates inbound 'content' rows,
    // reset once per render (see propagateCanvasStreams) rather than consumed/cleared inside
    // getOutput — getOutput can be called once per downstream connection in the same render, and
    // clearing it there would starve every call after the first.
    filter: {
      inputs: ["content"],
      outputs: ["content"],
      onStream(item, payload) {
        if (
          payload.streamType !== "content" ||
          !payload.delta ||
          !Array.isArray(payload.delta.rows)
        )
          return;
        item.incomingRows = ((item.incomingRows as Record<string, unknown>[]) || []).concat(
          payload.delta.rows as Record<string, unknown>[],
        );
        // Passed straight through to whatever this filter feeds (see getOutput below) so a game
        // card downstream of a filter still sees real column names, not just "Column N".
        if (payload.delta.headers) item.incomingHeaders = payload.delta.headers;
      },
      getOutput(item) {
        const filtered = applyFilterToRows(
          item,
          (item.incomingRows as Record<string, unknown>[]) || [],
        );
        return filtered.length
          ? makeStreamPayload(item.id, "content", { rows: filtered, headers: item.incomingHeaders })
          : null;
      },
    },
    flashcard: {
      inputs: ["content"],
      outputs: ["performance", "srsUpdate"],
      onStream(item, payload) {
        if (payload.streamType !== "content") return;
        const rows = payload.delta.rows as Record<string, unknown>[] | undefined;
        if (rows && rows.length) {
          // Only reset shuffle order / position when the underlying deck actually changed shape
          // (rows added/removed/edited) — NOT when only the SM-2 srs fields changed (e.g. because
          // we just streamed our own grading update back up to the source and it echoed back
          // down), which would otherwise yank the user back to card #1 every single time they
          // rate a card.
          const prevKey = ((item.cards as Record<string, unknown>[]) || [])
            .map((c) => c.rowIndex + "|" + c.front + "|" + c.back)
            .join("~");
          const newKey = rows.map((c) => c.rowIndex + "|" + c.front + "|" + c.back).join("~");
          const structuralChange = prevKey !== newKey;
          item.cards = rows;
          if (structuralChange) {
            item.fcOrder = [];
            item.fcIndex = 0;
            item.fcFlipped = false;
          }
        }
        // Real column names for the right-click options panel (see renderGameOptionsHTML) — falls
        // back to "Column N" labels there when this is empty (e.g. no source linked yet, or a
        // chain that doesn't preserve header names).
        if (payload.delta.headers) item.gameHeaders = payload.delta.headers;
      },
      getOutput(item) {
        const out: StreamPayload[] = [
          makeStreamPayload(item.id, "performance", {
            seen: item.fcSeenCount || 0,
            totalCards: ((item.cards as unknown[]) || []).length,
            ratings: Object.assign(
              { noclue: 0, wrong: 0, hard: 0, easy: 0 },
              item.fcStats as object,
            ),
          }),
        ];
        // Re-broadcasts the most recently graded card's new SM-2 state so the source table (the
        // system of record) stays in sync on every propagation pass.
        if (item.pendingSrsUpdate)
          out.push(
            makeStreamPayload(
              item.id,
              "srsUpdate",
              item.pendingSrsUpdate as Record<string, unknown>,
            ),
          );
        return out;
      },
    },
    // Typeright: see one side, type the other — same streaming shape as flashcard (content in,
    // performance/srsUpdate out), just its own tr*-prefixed play state (trIndex/trOrder/trInput/
    // trStats) instead of fc*, since it's a distinct gameplay loop (typed-answer grading, not
    // flip+rate).
    typeright: {
      inputs: ["content"],
      outputs: ["performance", "srsUpdate"],
      onStream(item, payload) {
        if (payload.streamType !== "content") return;
        const rows = payload.delta.rows as Record<string, unknown>[] | undefined;
        if (rows && rows.length) {
          const prevKey = ((item.cards as Record<string, unknown>[]) || [])
            .map((c) => c.rowIndex + "|" + c.front + "|" + c.back)
            .join("~");
          const newKey = rows.map((c) => c.rowIndex + "|" + c.front + "|" + c.back).join("~");
          const structuralChange = prevKey !== newKey;
          item.cards = rows;
          if (structuralChange) {
            item.trOrder = [];
            item.trIndex = 0;
            item.trInput = "";
            item.trChecked = false;
          }
        }
        if (payload.delta.headers) item.gameHeaders = payload.delta.headers;
      },
      getOutput(item) {
        const out: StreamPayload[] = [
          makeStreamPayload(item.id, "performance", {
            seen: item.trSeenCount || 0,
            totalCards: ((item.cards as unknown[]) || []).length,
            ratings: Object.assign(
              { noclue: 0, wrong: 0, hard: 0, easy: 0 },
              item.trStats as object,
            ),
          }),
        ];
        if (item.pendingSrsUpdate)
          out.push(
            makeStreamPayload(
              item.id,
              "srsUpdate",
              item.pendingSrsUpdate as Record<string, unknown>,
            ),
          );
        return out;
      },
    },
    statcard: {
      inputs: ["performance"],
      onStream(item, payload) {
        item.streamCache = item.streamCache || {};
        const cache = item.streamCache as Record<string, StreamPayload>;
        const existing = cache[payload.originId];
        // A stopwatch re-broadcasts several sessions for the same origin at once (so a connected
        // shelf can catch all of them); a plain stats card should only ever keep the most recent
        // one. This is decided purely from the payload shape (`delta.sessionStartedAt`), never
        // from what kind sent it — if either payload isn't session-scoped (no sessionStartedAt),
        // there's no ambiguity and the newest write simply wins, same as before.
        if (existing) {
          const incomingStart =
            payload.delta && (payload.delta.sessionStartedAt as number | undefined);
          const existingStart =
            existing.delta && (existing.delta.sessionStartedAt as number | undefined);
          if (incomingStart != null && existingStart != null && incomingStart < existingStart)
            return;
        }
        cache[payload.originId] = payload;
      },
    },
    stopwatch: {
      inputs: ["performance"],
      outputs: ["performance"],
      onStream(item, payload) {
        if (payload.streamType !== "performance" || !item.swSessionActive) return;
        const live = (item.swSessionLive as Record<string, unknown>) || {};
        const baseline = (item.swSessionBaseline as Record<string, unknown>) || {};
        live[payload.originId] = payload.delta;
        if (!baseline[payload.originId]) baseline[payload.originId] = payload.delta;
        item.swSessionLive = live;
        item.swSessionBaseline = baseline;
      },
      getOutput(item) {
        const payloads: StreamPayload[] = [];
        if (item.swSessionActive) {
          const live = (item.swSessionLive as Record<string, Record<string, unknown>>) || {};
          const baseline =
            (item.swSessionBaseline as Record<string, Record<string, unknown>>) || {};
          Object.keys(live).forEach((originId) => {
            const l = live[originId] || {};
            const b = baseline[originId] || {};
            payloads.push(
              makeStreamPayload(originId, "performance", {
                seen: ((l.seen as number) || 0) - ((b.seen as number) || 0),
                totalCards: l.totalCards,
                ratings: window.__diffRatings?.(
                  l.ratings as Record<string, number>,
                  b.ratings as Record<string, number>,
                ),
                sessionId: item.swSessionId,
                sessionStartedAt: item.swSessionStartedAt,
                final: false,
              }),
            );
          });
        } else if (item.swSessions && (item.swSessions as unknown[]).length) {
          // Re-broadcast every session still held in the 3-slot buffer (not just the latest) so a
          // shelf connected at any point can catch ones it missed. A plain stats card linked
          // straight to the stopwatch sees all of these too, but its own onStream keeps only the
          // one with the newest sessionStartedAt.
          (
            item.swSessions as {
              sessionId: string;
              startedAt: number;
              payloads: { originId: string; delta: Record<string, unknown> }[];
            }[]
          ).forEach((session) => {
            session.payloads.forEach((p) => {
              payloads.push(
                makeStreamPayload(
                  p.originId,
                  "performance",
                  Object.assign({}, p.delta, {
                    sessionId: session.sessionId,
                    sessionStartedAt: session.startedAt,
                    final: true,
                  }),
                ),
              );
            });
          });
        }
        return payloads;
      },
    },
    // "Stack" in the UI (kind stays 'shelf' internally — see the naming note near its add-menu
    // entry). Dual-purpose: the original job (archiving stopwatch session performance data, below)
    // is untouched; it ALSO now accepts 'sourceRows' from any number of directly-connected source
    // cards and re-emits their combined rows as one 'content' stream, so a flashcard (or filter,
    // or anything else that accepts 'content') plugged into a Stack plays every connected source's
    // rows at once — the same aggregation source-to-source merging used to do, just via an
    // explicit hub card instead of two sources linking directly to each other. stackSourceRows is
    // reset once per render (see propagateCanvasStreams), same pattern as source.mergeCache used
    // to be.
    shelf: {
      inputs: ["performance", "sourceRows"],
      outputs: ["performance", "content"],
      onStream(item, payload) {
        if (payload.streamType === "sourceRows") {
          item.stackSourceRows = item.stackSourceRows || {};
          (item.stackSourceRows as Record<string, unknown>)[payload.originId] =
            payload.delta.rows || [];
          return;
        }
        if (
          payload.streamType !== "performance" ||
          !payload.delta ||
          !payload.delta.final ||
          !payload.delta.sessionId
        )
          return;
        item.shelfSessions = item.shelfSessions || [];
        const sessions = item.shelfSessions as {
          sessionId: unknown;
          savedAt: number;
          payloads: { originId: unknown; delta: Record<string, unknown> }[];
          label: string;
        }[];
        const sid = payload.delta.sessionId;
        let session = sessions.find((s) => s.sessionId === sid);
        if (!session) {
          session = {
            sessionId: sid,
            savedAt: Date.now(),
            payloads: [],
            label: "Session " + (sessions.length + 1),
          };
          sessions.push(session);
          item.shelfSelectedId = session.sessionId;
        }
        const cleanDelta = Object.assign({}, payload.delta);
        delete cleanDelta.final;
        delete cleanDelta.sessionId;
        const existing = session.payloads.find((p) => p.originId === payload.originId);
        if (existing) existing.delta = cleanDelta;
        else session.payloads.push({ originId: payload.originId, delta: cleanDelta });
      },
      getOutput(item) {
        const out: StreamPayload[] = [];
        const sessions =
          (item.shelfSessions as {
            sessionId: unknown;
            payloads: { originId: unknown; delta: Record<string, unknown> }[];
          }[]) || [];
        const session = sessions.find((s) => s.sessionId === item.shelfSelectedId);
        if (session)
          session.payloads.forEach((p) =>
            out.push(makeStreamPayload(p.originId as string, "performance", p.delta)),
          );
        const combinedRows = ([] as unknown[]).concat(
          ...Object.values((item.stackSourceRows as Record<string, unknown[]>) || {}),
        );
        if (combinedRows.length)
          out.push(makeStreamPayload(item.id, "content", { rows: combinedRows }));
        return out.length ? out : null;
      },
    },
  };
}

function doWire(): void {
  const appState = getAppState()!;
  appState.CardStreamIO = buildCardStreamIO();

  document.addEventListener("keydown", handleGlobalKeydown);

  const drawColorInput = window.__getDrawColorInputEl?.() as HTMLInputElement;
  const drawSizeInput = window.__getDrawSizeInputEl?.() as HTMLInputElement;
  const drawPenBtn = window.__getDrawPenBtnEl?.();
  const drawEraserBtn = window.__getDrawEraserBtnEl?.();
  const drawFrontBtn = window.__getDrawFrontBtnEl?.();
  const drawBackBtn = window.__getDrawBackBtnEl?.();
  drawColorInput.oninput = (e) => {
    getAppState()!.drawColor = (e.target as HTMLInputElement).value;
  };
  drawSizeInput.oninput = (e) => {
    getAppState()!.drawSize = parseInt((e.target as HTMLInputElement).value);
  };
  // Switching pen<->eraser (or the layer buttons below) mid-polyline finishes whatever line is in
  // progress first, rather than leaving it in an ambiguous half-old-half-new-tool state.
  drawPenBtn!.onclick = (e) => {
    e.stopPropagation();
    finishPenPolyline();
    getAppState()!.drawTool = "pen";
    updateDrawToolBtns();
  };
  drawEraserBtn!.onclick = (e) => {
    e.stopPropagation();
    finishPenPolyline();
    getAppState()!.drawTool = "eraser";
    updateDrawToolBtns();
  };
  drawFrontBtn!.onclick = (e) => {
    e.stopPropagation();
    finishPenPolyline();
    getAppState()!.drawLayer = "front";
    updateDrawLayerBtns();
  };
  drawBackBtn!.onclick = (e) => {
    e.stopPropagation();
    finishPenPolyline();
    getAppState()!.drawLayer = "back";
    updateDrawLayerBtns();
  };

  const zoomTrack = window.__getZoomTrackEl?.()!;
  zoomTrack.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    zoomTrack.classList.add("dragging");
    setZoomFromClientY(e.clientY);
    const move = (me: PointerEvent) => setZoomFromClientY(me.clientY);
    const up = () => {
      zoomTrack.classList.remove("dragging");
      window.removeEventListener("pointermove", move as EventListener);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move as EventListener);
    window.addEventListener("pointerup", up);
  });
  // Double-clicking the zoom bar jumps straight back to 100%, anchored on the current viewport
  // center (same centering math as dragging the slider itself).
  zoomTrack.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const appState = getAppState()!;
    const newScale = 1;
    const cx = window.__canvasViewportCenterX?.() ?? 0,
      cy = window.innerHeight / 2;
    const { x: worldX, y: worldY } = viewportCenterWorldPoint();
    appState.tx = cx - worldX * newScale;
    appState.ty = cy - worldY * newScale;
    appState.scale = newScale;
    window.__applyTransform?.();
  });

  const canvas = window.__getCanvasEl?.()!;
  setupCanvasLevelInteractionListeners(canvas, 0);
  window.__registerPaneCanvasListenerSetup?.(setupCanvasLevelInteractionListeners);
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (dotto-app.jsx) — this needs live appState AND
// several already-existing DOM elements (canvas, zoom track, draw toolbar) right at wire time,
// same bridge-readiness-poll reasoning as every other Phase 4.4/4.5 wireX() port.
export function wireSrsConnectionsCore(): () => void {
  const isReady = () =>
    !!(
      getAppState() &&
      window.__getCanvasEl?.() &&
      window.__getZoomTrackEl?.() &&
      window.__getDrawPenBtnEl?.()
    );
  if (isReady()) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (isReady()) {
      clearInterval(poll);
      doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

if (typeof window !== "undefined") {
  // React -> vanilla bridge (see the identical pattern/comment in cards-misc.js) — used by
  // FilterCard.jsx (app/dotto/), which can't import these directly since public/dotto/*.js isn't
  // reachable from app/dotto/.
  window.__applyFilterToRows = applyFilterToRows;
  window.__collectAvailableFilterTags = collectAvailableFilterTags;
  // Used by app/dotto/canvasItemBehavior.js's setupDraggingAndClicking (Phase 3's second relocated
  // piece), same reasoning as window.__getAppState (core-state.js).
  window.__deepCloneItem = deepCloneItem;
  window.__deleteClonedItemFolders = deleteClonedItemFolders;
  window.__handlePenPointerDown = handlePenPointerDown;
  // Used by app/dotto/canvasItemBehavior.js's startConnectionDrag (Phase 3's third relocated piece
  // — connection-dragging), same reasoning as window.__getAppState (core-state.js). Both stay
  // reachable this way since isValidConnection/handleDataModeClick have their own vanilla-side
  // callers too (isValidConnection: drawing-connections.js's own linkSelectedCards;
  // handleDataModeClick: the click-to-link fallback startConnectionDrag's own up() handler falls
  // back to).
  window.__isValidConnection = isValidConnection;
  window.__handleDataModeClick = handleDataModeClick;
  // Used by sourceButtonsCursorMode.ts's applyCursorMode (Phase 4.4).
  window.__clearDataLinkPending = clearDataLinkPending;
  // Used by historyAutosave.ts's global Escape keydown handler (Phase 4.5).
  window.__cancelAddingKind = cancelAddingKind;
  window.__finishPenPolyline = finishPenPolyline;
  // Vanilla -> React bridges — waypoints-render-loop.js/drawing-connections.js/window-bridge.js/
  // app-init.js/command-verbs.js/source-tags-ai.js/upload-popup.js all previously imported these
  // directly.
  window.__applyConnections = applyConnections;
  window.__viewportCenterWorldPoint = viewportCenterWorldPoint;
  window.__updateDrawLayerBtns = updateDrawLayerBtns;
  window.__add = add;
  // Dual-exposed like broadcastEditingState/hideCanvasContextMenu before it — real inline onclick
  // target (content/fragments/hamburger-stack.html's "New source" + button,
  // "createNewSource();") AND real programmatic caller (window.__createNewSource,
  // SourcesListPanel.jsx). window-bridge.js's own old re-export of the plain global is removed,
  // same "this file is now the sole source" precedent as every other recent plain-global move.
  window.createNewSource = createNewSource;
  window.__createNewSource = createNewSource;
}
