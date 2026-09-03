"use client";

import { useEffect } from "react";
import MarkupSection from "./MarkupSection";
import { wireRailTooltipExpand } from "../lib/railTooltipExpand";

// Shell markup for "top-bar", migrated verbatim from Dotto.html.
// See content/fragments/top-bar.html for the source HTML.
export default function TopBar({ html }: { html: string }) {
  // Phase 4.1: rail-tooltip-expand.js's wiring now runs from here instead of the vanilla bundle
  // (see wireRailTooltipExpand's own comment) — #dotto-rail's .rail-btn elements from the markup
  // above already exist by the time this effect runs, same timing the old afterInteractive script
  // relied on.
  useEffect(() => wireRailTooltipExpand(), []);

  return <MarkupSection html={html} />;
}
