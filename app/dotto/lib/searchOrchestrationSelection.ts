// Phase 4.1 cluster revisit port of public/dotto/search-orchestration-selection.js — file #11 of
// 11, the last file in the command/search cluster. Closes out the whole cluster: every other file
// in it (commandParser.ts, cardKinds.ts, globalIds.ts, commandTargetLookup.ts, commandVerbs.ts,
// commandPalette.ts, addMenu.ts, textUtils.ts, drawingConnections.ts, searchPanelHistory.ts) was
// either already fully cut over, or — for commandPalette.ts specifically — written but sitting
// unwired until this file, its one remaining real consumer, was ready too. All 4 of this file's
// own exports (commenceDotbotSearch, openAddToSourcePopup, selectionToolbarLookUp,
// showSelectionToolbarFor) have zero remaining vanilla callers, so every caller across
// SelectionToolbar.jsx/mediaPdfEpub.ts/mnemonicSearchMatching.ts switches to a real import here.
// mnemonicSearchMatching.ts is genuinely circular with this file (commenceSearchOrMnemonic one
// way, commenceDotbotSearch the other) — both real imports, matching the precedent already
// established for the ai/hamburger/mnemonic trio and drawingConnections.ts<->srsConnectionsCore.ts,
// since neither side reads the other at module-evaluation time.

import { flushSync } from "react-dom";
import { escapeHtml, stripHtml } from "./textUtils";
import { executeCurrentCommand, setCommandActive } from "./commandPalette";
import { ensureConnections } from "./drawingConnections";
import { commenceSearchOrMnemonic } from "./mnemonicSearchMatching";
import {
  scrollChatThreadToBottom,
  showAiChatView,
  updateChatThread,
  updateSearchDropdown,
} from "./aiAssistantSuggestions";
import { applyAiAddRowsToSource, createSourceFromAI } from "./sourceTagsAi";
import { colgroupHTML } from "./sourceTable";
import { useSelectionToolbarStore } from "./selectionToolbarStore";
import { useSearchSuggestionsStore } from "./searchSuggestionsStore";
import { useChatThreadStore } from "./chatThreadStore";
import { useAddToSourcePopupStore } from "./addToSourcePopupStore";

