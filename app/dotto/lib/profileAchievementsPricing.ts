// Phase 4.5 port of public/dotto/profile-achievements-pricing.js: the Profile panel (level pill,
// avatar rendering, Dotbot usage bars), the achievement/spritebook system, and the
// pricing-overlay open/close wrappers. Reaches every still-vanilla dependency through window
// bridges — most already existed (window.pushNotification/__closeAllPanels/__setPricingOverlayOpen/
// __setProfileLevel/__setAchievements/__wireRailIcon/__closeRailView), 3 are new as part of this
// port (__refreshDotbotUsage/__closeProfilePanel/__openDotbotUpgradeModal — friends-presence.js/
// drawing-connections.js/search-orchestration-selection.js/hamburger-collab.js/app-init.js/
// mnemonic-search-matching.js, all still vanilla, used to import these 5 functions directly; that
// vanilla-to-vanilla import no longer reaches across the public/app boundary).

interface Achievement {
  id: string;
  statKey: string;
  threshold: number;
  name: string;
  spriteIndex: number;
}

interface AppState {
  currentUser: { id: string | null; totalScore: number };
  LEVEL_NAMES: string[];
  SUB_RANKS_PER_TIER: number;
  LEVEL_GROWTH_RATE: number;
  LEVEL_BASE_POINTS: number;
  TOTAL_SUB_LEVELS: number;
  ACHIEVEMENTS: Achievement[];
  SPRITE_TOTAL_COUNT: number;
  BLOCKS_CAP: number;
  unlockedAchievementIds: Set<string>;
  searchUsageWarned: boolean;
  genUsageWarned: boolean;
  dotbotUpgradePromptedForFullness: boolean;
  profileBtn: HTMLElement;
  profilePanel: HTMLElement;
  profileMainView: HTMLElement;
  profileSettingsView: HTMLElement;
  folders: Record<string, { items?: unknown[] }>;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Profile Panel Controls ----------

// 20-tier / 9-sub-rank (180 total sub-level) progression system — canonical source is
// lib/leveling.js (calculateUserLevel); duplicated here verbatim because this used to be a
// classic, non-module script that couldn't import it. Keep the two in sync.
function scoreRequiredForLevel(level: number): number {
  const appState = getAppState();
  if (level <= 1) return 0;
  return Math.floor(
    (appState.LEVEL_BASE_POINTS * (Math.pow(appState.LEVEL_GROWTH_RATE, level - 1) - 1)) /
      (appState.LEVEL_GROWTH_RATE - 1),
  );
}

function calculateUserLevel(score: number) {
  const appState = getAppState();
  const totalScore = Math.max(0, Math.floor(score || 0));
  let absoluteLevel = 1;
  for (let level = 2; level <= appState.TOTAL_SUB_LEVELS; level++) {
    if (totalScore >= scoreRequiredForLevel(level)) absoluteLevel = level;
    else break;
  }
  const tierIndex = Math.floor((absoluteLevel - 1) / appState.SUB_RANKS_PER_TIER);
  const subRank = ((absoluteLevel - 1) % appState.SUB_RANKS_PER_TIER) + 1;
  const tierName = appState.LEVEL_NAMES[tierIndex];
  const currentThreshold = scoreRequiredForLevel(absoluteLevel);
  const isMaxLevel = absoluteLevel >= appState.TOTAL_SUB_LEVELS;
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

// Centralized score-award entry point for every client-side action that grants points (chat
// message, canvas block, flashcard flip, ...) — mirrors lib/leveling.js's awardUserPoints,
// duplicated for the same no-import-system reason as calculateUserLevel above. Re-renders the
// profile level display live on success so the user sees the change immediately, without needing
// a page refresh.
export async function awardUserPoints(
  actionType: string,
  points: number,
): Promise<{ ok: boolean; reason?: string; totalScore?: number }> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState.currentUser.id) return { ok: false, reason: "no_session" };
  const oldLevel = calculateUserLevel(appState.currentUser.totalScore);
  const { data, error } = await supabase.rpc("award_user_points", {
    p_user_id: appState.currentUser.id,
    p_action_type: actionType,
    p_points: points,
  });
  if (error) {
    console.error("[leveling] award_user_points failed:", error);
    return { ok: false, reason: "error" };
  }
  appState.currentUser.totalScore = data;
  renderProfileLevel();
  const newLevel = calculateUserLevel(appState.currentUser.totalScore);
  if (newLevel.absoluteLevel > oldLevel.absoluteLevel) {
    window.pushNotification?.({
      type: "level_up",
      message: `Level up! You're now ${newLevel.displayName}`,
    }); // no buttons, auto-dismisses — no dismiss function
  }
  return { ok: true, totalScore: data };
}

