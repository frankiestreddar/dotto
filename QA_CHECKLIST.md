# Manual QA checklist

The manual-QA companion to CI's own automated coverage — not a from-scratch regression suite the
way it was when this file was first written (see `PHASE2_ROADMAP.md`, archived at
`docs/archive/PHASE2_ROADMAP.md`, for that history). CI (`.github/workflows/ci.yml`) now runs
`lint`, `typecheck`, `format:check`, a real Vitest unit suite, `build`, and a real 47-test
Playwright e2e suite (`e2e/`) against the dedicated `dotto-test` Supabase project on every push/PR
— genuinely exercising real browser interaction across the canvas core, navigation, the source
table, shortcuts/draw tools, Dotbot search UI, marketplace, media, and multi-pane/collaboration UI
(see `e2e/authenticated/*.spec.ts`, and Phase 4.7's e2e batches 26-31 in `PHASE4_ROADMAP.md` for
what each spec covers and, just as importantly, what it deliberately doesn't). A line below marked
**(automated)** already has a passing e2e spec behind it — still worth a quick manual look if
you're touching that exact area, but it's no longer the only thing standing between a regression
and a merged PR the way it was before. Everything else here — most of collaboration, all of
marketplace purchase, most of SRS/media/search, anything needing a real second account or a real
paid/AI-provider round trip — still has no automated coverage and needs a human before merging a PR
that touches it.

Run `npm run dev`, open http://localhost:3000, and go through whatever section is relevant to your
change. Add a line whenever a new feature ships — this list is only as good as it is current.

## Auth & account

- [ ] Register a new account, log in, log out
- [ ] Avatar setup: username availability check (grey → red/green), each avatar option, save

## Canvas basics

- [ ] Add every card kind from the Add menu (title, folder, source, table, media, bookmark,
      checklist, watermark, flashcard, statcard, stopwatch, shelf/Stack, filter, embed)
- [ ] Drag a card; drag a multi-selection (shift-click or select-cursor-mode) — **(automated:**
      **`canvas-drag.spec.ts`** covers a plain drag, shift-click selection, and alt-duplicate-drag;
      **not** multi-card drag or select-cursor-mode specifically)
- [ ] Drag a card to the screen's edge — canvas auto-pans in that direction, including diagonally
      in a corner
- [ ] Copy (Cmd/Ctrl+C), Cut (Cmd/Ctrl+X), Paste (Cmd/Ctrl+V) a card and a multi-selection;
      confirm cut removes the original, paste offsets each press so repeats don't stack
- [ ] Delete selected card(s) via Backspace; confirm the SRS/Stack-data warning dialog appears
      when relevant
- [ ] Undo/redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z) across a few different actions
- [ ] Zoom control (slider + Ctrl+scroll); pan via trackpad/wheel scroll — **(automated:**
      **`shortcuts-draw-tools.spec.ts`** covers a real zoom-track drag, **`canvas-resize.spec.ts`**
      covers real Ctrl+scroll zoom and confirms resize distance accounts for it)
- [ ] Drill into a folder/source card, breadcrumb back out, ".." breadcrumb map — **(automated:**
      entering a source is covered by **`source-table.spec.ts`**; breadcrumb back-out/".." and
      folder drill-in are not)
- [ ] Rename a folder/source card title inline (click to edit, Enter/Escape/blur to commit/revert)
- [ ] Draw mode: pen + eraser, front/back layer toggle, color/size — **(automated:**
      **`shortcuts-draw-tools.spec.ts`** covers the pen tool button toggling `drawTool` + its active
      class; eraser, layer toggle, and color/size are not covered)

## Source / table

