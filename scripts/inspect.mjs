import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { chromium } from "@playwright/test";
import { createClerkTestUser } from "./clerk-test-user.mjs";
import { resolveLocalTestConfig } from "./local-test-config.mjs";

try {
  const local = resolveLocalTestConfig();
  const { config, env } = local;
  const mode = process.argv[2] ?? "open";
  if (!["open", "codegen"].includes(mode) || process.argv.length > 3) {
    throw new Error("Usage: pnpm inspect [open|codegen]");
  }
  process.env.CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
  delete process.env.CLERK_TESTING_TOKEN;
  delete process.env.CLERK_FAPI;
  delete process.env.CLERK_API_URL;
  try {
    await clerkSetup({ publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY, dotenv: false });
  } catch {
    throw new Error("Clerk testing-token setup failed. Check the development credentials; provider error details are omitted.");
  }
  const user = await createClerkTestUser(local);
  const stateFile = join(config.root, ".playwright", `inspect-${process.pid}.json`);
  let child;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(config.env.APP_URL);
      try {
        await clerk.signIn({ page, emailAddress: user.email });
      } catch {
        throw new Error("Official Clerk test sign-in failed; check the local development credentials.");
      }
      mkdirSync(join(config.root, ".playwright"), { recursive: true, mode: 0o700 });
      chmodSync(join(config.root, ".playwright"), 0o700);
      await page.context().storageState({ path: stateFile });
      chmodSync(stateFile, 0o600);
    } finally {
      await browser.close();
    }
    if (interrupted) throw new Error("Inspection stopped before opening the browser.");
    console.log(`Inspecting ${config.env.APP_URL} as ${user.name}. Close the browser to remove this temporary Clerk user and session file.`);
    const code = await new Promise((resolveExit, reject) => {
      const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
      child = spawn(process.execPath, [cli, mode, `--load-storage=${stateFile}`, config.env.APP_URL], {
        cwd: config.root, stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
    });
    process.exitCode = code;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    rmSync(stateFile, { force: true });
    await user.cleanup();
  }
} catch (error) {
  console.error(`Inspect: ${error.message}`);
  process.exitCode = 1;
}
