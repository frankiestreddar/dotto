# Contributing

This describes how the codebase is structured today and how to add to it — not migration history
(see `PHASE4_ROADMAP.md` for that, and for why some things below are shaped the way they are
rather than by oversight).

## The architecture today

The app is one cohesive React + TypeScript codebase under `app/dotto/`:

- **`app/dotto/lib/*.ts`** — plain TypeScript modules holding the app's behavior and logic: canvas
  rendering, drag/resize/select, connections, live collaboration, the Source database page, and
  more. `app/dotto/lib/coreState.ts` owns the `appState` singleton these mostly read/mutate.
- **`app/dotto/*.tsx`** — real React components, one per subsystem (overlays, dropdown panels,
  list panels, every canvas card kind). Most portal into an *existing* static DOM node from
  `content/fragments/*.html` rather than owning new markup — a holdover from when that markup was
  hand-authored HTML the vanilla layer built around, kept because it still works and there's no
  reason to churn it.

There is no separate vanilla/bundler-less layer anymore — `public/dotto/` (the ~30-odd vanilla ES
modules this app used to ship as a raw `<Script type="module">` bundle) was fully retired in
Phase 4.1 (see `PHASE4_ROADMAP.md`). Everything is real TypeScript now, type-checked, and reachable
by a normal `import`.

### `window.__*` — still around, now an internal convention, not a layer boundary

