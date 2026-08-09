"use client";

import { useLayoutEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { sharedCanvasModalStore } from "./bridges";
import usePortalNode from "./usePortalNode";

// Each item's own card content still comes from renderMsgSnapshotCard (public/dotto/
// live-presence.js) — same "vanilla builds live DOM, React just mounts it via ref" pattern as
// MsgConvo's canvas-snapshot messages, since that function builds real per-kind DOM (tables,
// checklists, media), not something worth re-expressing as JSX.
function SnapshotCardMount({ item }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    mount.appendChild(window.__renderMsgSnapshotCard(item));
  }, [item]);
  return <div ref={ref} />;
}

// Portals into #canvas-modal-body (content/fragments/canvas-modal.html). The modal shell's own
// open/close class toggle and title text stay vanilla (public/dotto/live-presence.js's
// openSharedCanvasView/closeSharedCanvasView) — plain attribute writes on the shell, not on
// anything React portals into. The flex/column/gap layout that used to be set as inline styles on
// #canvas-modal-body itself is now an inner wrapper's className instead, so the portal never
// writes to the target node's own attributes.
export default function SharedCanvasModalBody() {
  const state = useSyncExternalStore(sharedCanvasModalStore.subscribe, sharedCanvasModalStore.getSnapshot, () => null);
  const portalNode = usePortalNode("canvas-modal-body");

  if (!portalNode || !state) return null;

  return createPortal(
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {state.items.map((item, i) => <SnapshotCardMount key={i} item={item} />)}
    </div>,
    portalNode,
  );
}
