import { expect, test } from "@playwright/test";
import { goToRoot } from "./helpers";

// Promotes the single-account-testable slice of
// .claude-testing/verify-phase4-5-friendspresence-port.js to a permanent spec — the Phase 4.5 port
// of friends-presence.js -> app/dotto/lib/friendsPresence.ts and messages-schedule.js ->
// app/dotto/lib/messagesSchedule.ts.
//
// Deliberately NOT promoted here: the real cross-account flow (friend request -> accept ->
// canvas-collaboration invite -> chat message -> online/offline/AFK presence over Supabase
// Realtime). The source script drives that with TWO real browser contexts against TWO real
// Supabase accounts (this repo's own storage-state.json PLUS a second, separately-provisioned
// account/credentials file) — CI's own e2e job (.github/workflows/ci.yml) only has secrets for
// ONE test account (E2E_TEST_EMAIL/E2E_TEST_PASSWORD), so a spec needing a second real account
// would only ever pass locally, never in CI, by construction. Promoting it would need a second
// dedicated test account provisioned on the same dotto-test Supabase project plus new CI secrets —
// real infrastructure work outside what a code change here can provide. The source script itself
// also documents two genuine, pre-existing, out-of-scope infra gaps in that cross-account flow
// (a PGRST202 invite_canvas_collaborator RPC-not-found error, and a Presence-metadata bug that
// blocks the AFK cross-account notification) — neither is exercised by the slice below.
//
// What IS covered here, with the single already-configured account: every bridge this subsystem
// exposes, the Messages rail panel opening via a real click, and the per-pane Collaborators
// bubble/panel opening via a real hover + click.
test.describe("collaboration UI (single-account slice)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await goToRoot(page);
  });

  test("every friendsPresence/messagesSchedule bridge is wired up after boot", async ({ page }) => {
    const bridges = await page.evaluate(() => ({
      __openCollabPanel: typeof window.__openCollabPanel === "function",
      __renderCollabPill: typeof window.__renderCollabPill === "function",
      __closeCollabPanel: typeof window.__closeCollabPanel === "function",
      __renderMsgList: typeof window.__renderMsgList === "function",
      __refreshCanvasCollabForCurrentFolder:
        typeof window.__refreshCanvasCollabForCurrentFolder === "function",
      __closeMessagesPanel: typeof window.__closeMessagesPanel === "function",
      handleCollabSearch: typeof window.handleCollabSearch === "function",
      handleMsgSearch: typeof window.handleMsgSearch === "function",
    }));
    expect(Object.values(bridges).every(Boolean), JSON.stringify(bridges)).toBe(true);
  });

  test("a real click on the Messages rail icon opens the panel", async ({ page }) => {
    await expect(page.locator("#messages-panel.open")).toHaveCount(0);
    await page.locator("#btn-messages").click();
    await page.waitForTimeout(800); // real refreshFriendsData/refreshMessagesPanel Supabase round trip
    await expect(page.locator("#messages-panel.open")).toHaveCount(1);
    await page.evaluate(() => window.__closeMessagesPanel!());
    await page.waitForTimeout(300);
  });

  test("a real hover + click on the pane's collaborators bubble opens the panel", async ({
    page,
  }) => {
    // renderCollabPill (friendsPresence.ts) deliberately keeps the bubble's own `show` state false
    // on the root canvas — "always private to the user, so no collaborators indicator there" — so
    // a real non-root folder is required first, same as the source script's own testFolderId setup.
    const testFolderId = await page.evaluate(() => {
      const id = "collab-presence-verify-" + Date.now();
      const appState = window.__getAppState!() as unknown as {
        folders: Record<string, unknown>;
      };
      appState.folders[id] = {
        id,
        title: "Collab presence verify folder",
        items: [],
        collaborators: [],
      };
      window.__applyFolderView?.(id);
      return id;
    });
    await page.waitForTimeout(400);

    // .pane-collab-bubble is max-width:0/opacity:0 until its parent .pane-breadcrumb-pill is
    // actually hovered (globals.css) — a real mouse hover, not just Playwright's own element
    // .click() on the still-collapsed bubble, so its real on-screen box exists first.
    const breadcrumbPill = page.locator("#pane-breadcrumb-pill-0");
    await breadcrumbPill.hover();
    await page.waitForTimeout(400); // CSS max-width/opacity transition
    const collabBubble = page.locator("#pane-breadcrumb-pill-0 .pane-collab-bubble");
    await collabBubble.waitFor({ state: "visible", timeout: 5000 });
    await collabBubble.click();
    await page.waitForTimeout(600); // real renderCollabList (refreshFriendsData + refreshCanvasCollabForCurrentFolder)
    await expect(page.locator("#collab-panel.open")).toHaveCount(1);

    await page.evaluate(() => window.__closeCollabPanel?.());
    await page.waitForTimeout(300);

    await page.evaluate((id) => {
      const appState = window.__getAppState!() as unknown as { folders: Record<string, unknown> };
      delete appState.folders[id];
      window.__applyFolderView?.("root");
    }, testFolderId);
    await page.waitForTimeout(200);
  });
});
