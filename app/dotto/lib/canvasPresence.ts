// Phase 4.5 port of public/dotto/live-presence.js's "realtime presence/cursor broadcast" concern
// (per the migration plan's own split of this file's 3 bundled concerns) — Figma-style remote
// cursors/typing indicators/selection highlights, plus the diff-and-broadcast content-sync
// pipeline that piggybacks on every render() call. Also owns findItemById/placeCaretEnd, the tiny
// "canonical item-data accessor" primitives the plan calls out separately — kept here rather than
// a third file since they're both used internally by this concern's own functions throughout, and
// splitting a 2-line function into its own file for architectural purity (when nothing currently
// needs it as a reactive Zustand selector — appState.folders itself is still a plain mutable
// object, not a real store, until core-state.js's own Phase 4.5 port (app/dotto/lib/coreState.ts, done since)) would be premature. See
// messagingCanvasPreview.ts for the other bundled concern (card-preview/messaging DOM). Reaches
// every still-vanilla dependency through window bridges; wires its real, module-load-time-only
// cursor-tracking pointermove listener (against the already-existing canvas element) via
// wireCanvasPresence(), using the same bridge-readiness poll established by every other Phase
// 4.4/4.5 wireX() port.

import type { SupabaseClient } from "@supabase/supabase-js";

interface Item {
  id: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  kind: string;
  [key: string]: unknown;
}
interface FolderObj {
  id: string;
  title?: string;
  items: Item[];
  isSharedView?: boolean;
  sharedOwnerId?: string;
  [key: string]: unknown;
  collaborators?: string[];
}
type PresenceChannel = ReturnType<SupabaseClient["channel"]>;
interface RemoteCursorEntry {
  el: HTMLElement;
  x: number;
  y: number;
  editingTarget: string | null;
  highlightedEl: HTMLElement | null;
  typingCaretEl: HTMLElement | null;
  typingLabelEl: HTMLElement | null;
  caretX: number | null;
  caretY: number | null;
  caretHeight: number | null;
  selectionRects: { x: number; y: number; w: number; h: number }[];
  selectionEls: HTMLElement[];
  isTyping: boolean;
  travelTimer: ReturnType<typeof setTimeout> | null;
  editingBlurTimer?: ReturnType<typeof setTimeout> | null;
  color?: string;
  displayName?: string;
  avatarId?: number;
  avatarUrl?: string | null;
}
interface AppState {
  currentUser: {
    id: string | null;
    displayName?: string;
    avatarId?: number;
    avatarUrl?: string | null;
  };
  currentFolderId: string;
  folders: Record<string, FolderObj>;
  tx: number;
  ty: number;
  scale: number;
  CURSOR_COLORS: string[];
  REMOTE_CURSOR_TRAVEL_MS: number;
  canvasPresenceChannel: PresenceChannel | null;
  canvasPresenceKey: string | null;
  lastBroadcastSnapshot: { title?: string; items: Map<number, string> } | null;
  pendingSyncDeltas: { title?: string; upserts: Map<number, Item>; deletes: Set<number> } | null;
  localEditingState: {
    editing: boolean;
    editingTarget: string | null;
    caret: { x: number; y: number; height: number } | null;
  };
  syncBroadcastTimer: ReturnType<typeof setTimeout>;
  remoteCursors: Map<string, RemoteCursorEntry>;
  lastPointerClientX: number | null;
  lastPointerClientY: number | null;
  cursorBroadcastThrottleId: ReturnType<typeof setTimeout> | null;
  itemDragBroadcastThrottleId: ReturnType<typeof setTimeout> | null;
  itemResizeBroadcastThrottleId: ReturnType<typeof setTimeout> | null;
  caretBroadcastThrottleId: ReturnType<typeof setTimeout> | null;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}