// Populates #profile-level-pill's text (e.g. "Noob 1") and per-tier colour from
// currentUser.totalScore — called once on init (wireProfileAchievementsPricing below) and again
// after awardUserPoints so it updates live. One CSS rule can't express 20 different tier colours,
// so the pill's background/text colour is generated here instead of hardcoded per tier: an even
// hue step per tier around the wheel (360/20 = 18°) keeps every tier visually distinct without
// hand-picking 20 hex values, and automatically stays distinct if LEVEL_NAMES ever grows/shrinks.
function levelTierColor(tierIndex: number): string {
  const appState = getAppState();
  const hue = Math.round((tierIndex * 360) / appState.LEVEL_NAMES.length);
  return `hsl(${hue}, 62%, 38%)`;
}

// Real React state now (see app/dotto/ProfileLevelPill.jsx, profileLevelStore) — text + background
// color both move together as one store value.
function renderProfileLevel(): void {
  const appState = getAppState();
  if (!appState.currentUser.id) return;
  const lvl = calculateUserLevel(appState.currentUser.totalScore);
  window.__setProfileLevel!({
    displayName: lvl.displayName,
    tierColor: levelTierColor(lvl.tierIndex),
  });
}

// `avatar` is { id, url } — url is the saved custom avatar-builder composite (Supabase Storage
// public URL, once a user completes /avatar-setup) and always wins when present; id falls back to
// the older static /assets/avatar/avatar-{n}.png set (0 = default silhouette) for accounts that
// haven't built a custom avatar. Falls back to initials if the resolved src fails to load. Still
// used for every OTHER avatar spot in the app (remote cursor labels, message/friends/per-canvas-
// collab rows) — only the profile panel's own avatar/avatar-sm/username/streak are React-owned now
// (see app/dotto/ProfileIdentity.jsx), since those four never change after initial page load
// (unlike this function's other callers, which render a DIFFERENT person's avatar each time) and
// window.__DOTTO_USER__ (already set once during DottoApp's own render, app/dotto-app.jsx) already
// carries the exact same data.
export function renderAvatarInto(
  el: HTMLElement | null,
  avatar: { id: number; url: string | null } | null,
  fallbackText: string,
): void {
  if (!el) return;
  const src =
    avatar && avatar.url ? avatar.url : `/assets/avatar/avatar-${(avatar && avatar.id) || 0}.png`;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.onerror = () => {
    el.innerHTML = "";
    el.textContent = fallbackText;
  };
  el.innerHTML = "";
  el.appendChild(img);
}

// ---------- Achievements ----------
// Backs the spritebook: each of the first 8 sprite slots is tied to one achievement, tracked
// server-side via the generic bump_achievement_stat RPC (see
// supabase/migrations/20260730_add_achievements.sql) rather than one bespoke column/RPC per
// achievement. statKey/threshold are client-defined constants passed straight to the RPC — not
// security-sensitive, same trust level as awardUserPoints' p_points above.

