import { describe, expect, it } from "vitest";
import { calculateSM2, defaultSrsState, diffRatings } from "./srsAlgorithm";

// First real test coverage for the SM-2 spaced-repetition algorithm, extracted from
// srs-connections-core.js in Phase 4.2 and moved to app/dotto/lib in Phase 4.1 (see
// srsAlgorithm.ts's own comment) — zero coverage existed anywhere before Phase 4.2, despite it
// being the scheduling logic behind every flashcard/table-backed game in the app.

describe("defaultSrsState", () => {
  it("returns a fresh, never-reviewed state", () => {
    const state = defaultSrsState();
    expect(state.interval).toBe(1);
    expect(state.easeFactor).toBe(2.5);
    expect(state.repetitions).toBe(0);
    expect(state.dueDate).toBeGreaterThan(0);
  });
});

describe("calculateSM2", () => {
  it("mutates and returns the same card object", () => {
    const card = defaultSrsState();
    const result = calculateSM2(card, 5);
    expect(result).toBe(card);
  });

  it("an incorrect answer (quality < 3) resets repetitions and interval to 1, regardless of prior streak", () => {
    const card = { interval: 30, easeFactor: 2.5, repetitions: 4, dueDate: 0 };
    calculateSM2(card, 1);
    expect(card.repetitions).toBe(0);
    expect(card.interval).toBe(1);
  });

  it("the first correct answer sets interval to 1 and repetitions to 1", () => {
    const card = defaultSrsState();
    calculateSM2(card, 4);
    expect(card.repetitions).toBe(1);
    expect(card.interval).toBe(1);
  });

  it("the second correct answer sets interval to 6", () => {
    const card = defaultSrsState();
    calculateSM2(card, 4); // repetitions -> 1
    calculateSM2(card, 4); // repetitions -> 2
    expect(card.repetitions).toBe(2);
    expect(card.interval).toBe(6);
  });

  it("the third+ correct answer multiplies interval by the (updated) ease factor, rounded", () => {
    const card = defaultSrsState();
    calculateSM2(card, 4); // interval 1, rep 1
    calculateSM2(card, 4); // interval 6, rep 2
    const easeBeforeThird = card.easeFactor;
    calculateSM2(card, 4); // interval 6, rep 3
    expect(card.repetitions).toBe(3);
    expect(card.interval).toBe(Math.round(6 * easeBeforeThird));
  });

  it("ease factor never drops below the 1.3 floor even after repeated low-quality answers", () => {
    const card = defaultSrsState();
    for (let i = 0; i < 20; i++) calculateSM2(card, 3); // the lowest "correct" quality still lowers ease factor
    expect(card.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("a perfect quality (5) increases the ease factor", () => {
    const card = defaultSrsState();
    const before = card.easeFactor;
    calculateSM2(card, 5);
    expect(card.easeFactor).toBeGreaterThan(before);
  });

  it("dueDate is set interval days into the future from call time", () => {
    const card = defaultSrsState();
    const before = Date.now();
    calculateSM2(card, 4); // interval becomes 1
    const expectedMin = before + 1 * 24 * 60 * 60 * 1000;
    expect(card.dueDate).toBeGreaterThanOrEqual(expectedMin);
    expect(card.dueDate).toBeLessThan(expectedMin + 5000); // generous slack for test execution time
  });
});

describe("diffRatings", () => {
  it("computes the per-key difference between two cumulative tallies", () => {
    const live = { noclue: 5, wrong: 3, hard: 2, easy: 10 };
    const base = { noclue: 2, wrong: 1, hard: 2, easy: 4 };
    expect(diffRatings(live, base)).toEqual({ noclue: 3, wrong: 2, hard: 0, easy: 6 });
  });

  it("treats missing keys on either side as 0", () => {
    expect(diffRatings({ easy: 3 }, {})).toEqual({ noclue: 0, wrong: 0, hard: 0, easy: 3 });
  });

  it("handles null/undefined inputs the same as an empty tally", () => {
    expect(diffRatings(null, undefined)).toEqual({ noclue: 0, wrong: 0, hard: 0, easy: 0 });
  });
});