export function findItemById(id: number): Item | undefined {
  const appState = getAppState();
  return appState?.folders[appState.currentFolderId].items.find((i) => i.id === id);
}
export function placeCaretEnd(el: HTMLElement): void {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
// Pure reimplementation of `initials` (app/dotto/lib/friendsPresence.ts) — plain string logic with
// no vanilla-only dependency, same reasoning Avatar.jsx's own identical reimplementation already
// established (no window.__initials bridge exists by design).
function initials(name: string): string {
  return (name || "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ---------- Live canvas presence (Figma-style cursors) + real-time content sync ----------
// Distinct from #collab-bubble/#collab-panel (inviting a collaborator to a canvas) and
// #hub-collab-panel (the hamburger Collaborations list) — this is live presence for whoever is
// CURRENTLY looking at a canvas, not the invite/access-management UI (same kind of naming
// collision the codebase already disambiguates between hub-collab-panel and collab-panel).
//
// One realtime channel per (owner id, real folder id) pair — both the owner's own view and every
// collaborator's shared:owner:folderId view resolve to the identical channel name independently
// (see resolvePresenceFolderKey), so everyone currently on that exact canvas ends up on the same
// channel regardless of whose canvas it actually is. Reuses the exact same combined
// presence+broadcast-on-one-channel shape as subscribeToAllFriendMessages
// (app/dotto/lib/friendsPresence.ts).
//
// A small fixed indexed palette (appState.CURSOR_COLORS), keyed by hashing the user's own id
// rather than anything server-stored, so the same person always gets the same color across
// reloads/sessions with no extra storage needed.
function assignCursorColor(appState: AppState, userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return appState.CURSOR_COLORS[Math.abs(hash) % appState.CURSOR_COLORS.length];
}
// {ownerId, folderId} for whatever folder is currently open, whether it's this user's own or a
// shared:owner:folderId view — mirrors parseSharedFolderKey's own logic so every viewer of the
// exact same real canvas computes the identical channel name independently.
function resolvePresenceFolderKey(appState: AppState): { ownerId: string; folderId: string } {
  if (appState.currentFolderId.startsWith("shared:")) {
    const parsed = window.__parseSharedFolderKey?.(appState.currentFolderId);
    return { ownerId: parsed?.ownerId ?? "", folderId: parsed?.remoteFolderId ?? "" };
  }
  return { ownerId: appState.currentUser.id ?? "", folderId: appState.currentFolderId };
}

function teardownCanvasPresenceChannel(): void {
  const appState = getAppState();
  if (!appState) return;
  if (appState.canvasPresenceChannel)
    window.__dottoSupabase?.removeChannel(appState.canvasPresenceChannel);
  appState.canvasPresenceChannel = null;
  appState.canvasPresenceKey = null;
  appState.lastBroadcastSnapshot = null;
  appState.pendingSyncDeltas = null;
  appState.localEditingState = { editing: false, editingTarget: null, caret: null };
  clearTimeout(appState.syncBroadcastTimer);
  appState.remoteCursors.forEach((entry) => entry.el.remove());
  appState.remoteCursors.clear();
}
// Diffing/broadcasting always works in CANONICAL (un-namespaced) item form — never the local
// shared: wrapping a collaborator's own folders dict uses (see namespaceSharedFolderIds/
// stripSharedFolderIds) — so a broadcast is meaningful to every viewer regardless of whether
// they're the owner or a collaborator, and so the wrapping itself never gets diffed as if it were
// a real content change.
function canonicalItem(it: Item): Item {
  return (
    window.__stripSharedFolderIds?.([it as unknown as Record<string, unknown>]) as unknown as Item[]
  )[0];
}
function snapshotFolderForBroadcast(folderObj: FolderObj): {
  title?: string;
  items: Map<number, string>;
} {
  const items = new Map<number, string>();
  (folderObj.items || []).forEach((it) => items.set(it.id, JSON.stringify(canonicalItem(it))));
  return { title: folderObj.title, items };
}
// Called near the top of render() — already the one place every mutation across the entire app
// funnels through (every card kind, every field edit), so this never needs threading through the
// ~100+ individual mutation call sites elsewhere. No-ops unless the resolved (owner,folder) pair
// actually changed since the last call.
//
// paneId (split-screen Stage 3) — always called synchronously from whichever pane just mutated
// something, so appState.activePaneId is already correct at call time; the explicit parameter
// (rather than reading appState.activePaneId internally) exists purely so this function's own
// signature already matches queueSyncDiff/flushSyncDiff's below, which genuinely DO need it
// captured explicitly (see their own comments) — ahead of Stage 4+, when
// appState.canvasPresenceChannel and friends become real per-pane storage instead of a single
// shared slot, every caller here will already be passing the right paneId through.
export function ensureCanvasPresenceChannel(): void {
  const appState = getAppState();
  const folderObj = appState?.folders[appState.currentFolderId];
  const supabaseClient = window.__dottoSupabase;
  if (!supabaseClient || !appState?.currentUser.id || !folderObj) {
    teardownCanvasPresenceChannel();
    return;
  }
  // Only a shared: view (someone else's canvas) or an owned folder that currently has
  // collaborators is ever worth a live channel — a private canvas nobody else can reach gets no
  // realtime overhead at all.
  const eligible =
    folderObj.isSharedView || (folderObj.collaborators && folderObj.collaborators.length > 0);
  if (!eligible) {
    teardownCanvasPresenceChannel();
    return;
  }
  const { ownerId, folderId } = resolvePresenceFolderKey(appState);
  const key = `${ownerId}:${folderId}`;
  if (key === appState.canvasPresenceKey) return;
  teardownCanvasPresenceChannel();
  appState.canvasPresenceKey = key;
  appState.lastBroadcastSnapshot = snapshotFolderForBroadcast(folderObj);
  const channel = supabaseClient
    .channel(`presence:${ownerId}:${folderId}`, {
      config: { presence: { key: appState.currentUser.id } },
    })
    .on("presence", { event: "sync" }, () => handleCanvasPresenceSync(channel))
    .on("presence", { event: "leave" }, ({ key: leftUserId }: { key: string }) =>
      removeRemoteCursor(leftUserId),
    )
    // A newly-joined collaborator has no way to know we're already mid-edit (the 'editing'
    // broadcast below only fires on a state CHANGE, not to catch up latecomers) — so if we're
    // actively editing when someone else joins, resend our current state just for them. Cheap
    // (only fires while genuinely editing) and self-contained.
    .on("presence", { event: "join" }, ({ key: joinedUserId }: { key: string }) => {
      const st = getAppState();
      if (st && joinedUserId !== st.currentUser.id && st.localEditingState.editing) {
        channel.send({
          type: "broadcast",
          event: "editing",
          payload: {
            userId: st.currentUser.id,
            editing: true,
            editingTarget: st.localEditingState.editingTarget,
            caret: st.localEditingState.caret || computeLocalCaret(),
          },
        });
      }
    })
    .on("broadcast", { event: "cursor" }, ({ payload }: { payload: unknown }) =>
      handleRemoteCursorBroadcast(payload),
    )
    .on("broadcast", { event: "item-drag" }, ({ payload }: { payload: unknown }) =>
      handleRemoteItemDrag(payload),
    )
    .on("broadcast", { event: "item-resize" }, ({ payload }: { payload: unknown }) =>
      handleRemoteItemResize(payload),
    )
    .on("broadcast", { event: "editing" }, ({ payload }: { payload: unknown }) =>
      handleRemoteEditingBroadcast(payload),
    )
    .on("broadcast", { event: "caret" }, ({ payload }: { payload: unknown }) =>
      handleRemoteCaretBroadcast(payload),
    )
    .on("broadcast", { event: "selection" }, ({ payload }: { payload: unknown }) =>
      handleRemoteSelectionBroadcast(payload),
    )
    .on("broadcast", { event: "sync" }, ({ payload }: { payload: unknown }) =>
      applyRemoteSyncBroadcast(payload),
    )
    .subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        // Identity only — never re-tracked after this. Editing state deliberately lives entirely
        // in broadcasts (see broadcastEditingState) instead, since presence.track() re-calls
        // proved unreliable for fast-changing state: confirmed live (2-client Realtime test) that
        // re-tracking the same key can leave stale older metas sitting alongside the fresh one in
        // presenceState() indefinitely, with no reliable way to tell which is current. Identity
        // fields never change after this single initial track(), so that ambiguity never matters
        // here.
        const st = getAppState();
        if (!st) return;
        channel.track({
          displayName: st.currentUser.displayName,
          avatarId: st.currentUser.avatarId ?? 0,
          avatarUrl: st.currentUser.avatarUrl || null,
          color: assignCursorColor(st, st.currentUser.id as string),
        });
      }
    });
  appState.canvasPresenceChannel = channel;
}

