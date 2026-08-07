// Card-kind metadata registry (Phase 2, see PHASE2_ROADMAP.md's "Card-kind registry pattern").
// Consolidates kindSize (add-menu.js) and miniIconForKind (live-presence.js) — two independent
// if/else chains in two different files, keyed by the same `kind` string but never sharing a
// data source — into one lookup. `label` here is ONLY kindLabel's own 2 genuine hardcoded
// specials (sentence, checklist); every OTHER function that produces a kind-dependent label
// (searchTypeLabel, searchKindLabel, miniLabelForItem) has its own real, function-specific
// special-casing that does NOT safely collapse into a shared field — confirmed by checking
// ADD_MENU_DATA's actual content before writing this: kindLabel('flashcard') returns "Flashcard"
// (singular, from ADD_MENU_DATA), while searchTypeLabel/miniLabelForItem need "Flashcards"
// (plural) for unrelated reasons of their own (see their own comments) — genuinely different
// values for the same kind, not duplicated data. Those three functions are deliberately left
// untouched rather than forced into this registry.
//
// Deliberately does NOT yet include a `Component:` slot for React-owned rendering. render()
// (waypoints-render-loop.js) does a full, unconditional teardown-and-rebuild of every card's DOM
// on nearly every canvas interaction (world.innerHTML = '', called from 15+ files) — there's no
// keyed diffing today, so making React actually own a card kind's DOM node means first modifying
// render()'s own teardown logic to cache wrapper elements/React roots by item id. That's real
// canvas-core surgery (PHASE2_ROADMAP.md flags canvas core as highest-risk, migrate last), kept
// deliberately separate from this metadata-only pass. Adding Component here later, once render()
// supports React-owned kinds, is additive and won't disturb what's here now.
export const CARD_KINDS = {
    title: { defaultSize: { w: 100, h: 50 }, icon: 'T' },
    folder: { defaultSize: { w: 448, h: 280 }, icon: '↗' },
    source: { defaultSize: { w: 7 * 28, h: 2 * 28 }, icon: '▶' }, // 2x7 grid cells (see #dot-layer's 28px spacing)
    table: { defaultSize: { w: 280, h: 180 }, icon: '⊞' },
    media: { defaultSize: { w: 240, h: 160 }, icon: '▣' },
    // No longer creatable from the add-menu (removed from ADD_MENU_DATA), kept so existing
    // checklist cards on canvases keep resolving a correct label/size/icon everywhere these are used.
    checklist: { label: 'Checklist', defaultSize: { w: 220, h: 160 }, icon: '☑' },
    embed: { defaultSize: { w: 320, h: 220 }, icon: '🌐' },
    watermark: { defaultSize: { w: 200, h: 80 }, icon: '≈' },
    flashcard: { defaultSize: { w: 15 * 28, h: 10 * 28 }, icon: '⟲' },
    typeright: { defaultSize: { w: 15 * 28, h: 8 * 28 } },
    statcard: { defaultSize: { w: 180, h: 110 }, icon: '📈' },
    stopwatch: { defaultSize: { w: 220, h: 70 }, icon: '⏱️' },
    shelf: { defaultSize: { w: 220, h: 170 }, icon: '🗄️' },
    filter: { defaultSize: { w: 220, h: 140 } },
    sentence: { label: 'Sentence', defaultSize: { w: 220, h: 130 } },
    // Collapsed size (1 grid cell) — .item.waypoint.expanded overrides via CSS, not this.
    waypoint: { defaultSize: { w: 28, h: 28 } },
};

export const DEFAULT_CARD_SIZE = { w: 200, h: 112 };
export const DEFAULT_CARD_ICON = '≡';
