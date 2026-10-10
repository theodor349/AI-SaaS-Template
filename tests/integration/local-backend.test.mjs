import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const { config } = resolveLocalTestConfig();

test("the worktree Convex backend serves successfully", { timeout: 30000 }, async () => {
  const response = await fetch(`${config.env.NEXT_PUBLIC_CONVEX_URL}/version`, { signal: AbortSignal.timeout(25000) });
  await response.body?.cancel();
  assert.equal(response.status, 200);
});

test("the worktree frontend serves successfully", { timeout: 30000 }, async () => {
  const response = await fetch(config.env.APP_URL, { signal: AbortSignal.timeout(25000) });
  await response.body?.cancel();
  assert.equal(response.status, 200);
});
