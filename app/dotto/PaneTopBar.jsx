"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Avatar from "./Avatar";
import { collabPillStore, navHistoryStore } from "./bridges";
import TabsBar from "./TabsBar";

// Module-level, not inline — see CanvasItemsLayer.jsx's identical EMPTY_ITEMS comment for why a
// fresh object literal as the getServerSnapshot fallback trips React's "should be cached" warning.
const EMPTY_NAV = { canGoBack: false, canGoForward: false };
const EMPTY_COLLAB = { show: false, collabs: [], moreCount: 0 };

// Same TOP_BAR_PROXIMITY_PX/distance-to-rect/touch-then-leave-stays-collapsed state machine that
// used to live as a single global mousemove listener in resize-shortcuts-init.js (see that file's
// own comment for where it moved from) — now one independent instance per pane, since "each one
// expands individually" was the explicit ask this component exists to satisfy.
const PROXIMITY_PX = 100;

// Each pane's own FULL top-bar pill (split-screen Stage 8, explicit correction to Stage 7's
// per-pane-tab-row-only version — the user's own follow-up: "each split should have its own copy
// of the whole breadcrumb pill, with its own arrows and collab button relevant to the current
// canvas its on, and its own add tab button. and each one expands individually"). Renders the same
// 3-column grid #top-bar-center's own markup used to be (nav-arrows | tab row anchor | collab+add-
// tab), mounted once per pane from PaneCanvasArea.jsx at that pane's own centred position — see
// .pane-breadcrumb-pill's own comment, globals.css, for the full CSS side of this.
//
// Back/forward (window.__navBack/__navForward, shared-canvases-outline.js) and the tab-add button
// (window.__addTab) both activate this pane first if it wasn't already active, same convention
// every other per-pane control in this codebase follows — they're plain vanilla functions, not
// duplicated here. The collaborator bubble is the one piece with real shared state behind it (a
// single #collab-panel flyout, not one per pane) — collabBubblePaneClick/MouseEnter/MouseLeave
// (friends-presence.js) retarget appState.collabBubble (a reassignable object property, not a
// binding) to THIS bubble's own DOM node before reusing that one shared flyout's existing open/
// close/position logic unchanged, activating this pane first the same way.
export default function PaneTopBar({ paneId, rect }) {
  const paneNavStore = navHistoryStore.storeFor(paneId);
  const nav = useSyncExternalStore(
    paneNavStore.subscribe,
    paneNavStore.getSnapshot,
    () => EMPTY_NAV,
  );
  const paneCollabStore = collabPillStore.storeFor(paneId);
  const collab = useSyncExternalStore(
    paneCollabStore.subscribe,
    paneCollabStore.getSnapshot,
    () => EMPTY_COLLAB,
  );

  const pillRef = useRef(null);
  const bubbleRef = useRef(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let zoneUsed = false;
    let wasOverPill = false;
    function distanceToRect(x, y, r) {
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      return Math.hypot(dx, dy);
    }
    function handleMove(e) {
      const el = pillRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dist = distanceToRect(e.clientX, e.clientY, r);
      const overPill = dist === 0;
      const inZone = dist <= PROXIMITY_PX;
      let next;
      if (overPill) next = true;
      else if (!inZone) {
        next = false;
        zoneUsed = false;
      } else if (wasOverPill) {
        next = false;
        zoneUsed = true;
      } else next = !zoneUsed;
      wasOverPill = overPill;
      setExpanded(next);
    }
    // No further mousemove ever fires once the cursor leaves the window, which could otherwise
    // leave this pane's pill stuck expanded — same "clear on blur" safety net the old global
    // listener used for the identical problem.
    function handleBlur() {
      zoneUsed = false;
      wasOverPill = false;
      setExpanded(false);
    }
    document.addEventListener("mousemove", handleMove);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const total = collab.collabs.length + collab.moreCount;

  return (
    <div
      ref={pillRef}
      id={"pane-breadcrumb-pill-" + paneId}
      className={"pane-breadcrumb-pill" + (expanded ? " pill-proximity" : "")}
      // top must be computed from rect.y (a real bug found via split-screen Stage 9's own
      // quartering testing — a column split's BOTTOM pane used to render its pill at the CSS
      // rule's flat top:12px, exactly overlapping the TOP pane's own pill instead of sitting near
      // its own box; row splits never exposed this since every row-split pane spans the full
      // height, rect.y === 0 for all of them). `calc(...)` composes rect.y's own percentage offset
      // with the same 12px inset .pane-breadcrumb-pill's own CSS rule always used.
      style={{ left: (rect.x + rect.w / 2) * 100 + "%", top: `calc(${rect.y * 100}% + 12px)` }}
    >
      <div className="pane-nav-arrows">
        <button
          type="button"
          className="btn"
          title="Back"
          disabled={!nav.canGoBack}
          onClick={() => window.__navBack(paneId)}
        >
          <img
            className="pane-nav-arrow-img pane-nav-arrow-back"
            src="/assets/icons/arrow.png"
            alt=""
          />
        </button>
        <button
          type="button"
          className="btn"
          title="Forward"
          disabled={!nav.canGoForward}
          onClick={() => window.__navForward(paneId)}
        >
          <img className="pane-nav-arrow-img" src="/assets/icons/arrow.png" alt="" />
        </button>
      </div>
      <div id={"pane-tabs-" + paneId} className="pane-tabs-anchor" />
      <div className="pane-right-actions">
        <div
          ref={bubbleRef}
          className={"pane-collab-bubble" + (collab.show ? " show" : "")}
          onClick={(e) => {
            e.stopPropagation();
            window.__collabBubblePaneClick(paneId, bubbleRef.current);
          }}
          onMouseEnter={() => window.__collabBubblePaneMouseEnter(paneId, bubbleRef.current)}
          onMouseLeave={() => window.__collabBubblePaneMouseLeave(bubbleRef.current)}
        >
          {collab.collabs.length ? (
            <div className="collab-avatars">
              {collab.collabs.map((f) => (
                <Avatar
                  key={f.id}
                  className="collab-avatar"
                  avatar={{ id: f.avatarId, url: f.avatarUrl }}
                  name={f.displayName}
                />
              ))}
              {collab.moreCount > 0 && (
                <div className="collab-avatar collab-more">+{collab.moreCount}</div>
              )}
            </div>
          ) : (
            <button type="button" className="pane-collab-add-btn" title="Add collaborators">
              <img className="rail-icon-img" src="/assets/icons/collaboration.png" alt="" />
            </button>
          )}
          <div className="collab-tooltip">
            {total > 0 ? `${total} collaborator${total === 1 ? "" : "s"}` : ""}
          </div>
        </div>
        <button
          type="button"
          className="pane-tab-add-btn"
          title="New tab"
          onClick={(e) => {
            e.stopPropagation();
            window.__addTab(paneId);
          }}
        >
          <img className="pane-tab-add-img" src="/assets/icons/add.png" alt="" />
        </button>
      </div>
      <TabsBar paneId={paneId} />
    </div>
  );
}
