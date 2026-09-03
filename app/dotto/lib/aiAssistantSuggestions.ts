// Phase 4.5 port of public/dotto/ai-assistant-suggestions.js: the AI search box (animated
// placeholder, live-suggestions, the AI panel's list/chat views), Dotbot's typewriter reveal +
// height-transition machinery shared by #search-dropdown/#search-chat-thread, and a few small
// helpers (countSourceEntries, findParentFolderId, isLatinScriptText, escapeHtml/stripHtml — the
// last two now owned by app/dotto/lib/textUtils.ts, real ES imports since this file no longer
// duplicates them).
//
// Genuinely circular with app/dotto/lib/hamburgerCollab.ts (renderChatsList) and
// app/dotto/lib/mnemonicSearchMatching.ts (commenceSearchOrMnemonic) — all three moved to
// app/dotto/lib together specifically so these become real ES imports instead of the vanilla-only
// workaround of separate files each importing the others at their own top level; none of the
// circular bindings are read at module-evaluation time (only inside function bodies), so this is
// safe the same way live-presence.js/shelf-search.js's own pre-existing circular import always
// was.

import { renderChatsList } from "./hamburgerCollab";
import { commenceSearchOrMnemonic } from "./mnemonicSearchMatching";
import { stripHtml } from "./textUtils";
import { updateCommandPalette } from "./commandPalette";

interface AppState {
  searchInput: HTMLTextAreaElement;
  searchCommandPalette: HTMLElement | null;
  searchDotbotAnswer: HTMLElement;
  searchTranslation: HTMLElement | null;
  searchDictionary: HTMLElement;
  searchExamples: HTMLElement;
  searchImageResult: HTMLElement | null;
  searchRecommended: HTMLElement | null;
  searchDropdown: HTMLElement | null;
  searchChatThread: HTMLElement | null;
  searchInputWrap: HTMLElement;
  aiPanel: HTMLElement | null;
  aiChatView: HTMLElement;
  aiListView: HTMLElement;
  aiListHeader: HTMLElement;
  railBtnAi: HTMLElement;
  NON_LATIN_SCRIPT_RE: RegExp;
  dotbotSuggestDebounceTimer: ReturnType<typeof setTimeout> | null;
  dotbotSuggestAbortController: AbortController | null;
  dotbotSearchGeneration: number;
  currentConversationId: string | null;
  currentFolderId: string;
  folders: Record<string, { isSource?: boolean; items: Item[] }>;
  activeRailView: string | null;
  tx: number;
  ty: number;
  scale: number;
  idCounter: number;
}

