import { escapeHtml } from './ai-assistant-suggestions.js';
import { appState, supabase } from './core-state.js';
import { initials } from './friends-presence.js';
import { hmenuAction } from './hamburger-collab.js';
import { closeAllPanels, panelPinned, pinOnInsideClick, scheduleHoverClose } from './panels-hamburger.js';
import { pushNotification } from './stopwatch-search-notifications.js';


    // ---------- Profile Panel Controls ----------
    const profileBtn = document.getElementById('btn-profile'), profilePanel = document.getElementById('profile-panel');

    // 20-tier / 9-sub-rank (180 total sub-level) progression system — canonical source is
    // lib/leveling.js (calculateUserLevel); duplicated here verbatim because this is a classic,
    // non-module script (see app/dotto-app.jsx) that can't import it. Keep the two in sync.
    const LEVEL_NAMES = [
        'Noob', 'Novice', 'Apprentice', 'Learner', 'Scholar', 'Seeker', 'Thinker', 'Strategist',
        'Specialist', 'Expert', 'Master', 'Savant', 'Polymath', 'Brainiac', 'Prodigy', 'Intellect',
        'Visionary', 'Titan', 'Archon', 'Omniscient',
    ];
    const SUB_RANKS_PER_TIER = 9;
    const TOTAL_SUB_LEVELS = LEVEL_NAMES.length * SUB_RANKS_PER_TIER; // 180
    const LEVEL_GROWTH_RATE = 1.045;
    const LEVEL_BASE_POINTS = 100;
    function scoreRequiredForLevel(level) {
        if (level <= 1) return 0;
        return Math.floor(LEVEL_BASE_POINTS * (Math.pow(LEVEL_GROWTH_RATE, level - 1) - 1) / (LEVEL_GROWTH_RATE - 1));
    }
    function calculateUserLevel(score) {
        const totalScore = Math.max(0, Math.floor(score || 0));
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
            pushNotification({ type: 'level_up', message: `Level up! You're now ${newLevel.displayName}` }); // no buttons, auto-dismisses — no dismiss function
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
        const hue = Math.round((tierIndex * 360) / LEVEL_NAMES.length);
        return `hsl(${hue}, 62%, 38%)`;
    }
    function renderProfileLevel() {
        if (!appState.currentUser.id) return;
        const lvl = calculateUserLevel(appState.currentUser.totalScore);
        const pillEl = document.getElementById('profile-level-pill');
        if (!pillEl) return;
        const textEl = pillEl.querySelector('.profile-level-pill-text');
        if (textEl) textEl.textContent = lvl.displayName;
        pillEl.style.background = levelTierColor(lvl.tierIndex);
        pillEl.style.color = '#fff';
    }
    // Populates the flame+day-count streak pill from currentUser.loginStreak, computed
    // server-side once per page load (see bump_login_streak / app/page.js) — there's nothing to
    // recompute client-side, this just displays it.
    function renderProfileStreak() {
        if (!appState.currentUser.id) return;
        const el = document.getElementById('profile-streak-count');
        if (el) el.textContent = appState.currentUser.loginStreak || 0;
    }
    // `avatar` is { id, url } — url is the saved custom avatar-builder composite (Supabase
    // Storage public URL, once a user completes /avatar-setup) and always wins when present;
    // id falls back to the older static /assets/avatar/avatar-{n}.png set (0 = default
    // silhouette) for accounts that haven't built a custom avatar. Falls back to initials if the
    // resolved src fails to load.
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
        document.getElementById('profile-username').textContent = appState.currentUser.displayName;
        const avatar = { id: appState.currentUser.avatarId ?? 0, url: appState.currentUser.avatarUrl || null };
        renderAvatarInto(document.getElementById('profile-avatar'), avatar, initials(appState.currentUser.displayName));
        renderAvatarInto(document.getElementById('profile-avatar-sm'), avatar, initials(appState.currentUser.displayName));
        renderProfileLevel();
        renderProfileStreak();
    }

    // ---------- Achievements ----------
    // Backs the spritebook below: each of the first 8 sprite slots is tied to one achievement,
    // tracked server-side via the generic bump_achievement_stat RPC (see
    // supabase/migrations/20260730_add_achievements.sql) rather than one bespoke column/RPC per
    // achievement. statKey/threshold are client-defined constants passed straight to the RPC —
    // not security-sensitive, same trust level as awardUserPoints' p_points above.
    const ACHIEVEMENTS = [
        { id: 'first_block',      statKey: 'blocks_placed',    threshold: 1,     name: 'Place your first block',        spriteIndex: 1 },
        { id: 'three_friends',    statKey: 'friends_added',    threshold: 3,     name: 'Add three friends',              spriteIndex: 2 },
        { id: 'five_scheduled',   statKey: 'blocks_scheduled', threshold: 5,     name: 'Schedule five blocks',           spriteIndex: 3 },
        { id: 'twenty_searches',  statKey: 'ai_searches',      threshold: 20,    name: 'Make twenty AI searches',        spriteIndex: 4 },
        { id: 'fifty_links',      statKey: 'data_links',       threshold: 50,    name: 'Make fifty links in data mode',  spriteIndex: 5 },
        { id: 'hundred_flips',    statKey: 'flashcard_flips',  threshold: 100,   name: 'Flip one hundred cards',         spriteIndex: 6 },
        { id: 'master_250_words', statKey: 'words_mastered',   threshold: 250,   name: 'Master 250 words',               spriteIndex: 7 },
        { id: 'day_in_platform',  statKey: 'platform_seconds', threshold: 86400, name: 'Spend 24 hours in the platform', spriteIndex: 8 },
    ];
    const unlockedAchievementIds = new Set(appState.currentUser.unlockedAchievementIds || []);

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
        if (unlockedAchievementIds.has(achievementId)) return; // already unlocked — stop paying for RPC calls
        const def = ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!def) return;
        const { data, error } = await supabase.rpc('bump_achievement_stat', {
            p_user_id: appState.currentUser.id, p_stat_key: def.statKey, p_achievement_id: def.id,
            p_threshold: def.threshold, p_delta: delta, p_absolute: absolute,
        });
        if (error) { console.error('[achievements] bump_achievement_stat failed:', error); return; }
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.newly_unlocked) {
            unlockedAchievementIds.add(def.id);
            const grid = document.getElementById('profile-sprite-grid');
            if (grid) renderSpriteGrid(grid, SPRITE_TOTAL_COUNT);
            pushNotification({ type: 'achievement_unlock', message: `Achievement unlocked! (${def.name})` });
            pushNotification({ type: 'achievement_unlock', message: `Sprite ${def.spriteIndex} will spawn soon` });
        }
    }

    // Static asset grid, dropped into /public/sprites by hand: the first 8 cells are the
    // achievement-tied sprites above, each showing its own locked/unlocked art
    // (sprite-N-locked.png / sprite-N.png) based on unlockedAchievementIds; every cell after that
    // has no achievement at all, so it always shows the shared unknown-sprite.png regardless of
    // any state. A cell with a missing file just shows its empty placeholder space rather than a
    // broken-image icon. Always renders the full set (no separate compact/expanded view) — the
    // block itself just grows to fill the panel and scrolls internally (see
    // #profile-spritebook-block/positionProfilePanel).
    const SPRITE_TOTAL_COUNT = 108;
    function renderSpriteGrid(container, count) {
        container.innerHTML = '';
        for (let i = 1; i <= count; i++) {
            const cell = document.createElement('div');
            cell.className = 'profile-sprite-cell';
            const img = document.createElement('img');
            img.src = i > ACHIEVEMENTS.length ? '/sprites/unknown-sprite.png'
                : unlockedAchievementIds.has(ACHIEVEMENTS[i - 1].id) ? `/sprites/sprite-${i}.png` : `/sprites/sprite-${i}-locked.png`;
            img.alt = '';
            img.onerror = () => img.remove();
            cell.appendChild(img);
            container.appendChild(cell);
        }
    }
    // Active-time-only platform-usage tracker for the day_in_platform achievement — only ever
    // advances while the tab is actually visible/focused at the moment each tick fires (no
    // idle/backgrounded time counted), and bumpAchievementStat already no-ops once unlocked, so
    // this stops calling the RPC entirely once the 24h mark is reached.
    setInterval(() => {
        if (document.visibilityState === 'visible') bumpAchievementStat('day_in_platform', 60);
    }, 60000);
    renderSpriteGrid(document.getElementById('profile-sprite-grid'), SPRITE_TOTAL_COUNT);
    function closeProfilePanel() { profilePanel.classList.remove('open'); profileBtn.classList.remove('active'); panelPinned.profile = false; }
    // Panel height is set explicitly (not just left to CSS) so #profile-spritebook-block's
    // flex:1 has an actual constrained container to grow into and scroll within, filling from
    // the button down to a fixed margin above the bottom of the viewport — same margin
    // convention as #hamburger-stack.
    function positionProfilePanel() {
        const rect = profileBtn.getBoundingClientRect();
        const top = rect.bottom + 10;
        profilePanel.style.top = top + 'px';
        const panelWidth = 240;
        let leftPos = rect.right - panelWidth;
        if (leftPos < 20) leftPos = 20;
        profilePanel.style.left = leftPos + 'px';
        profilePanel.style.right = 'auto';
        profilePanel.style.height = (window.innerHeight - top - 20) + 'px';
    }
    // Keeps the panel's explicit height (see positionProfilePanel) matching the viewport if the
    // window is resized while it's open — otherwise it'd be stuck at whatever height was current
    // at open time.
    window.addEventListener('resize', () => { if (profilePanel.classList.contains('open')) positionProfilePanel(); });
    function openProfilePanel(pin) {
        closeAllPanels('profile');
        profilePanel.classList.add('open');
        profileBtn.classList.add('active');
        positionProfilePanel();
        refreshDotbotUsage();
        // Always start at the top of the sprite grid, not wherever it happened to be scrolled to
        // last time the panel was open.
        const sbScroll = document.getElementById('profile-spritebook-scroll');
        if (sbScroll) sbScroll.scrollTop = 0;
        if (pin) panelPinned.profile = true;
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
    const BLOCKS_CAP = 100;
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
    let searchUsageWarned = false, genUsageWarned = false;
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
        if (searchExpired) searchUsageWarned = false;
        if (!searchUsageWarned && searchUsedPct >= 75) {
            searchUsageWarned = true;
            pushNotification({ type: 'usage_update', message: `75% of your search limit used. Resets at ${formatResetTime(nextSearchReset)}`, actionLabel: 'Upgrade', onAction: openDotbotUpgradeModal });
        }

        const monthMs = 30 * 24 * 60 * 60 * 1000;
        const genResetAt = new Date(data.generation_credits_reset_at);
        const genExpired = Date.now() - genResetAt.getTime() >= monthMs;
        const genRemaining = genExpired ? 100 : data.generation_credits_remaining;
        const genUsedPct = ((100 - genRemaining) / 100) * 100;
        setUsageFillWidth('profile-usage-generation-fill', genUsedPct);
        const nextGenReset = new Date((genExpired ? Date.now() : genResetAt.getTime()) + monthMs);
        document.getElementById('profile-usage-generation-tooltip').textContent = `Resets ${formatResetDate(nextGenReset)}`;
        if (genExpired) genUsageWarned = false;
        if (!genUsageWarned && genUsedPct >= 75) {
            genUsageWarned = true;
            pushNotification({ type: 'usage_update', message: `75% of your generation limit used. Resets ${formatResetDate(nextGenReset)}`, actionLabel: 'Upgrade', onAction: openDotbotUpgradeModal });
        }

        const blocksUsed = totalBlocksUsed();
        setUsageFillWidth('profile-usage-blocks-fill', (blocksUsed / BLOCKS_CAP) * 100);
        document.getElementById('profile-usage-blocks-tooltip').textContent = `${blocksUsed}/${BLOCKS_CAP}`;

        if (searchRemaining <= 0) {
            if (!appState.dotbotUpgradePromptedForFullness) { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
        } else {
            appState.dotbotUpgradePromptedForFullness = false;
        }
    }
    function openDotbotUpgradeModal() { document.getElementById('dotbot-upgrade-overlay').classList.add('open'); }
    function closeDotbotUpgradeModal() { document.getElementById('dotbot-upgrade-overlay').classList.remove('open'); }

    // ---------- Pricing / upgrade page ----------
    // Full-screen 3-tier comparison (Free/Pro/Polyglot) — opened from the profile menu's "Try
    // Dotto Pro" button (see hmenuAction) and the paid-tier-ad notification's "Upgrade" button
    // (see the ad notification setup further down). Placeholder prices/taglines/features — no
    // real billing/subscription system exists in this codebase yet, so the paid CTAs surface a
    // "coming soon" notification instead of pretending to start a real checkout.
    const PRICING_PLANS = [
        { id: 'free', name: 'Free', price: '$0', period: '/mo', tagline: 'Get started with the basics.', cta: 'Current Plan', current: true },
        { id: 'pro', name: 'Pro', price: '$9', period: '/mo', tagline: 'For learners leveling up fast.', cta: 'Upgrade to Pro', featured: true },
        { id: 'polyglot', name: 'Polyglot', price: '$19', period: '/mo', tagline: 'Go all in on every language.', cta: 'Upgrade to Polyglot' },
    ];
    // Each row's `values` is [free, pro, polyglot] — same index lines up across all three cards.
    // A falsy value means that plan doesn't get this feature; it's still shown (greyed, with a
    // dash) using whichever plan's value is truthy, so the row reads the same across all 3 cards.
    const PRICING_FEATURE_ROWS = [
        { values: ['100 canvas blocks', '500 canvas blocks', 'Unlimited canvas blocks'] },
        { values: ['30 Dotbot searches / 6h', '150 Dotbot searches / 6h', 'Unlimited Dotbot searches'] },
        { values: ['100 Dotbot generations / mo', '500 Dotbot generations / mo', 'Unlimited Dotbot generations'] },
        { values: ['Unlimited canvases & waypoints', 'Unlimited canvases & waypoints', 'Unlimited canvases & waypoints'] },
        { values: ['Friends & collaboration', 'Friends & collaboration', 'Friends & collaboration'] },
        { values: [null, 'Priority support', 'Priority support'] },
        { values: [null, null, 'Early access to new features'] },
    ];
    function renderPricingOverlay() {
        const container = document.getElementById('pricing-cards');
        if (!container) return;
        container.innerHTML = '';
        PRICING_PLANS.forEach((plan, i) => {
            const card = document.createElement('div');
            card.className = 'pricing-card' + (plan.featured ? ' pricing-card-featured' : '');
            const featuresHtml = PRICING_FEATURE_ROWS.map(row => {
                const value = row.values[i];
                const label = value || row.values.find(Boolean);
                const excluded = !value;
                return `<li class="${excluded ? 'pricing-feature-excluded' : ''}"><span class="pricing-feature-icon">${excluded ? '–' : '✓'}</span>${escapeHtml(label)}</li>`;
            }).join('');
            card.innerHTML = `
                ${plan.featured ? '<div class="pricing-card-badge">Most Popular</div>' : ''}
                <div class="pricing-card-name">${escapeHtml(plan.name)}</div>
                <div class="pricing-card-price"><span class="pricing-card-price-amount">${escapeHtml(plan.price)}</span><span class="pricing-card-price-period">${escapeHtml(plan.period)}</span></div>
                <div class="pricing-card-tagline">${escapeHtml(plan.tagline)}</div>
                <button class="pricing-card-cta" type="button" ${plan.current ? 'disabled' : ''}>${escapeHtml(plan.cta)}</button>
                <div class="pricing-card-divider"></div>
                <ul class="pricing-card-features">${featuresHtml}</ul>
            `;
            if (!plan.current) card.querySelector('.pricing-card-cta').onclick = () => startPlanUpgrade(plan.id);
            container.appendChild(card);
        });
    }
    function openPricingOverlay() {
        closeAllPanels(null);
        closeProfilePanel();
        renderPricingOverlay();
        document.getElementById('pricing-overlay').classList.add('open');
    }
    function closePricingOverlay() {
        const el = document.getElementById('pricing-overlay');
        if (el) el.classList.remove('open');
    }
    function startPlanUpgrade(planId) {
        closePricingOverlay();
        pushNotification({ type: 'upgrade_unavailable', message: "Upgrades aren't available yet — check back soon!" }); // no buttons, auto-dismisses
    }
    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Once the button is showing the power icon (:hover only — see the CSS swap, which is
        // deliberately not also tied to .active/panel-open), clicking it logs out instead of
        // toggling the panel — that's the whole point of the swap. A genuine mouse click can
        // only land while the cursor is over the button, so :hover is already true in normal
        // use; the toggle-panel branch mainly exists so a keyboard-only "click" (Enter with no
        // prior hover) opens the panel on its first activation rather than logging out blind.
        if (profileBtn.matches(':hover')) { hmenuAction('logout'); }
        else { openProfilePanel(true); }
    });
    profileBtn.addEventListener('mouseenter', () => { if (!profilePanel.classList.contains('open')) openProfilePanel(false); });
    profileBtn.addEventListener('mouseleave', () => scheduleHoverClose('profile', [profileBtn, profilePanel], closeProfilePanel));
    profilePanel.addEventListener('mouseleave', () => scheduleHoverClose('profile', [profileBtn, profilePanel], closeProfilePanel));
    pinOnInsideClick('profile', [profilePanel]);

export { awardUserPoints, bumpAchievementStat, closeDotbotUpgradeModal, closePricingOverlay, closeProfilePanel, openDotbotUpgradeModal, openPricingOverlay, profilePanel, refreshDotbotUsage, renderAvatarInto };
