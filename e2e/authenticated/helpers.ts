import { type Page, expect } from "@playwright/test";

// Shared utilities for e2e/authenticated/*.spec.ts — the canvas core specs (canvas-drag,
// canvas-resize, connections) and later Phase 4.7 batches all need the same handful of setup
// steps a real interaction test on this app always needs: start from a known folder, and place a
// fresh card somewhere guaranteed not to collide with whatever a previous run (or a concurrently
// running spec, against the same shared test account) left on the canvas. Promoted from the
// duplicated-per-script version of this logic in .claude-testing/verify-phase3-*.js.

// Waits for DottoApp's own bootstrap bridges to actually exist before anything below tries to
// call one — a bare `page.goto("/")` resolves once the initial HTML/JS response lands, not once
// wireAppInit() (app/dotto/lib/appInit.ts) has actually run; calling a bridge immediately after
// can race a slow first compile (confirmed directly: a fresh Turbopack dev-server's very first
// request can take noticeably longer to have every module's own useEffect-driven wiring settle).
// #canvas existing (real DOM, matches e2e/authenticated/canvas.spec.ts's own readiness check) is
// necessary but not sufficient — window.__openFolder specifically is what every helper below
// actually calls first.
export async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.locator("#canvas")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => typeof window.__openFolder === "function", { timeout: 15000 });
}

// Navigates to the account's real root folder and resets the camera to its default position/zoom
// — the shared test account's saved workspace state can be left pointing into a source page (or
// zoomed/panned somewhere odd) by an earlier spec that didn't reset before finishing; every spec
// that interacts with the canvas needs to start from a known, non-source folder at a known scale
// (pixel-based assertions elsewhere assume scale=1 unless a test deliberately changes it, same
// reasoning as .claude-testing/open-app.js's own defensive reset).
export async function goToRoot(page: Page): Promise<void> {
  await waitForAppReady(page);
  await page.evaluate(async () => {
    await window.__openFolder!("root");
    const appState = window.__getAppState!() as unknown as {
      tx: number;
      ty: number;
      scale: number;
    };
    appState.tx = 0;
    appState.ty = 0;
    appState.scale = 1;
    window.__applyTransform?.();
  });
  await page.waitForTimeout(300);
}

// Pans the camera to a fresh, effectively-guaranteed-uninhabited part of the (functionally
// infinite) world canvas before placing anything — the shared test account accumulates cards
// across every run of every spec that touches it, so a fixed placement point would eventually
// collide with something left over from a previous run. `seed` should be unique per call site
// (e.g. a large distinct constant per spec/test) so two specs run in parallel (see
// playwright.config.ts's fullyParallel) don't pan to overlapping regions either.
export async function panToFreshSpace(page: Page, seed: number): Promise<void> {
  await page.mouse.move(700, 400);
  await page.mouse.wheel(-(seed + (Date.now() % 5000)), -(seed + (Date.now() % 3000)));
  await page.waitForTimeout(200);
}

// Enters placement mode for `kind` and clicks at (x, y) to drop it, then returns the new card's
// real DOM id — always the LAST matching `.item.<kind>` element (excluding the transient
// placement-ghost), never the first, since the account's canvas can already hold older cards of
// the same kind from a previous run.
export async function placeItem(page: Page, kind: string, x: number, y: number): Promise<string> {
  await page.evaluate((k) => window.prepareAdd?.(k), kind);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
  const id = await page.evaluate((k) => {
    const els = Array.from(document.querySelectorAll(`.item.${k}`)).filter(
      (el) => el.id !== "placement-ghost",
    );
    return els[els.length - 1]?.id;
  }, kind);
  expect(id, `expected a new .item.${kind} to have been placed`).toBeTruthy();
  return id!;
}

export interface Item {
  id: number;
  [key: string]: unknown;
}
export interface FolderObj {
  items: Item[];
  connections?: { fromId: number; toId: number }[];
  [key: string]: unknown;
}
export interface AppState {
  currentFolderId: string;
  folders: Record<string, FolderObj>;
  selectedCardIds: number[];
  scale: number;
  [key: string]: unknown;
}

export function getAppState(page: Page): Promise<AppState> {
  return page.evaluate(() => window.__getAppState!() as unknown as AppState);
}

// Removes a test-created item directly from appState and forces a real re-render — every spec
// that places a card on the shared test account owes cleanup, or successive runs (and every other
// spec sharing the same account) accumulate clutter indefinitely.
export async function removeItem(page: Page, id: string): Promise<void> {
  await page
    .evaluate((elId) => {
      const el = document.getElementById(elId);
      if (!el) return;
      const itemId = window.__parseItemId?.(el);
      if (itemId == null) return;
      const appState = window.__getAppState!() as unknown as AppState;
      const folder = appState.folders[appState.currentFolderId];
      folder.items = folder.items.filter((it) => it.id !== itemId);
      window.__render?.();
    }, id)
    .catch(() => {});
}
