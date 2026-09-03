"use client";

import { useEffect, useState } from "react";

// Resolves a DOM node by id after mount (SSR-safe: document isn't available at render time), so a
// component that createPortal's into an existing static node (from content/fragments/*.html) can
// wait for it to exist before rendering. Every list/panel component that portals into a
// pre-existing static node uses this — see CONTRIBUTING.md for the pattern.
export default function usePortalNode(id: string): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNode(document.getElementById(id));
  }, [id]);
  return node;
}
