import { expect, test } from "@playwright/test";
import { goToRoot, panToFreshSpace, placeItem } from "./helpers";

// Promotes .claude-testing/verify-phase3-sourcetable.js to a permanent spec — Phase 3's fourth
// relocated piece (renderStaticTableHTML/attachStaticTableHoverZones/layoutSourceTableColumns,
// app/dotto/canvasItemBehavior.ts): navigating into a source folder, the hover-zone geometry
// (add-column near the right edge, add-row near the bottom, a row-tag button on a hovered row),
// clicking add-row/add-column end to end, and the table staying correctly laid out after a window
// resize.
test.describe("source table", () => {
  let sourceCardId: string | undefined;

  test.beforeEach(async ({ page }) => {
    sourceCardId = undefined;
    await page.goto("/");
    await goToRoot(page);
    await panToFreshSpace(page, 70000);
  });

  test.afterEach(async ({ page }) => {
    if (!sourceCardId) return;
    // A source card owns a real associated folder (it.folderId) — removeItem alone would leave
    // that folder orphaned, so this cleans up both directly. By the time this runs, the test has
    // navigated INTO the source (the DOM id from placeItem no longer exists — the canvas re-renders
    // as the static source page) — the numeric item id is parsed straight out of the "item-<pane>-
    // <id>" DOM-id string instead of querying for the (gone) element.
    const itemId = Number(sourceCardId.split("-").pop());
    await page
      .evaluate((id) => {
        const appState = window.__getAppState!() as unknown as {
          folders: Record<string, { items: { id: number; folderId?: string }[] }>;
        };
        const rootFolder = appState.folders["root"];
        const it = rootFolder?.items.find((i) => i.id === id);
        if (it?.folderId) delete appState.folders[it.folderId];
        if (rootFolder) rootFolder.items = rootFolder.items.filter((i) => i.id !== id);
      }, itemId)
      .catch(() => {});
  });

  test("entering a source renders the static table page", async ({ page }) => {
    sourceCardId = await placeItem(page, "source", 700, 400);

    // Click the icon specifically, not the card's center — the title span fills most of a source
    // card's small footprint, and clicking it triggers rename instead of navigation
    // (attachSourceCardClick, waypointsRenderLoop.ts).
    await page.locator(`#${sourceCardId} .source-card-icon`).click();
    await page.waitForTimeout(400);
    await expect(page.locator("#canvas")).toHaveClass(/static-source/);

    const el = page.locator(".item.static-table");
    await expect(el).toBeAttached();
    await expect(el.locator(".static-table-header-track .col-name-slot").first()).toBeAttached();
    await expect(el.locator(".static-table-upload-btn")).toBeAttached();
    await expect(el.locator(".item-table tbody tr")).not.toHaveCount(0);
  });

  test("hover-zone geometry: add-column, add-row, and row-tag reveal correctly", async ({
    page,
  }) => {
    sourceCardId = await placeItem(page, "source", 700, 400);
    await page.locator(`#${sourceCardId} .source-card-icon`).click();
    await page.waitForTimeout(400);

    const wrap = page.locator(".item.static-table .static-table-wrap");
    const rounded = page.locator(".item.static-table .table-rounded");

    // Add-column zone near the right edge.
    let wrapBox = (await wrap.boundingBox())!;
    let roundedBox = (await rounded.boundingBox())!;
    // Stay within the real viewport (1440px wide) — a mousemove target past the edge isn't
    // reliably delivered.
    const rightEdgeX = Math.min(wrapBox.x + wrapBox.width + 20, 1435);
    await page.mouse.move(rightEdgeX, roundedBox.y + roundedBox.height / 2);
    await page.waitForTimeout(150);
    await expect(wrap).toHaveClass(/show-col/);
    await page.mouse.move(200, 200);
    await page.waitForTimeout(150);
    await expect(wrap).not.toHaveClass(/show-col/);

    // Add-row zone near the bottom.
    roundedBox = (await rounded.boundingBox())!;
    await page.mouse.move(
      roundedBox.x + roundedBox.width / 2,
      roundedBox.y + roundedBox.height + 20,
    );
    await page.waitForTimeout(150);
    await expect(page.locator(".item.static-table .add-row-strip")).toHaveClass(/show-row/);
    await page.mouse.move(200, 200);
    await page.waitForTimeout(150);

    // Row-tag button on a hovered data row.
    const firstCell = page
      .locator(".item.static-table .item-table tbody tr")
      .first()
      .locator("td")
      .first();
    const cellBox = (await firstCell.boundingBox())!;
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
    await page.waitForTimeout(150);
    await expect(wrap).toHaveClass(/show-row-tag/);
  });

  test("clicking add-column and add-row grows the table end to end", async ({ page }) => {
    sourceCardId = await placeItem(page, "source", 700, 400);
    await page.locator(`#${sourceCardId} .source-card-icon`).click();
    await page.waitForTimeout(400);

    const colCountBefore = await page.locator(".item.static-table .col-name-slot").count();
    const wrapBox = (await page.locator(".item.static-table .static-table-wrap").boundingBox())!;
    const roundedBox = (await page.locator(".item.static-table .table-rounded").boundingBox())!;
    const rightEdgeX = Math.min(wrapBox.x + wrapBox.width + 20, 1435);
    // The add-column/add-row buttons are opacity:0/pointer-events:none until their own hover zone
    // is active (globals.css) — must click while still hovering the zone that reveals them.
    await page.mouse.move(rightEdgeX, roundedBox.y + roundedBox.height / 2);
    await page.waitForTimeout(150);
    await page.locator(".item.static-table .add-col-strip").click();
    await page.waitForTimeout(400);
    await expect(page.locator(".item.static-table .col-name-slot")).toHaveCount(colCountBefore + 1);
    await page.mouse.move(200, 200);
    await page.waitForTimeout(150);

    const rowCountBefore = await page.locator(".item.static-table .item-table tbody tr").count();
    const roundedBox2 = (await page.locator(".item.static-table .table-rounded").boundingBox())!;
    await page.mouse.move(
      roundedBox2.x + roundedBox2.width / 2,
      roundedBox2.y + roundedBox2.height + 20,
    );
    await page.waitForTimeout(150);
    await page.locator(".item.static-table .add-row-btn").click();
    await page.waitForTimeout(400);
    await expect(page.locator(".item.static-table .item-table tbody tr")).toHaveCount(
      rowCountBefore + 1,
    );
  });

  test("the table stays correctly laid out after a window resize", async ({ page }) => {
    sourceCardId = await placeItem(page, "source", 700, 400);
    await page.locator(`#${sourceCardId} .source-card-icon`).click();
    await page.waitForTimeout(400);

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(300);
    const track = page.locator(".item.static-table .static-table-header-track");
    const width = await track.evaluate((el) => parseFloat((el as HTMLElement).style.width));
    expect(width).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
