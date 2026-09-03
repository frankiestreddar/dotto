// Phase 4.5 port of public/dotto/friends-presence.js: the Collaborators pill/panel controls (per-
// canvas collaboration invites), the Friends/Messages list data (friend requests, chat previews),
// and friend online/afk/logout presence tracking over Supabase Realtime.
//
// Genuinely circular with app/dotto/lib/messagesSchedule.ts (openMessagesPanel) — both moved to
// app/dotto/lib together so this becomes a real ES import instead of the vanilla-only workaround
// of each file importing the other at its own top level; the binding is only read inside function
// bodies (never at module-evaluation time), same as every other circular pair this migration has
// already carried over safely.

import { openMessagesPanel } from "./messagesSchedule";

interface Friend {
  id: string;
  friendshipId: string;
  username: string;
  displayName: string;
  avatarId: number;
  avatarUrl: string | null;
  messages: {
    id: string;
    senderId: string;
    text: string;
    canvasSnapshot: unknown;
    createdAt: string;
  }[];
  lastActive?: number;
}

interface FolderObj {
  id: string;
  title?: string;
  collaborators?: string[];
  isSharedView?: boolean;
  sharedOwnerId?: string;
  sharedRemoteFolderId?: string;
}

interface IncomingRequest {
  id: string;
  requester: { id: string; username: string; display_name: string | null };
}

