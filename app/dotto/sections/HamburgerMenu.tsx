"use client";

import { useEffect } from "react";
import MarkupSection from "./MarkupSection";
import { wireSidebarModeToggle } from "../lib/sidebarModeToggle";
import { wireThemeToggle } from "../lib/themeToggle";
import { wireSearchPanelHistory } from "../lib/searchPanelHistory";

// Shell markup for "hamburger-stack", migrated verbatim from Dotto.html.
// See content/fragments/hamburger-stack.html for the source HTML.
export default function HamburgerMenu({ html }: { html: string }) {
  // Phase 4.1: sidebar-mode-toggle.js's wiring now runs from here instead of the vanilla bundle
  // (see wireSidebarModeToggle's own comment) — real DOM elements from the markup above already
  // exist by the time this effect runs, same timing the old afterInteractive script relied on.
  useEffect(() => wireSidebarModeToggle(), []);
  // Same reasoning as wireSidebarModeToggle above — theme-toggle.js's own switch row lives in this
  // same markup (see wireThemeToggle's own comment).
  useEffect(() => wireThemeToggle(), []);
  // Same reasoning again — #search-panel-search/#search-panel-content (search-panel-history.js's
  // own markup) live in this same fragment too.
  useEffect(() => wireSearchPanelHistory(), []);

  return <MarkupSection html={html} />;
}
