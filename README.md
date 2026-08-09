# Dotto (Dotter v0.1.3)

An infinite-canvas study/notes app — cards (notes, tables, flashcards, checklists, media, and
more) on a pannable/zoomable canvas, with folders as nested canvases, spaced-repetition flashcards,
real-time collaboration, a marketplace for sharing canvas templates, and an AI assistant (Dotbot)
for search, mnemonics, and content generation.

Originally a single `Dotto.html` file; migrated into a real Next.js project (App Router, Tailwind
v4 + PostCSS, Supabase backend) over two phases documented in `PHASE2_ROADMAP.md`. Both phases are
now complete — see that document for the full migration history, and `CONTRIBUTING.md` for how to
work in the codebase as it stands today.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Requires Supabase environment variables (see `.env.local`) — the app
redirects to `/login` without a signed-in Supabase session.

## Architecture

The app is two layers, bridged together:

- **`public/dotto/*.js`** — ~30 real ES modules (no bundler, loaded via a single
  `<Script type="module">` in `app/dotto-app.jsx`) holding most of the app's actual behavior:
  canvas rendering, drag/resize/select, connections, live collaboration presence, the Source
  database page, and more. State lives on one shared `appState` object
  (`public/dotto/core-state.js`). This is intentionally still vanilla, not a gap — see
  `CONTRIBUTING.md` and `PHASE2_ROADMAP.md` item 12 for why.
- **`app/dotto/*.jsx`** — real React components for every subsystem worth converting to React
  state (overlays, dropdown panels, list panels, every canvas card kind). These portal into
  existing static DOM nodes rather than owning markup outright, and talk to the vanilla layer in
  both directions through a small `window.__*` bridge convention (`app/dotto/bridges.js`).

`app/dotto-app.jsx` is the seam: it renders the 18 static markup fragments
(`content/fragments/*.html`, one per top-level section of the original page), wires up every
`window.__*` bridge, and mounts every React component, each wrapped in an `<ErrorBoundary>` so a
crash in one small piece can't take the whole app down.

See `CONTRIBUTING.md` before adding a new feature — it walks through the pattern for adding either
a new piece of React-owned UI or new vanilla behavior, and links back to the specific examples in
`bridges.js` to copy.

## Project structure

```
app/
  layout.js            root layout — fonts, <head> links, imports globals.css
  page.js               Server Component — reads Supabase session/profile + content/fragments/*.html, passes to DottoApp
  dotto-app.jsx          Client component — the seam described above
  dotto/                 React components for every converted subsystem, plus bridges.js and usePortalNode.js
  dotto/sections/        18 named shell components (one per top-level page section), each rendering a static fragment
  api/dotbot/             API routes backing the AI assistant (ask/orchestrate/mnemonic/image/suggest/tts)
  globals.css             Tailwind v4 + the app's own CSS
content/
  fragments/*.html        the 18 static markup fragments (source of truth for the shell)
public/
  dotto/*.js              the vanilla ES-module layer described above
  assets/                 icons, sprites, fonts
lib/
  supabase/                Supabase client setup (browser + server)
  leveling.js              daily login bonus / streak logic used by app/page.js
supabase/
  migrations/*.sql          schema migrations — apply these yourself, this environment has no DB access
PHASE2_ROADMAP.md          full migration history (both phases), kept as a historical record
CONTRIBUTING.md            how to work in the codebase today — start here for new features
QA_CHECKLIST.md            manual regression checklist (no automated test suite exists yet)
```
