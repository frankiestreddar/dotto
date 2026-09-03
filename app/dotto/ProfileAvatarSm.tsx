"use client";

import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import usePortalNode from "./usePortalNode";

// Same data/reasoning as ProfileIdentity.tsx (the small avatar in the top-bar profile button, a
// separate spot in a separate fragment — content/fragments/top-bar.html — from the profile
// panel's own large one), just its own portal target.
export default function ProfileAvatarSm() {
  const portalNode = usePortalNode("profile-avatar-sm");

  if (!portalNode) return null;

  const user = window.__DOTTO_USER__ || ({} as NonNullable<typeof window.__DOTTO_USER__>);
  const avatar = {
    id: (user.avatarId as number | string | undefined) ?? 0,
    url: (user.avatarUrl as string | null | undefined) || null,
  };

  return createPortal(<Avatar bare avatar={avatar} name={user.displayName || ""} />, portalNode);
}