interface AppState {
  currentUser: { id: string | null };
  currentFolderId: string;
  folders: Record<string, FolderObj>;
  activePaneId: number;
  collabPanel: HTMLElement;
  collabBubble: HTMLElement;
  collabSearchInput: HTMLInputElement;
  panelPinned: { collab: boolean; [key: string]: boolean };
  outgoingCanvasInvitePendingIds: Set<string>;
  COLLAB_LIST_MAX: number;
  friends: Friend[];
  incomingRequests: IncomingRequest[];
  outgoingPendingIds: Set<string>;
  seenIncomingFriendRequestIds: Set<string> | null;
  remoteCursors: Map<string, unknown>;
  AFK_THRESHOLD_MS: number;
  localPresenceStatus: string;
  afkTimer: ReturnType<typeof setTimeout> | null;
  friendPresenceLastStatus: Map<string, string | null | undefined>;
  friendMessageChannels: Map<string, ReturnType<NonNullable<Window["__dottoSupabase"]>["channel"]>>;
  activeConvoId: string | null;
  messagesPanel: HTMLElement;
  msgView: string;
  msgSearchInput: HTMLInputElement;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

function getSupabase() {
  return window.__dottoSupabase || null;
}

// ---------- Collaborators Pill/Panel Controls ----------
function getCurrentCollaboratorIds(): string[] {
  const appState = getAppState();
  const folderObj = appState.folders[appState.currentFolderId];
  return folderObj && folderObj.collaborators ? folderObj.collaborators : [];
}
export function closeCollabPanel(): void {
  const appState = getAppState();
  appState.collabPanel.classList.remove("open");
  appState.panelPinned.collab = false;
}
function positionCollabPanel(): void {
  const appState = getAppState();
  const rect = appState.collabBubble.getBoundingClientRect();
  appState.collabPanel.style.top = rect.bottom + 10 + "px";
  const panelWidth = 280;
  const btnCenter = rect.left + rect.width / 2;
  let leftPos = btnCenter - panelWidth / 2;
  if (leftPos + panelWidth > window.innerWidth - 20) leftPos = window.innerWidth - panelWidth - 20;
  if (leftPos < 20) leftPos = 20;
  appState.collabPanel.style.left = leftPos + "px";
  appState.collabPanel.style.right = "auto";
}
export function openCollabPanel(pin?: boolean): void {
  const appState = getAppState();
  if (!appState.collabBubble.classList.contains("show")) return;
  window.__closeAllPanels?.("collab");
  window.__clearSearch?.();
  appState.collabPanel.classList.add("open");
  appState.collabSearchInput.value = "";
  renderCollabList("");
  positionCollabPanel();
  if (pin) {
    appState.panelPinned.collab = true;
  }
}
// Split-screen Stage 8 — each pane now renders its own collaborator bubble (PaneTopBar.jsx)
// instead of one shared #collab-bubble, but there's still only ONE flyout panel/#collab-panel;
// these three wrappers retarget appState.collabBubble (a plain, reassignable object property —
// see its own comment, coreState.ts — unlike canvas/world/etc's `let` bindings) to whichever
// pane's own bubble element triggered the interaction, activating that pane first if it wasn't
// already, then reuses openCollabPanel/closeCollabPanel/positionCollabPanel completely unchanged.
export function collabBubblePaneClick(paneId: number, bubbleEl: HTMLElement): void {
  const appState = getAppState();
  if (paneId !== appState.activePaneId) window.__switchActivePane?.(paneId);
  appState.collabBubble = bubbleEl;
  if (appState.panelPinned.collab) {
    closeCollabPanel();
  } else {
    openCollabPanel(true);
  }
}
export function collabBubblePaneMouseEnter(paneId: number, bubbleEl: HTMLElement): void {
  const appState = getAppState();
  if (paneId !== appState.activePaneId) window.__switchActivePane?.(paneId);
  appState.collabBubble = bubbleEl;
  // Only auto-open on hover when there are no collaborators yet (the "+" affordance); once
  // collaborators exist, hover just reveals the tooltip and click opens the panel.
  if (getCurrentCollaboratorIds().length === 0 && !appState.collabPanel.classList.contains("open"))
    openCollabPanel(false);
}
export function collabBubblePaneMouseLeave(bubbleEl: HTMLElement): void {
  const appState = getAppState();
  window.__scheduleHoverClose?.("collab", [bubbleEl, appState.collabPanel], closeCollabPanel);
}
// A pane's own collaborator bubble element (PaneTopBar.jsx) is the only thing
// appState.collabBubble can point to now that every pane renders its own — found by pane id
// rather than a fixed id. For callers that need to open the ACTIVE pane's own collab panel from
// somewhere other than a real click/hover on that bubble (e.g. handleOwnedHubCollabRowClick,
// app/dotto/lib/hamburgerCollab.ts, which navigates then opens the panel programmatically).
export function activePaneCollabBubbleEl(): HTMLElement | undefined {
  const appState = getAppState();
  return (
    document.querySelector<HTMLElement>(
      "#pane-breadcrumb-pill-" + appState.activePaneId + " .pane-collab-bubble",
    ) ?? undefined
  );
}

// Who's already accepted (including inherited from an ancestor canvas), and who has a pending
// invite at THIS exact folder, for the folder currently open in the per-canvas collab panel —
// refreshed each time that panel (re)opens (see renderCollabList).
export async function refreshCanvasCollabForCurrentFolder(): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) {
    appState.outgoingCanvasInvitePendingIds = new Set();
    return;
  }
  const folderObj = appState.folders[appState.currentFolderId];
  if (!folderObj) return;
  const [effective, pendingRes] = await Promise.all([
    supabase.rpc("get_effective_collaborators", {
      p_owner_id: appState.currentUser.id,
      p_folder_id: appState.currentFolderId,
    }),
    supabase
      .from("canvas_collaborations")
      .select("collaborator_id")
      .eq("owner_id", appState.currentUser.id)
      .eq("folder_id", appState.currentFolderId)
      .eq("status", "pending"),
  ]);
  if (effective.error)
    console.error("[collab] failed to load effective collaborators:", effective.error);
  if (pendingRes.error)
    console.error("[collab] failed to load pending canvas invites:", pendingRes.error);
  folderObj.collaborators = ((effective.data as { collaborator_id: string }[]) || []).map(
    (r) => r.collaborator_id,
  );
  appState.outgoingCanvasInvitePendingIds = new Set(
    ((pendingRes.data as { collaborator_id: string }[]) || []).map((r) => r.collaborator_id),
  );
  // ensureCanvasPresenceChannel's "is this folder worth a live channel" check only runs inside
  // render() — which already ran synchronously, BEFORE this async fetch had any real data, on
  // every normal navigation. Re-running it here, now that folderObj.collaborators is current, is
  // what actually catches an owner's own client permanently deciding "no collaborators, don't
  // join" off stale/empty data even with a collaborator actively viewing.
  window.__ensureCanvasPresenceChannel?.();
}
// A raw insert here fails outright (unique constraint violation) for anyone whose invite already
// reached a terminal state -- declined, or removed via revoke_canvas_collaboration -- since
// canvas_collaborations has no other way to distinguish "never invited" from "invited before, now
// available again". invite_canvas_collaborator upserts instead, same insert-on-conflict pattern
// revoke_canvas_collaboration already uses for its own direction.
async function sendCanvasCollabInvite(collaboratorId: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) return;
  const folderObj = appState.folders[appState.currentFolderId];
  if (!folderObj) return;
  const { error } = await supabase.rpc("invite_canvas_collaborator", {
    p_folder_id: appState.currentFolderId,
    p_folder_title: folderObj.title,
    p_collaborator_id: collaboratorId,
  });
  if (error) {
    console.error("[collab] failed to send canvas collaboration invite:", error);
    return;
  }
  appState.outgoingCanvasInvitePendingIds.add(collaboratorId);
}
// Explicitly blocks this collaborator from THIS exact folder, even if their access here was only
// inherited from a parent canvas. Their access to any sibling canvas (or the parent itself) is
// untouched.
async function revokeCanvasCollab(collaboratorId: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) return;
  const { error } = await supabase.rpc("revoke_canvas_collaboration", {
    p_folder_id: appState.currentFolderId,
    p_collaborator_id: collaboratorId,
  });
  if (error) console.error("[collab] failed to remove collaborator:", error);
}
// Keeps the Collaborations panel's cached folder_title in sync after a rename — that column is an
// invite-time snapshot only, never refreshed on its own. Goes through rename_canvas_collaborations
// (SECURITY DEFINER) rather than a raw table update since a collaborator has no RLS-visible row of
// their own to satisfy an owner-only update policy with.
export async function syncCanvasCollabTitle(folderId: string, newTitle: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) return;
  const folderObj = appState.folders[folderId];
  if (!folderObj) return;
  const ownerId = folderObj.isSharedView ? folderObj.sharedOwnerId : appState.currentUser.id;
  const realFolderId = folderObj.isSharedView ? folderObj.sharedRemoteFolderId : folderId;
  const { error } = await supabase.rpc("rename_canvas_collaborations", {
    p_owner_id: ownerId,
    p_folder_id: realFolderId,
    p_new_title: newTitle,
  });
  if (error) console.error("[collab] failed to sync renamed canvas title:", error);
}

