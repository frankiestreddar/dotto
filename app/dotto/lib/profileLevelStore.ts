import { create } from "zustand";

// Profile panel's level pill (app/dotto/lib/profileAchievementsPricing.ts's renderProfileLevel) —
// { displayName, tierColor }, updated once at init and again live after awardUserPoints. Text +
// background color move together as one store value — see ProfileLevelPill.jsx. Migrated from
// bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration
// plan, batch 5) — not flushSync'd, no synchronous DOM read follows either producer call.
export interface ProfileLevelState {
  displayName: string;
  tierColor: string;
}

export const useProfileLevelStore = create<ProfileLevelState>(() => ({
  displayName: "",
  tierColor: "",
}));
