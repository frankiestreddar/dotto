// Sidebar Mode dropdown — #profile-settings-view's own fully custom trigger+popup
// (content/fragments/hamburger-stack.html; was a native <select> until an explicit follow-up
// request to not use "the standard html dropdown", and lived in #settings-panel before that
// panel's own rail icon was removed and its content moved into a sub-view of the Profile panel
// instead), toggling between the two rail-panel layout behaviors this app has had this session:
// panels overlaying the canvas (the original behavior) vs. reserving their own screen space and
// pushing the canvas/source-table over (the current default — see #canvas's and
// .item.static-table's own body:has(#hamburger-stack.open):not([data-sidebar-mode="overlay"])
// overrides, app/globals.css).
//
// Phase 4.1 port (public/dotto/sidebar-mode-toggle.js) — zero imports in the original, so this
// moved verbatim with no bridge needed at all; the first vanilla file to fully exit the bridge
// system. Called once from HamburgerMenu.jsx's own useEffect on mount.

const SIDEBAR_MODE_STORAGE_KEY = "dotto-sidebar-mode";
const MODE_LABELS: Record<string, string> = { push: "Push", overlay: "Overlay" };

export function wireSidebarModeToggle(): () => void {
  const trigger = document.getElementById("sidebar-mode-trigger");
  const triggerLabel = document.getElementById("sidebar-mode-trigger-label");
  const popup = document.getElementById("sidebar-mode-popup");
  if (!trigger || !triggerLabel || !popup) return () => {};
  const rows = Array.from(popup.querySelectorAll<HTMLElement>(".settings-dropdown-row"));

  // Idempotent re-registration (same pattern as canvasItemBehavior.js's setupDraggingAndClicking)
  // — aborts any previous listener set before attaching a new one, so this can safely be called
  // more than once (e.g. React Strict Mode's double-invoked effects) without stacking duplicates.
  const controller = new AbortController();
  const { signal } = controller;

  function closeDropdown() {
    popup!.classList.remove("open");
  }
  function toggleDropdown() {
    popup!.classList.toggle("open");
  }

  // Only 'overlay' ever needs to be recorded on <body>; its absence already means "push" (the
  // default) — the CSS overrides above are written as :not([data-sidebar-mode="overlay"]) rather
  // than checking for an explicit "push" value, for exactly that reason.
  function setSidebarMode(mode: string) {
    if (mode === "overlay") document.body.dataset.sidebarMode = "overlay";
    else delete document.body.dataset.sidebarMode;
    try {
      localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, mode);
    } catch {
      // private browsing, storage disabled, etc. — choice just won't persist across reloads
    }
    triggerLabel!.textContent = MODE_LABELS[mode];
    rows.forEach((row) => row.classList.toggle("active", row.dataset.mode === mode));
  }

  let initialMode = "push";
  try {
    if (localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY) === "overlay") initialMode = "overlay";
  } catch {
    // private browsing, storage disabled, etc. — falls back to the push default
  }
  setSidebarMode(initialMode);

  trigger.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      toggleDropdown();
    },
    { signal },
  );
  rows.forEach((row) => {
    row.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        setSidebarMode(row.dataset.mode!);
        closeDropdown();
      },
      { signal },
    );
  });
  // A capture-phase listener (not the usual bubble phase) specifically because #profile-panel's
  // own onclick="event.stopPropagation()" (hamburger-stack.html) would otherwise swallow a click
  // on any OTHER settings row before it ever reached a plain document-level bubble listener —
  // capture fires on the way DOWN to the target, before that stopPropagation (called during the
  // bubble phase back up) ever runs, so this still sees every click regardless.
  document.addEventListener(
    "click",
    (e) => {
      if (!popup!.classList.contains("open")) return;
      if (trigger!.contains(e.target as Node) || popup!.contains(e.target as Node)) return;
      closeDropdown();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") closeDropdown();
    },
    { signal },
  );

  return () => controller.abort();
}
