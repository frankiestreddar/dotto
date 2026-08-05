# Manual QA checklist

The closest thing to a regression suite this project has until real test infra exists (see
`PHASE2_ROADMAP.md` Phase 0) — `public/dotto-script.js` has no automated tests, and this
environment can't reach a running browser instance, so every item here has to be walked by a human
before merging a PR that touches it. CI (`npm run lint && npm run build`) catches syntax/build
breaks; it catches nothing on this list.

Run `npm run dev`, open http://localhost:3000, and go through whatever section is relevant to your
change. Add a line whenever a new feature ships — this list is only as good as it is current.

## Auth & account

- [ ] Register a new account, log in, log out
- [ ] Avatar setup: username availability check (grey → red/green), each avatar option, save

## Canvas basics

- [ ] Add every card kind from the Add menu (title, folder, source, table, media, bookmark,
      checklist, watermark, flashcard, statcard, stopwatch, shelf/Stack, filter, embed)
- [ ] Drag a card; drag a multi-selection (shift-click or select-cursor-mode)
- [ ] Drag a card to the screen's edge — canvas auto-pans in that direction, including diagonally
      in a corner
- [ ] Copy (Cmd/Ctrl+C), Cut (Cmd/Ctrl+X), Paste (Cmd/Ctrl+V) a card and a multi-selection;
      confirm cut removes the original, paste offsets each press so repeats don't stack
- [ ] Delete selected card(s) via Backspace; confirm the SRS/Stack-data warning dialog appears
      when relevant
- [ ] Undo/redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z) across a few different actions
- [ ] Zoom control (slider + Ctrl+scroll); pan via trackpad/wheel scroll
- [ ] Drill into a folder/source card, breadcrumb back out, ".." breadcrumb map
- [ ] Rename a folder/source card title inline (click to edit, Enter/Escape/blur to commit/revert)
- [ ] Draw mode: pen + eraser, front/back layer toggle, color/size

## Source / table

- [ ] Open a source, add rows/columns, edit cells
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
      (`isValidConnection`)
- [ ] Connect a source to a Stack card; confirm its real name shows (not "Source"), row count
      says "entries"
- [ ] Stack: rename its own name inline; search box filters connected sources/sessions; single
      click on a source pill opens that source's page; double-click its label renames it; dragging
      the Stack card does **not** focus the search box
- [ ] Filter card: connect a source, toggle tags, AND/OR mode
- [ ] Stopwatch connected to a game card; start/stop, confirm a session saves to a connected Stack

## Media

- [ ] Upload an image/video; paste an image/video by link; aspect ratio looks right
- [ ] Upload a PDF; viewer renders, text-layer selection, highlight-to-source
- [ ] Upload an EPUB; viewer renders, navigation works

## Waypoints, schedule, notifications

- [ ] Drop a waypoint, jump to it from the hamburger Waypoints panel
- [ ] Schedule view mode: add/edit/remove an event, day navigation
- [ ] Dotbot scheduling conversation flow
- [ ] Due-time notification fires for a scheduled card; day-change notification (3am cutoff)

## Hamburger menu / panels

- [ ] Outline panel: every card kind shows its real name (not a generic kind label) — folders,
      sources, and Stacks in particular
- [ ] Profile panel; Messages panel (send/receive); Collaborators panel
- [ ] Achievements panel
- [ ] Pricing/upgrade panel

## Collaboration

- [ ] Share a canvas with another account; confirm live cursor presence and content sync in two
      browser tabs/sessions
- [ ] Rename a shared canvas; confirm the collaborator's view updates
      (`canvas_collaborations.folder_title` sync)
- [ ] Revoke a collaboration

## Marketplace

- [ ] Package a card/canvas as a template draft, publish it
- [ ] Browse/search the marketplace, purchase/deploy a template
- [ ] Drag a card into the cart dropzone; drag a card onto the Schedule button; drag a card into
      an open chat

## Search

- [ ] Canvas search: find and jump to a card
- [ ] Dotbot search answers (language question, "how do I..." app question)
- [ ] Mnemonic generation (text + image)