// Bumps one achievement's stat counter and, if it just crossed its threshold, unlocks it: the
// spritebook re-renders live and two notifications queue up in order — "Achievement unlocked!
// (name)" then "Sprite N will spawn soon". The actual on-canvas spawn isn't implemented yet
// (deliberately deferred to a follow-up pass) — this only announces it.
//
// delta/absolute mirror bump_achievement_stat's two counter modes: plain incrementing tallies (the
// default) for most achievements, vs. `absolute` for stats where the caller already knows its own
// true current total (e.g. three_friends passes friends.length, which is symmetric regardless of
// who sent/accepted the request, so it just needs to be synced in, never regressed).
export async function bumpAchievementStat(
  achievementId: string,
  delta = 1,
  absolute = false,
): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState.currentUser.id) return;
  if (appState.unlockedAchievementIds.has(achievementId)) return; // already unlocked — stop paying for RPC calls
  const def = appState.ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!def) return;
  const { data, error } = await supabase.rpc("bump_achievement_stat", {
    p_user_id: appState.currentUser.id,
    p_stat_key: def.statKey,
    p_achievement_id: def.id,
    p_threshold: def.threshold,
    p_delta: delta,
    p_absolute: absolute,
  });
  if (error) {
    console.error("[achievements] bump_achievement_stat failed:", error);
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.newly_unlocked) {
    appState.unlockedAchievementIds.add(def.id);
    renderSpriteGrid();
    window.pushNotification?.({
      type: "achievement_unlock",
      message: `Achievement unlocked! (${def.name})`,
    });
    window.pushNotification?.({
      type: "achievement_unlock",
      message: `Sprite ${def.spriteIndex} will spawn soon`,
    });
  }
}

// Real React state now (see app/dotto/AchievementsGrid.jsx, achievementsStore) — genuine JSX
// cells: the first 8 are the achievement-tied sprites, each showing its own locked/unlocked art
// (sprite-N-locked.png / sprite-N.png) based on unlockedAchievementIds; every cell after that has
// no achievement at all, so it always shows the shared unknown-sprite.png regardless of any state.
// window.__ACHIEVEMENTS/__SPRITE_TOTAL_COUNT are true constants (never reassigned after init),
// bridged once (in wireProfileAchievementsPricing below) rather than routed through the store —
// only unlockedAchievementIds actually varies over a session.
function renderSpriteGrid(): void {
  const appState = getAppState();
  window.__setAchievements!(Array.from(appState.unlockedAchievementIds));
}

// Profile shares the permanent rail's one shell/pinned-state (see openRailView,
// app/dotto/lib/panelsHamburger.ts) — no positioning/resize logic of its own needed (the shell is
// already positioned beside the rail, full-height, no per-panel height to keep in sync).
export function closeProfilePanel(): void {
  window.__closeRailView?.();
}

// Two internal sub-views of #profile-panel, toggled independently of the outer rail's own
// open/close state — same shape as showAiListView/showAiChatView (ai-assistant-suggestions.js).
// #profile-settings-view holds the old #settings-panel's content (Brightness Theme, Sidebar Mode),
// moved here once Settings was removed as its own rail icon, per explicit request.
export function showProfileMainView(): void {
  const appState = getAppState();
  appState.profileSettingsView.classList.remove("open");
  appState.profileMainView.classList.add("open");
}
export function showProfileSettingsView(): void {
  const appState = getAppState();
  appState.profileMainView.classList.remove("open");
  appState.profileSettingsView.classList.add("open");
}

