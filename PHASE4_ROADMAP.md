# Phase 4 roadmap: full vanilla→React consolidation & professionalization

## Status

- **Phase 4.0 — tooling & safety net: done.** See checklist below.
- **Phase 4.1 — leaf-first vanilla→React port: paused for now, real safe set exhausted.** 3 files
  ported (`rail-tooltip-expand.js`, `sidebar-mode-toggle.js`, `dotbot-schedule-notifications.js`).
  Every other candidate in the original ~20-file list was checked and confirmed genuinely blocked
  by deep hub dependencies (not just their own fan-in) — see its own section below. Revisit
  individual files as their blocking hub dependency lands in a later phase, but don't keep
  grinding on this phase in isolation; Phase 4.2 is the actual next productive step.
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
- **Phase 4.4 — port split-out concerns + remaining DOM-heavy files: in progress.**
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
- **Phase 4.5 — architectural/hub files: not started.**
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
