import { create } from "zustand";

// Pane layout tree (split-screen Stage 6+) — a real split tree, not a flat list of rects. A flat
// list has no way to express "these two panes are a pair" once a pane has been split TWICE (a
// quartered pane's own sibling might itself be a further-split PAIR, not a single leaf) — a closed
// pane needs to know exactly which OTHER subtree reclaims its space, which only a real tree can
// express correctly.
//
// Shape: { type: 'leaf', paneId } | { type: 'split', direction: 'row'|'column', children: [tree, tree] }.
// 'row' = children sit side by side (a left/right edge drop splits this way); 'column' = children
// stack top/bottom. children[0] is always the visually-first (left/top) child — which edge was
// dropped on decides which side the NEW pane lands on, not some fixed convention. Starts as a
// single leaf (pane 0, full viewport), matching how the app looked before split-screen existed.
//
// Migrated from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's
// Zustand migration plan, batch 10 — the highest-risk store in this whole migration, done last).
// Wider blast radius than every other store in this plan: besides PaneGrid.jsx's real subscription
// (a bare useSyncExternalStore -> now a bare usePaneLayoutStore() call), it's also read
// IMPERATIVELY (no subscription) by TabsBar.jsx and FilesListPanel.jsx (both via
// usePaneLayoutStore.getState(), replacing the old .getSnapshot()) and by
// app/dotto/lib/historyAutosave.ts — but that last one goes through the still-live
// window.__getPaneLayout/__setPaneLayout bridges (app/dotto-app.jsx), not a direct import, so it
// needs no changes here. MUST stay flushSync'd at every producer call site (still true — a caller
// that splits or closes a pane needs that pane's own #canvas-{paneId}/#world-{paneId}/etc DOM to
// actually exist, or stop existing, immediately afterward, not just scheduled for a later batched
// update).
export type PaneTree =
  | { type: "leaf"; paneId: number }
  | { type: "split"; direction: "row" | "column"; children: [PaneTree, PaneTree] };

