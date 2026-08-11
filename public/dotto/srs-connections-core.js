import { kindLabel, kindSize } from './add-menu.js';
import { handleSearchInput, stripHtml } from './ai-assistant-suggestions.js';
import { removePlacementGhost } from './copy-paste.js';
import { addMenu, appState, btnAdd, canvas, drawBackBtn, drawColorInput, drawEraserBtn, drawFrontBtn, drawPenBtn, drawSettings, drawSizeInput, effectiveMode, world, zoomTrack } from './core-state.js';
import { computeConnectorPoints, createConnection, ensureConnections, ensureDrawings, findLinkedTable, findTableById, itemRect, makeLayerSVG, pathNearPoint, pointsToLinePath, pointsToPath } from './drawing-connections.js';
import { defaultFlashcardDeck } from './games-flashcard-typeright.js';
import { applyTransform, saveSnapshot, scheduleApplyTransform } from './history-autosave.js';
import { broadcastEditingState } from './live-presence.js';
import { awardUserPoints, bumpAchievementStat } from './profile-achievements-pricing.js';
import { handleScheduleModeWheel, SCHEDULE_ALL } from './schedule-view-canvas.js';
import { setOutlineActive, toggleHamburgerMenu } from './shared-canvases-outline.js';
import { pushNotification } from './stopwatch-search-notifications.js';
import { render, renderSelectedOutlines, startBoxSelection, syncWaypointToDb } from './waypoints-render-loop.js';


    // ---------- SM-2 Spaced Repetition ----------
    // Per-row memory state lives on the table itself (table.srsMeta[rowIndex]), keyed by the
    // row's position in tableData — never on the flashcard/statcard/shelf that merely displays
    // it, so the schedule survives deleting and recreating any downstream card.
    function defaultSrsState() {
        return { interval: 1, easeFactor: 2.5, dueDate: Date.now(), repetitions: 0 };
    }
    function ensureSrsMeta(table) {
        if (!table.srsMeta) table.srsMeta = {};
        return table.srsMeta;
    }
    function getSrsForRow(table, rowIndex) {
        const meta = ensureSrsMeta(table);
        if (!meta[rowIndex]) meta[rowIndex] = defaultSrsState();
        return meta[rowIndex];
    }
    // Maps our four grading buttons onto the classic SM-2 0-5 quality scale.
    // Classic SM-2: given a card's current {interval, easeFactor, repetitions} and a 0-5
    // quality score, returns the updated memory state (mutates and returns `card`).
    function calculateSM2(card, quality) {
        if (quality < 3) {
            // Incorrect answers reset repetition streak and interval
            card.repetitions = 0;
            card.interval = 1;
        } else {
            // Correct answers advance the streak and interval
            if (card.repetitions === 0) {
                card.interval = 1;
            } else if (card.repetitions === 1) {
                card.interval = 6;
            } else {
                card.interval = Math.round(card.interval * card.easeFactor);
            }
            card.repetitions++;
        }
        // Adjust the Ease Factor based on SM-2 formula
        card.easeFactor = card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (card.easeFactor < 1.3) card.easeFactor = 1.3; // Cap it so it doesn't break
        // Calculate next due date timestamp
        card.dueDate = Date.now() + card.interval * 24 * 60 * 60 * 1000;
        return card;
    }

    // Returns { rows, headers } (or null) rather than a bare rows array — `headers` is the
    // table's own header row (plain text, one per column) and each row now also carries `cells`
    // (the RAW per-column HTML, every column, not just front/back) alongside the existing
    // front/back/rowIndex/etc — so a downstream game card can apply its OWN per-side column
    // selection (see gameConfig/resolveGameFace) instead of only ever seeing column 0/1 flattened
    // to plain text. `front`/`back` (column 0/1, stripped) are kept exactly as before so every
    // existing consumer that destructures {rows} the old way keeps working unchanged.
    function extractCardsFromSource(fromItem) {
        const table = findLinkedTable(fromItem);
        if (!table || !table.tableData || table.tableData.length < 2) return null;
        const rows = [];
        table.tableData.forEach((r, rowIndex) => {
            if (rowIndex === 0) return; // header row
            if (!r.some(c => stripHtml(c || '').trim() !== '')) return; // skip blank rows
            rows.push({
                front: stripHtml(r[0] || ''),
                back: stripHtml((r.length > 1 ? r[1] : r[0]) || ''),
                cells: r.slice(),
                rowIndex,
                // originTableId lets a downstream consumer (an srsUpdate flowing back, or a
                // filter card) always find its way back to the REAL table this row came from —
                // essential once rows can flow through a filter or a merged source and no longer
                // necessarily share the receiving card's own findLinkedTable() result. tags is
                // the row's tag ids on ITS OWN table (see ensureCellTags) — a filter card matches
                // against these; they mean nothing outside the context of originTableId.
                originTableId: table.id,
                tags: (table.cellTags && table.cellTags[rowIndex]) || [],
                srs: Object.assign({}, getSrsForRow(table, rowIndex))
            });
        });
        if (!rows.length) return null;
        return { rows, headers: table.tableData[0].map(h => stripHtml(h || '')) };
    }

    // Applies an inbound 'srsUpdate' payload (pushed back by a downstream flashcard after a
    // grading action) onto the source-of-truth table's per-row memory state. Routes by
    // originTableId when the payload carries one (set on every row by extractCardsFromSource) —
    // that's the row's REAL home table, which is no longer necessarily this receiving item's own
    // findLinkedTable() result once a filter card or a merged source sits in between; falls back
    // to the old direct-link behavior for payloads that predate that field.
    function applySrsUpdateStream(item, payload) {
        if (payload.streamType !== 'srsUpdate') return;
        const { rowIndex, srs, originTableId } = payload.delta || {};
        if (rowIndex == null || !srs) return;
        const table = (originTableId != null && findTableById(originTableId)) || findLinkedTable(item);
        if (!table) return;
        // "Mastered" = the SM-2 interval (in days — see calculateSM2) crossing 90+. masteredCounted
        // rides along in this same row-meta blob (persisted with the rest of the workspace JSON via
        // scheduleWorkspaceSave) so a word is only ever counted toward master_250_words once, even
        // if a later wrong answer drops its interval back down and it re-crosses 90 again later.
        const meta = ensureSrsMeta(table);
        const prev = meta[rowIndex];
        if (prev && prev.masteredCounted) {
            srs.masteredCounted = true;
        } else if (srs.interval >= 90) {
            srs.masteredCounted = true;
            bumpAchievementStat('master_250_words');
        }
        meta[rowIndex] = srs;
    }

    // CanvasStreamPayload — the single standardized message shape every card kind uses to
    // talk to any other card kind over a connection. Consumers must only branch on
    // `streamType`/`delta` shape — never on which kind produced or will receive it.
    function makeStreamPayload(originId, streamType, delta) {
        return { originId, streamType, timestamp: Date.now(), delta: delta || {} };
    }
    // Per-rating difference between two cumulative `ratings` tallies (e.g. a flashcard's
    // lifetime counts) — used to turn a session's live/baseline snapshot into a session-scoped
    // delta, the same way `seen` counts are diffed.
    function diffRatings(live, base) {
        const keys = ['noclue', 'wrong', 'hard', 'easy'];
        const out = {};
        keys.forEach(k => { out[k] = ((live && live[k]) || 0) - ((base && base[k]) || 0); });
        return out;
    }

    // Sums the current 'performance' output of every card a source/table/folder card feeds
    // content to (i.e. every game connected downstream of it), into one combined payload.
    // This is how a stats card linked to a shared data source shows totals across *all*
    // games built on top of it, without the source ever inspecting what kind those games are
    // — it just asks each connected card's own registered IO for its current performance
    // output, exactly like propagateCanvasStreams itself does.
    function aggregateDownstreamPerformance(sourceItem, ctx) {
        if (!ctx || !ctx.conns || !ctx.items) return null;
        const downstreamConns = ctx.conns.filter(c => c.fromId === sourceItem.id);
        if (!downstreamConns.length) return null;
        let seenTotal = 0;
        const ratingsTotal = { noclue: 0, wrong: 0, hard: 0, easy: 0 };
        let any = false;
        downstreamConns.forEach(c => {
            const gameItem = ctx.items.find(i => i.id === c.toId);
            if (!gameItem) return;
            const gameIO = appState.CardStreamIO[gameItem.kind];
            if (!gameIO || !gameIO.outputs || !gameIO.outputs.includes('performance') || !gameIO.getOutput) return;
            let perf = gameIO.getOutput(gameItem, ctx);
            if (!perf) return;
            if (!Array.isArray(perf)) perf = [perf];
            perf.forEach(p => {
                if (!p || p.streamType !== 'performance') return;
                any = true;
                seenTotal += (p.delta && p.delta.seen) || 0;
                const r = (p.delta && p.delta.ratings) || {};
                Object.keys(ratingsTotal).forEach(k => { ratingsTotal[k] += r[k] || 0; });
            });
        });
        if (!any) return null;
        return makeStreamPayload(sourceItem.id, 'performance', { seen: seenTotal, ratings: ratingsTotal });
    }

    // Shared by CardStreamIO.filter's getOutput and the filter card's own on-canvas row count —
    // a row passes through if it has at least one selected tag ("or", the default) or every
    // selected tag ("and"). No tags selected at all means everything passes through unfiltered.
    function applyFilterToRows(item, rows) {
        const selected = item.filterTagIds || [];
        if (!selected.length) return rows;
        return rows.filter(r => {
            const rowTags = (r && r.tags) || [];
            return item.filterMode === 'and' ? selected.every(t => rowTags.includes(t)) : selected.some(t => rowTags.includes(t));
        });
    }
    // Every distinct tag currently seen across a filter card's incoming rows, resolved (via each
    // row's originTableId) to its real {id, name, color} definition on whichever source it came
    // from — a filter has no source of its own, so the only tags it can ever offer are whatever
    // is actually flowing into it right now.
    function collectAvailableFilterTags(rows) {
        const seen = new Map();
        (rows || []).forEach(r => {
            const originTable = r.originTableId != null ? findTableById(r.originTableId) : null;
            if (!originTable) return;
            (r.tags || []).forEach(tagId => {
                if (seen.has(tagId)) return;
                const tag = (originTable.tags || []).find(t => t.id === tagId);
                if (tag) seen.set(tagId, tag);
            });
        });
        return Array.from(seen.values());
    }

    // CardStreamIO — interface table for the canvas's data-conduit connections. Each entry
    // describes one card kind's stream capabilities: `inputs`/`outputs` list the
    // CanvasStreamPayload streamTypes it can consume/produce; `onStream` is called for every
    // inbound payload whose streamType is in `inputs`; `getOutput` produces this card's current
    // outbound payload(s) (return a single payload, an array of payloads, or null/undefined).
    // Cards must react only to `payload.streamType` / `payload.delta` — never to
    // `fromItem.kind` or `toItem.kind` — so any future card kind can be wired to any other
    // without touching propagateCanvasStreams or this table's call sites.

    // Gatekeeper for every connection-creation entry point (drag-to-link and multi-select
    // link). Rejects a prospective fromId -> toId edge before it's ever added to
    // folder.connections, so propagateCanvasStreams never has to deal with a self-link, a
    // stream-type mismatch, or a cycle. All three checks are driven purely by CardStreamIO's
    // declared inputs/outputs and the existing connection graph — never by card kind — so any
    // new card kind just needs to declare its inputs/outputs correctly to be validated for free.
    // A Stack (kind:'shelf' — see its add-menu entry) holds exactly one kind of thing at a
    // time: either stopwatch sessions or source rows, never both mixed together (its own UI,
    // renderShelfHTML, already renders these as two entirely separate sections). Returns null
    // for any card kind that doesn't feed a shelf meaningfully at all (isValidConnection's
    // ordinary type-matching rule already handles those).
    function shelfInputCategory(kind) {
        if (kind === 'stopwatch') return 'sessions';
        const cfg = appState.CardStreamIO[kind];
        if (cfg && cfg.outputs && cfg.outputs.includes('sourceRows')) return 'sources';
        return null;
    }
    function isValidConnection(fromId, toId) {
        // Rule 1: no self-links.
        if (fromId === toId) return false;

        const folder = appState.folders[appState.currentFolderId];
        if (!folder) return false;
        const fromItem = folder.items.find(i => i.id === fromId);
        const toItem = folder.items.find(i => i.id === toId);
        if (!fromItem || !toItem) return false;

        // Rule 2: type matching. Either card kind must be missing from CardStreamIO, or
        // missing outputs/inputs entirely, to be blocked outright; otherwise at least one of
        // the source's outputs must be accepted by the target's inputs.
        const fromConfig = appState.CardStreamIO[fromItem.kind];
        const toConfig = appState.CardStreamIO[toItem.kind];
        if (!fromConfig || !toConfig || !fromConfig.outputs || !toConfig.inputs) return false;
        const hasMatchingType = fromConfig.outputs.some(outType => toConfig.inputs.includes(outType));
        if (!hasMatchingType) return false;

        const conns = ensureConnections(folder);

        // Rule 2.5: a Stack already fed by one category (sessions or sources — see
        // shelfInputCategory) rejects a new connection from the OTHER category outright, even
        // though the streamType-level check above would otherwise allow it.
        if (toItem.kind === 'shelf') {
            const newCategory = shelfInputCategory(fromItem.kind);
            if (newCategory) {
                const existingCategories = new Set(
                    conns.filter(c => c.toId === toId)
                        .map(c => {
                            const other = folder.items.find(i => i.id === c.fromId);
                            return other ? shelfInputCategory(other.kind) : null;
                        })
                        .filter(Boolean)
                );
                if (existingCategories.size && !existingCategories.has(newCategory)) return false;
            }
        }

        // Rule 3: no circular dependencies. If a path already exists from toId back to
        // fromId through the current connection graph, adding fromId -> toId would close a
        // loop, so walk forward from toId (BFS) and bail if we ever land back on fromId.
        let currentTargets = [toId];
        const visited = new Set();
        while (currentTargets.length > 0) {
            const nextId = currentTargets.shift();
            if (nextId === fromId) return false; // Loop detected!
            if (!visited.has(nextId)) {
                visited.add(nextId);
                const children = conns.filter(c => c.fromId === nextId).map(c => c.toId);
                currentTargets.push(...children);
            }
        }
        return true;
    }

    // Cancels a click-to-link gesture already in progress (see handleDataModeClick), removing
    // the "armed" highlight from whichever card was first-clicked. Safe to call even when
    // nothing is pending.
    function clearDataLinkPending() {
        if (appState.dataLinkPendingId != null) {
            const prevEl = document.getElementById('item-' + appState.dataLinkPendingId);
            if (prevEl) prevEl.classList.remove('link-source-armed');
        }
        appState.dataLinkPendingId = null;
    }
    // The click-based counterpart to dragging a connection line from one card to another (see
    // startConnectionDrag) — called when a data-mode gesture on `it` turns out to be a plain
    // click rather than a drag. First click arms `it` as the pending link source (highlighted via
    // .link-source-armed, re-applied every render — see the main render loop); a second click on
    // a DIFFERENT card completes the link exactly as a drag between them would, subject to the
    // same isValidConnection rules. Clicking the already-armed card again cancels it instead of
    // linking it to itself.
    function handleDataModeClick(it, el) {
        if (appState.dataLinkPendingId == null) {
            appState.dataLinkPendingId = it.id;
            el.classList.add('link-source-armed');
            return;
        }
        const fromId = appState.dataLinkPendingId;
        clearDataLinkPending();
        if (fromId === it.id) return; // clicked the armed card again — just cancel
        if (!isValidConnection(fromId, it.id)) return;
        saveSnapshot();
        const conns = ensureConnections(appState.folders[appState.currentFolderId]);
        createConnection(conns, fromId, it.id);
        render();
    }

    // Generic, scalable across any number of card kinds/connections: walks every connection,
    // asks the source card's registered IO for its current output payload(s), and — purely by
    // matching payload.streamType against the target card's declared input capability, never by
    // checking either card's identity/kind — delivers matching payloads to the target's onStream.
    // Multiple passes let short connection chains (A -> B -> C) settle within one render.
    function propagateCanvasStreams(folderObj) {
        const items = folderObj.items;
        const conns = ensureConnections(folderObj);
        const ctx = { folderObj, items, conns };
        const PASSES = 4;
        // Stat cards never persist their own data — they only ever reflect whatever's
        // currently flowing to them. Clearing the cache before each render's propagation
        // (rather than only ever merging into it) is what lets a connected shelf's session
        // selector actually change what a stat card shows: without this, once a session's
        // data landed in streamCache it would stick there forever, since the onStream 'keep
        // newest' guard below exists to dedupe *within* one delivery pass, not to pin the
        // card to whichever session happened to arrive first across separate renders.
        items.forEach(it => {
            if (it.kind === 'statcard') it.streamCache = {};
            // Same reasoning as statcard.streamCache above, for the two other content-aggregating
            // kinds: both only ever reflect what's CURRENTLY flowing in, recomputed fresh every
            // render — reset here (not consumed inside getOutput) so a getOutput called more than
            // once per render (once per downstream connection) always sees the same accumulated
            // set instead of the first caller draining it for everyone after.
            if (it.kind === 'shelf') it.stackSourceRows = {};
            if (it.kind === 'filter') it.incomingRows = [];
        });
        // Delivers whatever `sender` currently outputs to `receiver`'s input, purely by
        // matching declared streamTypes — never by kind. Called both ways per connection
        // below so a card the user drew as the *target* of a link (e.g. a flashcard fed by a
        // source) can still push data of a different streamType back the other way (e.g. an
        // 'srsUpdate' flowing from flashcard -> source) over that same connection, without
        // requiring the user to draw a second link in reverse.
        function deliver(sender, receiver) {
            if (!sender || !receiver) return;
            const senderIO = appState.CardStreamIO[sender.kind];
            const receiverIO = appState.CardStreamIO[receiver.kind];
            if (!senderIO || !senderIO.getOutput || !receiverIO || !receiverIO.inputs || !receiverIO.onStream) return;
            let payloads = senderIO.getOutput(sender, ctx);
            if (!payloads) return;
            if (!Array.isArray(payloads)) payloads = [payloads];
            payloads.forEach(payload => {
                if (payload && receiverIO.inputs.includes(payload.streamType)) {
                    receiverIO.onStream(receiver, payload, ctx);
                }
            });
        }
        for (let pass = 0; pass < PASSES; pass++) {
            conns.forEach(c => {
                const fromItem = items.find(i => i.id === c.fromId);
                const toItem = items.find(i => i.id === c.toId);
                deliver(fromItem, toItem);
                deliver(toItem, fromItem);
            });
        }

        // Source-of-truth integrity: a flashcard's real word data is only ever supposed to
        // exist while it's actively fed by a connected table/source/folder. If that connection
        // is gone (line deleted, source deleted, etc — this check doesn't care how, it just
        // looks at the current graph) but the deck still carries real content from a past
        // connection (a rowIndex/srs field is the tell), collapse it back to the generic
        // placeholder deck rather than letting real language data linger detached from its
        // source. Checked every render, not on a specific event, so it's robust to any path
        // that can sever the link.
        items.forEach(it => {
            if (it.kind !== 'flashcard' && it.kind !== 'typeright') return;
            const cards = it.cards || [];
            const looksReal = cards.some(c => c && (c.rowIndex != null || c.srs));
            if (!looksReal) return;
            const stillFed = conns.some(c => {
                const otherId = c.fromId === it.id ? c.toId : (c.toId === it.id ? c.fromId : null);
                if (!otherId) return false;
                const other = items.find(i => i.id === otherId);
                return other && appState.CardStreamIO[other.kind] && (appState.CardStreamIO[other.kind].outputs || []).includes('content');
            });
            if (!stillFed) {
                if (it.kind === 'flashcard') {
                    it.cards = defaultFlashcardDeck();
                    it.fcOrder = [];
                    it.fcIndex = 0;
                    it.fcFlipped = false;
                    it.fcStats = {};
                    it.fcSeenCount = 0;
                } else {
                    it.cards = [];
                    it.trOrder = [];
                    it.trIndex = 0;
                    it.trInput = '';
                    it.trChecked = false;
                    it.trStats = {};
                    it.trSeenCount = 0;
                }
            }
        });
    }

    function applyConnections(folderObj) {
        propagateCanvasStreams(folderObj);
    }

    function renderConnectionsLayer(folderObj, currentItems) {
        const layer = makeLayerSVG(1);
        layer.classList.add('connections-layer');
        const validIds = new Set(currentItems.map(i => i.id));
        const conns = ensureConnections(folderObj);
        folderObj.connections = conns.filter(c => validIds.has(c.fromId) && validIds.has(c.toId));
        folderObj.connections.forEach(c => {
            const fromItem = currentItems.find(i => i.id === c.fromId);
            const toItem = currentItems.find(i => i.id === c.toId);
            if (!fromItem || !toItem) return;
            const obstacles = currentItems.filter(i => i.id !== fromItem.id && i.id !== toItem.id).map(itemRect);
            const points = computeConnectorPoints(fromItem, toItem, true, obstacles);
            const d = pointsToLinePath(points);

            const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            visible.setAttribute('d', d);
            visible.setAttribute('stroke', 'var(--brand)');
            visible.setAttribute('stroke-width', '2');
            visible.setAttribute('fill', 'none');
            visible.setAttribute('stroke-linejoin', 'round');
            visible.style.pointerEvents = 'none';

            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hit.setAttribute('d', d);
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', '14');
            hit.setAttribute('fill', 'none');
            hit.style.pointerEvents = 'stroke';
            hit.style.cursor = 'pointer';
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = 'Click to remove this connection';
            hit.appendChild(title);
            hit.addEventListener('pointerdown', (e) => e.stopPropagation());
            hit.addEventListener('click', (e) => {
                e.stopPropagation();
                saveSnapshot();
                folderObj.connections = folderObj.connections.filter(x => x.id !== c.id);
                render();
            });

            layer.appendChild(visible);
            layer.appendChild(hit);
        });
        return layer;
    }

    // Drag-to-link: in Data mode (or with X held), dragging from a card draws a
    // live preview line to the pointer; dropping on another card creates a persistent
    // connection between them.
    function startConnectionDrag(e, it, el) {
        saveSnapshot();
        const downX = e.clientX, downY = e.clientY;
        let moved = false;
        const rect = canvas.getBoundingClientRect();
        const previewSvg = makeLayerSVG(500);
        const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        previewPath.setAttribute('stroke', 'var(--brand)');
        previewPath.setAttribute('stroke-width', '2');
        previewPath.setAttribute('stroke-dasharray', '6 4');
        previewPath.setAttribute('fill', 'none');
        previewPath.setAttribute('stroke-linejoin', 'round');
        previewPath.style.pointerEvents = 'none';
        previewSvg.appendChild(previewPath);
        world.appendChild(previewSvg);

        let hoveredTarget = null;
        const allItems = appState.folders[appState.currentFolderId] ? appState.folders[appState.currentFolderId].items : [];
        const updatePreview = (clientX, clientY) => {
            const wx = (clientX - rect.left - appState.tx) / appState.scale, wy = (clientY - rect.top - appState.ty) / appState.scale;
            const obstacles = allItems.filter(i => i.id !== it.id && i.id !== hoveredTarget).map(itemRect);
            const points = computeConnectorPoints(it, { x: wx, y: wy }, false, obstacles);
            previewPath.setAttribute('d', pointsToLinePath(points));
        };
        updatePreview(e.clientX, e.clientY);

        const move = (me) => {
            if (Math.abs(me.clientX - downX) > 3 || Math.abs(me.clientY - downY) > 3) moved = true;
            document.querySelectorAll('.item.link-target-hover, .item.link-target-invalid').forEach(x => x.classList.remove('link-target-hover', 'link-target-invalid'));
            const under = document.elementFromPoint(me.clientX, me.clientY);
            const cardEl = under && under.closest && under.closest('.item');
            const id = cardEl ? parseInt(cardEl.id.replace('item-', '')) : NaN;
            const candidate = (!isNaN(id) && id !== it.id) ? id : null;
            // Only ever treat a hovered card as a droppable target if the link would actually
            // be allowed (rules 1-3 below); otherwise flag it so the user gets live feedback
            // that dropping here won't do anything, instead of silently doing nothing on drop.
            hoveredTarget = candidate != null && isValidConnection(it.id, candidate) ? candidate : null;
            if (cardEl && candidate != null) cardEl.classList.add(hoveredTarget != null ? 'link-target-hover' : 'link-target-invalid');
            updatePreview(me.clientX, me.clientY);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            previewSvg.remove();
            document.querySelectorAll('.item.link-target-hover, .item.link-target-invalid').forEach(x => x.classList.remove('link-target-hover', 'link-target-invalid'));
            if (hoveredTarget != null && isValidConnection(it.id, hoveredTarget)) {
                const conns = ensureConnections(appState.folders[appState.currentFolderId]);
                createConnection(conns, it.id, hoveredTarget);
                render();
            } else if (!moved) {
                // No real drag happened — this was a plain click, so hand off to the
                // click-to-link flow instead of just discarding the gesture (see
                // handleDataModeClick). The speculative snapshot taken at the top of this
                // function was only for a potential drag that didn't happen;
                // handleDataModeClick takes its own snapshot, only at the moment it actually
                // creates a connection.
                appState.undoStack.pop();
                handleDataModeClick(it, el);
            } else {
                appState.undoStack.pop();
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }


    function setDrawMode(on) {
        appState.drawMode = on;
        btnAdd.classList.toggle('active', appState.drawMode);
        canvas.classList.toggle('crosshair', appState.drawMode || !!appState.addingKind);
        drawSettings.style.display = appState.drawMode ? 'flex' : 'none';
        if (appState.drawMode) { appState.addingKind = null; appState.addingStatKind = null; addMenu.style.display = 'none'; removePlacementGhost(); }
    }
    function cancelAddingKind() {
        appState.addingKind = null;
        appState.addingStatKind = null;
        canvas.classList.remove('crosshair');
        removePlacementGhost();
    }

    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');

        if (!isEditingText && appState.outlineMenu.classList.contains('open')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOutlineActive(appState.outlineActiveIndex + 1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setOutlineActive(appState.outlineActiveIndex - 1); return; }
            if (e.key === 'Enter') {
                e.preventDefault();
                const row = appState.outlineRows[appState.outlineActiveIndex] || appState.outlineRows[0];
                if (row) row.el.click();
                return;
            }
        }

        if (!isEditingText && e.key === ' ') { e.preventDefault(); if (appState.searchInput) appState.searchInput.focus(); return; }
        // Same idea as Space above, but actually types the "/" rather than just focusing, since
        // that's meant to start a slash command. preventDefault + writing .value ourselves (rather
        // than letting the keystroke's own default action insert it after we focus) sidesteps any
        // browser's own default behavior for "/" outside a text field (e.g. Firefox's
        // quick-find-on-slash). Command recognition/suggestions themselves aren't built yet — this
        // just gets "/" reliably into the box from anywhere; handleSearchInput currently treats it
        // as an ordinary (if unusual) search query character.
        if (!isEditingText && e.key === '/') {
            e.preventDefault();
            if (appState.searchInput) {
                appState.searchInput.focus();
                appState.searchInput.value = '/';
                appState.searchInput.setSelectionRange(1, 1);
                handleSearchInput('/');
            }
            return;
        }
        if (!isEditingText && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); toggleHamburgerMenu(); return; }
        // Debug shortcut for tweaking the notification entrance/exit animation — fires a plain
        // notification with no buttons on every press. Remove once done tweaking.
        if (!isEditingText && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); pushNotification({ type: 'debug', message: 'this is an example notification' }); return; }
    });

    function toggleDrawFromMenu() { addMenu.style.display = 'none'; setDrawMode(!appState.drawMode); }
    drawColorInput.oninput = (e) => { appState.drawColor = e.target.value; };
    drawSizeInput.oninput = (e) => { appState.drawSize = parseInt(e.target.value); };
    function updateDrawToolBtns() {
        drawPenBtn.classList.toggle('active', appState.drawTool === 'pen');
        drawEraserBtn.classList.toggle('active', appState.drawTool === 'eraser');
    }
    drawPenBtn.onclick = (e) => { e.stopPropagation(); appState.drawTool = 'pen'; updateDrawToolBtns(); };
    drawEraserBtn.onclick = (e) => { e.stopPropagation(); appState.drawTool = 'eraser'; updateDrawToolBtns(); };
    function updateDrawLayerBtns() {
        drawFrontBtn.classList.toggle('active', appState.drawLayer === 'front');
        drawBackBtn.classList.toggle('active', appState.drawLayer === 'back');
    }
    drawFrontBtn.onclick = (e) => { e.stopPropagation(); appState.drawLayer = 'front'; updateDrawLayerBtns(); };
    drawBackBtn.onclick = (e) => { e.stopPropagation(); appState.drawLayer = 'back'; updateDrawLayerBtns(); };

    function startDrawStroke(e) {
        const rect = canvas.getBoundingClientRect();

        if (appState.drawTool === 'eraser') {
            saveSnapshot();
            const dwList = ensureDrawings(appState.folders[appState.currentFolderId]);
            const eraseRadius = Math.max(appState.drawSize, 8) / 2;
            const eraseAt = (wx, wy) => {
                for (let i = dwList.length - 1; i >= 0; i--) {
                    if (pathNearPoint(dwList[i].d, wx, wy, eraseRadius + (dwList[i].width || 3) / 2)) {
                        dwList.splice(i, 1);
                        render();
                    }
                }
            };
            const toWorld = (ce) => [(ce.clientX - rect.left - appState.tx) / appState.scale, (ce.clientY - rect.top - appState.ty) / appState.scale];
            const [wx0, wy0] = toWorld(e);
            eraseAt(wx0, wy0);
            const move = (me) => { const [wx, wy] = toWorld(me); eraseAt(wx, wy); };
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
            return;
        }

        saveSnapshot();
        const wx = (e.clientX - rect.left - appState.tx) / appState.scale, wy = (e.clientY - rect.top - appState.ty) / appState.scale;
        appState.drawing = { points: [[wx, wy]], color: appState.drawColor, layer: appState.drawLayer, width: appState.drawSize };
        appState.liveSvg = makeLayerSVG(appState.drawLayer === 'back' ? 0 : 2);
        appState.livePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        appState.livePath.setAttribute('stroke', appState.drawColor);
        appState.livePath.setAttribute('stroke-width', String(appState.drawSize));
        appState.livePath.setAttribute('fill', 'none');
        appState.livePath.setAttribute('stroke-linecap', 'round');
        appState.livePath.setAttribute('stroke-linejoin', 'round');
        appState.liveSvg.appendChild(appState.livePath);
        if (appState.drawLayer === 'back') world.insertBefore(appState.liveSvg, world.firstChild); else world.appendChild(appState.liveSvg);

        const move = (me) => {
            const wx2 = (me.clientX - rect.left - appState.tx) / appState.scale, wy2 = (me.clientY - rect.top - appState.ty) / appState.scale;
            appState.drawing.points.push([wx2, wy2]);
            appState.livePath.setAttribute('d', pointsToPath(appState.drawing.points));
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (appState.drawing.points.length > 1) {
                ensureDrawings(appState.folders[appState.currentFolderId]).push({ color: appState.drawing.color, layer: appState.drawing.layer, d: pointsToPath(appState.drawing.points), width: appState.drawing.width });
            } else {
                appState.undoStack.pop();
            }
            if (appState.liveSvg) appState.liveSvg.remove();
            appState.liveSvg = null; appState.livePath = null; appState.drawing = null;
            render();
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    canvas.addEventListener('pointerdown', (e) => {
        if (e.target !== canvas) return;
        // Single-canvas Schedule Mode locks the viewport entirely (no free pan, no box-select) —
        // today's overlay-based SCHEDULE_ALL mode never reaches here at all, since #schedule-view
        // physically covers the canvas and intercepts pointer events itself.
        if (appState.scheduleViewMode) return;
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;

        // Clicking blank canvas cancels a click-to-link gesture in progress (see
        // handleDataModeClick) rather than leaving it armed indefinitely.
        if (appState.dataLinkPendingId != null) clearDataLinkPending();

        if (appState.drawMode) { startDrawStroke(e); return; }

        if (appState.addingKind) {
            const rect = canvas.getBoundingClientRect();
            const { w, h } = kindSize(appState.addingKind);
            const x = Math.round((((e.clientX - rect.left - appState.tx) / appState.scale) - w / 2) / 28) * 28;
            const y = Math.round((((e.clientY - rect.top - appState.ty) / appState.scale) - h / 2) / 28) * 28;
            add(appState.addingKind, x, y, appState.addingStatKind);
            appState.addingKind = null; appState.addingStatKind = null; canvas.classList.remove('crosshair');
            removePlacementGhost();
            return;
        }
        if(appState.currentEditingEl) { appState.currentEditingEl.classList.remove('editing'); appState.currentEditingEl.querySelector('.body').contentEditable = false; appState.currentEditingEl = null; broadcastEditingState(false); }
        
        // Multi-selection: Shift+drag (or Select mode) on empty canvas draws a selection window instead of panning
        if (e.shiftKey || effectiveMode() === 'select') {
            startBoxSelection(e);
            return;
        }
        appState.selectedCardIds = [];
        renderSelectedOutlines();

        let startX = e.clientX - appState.tx, startY = e.clientY - appState.ty;
        document.body.classList.add('dragging');
        const move = (me) => { appState.tx = me.clientX - startX; appState.ty = me.clientY - startY; applyTransform(); };
        const up = () => { document.body.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });

    canvas.addEventListener('wheel', (e) => {
        if (appState.scheduleViewMode) {
            // SCHEDULE_ALL: the old overlay's own #schedule-view-canvas has native
            // overflow-y:auto — let it handle its own scroll, nothing to do here. Any other
            // selection: a single canvas shown in-place, vertical-scroll-only, driven directly
            // against the real camera (there's no separate scrolling DOM element to defer to).
            if (appState.scheduleViewSelection !== SCHEDULE_ALL) handleScheduleModeWheel(e);
            return;
        }
        if (appState.folders[appState.currentFolderId] && appState.folders[appState.currentFolderId].isSource) return;
        const bodyEl = e.target.closest && e.target.closest('.item.note .body');
        if (bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight) return;
        e.preventDefault();
        if (e.ctrlKey) {
            const factor = Math.pow(1.1, -e.deltaY / 60);
            const mouseX = e.clientX - appState.tx, mouseY = e.clientY - appState.ty;
            const newScale = Math.min(Math.max(appState.scale * factor, appState.ZOOM_MIN), appState.ZOOM_MAX);
            appState.tx = e.clientX - (mouseX * (newScale / appState.scale));
            appState.ty = e.clientY - (mouseY * (newScale / appState.scale));
            appState.scale = newScale;
        } else {
            appState.tx -= e.deltaX;
            appState.ty -= e.deltaY;
        }
        scheduleApplyTransform();
    }, { passive: false });

    function setZoomFromClientY(clientY) {
        const rect = zoomTrack.getBoundingClientRect();
        let pct = 1 - (clientY - rect.top) / rect.height;
        pct = Math.max(0, Math.min(1, pct));
        const newScale = appState.ZOOM_MIN + pct * (appState.ZOOM_MAX - appState.ZOOM_MIN);
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const worldX = (cx - appState.tx) / appState.scale, worldY = (cy - appState.ty) / appState.scale;
        appState.tx = cx - worldX * newScale;
        appState.ty = cy - worldY * newScale;
        appState.scale = newScale;
        applyTransform();
    }
    zoomTrack.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        zoomTrack.classList.add('dragging');
        setZoomFromClientY(e.clientY);
        const move = (me) => setZoomFromClientY(me.clientY);
        const up = () => {
            zoomTrack.classList.remove('dragging');
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
    // Double-clicking the zoom bar jumps straight back to 100%, anchored on the current
    // viewport center (same centering math as dragging the slider itself).
    zoomTrack.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const newScale = 1;
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const worldX = (cx - appState.tx) / appState.scale, worldY = (cy - appState.ty) / appState.scale;
        appState.tx = cx - worldX * newScale;
        appState.ty = cy - worldY * newScale;
        appState.scale = newScale;
        applyTransform();
    });

    function add(kind, x = 100, y = 100, statKind = null) {
        saveSnapshot();
        const { w, h } = kindSize(kind);
        const base = { id: appState.idCounter++, x, y, w, h, kind };
        if (kind === 'title') { base.html = ''; base.level = 1; }
        else if (kind === 'folder') {
            const fid = 'folder-' + appState.idCounter++;
            appState.folders[fid] = { id: fid, title: 'New Canvas', items: [], drawings: [], collaborators: [] };
            base.folderId = fid;
        }
        else if (kind === 'source') {
            const fid = 'folder-' + appState.idCounter++;
            appState.folders[fid] = { id: fid, title: 'New Source', isSource: true, items: [
                // Header cells start blank — "Column 1"/"Column 2" show only as placeholder
                // text (see renderStaticTableHTML) until the user actually names them.
                { id: appState.idCounter++, x: 28, y: 28, w: 560, h: 360, kind: 'table', tableData: [['', ''], ['', ''], ['', ''], ['', '']] }
            ], drawings: [], collaborators: [] };
            base.folderId = fid;
        }
        else if (kind === 'table') { base.tableData = [['', '', ''], ['', '', ''], ['', '', '']]; base.w = null; base.h = null; }
        else if (kind === 'media') { base.mediaType = null; base.mediaSrc = null; base.mediaName = null; }
        else if (kind === 'checklist') { base.tasks = []; } // no longer creatable, kept for existing cards — see kindLabel
        else if (kind === 'embed') { base.embedUrl = ''; }
        else if (kind === 'watermark') { base.html = ''; }
        else if (kind === 'flashcard') { base.cards = defaultFlashcardDeck(); base.fcMode = 'shuffle'; base.fcOrder = []; base.fcIndex = 0; base.fcFlipped = false; base.fcStats = {}; base.fcSeenCount = 0; }
        else if (kind === 'typeright') { base.cards = []; base.trMode = 'shuffle'; base.trOrder = []; base.trIndex = 0; base.trInput = ''; base.trChecked = false; base.trStats = {}; base.trSeenCount = 0; }
        else if (kind === 'statcard') { base.statKind = statKind || 'progress'; base.streamCache = {}; }
        else if (kind === 'stopwatch') {
            base.swRunning = false; base.swPaused = false; base.swElapsedMs = 0; base.swLastResumeAt = null;
            base.swSessionActive = false; base.swSessionId = null; base.swSessionStartedAt = null;
            base.swSessionLive = {}; base.swSessionBaseline = {}; base.swSessions = [];
        }
        else if (kind === 'shelf') { base.shelfSessions = []; base.shelfSelectedId = null; }
        else if (kind === 'filter') { base.filterTagIds = []; base.filterMode = 'or'; base.incomingRows = []; }
        else if (kind === 'waypoint') { base.creatorId = appState.currentUser.id; }
        else { base.html = (kind === 'note') ? '' : `<strong>${kindLabel(kind)}</strong>`; }
        appState.folders[appState.currentFolderId].items.push(base);
        render();
        awardUserPoints('add_canvas_block', 5);
        bumpAchievementStat('first_block');
        if (kind === 'waypoint') syncWaypointToDb(appState.currentFolderId, base);
    }

    // Deep-clones a LIVE canvas item for a true, independent duplicate (Alt-drag). Critically,
    // for a 'folder'/'source' item this also clones the folder it points to into a brand-new
    // folders[] entry (recursively, for any folders/sources nested inside it), so the copy gets
    // its own separate data. A bare JSON.parse(JSON.stringify(it)) deep-copies the item's own
    // fields (x/y/w/h/etc) but NOT the folder it merely points to by id — without this, the
    // duplicate's folderId is the exact same string as the original's, so both cards resolve to
    // the identical folders[folderId] object and editing rows/notes/drawings in either one
    // changes both. (Unrelated to snapshotItem() above, which builds a self-contained copy for
    // sharing OUTSIDE this account — this one stays local and reuses a fresh folder id instead.)
    function deepCloneItem(it) {
        const clone = JSON.parse(JSON.stringify(it));
        clone.id = appState.idCounter++;
        if ((clone.kind === 'folder' || clone.kind === 'source') && clone.folderId && appState.folders[clone.folderId]) {
            const srcFolder = appState.folders[clone.folderId];
            const newFid = 'folder-' + appState.idCounter++;
            const newFolder = JSON.parse(JSON.stringify(srcFolder));
            newFolder.id = newFid;
            newFolder.collaborators = []; // a duplicate starts with no collaborators of its own
            delete newFolder.isSharedView; delete newFolder.sharedOwnerId; delete newFolder.sharedRemoteFolderId;
            newFolder.items = srcFolder.items.map(deepCloneItem); // recursive — nested folders/sources get their own fresh folder ids too
            appState.folders[newFid] = newFolder;
            clone.folderId = newFid;
        }
        return clone;
    }

    // Undoes deepCloneItem's folders[] side effect for a duplicate that's being discarded before
    // it ever really landed (Alt-drag released without moving, or the drop target vanished) —
    // recursively, since a cloned folder/source can itself contain freshly-cloned nested
    // folders/sources, each with their own new folders[] entry. Without this, canceling a
    // speculative duplicate would still leave its brand-new (now unreferenced-by-any-item)
    // folder data behind forever, quietly bloating every future workspace save.
    function deleteClonedItemFolders(item) {
        if (!item || (item.kind !== 'folder' && item.kind !== 'source') || !item.folderId) return;
        const folderObj = appState.folders[item.folderId];
        if (!folderObj) return;
        (folderObj.items || []).forEach(deleteClonedItemFolders);
        delete appState.folders[item.folderId];
    }
    // Relocated here from core-state.js's appState object literal — it needs functions this
    // file already owns, and core-state.js must never import anything (see its own comment on
    // why: any import there re-creates the exact circular-evaluation hazard this whole pass
    // exists to eliminate, this time for appState itself).
    appState.CardStreamIO = {
        table: {
            inputs: ['srsUpdate'],
            outputs: ['content', 'performance'],
            onStream: applySrsUpdateStream,
            getOutput(item, ctx) {
                const extracted = extractCardsFromSource(item);
                const out = [];
                if (extracted && extracted.rows.length) out.push(makeStreamPayload(item.id, 'content', { rows: extracted.rows, headers: extracted.headers }));
                const perf = aggregateDownstreamPerformance(item, ctx);
                if (perf) out.push(perf);
                return out.length ? out : null;
            }
        },
        // Distinct from table/folder below (not a shared object) because it also emits a
        // 'sourceRows' output — its OWN rows only, deliberately a SEPARATE streamType from
        // 'content' — for a connected Stack card (kind:'shelf', see CardStreamIO.shelf below) to
        // aggregate across several sources at once. A source no longer ACCEPTS 'sourceRows' as an
        // input (that's what used to let two sources merge directly into each other — removed;
        // aggregating multiple sources now only ever happens via a Stack in between), so
        // source-to-source connections are rejected by isValidConnection's ordinary type-matching
        // rule with no special-casing needed.
        source: {
            inputs: ['srsUpdate'],
            outputs: ['content', 'performance', 'sourceRows'],
            onStream: applySrsUpdateStream,
            getOutput(item, ctx) {
                const extracted = extractCardsFromSource(item);
                const ownRows = extracted ? extracted.rows : [];
                const out = [];
                if (ownRows.length) {
                    out.push(makeStreamPayload(item.id, 'content', { rows: ownRows, headers: extracted.headers }));
                    out.push(makeStreamPayload(item.id, 'sourceRows', { rows: ownRows }));
                }
                const perf = aggregateDownstreamPerformance(item, ctx);
                if (perf) out.push(perf);
                return out.length ? out : null;
            }
        },
        folder: {
            inputs: ['srsUpdate'],
            outputs: ['content', 'performance'],
            onStream: applySrsUpdateStream,
            getOutput(item, ctx) {
                const extracted = extractCardsFromSource(item);
                const out = [];
                if (extracted && extracted.rows.length) out.push(makeStreamPayload(item.id, 'content', { rows: extracted.rows, headers: extracted.headers }));
                const perf = aggregateDownstreamPerformance(item, ctx);
                if (perf) out.push(perf);
                return out.length ? out : null;
            }
        },
        // A pass-through content filter: connect a source into it, then it into a flashcard (or
        // another filter, or another source), and only rows matching the selected tags flow
        // onward — never touches the upstream table directly, so the same source can feed
        // several differently-filtered subdecks at once. incomingRows accumulates inbound
        // 'content' rows, reset once per render (see propagateCanvasStreams) rather than
        // consumed/cleared inside getOutput — getOutput can be called once per downstream
        // connection in the same render, and clearing it there would starve every call after the
        // first.
        filter: {
            inputs: ['content'],
            outputs: ['content'],
            onStream(item, payload) {
                if (payload.streamType !== 'content' || !payload.delta || !Array.isArray(payload.delta.rows)) return;
                item.incomingRows = (item.incomingRows || []).concat(payload.delta.rows);
                // Passed straight through to whatever this filter feeds (see getOutput below) so a
                // game card downstream of a filter still sees real column names, not just "Column N".
                if (payload.delta.headers) item.incomingHeaders = payload.delta.headers;
            },
            getOutput(item) {
                const filtered = applyFilterToRows(item, item.incomingRows || []);
                return filtered.length ? makeStreamPayload(item.id, 'content', { rows: filtered, headers: item.incomingHeaders }) : null;
            }
        },
        flashcard: {
            inputs: ['content'],
            outputs: ['performance', 'srsUpdate'],
            onStream(item, payload) {
                if (payload.streamType !== 'content') return;
                const rows = payload.delta.rows;
                if (rows && rows.length) {
                    // Only reset shuffle order / position when the underlying deck actually
                    // changed shape (rows added/removed/edited) — NOT when only the SM-2 srs
                    // fields changed (e.g. because we just streamed our own grading update back
                    // up to the source and it echoed back down), which would otherwise yank the
                    // user back to card #1 every single time they rate a card.
                    const prevKey = (item.cards || []).map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const newKey = rows.map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const structuralChange = prevKey !== newKey;
                    item.cards = rows;
                    if (structuralChange) { item.fcOrder = []; item.fcIndex = 0; item.fcFlipped = false; }
                }
                // Real column names for the right-click options panel (see renderGameOptionsHTML)
                // — falls back to "Column N" labels there when this is empty (e.g. no source
                // linked yet, or a chain that doesn't preserve header names).
                if (payload.delta.headers) item.gameHeaders = payload.delta.headers;
            },
            getOutput(item) {
                const out = [makeStreamPayload(item.id, 'performance', {
                    seen: item.fcSeenCount || 0,
                    totalCards: (item.cards || []).length,
                    ratings: Object.assign({ noclue: 0, wrong: 0, hard: 0, easy: 0 }, item.fcStats || {})
                })];
                // Re-broadcasts the most recently graded card's new SM-2 state so the source
                // table (the system of record) stays in sync on every propagation pass.
                if (item.pendingSrsUpdate) out.push(makeStreamPayload(item.id, 'srsUpdate', item.pendingSrsUpdate));
                return out;
            }
        },
        // Typeright: see one side, type the other — same streaming shape as flashcard (content
        // in, performance/srsUpdate out), just its own tr*-prefixed play state (trIndex/trOrder/
        // trInput/trStats) instead of fc*, since it's a distinct gameplay loop (typed-answer
        // grading, not flip+rate).
        typeright: {
            inputs: ['content'],
            outputs: ['performance', 'srsUpdate'],
            onStream(item, payload) {
                if (payload.streamType !== 'content') return;
                const rows = payload.delta.rows;
                if (rows && rows.length) {
                    const prevKey = (item.cards || []).map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const newKey = rows.map(c => c.rowIndex + '|' + c.front + '|' + c.back).join('~');
                    const structuralChange = prevKey !== newKey;
                    item.cards = rows;
                    if (structuralChange) { item.trOrder = []; item.trIndex = 0; item.trInput = ''; item.trChecked = false; }
                }
                if (payload.delta.headers) item.gameHeaders = payload.delta.headers;
            },
            getOutput(item) {
                const out = [makeStreamPayload(item.id, 'performance', {
                    seen: item.trSeenCount || 0,
                    totalCards: (item.cards || []).length,
                    ratings: Object.assign({ noclue: 0, wrong: 0, hard: 0, easy: 0 }, item.trStats || {})
                })];
                if (item.pendingSrsUpdate) out.push(makeStreamPayload(item.id, 'srsUpdate', item.pendingSrsUpdate));
                return out;
            }
        },
        statcard: {
            inputs: ['performance'],
            onStream(item, payload) {
                item.streamCache = item.streamCache || {};
                const existing = item.streamCache[payload.originId];
                // A stopwatch re-broadcasts several sessions for the same origin at once (so a
                // connected shelf can catch all of them); a plain stats card should only ever
                // keep the most recent one. This is decided purely from the payload shape
                // (`delta.sessionStartedAt`), never from what kind sent it — if either payload
                // isn't session-scoped (no sessionStartedAt), there's no ambiguity and the
                // newest write simply wins, same as before.
                if (existing) {
                    const incomingStart = payload.delta && payload.delta.sessionStartedAt;
                    const existingStart = existing.delta && existing.delta.sessionStartedAt;
                    if (incomingStart != null && existingStart != null && incomingStart < existingStart) return;
                }
                item.streamCache[payload.originId] = payload;
            }
        },
        stopwatch: {
            inputs: ['performance'],
            outputs: ['performance'],
            onStream(item, payload) {
                if (payload.streamType !== 'performance' || !item.swSessionActive) return;
                item.swSessionLive[payload.originId] = payload.delta;
                if (!item.swSessionBaseline[payload.originId]) item.swSessionBaseline[payload.originId] = payload.delta;
            },
            getOutput(item) {
                const payloads = [];
                if (item.swSessionActive) {
                    Object.keys(item.swSessionLive).forEach(originId => {
                        const live = item.swSessionLive[originId] || {};
                        const base = item.swSessionBaseline[originId] || {};
                        payloads.push(makeStreamPayload(originId, 'performance', {
                            seen: (live.seen || 0) - (base.seen || 0), totalCards: live.totalCards,
                            ratings: diffRatings(live.ratings, base.ratings),
                            sessionId: item.swSessionId, sessionStartedAt: item.swSessionStartedAt, final: false
                        }));
                    });
                } else if (item.swSessions && item.swSessions.length) {
                    // Re-broadcast every session still held in the 3-slot buffer (not just the
                    // latest) so a shelf connected at any point can catch ones it missed. A
                    // plain stats card linked straight to the stopwatch sees all of these too,
                    // but its own onStream keeps only the one with the newest sessionStartedAt.
                    item.swSessions.forEach(session => {
                        session.payloads.forEach(p => {
                            payloads.push(makeStreamPayload(p.originId, 'performance', Object.assign({}, p.delta, { sessionId: session.sessionId, sessionStartedAt: session.startedAt, final: true })));
                        });
                    });
                }
                return payloads;
            }
        },
        // "Stack" in the UI (kind stays 'shelf' internally — see the naming note near its
        // add-menu entry). Dual-purpose: the original job (archiving stopwatch session
        // performance data, below) is untouched; it ALSO now accepts 'sourceRows' from any number
        // of directly-connected source cards and re-emits their combined rows as one 'content'
        // stream, so a flashcard (or filter, or anything else that accepts 'content') plugged
        // into a Stack plays every connected source's rows at once — the same aggregation
        // source-to-source merging used to do, just via an explicit hub card instead of two
        // sources linking directly to each other. stackSourceRows is reset once per render (see
        // propagateCanvasStreams), same pattern as source.mergeCache used to be.
        shelf: {
            inputs: ['performance', 'sourceRows'],
            outputs: ['performance', 'content'],
            onStream(item, payload) {
                if (payload.streamType === 'sourceRows') {
                    item.stackSourceRows = item.stackSourceRows || {};
                    item.stackSourceRows[payload.originId] = payload.delta.rows || [];
                    return;
                }
                if (payload.streamType !== 'performance' || !payload.delta || !payload.delta.final || !payload.delta.sessionId) return;
                item.shelfSessions = item.shelfSessions || [];
                const sid = payload.delta.sessionId;
                let session = item.shelfSessions.find(s => s.sessionId === sid);
                if (!session) {
                    session = { sessionId: sid, savedAt: Date.now(), payloads: [], label: 'Session ' + (item.shelfSessions.length + 1) };
                    item.shelfSessions.push(session);
                    item.shelfSelectedId = session.sessionId;
                }
                const cleanDelta = Object.assign({}, payload.delta);
                delete cleanDelta.final; delete cleanDelta.sessionId;
                const existing = session.payloads.find(p => p.originId === payload.originId);
                if (existing) existing.delta = cleanDelta; else session.payloads.push({ originId: payload.originId, delta: cleanDelta });
            },
            getOutput(item) {
                const out = [];
                const session = (item.shelfSessions || []).find(s => s.sessionId === item.shelfSelectedId);
                if (session) session.payloads.forEach(p => out.push(makeStreamPayload(p.originId, 'performance', p.delta)));
                const combinedRows = [].concat(...Object.values(item.stackSourceRows || {}));
                if (combinedRows.length) out.push(makeStreamPayload(item.id, 'content', { rows: combinedRows }));
                return out.length ? out : null;
            }
        },
    };

export { add, applyConnections, applyFilterToRows, calculateSM2, cancelAddingKind, clearDataLinkPending, collectAvailableFilterTags, deepCloneItem, defaultSrsState, deleteClonedItemFolders, diffRatings, isValidConnection, renderConnectionsLayer, setDrawMode, startConnectionDrag, startDrawStroke, toggleDrawFromMenu, updateDrawLayerBtns };

// React → vanilla bridge (see the identical pattern/comment in cards-misc.js) — used by
// FilterCard.jsx (app/dotto/), which can't import these directly since public/dotto/*.js isn't
// reachable from app/dotto/.
window.__applyFilterToRows = applyFilterToRows;
window.__collectAvailableFilterTags = collectAvailableFilterTags;
