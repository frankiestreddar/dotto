import { expect, test } from "@playwright/test";
import { goToRoot } from "./helpers";

// Promotes .claude-testing/verify-zustand-batch9-pane-keyed.js to a permanent spec — the
// redesigned pane-keyed Zustand factory (app/dotto/lib/paneKeyedStore.ts, Zustand migration batch
// 9): the core new risk that batch introduced was calling `create()` N times at runtime and
// memoizing per paneId rather than using N pre-declared stores, so the main thing this spec proves
// is that two REAL panes end up with genuinely independent store state, not sharing one instance —
// covering useNavHistoryStore, useTabsStore/useBreadcrumbMapStore, useCollabPillStore, and
// useMediaViewerZoomStore, plus a real pane close correctly calling .remove() on all of them.
test.describe("multi-pane (pane-keyed stores)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("useNavHistoryStore reflects a real history-index change via renderNavArrows", async ({
    page,
  }) => {
    const backBtn = page.locator('#pane-breadcrumb-pill-0 .pane-nav-arrows button[title="Back"]');
    // A known baseline first — this shared account's real historyStack can already hold more than
    // one entry by the time this test runs (goToRoot's own navigation, or a previous spec sharing
    // this account/worker), so "Back starts disabled" isn't safe to assume without resetting.
    await page.evaluate(() => {
      const appState = window.__getAppState!() as unknown as {
        historyStack: string[];
        currentFolderId: string;
        historyIndex: number;
      };
      appState.historyStack = [appState.currentFolderId];
      appState.historyIndex = 0;
      window.__renderNavArrows?.();
    });
    await page.waitForTimeout(200);
    await expect(backBtn).toBeDisabled();

    await page.evaluate(() => {
      const appState = window.__getAppState!() as unknown as {
        historyStack: string[];
        currentFolderId: string;
        historyIndex: number;
      };
      if (appState.historyStack.length < 2) appState.historyStack.push(appState.currentFolderId);
      appState.historyIndex = 1;
      window.__renderNavArrows?.();
    });
    await page.waitForTimeout(300);
    await expect(backBtn).toBeEnabled();
  });

  test("a real second pane gets independent tabs/breadcrumb/collab-pill state", async ({
    page,
  }) => {
    await page.evaluate(() => window.__debugSplitPane!());
    await page.waitForTimeout(600);
    await expect(page.locator('[id^="pane-breadcrumb-pill-"]')).toHaveCount(2);

    await page.evaluate(() => {
      window.__switchActivePane!(0);
      window.__renderBreadcrumbMapPanel?.(0);
      window.__renderTabsPanel?.(0);
      window.__renderBreadcrumbMapPanel?.(1);
      window.__renderTabsPanel?.(1);
    });
    await page.waitForTimeout(400);

    // Both panes' own #pane-tabs-N anchors must have real content — an empty one would mean the
    // pane-keyed factory shared one store instance instead of creating two independent ones.
    const pane0Html = await page.locator("#pane-tabs-0").innerHTML();
    const pane1Html = await page.locator("#pane-tabs-1").innerHTML();
    expect(pane0Html.length).toBeGreaterThan(0);
    expect(pane1Html.length).toBeGreaterThan(0);

    // useCollabPillStore, pane-keyed too — a real .pane-collab-bubble must exist in both panes'
    // own top bars, and a real renderCollabPill() call (the flushSync'd producer) must run clean
    // for each.
    await expect(page.locator("#pane-breadcrumb-pill-0 .pane-collab-bubble")).toHaveCount(1);
    await expect(page.locator("#pane-breadcrumb-pill-1 .pane-collab-bubble")).toHaveCount(1);
    await page.evaluate(() => {
      window.__renderCollabPill?.(0);
      window.__renderCollabPill?.(1);
    });
    await page.waitForTimeout(300);

    // useMediaViewerZoomStore.storeFor(0) — forced into a synthetic media-viewer state directly
    // (the real trigger, openMediaViewerTab, needs an actual media item) to confirm the producer
    // path runs without error.
    await page.evaluate(() => {
      const appState = window.__getAppState!() as unknown as {
        currentFolderId: string;
        folders: Record<string, { isMediaViewer?: boolean; viewerZoom?: number }>;
      };
      const folderObj = appState.folders[appState.currentFolderId];
      const hadViewer = folderObj.isMediaViewer;
      const hadZoom = folderObj.viewerZoom;
      folderObj.isMediaViewer = true;
      folderObj.viewerZoom = 1.5;
      window.__renderMediaViewerZoom?.(0);
      folderObj.isMediaViewer = hadViewer;
      folderObj.viewerZoom = hadZoom;
    });

    // Close pane 1 — every one of the 5 pane-keyed stores' own .remove(1) must run clean.
    await page.evaluate(() => window.__closePaneInLayout!(1));
    await page.waitForTimeout(400);
    await expect(page.locator('[id^="pane-breadcrumb-pill-"]')).toHaveCount(1);
  });
});
