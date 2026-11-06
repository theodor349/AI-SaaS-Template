import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appLocation, checkoutRoots, deferInterrupts, isInside, parsePlan, parseTestUserEmail, shellQuote } from "./agent-cli.mjs";

const usage = "Usage: pnpm capture <path...> [--label before|after|<name>] [--plan monthly|yearly|lifetime] [--user <name>+clerk_test@<domain>] [--signed-out] [--out <dir>] [--wait-for <text>] [--video <seconds>] [--color-scheme light|dark]";

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export function captureOptions(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    label: { type: "string", default: "capture" }, plan: { type: "string" }, user: { type: "string" }, "signed-out": { type: "boolean", default: false },
    out: { type: "string" }, "wait-for": { type: "string" }, video: { type: "string" }, "color-scheme": { type: "string", default: "light" },
    help: { type: "boolean" },
  } });
  if (values.help) return { help: true };
  if (!positionals.length) throw new Error(usage);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.label)) throw new Error("--label may only contain letters, digits, '.', '_', and '-'.");
  const plan = parsePlan(values.plan);
  if (plan && values["signed-out"]) throw new Error("--plan needs a signed-in user; remove --signed-out.");
  const user = parseTestUserEmail(values.user);
  if (user && values["signed-out"]) throw new Error("--user signs a user in; remove --signed-out.");
  let videoSeconds = null;
  if (values.video !== undefined) {
    videoSeconds = Number(values.video);
    if (!Number.isFinite(videoSeconds) || videoSeconds <= 0 || videoSeconds > 60) throw new Error("--video must be a number of seconds between 0 and 60.");
  }
  if (values["wait-for"] === "") throw new Error("--wait-for needs visible text.");
  const colorScheme = values["color-scheme"];
  if (colorScheme !== "light" && colorScheme !== "dark") throw new Error("--color-scheme must be light or dark.");
  return { paths: positionals, label: values.label, plan, user, signedOut: values["signed-out"], out: values.out ?? null,
    waitFor: values["wait-for"] ?? null, videoSeconds, colorScheme };
}

// PR evidence must never land in a checkout where it could be committed.
export function evidenceDirectory({ out, label, worktreeId, checkouts, base = tmpdir() }) {
  const dir = out ? resolve(out) : join(base, "pr-evidence", worktreeId, label);
  for (const root of checkouts) {
    if (isInside(dir, root)) throw new Error(`Refusing to write PR evidence inside the checkout ${root}. Use a directory outside it.`);
  }
  return dir;
}