interface Item {
  id: number;
  kind: string;
  tableData?: string[][];
  [key: string]: unknown;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// "Entries" for a source card's count badge: data rows only (tableData[0] is the column-name
// header row, never a real entry), only rows with at least one non-blank cell.
export function countSourceEntries(folderId: string): number {
  const appState = getAppState();
  const f = appState.folders[folderId];
  const tableItem = f && (f.items || []).find((i) => i.kind === "table");
  if (!tableItem || !tableItem.tableData) return 0;
  return tableItem.tableData.slice(1).filter((row) => row.some((cell) => stripHtml(cell))).length;
}

// The TRUE structural parent of a folder — the folder that actually contains a folder/source card
// pointing at it — not "whatever we happened to navigate from before this" (that's
// historyStack/historyIndex, a separate, purely click-order concept used only for the back/forward
// buttons). Folders don't store their own parent, so this is a reverse lookup; used by the
// breadcrumb's ".." so it reflects real canvas hierarchy regardless of how you arrived here
// (drilling in, a waypoint jump, search, the hamburger menu, ...). Root has no parent (nothing
// ever points at it), so this naturally returns null for it.
export function findParentFolderId(folderId: string): string | null {
  const appState = getAppState();
  for (const fid in appState.folders) {
    const f = appState.folders[fid];
    if (
      (f.items || []).some(
        (it) => (it.kind === "folder" || it.kind === "source") && it.folderId === folderId,
      )
    )
      return fid;
  }
  return null;
}

// True when `s` is entirely Latin-script (+ digits/whitespace/common punctuation) -- used to
// suppress a dictionary/example transliteration line even if the model returns one anyway. The
// prompt already tells it to omit transliteration/romanization for already-Latin words (see
// lib/dotbot.js), but that is a request, not a guarantee -- this is a client-side backstop so a
// stray romaji-style line never shows up next to plain English/Spanish/French/etc. text,
// regardless of how reliably any given model actually follows that instruction.
export function isLatinScriptText(s: string): boolean {
  if (!s) return true;
  const appState = getAppState();
  return !appState.NON_LATIN_SCRIPT_RE.test(s);
}

export function speakerIconHTML(extraClass?: string): string {
  const url = "/assets/icons/speaker.png";
  return `<span class="${extraClass || ""} icon-mask" style="mask-image:url(${url});-webkit-mask-image:url(${url})"></span>`;
}

interface SentenceLike {
  text?: string;
  romanization?: string;
  translation?: string;
}

// Builds the {text, romanization, translation} elements for one example sentence — shared by the
// examples panel (buildExamplesCard) and the "example" blocks inside an in-depth
// grammar/explanation answer (see renderAnswerBlocks). Returns the elements rather than appending
// them anywhere, since each caller lays them out differently.
export function buildAlignedSentenceEls(s: SentenceLike): {
  textEl: HTMLElement;
  translitEl: HTMLElement | null;
  translationEl: HTMLElement | null;
} {
  const textEl = document.createElement("div");
  textEl.className = "dotbot-example-sentence";
  textEl.textContent = s.text || "";
  let translitEl: HTMLElement | null = null;
  if (s.romanization && !isLatinScriptText(s.text || "")) {
    translitEl = document.createElement("div");
    translitEl.className = "dotbot-example-translit";
    translitEl.textContent = s.romanization;
  }
  let translationEl: HTMLElement | null = null;
  if (s.translation && s.translation !== s.text) {
    translationEl = document.createElement("div");
    translationEl.className = "dotbot-example-translation";
    translationEl.textContent = s.translation;
  }
  return { textEl, translitEl, translationEl };
}

export function truncateCenter(str: string, max: number): string {
  if (str.length < max) return str;
  const tail = 4;
  const head = max - 3 - tail;
  return str.slice(0, head) + "..." + str.slice(str.length - tail);
}

// AI search's own state reset — called from closeRailView/openRailView (panelsHamburger.ts)
// whenever the AI view is the one actually being closed or navigated away from, never called
// directly by anything outside this file. Kept as a separate function from clearSearch() below
// specifically to avoid a clearSearch<->closeRailView call cycle: closeRailView needs to trigger
// this reset, and clearSearch needs to trigger closeRailView, so the reset logic itself can't live
// inside clearSearch (that direction would loop).
export function resetAiSearchState(): void {
  const appState = getAppState();
  // Ends the current thread for continuation purposes — the next message (whenever the AI view
  // next opens) starts a fresh conversation server-side. openSavedChat (the sidebar reopen flow)
  // sets this directly AFTER calling openSearchOverlay, which itself never triggers this reset
  // when simply opening, so it never fights with reopening a saved chat.
  appState.currentConversationId = null;
  appState.searchInput.value = "";
  window.__autoGrowSearchInput?.();
  appState.searchDotbotAnswer.innerHTML = "";
  appState.searchDotbotAnswer.style.display = "none";
  // #search-command-palette (CommandPalette.jsx) is portaled — React tracks real children there,
  // so a direct innerHTML write would desync its fiber tree from the actual DOM and risk a crash
  // on the next update. Every other panel here renders no JSX children of its own (returns null,
  // only ever touches its node from its own effect), so a direct clear is harmless for those —
  // see hideDotbotResultPanels' own comment for the full reasoning.
  window.__setCommandPalette?.(null);
  if (appState.searchTranslation) {
    appState.searchTranslation.innerHTML = "";
    appState.searchTranslation.style.display = "none";
  }
  appState.searchDictionary.innerHTML = "";
  appState.searchDictionary.style.display = "none";
  appState.searchExamples.innerHTML = "";
  appState.searchExamples.style.display = "none";
  if (appState.searchImageResult) {
    appState.searchImageResult.innerHTML = "";
    appState.searchImageResult.style.display = "none";
  }
  window.__setSearchSuggestions?.(null);
  if (appState.searchRecommended) {
    appState.searchRecommended.innerHTML = "";
    appState.searchRecommended.style.display = "none";
  }
  updateSearchDropdown();
  // updateSearchDropdown() just started (or was already mid-) a collapse transition on
  // #search-dropdown — but closeRailView (which called this) is about to hide the whole AI panel
  // right after, which would silently cancel that transition without ever firing 'transitionend'
  // (browsers don't dispatch it for a transition interrupted by an ancestor going display:none).
  // That means the handler which normally hands height back to 'auto' once a collapse finishes
  // never runs here, leaving #search-dropdown's height stuck at whatever explicit px value it was
  // at the moment of interruption — which then breaks `settled` detection (updateSearchDropdown
  // only recognizes '' / 'auto' as settled) for every future reveal, reusing whatever transition
  // happened to be live at THIS moment instead of the correct one. Force it back to a clean rest
  // state directly instead — there's no point letting a collapse animate toward something the user
  // is about to not see anyway, since the whole panel is disappearing regardless.
  if (appState.searchDropdown) {
    appState.searchDropdown.style.transition = "";
    appState.searchDropdown.style.height = "auto";
    appState.searchDropdown.style.opacity = "1";
    appState.searchDropdown.style.overflow = "visible";
  }
  // Same fix, same reasoning, for #search-chat-thread — restOverflow is 'auto' here (not
  // 'visible' like #search-dropdown above) to match its own rest-state convention.
  if (appState.searchChatThread) {
    appState.searchChatThread.style.transition = "";
    appState.searchChatThread.style.height = "auto";
    appState.searchChatThread.style.opacity = "1";
    appState.searchChatThread.style.overflow = "auto";
    appState.searchChatThread.classList.remove("visible", "thread-settled");
  }
  window.__setChatThread?.([]);
  showAiListView(); // always land back on the list view (not mid-conversation) next open
  appState.searchInput.blur();
}

// Thin guarded wrapper kept for the ~15 external call sites (Escape, window.onclick, etc.) that
// already call this by name expecting "end the AI conversation, if one's open" — genuinely a
// no-op unless the AI view is actually the one currently open, which matters because several of
// those call sites fire from unrelated background events (render()'s per-tick calls, realtime
// sync broadcasts) that have nothing to do with the user actually closing anything. Delegates to
// window.__closeRailView() for the actual hide/state-reset, rather than duplicating that logic
// here.
export function clearSearch(): void {
  const appState = getAppState();
  if (appState.activeRailView !== "ai") return;
  window.__closeRailView?.();
}

// Toggles between the AI panel's two internal views — the chat list (default: search box up top,
// previous conversations below it) and an active conversation — independent of the outer rail's
// own open/close/pin state. #search-input-wrap/#search-dropdown are a single shared pair,
// physically moved between #ai-list-header and #ai-chat-view by these two functions rather than
// duplicated — every listener/store/portal wired to their CHILDREN keeps working regardless of
// which parent currently holds them.
export function showAiListView(): void {
  const appState = getAppState();
  appState.aiChatView.classList.remove("open");
  appState.aiListView.classList.add("open");
  appState.aiListHeader.appendChild(appState.searchInputWrap);
  if (appState.searchDropdown) appState.aiListHeader.appendChild(appState.searchDropdown);
  // "Back" (the only way out of a conversation now) doubles as starting fresh: the next message
  // typed into the list view's own box should never silently continue whatever conversation was
  // just left.
  appState.currentConversationId = null;
  window.__setChatThread?.([]);
  updateChatThread();
  renderChatsList();
}
export function showAiChatView(): void {
  const appState = getAppState();
  appState.aiListView.classList.remove("open");
  appState.aiChatView.classList.add("open");
  // Two inserts, in this order, land search-input-wrap directly after the thread and
  // search-dropdown right after THAT: insertAdjacentElement moves (never clones) its argument, so
  // the second call — running after the first already placed search-input-wrap right after the
  // thread — pushes search-dropdown one slot further down, landing it after search-input-wrap
  // instead.
  appState.searchChatThread?.insertAdjacentElement("afterend", appState.searchDropdown!);
  appState.searchChatThread?.insertAdjacentElement("afterend", appState.searchInputWrap);
}

// AI search's own onOpen callback — passed to panelsHamburger.ts's wireRailIcon('ai', ...) call.
// Always lands back on the list view (not mid-conversation from a previous session).
export function refreshAiPanel(): void {
  showAiListView();
}

// Opens the AI panel — called from the global Space/"/" keydown shortcuts (srsConnectionsCore.ts),
// and from openSavedChat (hamburgerCollab.ts) when reopening a saved conversation from the chat
// list.
export function openSearchOverlay(): void {
  const appState = getAppState();
  if (!appState.aiPanel || !appState.searchInput) return;
  window.__openRailView?.("ai", appState.aiPanel, appState.railBtnAi, () => refreshAiPanel(), true);
}

interface HeightTransitionOpts {
  restOverflow?: "visible" | "auto";
  capTarget?: boolean | (() => number);
  settledClass?: string;
  shrinkTransition: string;
  growTransition: (wasVisible: boolean) => string;
}

// Factory for the hardened open/close/resize height-transition system originally built (across
// many rounds of real bugs) for #search-dropdown alone — factored out once #search-chat-thread
// needed the exact same behavior against a completely independent element. Each call returns its
// own `update(visible, opts)` function with entirely private state (settledHeight,
// transitionCleanup, its own ResizeObserver) — two controllers must NEVER share this state.
function createHeightTransitionController(
  getElement: () => HTMLElement | null | undefined,
  onOrganicResize?: () => void,
) {
  let settledHeight = 0;
  let transitionCleanup: ((e: TransitionEvent) => void) | null = null;
  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          const el = getElement();
          if (!el) return;
          const settled = el.style.height === "" || el.style.height === "auto";
          if (!settled) return;
          settledHeight = entries[0].contentRect.height;
          if (onOrganicResize) onOrganicResize();
        })
      : null;
  let resizeObserverStarted = false;

  return function update(visible: boolean, opts: HeightTransitionOpts): void {
    const el = getElement();
    if (el && resizeObserver && !resizeObserverStarted) {
      resizeObserver.observe(el);
      resizeObserverStarted = true;
    }
    if (!el) return;
    const restOverflow = opts.restOverflow || "visible";
    const wasVisible = el.classList.contains("visible");
    el.classList.toggle("visible", visible);
    // 'auto'/'' means no transition is currently live — the last one already ran its
    // transitionend handler and handed height back to normal flow. A non-empty px value means one
    // is still actively interpolating right now.
    const settled = el.style.height === "" || el.style.height === "auto";
    if (!visible) {
      if (!wasVisible) return; // already closed, staying closed — nothing to animate
      if (opts.settledClass) el.classList.remove(opts.settledClass);
      if (transitionCleanup) {
        el.removeEventListener("transitionend", transitionCleanup as EventListener);
        transitionCleanup = null;
      }
      if (settled) {
        el.style.transition = "none";
        el.style.height = settledHeight + "px";
        el.style.overflow = "hidden";
        void el.offsetHeight;
      }
      el.style.transition = opts.shrinkTransition;
      el.style.height = "0px";
      el.style.opacity = "0";
      settledHeight = 0;
      const onCollapseDone = (e: TransitionEvent) => {
        if (e.target !== el || e.propertyName !== "height") return;
        el.style.transition = "";
        el.style.height = "auto";
        el.style.overflow = restOverflow;
        el.removeEventListener("transitionend", onCollapseDone as EventListener);
        transitionCleanup = null;
      };
      el.addEventListener("transitionend", onCollapseDone as EventListener);
      transitionCleanup = onCollapseDone;
      return;
    }
    // Visible — either a fresh reveal (wasVisible false) or already open and just resized (wasVisible
    // true). By this point the caller has already written new content and flipped whatever display
    // flags matter.
    let target = el.scrollHeight;
    if (opts.capTarget) {
      const capPx =
        typeof opts.capTarget === "function"
          ? opts.capTarget()
          : parseFloat(getComputedStyle(el).maxHeight);
      if (Number.isFinite(capPx)) target = Math.min(target, capPx);
    }
    if (wasVisible && settled && Math.abs(target - settledHeight) < 1) return; // no real change, nothing in flight either
    if (opts.settledClass) el.classList.remove(opts.settledClass);
    if (transitionCleanup) {
      el.removeEventListener("transitionend", transitionCleanup as EventListener);
      transitionCleanup = null;
    }
    if (settled) {
      el.style.transition = "none";
      el.style.height = settledHeight + "px";
      if (!wasVisible) el.style.opacity = "0";
      el.style.overflow = "hidden";
      void el.offsetHeight;
    }
    el.style.transition = opts.growTransition(wasVisible);
    el.style.height = target + "px";
    el.style.opacity = "1";
    settledHeight = target;
    const onDone = (e: TransitionEvent) => {
      if (e.target !== el || e.propertyName !== "height") return;
      el.style.transition = "";
      el.style.height = "auto";
      el.style.overflow = restOverflow;
      if (opts.settledClass) el.classList.add(opts.settledClass);
      el.removeEventListener("transitionend", onDone as EventListener);
      transitionCleanup = null;
    };
    el.addEventListener("transitionend", onDone as EventListener);
    transitionCleanup = onDone;
  };
}

