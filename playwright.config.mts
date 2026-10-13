import { defineConfig, devices } from "@playwright/test";
import { resolveLocalTestConfig } from "./scripts/local-test-config.mjs";

const { config, env } = resolveLocalTestConfig();
process.env.CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.mts",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  outputDir: ".playwright/results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: config.env.APP_URL,
    // Clerk testing/session tokens must not end up in recorded network artifacts.
    trace: "off",
    screenshot: "off",
    // Opt-in PR evidence; see tests/e2e/evidence.mts.
    video: process.env.E2E_EVIDENCE ? "on" : "off",
  },
});
