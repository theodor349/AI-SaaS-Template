import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const { config } = resolveLocalTestConfig();
const client = new ConvexHttpClient(config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });

test("the running local backend validates arguments and persists mutations", { timeout: 30000 }, async () => {
  const before = await client.query(api.myFunctions.listNumbers, { count: 10 });
  assert.equal(before.viewer, null);
  await assert.rejects(client.mutation(api.myFunctions.addNumber, { value: "invalid" }));
  assert.deepEqual(await client.query(api.myFunctions.listNumbers, { count: 10 }), before);

  // This is scratch worktree data; preserve other records and leave cleanup to worktree disposal.
  const value = Date.now();
  await client.mutation(api.myFunctions.addNumber, { value });
  const after = await client.query(api.myFunctions.listNumbers, { count: 10 });
  assert.equal(after.numbers[0], value);
  assert.deepEqual(after.numbers.slice(1), before.numbers.slice(0, 9));
  assert.equal(after.viewer, null);
});

test("the worktree frontend serves successfully", { timeout: 30000 }, async () => {
  const response = await fetch(config.env.APP_URL, { signal: AbortSignal.timeout(25000) });
  await response.body?.cancel();
  assert.equal(response.status, 200);
});
