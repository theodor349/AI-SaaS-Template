import { clerkSetup } from "@clerk/testing/playwright";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

// Fetches one Clerk testing token for the run. clerkSetup stores it in process.env,
// which every Playwright worker inherits.
export default async function globalSetup() {
  const { env } = resolveLocalTestConfig();
  // Do not reuse another instance's testing token or API override from the shell.
  delete process.env.CLERK_TESTING_TOKEN;
  delete process.env.CLERK_FAPI;
  delete process.env.CLERK_API_URL;
  try {
    await clerkSetup({ publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY, dotenv: false });
  } catch {
    throw new Error("Clerk testing-token setup failed. Check the worktree's development credentials; provider error details are omitted.");
  }
}
