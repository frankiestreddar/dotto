import { buildAlignedSentenceEls, clearSearch, dotbotErrorMessage, isLatinScriptText, scrollChatThreadToBottom, setupDotbotResultDrag, speakerIconHTML, typewriterReveal, typewriterRevealSegments, updateSearchDropdown } from './ai-assistant-suggestions.js';
import { appState, canvas } from './core-state.js';
import { openDotbotUpgradeModal, refreshDotbotUsage } from './profile-achievements-pricing.js';
import { commenceDotbotSearch } from './search-orchestration-selection.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Mnemonic story / image (explicit, separate actions — not part of the
    // orchestrated search flow below, so kept simple: one result, no multi-panel handling) ----------
    // Dragging EITHER the story card or the image card onto the canvas brings in BOTH as separate
    // blocks (user can delete the one they don't want afterward) — see
    // importMnemonicPairAtScreenPoint. Whichever templates exist here at drop time get placed;
    // reset to {text:null,image:null} at the start of every new mnemonic (renderMnemonicLoading/
    // renderOwnMnemonicThenImage) so a stale pairing from a previous word never leaks in.
    function importMnemonicPairAtScreenPoint(clientX, clientY) {
        const pair = appState.dotbotMnemonicPair;
        if (!pair.text && !pair.image) return;
        window.__saveSnapshot();
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
    // #search-suggestions' content is real React state now (see app/dotto/SearchSuggestionsPanel.jsx,
    // searchSuggestionsStore) — it's shared by 5 different producers across 3 files (live AI
    // suggestions, this mnemonic story/loading/error trio, and the orchestrate error in search-
    // orchestration-selection.js), so the store holds a small discriminated union ({kind, ...})
    // rather than one plain value — the panel only ever shows ONE of them at a time. Each variant's
    // own build stays vanilla (typewriter reveal, drag-to-canvas wiring); render just decides
    // which one to show.
    // buildMnemonicResultCard/startMnemonicResultReveal split the same way
    // buildDotbotAnswerTextEl/startDotbotAnswerReveal do, for the same reason (typewriterReveal
    // needs the element already connected to the DOM).
    function buildMnemonicResultCard() {
        const card = document.createElement('div');
        card.className = 'search-suggestion-item dotbot-result-card';
        return card;
    }
    function startMnemonicResultReveal(card, content, options) {
        options = options || {};
        function finish() {
            if (options.canvasItem) {
                appState.dotbotMnemonicPair.text = options.canvasItem;
                setupDotbotResultDrag(card, options.canvasItem, { onDrop: importMnemonicPairAtScreenPoint });
            }
            updateSearchDropdown();
        }
        if (content.typeText !== undefined) typewriterReveal(card, content.typeText, finish);
        else { card.innerHTML = content.html; finish(); }
    }
    function renderMnemonicResultCard(content, options) {
        window.__setSearchSuggestions({ kind: 'mnemonic-result', content, options: options || null });
        updateSearchDropdown();
    }
    // A terminal-style typing loop for "AI is working" states: types one word out character by
    // character, holds briefly, deletes it, then moves to the next — looping — with a solid
    // rectangular block cursor at the caret (not a thin blinking line) that blinks the way a
    // terminal cursor does. One timer per active loading element (keyed by the element itself)
    // so more than one panel (story + image) can run this at once without stepping on each
    // other, and each stops cleanly the moment its own element is replaced/removed.
    function stopTypewriterLoading(el) {
        const timer = appState.typewriterLoadingTimers.get(el);
        if (timer) clearTimeout(timer);
        appState.typewriterLoadingTimers.delete(el);
    }
    function startTypewriterLoading(el) {
        el.innerHTML = `<span class="typewriter-loading-text"></span><span class="typewriter-loading-cursor"></span>`;
        const textEl = el.querySelector('.typewriter-loading-text');
        let wordIndex = 0, charIndex = 0, deleting = false;
        const step = () => {
            if (!el.isConnected) { stopTypewriterLoading(el); return; }
            const word = appState.TYPEWRITER_LOADING_WORDS[wordIndex] + '...';
            let delay;
            if (!deleting) {
                charIndex++;
                textEl.textContent = word.slice(0, charIndex);
                if (charIndex >= word.length) { deleting = true; delay = 900; }
                else delay = 55;
            } else {
                charIndex--;
                textEl.textContent = word.slice(0, charIndex);
                if (charIndex <= 0) { deleting = false; wordIndex = (wordIndex + 1) % appState.TYPEWRITER_LOADING_WORDS.length; delay = 300; }
                else delay = 30;
            }
            appState.typewriterLoadingTimers.set(el, setTimeout(step, delay));
        };
        step();
    }
    function buildMnemonicLoadingEl() {
        const loading = document.createElement('div');
        loading.className = 'search-suggestion-item typewriter-loading';
        startTypewriterLoading(loading);
        return loading;
    }
    function renderMnemonicLoading() {
        appState.dotbotMnemonicPair = { text: null, image: null };
        window.__setSearchSuggestions({ kind: 'mnemonic-loading' });
        updateSearchDropdown();
    }
    function buildMnemonicErrorEl(reason) {
        const errEl = document.createElement('div');
        errEl.className = 'search-suggestion-item';
        errEl.textContent = dotbotErrorMessage(reason);
        return errEl;
    }
    function renderMnemonicError(reason) {
        window.__setSearchSuggestions({ kind: 'mnemonic-error', reason });
        updateSearchDropdown();
        if (reason === 'no_credits') { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }
    // The generated image gets its OWN dedicated panel (#search-image-result — see the
    // fragment/CSS) rather than sharing #search-suggestions with the story card, so a story and
    // its image can both stay visible together instead of the image render wiping the story off
    // screen. Draggable onto the canvas as its own note (same as before) — see
    // setupDotbotResultDrag — and, via its cellImageHtml, straight into a source page's table
    // cell too.
    // The image panel's 3 mutually-exclusive states are real React state now (see
    // app/dotto/ImageResultPanel.jsx, imageResultStore) — these build*/render* pairs split the
    // same way buildTranslationCard/renderTranslationPanel do: build stays vanilla (the loading
    // state's typewriter animation, and the success state's drag-to-canvas wiring, both need a
    // real live DOM node to operate on), render just decides which state to show.
    function buildImageResultLoading() {
        const loading = document.createElement('div');
        loading.className = 'search-suggestion-item search-image-loading typewriter-loading';
        startTypewriterLoading(loading);
        return loading;
    }
    function buildImageResultError(reason) {
        const el = document.createElement('div');
        el.className = 'search-suggestion-item search-image-loading';
        el.textContent = dotbotErrorMessage(reason);
        return el;
    }
    function buildImageResultCard(imageDataUrl) {
        const card = document.createElement('div');
        card.className = 'search-suggestion-item dotbot-result-card search-image-result-card';
        card.innerHTML = `<img src="${imageDataUrl}" alt="" style="max-width:100%;border-radius:8px;display:block;">`;
        // 448x252 = exactly 16:9 (both are *28, matching the canvas's own placement grid) — the
        // generated image is 16:9 too (see app/api/dotbot/image/route.js), so this box shows it
        // in full rather than the old square box cropping a widescreen image down to a square.
        appState.dotbotMnemonicPair.image = { w: 448, h: 252, html: `<img src="${imageDataUrl}" style="max-width:100%;height:100%;object-fit:cover;border-radius:8px;">` };
        setupDotbotResultDrag(
            card,
            appState.dotbotMnemonicPair.image,
            { cellImageHtml: `<img class="cell-media-img" src="${imageDataUrl}">`, onDrop: importMnemonicPairAtScreenPoint }
        );
        return card;
    }
    function renderImageResultLoading() {
        if (!appState.searchImageResult) return;
        window.__setImageResult({ status: 'loading' });
    }
    function renderImageResultError(reason) {
        if (!appState.searchImageResult) return;
        window.__setImageResult({ status: 'error', reason });
        if (reason === 'no_credits') { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }
    function renderImageResultPanel(imageDataUrl) {
        if (!appState.searchImageResult) return;
        window.__setImageResult({ status: 'success', imageDataUrl });
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
        appState.dotbotMnemonicPair = { text: null, image: null };
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
    // normal orchestrated search for everything else.
    function commenceSearchOrMnemonic(query) {
        // Cancel any live-suggestion fetch still in flight from typing, and mark every response
        // from before this point as stale (see scheduleLiveSuggestions) — otherwise a suggestions
        // list that was already loading can land right as/after this submit and overwrite the
        // "thinking..." loading state it's about to show.
        appState.dotbotSearchGeneration++;
        clearTimeout(appState.dotbotSuggestDebounceTimer);
        if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
        const intent = parseMnemonicIntent(query);
        if (intent && intent.type === 'generate') { generateMnemonicStoryAndImage(intent.word); return; }
        if (intent && intent.type === 'own') { renderOwnMnemonicThenImage(intent.mnemonicText); return; }
        commenceDotbotSearch(query);
    }

    // Same brief highlight every "jump to this item" action lands on it with — the hamburger
    // menu's Waypoints panel (peekWaypointCard) and its Outline panel (goToOutlineItem) share this
    // one flash instead of each re-implementing it.
    function flashCanvasElement(el) {
        if (!el) return;
        el.classList.add('search-flash');
        setTimeout(() => el.classList.remove('search-flash'), 1000);
    }

    // ---------- Dictionary / examples panel builders — draggable onto the canvas like any
    // other Dotbot result. ----------
    // Speaks a dictionary entry's headword aloud via Edge TTS (server-side, /api/dotbot/tts —
    // Microsoft Edge's Read Aloud service, unofficial and free, not credit-gated). Replaced the
    // browser's own speechSynthesis: voice quality/availability varied wildly across machines,
    // whereas Edge TTS gives every user the same real neural voice regardless of what's installed
    // locally, and entry.language (a BCP-47 code from the AI) picks a matching voice server-side.
    // Shared by every TTS button in the AI results (dictionary headword, dictionary/examples
    // sentences) — speakDictionaryWord below is now a thin wrapper over this.
    async function speakText(text, language, btnEl) {
        if (!text || !text.trim()) return;
        if (appState.currentTtsAudio) { appState.currentTtsAudio.pause(); appState.currentTtsAudio = null; } // stop any previous playback first
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
            appState.currentTtsAudio = audio;
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
    // Splits `text` (a dotbotText/answerBlocks text-block string, already validated server-side —
    // see sanitizeInlineMarkers, app/api/dotbot/orchestrate/route.js) into an ordered sequence of
    // {type:'text', value} / {type:'ref', kind, index} segments. `kind` is 'dictionary'|'example'|
    // 'translation'; `index` is 0 for 'translation' (unused, singleton panel). Consumed by
    // startSequencedTurnReveal to interleave real prose with inline dictionary/example/translation
    // widgets during a fresh turn's reveal.
    function parseInlineMarkers(text) {
        const segments = [];
        const re = /\{\{(dictionary|example):(\d+)\}\}|\{\{translation\}\}/g;
        let last = 0, m;
        while ((m = re.exec(text))) {
            if (m.index > last) segments.push({ type: 'text', value: text.slice(last, m.index) });
            if (m[0] === '{{translation}}') segments.push({ type: 'ref', kind: 'translation', index: 0 });
            else segments.push({ type: 'ref', kind: m[1], index: parseInt(m[2], 10) });
            last = re.lastIndex;
        }
        if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
        return segments;
    }
    // Collapses markers to nothing — same fallback policy as an out-of-range server-side marker
    // (see sanitizeInlineMarkers). Used wherever raw {{...}} syntax shouldn't ever be shown as-is.
    function stripInlineMarkers(text) {
        return text.replace(/\{\{(dictionary|example):\d+\}\}|\{\{translation\}\}/g, '');
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
    // `initialIndex` (optional) opens the card on that sense instead of the first — used when this
    // is built as an inline widget for a specific {{dictionary:N}} reference (see
    // startSequencedTurnReveal). Omitted/invalid falls back to 0, same as every existing caller.
    function buildDictionaryCard(panel, initialIndex) {
        const entries = (panel.entries || []).slice(0, 5);
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-dictionary-wrap';
        const card = document.createElement('div');
        card.className = 'dotbot-dictionary-card';
        wrap.appendChild(card);
        if (!entries.length) return wrap;
        let index = (Number.isInteger(initialIndex) && entries[initialIndex]) ? initialIndex : 0;

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
    // model's own instruction to omit it). Each sentence is its own drag handle (not the whole
    // card) — dropped individually onto the canvas as a plain 'note' (kind omitted below —
    // same default-to-note path buildDictionaryCard/buildTranslationCard/buildDotbotAnswerTextEl
    // already use), per explicit request that example text land as an ordinary, editable note
    // rather than the dedicated read-only 'sentence' card it used to (still used by
    // buildAnswerExamplePill's own inline answer-block pills, below — a different, narrower use
    // case this request didn't ask to change). `panel.language` (the standalone examples panel's
    // own language field) is passed to
    // each sentence's own TTS button so it's spoken correctly rather than falling back to the
    // default English voice. `alignment` (and the "sourcePhrase"/"targetPhrase" data the model
    // still generates for it — see lib/dotbot.js) is currently unused: this used to drive
    // word-for-word color-coding highlights, removed per explicit request; buildAlignedSentenceEls
    // just renders plain escaped text now, ignoring its alignment argument.
    // One sentence's own drag handle + TTS button (extracted from buildExamplesCard's forEach so a
    // single referenced sentence can be shown inline — see startSequencedTurnReveal — without the
    // rest of that panel's sentences or its color-toggle chrome, which doesn't belong floating
    // mid-answer). `language` is the panel's own language field, same TTS fallback as before.
    function buildExampleSentenceEl(s, language) {
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
            w: 220, h: 130,
            html: [s.text, s.romanization, translationEl ? s.translation : ''].filter(Boolean).join('<br>'),
        });
        return wrap;
    }
    function buildExamplesCard(panel) {
        const card = document.createElement('div');
        card.className = 'dotbot-examples-card';
        const language = panel.language || '';
        (panel.sentences || []).forEach(s => {
            card.appendChild(buildExampleSentenceEl(s, language));
        });
        return card;
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
    // Content (buildTranslationCard/buildDictionaryCard's own return value) is real React state
    // now — see app/dotto/TranslationPanel.jsx/DictionaryPanel.jsx, both simple side-effect-only
    // components that mount the SAME vanilla builder's output into #search-translation/
    // #search-dictionary (window.__buildTranslationCard/__buildDictionaryCard) whenever the store
    // changes. The builders themselves stay vanilla — each is a small self-contained widget with
    // its own internal cycling/drag state, not worth rewriting as JSX for this pass.
    function renderTranslationPanel(panel) {
        if (!appState.searchTranslation) return;
        if (!panel || !panel.sourceWord || !panel.targetWord) { window.__setTranslationPanel(null); return; }
        window.__setTranslationPanel(panel);
    }
    function renderDictionaryPanel(panel) {
        if (!panel || !panel.entries || !panel.entries.length) { window.__setDictionaryPanel(null); return; }
        window.__setDictionaryPanel(panel);
    }
    function renderExamplesPanel(panel) {
        window.__setExamplesPanel(panel || null);
    }
    // Shown below every Dotbot answer now, not just when it couldn't help (canHelp:false) — the
    // chat thread's "what could I ask next" suggestions: an AI-generated, answer-specific lead-in
    // sentence (panel.intro, e.g. "But this is just the present and past indicative. Next we
    // could...") + 3 indented rows phrased as its direct continuations (e.g. "...explore the
    // subjunctive mood for these tenses" — see the prompt's own guidance, lib/dotbot.js). Falls
    // back to a generic label for panels persisted before this field existed (older saved chats
    // reopened from the sidebar replay their exact stored panels — see ChatTurn,
    // app/dotto/ChatThread.jsx — which wouldn't have `intro` at all). Same click idiom as every
    // other suggestion row in the app: fill the box, commence the search (continuing the same
    // conversation thread if one's active — commenceSearchOrMnemonic -> commenceDotbotSearch
    // already sends appState.currentConversationId, no special-casing needed here). Returns one
    // wrapping element now (not a bare DocumentFragment) so the intro and the indented row list can
    // share a single indentation container — still just appendChild'd by callers exactly the same
    // way either shape would be.
    function buildRecommendedSearchesRows(panel) {
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-recommended-wrap';
        const label = document.createElement('div');
        label.className = 'dotbot-recommended-label';
        label.textContent = panel.intro || 'Next, I could:';
        wrap.appendChild(label);
        const list = document.createElement('div');
        list.className = 'dotbot-recommended-list';
        panel.queries.forEach(q => {
            const div = document.createElement('div');
            div.className = 'search-suggestion-item';
            div.textContent = q;
            // Submits directly, same code path as pressing Enter on typed text — deliberately never
            // touches appState.searchInput.value first, so the query goes straight to "becoming a
            // message" (the box shows its normal loading state, per commenceDotbotSearch) instead
            // of visibly landing in the search box for a moment first.
            div.onclick = (e) => { e.stopPropagation(); commenceSearchOrMnemonic(q); };
            list.appendChild(div);
        });
        wrap.appendChild(list);
        return wrap;
    }
    function renderRecommendedSearchesPanel(panel) {
        if (!appState.searchRecommended) return;
        if (!panel || !panel.queries || !panel.queries.length) { window.__setRecommendedSearches(null); return; }
        window.__setRecommendedSearches(panel);
    }
    // Dotbot's written answer — just another panel like dictionary/examples, not a chat surface.
    // Height grows naturally with the (typed-out) text as it wraps; draggable onto the canvas
    // like any other Dotbot result. `answerBlocksPanel`/`answerBlocksLanguage` are the in-depth
    // continuation of a grammar/explanation answer (an ordered sequence of prose paragraphs and
    // highlighted example-sentence pills — see the "answerBlocks" field in lib/dotbot.js),
    // appended into the SAME #search-dotbot-answer container as the short text intro above it
    // (never a separate panel), so it visually reads as one continuous answer — this used to be a
    // second exported function (renderAnswerBlocksPanel) that renderOrchestrateResult called
    // immediately afterward, relying on this function having already cleared the container; now
    // that both live in one store (dotbotAnswerStore) they're genuinely one operation. Answer
    // blocks render instantly, not via typewriterReveal — coordinating a character-by-character
    // reveal across mixed prose/highlighted-example content isn't worth the complexity here.
    // `answerBlocksLanguage` (the dictionary entry's or standalone examples panel's own language,
    // whichever this response actually has — see renderOrchestrateResult) powers each example
    // pill's own TTS button, same convention as buildExamplesCard.
    function renderDotbotAnswerPanel(text, answerBlocksPanel, answerBlocksLanguage) {
        window.__setDotbotAnswer(text ? { text, answerBlocksPanel: answerBlocksPanel || null, answerBlocksLanguage: answerBlocksLanguage || '' } : null);
    }
    // Builds the short intro text element (not yet revealed — see startDotbotAnswerReveal) and
    // wires its drag-to-canvas payload. Split from the reveal step because typewriterReveal needs
    // the element already connected to the DOM (checks el.isConnected on its first tick) — the
    // caller (DotbotAnswerPanel.jsx) appends this, then calls startDotbotAnswerReveal.
    function buildDotbotAnswerTextEl(text) {
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-answer-text dotbot-result-card';
        setupDotbotResultDrag(textEl, { w: 240, h: 140, html: text });
        return textEl;
    }
    // onDone defaults to updateSearchDropdown for the (now-inert, see ChatThread.jsx's own comment)
    // #search-dropdown-based DotbotAnswerPanel.jsx caller; ChatTurn (ChatThread.jsx) passes
    // updateChatThread explicitly instead, since a fresh turn's typewriter now grows
    // #search-chat-thread, not #search-dropdown.
    function startDotbotAnswerReveal(textEl, text, onDone) {
        typewriterReveal(textEl, text, onDone || updateSearchDropdown);
    }
    // One answerBlocks "example" block's pill (extracted from buildAnswerBlocksWrap so
    // revealAnswerBlocksStaggered can build blocks one at a time — same pattern as
    // buildExampleSentenceEl above).
    function buildAnswerExamplePill(b, language) {
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
        return pill;
    }
    function buildAnswerBlocksWrap(panel, language) {
        if (!panel || !panel.blocks || !panel.blocks.length) return null;
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-answer-blocks';
        panel.blocks.forEach(b => {
            if (b.type === 'text') {
                const p = document.createElement('div');
                p.className = 'dotbot-answer-block-text';
                // This is a "show the already-final content, no live reveal" path (used by
                // ChatThread.jsx's history-restored branch and the inert DotbotAnswerPanel.jsx) —
                // unlike startSequencedTurnReveal, it never resolves {{dictionary:N}}/{{example:N}}/
                // {{translation}} markers into widgets, so any that made it into the stored text
                // are stripped rather than shown as raw syntax.
                p.textContent = stripInlineMarkers(b.content || '');
                wrap.appendChild(p);
            } else if (b.type === 'example') {
                wrap.appendChild(buildAnswerExamplePill(b, language));
            }
        });
        if (!wrap.children.length) return null;
        return wrap;
    }
    // Wraps `node` for a staggered fade+rise-in reveal step (see .dotbot-block-reveal, globals.css)
    // — shared by revealAnswerBlocksStaggered and startSequencedTurnReveal's own trailing
    // cards/recommended-searches steps.
    function withStaggerIn(node) {
        const wrap = document.createElement('div');
        wrap.className = 'dotbot-block-reveal';
        wrap.appendChild(node);
        requestAnimationFrame(() => wrap.classList.add('dotbot-block-in'));
        return wrap;
    }
    function runStaggered(steps, gapMs, cb) {
        let i = 0;
        (function next() {
            if (i >= steps.length) { cb(); return; }
            steps[i++]();
            setTimeout(next, gapMs);
        })();
    }
    // Same as buildDotbotAnswerTextEl but with NO drag-to-canvas wiring — the fresh-turn sequenced
    // reveal path (startSequencedTurnReveal) uses this instead, since only individual inline
    // widgets should be draggable now, not the whole answer paragraph. buildDotbotAnswerTextEl
    // itself stays untouched — DotbotAnswerPanel.jsx (confirmed inert, see ChatThread.jsx's own
    // comment) still calls it directly.
    function buildDotbotAnswerContainerEl() {
        const textEl = document.createElement('div');
        textEl.className = 'dotbot-answer-text dotbot-result-card';
        return textEl;
    }
    // Fresh-turn-only sequenced reveal (see turn.fresh, app/dotto/ChatThread.jsx — history-restored
    // turns never call this, they render every panel synchronously instead). ALL of `panels` is
    // already fully resolved before this ever runs — this codebase has no streaming anywhere (one
    // request -> one complete JSON response, see app/api/dotbot/orchestrate/route.js), so every
    // placeholder pulse below is a fixed-duration theatrical pacing beat, not a real loading state.
    // Order: (1) dotbotText, typed out, with any {{dictionary:N}}/{{example:N}}/{{translation}}
    // marker resolving to an inline widget in place; (2) answerBlocks, staggered per block, with
    // the same marker resolution inside its text blocks; (3) any dictionary/translation/example
    // content NOT already shown inline, staggered in; (4) recommended-searches. Tracks which
    // dictionary index / example index / translation got shown inline so step 3 never duplicates
    // it — dictionary/translation are shown in full inline (multi-sense cycle arrows / singleton),
    // so referencing either at all makes the standalone card fully redundant; examples are inline
    // one sentence at a time, so the trailing card is a FILTERED copy (remaining sentences only),
    // never entirely dropped.
    function startSequencedTurnReveal(el, panels, onAllDone) {
        // Auto-follows the newest content the whole time this turn is actively revealing — text
        // typing character by character, inline widgets swapping in, staggered blocks/cards
        // appending — so newly-generated text never grows off the bottom of the visible area
        // while it's happening, same "keeps following while generating" behavior other AI chat
        // apps have. A MutationObserver, not the chat thread's own ResizeObserver-driven
        // onOrganicResize (createHeightTransitionController, ai-assistant-suggestions.js) — that
        // one only fires when the THREAD's own OUTER box resizes, which stops being true once it
        // settles into flex:1 against a fixed available space (see #search-chat-thread's own
        // comment, globals.css); content growing WITHIN that fixed box no longer resizes it at
        // all. Scoped to exactly this turn's own reveal lifecycle (disconnected the instant
        // onAllDone fires below) rather than left running permanently — an always-on observer
        // would also fire, and incorrectly yank scroll back to the bottom, for unrelated later
        // mutations, like toggling word-alignment highlighting on an older, already-settled turn.
        const followObserver = new MutationObserver(() => scrollChatThreadToBottom());
        followObserver.observe(el, { childList: true, subtree: true, characterData: true });

        const textPanel = panels.find(p => p.type === 'dotbot_text') || null;
        const dictPanel = panels.find(p => p.type === 'dictionary') || null;
        const examplesPanel = panels.find(p => p.type === 'examples') || null;
        const translationPanel = panels.find(p => p.type === 'translation') || null;
        const answerBlocksPanel = panels.find(p => p.type === 'answer_blocks') || null;
        const recommendedPanel = panels.find(p => p.type === 'recommended_searches') || null;
        const answerLanguage = (dictPanel && dictPanel.entries[0] && dictPanel.entries[0].language) || (examplesPanel && examplesPanel.language) || '';

        const consumedDict = new Set();
        const consumedExamples = new Set();
        let consumedTranslation = false;

        function buildInlineWidget(kind, index) {
            const wrap = document.createElement('div');
            wrap.className = 'dotbot-inline-widget';
            if (kind === 'dictionary' && dictPanel && dictPanel.entries[index]) {
                consumedDict.add(index);
                wrap.appendChild(buildDictionaryCard(dictPanel, index));
            } else if (kind === 'example' && examplesPanel && examplesPanel.sentences[index]) {
                consumedExamples.add(index);
                wrap.appendChild(buildExampleSentenceEl(examplesPanel.sentences[index], examplesPanel.language || ''));
            } else if (kind === 'translation' && translationPanel) {
                consumedTranslation = true;
                wrap.appendChild(buildTranslationCard(translationPanel));
            }
            return wrap;
        }

        function runText(cb) {
            if (!textPanel || !textPanel.text) { cb(); return; }
            const textEl = buildDotbotAnswerContainerEl();
            el.appendChild(textEl);
            const segments = parseInlineMarkers(textPanel.text);
            typewriterRevealSegments(textEl, segments, {
                onPlaceholder: () => {
                    const ph = document.createElement('span');
                    ph.className = 'dotbot-inline-placeholder';
                    textEl.appendChild(ph);
                    return ph;
                },
                onSwap: (kind, index, ph) => { ph.replaceWith(buildInlineWidget(kind, index)); },
                onDone: cb,
            });
        }

        function runAnswerBlocks(cb) {
            if (!answerBlocksPanel || !answerBlocksPanel.blocks.length) { cb(); return; }
            const wrap = document.createElement('div');
            wrap.className = 'dotbot-answer-blocks';
            el.appendChild(wrap);
            const steps = answerBlocksPanel.blocks.map(b => () => {
                const blockEl = document.createElement('div');
                if (b.type === 'text') {
                    parseInlineMarkers(b.content).forEach(seg => {
                        if (seg.type === 'text') blockEl.appendChild(document.createTextNode(seg.value));
                        else blockEl.appendChild(buildInlineWidget(seg.kind, seg.index));
                    });
                    blockEl.className = 'dotbot-answer-block-text';
                } else if (b.type === 'example') {
                    blockEl.appendChild(buildAnswerExamplePill(b, answerLanguage));
                }
                wrap.appendChild(withStaggerIn(blockEl));
            });
            runStaggered(steps, 260, cb);
        }

        function runRemainingCards(cb) {
            const steps = [];
            if (!consumedTranslation && translationPanel) {
                steps.push(() => el.appendChild(withStaggerIn(buildTranslationCard(translationPanel))));
            }
            if (!consumedDict.size && dictPanel && dictPanel.entries.length) {
                steps.push(() => el.appendChild(withStaggerIn(buildDictionaryCard(dictPanel))));
            }
            if (examplesPanel && examplesPanel.sentences.length) {
                const remaining = examplesPanel.sentences.filter((_, i) => !consumedExamples.has(i));
                if (remaining.length) {
                    steps.push(() => el.appendChild(withStaggerIn(buildExamplesCard(Object.assign({}, examplesPanel, { sentences: remaining })))));
                }
            }
            runStaggered(steps, 260, cb);
        }

        function runRecommended(cb) {
            if (!recommendedPanel || !recommendedPanel.queries.length) { cb(); return; }
            el.appendChild(withStaggerIn(buildRecommendedSearchesRows(recommendedPanel)));
            setTimeout(cb, 220);
        }

        runText(() => runAnswerBlocks(() => runRemainingCards(() => runRecommended(() => {
            followObserver.disconnect();
            if (onAllDone) onAllDone();
        }))));
    }

export { buildAnswerBlocksWrap, buildDictionaryCard, buildDotbotAnswerTextEl, buildExamplesCard, buildImageResultCard, buildImageResultError, buildImageResultLoading, buildMnemonicErrorEl, buildMnemonicLoadingEl, buildMnemonicResultCard, buildRecommendedSearchesRows, buildTranslationCard, commenceSearchOrMnemonic, flashCanvasElement, renderDictionaryPanel, renderDotbotAnswerPanel, renderExamplesPanel, renderRecommendedSearchesPanel, renderTranslationPanel, startDotbotAnswerReveal, startMnemonicResultReveal };

// React → vanilla bridge (see the identical pattern/comment in other converted-panel files) —
// used by TranslationPanel.jsx/DictionaryPanel.jsx/ExamplesPanel.jsx/RecommendedSearchesPanel.jsx/
// DotbotAnswerPanel.jsx/ImageResultPanel.jsx/SearchSuggestionsPanel.jsx
// (app/dotto/), which can't import these directly since public/dotto/*.js isn't reachable from
// app/dotto/.
window.__buildTranslationCard = buildTranslationCard;
window.__buildDictionaryCard = buildDictionaryCard;
window.__buildExamplesCard = buildExamplesCard;
window.__buildRecommendedSearchesRows = buildRecommendedSearchesRows;
window.__buildDotbotAnswerTextEl = buildDotbotAnswerTextEl;
window.__startDotbotAnswerReveal = startDotbotAnswerReveal;
window.__buildAnswerBlocksWrap = buildAnswerBlocksWrap;
window.__startSequencedTurnReveal = startSequencedTurnReveal;
window.__stripInlineMarkers = stripInlineMarkers;
window.__buildImageResultLoading = buildImageResultLoading;
window.__buildImageResultError = buildImageResultError;
window.__buildImageResultCard = buildImageResultCard;
window.__buildMnemonicResultCard = buildMnemonicResultCard;
window.__startMnemonicResultReveal = startMnemonicResultReveal;
window.__buildMnemonicLoadingEl = buildMnemonicLoadingEl;
window.__buildMnemonicErrorEl = buildMnemonicErrorEl;
// Used by app/dotto/lib/outlineTree.ts's goToOutlineItem (Phase 4.4).
window.__flashCanvasElement = flashCanvasElement;
