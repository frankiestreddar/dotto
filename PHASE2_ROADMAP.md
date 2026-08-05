# Phase 2 roadmap: componentizing dotto-script.js

## Status (updated — see the restructuring plan this was folded into)

This document was written when `dotto-script.js` was 5,144 lines. It's now **12,825 lines**
across **579 functions** and **~70 named sections** (`grep "// ----------"`) — roughly 7,700 lines
of new features (achievements, live collaboration/presence, PDF/EPUB viewing, copy/paste, and
more) landed in the same monolith this document was written to get out of, before any of the
migration below started.

Current phase numbering (supersedes "Phase 2 increment N" below):

- **Phase 0 — safety net: done.** CI (`.github/workflows/ci.yml`, lint + build on every push/PR),
  `QA_CHECKLIST.md` (the manual regression pass CI can't do — no test infra exists yet), and this
  repo is now in git and pushed to GitHub.
- **Phase 1 — re-inventory, then mechanically modularize `dotto-script.js` into real ES modules**
  along subsystem boundaries, zero behavior change. Not started. The subsystem inventory below is
  the *starting point* for this, not the finished list — a fresh section-marker scan turned up
  named blocks with no home in it yet: **Copy/Cut/Paste**, **Achievements**, **Pricing/upgrade**,
  **Dotbot Scheduling Conversation**, **due-time / day-change / paid-tier-ad notifications**,
  **Collaborators Pill/Panel**, **Friend presence**, **Live canvas presence + real-time content
  sync**, **PDF viewer** / **EPUB viewer** (media sub-kinds), **cell tag picker + tag right-click
  menu**, **Dotbot-generated source content**, **card-dragged-into-search AI context**, **animated
  placeholder / live AI suggestions**, **mnemonic story/image**, **text-selection toolbar / add-to-
  source popup**, **library item detail view**, **publish flow**. Folding these into named buckets
  (new ones where they don't fit an existing one) is Phase 1's first task, before any extraction.
- **Phase 2+ — convert each module to real React state**, one subsystem at a time, per the
  migration order below (updated once Phase 1's re-inventory lands).

## Where things stand

Phase 1 (lift-and-shim) is done and verified: the app runs under Next.js
(App Router, real Tailwind v4 + PostCSS build, no CDN scripts) with zero
behavior change from the original `Dotto.html`.

Phase 2 increment 1 (shell componentization) is also done: the ~270 lines
of static body markup are no longer one blob. They're split into 18
byte-verified fragments (`content/fragments/*.html`), each rendered by a
small named component in `app/dotto/sections/` (`TopBar`, `AddMenu`,
`SchedulePanel`, `MarketplacePanel`, etc.). This was safe to do mechanically
because none of the original CSS or script relies on these containers being
direct children of `<body>` or on sibling order (`:nth-child` etc.) — see
the comment in `app/dotto-app.jsx` for how that was confirmed.

**What's still exactly as it was in `Dotto.html`:** all runtime behavior.
`public/dotto-script.js` is still one 5,144-line classic script, still
`document.getElementById`-driven, still holding all state in top-level
`let`/`const` closures. Nothing in it has been rewritten yet. That's the
work this document plans out.

## Why this is a multi-pass job, not a single rewrite

`dotto-script.js` has 269 functions sharing mutable state through closures
(`tx, ty, scale`, `idCounter`, `historyStack`, `currentFolderId`,
`lastFocusedCell`, `activeTagRow`, the in-memory card/connection/drawing
arrays, etc.). Converting this to React state in one pass means touching
most of those 269 functions in one shot with no way to test each change in
isolation in this environment (no real browser reachable from here — see
"How this was verified" below). That's how you silently regress drag
behavior while fixing flashcards. Doing it subsystem-by-subsystem, each one
independently shippable and diffable against `Dotto.html`, is the safer
path and is what's planned below.

## Suggested state shape (also sets up the DB-sync future)

Item 2 on your roadmap ("constant autosave... state in a shape that could
later sync to a database") should drive the shape chosen *now*, even before
a database exists. Recommend converging the scattered globals into one
serializable per-canvas document, e.g.:

```
CanvasDoc {
  id, parentId, title, kind: 'root' | 'folder'
  view: { tx, ty, scale }
  items: Item[]        // every card: title/source/table/media/bookmark/
                        // checklist/watermark/flashcard/statcard/
                        // stopwatch/shelf/folder, keyed by id
  connections: Connection[]
  drawings: DrawStroke[]
  waypoints: Waypoint[]
  schedule: ScheduleEvent[]   // keeps schedule data co-located with the
                              // canvas it belongs to, which the future
                              // "schedule view mode" (item 10) will want
                              // to query across canvases
  history: { stack: CanvasDoc[], index }  // undo/redo — currently
                              // `historyStack`/`historyIndex` globals
}
```

A `CanvasDoc` per folder/canvas (root included) maps directly onto "each
user gets a unique root canvas" (item 1) and "layers deep become
collaborative" (item 4) — collaboration and autosave can both be scoped to
"save/broadcast this one `CanvasDoc`" rather than a single giant global
blob. It also gives item 6 (chat-room card) and item 5 (voice-chat card) an
obvious home: `Item.kind === 'chatroom' | 'voicechat'`, scoped to the
`CanvasDoc.id` they live on, which is exactly the "collaborators of this
canvas" scope you described.

## Card-kind registry pattern

Right now, "kind" is threaded through many functions as string checks
(`kindLabel`, `kindSize`, `miniIconForKind`, `renderFlashcardHTML` /
`renderMediaHTML` / `renderShelfHTML` / etc., each with its own render
function). Before converting these to React components, introduce a
registry:

```js
const CARD_KINDS = {
  title:     { label, defaultSize, Component: TitleCard, ... },
  folder:    { ... },
  source:    { ... },
  table:     { ... },
  media:     { ... },
  bookmark:  { ... },
  checklist: { ... },
  watermark: { ... },
  flashcard: { ... },
  statcard:  { ... },
  stopwatch: { ... },
  shelf:     { ... },
};
```

Every place that currently does `if (kind === 'flashcard') ... else if
(kind === 'media') ...` becomes `CARD_KINDS[kind].something`. This is the
single change that makes adding **chat-room** and **voice-chat** card kinds
(items 5–6) a matter of registering a new entry, not touching a dozen
existing functions again.

## Subsystem inventory (from the 269 functions)

Grouped from the actual function names in `dotto-script.js`, as a map from
"future component/hook" to "functions that belong to it":

- **Canvas core** (`useCanvasTransform` + `<CanvasArea>`) — `applyTransform`,
  `applyView`, `centerOnContent`, `centerView`, `render`, `layoutDotLayer`,
  `itemRect`, `itemCenter`, `bringCardToFront`, `findItemById`,
  `computeFolderDepths`, `isCustomFolderId`, `createCustomFolder`,
  `addItemToCustomFolderById`, `removeFromCustomFolder`. Highest risk,
  migrate last — everything else assumes this coordinate system.
- **Card add flow** (`<AddMenu>` + `useAddCard`) — `add`, `prepareAdd`,
  `cancelAddingKind`, `kindLabel`, `kindSize`, `searchKindLabel`,
  `miniIconForKind`, `miniLabelForItem`, `openAddMenu`, `closeAddMenu`,
  `switchAddTab`, `renderAddMenuList`, `showAddPreview`,
  `showPlacementGhost`, `removePlacementGhost`, `openCellAddMenu`,
  `closeSourceAddMenu`, `newSourceClicked`.
- **Card-kind renderers** (one component per kind, per the registry above)
  — `renderFlashcardHTML`, `renderMediaHTML`, `renderShelfHTML`,
  `renderStatcardHTML`, `renderStopwatchHTML`, `renderTableHTML`,
  `renderStaticTableHTML`, `renderChecklistHTML`, `renderInlineCanvas`,
  `renderRealCardPreview`. Best place to *start* — pick the simplest kind
  (statcard or watermark) as the first real React-state conversion.
- **Drag/resize/select** (`useDragSelect`) — `setupDraggingAndClicking`,
  `setupResizing`, `startBoxSelection`, `renderSelectedOutlines`,
  `linkSelectedCards`.
- **Connections** (`<ConnectionsLayer>`) — `applyConnections`,
  `ensureConnections`, `computeConnectorPoints`, `isValidConnection`,
  `renderConnectionsLayer`, `startConnectionDrag`, `findLinkedTable`,
  `propagateCanvasStreams`, `makeStreamPayload`,
  `aggregateDownstreamPerformance`, `diffRatings`, `applySrsUpdateStream`.
- **Drawing** (`<DrawingLayer>` + `useDrawing`) — `ensureDrawings`,
  `startDrawStroke`, `setDrawMode`, `toggleDrawFromMenu`,
  `updateDrawLayerBtns`, `updateDrawToolBtns`, `makeLayerSVG`,
  `pathToPoints`, `pointsToPath`, `pointsToLinePath`, `pathNearPoint`,
  `pathAvoidsObstacles`, `distToSegment`, `segmentHitsRect`,
  `rectEdgePoint`, `nearestOf`, `waypointIcon`, `waypointLabel`,
  `buildWaypoints`, `goToWaypoint`, `setWaypointActive`. Self-contained and
  low-risk — good second migration target after a simple card kind.
- **Flashcards / SRS** (`useSrs` hook, shared by `<FlashcardCard>`) —
  `defaultSrsState`, `ensureSrsMeta`, `getSrsForRow`, `calculateSM2`,
  `fcCardName`, `fcCellText`, `fcCurrentRow`, `fcFlip`, `fcRate`,
  `fcRowIndices`, `fcToggleMode`, `ensureFcOrder`, `defaultFlashcardDeck`,
  `shuffleArr`. Isolated pure logic (`calculateSM2` especially) — good unit
  test candidate once extracted.
- **Source / table** (`<SourceCard>`, `<TableCard>`) — the largest single
  cluster: `addTableCol`, `addTableRow`, `addRow`, `colgroupHTML`,
  `distributeTableSizing`, `layoutSourceTableColumns`, `renameTableColumn`,
  `updateTableCell`, `focusTableCell`, `handleTableKeydown`,
  `handleColNameKeydown`, `setTableAlign`, `attachStaticTableHoverZones`,
  `deleteContextColumn`, `deleteContextRow`, `highlightContextColumn`,
  `highlightContextRow`, `ensureTableTags`, `toggleCellTag`,
  `ensureCellTags`, `refreshCellTagsDom`, `renderCellTagPickerList`,
  `createTagFromCellPicker`, `showCellTagPickerNewRow`,
  `hideCellTagPickerNewRow`, `closeCellTagPicker`, `openRowTagPicker`,
  `tagPillsHTML`, `importDelimitedIntoSource`, `parseDelimited`,
  `extractCardsFromSource`, `goToSourceRow`, `performSourceSearch`,
  `triggerSourceUpload`, `triggerCellImageUpload`, `triggerCellAudioUpload`,
  `startCellAudioRecording`, `stopCellAudioRecording`, `setMediaFromLink`,
  `clearMedia`, `triggerMediaUpload`, `insertIntoActiveCell`,
  `setLastFocusedCell`. Migrate last among card kinds — highest surface
  area.
- **Checklist** — `addTask`, `toggleTask`, `removeTask`, `updateTaskText`,
  `updateTaskDeadline` (+ `renderChecklistHTML` above).
- **Shelf** — `shelfSelectSession` (+ `renderShelfHTML` above).
- **Stopwatch** (`useStopwatch`) — `swTick`, `swTogglePause`,
  `swToggleRun`, `swFormatTime`, `swCurrentElapsedMs`, `ensureSwTicking`,
  `tick` (+ `renderStopwatchHTML` above). Self-contained timer state, good
  early migration target.
- **Schedule panel** (`<SchedulePanel>` + `useSchedule`) —
  `openSchedulePanel`, `closeSchedulePanel`, `positionSchedulePanel`,
  `scheduleApplyTransform`, `scheduleShiftDay`, `renderScheduleEvents`,
  `openScheduleEdit`, `closeScheduleEdit`, `saveScheduleEdit`,
  `removeScheduleEdit`, `scheduleContextItem`, `scheduleHoverClose`,
  `formatDateLabel`, `dateKey`, `findNextFreeSlot`, `relativeTimeLabel`.
  Note for item 10 (schedule overhaul): keep `scheduleEvents` reads
  separated from write/edit logic now, since the future "schedule view
  mode" needs to read across canvases without depending on any single
  canvas's edit UI being mounted.
- **Hamburger menu** — `toggleHamburgerMenu`, `openHamburgerMenu`,
  `closeHamburgerMenu`, `positionHamburgerMenu`, `hmenuAction`,
  `closeAllPanels`. Note for item 6: this is also the natural home for a
  future voice-chat toggle.
- **Profile / Messages / Collaborators panels** — straightforward
  presentational + list-filter logic
  (`openProfilePanel`/`openMessagesPanel`/`openCollabPanel` clusters,
  `renderMsgList`, `renderCollabList`, `sendMsg`, `renderConvoBody`, etc.).
  Currently backed by in-memory fixtures — item 3 (real friends/messaging)
  will replace the data source, not the component shape, if these are
  extracted now with a clean data-fetching seam.
- **Marketplace / cart** — `openCartPanel`, `closeCartPanel`,
  `switchCartTab`, `positionCartPanel`, `renderMarketplaceDiscover`,
  `handleMarketplaceSearch`, `showCategoryPreview`, `openMarketDetail`,
  `closeMarketDetail`, `purchaseCurrentMarketItem`,
  `packageSelectedAsTemplate`, `deployPurchasedTemplate`, `publishDraft`,
  `saveDraftFromEditor`, `openDraftEditor`, `closeDraftEditor`,
  `makeDraftItemDraggable`, `renderLibrary`, `switchLibraryFolder`,
  `renderLibrarySearchResults`, `handleLibrarySearch`, `saveSnapshot`,
  `performMerge`. `purchaseCurrentMarketItem` is the obvious future Stripe
  integration point (item 7) — worth isolating behind a single function
  early so payment logic has one call site to replace.
- **Search bar** — `handleSearchInput`, `handleSearchFocus`, `clearSearch`,
  `setSearchActive`, `animateSearchPlaceholder`, `updateSearchDropdown`,
  `renderSearchSuggestions`, `performCanvasSearch`, `getItemSearchText`,
  `goToCanvasItem`. This is the box item 8 ("Dottie") plugs into — worth
  giving it a dedicated `<SearchBar>` component with a clear
  input-submitted hook now, so routing a query to Dottie later is a branch,
  not a rewrite.
- **Zoom controls** — `setZoomFromClientX`, `setZoomFromClientY`,
  `updateZoomUI`, `updateZoomBarUI`.
- **Undo/redo** (`useHistory`) — `undo`, `redo`, `afterHistoryChange`.
  Extract in tandem with whatever state shape wins (see above) since it
  currently snapshots the same globals every other subsystem mutates.
- **Context menus** — `showCanvasContextMenu`, `hideCanvasContextMenu`,
  `updateContextMenuPosition`, `openTableCellContextMenu`,
  `deleteContextMenu`, `clearContextDeleteHighlight`.
- **Cursor/mode toggling** — `applyCursorMode`, `effectiveMode`,
  `beginModeOverride`, `endModeOverride`, `updateModeToolbarUI`.
- **Text/title editing utils** — `setTitleLevel`, `titleFontSize`,
  `editBookmark`, `escapeHtml`, `stripHtml`, `isCaretAtStart`,
  `isCaretAtEnd`, `placeCaretEnd`.
- **Misc utilities** — `shortUrl`, `rgbToHex`, `syncColorPicker`, `pad2`,
  `wrapPhase`, `generateFromInput`, `importSharedCardsAtScreenPoint`,
  `openSharedCanvasView`, `closeSharedCanvasView`, `handleAddItemClick`.
  These have no real subsystem home; keep as a `lib/dotto-utils.js` module
  as each caller gets migrated.

## Suggested migration order

1. **Stopwatch card** — fully self-contained timer state, zero
   cross-subsystem coupling. Good first real React-state conversion to
   validate the pattern (hook + component + registry entry) end to end.
2. **Drawing layer** — self-contained SVG path math, only reads canvas
   transform, doesn't need to touch card state.
3. **Checklist card** and **Statcard/Watermark** — simple, low-coupling
   card kinds, good practice for the registry pattern before tackling
   flashcards/tables.
4. **Flashcards / SRS** — isolated logic (`calculateSM2` etc.), higher
   value to get right early since it's a named feature in your pitch.
5. **Schedule panel** — mostly UI + a flat events array; do this before the
   schedule overhaul (item 10) lands so the overhaul builds on React state,
   not global-closure state.
6. **Hamburger menu + Profile/Messages/Collaborators panels** — UI-heavy,
   low logic risk, but touch this before wiring real backend data (items 1,
   3) so the seam is already React state, not DOM queries.
7. **Marketplace/cart** — biggest UI surface after source/table; do after
   the card-kind registry pattern is proven, since drafts/library items
   embed mini card previews.
8. **Source/table cards** — largest, most interconnected card kind; last
   among card kinds.
9. **Connections layer + drag/resize/select + canvas core** — do these
   together, last. Every other subsystem depends on canvas coordinates and
   card positions; this is where undo/redo, connections, and drag state
   all meet, so it's the highest-regression-risk chunk and benefits most
   from everything else already being proven out.

After each subsystem, the check that was used to verify Phases 1–2 in this
pass still applies: diff the relevant DOM ids/classes/content against
`Dotto.html`, confirm `node --check` on the script (or, once a piece is
real React, that Next's build passes), and do a manual click-through in a
real browser — which brings up the one gap in this pass, below.

## How this was verified (and what's still on you)

This environment can run the Next.js dev server, curl it, and diff its
HTML/CSS/JS output against the original file byte-for-byte — which is what
Phases 1 and 2-increment-1 were verified with:

- `content/fragments/*.html` reconstruct `Dotto.html` lines 718–986 exactly
  (programmatically diffed).
- `public/dotto-script.js` is byte-identical to `Dotto.html` lines 988–6131
  (diffed) and passes `node --check` (no syntax errors from extraction).
- The dev server serves the page at HTTP 200 with the same ids, same
  visible text content, and the same script/asset references as the
  original file would produce.
- The Tailwind v4 build (`@source` directives in `app/globals.css`)
  correctly generates CSS for utility classes used both in the markup
  fragments and inside `dotto-script.js` (spot-checked: `border-neutral-800`,
  `items-center`, plus the original custom CSS like `#align-pill`).

What it **cannot** do is click around a running instance in a real browser
— there's no way for a browser on your machine to reach a server running in
this sandbox. So the interactive walkthrough from the original task
(add each card kind, draw, connect cards, flip through an SRS deck, open
every hamburger sub-panel, click through the marketplace) hasn't been done
by an agent — you should run `npm run dev` and do that pass yourself before
treating parity as fully confirmed, especially the seven UI icons that
won't render (see `public/assets/icons/README.md`) and the marketplace/SRS
flows that depend on fixture data already baked into the script.
