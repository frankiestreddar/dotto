"use client";

import { createPortal } from "react-dom";
import { useExtensionsListStore } from "./lib/extensionsListStore";
import usePortalNode from "./usePortalNode";

// Portals into #extensions-list-container (content/fragments/hamburger-stack.html, #library-panel
// — the Extensions panel's real id under the hood, was Library before this repurposing). Just
// installed-extension pills, rectangular rather than item cards (explicit request) — no click
// behavior yet, nothing to click into (see app/dotto/lib/extensionsListStore.ts, dummy data for now).
export default function ExtensionsPanel() {
  const extensions = useExtensionsListStore();
  const portalNode = usePortalNode("extensions-list-container");

  if (!portalNode) return null;

  return createPortal(
    extensions.map((ext) => (
      <div key={ext.id} className="extension-pill">
        {ext.label}
      </div>
    )),
    portalNode,
  );
}
