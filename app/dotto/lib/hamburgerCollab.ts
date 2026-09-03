// Phase 4.5 port of public/dotto/hamburger-collab.js: the hamburger menu's Collaborations panel
// (canvas-sharing requests/invites), the Chats/Waypoints/Sources/Files list panels' data-fetching
// and row actions, shared list-panel selection + Backspace-delete dispatch, and hmenuAction
// (upgrade/logout).
//
// Genuinely circular with app/dotto/lib/aiAssistantSuggestions.ts (openSearchOverlay/
// scrollChatThreadToBottom/showAiChatView/updateChatThread) — see that file's own header comment
// for why this is safe. Also imports from app/dotto/lib/mnemonicSearchMatching.ts
// (flashCanvasElement, one-way — that file needs nothing back from here) and reaches
// app/dotto/lib/friendsPresence.ts via the __activePaneCollabBubbleEl bridge (new in the Phase 4.5
// friends-presence port — openCollabPanel/renderCollabPill were already bridged).

import { flushSync } from "react-dom";
import {
  openSearchOverlay,
  scrollChatThreadToBottom,
  showAiChatView,
  updateChatThread,
} from "./aiAssistantSuggestions";
import { flashCanvasElement } from "./mnemonicSearchMatching";
import { useChatThreadStore } from "./chatThreadStore";

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
  isSharedView?: boolean;
}

interface IncomingCanvasRequest {
  id: string;
  folderId: string;
  folderTitle: string;
  ownerId: string;
  ownerName: string;
  ownerAvatarId: number;
  ownerAvatarUrl: string | null;
  status: string;
}
interface OwnedCanvasCollab {
  folderId: string;
  folderTitle: string;
  collaborators: {
    id: string;
    username: string;
    displayName: string;
    avatarId: number;
    avatarUrl: string | null;
  }[];
}

interface AppState {
  currentUser: { id: string | null };
  currentFolderId: string;
  folders: Record<string, FolderObj>;
  incomingCanvasRequests: IncomingCanvasRequest[];
  acceptedCanvasCollaborations: IncomingCanvasRequest[];
  ownedCanvasCollaborations: OwnedCanvasCollab[];
  seenIncomingCanvasRequestIds: Set<string> | null;
  hubCollabView: string;
  hubCollabSearchInput: HTMLInputElement | null;
  waypointsSearchInput: HTMLInputElement | null;
  lastWaypointsRows: WaypointRow[];
  listPanelSelection: { panel: string | null; ids: Set<string> };
  tx: number;
  ty: number;
  scale: number;
  collabBubble: HTMLElement;
  preSharedViewState: {
    currentFolderId: string;
    historyStack: string[];
    historyIndex: number;
  } | null;
  historyStack: string[];
  historyIndex: number;
  currentConversationId: string | null;
  idCounter: number;
}

