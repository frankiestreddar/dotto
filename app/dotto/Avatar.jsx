"use client";

import { useState } from "react";

// Real JSX equivalent of renderAvatarInto (public/dotto/profile-achievements-pricing.js) — same
// img-with-fallback logic (a broken/missing avatar image falls back to initials text), just as
// local component state instead of an onerror handler mutating the DOM. `className` goes on the
// OUTER wrapper (matching the original's .collab-avatar/.profile-avatar-etc. div, which provides
// the circular frame via overflow:hidden — see its own CSS) so callers can reuse this across every
// avatar spot (hub-collab rows, profile, friends/messages) without duplicating that markup shape.
export default function Avatar({ avatar, fallback, className }) {
  const [failed, setFailed] = useState(false);
  const src = (avatar && avatar.url) || `/assets/avatar/avatar-${(avatar && avatar.id) || 0}.png`;

  return <div className={className}>{failed ? fallback : <img src={src} alt="" onError={() => setFailed(true)} />}</div>;
}
