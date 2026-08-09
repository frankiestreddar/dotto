# Contributing

This describes how the codebase is structured today and how to add to it — not migration history
(see `PHASE2_ROADMAP.md` for that, and for why some things below are vanilla by design rather than
oversight).

## The two-layer architecture

The app is split into two cooperating layers:

- **`public/dotto/*.js`** — ~30 vanilla ES modules, no bundler, loaded as one `<Script
  type="module">`. This is where the app's behavior and shared state (`appState`,
  `public/dotto/core-state.js`) live — canvas rendering, drag/resize/select, connections, live
  collaboration, the Source database page, and more. It's intentionally staying vanilla, not
  unfinished — see "Should this be React?" below.
- **`app/dotto/*.jsx`** — real React components, one per converted subsystem (overlays, dropdown
  panels, list panels, every canvas card kind). Each one portals into an *existing* static DOM node
  from `content/fragments/*.html` rather than owning new markup.

They talk to each other through `window.__*` — never a normal `import`, since `public/dotto/*.js`
can't import from `app/` (no bundler on that side) and the reverse would create a real dependency
edge this migration deliberately avoided.

## Adding a new piece of React-owned UI

Follow this shape — every component in `app/dotto/` does, and `bridges.js`'s own per-store
comments are the closest thing to a style guide, worth skimming before you add one:

1. **Add a store** to `app/dotto/bridges.js`: `export const myThingStore = createStore(initialValue);`
   with a short comment describing the shape and, if it's a list, why it's genuine JSX rows vs. a
   vanilla-built widget mounted via ref (see "Should this be React?" below for that call).
2. **Bridge vanilla → React** in `app/dotto-app.jsx`, inside the `if (typeof window !==
   "undefined") { ... }` block: `window.__setMyThing = myThingStore.set;`. Wrap it in `flushSync`
   only if some vanilla code reads the DOM *synchronously* right after calling it — e.g.
   `window.__renderCanvasItems = (items) => flushSync(() => canvasItemsStore.set(items));`
   (`app/dotto-app.jsx`) exists because `render()`'s caller sometimes does
   `document.getElementById('item-'+id)` immediately after. If nothing reads the DOM synchronously
   after your bridge call, skip `flushSync` — it's not free, and most stores don't need it.
3. **Write the component** in `app/dotto/YourThing.jsx`:
   - `usePortalNode("existing-dom-id")` (`app/dotto/usePortalNode.js`) to resolve the static target
     node from mount. Never create new DOM structure — always portal into something already in
     `content/fragments/*.html`.
   - `useSyncExternalStore(myThingStore.subscribe, myThingStore.getSnapshot, () => fallback)` to
     read the store.
   - `createPortal(<your JSX/>, portalNode)`. If a list item's own content needs real vanilla DOM
     (an existing builder function, not worth re-expressing as JSX — see below), mount it via a
     `useRef` + `useLayoutEffect` sub-component, same pattern as `InlineCanvasPreview` in
     `MarketDetailPanel.jsx`.
4. **Bridge React → vanilla**: any vanilla function your component needs to call gets
   `window.__fnName = fnName;` at the bottom of the vanilla file that owns it. Never touch
   `public/dotto/window-bridge.js` — that file is auto-generated for a different purpose (the
   ~107 functions still called by name from inline `onclick="..."` HTML attributes) and hand-
   editing it breaks its own "provably complete" guarantee (see its own header comment).
5. **Mount it** in `app/dotto-app.jsx`, wrapped in `<ErrorBoundary name="YourThing">` — every
   top-level piece is, so one crash can't take the rest of the app down.

### Should this be React?

Not everything should convert. Real reasons *not* to, all with precedent in this codebase (see
`PHASE2_ROADMAP.md` for the specifics):
- **contentEditable fields** — converting risks caret-position regressions for no behavior gain
  (Item Detail's title field, the Publish Flow view, the Source table's cells all stay vanilla for
  this reason).
- **Continuous pointer-driven pixel math** — drag, resize, connection-dragging, hover-zone
  geometry. These already coexist correctly with React-owned DOM (see below) and converting them
  would fight the framework's reconciliation model for no benefit.
- **No natural content-parameter boundary** — if there's no clean "here's the data, here's the
  render" split (the hamburger menu's Outline panel is the standing example), forcing a conversion
  usually means either a full rewrite or a no-op wrapper.
- Otherwise: if it's a self-contained rendering surface (a list, a dropdown, a form's button set)
  with no continuous imperative state of its own, it's very likely a good, low-risk candidate —
  that's the shape of nearly every component in `app/dotto/`.

## Working in `public/dotto/*.js`

Most new backend-touching or canvas-behavior features will still live here, extending the existing
pattern, not converting it. Conventions to match:
- File shape: imports → `// ---------- Section ----------` comment → functions → one alphabetized
  `export { ... };` → `window.__*` bridge assignments at the bottom with a comment naming which
  React component uses each one.
- Error handling: `if (error) { console.error('[tag] context:', error); ... }` — a short bracketed
  subsystem tag, always logged, never swallowed silently.
- State lives on `appState` (`core-state.js`), not module-level `let`s.

`setupDraggingAndClicking`/`setupResizing` (`drag-drop-chat.js`/`resize-shortcuts-init.js`) are the
reference example for writing vanilla code that operates on React-owned DOM nodes safely: they use
`AbortController`-based idempotent re-registration (`el.__dragListenerAbort = new
AbortController()`) so `CanvasItemsLayer.jsx`'s layout effect can safely re-run them on every
render without leaking listeners. Copy that pattern if you're wiring new imperative behavior onto
`#items-layer`'s cards.

## Verification before committing

- `node --check path/to/file.js` on every vanilla file you touched.
- `npx eslint path/to/files...` on everything touched, vanilla and React.
- `npm run build` — confirms the Next.js/React side compiles and SSRs cleanly.
- This environment can't run a real browser. Anything touching interactive behavior still owes a
  manual click-through — don't claim more confidence than a design read actually earned.

## A note on the architecture itself

The vanilla/React split, and the `window.__*` bridge mechanism connecting the two halves, is a
well-executed *migration scaffold* — not necessarily what a team would design building this app
from scratch. Keeping high-frequency pointer-driven canvas work (drag, resize, connections,
hover-zone math) outside React's reconciliation is genuinely good practice, matching real canvas-
app architecture (Figma/tldraw/Excalidraw-style) — that part isn't a compromise. The mechanism
itself is: a from-scratch build would more likely keep everything in one React tree (with the same
imperative escape hatches implemented as component-local refs, not a separate global-bridge module
system), use a real state library (Zustand/Valtio/Jotai) instead of the hand-rolled `createStore`
here, and have zero `window.__*` global functions.

Collapsing the two layers into one cohesive React architecture is a legitimate future direction,
but it's a new, large, separately-scoped initiative — not something to start opportunistically
alongside unrelated feature work. It would need the same incremental, subsystem-by-subsystem
discipline this migration used (arguably more, given how much imperative canvas-core logic it would
touch), not a single pass.
