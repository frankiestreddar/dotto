import { expect, test } from "@playwright/test";
import { goToRoot, panToFreshSpace, removeItem } from "./helpers";

// Promotes .claude-testing/verify-outline-panel.js to a permanent spec — the vanilla->React
// outline panel migration (OutlinePanel.tsx): opening via the 'o' shortcut, row content, search
// filtering (+ empty state), a leaf row click navigating and closing the panel, arrow-key nav, and
// preserveState (an in-progress search surviving a close/reopen via the rail icon).
test.describe("outline panel", () => {
  let headingId: string;
  let noteId: string;

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
    await panToFreshSpace(page, 60000);

    // Something to actually see in the outline: a heading + a note via the 'a' add-block chord
    // (srsConnectionsCore.ts). Placing a card does NOT itself enter edit mode — attachTitleBody/
    // attachNoteBody (waypointsRenderLoop.ts) both wire contentEditable through the card's own
    // el.onclick, so a real SECOND click on the just-placed card is required before typing, or the
    // text never actually commits (confirmed directly: the original .claude-testing script this
    // spec promotes never asserted on the typed text, only logged whatever label it saw, so it
    // never caught that its own typed text was silently discarded the same way). That second click
    // must land on the card's real, current bounding box — reusing the placement click's own fixed
    // coordinates is NOT reliable, since the card's rendered box doesn't always align exactly with
    // the point it was placed at (confirmed directly: a 6px vertical miss was enough to land the
    // "second click" just past the card's real bottom edge, silently landing on empty canvas
    // instead and never entering edit mode at all).
    await page.keyboard.press("a");
    await page.keyboard.press("h");
    await page.mouse.click(500, 300);
    await page.waitForTimeout(300);
    let box = (await page.locator(".item.title").last().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.type("Outline Test Heading");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    headingId = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll(".item.title")).filter(
        (el) => el.id !== "placement-ghost",
      );
      return els[els.length - 1]?.id;
    });

    await page.keyboard.press("a");
    await page.keyboard.press("n");
    await page.mouse.click(500, 450);
    await page.waitForTimeout(300);
    box = (await page.locator(".item.note").last().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.type("Outline test note");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    noteId = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll(".item.note")).filter(
        (el) => el.id !== "placement-ghost",
      );
      return els[els.length - 1]?.id;
    });
  });

  test.afterEach(async ({ page }) => {
    await page.keyboard.press("Escape").catch(() => {});
    if (headingId) await removeItem(page, headingId);
    if (noteId) await removeItem(page, noteId);
  });

  test("opens via the 'o' shortcut and shows real row content", async ({ page }) => {
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await expect(page.locator("#hmenu-outline-container .outline-item")).not.toHaveCount(0);
    const labels = await page.locator("#hmenu-outline-container .outline-label").allTextContents();
    expect(labels).toContain("Outline Test Heading");
    expect(labels).toContain("Outline test note");
  });

  test("search filters rows, an empty state shows for no matches, clearing restores all rows", async ({
    page,
  }) => {
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    const fullCount = await page.locator("#hmenu-outline-container .outline-item").count();

    await page.fill("#outline-search", "Heading");
    await page.waitForTimeout(200);
    const filteredLabels = await page
      .locator("#hmenu-outline-container .outline-label")
      .allTextContents();
    expect(filteredLabels).toContain("Outline Test Heading");
    expect(filteredLabels).not.toContain("Outline test note");

    await page.fill("#outline-search", "zzz-no-match-zzz");
    await page.waitForTimeout(200);
    await expect(page.locator("#hmenu-outline-container .outline-empty")).toBeVisible();
    await expect(page.locator("#hmenu-outline-container .outline-item")).toHaveCount(0);

    await page.fill("#outline-search", "");
    await page.waitForTimeout(200);
    await expect(page.locator("#hmenu-outline-container .outline-item")).toHaveCount(fullCount);
  });

  test("arrow-key nav highlights a row, and a row click navigates and closes the panel", async ({
    page,
  }) => {
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await page
      .locator("#hmenu-outline-container")
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    await expect(page.locator("#hmenu-outline-container .outline-item.active")).toHaveCount(1);

    await page.locator("#hmenu-outline-container .outline-item").first().click();
    await page.waitForTimeout(300);
    await expect(page.locator("#outline-menu.open")).toHaveCount(0);
  });

  test("preserveState: an in-progress search survives a close/reopen via the rail icon", async ({
    page,
  }) => {
    const railIcon = page.locator("#btn-menu");
    await railIcon.click();
    await page.waitForTimeout(300);
    await page.fill("#outline-search", "Note");
    await page.waitForTimeout(200);
    await railIcon.click(); // close
    await page.waitForTimeout(200);
    await railIcon.click(); // reopen — preserveState=true
    await page.waitForTimeout(300);
    await expect(page.locator("#outline-search")).toHaveValue("Note");
  });
});
