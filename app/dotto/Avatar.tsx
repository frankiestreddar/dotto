"use client";

import { useState } from "react";

// Pure reimplementation of `initials` (app/dotto/lib/friendsPresence.ts) — plain string logic with
// no vanilla-only dependency (no appState/DOM access), so it's computed directly here instead of
// via a window.__ bridge or a direct import. That matters on first paint specifically: every other
// window.__ bridge call in these React-owned panels only ever runs after some other component's
// own store data has already arrived (guaranteeing whichever module actually sets that bridge has
// already evaluated by then) — but Avatar can render on the very FIRST commit (see
// ProfileIdentity.tsx/ProfileAvatarSm.tsx, gated on nothing but a document.getElementById lookup),
// which can beat that module's own evaluation, throwing "window.__initials is not a function".
function initials(name: string | undefined): string {
  return (name || "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export interface AvatarInfo {
  id?: number | string;
  url?: string | null;
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
export default function Avatar({
  avatar,
  name,
  className,
  bare,
}: {
  avatar?: AvatarInfo | null;
  name?: string;
  className?: string;
  bare?: boolean;
}) {
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
