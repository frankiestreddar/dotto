// Phase 4.5 port of public/dotto/mnemonic-search-matching.js: the mnemonic story/image generation
// flow, the Dotbot dictionary/examples/translation/answer-blocks panel builders (all draggable
// onto the canvas), TTS playback, and the fresh-turn sequenced reveal
// (startSequencedTurnReveal) that interleaves prose with inline widgets.
//
// Genuinely circular with app/dotto/lib/aiAssistantSuggestions.ts (clearSearch/dotbotErrorMessage/
// isLatinScriptText/scrollChatThreadToBottom/setupDotbotResultDrag/speakerIconHTML/
// typewriterReveal/typewriterRevealSegments/updateSearchDropdown/buildAlignedSentenceEls) — see
// that file's own header comment for why this is safe. Also genuinely circular with
// app/dotto/lib/searchOrchestrationSelection.ts (commenceDotbotSearch one way,
// commenceSearchOrMnemonic the other) — same reasoning, neither side reads the other at
// module-evaluation time.

import { flushSync } from "react-dom";
import {
  buildAlignedSentenceEls,
  clearSearch,
  dotbotErrorMessage,
  isLatinScriptText,
  scrollChatThreadToBottom,
  setupDotbotResultDrag,
  speakerIconHTML,
  typewriterReveal,
  typewriterRevealSegments,
  updateSearchDropdown,
} from "./aiAssistantSuggestions";
import { useTranslationPanelStore } from "./translationPanelStore";
import { useDictionaryPanelStore } from "./dictionaryPanelStore";
import { useExamplesPanelStore } from "./examplesPanelStore";
import { useRecommendedSearchesStore } from "./recommendedSearchesStore";
import { useDotbotAnswerStore } from "./dotbotAnswerStore";
import { useImageResultStore } from "./imageResultStore";
import { commenceDotbotSearch } from "./searchOrchestrationSelection";

interface MnemonicTemplate {
  w: number;
  h: number;
  html: string;
  kind?: string;
  [key: string]: unknown;
}

