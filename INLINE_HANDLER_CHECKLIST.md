# Inline-handler checklist (Phase 1 module split)

Every one of these 104 functions is called by *name* from inline HTML (`onclick="fn(...)"` etc.)
— both the static markup fragments (`content/fragments/*.html`) and HTML strings the app itself
generates. Real ES modules don't attach top-level functions to `window` the way the old classic
script did, so `public/dotto/window-bridge.js` does it explicitly for every one of these,
generated from a grep of the actual call sites (not typed by hand — see `PHASE2_ROADMAP.md` Phase
1). If any single line was missed or misspelled in that generation, the exact action next to it
below will silently do nothing — no error, no console message, just a dead button. That's what
this list is for: walk every row once after this PR, in a real browser.

Grouped by which module now owns the function (purely for readability while checking — it has no
bearing on what to click).

## Add menu
- [ ] `switchAddTab` — open the Add menu, click between its tabs (Notes / Tools / Games)
- [ ] `toggleAddMenuSearch` — open the Add menu, click the search icon to reveal its search box
- [ ] `handleAddMenuSearchInput` — with that search box open, type a few characters, confirm the list filters
- [ ] `newSourceClicked` — Add menu → Notes/Tools tab → click "Source"

## Search / AI context cards
- [ ] `handleSearchFocus` — click into the main search bar
- [ ] `handleSearchInput` — type into the main search bar, confirm suggestions/results update
- [ ] `clearSearchCardContext` — drag a card into the search box as AI context, then click its "x" to remove it
- [ ] `openSearchCardsModal` — with 2+ cards dragged into search context, click the context pill to expand it
- [ ] `closeSearchCardsModal` — with that modal open, close it

## Notes / embeds / checklist
- [ ] `editEmbed` — add an Embed card, click it, confirm the edit field opens
- [ ] `addTask` — add a Checklist card, click "+ add task"
- [ ] `toggleTask` — check/uncheck a checklist item
- [ ] `removeTask` — delete a checklist item
- [ ] `updateTaskText` — edit a checklist item's text
- [ ] `updateTaskDeadline` — set/change a checklist item's deadline