// cubic-bezier(0,0,0.2,1)/cubic-bezier(0.4,0,1,1) are Material Design's standard decelerate/
// accelerate curves — a deliberate PAIR sharing the same underlying shape, not an unrelated
// choice: that's what makes an enter and its matching exit feel like the same physical object
// rather than two differently-tempered motions.
const HEIGHT_TRANSITION_OPTS: Pick<HeightTransitionOpts, "shrinkTransition" | "growTransition"> = {
  shrinkTransition: "height .16s cubic-bezier(0.4,0,1,1), opacity .12s ease-in",
  growTransition: (wasVisible: boolean) =>
    wasVisible
      ? "height .22s cubic-bezier(0,0,0.2,1)"
      : "height .22s cubic-bezier(0,0,0.2,1), opacity .26s ease-out .05s",
};

const dropdownAnimator = createHeightTransitionController(() => getAppState().searchDropdown);
export function updateSearchDropdown(): void {
  const appState = getAppState();
  if (!appState.searchDropdown) return;
  const panels = [
    appState.searchCommandPalette,
    appState.searchDotbotAnswer,
    appState.searchTranslation,
    appState.searchDictionary,
    appState.searchExamples,
    appState.searchImageResult,
    appState.searchRecommended,
  ].filter((el): el is HTMLElement => !!el);
  const visible = panels.some((el) => el.style.display !== "none");
  // #search-dropdown is deliberately non-clipping at rest (restOverflow defaults to 'visible') so
  // the dictionary/examples panels' hover-out nav arrows can slide outside their own edge. No
  // max-height cap, so capTarget is left off too.
  dropdownAnimator(visible, HEIGHT_TRANSITION_OPTS);
}

