# Phase 2 roadmap: componentizing dotto-script.js

## Status (updated — see the restructuring plan this was folded into)

This document was written when `dotto-script.js` was 5,144 lines. It's now **12,825 lines**
across **579 functions** (557 top-level) and **65 named sections** (`grep "// ----------"`) —
roughly 7,700 lines of new features landed in the same monolith this document was written to get
out of, before any of the migration below started.

Current phase numbering (supersedes "Phase 2 increment N" below):

- **Phase 0 — safety net: done.** CI (`.github/workflows/ci.yml`, lint + build on every push/PR),
  `QA_CHECKLIST.md` (the manual regression pass CI can't do — no test infra exists yet), and this
  repo is now in git and pushed to GitHub.
- **Phase 1 — re-inventory: done** (see the updated "Subsystem inventory" below — 65 sections
  audited function-by-function). **Mechanically split `dotto-script.js` into real ES modules:
  done.** `public/dotto-script.js` no longer exists — it's now ~30 modules under `public/dotto/`
  (e.g. `core-state.js`, `waypoints-render-loop.js`, `live-presence.js`, `srs-connections-core.js`
  — ~13,600 lines total across all of them), each a real ES module with real `import`/`export`.
  The two blockers this used to call out are both resolved: (1) the scattered `let` globals now
  live on one exported `appState` object (`core-state.js`); (2) the ~107 inline `onclick="..."`
  handler names are bridged via `window.fnName = fnName` assignments, concentrated in
  `public/dotto/window-bridge.js` (see that file's own header comment) plus a few more added
  per-module as needed for the React bridge (see the next bullet).
- **Phase 2+ — convert each module to real React state, one subsystem at a time — in progress.**
  All of "Suggested migration order" items 1–3 below are done (every overlay and every canvas
  card kind is a real Component under `app/dotto/`, keyed-diffed via `CanvasItemsLayer.jsx`
  instead of the old `world.innerHTML=''` full-teardown rebuild). Items 4–12 are still vanilla
  `public/dotto/*.js` code, unconverted.

## Where things stand

Phase 1 (lift-and-shim, then the real ES-module split) is done and verified: the app runs under
Next.js (App Router, real Tailwind v4 + PostCSS build, no CDN scripts) with zero behavior change
from the original `Dotto.html`, and every function that used to live in one 5,144-line (later
12,825-line) classic script now lives in a real, independently-importable ES module.

Phase 2 increment 1 (shell componentization) is also done: the ~270 lines of static body markup
are no longer one blob. They're split into 18 byte-verified fragments (`content/fragments/*.html`),
each rendered by a small named component in `app/dotto/sections/` (`TopBar`, `AddMenu`,
`SchedulePanel`, `MarketplacePanel`, etc.). This was safe to do mechanically because none of the
original CSS or script relies on these containers being direct children of `<body>` or on sibling
order (`:nth-child` etc.) — see the comment in `app/dotto-app.jsx` for how that was confirmed.

Phase 2 card-kind/overlay conversion (migration order items 1–3, plus the thin half of item 9) is
also done: every canvas item kind (checklist, embed, flashcard, folder/Canvas, media, note,
sentence, shelf, source, statcard, stopwatch, table, title, typeright, watermark, waypoint) is a
real React Component, and the old `world.innerHTML=''` full-rebuild render loop has been replaced
by `app/dotto/CanvasItemsLayer.jsx`'s keyed portal — see that file's own comments for how DOM node
identity (focus/scroll/CSS-transition state) is preserved across a `render()` call now, which the
old rebuild-from-scratch approach couldn't do. Two small overlay shells (Pricing/upgrade,
text-selection toolbar) are also real Components.

**What's still exactly as it was, functionally, even though it's a real ES module now:**
everything in migration-order items 4–12 below — still `document.getElementById`-driven, still
holding its state in `appState`/module-level closures rather than React state. That's the work
this document still plans out.

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
  items: Item[]        // every card: title/source/table/media/
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

## Subsystem inventory (re-audited at 12,825 lines / 579 functions / 65 sections)

The version of this table below the original "Phase 2 roadmap" heading was
written at 5,144 lines and is now stale in two ways, not just "missing new
features": (1) many function names it lists have been renamed, moved, or
removed entirely (34 old names no longer exist — mostly the old side-panel
Schedule UI, replaced by an in-canvas "Schedule View Mode" agenda overlay),
and (2) **the file's own `// ---------- Name ----------` section comments
are not reliable subsystem boundaries** — several large sections are
grab-bags. "SM-2 Spaced Repetition" (1,035 lines) contains real SRS code
but also connection-drag, draw-mode toggling, and the core `add()` card-
creation function. "Live canvas presence + real-time content sync" (lines
4224–5691, **1,468 lines — the single largest section in the file**) mixes
cursor-presence sync, remote drag/resize sync, diff-based content sync,
messaging functions, several unrelated card-kind helpers, and one entire
self-contained mini-canvas-preview widget (`renderInlineCanvas` + 8 private
nested helpers). **This matters directly for Phase 1**: splitting strictly
at the labeled comment boundaries would produce a few files that are just
as incoherent as the monolith is today. The two largest grab-bag sections
need a finer, function-level split (still mechanical, still order-
preserving within each resulting file) rather than a straight comment-to-
file cut.

Reconciled/updated buckets (functions confirmed present, current location):

- **Canvas core** — now physically scattered across 5 sections with no
  section of its own: `bringCardToFront`, `applyTransform`,
  `layoutDotLayer`, `itemRect`/`itemCenter`, `findItemById`, `render`,
  `centerOnContent`, `isCustomFolderId`/`createCustomFolder`/
  `addItemToCustomFolderById`/`removeFromCustomFolder`. `applyView`/
  `centerView`/`computeFolderDepths` no longer exist at top level —
  `applyView`/`centerView` are now two *different* private helpers, each
  scoped inside an unrelated inline-preview widget, not the real canvas.
  Still highest risk, still migrate last.
- **Card add flow** — spread across 5 sections now: `kindLabel`/`kindSize`/
  `searchKindLabel`/`switchAddTab`/`renderAddMenuList`/`newSourceClicked`
  (Add menu data), `cancelAddingKind`/`add` (inside SM-2 section),
  `showPlacementGhost`/`removePlacementGhost`/`prepareAdd`/`openAddMenu`/
  `closeAddMenu` (inside Copy/Cut/Paste section), `openCellAddMenu`/
  `closeSourceAddMenu`, `miniIconForKind`/`miniLabelForItem` (inside Live
  canvas presence section). `showAddPreview` is gone.
- **Card-kind renderers** — confirmed: `renderFlashcardHTML`,
  `renderMediaHTML`, `renderTableHTML`/`renderStaticTableHTML`,
  `renderChecklistHTML`, `renderInlineCanvas`/`renderRealCardPreview`.
  `renderShelfHTML` now lives inside the Stopwatch card section;
  `renderStatcardHTML` inside Checklist card. New:
  `renderGameFaceBlocksHTML`/`renderGameOptionsHTML`. (`renderEmbedHTML` — since removed: Embed
  is the first card kind converted to a real Component, see `EmbedCard.jsx`.)
- **Drag/resize/select** — `setupDraggingAndClicking` (Element Drag and
  Drop System section), `setupResizing`/`findNextFreeSlot`/
  `deleteSelectedCards`/`setTableAlign` (Element Resize System section),
  `startBoxSelection`/`renderSelectedOutlines` (Main Canvas Render Loop),
  `linkSelectedCards` (Card connections). Heavy `selectedCardIds`/
  `folders`/`currentFolderId` coupling throughout.
- **Connections** — core confirmed in "Card connections" section; SRS-
  adjacent connection code (`isValidConnection`, `propagateCanvasStreams`,
  `applyConnections`, `renderConnectionsLayer`, `startConnectionDrag`,
  stream payload helpers) lives inside the SM-2 grab-bag section instead.
  New: `createConnection`, `findTableById`, `connectedSourceCard`,
  `folderTitleForConnectedSource`, `folderIdForConnectedSource`.
- **Drawing** — core confirmed (`pathToPoints`, `distToSegment`,
  `pathNearPoint`, `makeLayerSVG`, `ensureDrawings`); mode-toggle functions
  now live inside the SM-2 section instead. Waypoint functions changed
  completely: `waypointIcon`/`waypointLabel`/`buildWaypoints`/`goToWaypoint`
  are gone, replaced by a new "Waypoint card expand/collapse" section (329
  lines) with DB-persisted waypoints (`syncWaypointToDb`,
  `deleteWaypointFromDb`) — new `supabase` coupling that didn't exist
  before.
- **Flashcards / SRS** — core confirmed (`defaultSrsState`, `ensureSrsMeta`,
  `getSrsForRow`, `calculateSM2`, `extractCardsFromSource`); the actual
  flashcard-app UI (`fcFlip`, `fcRate`, `fcToggleMode`, etc.) now lives in
  its own separate "Flashcard app" section. `calculateSM2` remains isolated
  pure logic — still the best unit-test candidate in the file.
- **Source / table** — still the largest card-kind cluster, now spread
  across 6 sections (Table card, cell image/audio insert, file import,
  tags, tag right-click menu, plus AI-generated-source-content). Still
  migrate last among card kinds.
- **Checklist**, **Shelf**, **Stopwatch** — confirmed, largely intact,
  Shelf gained real functions since (`filterShelfRows`,
  `startRenameShelfName`, `handleShelfSourceRowClick`,
  `startRenameShelfSourceRow`) plus a **Filter** card kind
  (`renderFilterHTML`/`setFilterMode`/`toggleFilterTag`) that didn't exist
  before.
- **Schedule panel** — substantially redesigned, not just moved. The old
  side-panel functions are gone entirely, replaced by an in-canvas agenda
  overlay: "Schedule View Mode" (`enterScheduleViewMode`,
  `renderScheduleAgenda`, `scheduleAgendaShift`, etc.).
- **Hamburger menu** — confirmed, plus new `openHubSubpanel`/
  `openWaypointsPanel`/`openHubCollabPanel`.
- **Profile / Messages / Friends panels** — renamed from "Profile /
  Messages / Collaborators panels" to avoid a real naming collision (see
  next bullet) — this bucket is the **friends/social system** (`renderMsgList`,
  `sendMsg`, `renderCollabList`, `refreshFriendsData`, friend requests).
  Heavy `supabase`/`friends` coupling (496-line "Collaborators Pill/Panel
  Controls" section alone).
- **Canvas collaborations (hamburger)** *(new bucket — was conflated with
  the one above)* — **canvas-sharing**, not friends: who can see *this
  specific canvas*. `refreshCanvasCollabData`, `respondToCanvasCollabRequest`,
  `renderHubCollabList`, `renderWaypointsList`, `goToWaypointCard`. Distinct
  from "Live-shared canvases" (below), which handles entering/exiting an
  already-accepted share, not the invite/request flow.
- **Marketplace / cart** — confirmed, now one 506-line section. `saveSnapshot`
  moved to the Stopwatch-ticking section (odd placement); `publishDraft`/
  `openDraftEditor`/`saveDraftFromEditor` replaced by two new sections,
  "Library item detail view" and "Publish flow" (below).
- **Search bar** — split between "Animated Placeholder" (which also grew
  text-alignment/read-aloud helpers unrelated to search) and "Canvas /
  source-row local matching" (`goToCanvasItem`, `goToSourceRow`,
  `computeCanvasMatches`). `animateSearchPlaceholder`/`performCanvasSearch`/
  `renderSearchSuggestions` are gone, superseded by the AI-orchestrated
  search pipeline (new buckets below).
