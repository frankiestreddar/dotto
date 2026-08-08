"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";

// Portals the profile panel's avatar/username/streak into their existing static nodes
// (content/fragments/profile-panel.html). No store needed — window.__DOTTO_USER__ (set once
// during DottoApp's own render, app/dotto-app.jsx) already carries this, and none of these three
// ever change after initial page load (unlike the level pill, which updates live after
// awardUserPoints — see ProfileLevelPill.jsx).
export default function ProfileIdentity() {
  const [nodes, setNodes] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNodes({
      avatar: document.getElementById("profile-avatar"),
      username: document.getElementById("profile-username"),
      streak: document.getElementById("profile-streak-count"),
    });
  }, []);

  if (!nodes) return null;

  const user = window.__DOTTO_USER__ || {};
  const displayName = user.displayName || "";
  const avatar = { id: user.avatarId ?? 0, url: user.avatarUrl || null };

  return (
    <>
      {nodes.avatar && createPortal(<Avatar bare avatar={avatar} name={displayName} />, nodes.avatar)}
      {nodes.username && createPortal(displayName, nodes.username)}
      {nodes.streak && createPortal(user.loginStreak || 0, nodes.streak)}
    </>
  );
}
