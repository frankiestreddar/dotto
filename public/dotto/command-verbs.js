import { appState, supabase } from './core-state.js';
import { resolveUsernameToUserId } from './friends-presence.js';
import { generateGlobalId } from './global-ids.js';
import { saveSnapshot } from './history-autosave.js';
import { openFolder, render } from './waypoints-render-loop.js';
import { CARD_KINDS } from './card-kinds.js';
import { openPublicCanvas, openSharedCanvas } from './shared-canvases-outline.js';
import { deepCloneItem, viewportCenterWorldPoint } from './srs-connections-core.js';
import { pushNotification } from './stopwatch-search-notifications.js';

// Executes the 'obtain' verb for an already-resolved command target (see
// command-target-lookup.js's resolveCommandTarget) — navigates in for your own or shared-with-you
// items (exactly like clicking into them normally would), or opens a public item view-only with
// no lasting record (see openPublicCanvas's own comment on why). copy arrives in a later PR — see
// the slash-command feature's own PR sequencing; this file only grows one function per PR as each
// verb actually ships.
function obtainTarget(target) {
    if (!target) return;
    if (target.access === 'owner') { openFolder(target.folder_id); return; }
    if (target.access === 'collaborator') { openSharedCanvas(target.owner_id, target.folder_id, target.title); return; }
    if (target.access === 'public') { openPublicCanvas(target.owner_id, target.folder_id, target.title); return; }
}