// Real React state now (see app/dotto/CollabListPanel.jsx, collabListStore) — genuine JSX rows,
// same reasoning as WaypointsListPanel. Unlike the Hub Collab/Messages panels, this one has no
// Requests drill-down — adding someone sends a request that shows as "Requested" until they
// accept it from THEIR OWN hamburger Collaborations panel. Someone already collaborating shows
// "Remove" instead, which always acts on this exact folder.
export async function renderCollabList(query?: string): Promise<void> {
  const appState = getAppState();
  await Promise.all([refreshFriendsData(), refreshCanvasCollabForCurrentFolder()]);
  const folderObj = appState.folders[appState.currentFolderId];
  if (!folderObj) return;
  folderObj.collaborators = folderObj.collaborators || [];
  const q = (query || "").trim().toLowerCase();
  const isCollab = (id: string) => folderObj.collaborators!.includes(id);

  // A live presence dot + clickable name only makes sense for someone who's both an actual
  // collaborator here AND currently present on this exact canvas right now.
  function toRow(f: Friend) {
    const added = isCollab(f.id);
    const pending = appState.outgoingCanvasInvitePendingIds.has(f.id);
    return {
      id: f.id,
      displayName: f.displayName,
      avatarId: f.avatarId ?? 0,
      avatarUrl: f.avatarUrl || null,
      added,
      pending,
      isPresent: added && appState.remoteCursors.has(f.id),
    };
  }

  // Search covers the whole friends list, no cap. Otherwise (the default view): every current
  // collaborator always shows (regardless of ranking, so Remove is always reachable), then up to
  // COLLAB_LIST_MAX more from recency/conversation.
  if (q) {
    const results = appState.friends.filter((f) => f.displayName.toLowerCase().includes(q));
    window.__setCollabList?.({ rows: results.map(toRow), query: q });
    return;
  }

  const current = folderObj.collaborators
    .map((id) => appState.friends.find((f) => f.id === id))
    .filter((f): f is Friend => !!f);
  const seen = new Set(current.map((f) => f.id));
  const rest = appState.friends.filter((f) => !seen.has(f.id));
  const byRecent = [...rest].sort((a, b) => (a.lastActive ?? 9999) - (b.lastActive ?? 9999));
  const byConversed = [...rest].sort((a, b) => b.messages.length - a.messages.length);
  const merged = current.slice();
  for (
    let i = 0;
    merged.length < appState.COLLAB_LIST_MAX && (i < byRecent.length || i < byConversed.length);
    i++
  ) {
    const r = byRecent[i];
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
    if (merged.length >= appState.COLLAB_LIST_MAX) break;
    const c = byConversed[i];
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      merged.push(c);
    }
  }
  window.__setCollabList?.({ rows: merged.map(toRow), query: "" });
}
// Wired up from CollabListPanel.jsx's Add/Remove button handler.
export async function handleCollabAddRemoveClick(
  friendId: string,
  added: boolean,
  pending: boolean,
  query?: string,
): Promise<void> {
  if (pending) return;
  if (added) await revokeCanvasCollab(friendId);
  else await sendCanvasCollabInvite(friendId);
  renderCollabList(query);
}
export function handleCollabSearch(v: string): void {
  renderCollabList(v);
}