function refreshProfilePanel(): void {
  // Always land on the main view, not wherever the panel was left last time (e.g. mid-Settings via
  // the ',' shortcut, app/dotto/lib/srsConnectionsCore.ts, which switches to the settings view
  // again right after this runs).
  showProfileMainView();
  refreshDotbotUsage();
  // Always start at the top of the sprite grid, not wherever it happened to be scrolled to last
  // time the panel was open.
  const sbScroll = document.getElementById("profile-spritebook-scroll");
  if (sbScroll) sbScroll.scrollTop = 0;
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
function formatResetTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatResetDate(d: Date): string {
  const day = d.getDate();
  return `${d.toLocaleDateString(undefined, { month: "long" })} ${day}${ordinalSuffix(day)}`;
}

// Total cards across every canvas the user has, regardless of which one is currently open — a
// pure client-side count (no new column), since the whole workspace is already loaded in memory.
// Never resets; the only way down is deleting cards (or, eventually, upgrading).
function totalBlocksUsed(): number {
  const appState = getAppState();
  return Object.values(appState.folders).reduce(
    (sum, f) => sum + (f.items ? f.items.length : 0),
    0,
  );
}

// Fills all three usage bars — split across the two independent credit pools (search: 30 per 6h,
// generation: 100 per month — see lib/dotbot.js) plus the client-computed blocks count. Bar-only,
// no numbers anywhere; each fills UP as usage goes up. Mirrors each RPC's own lazy-reset logic
// purely for display, without writing anything.
function setUsageFillWidth(id: string, pct: number): void {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

export async function refreshDotbotUsage(): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  const searchFill = document.getElementById("profile-usage-search-fill");
  if (!searchFill || !supabase || !appState.currentUser.id) return;
  const blocksFillEl = document.getElementById("profile-usage-blocks-fill");
  const genFillEl = document.getElementById("profile-usage-generation-fill");
  // Every time the panel opens, the bars should visibly fill up from empty — not animate from
  // wherever they happened to be left last time. Snap to 0% instantly (transition disabled for
  // this one write) before the real target widths below animate in normally.
  const allFills = [searchFill, blocksFillEl, genFillEl].filter((el): el is HTMLElement => !!el);
  allFills.forEach((el) => {
    el.style.transition = "none";
    el.style.width = "0%";
  });
  void searchFill.offsetWidth; // commit the instant 0% before re-enabling the transition
  allFills.forEach((el) => {
    el.style.transition = "";
  });

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "search_credits_remaining, search_credits_reset_at, generation_credits_remaining, generation_credits_reset_at",
    )
    .eq("id", appState.currentUser.id)
    .single();
  if (error || !data) return;

  const sixHoursMs = 6 * 60 * 60 * 1000;
  const searchResetAt = new Date(data.search_credits_reset_at);
  const searchExpired = Date.now() - searchResetAt.getTime() >= sixHoursMs;
  const searchRemaining = searchExpired ? 30 : data.search_credits_remaining;
  const searchUsedPct = ((30 - searchRemaining) / 30) * 100;
  setUsageFillWidth("profile-usage-search-fill", searchUsedPct);
  const nextSearchReset = new Date(
    (searchExpired ? Date.now() : searchResetAt.getTime()) + sixHoursMs,
  );
  const searchTooltip = document.getElementById("profile-usage-search-tooltip");
  if (searchTooltip) searchTooltip.textContent = `Resets at ${formatResetTime(nextSearchReset)}`;
  if (searchExpired) appState.searchUsageWarned = false;
  if (!appState.searchUsageWarned && searchUsedPct >= 75) {
    appState.searchUsageWarned = true;
    window.pushNotification?.({
      type: "usage_update",
      message: `75% of your search limit used. Resets at ${formatResetTime(nextSearchReset)}`,
      actionLabel: "Upgrade",
      onAction: openDotbotUpgradeModal,
    });
  }

  const monthMs = 30 * 24 * 60 * 60 * 1000;
  const genResetAt = new Date(data.generation_credits_reset_at);
  const genExpired = Date.now() - genResetAt.getTime() >= monthMs;
  const genRemaining = genExpired ? 100 : data.generation_credits_remaining;
  const genUsedPct = ((100 - genRemaining) / 100) * 100;
  setUsageFillWidth("profile-usage-generation-fill", genUsedPct);
  const nextGenReset = new Date((genExpired ? Date.now() : genResetAt.getTime()) + monthMs);
  const genTooltip = document.getElementById("profile-usage-generation-tooltip");
  if (genTooltip) genTooltip.textContent = `Resets ${formatResetDate(nextGenReset)}`;
  if (genExpired) appState.genUsageWarned = false;
  if (!appState.genUsageWarned && genUsedPct >= 75) {
    appState.genUsageWarned = true;
    window.pushNotification?.({
      type: "usage_update",
      message: `75% of your generation limit used. Resets ${formatResetDate(nextGenReset)}`,
      actionLabel: "Upgrade",
      onAction: openDotbotUpgradeModal,
    });
  }

  const blocksUsed = totalBlocksUsed();
  setUsageFillWidth("profile-usage-blocks-fill", (blocksUsed / appState.BLOCKS_CAP) * 100);
  const blocksTooltip = document.getElementById("profile-usage-blocks-tooltip");
  if (blocksTooltip) blocksTooltip.textContent = `${blocksUsed}/${appState.BLOCKS_CAP}`;

  if (searchRemaining <= 0) {
    if (!appState.dotbotUpgradePromptedForFullness) {
      appState.dotbotUpgradePromptedForFullness = true;
      openDotbotUpgradeModal();
    }
  } else {
    appState.dotbotUpgradePromptedForFullness = false;
  }
}