- **Zoom controls** — reduced to 2 real top-level functions
  (`updateZoomUI`, `setZoomFromClientY`); `updateZoomBarUI`/
  `setZoomFromClientX` no longer exist at top level.
- **Undo/redo**, **Context menus**, **Cursor/mode toggling** — confirmed,
  unchanged in shape.
- **Misc utilities** — `generateFromInput` is gone; the rest confirmed but
  scattered further (`rgbToHex`/`syncColorPicker` now live inside the Live
  canvas presence section).

New buckets (no home in the old inventory — full detail, function names,
and per-bucket coupling notes available on request; summarized here):

- **Achievements** (216 lines) — moderate coupling (`currentUser`,
  `supabase`, tightly linked to Profile's `awardUserPoints`).
- **Pricing / upgrade** (79 lines) — self-contained, no global-state hits,
  good early migration candidate.
- **Copy / Cut / Paste** (140 lines, added this project) — moderate,
  shares its section with card-add-flow functions (see above).
- **Dotbot Scheduling Conversation** (88 lines) — low-moderate coupling.
- **Notifications** — two parts: 3 small scheduling-trigger producers
  (152 lines total) feeding a self-contained core queue/toast engine (253
  lines, `pushNotification`/`showNotification`/etc. — no cross-cutting
  global-state hits).
- **Friend presence** (104 lines) — real-time subscription lifecycle
  (`friendMessageChannels` Map) makes this riskier than its size suggests.
- **Live canvas presence + real-time content sync** (1,468 lines) — see
  the grab-bag warning above; highest coupling AND highest line count of
  any section, needs its own three-way split (presence sync / content diff
  sync / misc leftovers) before extraction, not a single move.
- **Media card** (130 lines, parent) with **PDF viewer** (115 lines) and
  **EPUB viewer** (77 lines) as largely self-contained sub-kinds wrapping
  pdf.js/epub.js.
- **Embed card** (85 lines) — self-contained, no global-state hits, converted to a real Component
  (`app/dotto/EmbedCard.jsx`), the first kind to make that jump: done. (Bookmark card was removed
  outright, not migrated — redundant with waypoints/other menus.)
- **Game options / cloze** (279 lines) — self-contained config/parsing
  shared by both Flashcard app and the new **Typeright app** (193 lines,
  a second typed-answer game mode) — extract before either of those two.
- **Dotbot-generated source content**, **Card-dragged-into-search AI
  context**, **Dotbot AI assistant core**, **Mnemonic story/image**,
  **Dictionary/examples/translation panel builders**, **Orchestrated
  search**, **Text-selection toolbar**, **Add-to-source popup** — the AI/
  search feature cluster, roughly 1,700 lines combined. Mostly low-to-
  moderate coupling (HTML-panel builders reading AI response data), with
  Orchestrated search as the dispatcher tying the others together —
  extract it after them, not before.
- **Live-shared canvases** (226 lines) — entering/exiting an already-
  accepted shared canvas (distinct from the invite-handling bucket above).
  High risk: entangled with undo/redo history and folder-id namespacing
  (`historyStack`/`historyIndex` coupling).
- **Canvas outline hierarchical builder** (273 lines, hamburger) —
  proximity-clustered heading tree for the outline panel.
- **Library item detail view** (151 lines) / **Publish flow** (62 lines) —
  replaced the old draft-editor trio; `supabase`-coupled.
- **Hover/Pin Panel Helper** (38 lines) — small but structurally
  load-bearing: owns `panelPinned`, the shared open/pinned state nearly
  every panel bucket above reads.

## Suggested migration order

Largely unchanged in spirit from the original list below — self-contained/
low-coupling first, canvas core and connections last — with the new
buckets slotted in by the same principle:

1. **Pricing/upgrade, Embed, Text-selection toolbar** — zero global-state
   hits, good warm-up targets alongside the original Stopwatch/Drawing/
   Checklist candidates. **Done** (Pricing/upgrade and Text-selection toolbar
   as overlay shells; Embed as the first canvas-item Component, on top of
   the canvas-items-react foundation — see "Card-kind registry pattern"
   above, now superseded by `CARD_KIND_COMPONENTS` in
   `app/dotto/CanvasItemsLayer.jsx`).
2. **Stopwatch card**, **Drawing layer**, **Checklist / Statcard /
   Watermark** — as originally planned. **Done** (Checklist, Statcard,
   Watermark, Stopwatch all real Components; Bookmark card kind removed
   entirely rather than converted — solved by waypoints/other menus
   already). Title, Note, and Table also converted alongside these
   (self-contained, similar shape to Watermark/Checklist).
3. **Game options/cloze**, then **Flashcards/SRS** and **Typeright app**
   (both depend on Game options) — isolated logic, high pitch value.
   **Done** (Flashcard, Typeright, and the shared `GameOptionsPanel`;
   Sentence, Filter, and Shelf card kinds converted alongside these).
4. **Notifications core engine**, then its 3 scheduling-trigger producers.
   **Done** (`NotificationBar.jsx`) — the queue/sequencing engine and staged
   CSS-class choreography stay vanilla (no list-diffing bug to fix there);
   only the bar's own rendering surface moved to React. The 3 producers are
   just callers of `pushNotification` with no rendering surface of their
   own, so nothing further was needed for them.
5. **Schedule panel** (now the in-canvas agenda overlay). **Done**
   (`ScheduleAgenda.jsx`) — hour markers + event-card previews portal into
   the existing static markup; each event's own preview still comes from
   the vanilla `renderRealCardPreview`.
6. **Hamburger menu + Profile/Messages/Friends panels** + **Achievements**
   (tightly linked to Profile's leveling code) — before wiring real backend
   data so the seam is already React state. **Done**, granular (one PR per
   panel, not a batch — this bucket had no acute bug the way card kinds/
   search panels did, converted for architectural consistency instead):
   Waypoints panel, Hub Collab panel, Profile identity/level pill/
   achievements spritebook, Messages panel, per-canvas Collaborations
   flyout. The hamburger's Outline panel is the one exception, left
   vanilla — no natural content parameter to route through React state
   (pure appState-read + DOM-build, triggered once per menu-open), so
   converting it would mean either a full rewrite of its recursive
   proximity-clustering algorithm or a no-op wrapper that changes nothing
   (see WaypointsListPanel's own commit for the full reasoning). Also
   added a per-component `<ErrorBoundary>` around every top-level piece
   `DottoApp` renders (`app/dotto/ErrorBoundary.jsx`) partway through this
   wave, after a bug in one small component (twice) took the entire app
   down with it — no error boundary existed anywhere before that.
7. **AI/search feature cluster** (Dotbot core, mnemonic, dictionary panels,
   text-selection/add-to-source, orchestrated search last, as the
   dispatcher) — biggest single cluster after source/table and live
   presence; do after the card-kind registry pattern is proven. **Done.**
   Text-selection toolbar was already converted earlier (`SelectionToolbar.jsx`).
   All 8 search-dropdown panels are real React state now: 6 single-owner
   ones (Translation/Dictionary/Examples/Recommended-searches/Dotbot-answer+
   answer_blocks/Image-result) each mount a vanilla-built card via a plain
   side-effect component; the 2 shared-ownership ones
   (`#search-results`/`#search-suggestions`, each fed by multiple unrelated
   producers) needed their own discriminated-union stores and, for
   `#search-results`, genuine `createPortal`-based JSX so the existing
   keyboard-navigation code keeps working unmodified. `commenceDotbotSearch`/
   `renderOrchestrateResult` (the dispatcher) needed no further conversion
   of their own — once every panel they call was React-owned, nothing was
   left but CSS-class toggles on already-static elements (the spinner/
   loading state), same category as the notification bar's own choreography.
   Add-to-source popup is also done (`AddToSourcePopup.jsx`) — it isn't
   nested in any static fragment (originally appended straight onto
   `document.body`), so it renders independently like
   `PricingOverlay`/`SelectionToolbar` rather than portaling; its own
   search/entry-row content stays vanilla.
8. **Marketplace/cart** + **Library item detail view** + **Publish flow**. **Done**, granular:
   Discover tab's trending list (`MarketDiscoverPanel.jsx`) and item detail content
   (`MarketDetailPanel.jsx`, canvas preview ref-mounted), the Library tab's three sub-views (folder
   picker / item list / cross-folder search, `LibraryPanel.jsx`, one discriminated-union store),
   and the Item Detail view's 3-way footer button set (`ItemDetailFooter.jsx` — a natural,
   self-contained discriminated union, same shape as `ImageResultPanel`). Left vanilla, same
   reasoning as the hamburger menu's Outline panel exception (item 6): the Item Detail form fields
   (contentEditable title, autosave-on-blur for drafts, disabled-until-dirty tracking for
   published) and the entire Publish Flow view (including `focusPublishFlowName`'s manual caret/
   scroll positioning) — no acute bug in any of it, and converting contentEditable fields to React
   state risks regressing caret behavior for zero behavior gain.
9. **Source/table cards** — largest, most interconnected card kind. The
   thin **Canvas** (`kind:'folder'`, a nested canvas) and **Source**
   (`kind:'source'`, a database block) card *kinds* — i.e. what a folder or
   source looks like as a card sitting on a parent canvas — are **done**.
   **Media** and **Waypoint** are also done — every card kind that exists
   is now a real Component (`CARD_KIND_COMPONENTS` in
   `app/dotto/CanvasItemsLayer.jsx`); `renderLegacyCardBody` and the
   `window.__renderLegacyCardBody` bridge have been deleted outright, not
   just emptied. Still outstanding and much larger: the actual Source
   *database page* itself (`renderStaticTableHTML` and its whole cluster —
   tags, cell image/audio, AI content, SM-2, drag-select), which needs
   canvas-core-level work, not a simple card conversion.
10. **Friend presence**, **Canvas collaborations (hamburger)**,
    **Live-shared canvases** — real-time/collaboration cluster, done
    together since they share subscription-lifecycle risk. **Done** — turned out to have very
    little left after item 6: **Friend presence** (`subscribeToAllFriendMessages`,
    `handleFriendPresenceSync`) is pure realtime-channel lifecycle with no rendering surface of its
    own (it calls into `pushNotification`/`renderMsgList`, both already React); **Canvas
    collaborations (hamburger)**'s rendering (`renderHubCollabList`/`renderWaypointsList`) was
    already converted in item 6, leaving only pure data/navigation logic
    (`refreshCanvasCollabData`/`respondToCanvasCollabRequest`/`goToWaypointCard`) with nothing to
    convert. Two genuine small surfaces WERE found and converted: the collaborators pill under the
    search bar (`renderCollabPill`, `CollabPill.jsx` — the small avatar-cluster trigger for the
    per-canvas Collaborations panel, missed by item 6's pass since it's a different function/id
    than that panel itself) and the breadcrumb map dropdown
    (`renderBreadcrumbMapPanel`, `BreadcrumbMapPanel.jsx`, in shared-canvases-outline.js's
    **Live-shared canvases** section — shows the synthetic-root row when inside a shared canvas).
    The rest of "Live-shared canvases" (`openSharedCanvas`/`exitSharedCanvasToRoot`/folder-id
    namespacing) has no rendering surface of its own — it operates entirely through the shared
    `folders`/`render()` canvas-core machinery, migrated last (item 12).
11. **Live canvas presence + real-time content sync** — split into its
    three internal parts first (see grab-bag warning above), migrate each
    separately rather than as one 1,468-line unit. **Done** — auditing the split found only one of
    the parts had a real rendering surface: **messaging functions**
    (`renderConvoBody`/`openSharedCanvasView`) are converted (`MsgConvo.jsx`, header + message list
    as genuine JSX; `SharedCanvasModalBody.jsx`, the Shared Card preview modal's list), with each
    canvas-snapshot message's own card content still ref-mounted from
    `renderInlineCanvas`/`renderMsgSnapshotCard` (vanilla, same "vanilla builds live DOM" pattern
    as `InlineCanvasPreview`) — `sendMsg`/`openConvo`/`closeConvo`/`importSharedCardsAtScreenPoint`
    stay vanilla logic with no rendering surface of their own. **Cursor/typing/selection presence
    sync** and the **diff-based content-sync engine** (`queueSyncDiff`/`flushSyncDiff`/
    `applyRemoteSyncBroadcast`) stay fully vanilla by design, not deferred to a future slice —
    both are tightly coupled to live pan/zoom pixel math and per-frame drag/remote-sync updates
    against the real canvas DOM, the same "canvas-core-adjacent, migrate last" reasoning as item
    12 itself, with no list/identity structure that would benefit from React reconciliation. The
    **card-kind helpers** and the **mini-canvas-preview widget** (`renderInlineCanvas`) scattered
    in this same file are already covered elsewhere (bridged into real Components, or the
    established ref-mount pattern) — nothing left to convert in either.
12. **Connections layer + drag/resize/select + canvas core** — still last.
    Highest-regression-risk chunk; benefits most from everything else
    already being proven out.

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
