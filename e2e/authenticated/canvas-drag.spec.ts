import { expect, test } from "@playwright/test";
import { getAppState, goToRoot, panToFreshSpace, placeItem, removeItem } from "./helpers";

// Promotes .claude-testing/verify-phase3-drag.js to a permanent spec — the riskiest of Phase 3's
// relocated pieces (setupDraggingAndClicking, app/dotto/canvasItemBehavior.ts): a plain drag
// moving a card (grid-snapped position), a click with no real movement leaving position
// untouched, shift-click toggling selection, and alt-duplicate-drag (Option held: duplicate
// first, drag the duplicate, original stays put).
test.describe("canvas drag", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  const getPos = (page: import("@playwright/test").Page, id: string) =>
    page.evaluate((elId) => {
      const el = document.getElementById(elId)!;
      return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
    }, id);

  test("plain drag moves a card and grid-snaps its position", async ({ page }) => {
    await panToFreshSpace(page, 30000);
    const clickX = 700,
      clickY = 400;
    const noteId = await placeItem(page, "note", clickX, clickY);

    const before = await getPos(page, noteId);
    const noteBox = (await page.locator(`#${noteId}`).boundingBox())!;
    const grabX = noteBox.x + noteBox.width / 2,
      grabY = noteBox.y + 15; // near the top, away from the body text area

    await page.mouse.move(grabX, grabY);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(grabX + 220, grabY + 150, { steps: 15 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await getPos(page, noteId);
    expect(after.left).not.toBe(before.left);
    expect(after.top).not.toBe(before.top);
    // `% 28 === 0` itself is correct for a grid-snapped value, but a snapped-to-zero coordinate
    // can come out as -0 depending on drag direction — Object.is(-0, 0) is false, and Playwright's
    // toBe uses Object.is, so compare with === instead (where -0 === 0 is true) rather than
    // asserting the exact -0/0 representation.
    expect(after.left % 28 === 0).toBe(true);
    expect(after.top % 28 === 0).toBe(true);

    await removeItem(page, noteId);
  });

  test("a click with no real movement leaves position unchanged", async ({ page }) => {
    await panToFreshSpace(page, 31000);
    const noteId = await placeItem(page, "note", 700, 400);

    const before = await getPos(page, noteId);
    const noteBox = (await page.locator(`#${noteId}`).boundingBox())!;
    await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + 15);
    await page.waitForTimeout(300);
    const after = await getPos(page, noteId);
    expect(after).toEqual(before);

    // A plain click on a note enters edit mode by design — drop that focus before cleanup, same
    // as a real user clicking elsewhere would.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await removeItem(page, noteId);
  });

  test("shift-click toggles selection without moving the card", async ({ page }) => {
    await panToFreshSpace(page, 32000);
    const noteId = await placeItem(page, "note", 700, 400);

    // Playwright's page.mouse.click({modifiers:['Shift']}) does not reliably set e.shiftKey in
    // this app (confirmed directly) — keyboard.down/up around a plain click does.
    const before = await getAppState(page);
    const noteBox = (await page.locator(`#${noteId}`).boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + 15);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(300);
    const after = await getAppState(page);
    const noteNumId = await page.evaluate(
      (id) => window.__parseItemId!(document.getElementById(id)!),
      noteId,
    );
    expect(after.selectedCardIds).toContain(noteNumId);
    expect(after.selectedCardIds.length).toBe(before.selectedCardIds.length + 1);

    // Deselect again (shift-click a second time) so it doesn't interfere with later specs.
    const noteBox2 = (await page.locator(`#${noteId}`).boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.click(noteBox2.x + noteBox2.width / 2, noteBox2.y + 15);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(300);

    // Real, pre-existing app behavior (coreState.ts's effectiveMode/MODE_HOLD_THRESHOLD_MS=180):
    // a quick Shift tap under that threshold — exactly what the rapid keyboard.down/click/up
    // above does — STICKS the app in "select" cursor mode, same as clicking the Select toolbar
    // button. Escape resets back to normal mode, same recovery a real user would use.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const mode = await page.evaluate(() => window.__effectiveMode!());
    expect(mode).toBe("normal");

    await removeItem(page, noteId);
  });

  test("alt-duplicate-drag duplicates the card and leaves the original in place", async ({
    page,
  }) => {
    await panToFreshSpace(page, 33000);
    const noteId = await placeItem(page, "note", 700, 400);

    const before = await getPos(page, noteId);
    const idsBefore = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".item.note")).map((el) => el.id),
    );
    const noteBox = (await page.locator(`#${noteId}`).boundingBox())!;
    const grabX = noteBox.x + noteBox.width / 2,
      grabY = noteBox.y + 15;

    await page.keyboard.down("Alt");
    await page.mouse.move(grabX, grabY);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(grabX + 260, grabY + 200, { steps: 15 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(400);

    const after = await getPos(page, noteId);
    expect(after).toEqual(before); // original untouched

    const idsAfter = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".item.note")).map((el) => el.id),
    );
    const newIds = idsAfter.filter((id) => !idsBefore.includes(id));
    expect(newIds.length).toBe(1);
    const dupPos = await getPos(page, newIds[0]);
    expect(dupPos).not.toEqual(after);

    // A real subsequent render() must not desync React's own tree from the DOM.
    await page.evaluate(() => window.__render!());
    await page.waitForTimeout(200);
    await expect(page.locator(`#${noteId}`)).toBeAttached();

    await removeItem(page, noteId);
    await removeItem(page, newIds[0]);
  });
});
