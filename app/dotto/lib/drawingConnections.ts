import { isValidConnection } from "./srsConnectionsCore";
import { bumpAchievementStat } from "./profileAchievementsPricing";

interface Item {
  id: number;
  kind: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  folderId?: string;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  title?: string;
  isSource?: boolean;
  items: Item[];
  connections?: Connection[];
  drawings?: Record<string, unknown>[];
}
interface Connection {
  id: string;
  fromId: number;
  toId: number;
}
interface AppState {
  idCounter: number;
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  selectedCardIds: number[];
  undoStack: unknown[];
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Drawing mode ----------

function pathToPoints(d: string): [number, number][] {
  const nums = d.match(/-?\d+(\.\d+)?/g);
  if (!nums) return [];
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
  return pts;
}
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
export function pathNearPoint(d: string, px: number, py: number, radius: number): boolean {
  const pts = pathToPoints(d);
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= radius;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= radius)
      return true;
  }
  return false;
}
export function pointsToPath(pts: [number, number][]): string {
  if (!pts.length) return "";
  return (
    "M" +
    pts[0][0] +
    "," +
    pts[0][1] +
    " " +
    pts
      .slice(1)
      .map((p) => "L" + p[0] + "," + p[1])
      .join(" ")
  );
}
// Bezier-aware sibling of pointsToPath above, used only by the pen tool's point-by-point line
// (startPenPolyline/addPenPolylinePoint/finishPenPolyline, app/dotto/lib/srsConnectionsCore.ts) —
// freehand strokes keep using plain pointsToPath, completely untouched. Takes
// {x, y, handleOut} objects rather than [x,y] pairs: handleOut (world coords, or null for a plain
// corner point) is the bezier handle a click-DRAG pulls out when placing that point —
// Illustrator's "smooth anchor point" behavior, per explicit request. Only handleOut is ever
// stored; the same point's handleIn (its tangent on the INCOMING side, when it's a curve's end
// rather than its start) is always just the mirror image of handleOut reflected through the
// anchor itself (2*x-hx, 2*y-hy) — standard symmetric-handle bezier math, computed on the fly
// rather than stored twice. A segment only becomes a C (cubic bezier) command if EITHER endpoint
// actually has a handle; with neither, it emits the exact same M/L output pointsToPath would (so
// a polyline with no curves in it at all is byte-for-byte identical to before this existed).
export function penPointsToPath(
  points: { x: number; y: number; handleOut: [number, number] | null }[],
): string {
  if (!points.length) return "";
  let d = "M" + points[0].x + "," + points[0].y;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1],
      cur = points[i];
    if (!prev.handleOut && !cur.handleOut) {
      d += " L" + cur.x + "," + cur.y;
      continue;
    }
    const c1 = prev.handleOut || [prev.x, prev.y];
    const c2 = cur.handleOut
      ? [2 * cur.x - cur.handleOut[0], 2 * cur.y - cur.handleOut[1]]
      : [cur.x, cur.y];
    d += " C" + c1[0] + "," + c1[1] + " " + c2[0] + "," + c2[1] + " " + cur.x + "," + cur.y;
  }
  return d;
}
export function makeLayerSVG(zIndex: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = `position:absolute;top:0;left:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:${zIndex};`;
  return svg;
}
export function ensureDrawings(folder: FolderObj): Record<string, unknown>[] {
  if (!folder.drawings) folder.drawings = [];
  return folder.drawings;
}

// ---------- Card connections ("Data Conduit" links) ----------
// Generic, scalable across any card type/count: a connection is just {id, fromId, toId}
// stored per-folder. Any card kind can be a link target; today only 'flashcard' consumes
// incoming data, but new consumers can hook into applyConnections() below.
export function ensureConnections(folder: FolderObj): Connection[] {
  if (!folder.connections) folder.connections = [];
  return folder.connections;
}
// Shared by every place a new data-mode link gets created (Shift+X batch-link, click-to-link,
// drag-to-link) so the fifty_links achievement counts all three the same way.
export function createConnection(conns: Connection[], fromId: number, toId: number): Connection {
  const appState = getAppState();
  const conn: Connection = { id: "conn_" + appState.idCounter++, fromId, toId };
  conns.push(conn);
  bumpAchievementStat("fifty_links");
  return conn;
}