- [ ] Open a source, add rows/columns, edit cells — **(automated: `source-table.spec.ts`** covers
      entering a source, hover-zone geometry, and clicking add-row/add-column end to end; editing
      an existing cell's content is not covered)
- [ ] Import a delimited file into a source
- [ ] Insert image/audio into a cell; record audio into a cell
- [ ] Cell tags: create, apply, right-click rename/delete
- [ ] Column/row right-click context menu (delete, highlight)
- [ ] Dotbot-generated source content panel

## Flashcards / SRS

- [ ] Connect a source to a flashcard card; flip through the deck
- [ ] Rate a card (1-4) and confirm the SRS schedule updates (`calculateSM2`)
- [ ] Typeright card: type an answer, check, Enter to advance

## Connections / Stack

- [ ] Drag-link two cards (Data mode); confirm invalid connections are rejected
      (`isValidConnection`) — **(automated: `connections.spec.ts`** covers a real drag-to-link
      between a source and a flashcard, the SVG connection path rendering, and clicking its
      hit-path to delete it; rejecting an invalid connection pair is not covered)
- [ ] Connect a source to a Stack card; confirm its real name shows (not "Source"), row count
      says "entries"
- [ ] Stack: rename its own name inline; search box filters connected sources/sessions; single
      click on a source pill opens that source's page; double-click its label renames it; dragging
      the Stack card does **not** focus the search box
- [ ] Filter card: connect a source, toggle tags, AND/OR mode
- [ ] Stopwatch connected to a game card; start/stop, confirm a session saves to a connected Stack

## Media

- [ ] Upload an image/video; paste an image/video by link; aspect ratio looks right —
      **(automated: `media-pdf-epub.spec.ts`** covers a real image upload and a real Link-flow
      `prompt()` round trip; video is not covered)
- [ ] Upload a PDF; viewer renders, text-layer selection, highlight-to-source — **(automated:**
      **`media-pdf-epub.spec.ts`** covers a real PDF upload through Supabase Storage and confirms
      the real pdf.js viewer mounts and renders; text-layer selection and highlight-to-source are
      not covered)
- [ ] Upload an EPUB; viewer renders, navigation works

## Waypoints, schedule, notifications

- [ ] Drop a waypoint, jump to it from the hamburger Waypoints panel
- [ ] Schedule view mode: add/edit/remove an event, day navigation
- [ ] Dotbot scheduling conversation flow
- [ ] Due-time notification fires for a scheduled card; day-change notification (3am cutoff)

## Hamburger menu / panels

- [ ] Outline panel: every card kind shows its real name (not a generic kind label) — folders,
      sources, and Stacks in particular — **(automated: `outline-panel.spec.ts`** covers opening
      via the 'o' shortcut, real row content, search filtering + empty state, arrow-key nav, a row
      click navigating, and preserveState across a close/reopen; it doesn't check every card kind's
      label individually)
- [ ] Profile panel; Messages panel (send/receive); Collaborators panel — **(automated:**
      **`collab-presence.spec.ts`** covers a real Messages-panel rail-icon click and a real
      hover + click opening the Collaborators bubble/panel; sending/receiving a message, and the
      Profile panel itself, are not covered — see that spec's own header comment for why the real
      cross-account send/receive flow specifically isn't promoted)
- [ ] Achievements panel
- [ ] Pricing/upgrade panel

## Collaboration

- [ ] Share a canvas with another account; confirm live cursor presence and content sync in two
      browser tabs/sessions
- [ ] Rename a shared canvas; confirm the collaborator's view updates
      (`canvas_collaborations.folder_title` sync)
- [ ] Revoke a collaboration

None of the three above are automated — they need a real second account and real cross-account
Supabase Realtime sync, which CI's own e2e job doesn't have credentials for (see
`e2e/authenticated/collab-presence.spec.ts`'s own header comment for the full reasoning, and
`.claude-testing/verify-phase4-5-friendspresence-port.js` for a real two-account version of this
flow you can still run by hand locally against a second test account).

## Marketplace

- [ ] Package a card/canvas as a template draft, publish it
- [ ] Browse/search the marketplace, purchase/deploy a template — **(automated:**
      **`marketplace.spec.ts`** covers a real rail-icon click opening Discover, real search-input
      filtering, item-detail open/close, and deploying an already-purchased (in-memory) template;
      the real purchase flow itself is not covered — real Supabase writes against the shared test
      account, deliberately excluded)
- [ ] Drag a card into the cart dropzone; drag a card onto the Schedule button; drag a card into
      an open chat

## Search

- [ ] Canvas search: find and jump to a card
- [ ] Dotbot search answers (language question, "how do I..." app question)
- [ ] Mnemonic generation (text + image)

None of the three above are automated in CI — `dotbot-search-chat.spec.ts` covers the parts of the
search UI that don't need a real AI round trip (the slash-command palette, the "Add to..." popup);
live suggestions, a real Dotbot search answer, and mnemonic generation all need a real
`/api/dotbot/*` call against Groq/HuggingFace, and CI's own e2e job runs with those keys set to the
literal string `"placeholder"` (see that spec's own header comment).
