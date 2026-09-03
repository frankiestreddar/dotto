import { generateGlobalId } from "./globalIds";
import { CARD_KINDS } from "./cardKinds";
import { resolveUsernameToUserId } from "./friendsPresence";
import type { CommandTarget } from "./commandTargetLookup";

interface Item {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  folderId?: string;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  isSharedView?: boolean;
  sharedOwnerId?: string;
  sharedRemoteFolderId?: string;
  collaborators?: string[];
  globalId?: string | null;
  [key: string]: unknown;
}
interface AppState {
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  idCounter: number;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// Executes the 'obtain' verb for an already-resolved command target (see
// app/dotto/lib/commandTargetLookup.ts's resolveCommandTarget) — navigates in for your own or
// shared-with-you items (exactly like clicking into them normally would), or opens a public item
// view-only with no lasting record (see openPublicCanvas's own comment on why).
export function obtainTarget(target: CommandTarget | null): void {
  if (!target) return;
  if (target.access === "owner") {
    window.__openFolder?.(target.folder_id);
    return;
  }
  if (target.access === "collaborator") {
    window.__openSharedCanvas!(target.owner_id, target.folder_id, target.title);
    return;
  }
  if (target.access === "public") {
    window.__openPublicCanvas!(target.owner_id, target.folder_id, target.title);
    return;
  }
}

// 'set public'/'set private' — checked against target.access here rather than just leaving it to
// the RPC's own auth.uid()-scoped WHERE clause, so running this against someone else's canvas
// fails with a clear message instead of a generic RPC error/silent no-op
// (set_global_item_visibility raises "not found" for a folder_id that doesn't belong to the
// caller, which would otherwise read as a confusing, unrelated failure).
export async function setVisibility(
  target: CommandTarget | null,
  visibility: string,
): Promise<void> {
  const supabase = window.__dottoSupabase || null;
  if (!target || !supabase) return;
  if (target.access !== "owner") {
    window.pushNotification?.({
      type: "command_error",
      message: `You can only change visibility on your own ${target.kind}.`,
    });
    return;
  }
  const { error } = await supabase.rpc("set_global_item_visibility", {
    p_folder_id: target.folder_id,
    p_visibility: visibility,
  });
  if (error) {
    console.error(
      `[commands] set_global_item_visibility failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`,
    );
    window.pushNotification?.({
      type: "command_error",
      message: `Couldn't set "${target.title}" to ${visibility}.`,
    });
    return;
  }
  window.pushNotification?.({
    type: "command_success",
    message: `"${target.title}" is now ${visibility}.`,
  });
}

// 'invite <username>' — same owner-only guard as setVisibility. Deliberately calls
// invite_canvas_collaborator directly rather than reusing sendCanvasCollabInvite
// (app/dotto/lib/friendsPresence.ts) — that wrapper hardcodes appState.currentFolderId and a
// UI-panel-specific pending-invite tracker, neither of which fits inviting on an arbitrary canvas
// by name/id from a command. resolveUsernameToUserId (app/dotto/lib/friendsPresence.ts)
// deliberately doesn't require the target to already be a friend, unlike the existing
// Collaborations-panel flow — that restriction lives entirely in that panel's own UI, not in the
// RPC itself.
export async function inviteUser(target: CommandTarget | null, username: string): Promise<void> {
  const supabase = window.__dottoSupabase || null;
  if (!target || !supabase) return;
  if (target.access !== "owner") {
    window.pushNotification?.({
      type: "command_error",
      message: `You can only invite people to your own ${target.kind}.`,
    });
    return;
  }
  const userId = await resolveUsernameToUserId(username);
  if (!userId) {
    window.pushNotification?.({
      type: "command_error",
      message: `No user found with username "${username}".`,
    });
    return;
  }
  const { error } = await supabase.rpc("invite_canvas_collaborator", {
    p_folder_id: target.folder_id,
    p_folder_title: target.title,
    p_collaborator_id: userId,
  });
  if (error) {
    console.error(
      `[commands] invite_canvas_collaborator failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`,
    );
    window.pushNotification?.({ type: "command_error", message: `Couldn't invite ${username}.` });
    return;
  }
  window.pushNotification?.({
    type: "command_success",
    message: `Invited ${username} to "${target.title}".`,
  });
}

// 'remove <username>' — removes an accepted collaborator, or cancels a still-pending invite to
// them (the same RPC already handles both — see revoke_canvas_collaboration's own comment,
// 20260727_add_nested_canvas_sharing.sql — this is the first real UI path that ever exercises the
// pending-invite case, which previously had no way to reach it at all).
export async function removeUser(target: CommandTarget | null, username: string): Promise<void> {
  const supabase = window.__dottoSupabase || null;
  if (!target || !supabase) return;
  if (target.access !== "owner") {
    window.pushNotification?.({
      type: "command_error",
      message: `You can only remove people from your own ${target.kind}.`,
    });
    return;
  }
  // Real bug in the original vanilla file, unavoidably fixed by this port: this call was missing
  // its window.__ prefix (every other bridge call in this file, including inviteUser's identical
  // call one function above, correctly used it) — a plain, undeclared `resolveUsernameToUserId`
  // identifier only ever threw a runtime ReferenceError the one time this code path actually ran.
  // TypeScript's compile-time name resolution made porting the bug byte-for-byte impossible (an
  // undeclared identifier is a compile error here, not just a latent runtime one), so this is
  // fixed as a direct, unavoidable consequence of the port rather than a deliberate behavior
  // change.
  const userId = await resolveUsernameToUserId(username);
  if (!userId) {
    window.pushNotification?.({
      type: "command_error",
      message: `No user found with username "${username}".`,
    });
    return;
  }
  const { error } = await supabase.rpc("revoke_canvas_collaboration", {
    p_folder_id: target.folder_id,
    p_collaborator_id: userId,
  });
  if (error) {
    console.error(
      `[commands] revoke_canvas_collaboration failed: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`,
    );
    window.pushNotification?.({ type: "command_error", message: `Couldn't remove ${username}.` });
    return;
  }
  window.pushNotification?.({
    type: "command_success",
    message: `Removed ${username} from "${target.title}".`,
  });
}

// 'place' — drops a read-only reference card (kind: 'reference', ReferenceCard.jsx) at the center
// of the current viewport, pointing at the resolved target by (owner_id, folder_id) rather than
// copying any content — see resolveReferenceFolderKey's own comment
// (app/dotto/lib/sharedAndPublicCanvasLoading.ts) for how that card finds/loads the live data
// every time it (re)mounts, refetched fresh rather than cached. Valid for a target you own, a
// target shared with you, or a public one — obtaining isn't required first, "place" is its own
// independent way to reach something. refTitle/refGlobalId are a display-only snapshot (the card
// re-derives the real content live; these two fields just avoid an extra round trip before the
// preview itself has loaded).
export function placeTarget(target: CommandTarget | null): void {
  const appState = getAppState();
  if (!target) return;
  window.__saveSnapshot!();
  const { w, h } = CARD_KINDS.reference.defaultSize;
  const center = window.__viewportCenterWorldPoint?.();
  if (!center) return;
  appState.folders[appState.currentFolderId].items.push({
    id: appState.idCounter++,
    x: Math.round(center.x - w / 2),
    y: Math.round(center.y - h / 2),
    w,
    h,
    kind: "reference",
    refOwnerId: target.owner_id,
    refFolderId: target.folder_id,
    refKind: target.kind,
    refTitle: target.title,
    refGlobalId: target.global_id || null,
  });
  window.__render?.();
}

// Recursively rebuilds a fetched remote folder — and everything nested inside it the caller can
// still reach — as brand-new local folders/items with fresh local AND global ids throughout. The
// remote-data counterpart to deepCloneItem (app/dotto/lib/srsConnectionsCore.ts), which does the
// identical thing for data already sitting in appState.folders; this exists because deepCloneItem
// only ever reads that local map, never fetches. get_shared_folder/get_public_folder are both
// gated per-folder (not per-tree — see their own migrations), so a nested folder/source the caller
// can no longer reach (revoked partway down a shared tree, or — for a public copy — simply not
// independently public itself, since visibility never cascades to nested items) is silently
// dropped from the copy rather than left as a broken reference. No recursion-depth cap here
// (unlike search_accessible_by_name's defensive one) — real trees are nowhere near deep enough for
// it to matter in practice; worth adding if that ever changes.
async function fetchRemoteFolderData(
  ownerId: string,
  folderId: string,
  accessKind: string,
): Promise<Record<string, unknown> | null> {
  const supabase = window.__dottoSupabase || null;
  if (!supabase) return null;
  const rpcName = accessKind === "public" ? "get_public_folder" : "get_shared_folder";
  const { data, error } = await supabase.rpc(rpcName, {
    p_owner_id: ownerId,
    p_folder_id: folderId,
  });
  if (error) {
    console.error(
      `[commands] ${rpcName} failed during copy: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`,
    );
    return null;
  }
  return (data as Record<string, unknown>) || null;
}
async function cloneRemoteFolder(
  ownerId: string,
  folderId: string,
  accessKind: string,
): Promise<{ folderId: string } | null> {
  const appState = getAppState();
  const data = await fetchRemoteFolderData(ownerId, folderId, accessKind);
  if (!data) return null;
  const newFid = "folder-" + appState.idCounter++;
  const newItems: Item[] = [];
  for (const item of (data.items as Item[]) || []) {
    if ((item.kind === "folder" || item.kind === "source") && item.folderId) {
      const clonedChild = await cloneRemoteFolder(ownerId, item.folderId, accessKind);
      if (!clonedChild) continue; // inaccessible nested item — dropped, see comment above
      newItems.push({
        ...JSON.parse(JSON.stringify(item)),
        id: appState.idCounter++,
        folderId: clonedChild.folderId,
      });
    } else {
      newItems.push({ ...JSON.parse(JSON.stringify(item)), id: appState.idCounter++ });
    }
  }
  // ...data may carry the ORIGINAL owner's own globalId (folders persist that field like any
  // other, see saveWorkspaceNow) — spread first, then override every field a real independent
  // copy needs its own fresh value for, same "duplicate starts fresh" reasoning deepCloneItem's
  // own comment already states for the local case.
  appState.folders[newFid] = {
    ...(data as unknown as FolderObj),
    id: newFid,
    items: newItems,
    collaborators: [],
    globalId: generateGlobalId(),
  };
  delete appState.folders[newFid].isSharedView;
  delete appState.folders[newFid].sharedOwnerId;
  delete appState.folders[newFid].sharedRemoteFolderId;
  return { folderId: newFid };
}

// 'copy' — creates a full independent duplicate, owned by the caller, placed at the viewport
// center with its own brand-new global id (a real fork, not a live reference — contrast with
// placeTarget above, which never copies content). The 'owner' case reuses deepCloneItem directly
// (already-local data, a synchronous clone, exactly like an Alt-drag duplicate elsewhere in the
// app); 'collaborator'/'public' targets go through cloneRemoteFolder above instead, since
// deepCloneItem has no way to fetch anything.
export async function copyTarget(target: CommandTarget | null): Promise<void> {
  const appState = getAppState();
  if (!target) return;
  window.__saveSnapshot!();
  let clonedFolderId: string;
  if (target.access === "owner") {
    const clone = window.__deepCloneItem?.({
      kind: target.kind === "source" ? "source" : "folder",
      folderId: target.folder_id,
    }) as { folderId: string } | undefined;
    if (!clone) return;
    clonedFolderId = clone.folderId;
  } else {
    const result = await cloneRemoteFolder(target.owner_id, target.folder_id, target.access);
    if (!result) {
      window.pushNotification?.({
        type: "command_error",
        message: `Couldn't copy "${target.title}" — it may no longer be accessible.`,
      });
      return;
    }
    clonedFolderId = result.folderId;
  }
  const kind = target.kind === "source" ? "source" : "folder";
  const { w, h } = CARD_KINDS[kind].defaultSize;
  const center = window.__viewportCenterWorldPoint?.();
  if (!center) return;
  appState.folders[appState.currentFolderId].items.push({
    id: appState.idCounter++,
    x: Math.round(center.x - w / 2),
    y: Math.round(center.y - h / 2),
    w,
    h,
    kind,
    folderId: clonedFolderId,
  });
  window.__render?.();
  window.pushNotification?.({ type: "command_success", message: `Copied "${target.title}".` });
}
