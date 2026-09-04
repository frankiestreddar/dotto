import { expect, test } from "@playwright/test";
import { goToRoot } from "./helpers";

// Promotes the shortcuts/draw-toolbar/zoom-track slice of
// .claude-testing/verify-phase4-5-srsconnectionscore-port.js to a permanent spec (the Phase 4.5
// port of srs-connections-core.js -> app/dotto/lib/srsConnectionsCore.ts). The click-to-link/
// CardStreamIO data-flow slice of that same script is already covered by
// e2e/authenticated/connections.spec.ts (batch 26) via a real drag gesture, so it isn't duplicated
// here. Covers: a real global keydown shortcut opening a rail panel, the draw toolbar's pen button
// toggling drawTool + its own active class, and a real zoom-track drag changing scale.
test.describe("shortcuts and draw tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("every srsConnectionsCore bridge this spec needs is wired up", async ({ page }) => {
    const bridges = await page.evaluate(() => ({
      __isValidConnection: typeof window.__isValidConnection === "function",
      __handleDataModeClick: typeof window.__handleDataModeClick === "function",
      __applyConnections: typeof window.__applyConnections === "function",
      __add: typeof window.__add === "function",
      __getDrawPenBtnEl: typeof window.__getDrawPenBtnEl === "function",
      __getZoomTrackEl: typeof window.__getZoomTrackEl === "function",
      cardStreamIOPopulated: (() => {
        const s = window.__getAppState!() as unknown as { CardStreamIO?: Record<string, unknown> };
        return !!(s.CardStreamIO && Object.keys(s.CardStreamIO).length > 5);
      })(),
    }));
    expect(Object.values(bridges).every(Boolean), JSON.stringify(bridges)).toBe(true);
  });

  test("a real 'w' keypress opens the Waypoints panel", async ({ page }) => {
    await page.keyboard.press("Escape"); // known baseline first
    await page.waitForTimeout(200);
    await page.keyboard.press("w");
    await page.waitForTimeout(300);
    const activeRailView = await page.evaluate(
      () =>
        (window.__getAppState!() as unknown as { activeRailView: string | null }).activeRailView,
    );
    expect(activeRailView).toBe("waypoints");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("a real click on the draw-pen-btn sets drawTool and the active class", async ({ page }) => {
    const result = await page.evaluate(() => {
      const btn = window.__getDrawPenBtnEl?.();
      if (!btn) return null;
      btn.click();
      const appState = window.__getAppState!() as unknown as { drawTool: string };
      return { drawTool: appState.drawTool, active: btn.classList.contains("active") };
    });
    expect(result).not.toBeNull();
    // "pen" is also coreState.ts's own default drawTool value — this assertion isn't just
    // confirming a no-op, since the real click handler still has to run and toggle the button's
    // own .active class either way.
    expect(result?.drawTool).toBe("pen");
    expect(result?.active).toBe(true);
  });

  test("a real zoom-track pointer drag changes scale", async ({ page }) => {
    const zoomBox = await page.evaluate(() => {
      const el = window.__getZoomTrackEl?.();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, top: r.top, height: r.height };
    });
    expect(zoomBox).not.toBeNull();
    const before = await page.evaluate(
      () => (window.__getAppState!() as unknown as { scale: number }).scale,
    );

    await page.mouse.move(zoomBox!.x, zoomBox!.top + 5);
    await page.mouse.down();
    await page.mouse.move(zoomBox!.x, zoomBox!.top + zoomBox!.height * 0.9, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await page.evaluate(
      () => (window.__getAppState!() as unknown as { scale: number }).scale,
    );
    expect(after).not.toBe(before);

    // Reset back to a sane default so this doesn't leak into another test.
    await page.evaluate(() => {
      const appState = window.__getAppState!() as unknown as {
        tx: number;
        ty: number;
        scale: number;
      };
      appState.tx = 0;
      appState.ty = 0;
      appState.scale = 1;
      window.__applyTransform?.();
    });
    await page.waitForTimeout(200);
  });
});
