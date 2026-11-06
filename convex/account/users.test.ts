import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { retryAfter } from "../lib/errors";
import schema from "../schema";
import { modules } from "../test.setup";

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
const issuer = "https://test.clerk.accounts.dev";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("protected queries reject anonymous callers", async () => {
  const t = setup();
  await expect(t.query(api.account.users.current, {})).rejects.toThrow("UNAUTHENTICATED");
});

test("the user record comes from the caller's identity, including issuer", async () => {
  const t = setup();
  await t.run((ctx) => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|same-subject`, clerkId: "same-subject", email: "alice@example.com",
    displayName: "Alice", profileUpdatedAt: 1, profileEventAt: 1, lifecycle: "active",
  }));
  const alice = t.withIdentity({ subject: "same-subject", issuer });
  expect(await alice.query(api.account.users.current, {})).toMatchObject({ status: "ready", user: { email: "alice@example.com" } });
  // Same subject from another issuer is a different, not yet provisioned, identity.
  const other = t.withIdentity({ subject: "same-subject", issuer: "https://clerk.example.com" });
  expect(await other.query(api.account.users.current, {})).toEqual({ status: "provisioning" });
});

test("clients cannot select another caller's identity through arguments", async () => {
  const t = setup();
  const alice = t.withIdentity({ subject: "alice", issuer });
  const forged = { tokenIdentifier: `${issuer}|bob` } as unknown as Record<string, never>;
  await expect(alice.query(api.account.users.current, forged)).rejects.toThrow();
});

test("a trailing slash on the configured issuer still provisions and finds the caller", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", `${issuer}/`);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    id: "user_a", updated_at: 100, primary_email_address_id: "email_a",
    email_addresses: [{ id: "email_a", email_address: "alice@example.com" }],
  }));
  const t = setup();
  const alice = t.withIdentity({ subject: "user_a", issuer });
  expect(await alice.action(api.account.users.ensureCurrentUser, {})).toMatchObject({ status: "ready" });
  expect(await alice.query(api.account.users.current, {})).toMatchObject({ status: "ready", user: { email: "alice@example.com" } });
});

test("provisioning repairs a record keyed with the slash-suffixed issuer", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", `${issuer}/`);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    id: "user_a", updated_at: 100, primary_email_address_id: "email_a",
    email_addresses: [{ id: "email_a", email_address: "alice@example.com" }],
  }));
  const t = setup();
  // An earlier webhook stored the unnormalized key with a newer event time, so
  // the fetched snapshot is stale and leaves the profile itself untouched.
  await t.run((ctx) => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}/|user_a`, clerkId: "user_a", email: "alice@example.com",
    profileUpdatedAt: 100, profileEventAt: 200, lifecycle: "active",
  }));
  const alice = t.withIdentity({ subject: "user_a", issuer });
  expect(await alice.query(api.account.users.current, {})).toEqual({ status: "provisioning" });
  await alice.action(api.account.users.ensureCurrentUser, {});
  expect(await alice.query(api.account.users.current, {})).toMatchObject({ status: "ready", user: { email: "alice@example.com" } });
});

test("profile refreshes are limited per user, and a rejected one makes no Clerk request", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
  const clerk = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const id = (url as string).split("/").at(-1);
    return Response.json({ id, updated_at: 100, primary_email_address_id: "email",
      email_addresses: [{ id: "email", email_address: `${id}@example.com` }] });
  });
  const t = setup();
  const alice = t.withIdentity({ subject: "user_a", issuer });
  for (let call = 0; call < 5; call++) await alice.action(api.account.users.ensureCurrentUser, { refresh: true });
  clerk.mockClear();

  const rejected = await alice.action(api.account.users.ensureCurrentUser, { refresh: true }).catch((error: unknown) => error);

  expect(retryAfter(rejected)).toBeGreaterThan(0);
  expect(clerk).not.toHaveBeenCalled();
  // Sign-in on a provisioned account needs no Clerk request, so it still works.
  expect(await alice.action(api.account.users.ensureCurrentUser, {})).toMatchObject({ status: "ready" });
  const bob = t.withIdentity({ subject: "user_b", issuer });
  expect(await bob.action(api.account.users.ensureCurrentUser, {})).toMatchObject({ status: "ready" });
});

// Terms acceptance is no longer recorded or required. Records written before
// that change, current or outdated, must not block anything.
test.each([
  ["no terms record", undefined],
  ["an outdated terms record", { terms: 0, privacy: 1, acceptedAt: 1 }],
])("a paid user with %s uses the product", async (_label, legalAcceptance) => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  const t = setup();
  const userId = await t.run((ctx) => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|alice`, clerkId: "alice", email: "alice@example.com",
    lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1, legalAcceptance,
  }));
  await t.run((ctx) => ctx.db.insert("billingAccounts", {
    customerId: "customer-a", userId, status: "active", model: "lifetime", cancelAtPeriodEnd: false, revision: 1,
  }));
  const alice = t.withIdentity({ subject: "alice", issuer });
  expect(await alice.query(api.billing.account.application, {})).toEqual({ name: "there" });
});

test("new accounts store no terms acceptance", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  const t = setup();
  await t.mutation(internal.account.users.syncProfile, {
    profile: { clerkId: "alice", email: "alice@example.com", updatedAt: 1 }, eventAt: 1,
  });
  const users = await t.run((ctx) => ctx.db.query("users").collect());
  expect(users.map((user) => user.legalAcceptance)).toEqual([undefined]);
});

test("clearing legacy terms records empties them in batches and keeps everything else", async () => {
  vi.useFakeTimers();
  const t = setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 250; i++) {
      await ctx.db.insert("users", {
        tokenIdentifier: `${issuer}|user-${i}`, clerkId: `user-${i}`, email: `user-${i}@example.com`,
        lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
        legalAcceptance: i % 5 ? { terms: 1, privacy: 1, acceptedAt: 1 } : undefined,
      });
    }
  });
  await t.mutation(internal.account.users.clearLegalAcceptance, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const users = await t.run((ctx) => ctx.db.query("users").collect());
  expect(users).toHaveLength(250);
  expect(users.filter((user) => user.legalAcceptance !== undefined)).toEqual([]);
  expect(users.every((user) => user.email === `${user.clerkId}@example.com`)).toBe(true);
  vi.useRealTimers();
});
