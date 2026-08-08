"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";

// Same data/reasoning as ProfileIdentity.jsx (the small avatar in the top-bar profile button, a
// separate spot in a separate fragment — content/fragments/top-bar.html — from the profile
// panel's own large one), just its own portal target.
export default function ProfileAvatarSm() {
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("profile-avatar-sm"));
  }, []);

  if (!portalNode) return null;

  const user = window.__DOTTO_USER__ || {};
  const avatar = { id: user.avatarId ?? 0, url: user.avatarUrl || null };

  return createPortal(<Avatar bare avatar={avatar} name={user.displayName || ""} />, portalNode);
}