A lot of modules still reach each other through `window.__*` rather than a plain `import`. That
convention predates the full React/TS consolidation — it used to be load-bearing, the only way
code on either side of the vanilla/React split could reach across it. That reason is gone. Every
store a React component subscribes to has since migrated off the old hand-rolled `createStore`
mechanism onto real Zustand (`app/dotto/lib/*Store.ts`, one file per store — see the Zustand
migration plan's closing entry in `PHASE4_ROADMAP.md`); `bridges.js` itself is deleted. What
remains is a wide layer of plain `window.__*` accessor/setter bridges between still-separate
`lib/*.ts` modules — some of that is genuine same-tree-upgrade debt (a bridge whose only remaining
caller could just import it directly), and some of it is permanent by design (see the two
deliberately-kept categories below). **The same-tree-upgrade slice is real, tracked debt — the
hub-accessor and inline-`onclick`-target categories are not** — see "A note on the architecture
itself" below.

Practically, today:
- **When adding a new same-tree caller** (an `app/dotto/lib/*.ts` or `app/dotto/*.tsx` file that
  needs something from another file in the same tree, with no real circularity), **import it
  directly.** Don't reach for a new `window.__*` bridge just because that used to be the pattern —
  a plain `import` is simpler, type-checked, and the standing direction of travel. If you're
  touching a file that still calls an existing sibling through a bridge for no reason other than
  history (its old vanilla-side caller is long gone), upgrading that one call site to a real
  import while you're there is welcome, not scope creep — see `PHASE4_ROADMAP.md`'s own closing
  entries for many examples of this exact upgrade, file by file.
- **A few bridges are deliberately kept as bridges even between two TS/React files**, either
  because of a genuine circular import between two files that would otherwise both need to load
  before the other (documented case by case — see e.g. `drawingConnections.ts`'s and
  `srsConnectionsCore.ts`'s own header comments), or because a handful of "hub" accessors
  (`window.__getAppState`, `window.__saveSnapshot`, `window.__render`, `window.__findItemById`,
  `window.pushNotification`, and a few others) are called from dozens of files each and have
  stayed bridges throughout the whole migration by established convention, to avoid a
  combinatorial explosion of import edges — not because importing them directly would be wrong.
- **New React-facing state is a real Zustand store**, its own file under `app/dotto/lib/`
  (`export const useMyThingStore = create<MyThingState>(() => initialValue)`), consumed directly
  (`useMyThingStore()` in the component, `useMyThingStore.setState(next)` in the producer) — no
  bridge needed unless the producer genuinely can't import the store directly (a circular-import
  case). Any store whose value is an array needs `useMyThingStore.setState(next, true)` — the
  `true` forces a full replace; Zustand's default merge behavior for object/array next-states
  (`Object.assign`) silently turns an array into a plain `{0:...,1:...}` object otherwise (see
  `app/dotto/lib/chatThreadStore.ts`'s own comment for the full mechanics). A store one component
  needs *per pane* (not one shared instance) uses `app/dotto/lib/paneKeyedStore.ts`'s
  `createPaneKeyedStore` factory instead of a bare `create()` — see e.g.
  `app/dotto/lib/tabsStore.ts` for the pattern, consumed as `useMyStore.storeFor(paneId)()`. Pick
  any existing `app/dotto/lib/*Store.ts` file as a template — they're intentionally uniform.
- **Real inline `onclick="..."`/`oninput="..."` targets** — HTML strings some modules still build
  directly (a source table's cells, the search-history list, a few others) — need a plain,
  non-`__`-prefixed global (`window.fnName = fnName;`), same shape `window.pushNotification` uses.
  This is different from the bridge convention above and isn't going away just because the vanilla
  layer did — it's how a real inline-HTML-attribute string resolves a function at click time,
  regardless of which layer defines it.

## Should this be a real component vs. a raw HTML-string builder?

For **new** UI: a real component, essentially always.

For **existing HTML-string-building code** you're just touching in passing (not planning to
redesign): don't convert it as a drive-by, for the same reason this has always applied — converting
it *properly* is real, deliberate work, and doing it halfway while you're there for something
unrelated produces two competing patterns for the same thing instead of one clean one. The
categories that specifically need doing properly rather than opportunistically (all with precedent
in this codebase — see `PHASE4_ROADMAP.md`):
- **contentEditable fields** (Item Detail's title, the Publish Flow view, the Source table's
  cells) — a real conversion means adopting an actual rich-text/contentEditable approach that
  doesn't fight React's diffing (a library like Lexical/Slate/TipTap, or a carefully-designed
  uncontrolled-ref pattern), not wrapping the existing DOM-string logic in JSX and hoping the caret
  behaves.
- **Continuous pointer-driven pixel math** (drag, resize, connection-dragging, hover-zone
  geometry) — already lives as component-local imperative code with ref-based escape hatches
  (`canvasItemBehavior.ts` is the reference example, see below) — extending it in place, not
  bridging it further apart, is the right move here.
- **No natural content-parameter boundary** (the hamburger menu's Outline panel was the standing
  example before its own Phase 4.4 port) — needs an actual design pass for what its owned state
  should look like, not a mechanical wrap of a recursive DOM-building function in JSX.

## Writing imperative canvas code safely

`setupDraggingAndClicking`/`setupResizing` (`app/dotto/canvasItemBehavior.ts`) are the reference
example for writing imperative code that operates on React-owned DOM nodes safely: they use
`AbortController`-based idempotent re-registration (`el.__dragListenerAbort = new
AbortController()`) so `CanvasItemsLayer.tsx`'s layout effect can safely re-run them on every
render without leaking listeners. Copy that pattern if you're wiring new imperative behavior onto
`#items-layer`'s cards.

Error handling convention throughout `app/dotto/lib/*.ts`: `if (error) { console.error('[tag]
context:', error); ... }` — a short bracketed subsystem tag, always logged, never swallowed
silently.

## Verification before committing

- `npx eslint path/to/files...` on everything touched.
- `npm run typecheck` — the whole point of having real types; don't skip it.
- `npm run format:check` (or `prettier --write` the files you touched) before committing.
- `npm run test` — Vitest unit tests for anything with real logic coverage.
- `rm -rf .next && npm run build` — confirms the app compiles and SSRs cleanly. Never run this
  concurrently with a live `npm run dev` — they share a `.next` cache and will corrupt each other.
- Anything touching interactive behavior owes real browser verification, not just a design read —
  this environment can drive a real Playwright browser against a real dev/production server; use
  it rather than claiming confidence a static read didn't actually earn.

## A note on the architecture itself

The full vanilla/React split is gone — every file is real TypeScript now, and every store a React
component subscribes to is real Zustand (`bridges.js` and its hand-rolled `createStore`/
`createPaneKeyedStore` mechanism are deleted entirely — see the Zustand migration plan's closing
entry in `PHASE4_ROADMAP.md` for how that 10-batch, 39-store migration was carried out). What's
left of the original *migration scaffold* is narrower: `window.__*` as the mechanism a number of
same-tree modules still use to reach each other instead of a plain `import`. That's not uniformly
wrong — the imperative, outside-React canvas-core work (drag/resize/connections/hover-zone math)
staying outside React's reconciliation is genuinely good practice, matching real canvas-app
architecture (Figma/tldraw/Excalidraw-style), not a compromise, and a handful of hub accessors
(`window.__getAppState` and similar) and every inline-`onclick`/`oninput` target are permanent by
design, not debt — but `window.__*` as a *general* cross-module convention for two files that
could just import each other directly is exactly the kind of thing a from-scratch build wouldn't
do.

Finishing that — converting the remaining `window.__*` bridges that are genuinely just historical
(not the deliberately-kept circular/hub-accessor/inline-onclick cases above) into plain imports —
is real, heterogeneous debt, but small enough per call site to keep chipping away at opportunistically
alongside unrelated feature work (see "When adding a new same-tree caller" above), rather than
needing its own dedicated initiative the way the Zustand migration did.
