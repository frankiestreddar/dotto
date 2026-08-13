import { openFolder } from './waypoints-render-loop.js';
import { openPublicCanvas, openSharedCanvas } from './shared-canvases-outline.js';

// Executes the 'obtain' verb for an already-resolved command target (see
// command-target-lookup.js's resolveCommandTarget) — navigates in for your own or shared-with-you
// items (exactly like clicking into them normally would), or opens a public item view-only with
// no lasting record (see openPublicCanvas's own comment on why). Other verbs (set public/private,
// invite, remove, place, copy) arrive in later PRs — see the slash-command feature's own PR
// sequencing; this file only grows one function per PR as each verb actually ships.
function obtainTarget(target) {
    if (!target) return;
    if (target.access === 'owner') { openFolder(target.folder_id); return; }
    if (target.access === 'collaborator') { openSharedCanvas(target.owner_id, target.folder_id, target.title); return; }
    if (target.access === 'public') { openPublicCanvas(target.owner_id, target.folder_id, target.title); return; }
}

export { obtainTarget };
