import { expect, test } from "@playwright/test";

// First real committed e2e spec (Phase 4.0) — proves the @playwright/test pipeline works
// end-to-end (webServer auto-boot, browser launch, real assertions) without needing an
// authenticated test account, since the dedicated test-Supabase project + credentials this suite
// will eventually run against don't exist yet (see PHASE4_ROADMAP.md's open items). Real
// authenticated specs (canvas, drag/resize/connections, etc. — converting .claude-testing/*.js's
// ad-hoc scripts into real assertions) land once e2e/fixtures/auth.ts exists.
test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in to Dotto" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();
});

test("unauthenticated visit to / redirects to /login", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await expect(page).toHaveURL(/\/login/);
});
