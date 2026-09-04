# Architecture

A snapshot of the system as of Phase 4.7 (see `PHASE4_ROADMAP.md` for how it got here). This
describes what the codebase *is* — for conventions on how to extend it, see `CONTRIBUTING.md`.

## Stack

Next.js 16 (App Router, Turbopack), React 19, TypeScript, Zustand, Supabase (Postgres + Auth +
Storage + Realtime), Tailwind v4, Vitest (unit) + Playwright (e2e).

## Top-level shape

```
app/
  page.tsx                 server component: auth check, loads currentUser + the static
                            content/fragments/*.html sections, renders <DottoApp>
  layout.tsx, (auth)/, auth/callback/, avatar-setup/, api/dotbot/*/route.ts
  dotto-app.tsx             the client root — wires ~20 subsystems (useEffect per subsystem),
                            renders every panel/overlay, owns the window.__dottoSupabase bootstrap
  dotto/
    *.tsx                   63 real React components: card kinds (18), list/dropdown panels,
                             overlays, the pane shell (PaneGrid/PaneCanvasArea/TabsBar)
    sections/*.tsx          12 thin wrappers that inject content/fragments/*.html verbatim via
                             dangerouslySetInnerHTML (see "Static markup" below)
    lib/*.ts                96 plain TS modules: canvas behavior, Zustand stores, Supabase-backed
                             features, the appState singleton
    canvasItemBehavior.ts   drag/resize/connections pixel math — the single largest file (~1,250
                             lines), deliberately not decomposed further (see CONTRIBUTING.md's
                             "writing imperative canvas code safely")
lib/                        repo-root utilities: leveling, Supabase clients + generated DB types,
                             Groq/HuggingFace/Edge-TTS clients, dotbot orchestration helpers
content/fragments/*.html    hand-authored static markup, read server-side in page.tsx and passed
                             down as prop strings
e2e/                        Playwright specs (see "Testing" below)
.claude-testing/            gitignored, ad-hoc verification scripts written during migration
                             batches — reference material, not a maintained suite
```

There is no `public/dotto/` anymore and no separate vanilla/bundler-less layer — every file in the
tree above is real, type-checked TypeScript reachable by a normal `import`. `public/` today holds
only static assets and two vendored, non-modular libraries (`epub.min.js`, `jszip.min.js`) loaded
via `<Script>` tags for their side effects, not imported.

## Canvas core

The product is a single infinite canvas per folder (`appState.folders[id].items`), rendered by
`waypointsRenderLoop.ts`'s `render()` and owned imperatively outside React's reconciliation for
the same reason Figma/tldraw/Excalidraw-style apps do: continuous pointer-driven pixel math (drag,
resize, connection-dragging, hover-zone geometry) doesn't fit a virtual-DOM diff loop well.
`CanvasItemsLayer.tsx` is the one bridge between the two worlds — React owns creating, keying, and
removing each item's wrapper `<div id={itemElId(id)}>`; `canvasItemBehavior.ts`'s
`setupDraggingAndClicking`/`setupResizing` then attach real, `AbortController`-scoped listeners to
that already-mounted node (safe to re-run on every render — see CONTRIBUTING.md).

18 card kinds (`app/dotto/*Card.tsx`) share one canonical `Item` type
(`app/dotto/lib/messagingCanvasPreview.ts`, grown incrementally as each kind was ported) for the
`it` prop `CanvasItemsLayer.tsx`'s dispatch table passes them. Every other `lib/*.ts` file defines
its *own* minimal local `Item`/`FolderObj` interface instead of importing the canonical one — real
data (`appState.folders[id].items`) is structurally compatible with all of them, so this works
without cross-file casts in the common case; a cast is used explicitly, at the one call site,
wherever a genuinely stricter/looser shape actually meets a real API boundary (documented in-line
each time it happens).

## Split-screen panes

Up to 4 panes, laid out via a binary split tree (`PaneTree` — `paneLayoutStore.ts`), each with its
own camera (`tx`/`ty`/`scale`), items, tabs, breadcrumb trail, and collaborator pill. Every
per-pane piece of React state uses `createPaneKeyedStore` (`paneKeyedStore.ts`) — one store slot
per `paneId`, consumed as `useMyStore.storeFor(paneId)()`. `coreState.ts` swaps which pane's fields
are the *live* `appState.<field>` ones on `__switchActivePane` — imperative canvas code (which
reads `appState.tx`/`appState.folders[appState.currentFolderId]` ambiently, with no `paneId`
parameter of its own) stays correct without threading a pane id through every call.

## State layers

- **`appState`** (`coreState.ts`) — the single mutable, non-reactive singleton behind the canvas
  itself: folders/items, camera, selection, undo stack. Read/written directly by `lib/*.ts` files;
  never subscribed to by React (would defeat the point of keeping canvas math outside
  reconciliation).