// Real React state now (see app/dotto/PaneTopBar.jsx, collabPillStore) — genuine JSX, same
// Avatar.jsx-based reasoning as CollabListPanel. Pane-keyed since split-screen Stage 8. MUST be
// flushSync'd (see app/dotto-app.jsx): openCollabPanel, right above, reads collabBubble's `.show`
// class synchronously right after a caller in app/dotto/lib/hamburgerCollab.ts calls this.
export function renderCollabPill(paneId?: number): void {
  const appState = getAppState();
  const pid = paneId ?? appState.activePaneId;
  const folderObj = appState.folders[appState.currentFolderId];
  // The root canvas is always private to the user, so no collaborators indicator there — checked
  // by identity (currentFolderId === 'root'), not historyIndex === 0. A canvas someone else
  // shared with you isn't yours to invite further collaborators on.
  if (!folderObj || appState.currentFolderId === "root" || folderObj.isSharedView) {
    closeCollabPanel();
    window.__setCollabPill?.(pid, { show: false, collabs: [], moreCount: 0 });
    return;
  }
  const collabIds = folderObj.collaborators || [];
  const collabs = collabIds
    .map((id) => appState.friends.find((f) => f.id === id))
    .filter((f): f is Friend => !!f);
  const shown = collabs.slice(0, 3).map((f) => ({
    id: f.id,
    avatarId: f.avatarId ?? 0,
    avatarUrl: f.avatarUrl || null,
    displayName: f.displayName,
  }));
  window.__setCollabPill?.(pid, {
    show: true,
    collabs: shown,
    moreCount: Math.max(0, collabs.length - 3),
  });
}