interface AppState {
  dotbotMnemonicPair: { text: MnemonicTemplate | null; image: MnemonicTemplate | null };
  currentFolderId: string;
  folders: Record<string, { items: Record<string, unknown>[] }>;
  tx: number;
  ty: number;
  scale: number;
  idCounter: number;
  typewriterLoadingTimers: WeakMap<HTMLElement, ReturnType<typeof setTimeout>>;
  TYPEWRITER_LOADING_WORDS: string[];
  searchImageResult: HTMLElement | null;
  searchTranslation: HTMLElement | null;
  searchRecommended: HTMLElement | null;
  dotbotSearchGeneration: number;
  dotbotSuggestDebounceTimer: ReturnType<typeof setTimeout> | null;
  dotbotSuggestAbortController: AbortController | null;
  dotbotUpgradePromptedForFullness: boolean;
  currentTtsAudio: HTMLAudioElement | null;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Mnemonic story / image (explicit, separate actions — not part of the orchestrated
// search flow below, so kept simple: one result, no multi-panel handling) ----------
// Dragging EITHER the story card or the image card onto the canvas brings in BOTH as separate
// blocks (user can delete the one they don't want afterward). Whichever templates exist here at
// drop time get placed; reset to {text:null,image:null} at the start of every new mnemonic so a
// stale pairing from a previous word never leaks in.
function importMnemonicPairAtScreenPoint(clientX: number, clientY: number): void {
  const appState = getAppState();
  const pair = appState.dotbotMnemonicPair;
  if (!pair.text && !pair.image) return;
  window.__saveSnapshot?.();
  const rect = window.__getCanvasEl?.()?.getBoundingClientRect();
  const dropX = rect
    ? Math.round((clientX - rect.left - appState.tx) / appState.scale / 28) * 28
    : 0;
  const dropY = rect
    ? Math.round((clientY - rect.top - appState.ty) / appState.scale / 28) * 28
    : 0;
  function place(template: MnemonicTemplate, x: number, y: number) {
    appState.folders[appState.currentFolderId].items.push({
      id: appState.idCounter++,
      x,
      y,
      w: template.w,
      h: template.h,
      kind: template.kind || "note",
      html: template.html,
      aiGenerated: true,
    });
  }
  if (pair.text) place(pair.text, dropX, dropY);
  // Offset to the right of the story block so the two never fully overlap; falls back to the
  // same drop point when there's no story block to offset from.
  if (pair.image) place(pair.image, dropX + (pair.text ? pair.text.w + 20 : 0), dropY);
  window.__render?.();
  clearSearch();
}
// #search-suggestions' content is real React state now (see app/dotto/SearchSuggestionsPanel.jsx,
// searchSuggestionsStore) — it's shared by 5 different producers across 3 files (live AI
// suggestions, this mnemonic story/loading/error trio, and the orchestrate error in
// app/dotto/lib/searchOrchestrationSelection.ts), so the store holds a small discriminated union
// rather than one plain value. Each variant's own build stays vanilla; render just decides which one to show.
// buildMnemonicResultCard/startMnemonicResultReveal split the same way
// buildDotbotAnswerTextEl/startDotbotAnswerReveal do, for the same reason (typewriterReveal needs
// the element already connected to the DOM).
export function buildMnemonicResultCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "search-suggestion-item dotbot-result-card";
  return card;
}
export function startMnemonicResultReveal(
  card: HTMLElement,
  content: { typeText?: string; html?: string },
  options: { canvasItem?: MnemonicTemplate } = {},
): void {
  function finish() {
    if (options.canvasItem) {
      getAppState().dotbotMnemonicPair.text = options.canvasItem;
      setupDotbotResultDrag(card, options.canvasItem, { onDrop: importMnemonicPairAtScreenPoint });
    }
    updateSearchDropdown();
  }
  if (content.typeText !== undefined) typewriterReveal(card, content.typeText, finish);
  else {
    card.innerHTML = content.html || "";
    finish();
  }
}
function renderMnemonicResultCard(
  content: { typeText?: string },
  options?: { canvasItem?: MnemonicTemplate },
): void {
  window.__setSearchSuggestions?.({ kind: "mnemonic-result", content, options: options || null });
  updateSearchDropdown();
}
// A terminal-style typing loop for "AI is working" states: types one word out character by
// character, holds briefly, deletes it, then moves to the next — looping — with a solid
// rectangular block cursor at the caret (not a thin blinking line) that blinks the way a terminal
// cursor does. One timer per active loading element (keyed by the element itself) so more than
// one panel (story + image) can run this at once without stepping on each other, and each stops
// cleanly the moment its own element is replaced/removed.
function stopTypewriterLoading(el: HTMLElement): void {
  const appState = getAppState();
  const timer = appState.typewriterLoadingTimers.get(el);
  if (timer) clearTimeout(timer);
  appState.typewriterLoadingTimers.delete(el);
}
function startTypewriterLoading(el: HTMLElement): void {
  const appState = getAppState();
  el.innerHTML = `<span class="typewriter-loading-text"></span><span class="typewriter-loading-cursor"></span>`;
  const textEl = el.querySelector<HTMLElement>(".typewriter-loading-text")!;
  let wordIndex = 0;
  let charIndex = 0;
  let deleting = false;
  const step = () => {
    if (!el.isConnected) {
      stopTypewriterLoading(el);
      return;
    }
    const word = appState.TYPEWRITER_LOADING_WORDS[wordIndex] + "...";
    let delay: number;
    if (!deleting) {
      charIndex++;
      textEl.textContent = word.slice(0, charIndex);
      if (charIndex >= word.length) {
        deleting = true;
        delay = 900;
      } else delay = 55;
    } else {
      charIndex--;
      textEl.textContent = word.slice(0, charIndex);
      if (charIndex <= 0) {
        deleting = false;
        wordIndex = (wordIndex + 1) % appState.TYPEWRITER_LOADING_WORDS.length;
        delay = 300;
      } else delay = 30;
    }
    appState.typewriterLoadingTimers.set(el, setTimeout(step, delay));
  };
  step();
}
export function buildMnemonicLoadingEl(): HTMLElement {
  const loading = document.createElement("div");
  loading.className = "search-suggestion-item typewriter-loading";
  startTypewriterLoading(loading);
  return loading;
}
function renderMnemonicLoading(): void {
  const appState = getAppState();
  appState.dotbotMnemonicPair = { text: null, image: null };
  window.__setSearchSuggestions?.({ kind: "mnemonic-loading" });
  updateSearchDropdown();
}
export function buildMnemonicErrorEl(reason: string): HTMLElement {
  const errEl = document.createElement("div");
  errEl.className = "search-suggestion-item";
  errEl.textContent = dotbotErrorMessage(reason);
  return errEl;
}
function renderMnemonicError(reason: string): void {
  const appState = getAppState();
  window.__setSearchSuggestions?.({ kind: "mnemonic-error", reason });
  updateSearchDropdown();
  if (reason === "no_credits") {
    appState.dotbotUpgradePromptedForFullness = true;
    window.__openDotbotUpgradeModal?.();
  }
}
// The generated image gets its OWN dedicated panel (#search-image-result) rather than sharing
// #search-suggestions with the story card, so a story and its image can both stay visible
// together instead of the image render wiping the story off screen. Draggable onto the canvas as
// its own note — and, via its cellImageHtml, straight into a source page's table cell too.
export function buildImageResultLoading(): HTMLElement {
  const loading = document.createElement("div");
  loading.className = "search-suggestion-item search-image-loading typewriter-loading";
  startTypewriterLoading(loading);
  return loading;
}
export function buildImageResultError(reason: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "search-suggestion-item search-image-loading";
  el.textContent = dotbotErrorMessage(reason);
  return el;
}
export function buildImageResultCard(imageDataUrl: string): HTMLElement {
  const appState = getAppState();
  const card = document.createElement("div");
  card.className = "search-suggestion-item dotbot-result-card search-image-result-card";
  card.innerHTML = `<img src="${imageDataUrl}" alt="" style="max-width:100%;border-radius:8px;display:block;">`;
  // 448x252 = exactly 16:9 (both are *28, matching the canvas's own placement grid) — the
  // generated image is 16:9 too, so this box shows it in full rather than the old square box
  // cropping a widescreen image down to a square.
  appState.dotbotMnemonicPair.image = {
    w: 448,
    h: 252,
    html: `<img src="${imageDataUrl}" style="max-width:100%;height:100%;object-fit:cover;border-radius:8px;">`,
  };
  setupDotbotResultDrag(card, appState.dotbotMnemonicPair.image, {
    cellImageHtml: `<img class="cell-media-img" src="${imageDataUrl}">`,
    onDrop: importMnemonicPairAtScreenPoint,
  });
  return card;
}
// This and the other 5 search-dropdown result-panel setState calls in this file
// (dictionary/examples/translation/recommended/dotbotAnswer below) all need flushSync, same
// reasoning as canvasItemsStore (app/dotto-app.jsx): updateSearchDropdown
// (app/dotto/lib/aiAssistantSuggestions.ts) reads each panel's real DOM node's style.display
// synchronously right after calling into this file — without flushSync that read would race the
// consuming component's own layout effect that actually sets style.display.
function renderImageResultLoading(): void {
  const appState = getAppState();
  if (!appState.searchImageResult) return;
  flushSync(() => useImageResultStore.setState({ status: "loading" }));
}
function renderImageResultError(reason: string): void {
  const appState = getAppState();
  if (!appState.searchImageResult) return;
  flushSync(() => useImageResultStore.setState({ status: "error", reason }));
  if (reason === "no_credits") {
    appState.dotbotUpgradePromptedForFullness = true;
    window.__openDotbotUpgradeModal?.();
  }
}
function renderImageResultPanel(imageDataUrl: string): void {
  const appState = getAppState();
  if (!appState.searchImageResult) return;
  flushSync(() => useImageResultStore.setState({ status: "success", imageDataUrl }));
}
async function generateMnemonicImage(imageScene: string): Promise<void> {
  renderImageResultLoading();
  try {
    const res = await fetch("/api/dotbot/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_scene: imageScene }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderImageResultError(data.error);
      return;
    }
    window.__refreshDotbotUsage?.();
    renderImageResultPanel(data.imageDataUrl);
  } catch (e) {
    console.error("[dotbot] image failed:", e);
    renderImageResultError("error");
  }
}
// The "my mnemonic for X is Y" flow — the user already supplied their own mnemonic text, so
// there's no AI text generation step (no separate image_scene either — their raw text doubles as
// the scene description), but it still needs to show as a text card above the image (every
// mnemonic path must show text then image, no exceptions) rather than jumping straight to the
// image alone.
function renderOwnMnemonicThenImage(mnemonicText: string): void {
  const appState = getAppState();
  appState.dotbotMnemonicPair = { text: null, image: null };
  renderMnemonicResultCard(
    { typeText: mnemonicText },
    { canvasItem: { w: 260, h: 160, html: mnemonicText } },
  );
  generateMnemonicImage(mnemonicText);
}
// The combined "generate a mnemonic for X" flow — writes the story first, then automatically
// continues straight into generating its image, no extra click needed. The story keeps using its
// own existing card (search-suggestions, with the typewriter reveal); the image lands in the
// separate panel above.
async function generateMnemonicStoryAndImage(word: string): Promise<void> {
  renderMnemonicLoading();
  let sentence: string;
  let imageScene: string;
  try {
    const res = await fetch("/api/dotbot/mnemonic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderMnemonicError(data.error);
      return;
    }
    window.__refreshDotbotUsage?.();
    sentence = data.sentence;
    imageScene = data.image_scene;
  } catch (e) {
    console.error("[dotbot] mnemonic failed:", e);
    renderMnemonicError("error");
    return;
  }
  renderMnemonicResultCard(
    { typeText: sentence },
    { canvasItem: { w: 260, h: 160, html: sentence } },
  );
  // image_scene (a short literal action description) is what actually drives the image, not the
  // displayed "sentence" — deliberately free of the "Imagine ..." framing, which makes a worse
  // image prompt than a plain scene description.
  generateMnemonicImage(imageScene);
}
// Recognizes two ways of asking for a mnemonic straight from the search bar: "generate/make/create
// a mnemonic (story) for X" (or bare "mnemonic for X") writes a fresh story then its image; "my
// mnemonic for X is Y" treats Y as the user's OWN mnemonic and skips straight to generating an
// image for it. Returns null for anything else, which falls through to the normal orchestrated
// search.
function parseMnemonicIntent(
  query: string,
): { type: "own"; word: string; mnemonicText: string } | { type: "generate"; word: string } | null {
  const q = query.trim().replace(/[?!.]+$/, "");
  let m = q.match(/^my\s+mnemonic\s+for\s+(.+?)\s+is\s+(.+)$/i);
  if (m) return { type: "own", word: m[1].trim(), mnemonicText: m[2].trim() };
  // Anchored on the core "mnemonic ... for X" phrase rather than enumerating every possible verb
  // — matches "generate/make/create/give me/write me/can you make me/etc. a mnemonic (story) for
  // X" anywhere in the query, so odd phrasings still route to the real generator instead of
  // falling through to a plain-text (no image) response.
  m = q.match(/mnemonic(?:\s+story)?\s+for\s+(.+)$/i);
  if (m) return { type: "generate", word: m[1].trim() };
  // A bare "mnemonic X" / "mnemonic: X" / "mnemonic - X" with no "for" at all.
  m = q.match(/^mnemonic\s*[:-]?\s+(.+)$/i);
  if (m) return { type: "generate", word: m[1].trim() };
  return null;
}
// Shared by every way a query gets submitted (Enter, clicking a suggestion/recommended-search
// row) — routes a mnemonic-shaped query to the right generation flow, or falls through to the
// normal orchestrated search for everything else.
export function commenceSearchOrMnemonic(query: string): void {
  const appState = getAppState();
  // Cancel any live-suggestion fetch still in flight from typing, and mark every response from
  // before this point as stale — otherwise a suggestions list that was already loading can land
  // right as/after this submit and overwrite the "thinking..." loading state it's about to show.
  appState.dotbotSearchGeneration++;
  if (appState.dotbotSuggestDebounceTimer) clearTimeout(appState.dotbotSuggestDebounceTimer);
  if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
  const intent = parseMnemonicIntent(query);
  if (intent && intent.type === "generate") {
    generateMnemonicStoryAndImage(intent.word);
    return;
  }
  if (intent && intent.type === "own") {
    renderOwnMnemonicThenImage(intent.mnemonicText);
    return;
  }
  commenceDotbotSearch(query);
}

// Same brief highlight every "jump to this item" action lands on it with — the hamburger menu's
// Waypoints panel (peekWaypointCard) and its Outline panel (goToOutlineItem) share this one flash
// instead of each re-implementing it.
export function flashCanvasElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.classList.add("search-flash");
  setTimeout(() => el.classList.remove("search-flash"), 1000);
}

