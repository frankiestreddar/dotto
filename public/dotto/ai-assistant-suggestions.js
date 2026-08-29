import { updateCommandPalette } from './command-palette.js';
import { appState, canvas, itemElId } from './core-state.js';
import { renderChatsList } from './hamburger-collab.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { commenceSearchOrMnemonic } from './mnemonic-search-matching.js';
import { closeAllPanels, closeRailView, openRailView } from './panels-hamburger.js';
import { autoGrowSearchInput } from './stopwatch-search-notifications.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Animated Placeholder (types out & deletes a looping series of suggestions) ----------
    // Every searchbox in the app does this — per explicit request, not just Queries' own
    // #search-input (which is all this ever drove originally). #search-panel-search
    // (search-panel-history.js) is the other one so far; both are plain elements with a
    // `.placeholder` property (a <textarea> and an <input>), set identically here regardless of
    // which, so adding a future box just means adding its selector below.
    (function animateSearchPlaceholder() {
        const targets = [appState.searchInput, document.getElementById('search-panel-search')].filter(Boolean);
        if (!targets.length) return;
        const suggestions = [
            'Find anything in your canvas...',
            'Ask me how to conjugate verbs...',
            'Generate a mnemonic for ananas...'
        ];
        const TYPE_SPEED = 60, DELETE_SPEED = 45, PAUSE_AFTER_TYPE = 2400, PAUSE_AFTER_DELETE = 800;
        let sIndex = 0, charIndex = 0, deleting = false;
        function tick() {
            const current = suggestions[sIndex];
            if (!deleting) {
                charIndex++;
                targets.forEach(t => { t.placeholder = current.slice(0, charIndex); });
                if (charIndex >= current.length) {
                    deleting = true;
                    setTimeout(tick, PAUSE_AFTER_TYPE);
                    return;
                }
                setTimeout(tick, TYPE_SPEED);
            } else {
                charIndex--;
                targets.forEach(t => { t.placeholder = current.slice(0, charIndex); });
                if (charIndex <= 0) {
                    deleting = false;
                    sIndex = (sIndex + 1) % suggestions.length;
                    setTimeout(tick, PAUSE_AFTER_DELETE);
                    return;
                }
                setTimeout(tick, DELETE_SPEED);
            }
        }
        tick();
    })();

    function stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return (div.textContent || '').trim();
    }
    // "Entries" for a source card's count badge: data rows only (tableData[0] is the column-name
    // header row, never a real entry), only rows with at least one non-blank cell.
    function countSourceEntries(folderId) {
        const f = appState.folders[folderId];
        const tableItem = f && (f.items || []).find(i => i.kind === 'table');
        if (!tableItem || !tableItem.tableData) return 0;
        return tableItem.tableData.slice(1).filter(row => row.some(cell => stripHtml(cell))).length;
    }
    // The TRUE structural parent of a folder — the folder that actually contains a
    // folder/source card pointing at it — not "whatever we happened to navigate from before
    // this" (that's historyStack/historyIndex, a separate, purely click-order concept used only
    // for the back/forward buttons). Folders don't store their own parent, so this is a reverse
    // lookup; used by the breadcrumb's ".." so it reflects real canvas hierarchy regardless of
    // how you arrived here (drilling in, a waypoint jump, search, the hamburger menu, ...).
    // Root has no parent (nothing ever points at it), so this naturally returns null for it.
    function findParentFolderId(folderId) {
        for (const fid in appState.folders) {
            const f = appState.folders[fid];
            if ((f.items || []).some(it => (it.kind === 'folder' || it.kind === 'source') && it.folderId === folderId)) return fid;
        }
        return null;
    }
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    // True when `s` is entirely Latin-script (+ digits/whitespace/common punctuation) -- used to
    // suppress a dictionary/example transliteration line even if the model returns one anyway.
    // The prompt already tells it to omit transliteration/romanization for already-Latin words
    // (see lib/dotbot.js), but that is a request, not a guarantee -- this is a client-side backstop
    // so a stray romaji-style line never shows up next to plain English/Spanish/French/etc. text,
    // regardless of how reliably any given model actually follows that instruction. Built from
    // explicit \uXXXX escapes (never raw high-codepoint characters in the source) covering Basic
    // Latin + Latin-1 Supplement + Latin Extended A/B (U+0000-U+024F), Latin Extended Additional
    // (U+1E00-U+1EFF, Vietnamese diacritics), and General Punctuation (U+2000-U+206F) -- anything
    // outside those ranges (plus \s/\d) left over after stripping means a non-Latin script is
    // actually present.
    function isLatinScriptText(s) {
        if (!s) return true;
        return !appState.NON_LATIN_SCRIPT_RE.test(s);
    }
    function speakerIconHTML(extraClass) {
        const url = '/assets/icons/speaker.png';
        return `<span class="${extraClass || ''} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
    }
    // Builds the {text, romanization, translation} elements for one example sentence — shared by
    // the examples panel (buildExamplesCard) and the "example" blocks inside an in-depth
    // grammar/explanation answer (see renderAnswerBlocks). Returns the elements rather than
    // appending them anywhere, since each caller lays them out differently (the examples panel
    // puts a TTS button alongside the text; answer blocks render as a standalone pill) —
    // translitEl/translationEl are null when that line doesn't apply (see isLatinScriptText and
    // the "differs from the sentence itself" rule). Plain escaped text throughout — this used to
    // apply word-for-word color-coded highlighting here (see lib/dotbot.js's "alignment" field,
    // {sourcePhrase, targetPhrase} pairs the model still generates but nothing reads anymore),
    // removed per explicit request.
    function buildAlignedSentenceEls(s) {
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-example-sentence';
        textEl.textContent = s.text || '';
        let translitEl = null;
        if (s.romanization && !isLatinScriptText(s.text)) {
            translitEl = document.createElement('div');
            translitEl.className = 'dotbot-example-translit';
            translitEl.textContent = s.romanization;
        }
        let translationEl = null;
        if (s.translation && s.translation !== s.text) {
            translationEl = document.createElement('div');
            translationEl.className = 'dotbot-example-translation';
            translationEl.textContent = s.translation;
        }
        return { textEl, translitEl, translationEl };
    }
    function truncateCenter(str, max) {
        if (str.length < max) return str;
        const tail = 4;
        const head = max - 3 - tail;
        return str.slice(0, head) + '...' + str.slice(str.length - tail);
    }

    // Bumped once by commenceSearchOrMnemonic every time a search is actually submitted — lets a
    // live-suggestion fetch that was already in flight (see scheduleLiveSuggestions) detect that a
    // submit happened while it was waiting, even in the edge case where its response arrives
    // right as/after Enter is pressed (too late for the abort() below to actually cancel it) —
    // otherwise it would clobber the "thinking..." loading state with a stale suggestions list.

    // AI search's own state reset — called from closeRailView/openRailView (panels-hamburger.js)
    // whenever the AI view is the one actually being closed or navigated away from, never called
    // directly by anything outside this file. Kept as a separate function from clearSearch()
    // below specifically to avoid a clearSearch<->closeRailView call cycle: closeRailView needs to
    // trigger this reset, and clearSearch needs to trigger closeRailView, so the reset logic itself
    // can't live inside clearSearch (that direction would loop).
    function resetAiSearchState() {
        // Ends the current thread for continuation purposes — the next message (whenever the AI
        // view next opens) starts a fresh conversation server-side. openSavedChat (the sidebar
        // reopen flow) sets this directly AFTER calling openSearchOverlay, which itself never
        // triggers this reset when simply opening, so it never fights with reopening a saved chat.
        appState.currentConversationId = null;
        appState.searchInput.value = '';
        autoGrowSearchInput();
        appState.searchDotbotAnswer.innerHTML = ''; appState.searchDotbotAnswer.style.display = 'none';
        // #search-command-palette (CommandPalette.jsx) is portaled — React tracks real children
        // there, so a direct innerHTML write would desync its fiber tree from the actual DOM and
        // risk a crash on the next update. Every other panel here renders no JSX children of its
        // own (returns null, only ever touches its node from its own effect), so a direct clear is
        // harmless for those — see hideDotbotResultPanels' own comment for the full reasoning.
        window.__setCommandPalette(null);
        if (appState.searchTranslation) { appState.searchTranslation.innerHTML = ''; appState.searchTranslation.style.display = 'none'; }
        appState.searchDictionary.innerHTML = ''; appState.searchDictionary.style.display = 'none';
        appState.searchExamples.innerHTML = ''; appState.searchExamples.style.display = 'none';
        if (appState.searchImageResult) { appState.searchImageResult.innerHTML = ''; appState.searchImageResult.style.display = 'none'; }
        window.__setSearchSuggestions(null);
        if (appState.searchRecommended) { appState.searchRecommended.innerHTML = ''; appState.searchRecommended.style.display = 'none'; }
        updateSearchDropdown();
        // updateSearchDropdown() just started (or was already mid-) a collapse transition on
        // #search-dropdown — but closeRailView (which called this) is about to hide the whole AI
        // panel right after, which would silently cancel that transition without ever firing
        // 'transitionend' (browsers don't dispatch it for a transition interrupted by an ancestor
        // going display:none). That means the handler which normally hands height back to 'auto'
        // once a collapse finishes never runs here, leaving #search-dropdown's height stuck at
        // whatever explicit px value it was at the moment of interruption — which then breaks
        // `settled` detection (updateSearchDropdown only recognizes '' / 'auto' as settled) for
        // every future reveal, reusing whatever transition happened to be live at THIS moment
        // instead of the correct one. Force it back to a clean rest state directly instead — there's
        // no point letting a collapse animate toward something the user is about to not see anyway,
        // since the whole panel is disappearing regardless.
        if (appState.searchDropdown) {
            appState.searchDropdown.style.transition = '';
            appState.searchDropdown.style.height = 'auto';
            appState.searchDropdown.style.opacity = '1';
            appState.searchDropdown.style.overflow = 'visible';
        }
        // Same fix, same reasoning, for #search-chat-thread — restOverflow is 'auto' here (not
        // 'visible' like #search-dropdown above) to match its own rest-state convention (a real
        // max-height cap that needs to actually clip/scroll, not stay non-clipping).
        // currentConversationId already reset to null above ends the THREAD for continuation
        // purposes; clearing chatThreadStore here ends it visually too, so the next open (without
        // explicitly restoring a saved chat) starts on a genuinely blank palette instead of showing
        // a now-orphaned prior conversation's turns above a box that's about to start a brand new
        // one.
        if (appState.searchChatThread) {
            appState.searchChatThread.style.transition = '';
            appState.searchChatThread.style.height = 'auto';
            appState.searchChatThread.style.opacity = '1';
            appState.searchChatThread.style.overflow = 'auto';
            // Also dropped directly here, not left for updateChatThread() to sort out later —
            // this whole force-reset exists specifically because the normal transition path can't
            // be trusted right as an ancestor is about to go display:none (see above), and
            // 'thread-settled' (flex:1, globals.css) lingering on what's about to be an empty
            // thread would pin the input box to the bottom of a conversation view that no longer
            // has any actual conversation on it.
            appState.searchChatThread.classList.remove('visible', 'thread-settled');
        }
        window.__setChatThread([]);
        showAiListView(); // always land back on the list view (not mid-conversation) next open
        appState.searchInput.blur();
    }
    // Thin guarded wrapper kept for the ~15 external call sites (Escape, window.onclick, etc.)
    // that already call this by name expecting "end the AI conversation, if one's open" — genuinely
    // a no-op unless the AI view is actually the one currently open, which matters because several
    // of those call sites fire from unrelated background events (render()'s per-tick calls,
    // realtime sync broadcasts) that have nothing to do with the user actually closing anything —
    // see resetAiSearchState's own comment for the "AI forgets everything" bug this guard exists
    // to prevent. Delegates to closeRailView() for the actual hide/state-reset (see its own
    // comment in panels-hamburger.js), rather than duplicating that logic here.
    function clearSearch() {
        if (appState.activeRailView !== 'ai') return;
        closeRailView();
    }
    // Toggles between the AI panel's two internal views — the chat list (default: search box up
    // top, previous conversations below it) and an active conversation — independent of the outer
    // rail's own open/close/pin state (openRailView/closeRailView, panels-hamburger.js), so
    // switching between them never disturbs whether the AI panel itself is open or pinned.
    // #search-input-wrap/#search-dropdown are a single shared pair (see #ai-panel's own comment,
    // hamburger-stack.html), physically moved between #ai-list-header and #ai-chat-view by these
    // two functions rather than duplicated — every listener/store/portal wired to their CHILDREN
    // keeps working regardless of which parent currently holds them. Unconditional (no "already
    // showing, skip" guard): re-running this while already on the target view is a real no-op for
    // the DOM moves (appendChild-ing a node that's already exactly where it's going doesn't
    // actually mutate anything), and skipping it would risk skipping the state reset below too —
    // resetAiSearchState (closing the panel) calls this same function needing that reset to
    // happen regardless of which view happened to be showing at the time.
    function showAiListView() {
        appState.aiChatView.classList.remove('open');
        appState.aiListView.classList.add('open');
        appState.aiListHeader.appendChild(appState.searchInputWrap);
        appState.aiListHeader.appendChild(appState.searchDropdown);
        // "Back" (the only way out of a conversation now — there's no separate "New chat" button
        // anymore, see the fragment's own comment) doubles as starting fresh: the next message
        // typed into the list view's own box should never silently continue whatever conversation
        // was just left.
        appState.currentConversationId = null;
        window.__setChatThread([]);
        updateChatThread();
        renderChatsList();
    }
    function showAiChatView() {
        appState.aiListView.classList.remove('open');
        appState.aiChatView.classList.add('open');
        // Two inserts, in this order, land search-input-wrap directly after the thread and
        // search-dropdown right after THAT: insertAdjacentElement moves (never clones) its
        // argument, so the second call — running after the first already placed
        // search-input-wrap right after the thread — pushes search-dropdown one slot further
        // down, landing it after search-input-wrap instead.
        appState.searchChatThread.insertAdjacentElement('afterend', appState.searchDropdown);
        appState.searchChatThread.insertAdjacentElement('afterend', appState.searchInputWrap);
    }
    // AI search's own onOpen callback — passed to panels-hamburger.js's wireRailIcon('ai', ...)
    // call (kept there, not here, alongside every other rail icon's own wireRailIcon call, to
    // avoid calling wireRailIcon itself at this module's own top level — a circular-import timing
    // risk, since panels-hamburger.js also imports from this file; a plain function reference like
    // this one has no such risk, it's only ever invoked later, on a real click). Always lands back
    // on the list view (not mid-conversation from a previous session). Used to also focus the input
    // here — removed per explicit request that opening the panel not auto-focus the search box;
    // `pin` is kept as a parameter since openRailView always passes it through, same as every other
    // view's own onOpen callback, even though nothing in this function reads it any more.
    function refreshAiPanel(pin) {
        showAiListView();
    }
    // Opens the AI panel — called from the global Space/"/" keydown shortcuts
    // (srs-connections-core.js), and from openSavedChat (hamburger-collab.js) when reopening a
    // saved conversation from the chat list.
    function openSearchOverlay() {
        if (!appState.aiPanel || !appState.searchInput) return;
        openRailView('ai', appState.aiPanel, appState.railBtnAi, refreshAiPanel, true);
    }
    // Factory for the hardened open/close/resize height-transition system originally built (across
    // many rounds of real bugs) for #search-dropdown alone — factored out once #search-chat-thread
    // needed the exact same behavior against a completely independent element. Each call returns
    // its own `update(visible, opts)` function with entirely private state (settledHeight,
    // transitionCleanup, its own ResizeObserver) — two controllers must NEVER share this state,
    // that's exactly what would reintroduce the class of bug fixed here:
    //
    // - settledHeight is this controller's own record of the last height its element was actually
    //   animated TO and settled at (0 while collapsed). Can't just re-measure the DOM on demand
    //   once height is back to 'auto': an 'auto'-height element instantly, silently resizes to
    //   match new content as part of the very same reflow the content mutation itself causes, so by
    //   the time `update()` runs, it's ALREADY jumped to the new size — measuring then would just
    //   report the new size back, not the true "before" one.
    // - The ResizeObserver keeps settledHeight honest during growth that happens WITHOUT ever
    //   calling update() — typewriterReveal (mnemonic-search-matching.js) is the real case: text
    //   types out character by character over ~700ms via its own setTimeout loop, growing the
    //   element the whole time via completely ordinary auto-height reflow, with update() itself
    //   only called once, at the very end. Without this, settledHeight would be stuck at whatever
    //   it was BEFORE the typewriter started, and the final update() call would force-snap the
    //   element back down to that stale value before re-growing — a real, visible jump, even though
    //   it was already sitting at the correct size the whole time. Only trusted while settled
    //   (mid-transition, height is a deliberately controlled explicit px value update() already
    //   tracks itself; the observer firing on every animation frame during that would be noise).
    // - opts.growTransition(wasVisible) and opts.shrinkTransition are re-applied UNCONDITIONALLY on
    //   every single call, not just when starting from a settled rest state — content can flicker
    //   in and out fast enough (canvas matches changing keystroke to keystroke, in #search-
    //   dropdown's case) that a shrink is often still mid-flight when a grow is requested a moment
    //   later; without reapplying, the element would silently keep animating with whichever
    //   direction's transition curve happened to be active, not the one actually needed now.
    // - opts.restOverflow controls what `overflow` becomes once a transition settles —
    //   #search-dropdown wants 'visible' (deliberately non-clipping at rest, so the dictionary/
    //   examples panels' hover-out nav arrows can slide outside their own edge); #search-chat-
    //   thread wants 'auto' instead (it needs to actually clip/scroll once its flex-constrained
    //   available space runs out, not stay boundlessly non-clipping).
    // - opts.capTarget, when set, clamps the measured scrollHeight target before animating toward
    //   it — scrollHeight reports the UNCLAMPED natural content height even under overflow:hidden,
    //   so without this an element could animate past whatever ceiling it actually has and then
    //   visually snap back down once that ceiling reasserts itself. A boolean true reads the
    //   element's own current computed max-height (unused by any caller right now — #search-chat-
    //   thread's own ceiling isn't a static CSS value, see updateChatThread's measureThreadFlexAvailable
    //   below, and #search-dropdown has no cap at all). A function is called fresh on every update()
    //   instead and used as the cap directly, for a ceiling that has to be measured live rather than
    //   read off a fixed CSS property.
    // onOrganicResize (optional) fires from inside the ResizeObserver callback, right after
    // settledHeight updates — i.e. exactly when this element grew/shrank on its own (typewriter
    // text, etc.) without ever going through update() itself. #search-chat-thread passes
    // scrollChatThreadToBottom here so the view keeps following newly-typed text in real time as it
    // reveals, not just once when the turn is first appended and once more when typing finishes —
    // #search-dropdown has no equivalent need (nothing to scroll there) and leaves this off.
    function createHeightTransitionController(getElement, onOrganicResize) {
        let settledHeight = 0;
        let transitionCleanup = null;
        const resizeObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver((entries) => {
            const el = getElement();
            if (!el) return;
            const settled = el.style.height === '' || el.style.height === 'auto';
            if (!settled) return;
            settledHeight = entries[0].contentRect.height;
            if (onOrganicResize) onOrganicResize();
        }) : null;
        let resizeObserverStarted = false;

        return function update(visible, opts) {
            const el = getElement();
            if (el && resizeObserver && !resizeObserverStarted) {
                resizeObserver.observe(el);
                resizeObserverStarted = true;
            }
            if (!el) return;
            const restOverflow = opts.restOverflow || 'visible';
            const wasVisible = el.classList.contains('visible');
            el.classList.toggle('visible', visible);
            // 'auto'/'' means no transition is currently live — the last one already ran its
            // transitionend handler and handed height back to normal flow. A non-empty px value
            // means one is still actively interpolating right now.
            const settled = el.style.height === '' || el.style.height === 'auto';
            if (!visible) {
                if (!wasVisible) return; // already closed, staying closed — nothing to animate
                // Dropped immediately (not deferred to the collapse finishing) — opts.settledClass
                // (see #search-chat-thread's own flex:1-once-settled rule, globals.css) must never
                // be active on an empty element: even mid-collapse, a lingering flex-grow would
                // fight this element's own explicit px height with whatever leftover flex space is
                // still around at that moment.
                if (opts.settledClass) el.classList.remove(opts.settledClass);
                if (transitionCleanup) { el.removeEventListener('transitionend', transitionCleanup); transitionCleanup = null; }
                // Only force a starting px value if coming from a settled 'auto' rest — if a grow
                // was still in flight, its current live height is already a real px value we can
                // redirect from directly.
                if (settled) {
                    el.style.transition = 'none';
                    el.style.height = settledHeight + 'px';
                    el.style.overflow = 'hidden';
                    void el.offsetHeight;
                }
                el.style.transition = opts.shrinkTransition;
                el.style.height = '0px';
                el.style.opacity = '0';
                settledHeight = 0;
                const onCollapseDone = (e) => {
                    if (e.target !== el || e.propertyName !== 'height') return;
                    el.style.transition = '';
                    el.style.height = 'auto';
                    el.style.overflow = restOverflow;
                    el.removeEventListener('transitionend', onCollapseDone);
                    transitionCleanup = null;
                };
                el.addEventListener('transitionend', onCollapseDone);
                transitionCleanup = onCollapseDone;
                return;
            }
            // Visible — either a fresh reveal (wasVisible false) or already open and just resized
            // (wasVisible true). By this point the caller has already written new content and
            // flipped whatever display flags matter — the element's natural (scrollHeight) size
            // already reflects that, we just haven't grown into it yet.
            let target = el.scrollHeight;
            if (opts.capTarget) {
                const capPx = typeof opts.capTarget === 'function' ? opts.capTarget() : parseFloat(getComputedStyle(el).maxHeight);
                if (Number.isFinite(capPx)) target = Math.min(target, capPx);
            }
            if (wasVisible && settled && Math.abs(target - settledHeight) < 1) return; // no real change, nothing in flight either
            // Dropped for the same reason as the collapse branch above — while a grow transition
            // is actively driving an explicit px height, opts.settledClass's flex-grow must not
            // also be trying to claim leftover space on top of that same value. Restored in onDone
            // below, once height is handed back to 'auto' and flex-grow becomes the sole thing
            // determining this element's actual size.
            if (opts.settledClass) el.classList.remove(opts.settledClass);
            if (transitionCleanup) { el.removeEventListener('transitionend', transitionCleanup); transitionCleanup = null; }
            if (settled) {
                el.style.transition = 'none';
                el.style.height = settledHeight + 'px';
                // Only fade in from transparent on a genuinely fresh reveal — an in-place resize
                // keeps existing, already-visible content at full opacity throughout.
                if (!wasVisible) el.style.opacity = '0';
                el.style.overflow = 'hidden';
                void el.offsetHeight;
            }
            el.style.transition = opts.growTransition(wasVisible);
            el.style.height = target + 'px';
            el.style.opacity = '1';
            settledHeight = target;
            const onDone = (e) => {
                if (e.target !== el || e.propertyName !== 'height') return;
                el.style.transition = '';
                el.style.height = 'auto';
                el.style.overflow = restOverflow;
                if (opts.settledClass) el.classList.add(opts.settledClass);
                el.removeEventListener('transitionend', onDone);
                transitionCleanup = null;
            };
            el.addEventListener('transitionend', onDone);
            transitionCleanup = onDone;
        };
    }

    // cubic-bezier(0,0,0.2,1)/cubic-bezier(0.4,0,1,1) are Material Design's standard decelerate/
    // accelerate curves — a deliberate PAIR sharing the same underlying shape (just mirrored), not
    // an unrelated choice: that's what makes an enter and its matching exit feel like the same
    // physical object rather than two differently-tempered motions. An earlier easeOutExpo-style
    // curve was tried first for a "smooth/premium" feel, but it's far more front-loaded than this:
    // its second control point already sits at the FULL target value, so well over half the visible
    // size change happens in roughly the first third of the duration and the rest is an almost
    // imperceptible settle — reads as a fast jump followed by a barely-visible creep, not a
    // continuous grow. Material's decelerate curve spreads deceleration evenly across the whole
    // duration instead of front-loading it. On a fresh reveal, opacity overlaps the grow (starts
    // early, finishes a bit after) rather than waiting for it to finish first — a fully-sequenced
    // "grow, THEN fade" leaves the box entirely empty for most of the transition, reading as an
    // empty container snapping to size before content pops in separately, the same "jumpy" symptom
    // by a different route. Shared by both controllers below — nothing about this tuning is
    // #search-dropdown-specific.
    const HEIGHT_TRANSITION_OPTS = {
        shrinkTransition: 'height .16s cubic-bezier(0.4,0,1,1), opacity .12s ease-in',
        growTransition: (wasVisible) => wasVisible
            ? 'height .22s cubic-bezier(0,0,0.2,1)'
            : 'height .22s cubic-bezier(0,0,0.2,1), opacity .26s ease-out .05s',
    };

    const dropdownAnimator = createHeightTransitionController(() => appState.searchDropdown);
    function updateSearchDropdown() {
        if (!appState.searchDropdown) return;
        const panels = [appState.searchCommandPalette, appState.searchDotbotAnswer, appState.searchTranslation, appState.searchDictionary, appState.searchExamples, appState.searchImageResult, appState.searchSuggestions, appState.searchRecommended].filter(Boolean);
        const visible = panels.some(el => el.style.display !== 'none');
        // #search-dropdown is deliberately non-clipping at rest (restOverflow defaults to
        // 'visible') so the dictionary/examples panels' hover-out nav arrows can slide outside
        // their own edge — see #search-bar's own comment on that in globals.css. No max-height
        // cap, so capTarget is left off too.
        dropdownAnimator(visible, HEIGHT_TRANSITION_OPTS);
    }

    const chatThreadAnimator = createHeightTransitionController(() => appState.searchChatThread, scrollChatThreadToBottom);
    // The grow transition's target needs a real ceiling (see opts.capTarget's own comment above) —
    // but #search-chat-thread no longer has a fixed one: it used to be a static max-height:60vh,
    // which caused its own real bug once the element started resting at flex:1 (see globals.css) —
    // 60vh is frequently SMALLER than the panel's actual available space (a full-height sidebar,
    // not a short modal), so flex-grow would happily fill the rest while the static cap here still
    // clamped it down, leaving a bug-reported "huge gap between the search box and the bottom of
    // the screen" below the artificially short thread. There's no single correct static number —
    // the real available space depends on the header/input/dropdown's own current sizes, which
    // change (the card-attachment pill, live suggestions, etc.). So this measures it live instead:
    // temporarily let the element actually resolve its flex:1 size (adding 'thread-settled' if it
    // isn't already there, setting height:auto so flex-grow — not this function's own animation —
    // determines the box), reads the real result, then restores exactly what was there before. All
    // synchronous, no frame ever paints the transient state, same "read layout, then keep going"
    // technique the `void el.offsetHeight;` reflow forces elsewhere in this file already rely on.
    function measureThreadFlexAvailable() {
        const el = appState.searchChatThread;
        if (!el) return Infinity;
        const hadSettled = el.classList.contains('thread-settled');
        const prevHeight = el.style.height;
        if (!hadSettled) el.classList.add('thread-settled');
        el.style.height = 'auto';
        const available = el.offsetHeight;
        el.style.height = prevHeight;
        if (!hadSettled) el.classList.remove('thread-settled');
        return available;
    }
    // #search-chat-thread has no fixed panels to check display on the way #search-dropdown does —
    // ChatThread.jsx portals turn elements directly into it, so "does it have anything to show" is
    // just "does it currently have any children" (childElementCount, not scrollHeight — scrollHeight
    // stays 0 while height:0/overflow:hidden are still in their resting collapsed state, but
    // childElementCount reflects real DOM content regardless of the element's own current size).
    function updateChatThread() {
        if (!appState.searchChatThread) return;
        const visible = appState.searchChatThread.childElementCount > 0;
        // settledClass ('thread-settled', globals.css): only once the grow/shrink transition has
        // actually finished does this element switch to flex:1, pinning the input box (and
        // dropdown) below it to the panel's bottom edge — see #search-chat-thread's own comment,
        // globals.css, for why that has to wait for "settled" rather than applying the instant
        // .visible does.
        chatThreadAnimator(visible, Object.assign({ restOverflow: 'auto', capTarget: measureThreadFlexAvailable, settledClass: 'thread-settled' }, HEIGHT_TRANSITION_OPTS));
    }
    // Auto-follows the newest turn — called after updateChatThread() so the container's real
    // scrollHeight already reflects any just-appended content. No-op while a transition is still
    // hiding overflow (mid-grow, before max-height/overflow:auto can actually take effect); harmless
    // since the eventual transitionend hand-back to overflow:auto leaves scrollTop wherever this
    // last set it, and by then scrollHeight hasn't changed further for that turn anyway.
    // #search-chat-thread is flex-direction:column-reverse (globals.css), paired with ChatThread.jsx
    // rendering turns newest-first — same technique #msg-convo-body/MsgConvo.jsx already uses for
    // the Messages panel, for the same reason: newest content renders at the BOTTOM and pushes
    // older turns upward as it arrives, matching how every real messaging UI behaves, rather than
    // the list growing downward from the top. Under column-reverse the coordinate system flips —
    // scrollTop:0 IS the bottom (newest) — so "scroll to the newest turn" is a plain reset to 0,
    // not scrollHeight.
    function scrollChatThreadToBottom() {
        if (!appState.searchChatThread) return;
        appState.searchChatThread.scrollTop = 0;
    }

    // Hides the panels that hold a *completed* search's result (Dotbot's answer, dictionary,
    // examples) — called whenever the box is re-opened or typed into again, so a prior search's
    // result doesn't linger on screen underneath/alongside the live typing state. Deliberately
    // separate from clearSearch(), which also wipes the input value and suggestions — this only
    // clears the "result" panels.
    //
    // Six of these seven are React-owned now (TranslationPanel.jsx and friends, app/dotto/) but
    // safe to keep clearing directly here: each owning component renders no JSX children of its
    // own (returns null) and only ever touches its node's contents from its own layout effect,
    // gated on its store's value — React never diffs against what's actually in the DOM, so a
    // direct clear here can't fight it. The corresponding store still holds the old panel data
    // until the next render*Panel call sets it fresh, which is harmless (nothing reads a store
    // except its own component, and that component's effect only reruns when the store's value
    // actually changes).
    function hideDotbotResultPanels() {
        appState.searchDotbotAnswer.innerHTML = ''; appState.searchDotbotAnswer.style.display = 'none';
        if (appState.searchTranslation) { appState.searchTranslation.innerHTML = ''; appState.searchTranslation.style.display = 'none'; }
        appState.searchDictionary.innerHTML = ''; appState.searchDictionary.style.display = 'none';
        appState.searchExamples.innerHTML = ''; appState.searchExamples.style.display = 'none';
        if (appState.searchImageResult) { appState.searchImageResult.innerHTML = ''; appState.searchImageResult.style.display = 'none'; }
        if (appState.searchRecommended) { appState.searchRecommended.innerHTML = ''; appState.searchRecommended.style.display = 'none'; }
    }

    function handleSearchInput(value) {
        autoGrowSearchInput();
        // Slash commands (see command-palette.js) take over the box entirely — none of the normal
        // live-suggestion machinery below applies, and any of its panels left over from before "/"
        // was typed need clearing so they don't linger behind the command palette.
        if (value.startsWith('/')) {
            hideDotbotResultPanels();
            window.__setSearchSuggestions(null);
            updateCommandPalette(value);
            updateSearchDropdown();
            return;
        }
        window.__setCommandPalette(null);
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        hideDotbotResultPanels();
        if (value.trim() === "") {
            handleSearchFocus();
            return;
        }
        // Live AI suggestions are for a fresh, standalone query — mid-conversation (a follow-up in
        // an existing chat thread, appState.currentConversationId set — see Stage 3, commit 5d1dd81)
        // they'd suggest generic starting points unrelated to what's actually being continued, so
        // skip scheduling them entirely rather than show something that doesn't fit the moment.
        // Also cancels/clears anything already pending from BEFORE this became a follow-up (the
        // conversation's first message, before a response had come back and set
        // currentConversationId), so a stale suggestion fetch can't still land and pop in later.
        if (appState.currentConversationId) {
            clearTimeout(appState.dotbotSuggestDebounceTimer);
            if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
            window.__setSearchSuggestions(null);
        } else {
            scheduleLiveSuggestions(value, folderObj.isSource);
        }
        updateSearchDropdown();
    }

    // Focusing the box no longer drops a static suggestion list on you. Browsing past chats is the
    // list view's own always-visible #chats-list now (see showAiListView), not something that pops
    // up under the box here — an earlier version of this function fetched and showed a "recent
    // chats" preview under an empty box, back when the box's default resting position WAS a chat
    // view with nothing else on it; that page doesn't exist anymore.
    function handleSearchFocus() {
        // 'rail' — the AI panel IS the currently-open rail view when this fires (focusing the box
        // only happens while it's visible), so closing the rail here would close the box's own
        // panel out from under itself. Still closes unrelated overlays (add-menu/collab/source-add)
        // that might be open at the same time.
        closeAllPanels('rail');
        hideDotbotResultPanels();
        const v = appState.searchInput.value.trim();
        if (v !== "") return;
        window.__setSearchSuggestions(null);
        updateSearchDropdown();
    }

    // ---------- Live AI-generated suggestions (free, debounced — see /api/dotbot/suggest) ----------
    function scheduleLiveSuggestions(value, isSourceFolder) {
        clearTimeout(appState.dotbotSuggestDebounceTimer);
        if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
        const q = value.trim();
        if (q.length < 2) { window.__setSearchSuggestions(null); updateSearchDropdown(); return; }
        const generationAtScheduleTime = appState.dotbotSearchGeneration;
        appState.dotbotSuggestDebounceTimer = setTimeout(async () => {
            appState.dotbotSuggestAbortController = new AbortController();
            let suggestions = [];
            try {
                const res = await fetch('/api/dotbot/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, isSourceFolder }),
                    signal: appState.dotbotSuggestAbortController.signal
                });
                const data = await res.json();
                if (appState.searchInput.value.trim() !== q) return; // stale — a newer keystroke already moved on
                // A search may have been SUBMITTED (Enter) while this fetch was in flight — that
                // shows its own "thinking..." loading state in this same #search-suggestions
                // element, which these stale suggestions would otherwise clobber the instant this
                // response lands, even though abort() above didn't catch it in time.
                if (generationAtScheduleTime !== appState.dotbotSearchGeneration) return;
                suggestions = data.suggestions || [];
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.error('[dotbot/suggest] failed:', e);
            }
            renderLiveSuggestions(suggestions);
        }, 200);
    }
    // No more hardcoded "Generate a mnemonic for X"/"Generate an image for this" rows here —
    // /api/dotbot/suggest's own prompt (see DOTBOT_SUGGEST_SYSTEM_PROMPT in lib/dotbot.js) now
    // recommends a mnemonic-generation suggestion as one of these AI-suggested completions
    // itself, specifically when the typed text looks like a single word/short phrase worth one —
    // clicking any suggestion here already routes through commenceSearchOrMnemonic, so a
    // suggested "generate a mnemonic for X" string is picked up correctly with no special-casing.
    // Rows built vanilla (see buildLiveSuggestionsRows) — no internal state of their own, just
    // event wiring, not worth rewriting as JSX for this pass (same reasoning as
    // buildRecommendedSearchesRows). #search-suggestions' content itself is real React state now
    // (see app/dotto/SearchSuggestionsPanel.jsx, searchSuggestionsStore) — see
    // renderMnemonicResultCard's own comment in mnemonic-search-matching.js for the full picture
    // of why (shared by 5 different producers across 3 files).
    function buildLiveSuggestionsRows(suggestions) {
        const frag = document.createDocumentFragment();
        suggestions.slice(0, 4).forEach(text => {
            const div = document.createElement('div');
            // .search-suggestion-item-live (not just the shared .search-suggestion-item every other
            // producer in this file/mnemonic-search-matching.js also uses — recommended searches,
            // mnemonic result cards, image loading states, etc.) scopes the arrow.png icon added
            // here to just these live-as-you-type rows, per explicit request, rather than every
            // other kind of card that reuses the base class.
            div.className = 'search-suggestion-item search-suggestion-item-live';
            const icon = document.createElement('img');
            icon.className = 'search-suggestion-arrow';
            icon.src = '/assets/icons/arrow.png';
            icon.alt = '';
            const label = document.createElement('span');
            label.className = 'search-suggestion-label';
            label.textContent = text;
            div.append(icon, label);
            div.onclick = (e) => { e.stopPropagation(); appState.searchInput.value = text; autoGrowSearchInput(); commenceSearchOrMnemonic(text); };
            frag.appendChild(div);
        });
        return frag;
    }
    function renderLiveSuggestions(suggestions) {
        window.__setSearchSuggestions({ kind: 'live-suggestions', suggestions });
        updateSearchDropdown();
    }

    // ---------- Dotbot (AI assistant embedded in the search box) ----------
    // Credit costs are intentionally never shown here or anywhere in this UI —
    // deduction happens entirely server-side (see app/api/dotbot/*), the client
    // just gets back a result or a friendly "no_credits" reason.
    function dotbotErrorMessage(reason) {
        if (reason === 'no_credits') return "You're out of Dotbot credits for today — more tomorrow!";
        if (reason === 'not_configured') return "Dotbot isn't set up yet.";
        if (reason === 'unauthenticated') return 'Log in to talk to Dotbot.';
        return 'Something went wrong — try again.';
    }
    // Reveals `text` inside `el` a character at a time (a blinking caret via the dotbot-typing
    // class while it runs). Plain textContent throughout — no HTML involved, so newlines are
    // handled with CSS white-space:pre-wrap rather than injecting <br> mid-animation, and there's
    // nothing to escape. Bails cleanly if `el` gets removed from the DOM mid-animation (e.g. the
    // search box was cleared/navigated away from before typing finished).
    function typewriterReveal(el, text, onDone) {
        el.textContent = '';
        el.classList.add('dotbot-typing');
        let i = 0;
        // Scaled to a ~700ms total reveal regardless of length, clamped to a sensible per-char
        // range — a flat 12ms/char was adding up to 1.5-2+ seconds of pure animation on top of
        // the network round trip for a longer answer, which read as the app still being slow
        // even after the response had already arrived.
        const msPerChar = Math.max(4, Math.min(12, 700 / Math.max(text.length, 1)));
        (function step() {
            if (!el.isConnected) return;
            i++;
            el.textContent = text.slice(0, i);
            if (i < text.length) { setTimeout(step, msPerChar); }
            else { el.classList.remove('dotbot-typing'); if (onDone) onDone(); }
        })();
    }
    // Types out `segments` (parseInlineMarkers' output — mnemonic-search-matching.js) into
    // `container` in order. A 'text' segment types character-by-character into its OWN freshly
    // appended <span> (never wipes prior siblings, unlike typewriterReveal's whole-el.textContent
    // reset — that's what lets placeholder elements interleave with text runs). A 'ref' segment
    // calls opts.onPlaceholder(kind, index) synchronously — the caller appends its own placeholder
    // element and returns it — holds for opts.holdMs (default 400ms, a fixed pacing beat: nothing
    // is actually still loading, see the "Sequenced turn reveal" comment in globals.css), then
    // calls opts.onSwap(kind, index, placeholderEl) so the caller can replace it with the real
    // widget. Calls opts.onDone exactly once, after the last segment. Checks container.isConnected
    // on every tick, same abandoned-element guard as typewriterReveal.
    function typewriterRevealSegments(container, segments, opts) {
        opts = opts || {};
        const holdMs = opts.holdMs || 400;
        let i = 0;
        function nextSegment() {
            if (i >= segments.length) { if (opts.onDone) opts.onDone(); return; }
            const seg = segments[i++];
            if (seg.type === 'text') {
                if (!container.isConnected) return;
                const span = document.createElement('span');
                span.classList.add('dotbot-typing');
                container.appendChild(span);
                let c = 0;
                const msPerChar = Math.max(4, Math.min(12, 700 / Math.max(seg.value.length, 1)));
                (function step() {
                    if (!container.isConnected) return;
                    c++;
                    span.textContent = seg.value.slice(0, c);
                    if (c < seg.value.length) { setTimeout(step, msPerChar); }
                    else { span.classList.remove('dotbot-typing'); nextSegment(); }
                })();
            } else {
                if (!container.isConnected) return;
                const placeholderEl = opts.onPlaceholder(seg.kind, seg.index);
                setTimeout(() => {
                    if (!container.isConnected) return;
                    opts.onSwap(seg.kind, seg.index, placeholderEl);
                    nextSegment();
                }, holdMs);
            }
        }
        nextSegment();
    }
    // Mirrors the pointer-drag pattern used to drag a shared chat card onto the
    // canvas (see the draggableOut branch in renderInlineCanvas), but for a single
    // synthetic Dotbot result rather than an array of existing canvas items.
    // `opts.cellImageHtml`, when set, is an <img ...> tag this drag can ALSO land directly
    // inside a source page's table cell (see insertImageIntoCellAt) if it's released over one —
    // otherwise (or if released over blank canvas) it falls through to the normal
    // canvasItemTemplate drop.
    function setupDotbotResultDrag(card, canvasItemTemplate, opts) {
        opts = opts || {};
        card.classList.add('dotbot-draggable');
        card.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            let dragStarted = false, dragGhost = null;
            const startX = e.clientX, startY = e.clientY;
            const move = (me) => {
                if (!dragStarted) {
                    if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
                    dragStarted = true;
                    dragGhost = document.createElement('div');
                    dragGhost.className = 'inline-canvas-drag-ghost';
                    dragGhost.textContent = 'drop onto your canvas';
                    document.body.appendChild(dragGhost);
                }
                dragGhost.style.left = (me.clientX + 14) + 'px';
                dragGhost.style.top = (me.clientY + 14) + 'px';
                if (opts.cellImageHtml) {
                    const overCell = me.target && me.target.closest && me.target.closest('.cell-text');
                    dragGhost.textContent = overCell ? 'drop into this entry' : 'drop onto your canvas';
                }
            };
            const up = (ue) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (dragGhost) dragGhost.remove();
                if (!dragStarted) return;
                if (opts.cellImageHtml) {
                    const dropEl = document.elementFromPoint(ue.clientX, ue.clientY);
                    const cellTextEl = dropEl && dropEl.closest ? dropEl.closest('.cell-text') : null;
                    const tdEl = cellTextEl && cellTextEl.closest('td[data-origin-table]');
                    if (tdEl) {
                        const r = Number(cellTextEl.dataset.r), c = Number(cellTextEl.dataset.c), tableId = Number(tdEl.dataset.originTable);
                        if (Number.isFinite(r) && Number.isFinite(c) && Number.isFinite(tableId) && insertImageIntoCellAt(tableId, r, c, opts.cellImageHtml)) {
                            clearSearch();
                            return;
                        }
                    }
                }
                const canvasRect = canvas.getBoundingClientRect();
                const overCanvas = ue.clientX >= canvasRect.left && ue.clientX <= canvasRect.right && ue.clientY >= canvasRect.top && ue.clientY <= canvasRect.bottom;
                if (!overCanvas) return;
                // opts.onDrop lets a caller replace the default single-template import — used by
                // the mnemonic story/image cards so dragging either one brings BOTH in (see
                // importMnemonicPairAtScreenPoint).
                if (opts.onDrop) opts.onDrop(ue.clientX, ue.clientY);
                else importDotbotResultAtScreenPoint(canvasItemTemplate, ue.clientX, ue.clientY);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }
    // Drops a generated image straight into a source table cell (see setupDotbotResultDrag's
    // cellImageHtml option) — appends to whatever's already in the cell, same as
    // triggerCellImageUpload/insertIntoActiveCell do for a manually-uploaded image, just
    // addressed by an explicit (tableId, r, c) from the drop point rather than lastFocusedCell.
    function insertImageIntoCellAt(tableId, r, c, imgHtml) {
        const table = findItemById(tableId);
        if (!table || !table.tableData || !table.tableData[r] || table.tableData[r][c] == null) return false;
        saveSnapshot();
        const cellEl = document.querySelector(`#${itemElId(tableId)} .cell-text[data-r="${r}"][data-c="${c}"]`);
        if (cellEl) {
            cellEl.insertAdjacentHTML('beforeend', imgHtml);
            table.tableData[r][c] = cellEl.innerHTML;
        } else {
            table.tableData[r][c] = (table.tableData[r][c] || '') + imgHtml;
        }
        scheduleWorkspaceSave();
        render();
        return true;
    }
    function importDotbotResultAtScreenPoint(template, clientX, clientY) {
        saveSnapshot();
        const rect = canvas.getBoundingClientRect();
        const dropX = Math.round(((clientX - rect.left - appState.tx) / appState.scale) / 28) * 28;
        const dropY = Math.round(((clientY - rect.top - appState.ty) / appState.scale) / 28) * 28;
        // Every caller of this function is Dotbot/AI-originated content (dictionary/answer/
        // mnemonic story/image, and now individual example sentences) — aiGenerated:true here
        // covers the "Generated content may be inaccurate" badge for all of them in one place,
        // with no per-call-site changes needed.
        const item = {
            id: appState.idCounter++,
            x: dropX, y: dropY,
            w: template.w, h: template.h,
            kind: template.kind || 'note',
            html: template.html,
            aiGenerated: true,
        };
        if (template.kind === 'sentence') {
            item.text = template.text || '';
            item.translit = template.translit || '';
            item.translation = template.translation || '';
        }
        appState.folders[appState.currentFolderId].items.push(item);
        render();
        clearSearch();
    }