// `friends` / incoming / outgoing requests are loaded from Supabase (`profiles` + `friendships`)
// via refreshFriendsData() below, called on init and again whenever a messages/collab panel is
// opened. `messages` per friend stays a local-only array for now.
export async function refreshFriendsData(): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) return;

  interface FriendshipRow {
    id: string;
    requester_id: string;
    addressee_id: string;
    requester: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_id: number | null;
      avatar_url: string | null;
    };
    addressee: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_id: number | null;
      avatar_url: string | null;
    };
  }
  const { data: accepted, error: acceptedErr } = await supabase
    .from("friendships")
    .select(
      "id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_id, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_id, avatar_url)",
    )
    .eq("status", "accepted")
    .or(`requester_id.eq.${appState.currentUser.id},addressee_id.eq.${appState.currentUser.id}`);
  if (acceptedErr) console.error("[friends] failed to load friendships:", acceptedErr);

  appState.friends = ((accepted as unknown as FriendshipRow[]) || []).map((row) => {
    const other = row.requester_id === appState.currentUser.id ? row.addressee : row.requester;
    return {
      id: other.id,
      friendshipId: row.id,
      username: other.username,
      displayName: other.display_name || other.username,
      avatarId: other.avatar_id ?? 0,
      avatarUrl: other.avatar_url || null,
      messages: [],
    };
  });
  // This query is already symmetric (requester OR addressee = me), so friends.length is always
  // this user's true total regardless of who sent/accepted — sync it in as an absolute value
  // rather than incrementing, since respondToFriendRequest only runs on the accepting side and
  // would otherwise never move the requester's own count.
  window.__bumpAchievementStat?.("three_friends", appState.friends.length, true);

  // Loaded in one round trip (not lazily per-conversation) so the chat list's preview text and
  // the collab panel's "most conversed with" sort both reflect real data without an extra fetch
  // each.
  const friendshipIds = appState.friends.map((f) => f.friendshipId);
  if (friendshipIds.length) {
    interface MessageRow {
      id: string;
      friendship_id: string;
      sender_id: string;
      body: string;
      canvas_snapshot: unknown;
      created_at: string;
    }
    const { data: allMessages, error: messagesErr } = await supabase
      .from("messages")
      .select("id, friendship_id, sender_id, body, canvas_snapshot, created_at")
      .in("friendship_id", friendshipIds)
      .order("created_at", { ascending: true });
    if (messagesErr) console.error("[chat] failed to load messages:", messagesErr);
    const byFriendship = new Map<string, Friend["messages"]>();
    ((allMessages as MessageRow[]) || []).forEach((m) => {
      if (!byFriendship.has(m.friendship_id)) byFriendship.set(m.friendship_id, []);
      byFriendship.get(m.friendship_id)!.push({
        id: m.id,
        senderId: m.sender_id,
        text: m.body,
        canvasSnapshot: m.canvas_snapshot,
        createdAt: m.created_at,
      });
    });
    appState.friends.forEach((f) => {
      f.messages = byFriendship.get(f.friendshipId) || [];
    });
  }

  const { data: incoming, error: incomingErr } = await supabase
    .from("friendships")
    .select("id, requester:profiles!friendships_requester_id_fkey(id, username, display_name)")
    .eq("status", "pending")
    .eq("addressee_id", appState.currentUser.id);
  if (incomingErr) console.error("[friends] failed to load incoming requests:", incomingErr);
  appState.incomingRequests = (incoming as unknown as IncomingRequest[]) || [];
  if (appState.seenIncomingFriendRequestIds === null) {
    appState.seenIncomingFriendRequestIds = new Set(appState.incomingRequests.map((r) => r.id));
  } else {
    appState.incomingRequests.forEach((r) => {
      if (appState.seenIncomingFriendRequestIds!.has(r.id)) return;
      appState.seenIncomingFriendRequestIds!.add(r.id);
      window.pushNotification?.({
        type: "friend_request",
        message: `@${r.requester.username} sent you a friend request`,
        actionLabel: "Accept",
        onAction: () => respondToFriendRequest(r.id, true),
        // No dismiss button — Escape hides it without accepting, request stays pending.
        sticky: true,
      });
    });
  }

  const { data: outgoing, error: outgoingErr } = await supabase
    .from("friendships")
    .select("addressee_id")
    .eq("status", "pending")
    .eq("requester_id", appState.currentUser.id);
  if (outgoingErr) console.error("[friends] failed to load outgoing requests:", outgoingErr);
  appState.outgoingPendingIds = new Set(
    ((outgoing as { addressee_id: string }[]) || []).map((r) => r.addressee_id),
  );

  subscribeToAllFriendMessages();
}

async function sendFriendRequest(userId: string): Promise<void> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !appState.currentUser.id) return;
  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: appState.currentUser.id, addressee_id: userId });
  if (error) {
    console.error("[friends] failed to send request:", error);
    return;
  }
  appState.outgoingPendingIds.add(userId);
}

async function respondToFriendRequest(friendshipId: string, accept: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = accept
    ? await supabase
        .from("friendships")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", friendshipId)
    : await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) console.error("[friends] failed to respond to request:", error);
}

async function searchDiscoverableUsers(
  query: string,
): Promise<{ id: string; username: string; displayName: string }[]> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !query) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .ilike("username", `%${query}%`)
    .neq("id", appState.currentUser.id)
    .limit(10);
  if (error) {
    console.error("[friends] failed to search users:", error);
    return [];
  }
  const friendIds = new Set(appState.friends.map((f) => f.id));
  return ((data as { id: string; username: string; display_name: string | null }[]) || [])
    .filter((u) => !friendIds.has(u.id))
    .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name || u.username }));
}

// Exact-match counterpart to searchDiscoverableUsers above, for the slash-command "invite
// <username>"/"remove <username>" verbs (app/dotto/lib/commandVerbs.ts) — those need to resolve
// one exact username typed as a command argument, not a fuzzy list to pick from. Deliberately
// doesn't
// require the target to already be a friend (unlike the existing Collaborations-panel invite
// flow, which only lists friends) — that restriction lives entirely in that panel's own UI, not
// in invite_canvas_collaborator itself, so a command can bypass it correctly rather than working
// around a UI-only gate.
export async function resolveUsernameToUserId(username: string): Promise<string | null> {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase || !username) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", appState.currentUser.id)
    .maybeSingle();
  if (error) {
    console.error(`[commands] username lookup failed: message=${error.message} code=${error.code}`);
    return null;
  }
  return data ? (data as { id: string }).id : null;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function lastPreview(f: Friend): string {
  const m = f.messages[f.messages.length - 1];
  return m ? m.text : "No messages yet";
}

