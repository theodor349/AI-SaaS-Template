import { setTimeout as delay } from "node:timers/promises";

// Margin added to the rejection's retryAfter, so the retry lands after the
// bucket has refilled rather than at the exact moment it may.
const RETRY_MARGIN_MS = 1000;

// Total time a step may spend waiting out rejections. Playwright's test timeout
// in playwright.config.mts is 90 seconds, so this leaves room for the rest of
// the test.
const WAIT_BUDGET_MS = 45_000;

/**
 * Runs a test step that spends the shared sandbox Polar budget in
 * convex/rateLimits.ts. Another E2E run on the same organization, or the app's
 * own recovery and webhook reconciliation, may have spent it. Each RATE_LIMITED
 * rejection waits the milliseconds it carries, plus a margin, and runs the step
 * again, until the next wait would take the total past 45 seconds. Then the
 * last rejection fails the step. Any other error fails it at once.
 * @template T
 * @param {() => Promise<T>} step
 * @param {(ms: number) => Promise<unknown>} [sleep]
 * @returns {Promise<T>}
 */
export async function waitOutRateLimit(step, sleep = delay) {
  let waited = 0;
  for (;;) {
    try {
      return await step();
    } catch (error) {
      const retryAfter = rateLimitWait(error);
      if (retryAfter === null) throw error;
      const wait = retryAfter + RETRY_MARGIN_MS;
      if (waited + wait > WAIT_BUDGET_MS) throw error;
      waited += wait;
      console.warn(`RATE_LIMITED: retrying in ${wait} ms (${waited} of ${WAIT_BUDGET_MS} ms waited)`);
      await sleep(wait);
    }
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
