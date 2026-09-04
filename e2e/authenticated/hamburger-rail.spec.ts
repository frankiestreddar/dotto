import { expect, test } from "@playwright/test";
import { goToRoot } from "./helpers";

// Promotes .claude-testing/verify-phase4-5-panelshamburger-port.js to a permanent spec — the
// permanent rail's shared open/close contract (app/dotto/lib/panelsHamburger.ts), used by
// essentially every panel in the app: opening a rail panel, switching between two different rail
// panels, closing by re-clicking the already-active icon, a real search input filtering a panel's
// rows, and Escape closing whatever's open.
test.describe("hamburger rail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("every panelsHamburger bridge is wired up after boot", async ({ page }) => {
    const bridgesReady = await page.evaluate(() => ({
      closeRailView: typeof window.__closeRailView === "function",
      wireRailIcon: typeof window.__wireRailIcon === "function",
      openRailView: typeof window.__openRailView === "function",
      closeAllPanels: typeof window.__closeAllPanels === "function",
      isAnyUiPanelOpen: typeof window.__isAnyUiPanelOpen === "function",
      handleSourcesSearch: typeof window.handleSourcesSearch === "function",
      handleWaypointsSearch: typeof window.handleWaypointsSearch === "function",
    }));
    expect(Object.values(bridgesReady).every(Boolean), JSON.stringify(bridgesReady)).toBe(true);
  });

  test("nothing is open by default", async ({ page }) => {
    const open = await page.evaluate(() => window.__isAnyUiPanelOpen!());
    expect(open).toBe(false);
  });

  test("a real click on a rail icon opens its panel", async ({ page }) => {
    await page.locator("#btn-menu").click();
    await page.waitForTimeout(300);
    await expect(page.locator("#outline-menu.open")).toHaveCount(1);
    const open = await page.evaluate(() => window.__isAnyUiPanelOpen!());
    expect(open).toBe(true);
    await page.keyboard.press("Escape");
  });

  test("clicking a different rail icon switches panels", async ({ page }) => {
    await page.locator("#btn-menu").click();
    await page.waitForTimeout(300);
    await expect(page.locator("#outline-menu.open")).toHaveCount(1);

    await page.locator("#btn-sources").click();
    await page.waitForTimeout(500); // the closing fade is .3s (openRailView's own comment)
    await expect(page.locator("#outline-menu.open")).toHaveCount(0);
    await expect(page.locator("#sources-panel.open")).not.toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("re-clicking the already-active icon closes its panel", async ({ page }) => {
    await page.locator("#btn-sources").click();
    await page.waitForTimeout(300);
    await expect(page.locator("#sources-panel.open")).not.toHaveCount(0);

    await page.locator("#btn-sources").click();
    await page.waitForTimeout(500);
    await expect(page.locator("#sources-panel.open")).toHaveCount(0);
    const open = await page.evaluate(() => window.__isAnyUiPanelOpen!());
    expect(open).toBe(false);
  });

  test("a real search input filters the Sources panel's rows", async ({ page }) => {
    await page.locator("#btn-sources").click();
    await page.waitForTimeout(300);
    await page.fill("#sources-panel-search", "zzz-no-match-zzz");
    await page.waitForTimeout(300);
    await expect(page.locator("#sources-panel-content .outline-item")).toHaveCount(0);
    await page.fill("#sources-panel-search", "");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
  });

  test("a real search input filters the Waypoints panel's rows", async ({ page }) => {
    await page.locator("#rail-btn-waypoints").click();
    await page.waitForTimeout(300);
    await expect(page.locator("#waypoints-panel.open")).not.toHaveCount(0);
    await page.fill("#waypoints-search", "zzz-no-match-zzz");
    await page.waitForTimeout(300);
    await expect(page.locator("#waypoints-panel-content .outline-item")).toHaveCount(0);
    await page.fill("#waypoints-search", "");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
  });

  test("Escape closes whatever panel is open (closeAllPanels)", async ({ page }) => {
    await page.locator("#btn-menu").click();
    await page.waitForTimeout(300);
    const openBefore = await page.evaluate(() => window.__isAnyUiPanelOpen!());
    expect(openBefore).toBe(true);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const openAfter = await page.evaluate(() => window.__isAnyUiPanelOpen!());
    expect(openAfter).toBe(false);
  });
});
