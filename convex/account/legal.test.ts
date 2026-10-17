import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { legalVersions } from "./legalVersions";
import { modules } from "../test.setup";

const issuer = "https://clerk.example";
beforeEach(() => vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function setup(legalAcceptance?: { terms: number; privacy: number; acceptedAt: number }) {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ issuer, subject: "alice" });
  const userId = () => t.run(ctx => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|alice`, clerkId: "alice", email: "alice@example.com",
    lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1, legalAcceptance,
  }));
  return { t, alice, userId };
}

async function activate(t: ReturnType<typeof convexTest>, userId: Awaited<ReturnType<ReturnType<typeof setup>["userId"]>>) {
  await t.run(ctx => ctx.db.insert("billingAccounts", {
    customerId: "customer-a", userId, status: "active", model: "lifetime", cancelAtPeriodEnd: false, revision: 1,
  }));
}

test("signing up accepts the current versions, so checkout and the product don't ask", async () => {
  vi.useFakeTimers({ now: 1_000 });
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ issuer, subject: "alice" });
  await t.mutation(internal.account.users.syncProfile, {
    profile: { clerkId: "alice", email: "alice@example.com", updatedAt: 1 }, eventAt: 1,
  });
  expect(await alice.query(api.account.legal.status, {})).toEqual({ accepted: true, previouslyAccepted: true });
  const user = await t.run(ctx => ctx.db.query("users").first());
  expect(user?.legalAcceptance).toEqual({ ...legalVersions, acceptedAt: 1_000 });
});

test("an account without a record accepts the current versions, and accepting again keeps the original time", async () => {
  vi.useFakeTimers({ now: 1_000 });
  const { t, alice, userId } = setup();
  const id = await userId();
  expect(await alice.query(api.account.legal.status, {})).toEqual({ accepted: false, previouslyAccepted: false });
  await alice.mutation(api.account.legal.accept, {});
  expect(await alice.query(api.account.legal.status, {})).toEqual({ accepted: true, previouslyAccepted: true });
  vi.setSystemTime(2_000);
  await alice.mutation(api.account.legal.accept, {});
  expect((await t.run(ctx => ctx.db.get("users", id)))?.legalAcceptance).toEqual({ ...legalVersions, acceptedAt: 1_000 });
});

test("a version bump asks again and pauses the paid product, but not account or billing access", async () => {
  const { t, alice, userId } = setup({ terms: legalVersions.terms - 1, privacy: legalVersions.privacy, acceptedAt: 1 });
  await activate(t, await userId());
  expect(await alice.query(api.account.legal.status, {})).toEqual({ accepted: false, previouslyAccepted: true });
  await expect(alice.query(api.billing.account.application, {})).rejects.toThrow("LEGAL_ACCEPTANCE_REQUIRED");
  expect((await alice.query(api.billing.account.status, {})).state).toBe("active");
  expect(await alice.query(api.account.users.current, {})).toMatchObject({ status: "ready" });
  expect(await alice.query(api.account.lifecycle.current, {})).toBeNull();
  await alice.mutation(api.account.legal.accept, {});
  expect(await alice.query(api.billing.account.application, {})).toEqual({ name: "there" });
});

test("checkout requires the current terms before contacting the payment provider", async () => {
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  const { alice, userId } = setup();
  await userId();
  await expect(alice.action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" }))
    .rejects.toThrow("LEGAL_ACCEPTANCE_REQUIRED");
});

test("accounts being deleted have nothing to accept", async () => {
  const { t, alice, userId } = setup();
  const id = await userId();
  await t.run(ctx => ctx.db.patch("users", id, { lifecycle: "deletion_requested" }));
  expect(await alice.query(api.account.legal.status, {})).toBeNull();
  await expect(alice.mutation(api.account.legal.accept, {})).rejects.toThrow("ACCOUNT_UNAVAILABLE");
});
