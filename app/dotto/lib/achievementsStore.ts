import { create } from "zustand";

// Profile panel's achievement spritebook (app/dotto/lib/profileAchievementsPricing.ts's
// renderSpriteGrid) — just the array of unlocked achievement ids; window.__ACHIEVEMENTS/
// __SPRITE_TOTAL_COUNT (bridged as plain constants, not through a store, since they never change)
// supply everything else AchievementsGrid.jsx needs to render every cell. Genuine JSX, same
// reasoning as commandPaletteStore/waypointsListStore. Migrated from bridges.js's hand-rolled
// createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 5) — not
// flushSync'd, no synchronous DOM read follows it. Array-shaped, like chatThreadStore/
// chatsListStore — its one producer call passes `true` as setState's second (replace) argument to
// avoid Zustand's default Object.assign shallow-merge silently turning the array into a plain
// {0:...,1:...} object (see chatThreadStore.ts's own comment for the full mechanics).
export const useAchievementsStore = create<string[]>(() => []);
