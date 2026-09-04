import { type Page, expect, test } from "@playwright/test";
import { getAppState, goToRoot, panToFreshSpace, placeItem, removeItem } from "./helpers";

// Promotes .claude-testing/verify-phase3-resize.js to a permanent spec — Phase 3's first
// relocated piece (setupResizing, app/dotto/canvasItemBehavior.ts): a table's first-ever resize
// (the riskiest branch — rebuilds via the legacy renderStaticTableHTML string then re-attaches, on
// a React-owned node) surviving a real subsequent React re-render, a note's width-only resize, and
// that resize distance correctly accounts for the current zoom level, not just at scale 1.0.
test.describe("canvas resize", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  async function dragHandle(page: Page, id: string, dx: number, dy: number) {
    const handle = page.locator(`#${id} .resize`);
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(box.x + dx, box.y + dy, { steps: 15 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  test("a table's first-ever resize survives a real re-render", async ({ page }) => {
    await panToFreshSpace(page, 40000);
    const tableId = await placeItem(page, "table", 700, 400);

    const before = await page.evaluate((id) => {
      const el = document.getElementById(id)!;
      return { userSized: el.classList.contains("sized"), w: el.offsetWidth, h: el.offsetHeight };
    }, tableId);
    expect(before.userSized).toBe(false);

    await dragHandle(page, tableId, 150, 100);
    const afterFirst = await page.evaluate((id) => {
      const el = document.getElementById(id)!;
      return {
        userSized: el.classList.contains("sized"),
        w: el.offsetWidth,
        h: el.offsetHeight,
        hasTable: !!el.querySelector("table"),
      };
    }, tableId);
    expect(afterFirst.userSized).toBe(true);
    expect(afterFirst.hasTable).toBe(true);
    expect(afterFirst.w).toBeGreaterThan(before.w);
    expect(afterFirst.h).toBeGreaterThan(before.h);

    // A real subsequent render() must not desync React's own fiber tree from the rebuilt DOM.
    await page.evaluate(() => window.__render!());
    await page.waitForTimeout(200);
    const stillHasTable = await page.evaluate(
      (id) => !!document.getElementById(id)?.querySelector("table"),
      tableId,
    );
    expect(stillHasTable).toBe(true);

    await removeItem(page, tableId);
  });

  test("a note's resize handle only affects width", async ({ page }) => {
    await panToFreshSpace(page, 41000);
    const noteId = await placeItem(page, "note", 700, 400);

    const before = await page.evaluate(
      (id) => parseFloat(document.getElementById(id)!.style.width),
      noteId,
    );
    await dragHandle(page, noteId, 100, 80); // dy should be ignored entirely for notes
    const after = await page.evaluate(
      (id) => parseFloat(document.getElementById(id)!.style.width),
      noteId,
    );
    expect(after).toBeGreaterThan(before);

    await removeItem(page, noteId);
  });

  test("resize distance accounts for the current zoom level", async ({ page }) => {
    await panToFreshSpace(page, 42000);
    const noteId = await placeItem(page, "note", 700, 400);
    const w1 = await page.evaluate(
      (id) => parseFloat(document.getElementById(id)!.style.width),
      noteId,
    );
    await dragHandle(page, noteId, 100, 0);
    const w2 = await page.evaluate(
      (id) => parseFloat(document.getElementById(id)!.style.width),
      noteId,
    );
    const deltaAtScale1 = w2 - w1;
    expect(deltaAtScale1).toBeGreaterThan(0);

    // Real ctrl+wheel zoom (srsConnectionsCore.ts's own wheel handler) rather than poking
    // appState.scale directly — that handler also updates tx/ty and schedules the real CSS
    // transform, which a raw mutation would skip, leaving the rendered scale desynced.
    const noteBox = (await page.locator(`#${noteId}`).boundingBox())!;
    await page.mouse.move(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -600); // negative deltaY zooms in (factor = 1.1^(-deltaY/60))
    await page.keyboard.up("Control");
    await page.waitForTimeout(300);
    const state = await getAppState(page);
    expect(state.scale).toBeGreaterThan(1);

    const note2Id = await placeItem(page, "note", 900, 500);
    const w3 = await page.evaluate(
      (id) => parseFloat(document.getElementById(id)!.style.width),
      note2Id,
    );
    await dragHandle(page, note2Id, 100, 0);
    const w4 = await page.evaluate(
      (id) => parseFloat(document.getElementById(id)!.style.width),
      note2Id,
    );
    const deltaAtScale2 = w4 - w3;
    // The move handler divides screen delta by appState.scale — at ~2x zoom, the same 100px
    // screen-space drag should produce roughly half the world-space width change.
    expect(deltaAtScale2).toBeGreaterThan(0);
    expect(deltaAtScale2).toBeLessThan(deltaAtScale1 * 0.75);

    await removeItem(page, noteId);
    await removeItem(page, note2Id);
  });
});
