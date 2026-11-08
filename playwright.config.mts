import { defineConfig, devices } from "@playwright/test";
import { resolveLocalTestConfig } from "./scripts/local-test-config.mjs";
import { allChoices, CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, consentCookieValue } from "./lib/consent/cookie";

const { config, env } = resolveLocalTestConfig();
process.env.CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Tests start with optional cookies rejected so the consent banner stays out of their
// way; tests/e2e/consent.spec.mts starts without a choice.
const appUrl = new URL(config.env.APP_URL);
const consentRejected = {
  name: CONSENT_COOKIE, value: consentCookieValue(allChoices(false)), domain: appUrl.hostname, path: "/",
  expires: Math.floor(Date.now() / 1000) + CONSENT_MAX_AGE_SECONDS, httpOnly: false,
  secure: appUrl.protocol === "https:", sameSite: "Lax" as const,
};

// Specs that call the Polar sandbox, directly or through checkout. They run one
// at a time: in parallel they spend the app's sandbox Polar budget in
// convex/rateLimits.ts and fail with RATE_LIMITED, and other worktrees share
// the organization's limit too.
const polarSpecs = ["account", "billing", "landing", "withdrawal"].map((name) => `${name}.spec.mts`);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.mts",
  // Every test creates its own users and data, so specs run in parallel. More
  // workers would not finish sooner, because the one-at-a-time Polar specs take
  // longest, and would load the machine that other worktrees and CI share.
  workers: 3,
  // Polar first, so its chain starts while the other workers take the rest.
  projects: [
    { name: "polar", testMatch: polarSpecs, workers: 1 },
    { name: "parallel", testIgnore: polarSpecs },
  ],
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  outputDir: ".playwright/results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: config.env.APP_URL,
    storageState: { cookies: [consentRejected], origins: [] },
    // Clerk testing/session tokens must not end up in recorded network artifacts.
    trace: "off",
    screenshot: "off",
    // Opt-in PR evidence; see tests/e2e/evidence.mts.
    video: process.env.E2E_EVIDENCE ? "on" : "off",
  },
});
