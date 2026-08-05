import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awardDailyLoginBonus, bumpLoginStreak } from "@/lib/leveling";
import DottoApp from "./dotto-app";

// Server Component: read each migrated Dotto markup fragment from disk at
// build/request time and hand them to the client shell as plain strings.
//
// The fragments in content/fragments/*.html are a byte-for-byte split of
// the original single-file app's body markup (Dotto.html lines 718-986,
// minus its <script> block) along its 18 top-level sections — verified
// programmatically to reconstruct the original markup exactly. Splitting
// them here (rather than one giant blob) is Phase 2's first increment:
// it gives each subsystem (top bar, panels, canvas shell, toolbars, menus)
// its own named file/component, without changing any behavior yet.
const FRAGMENT_NAMES = [
  "top-bar",
  "profile-panel",
  "messages-panel",
  "collab-panel",
  "canvas-modal",
  "cart-panel",
  "hamburger-stack",
  "canvas-area",
  "bottom-toolbars",
  "zoom-control",
  "add-menu",
  "source-add-menu",
  "cell-tag-picker",
  "audio-record-indicator",
  "draw-settings",
  "context-menu",
  "canvas-context-menu",
  "footer",
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // total_score requires supabase/migrations/20260724_add_leveling_system.sql to have been
  // applied — see that file's header comment for why a missing column here fails this whole
  // select, not just this one field.
  // login_streak/created_at require supabase/migrations/20260725_add_login_streak.sql to have
  // been applied — see that file's header and the 20260724 migration's own comment for why a
  // missing column here fails this whole select, not just this one field.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, avatar_id, total_score, login_streak, created_at")
    .eq("id", user.id)
    .single();

  // Idempotent (see award_daily_login_bonus) — safe to call on every page load. Reflects a bonus
  // just granted THIS load in the score the page renders, rather than waiting for a refresh.
  let totalScore = profile?.total_score ?? 0;
  const bonus = await awardDailyLoginBonus(supabase, user.id);
  if (bonus.ok) totalScore = bonus.totalScore;

  // Not idempotent-and-skippable like the bonus above — runs every load and always reflects the
  // current streak (see bump_login_streak).
  let loginStreak = profile?.login_streak ?? 0;
  const streakResult = await bumpLoginStreak(supabase, user.id);
  if (streakResult.ok) loginStreak = streakResult.streak;

  // Requires supabase/migrations/20260730_add_achievements.sql to have been applied. Feeds the
  // spritebook's per-user lock state (see renderSpriteGrid in public/dotto-script.js) so it shows
  // correctly on first paint, before any in-session bumpAchievementStat call could populate it.
  const { data: achievementRows } = await supabase
    .from("user_achievements")
    .select("achievement_id")
    .eq("user_id", user.id);
  const unlockedAchievementIds = (achievementRows || []).map((r) => r.achievement_id);

  const currentUser = {
    id: user.id,
    username: profile?.username ?? user.email,
    displayName: profile?.display_name ?? profile?.username ?? user.email,
    avatarUrl: profile?.avatar_url ?? null,
    avatarId: profile?.avatar_id ?? 0,
    totalScore,
    loginStreak,
    joinedAt: profile?.created_at ?? null,
    unlockedAchievementIds,
  };

  const fragmentsDir = path.join(process.cwd(), "content", "fragments");
  const sections = Object.fromEntries(
    FRAGMENT_NAMES.map((name) => [
      name,
      fs.readFileSync(path.join(fragmentsDir, `${name}.html`), "utf8"),
    ])
  );

  return <DottoApp sections={sections} currentUser={currentUser} />;
}