interface Item {
  id: number;
  kind: string;
  x?: number;
  y?: number;
  folderId?: string;
  [key: string]: unknown;
}
interface TableItem {
  id: number;
  kind: "table";
  tableData: string[][];
}
interface FolderObj {
  id: string;
  title: string;
  isSource?: boolean;
  items: Item[];
  connections?: { fromId: number; toId: number }[];
}
interface CardSnapshot {
  id: number;
  snapshot: Record<string, unknown>;
}
interface SourceFolderTarget {
  folder: FolderObj;
  table: TableItem;
}
interface AppState {
  dotbotSearchGeneration: number;
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  searchDotbotAnswer: HTMLElement;
  searchDictionary: HTMLElement;
  searchExamples: HTMLElement;
  searchImageResult: HTMLElement | null;
  searchRecommended: HTMLElement | null;
  dotbotSuggestDebounceTimer: ReturnType<typeof setTimeout> | null;
  dotbotSuggestAbortController: AbortController | null;
  searchSpinner: HTMLElement;
  currentConversationId: string | null;
  searchCardContext: CardSnapshot[];
  searchCardConnections: { fromId: number; toId: number }[];
  searchInput: HTMLTextAreaElement;
  idCounter: number;
  dotbotUpgradePromptedForFullness: boolean;
  selectionToolbarRange: Range | null;
  selectionToolbarHostEl: HTMLElement | null;
  selectionToolbarRect:
    DOMRect | { left: number; top: number; width: number; height: number } | null;
  addToSourceTarget: SourceFolderTarget | null;
  searchCommandPalette: HTMLElement;
  commandActiveIndex: number;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Orchestrated search: one AI call decides which panels are useful. Canvas
// results keep the fixed slot they already rendered into synchronously, before the network
// call even started, to avoid layout jank. A written Dotbot answer (when it has one) is
// the top/first panel in the stack; dictionary/examples are preferred over writing text
// where possible, so they're common even without an answer panel above them. The search bar
// itself never moves. ----------
// Same shape as renderMnemonicError (app/dotto/lib/mnemonicSearchMatching.ts) — reuses its build
// function (window.__buildMnemonicErrorEl) via SearchSuggestionsPanel.jsx's 'dotbot-error' branch,
// since the two are visually/structurally identical (same class, same dotbotErrorMessage
// extraction), just triggered by a different flow.
function renderDotbotOrchestrateError(reason: string): void {
  const appState = getAppState();
  flushSync(() => useSearchSuggestionsStore.setState({ kind: "dotbot-error", reason }));
  updateSearchDropdown();
  if (reason === "no_credits") {
    appState.dotbotUpgradePromptedForFullness = true;
    window.__openDotbotUpgradeModal!();
  }
}

// Structured (not prose) source info for the AI's "Sources attached to this query" block —
// only "source" cards resolve (a plain "table" or "folder" card is never AI-editable, see
// applyAiAddRowsToSource) since that function needs snapshot.folderId to reach the LIVE
// folder later, and only a source snapshot carries one.
function sourceContextForAI(
  snapshot: Record<string, unknown>,
): { headers: string[]; rowCount: number } | null {
  if (snapshot.kind !== "source") return null;
  const table = ((snapshot.snapshotChildren as Record<string, unknown>[]) || []).find(
    (c) => c.kind === "table",
  ) as { tableData?: string[][] } | undefined;
  if (!table) return null;
  return {
    headers: (table.tableData?.[0] || []).map((c) => stripHtml(c || "")),
    rowCount: Math.max(0, (table.tableData || []).length - 1),
  };
}

// A short, plain-text description of one attached card for the AI's context block — reuses
// the same text-extraction rules as getItemSearchText/stripHtml, but written against a
// snapshot's own fields (tableData/tasks/cards/html) rather than assuming a live item, since
// card-context entries are always snapshots (see addCardsToSearchContext).
function describeCardForAI(snapshot: Record<string, unknown>): string {
  const label = window.__miniLabelForItem!(snapshot);
  let text: string;
  if (snapshot.kind === "table" || snapshot.kind === "source" || snapshot.kind === "folder") {
    const table = (
      snapshot.kind === "table"
        ? snapshot
        : ((snapshot.snapshotChildren as Record<string, unknown>[]) || []).find(
            (c) => c.kind === "table",
          )
    ) as { tableData?: string[][] } | undefined;
    text = table
      ? (table.tableData || [])
          .map((row) => row.map((c) => stripHtml(c || "")).join(" "))
          .join(" | ")
      : (snapshot.snapshotTitle as string) || "";
  } else if (snapshot.kind === "checklist") {
    text = ((snapshot.tasks as { text: string }[]) || []).map((t) => t.text).join("; ");
  } else if (snapshot.kind === "flashcard" || snapshot.kind === "typeright") {
    text = ((snapshot.cards as { front: string; back: string }[]) || [])
      .map((c) => `${c.front} - ${c.back}`)
      .join("; ");
  } else if (snapshot.kind === "embed") {
    text = (snapshot.embedUrl as string) || "";
  } else if (snapshot.kind === "filter") {
    const tagCount = ((snapshot.filterTagIds as unknown[]) || []).length;
    text = tagCount
      ? `filters by ${tagCount} tag(s), match ${((snapshot.filterMode as string) || "or").toUpperCase()}`
      : "no tags selected yet";
  } else {
    text = stripHtml((snapshot.html as string) || "");
  }
  return `[${label}] ${text}`.trim();
}

export async function commenceDotbotSearch(query: string): Promise<void> {
  const appState = getAppState();
  query = (query || "").trim();
  if (!query) return;
  appState.dotbotSearchGeneration++; // redundant when reached via commenceSearchOrMnemonic, needed for direct callers like selectionToolbarLookUp
  window.__bumpAchievementStat?.("twenty_searches");
  const folderObj = appState.folders[appState.currentFolderId];
  if (!folderObj) return;
  appState.searchDotbotAnswer.innerHTML = "";
  appState.searchDotbotAnswer.style.display = "none";
  appState.searchDictionary.innerHTML = "";
  appState.searchDictionary.style.display = "none";
  appState.searchExamples.innerHTML = "";
  appState.searchExamples.style.display = "none";
  if (appState.searchImageResult) {
    appState.searchImageResult.innerHTML = "";
    appState.searchImageResult.style.display = "none";
  }
  flushSync(() => useSearchSuggestionsStore.setState(null));
  if (appState.searchRecommended) {
    appState.searchRecommended.innerHTML = "";
    appState.searchRecommended.style.display = "none";
  }
  clearTimeout(appState.dotbotSuggestDebounceTimer as ReturnType<typeof setTimeout>);
  if (appState.dotbotSuggestAbortController) appState.dotbotSuggestAbortController.abort();
  appState.searchSpinner.classList.add("visible");
  try {
    const res = await fetch("/api/dotbot/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        // Null on the first message of a session (starts a fresh conversation
        // server-side); set from that response's own conversationId afterward, so
        // every subsequent message in the same open-palette session — or in a chat
        // explicitly reopened from the sidebar, see the reopen-flow bridge — continues
        // that same thread instead of starting over each time.
        conversationId: appState.currentConversationId || undefined,
        isSourceFolder: folderObj.isSource,
        cardContext: appState.searchCardContext.length
          ? appState.searchCardContext.map((c) => describeCardForAI(c.snapshot))
          : undefined,
        cardConnections: appState.searchCardConnections.length
          ? appState.searchCardConnections.map((c) => {
              const from = appState.searchCardContext.find((sc) => sc.id === c.fromId);
              const to = appState.searchCardContext.find((sc) => sc.id === c.toId);
              return `${from ? window.__miniLabelForItem!(from.snapshot) : c.fromId} -> ${to ? window.__miniLabelForItem!(to.snapshot) : c.toId}`;
            })
          : undefined,
        // Numbered the same way as cardContext above (both mapped from searchCardContext
        // in the same order) so the server can tell the model "source #N" and get back a
        // targetIndex that points at the right live card — see applyAiAddRowsToSource.
        sourceContext: appState.searchCardContext.length
          ? appState.searchCardContext
              .map((c, i) => {
                const info = sourceContextForAI(c.snapshot);
                return info ? Object.assign({ index: i + 1 }, info) : null;
              })
              .filter(Boolean)
          : undefined,
      }),
    });
    const data = await res.json();
    appState.searchSpinner.classList.remove("visible");
    // Stay focused rather than blurring — a response landing is exactly when you're most
    // likely to want to type a follow-up immediately.
    appState.searchInput.value = "";
    appState.searchInput.focus();
    window.__autoGrowSearchInput?.();
    if (!res.ok) {
      renderDotbotOrchestrateError(data.error);
      return;
    }
    window.__refreshDotbotUsage?.();
    // Carries forward even if the route's own persistence failed server-side (in which
    // case data.conversationId is just whatever was already sent, possibly still null —
    // see the route's own fail-soft handling) rather than ever going backward to null here.
    if (data.conversationId) appState.currentConversationId = data.conversationId;
    renderOrchestrateResult(query, data.panels || []);
  } catch (e) {
    appState.searchSpinner.classList.remove("visible");
    appState.searchInput.value = "";
    appState.searchInput.focus();
    window.__autoGrowSearchInput?.();
    console.error("[dotbot/orchestrate] failed:", e);
    renderDotbotOrchestrateError("error");
  }
}