## Copy/paste
- [ ] `prepareAdd` — open the Add menu and actually place a card (confirms the add-flow's own internal wiring, not just Cmd+V)

## Friends / collaborators panel
- [ ] `openCollabPanel` — click the collaborators bubble
- [ ] `handleCollabSearch` — in that panel, type into its search box
- [ ] `handleMsgSearch` — open Messages, type into its search box

## Games (flashcards / typeright / cloze config)
- [ ] `fcFlip` — open a Flashcard card, click to flip it
- [ ] `fcRate` — flip a flashcard, click one of the 1-4 rating buttons
- [ ] `fcToggleMode` — toggle a flashcard's front/back mode setting
- [ ] `trCheck` — open a Typeright card, type an answer, click Check
- [ ] `trNext` — after checking, click Next
- [ ] `trFocusInput` — click into a Typeright card's answer input
- [ ] `trUpdateInput` — type into that input, confirm it registers
- [ ] `trToggleMode` — toggle a Typeright card's mode setting
- [ ] `addGameColumnSlot` — right-click a flashcard/typeright card's column config, add a slot
- [ ] `removeGameColumnSlot` — remove a slot from that same config
- [ ] `setGameColumnSlot` — change what a slot shows (front/back/cloze) in that config

## Hamburger menu
- [ ] `hmenuAction` — open the hamburger menu, click any of its top-level menu items
- [ ] `openHubCollabPanel` — hamburger menu → Collaborations
- [ ] `handleHubCollabSearch` — in that panel, type into its search box
- [ ] `openWaypointsPanel` — hamburger menu → Waypoints
- [ ] `handleWaypointsSearch` — in that panel, type into its search box

## Undo/redo, context menu
- [ ] `undo` — Cmd/Ctrl+Z isn't the only path in; right-click a table cell/column and use its own controls, or confirm the toolbar's own undo button (if present) still works
- [ ] `redo` — same, redo direction
- [ ] `hideCanvasContextMenu` — right-click a table cell to open the context menu, then click elsewhere to close it
- [ ] `deleteContextColumn` — right-click a table column header, delete it
- [ ] `deleteContextRow` — right-click a table row, delete it
- [ ] `highlightContextColumn` — right-click a table column, confirm hover-highlight before deleting
- [ ] `highlightContextRow` — same, for a row

## Library / publish flow
- [ ] `startPublishFlow` — from your library, start publishing a draft
- [ ] `focusPublishFlowName` / `blurPublishFlowName` — click into and out of the publish-flow name field
- [ ] `confirmPublishFlow` — complete a publish
- [ ] `commitItemDetailTitle` / `commitItemDetailDesc` — open a library item's detail view, edit its title/description
- [ ] `onItemDetailFieldChange` — type in either of those fields, confirm live-dirty state updates
- [ ] `updateDetailItem` — save changes to a library item
- [ ] `unpublishDetailItem` — unpublish a published item
- [ ] `deleteDetailDraft` — delete a draft

## Live presence / messaging
- [ ] `broadcastEditingState` — start editing any text field on a shared canvas (with a second session watching, confirm the "editing" indicator appears for them)
- [ ] `closeConvo` — open a chat conversation, close it
- [ ] `closeSharedCanvasView` — exit a shared canvas view back to your own
- [ ] `sendMsg` — send a chat message
- [ ] `setTitleLevel` — select a Title card, change its heading level (H1/H2/H3)

## Marketplace
- [ ] `switchCartTab` — open the cart/marketplace panel, switch between Discover/Library tabs
- [ ] `handleMarketplaceSearch` — type into the marketplace search box
- [ ] `handleLibrarySearch` — type into the library search box
- [ ] `switchLibraryFolder` — switch between library folders (Purchased/Drafts/Published)
- [ ] `closeMarketDetail` — open an item's detail view from the marketplace, close it
- [ ] `purchaseCurrentMarketItem` — purchase an item
- [ ] `deployPurchasedTemplate` — deploy a purchased template onto the canvas
- [ ] `addItemToCustomFolderById` / `removeFromCustomFolder` — organize library items into a custom folder and back out

## Media (image/video/PDF/EPUB)
- [ ] `triggerMediaUpload` — add a Media card, click Upload
- [ ] `setMediaFromLink` — add a Media card, click Link, paste a URL
- [ ] `clearMedia` — click the "x" on an existing media card to remove its content

## Schedule
- [ ] `scheduleAgendaShift` — open Schedule view mode, navigate to the next/previous day

## Pricing / upgrade
- [ ] `openPricingOverlay` — trigger the upgrade prompt (or open it directly if there's a menu path), confirm it opens
- [ ] `closePricingOverlay` — close it
- [ ] `closeDotbotUpgradeModal` — trigger the Dotbot usage-limit modal, close it

## Table resize
- [ ] `setTableAlign` — select a table, change its text alignment

## Source page — cell add menu
- [ ] `openCellAddMenu` — open a source, click a cell's own Add/Upload/Tags hover button

## Source page — table editing
- [ ] `addTableCol` / `addTableRow` — open a source, add a column and a row
- [ ] `handleTableKeydown` — type into a cell, confirm Tab/Enter navigation works
- [ ] `updateTableCell` — edit a cell's text
- [ ] `setLastFocusedCell` — click into any cell (was missing from the original generation — this
      one threw `ReferenceError: setLastFocusedCell is not defined` in the console until fixed)
- [ ] `renameTableColumn` — rename a column header
- [ ] `handleColNameKeydown` — while renaming a column header, confirm Enter/Escape work
- [ ] `openTableCellContextMenu` — right-click a cell, confirm the context menu opens
- [ ] `triggerCellImageUpload` — insert an image into a cell
- [ ] `triggerCellAudioUpload` — insert an audio file into a cell
- [ ] `startCellAudioRecording` / `stopCellAudioRecording` — record audio directly into a cell

## Source page — tags
- [ ] `toggleCellTag` — open a cell's tag picker, apply a tag
- [ ] `createTagFromCellPicker` — create a brand-new tag from that picker
- [ ] `closeCellTagPicker` — close the tag picker
- [ ] `openTagContextMenu` — right-click an applied tag
- [ ] `startRenameActiveTag` / `handleTagRenameKeydown` / `commitTagRename` — rename a tag inline via that context menu
- [ ] `deleteActiveTag` — delete a tag via that context menu
- [ ] `closeTagContextMenu` — close the context menu without acting
- [ ] `triggerSourceUpload` — import a delimited file into a source

## Stopwatch / Stack (shelf) / Filter
- [ ] `swToggleRun` — add a Stopwatch card, start/stop it
- [ ] `swTogglePause` — pause/resume it while running
- [ ] `shelfSelectSession` — add a Stack card with a saved session, click to select it
- [ ] `filterShelfRows` — type into a Stack card's search box, confirm it filters
- [ ] `handleShelfSourceRowClick` — click a connected-source pill in a Stack, confirm it opens that source's page
- [ ] `startRenameShelfName` — click a Stack's own name to rename it inline
- [ ] `startRenameShelfSourceRow` — double-click a connected-source pill's label to rename it inline
- [ ] `setFilterMode` — add a Filter card, toggle AND/OR
- [ ] `toggleFilterTag` — toggle one of its tag chips
- [ ] `runNotificationAction` — trigger any notification with an action button (e.g. a due-scheduled-event alert), click its action
