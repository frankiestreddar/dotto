import { clearSearch, escapeHtml, handleSearchFocus, setSearchActive, stripHtml, updateSearchDropdown } from './ai-assistant-suggestions.js';
import { executeCurrentCommand, setCommandActive } from './command-palette.js';
import { appState } from './core-state.js';
import { cancelDotbotScheduleConversation, submitDotbotScheduleAnswer } from './dotbot-schedule-notifications.js';
import { ensureConnections } from './drawing-connections.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { miniLabelForItem } from './live-presence.js';
import { commenceSearchOrMnemonic, computeCanvasMatches, computeSourceMatches, renderCanvasResultsPanel, renderDictionaryPanel, renderDotbotAnswerPanel, renderExamplesPanel, renderRecommendedSearchesPanel, renderTranslationPanel } from './mnemonic-search-matching.js';
import { bumpAchievementStat, openDotbotUpgradeModal, refreshDotbotUsage } from './profile-achievements-pricing.js';
import { colgroupHTML } from './source-table.js';
import { applyAiAddRowsToSource, createSourceFromAI } from './source-tags-ai.js';
import { autoGrowSearchInput, updateSearchSpaceHint } from './stopwatch-search-notifications.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Orchestrated search: one AI call decides which panels are useful. Canvas
    // results keep the fixed slot they already rendered into synchronously, before the network
    // call even started, to avoid layout jank. A written Dotbot answer (when it has one) is
    // the top/first panel in the stack; dictionary/examples are preferred over writing text
    // where possible, so they're common even without an answer panel above them. The search bar
    // itself never moves. ----------
    // Same shape as renderMnemonicError (mnemonic-search-matching.js) — reuses its build function
    // (window.__buildMnemonicErrorEl) via SearchSuggestionsPanel.jsx's 'dotbot-error' branch,
    // since the two are visually/structurally identical (same class, same dotbotErrorMessage
    // extraction), just triggered by a different flow.
    function renderDotbotOrchestrateError(reason) {
        window.__setSearchSuggestions({ kind: 'dotbot-error', reason });
        updateSearchDropdown();
        if (reason === 'no_credits') { appState.dotbotUpgradePromptedForFullness = true; openDotbotUpgradeModal(); }
    }

    // A short, plain-text description of one attached card for the AI's context block — reuses
    // the same text-extraction rules as getItemSearchText/stripHtml, but written against a
    // snapshot's own fields (tableData/tasks/cards/html) rather than assuming a live item, since
    // card-context entries are always snapshots (see addCardsToSearchContext).
    // Structured (not prose) source info for the AI's "Sources attached to this query" block —
    // only "source" cards resolve (a plain "table" or "folder" card is never AI-editable, see
    // applyAiAddRowsToSource) since that function needs snapshot.folderId to reach the LIVE
    // folder later, and only a source snapshot carries one.
    function sourceContextForAI(snapshot) {
        if (snapshot.kind !== 'source') return null;
        const table = (snapshot.snapshotChildren || []).find(c => c.kind === 'table');
        if (!table) return null;
        return {
            headers: (table.tableData[0] || []).map(c => stripHtml(c || '')),
            rowCount: Math.max(0, (table.tableData || []).length - 1),
        };
    }

    function describeCardForAI(snapshot) {
        const label = miniLabelForItem(snapshot);
        let text;
        if (snapshot.kind === 'table' || snapshot.kind === 'source' || snapshot.kind === 'folder') {
            const table = snapshot.kind === 'table' ? snapshot : (snapshot.snapshotChildren || []).find(c => c.kind === 'table');
            text = table ? (table.tableData || []).map(row => row.map(c => stripHtml(c || '')).join(' ')).join(' | ') : (snapshot.snapshotTitle || '');
        } else if (snapshot.kind === 'checklist') {
            text = (snapshot.tasks || []).map(t => t.text).join('; ');
        } else if (snapshot.kind === 'flashcard' || snapshot.kind === 'typeright') {
            text = (snapshot.cards || []).map(c => `${c.front} - ${c.back}`).join('; ');
        } else if (snapshot.kind === 'embed') {
            text = snapshot.embedUrl || '';
        } else if (snapshot.kind === 'filter') {
            const tagCount = (snapshot.filterTagIds || []).length;
            text = tagCount ? `filters by ${tagCount} tag(s), match ${(snapshot.filterMode || 'or').toUpperCase()}` : 'no tags selected yet';
        } else {
            text = stripHtml(snapshot.html || '');
        }
        return `[${label}] ${text}`.trim();
    }

    async function commenceDotbotSearch(query) {
        query = (query || '').trim();
        if (!query || appState.dotbotScheduleConversation) return;
        appState.searchInputWrap.classList.remove('idle-pulsing'); // redundant when reached via commenceSearchOrMnemonic, needed for direct callers like selectionToolbarLookUp
        appState.dotbotSearchGeneration++; // same reasoning — redundant via commenceSearchOrMnemonic, needed for direct callers
        bumpAchievementStat('twenty_searches');
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) return;
        const matches = folderObj.isSource ? computeSourceMatches(query) : computeCanvasMatches(query);
        renderCanvasResultsPanel(matches, folderObj.isSource); // instant, sync — visible before the spinner even shows
        appState.searchDotbotAnswer.innerHTML = ''; appState.searchDotbotAnswer.style.display = 'none';
        appState.searchDictionary.innerHTML = ''; appState.searchDictionary.style.display = 'none';
        appState.searchExamples.innerHTML = ''; appState.searchExamples.style.display = 'none';
        if (appState.searchImageResult) { appState.searchImageResult.innerHTML = ''; appState.searchImageResult.style.display = 'none'; }
        window.__setSearchSuggestions(null);
        if (appState.searchRecommended) { appState.searchRecommended.innerHTML = ''; appState.searchRecommended.style.display = 'none'; }
        clearTimeout(appState.dotbotSuggestDebounceTimer);
        if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
        appState.searchSpinner.classList.add('visible');
        appState.searchInputWrap.classList.add('loading');
        try {
            const res = await fetch('/api/dotbot/orchestrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    canvasMatches: matches.map(m => folderObj.isSource
                        ? { id: m.ri, kind: 'row', label: m.text.slice(0, 60) }
                        : { id: m.it.id, kind: m.it.kind, label: (m.text || '').slice(0, 60) }),
                    isSourceFolder: folderObj.isSource,
                    cardContext: appState.searchCardContext.length ? appState.searchCardContext.map(c => describeCardForAI(c.snapshot)) : undefined,
                    cardConnections: appState.searchCardConnections.length ? appState.searchCardConnections.map(c => {
                        const from = appState.searchCardContext.find(sc => sc.id === c.fromId);
                        const to = appState.searchCardContext.find(sc => sc.id === c.toId);
                        return `${from ? miniLabelForItem(from.snapshot) : c.fromId} -> ${to ? miniLabelForItem(to.snapshot) : c.toId}`;
                    }) : undefined,
                    // Numbered the same way as cardContext above (both mapped from searchCardContext
                    // in the same order) so the server can tell the model "source #N" and get back a
                    // targetIndex that points at the right live card — see applyAiAddRowsToSource.
                    sourceContext: appState.searchCardContext.length ? appState.searchCardContext.map((c, i) => {
                        const info = sourceContextForAI(c.snapshot);
                        return info ? Object.assign({ index: i + 1 }, info) : null;
                    }).filter(Boolean) : undefined
                })
            });
            const data = await res.json();
            appState.searchSpinner.classList.remove('visible');
            appState.searchInputWrap.classList.remove('loading');
            appState.searchInput.blur(); // forces the border back to its plain unfocused state, not whatever :focus/:hover would otherwise show
            appState.searchInput.value = '';
            autoGrowSearchInput();
            if (!res.ok) { renderDotbotOrchestrateError(data.error); return; }
            refreshDotbotUsage();
            renderOrchestrateResult(data.panels || []);
        } catch (e) {
            appState.searchSpinner.classList.remove('visible');
            appState.searchInputWrap.classList.remove('loading');
            appState.searchInput.blur();
            appState.searchInput.value = '';
            autoGrowSearchInput();
            console.error('[dotbot/orchestrate] failed:', e);
            renderDotbotOrchestrateError('error');
        }
    }

    function renderOrchestrateResult(panels) {
        // Fresh per result — every aligned sentence element built below (dictionary's examples,
        // and any answerBlocks example pills) registers itself here so the examples panel's
        // color-coding toggle can re-render them in place (see applyAlignHighlightToggle); a
        // stale registry would otherwise keep referencing long-gone elements from a prior search.
        appState.dotbotAlignedRegistry = [];
        const textPanel = panels.find(p => p.type === 'dotbot_text');
        // dictPanel/examplesPanel are hoisted above the renderDotbotAnswerPanel call (pure lookups,
        // no side effects, so reordering them is a no-op otherwise) since answerLanguage — the
        // in-depth answer_blocks continuation's language, reusing whichever the dictionary/
        // examples panel already carries so its example pills' TTS buttons speak correctly —
        // needs both, and renderDotbotAnswerPanel now takes the answer_blocks panel + language
        // directly (see its own comment for why it merged what used to be a second function call).
        const dictPanel = panels.find(p => p.type === 'dictionary') || null;
        // Always rendered independently now — dictionary entries no longer carry their own
        // sentences (see buildDictionaryCard), so "examples" is the one place they come from
        // whether or not a dictionary panel is also present.
        const examplesPanel = panels.find(p => p.type === 'examples') || null;
        const answerLanguage = (dictPanel && dictPanel.entries && dictPanel.entries[0] && dictPanel.entries[0].language) || (examplesPanel && examplesPanel.language) || '';
        renderDotbotAnswerPanel(textPanel ? textPanel.text : null, panels.find(p => p.type === 'answer_blocks') || null, answerLanguage);
        // Its own small panel, shown above the dictionary panel — only for direct
        // translation-style queries (see lib/dotbot.js's "translation" field).
        renderTranslationPanel(panels.find(p => p.type === 'translation') || null);
        renderDictionaryPanel(dictPanel);
        renderExamplesPanel(examplesPanel);
        renderRecommendedSearchesPanel(panels.find(p => p.type === 'recommended_searches') || null);
        // Applies the mutation directly rather than rendering a confirmation panel of its own —
        // "dotbotText" above already reads as the confirmation (see the prompt), and the change
        // is immediately visible on the actual card/canvas.
        const sourceActionPanel = panels.find(p => p.type === 'source_action');
        if (sourceActionPanel) {
            if (sourceActionPanel.action === 'create_source') createSourceFromAI(sourceActionPanel.title, sourceActionPanel.columns, sourceActionPanel.rows);
            else if (sourceActionPanel.action === 'add_rows') applyAiAddRowsToSource(sourceActionPanel.targetIndex, sourceActionPanel.columns, sourceActionPanel.rows);
        }
        updateSearchDropdown();
    }

    // ---------- Text selection toolbar (copy / paste / look up / add to source) ----------
    // Fires on every selection change anywhere in the document; only reacts when the selection
    // is non-empty AND lives inside an actual editable surface — [contenteditable="true"] is the
    // only kind of element CSS grants user-select:text to at all (see the global `*{user-select:
    // none}` reset plus its `[contenteditable="true"], input, textarea{user-select:text}`
    // override in globals.css), so this can't fire for arbitrary page chrome.
 // cloned Range, captured at the moment the toolbar shows
 // the [contenteditable] element the selection lives in
 // last shown position, reused to place the add-to-source popup nearby
    // Phase 2 increment 2: the toolbar element itself is now real React (see
    // app/dotto/SelectionToolbar.jsx) — this file still owns WHEN to show/hide it and WHERE
    // (both fundamentally about reading native browser selection state, not a rendering concern),
    // via the window.__setSelectionToolbarState bridge (app/dotto/bridges.js).
    function hideSelectionToolbar() {
        window.__setSelectionToolbarState({ isOpen: false, left: 0, top: 0 });
        appState.selectionToolbarRange = null;
        appState.selectionToolbarHostEl = null;
    }
    function currentSelectionText() {
        return appState.selectionToolbarRange ? appState.selectionToolbarRange.toString() : '';
    }
    // Shared by both selection sources: the plain document-level listener below (contentEditable
    // cards and PDF text layers — both live in the main document) and buildEpubViewer's
    // rendition.on('selectedRange', ...) hook (EPUB content lives inside its own same-origin
    // iframe, whose Range coordinates are relative to THAT iframe, not the main page — rectOverride
    // lets that caller supply the already-offset page-relative rect instead of range.getBoundingClientRect()).
    function showSelectionToolbarFor(range, host, rectOverride) {
        appState.selectionToolbarRange = range;
        appState.selectionToolbarHostEl = host;
        // The RAW selection rect — kept exactly as before, independently of the toolbar's own
        // (clamped) screen position below, since openAddToSourcePopup positions itself relative
        // to this, not to wherever the toolbar itself ended up clamped to.
        const rect = rectOverride || range.getBoundingClientRect();
        appState.selectionToolbarRect = rect;
        // Clamped so a selection near the top/left edge of the screen doesn't push the toolbar
        // off-screen — same 20px-from-edge convention used for other floating-panel clamping.
        const toolbarWidth = 150; // rough estimate ahead of layout (two small pills); good enough for clamping
        let left = Math.round(rect.left + rect.width / 2 - toolbarWidth / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));
        const top = Math.max(8, Math.round(rect.top - 40));
        window.__setSelectionToolbarState({ isOpen: true, left, top });
    }
    document.addEventListener('selectionchange', () => {
        // A selectionchange firing because the user is typing inside the add-to-source popup's
        // own search box isn't a text highlight to react to. React only renders the popup at all
        // while open (see app/dotto/AddToSourcePopup.jsx) — this file can't import from app/ to
        // read the bridge store directly (same constraint noted throughout core-state.js), so the
        // element's mere presence in the DOM doubles as the open-check here.
        if (document.getElementById('add-to-source-popup')) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideSelectionToolbar(); return; }
        const anchorEl = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        // .pdf-text-layer alongside the usual [contenteditable] — pdf.js's TextLayer renders real,
        // positioned, selectable <span>s directly into the main document (no iframe involved for
        // PDFs, unlike EPUB above), so it Just Works here once recognized as a valid host — see
        // buildPdfViewer.
        const host = anchorEl && anchorEl.closest && anchorEl.closest('[contenteditable="true"], .pdf-text-layer');
        if (!host) { hideSelectionToolbar(); return; }
        showSelectionToolbarFor(sel.getRangeAt(0).cloneRange(), host);
    });
    // Outside click hides it — same convention as the game options panel's own document-level
    // pointerdown listener.
    document.addEventListener('pointerdown', (e) => {
        // React only renders #selection-toolbar at all while open (see
        // app/dotto/SelectionToolbar.jsx) — this file can't import from app/ to read the bridge
        // store directly (same constraint noted throughout core-state.js), so the element's mere
        // presence in the DOM doubles as the open-check here.
        const toolbarEl = document.getElementById('selection-toolbar');
        if (toolbarEl && !toolbarEl.contains(e.target)) hideSelectionToolbar();
    });
    // Always phrased as an explicit meaning/translation question — never just the bare selected
    // text — so the orchestrate model reliably returns the "dictionary" panel (its own prompt,
    // see lib/dotbot.js, only fills that panel "for a word/phrase meaning question"; a bare
    // word or phrase alone doesn't reliably read as one). Shown in the search bar exactly as
    // sent, matching how recommended-search pills elsewhere already show full natural-language
    // questions rather than bare words.
    function selectionToolbarLookUp() {
        const text = currentSelectionText().trim();
        hideSelectionToolbar();
        if (!text || !appState.searchInput) return;
        const query = `What does "${text}" mean?`;
        appState.searchInput.value = query;
        autoGrowSearchInput();
        commenceDotbotSearch(query);
        appState.searchInput.focus();
    }

    // ---------- Add to source popup ----------
    // Every source is a folder with isSource:true holding exactly one 'table' item (see
    // add()'s 'source' branch) — `folders` is a flat map of EVERY folder in the account (not
    // nested), so this is a full account-wide list, not just the current canvas.
 // {folder, table} — the currently chosen destination
    function findAllSourceFolders() {
        return Object.values(appState.folders).filter(f => f.isSource && f.items.some(i => i.kind === 'table'));
    }
    // Picks the default destination, in priority order: (1) we're editing inside a source's own
    // table already, (2) the item being edited IS a source card, (3) the item being edited is
    // connected (a drawn canvas connection) to a source card, (4) the geometrically nearest
    // source card in the same folder, (5) the first source anywhere in the account.
    function findDefaultSourceForItem(hostEl) {
        const folder = appState.folders[appState.currentFolderId];
        if (!folder) return null;
        const tableOf = (f) => f && f.items.find(i => i.kind === 'table');
        if (folder.isSource) {
            const table = tableOf(folder);
            if (table) return { folder, table };
        }
        const itemEl = hostEl && hostEl.closest ? hostEl.closest('.item') : null;
        const itemId = itemEl && itemEl.id ? Number(itemEl.id.replace('item-', '')) : null;
        const it = itemId != null ? folder.items.find(i => i.id === itemId) : null;
        if (it && it.kind === 'source') {
            const table = tableOf(appState.folders[it.folderId]);
            if (table) return { folder: appState.folders[it.folderId], table };
        }
        if (it) {
            const conns = ensureConnections(folder);
            const connectedIds = conns.filter(c => c.fromId === it.id || c.toId === it.id)
                .map(c => c.fromId === it.id ? c.toId : c.fromId);
            for (const cid of connectedIds) {
                const other = folder.items.find(i => i.id === cid);
                if (other && other.kind === 'source') {
                    const table = tableOf(appState.folders[other.folderId]);
                    if (table) return { folder: appState.folders[other.folderId], table };
                }
            }
        }
        if (it) {
            const sources = folder.items.filter(i => i.kind === 'source' && tableOf(appState.folders[i.folderId]));
            if (sources.length) {
                let best = null, bestDist = Infinity;
                sources.forEach(s => {
                    const dx = (s.x || 0) - (it.x || 0), dy = (s.y || 0) - (it.y || 0);
                    const d = dx * dx + dy * dy;
                    if (d < bestDist) { bestDist = d; best = s; }
                });
                if (best) return { folder: appState.folders[best.folderId], table: tableOf(appState.folders[best.folderId]) };
            }
        }
        const anySourceFolder = findAllSourceFolders()[0];
        return anySourceFolder ? { folder: anySourceFolder, table: tableOf(anySourceFolder) } : null;
    }
    // The popup element itself is real React state now (see app/dotto/AddToSourcePopup.jsx,
    // addToSourcePopupStore) — existence/position/visibility all move together as one {isOpen,
    // left, top}, same shape as selectionToolbarStore. window.__setAddToSourcePopupOpen
    // (app/dotto-app.jsx) wraps its store.set in flushSync so the div already exists in the DOM
    // by the time openAddToSourcePopup calls renderAddToSourcePopup right after (below) — that
    // function, and every rebuild it triggers internally (source search, source pick), still
    // build the popup's actual CONTENT fully vanilla, same "React owns the shell, vanilla owns a
    // self-contained widget's internals" split as buildDictionaryCard.
    function closeAddToSourcePopup() {
        window.__setAddToSourcePopupOpen({ isOpen: false, left: 0, top: 0 });
        appState.addToSourceTarget = null;
    }
    document.addEventListener('pointerdown', (e) => {
        const popup = document.getElementById('add-to-source-popup');
        if (popup && !popup.contains(e.target)) closeAddToSourcePopup();
    });
    // Rebuilt from scratch on every change (source search, source pick) — this popup's whole
    // state is small and short-lived, same tradeoff renderGameOptionsHTML makes.
    // Reuses the SAME markup/classes a real source page renders its column-pill row and data
    // row with (buildHeaderPillsHTML's .col-name-slot/.col-name-pill/.col-name-input,
    // renderStaticTableHTML's .table-rounded/.item-table/.cell-inner/.cell-text, colgroupHTML)
    // so this entry looks pixel-identical to one row of the real thing — just without that
    // system's dynamic pixel-based column-width/scroll JS (layoutSourceTableColumns), which is
    // wired to a real mounted card's own resize lifecycle; equal percentage widths here (via
    // colgroupHTML itself, already percentage-based) give the same aligned look for a fixed-width
    // popup with a normal number of columns.
    function renderAddToSourcePopup(prefillText) {
        const popup = document.getElementById('add-to-source-popup');
        if (!popup) return;
        const target = appState.addToSourceTarget;
        const table = target ? target.table : null;
        const headers = table ? table.tableData[0].map(h => stripHtml(h || '')) : [];
        const numCols = headers.length;
        const pillWidth = numCols ? (100 / numCols).toFixed(4) : 100;
        const pillsHTML = headers.map((h, i) => `
            <div class="col-name-slot" style="width:${pillWidth}%">
                <div class="col-name-pill"><input type="text" class="col-name-input" readonly value="${escapeHtml(h)}" placeholder="Column ${i + 1}"></div>
            </div>`).join('');
        const cg = colgroupHTML(numCols);
        const cellsHTML = headers.map((_, i) => `
            <td>
                <div class="cell-inner">
                    <div class="cell-text add-to-source-cell-input" contenteditable="true" data-col="${i}">${i === 0 ? escapeHtml(prefillText || '') : ''}</div>
                </div>
            </td>`).join('');
        const entryHTML = numCols
            ? `<div class="add-to-source-entry">
                   <div class="add-to-source-entry-table">
                       <div class="static-table-header-track">${pillsHTML}</div>
                       <div class="static-table-row"><div class="table-rounded"><table class="item-table">${cg}<tbody><tr>${cellsHTML}</tr></tbody></table></div></div>
                   </div>
                   <button type="button" class="add-to-source-add-btn" title="Add entry"><img src="/assets/icons/add-btn.png" alt="Add"></button>
               </div>`
            : `<div class="add-to-source-empty">This source has no columns yet — open it to add one first.</div>`;
        popup.innerHTML = `
            <input type="text" class="add-to-source-search" placeholder="Search sources by name…" value="${target ? escapeHtml(target.folder.title) : ''}">
            <div class="add-to-source-results"></div>
            ${target ? entryHTML : `<div class="add-to-source-empty">No sources yet — create one from the Add menu first.</div>`}
        `;
        const searchEl = popup.querySelector('.add-to-source-search');
        const resultsEl = popup.querySelector('.add-to-source-results');
        searchEl.onmousedown = (e) => e.stopPropagation();
        searchEl.oninput = () => {
            const q = searchEl.value.trim().toLowerCase();
            if (!q) { resultsEl.innerHTML = ''; resultsEl.classList.remove('open'); return; }
            const matches = findAllSourceFolders().filter(f => f.title.toLowerCase().includes(q)).slice(0, 8);
            resultsEl.innerHTML = matches.length
                ? matches.map(f => `<div class="add-to-source-result" data-fid="${f.id}">${escapeHtml(f.title)}</div>`).join('')
                : `<div class="add-to-source-result add-to-source-no-match">No matches</div>`;
            resultsEl.classList.add('open');
            resultsEl.querySelectorAll('.add-to-source-result[data-fid]').forEach(row => {
                row.onclick = () => {
                    const f = appState.folders[row.dataset.fid];
                    appState.addToSourceTarget = { folder: f, table: f.items.find(i => i.kind === 'table') };
                    renderAddToSourcePopup(prefillText);
                };
            });
        };
        const addBtn = popup.querySelector('.add-to-source-add-btn');
        if (addBtn) {
            addBtn.onclick = () => {
                // .innerHTML (not .value/.textContent) — matches how a real source cell is
                // stored (see updateTableCell: it.tableData[r][c] = el.innerHTML).
                const cells = Array.from(popup.querySelectorAll('.add-to-source-cell-input')).map(el => el.innerHTML);
                if (!cells.some(c => stripHtml(c).trim())) return;
                // saveSnapshot/scheduleWorkspaceSave both operate on the whole `folders` object,
                // not just the current one (see their own definitions) — safe to call here even
                // when the target source lives in a folder other than the one open right now.
                saveSnapshot();
                appState.addToSourceTarget.table.tableData.push(cells);
                scheduleWorkspaceSave();
                if (appState.currentFolderId === appState.addToSourceTarget.folder.id) render();
                closeAddToSourcePopup();
            };
        }
    }
    function openAddToSourcePopup() {
        const text = currentSelectionText();
        const host = appState.selectionToolbarHostEl;
        const rect = appState.selectionToolbarRect;
        hideSelectionToolbar();
        appState.addToSourceTarget = findDefaultSourceForItem(host);
        const popupWidth = 280;
        let left = rect ? Math.round(rect.left) : window.innerWidth / 2 - popupWidth / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
        const estPopupHeight = 280; // rough estimate ahead of layout, same tradeoff as toolbarWidth above
        const top = rect ? Math.max(8, Math.min(window.innerHeight - estPopupHeight - 8, Math.round(rect.bottom + 10))) : window.innerHeight / 2 - estPopupHeight / 2;
        // flushSync'd (see window.__setAddToSourcePopupOpen, app/dotto-app.jsx) — the div must
        // already exist in the DOM before renderAddToSourcePopup below can find it.
        window.__setAddToSourcePopupOpen({ isOpen: true, left, top });
        renderAddToSourcePopup(text);
    }

    if (appState.searchInput) {
        // Clicking the input again after it already has focus (e.g. right after a completed
        // search, which doesn't blur it) doesn't re-fire the browser's own `focus` event — so
        // onfocus="handleSearchFocus()" alone would silently do nothing until the next keystroke.
        // Calling it here too makes a click always reopen the initial-suggestion state.
        appState.searchInput.addEventListener('click', (e) => { e.stopPropagation(); handleSearchFocus(); });
        appState.searchInput.addEventListener('blur', updateSearchSpaceHint);
        // Clicking/tabbing away without submitting stops the idle pulse (see handleSearchFocus) —
        // Escape's own searchInput.blur() call elsewhere routes through this same listener too.
        appState.searchInput.addEventListener('blur', () => appState.searchInputWrap.classList.remove('idle-pulsing'));
        appState.searchInput.addEventListener('keydown', (e) => {
            if (appState.dotbotScheduleConversation) {
                if (e.key === 'Enter') { e.preventDefault(); submitDotbotScheduleAnswer(appState.searchInput.value); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelDotbotScheduleConversation(); }
                return;
            }
            if (e.key === 'Escape') { clearSearch(); return; }
            // Slash-command mode (see command-palette.js) — Arrow/Enter get their own meaning
            // here (navigate/execute a command) instead of falling through to the
            // #search-results-specific logic below, which stays harmlessly inert anyway (that
            // panel is always hidden while a command is being typed — see handleSearchInput's own
            // command branch) but this is clearer than relying on that. Every other key (typing,
            // Backspace, Tab, ...) intentionally falls through to the textarea's normal behavior —
            // nothing here should ever swallow an edit keystroke.
            if (appState.searchInput.value.startsWith('/')) {
                if (e.key === 'ArrowDown' && appState.searchCommandPalette.style.display === 'block') { e.preventDefault(); setCommandActive(appState.commandActiveIndex + 1); return; }
                if (e.key === 'ArrowUp' && appState.searchCommandPalette.style.display === 'block') { e.preventDefault(); setCommandActive(appState.commandActiveIndex - 1); return; }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (appState.searchCommandPalette.style.display === 'block' && appState.commandActiveIndex >= 0) {
                        const items = Array.from(appState.searchCommandPalette.querySelectorAll('.command-palette-row'));
                        const target = items[appState.commandActiveIndex];
                        if (target) { target.click(); return; }
                    }
                    executeCurrentCommand(appState.searchInput.value);
                    return;
                }
            }
            // Mirrors the global Enter-to-open shortcut (see the document-level keydown handler,
            // which only fires while nothing's focused) — once the box itself is focused and still
            // empty, Enter closes it back up instead of submitting, so the same key toggles the
            // search bar open/closed depending on which state it's already in. Checked before the
            // general Enter-submits-search handler below, so a non-empty box still submits as usual.
            if (e.key === 'Enter' && appState.searchInput.value.trim() === '') { e.preventDefault(); clearSearch(); appState.searchInput.blur(); return; }
            if (e.key === 'ArrowDown' && appState.searchResults.style.display === 'block') { e.preventDefault(); setSearchActive(appState.searchActiveIndex + 1); return; }
            if (e.key === 'ArrowUp' && appState.searchResults.style.display === 'block') { e.preventDefault(); setSearchActive(appState.searchActiveIndex - 1); return; }
            // 1-4 pick a visible result directly (see the pill on each row — always max 4 shown,
            // see the .slice(0, 4) in matchesFor), the same one-key jump ArrowDown+Enter would
            // take several presses to reach. Only hijacks the digit when there's actually a
            // matching row to jump to — e.g. pressing "3" with only 2 results showing still types
            // a normal "3" into the query, same as it would with the dropdown closed entirely.
            if (['1', '2', '3', '4'].includes(e.key) && appState.searchResults.style.display === 'block') {
                const items = Array.from(appState.searchResults.querySelectorAll('.search-result-item'));
                const target = items[Number(e.key) - 1];
                if (target) { e.preventDefault(); target.click(); return; }
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                // Arrowed down to a specific canvas match — Enter jumps to that, same as clicking it.
                if (appState.searchResults.style.display === 'block' && appState.searchActiveIndex >= 0) {
                    const items = Array.from(appState.searchResults.querySelectorAll('.search-result-item'));
                    const target = items[appState.searchActiveIndex];
                    if (target) { target.click(); return; }
                }
                // Otherwise, Enter on whatever's typed commences a Dotbot search — or, for a
                // mnemonic-shaped query ("generate a mnemonic for X" / "my mnemonic for X is
                // Y"), routes straight into story+image generation instead (see
                // commenceSearchOrMnemonic/parseMnemonicIntent).
                const value = appState.searchInput.value.trim();
                if (value) commenceSearchOrMnemonic(value);
            }
        });
    }

export { commenceDotbotSearch, openAddToSourcePopup, selectionToolbarLookUp, showSelectionToolbarFor };

// Not inline-HTML onclick targets (see window-bridge.js's own header comment for why those live
// there instead) — app/dotto/SelectionToolbar.jsx's two buttons call these directly, same
// rationale as pushNotification's bridge in stopwatch-search-notifications.js (Phase 2
// increment 1).
window.selectionToolbarLookUp = selectionToolbarLookUp;
window.openAddToSourcePopup = openAddToSourcePopup;
