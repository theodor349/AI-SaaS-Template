import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ConvexError } from "convex/values";
import { waitOutRateLimit } from "./rate-limit-retry.mjs";

const rateLimited = (retryAfter) => new ConvexError({ code: "RATE_LIMITED", retryAfter });

/** @param {unknown[]} outcomes errors to throw or values to return, one per call */
function steps(outcomes) {
  let calls = 0;
  const step = async () => {
    const outcome = outcomes[calls++];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { step, calls: () => calls };
}

function recordingSleep() {
  /** @type {number[]} */
  const waits = [];
  return { waits, sleep: async (/** @type {number} */ ms) => { waits.push(ms); } };
}

test("a RATE_LIMITED rejection waits its retryAfter plus a margin, then retries once", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { step, calls } = steps([rateLimited(530), "checkout url"]);
  const { waits, sleep } = recordingSleep();
  assert.equal(await waitOutRateLimit(step, sleep), "checkout url");
  assert.equal(calls(), 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 530 && waits[0] <= 530 + 5000);
});

// Playwright loads convex/lib/errors.ts as CommonJS, so errors can come from
// either build of the convex package.
test("a RATE_LIMITED rejection from the CommonJS ConvexError class is also waited out", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { ConvexError: CommonJsConvexError } = createRequire(import.meta.url)("convex/values");
  assert.notEqual(CommonJsConvexError, ConvexError);
  const { step, calls } = steps([new CommonJsConvexError({ code: "RATE_LIMITED", retryAfter: 10 }), "recovered"]);
  const { waits, sleep } = recordingSleep();
  assert.equal(await waitOutRateLimit(step, sleep), "recovered");
  assert.equal(calls(), 2);
  assert.equal(waits.length, 1);
});

test("a second RATE_LIMITED rejection fails the step", async (t) => {
  t.mock.method(console, "warn", () => {});
  const second = rateLimited(200);
  const { step, calls } = steps([rateLimited(100), second, "unreached"]);
  const { waits, sleep } = recordingSleep();
  await assert.rejects(waitOutRateLimit(step, sleep), (error) => error === second);
  assert.equal(calls(), 2);
  assert.equal(waits.length, 1);
});

test("other errors fail at once without waiting", async () => {
  for (const error of [new ConvexError({ code: "BILLING_REQUEST_FAILED" }), new Error("Polar is down")]) {
    const { step, calls } = steps([error, "unreached"]);
    const { waits, sleep } = recordingSleep();
    await assert.rejects(waitOutRateLimit(step, sleep), (thrown) => thrown === error);
    assert.equal(calls(), 1);
    assert.deepEqual(waits, []);
  }
});
