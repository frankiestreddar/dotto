// Phase 4.4 port of public/dotto/shared-and-public-canvas-loading.js (itself a Phase 4.3 split of
// shared-canvases-outline.js — see PHASE4_ROADMAP.md): fetching a live-shared or public canvas
// into this client's own `folders` map under a namespaced key, and the resume-state bookkeeping
// for leaving it again. Reaches every still-vanilla dependency through window bridges — most
// already existed (window.__closeRailView/__render/__applyTransform/__getAppState), 1 is new as
// part of this port (__centerOnContent, waypoints-render-loop.js).

interface Item {
  id: number;
  kind: string;
  folderId?: string;
  [key: string]: unknown;
}

interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  collaborators: unknown[];
  isSharedView?: boolean;
  sharedOwnerId?: string;
  sharedRemoteFolderId?: string;
  isPublicView?: boolean;
  publicOwnerId?: string;
  publicRemoteFolderId?: string;
  lastView?: { tx: number; ty: number; scale: number };
}

interface AppState {
  currentUser: { id: string | null };
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  historyStack: string[];
  historyIndex: number;
  sharedOwnerNameCache: Record<string, string>;
  preSharedViewState: {
    currentFolderId: string;
    historyStack: string[];
    historyIndex: number;
  } | null;
  tx: number;
  ty: number;
  scale: number;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

// ---------- Live-shared canvases (accepted canvas_collaborations — see the hamburger
// Collaborations panel) ----------
// A canvas someone else owns isn't part of this user's own folder tree at all — it's fetched on
// demand (get_shared_folder RPC) and dropped into the SAME `folders` map everything else already
// reads from, under a key namespaced by owner+remote id (folder ids are only unique within one
// user's own id sequence, so a bare folder id could collide with one of ours). That reuse is what
// lets render()/openFolder/the outline/etc. all work on it completely unmodified.
// saveWorkspaceNow strips shared: keys back out before persisting to this user's own workspace
// row, and instead patches just that one folder back via update_shared_folder when one is
// currently open — see that function.
//
// A folder/source nested inside a shared canvas is itself shared too (inherited access — see
// canvas_access_status in the 20260727 migration), so it needs to be reachable the exact same way
// as the top-level one: fetched on demand under its own shared:owner:id key. That's why every
// folder/source item's `folderId` gets rewritten to that namespaced form the moment its OWN
// containing folder is fetched (see injectSharedFolder) — so a later openFolder() on one of those
// items resolves to a shared: key too, and ensureSharedFolderLoaded fetches it lazily the first
// time it's actually navigated into, exactly like the entry point was.
export function sharedFolderKey(ownerId: string, folderId: string): string {
  return `shared:${ownerId}:${folderId}`;
}
export function parseSharedFolderKey(key: string): { ownerId: string; remoteFolderId: string } {
  const parts = key.split(":");
  return { ownerId: parts[1], remoteFolderId: parts.slice(2).join(":") };
}

// A 'folder'/'source' kind item's own .folderId points at whichever child folder IT opens —
// namespaceSharedFolderIds/stripSharedFolderIds are exact inverses of each other for rewriting
// those references across the shared/canonical boundary. The owner's real, canonical storage
// (workspaces.data->folders) ALWAYS uses bare, un-namespaced folder ids; the shared: prefix is a
// purely LOCAL, this-client-only device (see sharedFolderKey) so a collaborator's own `folders`
// dict doesn't collide with their own folder ids. Any data crossing that boundary in EITHER
// direction must be rewritten accordingly — get it wrong and a shared: value leaks into the
// owner's canonical data, which then gets wrapped AGAIN on the next fetch, compounding into a
// genuinely corrupt, permanently-broken folder id (confirmed live: "no accepted collaboration
// covers this canvas" on a folder id like "shared:OWNER:shared:OWNER:folder-42" — exactly this
// bug, from update_shared_folder previously saving the still-namespaced form straight back to the
// owner's own row). Strips however MANY layers of shared: wrapping happen to be present, not just
// one — some existing data already has 2+ layers baked in from before this fix existed, and this
// needs to fully self-heal that on the next read/write it goes through, not just avoid making it
// worse.
function fullyUnwrapFolderId(folderId: string | undefined): string | undefined {
  while (typeof folderId === "string" && folderId.startsWith("shared:")) {
    folderId = parseSharedFolderKey(folderId).remoteFolderId;
  }
  return folderId;
}
export function stripSharedFolderIds(items: Item[] | undefined): Item[] {
  return (items || []).map((it) =>
    it.kind === "folder" || it.kind === "source"
      ? { ...it, folderId: fullyUnwrapFolderId(it.folderId) }
      : it,
  );
}
// Always strips first, THEN wraps exactly once — makes this idempotent/self-healing no matter how
// many layers of historical corruption the input already carries (see the comment above).
export function namespaceSharedFolderIds(ownerId: string, items: Item[] | undefined): Item[] {
  return stripSharedFolderIds(items).map((it) =>
    it.kind === "folder" || it.kind === "source"
      ? { ...it, folderId: sharedFolderKey(ownerId, it.folderId as string) }
      : it,
  );
}
// Drops one fetched folder into `folders` under its namespaced key, rewriting its own child
// folder/source items' folderId references to the same namespaced form (see comment above). Also
// kicks off (fire-and-forget) fetching who else besides this user has access. Returns the local
// key it was stored under.
function injectSharedFolder(
  ownerId: string,
  remoteFolderId: string,
  data: { title?: string; items: Item[] },
): string {
  const appState = getAppState();
  const localKey = sharedFolderKey(ownerId, remoteFolderId);
  const items = namespaceSharedFolderIds(ownerId, data.items);
  if (appState) {
    appState.folders[localKey] = {
      ...data,
      items,
      id: localKey,
      title: data.title || remoteFolderId,
      collaborators: [],
      isSharedView: true,
      sharedOwnerId: ownerId,
      sharedRemoteFolderId: remoteFolderId,
    };
  }
  return localKey;
}
export async function ensureSharedFolderLoaded(localKey: string): Promise<boolean> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (appState?.folders[localKey]) return true;
  if (!supabase || !appState?.currentUser.id) return false;
  const { ownerId, remoteFolderId } = parseSharedFolderKey(localKey);
  const { data, error } = await supabase.rpc("get_shared_folder", {
    p_owner_id: ownerId,
    p_folder_id: remoteFolderId,
  });
  // A PostgrestError's own useful fields (message/code/details/hint) don't always show up when
  // the error object itself is logged directly (some log viewers just print "{}") — spelling them
  // out explicitly as a string here means the real reason is always visible regardless of how
  // this ends up being viewed.
  if (error || !data) {
    console.error(
      `[collab] failed to load shared folder (owner=${ownerId} folder=${remoteFolderId}):`,
      error
        ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`
        : "no data returned (folder not found?)",
    );
    return false;
  }
  injectSharedFolder(ownerId, remoteFolderId, data as { title?: string; items: Item[] });
  return true;
}
// `ownerName` is only known at the entry point (whoever linked you here already has it — e.g. the
// hamburger Collaborations list) — cached so the pill can show it for any nested folder fetched
// later within the same tree too, without a further profile lookup.
export async function openSharedCanvas(
  ownerId: string,
  folderId: string,
  title?: string,
  ownerName?: string,
): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState?.currentUser.id) return;
  if (ownerName) appState.sharedOwnerNameCache[ownerId] = ownerName;
  const { data, error } = await supabase.rpc("get_shared_folder", {
    p_owner_id: ownerId,
    p_folder_id: folderId,
  });
  if (error || !data) {
    console.error(
      `[collab] failed to open shared canvas (owner=${ownerId} folder=${folderId}):`,
      error
        ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`
        : "no data returned (folder not found?)",
    );
    return;
  }
  const localKey = injectSharedFolder(ownerId, folderId, data as { title?: string; items: Item[] });
  if (title) appState.folders[localKey].title = (data as { title?: string }).title || title;
  const isFreshEntry = !appState.preSharedViewState;
  if (isFreshEntry) {
    appState.preSharedViewState = {
      currentFolderId: appState.currentFolderId,
      historyStack: appState.historyStack.slice(),
      historyIndex: appState.historyIndex,
    };
  }
  appState.currentFolderId = localKey;
  appState.historyStack = [localKey];
  appState.historyIndex = 0;
  window.__closeRailView?.();
  window.__render?.();
  window.__centerOnContent?.();
  if (isFreshEntry) announceEnteredCollaboration(localKey);
}
// Replaces the old persistent "Collaborating with X" pill under the search bar — fires ONCE,
// right when a collaboration session actually starts (fresh entry only, never on every render
// while already in one — see callers), rather than a permanent fixture for as long as you're in
// it. Awaits a fresh get_effective_collaborators fetch itself (rather than reusing
// injectSharedFolder's own fire-and-forget one) so the "and N others" count is accurate the very
// first time this shows, not whatever was last known.
export async function announceEnteredCollaboration(localKey: string): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  const folderObj = appState?.folders[localKey];
  if (!folderObj) return;
  const ownerName = appState?.sharedOwnerNameCache[folderObj.sharedOwnerId as string] || "someone";
  let othersCount = 0;
  if (supabase && appState?.currentUser.id) {
    const { data: rows, error } = await supabase.rpc("get_effective_collaborators", {
      p_owner_id: folderObj.sharedOwnerId,
      p_folder_id: folderObj.sharedRemoteFolderId,
    });
    if (!error) {
      othersCount = ((rows as { collaborator_id: string }[]) || []).filter(
        (r) => r.collaborator_id !== appState.currentUser.id,
      ).length;
    }
  }
  if (!getAppState()?.folders[localKey]) return; // navigated away again before this resolved
  window.pushNotification?.({
    type: "entered_collaboration",
    message: `Collaborating on "${folderObj.title}" with ${ownerName}${othersCount > 0 ? ` and ${othersCount} ${othersCount === 1 ? "other" : "others"}` : ""}.`,
  });
}

