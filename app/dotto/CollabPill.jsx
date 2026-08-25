"use client";

import { useLayoutEffect } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { collabPillStore } from "./bridges";
import usePortalNode from "./usePortalNode";

const EMPTY_STATE = { show: false, collabs: [], moreCount: 0 };

// Reads an element's natural (un-collapsed) content width without a visible flash — temporarily
// lifts its own max-width cap, measures, then restores it, all synchronously within the same
// useLayoutEffect tick (before the browser ever paints in between). Used below to compute
// --tb-offset-target: #nav-arrows-pill/#collab-bubble are both collapsed via max-width:0 at rest
// (globals.css), so a plain getBoundingClientRect() on either at rest would just report ~0, not
// the real width they grow to on hover.
function measureNaturalWidth(el) {
  if (!el) return 0;
  const prevTransition = el.style.transition;
  const prevMaxWidth = el.style.maxWidth;
  el.style.transition = "none";
  el.style.maxWidth = "none";
  const width = el.getBoundingClientRect().width;
  el.style.maxWidth = prevMaxWidth;
  el.style.transition = prevTransition;
  return width;
}

// Portals into #collab-content (content/fragments/top-bar.html) — a plain content wrapper inside
// #collab-bubble. #collab-bubble's own `.show` class and #collab-tooltip's text sit OUTSIDE the
// portal (siblings of #collab-content, not children of it), so they're synced imperatively below
// rather than through React — safe since nothing else ever writes to them (see collabPillStore's
// own comment in bridges.js). useLayoutEffect (not useEffect) so this is guaranteed to have run by
// the time the flushSync'd bridge call returns — openCollabPanel reads collabBubble's `.show`
// class synchronously right after one of its callers re-renders this pill.
export default function CollabPill() {
  const state = useSyncExternalStore(collabPillStore.subscribe, collabPillStore.getSnapshot, () => EMPTY_STATE);
  const portalNode = usePortalNode("collab-content");

  useLayoutEffect(() => {
    const bubble = document.getElementById("collab-bubble");
    const tooltip = document.getElementById("collab-tooltip");
    const total = state.collabs.length + state.moreCount;
    if (bubble) bubble.classList.toggle("show", state.show);
    if (tooltip) tooltip.textContent = total > 0 ? `${total} collaborator${total === 1 ? "" : "s"}` : "";

    // --tb-offset-target (globals.css, #top-bar-center) keeps #breadcrumb-pill's own on-screen
    // centre fixed at the viewport's regardless of #nav-arrows-pill/#collab-bubble growing by
    // different amounts on hover — recomputed here since it's this component's own re-renders
    // (a collaborator joining/leaving, or .show flipping) that are the only thing that can actually
    // change either side's natural width; #nav-arrows-pill's own two buttons never change, but
    // it's re-measured alongside #collab-bubble anyway rather than hardcoding a constant, so this
    // keeps working correctly if that ever changes too. #collab-bubble measures as 0 when !state.show
    // rather than reading its actual (irrelevant) content width — with .show absent, the CSS rule
    // that grows it on hover never matches at all (see that rule's own comment), so it truly never
    // contributes any width in that case, regardless of what it currently contains.
    const navArrows = document.getElementById("nav-arrows-pill");
    const topBarCenter = document.getElementById("top-bar-center");
    if (bubble && navArrows && topBarCenter) {
      const collabWidth = state.show ? measureNaturalWidth(bubble) : 0;
      const navWidth = measureNaturalWidth(navArrows);
      topBarCenter.style.setProperty("--tb-offset-target", `${(collabWidth - navWidth) / 2}px`);
    }
  }, [state]);

  if (!portalNode || !state.show) return null;

  if (!state.collabs.length) {
    return createPortal(
      <button id="collab-add-btn" title="Add collaborators" onClick={(e) => { e.stopPropagation(); window.__openCollabPanel(true); }}>
        <img className="rail-icon-img" src="/assets/icons/collaboration.png" alt="" />
      </button>,
      portalNode,
    );
  }

  return createPortal(
    <div className="collab-avatars">
      {state.collabs.map((f) => (
        <Avatar key={f.id} className="collab-avatar" avatar={{ id: f.avatarId, url: f.avatarUrl }} name={f.displayName} />
      ))}
      {state.moreCount > 0 && <div className="collab-avatar collab-more">+{state.moreCount}</div>}
    </div>,
    portalNode,
  );
}
