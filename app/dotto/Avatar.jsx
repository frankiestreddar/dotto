"use client";

import { useState } from "react";

// Pure reimplementation of the vanilla `initials` (public/dotto/friends-presence.js) — plain
// string logic with no vanilla-only dependency (no appState/DOM access), so it's computed directly
// here instead of via a window.__ bridge. That matters on first paint specifically: every other
// window.__ bridge call in these React-owned panels only ever runs after some vanilla-originated
// store data has already arrived (guaranteeing dotto-script.js, the <Script strategy=
// "afterInteractive"> bundle that sets those bridges, is already loaded by then) — but Avatar can
// render on the very FIRST commit (see ProfileIdentity.jsx/ProfileAvatarSm.jsx, gated on nothing
// but a document.getElementById lookup), which can beat that script's load, throwing
// "window.__initials is not a function".
function initials(name) {
  return (name || "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Real JSX equivalent of renderAvatarInto (app/dotto/lib/profileAchievementsPricing.ts) — same
// img-with-fallback logic (a broken/missing avatar image falls back to initials text), just as
// local component state instead of an onerror handler mutating the DOM. `className` goes on the
// OUTER wrapper (matching the original's .collab-avatar/.profile-avatar-etc. div, which provides
// the circular frame via overflow:hidden — see its own CSS) so callers can reuse this across every
// avatar spot (hub-collab rows, profile, friends/messages) without duplicating that markup shape.
// `bare` skips that wrapper entirely — for callers portaling into an EXISTING static element that
// already provides its own frame (e.g. #profile-avatar/#profile-avatar-sm), where an extra
// wrapper div would be a spurious nesting level, not just a styling no-op.
export default function Avatar({ avatar, name, className, bare }) {
  const [failed, setFailed] = useState(false);
  const src = (avatar && avatar.url) || `/assets/avatar/avatar-${(avatar && avatar.id) || 0}.png`;
  const content = failed ? (
    initials(name)
  ) : (
    <img src={src} alt="" onError={() => setFailed(true)} />
  );

  if (bare) return content;
  return <div className={className}>{content}</div>;
}