export { buildAlignedSentenceEls, buildLiveSuggestionsRows, clearSearch, countSourceEntries, dotbotErrorMessage, escapeHtml, findParentFolderId, handleSearchFocus, handleSearchInput, isLatinScriptText, openSearchOverlay, refreshAiPanel, resetAiSearchState, scrollChatThreadToBottom, setupDotbotResultDrag, showAiChatView, showAiListView, speakerIconHTML, stripHtml, truncateCenter, typewriterReveal, typewriterRevealSegments, updateChatThread, updateSearchDropdown };

window.__countSourceEntries = countSourceEntries;
window.__buildLiveSuggestionsRows = buildLiveSuggestionsRows;
// ChatTurn (app/dotto/ChatThread.jsx) calls these directly — React files can't import public/
// dotto/*.js as ES modules (same constraint every other window.__* bridge here exists for).
window.__updateChatThread = updateChatThread;
window.__scrollChatThreadToBottom = scrollChatThreadToBottom;
window.__typewriterRevealSegments = typewriterRevealSegments;
// Used by app/dotto/canvasItemBehavior.js's renderStaticTableHTML (Phase 3's fourth relocated
// piece — the Source database page's own rendering/hover-zone geometry), same reasoning as
// window.__getAppState (core-state.js).
window.__escapeHtml = escapeHtml;
window.__stripHtml = stripHtml;
