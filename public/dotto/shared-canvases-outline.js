import { clearSearch, escapeHtml, findParentFolderId, stripHtml } from './ai-assistant-suggestions.js';
import { shortUrl } from './cards-misc.js';
import { appState, canvasViewportCenterX, supabase } from './core-state.js';
import { applyTransform, smoothPanTo } from './history-autosave.js';
import { flashCanvasElement } from './mnemonic-search-matching.js';
import { closeHamburgerMenu } from './panels-hamburger.js';
import { pushNotification } from './stopwatch-search-notifications.js';
import { applyFolderView, centerOnContent, expandWaypointCard, openFolder, render } from './waypoints-render-loop.js';


    // ---------- Live-shared canvases (accepted canvas_collaborations — see the hamburger
    // Collaborations panel) ----------
    // A canvas someone else owns isn't part of this user's own folder tree at all — it's fetched
    // on demand (get_shared_folder RPC) and dropped into the SAME `folders` map everything else
    // already reads from, under a key namespaced by owner+remote id (folder ids are only unique
    // within one user's own id sequence, so a bare folder id could collide with one of ours).
    // That reuse is what lets render()/openFolder/the outline/etc. all work on it completely
    // unmodified. saveWorkspaceNow strips shared: keys back out before persisting to this user's
    // own workspace row, and instead patches just that one folder back via update_shared_folder
    // when one is currently open — see that function.
    //
    // A folder/source nested inside a shared canvas is itself shared too (inherited access — see
    // canvas_access_status in the 20260727 migration), so it needs to be reachable the exact same
    // way as the top-level one: fetched on demand under its own shared:owner:id key. That's why
    // every folder/source item's `folderId` gets rewritten to that namespaced form the moment its
    // OWN containing folder is fetched (see injectSharedFolder) — so a later openFolder() on one
    // of those items resolves to a shared: key too, and ensureSharedFolderLoaded fetches it lazily
    // the first time it's actually navigated into, exactly like the entry point was.
 // { currentFolderId, historyStack, historyIndex } from just before entering the top-level shared canvas — restored by exitSharedCanvas
 // ownerId -> display name, populated wherever it's already known (openSharedCanvas's caller) — see announceEnteredCollaboration/renderHubCollabList
    function sharedFolderKey(ownerId, folderId) { return `shared:${ownerId}:${folderId}`; }
    function parseSharedFolderKey(key) {
        const parts = key.split(':');
        return { ownerId: parts[1], remoteFolderId: parts.slice(2).join(':') };
    }
    // A 'folder'/'source' kind item's own .folderId points at whichever child folder IT opens —
    // namespaceSharedFolderIds/stripSharedFolderIds are exact inverses of each other for
    // rewriting those references across the shared/canonical boundary. The owner's real,
    // canonical storage (workspaces.data->folders) ALWAYS uses bare, un-namespaced folder ids;
    // the shared: prefix is a purely LOCAL, this-client-only device (see sharedFolderKey) so a
    // collaborator's own `folders` dict doesn't collide with their own folder ids. Any data
    // crossing that boundary in EITHER direction must be rewritten accordingly — get it wrong and
    // a shared: value leaks into the owner's canonical data, which then gets wrapped AGAIN on the
    // next fetch, compounding into a genuinely corrupt, permanently-broken folder id (confirmed
    // live: "no accepted collaboration covers this canvas" on a folder id like
    // "shared:OWNER:shared:OWNER:folder-42" — exactly this bug, from update_shared_folder
    // previously saving the still-namespaced form straight back to the owner's own row).
    // Strips however MANY layers of shared: wrapping happen to be present, not just one — some
    // existing data already has 2+ layers baked in from before this fix existed, and this needs to
    // fully self-heal that on the next read/write it goes through, not just avoid making it worse.
    function fullyUnwrapFolderId(folderId) {
        while (typeof folderId === 'string' && folderId.startsWith('shared:')) folderId = parseSharedFolderKey(folderId).remoteFolderId;
        return folderId;
    }
    function stripSharedFolderIds(items) {
        return (items || []).map(it => (it.kind === 'folder' || it.kind === 'source')
            ? { ...it, folderId: fullyUnwrapFolderId(it.folderId) }
            : it);
    }
    // Always strips first, THEN wraps exactly once — makes this idempotent/self-healing no matter
    // how many layers of historical corruption the input already carries (see the comment above).
    function namespaceSharedFolderIds(ownerId, items) {
        return stripSharedFolderIds(items).map(it => (it.kind === 'folder' || it.kind === 'source')
            ? { ...it, folderId: sharedFolderKey(ownerId, it.folderId) }
            : it);
    }
    // Drops one fetched folder into `folders` under its namespaced key, rewriting its own child
    // folder/source items' folderId references to the same namespaced form (see comment above).
    // Also kicks off (fire-and-forget) fetching who else besides this user has access, for the
    // Returns the local key it was stored under.
    function injectSharedFolder(ownerId, remoteFolderId, data) {
        const localKey = sharedFolderKey(ownerId, remoteFolderId);
        const items = namespaceSharedFolderIds(ownerId, data.items);
        appState.folders[localKey] = { ...data, items, id: localKey, title: data.title || remoteFolderId, collaborators: [], isSharedView: true, sharedOwnerId: ownerId, sharedRemoteFolderId: remoteFolderId };
        return localKey;
    }
    async function ensureSharedFolderLoaded(localKey) {
        if (appState.folders[localKey]) return true;
        if (!supabase || !appState.currentUser.id) return false;
        const { ownerId, remoteFolderId } = parseSharedFolderKey(localKey);
        const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: ownerId, p_folder_id: remoteFolderId });
        // A PostgrestError's own useful fields (message/code/details/hint) don't always show up
        // when the error object itself is logged directly (some log viewers just print "{}") —
        // spelling them out explicitly as a string here means the real reason is always visible
        // regardless of how this ends up being viewed.
        if (error || !data) {
            console.error(`[collab] failed to load shared folder (owner=${ownerId} folder=${remoteFolderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (folder not found?)');
            return false;
        }
        injectSharedFolder(ownerId, remoteFolderId, data);
        return true;
    }
    // `ownerName` is only known at the entry point (whoever linked you here already has it —
    // e.g. the hamburger Collaborations list) — cached so the pill can show it for any nested
    // folder fetched later within the same tree too, without a further profile lookup.
    async function openSharedCanvas(ownerId, folderId, title, ownerName) {
        if (!supabase || !appState.currentUser.id) return;
        if (ownerName) appState.sharedOwnerNameCache[ownerId] = ownerName;
        const { data, error } = await supabase.rpc('get_shared_folder', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !data) {
            console.error(`[collab] failed to open shared canvas (owner=${ownerId} folder=${folderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (folder not found?)');
            return;
        }
        const localKey = injectSharedFolder(ownerId, folderId, data);
        if (title) appState.folders[localKey].title = data.title || title;
        const isFreshEntry = !appState.preSharedViewState;
        if (isFreshEntry) appState.preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        appState.currentFolderId = localKey;
        appState.historyStack = [localKey];
        appState.historyIndex = 0;
        closeHamburgerMenu();
        render();
        centerOnContent();
        if (isFreshEntry) announceEnteredCollaboration(localKey);
    }
    // Replaces the old persistent "Collaborating with X" pill under the search bar — fires ONCE,
    // right when a collaboration session actually starts (fresh entry only, never on every render
    // while already in one — see callers), rather than a permanent fixture for as long as you're
    // in it. Awaits a fresh get_effective_collaborators fetch itself (rather than reusing
    // injectSharedFolder's own fire-and-forget one) so the "and N others" count is accurate the
    // very first time this shows, not whatever was last known.
    async function announceEnteredCollaboration(localKey) {
        const folderObj = appState.folders[localKey];
        if (!folderObj) return;
        const ownerName = appState.sharedOwnerNameCache[folderObj.sharedOwnerId] || 'someone';
        let othersCount = 0;
        if (supabase && appState.currentUser.id) {
            const { data: rows, error } = await supabase.rpc('get_effective_collaborators', { p_owner_id: folderObj.sharedOwnerId, p_folder_id: folderObj.sharedRemoteFolderId });
            if (!error) othersCount = (rows || []).filter(r => r.collaborator_id !== appState.currentUser.id).length;
        }
        if (!appState.folders[localKey]) return; // navigated away again before this resolved
        pushNotification({
            type: 'entered_collaboration',
            message: `Collaborating on "${folderObj.title}" with ${ownerName}${othersCount > 0 ? ` and ${othersCount} ${othersCount === 1 ? 'other' : 'others'}` : ''}.`,
        });
    }

    // ---------- Publicly-shared canvases (see set_global_item_visibility/global_items,
    // 20260812_add_global_items.sql, and resolve_global_id/get_public_folder,
    // 20260813_add_global_id_resolution.sql) ----------
    // A second, deliberately much narrower sharing mode alongside the collaboration system above:
    // an owner can mark a specific canvas/source public, after which ANYONE can view it read-only
    // by its exact global id — never by name, and never inherited by nested items automatically.
    // Each nested folder/source has its own independent visibility flag; get_public_folder's own
    // gate is per-(owner,folder), so navigating into a nested item here only works if THAT item
    // was separately marked public too — no cascading, unlike canvas_access_status's inheritance
    // for the private-collaboration case above. Same local-namespaced-key reuse trick as the
    // shared: convention, under its own public: prefix — and, critically, NEVER written back
    // anywhere: saveWorkspaceNow's own filter excludes public: keys the same way it already
    // excludes shared: ones (history-autosave.js), and there is no update_public_folder RPC at
    // all. Leaving and coming back forgets it completely — nothing about a public view is ever
    // persisted, locally or remotely, matching "obtain" on a public item being a one-off,
    // no-lasting-record read (see the slash-command plan's own "obtain" semantics).
    function publicFolderKey(ownerId, folderId) { return `public:${ownerId}:${folderId}`; }
    function parsePublicFolderKey(key) {
        const parts = key.split(':');
        return { ownerId: parts[1], remoteFolderId: parts.slice(2).join(':') };
    }
    // No stripPublicFolderIds/fullyUnwrapPublicFolderId counterpart to the shared: versions above
    // — those exist only because a shared folder's edits get written BACK to the owner's canonical
    // (bare-id) storage via update_shared_folder, which needs the unwrap. A public: id never gets
    // written anywhere, so it never needs unwrapping either.
    function namespacePublicFolderIds(ownerId, items) {
        return (items || []).map(it => (it.kind === 'folder' || it.kind === 'source')
            ? { ...it, folderId: publicFolderKey(ownerId, it.folderId) }
            : it);
    }
    function injectPublicFolder(ownerId, remoteFolderId, data) {
        const localKey = publicFolderKey(ownerId, remoteFolderId);
        const items = namespacePublicFolderIds(ownerId, data.items);
        appState.folders[localKey] = { ...data, items, id: localKey, title: data.title || remoteFolderId, collaborators: [], isPublicView: true, publicOwnerId: ownerId, publicRemoteFolderId: remoteFolderId };
        return localKey;
    }
    async function ensurePublicFolderLoaded(localKey) {
        if (appState.folders[localKey]) return true;
        if (!supabase || !appState.currentUser.id) return false;
        const { ownerId, remoteFolderId } = parsePublicFolderKey(localKey);
        const { data, error } = await supabase.rpc('get_public_folder', { p_owner_id: ownerId, p_folder_id: remoteFolderId });
        if (error || !data) {
            console.error(`[public] failed to load public folder (owner=${ownerId} folder=${remoteFolderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (not public, or deleted?)');
            return false;
        }
        injectPublicFolder(ownerId, remoteFolderId, data);
        return true;
    }
    // Entry point for the future "/source|canvas <id>" obtain command on a public item that isn't
    // the caller's own and isn't shared with them (see command-verbs.js, not built yet — this PR
    // is plumbing only, nothing calls this yet). Unlike openSharedCanvas, never announces a
    // collaboration (this isn't one) — reuses preSharedViewState purely as "where to resume when
    // backing out of someone else's read-only content," the same resume slot a shared view uses,
    // since the two cases need identical resume behavior and there's no reason to duplicate it.
    async function openPublicCanvas(ownerId, folderId, title) {
        if (!supabase || !appState.currentUser.id) return;
        const { data, error } = await supabase.rpc('get_public_folder', { p_owner_id: ownerId, p_folder_id: folderId });
        if (error || !data) {
            console.error(`[public] failed to open public canvas (owner=${ownerId} folder=${folderId}):`,
                error ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}` : 'no data returned (not public, or deleted?)');
            return;
        }
        const localKey = injectPublicFolder(ownerId, folderId, data);
        if (title) appState.folders[localKey].title = data.title || title;
        const isFreshEntry = !appState.preSharedViewState;
        if (isFreshEntry) appState.preSharedViewState = { currentFolderId: appState.currentFolderId, historyStack: appState.historyStack.slice(), historyIndex: appState.historyIndex };
        appState.currentFolderId = localKey;
        appState.historyStack = [localKey];
        appState.historyIndex = 0;
        closeHamburgerMenu();
        render();
        centerOnContent();
    }

    // Resolves whichever LOCAL key currently represents (ownerId, folderId) for THIS viewer —
    // their own bare folder id, the shared: namespaced key (if they have collaboration access),
    // or the public: namespaced key (if it's public and they don't otherwise have access) — used
    // by ReferenceCard.jsx (the 'place' command's read-only reference card, command-verbs.js) to
    // find/load whatever it should preview. Deliberately re-checked fresh every time, never
    // cached: a reference card needs to reflect an access change (revoked, or flipped back to
    // private after being placed) the next time it loads, not whatever was true when it was first
    // placed — see the feature plan's own trade-offs note on exactly this. Returns null if none
    // of the three currently apply.
    async function resolveReferenceFolderKey(ownerId, folderId) {
        if (ownerId === appState.currentUser.id) return appState.folders[folderId] ? folderId : null;
        const sKey = sharedFolderKey(ownerId, folderId);
        if (await ensureSharedFolderLoaded(sKey)) return sKey;
        const pKey = publicFolderKey(ownerId, folderId);
        if (await ensurePublicFolderLoaded(pKey)) return pKey;
        return null;
    }

    // Leaves the WHOLE shared tree (not just its top level) and lands on the user's own ACTUAL
    // root — not wherever they happened to be right before entering (that distinction used to
    // matter when this was reachable via the breadcrumb "..", but the breadcrumb map's "Root" row
    // (see renderBreadcrumbMapPanel) is specifically meant as an unconditional "take me home"
    // affordance, always available regardless of how deep into someone else's canvas you are).
    function exitSharedCanvasToRoot() {
        if (!appState.preSharedViewState) return;
        // public: entries (openPublicCanvas above) reuse this same preSharedViewState resume slot
        // and need the identical cleanup — they're never persisted anywhere, so simply dropping
        // them from memory here is the whole story, no server-side "leave" call needed.
        for (const id in appState.folders) { if (id.startsWith('shared:') || id.startsWith('public:')) delete appState.folders[id]; }
        appState.preSharedViewState = null;
        appState.currentFolderId = 'root';
        appState.historyStack = ['root'];
        appState.historyIndex = 0;
        render();
        if (appState.folders['root'] && appState.folders['root'].lastView) {
            const lv = appState.folders['root'].lastView;
            appState.tx = lv.tx; appState.ty = lv.ty; appState.scale = lv.scale;
            applyTransform();
        } else {
            centerOnContent();
        }
    }
    // Structural ancestor chain from root down to folderId — walks findParentFolderId repeatedly
    // (the REAL canvas hierarchy), not historyStack (linear click-order navigation history, which
    // can diverge from it — see the comment on the ".." breadcrumb). Works unmodified for a
    // shared: key too (findParentFolderId already does, per injectSharedFolder's consistent
    // rewriting), naturally stopping at whichever folder has no parent — true root for an owned
    // tree, or the top-level shared entry point for one entered via openSharedCanvas/a waypoint.
    function buildAncestorChain(folderId) {
        const chain = [folderId];
        let id = folderId;
        while (true) {
            const parent = findParentFolderId(id);
            if (!parent) break;
            chain.unshift(parent);
            id = parent;
        }
        return chain;
    }
    // Real React state (see app/dotto/BreadcrumbPill.jsx, breadcrumbMapStore) — a compact
    // "…/parent/current" pill next to the back/forward arrows now, not a full indented ancestor
    // list, so this only ever needs the last couple of links in the chain plus whether there's
    // more above them. Called straight from render() (waypoints-render-loop.js) on every
    // navigation, same as before. Still walks the full structural chain (buildAncestorChain,
    // including the synthetic Root row pinned in when currently inside a shared tree, since the
    // real ancestor chain never reaches it from there) — just condenses it down to {hasMore, root,
    // parent, current} instead of keeping every intermediate row. `root`/`parent`/`current` all
    // carry `isSyntheticRoot` through untouched, since whichever one ends up being the synthetic
    // Root row still needs breadcrumbMapRowClick to route it to exitSharedCanvasToRoot() rather
    // than a plain openFolder('root').
    function renderBreadcrumbMapPanel() {
        const folderObj = appState.folders[appState.currentFolderId];
        if (!folderObj) { window.__setBreadcrumbMap({ hasMore: false, root: null, parent: null, current: null }); return; }
        const showSyntheticRoot = folderObj.isSharedView;
        const chain = [];
        if (showSyntheticRoot) {
            chain.push({ label: appState.folders['root'] ? appState.folders['root'].title : 'Root', folderId: 'root', isSyntheticRoot: true });
        }
        buildAncestorChain(appState.currentFolderId).forEach((id) => {
            const target = appState.folders[id];
            if (!target) return;
            chain.push({ label: target.title || id, folderId: id, isSyntheticRoot: false });
        });
        const current = chain[chain.length - 1] || null;
        const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
        const root = chain.length > 2 ? chain[0] : null;
        window.__setBreadcrumbMap({ hasMore: chain.length > 2, root, parent, current });
    }

    // Wired up from BreadcrumbPill.jsx's ellipsis/parent onClick — a non-current segment's click
    // either exits to root (the synthetic row) or navigates there directly.
    function breadcrumbMapRowClick(folderId, isSyntheticRoot) {
        if (isSyntheticRoot) exitSharedCanvasToRoot();
        else openFolder(folderId);
    }

    // Steps to an EXISTING position in historyStack (back/forward, breadcrumb "..") — no
    // truncation, no push, just moves the pointer.
    function jumpToHistoryIndex(newIndex) {
        appState.historyIndex = newIndex;
        applyFolderView(appState.historyStack[newIndex]);
    }

    // ---------- Canvas Outline Hierarchical Builder inside Hamburger Menu ----------
    function nearestOf(list, ref) {
        let best = null, bd = Infinity;
        list.forEach(c => { const d = Math.hypot(c.x - ref.x, c.y - ref.y); if (d < bd) { bd = d; best = c; } });
        return best;
    }
    // Maps a card kind (+ heading level, for 'title') to its /assets/icons/*.png filename —
    // shared by the canvas outline tree (outlineIcon, below) and the search-results type
    // indicator (renderMatchRow), since both display the same kind taxonomy as a small icon.
    function kindIconFile(kind, level) {
        if (kind === 'title') return `heading-${level || 1}.png`;
        const files = {
            folder: 'canvas.png', source: 'source.png', table: 'table.png', media: 'media.png',
            checklist: 'checklist.png', watermark: 'watermark.png',
            flashcard: 'flashcards.png', typeright: 'typeright.png', note: 'note.png', statcard: 'statcard.png',
            stopwatch: 'stopwatch.png', shelf: 'shelf.png', waypoint: 'waypoint.png',
            filter: 'tag-button.png', // no dedicated icon asset yet — closest existing one, since filtering is tag-based
            embed: 'embed.png', // no icon asset exists yet either — add public/assets/icons/embed.png; missing files already degrade gracefully throughout this app
            reference: 'canvas.png', // no dedicated asset either — closest existing one, same reasoning as filter/embed above
        };
        return files[kind] || 'note.png';
    }
    // Plain "what kind of block is this" text — deliberately separate from miniLabelForItem
    // (live-presence.js), which mostly answers "what do I call this" instead (real content for
    // note/title, only falling back to a type-ish word when a kind has no user-facing text of its
    // own) and CARD_KINDS[kind].label (card-kinds.js), which only has real values for 2 of these
    // 17 kinds by design (see that file's own comment) — neither fits "type" as its own field.
    // Used by ScheduleModeCardBody.jsx (app/dotto/) alongside kindIconFile/miniLabelForItem.
    function kindTypeLabel(kind, level) {
        if (kind === 'title') return `Heading ${level || 1}`;
        const labels = {
            folder: 'Canvas', source: 'Source', table: 'Table', media: 'Media',
            checklist: 'Checklist', watermark: 'Watermark', flashcard: 'Flashcards',
            typeright: 'Typeright', note: 'Note', statcard: 'Stat', stopwatch: 'Stopwatch',
            shelf: 'Stack', waypoint: 'Waypoint', filter: 'Filter', embed: 'Embed',
            sentence: 'Sentence',
        };
        return labels[kind] || (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Card');
    }
    // Returns a ready-to-insert <span> using kindIconFile as a mask (see .icon-mask) — pass
    // whatever extra class sizes/positions it at the call site (e.g. "outline-icon").
    function kindIconHTML(kind, level, extraClass) {
        const url = `/assets/icons/${kindIconFile(kind, level)}`;
        return `<span class="${extraClass} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
    }
    function outlineIcon(kind, level) {
        return kindIconHTML(kind, level, 'outline-icon');
    }
    function outlineLabel(item) {
        if (item.kind === 'folder' || item.kind === 'source') return (appState.folders[item.folderId] ? appState.folders[item.folderId].title : 'Canvas');
        if (item.kind === 'table') return 'Table';
        if (item.kind === 'media') return 'Media';
        if (item.kind === 'embed') return item.embedUrl ? shortUrl(item.embedUrl) : 'Embed';
        if (item.kind === 'checklist') return 'Checklist';
        if (item.kind === 'watermark') return 'Watermark';
        if (item.kind === 'flashcard') return 'Flashcards';
        if (item.kind === 'typeright') return 'Typeright';
        if (item.kind === 'statcard') return item.statKind === 'accuracy' ? 'Accuracy' : 'Progress';
        if (item.kind === 'stopwatch') return 'Stopwatch';
        if (item.kind === 'shelf') return item.shelfName || 'Stack';
        if (item.kind === 'filter') return 'Filter';
        if (item.kind === 'waypoint') return item.name || 'New Waypoint';
        if (item.kind === 'note') return (item.html || '').replace(/<[^>]*>/g, '').trim() || 'Note';
        const txt = (item.html || '').replace(/<[^>]*>/g, '').trim();
        return txt || '(untitled heading)';
    }
    
    // Current level (currentFolderId's own contents) plus 2 deeper levels of nested folders —
    // the rolling window is always anchored to the LIVE canvas position, not a separate
    // menu-only drill state. The only way the window ever shifts is by actually navigating the
    // real canvas (via a leaf-item click here, a source-item click here, or anything else that
    // changes currentFolderId) — there is no in-menu-only "focus" concept and no breadcrumb.

   // 30 grid squares — beyond this, a card isn't near enough to any heading to join it directly
  // 10 grid squares — but it still joins whatever heading a nearby (already-grouped) card belongs to

    // Renders `folder`'s own items — leaf cards, plus child folders/sources — at the given depth.
    // Every row (whether it's a canvas, a source, or a plain card) uses the exact same
    // .outline-item styling — there is no header/row visual distinction of any kind by design.
    // A child FOLDER's own contents are recursed into immediately after its row (one level
    // deeper), up to OUTLINE_MAX_DEPTH; a child SOURCE is always a dead-end row — its internal
    // table is never shown separately, and clicking it jumps straight into the source instead of
    // centering on its card (see below). Waypoints are excluded entirely — they live only in
    // their own Waypoints hub panel (see openWaypointsPanel/renderWaypointsList), never here.
    //
    // Headings give this list structure, based purely on canvas proximity (there's no other
    // parent/child relationship recorded anywhere): H2 nests under its nearest H1, H3 under its
    // nearest H2 (or H1 if no H2 exists at all) — see h2Parent/h3Parent. Every OTHER card
    // (leaf cards, folders, sources) then nests under whichever heading of ANY level is nearest
    // to it, as long as that's within OUTLINE_GROUP_MAX_DIST — beyond that it's too far to
    // belong to that heading directly, but it can still be "rescued" into the same group as a
    // heading-grouped neighbor within OUTLINE_RESCUE_MAX_DIST (repeated to a fixed point, so a
    // rescued card can go on to rescue further cards near it, forming one contiguous cluster
    // instead of a hard cutoff at exactly 30 squares from the heading itself). Anything left
    // over after that — including every card when the folder has no headings at all — is
    // rendered flat, ungrouped, same as before headings existed.
    // Returns true if anything was rendered, for the "nothing here yet" empty state.
    function renderOutlineFolderContents(container, folder, depth, visited) {
        const items = folder.items || [];
        const titles = items.filter(i => i.kind === 'title');
        const childFolders = items.filter(i => i.kind === 'folder');
        const childSources = items.filter(i => i.kind === 'source');
        const others = items.filter(i => i.kind !== 'title' && i.kind !== 'folder' && i.kind !== 'source' && i.kind !== 'waypoint');
        const any = titles.length > 0 || others.length > 0 || childFolders.length > 0 || childSources.length > 0;

        // The canvas point currently centered on screen for this specific folder — live tx/ty/
        // scale for whichever folder is actually being viewed right now, or its saved pan/zoom
        // (folders[id].lastView — see applyFolderView) for any other folder the outline tree
        // recurses into. Same "canvas point centered on screen" inversion smoothPanTo/
        // centerOnContent use elsewhere: screenX = tx + canvasX*scale, so canvasX = (screenX -
        // tx) / scale. null (skip proximity ordering, fall back to natural creation order) for a
        // folder that's neither the live one nor has ever been visited.
        const view = (folder.id === appState.currentFolderId) ? { tx: appState.tx, ty: appState.ty, scale: appState.scale } : folder.lastView;
        const viewCenter = view ? { x: (canvasViewportCenterX() - view.tx) / view.scale, y: (window.innerHeight / 2 - view.ty) / view.scale } : null;
        function sortByProximity(list) {
            if (!viewCenter) return list;
            return list.sort((a, b) => Math.hypot(a.x - viewCenter.x, a.y - viewCenter.y) - Math.hypot(b.x - viewCenter.x, b.y - viewCenter.y));
        }

        // Sorting these once, in place, up front is enough to make every downstream listing —
        // top-level orphan headings AND each parent heading's own nested h2s/h3s (both just
        // `.filter()` these same arrays, which preserves source order) — closest-first without
        // needing to re-sort at every recursion level.
        const h1s = sortByProximity(titles.filter(t => (t.level || 1) === 1));
        const h2s = sortByProximity(titles.filter(t => (t.level || 1) === 2));
        const h3s = sortByProximity(titles.filter(t => (t.level || 1) === 3));
        const allHeadings = [...h1s, ...h2s, ...h3s];
        const h2Parent = new Map(), h3Parent = new Map();
        h2s.forEach(h2 => { if (h1s.length) h2Parent.set(h2.id, nearestOf(h1s, h2).id); });
        h3s.forEach(h3 => {
            if (h2s.length) h3Parent.set(h3.id, { level: 2, id: nearestOf(h2s, h3).id });
            else if (h1s.length) h3Parent.set(h3.id, { level: 1, id: nearestOf(h1s, h3).id });
        });

        // ---- Group every non-heading card under its nearest heading (see comment above) ----
        const headingGroups = new Map(); // heading id -> item[]
        allHeadings.forEach(h => headingGroups.set(h.id, []));
        const assignable = [...others, ...childSources, ...childFolders];
        let unassigned = [];
        assignable.forEach(item => {
            if (!allHeadings.length) { unassigned.push(item); return; }
            const nearest = nearestOf(allHeadings, item);
            const dist = Math.hypot(nearest.x - item.x, nearest.y - item.y);
            if (dist <= appState.OUTLINE_GROUP_MAX_DIST) headingGroups.get(nearest.id).push(item);
            else unassigned.push(item);
        });
        let changed = true;
        while (changed && unassigned.length) {
            changed = false;
            for (let i = unassigned.length - 1; i >= 0; i--) {
                const item = unassigned[i];
                let rescueHeadingId = null;
                for (const [hid, groupItems] of headingGroups) {
                    if (groupItems.some(g => Math.hypot(g.x - item.x, g.y - item.y) <= appState.OUTLINE_RESCUE_MAX_DIST)) { rescueHeadingId = hid; break; }
                }
                if (rescueHeadingId) {
                    headingGroups.get(rescueHeadingId).push(item);
                    unassigned.splice(i, 1);
                    changed = true;
                }
            }
        }
        headingGroups.forEach(group => sortByProximity(group));
        sortByProximity(unassigned);

        function makeRow(item, subIndent) {
            const row = document.createElement('div');
            row.className = 'outline-item';
            row.style.setProperty('--outline-indent', ((depth + subIndent) * 14) + 'px');
            row.innerHTML = `${outlineIcon(item.kind, item.level)}<span class="outline-label">${escapeHtml(outlineLabel(item))}</span>`;
            row.onclick = (e) => {
                e.stopPropagation();
                if (item.kind === 'source') {
                    // Sources are entered directly (they just show a table) rather than centered
                    // on as a card — unlike every other item kind, including canvases.
                    if (appState.currentFolderId !== item.folderId) openFolder(item.folderId);
                    closeHamburgerMenu();
                } else {
                    // Canvas cards and leaf cards alike: land on this item within its OWN direct
                    // parent (`folder`, the containing folder this row belongs to) — never
                    // drilling into a canvas via the menu itself.
                    goToOutlineItem(folder.id, item.id);
                }
            };
            container.appendChild(row);
            appState.outlineRows.push({ el: row });
        }

        // A non-heading card's own row, plus (for folders) recursing into its nested contents —
        // shared by both grouped-under-a-heading and fully-ungrouped rendering below.
        function makeCardRow(item, subIndent) {
            makeRow(item, subIndent);
            if (item.kind === 'folder' && depth < appState.OUTLINE_MAX_DEPTH && item.folderId && appState.folders[item.folderId] && !visited.has(item.folderId)) {
                visited.add(item.folderId);
                renderOutlineFolderContents(container, appState.folders[item.folderId], depth + 1, visited);
            }
        }

        // A heading's own nested h2s and directly-attached h3s (h3s whose nearest heading is
        // this h1 itself, when it has no h2 children at all — see h3Parent above) are two
        // separate sources, merged and re-sorted together here so they interleave by proximity
        // rather than always listing every h2 subtree before any direct h3.
        function renderHeadingSubtree(heading, subIndent) {
            makeRow(heading, subIndent);
            (headingGroups.get(heading.id) || []).forEach(item => makeCardRow(item, subIndent + 1));
            const level = heading.level || 1;
            let children = [];
            if (level === 1) {
                children = [
                    ...h2s.filter(h2 => h2Parent.get(h2.id) === heading.id),
                    ...h3s.filter(h3 => { const p = h3Parent.get(h3.id); return p && p.level === 1 && p.id === heading.id; }),
                ];
            } else if (level === 2) {
                children = h3s.filter(h3 => { const p = h3Parent.get(h3.id); return p && p.level === 2 && p.id === heading.id; });
            }
            sortByProximity(children).forEach(child => renderHeadingSubtree(child, subIndent + 1));
        }

        // Top-level entries — every orphan heading (no parent to nest under) plus every fully
        // ungrouped card — combined into one list and ordered by proximity together, rather than
        // rendering all h1s, then all orphan h2s, then all orphan h3s, then all ungrouped cards
        // as fixed, un-interleaved blocks.
        const topLevelRoots = [
            ...h1s.map(h1 => ({ x: h1.x, y: h1.y, render: () => renderHeadingSubtree(h1, 0) })),
            ...h2s.filter(h2 => !h2Parent.has(h2.id)).map(h2 => ({ x: h2.x, y: h2.y, render: () => renderHeadingSubtree(h2, 0) })),
            ...h3s.filter(h3 => !h3Parent.has(h3.id)).map(h3 => ({ x: h3.x, y: h3.y, render: () => renderHeadingSubtree(h3, 0) })),
            ...unassigned.map(item => ({ x: item.x, y: item.y, render: () => makeCardRow(item, 0) })),
        ];
        sortByProximity(topLevelRoots).forEach(root => root.render());

        return any;
    }

    function buildOutline() {
        const container = document.getElementById('hmenu-outline-container');
        if (!container) return;
        container.innerHTML = '';
        container.scrollTop = 0; // buildOutline only ever runs when the menu is being opened — always start at the top
        appState.outlineRows = []; appState.outlineActiveIndex = -1;

        const rootFolder = appState.folders[appState.currentFolderId];
        const any = rootFolder ? renderOutlineFolderContents(container, rootFolder, 0, new Set([rootFolder.id])) : false;

        if (!any) {
            const empty = document.createElement('div');
            empty.className = 'outline-empty';
            empty.textContent = 'Nothing here yet.';
            container.appendChild(empty);
        }
    }

    // Navigates the live canvas to a card's containing folder and centers on it. Used for every
    // non-source row (leaf cards AND canvas cards alike) — openFolder now goes through
    // applyFolderView, so this also benefits from per-folder position memory (see
    // navigateToFolder/applyFolderView).
    function goToOutlineItem(folderId, itemId) {
        if (appState.currentFolderId !== folderId) openFolder(folderId);
        const it = appState.folders[folderId].items.find(i => i.id === itemId);
        if (it) {
            const el = document.getElementById('item-' + it.id);
            const w = el ? el.offsetWidth : (it.w || 100);
            const h = el ? el.offsetHeight : (it.h || 50);
            smoothPanTo(canvasViewportCenterX() - (it.x + w / 2), window.innerHeight / 2 - (it.y + h / 2), 1);
            if (el && it.kind === 'waypoint') expandWaypointCard(el, it, { editable: false });
            flashCanvasElement(el);
        }
        closeHamburgerMenu();
    }
    function setOutlineActive(idx) {
        if (!appState.outlineRows.length) return;
        idx = ((idx % appState.outlineRows.length) + appState.outlineRows.length) % appState.outlineRows.length;
        appState.outlineRows.forEach(r => r.el.classList.remove('active'));
        appState.outlineActiveIndex = idx;
        const row = appState.outlineRows[idx];
        row.el.classList.add('active');
        row.el.scrollIntoView({ block: 'nearest' });
    }
    function toggleHamburgerMenu() {
        const willOpen = !appState.outlineMenu.classList.contains('open');
        appState.outlineMenu.classList.toggle('open', willOpen);
        appState.accountMenu.classList.toggle('open', willOpen);
        appState.hamburgerBtn.classList.toggle('active', willOpen);
        if(willOpen) {
            buildOutline();
            setOutlineActive(0);
        }
    }

export { announceEnteredCollaboration, breadcrumbMapRowClick, buildOutline, ensurePublicFolderLoaded, ensureSharedFolderLoaded, goToOutlineItem, jumpToHistoryIndex, kindIconFile, kindIconHTML, kindTypeLabel, namespacePublicFolderIds, namespaceSharedFolderIds, openPublicCanvas, openSharedCanvas, parsePublicFolderKey, parseSharedFolderKey, publicFolderKey, renderBreadcrumbMapPanel, resolveReferenceFolderKey, setOutlineActive, sharedFolderKey, stripSharedFolderIds, toggleHamburgerMenu };

window.__kindIconFile = kindIconFile;
window.__kindTypeLabel = kindTypeLabel;
window.__openSharedCanvas = openSharedCanvas;

// React → vanilla bridge — used by BreadcrumbPill.jsx (app/dotto/), which can't import this
// directly since public/dotto/*.js isn't reachable from app/dotto/.
window.__breadcrumbMapRowClick = breadcrumbMapRowClick;
window.__resolveReferenceFolderKey = resolveReferenceFolderKey;
