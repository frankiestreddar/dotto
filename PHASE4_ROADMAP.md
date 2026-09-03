# Phase 4 roadmap: full vanilla→React consolidation & professionalization

## Status

- **Phase 4.0 — tooling & safety net: done.** See checklist below.
- **Phase 4.1 — leaf-first vanilla→React port: revisited now that Phase 4.5 is fully done — 12 of
  ~23 files done, 1 real interdependent 11-file cluster remains.** First 3 files ported back when
  this phase was still active (`rail-tooltip-expand.js`, `sidebar-mode-toggle.js`,
  `dotbot-schedule-notifications.js`), then paused — every other original candidate was genuinely
  blocked by still-vanilla hub dependencies (`core-state.js`, `live-presence.js`,
  `history-autosave.js`, `panels-hamburger.js`'s `wireRailIcon`, `waypoints-render-loop.js`,
  `srs-connections-core.js`, `shared-canvases-outline.js`, `friends-presence.js`,
  `window-bridge.js`) — see its own section below. **Now that Phase 4.5 (all architectural/hub
  files) is fully done, every one of those blockers has landed** — re-auditing the remaining
  vanilla surface against the same two-sided rule found 9 more files genuinely portable with zero
  remaining blockers, all ported together in one batch: `theme-toggle.js` →
  `app/dotto/lib/themeToggle.ts`, `srs-algorithm.js` → `app/dotto/lib/srsAlgorithm.ts`,
  `app-init.js` → `app/dotto/lib/appInit.ts`, `drag-drop-chat.js` →
  `app/dotto/lib/dragDropChat.ts`, `table-grid-resize.js` → `app/dotto/lib/tableGridResize.ts`,
  `upload-popup.js` → `app/dotto/lib/uploadPopup.ts`, `extensions-panel.js` →
  `app/dotto/lib/extensionsPanel.ts`, `stopwatch.js`'s own remaining `renderStopwatchHTML` folded
  into the already-existing `app/dotto/lib/stopwatch.ts` (its `swFormatTime`/`swToggleRun`/etc. had
  already moved there in Phase 4.4), and `blocks-panel.js` → `app/dotto/lib/blocksPanel.ts` (the
  largest of the 9, 288 lines). `blocksPanel.ts`/`libraryPublish.ts`/`marketplace.ts` are a
  genuinely circular trio (documented in `libraryPublish.ts`'s own header comment from its earlier
  port) — kept as bridges in both directions deliberately rather than newly co-locating and
  resolving it, since the other two files are already-shipped and stable; every other bridge this
  batch's own files needed (`refreshMyLibrary`/`openItemDetail`/`deleteMyCreationItem`, all
  one-directional, no cycle) stayed bridges for the same "don't touch already-stable files beyond
  what's needed" reasoning. 8 same-tree React callers upgraded to real imports
  (`BlocksPanel.jsx`'s `createBlocksFolder`/`deleteBlocksFolder`/`toggleBlocksFolderCollapse`/
  `deleteBlockContentItem`/`handleBlockItemClick`/`setupContentItemDrag`;
  `TableCard.jsx`'s `setupTableGridResizing`); found and upgraded 5 more same-tree
  vanilla→vanilla-turned-app/dotto/lib bridge crossings while sweeping stale filename references
  afterward — `srsAlgorithm.ts`'s `calculateSM2`/`defaultSrsState`/`diffRatings` (now real imports
  in `gamesFlashcardTyperight.ts`/`stopwatch.ts`/`srsConnectionsCore.ts`, dropping those 3 bridges
  entirely, zero remaining callers), `friendsPresence.ts`'s `refreshCanvasCollabForCurrentFolder`/
  `refreshFriendsData`/`renderCollabPill` (now real imports in the new `appInit.ts`, dropping
  `__refreshFriendsData` entirely) and `renderMsgList` (now a real import in the new
  `dragDropChat.ts`), and `sourceTable.ts`'s `distributeTableSizing` (now a real import in the new
  `tableGridResize.ts`). `window.prepareAdd`/`window.__setupResizing`/`setupDraggingAndClicking`-
  style historical/inline-onclick-target globals deliberately left as bridges — see each one's own
  comment for why. **Remaining vanilla surface is now exactly one connected component: 11 files**
  (`command-parser.js`/`command-target-lookup.js`/`command-verbs.js`/`command-palette.js`/
  `card-kinds.js`/`global-ids.js`/`add-menu.js`/`text-utils.js`/`drawing-connections.js`/
  `search-panel-history.js`/`search-orchestration-selection.js`) with real vanilla-to-vanilla `import`
  statements among themselves — no true cycles (a DAG), but every file in it is blocked by a
  sibling still inside it, so it can't be peeled one file at a time under the two-sided rule; will
  need either a coordinated multi-file port of the whole cluster (or a real sub-chain) in one PR,
  same technique the friends-presence/messages-schedule pair and the ai/hamburger/mnemonic trio
  already used for their own circular clusters. One real, pre-existing, unrelated bug found and
  left alone (out of scope for this port, flagged for a future tiny fix): `command-verbs.js`'s
  `removeUser()` calls `resolveUsernameToUserId(username)` with no `window.__` prefix (every other
  call site in that file, including `inviteUser`, correctly uses
  `window.__resolveUsernameToUserId`) — will throw a real `ReferenceError` the first time a
  `/canvas … remove <user>` or `/source … remove <user>` slash command actually runs.