const chatThreadAnimator = createHeightTransitionController(
  () => getAppState().searchChatThread,
  () => scrollChatThreadToBottom(),
);
// The grow transition's target needs a real ceiling (see opts.capTarget's own comment above) —
// but #search-chat-thread no longer has a fixed one: it rests at flex:1 (globals.css), whose
// available space depends on the header/input/dropdown's own current sizes. So this measures it
// live instead: temporarily let the element actually resolve its flex:1 size, reads the real
// result, then restores exactly what was there before. All synchronous, no frame ever paints the
// transient state.
function measureThreadFlexAvailable(): number {
  const appState = getAppState();
  const el = appState.searchChatThread;
  if (!el) return Infinity;
  const hadSettled = el.classList.contains("thread-settled");
  const prevHeight = el.style.height;
  if (!hadSettled) el.classList.add("thread-settled");
  el.style.height = "auto";
  const available = el.offsetHeight;
  el.style.height = prevHeight;
  if (!hadSettled) el.classList.remove("thread-settled");
  return available;
}
export function updateChatThread(): void {
  const appState = getAppState();
  if (!appState.searchChatThread) return;
  const visible = appState.searchChatThread.childElementCount > 0;
  chatThreadAnimator(
    visible,
    Object.assign(
      {
        restOverflow: "auto" as const,
        capTarget: measureThreadFlexAvailable,
        settledClass: "thread-settled",
      },
      HEIGHT_TRANSITION_OPTS,
    ),
  );
}
// Auto-follows the newest turn — called after updateChatThread() so the container's real
// scrollHeight already reflects any just-appended content. #search-chat-thread is
// flex-direction:column-reverse (globals.css), paired with ChatThread.jsx rendering turns
// newest-first — under column-reverse the coordinate system flips — scrollTop:0 IS the bottom
// (newest) — so "scroll to the newest turn" is a plain reset to 0, not scrollHeight.
export function scrollChatThreadToBottom(): void {
  const appState = getAppState();
  if (!appState.searchChatThread) return;
  appState.searchChatThread.scrollTop = 0;
}

