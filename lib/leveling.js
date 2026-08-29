// 20-tier / 9-sub-rank (180 total sub-level) user progression system. Schema this depends on
// (profiles.total_score, profiles.last_daily_bonus_at, the award_user_points and
// award_daily_login_bonus RPCs) lives in
// supabase/migrations/20260724_add_leveling_system.sql — that migration must be applied before
// any of this is used against a real Supabase project.
//
// public/dotto-script.js (a classic, non-module script with no import system — see
// app/dotto-app.jsx) can't import this file directly, so calculateUserLevel's logic is
// deliberately duplicated there too, comment-linked back to this file as the canonical source.
// Keep the two in sync if the formula or LEVEL_NAMES ever change.

export const LEVEL_NAMES = [
  "Noob",
  "Novice",
  "Apprentice",
  "Learner",
  "Scholar",
  "Seeker",
  "Thinker",
  "Strategist",
  "Specialist",
  "Expert",
  "Master",
  "Savant",
  "Polymath",
  "Brainiac",
  "Prodigy",
  "Intellect",
  "Visionary",
  "Titan",
  "Archon",
  "Omniscient",
];

const SUB_RANKS_PER_TIER = 9;
export const TOTAL_SUB_LEVELS = LEVEL_NAMES.length * SUB_RANKS_PER_TIER; // 180
const GROWTH_RATE = 1.045;
const BASE_POINTS = 100;

// Cumulative score required to REACH absolute sub-level L (1-180). L=1 costs 0 (everyone starts
// there); each level after that compounds by GROWTH_RATE off a BASE_POINTS unit, via the
// standard geometric-series sum: sum_{i=0}^{n-1} base*rate^i = base*(rate^n - 1)/(rate - 1).
function scoreRequiredForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor((BASE_POINTS * (Math.pow(GROWTH_RATE, level - 1) - 1)) / (GROWTH_RATE - 1));
}

// Derives full level details from a user's cumulative total_score (profiles.total_score).
export function calculateUserLevel(score) {
  const totalScore = Math.max(0, Math.floor(score || 0));

  // Highest absolute level (1-180) whose threshold the score has met — capped at 180, a score
  // past the level-180 threshold just stays maxed out.
  let absoluteLevel = 1;
  for (let level = 2; level <= TOTAL_SUB_LEVELS; level++) {
    if (totalScore >= scoreRequiredForLevel(level)) absoluteLevel = level;
    else break;
  }

  const tierIndex = Math.floor((absoluteLevel - 1) / SUB_RANKS_PER_TIER);
  const subRank = ((absoluteLevel - 1) % SUB_RANKS_PER_TIER) + 1;
  const tierName = LEVEL_NAMES[tierIndex];

  const currentThreshold = scoreRequiredForLevel(absoluteLevel);
  const isMaxLevel = absoluteLevel >= TOTAL_SUB_LEVELS;
  const nextThreshold = isMaxLevel ? currentThreshold : scoreRequiredForLevel(absoluteLevel + 1);

  const currentLevelScore = totalScore - currentThreshold;
  const nextLevelScore = nextThreshold - currentThreshold;
  const progressPercentage = isMaxLevel
    ? 100
    : Math.max(0, Math.min(100, (currentLevelScore / nextLevelScore) * 100));

  return {
    totalScore,
    absoluteLevel,
    tierIndex,
    tierName,
    subRank,
    displayName: `${tierName} ${subRank}`,
    currentLevelScore,
    nextLevelScore,
    progressPercentage,
  };
}

// Centralized score-award entry point — every app action that grants points (chat message,
// canvas block, flashcard flip, daily login, achievement unlock, ...) should go through this
// (server-side call sites) or its public/dotto-script.js duplicate (client-side call sites)
// rather than touching profiles.total_score directly, so scoring always goes through the atomic,
// audited award_user_points RPC. `supabase` is an already-created client (browser or server) —
// this module doesn't construct one itself, matching lib/dotbot.js's credit-spend functions.
export async function awardUserPoints(supabase, userId, actionType, points) {
  const { data, error } = await supabase.rpc("award_user_points", {
    p_user_id: userId,
    p_action_type: actionType,
    p_points: points,
  });
  if (error) {
    console.error("[leveling] award_user_points failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true, totalScore: data };
}

// Awards the daily-login bonus if it hasn't already been claimed within the last 20 hours (see
// award_daily_login_bonus's own idempotency check) — safe to call unconditionally on every page
// load. Returns { ok: true, totalScore } only when the bonus was actually granted this call.
export async function awardDailyLoginBonus(supabase, userId, points = 20) {
  const { data, error } = await supabase.rpc("award_daily_login_bonus", {
    p_user_id: userId,
    p_points: points,
  });
  if (error) {
    console.error("[leveling] award_daily_login_bonus failed:", error);
    return { ok: false, reason: "error" };
  }
  if (data === null) return { ok: false, reason: "already_claimed" };
  return { ok: true, totalScore: data };
}

// Bumps (or resets) the profile panel's login streak — see bump_login_streak in
// supabase/migrations/20260725_add_login_streak.sql for the actual continuity logic. Unlike
// awardDailyLoginBonus this isn't idempotent-and-skippable; it's meant to run once per page load
// and always returns the current streak value (whether or not it changed this call).
export async function bumpLoginStreak(supabase, userId) {
  const { data, error } = await supabase.rpc("bump_login_streak", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[leveling] bump_login_streak failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true, streak: data };
}