// ---- Cursors: presence (identity/join/leave only — editing state is pure broadcast, see
// broadcastEditingState) + broadcast (high-frequency position/caret/editing) ----
function handleCanvasPresenceSync(channel: PresenceChannel): void {
  const appState = getAppState();
  if (!appState) return;
  const state = channel.presenceState() as Record<
    string,
    { color?: string; displayName?: string; avatarId?: number; avatarUrl?: string | null }[]
  >;
  const seenIds = new Set<string>();
  const cursorOverlay = window.__getCursorOverlayEl?.();
  Object.keys(state).forEach((userId) => {
    if (userId === appState.currentUser.id) return; // never render our own cursor
    seenIds.add(userId);
    const metas = state[userId];
    const meta = metas[metas.length - 1];
    if (!meta || !cursorOverlay) return;
    let entry = appState.remoteCursors.get(userId);
    if (!entry) {
      const el = document.createElement("div");
      el.className = "remote-cursor";
      el.innerHTML = `<svg class="remote-cursor-pointer" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15 L12 22 L15 20.5 L12 13.5 L19 13.5 Z"/></svg>
                <div class="remote-cursor-label"><span class="remote-cursor-avatar"></span><span class="remote-cursor-name"></span></div>`;
      cursorOverlay.appendChild(el);
      entry = {
        el,
        x: 0,
        y: 0,
        editingTarget: null,
        highlightedEl: null,
        typingCaretEl: null,
        typingLabelEl: null,
        caretX: null,
        caretY: null,
        caretHeight: null,
        selectionRects: [],
        selectionEls: [],
        isTyping: false,
        travelTimer: null,
      };
      appState.remoteCursors.set(userId, entry);
    }
    entry.color = meta.color || "#999";
    entry.displayName = meta.displayName;
    entry.avatarId = meta.avatarId;
    entry.avatarUrl = meta.avatarUrl;
    entry.el.style.color = entry.color;
    (entry.el.querySelector(".remote-cursor-name") as HTMLElement).textContent =
      entry.displayName || "";
    window.__renderAvatarInto?.(
      entry.el.querySelector(".remote-cursor-avatar") as HTMLElement,
      { id: entry.avatarId ?? 0, url: entry.avatarUrl || null },
      initials(entry.displayName || "?"),
    );
    applyRemoteCursorMode(entry);
  });
  appState.remoteCursors.forEach((entry, userId) => {
    if (!seenIds.has(userId)) removeRemoteCursor(userId);
  });
}
// The single place that decides, fresh every time it runs, whether a remote collaborator shows as
// a normal floating cursor or as an in-place "typing here" indicator — the two are mutually
// exclusive, matching Figma-style presence (you see their cursor most of the time; the moment they
// start typing anywhere, it's replaced by their name+avatar above a blinking colored caret pinned
// to the exact field, then reverts the instant they stop). Always fully re-derived (never
// incrementally patched) — called from presence sync, render() (edit targets get rebuilt from
// scratch), and applyTransform() (everything here is screen-space positioned) — so it can't get
// stuck showing a stale state if a step gets missed somewhere.
function applyRemoteCursorMode(entry: RemoteCursorEntry): void {
  const target = entry.editingTarget
    ? document.querySelector<HTMLElement>(entry.editingTarget)
    : null;
  const isTyping = !!target;
  // Only a REAL mode flip (not just this same mode being repositioned again — e.g. every frame
  // while the LOCAL user pans/zooms, via repositionAllRemoteCursors) should trigger the travel
  // animation below; comparing against the last mode is what tells the two apart.
  const modeChanged = entry.isTyping !== isTyping;
  entry.isTyping = isTyping;
  if (isTyping) {
    showRemoteTypingIndicator(entry, target, modeChanged);
    if (modeChanged) entry.el.style.display = "none";
  } else {
    if (modeChanged) travelCursorBackToPointer(entry);
    else {
      entry.el.style.display = "";
      positionRemoteCursor(entry);
    }
    hideRemoteTypingIndicator(entry);
  }
  // Independent of the cursor-vs-typing-indicator mode above — a live text selection can coexist
  // with either (selecting text also focuses the field, so entry.editingTarget is usually set
  // too, but this doesn't rely on that either way).
  positionSelectionHighlight(entry);
}
// Renders/repositions the tinted highlight rect(s) for a remote collaborator's live text selection
// — one <div> per entry.selectionRects entry (Range.getClientRects() can return several, one per
// visual line a selection spans), reused across updates rather than recreated every broadcast/
// reposition. Colored via entry.color (see assignCursorColor) — same currentColor convention as
// .remote-cursor/.remote-typing-caret — through background:currentColor + fixed opacity in CSS
// (see .remote-selection-highlight).
function positionSelectionHighlight(entry: RemoteCursorEntry): void {
  const appState = getAppState();
  const cursorOverlay = window.__getCursorOverlayEl?.();
  if (!appState || !cursorOverlay) return;
  const rects = entry.selectionRects || [];
  while (entry.selectionEls.length < rects.length) {
    const el = document.createElement("div");
    el.className = "remote-selection-highlight";
    cursorOverlay.appendChild(el);
    entry.selectionEls.push(el);
  }
  while (entry.selectionEls.length > rects.length) {
    entry.selectionEls.pop()?.remove();
  }
  entry.selectionEls.forEach((el, i) => {
    const r = rects[i];
    el.style.color = entry.color || "";
    el.style.left = appState.tx + r.x * appState.scale + "px";
    el.style.top = appState.ty + r.y * appState.scale + "px";
    el.style.width = r.w * appState.scale + "px";
    el.style.height = r.h * appState.scale + "px";
  });
}
// travel: true only on a genuine cursor->typing mode flip (see applyRemoteCursorMode), never on a
// same-mode reposition — makes the indicator visibly glide in from wherever the floating cursor
// last was, instead of popping straight to its destination.
function showRemoteTypingIndicator(
  entry: RemoteCursorEntry,
  target: HTMLElement | null,
  travel: boolean,
): void {
  const appState = getAppState();
  const cursorOverlay = window.__getCursorOverlayEl?.();
  if (!appState || !cursorOverlay) return;
  const isNew = !entry.typingCaretEl;
  if (!entry.typingCaretEl) {
    entry.typingCaretEl = document.createElement("div");
    entry.typingCaretEl.className = "remote-typing-caret";
    cursorOverlay.appendChild(entry.typingCaretEl);
  }
  if (!entry.typingLabelEl) {
    entry.typingLabelEl = document.createElement("div");
    entry.typingLabelEl.className = "remote-editing-label";
    entry.typingLabelEl.innerHTML = `<span class="remote-cursor-avatar"></span><span class="remote-cursor-name"></span>`;
    cursorOverlay.appendChild(entry.typingLabelEl);
  }
  // Tracked by direct element reference (not just re-queried from the selector later) so
  // goToCollaboratorCursor can jump to it — no persistent outline/border is drawn on it anymore
  // (per explicit request: the block itself should stay plain; only the blinking caret + name/
  // avatar pill indicate typing, positioned at the real caret, not the block).
  entry.highlightedEl = target;
  entry.typingCaretEl.style.color = entry.color || "";
  entry.typingLabelEl.style.color = entry.color || "";
  (entry.typingLabelEl.querySelector(".remote-cursor-name") as HTMLElement).textContent =
    entry.displayName || "";
  window.__renderAvatarInto?.(
    entry.typingLabelEl.querySelector(".remote-cursor-avatar") as HTMLElement,
    { id: entry.avatarId ?? 0, url: entry.avatarUrl || null },
    initials(entry.displayName || "?"),
  );
  if (travel && isNew) {
    // Snap both straight to wherever the floating cursor just was (no transition yet —
    // .remote-presence-travel isn't applied until after this instant jump is committed), then
    // let positionTypingIndicator below move them to their REAL target under that class, which
    // is what actually animates. Without this, a freshly-created element has no "previous"
    // position for the CSS transition to animate FROM, so it would just appear at the
    // destination immediately regardless of the transition being set.
    entry.typingCaretEl.style.display = "";
    entry.typingLabelEl.style.display = "";
    entry.typingCaretEl.style.left = entry.el.style.left;
    entry.typingCaretEl.style.top = entry.el.style.top;
    entry.typingLabelEl.style.left = entry.el.style.left;
    entry.typingLabelEl.style.top = entry.el.style.top;
    void entry.typingCaretEl.offsetWidth; // forces the snap above to paint before the class below re-enables a transition
    entry.typingCaretEl.classList.add("remote-presence-travel");
    entry.typingLabelEl.classList.add("remote-presence-travel");
    if (entry.travelTimer) clearTimeout(entry.travelTimer);
    entry.travelTimer = setTimeout(() => {
      if (entry.typingCaretEl) entry.typingCaretEl.classList.remove("remote-presence-travel");
      if (entry.typingLabelEl) entry.typingLabelEl.classList.remove("remote-presence-travel");
    }, appState.REMOTE_CURSOR_TRAVEL_MS);
  }
  positionTypingIndicator(entry, target ?? undefined);
}
// Split out from showRemoteTypingIndicator so an incoming 'caret' broadcast (see
// handleRemoteCaretBroadcast) can reposition the existing indicator without recreating it or
// re-touching the label's text/avatar — called on every caret move while still editing, not just
// once on entering typing mode.
function positionTypingIndicator(entry: RemoteCursorEntry, target?: HTMLElement): void {
  const appState = getAppState();
  const canvasEl = window.__getCanvasEl?.();
  if (!appState || !canvasEl || !entry.typingCaretEl || !entry.typingLabelEl) return;
  target = target || entry.highlightedEl || undefined;
  let left: number, top: number, height: number;
  if (entry.caretX != null && entry.caretY != null) {
    // The typist's actual measured caret position (see getCaretScreenRect/
    // broadcastCaretPosition), converted through OUR OWN live tx/ty/scale — same projection
    // positionRemoteCursor uses for the floating cursor.
    left = appState.tx + entry.caretX * appState.scale;
    top = appState.ty + entry.caretY * appState.scale;
    height = entry.caretHeight != null ? Math.max(12, entry.caretHeight * appState.scale) : 18;
  } else if (target) {
    // No caret broadcast has landed yet (right after entering typing mode) — approximate with
    // the target's own top-left corner for one frame until the real position arrives.
    const canvasRect = canvasEl.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    left = targetRect.left - canvasRect.left + 2;
    top = targetRect.top - canvasRect.top + 2;
    height = Math.max(12, Math.min(20, targetRect.height - 4));
  } else {
    return;
  }
  entry.typingCaretEl.style.display = "";
  entry.typingCaretEl.style.left = left + "px";
  entry.typingCaretEl.style.top = top + "px";
  entry.typingCaretEl.style.height = height + "px";
  // display must be set before reading offsetWidth/offsetHeight below — both are 0 while
  // display:none, which would center on 0 (i.e. not center at all) on the very first paint.
  entry.typingLabelEl.style.display = "";
  entry.typingLabelEl.style.left = left - entry.typingLabelEl.offsetWidth / 2 + "px";
  entry.typingLabelEl.style.top = top - entry.typingLabelEl.offsetHeight - 4 + "px";
}
function hideRemoteTypingIndicator(entry: RemoteCursorEntry): void {
  entry.highlightedEl = null;
  entry.caretX = null;
  entry.caretY = null;
  entry.caretHeight = null;
  if (entry.typingCaretEl) {
    entry.typingCaretEl.remove();
    entry.typingCaretEl = null;
  }
  if (entry.typingLabelEl) {
    entry.typingLabelEl.remove();
    entry.typingLabelEl = null;
  }
}
function removeRemoteCursor(userId: string): void {
  const appState = getAppState();
  const entry = appState?.remoteCursors.get(userId);
  if (!entry) return;
  if (entry.travelTimer) clearTimeout(entry.travelTimer);
  if (entry.editingBlurTimer) clearTimeout(entry.editingBlurTimer);
  hideRemoteTypingIndicator(entry);
  entry.selectionEls.forEach((el) => el.remove());
  entry.el.remove();
  appState?.remoteCursors.delete(userId);
}
function positionRemoteCursor(entry: RemoteCursorEntry): void {
  const appState = getAppState();
  if (!appState) return;
  entry.el.style.left = appState.tx + entry.x * appState.scale + "px";
  entry.el.style.top = appState.ty + entry.y * appState.scale + "px";
}
// Mirror of showRemoteTypingIndicator's travel case, for the reverse (typing -> cursor) mode flip:
// snap the floating cursor to wherever the typing indicator currently sits (no transition), make
// it visible, then let positionRemoteCursor below move it to its REAL (live mouse) target under
// .remote-presence-travel — same "instant jump into place, THEN animate away" trick, so it reads
// as one continuous glide-and-morph rather than the caret vanishing and the cursor popping up
// already at the far side of the canvas.
function travelCursorBackToPointer(entry: RemoteCursorEntry): void {
  const appState = getAppState();
  if (!appState) return;
  entry.el.style.display = "";
  if (entry.typingCaretEl) {
    entry.el.classList.remove("remote-presence-travel");
    entry.el.style.left = entry.typingCaretEl.style.left;
    entry.el.style.top = entry.typingCaretEl.style.top;
    void entry.el.offsetWidth; // forces the snap above to paint before the class below re-enables a transition
    entry.el.classList.add("remote-presence-travel");
    if (entry.travelTimer) clearTimeout(entry.travelTimer);
    entry.travelTimer = setTimeout(
      () => entry.el.classList.remove("remote-presence-travel"),
      appState.REMOTE_CURSOR_TRAVEL_MS,
    );
  }
  positionRemoteCursor(entry);
}
// Called from applyTransform() too (see below) so every remote cursor/typing-indicator stays
// visually anchored to the right spot while YOU pan/zoom, not just when a new broadcast/sync
// arrives.
export function repositionAllRemoteCursors(): void {
  const appState = getAppState();
  appState?.remoteCursors.forEach(applyRemoteCursorMode);
}
// Pans to wherever a collaborator's cursor currently is — clicking their name in the collaborator
// panel (#collab-panel, see renderCollabList) does this so you can see what they're doing.
// remoteCursors only has an entry for someone currently present on THIS exact canvas (see
// handleCanvasPresenceSync) — a no-op if they're not, since there's nowhere real to jump to.
export function goToCollaboratorCursor(userId: string): void {
  const appState = getAppState();
  const entry = appState?.remoteCursors.get(userId);
  const canvasEl = window.__getCanvasEl?.();
  if (!appState || !entry || !canvasEl) return;
  window.__closeCollabPanel?.();
  const targetScale = Math.max(appState.scale, 1);
  const centerX = window.__canvasViewportCenterX?.() ?? 0;
  if (entry.highlightedEl) {
    // Currently typing somewhere — jump to what they're actually editing, not their last known
    // mouse position (irrelevant right now, since the cursor itself is hidden while they're
    // typing — see applyRemoteCursorMode).
    const rect = entry.highlightedEl.getBoundingClientRect();
    const canvasRect = canvasEl.getBoundingClientRect();
    const cx = (rect.left + rect.width / 2 - canvasRect.left - appState.tx) / appState.scale;
    const cy = (rect.top + rect.height / 2 - canvasRect.top - appState.ty) / appState.scale;
    window.__smoothPanTo?.(
      centerX - cx * targetScale,
      window.innerHeight / 2 - cy * targetScale,
      targetScale,
    );
    // A one-off navigation flash, distinct from (and not drawn during) normal typing — the block
    // itself otherwise stays plain per the current design, so the color is set just for this
    // brief animation rather than left on the element.
    const flashEl = entry.highlightedEl;
    flashEl.style.setProperty("--remote-edit-color", entry.color || "");
    flashEl.classList.add("remote-editing-highlight--flash");
    setTimeout(() => {
      flashEl.classList.remove("remote-editing-highlight--flash");
      flashEl.style.removeProperty("--remote-edit-color");
    }, 1200);
  } else {
    window.__smoothPanTo?.(
      centerX - entry.x * targetScale,
      window.innerHeight / 2 - entry.y * targetScale,
      targetScale,
    );
  }
}
function handleRemoteCursorBroadcast(payload: unknown): void {
  const appState = getAppState();
  const p = payload as { userId?: string; x: number; y: number } | null;
  if (!appState || !p || p.userId === appState.currentUser.id) return;
  const entry = appState.remoteCursors.get(p.userId as string);
  if (!entry) return; // presence sync hasn't created their node yet — the next broadcast will land once it has
  entry.x = p.x;
  entry.y = p.y;
  positionRemoteCursor(entry);
}
// Live, purely-visual position streaming while someone else is actively dragging a card — see the
// throttled send in setupDraggingAndClicking's own `move` handler below. Deliberately DOM-only:
// this never touches folders[currentFolderId].items itself, so it can't race with (or get
// overwritten by) anything else touching the real data model. The item's actual position only
// gets durably committed once the dragger releases and their own render() call picks it up as a
// normal item-upsert through the existing content-sync diff (see queueSyncDiff/
// applyRemoteSyncBroadcast) — this is just what makes the drag itself visible in between, instead
// of the card only jumping to its new spot once dropped.
function handleRemoteItemDrag(payload: unknown): void {
  const appState = getAppState();
  const p = payload as { userId?: string; items?: { id: number; x: number; y: number }[] } | null;
  if (!appState || !p || p.userId === appState.currentUser.id || !Array.isArray(p.items)) return;
  p.items.forEach(({ id, x, y }) => {
    const el = window.__findItemEl?.(id);
    if (!el) return;
    el.style.left = x + "px";
    el.style.top = y + "px";
  });
}
// lastPointerClientX/Y track raw SCREEN position, updated on every real pointermove regardless of
// the broadcast throttle below — needed because panning without moving the mouse (trackpad
// two-finger scroll, ctrl+scroll zoom, the zoom slider, any animated smoothPanTo jump) changes
// which canvas-space point sits under a perfectly stationary on-screen cursor. Re-broadcasting
// from applyTransform() (see below) using these, rather than only on 'pointermove', is what keeps
// a collaborator's cursor tracking live WHILE someone pans instead of appearing frozen until they
// next actually move the mouse.
export function broadcastCursorPositionThrottled(): void {
  const appState = getAppState();
  const canvasEl = window.__getCanvasEl?.();
  if (
    !appState ||
    !canvasEl ||
    !appState.canvasPresenceChannel ||
    appState.lastPointerClientX == null ||
    appState.cursorBroadcastThrottleId
  )
    return;
  appState.cursorBroadcastThrottleId = setTimeout(() => {
    appState.cursorBroadcastThrottleId = null;
  }, 50);
  const rect = canvasEl.getBoundingClientRect();
  appState.canvasPresenceChannel.send({
    type: "broadcast",
    event: "cursor",
    payload: {
      userId: appState.currentUser.id,
      x: ((appState.lastPointerClientX as number) - rect.left - appState.tx) / appState.scale,
      y: ((appState.lastPointerClientY as number) - rect.top - appState.ty) / appState.scale,
    },
  });
}
// Re-attached per pane (split-screen Stage 4: see registerPaneCanvasListenerSetup, app/dotto/lib/coreState.ts),
// same as the placement-ghost tracker (app/dotto/lib/copyPaste.ts), so cursor tracking doesn't
// just stop working when hovering a pane other than pane 0. Deliberately does NOT call
// switchActivePane here — canvasPresenceChannel/appState.tx/etc are still single global fields
// (Stage 3 explicitly deferred genuinely concurrent per-pane presence to real Stage 4+ feature
// work), and silently activating a pane on mere hover — no click — would be a real, separate UX
// decision, not something to make unilaterally inside a cursor-tracking listener.
function setupCursorTracking(canvasEl: HTMLElement): void {
  canvasEl.addEventListener("pointermove", (e) => {
    const appState = getAppState();
    if (!appState) return;
    appState.lastPointerClientX = e.clientX;
    appState.lastPointerClientY = e.clientY;
    broadcastCursorPositionThrottled();
  });
}
// Streams a dragged card's LIVE position to everyone else on this canvas (see the `move` handler
// in setupDraggingAndClicking) — same throttle shape as the cursor broadcast above, so a drag
// reads as smooth, continuous movement on other screens rather than a jump-to-final-position once
// dropped. Purely visual on the receiving end (see handleRemoteItemDrag) — the position only
// becomes durable once the drop itself triggers a normal render()/content-sync.
export function broadcastItemDragPositions(startPositions: { id: number }[]): void {
  const appState = getAppState();
  if (!appState || !appState.canvasPresenceChannel || appState.itemDragBroadcastThrottleId) return;
  appState.itemDragBroadcastThrottleId = setTimeout(() => {
    appState.itemDragBroadcastThrottleId = null;
  }, 50);
  const items = startPositions
    .map((pos) => {
      const it = findItemById(pos.id);
      return it ? { id: it.id, x: it.x, y: it.y } : null;
    })
    .filter((x): x is { id: number; x: number; y: number } => !!x);
  if (!items.length) return;
  appState.canvasPresenceChannel.send({
    type: "broadcast",
    event: "item-drag",
    payload: { userId: appState.currentUser.id, items },
  });
}
// Live, purely-visual size streaming while someone else is actively dragging a card's resize
// handle — see the throttled send in setupResizing's own `move` handler below. Same DOM-only shape
// as handleRemoteItemDrag: the item's actual w/h only becomes durable once the drag ends and
// scheduleWorkspaceSave's normal content-sync diff picks it up.
function handleRemoteItemResize(payload: unknown): void {
  const appState = getAppState();
  const p = payload as { userId?: string; id: number; w: number; h: number } | null;
  if (!appState || !p || p.userId === appState.currentUser.id) return;
  const el = window.__findItemEl?.(p.id);
  if (!el) return;
  el.style.width = p.w + "px";
  // Notes never get an explicit height, even here — it's always automatic (see
  // applyItemWrapperAttrs, app/dotto/lib/waypointsRenderLoop.ts) — pinning one on a remote collaborator's
  // screen while the owner drags would fight that and either clip content or leave a gap until
  // something else happened to clear it.
  if (!el.classList.contains("note")) el.style.height = p.h + "px";
}
export function broadcastItemResize(id: number, w: number, h: number): void {
  const appState = getAppState();
  if (!appState || !appState.canvasPresenceChannel || appState.itemResizeBroadcastThrottleId)
    return;
  appState.itemResizeBroadcastThrottleId = setTimeout(() => {
    appState.itemResizeBroadcastThrottleId = null;
  }, 50);
  appState.canvasPresenceChannel.send({
    type: "broadcast",
    event: "item-resize",
    payload: { userId: appState.currentUser.id, id, w, h },
  });
}
// Applies an incoming 'editing' broadcast — see broadcastEditingState for why this is a plain
// broadcast rather than presence.track(). The broadcast itself now carries the caret position
// measured at the exact moment editing started (see computeLocalCaret), not just the target
// selector — previously the indicator had no caret position at all until the NEXT keystroke's
// separate 'caret' broadcast landed, so it visibly appeared at the wrong (target top-left) spot
// for a beat and then jumped once real typing began. Carrying it in the same message means the
// very first paint is already in the right place.
function handleRemoteEditingBroadcast(payload: unknown): void {
  const appState = getAppState();
  const p = payload as {
    userId?: string;
    editing: boolean;
    editingTarget?: string;
    caret?: { x: number; y: number; height: number };
  } | null;
  if (!appState || !p || p.userId === appState.currentUser.id) return;
  const entry = appState.remoteCursors.get(p.userId as string);
  if (!entry) return; // presence sync hasn't created their node yet — the join-time catch-up resend covers this once it has
  if (entry.editingBlurTimer) clearTimeout(entry.editingBlurTimer);
  if (p.editing) {
    entry.editingTarget = p.editingTarget || null;
    if (p.caret) {
      entry.caretX = p.caret.x;
      entry.caretY = p.caret.y;
      entry.caretHeight = p.caret.height;
    } else {
      entry.caretX = null;
      entry.caretY = null;
      entry.caretHeight = null;
    }
    applyRemoteCursorMode(entry);
  } else {
    // Don't drop back to the floating cursor immediately — a blur is very often followed almost
    // right away by a focus on a DIFFERENT field (tabbing/clicking between table cells), and
    // applying this instantly would flash the floating cursor (with its own travel animation,
    // see applyRemoteCursorMode) in between the two, for a switch that should just read as a
    // direct jump from the old field to the new one. This short grace period lets a fast-
    // following 'editing:true' cancel it (via the clearTimeout above) before it ever takes
    // effect.
    entry.editingBlurTimer = setTimeout(() => {
      entry.editingTarget = null;
      entry.caretX = null;
      entry.caretY = null;
      entry.caretHeight = null;
      applyRemoteCursorMode(entry);
    }, 150);
  }
}
function handleRemoteCaretBroadcast(payload: unknown): void {
  const appState = getAppState();
  const p = payload as { userId?: string; x: number; y: number; height: number } | null;
  if (!appState || !p || p.userId === appState.currentUser.id) return;
  const entry = appState.remoteCursors.get(p.userId as string);
  if (!entry || !entry.editingTarget) return;
  entry.caretX = p.x;
  entry.caretY = p.y;
  entry.caretHeight = p.height;
  positionTypingIndicator(entry);
}
function handleRemoteSelectionBroadcast(payload: unknown): void {
  const appState = getAppState();
  const p = payload as {
    userId?: string;
    rects?: { x: number; y: number; w: number; h: number }[];
  } | null;
  if (!appState || !p || p.userId === appState.currentUser.id) return;
  const entry = appState.remoteCursors.get(p.userId as string);
  if (!entry) return; // presence sync hasn't created their node yet — the next broadcast will land once it has
  entry.selectionRects = Array.isArray(p.rects) ? p.rects : [];
  positionSelectionHighlight(entry);
}
// Measures where the blinking caret should actually sit — the real caret position within a
// contentEditable field via the Selection Range API (falling back to a temporary zero-width
// marker node when the collapsed range yields no client rect, e.g. an empty line — a standard
// workaround for that DOM quirk), or an approximate proportional position within a plain <input>
// (Typeright's answer box), where Selection ranges don't apply the same way.
function getCaretScreenRect(el: HTMLElement): { left: number; top: number; height: number } {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0,
      padR = parseFloat(cs.paddingRight) || 0;
    const val = (el as HTMLInputElement).value || "";
    const pos =
      (el as HTMLInputElement).selectionEnd != null
        ? (el as HTMLInputElement).selectionEnd!
        : val.length;
    const ratio = val.length ? pos / val.length : 0;
    return {
      left: rect.left + padL + (rect.width - padL - padR) * ratio,
      top: rect.top,
      height: rect.height,
    };
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (el.contains(range.startContainer)) {
      const r = range.cloneRange();
      // Collapse to the END, not the start — for a real (non-collapsed) selection, the typing
      // indicator/caret should land at the end of the highlighted segment, same place a native
      // caret would sit after you finish dragging a selection. A no-op for an already-collapsed
      // range (start === end), so this doesn't affect plain typing.
      r.collapse(false);
      const rects = r.getClientRects();
      if (rects.length) return rects[0];
      const marker = document.createElement("span");
      marker.textContent = "​";
      r.insertNode(marker);
      const rect = marker.getBoundingClientRect();
      const parent = marker.parentNode as Node;
      parent.removeChild(marker);
      (parent as HTMLElement).normalize?.();
      return rect;
    }
  }
  return el.getBoundingClientRect();
}
// Measures the caret position for whatever's currently being edited (see localEditingState), in
// the same canvas-space coordinates handleRemoteCursorBroadcast/positionRemoteCursor use. Returns
// null if there's nothing to measure (not editing, or the target's gone from the DOM).
function computeLocalCaret(): { x: number; y: number; height: number } | null {
  const appState = getAppState();
  const canvasEl = window.__getCanvasEl?.();
  if (!appState || !canvasEl || !appState.localEditingState.editingTarget) return null;
  const el = document.querySelector<HTMLElement>(appState.localEditingState.editingTarget);
  if (!el) return null;
  const rect = getCaretScreenRect(el);
  const canvasRect = canvasEl.getBoundingClientRect();
  return {
    x: (rect.left - canvasRect.left - appState.tx) / appState.scale,
    y: (rect.top - canvasRect.top - appState.ty) / appState.scale,
    height: rect.height / appState.scale,
  };
}
// Re-measures and broadcasts the caret position on every subsequent selectionchange (typing,
// arrow keys, clicking elsewhere within the same field all move the caret and fire it) via the
// throttled listener below — the INITIAL position at edit-start is instead carried directly in
// the 'editing' broadcast itself (see broadcastEditingState), so this only ever needs to cover
// movement AFTER that first paint.
function broadcastCaretPosition(): void {
  const appState = getAppState();
  if (!appState || !appState.canvasPresenceChannel) return;
  const caret = computeLocalCaret();
  if (!caret) return;
  appState.localEditingState.caret = caret;
  appState.canvasPresenceChannel.send({
    type: "broadcast",
    event: "caret",
    payload: { userId: appState.currentUser.id, ...caret },
  });
}
// Measures the current live text SELECTION (not just the caret) within whatever's being edited —
// same canvas-space coordinates/projection as computeLocalCaret, but one rect per visual line the
// selection spans (Range.getClientRects(), plural — a real selection can wrap across multiple
// lines) rather than a single collapsed point. Returns an empty array when there's nothing to
// highlight (no selection, collapsed to a caret, or somehow outside the current editing target) —
// broadcastLocalSelection still sends that empty array rather than skipping the send, so a
// collaborator's screen reliably clears a previously-shown highlight the instant the selection
// collapses, not just when a new one appears.
function computeLocalSelectionRects(): { x: number; y: number; w: number; h: number }[] {
  const appState = getAppState();
  const canvasEl = window.__getCanvasEl?.();
  if (!appState || !canvasEl || !appState.localEditingState.editingTarget) return [];
  const el = document.querySelector<HTMLElement>(appState.localEditingState.editingTarget);
  if (!el) return [];
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return [];
  const canvasRect = canvasEl.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((r) => ({
    x: (r.left - canvasRect.left - appState.tx) / appState.scale,
    y: (r.top - canvasRect.top - appState.ty) / appState.scale,
    w: r.width / appState.scale,
    h: r.height / appState.scale,
  }));
}
// Broadcasts the current user's own live text selection so every collaborator sees the exact
// range highlighted, tinted in this user's assigned color (see assignCursorColor) — the selection
// equivalent of the caret/typing indicator above, rendered on the receiving end by
// handleRemoteSelectionBroadcast/positionSelectionHighlight.
function broadcastLocalSelection(): void {
  const appState = getAppState();
  if (!appState || !appState.canvasPresenceChannel) return;
  appState.canvasPresenceChannel.send({
    type: "broadcast",
    event: "selection",
    payload: { userId: appState.currentUser.id, rects: computeLocalSelectionRects() },
  });
}
// Broadcasts (not tracks — see the SUBSCRIBED callback above for why) an editing-state change —
// called from every inline text-edit start/end pair (waypoint rename, breadcrumb title rename,
// note/title/watermark body editing, table cells, game inputs) so a remote viewer sees this
// replace their floating cursor with an in-place typing indicator while any of those are focused,
// and revert back the instant it's blurred (see applyRemoteCursorMode). A no-op wherever there's
// no active presence channel (a private, non-shared canvas), so nothing needs to guard these
// calls itself.
//
// targetSelector (optional) is a CSS selector identifying the EXACT element being typed into —
// e.g. "#item-123" for a whole card, or '#item-123 .cell-text[data-r="2"][data-c="1"]' for one
// specific table cell — used to show a blinking caret + name/avatar label at that element's actual
// caret position (see showRemoteTypingIndicator/getCaretScreenRect), instead of the normal
// floating cursor. Omit it for edits that aren't a real canvas element worth pinning to (e.g. the
// breadcrumb title, which lives in the top bar, not on the canvas) — that case just keeps showing
// the plain floating cursor throughout.
//
// Real inline onfocus/onblur target (canvasItemBehavior.js's cell markup) — plain global, no
// underscore.
export function broadcastEditingState(isEditing: boolean, targetSelector?: string): void {
  const appState = getAppState();
  if (!appState) return;
  appState.localEditingState = {
    editing: isEditing,
    editingTarget: isEditing ? targetSelector || null : null,
    caret: null,
  };
  // Measured synchronously, in the SAME tick focus/placeCaretEnd already ran in at each call
  // site, and sent as part of this very message — see computeLocalCaret's caller comment for why
  // this (not a follow-up 'caret' broadcast) is what fixes the initial-position jump.
  if (isEditing && appState.localEditingState.editingTarget)
    appState.localEditingState.caret = computeLocalCaret();
  if (!appState.canvasPresenceChannel) return;
  appState.canvasPresenceChannel.send({
    type: "broadcast",
    event: "editing",
    payload: {
      userId: appState.currentUser.id,
      editing: isEditing,
      editingTarget: appState.localEditingState.editingTarget,
      caret: appState.localEditingState.caret,
    },
  });
  // Blurring normally collapses/moves the selection too (which the selectionchange listener
  // above would already catch), but that's not guaranteed for every call site — explicit and
  // immediate here so a collaborator's screen never has to wait for a maybe-not-firing event to
  // clear a stale highlight.
  if (!isEditing) {
    appState.canvasPresenceChannel.send({
      type: "broadcast",
      event: "selection",
      payload: { userId: appState.currentUser.id, rects: [] },
    });
  }
}

