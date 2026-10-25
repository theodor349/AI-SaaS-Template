import { setTimeout as delay } from "node:timers/promises";

// Margin added to the rejection's retryAfter, so the retry lands after the
// bucket has refilled rather than at the exact moment it may.
const RETRY_MARGIN_MS = 1000;

/**
 * Runs a test step that spends the shared sandbox Polar budget in
 * convex/rateLimits.ts. Another E2E run on the same organization may have spent
 * it, so a RATE_LIMITED rejection waits the milliseconds it carries, plus a
 * margin, and runs the step once more. A second rejection, or any other error,
 * fails the step.
 * @template T
 * @param {() => Promise<T>} step
 * @param {(ms: number) => Promise<unknown>} [sleep]
 * @returns {Promise<T>}
 */
export async function waitOutRateLimit(step, sleep = delay) {
  try {
    return await step();
  } catch (error) {
    const wait = rateLimitWait(error);
    if (wait === null) throw error;
    console.warn(`RATE_LIMITED: retrying once in ${wait + RETRY_MARGIN_MS} ms`);
    await sleep(wait + RETRY_MARGIN_MS);
    return await step();
  }
}

/**
 * The milliseconds a RATE_LIMITED ConvexError asks to wait, or null for any
 * other error. This reads the error's data instead of calling retryAfter from
 * convex/lib/errors.ts: Playwright loads that module as CommonJS, so its
 * ConvexError class is not the ESM one the specs' errors are built from, and
 * its instanceof check fails.
 * @param {unknown} error
 */
function rateLimitWait(error) {
  if (!(error instanceof Error) || error.name !== "ConvexError" || !("data" in error)) return null;
  const { data } = error;
  if (typeof data !== "object" || data === null || !("code" in data) || data.code !== "RATE_LIMITED") return null;
  return "retryAfter" in data && typeof data.retryAfter === "number" ? data.retryAfter : 0;
}