export const usePaneLayoutStore = create<PaneTree>(() => ({ type: "leaf", paneId: 0 }));

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Walks the tree, dividing `rect` (fractional [0,1] viewport coords, defaulting to the full
// viewport) evenly between each split's two children, and returns a flat [{ paneId, rect }] for
// however many leaves currently exist — this is what PaneGrid.jsx actually renders from; nothing
// downstream of it needs to know the tree shape at all, only the resulting flat rects. No
// adjustable dividers (both children of a split always get exactly half) — a real draggable-
// divider feature would extend this function's own math, not the tree shape.
export function computePaneRects(
  tree: PaneTree,
  rect: PaneRect = { x: 0, y: 0, w: 1, h: 1 },
): { paneId: number; rect: PaneRect }[] {
  if (tree.type === "leaf") return [{ paneId: tree.paneId, rect }];
  const [a, b] = tree.children;
  if (tree.direction === "row") {
    const halfW = rect.w / 2;
    return [
      ...computePaneRects(a, { x: rect.x, y: rect.y, w: halfW, h: rect.h }),
      ...computePaneRects(b, { x: rect.x + halfW, y: rect.y, w: halfW, h: rect.h }),
    ];
  }
  const halfH = rect.h / 2;
  return [
    ...computePaneRects(a, { x: rect.x, y: rect.y, w: rect.w, h: halfH }),
    ...computePaneRects(b, { x: rect.x, y: rect.y + halfH, w: rect.w, h: halfH }),
  ];
}

export interface SplitDivider {
  orientation: "vertical" | "horizontal";
  x: number;
  y: number;
  length: number;
}

// One thin divider line per split node — walks the same tree computePaneRects does, but instead
// of leaf rects, collects the boundary BETWEEN each split's two children. 'row' splits (children
// side by side) get a vertical line at the shared x boundary spanning that subtree's own full
// height; 'column' splits get a horizontal line at the shared y boundary spanning its own full
// width — each in the same fractional [0,1] coordinate space PaneGrid.jsx already renders panes
// in, so the caller just converts to percent the same way it does for a pane's own rect.
export function computeSplitDividers(
  tree: PaneTree,
  rect: PaneRect = { x: 0, y: 0, w: 1, h: 1 },
): SplitDivider[] {
  if (tree.type === "leaf") return [];
  const [a, b] = tree.children;
  if (tree.direction === "row") {
    const halfW = rect.w / 2;
    return [
      { orientation: "vertical", x: rect.x + halfW, y: rect.y, length: rect.h },
      ...computeSplitDividers(a, { x: rect.x, y: rect.y, w: halfW, h: rect.h }),
      ...computeSplitDividers(b, { x: rect.x + halfW, y: rect.y, w: halfW, h: rect.h }),
    ];
  }
  const halfH = rect.h / 2;
  return [
    { orientation: "horizontal", y: rect.y + halfH, x: rect.x, length: rect.w },
    ...computeSplitDividers(a, { x: rect.x, y: rect.y, w: rect.w, h: halfH }),
    ...computeSplitDividers(b, { x: rect.x, y: rect.y + halfH, w: rect.w, h: halfH }),
  ];
}

// Every currently-open paneId, in no particular order — used for the 4-pane cap check
// (app/dotto/lib/splitPaneManagement.ts) and nowhere else, so a plain array beats bothering with
// an object.
export function listPaneIds(tree: PaneTree): number[] {
  return tree.type === "leaf"
    ? [tree.paneId]
    : [...listPaneIds(tree.children[0]), ...listPaneIds(tree.children[1])];
}

// Which of a pane's 4 edges are valid drop targets right now — split-screen must only ever grow
// into a clean 2x2 (quartering one or both halves of an existing row/column split), never 3+ panes
// side by side in the same direction. Walks root-to-leaf collecting each ancestor split's own
// direction; the shape of that path is exactly what decides which edges are still legal for THIS
// leaf:
//  - path length 0 (tree is just this one leaf, nothing split yet): every edge is legal — this is
//    the very first split, which can go either way.
//  - path length 1 (this leaf is one of an existing row/column pair, not itself split again yet):
//    only the PERPENDICULAR edges are legal (top/bottom if its parent split was 'row', left/right
//    if 'column'). The parent's own direction is explicitly excluded — splitting a pane that's
//    already part of a row AGAIN in the row direction would produce 3 panes side by side instead
//    of quartering it, which is exactly the shape this function exists to prevent.
//  - path length 2+ (this leaf is already one of a quartered pair): no edge is legal — a 3rd level
//    of nesting can only ever produce something other than a clean 2x2 (and this codebase caps
//    split-screen at 4 panes total regardless, enforced separately by window.__countPanes() < 4 at
//    the call site, TabsBar.jsx).
// Returns the empty array for a paneId that isn't in the tree at all, same as "no legal edges."
export function allowedEdgesForPane(
  tree: PaneTree,
  paneId: number,
): ("left" | "right" | "top" | "bottom")[] {
  function pathTo(node: PaneTree, path: ("row" | "column")[]): ("row" | "column")[] | null {
    if (node.type === "leaf") return node.paneId === paneId ? path : null;
    const [a, b] = node.children;
    return pathTo(a, [...path, node.direction]) || pathTo(b, [...path, node.direction]);
  }
  const path = pathTo(tree, []);
  if (!path) return [];
  if (path.length === 0) return ["left", "right", "top", "bottom"];
  if (path.length === 1) return path[0] === "row" ? ["top", "bottom"] : ["left", "right"];
  return [];
}

// Replaces the leaf for targetPaneId with a new split node pairing it with newPaneId — direction/
// child order both come from `edge` ('left'/'right' -> row, existing pane and new pane ordered so
// the new one lands on the dropped side; 'top'/'bottom' -> column, same reasoning). Returns a NEW
// tree (the leaf/split nodes on the path to the target are new objects; every sibling subtree not
// on that path is reused as-is) rather than mutating — matches how every other store gets
// updated (a fresh value passed to setState, not an in-place mutation), and keeps this function
// safe to call speculatively before deciding whether to commit the result. Returns the ORIGINAL
// tree unchanged if targetPaneId isn't found (caller's job to guard against that not happening).
export function splitLeafInTree(
  tree: PaneTree,
  targetPaneId: number,
  newPaneId: number,
  edge: "left" | "right" | "top" | "bottom",
): PaneTree {
  if (tree.type === "leaf") {
    if (tree.paneId !== targetPaneId) return tree;
    const targetLeaf: PaneTree = { type: "leaf", paneId: targetPaneId };
    const newLeaf: PaneTree = { type: "leaf", paneId: newPaneId };
    if (edge === "left")
      return { type: "split", direction: "row", children: [newLeaf, targetLeaf] };
    if (edge === "right")
      return { type: "split", direction: "row", children: [targetLeaf, newLeaf] };
    if (edge === "top")
      return { type: "split", direction: "column", children: [newLeaf, targetLeaf] };
    return { type: "split", direction: "column", children: [targetLeaf, newLeaf] }; // 'bottom'
  }
  return {
    ...tree,
    children: [
      splitLeafInTree(tree.children[0], targetPaneId, newPaneId, edge),
      splitLeafInTree(tree.children[1], targetPaneId, newPaneId, edge),
    ],
  };
}

// Closes paneId and re-merges its space into whichever subtree it was paired with — the split
// node immediately ABOVE its leaf is replaced by that split's OTHER child, so the surviving
// subtree (a single pane, or itself a further-split pair — e.g. closing the one pane NOT
// quartered correctly hands the full reclaimed box to the still-quartered pair, not just one
// arbitrary pane of it) expands to fill exactly the space the closed pane's pair used to occupy.
// Returns null if paneId was the tree's only leaf (closing the last pane isn't a real operation —
// same "always keep at least one" guard closeTab/splitPaneWithTab already enforce, just expressed
// as null here since there's no tree left to return). Same "returns a new tree, doesn't mutate"
// shape as splitLeafInTree.
export function closeLeafInTree(tree: PaneTree, paneId: number): PaneTree | null {
  if (tree.type === "leaf") return tree.paneId === paneId ? null : tree;
  const [a, b] = tree.children;
  if (a.type === "leaf" && a.paneId === paneId) return b;
  if (b.type === "leaf" && b.paneId === paneId) return a;
  const newA = closeLeafInTree(a, paneId);
  if (newA !== a) return newA === null ? b : { ...tree, children: [newA, b] };
  const newB = closeLeafInTree(b, paneId);
  if (newB !== b) return newB === null ? a : { ...tree, children: [a, newB] };
  return tree;
}
