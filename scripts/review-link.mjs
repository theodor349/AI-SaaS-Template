import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appLocation, deferInterrupts, formatDuration, isLoopbackUrl, parseDuration, parsePlan } from "./agent-cli.mjs";
import { createClerkTestUser } from "./clerk-test-user.mjs";
import { resolveLocalTestConfig } from "./local-test-config.mjs";

const usage = "Usage: pnpm review-link [--plan monthly|yearly|lifetime] [--path /billing] [--expires 1h]";
// pnpm clerk:sweep removes maintainer-review users after this age; links and paid fixtures never outlive it.
export const REVIEW_USER_LIFETIME_MS = 7 * 86_400_000;

export function reviewLinkOptions(argv) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    plan: { type: "string" }, path: { type: "string" }, expires: { type: "string", default: "1h" }, help: { type: "boolean" },
  } });
  if (values.help) return { help: true };
  const expiresMs = parseDuration(values.expires, "--expires");
  if (expiresMs < 60_000 || expiresMs > REVIEW_USER_LIFETIME_MS) throw new Error("--expires must be between 1m and 7d.");
  return { plan: parsePlan(values.plan), path: values.path ?? null, expiresMs };
}

// The prebuilt <SignIn /> consumes __clerk_ticket and then follows redirect_url.
export function reviewLink(appUrl, token, path) {
  const link = new URL("/sign-in", appUrl);
  link.searchParams.set("__clerk_ticket", token);
  if (path !== null) {
    const target = appLocation(appUrl, path);
    if (/^\/sign-(in|up)(\/|$)/.test(target.pathname)) throw new Error("--path cannot point at the sign-in or sign-up pages.");
    link.searchParams.set("redirect_url", target.href);
  }
  return link.href;
}

async function main() {
  const options = reviewLinkOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`${usage}\n\nCreates a labeled Clerk test user for this worktree and prints a single-use sign-in link.\n--plan     Seed deterministic paid access for the plan.\n--path     Application path to open after signing in.\n--expires  Link lifetime (default 1h, at most 7d).`);
    return;
  }
  const local = resolveLocalTestConfig();
  const appUrl = local.config.env.APP_URL;
  // Validate the destination before creating provider resources.
  reviewLink(appUrl, "validation", options.path);
  const interrupts = deferInterrupts();
  let user;
  try {
    user = await createClerkTestUser(local, { purpose: "maintainer-review" });
    interrupts.check();
    if (options.plan) {
      const { seedPaidTestUser } = await import("./billing-test-fixtures.mjs");
      await seedPaidTestUser(user, options.plan, true, { periodMs: REVIEW_USER_LIFETIME_MS });
      interrupts.check();
    }
    const link = reviewLink(appUrl, await user.createSignInToken(Math.round(options.expiresMs / 1000)), options.path);
    interrupts.check();
    const access = options.plan ? `${options.plan} access` : "no paid access";
    console.error(`Review user ${user.id} (${user.name}) with ${access} in worktree ${local.config.id}.`);
    if (isLoopbackUrl(appUrl)) {
      console.error(`Warning: ${appUrl} is a loopback address, so the maintainer cannot open it from another device. Restart with pnpm bootstrap --tailscale and run this again.`);
    }
    console.log(link);
    console.error(`This link is a single-use sign-in credential that expires in ${formatDuration(options.expiresMs)}. Send it to the maintainer directly; never paste it into PRs, issues, commits, or logs.`);
    console.error("Tell the maintainer to open it in a private window. Every worktree shares this hostname, so a browser signed in to another worktree keeps that session and ignores the link.");
    console.error(`The review user stays in Clerk for the review; pnpm clerk:sweep removes it after ${formatDuration(REVIEW_USER_LIFETIME_MS)}.`);
  } catch (error) {
    // Without a printed link nobody can use the user, so remove it now.
    if (user) {
      try { await user.cleanup(); } catch (cleanupError) { console.error(`Review link: ${cleanupError.message}`); }
    }
    throw error;
  } finally {
    interrupts.dispose();
    if (interrupts.signal) process.exitCode = 130;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Review link: ${error.message}`);
    process.exitCode ||= 1;
  });
}
