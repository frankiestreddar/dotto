"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { achievementsStore } from "./bridges";

const EMPTY_UNLOCKED = [];

// Static asset grid, dropped into /public/sprites by hand: the first 8 cells are the
// achievement-tied sprites, each showing its own locked/unlocked art (sprite-N-locked.png /
// sprite-N.png) based on unlockedIds; every cell after that has no achievement at all, so it
// always shows the shared unknown-sprite.png regardless of any state. A cell whose image 404s
// just shows its empty placeholder space (same as the original's img.onerror = () => img.remove())
// rather than a broken-image icon.
function SpriteCell({ index, achievements, unlockedSet }) {
  const [broken, setBroken] = useState(false);
  const hasAchievement = index <= achievements.length;
  const src = !hasAchievement
    ? "/sprites/unknown-sprite.png"
    : unlockedSet.has(achievements[index - 1].id)
      ? `/sprites/sprite-${index}.png`
      : `/sprites/sprite-${index}-locked.png`;

  return <div className="profile-sprite-cell">{!broken && <img src={src} alt="" onError={() => setBroken(true)} />}</div>;
}

// Portals into #profile-sprite-grid (content/fragments/profile-panel.html) — genuine JSX cells,
// same reasoning as CanvasResultsPanel/WaypointsListPanel: no per-cell widget state beyond its own
// broken-image fallback. window.__ACHIEVEMENTS/__SPRITE_TOTAL_COUNT are bridged as plain constants
// (see profile-achievements-pricing.js's own comment) since they never change; only the unlocked-
// ids list is real store state.
export default function AchievementsGrid() {
  const unlockedIds = useSyncExternalStore(achievementsStore.subscribe, achievementsStore.getSnapshot, () => EMPTY_UNLOCKED);
  const [portalNode, setPortalNode] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(document.getElementById("profile-sprite-grid"));
  }, []);

  if (!portalNode) return null;

  const unlockedSet = new Set(unlockedIds);
  const achievements = window.__ACHIEVEMENTS || [];
  const count = window.__SPRITE_TOTAL_COUNT || 0;
  const cells = [];
  for (let i = 1; i <= count; i++) {
    cells.push(<SpriteCell key={i} index={i} achievements={achievements} unlockedSet={unlockedSet} />);
  }

  return createPortal(cells, portalNode);
}
