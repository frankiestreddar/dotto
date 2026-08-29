"use client";

import { createPortal } from "react-dom";
import usePortalNode from "./usePortalNode";

// Same uncontrolled-ref reasoning as ItemDetailTitle.jsx — renders once, library-publish.js's own
// document.getElementById('publish-flow-name') reads/writes (startPublishFlow/focusPublishFlowName/
// blurPublishFlowName/confirmPublishFlow) keep working unmodified. onMouseDown's preventDefault
// (instead of stopPropagation) matches the original inline attribute exactly — it's what stops the
// mousedown's own default focus/caret placement so focusPublishFlowName can collapse the caret to
// the end itself instead.
//
// Portals into #publish-flow-name-root (content/fragments/hamburger-stack.html), which carries
// display:contents so the actual #publish-flow-name div ends up the effective flex child of
// #publish-flow-header, matching the original flat markup's layout exactly.
export default function PublishFlowName() {
  const portalNode = usePortalNode("publish-flow-name-root");
  if (!portalNode) return null;

  return createPortal(
    <div
      id="publish-flow-name"
      contentEditable
      suppressContentEditableWarning
      onMouseDown={(e) => {
        e.preventDefault();
        window.focusPublishFlowName();
      }}
      onBlur={() => window.blurPublishFlowName()}
    />,
    portalNode,
  );
}