- **Zustand** (42 store files, `app/dotto/lib/*Store.ts` + `paneKeyedStore.ts`) — every piece of
  state a React component actually subscribes to: panel visibility, list-panel contents, dropdown
  results, tabs, breadcrumbs, pane layout. One file per store, uniform shape (see CONTRIBUTING.md
  for the template). This replaced a hand-rolled `createStore`/`createPaneKeyedStore` mechanism
  (`bridges.js`, deleted) in a 10-batch migration — see `PHASE4_ROADMAP.md`'s Zustand section.
- **`window.__*` bridges** — how a number of `lib/*.ts` modules still reach each other instead of a
  plain `import`. This is a real internal convention now, not a vanilla/React layer boundary (that
  boundary is gone) — see CONTRIBUTING.md's "still around, now an internal convention" section for
  the full breakdown of which bridges are same-tree-upgrade debt vs. permanent by design (genuine
  circular imports, hub accessors like `window.__getAppState`, and inline-`onclick` targets).

## Static markup

`content/fragments/*.html` is hand-authored HTML, read server-side (`page.tsx`) and injected
client-side via `dangerouslySetInnerHTML` (`app/dotto/sections/*.tsx`) rather than rewritten as
JSX. Every inline `onclick="..."`/`oninput="..."` attribute in that markup resolves against a
plain, non-`__`-prefixed `window` global at click time (`window.fnName = fnName`) — a different,
permanent convention from the `window.__*` bridge one above (see CONTRIBUTING.md). Converting this
markup to real JSX is deliberately out of scope except where a specific piece (contentEditable
fields, panels with no natural content-parameter boundary) gets a real, dedicated design pass — see
CONTRIBUTING.md's "Should this be a real component" section.

## Backend

Supabase: Postgres (RLS-scoped tables, migrations under `supabase/migrations/`), Auth
(`lib/supabase/{client,server}.ts`, cookie-based sessions rotated by `proxy.ts` — Next 16's
`middleware.ts` equivalent), Storage (avatars, published-block media), and Realtime (live-canvas
presence/cursor broadcast, `canvasPresence.ts`). `lib/supabase/database.types.ts` is generated
directly from the live schema (`npx supabase gen types typescript --project-id <ref>`) — regenerate
it after any migration that changes a table this app reads/writes, don't hand-edit it.

Dotbot (the in-app AI assistant) is a set of `app/api/dotbot/*/route.ts` handlers backed by Groq
(chat), HuggingFace (embeddings/search), and Edge TTS — `lib/dotbot.ts`,`lib/groq.ts`,
`lib/huggingface.ts`, `lib/edgeTts.ts`. `orchestrate/route.ts` is the largest single route (the
main chat/search turn handler); the rest are narrower single-purpose endpoints.

## TypeScript configuration

`tsconfig.json` enables `checkJs`, `strictNullChecks`, and `noImplicitAny` (not full `strict` —
see `PHASE4_ROADMAP.md`'s Phase 4.7 entry for the measured gap between this subset and full
`strict: true`, and why the subset was chosen). `public/**` and `.claude-testing/**` are excluded
(vendored, non-modular libraries and gitignored scratch scripts respectively). Every file in
`app/`, `lib/`, and the repo root is real `.ts`/`.tsx` — there is no remaining `.js`/`.jsx` for
`checkJs` to actually be catching today; it's there so a future untyped file can't be added
silently.

## Testing

- **Vitest** (`npm run test`) — unit coverage for pure logic (`lib/leveling.ts` and similar).
- **Playwright** (`npm run test:e2e`, `e2e/*.spec.ts`) — real-browser coverage against a live dev
  server, wired into CI (`.github/workflows/ci.yml`) on every push/PR to `main`, against a
  dedicated `dotto-test` Supabase project.
- **`.claude-testing/`** (gitignored) — one-off verification scripts written during specific
  migration/port steps, most tied to a now-completed batch. Not a maintained regression suite;
  useful as reference material for writing a new permanent spec, not for running as-is.
- **`QA_CHECKLIST.md`** — manual-QA breadth (marketplace purchase, live collaboration, SRS
  scheduling) that a curated e2e subset doesn't fully replace.

## Migration history

`PHASE4_ROADMAP.md` (2,900+ lines) is the complete, file-by-file record of how the codebase got to
this shape — every vanilla-to-React port, every split/extraction, the full Zustand migration, and
the final TypeScript-strictness/testing close-out this document describes the result of. Read it
for *why* something is shaped the way it is; this document and `CONTRIBUTING.md` describe *what it
is* and *how to work in it* today.
