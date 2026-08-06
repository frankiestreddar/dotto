"use client";

import { useSyncExternalStore } from "react";
import { pricingOverlayStore } from "./bridges";

// Placeholder prices/taglines/features — no real billing/subscription system exists in this
// codebase yet, so the paid CTAs surface a "coming soon" notification instead of pretending to
// start a real checkout (see startPlanUpgrade below). Moved out of appState (public/dotto/core-
// state.js) since this is pure presentation data with zero coupling to the rest of the app.
const PRICING_PLANS = [
  { id: "free", name: "Free", price: "$0", period: "/mo", tagline: "Get started with the basics.", cta: "Current Plan", current: true },
  { id: "pro", name: "Pro", price: "$9", period: "/mo", tagline: "For learners leveling up fast.", cta: "Upgrade to Pro", featured: true },
  { id: "polyglot", name: "Polyglot", price: "$19", period: "/mo", tagline: "Go all in on every language.", cta: "Upgrade to Polyglot" },
];

// Each row's `values` is [free, pro, polyglot] — same index lines up across all three cards. A
// falsy value means that plan doesn't get this feature; it's still shown (greyed, with a dash)
// using whichever plan's value is truthy, so the row reads the same across all 3 cards.
const PRICING_FEATURE_ROWS = [
  { values: ["100 canvas blocks", "500 canvas blocks", "Unlimited canvas blocks"] },
  { values: ["30 Dotbot searches / 6h", "150 Dotbot searches / 6h", "Unlimited Dotbot searches"] },
  { values: ["100 Dotbot generations / mo", "500 Dotbot generations / mo", "Unlimited Dotbot generations"] },
  { values: ["Unlimited canvases & waypoints", "Unlimited canvases & waypoints", "Unlimited canvases & waypoints"] },
  { values: ["Friends & collaboration", "Friends & collaboration", "Friends & collaboration"] },
  { values: [null, "Priority support", "Priority support"] },
  { values: [null, null, "Early access to new features"] },
];

function startPlanUpgrade(planId) {
  pricingOverlayStore.set(false);
  // pushNotification still lives in public/dotto/stopwatch-search-notifications.js (not migrated
  // yet) — window-bridged for exactly this call, see public/dotto/window-bridge.js.
  window.pushNotification({ type: "upgrade_unavailable", message: "Upgrades aren't available yet — check back soon!" });
}

export default function PricingOverlay() {
  // getSnapshot always starts false on both server and first client render (the overlay is never
  // open on load), so there's nothing to reconcile — no getServerSnapshot mismatch risk.
  const isOpen = useSyncExternalStore(pricingOverlayStore.subscribe, pricingOverlayStore.getSnapshot, () => false);

  if (!isOpen) return null;

  return (
    <div id="pricing-overlay" className="open" onClick={() => pricingOverlayStore.set(false)}>
      <div className="pricing-page" onClick={(e) => e.stopPropagation()}>
        <div className="pricing-page-header">
          <div className="pricing-page-title">Upgrade your plan</div>
          <button className="pricing-page-close" type="button" onClick={() => pricingOverlayStore.set(false)}>
            ✕
          </button>
        </div>
        <div id="pricing-cards">
          {PRICING_PLANS.map((plan, i) => (
            <div key={plan.id} className={"pricing-card" + (plan.featured ? " pricing-card-featured" : "")}>
              {plan.featured && <div className="pricing-card-badge">Most Popular</div>}
              <div className="pricing-card-name">{plan.name}</div>
              <div className="pricing-card-price">
                <span className="pricing-card-price-amount">{plan.price}</span>
                <span className="pricing-card-price-period">{plan.period}</span>
              </div>
              <div className="pricing-card-tagline">{plan.tagline}</div>
              <button
                className="pricing-card-cta"
                type="button"
                disabled={plan.current}
                onClick={plan.current ? undefined : () => startPlanUpgrade(plan.id)}
              >
                {plan.cta}
              </button>
              <div className="pricing-card-divider" />
              <ul className="pricing-card-features">
                {PRICING_FEATURE_ROWS.map((row, rowIndex) => {
                  const value = row.values[i];
                  const label = value || row.values.find(Boolean);
                  const excluded = !value;
                  return (
                    <li key={rowIndex} className={excluded ? "pricing-feature-excluded" : ""}>
                      <span className="pricing-feature-icon">{excluded ? "–" : "✓"}</span>
                      {label}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