// Hides the panels that hold a *completed* search's result (Dotbot's answer, dictionary,
// examples) — called whenever the box is re-opened or typed into again, so a prior search's
// result doesn't linger on screen underneath/alongside the live typing state. Deliberately
// separate from clearSearch(), which also wipes the input value and suggestions — this only
// clears the "result" panels.
function hideDotbotResultPanels(): void {
  const appState = getAppState();
  appState.searchDotbotAnswer.innerHTML = "";
  appState.searchDotbotAnswer.style.display = "none";
  if (appState.searchTranslation) {
    appState.searchTranslation.innerHTML = "";
    appState.searchTranslation.style.display = "none";
  }
  appState.searchDictionary.innerHTML = "";
  appState.searchDictionary.style.display = "none";
  appState.searchExamples.innerHTML = "";
  appState.searchExamples.style.display = "none";
  if (appState.searchImageResult) {
    appState.searchImageResult.innerHTML = "";
    appState.searchImageResult.style.display = "none";
  }
  if (appState.searchRecommended) {
    appState.searchRecommended.innerHTML = "";
    appState.searchRecommended.style.display = "none";
  }
}

export function handleSearchInput(value: string): void {
  window.__autoGrowSearchInput?.();
  const appState = getAppState();
  // Slash commands (app/dotto/lib/commandPalette.ts) take over the box entirely — none of the
  // normal live-suggestion machinery below applies, and any of its panels left over from before
  // "/" was typed need clearing so they don't linger behind the command palette.
  if (value.startsWith("/")) {
    hideDotbotResultPanels();
    window.__setSearchSuggestions?.(null);
    updateCommandPalette(value);
    updateSearchDropdown();
    return;
  }
  window.__setCommandPalette?.(null);
  const folderObj = appState.folders[appState.currentFolderId];
  if (!folderObj) return;
  hideDotbotResultPanels();
  if (value.trim() === "") {
    handleSearchFocus();
    return;
  }
  // Live AI suggestions are for a fresh, standalone query — mid-conversation they'd suggest
  // generic starting points unrelated to what's actually being continued, so skip scheduling them
  // entirely rather than show something that doesn't fit the moment.
  if (appState.currentConversationId) {
    if (appState.dotbotSuggestDebounceTimer) clearTimeout(appState.dotbotSuggestDebounceTimer);
    if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
    window.__setSearchSuggestions?.(null);
  } else {
    scheduleLiveSuggestions(value, !!folderObj.isSource);
  }
  updateSearchDropdown();
}

// Focusing the box no longer drops a static suggestion list on you. Browsing past chats is the
// list view's own always-visible #chats-list now, not something that pops up under the box here.
export function handleSearchFocus(): void {
  // 'rail' — the AI panel IS the currently-open rail view when this fires (focusing the box only
  // happens while it's visible), so closing the rail here would close the box's own panel out
  // from under itself. Still closes unrelated overlays (add-menu/collab/source-add) that might be
  // open at the same time.
  window.__closeAllPanels?.("rail");
  hideDotbotResultPanels();
  const appState = getAppState();
  const v = appState.searchInput.value.trim();
  if (v !== "") return;
  window.__setSearchSuggestions?.(null);
  updateSearchDropdown();
}