- **Phase 4.2 — utility extraction from hub files: done.** All 3 original targets addressed: SM-2
  (`calculateSM2`/`defaultSrsState`/`diffRatings`, from `srs-connections-core.js` into
  `public/dotto/srs-algorithm.js`), `escapeHtml`/`stripHtml` (from `ai-assistant-suggestions.js`
  into `public/dotto/text-utils.js`), and achievement-scoring (`calculateUserLevel`, turned out to
  already be cleanly separated in `lib/leveling.js` — just needed test coverage + a drift check
  against its vanilla duplicate, not a real extraction). 30 new Vitest unit tests total across the
  three (zero coverage on any of this before Phase 4.2). See its own section below for a real
  correction to how this phase was originally scoped, and a real importability gotcha
  (`core-state.js`'s module-level DOM lookups breaking Vitest imports) caught while doing the
  second extraction.
- **Phase 4.3 — split multi-concern files: done.** `resize-shortcuts-init.js` (333 lines, 3
  bundled concerns) done: split into `table-grid-resize.js` (internal column/row divider drag),
  `card-shortcuts.js` (Option-held tracking, Backspace multi-delete, hover-scoped game-card and
  PDF-page-turn keyboard shortcuts), and `app-init.js` (the one-time bootstrap sequence — pure
  side-effect module, no exports). 4 real cross-file imports fixed (`copy-paste.js`,
  `source-buttons-cursor-mode.js`, `window-bridge.js`, `waypoints-render-loop.js`), 10 stale
  comment references to the old filename fixed across 8 files (a further 6 references left as-is —
  either genuinely historical/past-tense provenance notes, or pre-existing staleness pointing at
  `setupResizing` that predates this split and belongs to Phase 3's `canvasItemBehavior.js`
  instead, out of scope here). `shared-canvases-outline.js` (983 lines, 4 bundled concerns) also
  done: split into `shared-and-public-canvas-loading.js` (fetching a live-shared or public canvas
  into this client's own `folders` map under a namespaced key, plus the resume-state bookkeeping
  for leaving it), `outline-tree.js` (the hamburger menu's canvas outline builder + its "O"
  shortcut/rail-icon toggle), `tab-management.js` (PaneTopBar's whole per-pane navigation surface —
  breadcrumb trail, tabs, back/forward history — deliberately kept together since all three read/
  write the same live per-pane state), and `split-pane-management.js` (the actual pane-tree
  surgery behind TabsBar's drag-to-split gesture and a pane's close button, kept separate from
  tab-management.js since it's a different concern: splitting/closing panes themselves rather than
  navigating within however many currently exist). 15 real cross-file imports fixed across 10
  caller files (some needed splitting into 2-3 import lines, since a single caller sometimes
  pulled from what are now different new files), roughly 45 stale comment references to the old
  filename fixed across 19 files (1 pre-existing, already-wrong reference left alone —
  `app/dotto-app.jsx`'s
  `renderMediaViewerZoom`/`setMediaViewerZoom` mention, which actually lives in
  `waypoints-render-loop.js` and never was in `shared-canvases-outline.js`, predates this split and
  is out of scope here). `stopwatch-search-notifications.js` (509 lines) also done: split into
  `stopwatch.js` (the Stopwatch card's start/stop/pause timer + session-archiving into a connected
  Shelf/Stack), `notifications.js` (the bottom-left notification stack engine), and `shelf-search.js`
  (the Shelf/Stack card's own row search, the small Filter card's tag-toggling, and the top AI
  search bar's autogrow + drag-cards-in-as-context popup — every "search"-flavored piece the
  original filename's own name pointed at, kept together since none of it is stopwatch or
  notifications). These 3 new files needed zero cross-imports between each other (unlike the
  4-way split above) — genuinely independent concerns. 15 real cross-file imports fixed across 12
  caller files, roughly 20 stale comment references fixed across 16 files (all 3 new files' own
  Phase 4.3 provenance comments left as-is, matching convention). One pre-existing circular import
  between `live-presence.js` and `shelf-search.js` carried over unchanged from the original single
  file (both already imported from each other before this split; ES modules tolerate it fine as
  long as the circularly-imported binding is only used inside function bodies, never at
  module-evaluation time — confirmed via a clean `npm run build`, which would have failed on a
  genuine resolution problem). **Phase 4.3 is now fully done** — all 3 originally-scoped
  multi-concern files split. All 3 commits (`86fc151`, `c8a182f`, `50e9f00`) confirmed green in
  real GitHub Actions.
- **Phase 4.4 — port split-out concerns + remaining DOM-heavy files: done.**
  `notifications.js` (Phase 4.3's own split, 122 lines) ported first: `app/dotto/lib/
  notificationsStore.ts` — the codebase's first real **Zustand** store (per the Phase 4 plan's
  locked-in decision, installed as a real dependency here since nothing had adopted it yet;
  every other existing `bridges.js` `createStore` stays untouched for now, migrating individually
  as its own owning file gets ported, same incremental approach as every other Phase 4 step).
  `NotificationBar.jsx` now reads the store directly (`useNotificationsStore` hook) instead of
  `useSyncExternalStore` against `bridges.js`'s old `notificationsStore`, and calls
  `dismissNotification`/`runNotificationAction` as real imported actions instead of through
  `window.__dismissNotification`/`window.runNotificationAction` — those two bridges are gone
  entirely (confirmed unused elsewhere first). `window.pushNotification` and a new
  `window.__hasVisibleNotifications` stay as vanilla-facing bridges (the reverse direction from
  every other bridge in `vanillaBridges.d.ts`) since ~9 still-vanilla files call them: 7 callers
  switched from `import { pushNotification } from './notifications.js'` to
  `window.pushNotification(...)` (a mechanical `pushNotification(` → `window.pushNotification(`
  swap across ~28 call sites — first attempted with a `\b`-anchored `sed` pattern that silently
  matched nothing on BSD/macOS `sed`, caught by re-grepping afterward rather than assuming it
  worked), and `card-shortcuts.js`'s 2 direct `appState.visibleNotifications.length` reads (its
  hover-scoped game-card/PDF shortcuts gate on this) switched to the new
  `window.__hasVisibleNotifications()` bridge, since that state no longer lives on `appState` at
  all — moving it fully into the Zustand store (rather than dual-writing to both) was possible
  because exactly one vanilla file read it directly and that read was easy to re-point at a
  bridge. `NOTIFICATION_MAX_VISIBLE`/`NOTIFICATION_DEFAULT_DURATION_MS`/`notificationQueue`/
  `visibleNotifications` removed from `core-state.js`'s `appState` object literal entirely.
  `stopwatch.js`'s `swFormatTime`/`swCurrentElapsedMs`/`swToggleRun`/`swTogglePause` ported next —
  **not** a Zustand store this time: a stopwatch card's own fields live on the same `it` object
  every other canvas item does, inside `appState.folders`, which stays the single source of truth
  until Phase 4.5's own `core-state.js` migration (dual-write). This is the plain Phase 4.1-style
  port instead — pure logic moved to `app/dotto/lib/stopwatch.ts`, reaching the still-vanilla item/
  render/save/diff dependencies through `window.__findItemById`/`__saveSnapshot`/`__render`/a new
  `__diffRatings` bridge (added to `srs-connections-core.js`). `renderStopwatchHTML` itself stays
  vanilla in `stopwatch.js` (`live-presence.js`'s mini inline-canvas previews still call it
  directly) — rewritten to call the new `window.__swFormatTime`/`__swCurrentElapsedMs` bridges
  instead of local functions. `StopwatchCard.jsx` switched from calling
  `window.swToggleRun`/`window.swTogglePause`/`window.__swFormatTime`/`window.__swCurrentElapsedMs`
  to real same-tree imports; those 4 globals are still set (now from the TS file, reversed
  direction) since `renderStopwatchHTML`'s own `onclick="swToggleRun(...)"` string and
  `history-autosave.js`'s `ensureSwTicking`/`swTick` (a 1s `.sw-time`-patching interval, unchanged)
  both call them by name. `window-bridge.js`'s now-dead `swTogglePause`/`swToggleRun`
  import+assignments removed (StopwatchCard.jsx no longer needs them as globals).
  `split-pane-management.js` (77 lines) ported next to `app/dotto/lib/splitPaneManagement.ts` —
  the cleanest Phase 4.4 port so far: nothing vanilla ever imported it directly (only via the
  already React-callable `window.__splitPaneWithTab`/`__closePane` bridges TabsBar.jsx/
  PaneTopBar.jsx already used), so zero vanilla caller updates were needed anywhere else, just the
  bridge's own source flipping from vanilla to TS. Every one of its own dependencies was already
  bridged except `applyFolderView`, which got one new bridge (`window.__applyFolderView`,
  `waypoints-render-loop.js`). Since the module has no `wireX()` function (its only job is setting
  2 bridges at load time, no live DOM/appState read needed at wire time), it's imported as a plain
  side-effect import directly in `app/dotto-app.jsx` rather than called from a specific owning
  component — the same reasoning `wireNotifications`/`wireDayChangeAndAdNotifications` are called
  from there, just without a wire function of its own to invoke.
  `copy-paste.js` (158 lines) ported next to `app/dotto/lib/copyPaste.ts` — the most involved
  Phase 4.4 port so far: copy/cut/paste plus the add-menu "placement ghost" preview (a real DOM
  element the TS code creates/positions itself, same imperative-DOM pattern
  `canvasItemBehavior.js` established in Phase 3) and `prepareAdd`. 5 brand-new bridges added
  (`__closeRailView`/`__applyCursorMode`/`__kindSize`/`__deleteSelectedCards`/
  `__registerPaneCanvasListenerSetup`, one per still-vanilla dependency that had no bridge yet) —
  the last of these replicates a real architectural pattern (`registerPaneCanvasListenerSetup`,
  `core-state.js`): every owning file registers its own "attach my canvas-level listener to a
  given canvas element" callback once, so a brand-new split-screen pane automatically gets it too,
  fixing a real production bug (a second pane silently missing whichever listeners were only ever
  attached to pane 0's own element) — `wireCopyPaste` replicates the exact same
  register-once-at-wire-time shape, with the same bridge-readiness poll `wireDayChangeAndAdNotifications`
  established (`window.__getCanvasEl`/`__registerPaneCanvasListenerSetup` might not exist yet when
  DottoApp's own mount effect runs). 3 vanilla callers switched from direct imports to window
  bridges (`blocks-panel.js`, `history-autosave.js`'s Cmd+C/X/V handler, `srs-connections-core.js`'s
  'a'-chord + Escape handling); `window-bridge.js`'s now-dead `prepareAdd` import+assignment
  removed. `vanillaBridges.d.ts` also gained 3 retroactive declarations
  (`__getCanvasEl`/`__getWorldEl`/`__renderSelectedOutlines`) for bridges that already existed but
  had never been touched by a real `.ts` file before — `canvasItemBehavior.js` (Phase 3) is a
  plain `.js` file that never needed them declared.
  `tab-management.js` (263 lines) ported next to `app/dotto/lib/tabManagement.ts` — PaneTopBar's
  whole per-pane breadcrumb/tabs/back-forward navigation surface. Only one real vanilla importer
  (`waypoints-render-loop.js`'s `render()`, needing `renderBreadcrumbMapPanel`/`renderNavArrows`/
  `renderTabsPanel` directly — switched to a new `window.__renderBreadcrumbMapPanel` bridge plus
  the 2 that already existed); every other consumer (TabsBar.jsx, PaneTopBar.jsx) already used the
  `window.__addTab`/`__switchTab`/etc bridges this file itself used to set, so those callers needed
  zero changes — only the bridges' own source flipped from vanilla to TS. 2 new outbound bridges
  added (`__findParentFolderId` for `buildAncestorChain`'s structural-parent walk,
  `__exitSharedCanvasToRoot` for the synthetic breadcrumb Root row) plus 3 retroactive
  declarations for React-facing setters (`__setBreadcrumbMap`/`__setTabs`/`__setNavHistory`) that
  already existed in `dotto-app.jsx` but had never been typed since no `.ts` file had called them
  before. No `wireX()` needed (same reasoning as `splitPaneManagement.ts` — every function here is
  called later via bridge, nothing needs a live DOM/appState read right at import time), so it's a
  plain side-effect import in `app/dotto-app.jsx` alongside `splitPaneManagement`'s own.
  `shared-and-public-canvas-loading.js` (265 lines) ported next to `app/dotto/lib/
  sharedAndPublicCanvasLoading.ts` — fetching a live-shared or public canvas into this client's
  own `folders` map under a namespaced key. The most-depended-upon Phase 4.4 port so far: 6 real
  vanilla callers (`app-init.js`, `command-verbs.js`, `hamburger-collab.js`, `history-autosave.js`,
  `live-presence.js`, `waypoints-render-loop.js`), all switched from direct imports to window
  bridges — 7 new outbound bridges added on top of the 3 that already existed
  (`__openSharedCanvas`/`__resolveReferenceFolderKey`/`__exitSharedCanvasToRoot`). First port to
  touch real Supabase RPC calls from TS: reused the ALREADY-EXISTING `window.__dottoSupabase`
  bridge (set by `dotto-app.jsx` at module-eval time, previously untyped since only vanilla code
  had read it) rather than inventing a new one — added a real `SupabaseClient` type import from
  `@supabase/supabase-js` to `vanillaBridges.d.ts` for it. The `.rpc()` calls themselves typechecked
  cleanly with no casts needed. `window.__centerOnContent` added as a 1-off new bridge
  (`waypoints-render-loop.js`). Same plain-side-effect-import pattern as `splitPaneManagement.ts`/
  `tabManagement.ts` (no `wireX()` needed).
  `marketplace.js` (232 lines) ported next to `app/dotto/lib/marketplace.ts` — Discover-tab
  browsing, the purchase flow, and packaging a canvas selection into a draft. Introduced a genuinely
  new pattern beyond every earlier Phase 4.4 port: the original called `wireRailIcon(...)` at plain
  module-load time to register the Marketplace rail icon's click/hover/pin behavior directly
  against real DOM elements (`appState.btnCart`/`appState.cartPanel`) — ported as `wireMarketplace`
  with the same bridge-readiness poll `wireCopyPaste`/`wireDayChangeAndAdNotifications` established,
  since `window.__wireRailIcon` and those two DOM elements might not exist yet when DottoApp's own
  mount effect runs. 6 new bridges added (`__getAddMenuEl`/`__getBtnAddEl` for two more separate
  module-level DOM bindings core-state.js exports — same category as `__getCanvasEl`/`__getWorldEl`,
  not appState properties; `__wireRailIcon`/`__openRailView`; `__snapshotItem`/
  `__sanitizeFlashcardSnapshot`). Untangled a real vanilla-to-vanilla circular import
  (`library-publish.js` imports `openItemDetail` from... itself calling back into
  `refreshMyLibrary`, which lived in this file — both directions now go through bridges). 3 of the
  4 window-bridge.js assignments this file used to feed are genuine inline-onclick targets
  (`handleMarketplaceSearch`/`closeMarketDetail`/`purchaseCurrentMarketItem`, confirmed against
  `hamburger-stack.html`) and kept their plain non-`__` names, now set from the TS file itself; the
  4th (`window.deployPurchasedTemplate`, no `__` prefix) was genuinely dead — only
  `window.__deployPurchasedTemplate` was ever actually called (ItemDetailFooter.jsx) — dropped
  rather than recreated.
  `shelf-search.js` (330 lines) ported next to `app/dotto/lib/shelfSearch.ts` — the Shelf/Stack
  card (aggregating connected sources + saved stopwatch sessions, with its own in-card row
  search), the Filter card's tag-toggling, and the top search bar's autogrow + its AI-context
  "drag cards in as context" popup. `renderShelfHTML` still builds a real HTML string with inline
  `onclick="..."` attributes (live-presence.js's mini inline-canvas previews render it directly) —
  those 5 globals (`startRenameShelfName`/`shelfSelectSession`/`handleShelfSourceRowClick`/
  `startRenameShelfSourceRow`/`filterShelfRows`) kept their exact plain (non-`__`) names, same
  convention `window-bridge.js` used for them before this port; 5 more (`closeSearchCardsModal`/
  `setFilterMode`/`toggleFilterTag`/`openSearchCardsModal`/`clearSearchCardContext`) likewise.
  9 new bridges added for still-vanilla dependencies with no bridge yet
  (`__folderIdForConnectedSource`/`__syncCanvasCollabTitle`/`__broadcastEditingState`, plus 6 more
  that already existed at runtime but had genuinely never been typed —
  `__ensureConnections`/`__folderTitleForConnectedSource`/`__scheduleWorkspaceSave`/`__itemElId`/
  `__escapeHtml`/`__renderInlineCanvas` — since no prior `.ts` file had touched them). Caught and
  fixed 2 real bridge omissions of its own during the pre-verification comment sweep — a
  discipline step that's paid off before, but this time genuinely caught something a
  typecheck/build pass alone could NOT have: `renderShelfHTML` (still needed by live-presence.js)
  and `autoGrowSearchInput` (needed by 2 files, several call sites) were both fully implemented and
  exported from the new file but never actually assigned to a `window.*` bridge, so
  `node --check`/`eslint`/`tsc`/`next build` all stayed green while the real call sites would have
  silently called `undefined` at runtime — caught only by grepping for leftover references to the
  old filename across the repo and finding these two still-real imports, not by any automated
  check.
  `outline-tree.js` (423 lines) ported next to `app/dotto/lib/outlineTree.ts` — the hamburger
  menu's canvas outline builder (proximity-grouped under headings, with collapse/search/arrow-key
  nav), a source page's own row-per-table-row outline, plus the small kind→icon mapping and
  hover-revealed row-actions markup shared with `RowActions.jsx`/`search-panel-history.js`. All 12
  exports were real callers across 7 vanilla files (`hamburger-collab.js`, `live-presence.js`,
  `search-panel-history.js`, `panels-hamburger.js`, `window-bridge.js`,
  `waypoints-render-loop.js`, `srs-connections-core.js`) — every one switched to a `window.__*`
  bridge; `OutlinePanel.jsx` (this migration's own original reference port from Phase 1) already
  called every React→vanilla bridge this port needed, unchanged. 5 new outbound bridges added for
  still-vanilla dependencies with no bridge yet (`__canvasViewportCenterX`/`__smoothPanTo`/
  `__flashCanvasElement`/`__focusTableCell`/`__expandWaypointCard`), plus 3 more that already
  existed at runtime but had never been typed (`__stripHtml`/`__shortUrl`/`__findItemEl`).
  `handleOutlineSearch` is a real inline `oninput="..."` target (`hamburger-stack.html`) — kept its
  exact plain (non-`__`) name, now set from the TS file itself instead of re-exported through
  `window-bridge.js`'s old indirection, same convention `marketplace.ts`/`shelfSearch.ts`
  established. The stale-reference sweep this time also caught two comments asserting something
  no longer true rather than just a stale filename: `OutlinePanel.jsx`'s own loading-race comment
  (used to describe a real `afterInteractive <Script>` race that no longer exists now that
  `outlineTree.ts` is a plain side-effect import in the same module graph) and `RowActions.jsx`'s
  own comment claiming the Outline tree's rows were still vanilla-rendered (they've been React,
  via `OutlinePanel.jsx`, since Phase 1 — only `search-panel-history.js` still builds a plain HTML
  string via `rowActionsHTML()`) — both rewritten to state what's actually true now, not just
  repointed.
  `source-buttons-cursor-mode.js` (264 lines) ported next to
  `app/dotto/lib/sourceButtonsCursorMode.ts` — two genuinely unrelated concerns that happened to
  share a file (kept bundled here too, matching the original's own reasoning): a source page's
  per-cell Add/Upload/Tags button popovers, and the cursor-mode toolbar (normal/data/select/pen)
  with its D/Escape/Shift tap-vs-hold keyboard overrides. 7 real vanilla callers
  (`app-init.js`, `blocks-panel.js`, `panels-hamburger.js`, `source-table.js`, `source-tags-ai.js`,
  `window-bridge.js`, `waypoints-render-loop.js`) all switched to bridges. `openCellAddMenu` is a
  real inline `onclick="..."` target (`canvasItemBehavior.js`'s cell markup) — kept its exact plain
  (non-`__`) name, now set from the TS file itself instead of through `window-bridge.js`'s old
  indirection, same convention `marketplace.ts`/`shelfSearch.ts`/`outlineTree.ts` established. 11
  new outbound bridges added for still-vanilla dependencies with no bridge yet
  (`__getContextMenuEl`/`__getDrawSettingsEl` — `contextMenu`/`drawSettings` join `addMenu`/
  `btnAdd` as the 3rd/4th pair of separate, never-reassigned module-level DOM bindings
  `core-state.js` exposes this way — plus `__effectiveMode`/`__layoutSourceTableColumns`/
  `__linkSelectedCards`/`__closeCollabPanel`/`__dispatchListPanelDelete`/`__hideCanvasContextMenu`/
  `__closeCellTagPicker`/`__clearDataLinkPending`/`__closeAllPanels`). Genuinely new architectural
  pattern beyond every earlier Phase 4.4 port: this file's whole second half (mode-toolbar
  clicks/hover, global keydown/keyup/blur/resize, `window.onclick`, the canvas transitionend hook)
  is real module-load-time DOM wiring against already-existing elements, not just function exports
  — ported as `wireSourceButtonsCursorMode()` with the same bridge-readiness poll
  `wireDayChangeAndAdNotifications`/`wireCopyPaste`/`wireMarketplace` established. One caller-fix
  regex miss caught by a routine post-sed re-grep (not the stale-reference sweep this time): the
  bare `s/([^_.])applyCursorMode(/.../g` pattern requires a character before the call, so
  `app-init.js`'s own `applyCursorMode();` sitting at the very start of a line was skipped by the
  automated pass — caught immediately by re-grepping the 7 caller files right after, before moving
  on to verification.
  `games-flashcard-typeright.js` (657 lines) ported next to
  `app/dotto/lib/gamesFlashcardTyperight.ts` — the shared front/back column configuration
  (right-click "Options" face) for every game card kind, plus the Flashcard and Typeright apps
  built on top of it. Unlike every earlier Phase 4.4 port, most of this file's exports were
  already React->vanilla bridges before this port (`FlashcardCard.jsx`/`TypeRightCard.jsx`/
  `GameOptionsPanel.jsx` — all real React components from an earlier phase — already called
  `window.__cellContentType`/`__fcCurrentRow`/`__resolveGameFace`/etc); this port also upgraded
  those 3 same-tree callers from window bridges to real ES imports (matching the precedent
  `StopwatchCard.jsx` already established for `stopwatch.ts`), keeping the bridges themselves only
  for genuinely still-vanilla callers (`live-presence.js`'s mini previews, `card-shortcuts.js`'s
  keyboard shortcuts). 5 real vanilla callers fixed (`card-shortcuts.js`, `live-presence.js`,
  `srs-connections-core.js`, `window-bridge.js`, `waypoints-render-loop.js`); 11 real inline
  onclick/oninput targets (`setGameColumnSlot`/`addGameColumnSlot`/`removeGameColumnSlot`/
  `fcFlip`/`fcRate`/`fcToggleMode`/`trUpdateInput`/`trFocusInput`/`trCheck`/`trNext`/
  `trToggleMode`) moved off `window-bridge.js`'s old centralized indirection onto direct plain-
  global assignment from the new file, same convention `marketplace.ts`/`shelfSearch.ts`/
  `outlineTree.ts`/`sourceButtonsCursorMode.ts` established. 3 new outbound bridges added for
  still-vanilla dependencies with no bridge yet (`__parseItemId`, `__awardUserPoints`/
  `__bumpAchievementStat`, `__calculateSM2`/`__defaultSrsState` — the latter two re-exported from
  `srs-algorithm.js`, a genuinely pure Phase 4.2 extraction that had sat completely un-bridged
  until this port needed it), plus 9 more that already existed at runtime but had never been typed
  (the pre-existing React->vanilla set named above). Real Playwright verification surfaced a
  genuine cross-module interaction, not a port bug: `srs-connections-core.js`'s
  `propagateCanvasStreams` runs a real "orphaned source-of-truth" integrity sweep on every
  `render()` that collapses a flashcard/typeright deck back to its placeholder the instant
  `card.srs` looks real (which `fcRate`/`trCheck` set unconditionally) but the card isn't fed by
  an actual connected source — exactly what a disconnected mock card is. Verified by stubbing
  `window.__render` for the one click that would otherwise trigger it (isolating this port's own
  logic), then restoring and re-triggering a real render to confirm the still-vanilla sweep
  correctly observes and acts on this port's data shape afterward — a real, useful end-to-end
  proof, not a workaround.
  `media-pdf-epub.js` (441 lines) ported next to `app/dotto/lib/mediaPdfEpub.ts` — the Media card
  (image/video/PDF/EPUB upload + link + clear) plus the live pdf.js/epub.js viewers built on top of
  it. `MediaCard.jsx` upgraded from window bridges to real ES imports (same precedent as
  `stopwatch.ts`/`gamesFlashcardTyperight.ts`), bridges kept only for `live-presence.js`'s mini
  previews. 3 real vanilla callers fixed (`live-presence.js`, `window-bridge.js`,
  `upload-popup.js`); 3 real inline onclick targets (`setMediaFromLink`/`triggerMediaUpload`/
  `clearMedia`) moved off `window-bridge.js`'s indirection onto direct plain-global assignment,
  same convention as every recent Phase 4.4 port. 1 new outbound bridge
  (`__showSelectionToolbarFor`, added to `search-orchestration-selection.js`, needed by
  `buildEpubViewer`'s selection-toolbar hook). Hit a real, build-breaking issue neither `tsc` nor
  any earlier port surfaced: `loadPdfjs`'s dynamic `import('/vendor/pdfjs/pdf.min.mjs')` (a public-
  served, unbundled vendor build the original vanilla file loaded the exact same way) made
  Turbopack try to statically resolve and bundle that literal path at build time and fail —
  `webpackIgnore` (Turbopack isn't webpack) didn't help; `turbopackIgnore` — a real, Next-16-
  supported magic comment, undocumented enough that it isn't mentioned anywhere in this repo's own
  history — fixed it cleanly, confirmed both by a clean production build AND a real end-to-end
  Playwright PDF upload actually rendering. Real Playwright verification against a fresh dev
  server: a real click on Link + a real browser `prompt()` dialog rendered a genuine `<img>`; a
  real click on the remove button correctly cleared it back to empty; a real OS-file-chooser
  upload (an actual small PNG, via Playwright's `filechooser` event) round-tripped through the
  real `processMediaFile` → FileReader → `<img>` pipeline; and — the highest-risk, most novel code
  in this port — a real, valid tiny PDF uploaded through the real Supabase Storage pipeline
  (`uploadDocumentToStorage`) correctly produced a live pdf.js viewer: a real rendered `<canvas>`
  and a real "1 / 1" page-nav label, confirming the dynamic `import()`/`turbopackIgnore` fix works
  correctly at runtime, not just at build time. EPUB's own viewer (`buildEpubViewer`) was
  deliberately not end-to-end tested with a real file — generating/uploading a valid EPUB is
  substantially heavier for marginal additional coverage, since it shares the exact same
  Storage-upload pipeline and script-loading pattern (arguably simpler than pdf.js's dynamic
  `import()`, the one part with genuine build-breaking risk) already proven correct by the PDF
  test above. Zero unexpected console/page errors. Re-checked the account afterward to confirm
  zero residual mock cards.
  `source-table.js` (543 lines) ported last to `app/dotto/lib/sourceTable.ts` — the on-canvas
  Table card's legacy string renderer, cell/keyboard navigation shared by both that legacy
  renderer and the real `TableCard.jsx`, row/column growth + merging, and the Source page's own
  image/audio-insert + CSV/TSV import pipeline. `TableCard.jsx` upgraded from window bridges to
  real ES imports for the technical functions (`distributeTableSizing`/`mergeTableCells`/
  `updateTableCell`/`handleTableKeydown`/`addTableCol`/`addTableRow` — same precedent as every
  recent Phase 4.4 port); its own separate, pre-existing local `handleCellMouseDown` was correctly
  left alone rather than shadowed by an accidental same-name import (caught by a real duplicate-
  declaration error on the first typecheck attempt). 5 real vanilla callers fixed
  (`live-presence.js`, `search-orchestration-selection.js`, `window-bridge.js`, `source-tags-ai.js`,
  `table-grid-resize.js`); 12 real inline onclick/oninput/onkeydown/onmousedown/onfocus targets
  moved off `window-bridge.js`'s indirection onto direct plain-global assignment — the largest
  single batch of any Phase 4.4 port, spanning `renderTableHTML`'s own built HTML,
  `canvasItemBehavior.js`'s still-vanilla Source-page renderer, and two static HTML fragments
  (`source-add-menu.html`/`audio-record-indicator.html`). 2 new outbound bridges added for
  still-vanilla dependencies with no bridge yet (`__placeCaretEnd` on `live-presence.js`,
  `__resolveTableForEdit` on `drawing-connections.js`). Real Playwright verification against a
  fresh dev server: real contentEditable typing into a `TableCard.jsx` cell persisted to
  `tableData`; real clicks on Add-column/Add-row grew the table correctly; a real `ArrowRight`
  keypress navigated focus to the adjacent cell; a real `mergeTableCells` call rendered a genuine
  `<td colspan="2">` in the DOM; and `importDelimitedIntoSource`'s column-name-matching CSV import
  logic was verified directly against a tagged mock source folder (matched `Name`/`Age` by name,
  appended the unmatched `City` column) — the full "open a real Source page, upload a real CSV
  file" UI flow was judged not worth the added weight over exercising the actual matching logic
  this port owns directly. Zero console/page errors. Re-checked the account afterward to confirm
  zero residual mock cards/folders. **This closes out Phase 4.4 — every split-out concern and
  remaining DOM-heavy file has now been ported.** Phase 4.5 (architectural/hub files) is next.
- **Phase 4.5 — architectural/hub files: done (7 of 7).**
  `panels-hamburger.js` (178 lines) ported first to `app/dotto/lib/panelsHamburger.ts` — the
  permanent rail's shared open/close contract (one sliding `#hamburger-stack` shell, many trigger
  icons) plus the hover/pin panel helper used by the add-menu and per-canvas collaborator flyout.
  **No `usePanelState` React hook/context was built**, despite the original plan anticipating one
  ("just a generic open/close contract") — all 12 real callers turned out to still be vanilla
  today, with zero React components reaching this file yet, so a hook would have had no real
  consumer; built the same conservative, proven Phase 4.4 pattern (plain TS module + bridges)
  instead, consistent with this migration's own "port what's actually needed" discipline
  throughout. If a real React consumer needs this panel-state logic later, a hook can be
  introduced then. 12 real vanilla callers fixed (`blocks-panel.js`, `ai-assistant-suggestions.js`,
  `card-shortcuts.js`, `extensions-panel.js`, `history-autosave.js`, `hamburger-collab.js`,
  `friends-presence.js`, `messages-schedule.js`, `profile-achievements-pricing.js`,
  `source-tags-ai.js`, `srs-connections-core.js`, `window-bridge.js`); 4 real inline oninput
  targets (`handleFilesSearch`/`handleHubCollabSearch`/`handleSourcesSearch`/
  `handleWaypointsSearch`) moved off `window-bridge.js`'s indirection onto direct plain-global
  assignment, same convention as every recent port. 7 new outbound bridges added for still-vanilla
  dependencies with no bridge yet (`__refreshAiPanel`/`__resetAiSearchState` on
  `ai-assistant-suggestions.js`; `__clearListPanelSelection`/`__renderFilesList`/
  `__renderHubCollabList`/`__renderSourcesList`/`__renderWaypointsList` on `hamburger-collab.js`).
  Its real module-load-time rail-icon click wiring (10 `wireRailIcon` calls against already-
  existing DOM elements) ported as `wirePanelsHamburger()`, same bridge-readiness-poll `wireX()`
  pattern every Phase 4.4/4.5 port with real DOM wiring has used. The stale-reference sweep found
  ~30 comment references across 17 files (the widest sweep of this migration so far, reflecting
  this file's real fan-in) — two were caught not just for a stale filename but for reasoning that
  had gone stale: `ai-assistant-suggestions.js`'s own onOpen-callback comment, and this file's own
  `refreshAiPanel`-wiring comment, both used to justify a plain-function-reference pattern by a
  circular-ES-import risk that no longer exists now that the two files reach each other through a
  bridge instead of a direct import — both rewritten to state what's actually true now. Real
  Playwright verification against a fresh dev server: a real click on the Outline rail icon opened
  it; a real click on a DIFFERENT icon (Sources) correctly switched — Outline closed, Sources
  opened; a real click on the now-active Sources icon again closed it; real typing into the
  Sources and Waypoints search inputs (`handleSourcesSearch`/`handleWaypointsSearch`, genuine
  inline `oninput` targets) correctly filtered each list to zero rows on a no-match query; and a
  real `Escape` keypress (routing through `history-autosave.js`'s existing global handler into
  `closeAllPanels`) closed the open panel. `isAnyUiPanelOpen()` was checked at every stage and
  matched the real DOM state throughout. Zero console/page errors. No mock data was created (pure
  UI-interaction test), so no cleanup step was needed.
  `live-presence.js` (1512 lines, fan-in 15 files) ported second — the largest single port of this
  entire migration, more than double any Phase 4.4 file. Split into two files along the plan's own
  3-concern breakdown, mechanically for organization (not for any new architecture — see below):
  `app/dotto/lib/canvasPresence.ts` (~1050 lines — the realtime presence/cursor-broadcast concern:
  Figma-style remote cursors/typing indicators/selection highlights, plus the diff-and-broadcast
  content-sync pipeline riding every `render()` call; also owns `findItemById`/`placeCaretEnd`,
  the tiny "canonical item-data accessor" primitives the plan called out separately, kept here
  since nothing else in either new file needed them split out further) and
  `app/dotto/lib/messagingCanvasPreview.ts` (~500 lines — the card-preview/messaging DOM concern:
  mini read-only canvas previews, snapshot/sanitize helpers for exporting cards off-canvas, and the
  chat conversation panel's send/close/title-level plumbing). **Neither a Zustand selector layer
  nor a dedicated presence hook were built**, despite the original plan explicitly anticipating
  both ("canonical item-data accessors... → Zustand selectors," "realtime presence/cursor
  broadcast... → a dedicated hook wrapping the Supabase realtime channel") — checked against the
  real codebase first (not assumed from the plan's own aspirational language written before this
  phase's actual work began): zero React components read `appState.remoteCursors`/
  `cursorOverlay` today (pure imperative DOM, no reactive consumer to serve), and a Zustand
  selector over `appState.folders` would be structurally meaningless before `appState` itself
  becomes a real Zustand store — core-state.js's own job, deliberately saved for last in this same
  phase since "everything reads it." Same conservative "port what's actually needed" call as
  `panels-hamburger.js` just above, for the identical underlying reason.
  8 already-existing React components (`TitleCard.jsx`, `MsgConvo.jsx`, `SharedCanvasModalBody.jsx`,
  `CollabListPanel.jsx`, `FilesListPanel.jsx`, `MessagesListPanel.jsx`, `MarketDetailPanel.jsx`,
  `TableCard.jsx`) upgraded from window bridges to real ES imports — the largest batch of this
  precedent (previously used for `stopwatch.ts`/`MediaCard.jsx`/`TableCard.jsx`/the whole
  `gamesFlashcardTyperight.ts` trio) applied in one port so far. `miniIconForKind` (the original
  file's own dead code — defined but never called anywhere) was dropped rather than carried over,
  same precedent as `window.deployPurchasedTemplate` earlier this session. 15 real vanilla callers
  fixed across both new files; 5 new outbound bridges added for still-vanilla dependencies with no
  bridge yet (`__getCursorOverlayEl` on `core-state.js`, `__renderAvatarInto` on
  `profile-achievements-pricing.js`, `__searchKindLabel` on `add-menu.js`, `__countSourceEntries`
  already existed but untyped, `__renderChecklistHTML`/`__renderStatcardHTML` on `cards-misc.js`,
  `__renderStopwatchHTML` on `stopwatch.js`, `__renderMsgList`/`__closeMessagesPanel` on their
  owning files) plus roughly a dozen bridges that already existed at runtime but had never been
  typed in `vanillaBridges.d.ts` (including a genuine duplicate `__findItemById` declaration this
  port's own new one superseded, removed rather than left alongside it). `broadcastEditingState`
  is dual-exposed on purpose — both `window.broadcastEditingState` (a real inline `onfocus`/
  `onblur` target, `canvasItemBehavior.js`'s cell markup) and `window.__broadcastEditingState`
  (real vanilla-JS callers like `waypoints-render-loop.js`'s own `.onblur` closures need
  programmatic access too) — same shape the original vanilla file already used, preserved exactly.
  The real, module-load-time cursor-tracking `pointermove` listener (`setupCursorTracking(canvas)`
  + `registerPaneCanvasListenerSetup`) and the `selectionchange` listener both ported into
  `wireCanvasPresence()`, same bridge-readiness-poll `wireX()` pattern every other port with real
  DOM wiring has used; the `#msg-convo-input` keydown/input listeners similarly became
  `wireMessagingCanvasPreview()`. The stale-reference sweep found ~35 comment references across 26
  files (the widest yet, matching this file's real fan-in) — several caught not just a stale
  filename but reasoning that had gone stale (`FilesListPanel.jsx`'s own `window.__findItemById`
  comment now describing a real ES import instead; `friends-presence.js`'s own claim that
  `openConvo`/`renderConvoBody` "stays vanilla," no longer true; `card-kinds.js`'s own
  `miniIconForKind` reference, now describing dead code) — all rewritten to state what's actually
  true now, not just repointed.
  **Two real bugs caught by later verification steps, not by typecheck**: (1) `queueSyncDiff`/
  `renderConvoBody`'s own bridge assignments failed to typecheck against their
  `Record<string, unknown>` ambient declarations until `FolderObj`/`Friend` got the same index-
  signature treatment `SrsState`/`CardRow` needed earlier this session — an expected instance of
  that now-familiar friction, not a new class of bug. (2) A genuinely new class of gap, caught only
  by `npm run build` (not `npm run typecheck`, which stayed clean): `renderMsgSnapshotCard` was
  fully implemented and called correctly from within `messagingCanvasPreview.ts` itself (via its
  own `window.__renderMsgSnapshotCard` bridge assignment) but the `export` keyword was missing from
  its own function declaration — `tsc --noEmit` never caught this because the file's own internal
  usage was enough to satisfy every type it checks; only Next.js's real bundler, resolving
  `MsgConvo.jsx`/`SharedCanvasModalBody.jsx`'s real ES `import { renderMsgSnapshotCard } from
  "./lib/messagingCanvasPreview"` against the module's actual exports, caught the mismatch. Lesson
  for the rest of this migration: the "port what's needed" discipline already established for
  window-bridge omissions (caught only by the stale-reference sweep, see the `shelf-search.js`/
  `outline-tree.js` entries above) has a real sibling failure mode on the ES-export side too, and
  only a real build — never typecheck alone — catches it; never skip `npm run build` even when
  typecheck is clean.
  Real Playwright verification against a fresh dev server, scoped honestly (documented in the
  verify script itself, same tradeoff class as this migration's own EPUB-upload and full-CSV-UI
  skips elsewhere): this shared test account has zero real friends and zero real canvas
  collaborators, so the actual multi-client realtime presence path (two different real users
  seeing each other's cursors/typing indicators/content-sync) genuinely cannot be exercised without
  a second real authenticated account with a real collaboration relationship, out of reach for a
  single-account test session. What WAS verified for real: all 27 bridges present; every
  presence/broadcast function's real null-channel safety (this account's `appState.
  canvasPresenceChannel` is legitimately `null` with no active collaboration — `ensureCanvas
  PresenceChannel`/every `broadcast*` function/`repositionAllRemoteCursors`/`goToCollaboratorCursor`
  all had to no-op cleanly against that, not throw, and did); the pure data-transform functions
  (`snapshotItem`'s real nested-folder embedding, `sanitizeFlashcardSnapshot`'s real disconnected-
  deck reset, `miniLabelForItem`, `renderMsgSnapshotCard`) called directly and checked against real
  expected output; `renderInlineCanvas` mounted into a real detached DOM node and inspected for
  real structure (world/zoom-bar/card-count/no-drag-tab-when-draggableOut-false); a real messaging
  flow — `openConvo`/`renderConvoBody`/`closeConvo` driven through the real `MsgConvo.jsx` React
  component and a real click on its back button, using a tagged mock friend injected AFTER opening
  the real rail panel specifically because `refreshMessagesPanel`'s own `renderMsgList` makes a
  real Supabase round-trip that wholesale-overwrites `appState.friends` with this account's real
  (empty) list, which would silently wipe out a mock seeded any earlier — confirmed via a real
  failed run before adjusting the seeding order; and a real `TitleCard.jsx` dropdown change (after
  a real click put the card into `.editing` mode, since `.format-bar` is `display:none` until
  then) correctly updated both the data (`level`) and the live DOM (`fontSize`). Zero console/page
  errors. Re-checked the account afterward to confirm zero residual mock items/friends.
  `history-autosave.js` (742 lines, fan-in 22) ported third to `app/dotto/lib/historyAutosave.ts`,
  kept as one file rather than split, despite the original plan's own "unrelated table-context-menu
  code splits out and ports separately" language — checked against this file's actual size/coupling
  first (not assumed from the plan's pre-work wording): at 742 lines with undo/redo, autosave,
  camera-transform, the context-menu, the global keydown handler, and stopwatch-ticking all calling
  into each other throughout, this doesn't clear the "genuinely large with cleanly-separable
  concerns" bar `live-presence.js`'s 1512-line 3-way split did — matches the precedent already set
  by `sourceButtonsCursorMode.ts` (2 unrelated concerns bundled in one file) and every single-file
  Phase 4.4 port of comparable size. **No `useHistoryStore` was built**, despite the plan
  anticipating one ("`saveSnapshot`/`undo`/`redo`/autosave become `useHistoryStore` actions") — same
  check-before-building discipline as `panels-hamburger.js`/`live-presence.js` above: zero React
  components read `appState.undoStack`/`redoStack` today, so a store wrapping them would have no
  real reactive consumer yet; kept the same conservative "plain TS module + window bridges"
  pattern. 15 real vanilla callers fixed (the 15th, `window-bridge.js`, was missed by the first
  batch-sed pass and caught by the follow-up per-file `grep` sweep that checks every caller
  individually, not just the ones the sed batch targeted); 8 real inline-onclick/oncontextmenu
  targets (`undo`/`redo`/`hideCanvasContextMenu`/`deleteContextColumn`/`deleteContextRow`/
  `highlightContextColumn`/`highlightContextRow`/`openTableCellContextMenu`) moved off
  `window-bridge.js`'s old indirection onto direct plain-global assignment, same convention as
  every recent port — `window-bridge.js` is down to 9 remaining re-exports after this, a running
  measure of how close it is to empty (Phase 4.5 target 5). `hideCanvasContextMenu` is dual-exposed
  on purpose — both `window.hideCanvasContextMenu` (a real inline `onclick` target,
  `content/fragments/canvas-context-menu.html`'s own "Undo"/"Redo" rows) and
  `window.__hideCanvasContextMenu` (real vanilla-JS callers like `sourceButtonsCursorMode.ts`'s own
  `window.onclick` handler need programmatic access too) — same dual-exposure shape established for
  `broadcastEditingState` in the previous port. `canvasItemBehavior.js` (a plain `.js` file,
  deliberately zero-import before this port) upgraded to a real ES import of `applyTransform`/
  `saveSnapshot`/`scheduleWorkspaceSave` for its `setupResizing`/`setupDraggingAndClicking` closures
  — same same-tree-caller-upgrade precedent as every other port this session, but this one had a
  real consequence caught below. `__registerPaneCanvasListenerSetup`'s ambient type in
  `vanillaBridges.d.ts` was simply wrong — declared as `(fn: (canvasEl: HTMLElement) => void) =>
  void` when the real implementation (`core-state.js`'s `registerPaneCanvasListenerSetup`) always
  calls `fn(canvasEl, paneId)`, a real 2-argument call; `npm run typecheck` caught this immediately
  once `setupCanvasContextMenu(canvasEl, paneId)` was registered through it — fixed the type to
  match the real call site, not the other way around.
  **A second, far more significant bug, project-wide in scope, was caught only by real Playwright
  browser testing (neither typecheck nor `npm run build` catches it — both stayed clean)**:
  `canvasItemBehavior.js`'s new import above was the first point in `app/dotto-app.jsx`'s entire
  module graph where a bridge-setting file's top-level code actually runs during Next's real
  server-side render pass, and `window`/`document` genuinely don't exist yet at that point in SSR
  — a real, reproducible `ReferenceError`, confirmed via the dev server's own log
  (`⨯ ReferenceError: window is not defined at module evaluation (historyAutosave.ts:811:1)`) and a
  real `GET / 500` on every single request. Bisected with `git stash` against `HEAD` (commit
  `db6b97a`, before any of this port's changes) to rule out a false positive: **the same crash
  reproduces identically at `HEAD`, in both `npm run dev` and a real `npm run build && npm run
  start` production server** — this is a pre-existing, already-shipped bug across this whole
  migration's bridge-file convention (every `app/dotto/lib/*.ts` port sets `window.__X = fn` at
  bare module top level, unguarded), not something this specific port introduced; this port's own
  `canvasItemBehavior.js` change only happened to be what surfaced it, by being the first thing in
  the import graph to reach an unguarded file's top level this early. Root-caused and fixed
  properly rather than patched around: every `app/dotto/lib/*.ts` file with a top-level
  `window.X = ...` assignment (17 files: `canvasPresence.ts`, `copyPaste.ts`,
  `gamesFlashcardTyperight.ts`, `historyAutosave.ts`, `marketplace.ts`, `mediaPdfEpub.ts`,
  `messagingCanvasPreview.ts`, `notificationsStore.ts`, `outlineTree.ts`, `panelsHamburger.ts`,
  `sharedAndPublicCanvasLoading.ts`, `shelfSearch.ts`, `sourceButtonsCursorMode.ts`,
  `sourceTable.ts`, `splitPaneManagement.ts`, `stopwatch.ts`, `tabManagement.ts`) had its bridge
  block wrapped in `if (typeof window !== "undefined") { ... }`; `gamesFlashcardTyperight.ts` also
  had a genuinely different variant of the same bug — a real top-level `document.addEventListener`
  call (its outside-click-closes-the-options-panel listener), guarded with its own
  `if (typeof document !== "undefined")` instead. Verified the fix at three levels: `npm run build
  && npm run start`, real authenticated Playwright reloads (3x) with zero console errors or server
  500s; a fresh `npm run dev`, same result; and the full `verify-phase4-5-historyautosave-port.js`
  script passing clean end to end. **This is flagged here prominently, not folded quietly into the
  bridge-file list above, because it was a real production-affecting bug already live on `main`
  before this port started** — every authenticated user's first/refreshed page load was hitting a
  server-side 500 (the client-side app still ultimately worked after hydration recovered from it,
  which is presumably why it went unnoticed by users and by every prior port's own Playwright
  verification, none of which happened to check server response status codes or reload from a cold
  SSR pass the way this port's own bisection did).
  Real Playwright verification against a fresh dev server: undo/redo via a real card add + real
  `__undo`/`__redo` round trip (item count checked before/after each step); camera transform via a
  real mouse-wheel pan (`tx`/`ty` change) and a real Ctrl+wheel zoom (`scale` change); the canvas
  right-click context menu opened via a real right-click on verified-blank canvas space (a screen
  point picked via `elementFromPoint`, since a card's own image can intercept the click and stop
  the event from bubbling to the canvas listener — by design, "cards handle their own contextmenu")
  and closed via the real `hideCanvasContextMenu()` plain global; and the full autosave/load round
  trip via a real title edit, `scheduleWorkspaceSave()`, a real page reload, and confirming the new
  title survived (real Supabase round trip, not a mocked one). Zero console/page errors. Cleanup
  restored the edited card's original title and removed the mock undo/redo test card.
  `srs-connections-core.js` (1309 lines, fan-in 7) ported fourth to
  `app/dotto/lib/srsConnectionsCore.ts` — the largest single Phase 4.5 file by fan-out even though
  its own fan-in (7 real vanilla callers) was the smallest of the four ports so far: the canvas
  data-conduit connection system (`isValidConnection`/`CardStreamIO`/`propagateCanvasStreams`,
  9 card kinds' worth of stream config), click-to-link (`handleDataModeClick`), canvas item
  creation (`add`/`createNewSource`/`deepCloneItem`/`deleteClonedItemFolders`), the pen/eraser
  drawing tool (point-by-point polylines with bezier handles, freehand strokes, eraser hit-testing),
  the zoom-track drag/dblclick handlers, the draw toolbar, and — the single largest piece — the
  global keydown handler backing every one-letter rail shortcut in the app (~25 branches). SM-2
  (`calculateSM2`/`defaultSrsState`/`diffRatings`) stayed in `srs-algorithm.js` exactly where the
  Phase 4.2 extraction left it (genuinely pure/zero-import, still not worth moving on its own) —
  that file now sets its own `window.__calculateSM2`/`__defaultSrsState`/`__diffRatings` bridges
  directly instead of `srs-connections-core.js` re-exporting them, since it's fully capable of
  doing so safely and that file is gone. **No `useHistoryStore`-style store or hook was built**,
  same check-before-building discipline as every other Phase 4.5 port: `appState.CardStreamIO` is
  still a plain mutable object assigned inside `wireSrsConnectionsCore()`'s own wire step (it
  mutates the live `appState`, so it can't run at TS module-evaluation time the way the vanilla
  original did at vanilla module-load time — `appState` doesn't exist yet then), same pattern
  every other Phase 4.5 port's DOM/appState wiring already established. 7 real vanilla callers
  fixed (`waypoints-render-loop.js`, `drawing-connections.js`, `window-bridge.js`, `app-init.js`,
  `command-verbs.js`, `source-tags-ai.js`, `upload-popup.js`); `createNewSource` is dual-exposed —
  both `window.createNewSource` (a real inline `onclick` target,
  `content/fragments/hamburger-stack.html`'s "New source" `+` button) and `window.__createNewSource`
  (already an established bridge, `SourcesListPanel.jsx`) — same dual-exposure shape
  `hideCanvasContextMenu`/`broadcastEditingState` established earlier this session;
  `window-bridge.js`'s own old re-export of the plain global was removed, same "this file is now
  the sole source" precedent as every other recent plain-global move. 13 new outbound bridges added
  for still-vanilla dependencies with no bridge yet (`__kindLabel` on `add-menu.js`;
  `__openSearchOverlay` on `ai-assistant-suggestions.js`; `__showProfileSettingsView` on
  `profile-achievements-pricing.js`; `__toggleTheme` on `theme-toggle.js`; `__toggleUploadPopup` on
  `upload-popup.js`; `__startBoxSelection`/`__syncWaypointToDb` on `waypoints-render-loop.js`;
  `__findLinkedTable`/`__findTableById`/`__pathNearPoint`/`__penPointsToPath`/`__pointsToPath`/
  `__ensureDrawings` on `drawing-connections.js`) plus 6 new draw-toolbar-element getters on
  `core-state.js` (`__getDrawColorInputEl`/`__getDrawSizeInputEl`/`__getDrawPenBtnEl`/
  `__getDrawEraserBtnEl`/`__getDrawFrontBtnEl`/`__getDrawBackBtnEl`, same "single, never-reassigned
  element" category `__getBtnAddEl`/`__getContextMenuEl` already established) and one bridge
  (`__goToWaypointCard`) that already existed at runtime (`hamburger-collab.js`) but had never
  been typed. `canvasItemBehavior.js` (same-tree, already real ES imports for
  `applyTransform`/`saveSnapshot`/`scheduleWorkspaceSave` from the previous port) upgraded 7 call
  sites (`handlePenPointerDown`, `deepCloneItem`, `deleteClonedItemFolders` x2,
  `isValidConnection` x2, `handleDataModeClick`) from `window.__X` bridges to direct imports;
  `FilterCard.jsx` (already real ES imports for other same-tree modules) similarly upgraded
  `applyFilterToRows`/`collectAvailableFilterTags`. A real, pre-existing bug in
  `vanillaBridges.d.ts` was caught by `npm run typecheck` on the first pass:
  `__registerPaneCanvasListenerSetup`'s ambient type was declared as a 1-argument callback
  (`(canvasEl: HTMLElement) => void`) when `core-state.js`'s real implementation has always called
  it with 2 (`fn(canvasEl, paneId)`) — fixed the type to match the real call site. The
  stale-reference sweep found ~50 comment references across 29 files (the widest yet this
  migration) — several caught reasoning that had gone stale, not just a filename: `add-menu.js`'s
  and `text-utils.js`'s own comments describing `srs-connections-core.js` as still directly
  `import`-ing their pure helpers (now reached via a bridge, since `srsConnectionsCore.ts` can't
  import from `public/dotto/`), `srs-algorithm.js`'s own header comment (previously justified
  staying vanilla by "srs-connections-core.js still has real vanilla hub dependents of its own" —
  no longer true, that file is gone), and `test/vanilla/srs-algorithm.test.ts`'s identical stale
  justification.
  **Real Playwright verification against a fresh dev server, covering unusually deep real
  functional behavior for this migration (not just bridge presence)**: `add()` via a real bridge
  call producing a real new item pushed onto `appState.folders[...].items`; a full real
  click-to-link + data-flow round trip — two real mock cards (a source with a real nested table
  and a flashcard), `isValidConnection` accepting the pairing, two real `handleDataModeClick` calls
  completing the link, and `applyConnections`/`CardStreamIO`'s real propagation actually copying
  the source table's row (`front: 'hello'`) onto the flashcard's own `cards` array — the single
  deepest functional check any Phase 4.5 verify script has done, not just confirming a bridge
  exists but confirming the whole data-conduit pipeline actually moves real data end to end; a real
  `w` keypress (global keydown handler) opening the Waypoints panel via a real
  `appState.railBtnWaypoints.click()`; a real click on the live `draw-pen-btn` DOM element setting
  both `appState.drawTool` and the button's own `active` class; and a real pointerdown-drag-pointerup
  gesture on the live zoom-track element changing `appState.scale` from a real `clientY` sequence,
  not a synthetic direct call. Also re-ran the previous port's own
  `verify-phase4-5-historyautosave-port.js` afterward as a regression check, since this port also
  touched `core-state.js`/`waypoints-render-loop.js`/`ai-assistant-suggestions.js`/
  `profile-achievements-pricing.js`/`theme-toggle.js`/`upload-popup.js` — passed clean, no
  regression. Zero console/page errors on either script. Cleanup removed every mock item/folder/
  connection created during the run.
  `waypoints-render-loop.js` (1231 lines, fan-in 10) ported fifth to
  `app/dotto/lib/waypointsRenderLoop.ts` — the plan's own "hardest single piece": `render()`/
  `renderOnce()`, the global re-render escape hatch dozens of call sites across the whole app funnel
  through (item add/delete/move, realtime remote updates, navigation — every one of them,
  vanilla and React alike, still reaches it exactly the same way, via `window.__render`), plus
  waypoint-card expand/collapse (intricate width-transition/contentEditable/drag-detection math),
  folder/source card click-routing and inline-rename, the note/watermark/title contentEditable
  lifecycles, universal per-item wrapper attrs/behavior, box-selection, folder-merge (Alt-drag),
  camera centering, folder navigation (`openFolder`/`applyFolderView`), media-viewer zoom, and
  cascading folder deletion (waypoints/collaborators/`global_items` cleanup, recursive into nested
  folders). **No `wireX()` was needed** — unusual for a Phase 4.4/4.5 port with real DOM
  interactivity: unlike every prior port, nothing here does real DOM-listener wiring at a fixed
  module-load moment. Every interactive piece is attached per-item from a React layout effect
  (`CanvasItemsLayer.jsx` et al., matching the established per-Component `attach*` pattern) or
  invoked directly by a caller — so a plain side-effect import in `dotto-app.jsx` is enough, same
  shape `outlineTree.ts`/`shelfSearch.ts` already use for their own side-effect-only imports.
  `setupResizing`/`setupDraggingAndClicking`/`renderConnectionsLayer`/`renderStaticTableHTML`/
  `attachStaticTableHoverZones`/`layoutSourceTableColumns` are real ES imports from
  `canvasItemBehavior.js` instead of bridges — same-tree, both live in `app/dotto/` — the first
  time this migration's "same-tree caller upgrade" precedent applied to the PORTED file's own
  internal calls, not just external callers; `window.__performMerge` deliberately stayed a bridge
  in `canvasItemBehavior.js` specifically (not the "ubiquitous primitive" reasoning `render()`/
  `openFolder()` get everywhere else, but a genuine circular-import hazard: `canvasItemBehavior.js`
  importing back from `waypointsRenderLoop.ts` would close a cycle, since that file already imports
  FROM `canvasItemBehavior.js`) — checked and ruled out before ever attempting it, not discovered
  by a failed build. 10 real vanilla callers fixed (`drawing-connections.js`,
  `ai-assistant-suggestions.js`, `search-orchestration-selection.js`, `hamburger-collab.js`,
  `app-init.js`, `mnemonic-search-matching.js`, `command-verbs.js`, `cards-misc.js`,
  `card-shortcuts.js`, `source-tags-ai.js`). 12 new outbound bridges added for still-vanilla
  dependencies with no bridge yet (`__paneElId`/`__getZoomControlEl` on `core-state.js`;
  `__refreshCanvasCollabForCurrentFolder` on `friends-presence.js`; `__findNextFreeSlot` on
  `card-shortcuts.js`) plus 4 bridges that already existed at runtime but had never been typed
  (`__deleteWaypointFromDb`/`__deleteCanvasCollabsForFolder`/`__cascadeDeleteFolderContents`/
  `__deleteWaypointCardEverywhere` — caught only because `card-shortcuts.js`'s own fix needed them
  typed, the same "gap invisible until a real caller needs it" class as prior ports). 13
  already-existing React components upgraded from window bridges to real ES imports — the widest
  batch of this precedent yet: `CanvasItemsLayer.jsx`, `CanvasCard.jsx`, `SourceCard.jsx`,
  `NoteCard.jsx`, `WatermarkCard.jsx`, `TitleCard.jsx`, `WaypointCard.jsx`, `FilesListPanel.jsx`,
  `PaneZoomBar.jsx`, `ReferenceCard.jsx`, `SourcesListPanel.jsx` (both `startRenameFolderCardTitle`
  and `openFolder`, tightly coupled to the same row-click interaction), `TabsBar.jsx`. `render()`/
  `openFolder()`/`centerOnContent()`/`applyFolderView()`/`performMerge()`/`expandWaypointCard()`/
  etc deliberately stayed bridges everywhere else — same "ubiquitous core primitive" precedent
  `getAppState`/`saveSnapshot` already established (called so pervasively, including
  lib-file-to-lib-file, that treating every call site as a direct-import candidate would tangle the
  dependency graph for no real benefit); the same-tree-upgrade precedent applies specifically to a
  React component's own clearly-scoped rendering/behavior helper, not a universal entry point. Two
  real pre-existing type bugs caught by `npm run typecheck` on the first real pass, both fixed by
  correcting the type to match the real call site (never the other way around): `__renderSourcesList`/
  `__renderFilesList`/`__renderHubCollabList`/`__renderWaypointsList`'s shared `query` parameter was
  declared required when the real functions have always treated it as optional (falling back to the
  search input's own live value); `__openFolder`'s declared return type was a sync `void` when the
  real function has always been `async` (a `shared:` key not yet fetched is loaded first). The
  stale-reference sweep found ~55 comment references across 24 files (the widest yet this
  migration, reflecting this file's real fan-out even though its fan-in was comparatively small) —
  several caught reasoning that had gone stale, not just a filename: `dotto-app.jsx`'s and
  `canvasItemBehavior.js`'s own comments explaining which vanilla callers "still need" the
  `setupResizing`/`renderConnectionsLayer`/etc bridges had to be rewritten now that `render()`
  itself reaches those same-tree (the one real remaining bridge consumer is
  `sourceButtonsCursorMode.ts`'s `relayoutSourceTableIfVisible`, a genuinely different lib file);
  `CanvasItemsLayer.jsx`'s own comment claiming wrapper-attr/behavior wiring was "still owned by
  vanilla code" (now a same-tree import); two identical `table-grid-resize.js`/vanillaBridges.d.ts
  passages claiming `attachNoteBody`'s onblur closures were "real vanilla-JS callers" of
  `__broadcastEditingState` (still real bridge callers, just no longer vanilla — TS calling a
  different lib file's bridge, not vanilla calling one).
  **Build took an anomalously long 17.1 minutes for TypeScript checking on its very first run
  after this port landed** (vs. the usual under-2-second `next build` TypeScript pass) — re-ran
  immediately after to rule out a real regression: the second run was back to 1.67s, confirming
  this was a one-time cold-cache cost (Turbopack's persistent type-check cache warming up against
  this migration's single largest new file, ~1650 lines) rather than a lasting problem; flagged
  here for visibility, not treated as a blocker.
  Real Playwright verification against a fresh dev server, deliberately going deeper than a bridge-
  presence check given this file's real risk profile (`render()` is called on every single state
  change across the whole app): a real note-card click-to-edit-and-type-and-blur round trip
  persisting `it.html` correctly (the single most common interaction in the entire app); a real
  mock folder card created, clicked, and navigated into end-to-end
  (`attachFolderCardClick` -> `openFolder` -> `applyFolderView` -> `render()`, confirmed via a real
  `currentFolderId` check, then navigated back out again); a real double-click folder rename
  (`startRenameFolderCardTitle`) that persisted the new title; a real mouse hover that visibly
  widened a waypoint card via `attachWaypointCardBody`/`expandWaypointCard`'s real
  `getBoundingClientRect`-driven width transition; and a real Shift+drag box selection
  (`startBoxSelection`) that correctly picked up all 3 mock cards by real screen-to-world coordinate
  conversion. Mock cards were placed in a large empty world-coordinate area (x/y 5000+, camera
  panned out to it first) specifically so they'd never collide with this shared test account's real
  existing content — a real collision was hit and fixed during this port's own test-writing pass
  (a mock note card first placed near the origin landed under a real table card and silently ate
  every click). Also re-ran both `verify-phase4-5-historyautosave-port.js` and
  `verify-phase4-5-srsconnectionscore-port.js` afterward as regression checks, since this port
  touched several files those scripts exercise (`core-state.js`, `hamburger-collab.js`,
  `card-shortcuts.js`, `cards-misc.js`, `ai-assistant-suggestions.js`) — both passed clean, no
  regression. Also re-ran the SSR-safety check from the `history-autosave.js` port one more time
  (`npm run build && npm run start`, 3 real authenticated Playwright reloads) since this port added
  yet another new module-top-level bridge-setting file to the same import graph that bug lived in —
  zero console errors or server 500s. Zero console/page errors across every script. Cleanup removed
  every mock item/folder created during the run and restored the original folder/camera.
  `core-state.js` (905 lines, fan-in 35, the `appState` singleton) ported sixth — deliberately
  last, per the plan's own reasoning ("everything reads it"). Genuinely different in kind from
  every other Phase 4.5 port, not just scale: the plan's own original strategy for this file called
  for a Zustand dual-write migration rather than the plain-TS-module pattern every other Phase 4.5
  file ended up using — checked against real usage first (same discipline as every other deviation
  this phase), and confirmed correct here in the OPPOSITE direction from every prior check: this
  file's own extra caution turned out to be warranted, just not for the reason the plan assumed.
  The real hazard wasn't architecture, it was timing: `appState.currentUser` depends on
  `window.__DOTTO_USER__`, which `dotto-app.jsx` deliberately sets INSIDE `DottoApp`'s own render
  body (not at module eval, not in a `useEffect` — see that file's own comment: `dotto-script.js`'s
  `afterInteractive` `<Script>` tag needs it ready before that script runs, and setting it during
  render, not after paint, is what guarantees that ordering). A plain module-load-time side-effect
  import — the pattern every other Phase 4.4/4.5 port uses — runs during module evaluation, which
  always completes *before* the first render call; had this port copied that pattern verbatim,
  `appState.currentUser` would have silently constructed from the guest fallback (`{id: null,
  username: 'guest', ...}`) for every real logged-in user, every single time. Caught by tracing the
  actual render-vs-module-eval ordering before writing any code, not by a failed test. Fixed by
  exporting `ensureCoreState()` instead of a side-effect import — called from `DottoApp`'s own
  render body immediately after `window.__DOTTO_USER__` is set (the exact same synchronous timing),
  idempotent (`DottoApp` re-renders many times over its lifetime; `appState` must only ever be
  constructed once). Confirmed working via a real production-server check: `appState.currentUser`
  showed the actual logged-in test account (real `id`/`username`/achievements), not the guest
  fallback, across 3 real reloads.
  **The other genuinely large-scale challenge was correctness at hundreds of call sites, not
  architecture.** 22 real vanilla files still imported directly from `core-state.js` (real ES
  imports, not bridges) — 553 individual `appState.` references across them combined. The key
  simplification that made this tractable: `appState` is a stable object reference, only ever
  mutated in place, never reassigned — given the confirmed module-eval-before-render ordering
  guarantee, every vanilla file could safely capture it ONCE at its own module top level
  (`const appState = window.__getAppState();`), with zero changes needed to any of those hundreds
  of internal `appState.X` call sites, the exact same ergonomics as the real import it replaced.
  The same held for every bridge-backed FUNCTION this file exposes (`effectiveMode`, `findItemEl`,
  `switchActivePane`, `parseItemId`, `canvasViewportCenterX`, etc. — bridges are assigned once and
  never reassigned) and for every `const`-declared DOM element (`btnAdd`, `contextMenu`,
  `drawSettings`, etc. — genuine page-level singletons). The ONE real exception:
  `canvas`/`world`/`dotLayer`/`cursorOverlay` are `let`-reassigned by `switchActivePane` for
  split-screen — a module-scope capture of these would silently go stale the moment a second pane
  became active, so the 3 files touching `canvas` (`ai-assistant-suggestions.js`,
  `blocks-panel.js`, `mnemonic-search-matching.js`, one call site each) got a fresh
  `window.__getCanvasEl?.()` call at their own actual use site instead, matching the "always fetch
  fresh, never cache" convention every other Phase 4.4/4.5 port already established for these same
  four elements. Zero new outbound bridges were needed for the appState/DOM-element surface at
  all — every one of the ~90 bridges this file exposes (the appState-property DOM refs like
  `appState.btnInbox` needed no getter of their own, already reachable through
  `window.__getAppState()`; the ~19 separately-bound elements' getters) had already been
  proactively established by 5 earlier ports reaching into this file's internals before this port
  even started — this port's own job was almost entirely "actually implement what those getters
  already promised." Only 3 bridges were genuinely new: `window.__DOTTO_USER__`'s own ambient type
  (existed at runtime, never typed), `window.__setActivePaneId` (same), and
  `window.__bringCardToFront` (same) — all 3 the "existed at runtime, never typed until a real
  `.ts` consumer needed it" class this migration has hit repeatedly.
  A real corruption was caught and fixed during the port itself, not by a later test: `NON_LATIN_SCRIPT_RE`'s
  ` -ɏḀ-ỿ -⁯` unicode escape sequences got rendered as literal raw
  Unicode characters while authoring the file (visually indistinguishable in a normal read, since
  the resulting text still looked like plausible source) instead of staying escape-sequence text —
  caught by a deliberate post-write `python3`/`repr()` byte-level diff against the original vanilla
  file (grep alone couldn't even find the corrupted line, since the raw Unicode text no longer
  matched a plain-ASCII search pattern), then fixed to be byte-for-byte identical to the original.
  A related but harmless discrepancy (`CLOZE_RE`'s `[^[\]]` vs. the original's `[^\[\]]` —
  functionally identical in JavaScript regex, since `[` needs no escaping inside a character class)
  was fixed the same way for exact fidelity regardless. This bug class — and the fact that
  automated verification (typecheck/eslint/build/tests) cannot catch it, since a corrupted-but-
  syntactically-valid regex has no type or runtime signature distinguishing it from a correct one
  — is worth remembering for any future port of a file with unicode-escape or other
  easily-visually-confusable literal content.
  Real Playwright verification against a fresh dev server: re-ran all 5 previous Phase 4.5 verify
  scripts (`panels-hamburger`, `live-presence`, `history-autosave`, `srs-connections-core`,
  `waypoints-render-loop`) as regression checks first, since every one of them depends on
  `window.__getAppState()` now coming from this exact file — all 5 passed clean, zero regressions,
  the single largest regression-check batch this migration has run for one port. Then a new,
  targeted test for the one piece of real, distinctive logic `core-state.js` alone owns that
  nothing else had exercised directly: split-screen pane switching. A real second pane created via
  the same `window.__splitPaneWithTab` bridge `TabsBar.jsx`'s own drag-to-split gesture calls,
  confirmed via a real mounted `#canvas-N` DOM element (not just state); a mock folder navigated
  into on the new pane; `switchActivePane` back to pane 0 confirmed via a real
  `appState.currentFolderId` check that pane 0's OWN folder came back correctly (not left stuck on
  the new pane's folder, not reset to root); switching to the new pane again confirmed its own
  folder was correctly saved and restored too — real swap-in-place pane-state correctness verified
  in both directions, not just "a bridge exists." Also verified `appState.currentUser` reflects the
  real logged-in user (not the guest fallback) directly in the browser, both in dev and via a real
  production server (`npm run build && npm run start`, 3 real authenticated reloads) — zero console
  errors or server 500s in either mode. Zero console/page errors across all 7 scripts run this port
  (6 Phase 4.5 verify scripts plus the dev/prod SSR safety checks). Cleanup closed every pane and
  removed every mock folder created during the run.
  **This closes out Phase 4.5's single riskiest remaining target and the whole phase's real
  architectural core — 6 of 7 done.** Only `window-bridge.js` remains — not a standalone port, but
  a shim that shrinks as a side effect of porting the 8 vanilla files it re-exports from. Of those
  8: 4 (`cards-misc.js`, `library-publish.js`, `profile-achievements-pricing.js`,
  `card-shortcuts.js`) have zero remaining vanilla-to-vanilla dependencies and are immediately
  portable; the other 4 (`ai-assistant-suggestions.js`, `hamburger-collab.js`,
  `friends-presence.js`, plus `mnemonic-search-matching.js`/`messages-schedule.js`) form a
  genuinely circular cluster needing a different approach. `cards-misc.js` (153 lines) done first,
  to `app/dotto/lib/cardsMisc.ts` — the Embed card (`shortUrl`/`withYoutubeOrigin`/
  `toEmbeddableUrl`/`editEmbed`) and the Checklist/Statcard cards (`renderChecklistHTML`/
  `renderStatcardHTML` + `addTask`/`toggleTask`/`updateTaskText`/`updateTaskDeadline`/
  `removeTask`). The one real design wrinkle: `renderChecklistHTML`'s own generated HTML string
  has literal `onclick`/`onchange`/`oninput="toggleTask(...)"`-style attributes (consumed by
  `messagingCanvasPreview.ts`'s mini inline-canvas previews too), so `addTask`/`editEmbed`/
  `removeTask`/`toggleTask`/`updateTaskDeadline`/`updateTaskText` keep their exact plain
  (non-`__`) global names in `cardsMisc.ts`'s own bridge block, dual-exposed alongside real named
  exports — same convention `window.setMediaFromLink`/`window.pushNotification` already
  established — while `__shortUrl`/`__toEmbeddableUrl`/`__renderChecklistHTML`/
  `__renderStatcardHTML` stay `__`-prefixed bridges for `outlineTree.ts`/
  `messagingCanvasPreview.ts` (different lib files). `EmbedCard.jsx`/`ChecklistCard.jsx` (same
  `app/dotto/` tree) upgraded to real ES imports of the same functions, same "same-tree caller
  upgrade" precedent as every other Phase 4.5 port. `window-bridge.js`'s own import line and 6
  re-export lines for these functions removed — it now imports from 7 files instead of 8. One
  real bug caught mid-port: an initial `const appState = window.__getAppState!();` captured once
  at this file's own module top level (the pattern `core-state.js`'s port established) crashed
  with `window.__getAppState is not a function` — unlike every file that pattern was safe for,
  this file has no `wireX()` of its own (a plain side-effect import, same as
  `waypoints-render-loop.js`), so its module body runs at import time, before `DottoApp`'s render
  body has called `ensureCoreState()` and set the bridge. Fixed by reading
  `window.__getAppState?.()` lazily inside `addTask` (the only function that needs it), same
  lazy-read pattern `stopwatch.ts` already used for the identical reason. Real Playwright
  verification against both a dev server and a real production server (`npm run build && npm run
  start`): `shortUrl`/`toEmbeddableUrl` pure-logic checks; a real Embed card rendering a live
  YouTube URL's hostname/rewritten iframe src; a real `editEmbed()` click (via `EmbedCard.jsx`'s
  real import, `window.prompt` overridden in-page) updating `it.embedUrl`; a real Checklist card's
  checkbox/contentEditable-text/date-input/remove/add all round-tripped through real clicks and
  typing (via `ChecklistCard.jsx`'s real imports); the same plain-global names independently
  smoke-tested by calling them directly, matching `renderChecklistHTML`'s own generated-HTML
  contract; `renderStatcardHTML`'s bridge output checked for the correct computed value/caption.
  Zero console/page errors in either mode (one real third-party noise source — `player.vimeo.com`'s
  own CORS/`PresentationRequest` console errors from the real Vimeo iframe the `editEmbed` test
  intentionally loads — filtered the same way `example.com/test.pdf`/404 noise already was).
  Regression-verified `core-state.js`'s and `waypoints-render-loop.js`'s own Phase 4.5 scripts
  clean afterward (the two ports `cardsMisc.ts` most directly sits on top of). Cleanup removed
  every mock item created.
  `library-publish.js` (248 lines) done second, to `app/dotto/lib/libraryPublish.ts` — the Blocks
  panel's Item Detail view (Purchased / My Creations = drafts+published) and the Publish Flow
  (draft → published). Every function reads `appState` lazily via a `getAppState()` helper called
  at the top of each function body (matching `marketplace.ts`'s established convention for
  plain-side-effect-import files with no `wireX()`), not a module-top-level capture — the exact
  same class of bug `cardsMisc.ts`'s port hit above would have recurred here otherwise, this file
  has 9 functions that read `appState`, not just one. The real design work here was untangling
  which of the file's 12 real callers actually needed which exposure shape, since every one of
  them turned out different on inspection: `__openItemDetail` stays a `__`-prefixed bridge
  (`marketplace.ts`, a different lib file, plus `blocks-panel.js`, still vanilla); a brand new
  `__deleteMyCreationItem` bridge was added for `blocks-panel.js`'s own row-level delete (it used
  to import this function directly, a plain vanilla-to-vanilla import that no longer reaches
  across the public/app boundary); `onItemDetailFieldChange`/`confirmPublishFlow` stay plain
  (non-`__`) globals (real inline `oninput`/`onclick` targets in
  `content/fragments/hamburger-stack.html`'s price/description fields and Publish button) *and*
  `onItemDetailFieldChange` also gets a real import in `ItemDetailTitle.jsx` — a genuine dual-path
  consumer, both kept; `commitItemDetailTitle`/`focusPublishFlowName`/`blurPublishFlowName` had
  their old plain-global exposure dropped entirely once their one real consumer each
  (`ItemDetailTitle.jsx`, `PublishFlowName.jsx`) was upgraded to a real import — no inline HTML
  target for any of the three, confirmed by grep before removing; `deleteDetailDraft`/
  `startPublishFlow`/`unpublishDetailItem`/`updateDetailItem` had their old `__`-prefixed bridges
  dropped the same way once their one real consumer (`ItemDetailFooter.jsx`) was upgraded to real
  imports; `commitItemDetailDesc` turned out to be genuinely dead code — grepped for a real caller
  (inline HTML, a React component, anywhere) and found none, so its window-bridge.js re-export was
  removed but the function itself stays exported unchanged, matching this migration's
  feature-freeze discipline (a real functional gap — the description field's blur never wires
  to it, unlike the title field — carried forward exactly as-is, not fixed as a drive-by). One
  pre-existing ambient-type inaccuracy caught and fixed: `__renderInlineCanvas`'s `connections`/
  `onDelete` params were declared required even though the real implementation
  (`messagingCanvasPreview.ts`) always treated them as optional — this file's own 2-argument call
  sites would have failed `npm run typecheck` otherwise. `ItemDetailTitle.jsx`/`PublishFlowName.jsx`/
  `ItemDetailFooter.jsx` (same `app/dotto/` tree) all upgraded to real ES imports, same "same-tree
  caller upgrade" precedent as every other Phase 4.5 port. `window-bridge.js`'s own import line and
  10 re-export lines removed — it now imports from 6 files instead of 7. `blocks-panel.js` (still
  vanilla) fixed at its 2 real call sites (`openItemDetail`/`deleteMyCreationItem`, formerly a
  direct vanilla-to-vanilla import) to go through the `__openItemDetail`/`__deleteMyCreationItem`
  bridges instead. Real Playwright verification against both a dev server and a real production
  server: real click on the Blocks rail icon opening `#add-menu`; a real `openItemDetail()` call
  (matching `blocks-panel.js`'s own real call shape) correctly populating every DOM field and
  toggling the right view classes; `ItemDetailFooter.jsx`'s real rendered button set checked for
  both `sourceFolder` states (`Delete`/`Publish` for drafts, `Unpublish`/`Update` for published); a
  real contentEditable triple-click-type-blur through `ItemDetailTitle.jsx`'s real
  `commitItemDetailTitle` import persisting the new title; a real `startPublishFlow` →
  `PublishFlowName.jsx`'s real `focusPublishFlowName` import (via a real mousedown) →
  `confirmPublishFlow` (the real inline `onclick` target) round trip; a real price-field edit
  through the real inline `oninput` target correctly enabling the Update button via
  `onItemDetailFieldChange`; `updateDetailItem`/`unpublishDetailItem`/`deleteDetailDraft` all
  exercised via real `ItemDetailFooter.jsx` button clicks; `__deleteMyCreationItem` exercised
  directly, matching `blocks-panel.js`'s own real call shape. Every mock item used a real
  `crypto.randomUUID()` id rather than a plain string — `marketplace_listings.id` is a real `uuid`
  column, and a non-UUID string fails Postgres's own type check with a 400 before even reaching
  "row doesn't exist," caught the hard way while writing this port's own verify script (a plain
  string mock id produced a real, confusing `invalid input syntax for type uuid` Postgres error
  instead of the intended silent 0-rows-affected no-op). Every Supabase update/delete call this
  port makes was exercised for real, against real-UUID-shaped but nonexistent ids, so each one
  safely no-ops without ever touching real data — not skipped, not mocked. Also caught and fixed
  the same class of bug in a pre-existing (Phase 2, gitignored) regression script,
  `verify-phase2-contenteditable.js`: a plain-string mock id triggering the same Postgres 400,
  `window.__startPublishFlow` no longer existing now that its own bridge was dropped (fixed to
  click the real Publish button instead — more faithful to a real user flow than the direct bridge
  call it replaces), and a stale `#btn-library` click (the Plugins panel, not `#add-menu`, which is
  where `#item-detail-view` actually lives, predating the Library→Blocks/Plugins repurposing) —
  confirmed clean afterward. Zero console/page errors across both scripts in both dev and
  production modes.
  `profile-achievements-pricing.js` (314 lines) done third, to
  `app/dotto/lib/profileAchievementsPricing.ts` — the Profile panel (level pill, avatar rendering,
  Dotbot usage bars), the achievement/spritebook system, and the pricing-overlay open/close
  wrappers. The one genuinely new wrinkle this port needed, beyond the lazy-`getAppState()`
  discipline `cardsMisc.ts`/`libraryPublish.ts` already established: this file has real
  module-load-time side effects (an initial `renderProfileLevel()`/`renderSpriteGrid()` call, the
  achievement-bump interval, the usage-tooltip mousemove listeners, and — the one requiring a real
  external bridge — `window.__wireRailIcon('profile', ...)` itself, wiring the Profile rail icon),
  not just functions waiting to be called later. A plain side-effect import (this file's first
  instinct, matching `cardsMisc.ts`/`libraryPublish.ts`) would have run all of that at module-eval
  time, before `ensureCoreState()` OR `panelsHamburger.ts`'s own `wireRailIcon` bridge exist —
  needed a real `wireProfileAchievementsPricing()`, following
  `app/dotto/lib/dayChangeAndAdNotifications.ts`'s own precedent almost exactly (that file's own
  comment already states the general principle: "a single readiness check isn't enough here"),
  polling for both `window.__getAppState` and `window.__wireRailIcon` before wiring — the first
  case in this migration polling for two independent bridges from two different owning files at
  once, not just one. `window.__ACHIEVEMENTS`/`__SPRITE_TOTAL_COUNT` (true constants,
  `AchievementsGrid.jsx`'s own bridges) went through the identical mistake once before landing
  correctly: an initial `if (window.__getAppState) { window.__ACHIEVEMENTS = ... }` guard at module
  scope looked plausible but is provably always-false, not just racy — module eval always
  completes before `DottoApp`'s render body (where the bridge gets set) ever runs, so this isn't a
  timing window that sometimes loses, it never wins; caught by the verify script below actually
  checking the two window globals' real values, not just their bridge-existence type, then fixed
  by moving the assignment inside `doWire()` where `appState` is genuinely available. 6 real
  vanilla-to-vanilla direct imports fixed across `friends-presence.js`, `drawing-connections.js`,
  `search-orchestration-selection.js` (`bumpAchievementStat`), `hamburger-collab.js`
  (`closeProfilePanel`/`openPricingOverlay`), and `app-init.js`/`mnemonic-search-matching.js`
  (`refreshDotbotUsage`/`openDotbotUpgradeModal`) — 3 brand-new bridges added
  (`__refreshDotbotUsage`/`__closeProfilePanel`/`__openDotbotUpgradeModal`) since these 5 functions
  had never needed one before (always reached via a same-file-tree import until now).
  `closePricingOverlay`'s own old plain-global re-export (`window-bridge.js`) turned out to be
  genuinely dead — grepped for a real caller anywhere (inline HTML, any component) and found none
  (`PricingOverlay.jsx` closes itself directly via `pricingOverlayStore.set(false)`; the only real
  caller of `closePricingOverlay` at all is `historyAutosave.ts`'s Escape handler, via the
  `__`-prefixed bridge) — not carried forward, same "genuinely dead, don't perpetuate" precedent
  `cardsMisc.ts`'s port already set with `commitItemDetailDesc`. `window-bridge.js`'s own import
  line and 17 re-export lines removed — it now imports from 5 files instead of 6. Real Playwright
  verification against both a dev server and a real production server: bridge-existence/type
  checks for all 15 bridges this port touches, including the 2 true constants checked for their
  real values (`__ACHIEVEMENTS.length === 7`, `__SPRITE_TOTAL_COUNT === 108`), not just presence;
  a real click on the Profile rail icon opening `#profile-panel`, proving
  `wireProfileAchievementsPricing()`'s own poll-and-wire actually ran on a fresh page load; the
  real level pill (`ProfileLevelPill.jsx`) and all 108 real achievement-grid sprite cells
  (`AchievementsGrid.jsx`) rendered correctly from this port's own wire-time
  `renderProfileLevel()`/`renderSpriteGrid()` calls; a real `refreshDotbotUsage()` Supabase read
  against the signed-in test account populating the usage-bar tooltips with real data; real
  `showProfileSettingsView`/`showProfileMainView` clicks (inline onclick targets) correctly
  toggling the two sub-views; a real `openDotbotUpgradeModal()`/`closeDotbotUpgradeModal()` round
  trip (bridge call + the real "Got it" button's inline onclick target); a real
  `closeProfilePanel()`/`openPricingOverlay()`/`closePricingOverlay()` round trip, including the
  real inline `onclick="openPricingOverlay()"` upgrade-hint click; a real `renderAvatarInto()`
  img-with-fallback round trip (a real broken-image error event correctly swapping to initials
  text). One real Playwright quirk hit and worked around, not just accepted: `#btn-profile` sits at
  the exact bottom-left screen position Next.js's own dev-mode floating indicator badge
  (`<nextjs-portal>`) occupies, so a coordinate-based mouse click (even with `force: true`) lands
  on the overlay instead of the button — switched to an in-page `element.click()` call, which
  bypasses coordinate-based hit-testing while still exercising the exact same real DOM `click`
  listener `wireRailIcon` attaches (confirmed identical behavior against a real production build,
  which has no such overlay). Regression-verified `verify-phase4-5-corestate-port.js`,
  `verify-phase4-5-panelshamburger-port.js`, and `verify-phase4-5-srsconnectionscore-port.js` all
  clean afterward (the three ports this file's own rail-icon wiring and appState reads sit
  closest to). Zero console/page errors in either mode. `awardUserPoints`/`bumpAchievementStat`
  deliberately NOT exercised with new real RPC calls in this port's own verify script (bridge
  existence/type checked only) — unlike every other Supabase call this migration's scripts
  routinely make for real against nonexistent mock ids, these two mutate the *real* signed-in test
  account's own score/achievement row with no safe fake-id equivalent available, and
  `gamesFlashcardTyperight.ts`'s own verify script already exercises `__awardUserPoints` for real
  via `fcFlip`/`trCheck` — a documented scope decision, not an oversight.
  `card-shortcuts.js` (154 lines) done fourth — the last of the 4 immediately-portable
  `window-bridge.js`-owning files this batch targeted — to `app/dotto/lib/cardShortcuts.ts`: global
  Option-held tracking, the multi-select delete action, hover-scoped game-card/PDF-page-turn
  keyboard shortcuts, and `setTableAlign`. Unlike `cardsMisc.ts`/`libraryPublish.ts` (pure
  functions, no module-load-time side effects) but also unlike
  `profileAchievementsPricing.ts` (needed an external `__wireRailIcon` bridge too), this file's
  real risk was 3 always-on global `document`/`window` listeners (Option-held tracking ×3,
  hover-scoped game shortcuts, PDF arrow-key routing) that all close over live `appState`/bridge
  reads — needed a real `wireCardShortcuts()`, but a single `window.__getAppState` readiness check
  (not a poll for multiple bridges) was enough, matching
  `app/dotto/lib/sourceButtonsCursorMode.ts`'s own established shape rather than
  `profileAchievementsPricing.ts`'s heavier one — no rail icon or DOM writes to defer past mount
  here. `setTableAlign` needed a brand-new ambient type (never declared before this port needed
  it); 2 stale "current-tense" comment references caught and fixed where cardShortcuts.ts genuinely
  no longer owns behavior a comment implied it did (`vanillaBridges.d.ts`'s own
  `__applyCanvasItemWrapperAttrs`/`__attachUniversalItemBehavior` "vanilla -> React, all reach
  these" list, same stale-list pattern `cardsMisc.ts`'s port already caught once). One real
  documentation bug caught and fixed while writing this port, not just copied forward: the original
  vanilla file's own `deleteSelectedCards` comment said "see the Backspace keydown handler" without
  saying where — grepping for the real Backspace-to-delete callers found they live in
  `app/dotto/lib/copyPaste.ts` and `app/dotto/lib/sourceButtonsCursorMode.ts` (via the
  `__deleteSelectedCards` bridge), not in this file at all — the vague pointer got made precise
  rather than carried forward unclear. `window-bridge.js`'s own import line and 1 re-export line
  removed — it now imports from 4 files instead of 5, the exact 4-file circular cluster
  (`ai-assistant-suggestions.js`/`hamburger-collab.js`/`friends-presence.js`/
  `source-tags-ai.js`) this batch always expected to remain once the 4 immediately-portable files
  were done. Real Playwright verification against both a dev server and a real production server:
  real Alt keydown/keyup/window-blur events correctly toggling `body.option-held` (including the
  stuck-on-alt-tab guard); a real `__deleteSelectedCards()` call removing a plain multi-selection
  with no `confirm()` prompt, and a separate real call with a source-kind item correctly triggering
  the irrecoverable-data `confirm()` gate (dismissing it correctly left the item in place — real
  dialog interception via Playwright's own `page.on('dialog', ...)`, not stubbed); a real
  `setTableAlign()` call against the live `#context-menu` DOM element correctly setting
  `it.textAlign` and closing the menu; a real mouse-hover (via `page.mouse.move` to the item's
  actual on-screen position, not a CSS class hack) plus a real Space keypress correctly routing
  through `hoveredGameCard()` to `fcFlip()`, then a real "4" keypress correctly routing to
  `fcRate('easy')`; a real hover plus ArrowRight keypress on a minimal mocked PDF-card DOM
  (`.item.media` + two real `.pdf-viewer-nav-btn` buttons, `window.__findItemById`/`__parseItemId`
  narrowly stubbed only for that one mock id) correctly routing to the real next-page button's own
  `.click()`. Two real bugs caught and fixed in this port's own verify script before it was
  considered done, not worked around: (1) an initial mock table item used `rows` instead of the
  real `tableData` field `TableCard.jsx`/`sourceTable.ts` actually expect, which crashed the whole
  React tree with a real `TypeError` (caught via the dev server's own error log, not silently
  swallowed) and left every later assertion failing for an unrelated reason — fixed to use the
  correct field name; (2) rating a freshly-created, unconnected mock flashcard collapsed
  `fcStats` back to empty immediately, because `srs-connections-core.js`'s real "orphaned-SRS
  integrity sweep" (`propagateCanvasStreams`) runs on every `render()` and legitimately resets any
  flashcard whose `card.srs` looks real but isn't fed by an actual connection — the exact mechanism
  `verify-phase4-4-gamesflashcardtyperight-port.js`'s own script already documented and worked
  around (stub `window.__render` to a no-op for the one keypress being tested, check state, then
  restore and re-trigger); applied the identical technique here. Regression-verified
  `verify-phase4-5-corestate-port.js`, `verify-phase4-4-gamesflashcardtyperight-port.js`, and
  `verify-phase4-4-copypaste-port.js` all clean afterward (the last two for
  `hoveredGameCard`/`fcFlip`/`fcRate` and the `__deleteSelectedCards` bridge this port's own
  routing sits directly on top of). Zero console/page errors across every script in both modes.
  **This closes out all 4 of the immediately-portable `window-bridge.js`-owning files.** Only the
  4-file circular cluster (`ai-assistant-suggestions.js`, `hamburger-collab.js`,
  `friends-presence.js`, `source-tags-ai.js`) remains before `window-bridge.js` itself can be
  deleted — no concrete plan yet devised for how to sequence or bundle that group, since each
  imports from at least one of the others; Phase 4.5's own final open question (whether any paused
  Phase 4.1 files are now unblocked) still depends on that cluster landing first.
  `ai-assistant-suggestions.js`/`hamburger-collab.js`/`mnemonic-search-matching.js` (881 + 593 + 864
  = 2,338 lines) done together next, as one coordinated PR — the largest single port of this whole
  migration, and the first genuinely circular group: `ai-assistant-suggestions.js` ↔
  `hamburger-collab.js` (mutual), `ai-assistant-suggestions.js` ↔ `mnemonic-search-matching.js`
  (mutual), `hamburger-collab.js` → `mnemonic-search-matching.js` (one-way). Ported to
  `app/dotto/lib/aiAssistantSuggestions.ts`/`app/dotto/lib/hamburgerCollab.ts`/
  `app/dotto/lib/mnemonicSearchMatching.ts` with real ES imports between all three — TypeScript
  modules in the same directory tolerate circular imports fine (matching the pre-existing
  `live-presence.js`/`shelf-search.js` circular import this migration already carried over
  unchanged), which is what actually dissolves the "genuinely circular" problem: it only existed
  as an ordering constraint in the vanilla world, not a real architectural one. Before writing any
  code, built a complete caller map across the whole repo (every real import, every bridge, every
  inline-HTML target) for all 3 files' full export surfaces — given the scale, this was worth doing
  as its own upfront pass rather than discovering gaps mid-port. `aiAssistantSuggestions.ts` owns
  the AI search box (animated placeholder, live-suggestions, list/chat views), the shared
  typewriter-reveal/height-transition machinery, and `countSourceEntries`/`findParentFolderId`/
  `isLatinScriptText` (`escapeHtml`/`stripHtml` did NOT move here — see `text-utils.js` below).
  `hamburgerCollab.ts` owns the Collaborations panel, the Chats/Waypoints/Sources/Files list
  panels' data-fetching and row actions, shared list-panel selection + Backspace-delete dispatch,
  and `hmenuAction`. `mnemonicSearchMatching.ts` owns the mnemonic story/image generation flow, the
  Dotbot dictionary/examples/translation/answer-blocks panel builders, TTS playback, and the
  fresh-turn sequenced reveal. A real, separate architectural decision made along the way:
  `text-utils.js` (the Phase 4.2 extraction holding `escapeHtml`/`stripHtml`) stayed vanilla rather
  than porting alongside this trio — 3 real vanilla files (`search-panel-history.js`,
  `search-orchestration-selection.js`, `source-tags-ai.js`) still import it directly, and it now
  sets its own `window.__escapeHtml`/`__stripHtml` bridges directly (genuinely pure/zero-import,
  same convention `srs-algorithm.js` already established) rather than being re-exported through
  `aiAssistantSuggestions.ts` as it used to be. 3 brand-new bridges added for functions that had
  never needed one before (`__updateCommandPalette` on `command-palette.js`,
  `__commenceDotbotSearch` on `search-orchestration-selection.js`,
  `__activePaneCollabBubbleEl` on `friends-presence.js`) — one of these
  (`__commenceDotbotSearch`) was initially only half-added (the ambient type and the caller-side
  `window.__commenceDotbotSearch?.()` call were written, but the actual
  `window.__commenceDotbotSearch = commenceDotbotSearch;` assignment on the owning file was
  missed) — caught by the port's own verify script failing its very first bridge-existence check,
  fixed before the port was considered done. 5 more real vanilla-to-vanilla callers fixed
  (`friends-presence.js`'s `clearSearch` import, `search-orchestration-selection.js`'s 8-function
  import spanning both `escapeHtml`/`stripHtml` — retargeted to `text-utils.js` directly — and 6
  bridge-only names, `search-panel-history.js`'s and `source-tags-ai.js`'s `escapeHtml`/`stripHtml`
  imports — both retargeted to `text-utils.js` directly). `window-bridge.js`'s own import lines for
  both ported files and their combined 4 re-export lines removed — it now imports from only 2
  files (`friends-presence.js`, `source-tags-ai.js`), down from the original 8-file
  `window-bridge.js` dependency list this sub-effort started from. 12 same-tree `app/dotto/*.jsx`
  callers upgraded to real imports (`ChatThread.jsx`, `DictionaryPanel.jsx`, `DotbotAnswerPanel.jsx`,
  `ExamplesPanel.jsx`, `ImageResultPanel.jsx`, `RecommendedSearchesPanel.jsx`,
  `SearchSuggestionsPanel.jsx`, `TranslationPanel.jsx`, `SourceCard.jsx`, `WaypointsListPanel.jsx`,
  `ChatsListPanel.jsx`, `HubCollabListPanel.jsx`) — several bridges dropped entirely once their only
  consumer was one of these (`__buildLiveSuggestionsRows`, `__updateChatThread`'s *jsx* consumer
  specifically — the bridge itself was kept for a still-vanilla caller found later, see below —
  `__openSavedChat`, `__openHubCollabRequestsView`, `__backToHubCollabMain`,
  `__handleOwnedHubCollabRowClick`, `__respondToHubCollabRequest`, and all 15 of
  `mnemonicSearchMatching.ts`'s panel-builder bridges except `__buildMnemonicErrorEl`, kept dual
  for `search-orchestration-selection.js`'s own real caller); others stayed genuinely dual
  (`__countSourceEntries` for `messagingCanvasPreview.ts`, `__goToWaypointCard` for
  `srsConnectionsCore.ts`). One real gap caught only AFTER the first bridge-dropping pass: while
  fixing `search-orchestration-selection.js`'s own real call sites, discovered it independently
  needs `updateChatThread`/`scrollChatThreadToBottom`/`updateSearchDropdown`/`showAiChatView` too —
  all 4 had to be added (back, for the first two) as bridges rather than staying jsx-only, since an
  earlier caller-mapping pass (correctly, at the time) found no `__`-prefixed callers for them
  simply because this file reached them via a *plain* vanilla-to-vanilla import back then, not a
  bridge — the exact kind of gap only surfacing once each real caller is actually fixed one at a
  time, not just mapped in the abstract. Two provably-wrong pre-existing ambient types caught and
  fixed along the way, both around waypoint ids that are real numbers, not strings, everywhere else
  in the codebase: `__goToWaypointCard`'s `itemId` param and `__dispatchListPanelDelete`'s `ids`
  array — the latter also required fixing `sourceButtonsCursorMode.ts`'s own
  `listPanelSelection.ids: Set<number>` field type to `Set<string>` (it's really the OTHER kind of
  id — `"owned:folderId"`/`"shared:collabRowId"`-prefixed composite strings, confirmed against
  `deleteSelectedCollabs`'s and `waypointRowKey`'s own real construction of these values). Real
  Playwright verification against both a dev server and a real production server, via a new script
  covering the parts genuinely new to this port rather than re-testing unchanged AI/business logic:
  all 30 bridges checked for real presence; a real click on the Queries/AI rail icon opening
  `#ai-panel` and landing on the list view, proving `wireAiAssistantSuggestions()`'s own
  module-load-time animated-placeholder loop and the rail-icon wiring both actually ran; the
  animated placeholder observed changing over a real 1.2s window; a real keystroke into
  `#search-input` triggering a real `/api/dotbot/suggest` round trip and populating live
  suggestions; a real `commenceSearchOrMnemonic` → `commenceDotbotSearch` call completing a real
  `/api/dotbot/orchestrate` round trip end-to-end across the cross-file boundary (the real AI
  provider call itself failed with a genuine `502` in this sandboxed environment — confirmed via
  the dev server's own log as a real Groq network-access restriction, not a code defect — and the
  real error-rendering path correctly handled it, which is what this check actually verifies); real
  rail-icon clicks opening the Waypoints/Sources/Files/Collaborations panels, each confirmed to
  have actually run its own real data-fetch (`renderWaypointsList`/`renderSourcesList`/
  `renderFilesList`/`renderHubCollabList` + a real `refreshCanvasCollabData` Supabase round trip for
  the last one); a real `#sources-panel-search` keystroke filtering to the empty state via
  `renderSourcesList`; a real `hmenuAction('upgrade')` call opening `#pricing-overlay`; a real
  `__flashCanvasElement()` call adding the flash class, exercising the cross-file
  `hamburgerCollab.ts` → `mnemonicSearchMatching.ts` import directly; real
  `escapeHtml`/`stripHtml`/`countSourceEntries`/`findParentFolderId` bridge calls all checked
  against real expected output; a real Escape keypress correctly closing `#ai-panel` through
  `historyAutosave.ts`'s existing global handler → `__clearSearch` → `closeRailView` →
  `resetAiSearchState`. Regression-verified `verify-phase4-5-corestate-port.js`,
  `verify-phase4-5-panelshamburger-port.js`, `verify-phase4-5-profileachievementspricing-port.js`,
  `verify-phase4-5-srsconnectionscore-port.js`, `verify-phase4-5-historyautosave-port.js`, and
  `verify-phase4-5-cardshortcuts-port.js` — 6 scripts, the widest regression batch this migration
  has run for one port — all clean afterward. Zero console/page errors across every script in both
  modes (beyond the one confirmed-external, deliberately-whitelisted `502`).
  **This closes out the ai/hamburger/mnemonic circular cluster.** Of the original 8
  `window-bridge.js`-owning files, only `friends-presence.js` and `source-tags-ai.js` remain — down
  from 8 at the start of this session's Phase 4.5 sub-effort — plus `messages-schedule.js` (30
  lines, never itself a `window-bridge.js` importer, but a real dependency of `friends-presence.js`)
  still to resolve before `window-bridge.js` itself can be deleted and this sub-effort of Phase 4.5
  closes out.
  `friends-presence.js` (605 lines) and `messages-schedule.js` (30 lines) done next, together —
  the last genuinely circular pair (`friends-presence.js` imports `openMessagesPanel` from
  `messages-schedule.js`; `messages-schedule.js` imports `renderMsgList` from
  `friends-presence.js`) — to `app/dotto/lib/friendsPresence.ts`/`app/dotto/lib/messagesSchedule.ts`,
  co-located as real ES modules the same way the ai/hamburger/mnemonic trio resolved its own
  circularity. `friendsPresence.ts` owns the per-canvas Collaborators bubble/panel (pane-keyed
  since split-screen Stage 8), canvas-collaboration invite/revoke Supabase RPCs, the Friends/
  Messages list data (friend requests, chat previews), and friend online/afk/logout presence
  tracking over Supabase Realtime; `messagesSchedule.ts` owns the thin Messages rail-view open/
  close/refresh wrappers around `panelsHamburger.ts`'s shared rail shell. 8 real bridges dropped in
  favor of real same-tree imports (`collabBubblePaneClick`/`collabBubblePaneMouseEnter`/
  `collabBubblePaneMouseLeave` into `PaneTopBar.jsx`; `openMsgRequestsView`/`backToMsgMain`/
  `handleAddFriendClick`/`respondToMsgRequest` into `MessagesListPanel.jsx`;
  `handleCollabAddRemoveClick` into `CollabListPanel.jsx`) — the largest single batch of
  bridge-to-import upgrades this migration has done in one port. 2 new outbound bridges added for
  still-vanilla dependents (`__refreshFriendsData`/`__resolveUsernameToUserId`, both used by
  `app-init.js`'s bootstrap and `command-verbs.js`'s `invite`/`remove` slash-command verbs
  respectively); `window-bridge.js`'s own dead `window.openCollabPanel` plain-global re-export
  dropped (confirmed via a repo-wide grep — no real inline `onclick` target left for it, only its
  `__`-prefixed bridge is still used) rather than carried forward. `window-bridge.js` now imports
  from only `source-tags-ai.js` — the last of the original 8.
  Two real, pre-existing product-level gaps found and documented (not fixed, out of scope for a
  migration port) while writing this port's own real two-account verify script: (1) the
  `invite_canvas_collaborator` RPC — called with the exact params its own migration
  (`supabase/migrations/20260808_fix_canvas_collab_reinvite.sql`) defines, unchanged from the
  original vanilla — returns a PostgREST `PGRST202` "function not found" against the live Supabase
  project this dev server points at (its own error hint even hints at the differently-named
  `revoke_canvas_collaboration`, which does exist), meaning either that one migration was never
  applied to this project or its PostgREST schema cache is stale; (2) `handleFriendPresenceSync`
  (also unchanged from the original) reads `metas[0].status` off a friend's Realtime Presence
  state, but re-calling `channel.track()` on an already-tracked presence channel was confirmed,
  via direct repro against a freshly created account pair, to append a SECOND meta under the same
  key rather than replacing the first — so a friend's online→afk transition is invisible to
  `metas[0]` even though the local `track()` call itself fires correctly; the resulting cross-
  account "X is away" notification never arrives, even though `resetAfkTimer`/
  `setLocalPresenceStatus` themselves are proven correct (verified directly: `localPresenceStatus`
  flips and `channel.track({status:'afk'})` visibly adds the new meta on the peer's own copy of the
  channel). Both confirmed unrelated to this port and out of scope to fix here. Real Playwright
  verification against both a dev server and a real production server, using two real accounts
  (the shared primary test account plus a second one created just for this script via a new
  `setup-test-account2.js`) driven through the actual friend-request → accept → per-canvas-
  collaborate → chat → presence flow, not mocked appState data — the first Phase 4.5 verify script
  this migration has needed two real browser contexts/accounts for: a real friend-request search +
  Add-button send, a real incoming-request notification + Accept flow (confirmed the "haven't
  heard from this channel yet" vs. "seen already" baseline distinction in `refreshFriendsData`
  actually works, by establishing account2's baseline before account1's request existed); a real
  per-canvas Collaborators bubble hover/click/invite (including real-hovering the parent
  `.pane-breadcrumb-pill` first, since `.pane-collab-bubble` is `max-width:0`/`opacity:0` until
  hovered, and navigating into a real non-root folder first, since the bubble correctly no-ops on
  `root`); `__closeMessagesPanel()` correctly closing both the rail panel and an open conversation
  together; a real chat message insert correctly routing to a "not actively viewing" push
  notification on the receiving account; a real presence disconnect/reconnect correctly firing
  "logged off"/"is online" notifications; the AFK local-state verification described above.
  Regression-verified `verify-phase4-5-ai-hamburger-mnemonic-port.js`,
  `verify-phase4-5-panelshamburger-port.js`, `verify-phase4-5-profileachievementspricing-port.js`,
  and `verify-phase4-5-livepresence-port.js` all clean afterward. Zero console/page errors across
  every script in both modes, beyond the two confirmed-external/pre-existing gaps above, both
  deliberately whitelisted with a documented reason.
  **This resolves the last genuinely circular pair.** Of the original 8 `window-bridge.js`-owning
  files, only `source-tags-ai.js` remains.
  `source-tags-ai.js` (309 lines) done last, closing out the original 8-file `window-bridge.js`
  dependency list entirely — to `app/dotto/lib/sourceTagsAi.ts`: Dotbot-generated source content
  (`applyAiAddRowsToSource`/`createSourceFromAI`, driven by the "sourceAction" panel in
  `app/api/dotbot/orchestrate/route.js`) and the Source page's row-tag system (tag definitions,
  per-row tag assignment, the row tag picker popover, its rename/delete context menu). 4 real
  bridges dropped in favor of real same-tree imports into `app/dotto/CellTagPickerList.jsx`
  (`commitTagRename`/`handleTagRenameKeydown`/`openTagContextMenu`/`toggleCellTag`) — the largest
  share of a single file's own bridges upgraded to imports this port has done relative to its total
  export surface. 2 new outbound bridges (`__applyAiAddRowsToSource`/`__createSourceFromAI`) for
  `search-orchestration-selection.js` (still vanilla), which used to import both directly.
  **Because this was the last of the 8, `window-bridge.js` itself emptied out entirely as a side
  effect — deleted outright** (its own header comment's REMOVED-log gets no further entries; the
  file simply no longer exists), along with its now-dead import in `dotto-script.js`. This closes
  out the 5th of the original 7 Phase 4.5 sub-items (`panels-hamburger.js`/`live-presence.js`/
  `history-autosave.js`/`srs-connections-core.js` remainder/`window-bridge.js`/
  `waypoints-render-loop.js`/`core-state.js` — the last two already done earlier this session, see
  their own status entries above) — **all 7 of Phase 4.5's original architectural/hub files are now
  done.** Full repo-wide stale-filename sweep via the established `python3` walk-and-string-search
  technique for both `source-tags-ai.js` and `window-bridge.js` — fixed current-tense pointers
  across `app/dotto-app.jsx`, `app/dotto/canvasItemBehavior.js`, `app/dotto/bridges.js`,
  `app/dotto/PricingOverlay.jsx`, `app/dotto/lib/waypointsRenderLoop.ts`,
  `app/dotto/lib/profileAchievementsPricing.ts`, `app/dotto/lib/notificationsStore.ts`,
  `app/dotto/lib/shelfSearch.ts`, `app/dotto/lib/dayChangeAndAdNotifications.ts`,
  `app/dotto/lib/outlineTree.ts`, `app/dotto/lib/sourceTable.ts`, `app/dotto/lib/vanillaBridges.d.ts`,
  `public/dotto/search-orchestration-selection.js`, `public/dotto/text-utils.js`,
  `public/dotto/add-menu.js`, `public/dotto/drawing-connections.js` — left the many genuinely
  historical/"all previously imported"/"formerly re-exported through window-bridge.js's own
  centralized inline-handler list" mentions alone across a dozen more files, matching established
  convention; `INLINE_HANDLER_CHECKLIST.md`/`CONTRIBUTING.md`'s own `window-bridge.js` mentions
  deliberately left untouched too — their rewrite is explicitly scoped to Phase 4.6, not this port,
  even though the file they describe is already gone ahead of that schedule.
  `node --check` on the 6 touched vanilla files (`dotto-script.js`, `search-orchestration-
  selection.js`, `text-utils.js`, `add-menu.js`, `drawing-connections.js`, plus `window-bridge.js`
  and `source-tags-ai.js` themselves deleted), `eslint` clean, `npm run typecheck` clean (after
  adding ambient types for the 2 new outbound bridges, 3 new `__openRowTagPicker`/`__tagPillsHTML`/
  `__setCellTagPickerList` bridges, and 6 plain-global inline-HTML targets — none of these had ever
  been typed before, since `source-tags-ai.js`'s own callers were all still vanilla until now),
  `npm run format:check` clean after a `prettier --write` pass run as the actual last step before
  committing, `rm -rf .next && npm run build` clean, all 32 Vitest tests still green. Real Playwright
  verification against both a dev server and a real production server — genuinely new coverage
  territory: no prior verify script in this migration had ever exercised the Source page's row-tag
  system (a vanilla-only feature, `folderObj.isSource`'s own render branch in
  `app/dotto/lib/waypointsRenderLoop.ts`, never a plain on-canvas Table card) at all. Real
  `isSource`-folder navigation (`window.__applyFolderView`) rendering the actual static table DOM;
  a real mouse hover over a real `td[data-r][data-c]` cell revealing the real `.row-tag-strip`
  button (`canvasItemBehavior.js`'s own continuous hover-zone logic, unchanged, exercised
  end-to-end as this port's real entry point) and a real click correctly opening the picker via
  `openRowTagPicker`; a real tag created through the picker's static new-tag `<input>` (Enter to
  submit) correctly assigned to the row and its chip rendered in the real table DOM; a real click
  on `app/dotto/CellTagPickerList.jsx`'s own row (now a real ES import of `toggleCellTag`)
  correctly toggling the tag off and clearing its chip; a real right-click → Rename → real
  `<input>` → Enter → blur round trip (exercising `openTagContextMenu`/`handleTagRenameKeydown`/
  `commitTagRename`, all real ES imports now) correctly renaming the tag and refreshing its chip; a
  real Delete via the context menu correctly removing the tag and cleaning up the now-dangling
  `cellTags` reference; a real Escape from the new-tag input correctly closing the picker via
  `closeCellTagPicker`; `createSourceFromAI`/`applyAiAddRowsToSource` called via their new bridges
  with real appState mutation checks (a new source card with the right title/seeded columns/rows;
  a real row appended to an already-attached source via a mocked `searchCardContext` entry); a real
  file-picker round trip (`triggerSourceUpload` → a real Playwright `filechooser` event → a real
  CSV file → `importDelimitedIntoSource`, `sourceTable.ts`'s own already-tested logic) correctly
  importing a new row end-to-end. Regression-verified `verify-phase4-4-sourcetable-port.js` and
  `verify-phase4-5-ai-hamburger-mnemonic-port.js` (the latter exercising
  `search-orchestration-selection.js`'s own real `commenceSearchOrMnemonic`/`commenceDotbotSearch`
  path this port's edit touched) both clean afterward, in both modes. Zero console/page errors
  across every script in both modes.
  **This closes out the original 8-file `window-bridge.js` dependency list, deletes
  `window-bridge.js` itself, and completes Phase 4.5 (architectural/hub files) in full — all 7 of
  its original sub-items are now done.**
- **Phase 4.6 — delete the bridge layer: not started.**
- **Phase 4.7 — final cleanup & professionalization close-out: not started.**

## Why this phase exists

Phases 1-3 (see `PHASE2_ROADMAP.md`, archived once this phase completes) deliberately left a
hybrid architecture in place: `public/dotto/*.js` (43 vanilla ES modules, ~16,200 lines) bridged to
`app/dotto/*.jsx` (63 React components, ~4,800 lines) via a hand-rolled `window.__*` global-bridge
convention (`app/dotto/bridges.js`'s `createStore()`). `CONTRIBUTING.md` always described this as
an intentional migration scaffold, with full consolidation planned as a future dedicated
initiative — not indefinitely deferred.

That initiative is this phase, driven by two goals: (1) bring the codebase to a standard a new
human dev team could pick up cold — real tests, real CI, real docs, no bridge-layer scaffolding —
and (2) leave behind a stable, versioned internal API surface as the prerequisite for a **future,
separate** plugin/custom-block system (tracked in Claude's own project memory as
`project-plugin-block-architecture`, not part of this codebase). This phase does **not** design or
build that plugin/block SDK — it only gets the codebase ready for that work to start.

**Feature freeze for the duration**: no new product features land until Phase 4.7 closes out. Any
genuinely urgent bugfix is its own tiny out-of-band PR, never folded into a migration batch. Every
phase below leaves the app fully working and shippable at every commit boundary — no phase is
"merge now, fix later."

## Decisions locked in

- **State management: Zustand**, replacing `createStore()`. Nearly identical mental model
  (`subscribe`/`getState`/`setState` vs. today's `subscribe`/`getSnapshot`/`set`), adds selector
  support, colocates state+actions (lets mutation logic actually move out of vanilla files, not
  just relocate), usable outside React (`store.getState()`/`setState()`) which matters while
  vanilla files still coexist mid-migration. Organized as many small domain-scoped stores
  (`useCanvasViewStore`, `useHistoryStore`, `useFoldersStore`, `usePaneStore`, etc.), continuing
  `bridges.js`'s existing per-concern organization rather than one mega-store.
- **TypeScript: adopted incrementally, not big-bang.** `tsconfig.json` (`allowJs: true`,
  `checkJs: false` initially) replaces `jsconfig.json`. Every file touched by this migration from
  Phase 4.1 onward is written `.ts`/`.tsx` from the start; untouched files stay as they are until
  the phase that touches them. Phase 4.7 does a final sweep (convert stragglers, `checkJs` on, then
  a strict subset — `strictNullChecks` + `noImplicitAny` minimum — enforced in CI).
  `supabase gen types typescript` generates `lib/supabase/database.types.ts` from the existing
  migrations — real query types and living schema documentation in one step.
- **Testing: Vitest + React Testing Library (unit/component) + `@playwright/test` (e2e), with a
  dedicated Supabase test project wired into CI from Phase 4.0.** Playwright is already a
  devDependency (used only as a raw automation library today via gitignored ad-hoc scripts in
  `.claude-testing/`). Each existing one-off script converts into a real asserting spec under
  `e2e/*.spec.ts` as part of whichever later phase covers that subsystem. `QA_CHECKLIST.md` gets
  trimmed continuously as e2e coverage lands per line; final disposition decided in Phase 4.7.
- **Docs**: this file is the live tracker. `ARCHITECTURE.md`, `.env.example` (done, see below),
  `lib/supabase/database.types.ts` get added. `PHASE2_ROADMAP.md` archives to `docs/archive/` once
  this phase closes. `INLINE_HANDLER_CHECKLIST.md` deletes once `window-bridge.js` is gone (4.6).
  `CONTRIBUTING.md`/`README.md` architecture sections rewritten as the closing task of 4.6.
- Prettier + `eslint-config-prettier` added for consistent formatting (Phase 4.0).

## Phase 4.0 checklist

- [x] `.env.example` added (the 5 known vars, each commented with where it's consumed).
- [x] `next.config.mjs`: pinned `turbopack.root` — fixes the stray-lockfile "multiple lockfiles"
      Turbopack warning without touching anything outside the repo. Verified: warning confirmed
      gone from a real `npm run build` output.
- [x] This file created.
- [x] New devDependencies installed: `typescript`, `@types/react`, `@types/node`,
      `@types/react-dom`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
      `@playwright/test`, `prettier`, `eslint-config-prettier`. `npm audit fix` (non-forcing)
      applied for `brace-expansion`/`js-yaml`; 3 remaining high-severity advisories
      (`next`/`postcss`/`sharp`) need `--force` breaking upgrades — deliberately NOT applied here,
      flagged as its own future decision, not bundled into tooling setup.
- [x] `tsconfig.json` added (`jsconfig.json` removed) — Next's own build step auto-corrected
      `jsx` to `react-jsx` and added a `.next/dev/types` include on first run; `next-env.d.ts`
      generated, already gitignored. `allowJs: true`/`checkJs: false`/`strict: false` as planned.
- [x] Vitest + RTL installed & configured (`vitest.config.mts` — `.mts` not `.ts`, avoids a
      CJS/ESM config-loader warning; jsdom environment; `passWithNoTests: true` since Phase 4.2
      hasn't landed real extracted-logic tests yet). First real test written and passing:
      `app/dotto/bridges.test.ts` (2 tests, exercises the actual `createStore()` contract every
      store in `bridges.js` relies on — zero prior coverage — not a throwaway placeholder).
- [x] `@playwright/test` configured (`playwright.config.ts`, `webServer` auto-boots `next dev`,
      `channel: "chrome"` matching `.claude-testing/open-app.js`'s existing convention). First real
      spec written and passing: `e2e/smoke.spec.ts` (login page renders; unauthenticated `/`
      redirects to `/login`) — deliberately login-free since the dedicated test Supabase project
      doesn't exist yet. `e2e/global-setup.ts` written and ready (mirrors `open-app.js`'s login
      flow, reads `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` from env instead of a committed credentials
      file) but **not yet wired into `playwright.config.ts`** — activate once the test project +
      credentials exist (see open items below; exact activation steps are commented directly in
      `playwright.config.ts`).
- [x] Prettier + `eslint-config-prettier` added. Scope decisions made while wiring this up (see
      `.prettierignore`'s own comments): excludes `public/dotto` + `public/dotto-script.js`
      (vanilla surface being replaced by this very migration — reformatting it now would just be
      thrown away), `public/vendor` (third-party minified libraries, never our code),
      `content/dotto-markup.html`/`content/dotto-original.css` (historical diff-reference
      artifacts whose exact original formatting IS the point), and **all `*.md` files** — tested
      Prettier's markdown formatter against `CONTRIBUTING.md` and found it re-indents multi-line
      list-item continuations in a way that risks changing how the doc renders, not just its
      source formatting (reverted that change; excluded markdown entirely rather than accept that
      risk for prose docs). Ran a real one-time `prettier --write` pass across `app/` (67 files)
      and `lib/`/`proxy.js`/`tsconfig.json` (9 files) — purely mechanical whitespace/quote
      changes, verified via lint + typecheck + `npm test` + a full production build + a real
      headless-browser smoke test (canvas/rail render, pushed a real notification end-to-end) all
      passing clean afterward. `format:check` is clean repo-wide as of this pass.
- [x] `package.json` scripts added: `test`, `test:watch`, `test:e2e`, `typecheck`, `format`,
      `format:check`.
- [x] CI (`.github/workflows/ci.yml`): added `typecheck`, `format:check`, `test`, and `test:e2e`
      (with a `playwright install --with-deps chrome` step first) to the existing lint+build job.
      `test:e2e` currently only runs the unauthenticated `smoke.spec.ts` against the same
      placeholder Supabase env values `build` already used — confirmed this actually works (login
      page + unauthenticated-redirect don't need real Supabase reachability) by running it
      manually against a dev server booted with placeholder values before wiring it in.
- [x] Dedicated Supabase test project provisioned (`dotto-test`, ref `oiydwkzhecsfnnaunrib`,
      separate org-member project from production `Dotto Beta`/`pudvgdpinbqmgqpfkkhj`). Linked and
      pushed to via the Supabase CLI (now a real `devDependency`, `npm run supabase -- <command>`)
      authenticated with a personal access token (`SUPABASE_ACCESS_TOKEN` in `.env.local`, never
      committed).
- [x] **Found and fixed a real, pre-existing gap while provisioning it**: `supabase/migrations/`
      only went back to `20260724_add_leveling_system.sql` — a genuine `supabase db push` against
      an empty database failed immediately (`relation "public.profiles" does not exist`), proving
      7 tables (`profiles`, `workspaces`, `friendships`, `messages`, `marketplace_listings`,
      `library_items`, `demo_sessions`) plus several functions/storage buckets predated migration
      tracking entirely and were never captured. Root-caused via Supabase's Management API
      (no Docker/`pg_dump` access in this environment): production's OWN
      `supabase_migrations.schema_migrations` table, unrelated to this repo's `migrations/`
      folder, still held the real original 17 migrations (`20260721144946_create_profiles_table`
      through `20260724150404_make_fallback_username_collision_safe`) with their exact original
      SQL in a `statements` column — pulled those down verbatim as real, byte-accurate migration
      files (not a reconstruction) rather than guessing. Genuinely reconstructed only the two
      pieces with NO tracked history anywhere, production included — `demo_sessions` and the
      `demo-recordings` storage bucket — via careful `information_schema`/`pg_catalog`
      introspection (columns, constraints, indexes, RLS policies, triggers), in
      `20260829000000_add_demo_sessions.sql`, clearly commented as a reconstruction with today's
      date rather than a guessed historical one. Also found and fixed a real version collision
      (`20260819_add_dotbot_conversations.sql`/`20260819_fix_dotbot_turn_ordering.sql` shared the
      exact same date-only version prefix) by renaming the second to
      `20260819120000_fix_dotbot_turn_ordering.sql`. `supabase/migrations/` now has 33 files and is
      a genuinely complete, self-sufficient source of truth for the schema — verified by pushing
      the full set to the fresh test project and confirming its resulting schema (table list,
      `profiles`' exact 18-column shape, storage buckets) matches production exactly.
- [x] Test user created (`e2e-test@dotto.test`, pre-confirmed via the Auth Admin API) — confirmed
      `handle_new_user`'s signup trigger fired correctly and created a matching `profiles` row.
      Credentials stored in `.env.local` (`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`) and handed to the
      user to add as GitHub Actions repo secrets (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`,
      `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`) — the one step this environment genuinely can't do
      itself (no `gh` CLI available, and repo secrets are account-scoped).
- [x] `e2e/global-setup.ts` activated in `playwright.config.ts` — a new `"authenticated"` project
      (testDir `e2e/authenticated/`, `storageState` from the saved session) runs alongside the
      original unauthenticated `"chromium"` project (now `testIgnore`-scoped away from
      `authenticated/` so `smoke.spec.ts`'s own unauthenticated-redirect assertion can't be broken
      by a pre-loaded session). First real authenticated spec written and passing:
      `e2e/authenticated/canvas.spec.ts` (logs in for real against the test project, confirms the
      canvas — not the login page — loads). CI's `test:e2e` step now passes the 4 real secrets
      through as env vars instead of placeholders.
- [ ] Convert the REMAINING `.claude-testing/*.js` ad-hoc scripts (drag/resize/connections/
      outline/contentEditable/source-table/pill-hover) into real committed specs — deliberately
      NOT done all at once here; each lands alongside whichever Phase 4.1–4.5 batch actually ports
      that subsystem, per this file's own "Suggested migration order," rather than front-loaded
      into Phase 4.0.

### Remaining open item

The only thing left for the user: add the 4 GitHub Actions repo secrets
(`TEST_SUPABASE_URL`/`TEST_SUPABASE_ANON_KEY`/`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`, values already
in `.env.local`) so CI's `test:e2e` step goes green on the next push — everything else in Phase 4.0
is done and verified locally (lint, typecheck, format:check, unit tests, production build, and the
full e2e suite including the real authenticated project all pass).

## Subsystem inventory (vanilla surface, audited for this phase)

Legend: fan-in = number of other vanilla files importing from it. Bridges = `window.__*` defined /
consumed. Full per-file breakdown was produced during planning; summarized by category below.

**Architectural/hub (9 files, migrate last — Phase 4.5, whole-state-model changes not mechanical
ports)**: `core-state.js` (872 lines, fan-in 35 — the `appState` singleton), `live-presence.js`
(1510 lines, fan-in 22, 3 bundled concerns), `history-autosave.js` (742 lines, fan-in 22),
`waypoints-render-loop.js` (1225 lines, fan-in 19 — the global `render()` escape hatch),
`panels-hamburger.js` (170 lines, fan-in 16 — generic panel open/close contract),
`shared-canvases-outline.js` (983 lines, fan-in 10, 4 bundled concerns), `srs-connections-core.js`
(1338 lines, fan-in 11 — SM-2 algo + the universal `add()` function), `ai-assistant-suggestions.js`
(875 lines, fan-in 16 — chat UI + shared pure string utils used by 16 files), `window-bridge.js`
(140 lines, ~107 plain `window.foo=` assignments — a shrinking migration-progress metric, not
logic itself).

**DOM/event-heavy (21 files, genuine React port required — Phases 4.1/4.4)**: ranging from
`library-publish.js` (246 lines) and `mnemonic-search-matching.js` (864 lines, heaviest DOM density
but fan-in 4, self-contained) down to small leaf widgets (`theme-toggle.js`, `rail-tooltip-expand.js`,
`upload-popup.js`) with zero/near-zero fan-in.

**Pure logic (13 files, trivially portable — Phase 4.1 Batch A)**: `global-ids.js`, `card-kinds.js`,
`command-parser.js`, `command-target-lookup.js`, `command-verbs.js`, `cards-misc.js`,
`drag-drop-chat.js` (comment notes core drag mechanics already moved to `canvasItemBehavior.js`),
and others with zero/near-zero DOM touches.

## Suggested migration order

1. **Phase 4.1 — leaf-first.** **Real finding (corrects the original Batch A/B/C sketch below):**
   "fan-in 0–1" (no other FILE imports this one's exports) turned out to be necessary but not
   sufficient. A file is only safely portable RIGHT NOW if BOTH (a) nothing else vanilla imports
   its exports, AND (b) its OWN imports are either nonexistent, already-ported (`app/`), or reach
   a still-vanilla hub only via a live `appState` read through the existing
   `window.__getAppState()` bridge (fine — matches the established `canvasItemBehavior.js`
   pattern) rather than calling an actual still-vanilla FUNCTION (not fine — that function isn't
   reachable from `app/` without either porting it too or adding a new bridge, which defeats "no
   bridge needed"). Checking the original ~20-file candidate list against this stricter rule, most
   turned out to still depend on later-phase hub files (`core-state.js`, `live-presence.js`,
   `history-autosave.js`, `panels-hamburger.js`'s `wireRailIcon`, etc.) even though nothing else
   imports THEM — e.g. `extensions-panel.js` has zero importers of its own but itself calls
   `wireRailIcon` (`panels-hamburger.js`, Phase 4.5), so it can't move yet either. Real safe set so
   far: `rail-tooltip-expand.js` (only external dep was a single `appState.activeRailView` read,
   moved to `app/dotto/lib/railTooltipExpand.ts`), `sidebar-mode-toggle.js` (zero imports at all,
   moved to `app/dotto/lib/sidebarModeToggle.ts`) — both wired in via a `useEffect` in their
   respective shell component (`TopBar.jsx`/`HamburgerMenu.jsx`), same imperative-DOM-wiring
   pattern `canvasItemBehavior.js` already established, not the portal+store pattern (neither file
   renders new markup, both just attach behavior to existing static HTML).
   Third file, `dotbot-schedule-notifications.js` (2 generic app-lifetime timers: 3am day-change
   ping, one-time paid-tier ad nudge) — its 3 deps were `pushNotification`/`openPricingOverlay`
   (already reachable via existing plain `window.*` bridges, no new bridge needed) and `dateKey`
   (a genuinely blocking dependency — but `dateKey` turned out to be a 3-line pure helper with
   exactly one caller inside `messages-schedule.js`, a file that otherwise stays vanilla for now
   — so it was extracted on its own into `app/dotto/lib/dateKey.ts`, same "extract the pure sliver,
   leave the rest of the hub file alone" technique Phase 4.2 uses for the bigger hub files, just
   applied here first since it was the one thing blocking this specific port). Wired into
   `app/dotto-app.jsx`'s own mount effect (global, not scoped to one shell component) — and unlike
   the previous two files' lazy, on-hover `window.__getAppState()` reads, this one needs appState
   available immediately at wire time (to seed `lastStatsDayKey`), which genuinely races the
   vanilla `afterInteractive` bundle's own load time (the same class of race a Phase 1 bug already
   surfaced for a different component) — solved with a short readiness poll
   (`wireDayChangeAndAdNotifications`'s own comment) rather than a single check-and-skip, since
   there's no later store update that would naturally retry a skipped wire-up the way the outline
   panel's own self-healing case has. New `app/dotto/lib/vanillaBridges.d.ts` centralizes the
   `window.__*`/`window.*` ambient type declarations these ports need, rather than each file
   re-declaring its own — grows as more Phase 4.x ports need to reach a still-vanilla bridge.
   Verified with real Playwright browser testing using the REAL 60-second interval (not mocked/
   fast-forwarded) — forced a stale `lastStatsDayKey`, waited up to 65s, confirmed the interval
   fired, called `pushNotification` correctly, and updated the key — not just checked
   initialization. Original Batch A/B/C grouping (kept below for reference) should be treated as a
   first-pass sketch, not a queue — each remaining candidate needs the same two-sided dependency
   check before porting, and many will naturally become portable only once their blocking hub
   dependency lands in a later phase (or, per `dateKey`'s own precedent, once whatever small pure
   sliver is actually blocking them gets extracted on its own).

   **Exhaustive check of the rest of the original candidate list** (before moving on to Phase 4.2):
   every remaining zero-or-low-fan-in file was individually checked against the two-sided rule and
   confirmed genuinely blocked — `drag-drop-chat.js` (depends on `core-state.js`/
   `friends-presence.js`/`history-autosave.js`/`live-presence.js`, all real function calls, not
   just appState reads), `extensions-panel.js` (calls `wireRailIcon`, `panels-hamburger.js`),
   `search-panel-history.js` (`escapeHtml`/`rowActionsHTML`, both still multi-caller hub exports),
   `add-menu.js`/`theme-toggle.js`/`upload-popup.js` (each has real external vanilla importers of
   their own, never were fan-in 0 to begin with — an error in the original audit). The
   `command-parser.js`/`command-target-lookup.js`/`command-verbs.js`/`command-palette.js` cluster
   looked promising (`command-palette.js` is their only shared consumer) until `command-verbs.js`
   itself turned out to depend on FIVE separate hub files directly (`render()`/`openFolder` from
   `waypoints-render-loop.js`, `deepCloneItem`/`viewportCenterWorldPoint` from
   `srs-connections-core.js`, `openPublicCanvas`/`openSharedCanvas` from
   `shared-canvases-outline.js`, `saveSnapshot` from `history-autosave.js`,
   `resolveUsernameToUserId` from `friends-presence.js`) — nothing like `dateKey`'s single tiny
   blocker, genuinely Phase 4.4/4.5 territory. **Conclusion: Phase 4.1's low-hanging fruit is
   genuinely exhausted for now** — stop trying to force more leaf-file ports and move to Phase 4.2
   (or later phases) instead; individual Phase 4.1 candidates will keep becoming portable
   organically as their blockers land.
2. **Phase 4.2 — utility extraction.** **Real correction to the original plan text below**: it
   said extracted functions move straight to `app/dotto/lib/*.ts` with "a vanilla-side re-export so
   existing callers keep working" — that doesn't actually work when multiple vanilla files still
   import the original directly (`escapeHtml` alone has ~16 vanilla callers), since vanilla can't
   import from `app/` at all, re-export or not. The re-export pattern only works
   vanilla-side-to-vanilla-side: extract into a NEW, smaller, more focused **vanilla** file, and
   have the original hub file `import`+re-`export` from it, so every existing
   `from './original-hub-file.js'` caller keeps working completely unchanged. This doesn't make
   the extracted code reachable from `app/` yet (that still requires every remaining vanilla
   caller to be ported first, same as any other file) — its real, immediate value is a smaller,
   independently testable module and real unit-test coverage now, with the extracted piece ready
   to move wholesale to `app/dotto/lib` the moment nothing vanilla needs it directly anymore. First
   extraction done this way: `calculateSM2`/`defaultSrsState`/`diffRatings` pulled out of
   `srs-connections-core.js` into `public/dotto/srs-algorithm.js` (genuinely pure, zero imports of
   its own — `srs-connections-core.js` still re-exports all three so
   `games-flashcard-typeright.js`/`stopwatch-search-notifications.js`'s existing imports are
   untouched), with 14 new Vitest unit tests (`test/vanilla/srs-algorithm.test.ts` — kept OUT of
   `public/dotto/` itself despite colocating with source being the usual convention, since
   Next.js serves everything under `public/` as a real static asset in production; a `.test.ts`
   file there would be publicly fetchable for no reason. Vitest itself isn't bound by the
   "`public/` can't be imported by `app/`" convention either — that's a browser-runtime constraint
   for the real app, not a test-tooling one — so a plain relative import straight into
   `public/dotto/` from the test file works fine).

   Second extraction: `escapeHtml`/`stripHtml` out of `ai-assistant-suggestions.js` into
   `public/dotto/text-utils.js`, with 7 new Vitest unit tests
   (`test/vanilla/text-utils.test.ts`) and a real Playwright integration check (typed a
   `<script>` tag into the search-history box, confirmed the rendered row has it HTML-escaped, not
   executed). **Real finding**: `isLatinScriptText` — defined right alongside these two in the
   original file, and just as self-contained-*looking* — was deliberately left where it was rather
   than joining the extraction. It reads `appState.NON_LATIN_SCRIPT_RE`, and importing `appState`
   from `core-state.js` turned out to transitively run core-state.js's own module-level DOM
   lookups (e.g. `appState.modeToolbar.querySelectorAll(...)`), which throw under Vitest's jsdom
   environment with no real app markup mounted — breaking importability for the WHOLE module,
   including `escapeHtml`/`stripHtml` which don't even touch `appState`. Caught by actually running
   the tests, not just reasoning about purity in the abstract. `truncateCenter`, also defined
   alongside these two, was left out for an unrelated reason: a full grep found zero callers
   anywhere in the codebase — genuinely dead code, not worth extracting; flagged for a future
   deletion pass instead. **General lesson for future Phase 4.2/4.3 extractions**: "no DOM/appState
   *mutation*" isn't the same as "safe to extract into a Vitest-testable module" — a single
   read-only `appState` import can still drag in `core-state.js`'s heavy module-level side effects
   transitively; verify importability with a real test run, don't assume from reading the function
   body alone. This is also useful signal for Phase 4.5's own eventual `core-state.js` work: its
   module-level DOM lookups already make it fragile to import in isolation today, so decoupling
   that (or making those lookups defensive/deferred) is worth keeping in mind as part of that
   phase's own scope, not just "move `appState` into a store."

   Third target, achievement-scoring out of `profile-achievements-pricing.js` — turned out not to
   need an extraction at all. `calculateUserLevel`/`scoreRequiredForLevel` (the actual pure
   scoring logic — level/tier from cumulative score) already has a canonical, standalone,
   zero-appState-dependency home: `lib/leveling.js`, a genuine Next.js `/lib` module (not
   `public/dotto/`) already exported and presumably consumed server-side. The vanilla copy in
   `profile-achievements-pricing.js` is a pre-existing, already-documented deliberate duplicate
   ("canonical source is `lib/leveling.js`... duplicated here verbatim because this is a classic,
   non-module script that can't import it" — its own comment, predates Phase 4 entirely), not a
   Phase-4-created problem to fix. Real value found instead: spot-checked the vanilla copy's
   constants (`LEVEL_NAMES`/`SUB_RANKS_PER_TIER`/`LEVEL_GROWTH_RATE`/`LEVEL_BASE_POINTS`, all on
   `appState`, `core-state.js`) against `lib/leveling.js`'s own module-level constants and
   confirmed **zero drift** — both sides genuinely in sync as of this commit, a real (if
   unglamorous) professionalization check worth having done. Added the actually-missing piece:
   `lib/leveling.js` had zero test coverage despite being real, already-portable app code — 11 new
   Vitest unit tests in `lib/leveling.test.js`, colocated directly with the source (unlike the
   `test/vanilla/` files above, `lib/` isn't served as a static asset the way `public/` is, so
   normal colocation is fine here) covering tier-name/sub-level-count sanity, a fresh account's
   starting state, negative/null/undefined/fractional score handling, tier-boundary naming,
   max-level capping, `progressPercentage` bounds and monotonic increase within a level, and
   overall score-to-level monotonicity. **Phase 4.2 is now fully done** — all 3 original targets
   addressed (2 real extractions + 1 "already correctly separated, just needed tests + a drift
   check").
3. **Phase 4.3 — split multi-concern files** (mechanical, no logic change, structurally verified):
   `shared-canvases-outline.js` → outline-tree / tab-management / split-pane-management /
   shared-and-public-canvas-loading; `resize-shortcuts-init.js` → its 3 concerns;
   `stopwatch-search-notifications.js` → notifications / stopwatch / shelf-search (notifications is
   this project's own newest vanilla subsystem — re-porting it almost immediately is expected here).
4. **Phase 4.4 — port the split-out concerns + remaining DOM-heavy files.** Largest phase by line
   count; batched into several PRs by subsystem (games, media, marketplace, source/table), not one
   giant PR.
5. **Phase 4.5 — architectural/hub files, one at a time, in this order** (each its own PR, next
   sub-phase never starts before the previous lands and proves stable):
   1. `panels-hamburger.js` → small shared `usePanelState` hook/context.
   2. `live-presence.js` → split first (accessors / realtime broadcast / preview DOM), then port
      each.
   3. `history-autosave.js` → `saveSnapshot`/`undo`/`redo`/autosave become `useHistoryStore`
      actions.
   4. `srs-connections-core.js` remainder → the universal `add()` becomes a store action.
   5. `window-bridge.js` → finish converting remaining inline `onclick` HTML, delete the file.
   6. `waypoints-render-loop.js` → keep `render()` alive as a thin compatibility shim triggering
      Zustand updates internally while callers migrate off it file-by-file; delete the shim last.
   7. `core-state.js` → introduce Zustand stores alongside the still-live `appState`, dual-write
      during the transition, migrate readers file-by-file, delete `appState` once zero direct
      readers remain.
6. **Phase 4.6 — delete the bridge layer**: `bridges.js`'s `createStore` mechanism,
   `window-bridge.js`, the vanilla `<Script type="module">` tag, `public/dotto/` itself. Grep-verify
   zero remaining `window.__` references. Rewrite `CONTRIBUTING.md`/`README.md`. Delete
   `INLINE_HANDLER_CHECKLIST.md`.
7. **Phase 4.7 — final cleanup**: TypeScript strict sweep, `ARCHITECTURE.md`, final
   `QA_CHECKLIST.md` disposition, archive `PHASE2_ROADMAP.md` to `docs/archive/`, this file's own
   closing "how this was verified" section, full CI review.

## Verification (every phase/batch)

1. `node --check` on every touched vanilla file (until vanilla is fully gone).
2. `npx eslint <touched files>`.
3. `npm run typecheck` (from 4.0 on).
4. `npm run test` (Vitest) for touched/extracted logic.
5. `rm -rf .next && npm run build` — never concurrent with a live `npm run dev` (shared `.next`
   cache corrupts otherwise).
6. `npm run dev` + relevant `npm run test:e2e` specs, or an ad-hoc headless `chromium.launch()`
   script for anything not yet a committed spec.
7. For mechanical moves (4.2's extractions, 4.3's splits): structural diff of DOM ids/classes
   against the pre-change version.
8. Manual click-through against any `QA_CHECKLIST.md` items not yet superseded by an automated spec.

Each phase's entry in this file should state exactly which of these were used, same as
`PHASE2_ROADMAP.md`'s own "how this was verified" discipline.

## How this was verified (updated as each phase closes)

**Phase 4.0**: `npm run lint && npm run typecheck && npm run format:check && npm run test && rm -rf
.next && npm run build` all green. Full `npx playwright test` (both the unauthenticated `chromium`
project and the real `authenticated` project logging into the dedicated test Supabase project) run
locally with `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` pointed at the test project
— all 3 specs passing, including a genuine login → canvas-loads round trip against real Supabase
auth. Test project's resulting schema (table list, `profiles`' 18-column shape, 3 storage buckets)
cross-checked against production's and confirmed to match exactly. The Prettier one-time formatting
pass was additionally verified with a real headless-browser smoke test (canvas/rail render, a
notification pushed end-to-end) against a fresh production build.

**Real CI-only bug found and fixed after the first push**: the actual GitHub Actions run (not just
local checks) failed on `npm run typecheck` — a genuine gap local testing couldn't have caught,
since it only reproduces on a truly fresh checkout. Root cause: `next-env.d.ts` is gitignored
(standard Next.js convention, auto-generated by `next dev`/`next build`) and itself references
`.next/types/routes.d.ts` (only created by `next build`) — CI runs `typecheck` *before* `build`, so
on a fresh clone neither file exists yet, and a bare `tsc --noEmit` fails outright. Every local run
up to that point had unknowingly been "cheating," since `.next/`/`next-env.d.ts` already existed
locally from earlier `npm run build`/`dev` calls in this same working directory. Reproduced locally
by explicitly deleting `.next`, `next-env.d.ts`, and `tsconfig.tsbuildinfo` (TypeScript's own
incremental-build cache, also gitignored, which was independently masking the issue by skipping
re-analysis of files it believed were unchanged) before running `npm run typecheck` — confirmed the
exact same failure, then fixed it by changing the `typecheck` script to `next typegen && tsc
--noEmit` (`next typegen`, this Next.js version's lightweight "generate route types without a full
build" command — no full `next build` needed just to unblock type-checking). Re-verified clean from
the same fully-scrubbed state, plus a full `lint`/`format:check`/`test`/`build`/`test:e2e` re-run,
before pushing the fix. **Lesson for future phases**: prefer testing CI-critical scripts against a
freshly-scrubbed local state (or the real CI run itself) over trusting a repeatedly-reused local
working directory, which accumulates exactly this kind of "artifacts my own earlier commands
created" false confidence.

**Confirmed green in real GitHub Actions** (run 33259037962, commit `1b9c43d`): every step —
`lint`, `typecheck`, `format:check`, `test`, `build`, `playwright install`, and `test:e2e` (against
the real `TEST_SUPABASE_URL`/`TEST_SUPABASE_ANON_KEY`/`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` repo
secrets) — passed. Phase 4.0 is fully done: no remaining open items.

**Phase 4.1 (first wave — `rail-tooltip-expand.js`/`sidebar-mode-toggle.js`)**: `node --check` on
`dotto-script.js` (its import list changed), `eslint`+`npm run typecheck` clean on both new
`.ts` files and the two touched section components, a full clean `rm -rf .next
next-env.d.ts tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass (see Phase 4.0's own
lesson above — verified from a genuinely scrubbed state, not a warm directory), and real Playwright
browser verification against a fresh dev server: the sidebar-mode dropdown (open/select
overlay/confirm `body[data-sidebar-mode]`+label+localStorage all update/Escape closes it) and the
rail-tooltip hold-to-expand animation (rest state → 2s hold → width 220px + typing text reveals
progressively → mouse-leave fully resets), both with zero page errors. One real, non-obvious
Playwright quirk hit and worked around during this verification: Next.js dev mode's
`<nextjs-portal>` error-overlay custom element intercepts Playwright's own click-actionability
check even when `document.elementFromPoint` resolves correctly and nothing is visually blocking
the target — confirmed via direct `elementFromPoint` inspection that this was a Playwright↔custom-
element hit-testing quirk, not a real app bug; worked around by dispatching clicks via
`element.click()` in `page.evaluate()` instead of `page.click()`. Worth reusing this workaround for
any future Phase 4.x verification script that hits the same "Element is not visible" /
"intercepts pointer events" symptom against a dev-mode page.

**Phase 4.1 (second file — `dotbot-schedule-notifications.js`)**: same clean-state
typecheck/build/lint pass as above, plus real Playwright verification using the actual 60-second
interval (not mocked) — confirmed `lastStatsDayKey` initializes correctly against an independently
recomputed expected value, forced a stale key, waited up to 65s for the real `setInterval` to
detect the crossing, and confirmed both the notification's exact text and the key update — not
just that the module loaded without error. Zero page errors.

**Phase 4.2 (SM-2 extraction)**: `node --check`/`eslint` on both touched vanilla files, a full
clean `typecheck`/`format:check`/`build` pass, and 14 new Vitest unit tests
(`test/vanilla/srs-algorithm.test.ts`) covering `defaultSrsState`'s initial shape,
`calculateSM2`'s full branch set (incorrect-answer reset, first/second/third+ correct-answer
interval progression, the 1.3 ease-factor floor, a perfect-quality ease increase, and the
interval-days-ahead `dueDate` math), and `diffRatings`' key-diffing including missing-key and
null/undefined-input edge cases — all passing. This is a purely mechanical extraction (the same
code moved verbatim, not rewritten), so a full UI-driven flashcard-grading Playwright test was
judged disproportionate to the actual risk here — real unit tests exercising the exact algorithm
plus a clean zero-error app load (confirming the import chain resolves at runtime, the one thing
a mechanical move could plausibly break) is the right verification weight for this kind of change,
unlike the two Phase 4.1 ports above (genuine new wiring/timing, appropriately verified with real
browser interaction).

**Phase 4.2 (text-utils extraction)**: `node --check`/`eslint` clean, 7 new Vitest unit tests
(escaping all 5 HTML-significant characters, non-string coercion, nested-tag stripping,
empty/null/undefined handling, whitespace trimming) plus the 14 SM-2 ones still passing (21
total), a full clean `typecheck`/`format:check`/`build` pass, and — since this one DOES get real
UI exposure (`escapeHtml` feeds directly into `search-panel-history.js`'s rendered rows) — a real
Playwright test: typed a literal `<script>alert(1)</script>` into the search-history box, pressed
Enter, and confirmed the rendered row has it HTML-escaped (`&lt;script&gt;`), not present as
executable markup, with zero page errors.

**Phase 4.2 (leveling — closes out the phase)**: no vanilla files touched this time (only a new
`lib/leveling.test.js`), so no `node --check` needed; `eslint` clean, a full clean
`typecheck`/`format:check`/`build` pass, and all 32 Vitest tests passing (11 new leveling ones —
tier-name/sub-level-count sanity, fresh-account starting state, negative/null/undefined/fractional
score handling, a real tier-boundary name check found by walking `calculateUserLevel` itself
rather than re-deriving the geometric-series threshold formula independently, max-level capping
at 180 for an astronomically large score, `progressPercentage` bounds (0 at a level's own
threshold, 100 at max, strictly between while mid-level) and monotonic increase within a level,
and overall score-to-level monotonicity across an irregular sampling of scores — plus the 21 from
the two earlier extractions, all still green). Also manually cross-checked the vanilla duplicate's
5 constants (`LEVEL_NAMES`/`SUB_RANKS_PER_TIER`/`LEVEL_GROWTH_RATE`/`LEVEL_BASE_POINTS`,
`core-state.js`) against `lib/leveling.js`'s own — byte-identical, zero drift found.

**Phase 4.3 (`resize-shortcuts-init.js` split)**: `node --check` on all 11 touched/new vanilla
files, `eslint` clean (vanilla files plus `TableCard.jsx`/`NoteCard.jsx`/`canvasItemBehavior.js`,
whose comments referenced the old filename), a full clean `rm -rf .next next-env.d.ts
tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass, `npm run format:check` clean, and
all 32 existing Vitest tests still green (no new ones needed — this is a mechanical file split, no
logic changed, same as Phase 4.2's SM-2 extraction). Real Playwright verification against a fresh
dev server, self-cleaning against the shared test account (every mock item it creates is tagged and
removed again in a `finally` block, with a 2.5s wait for `scheduleWorkspaceSave`'s 800ms debounce
plus its async Supabase write to actually persist before the browser closes — an earlier version of
this cleanup closed the browser too soon and silently lost the cleanup on the next reload, caught
by re-checking the account afterward rather than trusting the script's own "removed N" log):
confirmed `app-init.js`'s bootstrap sequence actually populates `appState.folders` +
`currentFolderId` on load; `card-shortcuts.js`'s global Option-held `body.option-held` class
toggles on keydown and clears on keyup; a real column-divider drag on a `userSized` table
(`table-grid-resize.js`'s `armDividerOnHover`/`startTableColResize`) correctly arms after the
300ms hover delay and mutates `it.colWidths`; and `card-shortcuts.js`'s Backspace-to-delete
(`deleteSelectedCards`) correctly removes the selected card from `appState`. Zero console/page
errors (one unrelated pre-existing stray media card in the shared test account, pointing at a dead
`https://example.com/test.pdf` fixture URL, logs CORS noise on every page load regardless of what's
under test — confirmed unrelated to this split, filtered out of the pass/fail check). One
test-script-only gotcha worth flagging for future Phase 4.3/4.4 verification scripts: a 2x2 mock
table's single row-divider and column-divider handles geometrically cross at the table's midpoint,
so clicking dead-center via real screen coordinates (`page.mouse`) hits whichever one happens to be
stacked on top rather than reliably hitting the one under test — dispatching `mouseenter`/
`pointerdown`/`pointermove`/`pointerup` directly at the target element (bypassing screen-coordinate
hit-testing) sidesteps this while still exercising the real listener chain
(`armDividerOnHover`'s hover-arm timer through to the actual resize).

**Phase 4.3 (`shared-canvases-outline.js` split)**: `node --check` on all touched/new vanilla
files, `eslint` clean (vanilla files plus every touched `.jsx` file — only pre-existing, unrelated
`<img>`-vs-`next/image` warnings, zero errors), a full clean `rm -rf .next next-env.d.ts
tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass, `npm run format:check` clean, and
all 32 existing Vitest tests still green (mechanical split, no logic changed, same as the
`resize-shortcuts-init.js` split above and Phase 4.2's SM-2 extraction — no new tests needed for a
verbatim code move). Real Playwright verification against a fresh dev server: opening the hamburger
menu (`#btn-menu`) correctly builds and shows the outline tree (`outline-tree.js`'s `buildOutline`,
143 real rows against this account's actual canvas content) and its search correctly narrows the
row set (`handleOutlineSearch`, a nonsense query correctly zeroed the rows); `tab-management.js`'s
`addTab`/`switchTab`/`closeTab` round-tripped the tab count and active-tab id exactly as expected;
`navBack`/`navForward` exercised without error against real `historyStack` state; and
`split-pane-management.js`'s `splitPaneWithTab`/`closePane` round-tripped the real pane count
(+1 then back to baseline) via `window.__countPanes()` — verified against whatever the shared test
account's pane count actually was at the time (2, itself leftover split-screen state from earlier
sessions), not a hardcoded assumption of 1. Re-checked the account's persisted `tabs`/pane count
after the run to confirm the tab-management/split-pane round trips left no residue. Zero
console/page errors (same known stray `https://example.com/test.pdf` fixture noise as the
`resize-shortcuts-init.js` verification above, filtered out as unrelated). Not separately verified
in this pass: `shared-and-public-canvas-loading.js`'s actual live-collaboration/public-canvas RPC
paths (`openSharedCanvas`/`openPublicCanvas`/`ensureSharedFolderLoaded`/`ensurePublicFolderLoaded`)
— this is a single-account test setup with no second account to collaborate with or public canvas
to fetch; covered instead by the mechanical-move verification tier (clean typecheck/build, zero
console errors on a full app load that itself calls `announceEnteredCollaboration` via
`app-init.js` on every boot) — same reasoning Phase 4.2's SM-2 extraction used for skipping a
full UI-driven test on a verbatim code move.

**Phase 4.3 (`stopwatch-search-notifications.js` split — closes out Phase 4.3)**: `node --check`
on all touched/new vanilla files, `eslint` clean (only pre-existing `<img>`-vs-`next/image`
warnings, zero errors), a full clean `rm -rf .next next-env.d.ts tsconfig.tsbuildinfo && npm run
typecheck && npm run build` pass (the build in particular matters here — it's what would have
surfaced a genuine problem with the `live-presence.js`↔`shelf-search.js` circular import if the
split had actually broken it, not just carried it forward unchanged), `npm run format:check`
clean, all 32 existing Vitest tests still green. Real Playwright verification against a fresh dev
server, using the same tagged-mock-item + `finally`-block cleanup pattern as the earlier two
Phase 4.3 verifications: `notifications.js`'s `pushNotification`/`__dismissNotification` correctly
round-tripped `visibleNotifications`; `stopwatch.js`'s `swToggleRun`/`swTogglePause` correctly
drove a mock Stopwatch card through start → pause → resume → stop, confirming a session got
archived into `it.swSessions` on stop; `shelf-search.js`'s `toggleFilterTag`/`setFilterMode`
correctly round-tripped a mock Filter card's tag set and AND/OR mode; and `autoGrowSearchInput`
correctly grew `#search-input`'s real height (34px → 74px) after typing a long query into the AI
search box once opened via `#rail-btn-ai` (not `#btn-search`, which opens the unrelated
search-history panel — a real selector mistake caught and fixed during this verification, not a
finding about the app itself). Zero console/page errors on the final clean run — an earlier run
using the wrong search button logged 15 unrelated 404s, which disappeared entirely once the
correct button was used, confirming they were a test-script artifact (some fetch triggered by
the wrong panel opening), not a real regression. Re-checked the account afterward to confirm the
`finally` cleanup actually removed every mock item (stopwatch, filter) and notification, leaving
zero residue.

**Phase 4.4 (`notifications.js` → `notificationsStore.ts` — first real Zustand port)**:
`node --check` on all touched vanilla files, `eslint` clean (only pre-existing `<img>` warnings,
zero errors), a full clean `rm -rf .next next-env.d.ts tsconfig.tsbuildinfo && npm run typecheck
&& npm run build` pass (typecheck in particular matters here — it's the first real `.ts` file with
actual application logic and Zustand's own generic types, not just ambient declarations), `npm
run format:check` clean, all 32 existing Vitest tests still green. Real Playwright verification
against a fresh dev server: `window.pushNotification()` correctly rendered a real
`.notification-card` with the right text; a real click on `.notification-action` fired the
`onAction` callback AND dismissed the card; a real click on `.notification-close-btn` dismissed a
different card; a real `Escape` keydown dismissed a third; `window.__hasVisibleNotifications()`
correctly reported `false`/`true` across a push; and — the more important check — a genuinely
**vanilla** code path (srs-connections-core.js's own "N" debug-notification keyboard shortcut, not
a test script calling the bridge directly) correctly reached through `window.pushNotification` to
the new Zustand store and rendered for real, confirming the vanilla → React bridge direction
actually works end-to-end, not just React's own internal state. Zero console/page errors (the
same known stray PDF fixture noise as earlier Phase 4.3 verifications, filtered out as unrelated).
Confirmed green in real GitHub Actions (run 33267814620).

**Phase 4.4 (`stopwatch.js` → `app/dotto/lib/stopwatch.ts`)**: `node --check` on all touched
vanilla files, `eslint` clean (zero errors or warnings — the first Phase 4.4 file with neither),
a full clean `rm -rf .next next-env.d.ts tsconfig.tsbuildinfo && npm run typecheck && npm run
build` pass — typecheck caught 3 real type errors on the first pass (an unsafe direct cast from
`window.__findItemById`'s loosely-typed return to the new `StopwatchItem` interface, twice, plus
a bridge-assignment type mismatch), all fixed by routing the casts through `unknown` first rather
than loosening the interface itself, `npm run format:check` clean, all 32 Vitest tests still
green. Real Playwright verification against a fresh dev server, specifically targeting the
bridge-readiness race class of bug this port's own comment flags as a risk (React module-eval
setting `window.swToggleRun` etc. only once something imports `stopwatch.ts` — unlike the OLD
vanilla file, which set these bridges unconditionally at `dotto-script.js` load time): confirmed
all 4 bridges (`swToggleRun`/`swTogglePause`/`__swFormatTime`/`__swCurrentElapsedMs`) were already
real functions within 500ms of page load, well before any interaction — CanvasItemsLayer.jsx's
own always-mounted import graph (which includes StopwatchCard.jsx) evaluates during React's
initial bundle parse, ahead of the vanilla `afterInteractive` script, so there's no actual race in
practice. Then drove a real mock stopwatch card through genuine DOM button clicks (not calling the
ported functions directly, which would only prove the TS code runs, not that the wiring through
StopwatchCard.jsx's real `onClick` handlers is correct): Start → confirmed `swRunning`/
`swSessionActive` flipped true; Pause → confirmed `swPaused` true; Resume (same button) → confirmed
`swPaused` false again; Stop → confirmed `swRunning` false, `swElapsedMs` reset to 0, and a real
session got archived into `swSessions` (length 1); confirmed the rendered `.sw-time` text used
`swFormatTime`'s real `mm:ss` format, not a stale/placeholder value. Zero console/page errors.
`renderStopwatchHTML`'s own still-vanilla path (live-presence.js's mini previews) wasn't separately
UI-tested — it calls the identical `window.__swFormatTime`/`__swCurrentElapsedMs` bridges already
confirmed live by the checks above, and the zero-error result across the whole run is strong
evidence nothing there broke; judged proportionate the same way Phase 4.2's SM-2 extraction judged
a full UI test unnecessary for a verbatim-logic move.

**Phase 4.4 (`split-pane-management.js` → `app/dotto/lib/splitPaneManagement.ts`)**:
`node --check` on all touched vanilla files, `eslint` clean (zero errors or warnings), a full
clean `rm -rf .next next-env.d.ts tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass
(clean on the first attempt this time — no cast errors, unlike the stopwatch port, since this
file's own state is entirely bridge-mediated rather than touching a typed interface directly),
`npm run format:check` clean, all 32 Vitest tests still green. Real Playwright verification
against a fresh dev server: confirmed both `window.__splitPaneWithTab`/`window.__closePane`
bridges are live functions on load, then round-tripped the real pane count through a genuine
`splitPaneWithTab` → `closePane` cycle via the actual bridges (not calling the TS functions
directly) — count went from whatever the shared test account's baseline was (2, itself leftover
split-screen state) to 3 after the split and back to 2 after closing, matching the identical round
trip the `shared-canvases-outline.js` split verification already exercised, just now proving the
NEW TS-sourced bridge behaves identically to the old vanilla one it replaced. Zero console/page
errors. Re-checked the account afterward to confirm the transient tab created during the test
never got persisted (no `scheduleWorkspaceSave` was triggered or waited for) — tab/pane counts
matched the pre-test baseline exactly.

**Phase 4.4 (`copy-paste.js` → `app/dotto/lib/copyPaste.ts`)**: `node --check` on all touched
vanilla files, `eslint` clean (zero errors or warnings), a full clean `rm -rf .next next-env.d.ts
tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass — typecheck caught 7 real errors
on the first pass, all "bridge exists at runtime but was never declared" (`__getCanvasEl`/
`__getWorldEl`/`__renderSelectedOutlines`, pre-existing bridges no prior `.ts` file had touched),
fixed by adding the missing ambient declarations rather than working around them, `npm run
format:check` clean, all 32 Vitest tests still green. Real Playwright verification against a
fresh dev server: confirmed all 5 bridges live within 500ms of load; a real mock card round-
tripped through `copySelectedCards` → `pasteClipboardCards` (clipboard length, the correct 28px
cascade offset applied to the pasted clone's x/y, and its content preserved) → `cutSelectedCards`
on the pasted clone (removed from `appState`, re-added to the clipboard); `prepareAdd('note')`
correctly set `addingKind`, created a real `#placement-ghost` DOM element with the right class,
and added the `crosshair` cursor class to the canvas; a genuine `page.mouse.move` over the canvas
moved the ghost from its initial off-screen `-9999px` fallback to a real on-canvas pixel position,
confirming `setupPlacementGhostTracking`'s pointermove listener — registered once at `wireCopyPaste`
time via the new `__registerPaneCanvasListenerSetup` bridge — is genuinely live, not just present
in the bundle; `removePlacementGhost` correctly removed the DOM node and nulled `appState.
placementGhost`. Zero console/page errors. Re-checked the account afterward to confirm zero
residual mock items, an empty clipboard, and `addingKind` back to `null`.

**Phase 4.4 (`tab-management.js` → `app/dotto/lib/tabManagement.ts`)**: `node --check` on all
touched vanilla files, `eslint` clean (only pre-existing `<img>` warnings, zero errors), a full
clean `rm -rf .next next-env.d.ts tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass
(clean on the first attempt), `npm run format:check` clean (after fixing a real self-introduced
mistake caught during this pass — an ambient-type comment claiming `shared-and-public-canvas-
loading.js` had already been ported to `app/dotto/lib/`, which it hasn't; corrected before
committing), all 32 Vitest tests still green. Real Playwright verification against a fresh dev
server: confirmed all 8 bridges live within 500ms of load; round-tripped the real tab count/active-
tab-id through `addTab`/`switchTab`/`closeTab` via the actual bridges; confirmed `navBack`/
`navForward` run without error against real `historyStack` state. The breadcrumb path
(`buildAncestorChain`/`renderBreadcrumbMapPanel`/`breadcrumbMapRowClick`) needed a real nested
folder to exercise meaningfully — the shared test account's root had none, so a second, separate
verification run created one, navigated into it via `window.__openFolder`, confirmed
`currentFolderId` updated, then clicked back to root via the real `window.__breadcrumbMapRowClick`
bridge and confirmed it landed back on `currentFolderId === 'root'` — a genuine exercise of
`buildAncestorChain`'s structural-parent walk, not just a bridge-existence check. Zero console/page
errors across both runs. Re-checked the account afterward to confirm the mock nested folder, its
card, and the extra tab were all cleaned up with no residue.

**Phase 4.4 (`shared-and-public-canvas-loading.js` → `app/dotto/lib/sharedAndPublicCanvasLoading.ts`)**:
`node --check` on all 6 touched vanilla caller files, `eslint` clean (zero errors or warnings), a
full clean `rm -rf .next next-env.d.ts tsconfig.tsbuildinfo && npm run typecheck && npm run build`
pass — typecheck caught 3 real "bridge exists but was never declared" errors on the first pass
(`__applyTransform`, plus `__openSharedCanvas`/`__resolveReferenceFolderKey`, which this file both
reads and writes so needed declaring even though they'd existed as plain vanilla assignments for
phases already); notably the real `SupabaseClient.rpc()` calls typechecked cleanly with zero casts
needed, `npm run format:check` clean, all 32 Vitest tests still green. Real Playwright verification
against a fresh dev server — this is a single-account test setup, so the real cross-account RPC
flows (`openSharedCanvas`/`openPublicCanvas`/`ensureSharedFolderLoaded` actually fetching another
user's canvas) can't be exercised end-to-end here, same limitation the original Phase 4.3 split
verification of this exact file had; covered instead: confirmed all 10 bridges live within 500ms
of load; the pure key-transform functions (`sharedFolderKey`/`parseSharedFolderKey`/
`stripSharedFolderIds`/`namespaceSharedFolderIds`) produced correct output against real input data;
`ensureSharedFolderLoaded`'s already-loaded fast path correctly short-circuited to `true` without
attempting an RPC call; `resolveReferenceFolderKey`'s own-folder fast path correctly resolved
without a fetch; and `exitSharedCanvasToRoot` — simulating a `shared:`/`public:` state entirely in
`appState` rather than via a real fetch — correctly removed both namespaced folders, cleared
`preSharedViewState`, and restored `currentFolderId`/`historyStack` to root. One real test-script
bug caught and fixed along the way: `window.__getAppState` intermittently wasn't ready between
rapid-fire `page.evaluate` calls with no wait between them, fixed by adding small waits — a
test-script timing issue, not an app bug (the same functions worked correctly once given time to
settle). Zero console/page errors on the final clean run. Re-checked the account afterward to
confirm zero residual fake shared/public folder entries and a cleared `preSharedViewState`.

**Phase 4.4 (`marketplace.js` → `app/dotto/lib/marketplace.ts`)**: `node --check` on all touched
vanilla files, `eslint` clean (zero errors or warnings), a full clean `rm -rf .next next-env.d.ts
tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass — typecheck caught 4 real errors
on the first pass, all the same "interface too strict to pass through a `Record<string, unknown>`
bridge parameter" class already seen with `StopwatchItem`, fixed the same way (an index signature
on `MarketplaceItem`, not loosening the bridge's own type), `npm run format:check` clean, all 32
Vitest tests still green. Real Playwright verification against a fresh dev server — deliberately
scoped to avoid real Supabase writes against the shared test account (`purchaseCurrentMarketItem`/
`packageSelectedAsTemplate`'s own insert paths weren't exercised, same "mechanical port, verified
by typecheck + zero-error load" tier used for untestable RPC paths in the previous port): confirmed
all 11 bridges live within 500ms of load; a **real click on `#btn-cart`** (not a direct function
call) correctly opened the cart panel (`.open` class + `.active` on the button) via the
`wireRailIcon` binding `wireMarketplace`'s readiness-poll set up, and its `onOpen` callback
(`refreshCartPanel`) genuinely ran a real Supabase read (`trendingCount: 0`, confirming the query
executed against the real test-project schema rather than erroring silently); real typed search
input correctly updated `marketplaceSearchQuery`; `openMarketDetail`/`closeMarketDetail` correctly
toggled `selectedMarketItem` and the two view panels' classes; `deployPurchasedTemplate` (read-only
against an already-cached library entry, no write) correctly spawned a real canvas card with the
right content. Zero console/page errors. Re-checked the account afterward to confirm the spawned
card, the mock purchased-library entry, and `selectedMarketItem` were all cleaned up with no
residue.

**Phase 4.4 (`shelf-search.js` → `app/dotto/lib/shelfSearch.ts`)**: `node --check` on all touched
vanilla files, `eslint` clean (zero errors or warnings), a full clean `rm -rf .next next-env.d.ts
tsconfig.tsbuildinfo && npm run typecheck && npm run build` pass — typecheck caught 6 real errors
on the first pass: 3 more "bridge exists at runtime but was never declared" (`__scheduleWorkspaceSave`,
`closeSearchCardsModal` — this one genuinely forgotten in the ambient types even though its own
JSDoc comment already described it), plus a `FolderObj` interface missing the `connections` field
`__ensureConnections` needs, `npm run format:check` clean, all 32 Vitest tests still green. Real
Playwright verification against a fresh dev server, deliberately targeting the highest-risk new
surface (real HTML-string generation + contentEditable flows, a category this migration hadn't
ported before): `renderShelfHTML` produced correct output for a mock session including real HTML-
escaping of a `<script>` tag in the shelf name; `filterShelfRows` correctly showed/hid real DOM
rows by a live search value; `startRenameShelfName` drove a genuine `contentEditable` flow on a
mock Shelf card's own rendered `.shelf-header` element, confirming the rename actually persisted to
`appState`; `setFilterMode`/`toggleFilterTag` round-tripped correctly on a mock Filter card; a real
typed search grew `#search-input`'s height; and the full drag-context flow
(`addCardsToSearchContext` → `openSearchCardsModal`, which really mounts a `renderInlineCanvas`
node into the DOM → `closeSearchCardsModal` → `clearSearchCardContext`) worked end-to-end. Two real
bridge omissions were caught and fixed during the pre-verification stale-reference sweep, not by
any automated check: `renderShelfHTML` and `autoGrowSearchInput` were both fully implemented and
exported but never actually assigned to a `window.*` bridge — `node --check`/`eslint`/`tsc`/
`next build` all stayed green regardless, since nothing type-checks that a *specific* global gets
assigned, only that assignments which DO exist are well-typed; only grepping for leftover
references to the old filename across the repo (this project's own standing post-split discipline,
established back in the very first Phase 4.3 split) surfaced that `live-presence.js` and two other
files still had real, now-broken imports pointing at functions with no bridge. Zero console/page
errors on the final run. Re-checked the account afterward to confirm zero residual mock Shelf/
Filter cards and an empty `searchCardContext`.

**Phase 4.4 (`outline-tree.js` → `app/dotto/lib/outlineTree.ts`)**: `node --check` on all 7 touched
vanilla files, `eslint` clean (zero errors or warnings), `npm run typecheck` clean on the first
pass (no missing-bridge errors this time — all 8 dependencies this port needed were either already
typed or added up front before writing the file), `npm run format:check` clean after a `prettier
--write` pass, `rm -rf .next && npm run build` clean, all 32 Vitest tests still green. Real
Playwright verification against a fresh dev server: confirmed all 12 bridges present; `kindIconFile`
returned the right heading-level filenames and a safe fallback for an unknown kind; `kindIconHTML`/
`rowActionsHTML` produced correct HTML strings. Real DOM flow: seeded a tagged heading + tagged
note directly into `appState` (this shared test account already carries 140+ items from earlier
sessions' runs, which made simulating the 'a'-chord + click-to-place unreliable for picking out
"the fresh card" — seeding is still real data through the real data model, just not
screen-coordinate-dependent), opened the panel via the real 'o' keyboard shortcut, and confirmed
both rows rendered with correct labels; collapsed/expanded the heading's real hover-revealed
collapse toggle and confirmed the grouped note row actually disappeared/reappeared; live search
filtered correctly plus a real empty state; arrow-key nav set `.active`; clicking the note row
navigated (exercising `__canvasViewportCenterX`/`__smoothPanTo`/`__flashCanvasElement` under the
hood) and closed the panel. Zero unexpected console/page errors — two known, pre-existing,
unrelated noise sources were filtered: a missing `public/assets/icons/media.png` asset (a
already-accepted gap per `kindIconFile`'s own comment, surfaced only because this account has real
pre-existing Media cards) and the already-documented dead `test.pdf` CORS noise. Re-checked the
account afterward to confirm both tagged mock items were fully removed with no residue. The
stale-reference sweep this time caught two comments asserting something no longer true, not just a
stale filename — see the status section entry above.

**Phase 4.4 (`source-buttons-cursor-mode.js` → `app/dotto/lib/sourceButtonsCursorMode.ts`)**:
`node --check` on all 7 touched vanilla files, `eslint` clean (zero errors or warnings), `npm run
typecheck` clean on the first pass, `npm run format:check` clean after a `prettier --write` pass,
`rm -rf .next && npm run build` clean, all 32 Vitest tests still green. Real Playwright verification
against a fresh dev server: confirmed all 3 bridges present; a real hover on `#mode-toolbar`
expanded the mode popup, and clicking its Select row set `cardMode`/toggled the canvas's real
`mode-select` class; the D/Escape/Shift keyboard overrides were driven with real `keydown`/`keyup`
timing against `MODE_HOLD_THRESHOLD_MS` (180ms) — a quick Shift tap (50ms) stuck to select mode, a
quick Escape tap reverted to normal, and holding D past the threshold (300ms) correctly produced
the ORIGINAL vanilla file's own real quirk carried over verbatim (not a port bug): `effectiveMode()`
maps a held 'd' override to `'data'`, not `'pen'`, even though a quick tap of the same key sticks to
`'pen'` on release — confirmed via both `window.__effectiveMode()` and the canvas's real
`mode-data` class while held, and that raw `cardMode` correctly stayed `'normal'` after releasing
(no stick, since the hold exceeded the threshold). A tagged mock card was deleted for real via a
genuine Backspace keypress (`__dispatchListPanelDelete`/`__deleteSelectedCards` routing). A tagged
mock table cell's real `openCellAddMenu`/`closeSourceAddMenu` cycle opened/closed `#source-add-menu`
and toggled `panelPinned.sourceAdd` correctly. Zero unexpected console/page errors (the same two
known, pre-existing, unrelated noise sources as the `outline-tree.js` port were filtered). Re-checked
the account afterward to confirm zero residual mock cards and `cardMode`/`selectedCardIds` both
reset to their clean defaults.

**Phase 4.4 (`games-flashcard-typeright.js` → `app/dotto/lib/gamesFlashcardTyperight.ts`)**:
`node --check` on all 5 touched vanilla files, `eslint` clean (zero errors or warnings), `npm run
typecheck` clean after fixing 2 real `??`/`||`-mixing syntax errors and adding the 9 pre-existing
React->vanilla bridges this port's own `??` fixes exposed as still-untyped, `npm run format:check`
clean after a `prettier --write` pass, `rm -rf .next && npm run build` clean, all 32 Vitest tests
still green. Real Playwright verification against a fresh dev server: confirmed all 24
bridges/plain-globals present; pure-function sanity for `cellContentType`/`normalizeGameSlot`
(including its legacy-number and legacy-`{cloze:true}` migration paths)/`defaultFlashcardDeck`;
`renderFlashcardHTML`/`renderTypeRightHTML`'s own still-string-built mini-preview path (used by
`live-presence.js`) produced correct markup. Real DOM flow: a tagged mock flashcard rendered via
the real `FlashcardCard.jsx` (now a direct ES import of this port, not a bridge — see above), a
real click flipped it, a real click on "Easy" correctly rated it (verified via a `window.__render`
stub isolating this port's own logic from the real, correct "orphaned SRS" integrity sweep it
triggers — see the status section entry above for the full explanation — then restored to confirm
that sweep's own collapse behavior afterward), and a real click toggled shuffle mode. Same pattern
for a tagged typeright card via `TypeRightCard.jsx`: a real typed answer ("apple") was graded
`'correct'` by a real Check click (`.fill()` used instead of per-keystroke `.type()` — this
controlled input's value is a plain mutated field, not React state, which made per-keystroke typing
genuinely racy against this shared account's own background renders, unrelated to what this test
verifies), and a second card's `window.trNext` call was verified directly (real UI interaction
wasn't reachable for it either, same disconnected-mock/integrity-sweep interaction) then confirmed
against a real subsequent render showing the correct next-question DOM. Cloze/`GameOptionsPanel.jsx`
flow: a real right-click (`oncontextmenu`) opened the Options panel, a real `[bracket]`-containing
column showed its Blank/`[...]` optgroup, and selecting Blank via the real `<select>` correctly
re-rendered the card's shown front face to `"...[...] ..."`. Zero unexpected console/page errors
(the same two known, pre-existing, unrelated noise sources as prior Phase 4.4 ports were filtered).
Re-checked the account afterward to confirm zero residual mock cards.

**Phase 4.4 (`media-pdf-epub.js` → `app/dotto/lib/mediaPdfEpub.ts`)**: `node --check` on all 4
touched vanilla files, `eslint` clean (zero errors or warnings), `npm run typecheck` clean after
suppressing one genuine `tsc`-can't-resolve error on the vendored pdf.js path (`@ts-expect-error`,
same reasoning as every dynamic-import-of-an-unbundled-vendor-file case), `npm run format:check`
clean after a `prettier --write` pass, all 32 Vitest tests still green. `rm -rf .next && npm run
build` failed on the FIRST attempt — a real, previously-unencountered Turbopack build error on the
same vendored pdf.js dynamic import (`Module not found: Can't resolve '/vendor/pdfjs/pdf.min.mjs'`,
since Turbopack tries to statically bundle any literal-string `import()` specifier by default);
fixed with a `turbopackIgnore` magic comment (confirmed real and Next-16-supported by grepping
`node_modules/next`'s own dist output — `webpackIgnore` does nothing under Turbopack), after which
the build passed clean. Real Playwright verification against a fresh dev server, going further than
a typical Phase 4.4 port specifically because this file's PDF-viewer code was the riskiest, most
novel thing this specific build fix needed to prove actually works at runtime, not just at build
time: a real click on Link plus a real browser `prompt()` dialog produced a genuine `<img>`; a real
click on the remove button cleared it back to empty; a real OS file-chooser upload (an actual small
PNG) round-tripped through the real `processMediaFile`/FileReader pipeline; and a real, valid tiny
PDF uploaded through the real Supabase Storage pipeline (`uploadDocumentToStorage`) produced a live
pdf.js viewer with a real rendered `<canvas>` and a real "1 / 1" page-nav label. EPUB's own viewer
was verified by bridge presence and code review only, not a real file upload — see the status
section entry above for why that tradeoff was made. Zero console/page errors. Re-checked the
account afterward to confirm zero residual mock cards.

**Real CI failure caught and fixed after this commit landed**: the `turbopackIgnore` fix above was
made after the last local `prettier --write` pass and never reformatted before committing, which
passed every local check that had already run (typecheck, eslint, build, tests) but broke the
separate `format:check` CI step on push — confirmed via the GitHub Actions API directly (this
project's own standing CI-confirmation discipline), not assumed. Fixed with a second, immediate
commit (`e28c418`) containing only a `prettier --write` diff, verified locally against exactly what
would be committed (via `git stash push -u --keep-index` to isolate the fix from unrelated
in-progress work already sitting in the working directory) before pushing, then re-confirmed green
in real CI. Lesson for every future commit in this migration: run `format:check` as the LAST step
immediately before committing, not just once earlier in the verification pass — any edit made after
an earlier `prettier --write` (a build-fix, a typecheck-fix, anything) can reintroduce formatting
drift that only `format:check` itself would catch.

**Phase 4.4 (`source-table.js` → `app/dotto/lib/sourceTable.ts`)**: `node --check` on all 5 touched
vanilla files, `eslint` clean (zero errors or warnings), `npm run typecheck` clean on the first
pass (a real duplicate-declaration bug — `TableCard.jsx`'s own pre-existing local
`handleCellMouseDown` shadowed by an accidentally-imported same-name function from the new port —
was caught and fixed before this pass, not by it), `npm run format:check` clean after a `prettier
--write` pass run as the actual last step before committing (see the lesson just above), `rm -rf
.next && npm run build` clean, all 32 Vitest tests still green. Real Playwright verification
against a fresh dev server: real `contentEditable` typing into a `TableCard.jsx` cell persisted to
`tableData`; real clicks on Add-column/Add-row grew the table from 2×2 to 3×3; a real `ArrowRight`
keypress moved DOM focus to the adjacent cell; a real `mergeTableCells` call produced a genuine
`<td colspan="2">` in the live DOM; `importDelimitedIntoSource`'s column-matching CSV logic was
verified directly against a tagged mock source folder, correctly matching `Name`/`Age` columns by
name and appending the unmatched `City` column as new. Zero console/page errors. Re-checked the
account afterward to confirm zero residual mock cards/folders.

**Phase 4.4 is now fully complete** — every split-out concern (Phase 4.3) and every remaining
DOM-heavy vanilla file has been ported to `app/dotto/lib/*.ts`. Commits `810c8fd` through this
session's final one are all confirmed green in real GitHub Actions CI. Phase 4.5 (architectural/hub
files — `panels-hamburger.js` → `live-presence.js` → `history-autosave.js` → `srs-connections-
core.js` remainder → `window-bridge.js` → `waypoints-render-loop.js` → `core-state.js`, in that
order per the original approved plan) is next.

**Phase 4.5 (`panels-hamburger.js` → `app/dotto/lib/panelsHamburger.ts`)**: `node --check` on all
12 touched vanilla files, `eslint` clean (zero errors or warnings), `npm run typecheck` clean on
the first pass, `npm run format:check` clean after a `prettier --write` pass, `rm -rf .next && npm
run build` clean, all 32 Vitest tests still green. Real Playwright verification against a fresh
dev server, deliberately driving several real rail icons through real clicks rather than just one,
since this file is the shared mechanism EVERY rail panel in the app depends on: a real click
opened the Outline panel; a real click on a different icon (Sources) correctly switched panels
(Outline closed, Sources opened); a real click on the now-active Sources icon closed it again;
real typing into the Sources and Waypoints search inputs correctly filtered each list to zero rows
on a no-match query; a real `Escape` keypress closed the open panel via the existing global
handler's `closeAllPanels` call; and `window.__isAnyUiPanelOpen()` was checked at every stage and
matched the real DOM state throughout. Zero console/page errors. No mock data was created (pure
UI-interaction test), so no cleanup step was needed.

**Phase 4.5 (`live-presence.js` → `app/dotto/lib/canvasPresence.ts` +
`app/dotto/lib/messagingCanvasPreview.ts`)**: `node --check` on all touched vanilla files, `eslint`
clean, `npm run typecheck` clean once `FolderObj`/`Friend` got the same index-signature treatment
`SrsState`/`CardRow` needed earlier this session, `npm run format:check` clean after a `prettier
--write` pass, `rm -rf .next && npm run build` clean (this is what caught `renderMsgSnapshotCard`'s
missing `export` keyword — typecheck alone stayed clean since the file's own internal usage
already satisfied every type check it runs; only the real bundler, resolving `MsgConvo.jsx`'s
genuine `import { renderMsgSnapshotCard }` against the module's actual exports, caught the
mismatch), all 32 Vitest tests still green. Real Playwright verification against a fresh dev
server, scoped honestly around this shared test account's zero real friends/collaborators (the
actual multi-client realtime presence path needs a second authenticated account, out of reach for
a single-account session): all 27 bridges present; every presence/broadcast function's real
null-channel safety (`ensureCanvasPresenceChannel`/every `broadcast*`/`repositionAllRemoteCursors`/
`goToCollaboratorCursor` all no-op cleanly against this account's legitimately-`null`
`canvasPresenceChannel`, not throw); the pure data-transform functions (`snapshotItem`,
`sanitizeFlashcardSnapshot`, `miniLabelForItem`, `renderMsgSnapshotCard`) called directly and
checked against real expected output; `renderInlineCanvas` mounted into a real detached DOM node
and inspected for real structure; a real messaging flow (`openConvo`/`renderConvoBody`/
`closeConvo`) driven through the real `MsgConvo.jsx` component and a real click on its back
button, using a tagged mock friend injected after opening the real rail panel (seeding it before
would have been silently wiped by `refreshMessagesPanel`'s own real Supabase round-trip — caught
via a real failed run first); and a real `TitleCard.jsx` dropdown change (after a real click into
`.editing` mode) updated both `level` and the live DOM `fontSize`. Zero console/page errors.
Re-checked the account afterward to confirm zero residual mock items/friends.

**Phase 4.5 (`history-autosave.js` → `app/dotto/lib/historyAutosave.ts`)**: `node --check` on all 6
touched vanilla files, `eslint` clean, `npm run typecheck` clean (after fixing
`__registerPaneCanvasListenerSetup`'s ambient type — it was declared as a 1-argument callback when
the real `core-state.js` implementation always calls it with 2), `npm run format:check` clean after
a `prettier --write` pass run as the actual last step before committing, `rm -rf .next && npm run
build` clean, all 32 Vitest tests still green. **Also caught and fixed a real, pre-existing,
project-wide production bug this port's own `canvasItemBehavior.js` import happened to surface**:
every `app/dotto/lib/*.ts` port's bridge-assignment block runs at bare module top level, and
`canvasItemBehavior.js`'s new import of this port was the first point in `app/dotto-app.jsx`'s
whole import graph where such a block actually executes during Next's real SSR pass — where
`window`/`document` don't exist yet, a real `ReferenceError` confirmed via the dev server's own
log and a real `GET / 500` on every request. Bisected with `git stash` against `HEAD` (commit
`db6b97a`) to confirm this wasn't specific to this port's own changes: the identical crash
reproduces at `HEAD` too, in both `npm run dev` and a real `npm run build && npm run start`
production server — a bug already live on `main`, affecting every authenticated user's first or
refreshed page load (client-side hydration apparently recovered afterward, which is presumably why
it went unnoticed by users and by every prior port's own Playwright verification). Fixed properly
across all 17 affected files (see the Status section entry above for the full list) by guarding
each bridge block with `if (typeof window !== "undefined") { ... }`
(`gamesFlashcardTyperight.ts`'s one `document.addEventListener` call got its own `if (typeof
document !== "undefined")` guard instead), then re-verified at three levels: `npm run build && npm
run start` with 3 real authenticated Playwright reloads showing zero console errors or server
500s; a fresh `npm run dev`, same result; and this port's own full verify script passing clean.
Real Playwright verification of the port itself against a fresh dev server: undo/redo via a real
card add + real `__undo`/`__redo` round trip, item count checked at each step; camera transform via
a real mouse-wheel pan (`tx`/`ty` change) and a real Ctrl+wheel zoom (`scale` change); the canvas
right-click context menu opened via a real right-click on a screen point verified blank via
`elementFromPoint` (a card's own image can otherwise intercept the click) and closed via the real
`hideCanvasContextMenu()` plain global; and the full autosave/load round trip via a real title
edit, `scheduleWorkspaceSave()`, a real page reload, and confirming the new title survived a real
Supabase round trip. Zero console/page errors. Cleanup restored the edited card's original title
and removed the mock undo/redo test card.

**Phase 4.5 (`srs-connections-core.js` → `app/dotto/lib/srsConnectionsCore.ts`)**: `node --check`
on all 14 touched vanilla files, `eslint` clean, `npm run typecheck` clean on the first real pass
(after fixing `__registerPaneCanvasListenerSetup`'s ambient type, described above — a real
pre-existing bug, not introduced by this port, caught here because this was the first port to
actually register a 2-argument callback through it), `npm run format:check` clean after a
`prettier --write` pass run as the actual last step before committing, `rm -rf .next && npm run
build` clean, all 32 Vitest tests still green. Also re-verified the SSR-safety fix from the
previous port still holds for this one: a real `npm run build && npm run start` production server,
3 real authenticated Playwright reloads, zero console errors or server 500s — this port added a
new module-top-level `if (typeof window !== "undefined") { ... }`-guarded bridge block
(`srsConnectionsCore.ts` itself) to the same import graph that bug lived in, so re-confirming it
here (not just trusting the previous port's fix) was worth the few extra minutes. Real Playwright
verification against a fresh dev server: `add()` via a real bridge call producing a real item;
a full click-to-link + `CardStreamIO` data-flow round trip (two real mock cards, `isValidConnection`
+ two real `handleDataModeClick` calls + `applyConnections` actually copying a real table row from
a mock source onto a mock flashcard's own `cards` array — end-to-end real data movement, not just a
bridge-presence check); a real `w` keypress opening the Waypoints panel through the real global
keydown handler; a real click on the live pen-tool button setting both `appState.drawTool` and its
own `active` class; and a real pointerdown-drag-pointerup gesture on the live zoom-track element
changing `appState.scale`. Re-ran the previous port's own verify script afterward too, since this
port also touched several files (`core-state.js`, `waypoints-render-loop.js`,
`ai-assistant-suggestions.js`, `profile-achievements-pricing.js`, `theme-toggle.js`,
`upload-popup.js`) that port's own script exercises — passed clean, no regression. Zero
console/page errors across both scripts. Cleanup removed every mock item/folder/connection created
during the run.

**Phase 4.5 (`waypoints-render-loop.js` → `app/dotto/lib/waypointsRenderLoop.ts`)**: `node --check`
on all 10 touched vanilla callers, `eslint` clean, `npm run typecheck` clean (after fixing two real
pre-existing type bugs — `__renderSourcesList`/`__renderFilesList`/`__renderHubCollabList`/
`__renderWaypointsList`'s `query` param wrongly required instead of optional,
`__openFolder`'s return type wrongly sync instead of the real `Promise<void>`), `npm run
format:check` clean after a `prettier --write` pass run as the actual last step before committing,
`rm -rf .next && npm run build` clean (TypeScript checking took an anomalous 17.1 minutes on the
very first run after this port landed — re-ran immediately and got 1.67s, confirming a one-time
Turbopack cache-warming cost against this migration's largest new file, not a real regression), all
32 Vitest tests still green. Re-verified the SSR-safety fix from the `history-autosave.js` port
still holds against this port's own new bridge block too: a real `npm run build && npm run start`
production server, 3 real authenticated Playwright reloads, zero console errors or server 500s.
Real Playwright verification against a fresh dev server, deliberately going deeper than a
bridge-presence check given `render()`'s real risk profile (called on every single state change
across the whole app): a real note-card click-to-edit-and-type-and-blur round trip persisting
`it.html`; a real mock folder card created, clicked, and navigated into end-to-end
(`attachFolderCardClick` → `openFolder` → `applyFolderView` → `render()`, confirmed via a real
`currentFolderId` check, then navigated back out); a real double-click folder rename
(`startRenameFolderCardTitle`) that persisted the new title; a real mouse hover that visibly widened
a waypoint card via `attachWaypointCardBody`/`expandWaypointCard`'s real `getBoundingClientRect`-
driven width transition; and a real Shift+drag box selection (`startBoxSelection`) that correctly
picked up all 3 mock cards via real screen-to-world coordinate conversion. Mock cards were placed in
a large empty world-coordinate area (x/y 5000+, camera panned out to it first) specifically to avoid
colliding with this shared test account's real content — a real collision was hit and fixed during
this port's own test-writing pass (a mock note card placed near the origin landed under a real table
card and silently ate every click, caught by a real Playwright timeout, not assumed). Also re-ran
both `verify-phase4-5-historyautosave-port.js` and `verify-phase4-5-srsconnectionscore-port.js`
afterward as regression checks, since this port touched several files those scripts exercise
(`core-state.js`, `hamburger-collab.js`, `card-shortcuts.js`, `cards-misc.js`,
`ai-assistant-suggestions.js`) — both passed clean, no regression. Zero console/page errors across
every script. Cleanup removed every mock item/folder created during the run and restored the
original folder/camera.

**This closes out the two hardest Phase 4.5 ports (`live-presence.js` and
`waypoints-render-loop.js`, per the plan's own risk assessment) — 5 of 7 done.** Remaining 2:
`window-bridge.js` (still blocked on the paused Phase 4.1 files — see its own status entry above)
and `core-state.js` (the `appState` singleton, deliberately saved for last since everything reads
it).

**Phase 4.5 (`core-state.js` → `app/dotto/lib/coreState.ts`)**: `node --check` on all 22 touched
vanilla callers, `eslint` clean, `npm run typecheck` clean (after adding ambient types for 3
bridges that already existed at runtime but had never been typed — `__DOTTO_USER__`,
`__setActivePaneId`, `__bringCardToFront`), `npm run format:check` clean after a `prettier --write`
pass run as the actual last step before committing — then re-verified `NON_LATIN_SCRIPT_RE`/
`CLOZE_RE` byte-for-byte against the original vanilla file via `python3`/`repr()` a second time,
since prettier reformats the file and a corruption of this exact class (see the status entry above)
would be invisible to a normal read either way. `rm -rf .next && npm run build` clean, all 32
Vitest tests still green. Real production-server check
(`npm run build && npm run start`, 3 real authenticated Playwright reloads): zero console errors or
server 500s, and `appState.currentUser` confirmed as the real logged-in test account (real
`id`/`username`/achievements) rather than the guest fallback — the one thing this port's own
`ensureCoreState()` timing fix (called from `DottoApp`'s render body, not a plain side-effect
import) exists specifically to get right. Real Playwright verification against a fresh dev server:
re-ran all 5 previous Phase 4.5 verify scripts (`panels-hamburger`, `live-presence`,
`history-autosave`, `srs-connections-core`, `waypoints-render-loop`) as regression checks first —
every one of them depends on `window.__getAppState()` now coming from this exact file, and all 5
passed clean, the single largest regression-check batch this migration has run for one port. Then a
new script targeting the one piece of real, distinctive logic `core-state.js` alone owns and
nothing else had exercised: split-screen pane switching. A real second pane created via the same
`window.__splitPaneWithTab` bridge `TabsBar.jsx`'s own drag-to-split gesture calls, confirmed via a
real mounted `#canvas-N` DOM element, not just state; a mock folder navigated into on the new pane;
`switchActivePane` back to pane 0 confirmed via a real `appState.currentFolderId` check that pane
0's OWN folder came back correctly (not left stuck on the new pane's folder, not reset to root);
switching to the new pane again confirmed its own folder was correctly saved and restored too — real
swap-in-place pane-state correctness verified in both directions. Zero console/page errors across
every script run this port (6 Phase 4.5 verify scripts plus the dev/prod SSR safety checks).
Cleanup closed every pane and removed every mock folder created during the run.

**This closes out Phase 4.5's single riskiest remaining target and the whole phase's real
architectural core — 6 of 7 done.** Only `window-bridge.js` remains, still blocked on the paused
Phase 4.1 files.

**Phase 4.5 (`cards-misc.js` → `app/dotto/lib/cardsMisc.ts`)**: `node --check` on the 3 touched
vanilla files (`dotto-script.js`, `window-bridge.js`, `drawing-connections.js`, the last for one
stale comment reference), `eslint` clean, `npm run typecheck` clean, `npm run format:check` clean
after a `prettier --write` pass run as the actual last step before committing, `rm -rf .next &&
npm run build` clean, all 32 Vitest tests still green. One real bug caught and fixed mid-port: an
initial `const appState = window.__getAppState!();` captured once at this file's own module top
level (following `core-state.js`'s established "capture once, mutate in place" precedent) crashed
both server-side (`ReferenceError: window is not defined`) and client-side
(`window.__getAppState is not a function`) — that precedent only holds for files with their own
`wireX()` deferring initialization past mount; `cardsMisc.ts`, like `waypoints-render-loop.js`, is
a plain side-effect import with no `wireX()`, so its module body runs at import time, before
`DottoApp`'s render body has called `ensureCoreState()`. Fixed by reading
`window.__getAppState?.()` lazily inside `addTask` only (the sole function that needs it), same
lazy-read pattern `stopwatch.ts` already used for the identical reason. Real production-server
check (`npm run build && npm run start`): zero console errors or server 500s. Real Playwright
verification, run against both the dev server and the real production server: bridge-existence
checks for all 10 bridges this port owns; `shortUrl`/`toEmbeddableUrl` pure-logic checks against a
real YouTube URL (hostname extraction, embed-URL rewriting with the `origin` param, and a
non-YouTube/Vimeo URL passing through unchanged); a real Embed card (mock item, `kind: 'embed'`)
rendering `EmbedCard.jsx`'s real `shortUrl()`/`toEmbeddableUrl()` imports correctly in the DOM
(header text + iframe `src`); a real `editEmbed()` click round trip (`window.prompt` overridden
in-page to return a new URL, since native dialogs can't be typed into from `page.evaluate`)
confirming the click actually reaches the real import and updates `it.embedUrl`; a real Checklist
card (mock item, `kind: 'checklist'`) round-tripping `toggleTask`/`updateTaskText`/
`updateTaskDeadline`/`addTask`/`removeTask` through real checkbox clicks, contentEditable typing, a
native date-input fill, and add/remove button clicks, each verified against the actual
`appState.folders[...].items[...].tasks` array afterward; a direct smoke test of the same plain
`window.toggleTask`/etc. globals called independently of the React components, confirming
`renderChecklistHTML`'s own generated inline `onclick`/`onchange`/`oninput` attributes still have a
real target to call; and `renderStatcardHTML`'s bridge output checked for the correct computed
value/caption for a `statKind: 'progress'` item. One real third-party noise source filtered the
same way `example.com/test.pdf`/404 noise already was: `player.vimeo.com`'s own CORS/
`PresentationRequest` console errors, from the real Vimeo iframe the `editEmbed()` test
intentionally loads via `toEmbeddableUrl`'s real Vimeo-rewriting branch — also caught a gap in this
port's own verify script where `pageerror` events weren't filtered through the same noise regex
`console` events already were, fixed before the noise could mask a real failure. Regression-verified
both `verify-phase4-5-corestate-port.js` and `verify-phase4-5-waypointsrenderloop-port.js` clean
afterward, since `cardsMisc.ts` sits directly on `__getAppState`/`__findItemById`/`__saveSnapshot`/
`__render` from both. Cleanup removed every mock item created during the run.

**Phase 4.5 (`library-publish.js` → `app/dotto/lib/libraryPublish.ts`)**: `node --check` on the 3
touched vanilla files (`dotto-script.js`, `window-bridge.js`, `blocks-panel.js`), `eslint` clean,
`npm run typecheck` clean (after fixing a real pre-existing ambient-type inaccuracy —
`__renderInlineCanvas`'s `connections`/`onDelete` params declared required when the real
implementation always treats them as optional), `npm run format:check` clean after a
`prettier --write` pass run as the actual last step before committing, `rm -rf .next && npm run
build` clean, all 32 Vitest tests still green. Learned from `cardsMisc.ts`'s own port earlier this
session: this file has 9 functions reading `appState`, not 1, so every one uses a lazy
`getAppState()` helper called at the top of its own body — the same convention
`marketplace.ts` (a Phase 4.4 port) already established for plain-side-effect-import files with no
`wireX()` — rather than a module-top-level capture, avoiding a repeat of that exact crash outright
instead of fixing it after the fact. Real production-server check (`npm run build && npm run
start`): zero console errors or server 500s. Real Playwright verification, run against both the
dev server and the real production server: a real click on the Blocks rail icon opening `#add-menu`;
a real `__openItemDetail()` call (matching `blocks-panel.js`'s own real call shape) correctly
populating every DOM field (title/price/description/canvas preview) and toggling the right
draft/published/purchased view classes; `ItemDetailFooter.jsx`'s real rendered button set checked
for both `sourceFolder` states; a real contentEditable triple-click-type-blur through
`ItemDetailTitle.jsx`'s real `commitItemDetailTitle` import persisting the new title into
`appState.detailItem.title`; a real `startPublishFlow` → `PublishFlowName.jsx`'s real
`focusPublishFlowName` import (via a real mousedown, confirmed via `document.activeElement`) →
`confirmPublishFlow` (the real inline `onclick="confirmPublishFlow()"` target) round trip back to
the library view; a real price-field edit through the real inline `oninput` target correctly
enabling the Update button via `onItemDetailFieldChange`; `updateDetailItem`/`unpublishDetailItem`/
`deleteDetailDraft` all exercised via real `ItemDetailFooter.jsx` button clicks, each verified
against real `appState` reads afterward; `__deleteMyCreationItem` exercised directly, matching
`blocks-panel.js`'s own real call shape. Every mock item used a real `crypto.randomUUID()` id —
`marketplace_listings.id` is a real `uuid` column, and an early version of this port's own verify
script used a plain string id, which failed with a real Postgres `invalid input syntax for type
uuid` 400 error instead of the intended silent 0-rows-affected no-op; fixed before the script was
considered done, not worked around. Every real Supabase update/delete call this port makes
(`commitItemDetailTitle`/`updateDetailItem`/`unpublishDetailItem`/`deleteDetailDraft`/
`deleteMyCreationItem`/`confirmPublishFlow`) was exercised for real against these real-UUID-shaped
but nonexistent ids, so each one safely no-ops without ever touching real data — not skipped, not
mocked. Also found and fixed the identical class of bug in a pre-existing (Phase 2, gitignored)
regression script, `verify-phase2-contenteditable.js`, while re-running it as a regression check
(it directly exercises `ItemDetailTitle.jsx`/`PublishFlowName.jsx`, both touched by this port): the
same plain-string-id Postgres 400, `window.__startPublishFlow` no longer existing now that this
port dropped its bridge (its only real consumer, `ItemDetailFooter.jsx`, now uses a real import —
fixed by clicking the real Publish button instead, more faithful to an actual user flow than the
direct bridge call it replaces), a stale `#btn-library` click (the Plugins panel — `#item-detail-view`
actually lives inside `#add-menu`, the Blocks panel, predating the Library→Blocks/Plugins
repurposing), and a missing 404-noise filter every later Phase 4.x script already carries. Both
scripts confirmed clean afterward, zero console/page errors, in both dev and production modes.

**Phase 4.5 (`profile-achievements-pricing.js` → `app/dotto/lib/profileAchievementsPricing.ts`)**:
`node --check` on the 9 touched vanilla files (`dotto-script.js`, `window-bridge.js`,
`friends-presence.js`, `drawing-connections.js`, `search-orchestration-selection.js`,
`hamburger-collab.js`, `app-init.js`, `mnemonic-search-matching.js`, `table-grid-resize.js`, the
last for one stale comment reference), `eslint` clean, `npm run typecheck` clean (after adding
ambient types for 8 bridges that had never been typed before this port needed them —
`__setProfileLevel`/`__setAchievements`/`__setPricingOverlayOpen`/`__ACHIEVEMENTS`/
`__SPRITE_TOTAL_COUNT`/`closeDotbotUpgradeModal`/`showProfileMainView`/`showProfileSettingsView`),
`npm run format:check` clean after a `prettier --write` pass run as the actual last step before
committing, `rm -rf .next && npm run build` clean, all 32 Vitest tests still green. The real design
work here, beyond the by-now-established lazy-`getAppState()` discipline: this file has genuine
module-load-time side effects (the initial `renderProfileLevel()`/`renderSpriteGrid()` calls, the
achievement-bump interval, the usage-tooltip mousemove listeners, and wiring the Profile rail icon
itself via `window.__wireRailIcon`) — the first two Phase 4.5-batch ports this session
(`cardsMisc.ts`, `libraryPublish.ts`) only ever needed appState reads deferred, not real DOM
wiring, so this one needed a proper `wireProfileAchievementsPricing()` (following
`app/dotto/lib/dayChangeAndAdNotifications.ts`'s own established "a single readiness check isn't
enough here" precedent almost exactly), polling for both `window.__getAppState` and
`window.__wireRailIcon` — the first bridge-readiness poll in this migration waiting on two
independently-owned bridges at once. One real bug caught and fixed by the verify script actually
checking real *values*, not just bridge presence: `window.__ACHIEVEMENTS`/`__SPRITE_TOTAL_COUNT`
were initially set behind a module-scope `if (window.__getAppState) { ... }` guard, which looked
like the same safe pattern other true-constant bridges use — but is provably always-false at
module-eval time (not just occasionally racy), since module eval unconditionally completes before
`DottoApp`'s own render body — where that bridge actually gets set — ever runs; fixed by moving the
assignment inside `doWire()`, where `appState` is genuinely available. 6 real vanilla-to-vanilla
direct imports fixed (`friends-presence.js`/`drawing-connections.js`/
`search-orchestration-selection.js`'s `bumpAchievementStat`,
`hamburger-collab.js`'s `closeProfilePanel`/`openPricingOverlay`,
`app-init.js`/`mnemonic-search-matching.js`'s `refreshDotbotUsage`/`openDotbotUpgradeModal`), 3
brand-new bridges added for functions that had never needed one before this port
(`__refreshDotbotUsage`/`__closeProfilePanel`/`__openDotbotUpgradeModal`). One genuinely dead
plain-global caught and not carried forward: `closePricingOverlay`'s old `window-bridge.js`
re-export had zero real callers anywhere (`PricingOverlay.jsx` closes itself directly via
`pricingOverlayStore.set(false)`; the only real caller of `closePricingOverlay` at all reaches it
through the `__`-prefixed bridge, from `historyAutosave.ts`'s Escape handler) — same
"genuinely dead, don't perpetuate" precedent `cardsMisc.ts`'s port set with `commitItemDetailDesc`.
Real Playwright verification against both a dev server and a real production server: bridge
existence AND real-value checks for all 15 bridges this port touches (not just presence — the 2
true constants checked against their actual expected values); a real click on the Profile rail
icon opening `#profile-panel`, proving the bridge-readiness poll actually wired it on a fresh page
load; the real level pill and all 108 real achievement-grid sprite cells rendered correctly from
this port's own wire-time calls; a real `refreshDotbotUsage()` Supabase read against the
signed-in test account populating the usage-bar tooltips with real data; real
`showProfileSettingsView`/`showProfileMainView` sub-view toggle clicks; a real
`openDotbotUpgradeModal()`/`closeDotbotUpgradeModal()` round trip through both the bridge call and
the real "Got it" button's inline `onclick` target; a real
`closeProfilePanel()`/`openPricingOverlay()`/`closePricingOverlay()` round trip including the real
inline `onclick="openPricingOverlay()"` upgrade-hint click; a real `renderAvatarInto()`
img-with-fallback round trip via a real broken-image error event. One real Playwright quirk hit and
worked around: `#btn-profile` sits at the exact bottom-left screen position Next.js's own dev-mode
floating indicator badge occupies, so even a `force: true` coordinate-based mouse click lands on
the overlay instead — switched to an in-page `element.click()` call (still exercises the identical
real DOM `click` listener `wireRailIcon` attaches; confirmed identical behavior against the real
production build, which has no such overlay). Regression-verified
`verify-phase4-5-corestate-port.js`, `verify-phase4-5-panelshamburger-port.js`, and
`verify-phase4-5-srsconnectionscore-port.js` all clean afterward. Zero console/page errors in
either mode. `awardUserPoints`/`bumpAchievementStat` deliberately NOT exercised with new real RPC
calls in this port's own verify script — unlike every other real Supabase call this migration's
scripts make against safely-nonexistent mock ids, these two mutate the real signed-in test
account's own score/achievement row with no safe fake-id equivalent available, and
`gamesFlashcardTyperight.ts`'s own verify script already exercises `__awardUserPoints` for real via
`fcFlip`/`trCheck` — a documented scope decision, not an oversight.

**Phase 4.5 (`card-shortcuts.js` → `app/dotto/lib/cardShortcuts.ts`)**: `node --check` on the 2
touched vanilla files (`dotto-script.js`, `window-bridge.js`), `eslint` clean, `npm run typecheck`
clean (after adding an ambient type for `setTableAlign`, never declared before this port needed
it), `npm run format:check` clean after a `prettier --write` pass run as the actual last step
before committing, `rm -rf .next && npm run build` clean, all 32 Vitest tests still green. This is
the last of the 4 immediately-portable `window-bridge.js`-owning files this batch targeted, and the
first of the 4 with genuine always-on global listeners (Option-held tracking ×3, hover-scoped
game-card shortcuts, PDF arrow-key routing) rather than pure functions or appState-dependent DOM
writes — needed a real `wireCardShortcuts()`, but (unlike `profileAchievementsPricing.ts`'s
dual-bridge poll) a single `window.__getAppState` readiness check was enough, matching
`app/dotto/lib/sourceButtonsCursorMode.ts`'s own established shape, since nothing here needs an
external bridge like `__wireRailIcon` to be ready first. One real documentation bug fixed, not just
carried forward: the original file's own `deleteSelectedCards` comment said "see the Backspace
keydown handler" without saying where — grepped for the real callers and found they live in
`app/dotto/lib/copyPaste.ts`/`app/dotto/lib/sourceButtonsCursorMode.ts` (via the
`__deleteSelectedCards` bridge), not in this file itself; made precise rather than copied verbatim.
`window-bridge.js`'s own import line and 1 re-export line removed — it now imports from 4 files
instead of 5, exactly the circular 4-file cluster (`ai-assistant-suggestions.js`/
`hamburger-collab.js`/`friends-presence.js`/`source-tags-ai.js`) this batch always expected to be
left once the 4 immediately-portable files were done. Real Playwright verification against both a
dev server and a real production server: real Alt keydown/keyup/window-blur events correctly
toggling `body.option-held`, including the stuck-on-alt-tab-guard path (a real `blur` event, not
just a keyup); a real `__deleteSelectedCards()` call removing a plain multi-selection with zero
`confirm()` prompts, and a separate real call with a source-kind item correctly triggering the
irrecoverable-data `confirm()` gate via real Playwright dialog interception
(`page.on('dialog', ...)`, not stubbed) — dismissing it correctly left the item in place; a real
`setTableAlign()` call against the live `#context-menu` DOM element setting `it.textAlign` and
closing the menu; a real mouse-hover (`page.mouse.move` to the item's actual on-screen position,
not a CSS class hack) plus a real Space keypress correctly routing through `hoveredGameCard()` to
`fcFlip()`, then a real "4" keypress correctly routing to `fcRate('easy')`; a real hover plus
ArrowRight keypress on a minimal mocked PDF-card DOM (a real `.item.media` element with two real
`.pdf-viewer-nav-btn` buttons, `window.__findItemById`/`__parseItemId` narrowly stubbed only for
that one mock id, every other id resolution left untouched) correctly routing to the real
next-page button's own `.click()`. Two real bugs caught and fixed in this port's own verify script
before it was considered done, not worked around: (1) an initial mock table item used `rows`
instead of the real `tableData` field `TableCard.jsx`/`sourceTable.ts` actually expect, which
crashed the whole React tree with a real, uncaught `TypeError` (`it.tableData[0]` on `undefined`) —
caught by checking the dev server's own error log after the script's later assertions started
failing for what looked like an unrelated reason, not assumed away; (2) rating a freshly-created,
unconnected mock flashcard collapsed `fcStats` back to empty immediately, because
`srs-connections-core.js`'s real "orphaned-SRS integrity sweep" (`propagateCanvasStreams`) runs on
every `render()` and legitimately resets any flashcard whose `card.srs` looks real but isn't fed by
an actual connection — the exact mechanism `verify-phase4-4-gamesflashcardtyperight-port.js`'s own
script already documented and worked around (stub `window.__render` to a no-op for the one keypress
under test, read state, then restore and re-trigger); the identical technique applied here.
Regression-verified `verify-phase4-5-corestate-port.js`, `verify-phase4-4-gamesflashcardtyperight-port.js`,
and `verify-phase4-4-copypaste-port.js` all clean afterward (the last two exercise
`hoveredGameCard`/`fcFlip`/`fcRate` and the `__deleteSelectedCards` bridge this port's own routing
sits directly on top of). Zero console/page errors across every script in both modes.

**Phase 4.5 (`ai-assistant-suggestions.js`/`hamburger-collab.js`/`mnemonic-search-matching.js` →
`app/dotto/lib/aiAssistantSuggestions.ts`/`app/dotto/lib/hamburgerCollab.ts`/
`app/dotto/lib/mnemonicSearchMatching.ts`)**: `node --check` on the 7 touched vanilla files
(`dotto-script.js`, `window-bridge.js`, `text-utils.js`, `command-palette.js`,
`search-orchestration-selection.js`, `friends-presence.js`, `search-panel-history.js`,
`source-tags-ai.js`), `eslint` clean, `npm run typecheck` clean (after fixing 2 real
provably-wrong pre-existing ambient types — `__goToWaypointCard`'s `itemId` and
`__dispatchListPanelDelete`'s `ids`, both really numbers/strings respectively everywhere else in
the codebase, plus `sourceButtonsCursorMode.ts`'s own matching `Set<number>` field-type bug — and
adding ambient types for ~25 previously-untyped React store setters this port's own new .ts files
needed to call), `npm run format:check` clean after a `prettier --write` pass run as the actual
last step before committing, `rm -rf .next && npm run build` clean (confirming the genuine
3-file circular import resolves correctly at both compile time and real SSR — no
module-evaluation-order crash), all 32 Vitest tests still green. The largest and most
cross-cutting port of this whole migration, by a wide margin — 2,338 combined original lines
across 3 files, ~150 real call sites re-pointed across roughly 20 other files. Before writing any
code, spent a dedicated pass building a complete caller map (every real import, every existing
bridge, every inline-HTML target) across the entire repo for all 3 files' full combined export
surface — given the scale, treated as worth doing upfront rather than discovering gaps mid-port;
even with that pass, 2 real gaps still only surfaced during the port itself (documented in the
status entry above: a half-added `__commenceDotbotSearch` bridge missing its actual assignment,
and `search-orchestration-selection.js` needing 4 more bridges the original caller map had
correctly, but only faithfully, recorded as "not yet a bridge, still a plain import" before this
port existed to convert it into one) — both caught by the port's own verify script and fixed
before it was considered done, not discovered later. `text-utils.js` deliberately stayed vanilla
rather than porting alongside the trio (3 real vanilla files still import it directly) — now sets
its own `escapeHtml`/`stripHtml` bridges directly instead of being re-exported through
`aiAssistantSuggestions.ts`, matching the `srs-algorithm.js` precedent for genuinely pure files.
`window-bridge.js` now imports from only 2 files (`friends-presence.js`/`source-tags-ai.js`), down
from 8 at the start of this session's Phase 4.5 sub-effort. Real Playwright verification against
both a dev server and a real production server: all 30 bridges checked for real presence (not
just type); a real click on the Queries/AI rail icon confirming both the animated-placeholder
module-load-time loop and the rail-icon wiring actually ran; a real keystroke triggering a real
`/api/dotbot/suggest` round trip and populating live suggestions; a real
`commenceSearchOrMnemonic` → `commenceDotbotSearch` call completing a real
`/api/dotbot/orchestrate` round trip across the cross-file boundary end-to-end (the real Groq
provider call itself failed with a genuine, sandbox-network-restricted `502` — confirmed via the
dev server's own log as an external infrastructure limit, not a code defect — and the real
error-rendering path correctly handled it, which is what this check actually verifies, not
whether the AI provider itself is reachable); real rail-icon clicks opening the
Waypoints/Sources/Files/Collaborations panels, each confirmed to have run its own real data-fetch
(including a real `refreshCanvasCollabData` Supabase round trip for Collaborations); a real
`#sources-panel-search` keystroke filtering to the empty state; a real `hmenuAction('upgrade')`
call opening `#pricing-overlay`; a real `__flashCanvasElement()` call exercising the
`hamburgerCollab.ts` → `mnemonicSearchMatching.ts` cross-file import directly; real
`escapeHtml`/`stripHtml`/`countSourceEntries`/`findParentFolderId` bridge calls checked against
real expected output; a real Escape keypress closing `#ai-panel` through
`historyAutosave.ts`'s existing global handler → `__clearSearch` → `closeRailView` →
`resetAiSearchState`. Regression-verified 6 prior Phase 4.4/4.5 scripts — the widest regression
batch this migration has run for a single port —
`verify-phase4-5-corestate-port.js`/`verify-phase4-5-panelshamburger-port.js`/
`verify-phase4-5-profileachievementspricing-port.js`/`verify-phase4-5-srsconnectionscore-port.js`/
`verify-phase4-5-historyautosave-port.js`/`verify-phase4-5-cardshortcuts-port.js` — all clean
afterward. Zero console/page errors across every script in both modes, beyond the one confirmed-
external `502` deliberately whitelisted with a documented reason, not silently swallowed.

**Phase 4.5 (`friends-presence.js`/`messages-schedule.js` → `app/dotto/lib/friendsPresence.ts`/
`app/dotto/lib/messagesSchedule.ts`)**: `node --check` on the 5 touched vanilla files
(`dotto-script.js`, `window-bridge.js`, `app-init.js`, `command-verbs.js`, `drag-drop-chat.js`),
`eslint` clean, `npm run typecheck` clean (after adding ambient types for 5 previously-untyped
React store setters — `__setCollabList`/`__setCollabPill`/`__setMsgList` — plus the 2 plain-global
`handleCollabSearch`/`handleMsgSearch` and the 2 new outbound bridges this port needed, and casting
one cross-file call, `__renderConvoBody`, to the existing `Record<string, unknown>` ambient shape),
`npm run format:check` clean after a `prettier --write` pass run as the actual last step before
committing, `rm -rf .next && npm run build` clean, all 32 Vitest tests still green. The last
genuinely circular pair in this migration, co-located into `app/dotto/lib` the same way the
ai/hamburger/mnemonic trio resolved its own circularity — `friendsPresence.ts` imports
`openMessagesPanel` from `messagesSchedule.ts`, which imports `renderMsgList` back, with neither
binding read at module-evaluation time. 8 real bridges dropped in favor of real same-tree imports
(`collabBubblePaneClick`/`collabBubblePaneMouseEnter`/`collabBubblePaneMouseLeave` into
`PaneTopBar.jsx`; `openMsgRequestsView`/`backToMsgMain`/`handleAddFriendClick`/
`respondToMsgRequest` into `MessagesListPanel.jsx`; `handleCollabAddRemoveClick` into
`CollabListPanel.jsx`). 2 new outbound bridges (`__refreshFriendsData`/`__resolveUsernameToUserId`)
for `app-init.js`'s bootstrap and `command-verbs.js`'s `invite`/`remove` verbs respectively.
`window-bridge.js`'s dead `window.openCollabPanel` plain-global re-export dropped (confirmed via a
repo-wide grep — no real inline `onclick` target left) rather than carried forward; its
`handleCollabSearch`/`handleMsgSearch` re-exports also dropped, now set directly by
`friendsPresence.ts` itself. Full repo-wide stale-filename sweep via the established `python3`
walk-and-string-search technique (plain `grep` again missed hits due to the known em-dash/locale
quirk) — fixed current-tense pointers across `app/dotto-app.jsx`, `app/dotto/Avatar.jsx`,
`app/dotto/bridges.js`, `app/dotto/PaneTopBar.jsx`, `app/dotto/lib/canvasPresence.ts`,
`app/dotto/lib/profileAchievementsPricing.ts`, `app/dotto/lib/notificationsStore.ts`,
`app/dotto/lib/dayChangeAndAdNotifications.ts`, `app/dotto/lib/dateKey.ts`,
`app/dotto/lib/panelsHamburger.ts`, `app/dotto/lib/messagingCanvasPreview.ts`,
`app/dotto/lib/srsConnectionsCore.ts`, `app/dotto/lib/vanillaBridges.d.ts`,
`content/fragments/hamburger-stack.html`, `content/fragments/top-bar.html`; left historical/
past-tense "previously imported these directly" phrasing alone in `vanillaBridges.d.ts` and
`canvasPresence.ts`, matching established convention.

Two real, pre-existing product-level gaps found and documented (not fixed, confirmed unrelated to
this port and out of scope for a migration port) while writing this port's own real two-account
verify script — the first Phase 4.5 verify script this migration has needed two real browser
contexts/accounts for, driven through an actual friend-request → accept → per-canvas-collaborate
→ chat → presence flow rather than mocked `appState` data, using a second real test account
created via a new `setup-test-account2.js`:
1. `invite_canvas_collaborator` — called with the exact params its own migration
   (`supabase/migrations/20260808_fix_canvas_collab_reinvite.sql`) defines, unchanged from the
   original vanilla call site — returns a real PostgREST `PGRST202` "function not found" against
   the live Supabase project this dev server points at (`NEXT_PUBLIC_SUPABASE_URL`); its own error
   hint even suggests the differently-named `revoke_canvas_collaboration`, which does exist, as the
   nearest match. Either that one migration was never applied to this project or its PostgREST
   schema cache is stale — confirmed genuinely reproducible (not a testing artifact) via direct
   repro outside the verify script too. Out of scope to fix from an agent session against a live,
   shared Supabase project without explicit operator action; the verify script instead confirms the
   call fires with the correct name/params (via the real, documented error it produces) and that
   the button correctly stays un-pended given the real failure.
2. `handleFriendPresenceSync` (also unchanged from the original) reads `metas[0].status` off a
   friend's Realtime Presence state to detect online/afk/offline transitions — but re-calling
   `channel.track()` on an already-tracked presence channel was confirmed, via direct repro against
   a freshly created account pair with no prior state (ruling out test-run pollution), to append a
   SECOND meta under the same key rather than replacing the first, so `metas[0]` keeps reading the
   stale first ("online") entry and the online→afk transition is never observed by the peer, even
   though the local side's own `resetAfkTimer`/`setLocalPresenceStatus` are proven correct
   (`localPresenceStatus` flips to `'afk'` right at `AFK_THRESHOLD_MS`, and `channel.track` visibly
   adds the new `'afk'` meta on the peer's own copy of the shared channel — both checked directly).
   The cross-account "X is away" notification itself is what's blocked; the verify script checks
   the local flip and the track() call's own effect instead of the notification.

Real Playwright verification against both a dev server and a real production server: bridge
existence for all 12 (`__openCollabPanel`/`__renderCollabPill`/`__syncCanvasCollabTitle`/
`__closeCollabPanel`/`__renderMsgList`/`__refreshCanvasCollabForCurrentFolder`/
`__activePaneCollabBubbleEl`/`__refreshFriendsData`/`__resolveUsernameToUserId`/
`__closeMessagesPanel`/`handleCollabSearch`/`handleMsgSearch`); a real friend-request search + Add
click, waiting on real button-text state rather than a fixed delay; a real incoming-request
notification + Accept flow, deliberately establishing account2's own baseline (an empty messages-
panel open) *before* account1's request existed, confirming `refreshFriendsData`'s "haven't heard
from this channel yet" vs. "seen already" distinction actually works, not just its happy path; a
real per-canvas Collaborators bubble hover/click/invite — real-hovering the parent
`.pane-breadcrumb-pill` first (`.pane-collab-bubble` is `max-width:0`/`opacity:0` until hovered,
confirmed by direct CSS inspection, not assumed), and navigating into a real non-root folder first
(the bubble correctly no-ops on `root`, confirmed by checking `appState.currentFolderId` on the
real shared test account, which defaulted to `'root'`); `__closeMessagesPanel()` correctly closing
both the rail panel and an open conversation together; a real chat-message insert correctly
routing to a "not actively viewing" push notification on the receiving account (confirmed the
panel was actually closed on that side first, to exercise that specific branch rather than the
already-covered "actively viewing" one); a real presence disconnect (`context.close()`)/reconnect
correctly firing "logged off"/"is online" notifications; the AFK local-state verification
described above. Regression-verified `verify-phase4-5-ai-hamburger-mnemonic-port.js`,
`verify-phase4-5-panelshamburger-port.js`, `verify-phase4-5-profileachievementspricing-port.js`,
and `verify-phase4-5-livepresence-port.js` all clean afterward (the first hit one real flake on its
first dev-mode run — a live-suggestions network round trip, same real-network-timing category
already documented for that script — and passed clean on an immediate re-run, in both modes).
Zero console/page errors across every script in both modes, beyond the two confirmed-external/
pre-existing gaps above, both deliberately whitelisted with a documented reason.
**This resolves the last genuinely circular pair.** Of the original 8 `window-bridge.js`-owning
files, only `source-tags-ai.js` remains.

**Phase 4.1 revisit (9-file leaf batch, unblocked once Phase 4.5 finished)**: `node --check` on
the touched vanilla files (`dotto-script.js`), `eslint` clean, `npm run typecheck` clean, `npm run
format:check` clean after a `prettier --write` pass run as the actual last step before committing,
`rm -rf .next && npm run build` clean, all 32 Vitest tests still green (`srsAlgorithm.test.ts`
replaced `test/vanilla/srs-algorithm.test.ts` 1:1, now colocated with its own source per this
project's usual convention — the `test/vanilla/` exemption existed only while the logic itself
still lived under `public/`, served as a static asset). Real re-audit against the two-sided
portability rule (see Status section above) found 9 files genuinely blocked by nothing, all ported
in one batch — the biggest, `blocks-panel.js` (288 lines), needed a full caller map of its 9
exported functions plus its own real circular relationship with `library-publish.js`/
`marketplace.ts` (documented in `libraryPublish.ts`'s own header comment from an earlier port —
kept as bridges in both directions, a deliberate choice not to newly co-locate/resolve it given
those two files are already-shipped and stable). Real Playwright verification against both a dev
server and a real production server, one script covering the whole batch: a real click on
`#theme-switch-input` (reached via `#btn-profile` → `#profile-settings-btn`, both real in-page
`.click()`s to dodge Next's dev-mode overlay interception, same precedent
`verify-phase4-5-profileachievementspricing-port.js` established) flipping
`document.documentElement.dataset.theme`, restored after; the real `\` keyboard shortcut doing the
same (a real bug in the test itself, not the app, caught along the way — the shortcut's own
`isEditingText` guard correctly refused to fire while `#theme-switch-input` still had focus from
the previous step, confirmed via direct repro; fixed by a real `.blur()` before moving on); a real
click on `#btn-library` opening `#library-panel`; a real hover-to-arm (300ms) + pointer drag on a
mock table's own column-resize divider redistributing `colWidths` — needed scoping the locator to
that exact table's own element id (`window.__itemElId`) since the shared test account has many
other real tables from earlier ports' own runs, and needed picking a drag point away from the
table's vertical center, where a `.table-row-resize-handle` (a thin 9px horizontal strip positioned
at the row boundary) was confirmed, via direct `elementFromPoint` repro, to sit exactly on top of
the column handle's own midpoint and intercept the click; a real `dispatchSelectedToChat()` call
sharing a card into an open conversation with a real friend already on the shared test account (a
real Supabase insert — left uncleaned since the `messages` table's own RLS policies only grant
SELECT/INSERT, no DELETE, confirmed via migration read and direct repro, not assumed); a real `U`
keypress opening `#upload-popup`, a real Playwright `filechooser` event picking a file via the
dropzone, and a real "Add to canvas" click creating a real `media` item and closing the popup; a
real click on `#btn-add` opening the Blocks panel (`refreshBlocksPanel` ran); a real search
filtering to zero rows for a no-match query; a real click on the Essentials "Note" row routing
through `handleBlockItemClick` to a real (temporarily wrapped) `window.prepareAdd` call; a real
`prompt()` dialog creating a real custom folder via `createBlocksFolder`; a real hover + real
pointer drag onto the custom folder row (skipped gracefully — logged, not failed — when the shared
test account has no real Purchased/My-Creations item to drag, since `setupContentItemDrag`'s own
listener wiring and click-vs-drag threshold logic are still exercised elsewhere); a real hover +
click on the folder's own `RowActions.jsx` delete button (`.outline-item-delete-btn`) removing it
from both `appState` and the real DOM, confirmed rather than assumed by checking both.
Regression-verified `verify-phase4-4-sourcetable-port.js`, `verify-phase4-5-sourcetagsai-port.js`,
`verify-phase4-5-panelshamburger-port.js`, `verify-phase4-5-profileachievementspricing-port.js`,
`verify-phase4-4-gamesflashcardtyperight-port.js`, and `verify-phase4-5-srsconnectionscore-port.js`
all clean afterward, in both modes — the widest regression batch this migration has run for one
port, reflecting how many already-ported files this batch's own stale-reference sweep found and
upgraded to real same-tree imports (`srsAlgorithm.ts`'s `calculateSM2`/`defaultSrsState`/
`diffRatings` in `gamesFlashcardTyperight.ts`/`stopwatch.ts`/`srsConnectionsCore.ts`;
`friendsPresence.ts`'s `refreshCanvasCollabForCurrentFolder`/`refreshFriendsData`/`renderCollabPill`
in the new `appInit.ts` and `renderMsgList` in the new `dragDropChat.ts`; `sourceTable.ts`'s
`distributeTableSizing` in the new `tableGridResize.ts`) — each one a genuine "same-tree caller
upgrade" opportunity that only became available once this specific file left the vanilla tree,
found by re-running the established `python3` walk-and-string-search stale-reference sweep against
the 9 just-removed filenames rather than assuming the earlier caller map (built before this port)
was still exhaustive. Zero console/page errors across every script in both modes.
**This is the first genuine progress on Phase 4.1 since it was paused — 12 of the original ~23
vanilla files are now done.** Exactly one connected component remains: the 11-file
`command-parser.js`/`command-target-lookup.js`/`command-verbs.js`/`command-palette.js`/
`card-kinds.js`/`global-ids.js`/`add-menu.js`/`text-utils.js`/`drawing-connections.js`/
`search-panel-history.js`/`search-orchestration-selection.js` cluster — needs a coordinated
multi-file port, not a leaf-first approach, before Phase 4.6 (which requires `public/dotto/` to be
fully empty) can start.
