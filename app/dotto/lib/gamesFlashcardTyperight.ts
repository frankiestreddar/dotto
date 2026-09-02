// Phase 4.4 port of public/dotto/games-flashcard-typeright.js: the shared front/back column
// configuration (right-click "Options" face) for every game card kind, plus the Flashcard and
// Typeright apps built on top of it. Three React components (FlashcardCard.jsx/TypeRightCard.jsx/
// GameOptionsPanel.jsx) already consumed a subset of these as React->vanilla bridges before this
// port — those bridge names/shapes are preserved exactly, just reassigned from here now. Reaches
// every still-vanilla dependency through window bridges.

type GameMode = "plain" | "blank" | "extract";
interface GameSlot {
  col: number;
  mode: GameMode;
}
interface GameConfig {
  frontCols: GameSlot[];
  backCols: GameSlot[];
}
interface SrsState {
  interval: number;
  easeFactor: number;
  dueDate: number;
  repetitions: number;
  [key: string]: unknown;
}
interface CardRow {
  cells?: string[];
  front?: string;
  back?: string;
  srs?: SrsState;
  rowIndex?: number;
  originTableId?: number;
  [key: string]: unknown;
}
interface Item {
  id: number;
  cards?: CardRow[];
  gameConfig?: GameConfig;
  gameHeaders?: string[];
  optionsOpen?: boolean;
  fcMode?: string;
  fcOrder?: number[];
  fcIndex?: number;
  fcFlipped?: boolean;
  fcStats?: Record<string, number>;
  fcSeenCount?: number;
  trMode?: string;
  trOrder?: number[];
  trIndex?: number;
  trInput?: string;
  trChecked?: boolean;
  trLastGrade?: string | null;
  trStats?: Record<string, number>;
  trSeenCount?: number;
  pendingSrsUpdate?: { rowIndex: number; srs: SrsState; originTableId: number | undefined };
  [key: string]: unknown;
}
interface FaceBlock {
  col: number;
  type: "text" | "image" | "audio";
  text: string;
  html: string;
}
interface AppState {
  CLOZE_RE: RegExp;
  SM2_QUALITY: Record<string, number>;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}
function findItemById(id: number): Item | undefined {
  return window.__findItemById?.(id) as unknown as Item | undefined;
}