interface WaypointRow {
  owner_id: string;
  folder_id: string;
  item_id: number;
  name?: string;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

function getSupabase() {
  return window.__dottoSupabase;
}

// ---------- Hamburger "Collaborations" panel ----------
// Two views sharing #hub-collab-list: the main list (a "Requests" row with a pending-count badge,
// then every canvas someone has shared with this user — click to enter via openSharedCanvas) and
// the Requests view (every pending invite, Accept/Decline each) — swapped via hubCollabView
// rather than a separate hub-subpanel, since it's a drill-down within Collaborations, not a
// distinct top-level hamburger menu item.
//
// Same baseline-then-diff pattern as seenIncomingFriendRequestIds — null until the first refresh
// (baseline, no notifications), every run after that notifies for any request id that wasn't in
// the set yet.
async function refreshCanvasCollabData(): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) {
    appState.incomingCanvasRequests = [];
    appState.acceptedCanvasCollaborations = [];
    appState.ownedCanvasCollaborations = [];
    return;
  }
  const [sharedWithMeRes, ownedRes] = await Promise.all([
    supabase
      .from("canvas_collaborations")
      .select(
        "id, folder_id, folder_title, status, owner:profiles!canvas_collaborations_owner_id_fkey(id, username, display_name, avatar_id, avatar_url)",
      )
      .eq("collaborator_id", appState.currentUser.id)
      .in("status", ["pending", "accepted"]),
    supabase
      .from("canvas_collaborations")
      .select(
        "folder_id, folder_title, collaborator:profiles!canvas_collaborations_collaborator_id_fkey(id, username, display_name, avatar_id, avatar_url)",
      )
      .eq("owner_id", appState.currentUser.id)
      .eq("status", "accepted"),
  ]);
  // message/code/details/hint spelled out explicitly (same convention as command-verbs.js,
  // app/dotto/lib/sharedAndPublicCanvasLoading.ts, etc.) rather than logging the PostgrestError
  // object directly — its actual fields aren't enumerable in a way every console/error-overlay
  // serializer picks up, so a raw `console.error(..., error)` can print as an unhelpful {}.
  if (sharedWithMeRes.error) {
    const error = sharedWithMeRes.error;
    console.error(
      `[collab] failed to load canvas collaborations: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`,
    );
  }
  if (ownedRes.error) {
    const error = ownedRes.error;
    console.error(
      `[collab] failed to load owned canvas collaborations: message=${error.message} code=${error.code} details=${error.details} hint=${error.hint}`,
    );
  }

  interface SharedWithMeRow {
    id: string;
    folder_id: string;
    folder_title: string;
    status: string;
    owner: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_id: number | null;
      avatar_url: string | null;
    };
  }
  const rows = ((sharedWithMeRes.data as unknown as SharedWithMeRow[]) || []).map((r) => ({
    id: r.id,
    folderId: r.folder_id,
    folderTitle: r.folder_title,
    ownerId: r.owner.id,
    ownerName: r.owner.display_name || r.owner.username,
    ownerAvatarId: r.owner.avatar_id ?? 0,
    ownerAvatarUrl: r.owner.avatar_url || null,
    status: r.status,
  }));
  appState.incomingCanvasRequests = rows.filter((r) => r.status === "pending");
  appState.acceptedCanvasCollaborations = rows.filter((r) => r.status === "accepted");
  if (appState.seenIncomingCanvasRequestIds === null) {
    appState.seenIncomingCanvasRequestIds = new Set(
      appState.incomingCanvasRequests.map((r) => r.id),
    );
  } else {
    appState.incomingCanvasRequests.forEach((r) => {
      if (appState.seenIncomingCanvasRequestIds!.has(r.id)) return;
      appState.seenIncomingCanvasRequestIds!.add(r.id);
      window.pushNotification?.({
        type: "collab_request",
        message: `${r.ownerName} invited you to collaborate on "${r.folderTitle}"`,
        actionLabel: "Accept",
        onAction: () => respondToCanvasCollabRequest(r.id, true),
        // No dismiss button — Escape hides it without accepting, request stays pending (see
        // Requests in the Collaborations hub panel).
        sticky: true,
      });
    });
  }

  interface OwnedRow {
    folder_id: string;
    folder_title: string;
    collaborator: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_id: number | null;
      avatar_url: string | null;
    };
  }
  const byFolder = new Map<string, OwnedCanvasCollab>();
  ((ownedRes.data as unknown as OwnedRow[]) || []).forEach((r) => {
    if (!byFolder.has(r.folder_id)) {
      byFolder.set(r.folder_id, {
        folderId: r.folder_id,
        folderTitle: r.folder_title,
        collaborators: [],
      });
    }
    byFolder.get(r.folder_id)!.collaborators.push({
      id: r.collaborator.id,
      username: r.collaborator.username,
      displayName: r.collaborator.display_name || r.collaborator.username,
      avatarId: r.collaborator.avatar_id ?? 0,
      avatarUrl: r.collaborator.avatar_url || null,
    });
  });
  appState.ownedCanvasCollaborations = Array.from(byFolder.values());
}
async function respondToCanvasCollabRequest(id: string, accept: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc("respond_to_canvas_collaboration", {
    p_id: id,
    p_accept: accept,
  });
  if (error) console.error("[collab] failed to respond to canvas collaboration request:", error);
}
// Both directions in one flat list (own canvases with collaborators, and canvases others shared
// with this user) — no subheading distinguishing them; the row content itself (avatars vs. an
// Open button) makes which is which obvious.
export async function renderHubCollabList(query?: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  await refreshCanvasCollabData();
  if (appState.hubCollabView === "requests") {
    renderHubCollabRequests();
    return;
  }
  const q = (query || "").trim().toLowerCase();
  // Own canvases that have since been deleted shouldn't show here even if their
  // canvas_collaborations rows are somehow still lingering — folders[] is this user's own
  // COMPLETE tree, loaded in full up front, so absence here reliably means "no longer exists," no
  // extra round trip needed. Opportunistically retries the cleanup for any match found, since
  // we're the owner and can actually fix it from here.
  const ownedCandidates = appState.ownedCanvasCollaborations.filter(
    (c) => !q || c.folderTitle.toLowerCase().includes(q),
  );
  const ownedShown = ownedCandidates
    .filter((c) => {
      if (appState.folders[c.folderId]) return true;
      window.__deleteCanvasCollabsForFolder?.(c.folderId);
      return false;
    })
    .map((c) => ({
      ...c,
      liveTitle:
        (appState.folders[c.folderId] && appState.folders[c.folderId].title) || c.folderTitle,
    }));
  // Canvases shared WITH this user aren't necessarily loaded locally yet, so existence has to be
  // verified server-side: get_shared_folder returns null data (with no error) once access is
  // confirmed but the folder itself is gone.
  const sharedCandidates = appState.acceptedCanvasCollaborations.filter(
    (c) => !q || c.folderTitle.toLowerCase().includes(q),
  );
  const sharedStillExists = await Promise.all(
    sharedCandidates.map(async (c) => {
      if (appState.folders[window.__sharedFolderKey!(c.ownerId, c.folderId)]) return true; // already loaded locally this session
      const { data, error } = await supabase!.rpc("get_shared_folder", {
        p_owner_id: c.ownerId,
        p_folder_id: c.folderId,
      });
      return !error && data != null;
    }),
  );
  const sharedShown = sharedCandidates
    .filter((_c, i) => sharedStillExists[i])
    .map((c) => {
      const sharedKey = window.__sharedFolderKey!(c.ownerId, c.folderId);
      return {
        ...c,
        liveTitle:
          (appState.folders[sharedKey] && appState.folders[sharedKey].title) || c.folderTitle,
      };
    });
  window.__setHubCollabList?.({
    view: "main",
    requestsCount: appState.incomingCanvasRequests.length,
    ownedShown,
    sharedShown,
    query: q,
  });
}
function renderHubCollabRequests(): void {
  const appState = getAppState();
  window.__setHubCollabList?.({ view: "requests", requests: appState.incomingCanvasRequests });
}
// Wired up from HubCollabListPanel.jsx's JSX handlers — see that file for the row shapes these
// feed.
export function openHubCollabRequestsView(): void {
  const appState = getAppState();
  appState.hubCollabView = "requests";
  renderHubCollabRequests();
}
export function backToHubCollabMain(): void {
  const appState = getAppState();
  appState.hubCollabView = "main";
  renderHubCollabList(appState.hubCollabSearchInput ? appState.hubCollabSearchInput.value : "");
}
// Own canvas row click: navigates there AND opens its collaborator panel, since managing it is
// the obvious next step from here.
export function handleOwnedHubCollabRowClick(folderId: string): void {
  const appState = getAppState();
  window.__openFolder?.(folderId); // our own canvas — plain local navigation, no fetch needed
  // Retargets appState.collabBubble to the (now-active) pane's own bubble element first —
  // split-screen Stage 8, every pane has its own now, so there's no single static bubble to
  // assume any more.
  const bubbleEl = window.__activePaneCollabBubbleEl?.();
  if (bubbleEl) appState.collabBubble = bubbleEl;
  window.__renderCollabPill?.(); // sets the bubble's .show class synchronously so the line below doesn't no-op
  window.__openCollabPanel?.(true);
}
export async function respondToHubCollabRequest(id: string, accept: boolean): Promise<void> {
  await respondToCanvasCollabRequest(id, accept);
  await refreshCanvasCollabData();
  renderHubCollabRequests();
}
// Sorts nearest-first to where the user is actually looking right now — but only within the
// CURRENTLY OPEN folder: a waypoint on some other canvas has no comparable "distance" at all,
// since world coordinates are local to each folder's own canvas, not a single shared space. Those
// simply keep whatever order they were already in (most-recently-updated-first) and sort after
// every same-folder waypoint — Infinity for their "distance" plus Array#sort's guaranteed
// stability (ES2019+) is what achieves that for free.
function sortWaypointRowsByProximity(rows: WaypointRow[]): void {
  const appState = getAppState();
  const worldCenterX = (window.__canvasViewportCenterX!() - appState.tx) / appState.scale;
  const worldCenterY = (window.innerHeight / 2 - appState.ty) / appState.scale;
  const distanceOf = (r: WaypointRow) => {
    if (r.folder_id !== appState.currentFolderId) return Infinity;
    const it = window.__findItemById?.(r.item_id) as Item | undefined;
    if (!it) return Infinity;
    return Math.hypot((it.x as number) - worldCenterX, (it.y as number) - worldCenterY);
  };
  rows.sort((a, b) => distanceOf(a) - distanceOf(b));
}
// Queries the global `waypoints` table rather than scanning locally-loaded `folders` — a friend's
// canvas 300 layers deep isn't loaded client-side until you actually navigate into it, but a
// waypoint you dropped there still needs to show up and be jumpable-to from here, platform-wide.
export async function renderWaypointsList(query?: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  const q = (query || "").trim().toLowerCase();
  if (!supabase || !appState.currentUser.id) {
    window.__setWaypointsList?.({ rows: [], query: q });
    return;
  }
  const { data, error } = await supabase
    .from("waypoints")
    .select("owner_id, folder_id, item_id, name")
    .eq("creator_id", appState.currentUser.id)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[waypoints] failed to load waypoints:", error);
    window.__setWaypointsList?.({ rows: [], query: q });
    return;
  }
  const rows = ((data as WaypointRow[]) || []).filter(
    (r) => !q || (r.name || "New Waypoint").toLowerCase().includes(q),
  );
  sortWaypointRowsByProximity(rows);
  // Cached so deleteSelectedWaypointRows can look a selected row back up by its composite key,
  // and now also so the 1-9/0 keyboard shortcuts (srsConnectionsCore.ts's keydown handler) can
  // jump straight to row N by index, matching whatever this same sorted-and-filtered order the
  // panel is actually showing.
  appState.lastWaypointsRows = rows;
  window.__setWaypointsList?.({ rows, query: q });
}
// Matches WaypointsListPanel.jsx's own `key={...}` computation exactly — reused here as the
// shift-click selection id for waypoint rows.
function waypointRowKey(r: WaypointRow): string {
  return `${r.owner_id}-${r.folder_id}-${r.item_id}`;
}
// Sources rail panel — every kind:'source' linking item on the CURRENT canvas specifically, not
// every source anywhere in the whole workspace. Entirely local/synchronous, unlike
// renderWaypointsList/renderChatsList/renderHubCollabList above.
// query is optional — render()'s own call omits it, falling back to whatever's currently typed
// into the live search input (if the panel isn't even open/mounted yet, that lookup just comes
// back empty, same as an untouched box) so a render()-driven refresh doesn't clobber the user's
// in-progress search; the oninput handler (handleSourcesSearch, panelsHamburger.ts) always passes
// the freshly-typed value directly instead.
export function renderSourcesList(query?: string): void {
  const appState = getAppState();
  const input = document.getElementById("sources-panel-search") as HTMLInputElement | null;
  const q = (query !== undefined ? query : input ? input.value : "").trim().toLowerCase();
  const folderObj = appState.folders[appState.currentFolderId];
  const onCanvasIds = new Set(
    (folderObj ? folderObj.items : [])
      .filter((it) => it.kind === "source")
      .map((it) => it.folderId),
  );
  const rows = Object.values(appState.folders)
    .filter((f) => (f as unknown as { isSource?: boolean }).isSource)
    .map((f) => ({
      id: f.id,
      folderId: f.id,
      title: f.title || "New Source",
      globalId: window.__folderGlobalId?.(f.id),
      onCanvas: onCanvasIds.has(f.id),
      active: f.id === appState.currentFolderId,
    }))
    .filter((r) => !q || r.title.toLowerCase().includes(q))
    .sort((a, b) => (b.onCanvas === a.onCanvas ? 0 : b.onCanvas ? 1 : -1));
  window.__setSourcesList?.({ rows, query: q });
}
// Files panel — every uploaded file across the user's ENTIRE account, not just the current
// canvas: every kind:'media' item with a real mediaSrc, found by walking every folder's own
// items[]. Deduplicated to ONE row per uploaded file: it.mediaFileId (a real crypto.randomUUID())
// is the dedupe key; a legacy item from before this field existed falls back to its own mediaSrc.
export function renderFilesList(query?: string): void {
  const appState = getAppState();
  const input = document.getElementById("files-panel-search") as HTMLInputElement | null;
  const q = (query !== undefined ? query : input ? input.value : "").trim().toLowerCase();
  const mediaTypeLabel: Record<string, string> = { video: "Video", pdf: "PDF", epub: "EPUB" };
  const byFileKey = new Map<
    string,
    {
      id: number;
      folderId: string;
      itemId: number;
      title: string;
      onCanvas: boolean;
      mediaSrc: string;
    }
  >();
  Object.values(appState.folders).forEach((f) => {
    (f.items || []).forEach((it) => {
      if (it.kind !== "media" || !it.mediaSrc) return;
      const fileKey = (it.mediaFileId as string) || (it.mediaSrc as string);
      const onCanvas = f.id === appState.currentFolderId;
      const existing = byFileKey.get(fileKey);
      // First instance found wins by default; a later one only replaces it if THIS one is on the
      // current canvas and the kept one wasn't — so the row always navigates somewhere actually
      // visible right now when that's an option.
      if (existing && !(onCanvas && !existing.onCanvas)) return;
      byFileKey.set(fileKey, {
        id: it.id,
        folderId: f.id,
        itemId: it.id,
        title: (it.mediaName as string) || mediaTypeLabel[it.mediaType as string] || "Image",
        onCanvas,
        mediaSrc: it.mediaSrc as string,
      });
    });
  });
  const filtered = Array.from(byFileKey.values())
    .filter((r) => !q || r.title.toLowerCase().includes(q))
    .sort((a, b) => (b.onCanvas === a.onCanvas ? 0 : b.onCanvas ? 1 : -1));
  window.__setFilesList?.({ rows: filtered, query: q });
}
// Hamburger menu's Chats panel — every saved Dotbot conversation belonging to this user, most
// recently updated first. Returns the fetched rows (in addition to pushing them into
// chatsListStore) — handleSearchFocus (aiAssistantSuggestions.ts) reuses this same fetch for the
// compact "recent chats" preview shown in the AI panel's dropdown before you start typing, rather
// than duplicating the query.
export async function renderChatsList(): Promise<
  { id: string; title: string; updated_at: string }[]
> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) {
    window.__setChatsList?.([]);
    return [];
  }
  const { data, error } = await supabase
    .from("dotbot_conversations")
    .select("id, title, updated_at")
    .eq("owner_id", appState.currentUser.id)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[chats] failed to load conversations:", error);
    window.__setChatsList?.([]);
    return [];
  }
  window.__setChatsList?.(data || []);
  return data || [];
}
// Pans to and briefly expands (read-only "peek") a waypoint card already present in the
// CURRENTLY open folder's DOM — shared by both branches of goToWaypointCard below.
function peekWaypointCard(_folderId: string, it: Item): void {
  const el = window.__findItemEl?.(it.id);
  const w = el ? el.offsetWidth : (it.w as number) || 28;
  const h = el ? el.offsetHeight : (it.h as number) || 28;
  window.__smoothPanTo?.(
    window.__canvasViewportCenterX!() - ((it.x as number) + w / 2),
    window.innerHeight / 2 - ((it.y as number) + h / 2),
    1,
  );
  if (el) window.__expandWaypointCard?.(el, it as Record<string, unknown>, { editable: false });
  flashCanvasElement(el);
}
// Navigates to a waypoint card, possibly on a completely different user's canvas and arbitrarily
// deep inside it. Own-canvas waypoints are already fully loaded locally, so that's just a normal
// openFolder; a friend's waypoint needs its whole access path fetched and injected level by level
// first so that once there, findParentFolderId/the breadcrumb "up" navigation work exactly like a
// hand-drilled visit.
// Walks the ancestor chain from the top of ownerId's shared tree down to folderId and loads every
// level along the way, same as clicking down into each one by hand would — used both for a
// waypoint landing deep inside someone else's canvas and for resuming a shared session after a
// page reload. Returns the array of local (shared:owner:id) keys in root-to-target order, or null
// if any level failed to resolve/load.
export async function resolveSharedFolderChain(
  ownerId: string,
  folderId: string,
): Promise<string[] | null> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) return null;
  const { data: chain, error } = await supabase.rpc("get_folder_ancestor_chain", {
    p_owner_id: ownerId,
    p_folder_id: folderId,
  });
  if (error || !chain || !chain.length) {
    console.error("[collab] failed to resolve shared folder path:", error);
    return null;
  }
  const localKeys: string[] = [];
  for (const fid of chain) {
    const key = window.__sharedFolderKey!(ownerId, fid);
    if (!(await window.__ensureSharedFolderLoaded!(key))) return null;
    localKeys.push(key);
  }
  return localKeys;
}
export async function goToWaypointCard(
  ownerId: string,
  folderId: string,
  itemId: number,
): Promise<void> {
  const appState = getAppState();
  window.__closeRailView?.();
  if (ownerId === appState.currentUser.id) {
    if (appState.currentFolderId !== folderId) window.__openFolder?.(folderId);
    const it =
      appState.folders[folderId] &&
      appState.folders[folderId].items.find((i) => String(i.id) === String(itemId));
    if (it) peekWaypointCard(folderId, it);
    return;
  }
  const isFreshEntry = !appState.preSharedViewState;
  if (isFreshEntry) {
    appState.preSharedViewState = {
      currentFolderId: appState.currentFolderId,
      historyStack: appState.historyStack.slice(),
      historyIndex: appState.historyIndex,
    };
  }
  const localKeys = await resolveSharedFolderChain(ownerId, folderId);
  if (!localKeys) {
    if (isFreshEntry) appState.preSharedViewState = null;
    return;
  }
  appState.currentFolderId = localKeys[localKeys.length - 1];
  appState.historyStack = localKeys;
  appState.historyIndex = localKeys.length - 1;
  window.__render?.();
  if (isFreshEntry) window.__announceEnteredCollaboration?.(localKeys[0]);
  const it =
    appState.folders[appState.currentFolderId] &&
    appState.folders[appState.currentFolderId].items.find((i) => String(i.id) === String(itemId));
  if (it) peekWaypointCard(appState.currentFolderId, it);
}
// Reopens a saved conversation (clicked from the AI panel's own chat-list rows) — fully restoring
// its history — no live AI call, just the read path (dotbot_messages, RLS-scoped) replayed into
// the same turn-rendering ChatThread.jsx uses for live results. openSearchOverlay alone (no
// separate closeRailView first) is enough — opening the AI view already closes/hides whatever
// else might be open, and since it's already the active view here (that's how the chat list
// itself is visible), calling closeRailView first would trigger resetAiSearchState and reset
// currentConversationId/chatThreadStore right before this function sets them again — harmless in
// the end (this function's own assignments below run after and win), but pointless churn to
// avoid. openSearchOverlay lands on the list view by default, so this calls showAiChatView()
// itself, once the real data is actually in place, to bring the conversation on screen.
export async function openSavedChat(conversationId: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  openSearchOverlay();
  if (!supabase || !appState.currentUser.id) return;
  const { data, error } = await supabase
    .from("dotbot_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[chats] failed to load conversation:", error);
    return;
  }
  appState.currentConversationId = conversationId;
  // append_dotbot_turn always inserts one user row then one assistant row per turn, in that
  // order — created_at ascending naturally yields [user1, assistant1, user2, assistant2, ...], so
  // pairing sequentially here is reliable rather than needing an explicit turn/sequence id on
  // each row.
  interface MessageRow {
    role: string;
    content: unknown;
  }
  const turns: { id: string; query: string; panels: unknown }[] = [];
  let pendingUserQuery: string | null = null;
  ((data as MessageRow[]) || []).forEach((m) => {
    if (m.role === "user") {
      pendingUserQuery = (m.content as { query?: string })?.query || "";
    } else if (m.role === "assistant" && pendingUserQuery !== null) {
      // fresh: false (the default, omitted) — history must render fully settled instantly, never
      // re-typewriter text that was already delivered in a past session.
      turns.push({
        id: "turn_" + appState.idCounter++,
        query: pendingUserQuery,
        panels: m.content || [],
      });
      pendingUserQuery = null;
    }
  });
  flushSync(() => useChatThreadStore.setState(turns, true));
  showAiChatView();
  updateChatThread();
  scrollChatThreadToBottom();
}
// ---------- Chats/Waypoints/Collaborations list-panel selection + deletion ----------
// One shared selection, not three — openHubSubpanel (panelsHamburger.ts) already enforces exactly
// one hub-subpanel open at a time, so `panel` doubles as the disambiguation a single Backspace
// handler needs. Vanilla owns this as the source of truth (appState.listPanelSelection,
// coreState.ts — same convention as appState.selectedCardIds for canvas cards), mirrored into
// React's listPanelSelectionStore via window.__setListPanelSelection purely so the list rows can
// show a highlight.
export function toggleListPanelSelection(panel: string, id: string): void {
  const appState = getAppState();
  const current = appState.listPanelSelection;
  const ids = current.panel === panel ? new Set(current.ids) : new Set<string>();
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  appState.listPanelSelection = { panel, ids };
  window.__setListPanelSelection?.(appState.listPanelSelection);
}
// Shift+click-DRAG "paint select" across a list panel's rows, extending the existing shift+click
// toggle above — holding Shift and dragging the pointer across multiple rows now toggles every
// row it passes over, instead of needing to shift-click each one individually. Each row is only
// ever toggled ONCE per drag gesture. Listens on the STABLE list container via event delegation
// off e.target/elementFromPoint — rows opt in just by carrying data-select-id.
function setupListPanelDragSelect(container: HTMLElement | null, panel: string): void {
  if (!container) return;
  container.addEventListener("mousedown", (e) => {
    if (!e.shiftKey) return;
    const target = e.target as HTMLElement;
    const startRow = target.closest("[data-select-id]");
    if (!startRow || !container.contains(startRow)) return;
    const visited = new Set<string>();
    const toggleRow = (el: Element | null) => {
      const row = el?.closest?.("[data-select-id]") as HTMLElement | null;
      if (!row || !container.contains(row) || visited.has(row.dataset.selectId!)) return;
      visited.add(row.dataset.selectId!);
      toggleListPanelSelection(panel, row.dataset.selectId!);
    };
    toggleRow(startRow);
    const onMove = (me: MouseEvent) => toggleRow(document.elementFromPoint(me.clientX, me.clientY));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
export function clearListPanelSelection(): void {
  const appState = getAppState();
  appState.listPanelSelection = { panel: null, ids: new Set() };
  window.__setListPanelSelection?.(appState.listPanelSelection);
}
// Also clears currentConversationId/the visible chat thread if the deleted set includes the
// conversation currently open in the search palette — otherwise the next follow-up message would
// call append_dotbot_turn with a p_conversation_id that no longer exists, which raises and
// surfaces as a hard 502 instead of gracefully starting a fresh conversation.
async function deleteSelectedChats(ids: string[]): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!confirm(ids.length === 1 ? "Delete this chat?" : `Delete ${ids.length} chats?`)) {
    clearListPanelSelection();
    return;
  }
  const { error } = await supabase!.rpc("delete_dotbot_conversations", { p_conversation_ids: ids });
  if (error) console.error("[chats] failed to delete conversations:", error);
  // updateChatThread() alongside setChatThread: without it, #search-chat-thread's
  // 'thread-settled' class would linger from the just-deleted conversation, pinning the AI
  // panel's input box to the bottom of what's now a blank thread.
  if (ids.includes(appState.currentConversationId!)) {
    appState.currentConversationId = null;
    flushSync(() => useChatThreadStore.setState([], true));
    updateChatThread();
  }
  clearListPanelSelection();
  renderChatsList();
}
async function deleteSelectedWaypointRows(ids: string[]): Promise<void> {
  const appState = getAppState();
  const idSet = new Set(ids);
  const rows = (appState.lastWaypointsRows || []).filter((r) => idSet.has(waypointRowKey(r)));
  if (!rows.length) {
    clearListPanelSelection();
    return;
  }
  if (!confirm(rows.length === 1 ? "Delete this waypoint?" : `Delete ${rows.length} waypoints?`)) {
    clearListPanelSelection();
    return;
  }
  await Promise.all(
    rows.map((r) => window.__deleteWaypointCardEverywhere?.(r.owner_id, r.folder_id, r.item_id)),
  );
  clearListPanelSelection();
  renderWaypointsList(appState.waypointsSearchInput ? appState.waypointsSearchInput.value : "");
}
// "owned:folderId" ids remove every collaborator via the existing deleteCanvasCollabsForFolder
// (owner-only, already used elsewhere for folder-deletion cascade). "shared:id" ids are this user
// leaving a canvas they don't own, via the leave_canvas_collaboration RPC. Both id spaces are
// self-contained once the prefix is stripped — no row cache needed here, unlike waypoints.
async function deleteSelectedCollabs(ids: string[]): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  const owned = ids.filter((id) => id.startsWith("owned:")).map((id) => id.slice("owned:".length));
  const shared = ids
    .filter((id) => id.startsWith("shared:"))
    .map((id) => Number(id.slice("shared:".length)));
  const count = owned.length + shared.length;
  if (!confirm(count === 1 ? "Remove this collaboration?" : `Remove ${count} collaborations?`)) {
    clearListPanelSelection();
    return;
  }
  await Promise.all([
    ...owned.map((folderId) => window.__deleteCanvasCollabsForFolder?.(folderId)),
    ...shared.map(async (id) => {
      const { error } = await supabase!.rpc("leave_canvas_collaboration", { p_id: id });
      if (error) console.error("[collab] failed to leave canvas collaboration:", error);
    }),
  ]);
  clearListPanelSelection();
  renderHubCollabList(appState.hubCollabSearchInput ? appState.hubCollabSearchInput.value : "");
}
// Routed from the shared Backspace handler (sourceButtonsCursorMode.ts) — dispatches to whichever
// of the three panels the current selection actually belongs to.
export function dispatchListPanelDelete(panel: string, ids: string[]): void {
  if (panel === "chats") {
    deleteSelectedChats(ids);
    return;
  }
  if (panel === "waypoints") {
    deleteSelectedWaypointRows(ids);
    return;
  }
  if (panel === "collaborations") {
    deleteSelectedCollabs(ids);
    return;
  }
}
export function hmenuAction(action: string): void {
  window.__closeRailView?.();
  window.__closeProfilePanel?.();
  if (action === "upgrade") {
    window.openPricingOverlay?.();
  } else if (action === "logout") {
    // Flush whatever's still sitting in the debounced save timer (e.g. a pan/zoom just before
    // clicking logout) before navigating away, so the next login restores exactly where this
    // session left off — same as pagehide/visibilitychange do for a plain refresh or tab close.
    window.__saveWorkspaceNow?.().finally(() => {
      const supabase = getSupabase();
      if (supabase)
        supabase.auth.signOut().finally(() => {
          window.location.href = "/login";
        });
      else window.location.href = "/login";
    });
  }
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  setupListPanelDragSelect(document.getElementById("waypoints-list"), "waypoints");
  setupListPanelDragSelect(document.getElementById("chats-list"), "chats");
  setupListPanelDragSelect(document.getElementById("hub-collab-list"), "collaborations");
  window.__getDrawSettingsEl?.()?.addEventListener("click", (e) => e.stopPropagation());
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs
// window.__getDrawSettingsEl (coreState.ts) ready right at wire time to attach the click listener
// below, so a single readiness check isn't enough.
export function wireHamburgerCollab(): () => void {
  if (window.__getAppState && window.__getDrawSettingsEl) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState && window.__getDrawSettingsEl) {
      clearInterval(poll);
      doWire();
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // React → vanilla bridges — used by WaypointsListPanel.jsx/HubCollabListPanel.jsx/
  // ChatsListPanel.jsx (app/dotto/), which can't import these directly since public/dotto/*.js
  // isn't reachable from app/dotto/. openSavedChat/openHubCollabRequestsView/backToHubCollabMain/
  // handleOwnedHubCollabRowClick/respondToHubCollabRequest had their own bridges dropped — their
  // only consumer (ChatsListPanel.jsx/HubCollabListPanel.jsx) now uses real imports instead, same
  // app/dotto/ tree.
  window.__goToWaypointCard = goToWaypointCard; // also used by srsConnectionsCore.ts's keydown shortcut
  // Used by sourceButtonsCursorMode.ts's Backspace shortcut (Phase 4.4).
  window.__dispatchListPanelDelete = dispatchListPanelDelete;
  // Used by panelsHamburger.ts's openRailView/wireRailIcon calls (Phase 4.5).
  window.__clearListPanelSelection = clearListPanelSelection;
  window.__renderFilesList = renderFilesList;
  window.__renderHubCollabList = renderHubCollabList;
  window.__renderSourcesList = renderSourcesList;
  window.__renderWaypointsList = renderWaypointsList;
  // Used by historyAutosave.ts's loadWorkspace (Phase 4.5).
  window.__resolveSharedFolderChain = resolveSharedFolderChain;
  // Plain (non-`__`) global — real inline onclick target in
  // content/fragments/hamburger-stack.html/content/dotto-markup.html.
  window.hmenuAction = hmenuAction;
}
