"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { msgConvoStore } from "./bridges";

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
      mount.appendChild(window.__renderInlineCanvas(m.canvasSnapshot));
    } else {
      const snapBox = document.createElement("div");
      snapBox.className = "msg-canvas-snapshot";
      snapBox.appendChild(window.__renderMsgSnapshotCard(m.canvasSnapshot[0]));
      snapBox.onclick = () => window.__openSharedCanvasView(m.canvasSnapshot);
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
  const state = useSyncExternalStore(msgConvoStore.subscribe, msgConvoStore.getSnapshot, () => null);
  const [nodes, setNodes] = useState(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNodes({
      avatar: document.getElementById("msg-convo-avatar"),
      title: document.getElementById("msg-convo-title"),
      body: document.getElementById("msg-convo-body"),
    });
  }, []);

  // #msg-convo-body itself is the scrollable node (overflow-y:auto + flex-direction:column-
  // reverse, see globals.css) — it's the portal target, not something this component renders a
  // wrapper into, so its scrollTop is reset directly rather than via a ref on portaled content.
  useLayoutEffect(() => {
    // nodes.body is a plain DOM node reference stored in state, not React-managed data; setting
    // its scrollTop is the same category of external-node write as the imperative writes
    // elsewhere in this cluster.
    // eslint-disable-next-line react-hooks/immutability
    if (nodes && nodes.body) nodes.body.scrollTop = 0;
  }, [state, nodes]);

  if (!nodes || !state) return null;

  const reversed = state.messages.slice().reverse();
  const currentUserId = window.__DOTTO_USER__?.id;

  return (
    <>
      {createPortal(<Avatar bare avatar={{ id: state.avatarId, url: state.avatarUrl }} name={state.displayName} />, nodes.avatar)}
      {createPortal(state.displayName, nodes.title)}
      {createPortal(
        reversed.length === 0 ? (
          <div className="msg-empty">Say hi to {state.displayName.split(" ")[0]}!</div>
        ) : (
          reversed.map((m) => <MsgItem key={m.id} m={m} isMine={m.senderId === currentUserId} />)
        ),
        nodes.body,
      )}
    </>
  );
}
