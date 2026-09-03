"use client";

import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useProfileLevelStore } from "./lib/profileLevelStore";
import usePortalNode from "./usePortalNode";

// Portals the level text into #profile-level-pill (content/fragments/profile-panel.html — its own
// inner .profile-level-pill-text span was removed from the static markup so this doesn't
// duplicate it). The pill's background/color are set via a plain effect on the portal target
// itself, not JSX props — createPortal only ever owns the target's CHILDREN, never its own
// attributes, same as CommandPalette.jsx's #search-command-palette style.display handling.
export default function ProfileLevelPill() {
  const level = useProfileLevelStore();
  const portalNode = usePortalNode("profile-level-pill");

  useLayoutEffect(() => {
    const el = document.getElementById("profile-level-pill");
    if (el) {
      el.style.background = level.tierColor;
      el.style.color = "#fff";
    }
  }, [level]);

  if (!portalNode) return null;

  return createPortal(
    <span className="profile-level-pill-text">{level.displayName}</span>,
    portalNode,
  );
}
