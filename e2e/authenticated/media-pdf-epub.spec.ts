import path from "node:path";
import { expect, test } from "@playwright/test";
import { goToRoot, removeItem } from "./helpers";

// Promotes .claude-testing/verify-phase4-4-mediapdfepub-port.js to a permanent spec — the Phase
// 4.4 port of media-pdf-epub.js -> app/dotto/lib/mediaPdfEpub.ts. e2e/fixtures/tiny.png and
// tiny.pdf are small, real, committed fixture files (the original script's own TINY_PNG/TINY_PDF
// pointed at that session's own gitignored scratchpad, which doesn't exist for a permanent spec).
const TINY_PNG = path.join(__dirname, "..", "fixtures", "tiny.png");
const TINY_PDF = path.join(__dirname, "..", "fixtures", "tiny.pdf");

interface MediaItem {
  id: number;
  mediaSrc?: string | null;
  mediaType?: string;
  mediaUploading?: boolean;
  [key: string]: unknown;
}

async function panToPoint(page: import("@playwright/test").Page, x: number, y: number) {
  await page.evaluate(
    ({ x, y }) => {
      const appState = window.__getAppState!() as unknown as {
        scale: number;
        tx: number;
        ty: number;
      };
      appState.scale = 1;
      appState.tx = window.innerWidth / 2 - x;
      appState.ty = window.innerHeight / 2 - y;
      window.__applyTransform?.();
    },
    { x, y },
  );
  await page.waitForTimeout(200);
}

async function placeMediaCard(
  page: import("@playwright/test").Page,
  x: number,
  y: number,
): Promise<string> {
  const id = await page.evaluate(
    ({ x, y }) => {
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, { items: MediaItem[] }>;
        currentFolderId: string;
      };
      const folder = appState.folders[appState.currentFolderId];
      const newId = Math.floor(1e9 + Math.random() * 1e8);
      folder.items.push({ id: newId, kind: "media", x, y, w: 240, h: 160 });
      window.__render?.();
      return newId;
    },
    { x, y },
  );
  await panToPoint(page, x + 120, y + 80);
  await page.waitForTimeout(400);
  return page.evaluate((itemId) => window.__itemElId!(itemId), id);
}

test.describe("media (image/PDF)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("every mediaPdfEpub bridge is wired up, and the empty-state preview is correct", async ({
    page,
  }) => {
    const bridges = await page.evaluate(() => ({
      renderMediaHTML: typeof window.__renderMediaHTML === "function",
      buildPdfViewer: typeof window.__buildPdfViewer === "function",
      buildEpubViewer: typeof window.__buildEpubViewer === "function",
      processMediaFile: typeof window.__processMediaFile === "function",
      setMediaFromLink: typeof window.setMediaFromLink === "function",
      triggerMediaUpload: typeof window.triggerMediaUpload === "function",
      clearMedia: typeof window.clearMedia === "function",
    }));
    expect(Object.values(bridges).every(Boolean), JSON.stringify(bridges)).toBe(true);

    const previewHtml = await page.evaluate(() => window.__renderMediaHTML!({ id: 999999002 }));
    expect(previewHtml).toContain("Add photo");
  });

  test("real Link flow: prompt() sets a real image, the remove button clears it", async ({
    page,
  }) => {
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt")
        await dialog.accept("https://picsum.photos/seed/batch30/200/120");
      else await dialog.accept();
    });

    const wrapperId = await placeMediaCard(page, 91300, 91250);
    const wrapper = page.locator(`#${wrapperId}`);
    await wrapper.waitFor({ state: "visible", timeout: 5000 });
    await wrapper.locator("button.format-btn", { hasText: "Link" }).click();
    await page.waitForTimeout(500); // real prompt() round trip
    await expect(wrapper.locator("img")).toHaveCount(1);
    const srcAfterLink = await page.evaluate((elId) => {
      const id = window.__parseItemId!(document.getElementById(elId)!);
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, { items: MediaItem[] }>;
        currentFolderId: string;
      };
      return appState.folders[appState.currentFolderId].items.find((i) => i.id === id)?.mediaSrc;
    }, wrapperId);
    expect(srcAfterLink).toContain("picsum");

    await wrapper.locator(".media-change-btn").click();
    await page.waitForTimeout(300);
    await expect(wrapper.locator("img")).toHaveCount(0);
    const srcAfterClear = await page.evaluate((elId) => {
      const id = window.__parseItemId!(document.getElementById(elId)!);
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, { items: MediaItem[] }>;
        currentFolderId: string;
      };
      return appState.folders[appState.currentFolderId].items.find((i) => i.id === id)?.mediaSrc;
    }, wrapperId);
    expect(srcAfterClear).toBeNull();

    await removeItem(page, wrapperId);
  });

  test("real file upload (PNG) renders a real inline image", async ({ page }) => {
    const wrapperId = await placeMediaCard(page, 91300, 91550);
    const wrapper = page.locator(`#${wrapperId}`);
    await wrapper.waitFor({ state: "visible", timeout: 5000 });

    const fileChooserPromise = page.waitForEvent("filechooser");
    await wrapper.locator("button.format-btn", { hasText: "Upload" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(TINY_PNG);
    await page.waitForTimeout(500);

    await expect(wrapper.locator("img")).toHaveCount(1);
    const result = await page.evaluate((elId) => {
      const id = window.__parseItemId!(document.getElementById(elId)!);
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, { items: MediaItem[] }>;
        currentFolderId: string;
      };
      const it = appState.folders[appState.currentFolderId].items.find((i) => i.id === id)!;
      return { mediaSrc: (it.mediaSrc || "").slice(0, 20), mediaType: it.mediaType };
    }, wrapperId);
    expect(result.mediaType).toBe("image");
    expect(result.mediaSrc).toContain("data:image");

    await removeItem(page, wrapperId);
  });

  test("real file upload (PDF) mounts a real pdf.js viewer", async ({ page }) => {
    const wrapperId = await placeMediaCard(page, 91300, 91850);
    const wrapper = page.locator(`#${wrapperId}`);
    await wrapper.waitFor({ state: "visible", timeout: 5000 });

    const fileChooserPromise = page.waitForEvent("filechooser");
    await wrapper.locator("button.format-btn", { hasText: "Upload" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(TINY_PDF);
    // Real network upload + dynamic pdf.js import + parse + canvas render.
    await expect(wrapper.locator(".pdf-viewer-canvas")).toHaveCount(1, { timeout: 15000 });

    const result = await page.evaluate((elId) => {
      const id = window.__parseItemId!(document.getElementById(elId)!);
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, { items: MediaItem[] }>;
        currentFolderId: string;
      };
      const it = appState.folders[appState.currentFolderId].items.find((i) => i.id === id)!;
      return { mediaType: it.mediaType, mediaUploading: it.mediaUploading, hasSrc: !!it.mediaSrc };
    }, wrapperId);
    expect(result.mediaType).toBe("pdf");
    expect(result.mediaUploading).toBeFalsy();
    expect(result.hasSrc).toBe(true);
    await expect(wrapper.locator(".pdf-viewer-page-label")).toHaveText("1 / 1");

    await removeItem(page, wrapperId);
  });
});