// 'main' (chat list + "Add a friend" search) / 'requests' (every incoming friend request,
// Accept/Decline each) — same drill-down pattern as hubCollabView in the Collaborations hub
// panel. Real React state now (see app/dotto/MessagesListPanel.jsx, msgListStore). The actual
// conversation thread (openConvo/renderConvoBody) lives in messagingCanvasPreview.ts, reached via
// window.__openConvo — this file's own list rendering is a separate concern (real-time
// presence/content-sync, not messaging DOM); a chat row here just calls window.__openConvo.
export async function renderMsgList(query?: string): Promise<void> {
  const appState = getAppState();
  await refreshFriendsData();
  if (appState.msgView === "requests") {
    renderMsgRequests();
    return;
  }
  const q = (query || "").trim().toLowerCase();
  const matchedFriends = appState.friends
    .filter((f) => f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
    .map((f) => ({
      id: f.id,
      displayName: f.displayName,
      avatarId: f.avatarId ?? 0,
      avatarUrl: f.avatarUrl || null,
      preview: lastPreview(f),
    }));
  let searchResults: { id: string; username: string; pending: boolean }[] = [];
  if (q) {
    const users = await searchDiscoverableUsers(q);
    searchResults = users.map((u) => ({
      id: u.id,
      username: u.username,
      pending: appState.outgoingPendingIds.has(u.id),
    }));
  }
  window.__setMsgList?.({
    view: "main",
    requestsCount: appState.incomingRequests.length,
    matchedFriends,
    searchResults,
    query: q,
  });
}
function renderMsgRequests(): void {
  const appState = getAppState();
  window.__setMsgList?.({
    view: "requests",
    requests: appState.incomingRequests.map((req) => ({
      id: req.id,
      username: req.requester.username,
    })),
  });
}
// Wired up from MessagesListPanel.jsx's JSX handlers.
export function openMsgRequestsView(): void {
  const appState = getAppState();
  appState.msgView = "requests";
  renderMsgRequests();
}
export function backToMsgMain(): void {
  const appState = getAppState();
  appState.msgView = "main";
  renderMsgList(appState.msgSearchInput.value);
}
export async function handleAddFriendClick(userId: string, query?: string): Promise<void> {
  const appState = getAppState();
  if (appState.outgoingPendingIds.has(userId)) return;
  await sendFriendRequest(userId);
  renderMsgList(query);
}
export async function respondToMsgRequest(id: string, accept: boolean): Promise<void> {
  await respondToFriendRequest(id, accept);
  await refreshFriendsData();
  renderMsgRequests();
}
export function handleMsgSearch(v: string): void {
  renderMsgList(v);
}

// Standing subscription per friendship — not just whichever one is currently open — so a message
// can be caught and turned into a notification no matter what you're looking at. Rebuilt to match
// the friends list every time refreshFriendsData runs — diffs against the currently-subscribed
// set rather than tearing everything down and re-subscribing every time. Each channel's own
// handler looks up its friend object LIVE (by friendshipId, via friends.find) rather than closing
// over the `f` reference captured at subscribe time — refreshFriendsData replaces the whole
// `friends` array with fresh objects on every call, so a closed-over reference would silently go
// stale.
// ---------- Friend presence (online / afk / logout) ----------
// Reuses the SAME per-friendship channel as messages below rather than opening a second one —
// both participants in a friendship already open a channel with this exact topic, so Realtime
// Presence naturally scopes "who's here" to just the two of you. Each channel is given an
// explicit presence key (this user's own id) so the other side's entry can be looked up directly
// by their id in presenceState().
//
// Idle detection is ONE shared timer for the whole tab (not per friend) — any mouse/keyboard/
// pointer activity resets it; AFK_THRESHOLD_MS of silence flips to 'afk'. Whenever that local
// status actually changes, every open friend channel is re-tracked with it, which is what shows
// up as a 'sync' event on the other end.
function setLocalPresenceStatus(status: string): void {
  const appState = getAppState();
  if (appState.localPresenceStatus === status) return;
  appState.localPresenceStatus = status;
  appState.friendMessageChannels.forEach((channel) =>
    channel.track({ status: appState.localPresenceStatus }),
  );
}
function resetAfkTimer(): void {
  const appState = getAppState();
  setLocalPresenceStatus("online");
  if (appState.afkTimer) clearTimeout(appState.afkTimer);
  appState.afkTimer = setTimeout(() => setLocalPresenceStatus("afk"), appState.AFK_THRESHOLD_MS);
}

// friendshipId -> that friend's last known status this session ('online'/'afk'), or null if
// they're not present in the channel at all (offline) — undefined (never set) means "haven't
// heard from this channel yet", which is what tells the very first sync apart from a real
// transition: a friend already online when you load the app shouldn't fire a spurious "came
// online" notification, only a genuine change after that baseline should.
function handleFriendPresenceSync(
  friendshipId: string,
  channel: NonNullable<Window["__dottoSupabase"]>["channel"] extends (...args: never[]) => infer R
    ? R
    : never,
): void {
  const appState = getAppState();
  const live = appState.friends.find((x) => x.friendshipId === friendshipId);
  if (!live) return;
  const metas = (channel.presenceState() as Record<string, { status?: string }[]>)[live.id] || []; // presence key = the friend's own user id
  const nowStatus = metas.length ? metas[0].status || "online" : null;
  const prev = appState.friendPresenceLastStatus.get(friendshipId);
  if (nowStatus === prev) return;
  appState.friendPresenceLastStatus.set(friendshipId, nowStatus);
  if (prev === undefined) return; // first sync since subscribing — baseline only, not a real transition
  if (nowStatus === "online") {
    window.pushNotification?.({
      type: "friend_online",
      message: `${live.displayName} is online`,
      actionLabel: "Chat",
      onAction: () => {
        openMessagesPanel(true);
        window.__openConvo?.(live.id);
      },
    }); // one button, auto-dismisses — no dismiss function
  } else if (nowStatus === null) {
    window.pushNotification?.({
      type: "friend_offline",
      message: `${live.displayName} logged off`,
    }); // no buttons, auto-dismisses — no dismiss function
  } else if (nowStatus === "afk") {
    window.pushNotification?.({ type: "friend_afk", message: `${live.displayName} is away` }); // no buttons, auto-dismisses — no dismiss function
  }
}

function subscribeToAllFriendMessages(): void {
  const appState = getAppState();
  const supabase = getSupabase();
  if (!supabase) return;
  const liveFriendshipIds = new Set(appState.friends.map((f) => f.friendshipId));

  for (const [friendshipId, channel] of appState.friendMessageChannels) {
    if (!liveFriendshipIds.has(friendshipId)) {
      supabase.removeChannel(channel);
      appState.friendMessageChannels.delete(friendshipId);
      appState.friendPresenceLastStatus.delete(friendshipId);
    }
  }

  appState.friends.forEach((f) => {
    if (appState.friendMessageChannels.has(f.friendshipId)) return; // already subscribed
    const friendshipId = f.friendshipId;
    const channel = supabase
      .channel(`messages:${friendshipId}`, {
        config: { presence: { key: appState.currentUser.id! } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `friendship_id=eq.${friendshipId}`,
        },
        (payload: {
          new: {
            id: string;
            sender_id: string;
            body: string;
            canvas_snapshot: unknown;
            created_at: string;
          };
        }) => {
          const m = payload.new;
          if (m.sender_id === appState.currentUser.id) return; // our own message — already added optimistically by sendMsg
          const live = appState.friends.find((x) => x.friendshipId === friendshipId);
          if (!live) return; // unfriended (or a stale refresh) since this fired
          if (live.messages.some((existing) => existing.id === m.id)) return; // already have it somehow
          live.messages.push({
            id: m.id,
            senderId: m.sender_id,
            text: m.body,
            canvasSnapshot: m.canvas_snapshot,
            createdAt: m.created_at,
          });
          const isActivelyViewing =
            appState.activeConvoId === live.id && appState.messagesPanel.classList.contains("open");
          if (isActivelyViewing) {
            window.__renderConvoBody?.(live as unknown as Record<string, unknown>);
          } else {
            // renderMsgList only ever runs on open/search/etc. — never just because a message
            // arrived, so the chat list's preview text (lastPreview) would otherwise keep
            // showing whatever was last there until the panel is closed and reopened. Refresh
            // it here too, but only when the list is what's actually showing right now.
            if (appState.messagesPanel.classList.contains("open") && appState.msgView === "main") {
              renderMsgList(appState.msgSearchInput.value);
            }
            window.pushNotification?.({
              type: "chat",
              message: `${live.displayName}: ${(m.body || "").trim().slice(0, 80) || "New message"}`,
              actionLabel: "Reply",
              onAction: () => {
                openMessagesPanel(true);
                window.__openConvo?.(live.id);
              },
            }); // one button, auto-dismisses — no dismiss function
          }
        },
      )
      .on("presence", { event: "sync" }, () => handleFriendPresenceSync(friendshipId, channel))
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") channel.track({ status: appState.localPresenceStatus });
      });
    appState.friendMessageChannels.set(friendshipId, channel);
  });
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(): void {
  const appState = getAppState();
  appState.collabPanel.addEventListener("mouseleave", () =>
    window.__scheduleHoverClose?.(
      "collab",
      [appState.collabBubble, appState.collabPanel],
      closeCollabPanel,
    ),
  );
  window.__pinOnInsideClick?.("collab", [appState.collabPanel]);

  (["mousemove", "mousedown", "keydown", "pointerdown", "wheel", "touchstart"] as const).forEach(
    (evt) => {
      window.addEventListener(evt, resetAfkTimer, { passive: true });
    },
  );
  resetAfkTimer();
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs live appState right at
// wire time (to attach the mouseleave listener and start the AFK timer), so a single readiness
// check isn't enough — same reasoning app/dotto/lib/dayChangeAndAdNotifications.ts's own
// wireDayChangeAndAdNotifications gives.
export function wireFriendsPresence(): () => void {
  if (window.__getAppState) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getAppState) {
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
  // React → vanilla bridge — used by still-vanilla callers that can't import these directly.
  // collabBubblePaneClick/collabBubblePaneMouseEnter/collabBubblePaneMouseLeave
  // (PaneTopBar.jsx), openMsgRequestsView/backToMsgMain/handleAddFriendClick/respondToMsgRequest
  // (MessagesListPanel.jsx), and handleCollabAddRemoveClick (CollabListPanel.jsx) have no bridge
  // here — their only consumer is a real import instead, same app/dotto/ tree; same for
  // refreshCanvasCollabForCurrentFolder/refreshFriendsData/renderCollabPill's own former callers
  // in app/dotto/lib/appInit.ts, renderMsgList's own former caller in
  // app/dotto/lib/dragDropChat.ts, and resolveUsernameToUserId's own former caller in
  // app/dotto/lib/commandVerbs.ts (all ported since, all now real imports here too).
  window.__openCollabPanel = openCollabPanel;
  // Called from switchActivePane (coreState.ts) via this bridge, not a direct import — that
  // function is imported BY this file, so the reverse would be circular. Also used by
  // app/dotto/lib/hamburgerCollab.ts/app/dotto/lib/waypointsRenderLoop.ts.
  window.__renderCollabPill = renderCollabPill;
  // Used by app/dotto/lib/shelfSearch.ts's startRenameShelfSourceRow (Phase 4.4).
  window.__syncCanvasCollabTitle = syncCanvasCollabTitle;
  // Used by app/dotto/lib/sourceButtonsCursorMode.ts's window.onclick handler (Phase 4.4).
  window.__closeCollabPanel = closeCollabPanel;
  // Used by app/dotto/lib/messagingCanvasPreview.ts's closeConvo (Phase 4.5).
  window.__renderMsgList = renderMsgList;
  // Used by app/dotto/lib/waypointsRenderLoop.ts's applyFolderView (Phase 4.5).
  window.__refreshCanvasCollabForCurrentFolder = refreshCanvasCollabForCurrentFolder;
  // Used by app/dotto/lib/hamburgerCollab.ts's handleOwnedHubCollabRowClick (Phase 4.5).
  window.__activePaneCollabBubbleEl = activePaneCollabBubbleEl;
  // Plain (non-`__`) globals — real inline oninput targets in
  // content/fragments/collab-panel.html/hamburger-stack.html.
  window.handleCollabSearch = handleCollabSearch;
  window.handleMsgSearch = handleMsgSearch;

  // No window.__initials bridge — Avatar.jsx (app/dotto/) reimplements this directly instead (see
  // its own comment for why: plain string logic with no vanilla-only dependency, and needing it
  // to work on React's very first commit, before this module is guaranteed loaded, ruled out a
  // bridge here specifically).
}
