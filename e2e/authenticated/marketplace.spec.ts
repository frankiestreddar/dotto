import { expect, test } from "@playwright/test";
import { goToRoot, removeItem } from "./helpers";

// Promotes .claude-testing/verify-phase4-4-marketplace-port.js to a permanent spec — the Phase 4.4
// port of marketplace.js -> app/dotto/lib/marketplace.ts. Purchase/draft-creation
// (purchaseCurrentMarketItem, packageSelectedAsTemplate) do real Supabase writes against the
// shared test account, so — same exclusion as the source script's own header comment — this covers
// everything else: the real rail-icon click opening the cart panel, real search-input filtering,
// item-detail open/close with an in-memory mock listing (no write), and deployPurchasedTemplate
// (which only reads an already-in-memory userLibrary.purchased entry — also no write).
test.describe("marketplace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("every marketplace bridge is wired up after boot", async ({ page }) => {
    const bridges = await page.evaluate(() => ({
      wireRailIcon: typeof window.__wireRailIcon === "function",
      openRailView: typeof window.__openRailView === "function",
      openMarketDetail: typeof window.__openMarketDetail === "function",
      deployPurchasedTemplate: typeof window.__deployPurchasedTemplate === "function",
      packageSelectedAsTemplate: typeof window.__packageSelectedAsTemplate === "function",
      handleMarketplaceSearch: typeof window.handleMarketplaceSearch === "function",
      closeMarketDetail: typeof window.closeMarketDetail === "function",
      purchaseCurrentMarketItem: typeof window.purchaseCurrentMarketItem === "function",
    }));
    expect(Object.values(bridges).every(Boolean), JSON.stringify(bridges)).toBe(true);
  });

  test("a real click on the cart rail icon opens the Discover tab", async ({ page }) => {
    await expect(page.locator("#cart-panel.open")).toHaveCount(0);
    await page.locator("#btn-cart").click();
    await page.waitForTimeout(600); // refreshCartPanel's own await refreshMarketplaceListings()
    await expect(page.locator("#cart-panel.open")).toHaveCount(1);
    await expect(page.locator("#btn-cart.active")).toHaveCount(1);
    await expect(page.locator("#view-discover.active")).toHaveCount(1);
    await page.locator("#btn-cart").click(); // close again
    await page.waitForTimeout(300);
  });

  test("a real search input updates marketplaceSearchQuery", async ({ page }) => {
    await page.locator("#btn-cart").click();
    await page.waitForTimeout(600);
    await page.locator("#market-search").focus();
    await page.keyboard.type("zzzz_no_such_listing_zzzz");
    await page.waitForTimeout(300);
    const query = await page.evaluate(
      () =>
        (window.__getAppState!() as unknown as { marketplaceSearchQuery: string })
          .marketplaceSearchQuery,
    );
    expect(query).toBe("zzzz_no_such_listing_zzzz");
    await page.locator("#btn-cart").click();
    await page.waitForTimeout(300);
  });

  test("openMarketDetail/closeMarketDetail with an in-memory mock listing", async ({ page }) => {
    const flow = await page.evaluate(() => {
      const mockItem = {
        id: "mock-listing-id",
        title: "Batch30 verify listing",
        description: "test",
        tagline: "",
        count: 0,
        nodes: [],
        canvasSnapshot: [],
      };
      window.__openMarketDetail!(mockItem);
      const afterOpen = {
        selectedMarketItem: (
          window.__getAppState!() as unknown as { selectedMarketItem?: { id: string } }
        ).selectedMarketItem?.id,
        detailViewActive: document
          .getElementById("market-detail-view")
          ?.classList.contains("active"),
      };
      window.closeMarketDetail!();
      const afterClose = {
        selectedMarketItem: (window.__getAppState!() as unknown as { selectedMarketItem: unknown })
          .selectedMarketItem,
        detailViewActive: document
          .getElementById("market-detail-view")
          ?.classList.contains("active"),
        discoverActive: document.getElementById("view-discover")?.classList.contains("active"),
      };
      return { afterOpen, afterClose };
    });
    expect(flow.afterOpen.selectedMarketItem).toBe("mock-listing-id");
    expect(flow.afterOpen.detailViewActive).toBe(true);
    expect(flow.afterClose.selectedMarketItem).toBeNull();
    expect(flow.afterClose.detailViewActive).toBe(false);
    expect(flow.afterClose.discoverActive).toBe(true);
  });

  test("deployPurchasedTemplate spawns a real card from an in-memory purchased entry", async ({
    page,
  }) => {
    const MOCK_MARKER = "__batch30_deploy_mock__";
    const result = await page.evaluate((marker) => {
      const s = window.__getAppState!() as unknown as {
        userLibrary: { purchased: Record<string, unknown>[] };
        folders: Record<string, { items: Record<string, unknown>[] }>;
        currentFolderId: string;
      };
      const fakeId = "mock-purchased-" + Date.now();
      s.userLibrary.purchased.push({
        id: fakeId,
        title: "Batch30 deploy test",
        description: "",
        tagline: "",
        count: 0,
        nodes: [],
        canvasSnapshot: [],
      });
      const before = s.folders[s.currentFolderId].items.length;
      window.__deployPurchasedTemplate!(fakeId);
      const after = s.folders[s.currentFolderId].items;
      const spawned = after[after.length - 1];
      if (spawned) spawned[marker] = true;
      s.userLibrary.purchased = s.userLibrary.purchased.filter((x) => x.id !== fakeId);
      return {
        before,
        afterCount: after.length,
        spawnedKind: spawned?.kind,
        spawnedHtml: spawned?.html,
        spawnedElId: spawned ? window.__itemElId!(spawned.id as number) : null,
      };
    }, MOCK_MARKER);
    expect(result.afterCount).toBe(result.before + 1);
    expect(result.spawnedKind).toBe("note");
    expect(result.spawnedHtml as string).toContain("Batch30 deploy test");

    if (result.spawnedElId) await removeItem(page, result.spawnedElId);
  });
});