export function openDotbotUpgradeModal(): void {
  document.getElementById("dotbot-upgrade-overlay")?.classList.add("open");
}
export function closeDotbotUpgradeModal(): void {
  document.getElementById("dotbot-upgrade-overlay")?.classList.remove("open");
}

// ---------- Pricing / upgrade page ----------
// Phase 2 increment 1: the overlay itself (rendering, PRICING_PLANS/PRICING_FEATURE_ROWS,
// startPlanUpgrade) is real React — see app/dotto/PricingOverlay.jsx. These two stay as thin
// wrappers so every existing caller (the profile menu's "Try Dotto Pro" button via hmenuAction,
// the paid-tier-ad notification's "Upgrade" button, inline onclick="..." attributes bridged
// through window-bridge.js) keeps working unmodified — they just flip the React-owned open state
// (app/dotto/bridges.js) instead of touching the DOM directly.
export function openPricingOverlay(): void {
  window.__closeAllPanels?.(undefined);
  closeProfilePanel();
  window.__setPricingOverlayOpen!(true);
}
export function closePricingOverlay(): void {
  window.__setPricingOverlayOpen!(false);
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): () => void {
  const appState = getAppState();

  // React → vanilla bridges — used by AchievementsGrid.jsx (app/dotto/), which can't import these
  // directly since public/dotto/*.js isn't reachable from app/dotto/. True constants (never
  // reassigned after init), unlike window.__setProfileLevel/__setAchievements (app/dotto-app.jsx),
  // which are store setters for the parts that actually vary. Set here (not at module scope, and
  // not behind a plain readiness check) since appState is only genuinely available once doWire()
  // itself runs — a module-scope `if (window.__getAppState)` check would always be false, since
  // module eval always runs before DottoApp's own render body (where window.__getAppState gets
  // set) ever executes, not just "usually" — same class of bug caught in cardsMisc.ts's own port.
  window.__ACHIEVEMENTS = appState.ACHIEVEMENTS;
  window.__SPRITE_TOTAL_COUNT = appState.SPRITE_TOTAL_COUNT;

  if (appState.currentUser.id) renderProfileLevel();
  renderSpriteGrid();

  // Active-time-only platform-usage tracker for the day_in_platform achievement — only ever
  // advances while the tab is actually visible/focused at the moment each tick fires (no
  // idle/backgrounded time counted), and bumpAchievementStat already no-ops once unlocked, so this
  // stops calling the RPC entirely once the 24h mark is reached.
  const achievementInterval = setInterval(() => {
    if (document.visibilityState === "visible") bumpAchievementStat("day_in_platform", 60);
  }, 60000);

  // Tooltips directly follow the cursor rather than sitting pinned above the row (see the
  // position:absolute/no-transition setup on .profile-usage-tooltip) — offset a few px up and
  // left (see .profile-usage-tooltip's translateX(-100%)) so the cursor itself isn't sitting
  // directly on top of the text it points at.
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".profile-usage-row"));
  const listeners: { row: HTMLElement; fn: (e: MouseEvent) => void }[] = [];
  rows.forEach((row) => {
    const tooltip = row.querySelector<HTMLElement>(".profile-usage-tooltip");
    if (!tooltip) return;
    const fn = (e: MouseEvent) => {
      const rect = row.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left - 12 + "px";
      tooltip.style.top = e.clientY - rect.top - 30 + "px";
    };
    row.addEventListener("mousemove", fn);
    listeners.push({ row, fn });
  });

  window.__wireRailIcon!(
    "profile",
    appState.profileBtn,
    appState.profilePanel,
    refreshProfilePanel,
  );

  return () => {
    clearInterval(achievementInterval);
    listeners.forEach(({ row, fn }) => row.removeEventListener("mousemove", fn));
  };
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx). Needs both window.__getAppState
// AND window.__wireRailIcon (app/dotto/lib/panelsHamburger.ts) ready — renderProfileLevel/
// renderSpriteGrid read live appState.currentUser/unlockedAchievementIds RIGHT at wire time (same
// reasoning app/dotto/lib/dayChangeAndAdNotifications.ts's own wireDayChangeAndAdNotifications gives
// for why a single readiness check isn't enough), and __wireRailIcon needs
// appState.profileBtn/profilePanel to already be real DOM elements (set inside
// app/dotto/lib/coreState.ts's ensureCoreState(), which does run before any useEffect fires, but
// __wireRailIcon itself is set by panelsHamburger.ts's own wireX(), a separate useEffect whose
// relative ordering isn't worth depending on) — polls briefly instead of assuming either.
export function wireProfileAchievementsPricing(): () => void {
  if (window.__getAppState && window.__wireRailIcon) {
    return doWire();
  }

  let cancelled = false;
  let cleanup: (() => void) | null = null;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState && window.__wireRailIcon) {
      clearInterval(poll);
      cleanup = doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
    cleanup?.();
  };
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // Used by app/dotto/lib/gamesFlashcardTyperight.ts's fcFlip/trCheck (Phase 4.4) and
  // app/dotto/lib/canvasPresence.ts's handleCanvasPresenceSync (Phase 4.5).
  window.__awardUserPoints = awardUserPoints;
  window.__bumpAchievementStat = bumpAchievementStat;
  window.__renderAvatarInto = renderAvatarInto;
  // Used by app/dotto/lib/historyAutosave.ts's global Escape keydown handler (Phase 4.5).
  window.__closeDotbotUpgradeModal = closeDotbotUpgradeModal;
  window.__closePricingOverlay = closePricingOverlay;
  // Used by app/dotto/lib/srsConnectionsCore.ts's global keydown handler's ',' shortcut (Phase 4.5).
  window.__showProfileSettingsView = showProfileSettingsView;
  // New bridges for this port — friends-presence.js/drawing-connections.js/
  // search-orchestration-selection.js/hamburger-collab.js/app-init.js/mnemonic-search-matching.js
  // (all still vanilla) used to import these 5 directly.
  window.__refreshDotbotUsage = refreshDotbotUsage;
  window.__closeProfilePanel = closeProfilePanel;
  window.__openDotbotUpgradeModal = openDotbotUpgradeModal;
  // Plain (non-`__`) globals — real inline onclick targets in
  // content/fragments/hamburger-stack.html/canvas-modal.html, same shape window.pushNotification
  // uses. closePricingOverlay's own old plain-global re-export (window-bridge.js) was genuinely
  // dead — grepped for a real caller anywhere (inline HTML, any component) and found none
  // (PricingOverlay.jsx closes itself directly via pricingOverlayStore.set(false); the only real
  // caller of closePricingOverlay at all is historyAutosave.ts's Escape handler, via the
  // __-prefixed bridge above) — not carried forward.
  window.openPricingOverlay = openPricingOverlay;
  window.closeDotbotUpgradeModal = closeDotbotUpgradeModal;
  window.showProfileMainView = showProfileMainView;
  window.showProfileSettingsView = showProfileSettingsView;
}
