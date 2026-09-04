import { expect, test } from "@playwright/test";
import { getAppState, goToRoot, panToFreshSpace, placeItem, removeItem } from "./helpers";

// Promotes .claude-testing/verify-phase3-connections.js to a permanent spec — Phase 3's third
// relocated piece (renderConnectionsLayer/startConnectionDrag, app/dotto/canvasItemBehavior.ts):
// entering Data mode, dragging from a source card to a flashcard card to create a connection
// (drag-to-link), the SVG connections layer actually rendering a path between them, and clicking
// the connection's hit-path to delete it.
test.describe("connections", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("drag-to-link creates a connection, click on its hit-path deletes it", async ({ page }) => {
    await panToFreshSpace(page, 50000);
    // Flashcard cards default to a large footprint (~840x560 world px) — zoom out first so both
    // cards, and clear space between them, fit on screen without overlapping.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 900); // positive deltaY zooms OUT (factor = 1.1^(-deltaY/60))
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);

    // source outputs 'content', flashcard accepts it (appState.CardStreamIO,
    // srsConnectionsCore.ts) — a source->flashcard link is a valid connection.
    const sourceId = await placeItem(page, "source", 400, 300);
    const flashcardId = await placeItem(page, "flashcard", 1000, 600);

    const sourceBox = (await page.locator(`#${sourceId}`).boundingBox())!;
    const flashcardBox = (await page.locator(`#${flashcardId}`).boundingBox())!;
    const overlaps = !(
      sourceBox.x + sourceBox.width < flashcardBox.x ||
      flashcardBox.x + flashcardBox.width < sourceBox.x ||
      sourceBox.y + sourceBox.height < flashcardBox.y ||
      flashcardBox.y + flashcardBox.height < sourceBox.y
    );
    expect(overlaps, "test setup needs more separation between the two cards").toBe(false);

    const connsBefore = await page.locator(".connections-layer path").count();
    expect(connsBefore).toBe(0);

    // Known baseline first — cardMode is part of the persisted workspace (coreState.ts), so a
    // previous spec/session could in principle have left it somewhere other than "normal".
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);

    // Enter Data mode via a quick 'd' tap — a tap under coreState.ts's own
    // MODE_HOLD_THRESHOLD_MS=180 sticks the mode persistently rather than momentarily overriding
    // it (same mechanic the shift-click case in canvas-drag.spec.ts relies on).
    await page.keyboard.press("d");
    await page.waitForTimeout(100);
    const mode = await page.evaluate(() => window.__effectiveMode!());
    expect(mode).toBe("data");

    const fromX = sourceBox.x + sourceBox.width / 2,
      fromY = sourceBox.y + sourceBox.height / 2;
    const toX = flashcardBox.x + flashcardBox.width / 2,
      toY = flashcardBox.y + flashcardBox.height / 2;
    await page.mouse.move(fromX, fromY);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(toX, toY, { steps: 20 });
    await page.waitForTimeout(100);
    await expect(page.locator(`#${flashcardId}`)).toHaveClass(/link-target-hover/);
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Back to Normal mode so cleanup below doesn't fight with a stuck Data-mode click handler.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // One visible path + one wider, transparent hit path per real connection.
    await expect(page.locator(".connections-layer path")).toHaveCount(2);
    const state = await getAppState(page);
    const folder = state.folders[state.currentFolderId];
    expect(folder.connections?.length).toBe(1);

    const hitPath = page.locator('.connections-layer path[stroke="transparent"]').first();
    const hitBox = await hitPath.boundingBox();
    if (hitBox) {
      await page.mouse.click(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
    } else {
      // A zero-size stroke path can't be clicked by real coordinates — dispatch the click event
      // directly instead (still exercises the same real onclick handler).
      await hitPath.dispatchEvent("click");
    }
    await page.waitForTimeout(400);

    await expect(page.locator(".connections-layer path")).toHaveCount(0);
    const stateAfterDelete = await getAppState(page);
    const folderAfterDelete = stateAfterDelete.folders[stateAfterDelete.currentFolderId];
    expect(folderAfterDelete.connections?.length ?? 0).toBe(0);

    // A real subsequent render() must not desync React's own tree from the DOM.
    await page.evaluate(() => window.__render!());
    await page.waitForTimeout(200);
    await expect(page.locator(`#${sourceId}`)).toBeAttached();

    await removeItem(page, sourceId);
    await removeItem(page, flashcardId);
  });
});
