import { CARD_KINDS, DEFAULT_CARD_SIZE } from "./cardKinds";

interface AddMenuItem {
  kind: string;
  statKind?: string;
  label: string;
  icon: string;
}
interface AppState {
  ADD_MENU_DATA: Record<string, { label: string; categoryDesc: string; items: AddMenuItem[] }>;
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Block-kind metadata helpers ----------
// The Add-menu UI itself (grid/search/wiring) moved to app/dotto/lib/blocksPanel.ts when
// Essentials was repurposed into the Blocks panel (explicit request) — these three pure lookups
// live on their own, independently of anything panel-related.

// sentence/checklist: no longer creatable from the add-menu (checklist removed from
// ADD_MENU_DATA; sentence was never in it), but existing cards of both kinds on canvases keep
// working — this keeps their label correct everywhere kindLabel is used, rather than falling
// through to the raw kind string below. See cardKinds.ts for why only these two specials live in
// the shared registry and not e.g. flashcard's label (a different, and differently-valued,
// special case belongs to miniLabelForItem instead).
export function kindLabel(kind: string): string {
  if (CARD_KINDS[kind]?.label) return CARD_KINDS[kind].label;
  const appState = getAppState();
  for (const tab of Object.values(appState.ADD_MENU_DATA)) {
    const found = tab.items.find((i) => i.kind === kind);
    if (found) return found.label;
  }
  return kind;
}

export function searchKindLabel(it: { kind: string; level?: number }): string {
  const appState = getAppState();
  if (it.kind === "title") return "H" + (it.level || 1);
  if (it.kind === "folder") return "Canvas";
  if (appState.ADD_MENU_DATA.tools.items.some((i) => i.kind === it.kind)) return "Tool";
  if (appState.ADD_MENU_DATA.games.items.some((i) => i.kind === it.kind)) return "Game";
  return kindLabel(it.kind);
}

export function kindSize(kind: string): { w: number; h: number } {
  return CARD_KINDS[kind]?.defaultSize || DEFAULT_CARD_SIZE;
}