// Keyboard shortcut for linking a multi-selection: select several cards (Shift-click, or
// Select mode), then press Shift+X to wire them up without having to drag each connection
// by hand. The first-selected card becomes the source; a connection is drawn from it to
// every other selected card (a no-op for pairs that are already connected).
export function linkSelectedCards(): void {
  const appState = getAppState();
  if (
    !appState.folders[appState.currentFolderId] ||
    appState.folders[appState.currentFolderId].isSource
  )
    return;
  if (appState.selectedCardIds.length < 2) return;
  window.__saveSnapshot!();
  const conns = ensureConnections(appState.folders[appState.currentFolderId]);
  const [sourceId, ...targetIds] = appState.selectedCardIds;
  let madeAny = false;
  targetIds.forEach((targetId) => {
    const exists = conns.some((c) => c.fromId === sourceId && c.toId === targetId);
    if (!exists && isValidConnection(sourceId, targetId)) {
      createConnection(conns, sourceId, targetId);
      madeAny = true;
    }
  });
  if (!madeAny) {
    appState.undoStack.pop();
    return;
  }
  window.__render?.();
}

// ---- Connector geometry: lines must exit exactly at a card's edge and never cut
// through the interior of any card (their own endpoints or an unrelated card sitting
// between them). ----
export function itemRect(item: Item): { x: number; y: number; w: number; h: number } {
  return { x: item.x, y: item.y, w: item.w || 100, h: item.h || 60 };
}
function itemCenter(item: Item): { x: number; y: number } {
  const r = itemRect(item);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Where the ray from a card's center towards `to` crosses that card's own boundary.
function rectEdgePoint(
  box: { x: number; y: number; w: number; h: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  if (!dx && !dy) return { x: from.x, y: from.y };
  let best: { t: number; x: number; y: number } | null = null;
  const consider = (t: number, x: number, y: number) => {
    if (t > 1e-6 && (best === null || t < best.t)) best = { t, x, y };
  };
  if (dx !== 0) {
    let t = (box.x - from.x) / dx,
      y = from.y + t * dy;
    if (y >= box.y - 0.5 && y <= box.y + box.h + 0.5) consider(t, box.x, y);
    t = (box.x + box.w - from.x) / dx;
    y = from.y + t * dy;
    if (y >= box.y - 0.5 && y <= box.y + box.h + 0.5) consider(t, box.x + box.w, y);
  }
  if (dy !== 0) {
    let t = (box.y - from.y) / dy,
      x = from.x + t * dx;
    if (x >= box.x - 0.5 && x <= box.x + box.w + 0.5) consider(t, x, box.y);
    t = (box.y + box.h - from.y) / dy;
    x = from.x + t * dx;
    if (x >= box.x - 0.5 && x <= box.x + box.w + 0.5) consider(t, x, box.y + box.h);
  }
  return best
    ? { x: (best as { x: number }).x, y: (best as { y: number }).y }
    : { x: from.x, y: from.y };
}
// Does the segment (x1,y1)-(x2,y2) pass through the interior of `rect` (shrunk by
// `margin` so lines that merely graze a boundary don't count as a collision)?
function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: { x: number; y: number; w: number; h: number },
  margin: number,
): boolean {
  const xmin = rect.x + margin,
    ymin = rect.y + margin,
    xmax = rect.x + rect.w - margin,
    ymax = rect.y + rect.h - margin;
  if (xmax <= xmin || ymax <= ymin) return false;
  let t0 = 0,
    t1 = 1;
  const dx = x2 - x1,
    dy = y2 - y1;
  const p = [-dx, dx, -dy, dy],
    q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 > t0 + 1e-6;
}
function pathAvoidsObstacles(
  points: { x: number; y: number }[],
  obstacles: { x: number; y: number; w: number; h: number }[],
  margin: number,
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    for (const rect of obstacles) {
      if (segmentHitsRect(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, rect, margin))
        return false;
    }
  }
  return true;
}
// Builds the point list for a connector: exits fromItem's edge, (optionally) enters
// toItem's edge, and bends around any obstacle card whose interior the straight line
// would otherwise cross.
export function computeConnectorPoints(
  fromItem: Item,
  toTarget: Item | { x: number; y: number },
  isToItem: boolean,
  obstacles: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number }[] {
  const fromBox = itemRect(fromItem),
    fromCenter = itemCenter(fromItem);
  const toCenter = isToItem ? itemCenter(toTarget as Item) : (toTarget as { x: number; y: number });
  const p0 = rectEdgePoint(fromBox, fromCenter, toCenter);
  const p1 = isToItem ? rectEdgePoint(itemRect(toTarget as Item), toCenter, fromCenter) : toCenter;
  const margin = 6;
  if (pathAvoidsObstacles([p0, p1], obstacles, margin)) return [p0, p1];
  const elbowA = { x: p0.x, y: p1.y },
    elbowB = { x: p1.x, y: p0.y };
  if (pathAvoidsObstacles([p0, elbowA, p1], obstacles, margin)) return [p0, elbowA, p1];
  if (pathAvoidsObstacles([p0, elbowB, p1], obstacles, margin)) return [p0, elbowB, p1];
  return [p0, p1]; // dense clutter - best effort straight line
}
export function pointsToLinePath(points: { x: number; y: number }[]): string {
  return "M" + points.map((p) => p.x + "," + p.y).join(" L");
}

