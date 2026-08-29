import { chromium, type FullConfig } from "@playwright/test";
import path from "node:path";

// Playwright global setup — logs in once as the dedicated e2e test account and saves the
// authenticated session to e2e/.auth/user.json (gitignored), which playwright.config.ts's
// `use.storageState` then reuses for every spec, so individual specs never need their own
// login flow. Mirrors .claude-testing/open-app.js's own login flow (same
// getByLabel/getByRole selectors against app/(auth)/login/page.js), but reads credentials from
// env vars instead of a committed/gitignored credentials.json — this file itself IS committed,
// so it can never hold real credentials directly.
//
// Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD (a real account on whichever Supabase project
// DOTTO_TEST_BASE_URL points the app at — see PHASE4_ROADMAP.md's open items for provisioning the
// dedicated test project this should run against, separate from production). Locally, add both to
// .env.local; in CI, add both as repo secrets alongside the test project's Supabase keys.
export default async function globalSetup(config: FullConfig) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL / E2E_TEST_PASSWORD are not set — see e2e/global-setup.ts's own comment.",
    );
  }

  const baseURL = config.projects[0].use.baseURL;
  // process.cwd(), not import.meta.dirname — this file loads as CommonJS (package.json has no
  // "type": "module"), where import.meta is unavailable; Playwright always runs from the repo
  // root, so a cwd-relative path is equivalent and avoids the ESM/CJS mismatch entirely.
  const authFile = path.join(process.cwd(), "e2e", ".auth", "user.json");

  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`, { timeout: 90_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(`${baseURL}/`, { timeout: 15_000 });
  await page.context().storageState({ path: authFile });
  await browser.close();
}
