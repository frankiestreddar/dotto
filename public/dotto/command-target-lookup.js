const appState = window.__getAppState();
const supabase = window.__dottoSupabase || null;
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
// capped at `limit` (a small cap, same convention as every other live-typing suggestions list in
// this app) — good enough for a live-typing suggestions list; not meant to be an exhaustive/
// ranked search.
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

// Nested shared-tree name search (search_accessible_by_name RPC, see the matching migration) —
// everything the caller has effective (possibly multi-level inherited) access to via any accepted
// collaboration, however deep. Unlike searchOwnTreeByNameAll this is a real network round trip, so
// callers (command-palette.js) debounce it the same way scheduleLiveSuggestions already debounces
// the live AI suggestions fetch — this function itself doesn't debounce, it's called already-
// debounced. The RPC doesn't filter by kind itself (simpler to keep that logic in one place,
// client-side, matching the id-lookup branch below), so that's done here.
async function searchAccessibleByNameAll(query, kind, limit = 4) {
    const q = query.trim();
    if (!q || !supabase) return [];
    const { data, error } = await supabase.rpc('search_accessible_by_name', { p_query: q });
    if (error) {
        console.error(`[commands] search_accessible_by_name failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        return [];
    }
    return (data || []).filter(r => r.kind === kind).slice(0, limit);
}

// Resolves a slash command's target (typed name or id) to a single concrete
// { owner_id, folder_id, kind, title, visibility, access, source, global_id }, or null if nothing
// matches. Tries, in order: id shape -> resolve_global_id, own tree (local, instant), then the
// nested shared tree (search_accessible_by_name, a real round trip) — own-tree matches
// deliberately win over shared ones when both exist, since "my own canvas by this name" is the
// more likely intent for an ambiguous title (see the feature plan's own trade-offs note on this
// exact ambiguity). global_id is threaded through every branch (not just the id-lookup one) since
// the 'place' command (command-verbs.js) needs it for the reference card's own id display,
// regardless of how the target was originally found.
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
        if (row) return row.kind === kind ? { ...row, source: 'id', global_id: trimmed } : null;
    }
    const [own] = searchOwnTreeByNameAll(trimmed, kind, 1);
    if (own) return { owner_id: appState.currentUser.id, folder_id: own.folder_id, kind: own.kind, title: own.title, visibility: 'private', access: 'owner', source: 'own', global_id: (appState.folders[own.folder_id] && appState.folders[own.folder_id].globalId) || null };
    const [shared] = await searchAccessibleByNameAll(trimmed, kind, 1);
    if (shared) return { owner_id: shared.owner_id, folder_id: shared.folder_id, kind: shared.kind, title: shared.title, visibility: 'private', access: 'collaborator', source: 'shared', global_id: shared.global_id || null };
    return null;
}

export { GLOBAL_ID_SHAPE, resolveCommandTarget, searchAccessibleByNameAll, searchOwnTreeByNameAll };