export function captureNames(paths) {
  const used = new Map();
  return paths.map((path) => {
    const url = new URL(path, "http://capture.invalid");
    const slug = `${url.pathname}${url.search}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "home";
    const count = (used.get(slug) ?? 0) + 1;
    used.set(slug, count);
    return count === 1 ? slug : `${slug}-${count}`;
  });
}

async function settle(page, path, viewport, waitFor) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    console.error(`Warning: ${path} (${viewport}) kept loading resources after 15s; capturing anyway.`);
  }
  if (waitFor) {
    try {
      await page.getByText(waitFor).first().waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      throw new Error(`${JSON.stringify(waitFor)} did not appear on ${path} (${viewport}) within 30s; the ${viewport} page ended at ${new URL(page.url()).pathname}.`);
    }
  }
  await page.evaluate(() => document.fonts.ready);
  // Next's dev-mode indicator is not part of the UI under review.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

// Chromium's fullPage capture misplaces sticky headers under mobile emulation, so
// grow the viewport to the document height and capture that instead.
async function screenshotWholePage(page, viewport, file) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: file, animations: "disabled" });
}

async function main() {
  const options = captureOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`${usage}\n\nCaptures full-page desktop (1440x900) and mobile (390x844 @2x) screenshots for PR evidence.\nSigns in a temporary Clerk test user unless --signed-out or --user, and removes it afterwards.\n--label     Output folder name (default capture).\n--plan      Seed deterministic paid access before capturing. With --user, the access stays on that user.\n--user      Sign in this existing +clerk_test user of the Clerk development instance instead, and keep it.\n--out       Output directory outside the checkout (default <tmp>/pr-evidence/<worktree>/<label>).\n--wait-for  Text that must be visible before each capture.\n--video     Also record a desktop video of each path for this many seconds.\n--color-scheme  The OS theme to emulate, which the app's default System theme follows (default light).`);
    return;
  }
  const [{ chromium }, { clerk, clerkSetup, setupClerkTestingToken }, { createClerkTestUser, findClerkTestUser }, { resolveLocalTestConfig }] = await Promise.all([
    import("@playwright/test"), import("@clerk/testing/playwright"), import("./clerk-test-user.mjs"), import("./local-test-config.mjs"),
  ]);
  const local = resolveLocalTestConfig();
  const { config, env } = local;
  const appUrl = config.env.APP_URL;
  const targets = options.paths.map((path) => appLocation(appUrl, path));
  const { root, mainRoot } = checkoutRoots();
  const dir = evidenceDirectory({ out: options.out, label: options.label, worktreeId: config.id, checkouts: [root, mainRoot] });
  let browser;
  const interrupts = deferInterrupts(() => { browser?.close().catch(() => {}); });
  let user;
  let sessionId;
  let videoDir;
  const written = [];
  try {
    if (!options.signedOut) {
      process.env.CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
      delete process.env.CLERK_TESTING_TOKEN;
      delete process.env.CLERK_FAPI;
      delete process.env.CLERK_API_URL;
      try {
        await clerkSetup({ publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY, dotenv: false });
      } catch {
        throw new Error("Clerk testing-token setup failed. Check the development credentials; provider error details are omitted.");
      }
      interrupts.check();
      user = options.user ? await findClerkTestUser(local, options.user) : await createClerkTestUser(local);
      interrupts.check();
      if (options.plan) {
        const { seedPaidTestUser } = await import("./billing-test-fixtures.mjs");
        // A realistic period keeps "paid through" dates believable in evidence.
        const days = { monthly: 30, yearly: 365, lifetime: 1 }[options.plan];
        await seedPaidTestUser(user, options.plan, true, { periodMs: days * 24 * 60 * 60_000 });
        interrupts.check();
      }
    }
    browser = await chromium.launch();
    interrupts.check();
    // Session state stays in memory so no credential file outlives the run.
    let storageState;
    if (user) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(appUrl);
      try {
        await clerk.signIn({ page, emailAddress: user.email });
      } catch {
        interrupts.check();
        throw new Error("Official Clerk test sign-in failed; check the local development credentials.");
      }
      sessionId = await page.evaluate(() => window.Clerk.session?.id);
      storageState = await context.storageState();
      await context.close();
    }
    const newContext = async (contextOptions) => {
      const context = await browser.newContext({ ...contextOptions, storageState, colorScheme: options.colorScheme });
      if (user) await setupClerkTestingToken({ context });
      return context;
    };
    mkdirSync(dir, { recursive: true });
    const names = captureNames(options.paths);
    for (const [index, target] of targets.entries()) {
      const path = options.paths[index];
      for (const [viewport, device] of Object.entries(VIEWPORTS)) {
        const context = await newContext(device);
        try {
          const page = await context.newPage();
          await page.goto(target.href);
          await settle(page, path, viewport, options.waitFor);
          const file = join(dir, `${names[index]}-${viewport}.png`);
          await screenshotWholePage(page, device.viewport, file);
          const landed = new URL(page.url());
          if (landed.pathname !== target.pathname) console.error(`Warning: ${path} (${viewport}) ended at ${landed.pathname}.`);
          written.push({ file, alt: `${options.label}: ${path} (${viewport})` });
        } finally {
          await context.close();
        }
      }
      if (options.videoSeconds) {
        videoDir ??= mkdtempSync(join(tmpdir(), "capture-video-"));
        const context = await newContext({ ...VIEWPORTS.desktop, recordVideo: { dir: videoDir, size: VIEWPORTS.desktop.viewport } });
        const page = await context.newPage();
        const video = page.video();
        try {
          await page.goto(target.href, { waitUntil: "commit" });
          await page.waitForTimeout(options.videoSeconds * 1000);
        } finally {
          await context.close();
        }
        const file = join(dir, `${names[index]}-desktop.webm`);
        await video.saveAs(file);
        written.push({ file, alt: `${options.label}: ${path} (desktop video)` });
      }
    }
    const as = user ? `${user.name}${options.plan ? ` with ${options.plan} access` : ""}` : "a signed-out visitor";
    console.log(`Captured ${targets.length} path${targets.length === 1 ? "" : "s"} from ${appUrl} as ${as}:`);
    for (const { file } of written) console.log(`  ${file}`);
    console.log("Attach to a PR comment (gh >= 2.99.0; keep the quotes because of '#'):");
    for (const { file, alt } of written) console.log(`  gh pr comment <PR> --attach ${shellQuote(`${file}#${alt}`)}`);
  } catch (error) {
    throw interrupts.signal ? new Error(`Stopped by ${interrupts.signal}.`) : error;
  } finally {
    await browser?.close().catch(() => {});
    if (videoDir) rmSync(videoDir, { recursive: true, force: true });
    try {
      if (options.user) {
        if (sessionId) await user.revokeSession(sessionId);
      } else {
        await user?.cleanup();
      }
    } finally {
      interrupts.dispose();
      if (interrupts.signal) process.exitCode = 130;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Capture: ${error.message}`);
    process.exitCode ||= 1;
  });
}
