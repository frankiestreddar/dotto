import { create } from "zustand";

// Item Detail view's footer button set (app/dotto/lib/libraryPublish.ts's
// renderItemDetailFooter) — { sourceFolder, itemId, dirty } | null. A natural, self-contained
// discriminated union (same "compute state, render 1-3 buttons" shape as ImageResultPanel),
// unlike the rest of the Item Detail/Publish Flow views: the title/price/desc fields
// (contentEditable title, autosave-on-blur for drafts, disabled-until-dirty tracking for
// published) and the entire Publish Flow form stay vanilla — no acute bug in any of it, and
// converting contentEditable fields to React state risks regressing caret behavior for zero
// behavior gain, same reasoning as the hamburger menu's Outline panel exception (see
// PHASE2_ROADMAP.md item 6). sourceFolder stays `string | null` (not narrowed to
// 'drafts'|'published'|'purchased') to match appState.detailSourceFolder's own real type exactly
// — a transport-only swap, not a fresh design pass. Migrated from bridges.js's hand-rolled
// createStore to real Zustand (see PHASE4_ROADMAP.md's Zustand migration plan, batch 7) — not
// flushSync'd.
export interface ItemDetailFooterState {
  sourceFolder: string | null;
  itemId: string;
  dirty: boolean;
}

export const useItemDetailFooterStore = create<ItemDetailFooterState | null>(() => null);