// Appends one turn (the query just asked + the panels Dotbot answered with) to the persisted
// chat thread above the search input — see app/dotto/lib/chatThreadStore.ts's own comment
// for the full architecture, and ChatThread.jsx for how a turn's panels get built into their
// own DOM subtree using the same vanilla builders every individual panel type always used.
// #search-dropdown (canvas matches/"/"-commands/live suggestions) is untouched by any of this —
// this used to dispatch into ITS fixed nodes (renderDotbotAnswerPanel/renderTranslationPanel/
// etc.), which are now unused for AI content (their own components are left mounted but inert;
// nothing feeds them anymore).
function renderOrchestrateResult(query: string, panels: Record<string, unknown>[]): void {
  const appState = getAppState();
  // Applies the mutation directly rather than rendering a confirmation panel of its own —
  // "dotbotText" already reads as the confirmation (see the prompt), and the change is
  // immediately visible on the actual card/canvas. Stays a one-time side effect fired only
  // for a genuinely fresh live response (never for history restored via the sidebar reopen
  // flow, which sets chatThreadStore directly without ever calling this function) — applying
  // it again every time a saved chat is reopened would duplicate rows/sources on every view.
  const sourceActionPanel = panels.find((p) => p.type === "source_action");
  if (sourceActionPanel) {
    if (sourceActionPanel.action === "create_source")
      createSourceFromAI(
        sourceActionPanel.title as string | undefined,
        sourceActionPanel.columns as string[] | undefined,
        sourceActionPanel.rows as unknown[][],
      );
    else if (sourceActionPanel.action === "add_rows")
      applyAiAddRowsToSource(
        sourceActionPanel.targetIndex as number,
        sourceActionPanel.columns as string[] | undefined,
        sourceActionPanel.rows as unknown[][],
      );
  }
  flushSync(() =>
    useChatThreadStore.setState(
      [
        ...useChatThreadStore.getState(),
        { id: "turn_" + appState.idCounter++, query, panels, fresh: true },
      ],
      true,
    ),
  );
  // A search can be submitted from either view now — the list view's own top box (starting a
  // fresh conversation) or the chat view's bottom box (a follow-up, already showing) — this
  // is what actually brings the conversation on screen for the former; a safe no-op for the
  // latter, already there.
  showAiChatView();
  updateChatThread();
  scrollChatThreadToBottom();
}