// ---------- Publicly-shared canvases (see set_global_item_visibility/global_items,
// 20260812_add_global_items.sql, and resolve_global_id/get_public_folder,
// 20260813_add_global_id_resolution.sql) ----------
// A second, deliberately much narrower sharing mode alongside the collaboration system above: an
// owner can mark a specific canvas/source public, after which ANYONE can view it read-only by its
// exact global id — never by name, and never inherited by nested items automatically. Each nested
// folder/source has its own independent visibility flag; get_public_folder's own gate is per-
// (owner,folder), so navigating into a nested item here only works if THAT item was separately
// marked public too — no cascading, unlike canvas_access_status's inheritance for the private-
// collaboration case above. Same local-namespaced-key reuse trick as the shared: convention,
// under its own public: prefix — and, critically, NEVER written back anywhere: saveWorkspaceNow's
// own filter excludes public: keys the same way it already excludes shared: ones
// (app/dotto/lib/historyAutosave.ts), and there is no update_public_folder RPC at all. Leaving and coming back
// forgets it completely — nothing about a public view is ever persisted, locally or remotely,
// matching "obtain" on a public item being a one-off, no-lasting-record read (see the
// slash-command plan's own "obtain" semantics).
export function publicFolderKey(ownerId: string, folderId: string): string {
  return `public:${ownerId}:${folderId}`;
}
export function parsePublicFolderKey(key: string): { ownerId: string; remoteFolderId: string } {
  const parts = key.split(":");
  return { ownerId: parts[1], remoteFolderId: parts.slice(2).join(":") };
}
// No stripPublicFolderIds/fullyUnwrapPublicFolderId counterpart to the shared: versions above —
// those exist only because a shared folder's edits get written BACK to the owner's canonical
// (bare-id) storage via update_shared_folder, which needs the unwrap. A public: id never gets
// written anywhere, so it never needs unwrapping either.
export function namespacePublicFolderIds(ownerId: string, items: Item[] | undefined): Item[] {
  return (items || []).map((it) =>
    it.kind === "folder" || it.kind === "source"
      ? { ...it, folderId: publicFolderKey(ownerId, it.folderId as string) }
      : it,
  );
}
function injectPublicFolder(
  ownerId: string,
  remoteFolderId: string,
  data: { title?: string; items: Item[] },
): string {
  const appState = getAppState();
  const localKey = publicFolderKey(ownerId, remoteFolderId);
  const items = namespacePublicFolderIds(ownerId, data.items);
  if (appState) {
    appState.folders[localKey] = {
      ...data,
      items,
      id: localKey,
      title: data.title || remoteFolderId,
      collaborators: [],
      isPublicView: true,
      publicOwnerId: ownerId,
      publicRemoteFolderId: remoteFolderId,
    };
  }
  return localKey;
}
export async function ensurePublicFolderLoaded(localKey: string): Promise<boolean> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (appState?.folders[localKey]) return true;
  if (!supabase || !appState?.currentUser.id) return false;
  const { ownerId, remoteFolderId } = parsePublicFolderKey(localKey);
  const { data, error } = await supabase.rpc("get_public_folder", {
    p_owner_id: ownerId,
    p_folder_id: remoteFolderId,
  });
  if (error || !data) {
    console.error(
      `[public] failed to load public folder (owner=${ownerId} folder=${remoteFolderId}):`,
      error
        ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`
        : "no data returned (not public, or deleted?)",
    );
    return false;
  }
  injectPublicFolder(ownerId, remoteFolderId, data as { title?: string; items: Item[] });
  return true;
}
// Entry point for the future "/source|canvas <id>" obtain command on a public item that isn't the
// caller's own and isn't shared with them (see command-verbs.js, not built yet — this PR is
// plumbing only, nothing calls this yet). Unlike openSharedCanvas, never announces a collaboration
// (this isn't one) — reuses preSharedViewState purely as "where to resume when backing out of
// someone else's read-only content," the same resume slot a shared view uses, since the two cases
// need identical resume behavior and there's no reason to duplicate it.
export async function openPublicCanvas(
  ownerId: string,
  folderId: string,
  title?: string,
): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState?.currentUser.id) return;
  const { data, error } = await supabase.rpc("get_public_folder", {
    p_owner_id: ownerId,
    p_folder_id: folderId,
  });
  if (error || !data) {
    console.error(
      `[public] failed to open public canvas (owner=${ownerId} folder=${folderId}):`,
      error
        ? `message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`
        : "no data returned (not public, or deleted?)",
    );
    return;
  }
  const localKey = injectPublicFolder(ownerId, folderId, data as { title?: string; items: Item[] });
  if (title) appState.folders[localKey].title = (data as { title?: string }).title || title;
  const isFreshEntry = !appState.preSharedViewState;
  if (isFreshEntry) {
    appState.preSharedViewState = {
      currentFolderId: appState.currentFolderId,
      historyStack: appState.historyStack.slice(),
      historyIndex: appState.historyIndex,
    };
  }
  appState.currentFolderId = localKey;
  appState.historyStack = [localKey];
  appState.historyIndex = 0;
  window.__closeRailView?.();
  window.__render?.();
  window.__centerOnContent?.();
}

// Resolves whichever LOCAL key currently represents (ownerId, folderId) for THIS viewer — their
// own bare folder id, the shared: namespaced key (if they have collaboration access), or the
// public: namespaced key (if it's public and they don't otherwise have access) — used by
// ReferenceCard.jsx (the 'place' command's read-only reference card, command-verbs.js) to find/
// load whatever it should preview. Deliberately re-checked fresh every time, never cached: a
// reference card needs to reflect an access change (revoked, or flipped back to private after
// being placed) the next time it loads, not whatever was true when it was first placed — see the
// feature plan's own trade-offs note on exactly this. Returns null if none of the three currently
// apply.
export async function resolveReferenceFolderKey(
  ownerId: string,
  folderId: string,
): Promise<string | null> {
  const appState = getAppState();
  if (ownerId === appState?.currentUser.id) return appState.folders[folderId] ? folderId : null;
  const sKey = sharedFolderKey(ownerId, folderId);
  if (await ensureSharedFolderLoaded(sKey)) return sKey;
  const pKey = publicFolderKey(ownerId, folderId);
  if (await ensurePublicFolderLoaded(pKey)) return pKey;
  return null;
}

// Leaves the WHOLE shared tree (not just its top level) and lands on the user's own ACTUAL root —
// not wherever they happened to be right before entering (that distinction used to matter when
// this was reachable via the breadcrumb "..", but the breadcrumb map's "Root" row (see
// renderBreadcrumbMapPanel, app/dotto/lib/tabManagement.ts) is specifically meant as an
// unconditional "take me home" affordance, always available regardless of how deep into someone
// else's canvas you are).
export function exitSharedCanvasToRoot(): void {
  const appState = getAppState();
  if (!appState?.preSharedViewState) return;
  // public: entries (openPublicCanvas above) reuse this same preSharedViewState resume slot and
  // need the identical cleanup — they're never persisted anywhere, so simply dropping them from
  // memory here is the whole story, no server-side "leave" call needed.
  for (const id in appState.folders) {
    if (id.startsWith("shared:") || id.startsWith("public:")) delete appState.folders[id];
  }
  appState.preSharedViewState = null;
  appState.currentFolderId = "root";
  appState.historyStack = ["root"];
  appState.historyIndex = 0;
  window.__render?.();
  const rootFolder = appState.folders["root"];
  if (rootFolder?.lastView) {
    const lv = rootFolder.lastView;
    appState.tx = lv.tx;
    appState.ty = lv.ty;
    appState.scale = lv.scale;
    window.__applyTransform?.();
  } else {
    window.__centerOnContent?.();
  }
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__openSharedCanvas = openSharedCanvas;
  window.__resolveReferenceFolderKey = resolveReferenceFolderKey;
  window.__exitSharedCanvasToRoot = exitSharedCanvasToRoot;
  // The rest of these are new as of this port — every one of these 7 callers (app-init.js,
  // command-verbs.js, hamburger-collab.js, history-autosave.js, waypoints-render-loop.js — all still
  // vanilla — plus app/dotto/lib/canvasPresence.ts, ported since) previously imported the function
  // directly; public/dotto/*.js can't import from app/dotto/, so each still-vanilla one switched to
  // calling the matching bridge instead.
  window.__announceEnteredCollaboration = announceEnteredCollaboration;
  window.__openPublicCanvas = openPublicCanvas;
  window.__ensureSharedFolderLoaded = ensureSharedFolderLoaded;
  window.__sharedFolderKey = sharedFolderKey;
  window.__stripSharedFolderIds = stripSharedFolderIds;
  window.__namespaceSharedFolderIds = namespaceSharedFolderIds;
  window.__parseSharedFolderKey = parseSharedFolderKey;
}
