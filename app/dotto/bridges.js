// Canonical registration point for vanilla-JS <-> React bridges, as public/dotto/*.js gets
// migrated to real React one subsystem at a time (see PHASE2_ROADMAP.md). public/dotto/*.js can't
// import from app/ (same constraint that makes window.__dottoSupabase/__DOTTO_USER__ bridge the
// other direction in app/dotto-app.jsx), so each migrated piece of state gets a plain external
// store here: vanilla code keeps calling a small window.__set*/window.<fn> surface, and the React
// component that now owns the real state subscribes via useSyncExternalStore. New increments add
// their own store below rather than each inventing its own ad hoc globals.

function createStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  return {
    set(next) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return value;
    },
  };
}

export const pricingOverlayStore = createStore(false);

// Text-selection toolbar shell (Phase 2 increment 2) — {isOpen, left, top}, richer than
// pricingOverlayStore's plain boolean since this one also carries the toolbar's already-clamped
// screen position. See public/dotto/search-orchestration-selection.js's showSelectionToolbarFor/
// hideSelectionToolbar for the vanilla side that still owns WHEN to show/hide and WHERE.
export const selectionToolbarStore = createStore({ isOpen: false, left: 0, top: 0 });

// Canvas items layer (canvas-items-react plan, see PHASE2_ROADMAP.md) — the current folder's item
// array, set by render() (waypoints-render-loop.js) via window.__renderCanvasItems every time it
// would previously have wiped and rebuilt #world's item divs by hand. React now owns the #items-
// layer child of #world (see app/dotto/CanvasItemsLayer.jsx) and keys off item.id, so unchanged
// items are left alone instead of being torn down and recreated on every canvas interaction.
export const canvasItemsStore = createStore([]);

// Search-bar notification content (message/imageUrl/actionLabel) — the queue/sequencing engine
// and the staged CSS-class choreography that shows/hides it both stay fully vanilla (see
// public/dotto/stopwatch-search-notifications.js's showNotification/dismissCurrentNotification —
// neither is list-diffing or list-rebuilding, so there's no analogous bug to the canvas-items-
// react one to fix; only the notification's own rendering surface moves to React, via
// NotificationBar.jsx portaling into #search-notification-root, see content/fragments/top-bar.html).
// null means nothing has ever been shown yet (matches the original static markup's empty
// image/text/button on load) — showNotification sets this once per notification and dismissal
// deliberately leaves the last content in place rather than clearing it, same as the original
// (harmless: the notification bar is hidden via CSS once #search-input-wrap loses .notifying).
export const notificationStore = createStore(null);

// Schedule View Mode's agenda (public/dotto/messages-schedule.js's renderScheduleAgenda) — an
// { hours: [{hour, top}], events: [{it, ev, top, w, h}] } snapshot computed fresh on every entry/
// date-shift, same "compute data, hand it to React" split as canvasItemsStore, just for a single
// read-mostly view instead of a persistent list. Each event's own preview DOM (it can be any card
// kind) still gets built by the vanilla renderRealCardPreview — a whole live node, same "vanilla
// function builds live DOM, React just mounts it" reasoning as CanvasCard's
// buildFolderInlineCanvas — see ScheduleAgenda.jsx.
export const scheduleAgendaStore = createStore({ hours: [], events: [] });

// Search-dropdown result panels (public/dotto/mnemonic-search-matching.js) — each a single-owner
// static container (#search-translation/#search-dictionary/etc.), unlike #search-suggestions/
// #search-results which are shared by multiple producers and not converted yet. null means
// "nothing to show" (matches each panel's own display:none default) — the actual card content
// still comes from a vanilla builder (buildTranslationCard/buildDictionaryCard/etc., several of
// them small self-contained widgets with their own internal cycling/drag state), mounted by a
// plain side-effect component (TranslationPanel.jsx and friends) rather than a portal, since
// there's no list to key/diff — one blob of vanilla-built content, wholesale-replaced each time,
// same as before, just triggered by React state instead of a direct DOM write.
//
// All six __set* bridges for these (app/dotto-app.jsx) wrap their store.set in flushSync, unlike
// notificationStore/scheduleAgendaStore above — updateSearchDropdown (ai-assistant-suggestions.js)
// reads each panel's real DOM node's style.display SYNCHRONOUSLY right after calling its
// render*Panel function (see renderOrchestrateResult in search-orchestration-selection.js, which
// calls several of these back-to-back and then updateSearchDropdown once at the end) — without
// flushSync, that read would race the layout effect that actually sets style.display and could
// see a stale value, exactly the bug flushSync already exists to prevent for canvasItemsStore.
export const translationPanelStore = createStore(null);
export const dictionaryPanelStore = createStore(null);
export const examplesPanelStore = createStore(null);
export const recommendedSearchesStore = createStore(null);
// { text, answerBlocksPanel, answerBlocksLanguage } | null — combines what were originally two
// separate vanilla functions (renderDotbotAnswerPanel/renderAnswerBlocksPanel) into one store:
// the second always ran immediately after the first, appending into the SAME container the first
// had just cleared, so they were never really two independent panels — see
// DotbotAnswerPanel.jsx and renderDotbotAnswerPanel's own updated comment.
export const dotbotAnswerStore = createStore(null);
// { status: 'loading' | 'error' | 'success', reason, imageDataUrl } | null — the mnemonic image
// result panel's three mutually-exclusive states, see ImageResultPanel.jsx.
export const imageResultStore = createStore(null);