// ---------- Text selection toolbar (copy / paste / look up / add to source) ----------
// Fires on every selection change anywhere in the document; only reacts when the selection
// is non-empty AND lives inside an actual editable surface — [contenteditable="true"] is the
// only kind of element CSS grants user-select:text to at all (see the global `*{user-select:
// none}` reset plus its `[contenteditable="true"], input, textarea{user-select:text}`
// override in globals.css), so this can't fire for arbitrary page chrome.
function hideSelectionToolbar(): void {
  const appState = getAppState();
  useSelectionToolbarStore.setState({ isOpen: false, left: 0, top: 0 });
  appState.selectionToolbarRange = null;
  appState.selectionToolbarHostEl = null;
}
function currentSelectionText(): string {
  const appState = getAppState();
  return appState.selectionToolbarRange ? appState.selectionToolbarRange.toString() : "";
}
// Shared by both selection sources: the plain document-level listener below (contentEditable
// cards and PDF text layers — both live in the main document) and buildEpubViewer's
// rendition.on('selectedRange', ...) hook (EPUB content lives inside its own same-origin
// iframe, whose Range coordinates are relative to THAT iframe, not the main page — rectOverride
// lets that caller supply the already-offset page-relative rect instead of range.getBoundingClientRect()).
export function showSelectionToolbarFor(
  range: Range,
  host: HTMLElement,
  rectOverride?: { left: number; top: number; width: number; height: number },
): void {
  const appState = getAppState();
  appState.selectionToolbarRange = range;
  appState.selectionToolbarHostEl = host;
  // The RAW selection rect — kept exactly as before, independently of the toolbar's own
  // (clamped) screen position below, since openAddToSourcePopup positions itself relative
  // to this, not to wherever the toolbar itself ended up clamped to.
  const rect = rectOverride || range.getBoundingClientRect();
  appState.selectionToolbarRect = rect;
  // Clamped so a selection near the top/left edge of the screen doesn't push the toolbar
  // off-screen — same 20px-from-edge convention used for other floating-panel clamping.
  const toolbarWidth = 150; // rough estimate ahead of layout (two small pills); good enough for clamping
  let left = Math.round(rect.left + rect.width / 2 - toolbarWidth / 2);
  left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));
  const top = Math.max(8, Math.round(rect.top - 40));
  useSelectionToolbarStore.setState({ isOpen: true, left, top });
}
// Always phrased as an explicit meaning/translation question — never just the bare selected
// text — so the orchestrate model reliably returns the "dictionary" panel (its own prompt,
// see lib/dotbot.js, only fills that panel "for a word/phrase meaning question"; a bare
// word or phrase alone doesn't reliably read as one). Shown in the search bar exactly as
// sent, matching how recommended-search pills elsewhere already show full natural-language
// questions rather than bare words.
export function selectionToolbarLookUp(): void {
  const appState = getAppState();
  const text = currentSelectionText().trim();
  hideSelectionToolbar();
  if (!text || !appState.searchInput) return;
  const query = `What does "${text}" mean?`;
  appState.searchInput.value = query;
  window.__autoGrowSearchInput?.();
  commenceDotbotSearch(query);
  appState.searchInput.focus();
}