// 'set public'/'set private' — checked against target.access here rather than just leaving it to
// the RPC's own auth.uid()-scoped WHERE clause, so running this against someone else's canvas
// fails with a clear message instead of a generic RPC error/silent no-op (set_global_item_visibility
// raises "not found" for a folder_id that doesn't belong to the caller, which would otherwise read
// as a confusing, unrelated failure).
async function setVisibility(target, visibility) {
    if (!target) return;
    if (target.access !== 'owner') { pushNotification({ type: 'command_error', message: `You can only change visibility on your own ${target.kind}.` }); return; }
    const { error } = await supabase.rpc('set_global_item_visibility', { p_folder_id: target.folder_id, p_visibility: visibility });
    if (error) {
        console.error(`[commands] set_global_item_visibility failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        pushNotification({ type: 'command_error', message: `Couldn't set "${target.title}" to ${visibility}.` });
        return;
    }
    pushNotification({ type: 'command_success', message: `"${target.title}" is now ${visibility}.` });
}

// 'invite <username>' — same owner-only guard as setVisibility. Deliberately calls
// invite_canvas_collaborator directly rather than reusing sendCanvasCollabInvite
// (friends-presence.js) — that wrapper hardcodes appState.currentFolderId and a UI-panel-specific
// pending-invite tracker, neither of which fits inviting on an arbitrary canvas by name/id from a
// command. resolveUsernameToUserId (friends-presence.js) deliberately doesn't require the target
// to already be a friend, unlike the existing Collaborations-panel flow — that restriction lives
// entirely in that panel's own UI, not in the RPC itself.
async function inviteUser(target, username) {
    if (!target) return;
    if (target.access !== 'owner') { pushNotification({ type: 'command_error', message: `You can only invite people to your own ${target.kind}.` }); return; }
    const userId = await resolveUsernameToUserId(username);
    if (!userId) { pushNotification({ type: 'command_error', message: `No user found with username "${username}".` }); return; }
    const { error } = await supabase.rpc('invite_canvas_collaborator', { p_folder_id: target.folder_id, p_folder_title: target.title, p_collaborator_id: userId });
    if (error) {
        console.error(`[commands] invite_canvas_collaborator failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        pushNotification({ type: 'command_error', message: `Couldn't invite ${username}.` });
        return;
    }
    pushNotification({ type: 'command_success', message: `Invited ${username} to "${target.title}".` });
}

// 'remove <username>' — removes an accepted collaborator, or cancels a still-pending invite to
// them (the same RPC already handles both — see revoke_canvas_collaboration's own comment,
// 20260727_add_nested_canvas_sharing.sql — this is the first real UI path that ever exercises the
// pending-invite case, which previously had no way to reach it at all).
async function removeUser(target, username) {
    if (!target) return;
    if (target.access !== 'owner') { pushNotification({ type: 'command_error', message: `You can only remove people from your own ${target.kind}.` }); return; }
    const userId = await resolveUsernameToUserId(username);
    if (!userId) { pushNotification({ type: 'command_error', message: `No user found with username "${username}".` }); return; }
    const { error } = await supabase.rpc('revoke_canvas_collaboration', { p_folder_id: target.folder_id, p_collaborator_id: userId });
    if (error) {
        console.error(`[commands] revoke_canvas_collaboration failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        pushNotification({ type: 'command_error', message: `Couldn't remove ${username}.` });
        return;
    }
    pushNotification({ type: 'command_success', message: `Removed ${username} from "${target.title}".` });
}

// 'place' — drops a read-only reference card (kind: 'reference', ReferenceCard.jsx) at the center
// of the current viewport, pointing at the resolved target by (owner_id, folder_id) rather than
// copying any content — see resolveReferenceFolderKey's own comment (shared-canvases-outline.js)
// for how that card finds/loads the live data every time it (re)mounts, refetched fresh rather
// than cached. Valid for a target you own, a target shared with you, or a public one — obtaining
// isn't required first, "place" is its own independent way to reach something. refTitle/
// refGlobalId are a display-only snapshot (the card re-derives the real content live; these two
// fields just avoid an extra round trip before the preview itself has loaded).
function placeTarget(target) {
    if (!target) return;
    saveSnapshot();
    const { w, h } = CARD_KINDS.reference.defaultSize;
    const center = viewportCenterWorldPoint();
    appState.folders[appState.currentFolderId].items.push({
        id: appState.idCounter++,
        x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h,
        kind: 'reference',
        refOwnerId: target.owner_id, refFolderId: target.folder_id, refKind: target.kind,
        refTitle: target.title, refGlobalId: target.global_id || null,
    });
    render();
}

// Recursively rebuilds a fetched remote folder — and everything nested inside it the caller can
// still reach — as brand-new local folders/items with fresh local AND global ids throughout. The
// remote-data counterpart to deepCloneItem (srs-connections-core.js), which does the identical
// thing for data already sitting in appState.folders; this exists because deepCloneItem only ever
// reads that local map, never fetches. get_shared_folder/get_public_folder are both gated
// per-folder (not per-tree — see their own migrations), so a nested folder/source the caller can
// no longer reach (revoked partway down a shared tree, or — for a public copy — simply not
// independently public itself, since visibility never cascades to nested items) is silently
// dropped from the copy rather than left as a broken reference. No recursion-depth cap here
// (unlike search_accessible_by_name's defensive one) — real trees are nowhere near deep enough
// for it to matter in practice; worth adding if that ever changes.
async function fetchRemoteFolderData(ownerId, folderId, accessKind) {
    const rpcName = accessKind === 'public' ? 'get_public_folder' : 'get_shared_folder';
    const { data, error } = await supabase.rpc(rpcName, { p_owner_id: ownerId, p_folder_id: folderId });
    if (error) {
        console.error(`[commands] ${rpcName} failed during copy: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`);
        return null;
    }
    return data || null;
}
async function cloneRemoteFolder(ownerId, folderId, accessKind) {
    const data = await fetchRemoteFolderData(ownerId, folderId, accessKind);
    if (!data) return null;
    const newFid = 'folder-' + appState.idCounter++;
    const newItems = [];
    for (const item of (data.items || [])) {
        if ((item.kind === 'folder' || item.kind === 'source') && item.folderId) {
            const clonedChild = await cloneRemoteFolder(ownerId, item.folderId, accessKind);
            if (!clonedChild) continue; // inaccessible nested item — dropped, see comment above
            newItems.push({ ...JSON.parse(JSON.stringify(item)), id: appState.idCounter++, folderId: clonedChild.folderId });
        } else {
            newItems.push({ ...JSON.parse(JSON.stringify(item)), id: appState.idCounter++ });
        }
    }
    // ...data may carry the ORIGINAL owner's own globalId (folders persist that field like any
    // other, see saveWorkspaceNow) — spread first, then override every field a real independent
    // copy needs its own fresh value for, same "duplicate starts fresh" reasoning deepCloneItem's
    // own comment already states for the local case.
    appState.folders[newFid] = { ...data, id: newFid, items: newItems, collaborators: [], globalId: generateGlobalId() };
    delete appState.folders[newFid].isSharedView; delete appState.folders[newFid].sharedOwnerId; delete appState.folders[newFid].sharedRemoteFolderId;
    return { folderId: newFid };
}

// 'copy' — creates a full independent duplicate, owned by the caller, placed at the viewport
// center with its own brand-new global id (a real fork, not a live reference — contrast with
// placeTarget above, which never copies content). The 'owner' case reuses deepCloneItem directly
// (already-local data, a synchronous clone, exactly like an Alt-drag duplicate elsewhere in the
// app); 'collaborator'/'public' targets go through cloneRemoteFolder above instead, since
// deepCloneItem has no way to fetch anything.
async function copyTarget(target) {
    if (!target) return;
    saveSnapshot();
    let clonedFolderId;
    if (target.access === 'owner') {
        const clone = deepCloneItem({ kind: target.kind === 'source' ? 'source' : 'folder', folderId: target.folder_id });
        clonedFolderId = clone.folderId;
    } else {
        const result = await cloneRemoteFolder(target.owner_id, target.folder_id, target.access);
        if (!result) { pushNotification({ type: 'command_error', message: `Couldn't copy "${target.title}" — it may no longer be accessible.` }); return; }
        clonedFolderId = result.folderId;
    }
    const kind = target.kind === 'source' ? 'source' : 'folder';
    const { w, h } = CARD_KINDS[kind].defaultSize;
    const center = viewportCenterWorldPoint();
    appState.folders[appState.currentFolderId].items.push({
        id: appState.idCounter++,
        x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h,
        kind, folderId: clonedFolderId,
    });
    render();
    pushNotification({ type: 'command_success', message: `Copied "${target.title}".` });
}

export { copyTarget, inviteUser, obtainTarget, placeTarget, removeUser, setVisibility };
