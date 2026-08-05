"use client";

import Script from "next/script";
import { createClient } from "@/lib/supabase/client";

import TopBar from "./dotto/sections/TopBar";
import ProfilePanel from "./dotto/sections/ProfilePanel";
import MessagesPanel from "./dotto/sections/MessagesPanel";
import CollaboratorsPanel from "./dotto/sections/CollaboratorsPanel";
import SharedCanvasModal from "./dotto/sections/SharedCanvasModal";
import MarketplacePanel from "./dotto/sections/MarketplacePanel";
import HamburgerMenu from "./dotto/sections/HamburgerMenu";
import CanvasArea from "./dotto/sections/CanvasArea";
import BottomToolbars from "./dotto/sections/BottomToolbars";
import ZoomControl from "./dotto/sections/ZoomControl";
import AddMenu from "./dotto/sections/AddMenu";
import SourceAddMenu from "./dotto/sections/SourceAddMenu";
import CellTagPicker from "./dotto/sections/CellTagPicker";
import AudioRecordIndicator from "./dotto/sections/AudioRecordIndicator";
import DrawSettingsBar from "./dotto/sections/DrawSettingsBar";
import ItemContextMenu from "./dotto/sections/ItemContextMenu";
import CanvasContextMenu from "./dotto/sections/CanvasContextMenu";
import Footer from "./dotto/sections/Footer";

// Phase 1 "lift and shim" + Phase 2 increment 1 ("shell componentization").
//
// The original Dotto.html was one file: static markup followed by a single
// giant classic (non-module) <script> that queries the DOM with
// document.getElementById(...) at top level and wires everything up with
// closures over shared mutable state. Rather than trying to rewrite all 269
// interdependent functions into React state in one pass (high risk of
// silently losing behavior), this component reproduces the exact same
// runtime shape under Next.js, now split into per-subsystem sections:
//
//   1. Each section's markup is injected verbatim via dangerouslySetInnerHTML
//      (see app/dotto/sections/*), so it's real HTML parsed by the browser
//      (not JSX) — every inline onclick="..."/oninput="..." attribute from
//      the original file keeps working unmodified, resolved against the
//      global scope at click time. Splitting into named sections is purely
//      organizational (confirmed no CSS/JS in the original relies on these
//      containers being direct children of <body> or on their exact sibling
//      order via `:nth-child`), so this is still zero behavior change.
//   2. The legacy script is loaded from /public/dotto-script.js as a plain
//      classic <script src> tag (next/script, strategy="afterInteractive"),
//      so it runs after all the markup above is already in the DOM — exactly
//      like it did at the bottom of <body> in the original file. It keeps
//      declaring top-level `function`s (which attach to window) and
//      `const`/`let` state exactly as before.
//
// Phase 2 will continue by peeling pieces of dotto-script.js into real React
// state/hooks, subsystem by subsystem (see PHASE2_ROADMAP.md), replacing
// this shim a bit at a time rather than all at once.
//
// dotto-script.js is a classic (non-module) script, so it can't `import` the
// Supabase client itself. Instead this component — which hydrates before the
// afterInteractive script runs — hangs a shared client on `window` for it to
// use, alongside the signed-in user's profile.
if (typeof window !== "undefined" && !window.__dottoSupabase) {
  window.__dottoSupabase = createClient();
}

export default function DottoApp({ sections, currentUser }) {
  // A raw <script> rendered via JSX/dangerouslySetInnerHTML is never executed
  // by the browser on the client (same rule as innerHTML) — it silently did
  // nothing here. Setting it directly during render is what actually runs,
  // same as the window.__dottoSupabase bootstrap above.
  if (typeof window !== "undefined") {
    // Deliberately not moved into an effect (which the react-hooks/immutability rule below
    // would otherwise want) — dotto-script.js's afterInteractive <Script> tag needs
    // window.__DOTTO_USER__ set before it runs, and setting it during render (not after paint,
    // which an effect would do) is what guarantees that ordering — same reasoning as the
    // window.__dottoSupabase bootstrap above.
    // eslint-disable-next-line react-hooks/immutability
    window.__DOTTO_USER__ = currentUser;
  }

  return (
    <>
      <div id="dotto-root">
        <TopBar html={sections["top-bar"]} />
        <ProfilePanel html={sections["profile-panel"]} />
        <MessagesPanel html={sections["messages-panel"]} />
        <CollaboratorsPanel html={sections["collab-panel"]} />
        <SharedCanvasModal html={sections["canvas-modal"]} />
        <MarketplacePanel html={sections["cart-panel"]} />
        <HamburgerMenu html={sections["hamburger-stack"]} />
        <CanvasArea html={sections["canvas-area"]} />
        <BottomToolbars html={sections["bottom-toolbars"]} />
        <ZoomControl html={sections["zoom-control"]} />
        <AddMenu html={sections["add-menu"]} />
        <SourceAddMenu html={sections["source-add-menu"]} />
        <CellTagPicker html={sections["cell-tag-picker"]} />
        <AudioRecordIndicator html={sections["audio-record-indicator"]} />
        <DrawSettingsBar html={sections["draw-settings"]} />
        <ItemContextMenu html={sections["context-menu"]} />
        <CanvasContextMenu html={sections["canvas-context-menu"]} />
        <Footer html={sections["footer"]} />
      </div>
      <Script src="/dotto-script.js" strategy="afterInteractive" />
    </>
  );
}
