"use client";

import { useLayoutEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { msgConvoStore } from "./bridges";
import {
  openSharedCanvasView,
  renderInlineCanvas,
  renderMsgSnapshotCard,
} from "./lib/messagingCanvasPreview";
import usePortalNode from "./usePortalNode";

// A canvas-snapshot message's own card content still comes from vanilla builders
// (renderInlineCanvas for a multi-item snapshot, renderMsgSnapshotCard for a single-item one) —
// same "vanilla builds live DOM, React just mounts it via ref" pattern as InlineCanvasPreview,
// since those build real per-kind DOM (tables, checklists, media), not something worth
// re-expressing as JSX. Keyed by m.id in the parent, so this only ever mounts once per message.
function MsgSnapshotMount({ m }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    if (m.canvasSnapshot.length > 1) {
      mount.appendChild(renderInlineCanvas(m.canvasSnapshot));
    } else {
      const snapBox = document.createElement("div");
      snapBox.className = "msg-canvas-snapshot";
      snapBox.appendChild(renderMsgSnapshotCard(m.canvasSnapshot[0]));
      snapBox.onclick = () => openSharedCanvasView(m.canvasSnapshot);
      mount.appendChild(snapBox);
    }
  }, [m]);
  return <div ref={ref} />;
}

function MsgItem({ m, isMine }) {
  const wrapperClass = "flex flex-col " + (isMine ? "items-end" : "items-start") + " w-full";
  if (m.canvasSnapshot) {
    return (
      <div className={wrapperClass}>
        <MsgSnapshotMount m={m} />
      </div>
    );
  }
  return (
    <div className={wrapperClass}>
      <div className={"msg-bubble " + (isMine ? "me" : "them")}>{m.text}</div>
    </div>
  );
}

// Portals into 3 pre-existing static nodes (content/fragments/messages-panel.html):
// #msg-convo-avatar, #msg-convo-title (both children of #msg-convo-header, alongside the
// vanilla back button), and #msg-convo-body. DOM order is newest-message-first (reversed from
// appState.friends[].messages' chronological-ascending order) — paired with #msg-convo-body's
// flex-direction:column-reverse (see globals.css), that's what pins the view to the bottom
// (newest message) exactly like the original insertBefore-prepending did.
export default function MsgConvo() {
  const state = useSyncExternalStore(
    msgConvoStore.subscribe,
    msgConvoStore.getSnapshot,
    () => null,
  );
  const avatarNode = usePortalNode("msg-convo-avatar");
  const titleNode = usePortalNode("msg-convo-title");
  const bodyNode = usePortalNode("msg-convo-body");

  // bodyNode itself is the scrollable node (overflow-y:auto + flex-direction:column-reverse, see
  // globals.css) — it's the portal target, not something this component renders a wrapper into,
  // so its scrollTop is reset directly rather than via a ref on portaled content.
  useLayoutEffect(() => {
    // bodyNode is a plain DOM node reference stored in state, not React-managed data; setting its
    // scrollTop is the same category of external-node write as the imperative writes elsewhere in
    // this cluster.
    // eslint-disable-next-line react-hooks/immutability
    if (bodyNode) bodyNode.scrollTop = 0;
  }, [state, bodyNode]);

  if (!avatarNode || !titleNode || !bodyNode || !state) return null;

  const reversed = state.messages.slice().reverse();
  const currentUserId = window.__DOTTO_USER__?.id;

  return (
    <>
      {createPortal(
        <Avatar
          bare
          avatar={{ id: state.avatarId, url: state.avatarUrl }}
          name={state.displayName}
        />,
        avatarNode,
      )}
      {createPortal(state.displayName, titleNode)}
      {createPortal(
        reversed.length === 0 ? (
          <div className="msg-empty">Say hi to {state.displayName.split(" ")[0]}!</div>
        ) : (
          reversed.map((m) => <MsgItem key={m.id} m={m} isMine={m.senderId === currentUserId} />)
        ),
        bodyNode,
      )}
    </>
  );
}