// ---- Content sync: diff-and-broadcast on render(), not per-mutation-site instrumentation ----
// Every mutation in the app already ends in a render() call — rather than threading a broadcast
// through the ~100+ individual mutation sites across every card kind, this hooks into that one
// existing universal signal instead. Deliberately whole-item, last-write-wins, not a per-field
// merge/OT/CRDT — if two people edit the exact same item at the exact same moment, whichever
// change lands last simply overwrites the other. A real conflict-free merge would mean replacing
// the entire load/edit/save data model, a separate, much larger effort.
//
// NOTE (pre-existing, not introduced by this feature): new item ids come from this client's own
// local `idCounter++`, seeded from each user's own workspace row independently — two different
// people adding a new card to the same shared folder at nearly the same moment could in theory
// generate the same numeric id and collide once merged. This risk already existed today via the
// existing debounced update_shared_folder save; real-time sync just makes concurrent edits (and
// so this pre-existing edge case) more likely to actually happen. Worth a proper fix (namespaced/
// UUID ids) if it turns out to matter in practice — out of scope here.
export function queueSyncDiff(folderObj: FolderObj): void {
  const appState = getAppState();
  if (!appState || !appState.canvasPresenceChannel || !appState.lastBroadcastSnapshot) return;
  if (!appState.pendingSyncDeltas)
    appState.pendingSyncDeltas = { upserts: new Map(), deletes: new Set() };
  const seenIds = new Set<number>();
  (folderObj.items || []).forEach((rawIt) => {
    seenIds.add(rawIt.id);
    const it = canonicalItem(rawIt);
    const json = JSON.stringify(it);
    if (appState.lastBroadcastSnapshot!.items.get(it.id) !== json) {
      appState.pendingSyncDeltas!.upserts.set(it.id, it);
      appState.pendingSyncDeltas!.deletes.delete(it.id);
      appState.lastBroadcastSnapshot!.items.set(it.id, json);
    }
  });
  appState.lastBroadcastSnapshot.items.forEach((_json, id) => {
    if (!seenIds.has(id)) {
      appState.pendingSyncDeltas!.deletes.add(id);
      appState.pendingSyncDeltas!.upserts.delete(id);
      appState.lastBroadcastSnapshot!.items.delete(id);
    }
  });
  if (folderObj.title !== appState.lastBroadcastSnapshot.title) {
    appState.pendingSyncDeltas.title = folderObj.title;
    appState.lastBroadcastSnapshot.title = folderObj.title;
  }
  // Short debounce so a burst of render() calls from one user action (e.g. typing, which
  // re-renders per keystroke in some card kinds) coalesces into one broadcast instead of one per
  // keystroke.
  clearTimeout(appState.syncBroadcastTimer);
  appState.syncBroadcastTimer = setTimeout(() => flushSyncDiff(), 120);
}
function flushSyncDiff(): void {
  const appState = getAppState();
  if (!appState || !appState.canvasPresenceChannel || !appState.pendingSyncDeltas) return;
  const payload: { upserts: Item[]; deletes: number[]; title?: string } = {
    upserts: Array.from(appState.pendingSyncDeltas.upserts.values()),
    deletes: Array.from(appState.pendingSyncDeltas.deletes),
  };
  if (appState.pendingSyncDeltas.title !== undefined)
    payload.title = appState.pendingSyncDeltas.title;
  appState.pendingSyncDeltas = null;
  if (!payload.upserts.length && !payload.deletes.length && payload.title === undefined) return;
  appState.canvasPresenceChannel.send({ type: "broadcast", event: "sync", payload });
}
// Applies an incoming remote change directly into local state and re-renders — also updates
// lastBroadcastSnapshot to match (critical: this is what stops the render() this triggers from
// re-diffing this exact change as "new" and immediately echoing it straight back out).
function applyRemoteSyncBroadcast(payload: unknown): void {
  const appState = getAppState();
  const p = payload as { title?: string; upserts?: Item[]; deletes?: number[] } | null;
  const folderObj = appState?.folders[appState.currentFolderId];
  if (!appState || !folderObj || !p) return;
  let changed = false;
  if (p.title !== undefined && p.title !== folderObj.title) {
    folderObj.title = p.title;
    if (appState.lastBroadcastSnapshot) appState.lastBroadcastSnapshot.title = p.title;
    changed = true;
  }
  (p.upserts || []).forEach((canonicalRemoteItem) => {
    // Incoming items always arrive canonical (un-namespaced) — see queueSyncDiff. If THIS
    // client's own view of this folder is itself a shared: one, its local items need the same
    // local-only wrapping every other item here already has (see namespaceSharedFolderIds) to
    // stay internally consistent; the owner's own view uses the canonical form directly.
    const remoteItem = folderObj.isSharedView
      ? (window.__namespaceSharedFolderIds?.(folderObj.sharedOwnerId as string, [
          canonicalRemoteItem as unknown as Record<string, unknown>,
        ])?.[0] as unknown as Item)
      : canonicalRemoteItem;
    const idx = folderObj.items.findIndex((it) => it.id === remoteItem.id);
    if (idx === -1) folderObj.items.push(remoteItem);
    else folderObj.items[idx] = remoteItem;
    if (appState.lastBroadcastSnapshot)
      appState.lastBroadcastSnapshot.items.set(remoteItem.id, JSON.stringify(canonicalRemoteItem));
    changed = true;
  });
  (p.deletes || []).forEach((id) => {
    const idx = folderObj.items.findIndex((it) => it.id === id);
    if (idx !== -1) folderObj.items.splice(idx, 1);
    if (appState.lastBroadcastSnapshot) appState.lastBroadcastSnapshot.items.delete(id);
    changed = true;
  });
  if (changed) window.__render?.();
}

