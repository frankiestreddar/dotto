import { updateCommandPalette } from './command-palette.js';
import { appState, canvas } from './core-state.js';
import { renderChatsList } from './hamburger-collab.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { commenceSearchOrMnemonic, computeCanvasMatches, computeSourceMatches, renderCanvasResultsPanel } from './mnemonic-search-matching.js';
import { closeAllPanels, closeRailView, openRailView } from './panels-hamburger.js';
import { autoGrowSearchInput } from './stopwatch-search-notifications.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Animated Placeholder (types out & deletes a looping series of suggestions) ----------
    (function animateSearchPlaceholder() {
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
                appState.searchInput.placeholder = current.slice(0, charIndex);
                if (charIndex >= current.length) {
                    deleting = true;
                    setTimeout(tick, PAUSE_AFTER_TYPE);
                    return;
                }
                setTimeout(tick, TYPE_SPEED);
            } else {
                charIndex--;
                appState.searchInput.placeholder = current.slice(0, charIndex);
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

    function setSearchActive(idx) {
        const items = Array.from(appState.searchResults.querySelectorAll('.search-result-item'));
        if (!items.length) return;
        idx = ((idx % items.length) + items.length) % items.length;
        items.forEach(el => el.classList.remove('active'));
        appState.searchActiveIndex = idx;
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
    }
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
    function getItemSearchText(it) {
        if (it.kind === 'folder' || it.kind === 'source') return appState.folders[it.folderId] ? appState.folders[it.folderId].title : '';
        if (it.kind === 'waypoint') return it.name || '';
        if (it.kind === 'table') return it.tableData.map(row => row.map(c => stripHtml(c)).join(' ')).join(' ');
        if (it.kind === 'checklist') return (it.tasks || []).map(t => t.text).join(' ');
        if (it.kind === 'embed') return it.embedUrl || '';
        return stripHtml(it.html);
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
    // Must match the .align-hl-0..N palette in globals.css.
    // Global on/off switch for word-alignment color-coding, toggled via the examples panel's
    // hover-slide toggle button (see buildExamplesCard) — affects every aligned sentence
    // currently on screen (examples panel AND any embedded answerBlocks example pills, since
    // both share the exact same highlighting mechanism), not just the panel the toggle button
    // lives on. `dotbotAlignedRegistry` tracks every {el, str, alignment, pick} currently
    // rendered so toggling can re-render them in place without needing to re-fetch or rebuild
    // whole cards — cleared at the top of renderOrchestrateResult each time a fresh result comes
    // in, so it never grows to reference stale, long-gone elements.
    function applyAlignHighlightToggle(on) {
        appState.dotbotAlignHighlightOn = on;
        appState.dotbotAlignedRegistry.forEach(entry => {
            entry.el.innerHTML = alignedSentenceHTML(entry.str, entry.alignment, entry.pick);
        });
    }
    // Wraps whichever alignment phrases actually appear verbatim in `str` with color-coded
    // highlight spans — one color per entry in the `alignment` array (see lib/dotbot.js's
    // ALIGNMENT_SCHEMA for the {sourcePhrase, targetPhrase} contract this backs). `pickPhrase`
    // selects which side of each pair applies to THIS string (sourcePhrase for the original
    // sentence, targetPhrase for its translation) — calling this once per side with the same
    // `alignment` array naturally gives a matching pair the same color on both sides, since the
    // color is just that pair's own index in the array. A phrase that isn't found verbatim (the
    // model didn't follow the exact-substring contract) is silently skipped rather than guessed
    // at — same "never trust structured output blindly" posture as the rest of this codebase.
    // Matches are found in array order and never allowed to overlap an already-claimed range, so
    // an earlier pair's match always wins over a later, overlapping one.
    function alignedSentenceHTML(str, alignment, pickPhrase) {
        str = str || '';
        if (!appState.dotbotAlignHighlightOn || !alignment || !alignment.length) return escapeHtml(str);
        const claims = [];
        const lowerStr = str.toLowerCase();
        alignment.forEach((pair, i) => {
            const phrase = pair && pickPhrase(pair);
            if (!phrase) return;
            // Case-insensitive search (sentence-initial capitalization shouldn't silently break
            // an otherwise-correct alignment pair) — the ORIGINAL casing from `str` is still
            // what actually gets sliced out and rendered below, only the search ignores case.
            const idx = lowerStr.indexOf(phrase.toLowerCase());
            if (idx === -1) return;
            const end = idx + phrase.length;
            if (claims.some(c => idx < c.end && end > c.start)) return; // overlaps an earlier, already-claimed match
            claims.push({ start: idx, end, colorIdx: i % appState.ALIGN_HL_COLOR_COUNT });
        });
        if (!claims.length) return escapeHtml(str);
        claims.sort((a, b) => a.start - b.start);
        let html = '', cursor = 0;
        claims.forEach(c => {
            html += escapeHtml(str.slice(cursor, c.start));
            html += `<span class="align-hl align-hl-${c.colorIdx}">${escapeHtml(str.slice(c.start, c.end))}</span>`;
            cursor = c.end;
        });
        html += escapeHtml(str.slice(cursor));
        return html;
    }
    // Builds the {text, romanization, translation} elements for one example sentence, with
    // word-alignment highlighting applied to both text and translation — shared by the examples
    // panel (buildExamplesCard) and the "example" blocks inside an in-depth grammar/explanation
    // answer (see renderAnswerBlocks), so both use identical highlighting logic. Returns the
    // elements rather than appending them anywhere, since each caller lays them out differently
    // (the examples panel puts a TTS button alongside the text; answer blocks render as a
    // standalone pill) — translitEl/translationEl are null when that line doesn't apply (see
    // isLatinScriptText and the "differs from the sentence itself" rule, both unchanged from
    // before this shared alignment behavior).
    function buildAlignedSentenceEls(s) {
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-example-sentence';
        textEl.innerHTML = alignedSentenceHTML(s.text, s.alignment, (p) => p.sourcePhrase);
        appState.dotbotAlignedRegistry.push({ el: textEl, str: s.text, alignment: s.alignment, pick: (p) => p.sourcePhrase });
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
            translationEl.innerHTML = alignedSentenceHTML(s.translation, s.alignment, (p) => p.targetPhrase);
            appState.dotbotAlignedRegistry.push({ el: translationEl, str: s.translation, alignment: s.alignment, pick: (p) => p.targetPhrase });
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
        clearTimeout(appState.canvasResultsDebounceTimer);
        // Ends the current thread for continuation purposes — the next message (whenever the AI
        // view next opens) starts a fresh conversation server-side. openSavedChat (the sidebar
        // reopen flow) sets this directly AFTER calling openSearchOverlay, which itself never
        // triggers this reset when simply opening, so it never fights with reopening a saved chat.
        appState.currentConversationId = null;
        appState.searchInput.value = '';
        autoGrowSearchInput();
        appState.searchDotbotAnswer.innerHTML = ''; appState.searchDotbotAnswer.style.display = 'none';
        // #search-results (CanvasResultsPanel.jsx) is portaled — React tracks real children there,
        // so a direct innerHTML write would desync its fiber tree from the actual DOM and risk a
        // crash on the next update. Every other panel here renders no JSX children of its own
        // (returns null, only ever touches its node from its own effect), so a direct clear is
        // harmless for those — see hideDotbotResultPanels' own comment for the full reasoning.
        window.__setCanvasResults(null);
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
        }
        window.__setChatThread([]);
        showAiChatView(); // always land back on the chat view (not mid-history-browse) next open
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
    // Toggles between the AI panel's two internal views — the active chat (default) and a
    // chat-history list — independent of the outer rail's own open/close/pin state (openRailView/
    // closeRailView, panels-hamburger.js), so switching between them never disturbs whether the AI
    // panel itself is open or pinned.
    function showAiHistoryView() {
        appState.aiChatView.classList.remove('open');
        appState.aiHistoryView.classList.add('open');
        renderChatsList();
    }
    function showAiChatView() {
        appState.aiHistoryView.classList.remove('open');
        appState.aiChatView.classList.add('open');
    }
    // "New chat" — same conversationId/chatThreadStore reset resetAiSearchState does, without
    // actually closing the AI panel (unlike clearSearch, which is for leaving the AI view
    // entirely) — this is reached FROM the history view, so it also has to bring the chat view
    // back itself.
    function startNewAiChat() {
        appState.currentConversationId = null;
        window.__setChatThread([]);
        appState.searchInput.value = '';
        autoGrowSearchInput();
        showAiChatView();
        appState.searchInput.focus();
    }
    // AI search's own onOpen callback — passed to panels-hamburger.js's wireRailIcon('ai', ...)
    // call (kept there, not here, alongside every other rail icon's own wireRailIcon call, to
    // avoid calling wireRailIcon itself at this module's own top level — a circular-import timing
    // risk, since panels-hamburger.js also imports from this file; a plain function reference like
    // this one has no such risk, it's only ever invoked later, on a real click). Always lands
    // back on the chat view (not mid-history-browse from a previous session), and focuses the
    // input (the rail is click-only now, so `pin` is always true here — kept as a parameter since
    // openRailView always passes it through, same as every other view's own onOpen callback).
    function refreshAiPanel(pin) {
        showAiChatView();
        if (pin) appState.searchInput.focus();
    }
    // Opens the AI panel — called from the global Space/"/" keydown shortcuts and #btn-search's
    // click handler (srs-connections-core.js), and from openSavedChat (hamburger-collab.js) when
    // reopening a saved conversation from the Chats history list.
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
    //   thread wants 'auto' instead (it has a real max-height cap and needs to actually clip/scroll
    //   at rest, not stay boundlessly non-clipping).
    // - opts.capTarget, when true, clamps the measured scrollHeight target to the element's own
    //   current computed max-height before animating toward it — scrollHeight reports the
    //   UNCLAMPED natural content height even under a max-height + overflow:hidden, so without this
    //   an element with a real cap (#search-chat-thread) could animate past its own ceiling and
    //   then visually snap back down once the cap reasserts itself.
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
                const capPx = parseFloat(getComputedStyle(el).maxHeight);
                if (Number.isFinite(capPx)) target = Math.min(target, capPx);
            }
            if (wasVisible && settled && Math.abs(target - settledHeight) < 1) return; // no real change, nothing in flight either
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
        const panels = [appState.searchCommandPalette, appState.searchDotbotAnswer, appState.searchResults, appState.searchTranslation, appState.searchDictionary, appState.searchExamples, appState.searchImageResult, appState.searchSuggestions, appState.searchRecommended].filter(Boolean);
        const visible = panels.some(el => el.style.display !== 'none');
        // #search-dropdown is deliberately non-clipping at rest (restOverflow defaults to
        // 'visible') so the dictionary/examples panels' hover-out nav arrows can slide outside
        // their own edge — see #search-bar's own comment on that in globals.css. No max-height
        // cap, so capTarget is left off too.
        dropdownAnimator(visible, HEIGHT_TRANSITION_OPTS);
    }

    const chatThreadAnimator = createHeightTransitionController(() => appState.searchChatThread, scrollChatThreadToBottom);
    // #search-chat-thread has no fixed panels to check display on the way #search-dropdown does —
    // ChatThread.jsx portals turn elements directly into it, so "does it have anything to show" is
    // just "does it currently have any children" (childElementCount, not scrollHeight — scrollHeight
    // stays 0 while height:0/overflow:hidden are still in their resting collapsed state, but
    // childElementCount reflects real DOM content regardless of the element's own current size).
    function updateChatThread() {
        if (!appState.searchChatThread) return;
        const visible = appState.searchChatThread.childElementCount > 0;
        chatThreadAnimator(visible, Object.assign({ restOverflow: 'auto', capTarget: true }, HEIGHT_TRANSITION_OPTS));
    }
    // Auto-follows the newest turn — called after updateChatThread() so the container's real
    // scrollHeight already reflects any just-appended content. No-op while a transition is still
    // hiding overflow (mid-grow, before max-height/overflow:auto can actually take effect); harmless
    // since the eventual transitionend hand-back to overflow:auto leaves scrollTop wherever this
    // last set it, and by then scrollHeight hasn't changed further for that turn anyway.
    function scrollChatThreadToBottom() {
        if (!appState.searchChatThread) return;
        appState.searchChatThread.scrollTop = appState.searchChatThread.scrollHeight;
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
        if (appState.dotbotScheduleConversation) return; // typing the "when" reply — not a search query
        // Slash commands (see command-palette.js) take over the box entirely — none of the normal
        // canvas-match/live-suggestion machinery below applies, and any of its panels left over
        // from before "/" was typed need clearing so they don't linger behind the command palette.
        if (value.startsWith('/')) {
            clearTimeout(appState.canvasResultsDebounceTimer);
            hideDotbotResultPanels();
            window.__setCanvasResults(null);
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
            clearTimeout(appState.canvasResultsDebounceTimer);
            window.__setCanvasResults(null);
            handleSearchFocus();
            return;
        }
        scheduleCanvasResults(value, folderObj.isSource);
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

    // Debounced canvas-item matching — computeCanvasMatches/computeSourceMatches are themselves
    // synchronous (no fetch, no artificial delay), so this exists purely to avoid resizing
    // #search-dropdown on every single keystroke as matches flicker in and out while typing, not
    // for performance. 350ms of no typing before the results panel updates, mirroring the existing
    // debounce pattern already used for live AI suggestions (scheduleLiveSuggestions) just below.
    // Re-checks the input's CURRENT value against what was scheduled before applying anything —
    // if the user kept typing (or cleared the box, or switched to a "/" command) since this was
    // scheduled, this timer's own stale result is simply discarded rather than clobbering whatever
    // state the box has actually moved on to.
    function scheduleCanvasResults(value, isSourceFolder) {
        clearTimeout(appState.canvasResultsDebounceTimer);
        appState.canvasResultsDebounceTimer = setTimeout(() => {
            if (appState.searchInput.value !== value) return; // stale — superseded by later typing
            const matches = isSourceFolder ? computeSourceMatches(value) : computeCanvasMatches(value);
            renderCanvasResultsPanel(matches, isSourceFolder);
            updateSearchDropdown();
        }, 350);
    }

    // Focusing the box no longer drops a static suggestion list on you — instead the border
    // itself pulses (see .idle-pulsing / the search-idle-chase rects in globals.css) for as long
    // as the box is focused and nothing's been submitted yet, replaced by the existing loading
    // ring the moment a search actually commences (see commenceSearchOrMnemonic/
    // commenceDotbotSearch, which remove this class right before they run).
    function handleSearchFocus() {
        // 'rail' — the AI panel IS the currently-open rail view when this fires (focusing the box
        // only happens while it's visible), so closing the rail here would close the box's own
        // panel out from under itself. Still closes unrelated overlays (add-menu/collab/source-add)
        // that might be open at the same time.
        closeAllPanels('rail');
        if (appState.dotbotScheduleConversation) return; // keep Dotbot's prompt showing, not generic suggestions
        hideDotbotResultPanels();
        appState.searchInputWrap.classList.add('idle-pulsing');
        const v = appState.searchInput.value.trim();
        if (v !== "") return;
        window.__setSearchSuggestions(null);
        window.__setCanvasResults(null);
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
    // of why (shared by 6 different producers across 4 files).
    function buildLiveSuggestionsRows(suggestions) {
        const frag = document.createDocumentFragment();
        suggestions.slice(0, 4).forEach(text => {
            const div = document.createElement('div');
            div.className = 'search-suggestion-item';
            div.textContent = text;
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
        const cellEl = document.querySelector(`#item-${tableId} .cell-text[data-r="${r}"][data-c="${c}"]`);
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

export { applyAlignHighlightToggle, buildAlignedSentenceEls, buildLiveSuggestionsRows, clearSearch, countSourceEntries, dotbotErrorMessage, escapeHtml, findParentFolderId, getItemSearchText, handleSearchFocus, handleSearchInput, isLatinScriptText, openSearchOverlay, refreshAiPanel, resetAiSearchState, scrollChatThreadToBottom, setSearchActive, setupDotbotResultDrag, showAiChatView, showAiHistoryView, speakerIconHTML, startNewAiChat, stripHtml, truncateCenter, typewriterReveal, typewriterRevealSegments, updateChatThread, updateSearchDropdown };

window.__countSourceEntries = countSourceEntries;
window.__buildLiveSuggestionsRows = buildLiveSuggestionsRows;
// ChatTurn (app/dotto/ChatThread.jsx) calls these directly — React files can't import public/
// dotto/*.js as ES modules (same constraint every other window.__* bridge here exists for).
window.__updateChatThread = updateChatThread;
window.__scrollChatThreadToBottom = scrollChatThreadToBottom;
window.__typewriterRevealSegments = typewriterRevealSegments;