// ---------- Add to source popup ----------
// Every source is a folder with isSource:true holding exactly one 'table' item (see
// add()'s 'source' branch) — `folders` is a flat map of EVERY folder in the account (not
// nested), so this is a full account-wide list, not just the current canvas.
function findAllSourceFolders(): FolderObj[] {
  const appState = getAppState();
  return Object.values(appState.folders).filter(
    (f) => f.isSource && f.items.some((i) => i.kind === "table"),
  );
}
// Picks the default destination, in priority order: (1) we're editing inside a source's own
// table already, (2) the item being edited IS a source card, (3) the item being edited is
// connected (a drawn canvas connection) to a source card, (4) the geometrically nearest
// source card in the same folder, (5) the first source anywhere in the account.
function findDefaultSourceForItem(hostEl: HTMLElement | null): SourceFolderTarget | null {
  const appState = getAppState();
  const folder = appState.folders[appState.currentFolderId];
  if (!folder) return null;
  const tableOf = (f: FolderObj | undefined): TableItem | undefined =>
    f && (f.items.find((i) => i.kind === "table") as unknown as TableItem | undefined);
  if (folder.isSource) {
    const table = tableOf(folder);
    if (table) return { folder, table };
  }
  const itemEl = hostEl && hostEl.closest ? (hostEl.closest(".item") as HTMLElement | null) : null;
  const itemId = itemEl && itemEl.id ? window.__parseItemId!(itemEl) : null;
  const it = itemId != null ? folder.items.find((i) => i.id === itemId) : null;
  if (it && it.kind === "source") {
    const table = tableOf(appState.folders[it.folderId as string]);
    if (table) return { folder: appState.folders[it.folderId as string], table };
  }
  if (it) {
    const conns = ensureConnections(folder as unknown as Parameters<typeof ensureConnections>[0]);
    const connectedIds = conns
      .filter((c) => c.fromId === it.id || c.toId === it.id)
      .map((c) => (c.fromId === it.id ? c.toId : c.fromId));
    for (const cid of connectedIds) {
      const other = folder.items.find((i) => i.id === cid);
      if (other && other.kind === "source") {
        const table = tableOf(appState.folders[other.folderId as string]);
        if (table) return { folder: appState.folders[other.folderId as string], table };
      }
    }
  }
  if (it) {
    const sources = folder.items.filter(
      (i) => i.kind === "source" && tableOf(appState.folders[i.folderId as string]),
    );
    if (sources.length) {
      let best: Item | null = null,
        bestDist = Infinity;
      sources.forEach((s) => {
        const dx = (s.x || 0) - (it.x || 0),
          dy = (s.y || 0) - (it.y || 0);
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      });
      if (best) {
        const b = best as Item;
        return {
          folder: appState.folders[b.folderId as string],
          table: tableOf(appState.folders[b.folderId as string])!,
        };
      }
    }
  }
  const anySourceFolder = findAllSourceFolders()[0];
  return anySourceFolder ? { folder: anySourceFolder, table: tableOf(anySourceFolder)! } : null;
}
// The popup element itself is real React state now (see app/dotto/AddToSourcePopup.jsx,
// useAddToSourcePopupStore) — existence/position/visibility all move together as one {isOpen,
// left, top}, same shape as useSelectionToolbarStore (app/dotto/lib/selectionToolbarStore.ts).
// Every call site here wraps its setState in flushSync so the div already exists in the DOM
// by the time openAddToSourcePopup calls renderAddToSourcePopup right after (below) — that
// function, and every rebuild it triggers internally (source search, source pick), still
// build the popup's actual CONTENT fully vanilla, same "React owns the shell, vanilla owns a
// self-contained widget's internals" split as buildDictionaryCard.
function closeAddToSourcePopup(): void {
  const appState = getAppState();
  flushSync(() => useAddToSourcePopupStore.setState({ isOpen: false, left: 0, top: 0 }));
  appState.addToSourceTarget = null;
}
// Rebuilt from scratch on every change (source search, source pick) — this popup's whole
// state is small and short-lived, same tradeoff renderGameOptionsHTML makes.
// Reuses the SAME markup/classes a real source page renders its column-pill row and data
// row with (buildHeaderPillsHTML's .col-name-slot/.col-name-pill/.col-name-input,
// renderStaticTableHTML's .table-rounded/.item-table/.cell-inner/.cell-text, colgroupHTML)
// so this entry looks pixel-identical to one row of the real thing — just without that
// system's dynamic pixel-based column-width/scroll JS (layoutSourceTableColumns), which is
// wired to a real mounted card's own resize lifecycle; equal percentage widths here (via
// colgroupHTML itself, already percentage-based) give the same aligned look for a fixed-width
// popup with a normal number of columns.
function renderAddToSourcePopup(prefillText: string): void {
  const appState = getAppState();
  const popup = document.getElementById("add-to-source-popup");
  if (!popup) return;
  const target = appState.addToSourceTarget;
  const table = target ? target.table : null;
  const headers = table ? table.tableData[0].map((h) => stripHtml(h || "")) : [];
  const numCols = headers.length;
  const pillWidth = numCols ? (100 / numCols).toFixed(4) : 100;
  const pillsHTML = headers
    .map(
      (h, i) => `
            <div class="col-name-slot" style="width:${pillWidth}%">
                <div class="col-name-pill"><input type="text" class="col-name-input" readonly value="${escapeHtml(h)}" placeholder="Column ${i + 1}"></div>
            </div>`,
    )
    .join("");
  const cg = colgroupHTML(numCols);
  const cellsHTML = headers
    .map(
      (_, i) => `
            <td>
                <div class="cell-inner">
                    <div class="cell-text add-to-source-cell-input" contenteditable="true" data-col="${i}">${i === 0 ? escapeHtml(prefillText || "") : ""}</div>
                </div>
            </td>`,
    )
    .join("");
  const entryHTML = numCols
    ? `<div class="add-to-source-entry">
                   <div class="add-to-source-entry-table">
                       <div class="static-table-header-track">${pillsHTML}</div>
                       <div class="static-table-row"><div class="table-rounded"><table class="item-table">${cg}<tbody><tr>${cellsHTML}</tr></tbody></table></div></div>
                   </div>
                   <button type="button" class="add-to-source-add-btn" title="Add entry"><img src="/assets/icons/add.png" alt="Add"></button>
               </div>`
    : `<div class="add-to-source-empty">This source has no columns yet — open it to add one first.</div>`;
  popup.innerHTML = `
            <input type="text" class="add-to-source-search" placeholder="Search sources by name…" value="${target ? escapeHtml(target.folder.title) : ""}">
            <div class="add-to-source-results"></div>
            ${target ? entryHTML : `<div class="add-to-source-empty">No sources yet — create one from the Add menu first.</div>`}
        `;
  const searchEl = popup.querySelector(".add-to-source-search") as HTMLInputElement;
  const resultsEl = popup.querySelector(".add-to-source-results") as HTMLElement;
  searchEl.onmousedown = (e) => e.stopPropagation();
  searchEl.oninput = () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) {
      resultsEl.innerHTML = "";
      resultsEl.classList.remove("open");
      return;
    }
    const matches = findAllSourceFolders()
      .filter((f) => f.title.toLowerCase().includes(q))
      .slice(0, 8);
    resultsEl.innerHTML = matches.length
      ? matches
          .map(
            (f) =>
              `<div class="add-to-source-result" data-fid="${f.id}">${escapeHtml(f.title)}</div>`,
          )
          .join("")
      : `<div class="add-to-source-result add-to-source-no-match">No matches</div>`;
    resultsEl.classList.add("open");
    resultsEl.querySelectorAll(".add-to-source-result[data-fid]").forEach((row) => {
      (row as HTMLElement).onclick = () => {
        const fid = (row as HTMLElement).dataset.fid as string;
        const f = appState.folders[fid];
        appState.addToSourceTarget = {
          folder: f,
          table: f.items.find((i) => i.kind === "table") as unknown as TableItem,
        };
        renderAddToSourcePopup(prefillText);
      };
    });
  };
  const addBtn = popup.querySelector(".add-to-source-add-btn") as HTMLElement | null;
  if (addBtn) {
    addBtn.onclick = () => {
      // .innerHTML (not .value/.textContent) — matches how a real source cell is
      // stored (see updateTableCell: it.tableData[r][c] = el.innerHTML).
      const cells = Array.from(popup.querySelectorAll(".add-to-source-cell-input")).map(
        (el) => (el as HTMLElement).innerHTML,
      );
      if (!cells.some((c) => stripHtml(c).trim())) return;
      // saveSnapshot/scheduleWorkspaceSave both operate on the whole `folders` object,
      // not just the current one (see their own definitions) — safe to call here even
      // when the target source lives in a folder other than the one open right now.
      window.__saveSnapshot!();
      appState.addToSourceTarget!.table.tableData.push(cells);
      window.__scheduleWorkspaceSave!();
      if (appState.currentFolderId === appState.addToSourceTarget!.folder.id) window.__render?.();
      closeAddToSourcePopup();
    };
  }
}
export function openAddToSourcePopup(): void {
  const appState = getAppState();
  const text = currentSelectionText();
  const host = appState.selectionToolbarHostEl;
  const rect = appState.selectionToolbarRect;
  hideSelectionToolbar();
  appState.addToSourceTarget = findDefaultSourceForItem(host);
  const popupWidth = 280;
  let left = rect ? Math.round(rect.left) : window.innerWidth / 2 - popupWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
  const estPopupHeight = 280; // rough estimate ahead of layout, same tradeoff as toolbarWidth above
  const top = rect
    ? Math.max(
        8,
        Math.min(window.innerHeight - estPopupHeight - 8, Math.round(rect.top + rect.height + 10)),
      )
    : window.innerHeight / 2 - estPopupHeight / 2;
  // flushSync'd (see useAddToSourcePopupStore's own comment) — the div must
  // already exist in the DOM before renderAddToSourcePopup below can find it.
  flushSync(() => useAddToSourcePopupStore.setState({ isOpen: true, left, top }));
  renderAddToSourcePopup(text);
}