function doWire(): void {
  const canvasEl = window.__getCanvasEl?.();
  if (canvasEl) setupCursorTracking(canvasEl);
  window.__registerPaneCanvasListenerSetup?.(setupCursorTracking);
  document.addEventListener("selectionchange", () => {
    const appState = getAppState();
    if (
      !appState ||
      !appState.canvasPresenceChannel ||
      !appState.localEditingState.editing ||
      appState.caretBroadcastThrottleId
    )
      return;
    appState.caretBroadcastThrottleId = setTimeout(() => {
      appState.caretBroadcastThrottleId = null;
    }, 50);
    broadcastCaretPosition();
    broadcastLocalSelection();
  });
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — this needs
// window.__getCanvasEl/window.__registerPaneCanvasListenerSetup ready, same bridge-readiness-poll
// reasoning as every other Phase 4.4/4.5 wireX() port (the vanilla afterInteractive <Script>
// bundle that sets these can genuinely resolve after React's own mount). The selectionchange
// listener itself only touches `document`, so it's safe to attach unconditionally alongside the
// canvas-dependent half rather than needing its own separate readiness gate.
export function wireCanvasPresence(): () => void {
  if (window.__getCanvasEl && window.__registerPaneCanvasListenerSetup) {
    doWire();
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    if (window.__getCanvasEl && window.__registerPaneCanvasListenerSetup) {
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

// Vanilla -> React bridges — ai-assistant-suggestions.js/cards-misc.js/card-shortcuts.js/drawing-
// connections.js/history-autosave.js/hamburger-collab.js/friends-presence.js/drag-drop-chat.js/
// srs-connections-core.js/window-bridge.js/waypoints-render-loop.js all previously imported these
// directly. goToCollaboratorCursor/broadcastItemResize/broadcastItemDragPositions/findItemById/
// broadcastEditingState/placeCaretEnd were already established bridges (set here now instead of
// from this file's own vanilla original).
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__findItemById = findItemById;
  window.__placeCaretEnd = placeCaretEnd;
  window.__ensureCanvasPresenceChannel = ensureCanvasPresenceChannel;
  window.__repositionAllRemoteCursors = repositionAllRemoteCursors;
  window.__goToCollaboratorCursor = goToCollaboratorCursor;
  window.__broadcastCursorPositionThrottled = broadcastCursorPositionThrottled;
  window.__broadcastItemDragPositions = broadcastItemDragPositions;
  window.__broadcastItemResize = broadcastItemResize;
  window.__broadcastEditingState = broadcastEditingState;
  window.__queueSyncDiff = queueSyncDiff;
  // Plain (non-`__`) global too — broadcastEditingState is ALSO a real inline onfocus/onblur target
  // (canvasItemBehavior.js's cell markup), same shape window.pushNotification uses; kept alongside
  // the `__` bridge above since real callers elsewhere (app/dotto/lib/waypointsRenderLoop.ts's own
  // .onblur closures, reached via this bridge since it's a different lib file) need programmatic
  // access too, not just the inline-HTML-string form.
  window.broadcastEditingState = broadcastEditingState;
}
