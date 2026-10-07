import { defineConfig, devices } from "@playwright/test";
import { resolveLocalTestConfig } from "./scripts/local-test-config.mjs";

const { config, env } = resolveLocalTestConfig();
process.env.CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
// Do not reuse another instance's testing token or API override from the shell.
delete process.env.CLERK_TESTING_TOKEN;
delete process.env.CLERK_FAPI;
delete process.env.CLERK_API_URL;

export default defineConfig({
  testDir: "./tests/e2e",
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
    video: "off",
  },
});
