import { defineConfig } from "vitest/config";
import path from "node:path";

// jsdom environment so app/dotto/*.tsx component tests can render against a real-enough DOM
// (React Testing Library needs this). Pure-logic tests (app/dotto/lib/*.ts) don't need it, but
// paying jsdom's setup cost per-file isn't worth splitting into two configs for this project size.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // e2e specs live under e2e/ and run via `npm run test:e2e` (Playwright), never under Vitest —
    // excluded explicitly so `npm run test` never tries to execute a Playwright spec as a unit test.
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // Phase 4.0 (this config) intentionally lands before any real test files exist — Phase 4.2 is
    // where the first real unit tests (SM-2 scheduling math etc.) get written. Without this, `npm
    // run test` exits non-zero on an empty suite and would break CI immediately on landing.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