// Called once from DottoApp's own mount effect (app/dotto-app.jsx) — needs live
// window.__getAppState right at wire time (to read appState.searchInput and wire its own
// listeners), so a single readiness check isn't enough — same reasoning
// app/dotto/lib/aiAssistantSuggestions.ts's own wireAiAssistantSuggestions gives. The two
// document-level listeners below (selectionchange, pointerdown for the toolbar's own
// outside-click) are genuinely appState-free — they only touch the DOM/appState inside their own
// handler bodies, called after this file's other functions are already safe to call — so they're
// registered unconditionally here rather than gated behind the same readiness check as the
// searchInput block.
function doWire(): void {
  const appState = getAppState();
  document.addEventListener("pointerdown", (e) => {
    const popup = document.getElementById("add-to-source-popup");
    if (popup && !popup.contains(e.target as Node)) closeAddToSourcePopup();
  });
  document.addEventListener("selectionchange", () => {
    // A selectionchange firing because the user is typing inside the add-to-source popup's
    // own search box isn't a text highlight to react to. React only renders the popup at all
    // while open (see app/dotto/AddToSourcePopup.jsx) — this file can't import from app/ to
    // read the bridge store directly (same constraint noted throughout
    // app/dotto/lib/coreState.ts), so the element's mere presence in the DOM doubles as the
    // open-check here.
    if (document.getElementById("add-to-source-popup")) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideSelectionToolbar();
      return;
    }
    const anchorEl =
      sel.anchorNode &&
      (sel.anchorNode.nodeType === 1
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement);
    // .pdf-text-layer alongside the usual [contenteditable] — pdf.js's TextLayer renders real,
    // positioned, selectable <span>s directly into the main document (no iframe involved for
    // PDFs, unlike EPUB above), so it Just Works here once recognized as a valid host — see
    // buildPdfViewer.
    const host =
      anchorEl && anchorEl.closest && anchorEl.closest('[contenteditable="true"], .pdf-text-layer');
    if (!host) {
      hideSelectionToolbar();
      return;
    }
    showSelectionToolbarFor(sel.getRangeAt(0).cloneRange(), host as HTMLElement);
  });
  // Outside click hides it — same convention as the game options panel's own document-level
  // pointerdown listener.
  document.addEventListener("pointerdown", (e) => {
    // React only renders #selection-toolbar at all while open (see
    // app/dotto/SelectionToolbar.jsx) — this file can't import from app/ to read the bridge
    // store directly (same constraint noted throughout app/dotto/lib/coreState.ts), so the
    // element's mere presence in the DOM doubles as the open-check here.
    const toolbarEl = document.getElementById("selection-toolbar");
    if (toolbarEl && !toolbarEl.contains(e.target as Node)) hideSelectionToolbar();
  });

  if (appState.searchInput) {
    // Clicking the input again after it already has focus (e.g. right after a completed
    // search, which doesn't blur it) doesn't re-fire the browser's own `focus` event — so
    // onfocus="handleSearchFocus()" alone would silently do nothing until the next keystroke.
    // Calling it here too makes a click always reopen the initial-suggestion state.
    appState.searchInput.addEventListener("click", (e) => {
      e.stopPropagation();
      window.handleSearchFocus?.();
    });
    appState.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        window.__clearSearch?.();
        return;
      }
      // Slash-command mode (see app/dotto/lib/commandPalette.ts) — Arrow/Enter get their own
      // meaning here (navigate/execute a command) instead of falling through to the general
      // Enter-submits-search handler below. Every other key (typing, Backspace, Tab, ...)
      // intentionally falls through to the textarea's normal behavior — nothing here should
      // ever swallow an edit keystroke.
      if (appState.searchInput.value.startsWith("/")) {
        if (e.key === "ArrowDown" && appState.searchCommandPalette.style.display === "block") {
          e.preventDefault();
          setCommandActive(appState.commandActiveIndex + 1);
          return;
        }
        if (e.key === "ArrowUp" && appState.searchCommandPalette.style.display === "block") {
          e.preventDefault();
          setCommandActive(appState.commandActiveIndex - 1);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (
            appState.searchCommandPalette.style.display === "block" &&
            appState.commandActiveIndex >= 0
          ) {
            const items = Array.from(
              appState.searchCommandPalette.querySelectorAll(".command-palette-row"),
            );
            const target = items[appState.commandActiveIndex] as HTMLElement | undefined;
            if (target) {
              target.click();
              return;
            }
          }
          executeCurrentCommand(appState.searchInput.value);
          return;
        }
      }
      // Mirrors the global Enter-to-open shortcut (see the document-level keydown handler,
      // which only fires while nothing's focused) — once the box itself is focused and still
      // empty, Enter closes it back up instead of submitting, so the same key toggles the
      // search bar open/closed depending on which state it's already in. Checked before the
      // general Enter-submits-search handler below, so a non-empty box still submits as usual.
      if (e.key === "Enter" && appState.searchInput.value.trim() === "") {
        e.preventDefault();
        window.__clearSearch?.();
        appState.searchInput.blur();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Enter on whatever's typed commences a Dotbot search — or, for a mnemonic-shaped
        // query ("generate a mnemonic for X" / "my mnemonic for X is Y"), routes straight
        // into story+image generation instead (see commenceSearchOrMnemonic/
        // parseMnemonicIntent).
        const value = appState.searchInput.value.trim();
        if (value) commenceSearchOrMnemonic(value);
      }
    });
  }
}

const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

export function wireSearchOrchestrationSelection(): () => void {
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
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see wireAiAssistantSuggestions's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}
