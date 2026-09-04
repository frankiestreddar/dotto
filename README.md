# Dotto (Dotter v0.1.3)

An infinite-canvas study/notes app — cards (notes, tables, flashcards, checklists, media, and
more) on a pannable/zoomable canvas, with folders as nested canvases, spaced-repetition flashcards,
real-time collaboration, a marketplace for sharing canvas templates, and an AI assistant (Dotbot)
for search, mnemonics, and content generation.

Originally a single `Dotto.html` file; migrated into a real Next.js project (App Router, Tailwind
v4 + PostCSS, Supabase backend) in `docs/archive/PHASE2_ROADMAP.md`'s two phases, then consolidated
from a hybrid vanilla-JS/React app into one cohesive TypeScript + React codebase in
`PHASE4_ROADMAP.md` — every file in the tree is real, type-checked TypeScript now, under a strict
subset (`checkJs`/`strictNullChecks`/`noImplicitAny`) enforced in CI. See those documents for the
full migration history, `ARCHITECTURE.md` for the codebase's shape today, and `CONTRIBUTING.md` for
how to work in it.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Requires Supabase environment variables (see `.env.local`) — the app
redirects to `/login` without a signed-in Supabase session.

## Architecture

One cohesive React + TypeScript codebase under `app/dotto/`:

- **`app/dotto/lib/*.ts`** — plain TypeScript modules holding most of the app's actual behavior:
  canvas rendering, drag/resize/select, connections, live collaboration presence, the Source
  database page, and more. State lives on one shared `appState` object
  (`app/dotto/lib/coreState.ts`).
- **`app/dotto/*.tsx`** — real React components for every subsystem (overlays, dropdown panels,
  list panels, every canvas card kind). Most portal into existing static DOM nodes rather than
  owning markup outright — a holdover from the app's original hand-authored markup, kept because
  it still works.

There's no separate vanilla/bundler-less layer anymore (there used to be — see
`PHASE4_ROADMAP.md` for that history). A number of modules still reach each other through
`window.__*` bridge functions rather than a normal `import` — every store a React component
subscribes to is real Zustand now (`app/dotto/lib/*Store.ts`, one file per store; see
`app/dotto/lib/paneKeyedStore.ts` for the per-pane variant), but a wide layer of plain
`window.__*` accessor/setter bridges between still-separate `lib/*.ts` modules remains — see
`CONTRIBUTING.md` for the full picture of what's deliberately kept as a bridge (universal hub
accessors, inline-`onclick` targets) vs. what's real same-tree-upgrade debt.

`app/dotto-app.tsx` is the app's own composition root: it renders the 18 static markup fragments
(`content/fragments/*.html`, one per top-level section of the original page), wires up the
remaining `window.__*` bridges, and mounts every React component, each wrapped in an
`<ErrorBoundary>` so a crash in one small piece can't take the whole app down.

See `CONTRIBUTING.md` before adding a new feature — it walks through the current conventions and
links back to specific store examples (`app/dotto/lib/*Store.ts`) to copy.

## Project structure

```
app/
  layout.tsx            root layout — fonts, <head> links, imports globals.css
  page.tsx               Server Component — reads Supabase session/profile + content/fragments/*.html, passes to DottoApp
  dotto-app.tsx           Client component — the app's own composition root, described above
  dotto/                  React components for every subsystem, plus usePortalNode.ts
  dotto/lib/               plain TypeScript modules — most of the app's actual behavior lives here
  dotto/sections/          18 named shell components (one per top-level page section), each rendering a static fragment
  api/dotbot/              API routes backing the AI assistant (ask/orchestrate/mnemonic/image/suggest/tts)
  globals.css              Tailwind v4 + the app's own CSS
content/
  fragments/*.html        the 18 static markup fragments (source of truth for the shell)
public/
  assets/                 icons, sprites, fonts
lib/
  supabase/                Supabase client setup (browser + server) + generated database.types.ts
  leveling.ts              daily login bonus / streak logic used by app/page.tsx
  dotbot.ts                shared Dotbot prompt/system-prompt text used by the API routes above
supabase/
  migrations/*.sql          schema migrations — apply these yourself, this environment has no DB access
e2e/                       Playwright end-to-end specs (npm run test:e2e)
docs/archive/PHASE2_ROADMAP.md   Phase 1/2 migration history, kept as a historical record
PHASE4_ROADMAP.md          the vanilla->React consolidation + TypeScript/testing close-out — complete
ARCHITECTURE.md            the codebase's shape today — routes, canvas core, state layers, testing
CONTRIBUTING.md            how to work in the codebase today — start here for new features
QA_CHECKLIST.md            manual QA checklist, supplementing the automated Vitest/Playwright suites
```
