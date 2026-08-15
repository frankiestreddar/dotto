import { supabase } from './core-state.js';
import { resolveUsernameToUserId } from './friends-presence.js';
import { openFolder } from './waypoints-render-loop.js';
import { openPublicCanvas, openSharedCanvas } from './shared-canvases-outline.js';
import { pushNotification } from './stopwatch-search-notifications.js';

// Executes the 'obtain' verb for an already-resolved command target (see
// command-target-lookup.js's resolveCommandTarget) — navigates in for your own or shared-with-you
// items (exactly like clicking into them normally would), or opens a public item view-only with
// no lasting record (see openPublicCanvas's own comment on why). place/copy arrive in later PRs —
// see the slash-command feature's own PR sequencing; this file only grows one function per PR as
// each verb actually ships.
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

export { inviteUser, obtainTarget, removeUser, setVisibility };