// ---------- Game options (right-click front/back column config) ----------
// Shared by every game card kind that has a real front/back notion today (flashcard, typeright).
// A row's raw per-column HTML (row.cells, see extractCardsFromSource) came from either plain typed
// text or a media insert (triggerCellImageUpload/setMediaFromLink tag <img class="cell-media-img">;
// triggerCellAudioUpload/startCellAudioRecording tag <audio class="cell-media-audio">) — this is
// the one place that turns that raw HTML back into a content-type so the options panel can show it
// and Typeright can filter on it.
export function cellContentType(html: string): "text" | "image" | "audio" {
  if (!html) return "text";
  if (/<img\b/i.test(html)) return "image";
  if (/<audio\b/i.test(html)) return "audio";
  return "text";
}
// Cloze deletion: a text cell containing [bracketed] word(s) — e.g. "Yo [como] manzanas" — can be
// shown three ways once a column is picked in the options panel's dropdown: the plain column name
// (brackets removed, the word itself kept — "Yo como manzanas"), an indented "Blank" variant (the
// bracketed word replaced by a blank — "Yo [...] manzanas"), or an indented "[...]" variant (just
// the bracketed word/phrase alone — "como"). A column with no brackets anywhere only ever gets the
// plain option.
function hasCloze(text: string): boolean {
  const appState = getAppState();
  if (!appState) return false;
  appState.CLOZE_RE.lastIndex = 0;
  return appState.CLOZE_RE.test(text || "");
}
function clozeBlankText(text: string): string {
  return text.replace(/\[([^[\]]+)\]/g, "[...]");
}
function clozeAnswerText(text: string): string {
  const answers: string[] = [];
  text.replace(/\[([^[\]]+)\]/g, (m, g1) => {
    answers.push(g1.trim());
    return m;
  });
  return answers.join(", ");
}
// Removes just the bracket punctuation, keeping the enclosed word/phrase in place — the plain
// dropdown option's own transform, so a cloze-authored cell still reads as ordinary prose when
// neither the Blank nor the [...] variant is specifically chosen for it. A no-op for a column with
// no brackets at all.
function clozeUnwrapText(text: string): string {
  return text.replace(/\[([^[\]]+)\]/g, "$1");
}
// Which column(s) feed a given side, as slot objects {col, mode} — it.gameConfig (set via the
// dropdowns in renderGameOptionsHTML/setGameColumnSlot/addGameColumnSlot below) is
// {frontCols:[{col,mode},...], backCols:[...]}, mode one of 'plain' (default), 'blank', 'extract'.
// When unset, falls back to EXACTLY the old hardcoded behavior (front = column 0, back = column 1,
// or column 0 again if there's only one column, mode 'plain') so a flashcard that never had its
// options opened looks identical to before.
// Coerces one gameConfig entry into a real {col, mode} slot — entries saved by an earlier version
// of this feature (a bare column-index number, or a {col,cloze}/{col,cloze,extract} object from
// since-removed variants) are still sitting in already-persisted workspaces, and reading/mutating
// one of those as if it were already a slot object silently no-ops (you can't assign .col onto a
// primitive number) — which is exactly what made cards render blank and dropdown changes appear to
// do nothing for anyone who'd configured a game before this.
export function normalizeGameSlot(entry: unknown): GameSlot {
  if (entry && typeof entry === "object") {
    const e = entry as Record<string, unknown>;
    const col = typeof e.col === "number" && Number.isFinite(e.col) ? e.col : 0;
    if (e.mode === "plain" || e.mode === "blank" || e.mode === "extract")
      return { col, mode: e.mode };
    if (e.extract) return { col, mode: "extract" };
    if (e.cloze) return { col, mode: "blank" };
    return { col, mode: "plain" };
  }
  return { col: Number(entry) || 0, mode: "plain" };
}
function effectiveGameSlots(it: Item, side: "front" | "back", colCount: number): GameSlot[] {
  const cfg = it.gameConfig;
  const sideCols = cfg?.[`${side}Cols`];
  if (sideCols && sideCols.length) return sideCols.map(normalizeGameSlot);
  const col = side === "front" ? 0 : colCount > 1 ? 1 : 0;
  return [{ col, mode: "plain" }];
}
// Whether at least one row currently on this card has [bracket] syntax in column `i` — the options
// panel's own Blank/[...] dropdown entries (see renderGameOptionsHTML) only appear under a column
// that passes this, checked across every row rather than just a sample one.
export function colHasAnyCloze(it: Item, i: number): boolean {
  return (it.cards || []).some(
    (row) => Array.isArray(row.cells) && hasCloze(window.__stripHtml?.(row.cells[i] || "") ?? ""),
  );
}
// Resolves one row + one side into an ordered list of {col, type, text, html} blocks — one per
// selected column, so multiple text columns (e.g. Chinese characters + pinyin) stack as separate
// lines, and an image/audio column renders as its own media element. mode:'plain' (the default,
// top-level dropdown option) shows the column's text with any [bracket] punctuation removed but the
// enclosed word kept; mode:'blank' (the indented "Blank" option) shows the sentence with the
// bracketed word replaced by "[...]"; mode:'extract' (the indented "[...]" option) shows just the
// bracketed word/phrase alone. Which mode applies is a direct per-slot choice, not inferred from
// front/back side.
export function resolveGameFace(it: Item, row: CardRow, side: "front" | "back"): FaceBlock[] {
  // The placeholder deck (defaultFlashcardDeck, shown before any source is linked) has plain
  // {front, back} strings with no `cells` — render that as a single text block rather than trying
  // to apply column selection to data that has no columns.
  if (!Array.isArray(row.cells)) {
    const text = (row[side] as string) || "";
    return [{ col: 0, type: "text", text, html: text }];
  }
  const cells = row.cells;
  const slots = effectiveGameSlots(it, side, cells.length);
  return slots.map((slot) => {
    const i = slot.col;
    const html = cells[i] || "";
    const type = cellContentType(html);
    if (type === "text") {
      const text = window.__stripHtml?.(html) ?? "";
      if (slot.mode === "blank") return { col: i, type: "text", text: clozeBlankText(text), html };
      if (slot.mode === "extract")
        return { col: i, type: "text", text: clozeAnswerText(text), html };
      return { col: i, type: "text", text: clozeUnwrapText(text), html };
    }
    return { col: i, type, text: window.__stripHtml?.(html) ?? "", html };
  });
}
// Which column indices have a non-plain mode set, across both sides of this game card — a row must
// have [bracket] syntax in EVERY one of these columns to be included in the game at all (Blank/
// [...] only make sense for rows that actually have brackets there; plain mode never filters,
// since it works fine on ordinary rows too).
function gameClozeFilterCols(it: Item): number[] {
  const cfg = it.gameConfig;
  if (!cfg) return [];
  const cols = new Set<number>();
  (cfg.frontCols || []).concat(cfg.backCols || []).forEach((slot) => {
    if (slot && slot.mode && slot.mode !== "plain") cols.add(slot.col);
  });
  return Array.from(cols);
}
// The row list an actual game (flashcard, typeright) iterates over — it.cards filtered down by
// every cloze-toggled column's presence requirement. Shared by both kinds' own fcPlayableCards/
// trPlayableCards (typeright layers its own additional "answer side must be text" rule on top of
// this).
function gamePlayableCards(it: Item): CardRow[] {
  const clozeCols = gameClozeFilterCols(it);
  const cards = it.cards || [];
  if (!clozeCols.length) return cards;
  return cards.filter((row) => {
    if (!Array.isArray(row.cells)) return true; // placeholder deck — no columns to check
    return clozeCols.every((ci) => hasCloze(window.__stripHtml?.(row.cells![ci] || "") ?? ""));
  });
}
export function renderGameFaceBlocksHTML(blocks: FaceBlock[] | undefined): string {
  if (!blocks || !blocks.length) return "";
  return blocks
    .map((b) => {
      if (b.type === "image" || b.type === "audio") return b.html;
      return `<div class="game-face-line">${window.__escapeHtml?.(b.text) ?? b.text}</div>`;
    })
    .join("");
}
export function openGameOptionsPanel(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  it.optionsOpen = true;
  window.__render?.();
}
export function closeGameOptionsPanel(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  it.optionsOpen = false;
  window.__render?.();
}
// Materializes it.gameConfig from the same implicit default effectiveGameSlots computes on the
// fly (front=column 0, back=column 1 or 0, cloze off) — needed before any of the mutators below
// can edit a specific slot, since there's nothing to index into until it's real.
function ensureGameConfigDefaults(it: Item): GameConfig {
  const sampleCells = (it.cards && it.cards[0] && it.cards[0].cells) || [];
  const defaultBack = (): GameSlot[] => [{ col: sampleCells.length > 1 ? 1 : 0, mode: "plain" }];
  if (!it.gameConfig)
    it.gameConfig = { frontCols: [{ col: 0, mode: "plain" }], backCols: defaultBack() };
  if (!Array.isArray(it.gameConfig.frontCols) || !it.gameConfig.frontCols.length) {
    it.gameConfig.frontCols = [{ col: 0, mode: "plain" }];
  }
  if (!Array.isArray(it.gameConfig.backCols) || !it.gameConfig.backCols.length)
    it.gameConfig.backCols = defaultBack();
  // Migrates any slot saved in an older format (see normalizeGameSlot) into a real object IN
  // PLACE, so the mutators below (which do e.g. slot.col = ...) always have an actual object to
  // mutate rather than silently no-oping on a primitive.
  it.gameConfig.frontCols = it.gameConfig.frontCols.map(normalizeGameSlot);
  it.gameConfig.backCols = it.gameConfig.backCols.map(normalizeGameSlot);
  return it.gameConfig;
}
function gameColumnCount(it: Item): number {
  return (
    (it.gameHeaders && it.gameHeaders.length) ||
    ((it.cards && it.cards[0] && it.cards[0].cells) || []).length
  );
}
// Replaces the column (and mode) assigned to one dropdown slot — a plain column pick encodes as
// value="<col>", the indented Blank/[...] variants (see renderGameOptionsHTML) as
// value="<col>:blank" / "<col>:extract". Real inline onchange target
// (GameOptionsPanel.jsx's own select's onChange calls window.setGameColumnSlot the same way the
// vanilla renderGameOptionsHTML's own onchange="..." string used to) — plain global, no underscore.
export function setGameColumnSlot(
  id: number,
  side: "front" | "back",
  slotIndex: number,
  value: string,
): void {
  const it = findItemById(id);
  if (!it) return;
  window.__saveSnapshot?.();
  const cfg = ensureGameConfigDefaults(it);
  const [colStr, variant] = String(value).split(":");
  const slot = cfg[`${side}Cols`][slotIndex];
  slot.col = Number(colStr);
  slot.mode = variant === "blank" || variant === "extract" ? variant : "plain";
  window.__scheduleWorkspaceSave?.();
  window.__render?.();
}
// Adds another dropdown to a side, defaulting to the first column not already used on that side
// (falls back to column 0) — this is what lets a side stack more than one column (e.g. characters
// + pinyin), and applies equally to Front and Back. Real inline onclick target (GameOptionsPanel.jsx).
export function addGameColumnSlot(id: number, side: "front" | "back"): void {
  const it = findItemById(id);
  if (!it) return;
  window.__saveSnapshot?.();
  const cfg = ensureGameConfigDefaults(it);
  const cols = cfg[`${side}Cols`];
  const colCount = gameColumnCount(it);
  const used = new Set(cols.map((s) => s.col));
  let next = 0;
  for (let i = 0; i < colCount; i++) {
    if (!used.has(i)) {
      next = i;
      break;
    }
  }
  cols.push({ col: next, mode: "plain" });
  window.__scheduleWorkspaceSave?.();
  window.__render?.();
}
// Removes one dropdown from a side — a side always keeps at least one, since an empty side has
// nothing to show. Real inline onclick target (GameOptionsPanel.jsx).
export function removeGameColumnSlot(id: number, side: "front" | "back", slotIndex: number): void {
  const it = findItemById(id);
  if (!it) return;
  window.__saveSnapshot?.();
  const cfg = ensureGameConfigDefaults(it);
  const cols = cfg[`${side}Cols`];
  if (cols.length > 1) cols.splice(slotIndex, 1);
  window.__scheduleWorkspaceSave?.();
  window.__render?.();
}
// Builds the sliding "Options" face swapped in over a game card's normal content on right-click
// (see the .item-face/.item-options CSS and the oncontextmenu handler in the main render loop).
// Two sections, Front and Back, each a list of column-picker dropdowns (one per currently stacked
// column on that side) plus an "add column" button to stack another. A column with at least one
// [bracket] entry anywhere in the deck gets an indented "[Cloze]" option under its plain name (see
// colHasAnyCloze) — picking it turns cloze mode on for that slot, which restricts the whole game to
// rows with brackets in that column and shows the blanked sentence on Front / just the bracketed
// word on Back (see resolveGameFace). No close button — the panel closes by clicking anywhere
// outside the card (see the document-level pointerdown listener near setupDraggingAndClicking) or
// by right-clicking again.
function renderGameOptionsHTML(it: Item): string {
  const headers = it.gameHeaders || [];
  const sampleRow = it.cards && it.cards[0];
  const colCount = headers.length || (sampleRow && sampleRow.cells ? sampleRow.cells.length : 0);
  if (!colCount) {
    return `<div class="game-options-head">Options</div>
                <div class="game-options-empty">Connect a source to configure front/back columns.</div>`;
  }
  const cfg = it.gameConfig;
  const frontCols = (
    cfg?.frontCols && cfg.frontCols.length ? cfg.frontCols : [{ col: 0, mode: "plain" as const }]
  ).map(normalizeGameSlot);
  const backCols = (
    cfg?.backCols && cfg.backCols.length
      ? cfg.backCols
      : [{ col: colCount > 1 ? 1 : 0, mode: "plain" as const }]
  ).map(normalizeGameSlot);
  // Every column gets its own plain (top-level) option; a column with at least one [bracket] entry
  // anywhere in the deck (see colHasAnyCloze) ALSO gets an <optgroup> right after it holding
  // "Blank" and "[...]". Real nested <option>s indent natively in every browser's dropdown popup —
  // no CSS/whitespace hack needed — and critically, the CLOSED select still shows only the
  // selected option's own short text, never the group label, so picking one of these never leaves
  // stray indentation sitting in the collapsed pill.
  const optionsHTML = (slot: GameSlot): string => {
    let html = "";
    for (let i = 0; i < colCount; i++) {
      const name =
        window.__escapeHtml?.(headers[i] || `Column ${i + 1}`) ?? (headers[i] || `Column ${i + 1}`);
      html += `<option value="${i}"${i === slot.col && slot.mode === "plain" ? " selected" : ""}>${name}</option>`;
      if (colHasAnyCloze(it, i)) {
        html += `<optgroup label="${name} — cloze">`;
        html += `<option value="${i}:blank"${i === slot.col && slot.mode === "blank" ? " selected" : ""}>Blank</option>`;
        html += `<option value="${i}:extract"${i === slot.col && slot.mode === "extract" ? " selected" : ""}>[...]</option>`;
        html += `</optgroup>`;
      }
    }
    return html;
  };
  const sideHTML = (label: string, side: "front" | "back", slots: GameSlot[]): string => {
    const slotsHTML = slots
      .map((slot, slotIndex) => {
        const cellHtml = ((sampleRow && sampleRow.cells) || [])[slot.col] || "";
        const type = sampleRow ? cellContentType(cellHtml) : "text";
        const glyph =
          type === "image" ? "🖼" : type === "audio" ? "🔊" : slot.mode !== "plain" ? "[…]" : "Aa";
        return `<div class="game-options-slot" onmousedown="event.stopPropagation()">
                    <select class="game-options-select" onchange="setGameColumnSlot(${it.id}, '${side}', ${slotIndex}, this.value)">${optionsHTML(slot)}</select>
                    <span class="game-options-col-glyph" title="${type}">${glyph}</span>
                    ${slots.length > 1 ? `<button type="button" class="game-options-remove-slot" onclick="removeGameColumnSlot(${it.id}, '${side}', ${slotIndex})" title="Remove">×</button>` : ""}
                </div>`;
      })
      .join("");
    return `<div class="game-options-side">
                <div class="game-options-side-label">${label}</div>
                ${slotsHTML}
                <button type="button" class="game-options-add-slot" onmousedown="event.stopPropagation()" onclick="addGameColumnSlot(${it.id}, '${side}')">+ Add column</button>
            </div>`;
  };
  return `<div class="game-options-head">Options</div>
            <div class="game-options-body">
                ${sideHTML("Front", "front", frontCols)}
                ${sideHTML("Back", "back", backCols)}
            </div>`;
}
// No close button on the options panel itself — same "outside click closes it" convention already
// used by showInlineCanvasDeleteMenu's own document-level pointerdown listener. Real, module-load-
// time-only listener attachment — safe to run unconditionally at import time (unlike wireX()
// elsewhere in this migration) since it only ever touches `document` itself, never a specific
// element that might not exist yet. Guarded against `document` not existing during Next's
// server-side render pass (see PHASE4_ROADMAP.md's history-autosave.js entry for how this
// project-wide issue was found).
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    document.querySelectorAll<HTMLElement>(".item.options-open").forEach((el) => {
      if (!el.contains(e.target as Node)) {
        const id = window.__parseItemId?.(el);
        if (id != null && !Number.isNaN(id)) closeGameOptionsPanel(id);
      }
    });
  });
}

