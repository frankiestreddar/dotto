"use client";

import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import usePortalNode from "./usePortalNode";

// Portals the profile panel's avatar/username/streak into their existing static nodes
// (content/fragments/profile-panel.html). No store needed — window.__DOTTO_USER__ (set once
// during DottoApp's own render, app/dotto-app.jsx) already carries this, and none of these three
// ever change after initial page load (unlike the level pill, which updates live after
// awardUserPoints — see ProfileLevelPill.jsx).
export default function ProfileIdentity() {
  const avatarNode = usePortalNode("profile-avatar");
  const usernameNode = usePortalNode("profile-username");
  const streakNode = usePortalNode("profile-streak-count");

  const user = window.__DOTTO_USER__ || {};
  const displayName = user.displayName || "";
  const avatar = { id: user.avatarId ?? 0, url: user.avatarUrl || null };

  return (
    <>
      {avatarNode && createPortal(<Avatar bare avatar={avatar} name={displayName} />, avatarNode)}
      {usernameNode && createPortal(displayName, usernameNode)}
      {streakNode && createPortal(user.loginStreak || 0, streakNode)}
    </>
  );
}