// ---------- Dictionary / examples panel builders — draggable onto the canvas like any other
// Dotbot result. ----------
// Speaks a dictionary entry's headword aloud via Edge TTS (server-side, /api/dotbot/tts —
// Microsoft Edge's Read Aloud service, unofficial and free, not credit-gated). entry.language (a
// BCP-47 code from the AI) picks a matching voice server-side. Shared by every TTS button in the
// AI results.
async function speakText(
  text: string,
  language: string | undefined,
  btnEl?: HTMLElement | null,
): Promise<void> {
  const appState = getAppState();
  if (!text || !text.trim()) return;
  if (appState.currentTtsAudio) {
    appState.currentTtsAudio.pause();
    appState.currentTtsAudio = null;
  } // stop any previous playback first
  if (btnEl) btnEl.classList.add("loading");
  try {
    const res = await fetch("/api/dotbot/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
    if (!res.ok) throw new Error("tts request failed: " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    appState.currentTtsAudio = audio;
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    audio.addEventListener("error", () => URL.revokeObjectURL(url));
    await audio.play();
  } catch (e) {
    console.error("[dotbot] tts failed:", e);
  } finally {
    if (btnEl) btnEl.classList.remove("loading");
  }
}
export interface DictionaryEntry {
  word?: string;
  language?: string;
  transliteration?: string;
  ipa?: string;
  grammarTags?: string[];
  definition?: string;
}
function speakDictionaryWord(
  entry: DictionaryEntry | undefined,
  btnEl?: HTMLElement | null,
): Promise<void> | void {
  if (!entry || !entry.word) return;
  return speakText(entry.word, entry.language, btnEl);
}
// Splits `text` into an ordered sequence of {type:'text', value} / {type:'ref', kind, index}
// segments. `kind` is 'dictionary'|'example'|'translation'; `index` is 0 for 'translation'
// (unused, singleton panel). Consumed by startSequencedTurnReveal to interleave real prose with
// inline dictionary/example/translation widgets during a fresh turn's reveal.
interface InlineSegment {
  type: "text" | "ref";
  value?: string;
  kind?: string;
  index?: number;
}
function parseInlineMarkers(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\{\{(dictionary|example):(\d+)\}\}|\{\{translation\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ type: "text", value: text.slice(last, m.index) });
    if (m[0] === "{{translation}}") segments.push({ type: "ref", kind: "translation", index: 0 });
    else segments.push({ type: "ref", kind: m[1], index: parseInt(m[2], 10) });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}
// Collapses markers to nothing — same fallback policy as an out-of-range server-side marker. Used
// wherever raw {{...}} syntax shouldn't ever be shown as-is.
export function stripInlineMarkers(text: string): string {
  return text.replace(/\{\{(dictionary|example):\d+\}\}|\{\{translation\}\}/g, "");
}
export interface DictionaryPanelData {
  entries: DictionaryEntry[];
}
// One card, showing one sense/entry at a time. The drag payload uses getters so dragging always
// reflects whichever entry is currently on screen, not just whichever was first rendered. Returns
// a `.dotbot-dictionary-wrap` (position:relative) containing the card itself plus, only when
// there's more than one sense to cycle through, a `.dotbot-dictionary-arrows` sidebar living
// OUTSIDE the card on its right edge. `initialIndex` (optional) opens the card on that sense
// instead of the first — used when this is built as an inline widget for a specific
// {{dictionary:N}} reference.
export function buildDictionaryCard(
  panel: DictionaryPanelData,
  initialIndex?: number,
): HTMLElement {
  const entries = (panel.entries || []).slice(0, 5);
  const wrap = document.createElement("div");
  wrap.className = "dotbot-dictionary-wrap";
  const card = document.createElement("div");
  card.className = "dotbot-dictionary-card";
  wrap.appendChild(card);
  if (!entries.length) return wrap;
  let index = Number.isInteger(initialIndex) && entries[initialIndex!] ? initialIndex! : 0;

  let countEl: HTMLElement | null = null;
  if (entries.length > 1) {
    countEl = document.createElement("span");
    countEl.className = "dotbot-dictionary-count";
    card.appendChild(countEl);
  }

  const main = document.createElement("div");
  main.className = "dotbot-dictionary-main";
  card.appendChild(main);

  const headRow = document.createElement("div");
  headRow.className = "dotbot-dictionary-head-row";
  const wordEl = document.createElement("span");
  wordEl.className = "dotbot-dictionary-word";
  const audioBtn = document.createElement("button");
  audioBtn.className = "tts-btn dotbot-dictionary-audio-btn";
  audioBtn.type = "button";
  audioBtn.title = "Play pronunciation";
  audioBtn.innerHTML = speakerIconHTML();
  audioBtn.onclick = (e) => {
    e.stopPropagation();
    speakDictionaryWord(entries[index], audioBtn);
  };
  const ipaEl = document.createElement("span");
  ipaEl.className = "dotbot-dictionary-ipa";
  // Word, audio button, and IPA transcription all cluster directly next to each other (not
  // pushed to opposite ends of the row) since they're all "about the headword itself".
  headRow.appendChild(wordEl);
  headRow.appendChild(audioBtn);
  headRow.appendChild(ipaEl);
  main.appendChild(headRow);

  const translitEl = document.createElement("div");
  translitEl.className = "dotbot-dictionary-translit";
  main.appendChild(translitEl);
  const tagsEl = document.createElement("div");
  tagsEl.className = "dotbot-dictionary-tags";
  main.appendChild(tagsEl);
  const defEl = document.createElement("div");
  defEl.className = "dotbot-dictionary-def";
  main.appendChild(defEl);

  if (entries.length > 1) {
    const arrowsEl = document.createElement("div");
    arrowsEl.className = "dotbot-dictionary-arrows";
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "dotbot-dictionary-arrow dotbot-dictionary-arrow-up";
    upBtn.textContent = "▲";
    upBtn.title = "Previous sense";
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "dotbot-dictionary-arrow dotbot-dictionary-arrow-down";
    downBtn.textContent = "▼";
    downBtn.title = "Next sense";
    upBtn.onclick = (e) => {
      e.stopPropagation();
      index = (index - 1 + entries.length) % entries.length;
      renderEntry();
    };
    downBtn.onclick = (e) => {
      e.stopPropagation();
      index = (index + 1) % entries.length;
      renderEntry();
    };
    arrowsEl.appendChild(upBtn);
    arrowsEl.appendChild(downBtn);
    wrap.appendChild(arrowsEl); // sibling of `card`, outside it — see .dotbot-dictionary-wrap's hover-slide CSS
  }

  function renderEntry() {
    const entry = entries[index];
    wordEl.textContent = entry.word || "";
    // Suppressed for already-Latin-script words even if the model filled in a transliteration
    // anyway.
    const showTranslit = !!(entry.transliteration && !isLatinScriptText(entry.word || ""));
    translitEl.textContent = showTranslit ? entry.transliteration! : "";
    translitEl.style.display = showTranslit ? "block" : "none";
    ipaEl.textContent = entry.ipa ? `/${entry.ipa}/` : "";
    ipaEl.style.display = entry.ipa ? "inline-block" : "none";
    tagsEl.innerHTML = "";
    (entry.grammarTags || []).forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "dotbot-dictionary-tag-pill";
      pill.textContent = tag;
      tagsEl.appendChild(pill);
    });
    tagsEl.style.display = entry.grammarTags && entry.grammarTags.length ? "flex" : "none";
    defEl.textContent = entry.definition || "";
    if (countEl) countEl.textContent = `${index + 1}/${entries.length}`;
    updateSearchDropdown();
  }
  renderEntry();

  setupDotbotResultDrag(card, {
    w: 240,
    h: 140,
    get html() {
      const entry = entries[index];
      const tags =
        entry.grammarTags && entry.grammarTags.length ? `(${entry.grammarTags.join(", ")}) ` : "";
      return [
        entry.word,
        entry.transliteration,
        entry.ipa ? `/${entry.ipa}/` : "",
        `${tags}${entry.definition}`,
      ]
        .filter(Boolean)
        .join("<br>");
    },
  });
  return wrap;
}
// One sentence's own drag handle + TTS button (extracted from buildExamplesCard's forEach so a
// single referenced sentence can be shown inline — see startSequencedTurnReveal — without the
// rest of that panel's sentences or its color-toggle chrome, which doesn't belong floating
// mid-answer). `language` is the panel's own language field, same TTS fallback as before.
export interface ExampleSentence {
  text?: string;
  translation?: string;
  romanization?: string;
}
export function buildExampleSentenceEl(s: ExampleSentence, language: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dotbot-example-sentence-wrap";
  const { textEl, translitEl, translationEl } = buildAlignedSentenceEls(s);
  const textRow = document.createElement("div");
  textRow.className = "dotbot-example-sentence-row";
  const speakBtn = document.createElement("button");
  speakBtn.className = "tts-btn dotbot-example-audio-btn";
  speakBtn.type = "button";
  speakBtn.title = "Play pronunciation";
  speakBtn.innerHTML = speakerIconHTML();
  speakBtn.onclick = (e) => {
    e.stopPropagation();
    speakText(s.text || "", language, speakBtn);
  };
  textRow.appendChild(textEl);
  textRow.appendChild(speakBtn);
  wrap.appendChild(textRow);
  if (translitEl) wrap.appendChild(translitEl);
  if (translationEl) wrap.appendChild(translationEl);
  setupDotbotResultDrag(wrap, {
    w: 220,
    h: 130,
    html: [s.text, s.romanization, translationEl ? s.translation : ""].filter(Boolean).join("<br>"),
  });
  return wrap;
}
export interface ExamplesPanelData {
  language?: string;
  sentences: ExampleSentence[];
}
export function buildExamplesCard(panel: ExamplesPanelData): HTMLElement {
  const card = document.createElement("div");
  card.className = "dotbot-examples-card";
  const language = panel.language || "";
  (panel.sentences || []).forEach((s) => {
    card.appendChild(buildExampleSentenceEl(s, language));
  });
  return card;
}
export interface TranslationPanelData {
  sourceWord?: string;
  sourceLanguage?: string;
  targetWord?: string;
  targetLanguage?: string;
}
// A small, focused panel for direct translation-style queries ("how do you say X in Y", "what
// does X mean"). Just a word pill with its language labeled above it, an arrow, then an identical
// pill+label for the translated word — deliberately simpler than the dictionary card (no
// IPA/audio/grammar info).
export function buildTranslationCard(panel: TranslationPanelData): HTMLElement {
  const card = document.createElement("div");
  card.className = "dotbot-translation-card";
  const buildSide = (word?: string, language?: string) => {
    const side = document.createElement("div");
    side.className = "dotbot-translation-side";
    const langEl = document.createElement("div");
    langEl.className = "dotbot-translation-lang";
    langEl.textContent = language || "";
    const pillEl = document.createElement("div");
    pillEl.className = "dotbot-translation-pill";
    pillEl.textContent = word || "";
    side.appendChild(langEl);
    side.appendChild(pillEl);
    return side;
  };
  card.appendChild(buildSide(panel.sourceWord, panel.sourceLanguage));
  const arrowEl = document.createElement("div");
  arrowEl.className = "dotbot-translation-arrow";
  arrowEl.textContent = "→";
  card.appendChild(arrowEl);
  card.appendChild(buildSide(panel.targetWord, panel.targetLanguage));
  setupDotbotResultDrag(card, {
    w: 220,
    h: 100,
    html: `${panel.sourceLanguage}: ${panel.sourceWord} → ${panel.targetLanguage}: ${panel.targetWord}`,
  });
  return card;
}
// Content (buildTranslationCard/buildDictionaryCard's own return value) is real React state now —
// see app/dotto/TranslationPanel.jsx/DictionaryPanel.jsx, both simple side-effect-only components
// that mount the SAME vanilla builder's output whenever the store changes. The builders
// themselves stay vanilla — each is a small self-contained widget with its own internal
// cycling/drag state, not worth rewriting as JSX for this pass.
export function renderTranslationPanel(panel: TranslationPanelData | null): void {
  const appState = getAppState();
  if (!appState.searchTranslation) return;
  if (!panel || !panel.sourceWord || !panel.targetWord) {
    flushSync(() => useTranslationPanelStore.setState(null));
    return;
  }
  flushSync(() => useTranslationPanelStore.setState(panel));
}
export function renderDictionaryPanel(panel: DictionaryPanelData | null): void {
  if (!panel || !panel.entries || !panel.entries.length) {
    flushSync(() => useDictionaryPanelStore.setState(null));
    return;
  }
  flushSync(() => useDictionaryPanelStore.setState(panel));
}
export function renderExamplesPanel(panel: ExamplesPanelData | null): void {
  flushSync(() => useExamplesPanelStore.setState(panel || null));
}
export interface RecommendedPanelData {
  intro?: string;
  queries: string[];
}
// Shown below every Dotbot answer now, not just when it couldn't help — the chat thread's "what
// could I ask next" suggestions: an AI-generated, answer-specific lead-in sentence (panel.intro)
// + 3 indented rows phrased as its direct continuations. Falls back to a generic label for panels
// persisted before this field existed. Same click idiom as every other suggestion row in the app:
// fill the box, commence the search (continuing the same conversation thread if one's active —
// commenceSearchOrMnemonic -> commenceDotbotSearch already sends appState.currentConversationId,
// no special-casing needed here).
export function buildRecommendedSearchesRows(panel: RecommendedPanelData): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dotbot-recommended-wrap";
  const label = document.createElement("div");
  label.className = "dotbot-recommended-label";
  label.textContent = panel.intro || "Next, I could:";
  wrap.appendChild(label);
  const list = document.createElement("div");
  list.className = "dotbot-recommended-list";
  panel.queries.forEach((q) => {
    const div = document.createElement("div");
    div.className = "search-suggestion-item";
    div.textContent = q;
    // Submits directly, same code path as pressing Enter on typed text — deliberately never
    // touches appState.searchInput.value first, so the query goes straight to "becoming a
    // message" instead of visibly landing in the search box for a moment first.
    div.onclick = (e) => {
      e.stopPropagation();
      commenceSearchOrMnemonic(q);
    };
    list.appendChild(div);
  });
  wrap.appendChild(list);
  return wrap;
}
export function renderRecommendedSearchesPanel(panel: RecommendedPanelData | null): void {
  const appState = getAppState();
  if (!appState.searchRecommended) return;
  if (!panel || !panel.queries || !panel.queries.length) {
    flushSync(() => useRecommendedSearchesStore.setState(null));
    return;
  }
  flushSync(() => useRecommendedSearchesStore.setState(panel));
}
// Dotbot's written answer — just another panel like dictionary/examples, not a chat surface.
// Height grows naturally with the (typed-out) text as it wraps; draggable onto the canvas like
// any other Dotbot result. `answerBlocksPanel`/`answerBlocksLanguage` are the in-depth
// continuation of a grammar/explanation answer (an ordered sequence of prose paragraphs and
// highlighted example-sentence pills), appended into the SAME #search-dotbot-answer container as
// the short text intro above it (never a separate panel), so it visually reads as one continuous
// answer. Answer blocks render instantly, not via typewriterReveal — coordinating a
// character-by-character reveal across mixed prose/highlighted-example content isn't worth the
// complexity here. `answerBlocksLanguage` powers each example pill's own TTS button, same
// convention as buildExamplesCard.
export interface AnswerBlock {
  type: "text" | "example";
  content?: string;
  text?: string;
  romanization?: string;
  translation?: string;
}
export interface AnswerBlocksPanelData {
  blocks: AnswerBlock[];
}
export function renderDotbotAnswerPanel(
  text: string | undefined,
  answerBlocksPanel?: AnswerBlocksPanelData | null,
  answerBlocksLanguage?: string,
): void {
  flushSync(() =>
    useDotbotAnswerStore.setState(
      text
        ? {
            text,
            answerBlocksPanel: answerBlocksPanel || null,
            answerBlocksLanguage: answerBlocksLanguage || "",
          }
        : null,
    ),
  );
}
// Builds the short intro text element (not yet revealed — see startDotbotAnswerReveal) and wires
// its drag-to-canvas payload. Split from the reveal step because typewriterReveal needs the
// element already connected to the DOM (checks el.isConnected on its first tick) — the caller
// (DotbotAnswerPanel.jsx) appends this, then calls startDotbotAnswerReveal.
export function buildDotbotAnswerTextEl(text: string): HTMLElement {
  const textEl = document.createElement("div");
  textEl.className = "dotbot-answer-text dotbot-result-card";
  setupDotbotResultDrag(textEl, { w: 240, h: 140, html: text });
  return textEl;
}
// onDone defaults to updateSearchDropdown for the (now-inert) #search-dropdown-based
// DotbotAnswerPanel.jsx caller; ChatTurn (ChatThread.jsx) passes updateChatThread explicitly
// instead, since a fresh turn's typewriter now grows #search-chat-thread, not #search-dropdown.
export function startDotbotAnswerReveal(
  textEl: HTMLElement,
  text: string,
  onDone?: () => void,
): void {
  typewriterReveal(textEl, text, onDone || updateSearchDropdown);
}
// One answerBlocks "example" block's pill (extracted from buildAnswerBlocksWrap so
// revealAnswerBlocksStaggered can build blocks one at a time — same pattern as
// buildExampleSentenceEl above).
export function buildAnswerExamplePill(b: AnswerBlock, language: string): HTMLElement {
  const pill = document.createElement("div");
  pill.className = "dotbot-answer-example-pill";
  const { textEl, translitEl, translationEl } = buildAlignedSentenceEls(b);
  const textRow = document.createElement("div");
  textRow.className = "dotbot-example-sentence-row";
  const speakBtn = document.createElement("button");
  speakBtn.className = "tts-btn dotbot-example-audio-btn";
  speakBtn.type = "button";
  speakBtn.title = "Play pronunciation";
  speakBtn.innerHTML = speakerIconHTML();
  speakBtn.onclick = (e) => {
    e.stopPropagation();
    speakText(b.text || "", language, speakBtn);
  };
  textRow.appendChild(textEl);
  textRow.appendChild(speakBtn);
  pill.appendChild(textRow);
  if (translitEl) pill.appendChild(translitEl);
  if (translationEl) pill.appendChild(translationEl);
  setupDotbotResultDrag(pill, {
    kind: "sentence",
    w: 220,
    h: 130,
    text: b.text || "",
    translit: b.romanization || "",
    translation: translationEl ? b.translation : "",
    html: [b.text, b.romanization, translationEl ? b.translation : ""].filter(Boolean).join(" — "),
  });
  return pill;
}
export function buildAnswerBlocksWrap(
  panel: AnswerBlocksPanelData | null,
  language: string,
): HTMLElement | null {
  if (!panel || !panel.blocks || !panel.blocks.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "dotbot-answer-blocks";
  panel.blocks.forEach((b) => {
    if (b.type === "text") {
      const p = document.createElement("div");
      p.className = "dotbot-answer-block-text";
      // This is a "show the already-final content, no live reveal" path (used by ChatThread.jsx's
      // history-restored branch and the inert DotbotAnswerPanel.jsx) — unlike
      // startSequencedTurnReveal, it never resolves {{dictionary:N}}/{{example:N}}/{{translation}}
      // markers into widgets, so any that made it into the stored text are stripped rather than
      // shown as raw syntax.
      p.textContent = stripInlineMarkers(b.content || "");
      wrap.appendChild(p);
    } else if (b.type === "example") {
      wrap.appendChild(buildAnswerExamplePill(b, language));
    }
  });
  if (!wrap.children.length) return null;
  return wrap;
}
// Wraps `node` for a staggered fade+rise-in reveal step (see .dotbot-block-reveal, globals.css) —
// shared by revealAnswerBlocksStaggered and startSequencedTurnReveal's own trailing
// cards/recommended-searches steps.
function withStaggerIn(node: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dotbot-block-reveal";
  wrap.appendChild(node);
  requestAnimationFrame(() => wrap.classList.add("dotbot-block-in"));
  return wrap;
}
function runStaggered(steps: (() => void)[], gapMs: number, cb: () => void): void {
  let i = 0;
  (function next() {
    if (i >= steps.length) {
      cb();
      return;
    }
    steps[i++]();
    setTimeout(next, gapMs);
  })();
}
// Same as buildDotbotAnswerTextEl but with NO drag-to-canvas wiring — the fresh-turn sequenced
// reveal path (startSequencedTurnReveal) uses this instead, since only individual inline widgets
// should be draggable now, not the whole answer paragraph. buildDotbotAnswerTextEl itself stays
// untouched — DotbotAnswerPanel.jsx (confirmed inert, see ChatThread.jsx's own comment) still
// calls it directly.
function buildDotbotAnswerContainerEl(): HTMLElement {
  const textEl = document.createElement("div");
  textEl.className = "dotbot-answer-text dotbot-result-card";
  return textEl;
}
interface TurnPanel {
  type: string;
  text?: string;
  entries?: DictionaryEntry[];
  sentences?: ExampleSentence[];
  language?: string;
  sourceWord?: string;
  blocks?: AnswerBlock[];
  queries?: string[];
  [key: string]: unknown;
}
// Fresh-turn-only sequenced reveal (see turn.fresh, ChatThread.jsx — history-restored turns never
// call this, they render every panel synchronously instead). ALL of `panels` is already fully
// resolved before this ever runs — this codebase has no streaming anywhere, so every placeholder
// pulse below is a fixed-duration theatrical pacing beat, not a real loading state.
// Order: (1) dotbotText, typed out, with any {{dictionary:N}}/{{example:N}}/{{translation}}
// marker resolving to an inline widget in place; (2) answerBlocks, staggered per block, with the
// same marker resolution inside its text blocks; (3) any dictionary/translation/example content
// NOT already shown inline, staggered in; (4) recommended-searches. Tracks which dictionary
// index / example index / translation got shown inline so step 3 never duplicates it.
export function startSequencedTurnReveal(
  el: HTMLElement,
  panels: TurnPanel[],
  onAllDone?: () => void,
): void {
  // Auto-follows the newest content the whole time this turn is actively revealing. A
  // MutationObserver, not the chat thread's own ResizeObserver-driven onOrganicResize — that one
  // only fires when the THREAD's own OUTER box resizes, which stops being true once it settles
  // into flex:1 against a fixed available space; content growing WITHIN that fixed box no longer
  // resizes it at all. Scoped to exactly this turn's own reveal lifecycle (disconnected the
  // instant onAllDone fires below) rather than left running permanently.
  const followObserver = new MutationObserver(() => scrollChatThreadToBottom());
  followObserver.observe(el, { childList: true, subtree: true, characterData: true });

  const textPanel = panels.find((p) => p.type === "dotbot_text") || null;
  const dictPanel = panels.find((p) => p.type === "dictionary") || null;
  const examplesPanel = panels.find((p) => p.type === "examples") || null;
  const translationPanel = panels.find((p) => p.type === "translation") || null;
  const answerBlocksPanel = panels.find((p) => p.type === "answer_blocks") || null;
  const recommendedPanel = panels.find((p) => p.type === "recommended_searches") || null;
  const answerLanguage =
    (dictPanel && dictPanel.entries?.[0] && dictPanel.entries[0].language) ||
    (examplesPanel && examplesPanel.language) ||
    "";

  const consumedDict = new Set<number>();
  const consumedExamples = new Set<number>();
  let consumedTranslation = false;

  function buildInlineWidget(kind: string | undefined, index: number | undefined): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "dotbot-inline-widget";
    if (kind === "dictionary" && dictPanel && dictPanel.entries?.[index!]) {
      consumedDict.add(index!);
      wrap.appendChild(buildDictionaryCard(dictPanel as DictionaryPanelData, index));
    } else if (kind === "example" && examplesPanel && examplesPanel.sentences?.[index!]) {
      consumedExamples.add(index!);
      wrap.appendChild(
        buildExampleSentenceEl(examplesPanel.sentences[index!], examplesPanel.language || ""),
      );
    } else if (kind === "translation" && translationPanel) {
      consumedTranslation = true;
      wrap.appendChild(buildTranslationCard(translationPanel));
    }
    return wrap;
  }

  function runText(cb: () => void): void {
    if (!textPanel || !textPanel.text) {
      cb();
      return;
    }
    const textEl = buildDotbotAnswerContainerEl();
    el.appendChild(textEl);
    const segments = parseInlineMarkers(textPanel.text);
    typewriterRevealSegments(textEl, segments, {
      onPlaceholder: () => {
        const ph = document.createElement("span");
        ph.className = "dotbot-inline-placeholder";
        textEl.appendChild(ph);
        return ph;
      },
      onSwap: (kind, index, ph) => {
        ph.replaceWith(buildInlineWidget(kind, index));
      },
      onDone: cb,
    });
  }

  function runAnswerBlocks(cb: () => void): void {
    if (!answerBlocksPanel || !answerBlocksPanel.blocks?.length) {
      cb();
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "dotbot-answer-blocks";
    el.appendChild(wrap);
    const steps = answerBlocksPanel.blocks.map((b) => () => {
      const blockEl = document.createElement("div");
      if (b.type === "text") {
        parseInlineMarkers(b.content || "").forEach((seg) => {
          if (seg.type === "text") blockEl.appendChild(document.createTextNode(seg.value || ""));
          else blockEl.appendChild(buildInlineWidget(seg.kind, seg.index));
        });
        blockEl.className = "dotbot-answer-block-text";
      } else if (b.type === "example") {
        blockEl.appendChild(buildAnswerExamplePill(b, answerLanguage));
      }
      wrap.appendChild(withStaggerIn(blockEl));
    });
    runStaggered(steps, 260, cb);
  }

  function runRemainingCards(cb: () => void): void {
    const steps: (() => void)[] = [];
    if (!consumedTranslation && translationPanel) {
      steps.push(() => el.appendChild(withStaggerIn(buildTranslationCard(translationPanel))));
    }
    if (!consumedDict.size && dictPanel && dictPanel.entries?.length) {
      steps.push(() =>
        el.appendChild(withStaggerIn(buildDictionaryCard(dictPanel as DictionaryPanelData))),
      );
    }
    if (examplesPanel && examplesPanel.sentences?.length) {
      const remaining = examplesPanel.sentences.filter((_, i) => !consumedExamples.has(i));
      if (remaining.length) {
        steps.push(() =>
          el.appendChild(
            withStaggerIn(
              buildExamplesCard(Object.assign({}, examplesPanel, { sentences: remaining })),
            ),
          ),
        );
      }
    }
    runStaggered(steps, 260, cb);
  }

  function runRecommended(cb: () => void): void {
    if (!recommendedPanel || !recommendedPanel.queries?.length) {
      cb();
      return;
    }
    el.appendChild(
      withStaggerIn(buildRecommendedSearchesRows(recommendedPanel as RecommendedPanelData)),
    );
    setTimeout(cb, 220);
  }

  runText(() =>
    runAnswerBlocks(() =>
      runRemainingCards(() =>
        runRecommended(() => {
          followObserver.disconnect();
          if (onAllDone) onAllDone();
        }),
      ),
    ),
  );
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet. This file has no wireX() of its own — every top-level
// statement here is either a plain function declaration (safe to define eagerly, only run when
// called) or this guarded bridge-assignment block, same shape waypointsRenderLoop.ts's own port
// established.
if (typeof window !== "undefined") {
  // Used by outlineTree.ts's goToOutlineItem (Phase 4.4).
  window.__flashCanvasElement = flashCanvasElement;
}
