import { create } from "zustand";

// Source page's row tag picker popover (app/dotto/lib/sourceTagsAi.ts's renderCellTagPickerList)
// — { rows: [{tagId, name, color, selected, renaming}], id, r }. Genuine JSX, including the
// rename row's plain <input> (not contentEditable, so none of the caret-regression risk that
// ruled out converting the Source table's own cells or the Item Detail/Publish Flow
// contentEditable fields) — see CellTagPickerList.jsx. The picker's own show/hide/position and the
// new-tag row + tag-context-menu stay vanilla (static markup, untouched by this conversion).
// Migrated from bridges.js's hand-rolled createStore to real Zustand (see PHASE4_ROADMAP.md's
// Zustand migration plan, batch 8) — not flushSync'd.
export interface CellTagPickerRow {
  tagId: string;
  name: string;
  color: string;
  selected: boolean;
  renaming: boolean;
}

export interface CellTagPickerListState {
  rows: CellTagPickerRow[];
  id: number | null;
  r: number | null;
}

export const useCellTagPickerListStore = create<CellTagPickerListState>(() => ({
  rows: [],
  id: null,
  r: null,
}));
