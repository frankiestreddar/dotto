# Phase 4 roadmap: full vanilla→React consolidation & professionalization

## Status

- **Phase 4.0 — tooling & safety net: done.** See checklist below.
- **Phase 4.1 — leaf-first vanilla→React port: not started.**
- **Phase 4.2 — utility extraction from hub files: not started.**
- **Phase 4.3 — split multi-concern files: not started.**
- **Phase 4.4 — port split-out concerns + remaining DOM-heavy files: not started.**
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

1. **Phase 4.1 — leaf-first** (fan-in 0–1): Batch A pure-logic files move straight into
   `app/dotto/lib/*.ts`, no bridge needed. Batch B small leaf DOM widgets become real `.tsx`
   components following the `OutlinePanel.jsx` pattern. Batch C heavier-but-self-contained leaves
   (`library-publish.js`, `mnemonic-search-matching.js`, `source-tags-ai.js`, `command-palette.js`).
2. **Phase 4.2 — utility extraction** (zero-risk, unblocks downstream): pull
   `escapeHtml`/`stripHtml`/`truncateCenter` out of `ai-assistant-suggestions.js`,
   `calculateSM2`/`defaultSrsState`/`diffRatings` out of `srs-connections-core.js` (write real
   Vitest unit tests here — zero coverage today), achievement-scoring out of
   `profile-achievements-pricing.js`. Each keeps a vanilla-side re-export so existing callers keep
   working until they're themselves ported.
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
