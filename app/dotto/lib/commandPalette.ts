import {
  copyTarget,
  inviteUser,
  obtainTarget,
  placeTarget,
  removeUser,
  setVisibility,
} from "./commandVerbs";
import { parseCommandInput, type ParsedCommand } from "./commandParser";
import {
  GLOBAL_ID_SHAPE,
  resolveCommandTarget,
  searchAccessibleByNameAll,
  searchOwnTreeByNameAll,
} from "./commandTargetLookup";
import { flushSync } from "react-dom";
import { useCommandPaletteStore } from "./commandPaletteStore";

interface AppState {
  commandSuggestDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  searchInput: HTMLInputElement;
  commandActiveIndex: number;
  searchCommandPalette: HTMLElement;
  currentUser: { id: string };
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

export type CommandRow =
  | { type: "kind"; key: string; kind: string; label: string; sublabel: string }
  | { type: "own"; key: string; kind: string; folderId: string; label: string; sublabel: string }
  | {
      type: "shared";
      key: string;
      kind: string;
      ownerId: string;
      folderId: string;
      title: string;
      label: string;
      sublabel: string;
    }
  | { type: "id"; key: string; kind: string; globalId: string; label: string; sublabel: string };

// ---------- Slash-command suggestions panel (see commandParser.ts/commandTargetLookup.ts/
// commandVerbs.ts — orchestration lives here since it's the one place that needs all three) ----------
// Builds the SYNCHRONOUS/instant rows for the current input — kind-stage rows are a static pair;
// target-stage rows are the caller's own-tree name matches (searchOwnTreeByNameAll, already
// loaded locally, no round trip). The nested shared-tree half (scheduleSharedCommandSuggestions
// below) is a real network call, debounced and merged in separately once it resolves, so typing
// itself never waits on it. An id-shaped target gets a single "look up this id" row instead of a
// name search, since ids and free-text titles don't need to compete for the same row — actual id
// resolution only happens once that row is actually selected.
function buildOwnCommandRows(parsed: ParsedCommand | null): CommandRow[] {
  if (!parsed) return [];
  if (parsed.stage === "kind") {
    return ["source", "canvas"]
      .filter((k) => k.startsWith(parsed.kindPrefix))
      .map((k) => ({
        type: "kind" as const,
        key: `kind-${k}`,
        kind: k,
        label: `/${k}`,
        sublabel: `Look up a ${k} by name or id`,
      }));
  }
  // stage === 'target'
  if (parsed.verb !== "obtain") {
    // Every verb executes directly on Enter (see executeCurrentCommand) once it's typed out
    // in full — no target-picker row needed at that point, the target text is already fixed.
    // No suggestion rows make sense here once a real verb appears.
    return [];
  }
  if (GLOBAL_ID_SHAPE.test(parsed.targetRaw)) {
    return [
      {
        type: "id",
        key: "id",
        kind: parsed.kind,
        globalId: parsed.targetRaw,
        label: parsed.targetRaw,
        sublabel: `Look up this ${parsed.kind} by id`,
      },
    ];
  }
  return searchOwnTreeByNameAll(parsed.targetRaw, parsed.kind).map((m) => ({
    type: "own" as const,
    key: `own-${m.folder_id}`,
    kind: m.kind,
    folderId: m.folder_id,
    label: m.title || "(untitled)",
    sublabel: m.kind === "source" ? "Source" : "Canvas",
  }));
}

// Nested shared-tree matches (search_accessible_by_name RPC, see its own migration) — debounced
// the same way scheduleLiveSuggestions debounces the AI suggestions fetch
// (app/dotto/lib/aiAssistantSuggestions.ts), and merged into whatever own-tree rows are already
// showing rather than replacing them, since both can legitimately have matches at once.
// Re-derives the own-tree rows fresh at merge time (cheap/synchronous) instead of reading
// useCommandPaletteStore's own current state back — simpler than reconstructing which of its two
// producers (this one vs. updateCommandPalette below) most recently wrote it.
function scheduleSharedCommandSuggestions(parsed: ParsedCommand | null): void {
  const appState = getAppState();
  clearTimeout(appState.commandSuggestDebounceTimer);
  if (
    !parsed ||
    parsed.stage !== "target" ||
    parsed.verb !== "obtain" ||
    !parsed.targetRaw ||
    GLOBAL_ID_SHAPE.test(parsed.targetRaw)
  ) {
    return;
  }
  const valueAtScheduleTime = appState.searchInput.value;
  appState.commandSuggestDebounceTimer = setTimeout(async () => {
    const shared = await searchAccessibleByNameAll(parsed.targetRaw, parsed.kind);
    if (!shared.length || appState.searchInput.value !== valueAtScheduleTime) return; // stale or nothing to add
    const ownRows = buildOwnCommandRows(parsed);
    const sharedRows: CommandRow[] = shared.map((m) => ({
      type: "shared" as const,
      key: `shared-${m.owner_id}-${m.folder_id}`,
      kind: m.kind,
      ownerId: m.owner_id,
      folderId: m.folder_id,
      title: m.title,
      label: m.title || "(untitled)",
      sublabel: `Shared • ${m.kind === "source" ? "Source" : "Canvas"}`,
    }));
    flushSync(() => useCommandPaletteStore.setState({ rows: [...ownRows, ...sharedRows] }));
  }, 250);
}

// Arrow-key row selection for #search-command-palette's own row list — see
// appState.commandActiveIndex's own comment.
export function setCommandActive(idx: number): void {
  const appState = getAppState();
  const items = Array.from(appState.searchCommandPalette.querySelectorAll(".command-palette-row"));
  if (!items.length) return;
  idx = ((idx % items.length) + items.length) % items.length;
  items.forEach((el) => el.classList.remove("active"));
  appState.commandActiveIndex = idx;
  items[idx].classList.add("active");
  items[idx].scrollIntoView({ block: "nearest" });
}

// Called from handleSearchInput's new command branch (app/dotto/lib/aiAssistantSuggestions.ts) on
// every keystroke while the box starts with "/". Returns the parsed state so the caller can decide
// whether to fall back to normal search (parsed === null) without parsing twice.
export function updateCommandPalette(value: string): ParsedCommand | null {
  const appState = getAppState();
  const parsed = parseCommandInput(value);
  appState.commandActiveIndex = -1;
  clearTimeout(appState.commandSuggestDebounceTimer); // a stale in-flight shared search must never clobber this fresh set of rows once it lands
  flushSync(() =>
    useCommandPaletteStore.setState(parsed ? { rows: buildOwnCommandRows(parsed) } : null),
  );
  scheduleSharedCommandSuggestions(parsed);
  return parsed;
}

// A row's own click handler (CommandPalette.jsx) and Enter-on-an-arrow-selected-row
// (app/dotto/lib/searchOrchestrationSelection.ts) both funnel through here.
export async function selectCommandRow(row: CommandRow | null | undefined): Promise<void> {
  const appState = getAppState();
  if (!row) return;
  if (row.type === "kind") {
    appState.searchInput.value = `/${row.kind} `;
    appState.searchInput.focus();
    window.handleSearchInput?.(appState.searchInput.value);
    return;
  }
  if (row.type === "own") {
    obtainTarget({
      owner_id: appState.currentUser.id,
      folder_id: row.folderId,
      kind: row.kind,
      title: row.label,
      access: "owner",
      visibility: "private",
      source: "own",
      global_id: null,
    });
    return;
  }
  if (row.type === "shared") {
    obtainTarget({
      owner_id: row.ownerId,
      folder_id: row.folderId,
      kind: row.kind,
      title: row.title,
      access: "collaborator",
      visibility: "private",
      source: "shared",
      global_id: null,
    });
    return;
  }
  if (row.type === "id") {
    const target = await resolveCommandTarget(row.kind, row.globalId);
    if (!target) {
      window.pushNotification?.({
        type: "command_error",
        message: `No ${row.kind} found for that id.`,
      });
      return;
    }
    obtainTarget(target);
  }
}

// Plain Enter with nothing arrow-selected — parses and resolves the FULL current value as a
// complete command (not just whatever's in the suggestions list), so typing the whole thing and
// hitting Enter works without ever touching arrows/clicks, same as any other command palette.
// Every verb the parser recognizes is wired up — resolves the target once, then dispatches to its
// own verb function, each of which owns reporting its own success/failure.
export async function executeCurrentCommand(value: string): Promise<void> {
  const parsed = parseCommandInput(value);
  if (!parsed || parsed.stage !== "target" || !parsed.targetRaw) return;
  const target = await resolveCommandTarget(parsed.kind, parsed.targetRaw);
  if (!target) {
    window.pushNotification?.({
      type: "command_error",
      message: `No ${parsed.kind} found matching "${parsed.targetRaw}".`,
    });
    return;
  }
  if (parsed.verb === "obtain") {
    obtainTarget(target);
    return;
  }
  if (parsed.verb === "set" && parsed.arg) {
    await setVisibility(target, parsed.arg);
    return;
  }
  if (parsed.verb === "invite" && parsed.arg) {
    await inviteUser(target, parsed.arg);
    return;
  }
  if (parsed.verb === "remove" && parsed.arg) {
    await removeUser(target, parsed.arg);
    return;
  }
  if (parsed.verb === "place") {
    placeTarget(target);
    return;
  }
  if (parsed.verb === "copy") {
    await copyTarget(target);
    return;
  }
}
