import { appState } from './core-state.js';
import { obtainTarget } from './command-verbs.js';
import { parseCommandInput } from './command-parser.js';
import { GLOBAL_ID_SHAPE, resolveCommandTarget, searchAccessibleByNameAll, searchOwnTreeByNameAll } from './command-target-lookup.js';
import { pushNotification } from './stopwatch-search-notifications.js';

// ---------- Slash-command suggestions panel (see command-parser.js/command-target-lookup.js/
// command-verbs.js — orchestration lives here since it's the one place that needs all three) ----------
// Builds the SYNCHRONOUS/instant rows for the current input — kind-stage rows are a static pair;
// target-stage rows are the caller's own-tree name matches (searchOwnTreeByNameAll, already
// loaded locally, no round trip). The nested shared-tree half (scheduleSharedCommandSuggestions
// below) is a real network call, debounced and merged in separately once it resolves, so typing
// itself never waits on it. An id-shaped target gets a single "look up this id" row instead of a
// name search, since ids and free-text titles don't need to compete for the same row — actual id
// resolution only happens once that row is actually selected.
function buildOwnCommandRows(parsed) {
    if (!parsed) return [];
    if (parsed.stage === 'kind') {
        return ['source', 'canvas']
            .filter(k => k.startsWith(parsed.kindPrefix))
            .map(k => ({ type: 'kind', key: `kind-${k}`, kind: k, label: `/${k}`, sublabel: `Look up a ${k} by name or id` }));
    }
    // stage === 'target'
    if (parsed.verb !== 'obtain') {
        // A verb other than plain obtain is recognized by the parser but not wired to execute
        // yet (see command-verbs.js) — no point suggesting rows for something Enter can't do.
        return [];
    }
    if (GLOBAL_ID_SHAPE.test(parsed.targetRaw)) {
        return [{ type: 'id', key: 'id', kind: parsed.kind, globalId: parsed.targetRaw, label: parsed.targetRaw, sublabel: `Look up this ${parsed.kind} by id` }];
    }
    return searchOwnTreeByNameAll(parsed.targetRaw, parsed.kind).map(m => ({
        type: 'own', key: `own-${m.folder_id}`, kind: m.kind, folderId: m.folder_id, label: m.title || '(untitled)', sublabel: m.kind === 'source' ? 'Source' : 'Canvas',
    }));
}

// Nested shared-tree matches (search_accessible_by_name RPC, see its own migration) — debounced
// the same way scheduleLiveSuggestions debounces the AI suggestions fetch (ai-assistant-
// suggestions.js), and merged into whatever own-tree rows are already showing rather than
// replacing them, since both can legitimately have matches at once. Re-derives the own-tree rows
// fresh at merge time (cheap/synchronous) instead of trying to read the store back — there's no
// read bridge for it, only window.__setCommandPalette (write-only, same as every other store).
function scheduleSharedCommandSuggestions(parsed) {
    clearTimeout(appState.commandSuggestDebounceTimer);
    if (!parsed || parsed.stage !== 'target' || parsed.verb !== 'obtain' || !parsed.targetRaw || GLOBAL_ID_SHAPE.test(parsed.targetRaw)) return;
    const valueAtScheduleTime = appState.searchInput.value;
    appState.commandSuggestDebounceTimer = setTimeout(async () => {
        const shared = await searchAccessibleByNameAll(parsed.targetRaw, parsed.kind);
        if (!shared.length || appState.searchInput.value !== valueAtScheduleTime) return; // stale or nothing to add
        const ownRows = buildOwnCommandRows(parsed);
        const sharedRows = shared.map(m => ({
            type: 'shared', key: `shared-${m.owner_id}-${m.folder_id}`, kind: m.kind, ownerId: m.owner_id, folderId: m.folder_id, title: m.title,
            label: m.title || '(untitled)', sublabel: `Shared • ${m.kind === 'source' ? 'Source' : 'Canvas'}`,
        }));
        window.__setCommandPalette({ rows: [...ownRows, ...sharedRows] });
    }, 250);
}

// Same pattern as setSearchActive (ai-assistant-suggestions.js), for #search-command-palette's
// own row list instead of #search-results — see appState.commandActiveIndex's own comment.
function setCommandActive(idx) {
    const items = Array.from(appState.searchCommandPalette.querySelectorAll('.command-palette-row'));
    if (!items.length) return;
    idx = ((idx % items.length) + items.length) % items.length;
    items.forEach(el => el.classList.remove('active'));
    appState.commandActiveIndex = idx;
    items[idx].classList.add('active');
    items[idx].scrollIntoView({ block: 'nearest' });
}

// Called from handleSearchInput's new command branch (ai-assistant-suggestions.js) on every
// keystroke while the box starts with "/". Returns the parsed state so the caller can decide
// whether to fall back to normal search (parsed === null) without parsing twice.
function updateCommandPalette(value) {
    const parsed = parseCommandInput(value);
    appState.commandActiveIndex = -1;
    clearTimeout(appState.commandSuggestDebounceTimer); // a stale in-flight shared search must never clobber this fresh set of rows once it lands
    window.__setCommandPalette(parsed ? { rows: buildOwnCommandRows(parsed) } : null);
    scheduleSharedCommandSuggestions(parsed);
    return parsed;
}

// A row's own click handler (CommandPalette.jsx) and Enter-on-an-arrow-selected-row
// (search-orchestration-selection.js) both funnel through here.
async function selectCommandRow(row) {
    if (!row) return;
    if (row.type === 'kind') {
        appState.searchInput.value = `/${row.kind} `;
        appState.searchInput.focus();
        window.handleSearchInput(appState.searchInput.value);
        return;
    }
    if (row.type === 'own') {
        obtainTarget({ owner_id: appState.currentUser.id, folder_id: row.folderId, kind: row.kind, title: row.label, access: 'owner' });
        return;
    }
    if (row.type === 'shared') {
        obtainTarget({ owner_id: row.ownerId, folder_id: row.folderId, kind: row.kind, title: row.title, access: 'collaborator' });
        return;
    }
    if (row.type === 'id') {
        const target = await resolveCommandTarget(row.kind, row.globalId);
        if (!target) { pushNotification({ type: 'command_error', message: `No ${row.kind} found for that id.` }); return; }
        obtainTarget(target);
    }
}

// Plain Enter with nothing arrow-selected — parses and resolves the FULL current value as a
// complete command (not just whatever's in the suggestions list), so typing the whole thing and
// hitting Enter works without ever touching arrows/clicks, same as any other command palette.
async function executeCurrentCommand(value) {
    const parsed = parseCommandInput(value);
    if (!parsed || parsed.stage !== 'target' || !parsed.targetRaw) return;
    if (parsed.verb !== 'obtain') {
        pushNotification({ type: 'command_error', message: `"${parsed.verb}" isn't available yet — more commands are coming.` });
        return;
    }
    const target = await resolveCommandTarget(parsed.kind, parsed.targetRaw);
    if (!target) { pushNotification({ type: 'command_error', message: `No ${parsed.kind} found matching "${parsed.targetRaw}".` }); return; }
    obtainTarget(target);
}

export { executeCurrentCommand, selectCommandRow, setCommandActive, updateCommandPalette };
window.__selectCommandRow = selectCommandRow;