// ---------- Flashcard app ----------
// Cards live directly on the item (it.cards = [{front, back}, ...]). This is a placeholder data
// source ready to be swapped out by the new linking feature.
export function defaultFlashcardDeck(): CardRow[] {
  return [
    { front: "Front of card 1", back: "Back of card 1" },
    { front: "Front of card 2", back: "Back of card 2" },
    { front: "Front of card 3", back: "Back of card 3" },
  ];
}
function shuffleArr<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Cloze-toggled columns (see renderGameOptionsHTML's Cloze toggle / gameClozeFilterCols) restrict
// the deck the same way for flashcards as for Typeright — a filtered view of it.cards, not
// it.cards directly.
export function fcPlayableCards(it: Item): CardRow[] {
  return gamePlayableCards(it);
}
function ensureFcOrder(it: Item, playable: CardRow[]): void {
  const rows = playable.map((_, i) => i);
  const valid =
    it.fcOrder && it.fcOrder.length === rows.length && it.fcOrder.every((i) => rows.includes(i));
  if (!valid) {
    it.fcOrder = it.fcMode === "shuffle" ? shuffleArr(rows) : rows.slice();
    it.fcIndex = 0;
  }
  if ((it.fcIndex ?? 0) >= (it.fcOrder?.length ?? 0)) it.fcIndex = 0;
}
export function fcCurrentRow(it: Item, playable: CardRow[]): CardRow | null {
  ensureFcOrder(it, playable);
  if (!it.fcOrder?.length) return null;
  return playable[it.fcOrder[it.fcIndex ?? 0]];
}
function fcCardName(): string {
  return "Flashcards";
}
export function renderFlashcardHTML(it: Item): string {
  const title = fcCardName();
  const options = renderGameOptionsHTML(it);
  if (!it.cards || !it.cards.length) {
    return `<div class="item-face">
                <div class="fc-top" onmousedown="event.stopPropagation()">
                    <div class="fc-title">${title}</div>
                </div>
                <div class="fc-empty">No cards yet.</div>
            </div>
            <div class="item-options">${options}</div>`;
  }
  const playable = fcPlayableCards(it);
  if (!playable.length) {
    return `<div class="item-face">
                <div class="fc-top" onmousedown="event.stopPropagation()">
                    <div class="fc-title">${title}</div>
                </div>
                <div class="fc-empty">No playable entries — check the Cloze columns in Options.</div>
            </div>
            <div class="item-options">${options}</div>`;
  }
  const row = fcCurrentRow(it, playable);
  const front = row
    ? renderGameFaceBlocksHTML(resolveGameFace(it, row, "front"))
    : "(no data rows)";
  const back = row ? renderGameFaceBlocksHTML(resolveGameFace(it, row, "back")) : "";
  const total = it.fcOrder?.length ?? 0;
  const pos = total ? (it.fcIndex ?? 0) + 1 : 0;
  return `<div class="item-face">
                <div class="fc-top" onmousedown="event.stopPropagation()">
                    <div class="fc-title">${title}</div>
                    <div class="fc-top-right">
                        <button class="fc-mode-btn" onclick="fcToggleMode(${it.id})" title="Toggle shuffle / ordered">${it.fcMode === "shuffle" ? "Shuffle ON" : "Shuffle OFF"}</button>
                        <div class="fc-progress">${pos}/${total}</div>
                    </div>
                </div>
                <div class="fc-card ${it.fcFlipped ? "flipped" : ""}" onmousedown="event.stopPropagation()" onclick="fcFlip(${it.id})">
                    <div class="fc-face fc-front">${front || "(empty)"}</div>
                    <div class="fc-face fc-back">${back || "(empty)"}</div>
                </div>
                <div class="fc-actions" onmousedown="event.stopPropagation()">
                    <button class="fc-flip-btn" style="display:${it.fcFlipped ? "none" : "flex"}" onclick="fcFlip(${it.id})">Flip</button>
                    <div class="fc-rate-row" style="display:${it.fcFlipped ? "flex" : "none"}">
                        <button class="fc-rate-btn fc-rate-noclue" onclick="fcRate(${it.id}, 'noclue')">Not a clue</button>
                        <button class="fc-rate-btn fc-rate-wrong" onclick="fcRate(${it.id}, 'wrong')">Got it wrong</button>
                        <button class="fc-rate-btn fc-rate-hard" onclick="fcRate(${it.id}, 'hard')">Had to think</button>
                        <button class="fc-rate-btn fc-rate-easy" onclick="fcRate(${it.id}, 'easy')">Easy</button>
                    </div>
                </div>
                <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>
            </div>
            <div class="item-options">${options}</div>`;
}
// Real inline onclick target (renderFlashcardHTML's own built HTML) — plain global, no underscore.
export function fcFlip(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  it.fcFlipped = !it.fcFlipped;
  const el = window.__findItemEl?.(id);
  const card = el && el.querySelector(".fc-card");
  if (card) card.classList.toggle("flipped", it.fcFlipped);
  const flipBtn = el && el.querySelector<HTMLElement>(".fc-flip-btn");
  const rateRow = el && el.querySelector<HTMLElement>(".fc-rate-row");
  if (flipBtn) flipBtn.style.display = it.fcFlipped ? "none" : "flex";
  if (rateRow) rateRow.style.display = it.fcFlipped ? "flex" : "none";
  // Only on the reveal flip, not the flip back — otherwise toggling back and forth would farm
  // points for free.
  if (it.fcFlipped) {
    window.__awardUserPoints?.("flip_flashcard", 1);
    window.__bumpAchievementStat?.("hundred_flips");
  }
  // Reuses the same generic item-sync pipeline every other field change already goes through (see
  // scheduleWorkspaceSave/queueSyncDiff) — no special-casing needed since renderFlashcardHTML
  // already reads it.fcFlipped correctly on a fresh render, which is exactly what a receiving
  // collaborator's applyRemoteSyncBroadcast triggers.
  window.__scheduleWorkspaceSave?.();
}
// Real inline onclick target (renderFlashcardHTML's own built HTML) — plain global, no underscore.
export function fcRate(id: number, rating: string): void {
  const it = findItemById(id);
  if (!it) return;
  const appState = getAppState();
  it.fcStats = it.fcStats || {};
  it.fcStats[rating] = (it.fcStats[rating] || 0) + 1;
  it.fcSeenCount = (it.fcSeenCount || 0) + 1;

  // ---- SM-2: the flashcard is just the visual interface — it computes the new memory state
  // locally (for instant feedback) but the source table is the system of record. The result is
  // queued as `pendingSrsUpdate` and pushed upstream through the normal streaming connection
  // pipeline on the next render (see CardStreamIO.flashcard).
  const playable = fcPlayableCards(it);
  const card = fcCurrentRow(it, playable);
  if (card && appState) {
    const quality = appState.SM2_QUALITY[rating];
    const nextSrs = window.__calculateSM2?.(
      Object.assign({}, card.srs || window.__defaultSrsState?.()),
      quality,
    ) as SrsState | undefined;
    card.srs = nextSrs;
    // originTableId (carried on every card since extractCardsFromSource set it) makes sure this
    // update finds its way back to the row's real home table even when a filter card or a merged
    // source sits between this flashcard and it.
    if (card.rowIndex != null && nextSrs) {
      it.pendingSrsUpdate = {
        rowIndex: card.rowIndex,
        srs: nextSrs,
        originTableId: card.originTableId,
      };
    }
  }

  ensureFcOrder(it, playable);
  if (it.fcOrder?.length) it.fcIndex = ((it.fcIndex ?? 0) + 1) % it.fcOrder.length;
  it.fcFlipped = false;
  window.__render?.();
}
// Real inline onclick target (renderFlashcardHTML's own built HTML) — plain global, no underscore.
export function fcToggleMode(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  const playable = fcPlayableCards(it);
  ensureFcOrder(it, playable);
  const rows = playable.map((_, i) => i);
  if (it.fcMode === "shuffle") {
    const curOrig = it.fcOrder![it.fcIndex ?? 0];
    const startPos = rows.indexOf(curOrig);
    it.fcOrder = rows.slice(startPos).concat(rows.slice(0, startPos));
    it.fcIndex = 0;
    it.fcMode = "ordered";
  } else {
    const curOrig = it.fcOrder![it.fcIndex ?? 0];
    const rest = shuffleArr(rows.filter((r) => r !== curOrig));
    it.fcOrder = [curOrig, ...rest];
    it.fcIndex = 0;
    it.fcMode = "shuffle";
  }
  it.fcFlipped = false;
  window.__render?.();
}

// ---------- Typeright app ----------
// Classic edit-distance between two strings — used by gradeTypedAnswer below to recognize a
// near-miss typo rather than grading it as flatly wrong.
function levenshteinDistance(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
// Unicode NFD + stripping the Combining Diacritical Marks block (U+0300-U+036F) — "como" and
// "cómo" normalize to the same string, so a missing/wrong accent grades as "nearly" rather than
// fully wrong.
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
// Three-tier grade for a typed answer against the correct one — drives both the input's color
// feedback and which SM-2 bucket the attempt counts toward (see trCheck): 'correct' (exact,
// case-insensitive), 'nearly' (right except accents, or a small typo), 'wrong' otherwise.
function gradeTypedAnswer(typed: string, answer: string): "correct" | "nearly" | "wrong" {
  const t = typed.trim().toLowerCase();
  const a = answer.trim().toLowerCase();
  if (!t) return "wrong";
  if (t === a) return "correct";
  if (stripDiacritics(t) === stripDiacritics(a)) return "nearly"; // right, just missing/wrong accents
  const maxLen = Math.max(t.length, a.length);
  const typoThreshold = Math.max(1, Math.floor(maxLen * 0.25)); // scales gently with answer length
  if (levenshteinDistance(t, a) <= typoThreshold) return "nearly";
  return "wrong";
}
// See one side (front columns), type the other (back columns) — see resolveGameFace/gameConfig
// above. Only rows whose resolved BACK side is entirely text are playable (you can't type an
// answer that's an image or audio clip), so the deck here is always a filtered view of it.cards,
// not it.cards directly.
export function trPlayableCards(it: Item): CardRow[] {
  return gamePlayableCards(it).filter((row) =>
    resolveGameFace(it, row, "back").every((b) => b.type === "text"),
  );
}
function ensureTrOrder(it: Item, playable: CardRow[]): void {
  const rows = playable.map((_, i) => i);
  const valid =
    it.trOrder && it.trOrder.length === rows.length && it.trOrder.every((i) => rows.includes(i));
  if (!valid) {
    it.trOrder = it.trMode === "shuffle" ? shuffleArr(rows) : rows.slice();
    it.trIndex = 0;
  }
  if ((it.trIndex ?? 0) >= (it.trOrder?.length ?? 0)) it.trIndex = 0;
}
export function trCurrentCard(it: Item, playable: CardRow[]): CardRow | null {
  ensureTrOrder(it, playable);
  if (!it.trOrder?.length) return null;
  return playable[it.trOrder[it.trIndex ?? 0]];
}
export function renderTypeRightHTML(it: Item): string {
  const options = renderGameOptionsHTML(it);
  if (!it.cards || !it.cards.length) {
    return `<div class="item-face">
                    <div class="tr-top" onmousedown="event.stopPropagation()"><div class="tr-title">Typeright</div></div>
                    <div class="tr-empty">Connect a source to play.</div>
                </div>
                <div class="item-options">${options}</div>`;
  }
  const playable = trPlayableCards(it);
  if (!playable.length) {
    return `<div class="item-face">
                    <div class="tr-top" onmousedown="event.stopPropagation()"><div class="tr-title">Typeright</div></div>
                    <div class="tr-empty">No playable entries — the answer side must be text.</div>
                </div>
                <div class="item-options">${options}</div>`;
  }
  const card = trCurrentCard(it, playable);
  const promptHTML = card ? renderGameFaceBlocksHTML(resolveGameFace(it, card, "front")) : "";
  const total = it.trOrder?.length ?? 0;
  const pos = total ? (it.trIndex ?? 0) + 1 : 0;
  const checked = !!it.trChecked;
  const correctAnswer = card
    ? resolveGameFace(it, card, "back")
        .map((b) => b.text)
        .join(" ")
    : "";
  // Grade colors the INPUT itself (green/orange/red) — no separate feedback pill below it.
  const grade = checked ? it.trLastGrade : null;
  const inputGradeClass = grade ? ` tr-input-${grade}` : "";
  const escapedInput = window.__escapeHtml?.(it.trInput || "") ?? (it.trInput || "");
  const escapedAnswer = window.__escapeHtml?.(correctAnswer) ?? correctAnswer;
  const itemElId = window.__itemElId?.(it.id) ?? "";
  return `<div class="item-face" onmouseenter="trFocusInput(${it.id})">
                <div class="tr-top" onmousedown="event.stopPropagation()">
                    <div class="tr-title">Typeright</div>
                    <div class="fc-top-right">
                        <button class="fc-mode-btn" onclick="trToggleMode(${it.id})" title="Toggle shuffle / ordered">${it.trMode === "shuffle" ? "Shuffle ON" : "Shuffle OFF"}</button>
                        <div class="fc-progress">${pos}/${total}</div>
                    </div>
                </div>
                <div class="tr-prompt" onmousedown="event.stopPropagation()">${promptHTML || "(empty)"}</div>
                <div class="tr-answer-row" onmousedown="event.stopPropagation()">
                    <input type="text" class="tr-input${inputGradeClass}" placeholder="Type the answer…" value="${escapedInput}" oninput="trUpdateInput(${it.id}, this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault(); ${checked ? `trNext(${it.id})` : `trCheck(${it.id})`};}" onfocus="broadcastEditingState(true, '#${itemElId} .tr-input')" onblur="broadcastEditingState(false)" ${checked ? "disabled" : ""}>
                    ${checked ? `<button class="tr-next-btn" onclick="trNext(${it.id})">Next</button>` : `<button class="tr-check-btn" onclick="trCheck(${it.id})">Check</button>`}
                </div>
                ${checked && grade !== "correct" ? `<div class="tr-answer-reveal">Answer: ${escapedAnswer}</div>` : ""}
                <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>
            </div>
            <div class="item-options">${options}</div>`;
}
// Real inline oninput target (renderTypeRightHTML's own built HTML) — plain global, no underscore.
export function trUpdateInput(id: number, value: string): void {
  const it = findItemById(id);
  if (!it) return;
  it.trInput = value;
  // Live per-keystroke sync — same reasoning/pattern as the note/title body oninput fixes and
  // fcFlip: renderTypeRightHTML already reads it.trInput correctly on a fresh render, so this is
  // all that's needed for a collaborator to see typing happen in real time. This is the general
  // pattern any NEW card kind should follow for live collaboration too — call
  // scheduleWorkspaceSave() on every meaningful state change (including live text input, not just
  // on submit/commit) and make sure the kind's own render function reads that state back out — no
  // per-kind sync code to write, the existing generic item-diff pipeline (queueSyncDiff/
  // applyRemoteSyncBroadcast) picks it up automatically.
  window.__scheduleWorkspaceSave?.();
}
// Auto-focuses the answer input the moment the card is hovered — "always ready to type" rather
// than needing an extra click first. Fires again after trNext rebuilds the card for the next
// question (see below); render() replaces the whole element, so a plain mouseenter that already
// fired once when the cursor first arrived won't fire again on its own just because the DOM node
// underneath it was swapped out. No-ops while the input is disabled (mid-feedback, right after
// checking) or already focused. Real inline onmouseenter target (renderTypeRightHTML's own built
// HTML) — plain global, no underscore.
export function trFocusInput(id: number): void {
  const el = window.__findItemEl?.(id);
  const input = el && el.querySelector<HTMLInputElement>(".tr-input");
  if (input && !input.disabled && document.activeElement !== input) input.focus();
}
// Real inline onclick target (renderTypeRightHTML's own built HTML) — plain global, no underscore.
export function trCheck(id: number): void {
  const it = findItemById(id);
  if (!it || it.trChecked) return;
  const appState = getAppState();
  const playable = trPlayableCards(it);
  const card = trCurrentCard(it, playable);
  if (!card || !appState) return;
  const correctAnswer = resolveGameFace(it, card, "back")
    .map((b) => b.text)
    .join(" ");
  // 'correct' | 'nearly' (typo, or right minus accents) | 'wrong' — colors the input itself (see
  // renderTypeRightHTML), no separate feedback pill.
  const grade = gradeTypedAnswer(it.trInput || "", correctAnswer);
  it.trStats = it.trStats || {};
  // Collapses the 3-tier grade onto SM-2's rating buckets — "nearly" counts as "hard" (recalled
  // it, imperfectly) rather than fully right or fully wrong.
  const rating = grade === "correct" ? "easy" : grade === "nearly" ? "hard" : "wrong";
  it.trStats[rating] = (it.trStats[rating] || 0) + 1;
  it.trSeenCount = (it.trSeenCount || 0) + 1;
  it.trLastGrade = grade;
  it.trChecked = true;

  // ---- Same SM-2 pipeline as flashcard's fcRate.
  const quality = appState.SM2_QUALITY[rating];
  const nextSrs = window.__calculateSM2?.(
    Object.assign({}, card.srs || window.__defaultSrsState?.()),
    quality,
  ) as SrsState | undefined;
  card.srs = nextSrs;
  if (card.rowIndex != null && nextSrs) {
    it.pendingSrsUpdate = {
      rowIndex: card.rowIndex,
      srs: nextSrs,
      originTableId: card.originTableId,
    };
  }

  window.__awardUserPoints?.("typeright_check", 1);
  window.__render?.();
}
// Real inline onclick target (renderTypeRightHTML's own built HTML) — plain global, no underscore.
export function trNext(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  const playable = trPlayableCards(it);
  ensureTrOrder(it, playable);
  if (it.trOrder?.length) it.trIndex = ((it.trIndex ?? 0) + 1) % it.trOrder.length;
  it.trInput = "";
  it.trChecked = false;
  it.trLastGrade = null;
  window.__render?.();
  // Both ways trNext can fire (clicking "Next", or pressing Enter while hovering — see the
  // hover-scoped card shortcuts) only happen with the cursor already on this card, so restoring
  // focus to the freshly-rendered next question's input is always the right call here, not just a
  // hover-triggered nicety.
  trFocusInput(id);
}
// Real inline onclick target (renderTypeRightHTML's own built HTML) — plain global, no underscore.
export function trToggleMode(id: number): void {
  const it = findItemById(id);
  if (!it) return;
  const playable = trPlayableCards(it);
  ensureTrOrder(it, playable);
  const rows = playable.map((_, i) => i);
  if (it.trMode === "shuffle") {
    const curOrig = it.trOrder![it.trIndex ?? 0];
    const startPos = rows.indexOf(curOrig);
    it.trOrder = rows.slice(startPos).concat(rows.slice(0, startPos));
    it.trIndex = 0;
    it.trMode = "ordered";
  } else {
    const curOrig = it.trOrder![it.trIndex ?? 0];
    const rest = shuffleArr(rows.filter((r) => r !== curOrig));
    it.trOrder = [curOrig, ...rest];
    it.trIndex = 0;
    it.trMode = "shuffle";
  }
  it.trInput = "";
  it.trChecked = false;
  window.__render?.();
}

// React -> vanilla bridges (see the identical pattern/comment in cards-misc.js) — used by
// GameOptionsPanel.jsx (app/dotto/), shared by FlashcardCard.jsx and TypeRightCard.jsx. Names/
// shapes preserved exactly from before this port.
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__cellContentType = cellContentType;
  window.__colHasAnyCloze = colHasAnyCloze;
  window.__normalizeGameSlot = normalizeGameSlot;
  window.__fcCurrentRow = fcCurrentRow;
  window.__fcPlayableCards = fcPlayableCards;
  window.__renderGameFaceBlocksHTML = renderGameFaceBlocksHTML;
  window.__resolveGameFace = resolveGameFace;
  window.__trCurrentCard = trCurrentCard;
  window.__trPlayableCards = trPlayableCards;
  // Vanilla -> React bridges — waypoints-render-loop.js/srs-connections-core.js all previously
  // imported these directly, plus app/dotto/lib/messagingCanvasPreview.ts (ported since — was
  // live-presence.js's own direct import of renderFlashcardHTML/renderTypeRightHTML).
  window.__openGameOptionsPanel = openGameOptionsPanel;
  window.__closeGameOptionsPanel = closeGameOptionsPanel;
  window.__defaultFlashcardDeck = defaultFlashcardDeck;
  window.__renderFlashcardHTML = renderFlashcardHTML;
  window.__renderTypeRightHTML = renderTypeRightHTML;
  // Plain (non-`__`) globals — real inline onclick/oninput/onmouseenter targets built into this
  // file's own HTML strings (renderFlashcardHTML/renderTypeRightHTML/renderGameOptionsHTML) — same
  // shape window.pushNotification/window.handleMarketplaceSearch use. Formerly re-exported through
  // window-bridge.js's own centralized inline-handler list; now assigned directly here since this
  // file is the sole real source for all of them.
  window.setGameColumnSlot = setGameColumnSlot;
  window.addGameColumnSlot = addGameColumnSlot;
  window.removeGameColumnSlot = removeGameColumnSlot;
  window.fcFlip = fcFlip;
  window.fcRate = fcRate;
  window.fcToggleMode = fcToggleMode;
  window.trUpdateInput = trUpdateInput;
  window.trFocusInput = trFocusInput;
  window.trCheck = trCheck;
  window.trNext = trNext;
  window.trToggleMode = trToggleMode;
}
