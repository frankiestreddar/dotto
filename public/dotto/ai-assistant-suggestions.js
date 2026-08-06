import { shortUrl } from './cards-misc.js';
import { appState, canvas } from './core-state.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { commenceSearchOrMnemonic, computeCanvasMatches, computeSourceMatches, renderCanvasResultsPanel } from './mnemonic-search-matching.js';
import { closeAllPanels } from './panels-hamburger.js';
import { autoGrowSearchInput, updateSearchSpaceHint } from './stopwatch-search-notifications.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Animated Placeholder (types out & deletes a looping series of suggestions) ----------
    (function animateSearchPlaceholder() {
        const suggestions = [
            'find anything in your canvas...',
            'ask me how to conjugate verbs...',
            'generate a mnemonic for ananas...'
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
        if (it.kind === 'bookmark') return it.html || (it.bookmarkUrl ? shortUrl(it.bookmarkUrl) : '');
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

    function clearSearch() {
        if (!appState.searchInput) return;
        appState.searchInput.value = '';
        autoGrowSearchInput();
        updateSearchSpaceHint();
        appState.searchDotbotAnswer.innerHTML = ''; appState.searchDotbotAnswer.style.display = 'none';
        appState.searchResults.innerHTML = ''; appState.searchResults.style.display = 'none';
        if (appState.searchTranslation) { appState.searchTranslation.innerHTML = ''; appState.searchTranslation.style.display = 'none'; }
        appState.searchDictionary.innerHTML = ''; appState.searchDictionary.style.display = 'none';
        appState.searchExamples.innerHTML = ''; appState.searchExamples.style.display = 'none';
        if (appState.searchImageResult) { appState.searchImageResult.innerHTML = ''; appState.searchImageResult.style.display = 'none'; }
        appState.searchSuggestions.innerHTML = ''; appState.searchSuggestions.style.display = 'none';
        if (appState.searchRecommended) { appState.searchRecommended.innerHTML = ''; appState.searchRecommended.style.display = 'none'; }
        updateSearchDropdown();
    }
    function updateSearchDropdown() {
        if (!appState.searchDropdown) return;
        const panels = [appState.searchDotbotAnswer, appState.searchResults, appState.searchTranslation, appState.searchDictionary, appState.searchExamples, appState.searchImageResult, appState.searchSuggestions, appState.searchRecommended].filter(Boolean);
        const visible = panels.some(el => el.style.display !== 'none');
        appState.searchDropdown.classList.toggle('visible', visible);
    }

    // Hides the panels that hold a *completed* search's result (Dotbot's answer, dictionary,
    // examples) — called whenever the box is re-opened or typed into again, so a prior search's
    // result doesn't linger on screen underneath/alongside the live typing state. Deliberately
    // separate from clearSearch(), which also wipes the input value and suggestions — this only
    // clears the "result" panels.
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
        updateSearchSpaceHint();
        if (appState.dotbotScheduleConversation) return; // typing the "when" reply — not a search query
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        hideDotbotResultPanels();
        if (value.trim() === "") {
            handleSearchFocus();
            return;
        }
        const matches = folderObj.isSource ? computeSourceMatches(value) : computeCanvasMatches(value);
        renderCanvasResultsPanel(matches, folderObj.isSource);
        scheduleLiveSuggestions(value, folderObj.isSource);
        updateSearchDropdown();
    }

    // Focusing the box no longer drops a static suggestion list on you — instead the border
    // itself pulses (see .idle-pulsing / the search-idle-chase rects in globals.css) for as long
    // as the box is focused and nothing's been submitted yet, replaced by the existing loading
    // ring the moment a search actually commences (see commenceSearchOrMnemonic/
    // commenceDotbotSearch, which remove this class right before they run).
    function handleSearchFocus() {
        updateSearchSpaceHint();
        closeAllPanels(null);
        if (appState.dotbotScheduleConversation) return; // keep Dotbot's prompt showing, not generic suggestions
        hideDotbotResultPanels();
        appState.searchInputWrap.classList.add('idle-pulsing');
        const v = appState.searchInput.value.trim();
        if (v !== "") return;
        appState.searchSuggestions.innerHTML = '';
        appState.searchSuggestions.style.display = 'none';
        appState.searchResults.style.display = 'none';
        updateSearchDropdown();
    }

    // ---------- Live AI-generated suggestions (free, debounced — see /api/dotbot/suggest) ----------
    function scheduleLiveSuggestions(value, isSourceFolder) {
        clearTimeout(appState.dotbotSuggestDebounceTimer);
        if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
        const q = value.trim();
        if (q.length < 2) { appState.searchSuggestions.innerHTML = ''; appState.searchSuggestions.style.display = 'none'; updateSearchDropdown(); return; }
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
    function renderLiveSuggestions(suggestions) {
        appState.searchSuggestions.innerHTML = '';
        suggestions.slice(0, 4).forEach(text => {
            const div = document.createElement('div');
            div.className = 'search-suggestion-item';
            div.textContent = text;
            div.onclick = (e) => { e.stopPropagation(); appState.searchInput.value = text; autoGrowSearchInput(); commenceSearchOrMnemonic(text); };
            appState.searchSuggestions.appendChild(div);
        });

        appState.searchSuggestions.style.display = 'block';
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

export { applyAlignHighlightToggle, buildAlignedSentenceEls, clearSearch, countSourceEntries, dotbotErrorMessage, escapeHtml, findParentFolderId, getItemSearchText, handleSearchFocus, handleSearchInput, isLatinScriptText, setSearchActive, setupDotbotResultDrag, speakerIconHTML, stripHtml, truncateCenter, typewriterReveal, updateSearchDropdown };
