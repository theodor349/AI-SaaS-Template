import assert from "node:assert/strict";
import test from "node:test";
import { deleteClerkUser, withProviderRetry } from "./clerk-test-user.mjs";

const never = () => new Promise(() => {});
const notFound = Object.assign(new Error("Not Found"), { status: 404 });

test("a Clerk call that never answers fails with a clear error instead of waiting on", async () => {
  await assert.rejects(withProviderRetry(never, { attemptMs: 10 }), /Clerk did not answer within 10 ms/);
});

test("a Clerk call that isn't safe to repeat isn't repeated after a timeout", async () => {
  let calls = 0;
  await assert.rejects(withProviderRetry(() => { calls++; return never(); }, { attemptMs: 10 }));
  assert.equal(calls, 1);
});

test("deleting a test user tries again when Clerk doesn't answer", async () => {
  const calls = [never, async () => {}];
  const client = { users: { deleteUser: () => calls.shift()() } };
  await deleteClerkUser(client, "user_1", { attemptMs: 10 });
  assert.equal(calls.length, 0);
});

test("deleting a test user succeeds when a lost answer had already deleted it", async () => {
  const calls = [never, () => Promise.reject(notFound)];
  const client = { users: { deleteUser: () => calls.shift()() } };
  await deleteClerkUser(client, "user_1", { attemptMs: 10 });
  assert.equal(calls.length, 0);
});

test("deleting a test user still reports other Clerk errors", async () => {
  const client = { users: { deleteUser: () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 })) } };
  await assert.rejects(deleteClerkUser(client, "user_1"), /Forbidden/);
});
