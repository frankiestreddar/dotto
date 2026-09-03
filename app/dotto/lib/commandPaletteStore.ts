import { create } from "zustand";
import type { CommandRow } from "./commandPalette";

// #search-command-palette (app/dotto/lib/commandPalette.ts's updateCommandPalette) — the
// slash-command live suggestions list. Genuine JSX rows, portaled via createPortal unlike the
// single-owner panels (translationPanelStore and siblings), since there IS real list identity
// here (real list identity, clicked rows need their own onClick) — see CommandPalette.jsx.
// IMPORTANT: because this is a real portal (React tracks its children), nothing outside
// CommandPalette.jsx may touch #search-command-palette's innerHTML/children directly — always go
// through useCommandPaletteStore.setState(null) to clear it, never a raw DOM write (that would
// desync React's fiber tree from the actual DOM and risk a crash on the next update). Plain
// attribute reads/writes on the node itself (style.display, querySelectorAll for the existing
// keyboard-nav code) are fine — React's portal only owns the CHILDREN, never the target node's
// own attributes. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 3) — every producer still wraps its setState
// call in flushSync, same reasoning as before: it's a real portal, and
// app/dotto/lib/searchOrchestrationSelection.ts's command-mode keydown branches read its rows via
// querySelectorAll synchronously right after.
export interface CommandPaletteState {
  rows: CommandRow[];
}

export const useCommandPaletteStore = create<CommandPaletteState | null>(() => null);
