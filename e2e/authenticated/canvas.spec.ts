import { expect, test } from "@playwright/test";

// First real authenticated e2e spec (Phase 4.0) — proves the whole auth pipeline works end to
// end: e2e/global-setup.ts logs in against the dedicated test Supabase project, saves the
// session, and this project (see playwright.config.ts's "authenticated" project) reuses it
// without logging in again. Deeper interaction specs (drag/resize/connections/outline/etc.,
// porting .claude-testing/*.js's remaining ad-hoc scripts) land alongside whichever Phase 4.x
// batch actually ports that subsystem, not all at once here — see PHASE4_ROADMAP.md.
test("authenticated session loads the canvas, not the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("#canvas")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#dotto-rail")).toBeVisible();
});
