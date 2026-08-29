import { appState, supabase } from './core-state.js';
import { closeAllPanels, closeRailView, wireRailIcon } from './panels-hamburger.js';


    // ---------- Profile Panel Controls ----------

    // 20-tier / 9-sub-rank (180 total sub-level) progression system — canonical source is
    // lib/leveling.js (calculateUserLevel); duplicated here verbatim because this is a classic,
    // non-module script (see app/dotto-app.jsx) that can't import it. Keep the two in sync.
 // 180
    function scoreRequiredForLevel(level) {
        if (level <= 1) return 0;
        return Math.floor(appState.LEVEL_BASE_POINTS * (Math.pow(appState.LEVEL_GROWTH_RATE, level - 1) - 1) / (appState.LEVEL_GROWTH_RATE - 1));
    }
    function calculateUserLevel(score) {
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
        const progressPercentage = isMaxLevel ? 100 : Math.max(0, Math.min(100, (currentLevelScore / nextLevelScore) * 100));
        return { totalScore, absoluteLevel, tierIndex, tierName, subRank, displayName: `${tierName} ${subRank}`, currentLevelScore, nextLevelScore, progressPercentage };
    }
    // Centralized score-award entry point for every client-side action that grants points (chat
    // message, canvas block, flashcard flip, ...) — mirrors lib/leveling.js's awardUserPoints,
    // duplicated for the same no-import-system reason as calculateUserLevel above. Re-renders the
    // profile level display live on success so the user sees the change immediately, without
    // needing a page refresh.
    async function awardUserPoints(actionType, points) {
        if (!supabase || !appState.currentUser.id) return { ok: false, reason: 'no_session' };
        const oldLevel = calculateUserLevel(appState.currentUser.totalScore);
        const { data, error } = await supabase.rpc('award_user_points', { p_user_id: appState.currentUser.id, p_action_type: actionType, p_points: points });
        if (error) { console.error('[leveling] award_user_points failed:', error); return { ok: false, reason: 'error' }; }
        appState.currentUser.totalScore = data;
        renderProfileLevel();
        const newLevel = calculateUserLevel(appState.currentUser.totalScore);
        if (newLevel.absoluteLevel > oldLevel.absoluteLevel) {
            window.pushNotification({ type: 'level_up', message: `Level up! You're now ${newLevel.displayName}` }); // no buttons, auto-dismisses — no dismiss function
        }
        return { ok: true, totalScore: data };
    }
    // Populates #profile-level-pill's text (e.g. "Noob 1") and per-tier colour from
    // currentUser.totalScore — called once on init (below) and again after awardUserPoints so it
    // updates live. One CSS rule can't express 20 different tier colours, so the pill's
    // background/text colour is generated here instead of hardcoded per tier: an even hue step
    // per tier around the wheel (360/20 = 18°) keeps every tier visually distinct without hand
    // -picking 20 hex values, and automatically stays distinct if LEVEL_NAMES ever grows/shrinks.
    function levelTierColor(tierIndex) {
        const hue = Math.round((tierIndex * 360) / appState.LEVEL_NAMES.length);
        return `hsl(${hue}, 62%, 38%)`;
    }
    // Real React state now (see app/dotto/ProfileLevelPill.jsx, profileLevelStore) — text +
    // background color both move together as one store value.
    function renderProfileLevel() {
        if (!appState.currentUser.id) return;
        const lvl = calculateUserLevel(appState.currentUser.totalScore);
        window.__setProfileLevel({ displayName: lvl.displayName, tierColor: levelTierColor(lvl.tierIndex) });
    }
    // `avatar` is { id, url } — url is the saved custom avatar-builder composite (Supabase
    // Storage public URL, once a user completes /avatar-setup) and always wins when present;
    // id falls back to the older static /assets/avatar/avatar-{n}.png set (0 = default
    // silhouette) for accounts that haven't built a custom avatar. Falls back to initials if the
    // resolved src fails to load. Still used for every OTHER avatar spot in the app (remote cursor
    // labels, message/friends/per-canvas-collab rows) — only the profile panel's own avatar/
    // avatar-sm/username/streak are React-owned now (see app/dotto/ProfileIdentity.jsx), since
    // those four never change after initial page load (unlike this function's other callers,
    // which render a DIFFERENT person's avatar each time) and window.__DOTTO_USER__ (already set
    // once during DottoApp's own render, app/dotto-app.jsx) already carries the exact same data.
    function renderAvatarInto(el, avatar, fallbackText) {
        if (!el) return;
        const src = (avatar && avatar.url) ? avatar.url : `/assets/avatar/avatar-${(avatar && avatar.id) || 0}.png`;
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.onerror = () => { el.innerHTML = ''; el.textContent = fallbackText; };
        el.innerHTML = '';
        el.appendChild(img);
    }
    if (appState.currentUser.id) {
        renderProfileLevel();
    }

    // ---------- Achievements ----------
    // Backs the spritebook below: each of the first 8 sprite slots is tied to one achievement,
    // tracked server-side via the generic bump_achievement_stat RPC (see
    // supabase/migrations/20260730_add_achievements.sql) rather than one bespoke column/RPC per
    // achievement. statKey/threshold are client-defined constants passed straight to the RPC —
    // not security-sensitive, same trust level as awardUserPoints' p_points above.

    // Bumps one achievement's stat counter and, if it just crossed its threshold, unlocks it: the
    // spritebook re-renders live and two notifications queue up in order — "Achievement unlocked!
    // (name)" then "Sprite N will spawn soon". The actual on-canvas spawn isn't implemented yet
    // (deliberately deferred to a follow-up pass) — this only announces it.
    //
    // delta/absolute mirror bump_achievement_stat's two counter modes: plain incrementing tallies
    // (the default) for most achievements, vs. `absolute` for stats where the caller already knows
    // its own true current total (e.g. three_friends passes friends.length, which is symmetric
    // regardless of who sent/accepted the request, so it just needs to be synced in, never
    // regressed).
    async function bumpAchievementStat(achievementId, delta = 1, absolute = false) {
        if (!supabase || !appState.currentUser.id) return;
        if (appState.unlockedAchievementIds.has(achievementId)) return; // already unlocked — stop paying for RPC calls
        const def = appState.ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!def) return;
        const { data, error } = await supabase.rpc('bump_achievement_stat', {
            p_user_id: appState.currentUser.id, p_stat_key: def.statKey, p_achievement_id: def.id,
            p_threshold: def.threshold, p_delta: delta, p_absolute: absolute,
        });
        if (error) { console.error('[achievements] bump_achievement_stat failed:', error); return; }
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.newly_unlocked) {
            appState.unlockedAchievementIds.add(def.id);
            renderSpriteGrid();
            window.pushNotification({ type: 'achievement_unlock', message: `Achievement unlocked! (${def.name})` });
            window.pushNotification({ type: 'achievement_unlock', message: `Sprite ${def.spriteIndex} will spawn soon` });
        }
    }

    // Real React state now (see app/dotto/AchievementsGrid.jsx, achievementsStore) — genuine JSX
    // cells: the first 8 are the achievement-tied sprites, each showing its own locked/unlocked
    // art (sprite-N-locked.png / sprite-N.png) based on unlockedAchievementIds; every cell after
    // that has no achievement at all, so it always shows the shared unknown-sprite.png regardless
    // of any state. window.__ACHIEVEMENTS/__SPRITE_TOTAL_COUNT (below) are true constants (never
    // reassigned after init), bridged once rather than routed through the store — only
    // unlockedAchievementIds actually varies over a session.
    function renderSpriteGrid() {
        window.__setAchievements(Array.from(appState.unlockedAchievementIds));
    }
    // Active-time-only platform-usage tracker for the day_in_platform achievement — only ever
    // advances while the tab is actually visible/focused at the moment each tick fires (no
    // idle/backgrounded time counted), and bumpAchievementStat already no-ops once unlocked, so
    // this stops calling the RPC entirely once the 24h mark is reached.
    setInterval(() => {
        if (document.visibilityState === 'visible') bumpAchievementStat('day_in_platform', 60);
    }, 60000);
    renderSpriteGrid();
    // Profile shares the permanent rail's one shell/pinned-state now (see openRailView,
    // panels-hamburger.js) — no more of its own positionProfilePanel/resize listener (the shell is
    // already positioned beside the rail, full-height, no per-panel height to keep in sync).
    // closeProfilePanel stays a named export (hamburger-collab.js calls it directly); opening goes
    // through the generic wireRailIcon('profile', ...) below now, same as every other rail icon —
    // the hover-to-logout swap that used to need its own hand-written click handler here is gone
    // (logout is a small button inside the panel's identity block now, see hamburger-stack.html).
    function closeProfilePanel() { closeRailView(); }
    // Two internal sub-views of #profile-panel, toggled independently of the outer rail's own
    // open/close state — same shape as showAiListView/showAiChatView (ai-assistant-suggestions.js).
    // #profile-settings-view holds the old #settings-panel's content (Brightness Theme, Sidebar
    // Mode), moved here once Settings was removed as its own rail icon, per explicit request.
    function showProfileMainView() {
        appState.profileSettingsView.classList.remove('open');
        appState.profileMainView.classList.add('open');
    }
    function showProfileSettingsView() {
        appState.profileMainView.classList.remove('open');
        appState.profileSettingsView.classList.add('open');
    }
    function refreshProfilePanel() {
        // Always land on the main view, not wherever the panel was left last time (e.g. mid-
        // Settings via the 'z' shortcut, srs-connections-core.js, which switches to the settings
        // view again right after this runs).
        showProfileMainView();
        refreshDotbotUsage();
        // Always start at the top of the sprite grid, not wherever it happened to be scrolled to
        // last time the panel was open.
        const sbScroll = document.getElementById('profile-spritebook-scroll');
        if (sbScroll) sbScroll.scrollTop = 0;
    }

    function ordinalSuffix(n) {
        const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }
    function formatResetTime(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    function formatResetDate(d) {
        const day = d.getDate();
        return `${d.toLocaleDateString(undefined, { month: 'long' })} ${day}${ordinalSuffix(day)}`;
    }
    // Total cards across every canvas the user has, regardless of which one is currently open —
    // a pure client-side count (no new column), since the whole workspace is already loaded in
    // memory. Never resets; the only way down is deleting cards (or, eventually, upgrading).
    function totalBlocksUsed() {
        return Object.values(appState.folders).reduce((sum, f) => sum + (f.items ? f.items.length : 0), 0);
    }

    // Fills all three usage bars — split across the two independent credit pools (search: 30
    // per 6h, generation: 100 per month — see lib/dotbot.js) plus the client-computed blocks
    // count. Bar-only, no numbers anywhere; each fills UP as usage goes up. Mirrors each RPC's
    // own lazy-reset logic purely for display, without writing anything.
    // Same "warn once per cycle" pattern as dotbotUpgradePromptedForFullness above — reset back
    // to false once the credits actually reset (searchExpired/genExpired below), so the next
    // cycle can warn again.
    function setUsageFillWidth(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }
    // Tooltips directly follow the cursor rather than sitting pinned above the row (see the
    // position:absolute/no-transition setup on .profile-usage-tooltip) — offset a few px up and
    // left (see .profile-usage-tooltip's translateX(-100%)) so the cursor itself isn't sitting
    // directly on top of the text it points at.
    document.querySelectorAll('.profile-usage-row').forEach(row => {
        const tooltip = row.querySelector('.profile-usage-tooltip');
        if (!tooltip) return;
        row.addEventListener('mousemove', (e) => {
            const rect = row.getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left - 12) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
        });
    });
    async function refreshDotbotUsage() {
        const searchFill = document.getElementById('profile-usage-search-fill');
        if (!searchFill || !supabase || !appState.currentUser.id) return;
        const blocksFillEl = document.getElementById('profile-usage-blocks-fill');
        const genFillEl = document.getElementById('profile-usage-generation-fill');
        // Every time the panel opens, the bars should visibly fill up from empty — not animate
        // from wherever they happened to be left last time. Snap to 0% instantly (transition
        // disabled for this one write) before the real target widths below animate in normally.
        const allFills = [searchFill, blocksFillEl, genFillEl];
        allFills.forEach(el => { el.style.transition = 'none'; el.style.width = '0%'; });
        void searchFill.offsetWidth; // commit the instant 0% before re-enabling the transition
        allFills.forEach(el => { el.style.transition = ''; });

        const { data, error } = await supabase
            .from('profiles')
            .select('search_credits_remaining, search_credits_reset_at, generation_credits_remaining, generation_credits_reset_at')
            .eq('id', appState.currentUser.id)
            .single();
        if (error || !data) return;

        const sixHoursMs = 6 * 60 * 60 * 1000;
        const searchResetAt = new Date(data.search_credits_reset_at);
        const searchExpired = Date.now() - searchResetAt.getTime() >= sixHoursMs;
        const searchRemaining = searchExpired ? 30 : data.search_credits_remaining;
        const searchUsedPct = ((30 - searchRemaining) / 30) * 100;
        setUsageFillWidth('profile-usage-search-fill', searchUsedPct);
        const nextSearchReset = new Date((searchExpired ? Date.now() : searchResetAt.getTime()) + sixHoursMs);
        document.getElementById('profile-usage-search-tooltip').textContent = `Resets at ${formatResetTime(nextSearchReset)}`;
        if (searchExpired) appState.searchUsageWarned = false;
        if (!appState.searchUsageWarned && searchUsedPct >= 75) {
            appState.searchUsageWarned = true;
            window.pushNotification({ type: 'usage_update', message: `75% of your search limit used. Resets at ${formatResetTime(nextSearchReset)}`, actionLabel: 'Upgrade', onAction: openDotbotUpgradeModal });
        }

        const monthMs = 30 * 24 * 60 * 60 * 1000;
        const genResetAt = new Date(data.generation_credits_reset_at);
        const genExpired = Date.now() - genResetAt.getTime() >= monthMs;
        const genRemaining = genExpired ? 100 : data.generation_credits_remaining;
        const genUsedPct = ((100 - genRemaining) / 100) * 100;
        setUsageFillWidth('profile-usage-generation-fill', genUsedPct);
        const nextGenReset = new Date((genExpired ? Date.now() : genResetAt.getTime()) + monthMs);
        document.getElementById('profile-usage-generation-tooltip').textContent = `Resets ${formatResetDate(nextGenReset)}`;
        if (genExpired) appState.genUsageWarned = false;
        if (!appState.genUsageWarned && genUsedPct >= 75) {
            appState.genUsageWarned = true;
            window.pushNotification({ type: 'usage_update', message: `75% of your generation limit used. Resets ${formatResetDate(nextGenReset)}`, actionLabel: 'Upgrade', onAction: openDotbotUpgradeModal });
        }

        const blocksUsed = totalBlocksUsed();
        setUsageFillWidth('profile-usage-blocks-fill', (blocksUsed / appState.BLOCKS_CAP) * 100);
        document.getElementById('profile-usage-blocks-tooltip').textContent = `${blocksUsed}/${appState.BLOCKS_CAP}`;

        if (searchRemaining <= 0) {
            if (!appState.dotbotUpgradePromptedForFullness) { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
        } else {
            appState.dotbotUpgradePromptedForFullness = false;
        }
    }
    function openDotbotUpgradeModal() { document.getElementById('dotbot-upgrade-overlay').classList.add('open'); }
    function closeDotbotUpgradeModal() { document.getElementById('dotbot-upgrade-overlay').classList.remove('open'); }

    // ---------- Pricing / upgrade page ----------
    // Phase 2 increment 1: the overlay itself (rendering, PRICING_PLANS/PRICING_FEATURE_ROWS,
    // startPlanUpgrade) is now real React — see app/dotto/PricingOverlay.jsx. These two stay as
    // thin wrappers so every existing caller (the profile menu's "Try Dotto Pro" button via
    // hmenuAction, the paid-tier-ad notification's "Upgrade" button, inline onclick="..."
    // attributes bridged through window-bridge.js) keeps working unmodified — they just flip the
    // React-owned open state (app/dotto/bridges.js) instead of touching the DOM directly now.
    function openPricingOverlay() {
        closeAllPanels(null);
        closeProfilePanel();
        window.__setPricingOverlayOpen(true);
    }
    function closePricingOverlay() {
        window.__setPricingOverlayOpen(false);
    }
    wireRailIcon('profile', appState.profileBtn, appState.profilePanel, refreshProfilePanel);

export { awardUserPoints, bumpAchievementStat, closeDotbotUpgradeModal, closePricingOverlay, closeProfilePanel, openDotbotUpgradeModal, openPricingOverlay, refreshDotbotUsage, renderAvatarInto, showProfileMainView, showProfileSettingsView };

// React → vanilla bridge — used by AchievementsGrid.jsx (app/dotto/), which can't import these
// directly since public/dotto/*.js isn't reachable from app/dotto/. True constants (never
// reassigned after init), unlike window.__setProfileLevel/__setAchievements (app/dotto-app.jsx),
// which are store setters for the parts that actually vary.
window.__ACHIEVEMENTS = appState.ACHIEVEMENTS;
window.__SPRITE_TOTAL_COUNT = appState.SPRITE_TOTAL_COUNT;
