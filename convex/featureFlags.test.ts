import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { hasErrorCode } from "./lib/errors";
import { featureFlags, flagKeys, requireFlag } from "./lib/featureFlags";
import { action, mutation } from "./lib/functions";
import schema from "./schema";
import { modules } from "./test.setup";

const issuer = "https://clerk.example";
const key = "notePinning";
const defaults = Object.fromEntries(flagKeys.map((flag) => [flag, featureFlags[flag].default]));

beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// A function behind the flag, the way a feature module would guard one.
const gated = {
  "./testFlags.ts": async () => ({
    run: mutation({ args: {}, handler: async (ctx) => { await requireFlag(ctx, key); return null; } }),
    runAction: action({ args: {}, handler: async (ctx) => { await requireFlag(ctx, key); return null; } }),
  }),
};

async function setup() {
  const t = convexTest(schema, { ...modules, ...gated });
  const insert = (clerkId: string) => t.run((ctx) => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|${clerkId}`, clerkId, email: `${clerkId}@example.com`,
    lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
  }));
  const aliceId = await insert("alice");
  await insert("bob");
  return {
    t, aliceId,
    alice: t.withIdentity({ issuer, subject: "alice" }),
    bob: t.withIdentity({ issuer, subject: "bob" }),
  };
}

const flagsOf = (caller: { query: ReturnType<typeof convexTest>["query"] }) => caller.query(api.featureFlags.current, {});

test("a flag without a row uses its registry default for every caller", async () => {
  const { t, alice } = await setup();
  expect(await flagsOf(alice)).toEqual(defaults);
  expect(await flagsOf(t)).toEqual(defaults);
});

test("the allowlist enables the flag only for listed users, and the payload holds only their values", async () => {
  const { t, alice, bob, aliceId } = await setup();
  await t.mutation(internal.featureFlags.allowUser, { key, userId: aliceId });
  expect(await flagsOf(alice)).toEqual({ ...defaults, [key]: true });
  expect(await flagsOf(bob)).toEqual({ ...defaults, [key]: false });
  expect(await flagsOf(t)).toEqual({ ...defaults, [key]: false });

  await t.mutation(internal.featureFlags.disallowUser, { key, userId: aliceId });
  expect(await flagsOf(alice)).toEqual(defaults);
  expect(await t.run((ctx) => ctx.db.query("featureFlags").collect())).toEqual([]);
});

test("a deployment-wide override applies to everyone, ahead of the allowlist", async () => {
  const { t, alice, bob, aliceId } = await setup();
  await t.mutation(internal.featureFlags.allowUser, { key, userId: aliceId });
  await t.mutation(internal.featureFlags.setOverride, { key, enabled: true });
  for (const caller of [alice, bob, t]) expect(await flagsOf(caller)).toEqual({ ...defaults, [key]: true });

  await t.mutation(internal.featureFlags.setOverride, { key, enabled: false });
  for (const caller of [alice, bob, t]) expect(await flagsOf(caller)).toEqual({ ...defaults, [key]: false });

  await t.mutation(internal.featureFlags.setOverride, { key, enabled: null });
  expect(await flagsOf(alice)).toEqual({ ...defaults, [key]: true });
  expect(await flagsOf(bob)).toEqual({ ...defaults, [key]: false });
});

test("requireFlag rejects direct calls from users without the flag", async () => {
  const { t, alice, bob, aliceId } = await setup();
  const run = makeFunctionReference<"mutation">("testFlags:run");
  const runAction = makeFunctionReference<"action">("testFlags:runAction");
  await t.mutation(internal.featureFlags.allowUser, { key, userId: aliceId });

  await expect(alice.mutation(run, {})).resolves.toBeNull();
  await expect(alice.action(runAction, {})).resolves.toBeNull();
  for (const call of [bob.mutation(run, {}), bob.action(runAction, {}), t.mutation(run, {})]) {
    const failure: unknown = await call.catch((error: unknown) => error);
    expect(hasErrorCode(failure, "FEATURE_UNAVAILABLE")).toBe(true);
  }
});

test("flag state rejects unknown flags and users", async () => {
  const { t, aliceId } = await setup();
  await expect(t.mutation(internal.featureFlags.setOverride, { key: "missing", enabled: true })).rejects.toThrow("Unknown feature flag");
  await t.run((ctx) => ctx.db.delete("users", aliceId));
  await expect(t.mutation(internal.featureFlags.allowUser, { key, userId: aliceId })).rejects.toThrow("No user");
});
