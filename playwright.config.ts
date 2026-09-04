import { defineConfig, devices } from "@playwright/test";

// DOTTO_TEST_BASE_URL matches the convention already used by .claude-testing/open-app.js and every
// ad-hoc verification script throughout this project's history — kept consistent here rather than
// inventing a new env var name.
const baseURL = process.env.DOTTO_TEST_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every spec under e2e/authenticated/ shares ONE real, persisted backend account (workspace
  // state — folders/items/camera/cursor-mode — is saved to the real dotto-test Supabase project
  // and reloaded on the next page load) rather than an isolated per-test fixture. Two specs
  // mutating that shared state from different worker processes at once is a real cross-test race,
  // not just theoretical — confirmed directly while writing the Phase 4.7 canvas-core specs (one
  // spec's cursor-mode change leaking into another's assertion). CI already ran serially; this
  // just makes local runs match that same real constraint instead of defaulting to
  // hardware-parallel and occasionally flaking on exactly this.
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // devices["Desktop Chrome"]'s own default viewport (1280x720) is narrow enough that the
  // permanent rail's icons and the floating mode-toolbar visually overlap (confirmed directly — a
  // real click on #btn-sources got intercepted by the mode-toolbar's "normal" button sitting on
  // top of it at that width), something no manual verification ever hit because every
  // .claude-testing/*.js script and this app's whole migration history was checked against
  // 1440x900 (open-app.js's own explicit viewport) instead. VIEWPORT below is spread into each
  // project's own `use` AFTER `...devices["Desktop Chrome"]` (not set at the top level here) —
  // devices["Desktop Chrome"] carries its own viewport key, and Playwright merges a project's own
  // `use` over the top-level one wholesale, so a top-level-only viewport gets silently shadowed by
  // whatever the spread devices preset already set.
  // e2e/global-setup.ts logs in once (using E2E_TEST_EMAIL/E2E_TEST_PASSWORD against the
  // dedicated "dotto-test" Supabase project) and saves the session to e2e/.auth/user.json — the
  // "authenticated" project below reuses that for every spec under e2e/authenticated/, the same
  // way every .claude-testing/*.js script always assumed a logged-in session via
  // open-app.js/storage-state.json. The default "chromium" project stays deliberately
  // unauthenticated (excludes e2e/authenticated/ via testIgnore) — e2e/smoke.spec.ts specifically
  // asserts UNauthenticated behavior (the /login redirect), which a pre-loaded session would break.
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "chromium",
      testIgnore: "**/authenticated/**",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "authenticated",
      testDir: "./e2e/authenticated",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        storageState: "./e2e/.auth/user.json",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  // Boots `next dev` automatically for a local run; CI (or any run against an already-running
  // server, e.g. DOTTO_TEST_BASE_URL pointed elsewhere) reuses the existing one instead of trying
  // to bind the port twice.
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
