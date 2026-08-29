import { describe, expect, it } from "vitest";
import { calculateUserLevel, LEVEL_NAMES, TOTAL_SUB_LEVELS } from "./leveling";

// First real test coverage for the 20-tier/9-sub-rank leveling system — zero coverage existed
// before this, despite it being the canonical source a vanilla duplicate in
// public/dotto/profile-achievements-pricing.js is explicitly kept in sync with by hand (see that
// file's own comment). These tests double as drift protection for that duplicate: its constants
// (LEVEL_NAMES/SUB_RANKS_PER_TIER/LEVEL_GROWTH_RATE/LEVEL_BASE_POINTS, all read from appState —
// core-state.js) were spot-checked against this file's own module-level constants while doing the
// Phase 4.2 pass and confirmed identical as of this commit; if either side ever changes without
// the other, these tests won't directly catch it (they only exercise this file), but they at
// least pin down this file's own behavior precisely enough that a future sync check has something
// concrete to diff against.

describe("LEVEL_NAMES / TOTAL_SUB_LEVELS", () => {
  it("has 20 tier names", () => {
    expect(LEVEL_NAMES).toHaveLength(20);
  });

  it("TOTAL_SUB_LEVELS is 20 tiers * 9 sub-ranks = 180", () => {
    expect(TOTAL_SUB_LEVELS).toBe(180);
  });
});

describe("calculateUserLevel", () => {
  it("a brand-new account (score 0) starts at absolute level 1, tier 0 (Noob), sub-rank 1", () => {
    const lvl = calculateUserLevel(0);
    expect(lvl.absoluteLevel).toBe(1);
    expect(lvl.tierIndex).toBe(0);
    expect(lvl.tierName).toBe("Noob");
    expect(lvl.subRank).toBe(1);
    expect(lvl.displayName).toBe("Noob 1");
    expect(lvl.currentLevelScore).toBe(0);
  });

  it("negative/null/undefined scores are floored to 0, same as a fresh account", () => {
    expect(calculateUserLevel(-50).totalScore).toBe(0);
    expect(calculateUserLevel(null).totalScore).toBe(0);
    expect(calculateUserLevel(undefined).totalScore).toBe(0);
  });

  it("fractional scores are floored to an integer", () => {
    expect(calculateUserLevel(99.9).totalScore).toBe(99);
  });

  it("tier boundaries land on the right tier name — level 10 (sub-rank 1 of tier 2, 0-indexed) is Apprentice", () => {
    // Sub-ranks 1-9 = tier 0 (Noob), 10-18 = tier 1 (Novice), 19-27 = tier 2 (Apprentice)... i.e.
    // absolute level 19 is the first sub-rank of the THIRD tier (index 2).
    const scoreForLevel19 = (() => {
      // Binary-search-free: walk scores upward until calculateUserLevel first reports level 19 —
      // treats calculateUserLevel itself as the source of truth for the threshold, rather than
      // re-deriving the geometric-series formula independently (that would just be testing the
      // formula against itself). A modest upper bound is enough since growth is only ~4.5%/level.
      for (let score = 0; score < 5000; score++) {
        if (calculateUserLevel(score).absoluteLevel >= 19) return score;
      }
      throw new Error("level 19 threshold not found in search range");
    })();
    const lvl = calculateUserLevel(scoreForLevel19);
    expect(lvl.absoluteLevel).toBe(19);
    expect(lvl.tierIndex).toBe(2);
    expect(lvl.tierName).toBe("Apprentice");
    expect(lvl.subRank).toBe(1);
  });

  it("absoluteLevel never exceeds TOTAL_SUB_LEVELS (180) even for an astronomically large score", () => {
    const lvl = calculateUserLevel(Number.MAX_SAFE_INTEGER);
    expect(lvl.absoluteLevel).toBe(TOTAL_SUB_LEVELS);
    expect(lvl.tierName).toBe("Omniscient");
  });

  it("progressPercentage is 100 exactly at the max level, never exceeding 100", () => {
    const lvl = calculateUserLevel(Number.MAX_SAFE_INTEGER);
    expect(lvl.progressPercentage).toBe(100);
  });

  it("progressPercentage is 0 exactly at a level's own threshold (no progress into the next one yet)", () => {
    const lvl0 = calculateUserLevel(0);
    expect(lvl0.progressPercentage).toBe(0);
  });

  it("progressPercentage strictly increases as score increases within the same level", () => {
    // Level 1 spans [0, threshold-for-level-2) — sample a few points inside that range.
    const a = calculateUserLevel(0);
    const thresholdForLevel2 = (() => {
      for (let score = 1; score < 1000; score++) {
        if (calculateUserLevel(score).absoluteLevel >= 2) return score;
      }
      throw new Error("level 2 threshold not found");
    })();
    const mid = calculateUserLevel(Math.floor(thresholdForLevel2 / 2));
    expect(mid.absoluteLevel).toBe(1); // still level 1, just further into it
    expect(mid.progressPercentage).toBeGreaterThan(a.progressPercentage);
    expect(mid.progressPercentage).toBeLessThan(100);
  });

  it("is monotonic: a strictly higher score never produces a lower absolute level", () => {
    let prevLevel = 1;
    for (let score = 0; score <= 3000; score += 137) {
      // an arbitrary irregular step, not aligned to level boundaries on purpose
      const lvl = calculateUserLevel(score).absoluteLevel;
      expect(lvl).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = lvl;
    }
  });
});
