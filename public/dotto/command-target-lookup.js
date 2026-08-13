import { appState, supabase } from './core-state.js';
import { GLOBAL_ID_ALPHABET, GLOBAL_ID_LENGTH } from './global-ids.js';

// Matches the exact shape generateGlobalId() produces (global-ids.js) — used to short-circuit
// straight to resolve_global_id instead of a name search. A short, weird-looking canvas title
// could in theory also match this shape, but resolveCommandTarget below only trusts an id match
// when resolve_global_id actually finds one, so a false-positive shape match just falls through
// to "not found" rather than silently doing the wrong thing.
const GLOBAL_ID_SHAPE = new RegExp(`^[${GLOBAL_ID_ALPHABET}]{${GLOBAL_ID_LENGTH}}$`);

// Recursively walks the caller's OWN folder tree (already loaded locally — appState.folders' own,
// un-namespaced keys only; shared:/public: entries belong to someone else and are never searched
// here) for folders/sources whose title contains the query, filtered by kind. Depth-first,
// capped at `limit` (same 4-row cap CanvasResultsPanel already uses elsewhere) — good enough for
// a live-typing suggestions list; not meant to be an exhaustive/ranked search.
function searchOwnTreeByNameAll(query, kind, limit = 4) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    const visited = new Set();
    const stack = ['root'];
    while (stack.length && results.length < limit) {
        const id = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        const folderObj = appState.folders[id];
        if (!folderObj) continue;
        const folderKind = folderObj.isSource ? 'source' : 'canvas';
        if (folderKind === kind && (folderObj.title || '').toLowerCase().includes(q)) {
            results.push({ folder_id: id, kind: folderKind, title: folderObj.title || '' });
        }
        for (const item of folderObj.items || []) {
            if ((item.kind === 'folder' || item.kind === 'source') && item.folderId
                && !item.folderId.startsWith('shared:') && !item.folderId.startsWith('public:')) {
                stack.push(item.folderId);
            }
        }
    }
    return results;
}

// Resolves a slash command's target (typed name or id) to a single concrete
// { owner_id, folder_id, kind, title, visibility, access, source }, or null if nothing matches.
// `source` is 'id' | 'own' for now — nested shared-tree name search (source: 'shared') is a
// later PR (see the feature plan's own PR sequencing), not built yet.
async function resolveCommandTarget(kind, targetRaw) {
    const trimmed = (targetRaw || '').trim();
    if (!trimmed) return null;
    if (GLOBAL_ID_SHAPE.test(trimmed)) {
        if (!supabase) return null;
        const { data, error } = await supabase.rpc('resolve_global_id', { p_global_id: trimmed });
        if (error) {
            console.error(`[commands] resolve_global_id failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
            return null;
        }
        const row = data && data[0];
        // Matched a real id, but of the wrong kind (e.g. "/source" on a canvas's id) — don't fall
        // through to a name search on the same string, that would silently ignore a real typo
        // and match something unrelated instead.
        if (row) return row.kind === kind ? { ...row, source: 'id' } : null;
    }
    const [own] = searchOwnTreeByNameAll(trimmed, kind, 1);
    if (own) return { owner_id: appState.currentUser.id, folder_id: own.folder_id, kind: own.kind, title: own.title, visibility: 'private', access: 'owner', source: 'own' };
    return null;
}

export { GLOBAL_ID_SHAPE, resolveCommandTarget, searchOwnTreeByNameAll };
