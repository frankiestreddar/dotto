# Dotto (Dotter v0.1.3) — Next.js migration

This is the original single-file `Dotto.html` (infinite-canvas study/notes
app) migrated into a real Next.js project (App Router, Tailwind v4 +
PostCSS build — no CDN scripts). It runs and behaves the same as the
original file. See `PHASE2_ROADMAP.md` for what's next.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## What's real vs. what's a shim, right now

- **Markup**: split into 18 verbatim fragments in `content/fragments/*.html`,
  each rendered by a small named component in `app/dotto/sections/`
  (`TopBar`, `AddMenu`, `SchedulePanel`, `MarketplacePanel`, etc. — see
  `app/dotto-app.jsx`). This is organizational only; the HTML itself is
  unchanged from `Dotto.html`.
- **Styling**: `app/globals.css` = Tailwind v4 import + the original
  `<style>` block copied verbatim. `@source` directives tell Tailwind's
  scanner to also look inside the markup fragments and
  `public/dotto-script.js`, since the original app mixes custom CSS classes
  with Tailwind utility classes in both places.
- **Behavior**: `public/dotto-script.js` is the original ~5,100-line script,
  byte-for-byte, still loaded as one classic global script
  (`<script src>`, not a module) via `next/script`. None of its 269
  functions have been rewritten yet — it still manipulates the DOM
  directly with `document.getElementById`, exactly like it did in the
  single HTML file. This is intentional (see `PHASE2_ROADMAP.md` for why
  rewriting it in one pass was skipped).

## Known gaps

- **Icon assets are missing.** `Dotto.html` referenced 7 PNGs via
  `assets/icons/*.png`, but only the HTML file was provided — no sibling
  `assets` folder — so those icons never existed to migrate. Drop the real
  files into `public/assets/icons/` (see the README there) and the top
  bar / toolbar buttons will pick them up automatically; no code changes
  needed.
- **No backend, no persistence** — same as the original. Nothing was added
  here; that's explicitly out of scope for this pass.
- **Not yet interactively verified in a real browser.** Everything that
  could be checked without a browser was checked (byte-diffed markup/CSS/JS
  against `Dotto.html`, script syntax, correct SSR output, correct Tailwind
  CSS generation). Clicking through each feature (add every card kind, draw,
  connect cards, flip an SRS deck, open every panel, browse the
  marketplace) still needs a real run-through on your end — see the last
  section of `PHASE2_ROADMAP.md`.

## Project structure

```
app/
  layout.js          root layout — fonts, <head> links, imports globals.css
  page.js             Server Component — reads content/fragments/*.html, passes to DottoApp
  dotto-app.jsx        Client component — assembles the 18 sections, loads dotto-script.js
  globals.css          Tailwind v4 + migrated custom CSS
  dotto/sections/      18 named shell components (one per Dotto.html top-level section)
content/
  fragments/*.html      the 18 markup fragments (source of truth for the shell)
  dotto-markup.html      reference copy of the original unsplit markup (unused by the app)
  dotto-original.css     reference copy of the original CSS (unused by the app)
public/
  dotto-script.js       the original ~5,100-line script, verbatim
  assets/icons/          drop the 7 missing icon PNGs here
PHASE2_ROADMAP.md        subsystem inventory + suggested migration order for the rest of Phase 2
```