// ---------- Live AI-generated suggestions (free, debounced — see /api/dotbot/suggest) ----------
function scheduleLiveSuggestions(value: string, isSourceFolder: boolean): void {
  const appState = getAppState();
  if (appState.dotbotSuggestDebounceTimer) clearTimeout(appState.dotbotSuggestDebounceTimer);
  if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
  const q = value.trim();
  if (q.length < 2) {
    window.__setSearchSuggestions?.(null);
    updateSearchDropdown();
    return;
  }
  const generationAtScheduleTime = appState.dotbotSearchGeneration;
  appState.dotbotSuggestDebounceTimer = setTimeout(async () => {
    const appState2 = getAppState();
    appState2.dotbotSuggestAbortController = new AbortController();
    let suggestions: string[] = [];
    try {
      const res = await fetch("/api/dotbot/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, isSourceFolder }),
        signal: appState2.dotbotSuggestAbortController.signal,
      });
      const data = await res.json();
      if (appState2.searchInput.value.trim() !== q) return; // stale — a newer keystroke already moved on
      // A search may have been SUBMITTED (Enter) while this fetch was in flight — that shows its
      // own "thinking..." loading state in this same #search-suggestions element, which these
      // stale suggestions would otherwise clobber the instant this response lands, even though
      // abort() above didn't catch it in time.
      if (generationAtScheduleTime !== appState2.dotbotSearchGeneration) return;
      suggestions = data.suggestions || [];
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.error("[dotbot/suggest] failed:", e);
    }
    renderLiveSuggestions(suggestions);
  }, 200);
}
// No more hardcoded "Generate a mnemonic for X"/"Generate an image for this" rows here —
// /api/dotbot/suggest's own prompt now recommends a mnemonic-generation suggestion as one of these
// AI-suggested completions itself — clicking any suggestion here already routes through
// commenceSearchOrMnemonic, so a suggested "generate a mnemonic for X" string is picked up
// correctly with no special-casing. #search-suggestions' content itself is real React state now
// (see app/dotto/SearchSuggestionsPanel.jsx, searchSuggestionsStore).
export function buildLiveSuggestionsRows(suggestions: string[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  suggestions.slice(0, 4).forEach((text) => {
    const div = document.createElement("div");
    // .search-suggestion-item-live (not just the shared .search-suggestion-item every other
    // producer in this file/mnemonicSearchMatching.ts also uses) scopes the arrow.png icon added
    // here to just these live-as-you-type rows, per explicit request.
    div.className = "search-suggestion-item search-suggestion-item-live";
    const icon = document.createElement("img");
    icon.className = "search-suggestion-arrow";
    icon.src = "/assets/icons/arrow.png";
    icon.alt = "";
    const label = document.createElement("span");
    label.className = "search-suggestion-label";
    label.textContent = text;
    div.append(icon, label);
    div.onclick = (e) => {
      e.stopPropagation();
      const appState = getAppState();
      appState.searchInput.value = text;
      window.__autoGrowSearchInput?.();
      commenceSearchOrMnemonic(text);
    };
    frag.appendChild(div);
  });
  return frag;
}
function renderLiveSuggestions(suggestions: string[]): void {
  window.__setSearchSuggestions?.({ kind: "live-suggestions", suggestions });
  updateSearchDropdown();
}

// ---------- Dotbot (AI assistant embedded in the search box) ----------
// Credit costs are intentionally never shown here or anywhere in this UI — deduction happens
// entirely server-side (see app/api/dotbot/*), the client just gets back a result or a friendly
// "no_credits" reason.
export function dotbotErrorMessage(reason: string): string {
  if (reason === "no_credits") return "You're out of Dotbot credits for today — more tomorrow!";
  if (reason === "not_configured") return "Dotbot isn't set up yet.";
  if (reason === "unauthenticated") return "Log in to talk to Dotbot.";
  return "Something went wrong — try again.";
}
// Reveals `text` inside `el` a character at a time (a blinking caret via the dotbot-typing class
// while it runs). Plain textContent throughout — no HTML involved. Bails cleanly if `el` gets
// removed from the DOM mid-animation.
export function typewriterReveal(el: HTMLElement, text: string, onDone?: () => void): void {
  el.textContent = "";
  el.classList.add("dotbot-typing");
  let i = 0;
  // Scaled to a ~700ms total reveal regardless of length, clamped to a sensible per-char range.
  const msPerChar = Math.max(4, Math.min(12, 700 / Math.max(text.length, 1)));
  (function step() {
    if (!el.isConnected) return;
    i++;
    el.textContent = text.slice(0, i);
    if (i < text.length) {
      setTimeout(step, msPerChar);
    } else {
      el.classList.remove("dotbot-typing");
      if (onDone) onDone();
    }
  })();
}

interface InlineSegment {
  type: "text" | "ref";
  value?: string;
  kind?: string;
  index?: number;
}
interface TypewriterSegmentsOpts {
  holdMs?: number;
  onPlaceholder: (kind: string | undefined, index: number | undefined) => HTMLElement;
  onSwap: (kind: string | undefined, index: number | undefined, placeholderEl: HTMLElement) => void;
  onDone?: () => void;
}
// Types out `segments` (parseInlineMarkers' output — mnemonicSearchMatching.ts) into `container`
// in order. A 'text' segment types character-by-character into its OWN freshly appended <span>
// (never wipes prior siblings, unlike typewriterReveal's whole-el.textContent reset — that's what
// lets placeholder elements interleave with text runs). A 'ref' segment calls
// opts.onPlaceholder(kind, index) synchronously — the caller appends its own placeholder element
// and returns it — holds for opts.holdMs (default 400ms), then calls
// opts.onSwap(kind, index, placeholderEl) so the caller can replace it with the real widget. Calls
// opts.onDone exactly once, after the last segment.
export function typewriterRevealSegments(
  container: HTMLElement,
  segments: InlineSegment[],
  opts: TypewriterSegmentsOpts,
): void {
  const holdMs = opts.holdMs || 400;
  let i = 0;
  function nextSegment(): void {
    if (i >= segments.length) {
      if (opts.onDone) opts.onDone();
      return;
    }
    const seg = segments[i++];
    if (seg.type === "text") {
      if (!container.isConnected) return;
      const span = document.createElement("span");
      span.classList.add("dotbot-typing");
      container.appendChild(span);
      let c = 0;
      const value = seg.value || "";
      const msPerChar = Math.max(4, Math.min(12, 700 / Math.max(value.length, 1)));
      (function step() {
        if (!container.isConnected) return;
        c++;
        span.textContent = value.slice(0, c);
        if (c < value.length) {
          setTimeout(step, msPerChar);
        } else {
          span.classList.remove("dotbot-typing");
          nextSegment();
        }
      })();
    } else {
      if (!container.isConnected) return;
      const placeholderEl = opts.onPlaceholder(seg.kind, seg.index);
      setTimeout(() => {
        if (!container.isConnected) return;
        opts.onSwap(seg.kind, seg.index, placeholderEl);
        nextSegment();
      }, holdMs);
    }
  }
  nextSegment();
}

interface DragTemplate {
  w: number;
  h: number;
  html?: string;
  kind?: string;
  [key: string]: unknown;
}
interface DragOpts {
  cellImageHtml?: string;
  onDrop?: (clientX: number, clientY: number) => void;
}
// Mirrors the pointer-drag pattern used to drag a shared chat card onto the canvas, but for a
// single synthetic Dotbot result rather than an array of existing canvas items. `opts.cellImageHtml`,
// when set, is an <img ...> tag this drag can ALSO land directly inside a source page's table cell
// if it's released over one — otherwise (or if released over blank canvas) it falls through to the
// normal canvasItemTemplate drop.
export function setupDotbotResultDrag(
  card: HTMLElement,
  canvasItemTemplate: DragTemplate,
  opts: DragOpts = {},
): void {
  card.classList.add("dotbot-draggable");
  card.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    let dragStarted = false;
    let dragGhost: HTMLElement | null = null;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (me: PointerEvent) => {
      if (!dragStarted) {
        if (Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
        dragStarted = true;
        dragGhost = document.createElement("div");
        dragGhost.className = "inline-canvas-drag-ghost";
        dragGhost.textContent = "drop onto your canvas";
        document.body.appendChild(dragGhost);
      }
      dragGhost!.style.left = me.clientX + 14 + "px";
      dragGhost!.style.top = me.clientY + 14 + "px";
      if (opts.cellImageHtml) {
        const target = me.target as HTMLElement | null;
        const overCell = target?.closest?.(".cell-text");
        dragGhost!.textContent = overCell ? "drop into this entry" : "drop onto your canvas";
      }
    };
    const up = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", move as EventListener);
      window.removeEventListener("pointerup", up as EventListener);
      if (dragGhost) dragGhost.remove();
      if (!dragStarted) return;
      if (opts.cellImageHtml) {
        const dropEl = document.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
        const cellTextEl = dropEl?.closest?.(".cell-text") as HTMLElement | null;
        const tdEl = cellTextEl?.closest("td[data-origin-table]") as HTMLElement | null;
        if (tdEl) {
          const r = Number(cellTextEl!.dataset.r);
          const c = Number(cellTextEl!.dataset.c);
          const tableId = Number(tdEl.dataset.originTable);
          if (
            Number.isFinite(r) &&
            Number.isFinite(c) &&
            Number.isFinite(tableId) &&
            insertImageIntoCellAt(tableId, r, c, opts.cellImageHtml)
          ) {
            clearSearch();
            return;
          }
        }
      }
      const canvasRect = window.__getCanvasEl?.()?.getBoundingClientRect();
      const overCanvas =
        !!canvasRect &&
        ue.clientX >= canvasRect.left &&
        ue.clientX <= canvasRect.right &&
        ue.clientY >= canvasRect.top &&
        ue.clientY <= canvasRect.bottom;
      if (!overCanvas) return;
      // opts.onDrop lets a caller replace the default single-template import — used by the
      // mnemonic story/image cards so dragging either one brings BOTH in.
      if (opts.onDrop) opts.onDrop(ue.clientX, ue.clientY);
      else importDotbotResultAtScreenPoint(canvasItemTemplate, ue.clientX, ue.clientY);
    };
    window.addEventListener("pointermove", move as EventListener);
    window.addEventListener("pointerup", up as EventListener);
  });
}
// Drops a generated image straight into a source table cell (see setupDotbotResultDrag's
// cellImageHtml option) — appends to whatever's already in the cell.
function insertImageIntoCellAt(tableId: number, r: number, c: number, imgHtml: string): boolean {
  const table = window.__findItemById?.(tableId) as Item | undefined;
  if (!table || !table.tableData || !table.tableData[r] || table.tableData[r][c] == null)
    return false;
  window.__saveSnapshot?.();
  const cellEl = document.querySelector(
    `#${window.__itemElId?.(tableId)} .cell-text[data-r="${r}"][data-c="${c}"]`,
  );
  if (cellEl) {
    cellEl.insertAdjacentHTML("beforeend", imgHtml);
    table.tableData[r][c] = (cellEl as HTMLElement).innerHTML;
  } else {
    table.tableData[r][c] = (table.tableData[r][c] || "") + imgHtml;
  }
  window.__scheduleWorkspaceSave?.();
  window.__render?.();
  return true;
}
function importDotbotResultAtScreenPoint(
  template: DragTemplate,
  clientX: number,
  clientY: number,
): void {
  const appState = getAppState();
  window.__saveSnapshot?.();
  const rect = window.__getCanvasEl?.()?.getBoundingClientRect();
  const dropX = rect
    ? Math.round((clientX - rect.left - appState.tx) / appState.scale / 28) * 28
    : 0;
  const dropY = rect
    ? Math.round((clientY - rect.top - appState.ty) / appState.scale / 28) * 28
    : 0;
  // Every caller of this function is Dotbot/AI-originated content — aiGenerated:true here covers
  // the "Generated content may be inaccurate" badge for all of them in one place.
  const item: Item = {
    id: appState.idCounter++,
    x: dropX,
    y: dropY,
    w: template.w,
    h: template.h,
    kind: template.kind || "note",
    html: template.html,
    aiGenerated: true,
  };
  if (template.kind === "sentence") {
    item.text = template.text || "";
    item.translit = template.translit || "";
    item.translation = template.translation || "";
  }
  appState.folders[appState.currentFolderId].items.push(item);
  window.__render?.();
  clearSearch();
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

// Every searchbox in the app does this — per explicit request, not just Queries' own
// #search-input (which is all this ever drove originally). #search-panel-search
// (app/dotto/lib/searchPanelHistory.ts) is the other one so far; both are plain elements with a
// `.placeholder` property, set identically here regardless of which, so adding a future box just
// means adding its selector below.
function doWire(): void {
  const appState = getAppState();
  const targets = [appState.searchInput, document.getElementById("search-panel-search")].filter(
    (el): el is HTMLElement => !!el,
  );
  if (!targets.length) return;
  const suggestions = [
    "Find anything in your canvas...",
    "Ask me how to conjugate verbs...",
    "Generate a mnemonic for ananas...",
  ];
  const TYPE_SPEED = 60;
  const DELETE_SPEED = 45;
  const PAUSE_AFTER_TYPE = 2400;
  const PAUSE_AFTER_DELETE = 800;
  let sIndex = 0;
  let charIndex = 0;
  let deleting = false;
  function tick() {
    const current = suggestions[sIndex];
    if (!deleting) {
      charIndex++;
      targets.forEach((t) => {
        (t as HTMLInputElement | HTMLTextAreaElement).placeholder = current.slice(0, charIndex);
      });
      if (charIndex >= current.length) {
        deleting = true;
        setTimeout(tick, PAUSE_AFTER_TYPE);
        return;
      }
      setTimeout(tick, TYPE_SPEED);
    } else {
      charIndex--;
      targets.forEach((t) => {
        (t as HTMLInputElement | HTMLTextAreaElement).placeholder = current.slice(0, charIndex);
      });
      if (charIndex <= 0) {
        deleting = false;
        sIndex = (sIndex + 1) % suggestions.length;
        setTimeout(tick, PAUSE_AFTER_DELETE);
        return;
      }
      setTimeout(tick, DELETE_SPEED);
    }
  }
  tick();
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs live
// window.__getAppState right at wire time (to read appState.searchInput and start the animated
// placeholder loop), so a single readiness check isn't enough — same reasoning
// app/dotto/lib/dayChangeAndAdNotifications.ts's own wireDayChangeAndAdNotifications gives.
export function wireAiAssistantSuggestions(): () => void {
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
  window.__countSourceEntries = countSourceEntries;
  // ChatTurn (app/dotto/ChatThread.jsx) and SearchSuggestionsPanel.jsx used to call
  // __buildLiveSuggestionsRows directly via a window bridge (public/dotto/*.js wasn't reachable
  // from app/dotto/) — now a real ES import instead, same app/dotto/ tree, so that one bridge was
  // dropped. updateChatThread/scrollChatThreadToBottom/updateSearchDropdown/showAiChatView were
  // the same story once app/dotto/lib/searchOrchestrationSelection.ts (their one remaining real
  // caller) was itself ported — all four bridges dropped too.
  window.__findParentFolderId = findParentFolderId;
  window.__refreshAiPanel = refreshAiPanel;
  window.__resetAiSearchState = resetAiSearchState;
  window.__clearSearch = clearSearch;
  window.__openSearchOverlay = openSearchOverlay;
  // Plain (non-`__`) globals — real inline oninput/onfocus/onclick targets in
  // content/fragments/hamburger-stack.html and content/dotto-markup.html.
  window.handleSearchFocus = handleSearchFocus;
  window.handleSearchInput = handleSearchInput;
  window.showAiListView = showAiListView;
}
