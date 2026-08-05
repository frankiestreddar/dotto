import { searchTypeLabel } from './add-menu.js';
import { applyAlignHighlightToggle, buildAlignedSentenceEls, clearSearch, dotbotAlignHighlightOn, dotbotErrorMessage, dotbotSuggestAbortController, dotbotSuggestDebounceTimer, escapeHtml, getItemSearchText, isLatinScriptText, setupDotbotResultDrag, speakerIconHTML, stripHtml, typewriterReveal, updateSearchDropdown } from './ai-assistant-suggestions.js';
import { appState, canvas } from './core-state.js';
import { saveSnapshot, smoothPanTo } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { openDotbotUpgradeModal, refreshDotbotUsage } from './profile-achievements-pricing.js';
import { commenceDotbotSearch } from './search-orchestration-selection.js';
import { kindIconHTML } from './shared-canvases-outline.js';
import { autoGrowSearchInput, searchDictionary, searchDotbotAnswer, searchExamples, searchImageResult, searchInput, searchInputWrap, searchRecommended, searchResults, searchSuggestions, searchTranslation } from './stopwatch-search-notifications.js';
import { expandWaypointCard, render } from './waypoints-render-loop.js';


    // ---------- Mnemonic story / image (explicit, separate actions — not part of the
    // orchestrated search flow below, so kept simple: one result, no multi-panel handling) ----------
    // Dragging EITHER the story card or the image card onto the canvas brings in BOTH as separate
    // blocks (user can delete the one they don't want afterward) — see
    // importMnemonicPairAtScreenPoint. Whichever templates exist here at drop time get placed;
    // reset to {text:null,image:null} at the start of every new mnemonic (renderMnemonicLoading/
    // renderOwnMnemonicThenImage) so a stale pairing from a previous word never leaks in.
    let dotbotMnemonicPair = { text: null, image: null };
    function importMnemonicPairAtScreenPoint(clientX, clientY) {
        const pair = dotbotMnemonicPair;
        if (!pair.text && !pair.image) return;
        saveSnapshot();
        const rect = canvas.getBoundingClientRect();
        const dropX = Math.round(((clientX - rect.left - appState.tx) / appState.scale) / 28) * 28;
        const dropY = Math.round(((clientY - rect.top - appState.ty) / appState.scale) / 28) * 28;
        function place(template, x, y) {
            appState.folders[appState.currentFolderId].items.push({
                id: appState.idCounter++,
                x, y,
                w: template.w, h: template.h,
                kind: template.kind || 'note',
                html: template.html,
                aiGenerated: true,
            });
        }
        if (pair.text) place(pair.text, dropX, dropY);
        // Offset to the right of the story block so the two never fully overlap; falls back to
        // the same drop point when there's no story block to offset from (e.g. story failed).
        if (pair.image) place(pair.image, dropX + (pair.text ? pair.text.w + 20 : 0), dropY);
        render();
        clearSearch();
    }
    function renderMnemonicResultCard(content, options) {
        options = options || {};
        searchSuggestions.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'search-suggestion-item dotbot-result-card';
        searchSuggestions.appendChild(card);
        function finish() {
            if (options.canvasItem) {
                dotbotMnemonicPair.text = options.canvasItem;
                setupDotbotResultDrag(card, options.canvasItem, { onDrop: importMnemonicPairAtScreenPoint });
            }
            updateSearchDropdown();
        }
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        if (content.typeText !== undefined) typewriterReveal(card, content.typeText, finish);
        else { card.innerHTML = content.html; finish(); }
    }
    // A terminal-style typing loop for "AI is working" states: types one word out character by
    // character, holds briefly, deletes it, then moves to the next — looping — with a solid
    // rectangular block cursor at the caret (not a thin blinking line) that blinks the way a
    // terminal cursor does. One timer per active loading element (keyed by the element itself)
    // so more than one panel (story + image) can run this at once without stepping on each
    // other, and each stops cleanly the moment its own element is replaced/removed.
    const TYPEWRITER_LOADING_WORDS = ['Thinking', 'Consulting', 'Reasoning', 'Picturing', 'Composing', 'Imagining'];
    const typewriterLoadingTimers = new WeakMap();
    function stopTypewriterLoading(el) {
        const timer = typewriterLoadingTimers.get(el);
        if (timer) clearTimeout(timer);
        typewriterLoadingTimers.delete(el);
    }
    function startTypewriterLoading(el) {
        el.innerHTML = `<span class="typewriter-loading-text"></span><span class="typewriter-loading-cursor"></span>`;
        const textEl = el.querySelector('.typewriter-loading-text');
        let wordIndex = 0, charIndex = 0, deleting = false;
        const step = () => {
            if (!el.isConnected) { stopTypewriterLoading(el); return; }
            const word = TYPEWRITER_LOADING_WORDS[wordIndex] + '...';
            let delay;
            if (!deleting) {
                charIndex++;
                textEl.textContent = word.slice(0, charIndex);
                if (charIndex >= word.length) { deleting = true; delay = 900; }
                else delay = 55;
            } else {
                charIndex--;
                textEl.textContent = word.slice(0, charIndex);
                if (charIndex <= 0) { deleting = false; wordIndex = (wordIndex + 1) % TYPEWRITER_LOADING_WORDS.length; delay = 300; }
                else delay = 30;
            }
            typewriterLoadingTimers.set(el, setTimeout(step, delay));
        };
        step();
    }
    function renderMnemonicLoading() {
        dotbotMnemonicPair = { text: null, image: null };
        searchSuggestions.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'search-suggestion-item typewriter-loading';
        searchSuggestions.appendChild(loading);
        startTypewriterLoading(loading);
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
    }
    function renderMnemonicError(reason) {
        searchSuggestions.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'search-suggestion-item';
        errEl.textContent = dotbotErrorMessage(reason);
        searchSuggestions.appendChild(errEl);
        searchSuggestions.style.display = 'block';
        updateSearchDropdown();
        if (reason === 'no_credits') { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }
    // The generated image gets its OWN dedicated panel (#search-image-result — see the
    // fragment/CSS) rather than sharing #search-suggestions with the story card, so a story and
    // its image can both stay visible together instead of the image render wiping the story off
    // screen. Draggable onto the canvas as its own note (same as before) — see
    // setupDotbotResultDrag — and, via its cellImageHtml, straight into a source page's table
    // cell too.
    function renderImageResultLoading() {
        if (!searchImageResult) return;
        searchImageResult.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'search-suggestion-item search-image-loading typewriter-loading';
        searchImageResult.appendChild(loading);
        startTypewriterLoading(loading);
        searchImageResult.style.display = 'block';
        updateSearchDropdown();
    }
    function renderImageResultError(reason) {
        if (!searchImageResult) return;
        searchImageResult.innerHTML = `<div class="search-suggestion-item search-image-loading">${escapeHtml(dotbotErrorMessage(reason))}</div>`;
        searchImageResult.style.display = 'block';
        updateSearchDropdown();
        if (reason === 'no_credits') { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }
    function renderImageResultPanel(imageDataUrl) {
        if (!searchImageResult) return;
        searchImageResult.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'search-suggestion-item dotbot-result-card search-image-result-card';
        card.innerHTML = `<img src="${imageDataUrl}" alt="" style="max-width:100%;border-radius:8px;display:block;">`;
        searchImageResult.appendChild(card);
        searchImageResult.style.display = 'block';
        // 448x252 = exactly 16:9 (both are *28, matching the canvas's own placement grid) — the
        // generated image is 16:9 too (see app/api/dotbot/image/route.js), so this box shows it
        // in full rather than the old square box cropping a widescreen image down to a square.
        dotbotMnemonicPair.image = { w: 448, h: 252, html: `<img src="${imageDataUrl}" style="max-width:100%;height:100%;object-fit:cover;border-radius:8px;">` };
        setupDotbotResultDrag(
            card,
            dotbotMnemonicPair.image,
            { cellImageHtml: `<img class="cell-media-img" src="${imageDataUrl}">`, onDrop: importMnemonicPairAtScreenPoint }
        );
        updateSearchDropdown();
    }
    async function generateMnemonicImage(imageScene) {
        renderImageResultLoading();
        try {
            const res = await fetch('/api/dotbot/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_scene: imageScene })
            });
            const data = await res.json();
            if (!res.ok) { renderImageResultError(data.error); return; }
            refreshDotbotUsage();
            renderImageResultPanel(data.imageDataUrl);
        } catch (e) {
            console.error('[dotbot] image failed:', e);
            renderImageResultError('error');
        }
    }
    // The "my mnemonic for X is Y" flow (see parseMnemonicIntent) — the user already supplied
    // their own mnemonic text, so there's no AI text generation step (no separate image_scene
    // either — their raw text doubles as the scene description), but it still needs to show as a
    // text card above the image (every mnemonic path must show text then image, no exceptions —
    // see commenceSearchOrMnemonic) rather than jumping straight to the image alone.
    function renderOwnMnemonicThenImage(mnemonicText) {
        dotbotMnemonicPair = { text: null, image: null };
        renderMnemonicResultCard({ typeText: mnemonicText }, { canvasItem: { w: 260, h: 160, html: mnemonicText } });
        generateMnemonicImage(mnemonicText);
    }
    // The combined "generate a mnemonic for X" flow (see parseMnemonicIntent) — writes the story
    // first, then automatically continues straight into generating its image, no extra click
    // needed. The story keeps using its own existing card (search-suggestions, with the
    // typewriter reveal); the image lands in the separate panel above.
    async function generateMnemonicStoryAndImage(word) {
        renderMnemonicLoading();
        let sentence, imageScene;
        try {
            const res = await fetch('/api/dotbot/mnemonic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word })
            });
            const data = await res.json();
            if (!res.ok) { renderMnemonicError(data.error); return; }
            refreshDotbotUsage();
            sentence = data.sentence;
            imageScene = data.image_scene;
        } catch (e) {
            console.error('[dotbot] mnemonic failed:', e);
            renderMnemonicError('error');
            return;
        }
        renderMnemonicResultCard({ typeText: sentence }, { canvasItem: { w: 260, h: 160, html: sentence } });
        // image_scene (a short literal action description — see DOTBOT_MNEMONIC_SYSTEM_PROMPT) is
        // what actually drives the image, not the displayed "sentence" — deliberately free of the
        // "Imagine ..." framing, which makes a worse image prompt than a plain scene description.
        generateMnemonicImage(imageScene);
    }
    // Recognizes two ways of asking for a mnemonic straight from the search bar (see the Enter-
    // to-submit handler): "generate/make/create a mnemonic (story) for X" (or bare "mnemonic for
    // X") writes a fresh story then its image; "my mnemonic for X is Y" treats Y as the user's
    // OWN mnemonic and skips straight to generating an image for it. Returns null for anything
    // else, which falls through to the normal orchestrated search.
    function parseMnemonicIntent(query) {
        const q = query.trim().replace(/[?!.]+$/, '');
        let m = q.match(/^my\s+mnemonic\s+for\s+(.+?)\s+is\s+(.+)$/i);
        if (m) return { type: 'own', word: m[1].trim(), mnemonicText: m[2].trim() };
        // Anchored on the core "mnemonic ... for X" phrase rather than enumerating every possible
        // verb — matches "generate/make/create/give me/write me/can you make me/etc. a mnemonic
        // (story) for X" anywhere in the query, so odd phrasings still route to the real
        // generator instead of falling through to a plain-text (no image) response.
        m = q.match(/mnemonic(?:\s+story)?\s+for\s+(.+)$/i);
        if (m) return { type: 'generate', word: m[1].trim() };
        // A bare "mnemonic X" / "mnemonic: X" / "mnemonic - X" with no "for" at all.
        m = q.match(/^mnemonic\s*[:\-]?\s+(.+)$/i);
        if (m) return { type: 'generate', word: m[1].trim() };
        return null;
    }
    // Shared by every way a query gets submitted (Enter, clicking a suggestion/recommended-search
    // row) — routes a mnemonic-shaped query to the right generation flow, or falls through to the
    // normal orchestrated search for everything else. Also where the idle border pulse (see
    // handleSearchFocus) hands off to the real loading state, since this is the one place every
    // submission path passes through.
    function commenceSearchOrMnemonic(query) {
        searchInputWrap.classList.remove('idle-pulsing');
        // Cancel any live-suggestion fetch still in flight from typing, and mark every response
        // from before this point as stale (see scheduleLiveSuggestions) — otherwise a suggestions
        // list that was already loading can land right as/after this submit and overwrite the
        // "thinking..." loading state it's about to show.
        appState.dotbotSearchGeneration++;
        clearTimeout(dotbotSuggestDebounceTimer);
        if (dotbotSuggestAbortController) dotbotSuggestAbortController.abort();
        const intent = parseMnemonicIntent(query);
        if (intent && intent.type === 'generate') { generateMnemonicStoryAndImage(intent.word); return; }
        if (intent && intent.type === 'own') { renderOwnMnemonicThenImage(intent.mnemonicText); return; }
        commenceDotbotSearch(query);
    }

    // ---------- Canvas / source-row local matching (instant, no AI) ----------
    // Scored so the results panel (capped to 4 — see renderCanvasResultsPanel) shows the most
    // relevant and/or recent matches: exact match > starts-with > plain substring, tie-broken by
    // item id (idCounter only ever increases, so a higher id is a more recently created item).
    // Word-prefix matching, not substring — a query only matches if it's a prefix of the item's
    // whole text OR a prefix of one of its individual words, never merely contained partway
    // through one (e.g. "a" matches a note reading "and", but "n" no longer does just because
    // "and" happens to contain an "n"). Also matches by block TYPE: typing any PREFIX of a kind's
    // name (e.g. "n"/"no"/"not"/"note", not just the full word) surfaces every item of that kind,
    // regardless of its content — the highest-priority tier below, since asking for a whole
    // category is a stronger signal than any partial text match.
    function computeCanvasMatches(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const folderObj = appState.folders[appState.currentFolderId];
        const matches = [];
        (folderObj.items || []).forEach(it => {
            const text = getItemSearchText(it);
            const lower = text ? text.toLowerCase() : '';
            let score = 0;
            if (searchTypeLabel(it.kind).toLowerCase().startsWith(q)) score = 4;
            else if (lower === q) score = 3;
            else if (lower && lower.startsWith(q)) score = 2;
            else if (lower && lower.split(/[^\p{L}\p{N}]+/u).some(w => w && w.startsWith(q))) score = 1;
            if (!score) return;
            matches.push({ it, text, score });
        });
        matches.sort((a, b) => b.score - a.score || b.it.id - a.it.id);
        return matches.slice(0, 4);
    }
    function computeSourceMatches(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const folderObj = appState.folders[appState.currentFolderId];
        const tableItem = (folderObj.items || []).find(i => i.kind === 'table');
        if (!tableItem) return [];
        const matches = [];
        tableItem.tableData.forEach((row, ri) => {
            row.forEach((cell) => {
                const text = stripHtml(cell);
                if (!text) return;
                const lower = text.toLowerCase();
                const idx = lower.indexOf(q);
                if (idx === -1) return;
                matches.push({ ri, text, score: lower === q ? 3 : idx === 0 ? 2 : 1, tableId: tableItem.id });
            });
        });
        const seenRows = new Set();
        return matches
            .sort((a, b) => b.score - a.score)
            .filter(m => { if (seenRows.has(m.ri)) return false; seenRows.add(m.ri); return true; })
            .sort((a, b) => a.ri - b.ri)
            .slice(0, 4);
    }
    // Renders whichever ranked+capped match list it's given — hides entirely on zero matches
    // (no "No matches" placeholder anymore). `index` is this row's position (0-based) in the
    // capped max-4 list — shown as a 1-4 pill on the right, and pressing that digit key while the
    // dropdown is open clicks the row exactly like a mouse click would (see the keydown handler
    // near ArrowDown/ArrowUp/Enter further down).
    function renderMatchRow(m, isSourceFolder, index) {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        const indexPill = `<span class="search-result-index-pill">${index + 1}</span>`;
        if (isSourceFolder) {
            div.innerHTML = `<span class="search-result-kind">Row ${m.ri + 1}</span><span class="search-result-text">${escapeHtml(m.text.slice(0, 60))}</span>${indexPill}`;
            div.onclick = (e) => { e.stopPropagation(); goToSourceRow(m.tableId, m.ri); };
        } else {
            div.innerHTML = `${kindIconHTML(m.it.kind, m.it.level, 'search-result-kind-icon')}<span class="search-result-text">${escapeHtml((m.text || '(untitled)').slice(0, 60))}</span>${indexPill}`;
            div.onclick = (e) => { e.stopPropagation(); goToCanvasItem(m.it.id); };
        }
        return div;
    }
    function renderCanvasResultsPanel(matches, isSourceFolder) {
        searchResults.innerHTML = '';
        if (!matches.length) { searchResults.style.display = 'none'; appState.searchActiveIndex = -1; return; }
        matches.forEach((m, i) => {
            const div = renderMatchRow(m, isSourceFolder, i);
            div.dataset.index = i;
            searchResults.appendChild(div);
        });
        searchResults.style.display = 'block';
        appState.searchActiveIndex = -1;
    }
    function goToCanvasItem(id) {
        const it = findItemById(id);
        if (!it) return;
        const el = document.getElementById('item-' + id);
        const w = (it.kind === 'title' ? (el ? el.offsetWidth : 100) : it.w) || 0;
        const h = (it.kind === 'title' ? (el ? el.offsetHeight : 50) : it.h) || 0;
        const cx = it.x + w / 2, cy = it.y + h / 2;
        const targetScale = Math.max(appState.scale, 1);
        smoothPanTo(window.innerWidth / 2 - cx * targetScale, window.innerHeight / 2 - cy * targetScale, targetScale);
        clearSearch();
        if (el) {
            if (it.kind === 'waypoint') expandWaypointCard(el, it, { editable: false });
            flashCanvasElement(el);
        }
    }
    // Same brief highlight every "jump to this item" action lands on it with — search results
    // (above), the hamburger menu's Waypoints panel (peekWaypointCard), and its Outline panel
    // (goToOutlineItem) all share this one flash instead of each re-implementing it.
    function flashCanvasElement(el) {
        if (!el) return;
        el.classList.add('search-flash');
        setTimeout(() => el.classList.remove('search-flash'), 1000);
    }
    function goToSourceRow(tableId, rowIndex) {
        clearSearch();
        // Row 0 (column names) now lives in its own header-pill row entirely separate from
        // the table, so it needs its own lookup rather than a single tr:nth-child across both.
        const target = rowIndex === 0
            ? document.querySelector(`#item-${tableId} .static-table-header-track`)
            : document.querySelector(`#item-${tableId} .item-table tbody tr:nth-child(${rowIndex})`);
        if (!target) return;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.add('row-flash');
        setTimeout(() => target.classList.remove('row-flash'), 1000);
    }

    // ---------- Dictionary / examples panel builders — draggable onto the canvas like any
    // other Dotbot result. ----------
    // Speaks a dictionary entry's headword aloud via Edge TTS (server-side, /api/dotbot/tts —
    // Microsoft Edge's Read Aloud service, unofficial and free, not credit-gated). Replaced the
    // browser's own speechSynthesis: voice quality/availability varied wildly across machines,
    // whereas Edge TTS gives every user the same real neural voice regardless of what's installed
    // locally, and entry.language (a BCP-47 code from the AI) picks a matching voice server-side.
    let currentTtsAudio = null;
    // Shared by every TTS button in the AI results (dictionary headword, dictionary/examples
    // sentences) — speakDictionaryWord below is now a thin wrapper over this.
    async function speakText(text, language, btnEl) {
        if (!text || !text.trim()) return;
        if (currentTtsAudio) { currentTtsAudio.pause(); currentTtsAudio = null; } // stop any previous playback first
        if (btnEl) btnEl.classList.add('loading');
        try {
            const res = await fetch('/api/dotbot/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, language })
            });
            if (!res.ok) throw new Error('tts request failed: ' + res.status);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            currentTtsAudio = audio;
            audio.addEventListener('ended', () => URL.revokeObjectURL(url));
            audio.addEventListener('error', () => URL.revokeObjectURL(url));
            await audio.play();
        } catch (e) {
            console.error('[dotbot] tts failed:', e);
        } finally {
            if (btnEl) btnEl.classList.remove('loading');
        }
    }
    function speakDictionaryWord(entry, btnEl) {
        if (!entry || !entry.word) return;
        return speakText(entry.word, entry.language, btnEl);
    }
    // One card, showing one sense/entry at a time. The drag payload uses getters so dragging
    // always reflects whichever entry is currently on screen, not just whichever was first
    // rendered.
    // Returns a `.dotbot-dictionary-wrap` (position:relative) containing the card itself plus,
    // only when there's more than one sense to cycle through, a `.dotbot-dictionary-arrows`
    // sidebar living OUTSIDE the card on its right edge — hidden under the card by default and
    // sliding out on hover of the wrap (see CSS), rather than living inside the card as before.
    // The "1/3" counter stays inside the card, pinned to its top-right corner. Grammar info is
    // now a set of separate small pills (word/language/one-per-tag) rather than one combined
    // uppercase part-of-speech string — see lib/dotbot.js's "grammarTags". Entries no longer
    // carry a translation of the word/definition into the user's language at all (that's the
    // separate translation panel now — see buildTranslationCard) and no longer carry their own
    // example sentences — see renderOrchestrateResult, which renders "examples" independently.
    function buildDictionaryCard(panel) {
        const entries = (panel.entries || []).slice(0, 5);
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-dictionary-wrap';
        const card = document.createElement('div');
        card.className = 'dotbot-dictionary-card';
        wrap.appendChild(card);
        if (!entries.length) return wrap;
        let index = 0;

        let countEl = null;
        if (entries.length > 1) {
            countEl = document.createElement('span');
            countEl.className = 'dotbot-dictionary-count';
            card.appendChild(countEl);
        }

        const main = document.createElement('div');
        main.className = 'dotbot-dictionary-main';
        card.appendChild(main);

        const headRow = document.createElement('div');
        headRow.className = 'dotbot-dictionary-head-row';
        const wordEl = document.createElement('span');
        wordEl.className = 'dotbot-dictionary-word';
        const audioBtn = document.createElement('button');
        audioBtn.className = 'tts-btn dotbot-dictionary-audio-btn';
        audioBtn.type = 'button';
        audioBtn.title = 'Play pronunciation';
        audioBtn.innerHTML = speakerIconHTML();
        audioBtn.onclick = (e) => { e.stopPropagation(); speakDictionaryWord(entries[index], audioBtn); };
        const ipaEl = document.createElement('span');
        ipaEl.className = 'dotbot-dictionary-ipa';
        // Word, audio button, and IPA transcription all cluster directly next to each other
        // (not pushed to opposite ends of the row) since they're all "about the headword itself".
        headRow.appendChild(wordEl);
        headRow.appendChild(audioBtn);
        headRow.appendChild(ipaEl);
        main.appendChild(headRow);

        const translitEl = document.createElement('div');
        translitEl.className = 'dotbot-dictionary-translit';
        main.appendChild(translitEl);
        const tagsEl = document.createElement('div');
        tagsEl.className = 'dotbot-dictionary-tags';
        main.appendChild(tagsEl);
        const defEl = document.createElement('div');
        defEl.className = 'dotbot-dictionary-def';
        main.appendChild(defEl);

        if (entries.length > 1) {
            const arrowsEl = document.createElement('div');
            arrowsEl.className = 'dotbot-dictionary-arrows';
            const upBtn = document.createElement('button');
            upBtn.type = 'button'; upBtn.className = 'dotbot-dictionary-arrow dotbot-dictionary-arrow-up'; upBtn.textContent = '▲'; upBtn.title = 'Previous sense';
            const downBtn = document.createElement('button');
            downBtn.type = 'button'; downBtn.className = 'dotbot-dictionary-arrow dotbot-dictionary-arrow-down'; downBtn.textContent = '▼'; downBtn.title = 'Next sense';
            upBtn.onclick = (e) => { e.stopPropagation(); index = (index - 1 + entries.length) % entries.length; renderEntry(); };
            downBtn.onclick = (e) => { e.stopPropagation(); index = (index + 1) % entries.length; renderEntry(); };
            arrowsEl.appendChild(upBtn); arrowsEl.appendChild(downBtn);
            wrap.appendChild(arrowsEl); // sibling of `card`, outside it — see .dotbot-dictionary-wrap's hover-slide CSS
        }

        function renderEntry() {
            const entry = entries[index];
            wordEl.textContent = entry.word || '';
            // Suppressed for already-Latin-script words even if the model filled in a
            // transliteration anyway — see isLatinScriptText.
            const showTranslit = entry.transliteration && !isLatinScriptText(entry.word);
            translitEl.textContent = showTranslit ? entry.transliteration : '';
            translitEl.style.display = showTranslit ? 'block' : 'none';
            ipaEl.textContent = entry.ipa ? `/${entry.ipa}/` : '';
            ipaEl.style.display = entry.ipa ? 'inline-block' : 'none';
            tagsEl.innerHTML = '';
            (entry.grammarTags || []).forEach(tag => {
                const pill = document.createElement('span');
                pill.className = 'dotbot-dictionary-tag-pill';
                pill.textContent = tag;
                tagsEl.appendChild(pill);
            });
            tagsEl.style.display = (entry.grammarTags && entry.grammarTags.length) ? 'flex' : 'none';
            defEl.textContent = entry.definition || '';
            if (countEl) countEl.textContent = `${index + 1}/${entries.length}`;
            updateSearchDropdown();
        }
        renderEntry();

        setupDotbotResultDrag(card, {
            w: 240, h: 140,
            get html() {
                const entry = entries[index];
                const tags = (entry.grammarTags && entry.grammarTags.length) ? `(${entry.grammarTags.join(', ')}) ` : '';
                return [entry.word, entry.transliteration, entry.ipa ? `/${entry.ipa}/` : '', `${tags}${entry.definition}`]
                    .filter(Boolean).join('<br>');
            }
        });
        return wrap;
    }
    // `panel.sentences` is a list of {text, translation, romanization, alignment} — translation
    // is only rendered when it actually differs from the sentence itself (i.e. the sentence
    // isn't already English), and romanization only when the model filled it in AND the sentence
    // isn't already Latin script (isLatinScriptText is a client-side backstop on top of the
    // model's own instruction to omit it). Text/translation both get word-alignment highlighting
    // via the shared buildAlignedSentenceEls (see its own comment for the {sourcePhrase,
    // targetPhrase} contract). Each sentence is its own drag handle (not the whole card) —
    // dropped individually onto the canvas as a dedicated 'sentence' card, not a plain note.
    // `panel.language` (the standalone examples panel's own language field) is passed to each
    // sentence's own TTS button so it's spoken correctly rather than falling back to the default
    // English voice.
    // Returns a `.dotbot-examples-wrap` (position:relative) containing the card plus a
    // color-coding on/off toggle button living OUTSIDE it on the right edge, hidden under the
    // card by default and sliding out on hover (same hover-slide mechanic as the dictionary
    // card's nav arrows) — see .dotbot-examples-toggle in globals.css. The toggle is a grey
    // circle when highlighting is off and an rgb-gradient circle when it's on, and flips the
    // SAME global dotbotAlignHighlightOn switch that answerBlocks example pills also read (see
    // applyAlignHighlightToggle) — one switch for all word-alignment highlighting on screen, not
    // just this panel's own sentences.
    function buildExamplesCard(panel) {
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-examples-wrap';
        const card = document.createElement('div');
        card.className = 'dotbot-examples-card';
        wrap.appendChild(card);
        const language = panel.language || '';
        (panel.sentences || []).forEach(s => {
            const wrap = document.createElement('div');
            wrap.className = 'dotbot-example-sentence-wrap';
            const { textEl, translitEl, translationEl } = buildAlignedSentenceEls(s);
            const textRow = document.createElement('div');
            textRow.className = 'dotbot-example-sentence-row';
            const speakBtn = document.createElement('button');
            speakBtn.className = 'tts-btn dotbot-example-audio-btn';
            speakBtn.type = 'button';
            speakBtn.title = 'Play pronunciation';
            speakBtn.innerHTML = speakerIconHTML();
            speakBtn.onclick = (e) => { e.stopPropagation(); speakText(s.text, language, speakBtn); };
            textRow.appendChild(textEl);
            textRow.appendChild(speakBtn);
            wrap.appendChild(textRow);
            if (translitEl) wrap.appendChild(translitEl);
            if (translationEl) wrap.appendChild(translationEl);
            setupDotbotResultDrag(wrap, {
                kind: 'sentence',
                w: 220, h: 130,
                text: s.text || '',
                translit: s.romanization || '',
                translation: translationEl ? s.translation : '',
                html: [s.text, s.romanization, translationEl ? s.translation : ''].filter(Boolean).join(' — '),
            });
            card.appendChild(wrap);
        });
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'dotbot-examples-toggle';
        toggleBtn.title = 'Toggle word color-coding';
        const syncToggleIcon = () => toggleBtn.classList.toggle('is-on', dotbotAlignHighlightOn);
        syncToggleIcon();
        toggleBtn.onclick = (e) => { e.stopPropagation(); applyAlignHighlightToggle(!dotbotAlignHighlightOn); syncToggleIcon(); };
        wrap.appendChild(toggleBtn);
        return wrap;
    }
    // A small, focused panel for direct translation-style queries ("how do you say X in Y",
    // "what does X mean") — see the "translation" field in lib/dotbot.js. Just a word pill with
    // its language labeled above it, an arrow, then an identical pill+label for the translated
    // word — deliberately simpler than the dictionary card (no IPA/audio/grammar info, that's
    // what the dictionary panel above the arrow... below, rather, is for when it's also present).
    function buildTranslationCard(panel) {
        const card = document.createElement('div');
        card.className = 'dotbot-translation-card';
        const buildSide = (word, language) => {
            const side = document.createElement('div');
            side.className = 'dotbot-translation-side';
            const langEl = document.createElement('div');
            langEl.className = 'dotbot-translation-lang';
            langEl.textContent = language || '';
            const pillEl = document.createElement('div');
            pillEl.className = 'dotbot-translation-pill';
            pillEl.textContent = word || '';
            side.appendChild(langEl);
            side.appendChild(pillEl);
            return side;
        };
        card.appendChild(buildSide(panel.sourceWord, panel.sourceLanguage));
        const arrowEl = document.createElement('div');
        arrowEl.className = 'dotbot-translation-arrow';
        arrowEl.textContent = '→';
        card.appendChild(arrowEl);
        card.appendChild(buildSide(panel.targetWord, panel.targetLanguage));
        setupDotbotResultDrag(card, {
            w: 220, h: 100,
            html: `${panel.sourceLanguage}: ${panel.sourceWord} → ${panel.targetLanguage}: ${panel.targetWord}`,
        });
        return card;
    }
    function renderTranslationPanel(panel) {
        if (!searchTranslation) return;
        searchTranslation.innerHTML = '';
        if (!panel || !panel.sourceWord || !panel.targetWord) { searchTranslation.style.display = 'none'; return; }
        searchTranslation.appendChild(buildTranslationCard(panel));
        searchTranslation.style.display = 'block';
    }
    function renderDictionaryPanel(panel) {
        searchDictionary.innerHTML = '';
        if (!panel || !panel.entries || !panel.entries.length) { searchDictionary.style.display = 'none'; return; }
        searchDictionary.appendChild(buildDictionaryCard(panel));
        searchDictionary.style.display = 'block';
    }
    function renderExamplesPanel(panel) {
        searchExamples.innerHTML = '';
        if (!panel) { searchExamples.style.display = 'none'; return; }
        searchExamples.appendChild(buildExamplesCard(panel));
        searchExamples.style.display = 'block';
    }
    // Shown below Dotbot's answer only when it couldn't help with the query (canHelp:false) —
    // gives the user 3 generic searches to click instead of a dead end. Same row markup/click
    // idiom as every other suggestion row in the app: fill the box, commence the search.
    function renderRecommendedSearchesPanel(panel) {
        if (!searchRecommended) return;
        searchRecommended.innerHTML = '';
        if (!panel || !panel.queries || !panel.queries.length) { searchRecommended.style.display = 'none'; return; }
        panel.queries.forEach(q => {
            const div = document.createElement('div');
            div.className = 'search-suggestion-item';
            div.textContent = q;
            div.onclick = (e) => { e.stopPropagation(); searchInput.value = q; autoGrowSearchInput(); commenceSearchOrMnemonic(q); };
            searchRecommended.appendChild(div);
        });
        searchRecommended.style.display = 'block';
    }
    // Dotbot's written answer — just another panel like dictionary/examples, not a chat surface.
    // Height grows naturally with the (typed-out) text as it wraps; draggable onto the canvas
    // like any other Dotbot result.
    function renderDotbotAnswerPanel(text) {
        searchDotbotAnswer.innerHTML = '';
        if (!text) { searchDotbotAnswer.style.display = 'none'; return; }
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-answer-text dotbot-result-card';
        searchDotbotAnswer.appendChild(textEl); // append BEFORE typewriterReveal — it checks
        // el.isConnected on its first tick and silently no-ops forever otherwise.
        searchDotbotAnswer.style.display = 'block';
        setupDotbotResultDrag(textEl, { w: 240, h: 140, html: text });
        typewriterReveal(textEl, text, updateSearchDropdown);
    }
    // The in-depth continuation of a grammar/explanation answer — an ordered sequence of prose
    // paragraphs and highlighted example-sentence pills (see the "answerBlocks" field in
    // lib/dotbot.js), appended into the SAME #search-dotbot-answer container as the short
    // dotbotText intro above it (never a separate panel), so it visually reads as one continuous
    // answer. Rendered instantly, not via typewriterReveal — coordinating a character-by-character
    // reveal across mixed prose/highlighted-example content isn't worth the complexity here.
    // `language` (the dictionary entry's or standalone examples panel's own language, whichever
    // this response actually has — see renderOrchestrateResult) powers each example pill's own
    // TTS button, same convention as buildExamplesCard.
    function renderAnswerBlocksPanel(panel, language) {
        if (!panel || !panel.blocks || !panel.blocks.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-answer-blocks';
        panel.blocks.forEach(b => {
            if (b.type === 'text') {
                const p = document.createElement('div');
                p.className = 'dotbot-answer-block-text';
                p.textContent = b.content || '';
                wrap.appendChild(p);
            } else if (b.type === 'example') {
                const pill = document.createElement('div');
                pill.className = 'dotbot-answer-example-pill';
                const { textEl, translitEl, translationEl } = buildAlignedSentenceEls(b);
                const textRow = document.createElement('div');
                textRow.className = 'dotbot-example-sentence-row';
                const speakBtn = document.createElement('button');
                speakBtn.className = 'tts-btn dotbot-example-audio-btn';
                speakBtn.type = 'button';
                speakBtn.title = 'Play pronunciation';
                speakBtn.innerHTML = speakerIconHTML();
                speakBtn.onclick = (e) => { e.stopPropagation(); speakText(b.text, language, speakBtn); };
                textRow.appendChild(textEl);
                textRow.appendChild(speakBtn);
                pill.appendChild(textRow);
                if (translitEl) pill.appendChild(translitEl);
                if (translationEl) pill.appendChild(translationEl);
                setupDotbotResultDrag(pill, {
                    kind: 'sentence',
                    w: 220, h: 130,
                    text: b.text || '',
                    translit: b.romanization || '',
                    translation: translationEl ? b.translation : '',
                    html: [b.text, b.romanization, translationEl ? b.translation : ''].filter(Boolean).join(' — '),
                });
                wrap.appendChild(pill);
            }
        });
        if (!wrap.children.length) return;
        searchDotbotAnswer.appendChild(wrap);
        searchDotbotAnswer.style.display = 'block';
    }

export { commenceSearchOrMnemonic, computeCanvasMatches, computeSourceMatches, flashCanvasElement, renderAnswerBlocksPanel, renderCanvasResultsPanel, renderDictionaryPanel, renderDotbotAnswerPanel, renderExamplesPanel, renderRecommendedSearchesPanel, renderTranslationPanel };
