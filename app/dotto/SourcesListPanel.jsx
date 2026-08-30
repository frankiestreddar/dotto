"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { sourcesListStore } from "./bridges";
import RowActions from "./RowActions";
import usePortalNode from "./usePortalNode";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_STATE = { rows: [], query: "" };

// .outline-item/.search-history-icon/.outline-label — the same row structure #chats-list's rows
// and #search-panel-content's rows use (ChatsListPanel.jsx/search-panel-history.js), both sharing
// .panel-history-list's own row override — matches this panel too, since #sources-panel-content
// carries that same class (see hamburger-stack.html). source.png reused from SourceCard.jsx/the
// old rail icon. No shift-click multi-select (unlike Waypoints/Collaborations/Chats) — deleting a
// source isn't part of what was asked for, so there's nothing for a selection to actually do here
// yet; a plain click just opens it, same as before this list existed at all (SourceCard.jsx's own
// click handler, attachSourceCardClick).
// r.active (whichever source's own folder IS the current canvas — computed in renderSourcesList,
// hamburger-collab.js, so it stays correct across navigation without this component needing its
// own currentFolderId subscription) reuses the exact same .outline-item.active rule the Outline
// panel already applies to its own current-folder row (app/dotto/lib/outlineTree.ts) — a permanent
// version of the same highlight :hover gives every row, per explicit request.
// r.globalId's own display is Option/Alt-gated (see SourcesListPanel's own comment below on why
// SourceCard.jsx no longer shows it directly on the canvas block) — always rendered, but hidden by
// CSS (.outline-item-id{display:none}) unless BOTH `alt-reveal-id` (this component's own altHeld
// state, passed down) and :hover apply, at which point it swaps places with .outline-label instead
// of sitting alongside it (globals.css). Pure CSS for the hover half so no per-row mouseenter/leave
// tracking is needed here — only the keyboard half needs JS.
// Double-clicking the label renames the source in place (window.__startRenameFolderCardTitle, the
// same primitive the breadcrumb's current segment and folder/source cards already use, passed
// selectAll:true — per explicit follow-up request — so the whole name is selected right away
// instead of just a caret at the end, ready to be typed straight over) — per explicit request. A
// single click still navigates (window.__openFolder), so the row's own onClick needs the same
// "delay navigation, cancel if a second click lands within the window" dance ShelfCard.jsx's
// handleShelfSourceRowClick already establishes for this exact tension (see its own comment there)
// rather than firing immediately, or a genuine double-click would navigate away on its first click
// before ever reaching onDoubleClick. clickTimerRef is per-row (a plain local ref, not a shared
// appState slot like the vanilla shelf version) since each row's pending click is already scoped
// to its own component instance.
// .outline-label-renameable (on top of the shared .outline-label, globals.css) is what gives just
// THIS label a grey underline on hover — per explicit request, a visual hint that it's the
// double-clickable rename target — without adding that hover styling to every other, non-renameable
// use of the shared .outline-label class elsewhere (Outline/Waypoints/Chats rows, etc).
function SourceRow({ r, altHeld }) {
  const labelRef = useRef(null);
  const clickTimerRef = useRef(null);

  return (
    <div
      className={"outline-item" + (r.active ? " active" : "") + (altHeld ? " alt-reveal-id" : "")}
      onClick={(e) => {
        e.stopPropagation();
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
          return;
        }
        clickTimerRef.current = setTimeout(() => {
          clickTimerRef.current = null;
          window.__openFolder(r.folderId);
        }, 220);
      }}
    >
      <img className="search-history-icon" src="/assets/icons/source.png" alt="" />
      <span
        ref={labelRef}
        className="outline-label outline-label-renameable"
        onDoubleClick={(e) => {
          e.stopPropagation();
          window.__startRenameFolderCardTitle(
            labelRef.current,
            { folderId: r.folderId },
            "outline-label",
            true,
          );
        }}
        title="Double-click to rename"
      >
        {r.title}
      </span>
      {r.globalId && <span className="outline-item-id">{r.globalId}</span>}
      <RowActions />
    </div>
  );
}

// Portals into #sources-panel-content (content/fragments/hamburger-stack.html) — a plain flex-item
// container, safe to portal into directly, no wrapper needed. Visibility of the panel itself stays
// a vanilla classList toggle (openRailView/wireRailIcon, app/dotto/lib/panelsHamburger.ts), unrelated to this —
// this component only owns the row list. Lists every source anywhere in the account, current-
// canvas ones sorted first — see renderSourcesList's own comment, hamburger-collab.js, for the
// full reasoning and why it refreshes on every render() rather than just on panel-open/search-input.
//
// altHeld tracks the Option/Alt key globally (keydown/keyup, both scoped to this component's own
// mount rather than a permanently-attached vanilla listener — this state is only ever relevant
// while the Sources panel can actually be seen) — reset on window blur too, same convention
// app/dotto/lib/sourceButtonsCursorMode.ts's own mode-override system uses, so alt-tabbing away never leaves
// this "stuck" thinking the key is still held once focus returns. Per explicit request: source
// blocks on the canvas itself (SourceCard.jsx) no longer show their global id pill directly — it's
// only reachable here now, by holding Option and hovering a row, which swaps that row's name for
// its id (SourceRow above).
export default function SourcesListPanel() {
  const state = useSyncExternalStore(
    sourcesListStore.subscribe,
    sourcesListStore.getSnapshot,
    () => EMPTY_STATE,
  );
  const portalNode = usePortalNode("sources-panel-content");
  const [altHeld, setAltHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Alt") setAltHeld(true);
    };
    const onKeyUp = (e) => {
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  if (!portalNode) return null;

  return createPortal(
    state.rows.length ? (
      state.rows.map((r) => <SourceRow key={r.id} r={r} altHeld={altHeld} />)
    ) : (
      <div className="outline-empty">
        {state.query ? "No matching sources." : "No sources yet."}
      </div>
    ),
    portalNode,
  );
}
