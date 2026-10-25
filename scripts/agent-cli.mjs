import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Shared argument and safety helpers for review-link, capture, and clerk:sweep.
export const PLANS = ["monthly", "yearly", "lifetime"];
const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(value, flag) {
  const match = /^(\d+)([smhd])$/.exec(value ?? "");
  if (!match) throw new Error(`${flag} must be a whole number with a unit, such as 30s, 15m, 2h, or 7d.`);
  return Number(match[1]) * units[match[2]];
}

export function formatDuration(ms) {
  for (const unit of ["d", "h", "m"]) {
    if (ms >= units[unit]) return `${Math.floor(ms / units[unit])}${unit}`;
  }
  return `${Math.floor(ms / 1000)}s`;
}

export function parsePlan(value) {
  if (value === undefined) return null;
  if (!PLANS.includes(value)) throw new Error(`--plan must be one of ${PLANS.join(", ")}.`);
  return value;
}

// Clerk's development instances treat a +clerk_test address as a test user that
// never receives email. Nothing else may be signed in by an agent script.
export function parseTestUserEmail(value) {
  if (value === undefined) return null;
  if (!/^[^\s@]+\+clerk_test@[^\s@]+\.[^\s@]+$/i.test(value)) {
    throw new Error("--user must be a Clerk test address of the form <name>+clerk_test@<domain>.");
  }
  return value;
}

// A path on the application's own origin, with the same rules as lib/auth.ts safeReturnTo.
export function appLocation(appUrl, path) {
  const origin = new URL(appUrl).origin;
  const url = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") &&
    !/[\\\u0000- ]/.test(path) ? new URL(path, origin) : null;
  if (!url || url.origin !== origin) throw new Error(`Expected an application path starting with /, got ${JSON.stringify(path)}.`);
  return url;
}

export function isLoopbackUrl(value) {
  const { hostname } = new URL(value);
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127\./.test(hostname);
}

export function checkoutRoots() {
  const root = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  return { root, mainRoot: realpathSync(dirname(commonDir)) };
}

// Resolves symlinks in the nearest existing ancestor so links into a checkout are caught.
function physicalPath(path) {
  const rest = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    rest.unshift(basename(current));
    current = dirname(current);
  }
  return join(realpathSync(current), ...rest);
}

export function isInside(path, root) {
  const offset = relative(physicalPath(root), physicalPath(path));
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

// Defers SIGINT/SIGTERM so finally blocks can remove provider resources; a second signal exits at once.
export function deferInterrupts(onInterrupt = () => {}) {
  let received = null;
  const handler = (signal) => {
    if (received) {
      console.error(`${signal} again: exiting before cleanup finished. Run pnpm clerk:sweep later to remove leftover test users.`);
      process.exit(130);
    }
    received = signal;
    onInterrupt(signal);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return {
    get signal() { return received; },
    check() { if (received) throw new Error(`Stopped by ${received}.`); },
    dispose() {
      process.removeListener("SIGINT", handler);
      process.removeListener("SIGTERM", handler);
    },
  };
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