// What data a source card can feed a connected consumer. Currently reads a table
// (either the card itself, or the table inside a linked folder/source), returning
// rows as {front, back} pairs. Extend this to support more source kinds as needed.
// Resolves the actual 'table' item backing any of {table, source, folder} — the single
// source-of-truth record for a deck's content AND its SM-2 memory state (interval,
// easeFactor, dueDate, repetitions). Downstream cards (flashcard, statcard, shelf) never
// store this data themselves — they only ever read/write it through this table, via the
// streaming connection pipeline below.
export function findLinkedTable(fromItem: Item): Item | null {
  const appState = getAppState();
  if (fromItem.kind === "table") return fromItem;
  if (
    (fromItem.kind === "folder" || fromItem.kind === "source") &&
    fromItem.folderId &&
    appState.folders[fromItem.folderId]
  ) {
    return appState.folders[fromItem.folderId].items.find((i) => i.kind === "table") || null;
  }
  return null;
}
// Global lookup by table item id, regardless of which folder it lives in — unlike
// findItemById (scoped to whichever folder is currently open), this is what lets a
// flashcard's srsUpdate (fed via a source, possibly through a connected Stack card — see
// CardStreamIO.shelf) reach a table that belongs to a DIFFERENT source's own subfolder than
// whatever's currently on screen (see applySrsUpdateStream).
export function findTableById(tableId: number): Item | null {
  const appState = getAppState();
  for (const fid in appState.folders) {
    const f = appState.folders[fid];
    const found = f && f.items && f.items.find((i) => i.kind === "table" && i.id === tableId);
    if (found) return found;
  }
  return null;
}
// item.stackSourceRows (see CardStreamIO.shelf/.source) is keyed by payload.originId, which
// for a 'sourceRows' stream is the SOURCE CARD's own item id (see CardStreamIO.source's
// getOutput: makeStreamPayload(item.id, 'sourceRows', ...)) — NOT its nested table's id. A
// Stack can only ever be fed by a source connected to it on the SAME open canvas (connections
// only exist within one folder's own items+connections — see isValidConnection), so
// findItemById (scoped to currentFolderId) is exactly the right lookup here, no global search
// needed.
function connectedSourceCard(sourceItemId: number): Item | undefined {
  return window.__findItemById?.(sourceItemId) as Item | undefined;
}
// A source card's own display name IS its nested subfolder's title (folders[it.folderId] —
// same property its own card and the breadcrumb read/write) — used by a Stack card (see
// renderShelfHTML) to show which sources it's currently aggregating.
export function folderTitleForConnectedSource(sourceItemId: number): string {
  const appState = getAppState();
  const srcCard = connectedSourceCard(sourceItemId);
  return (
    (srcCard &&
      appState.folders[srcCard.folderId as string] &&
      appState.folders[srcCard.folderId as string].title) ||
    "Source"
  );
}
// Same lookup as folderTitleForConnectedSource, but returns the folder id itself rather than
// its title — used by startRenameShelfSourceRow to find what to actually write a rename back
// to, and by handleShelfSourceRowClick to jump the canvas to the actual card.
export function folderIdForConnectedSource(sourceItemId: number): string | null {
  const srcCard = connectedSourceCard(sourceItemId);
  return srcCard ? (srcCard.folderId as string) : null;
}
// Used by every source-table cell/tag/row editing function so they transparently work
// regardless of which folder the target table actually lives in — findTableById is a strict
// superset of findItemById for this purpose, checked first since it's the one that actually
// needs to reach outside the current folder.
export function resolveTableForEdit(id: number): Item | undefined {
  return findTableById(id) || (window.__findItemById?.(id) as Item | undefined);
}
