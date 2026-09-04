import { expect, test } from "@playwright/test";
import { goToRoot, panToFreshSpace, removeItem } from "./helpers";

// Promotes the CI-safe slice of .claude-testing/verify-zustand-batch3-search-chat-command.js to a
// permanent spec — 2 of that script's 4 Zustand stores (chatThreadStore, commandPaletteStore,
// searchSuggestionsStore, addToSourcePopupStore, all moved off bridges.js's hand-rolled createStore
// in the Zustand migration's own batch 3).
//
// Deliberately NOT promoted here: the live-suggestions (useSearchSuggestionsStore) and real Enter
// submission (useChatThreadStore) checks, both of which need a genuine /api/dotbot/{suggest,
// orchestrate} round trip against Groq/HuggingFace. CI's own e2e job (.github/workflows/ci.yml)
// deliberately runs with GROQ_API_KEY/HUGGINGFACE_API_KEY set to the literal string "placeholder",
// not real credentials — a spec asserting on a real AI response would fail there by design, not by
// accident. The command-palette and add-to-source-popup flows below are both fully synchronous
// (no network call), so they stay safe to run in CI exactly as CI is actually configured.
test.describe("dotbot search + chat UI (CI-safe slice)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("a real slash command populates the command palette", async ({ page }) => {
    await page.locator("#rail-btn-ai").click();
    await page.waitForTimeout(400);
    await expect(page.locator("#ai-panel.open")).toHaveCount(1);

    // "/s" (kind-prefix stage, buildOwnCommandRows' static ["source","canvas"] filter) rather than
    // a complete "/source" — a fully-typed kind with no target text jumps parseCommandInput
    // straight to stage:"target" with an empty targetRaw, which legitimately yields 0 own-tree
    // matches on a fresh workspace. "/s" keeps it in the synchronous, data-independent kind stage.
    await page.locator("#search-input").click();
    await page.locator("#search-input").fill("/s");
    await page.waitForTimeout(300);
    await expect(page.locator("#search-command-palette")).toBeVisible();
    await expect(page.locator(".command-palette-row")).not.toHaveCount(0);

    await page.evaluate(() => window.__clearSearch?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("real selection -> 'Add to...' opens the add-to-source popup, outside click closes it", async ({
    page,
  }) => {
    await panToFreshSpace(page, 80000);
    const noteId = await page.evaluate(() => {
      window.__add?.("note", 1700, 1700);
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, { items: { id: number; html?: string }[] }>;
        currentFolderId: string;
        tx: number;
        ty: number;
        scale: number;
      };
      const folder = appState.folders[appState.currentFolderId];
      const it = folder.items[folder.items.length - 1];
      it.html = "Batch29 selectable text for add-to-source";
      appState.tx = window.innerWidth / 2 - 1700 * appState.scale;
      appState.ty = window.innerHeight / 2 - 1700 * appState.scale;
      window.__applyTransform?.();
      window.__render?.();
      return it.id;
    });
    const noteElId = await page.evaluate((id) => window.__itemElId!(id), noteId);
    await page.waitForTimeout(300);

    // Enter edit mode (click, same requirement as outline-panel.spec.ts's own note/heading
    // cards), then double-click the body to select the word under the cursor.
    await page.locator(`#${noteElId}`).click();
    await page.waitForTimeout(200);
    await page.locator(`#${noteElId} .body`).dblclick();
    await page.waitForTimeout(300);
    await expect(page.locator("#selection-toolbar")).toBeVisible();

    await page.locator(".selection-toolbar-btn", { hasText: "Add to..." }).click();
    await page.waitForTimeout(300);
    const popup = page.locator("#add-to-source-popup");
    await expect(popup).toBeVisible();
    const hasContent = await popup.evaluate((el) => el.innerHTML.length > 0);
    expect(hasContent).toBe(true);

    // Close via outside click (doWire's document-level pointerdown listener,
    // searchOrchestrationSelection.ts).
    await page.mouse.click(20, 20);
    await page.waitForTimeout(300);
    await expect(popup).not.toBeVisible();

    await removeItem(page, noteElId);
  });
});
