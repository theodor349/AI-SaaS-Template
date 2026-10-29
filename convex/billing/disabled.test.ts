import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import crons from "../crons";
import schema from "../schema";
import { modules } from "../test.setup";
import { hasPaidPro } from "./lib";

// The same app with `billing: false` in app.config.ts.
vi.mock("../../app.config", async (importOriginal) => {
  const { appConfig } = await importOriginal<typeof import("../../app.config")>();
  return { appConfig: { ...appConfig, billing: false } };
});
const createPolar = vi.hoisted(() => vi.fn());
vi.mock("@polar-sh/sdk/2026-10", async (importOriginal) => ({
  ...await importOriginal<typeof import("@polar-sh/sdk/2026-10")>(), createPolar,
}));

const issuer = "https://clerk.example";
const tokenIdentifier = `${issuer}|alice`;

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
async function provision(t: ReturnType<typeof setup>, lifecycle: "active" | "deletion_requested" = "active") {
  return t.run((ctx) => ctx.db.insert("users", { tokenIdentifier, clerkId: "alice", email: "alice@example.com",
    displayName: "Alice", lifecycle, profileUpdatedAt: 1, profileEventAt: 1 }));
}
const alice = (t: ReturnType<typeof setup>) => t.withIdentity({ tokenIdentifier, subject: "alice", issuer });

beforeEach(() => {
  vi.stubEnv("WORKTREE_ID", "wt-test"); vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  createPolar.mockImplementation(() => { throw new Error("Polar must not be called"); });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("every active user has paid access, without a billing account", async () => {
  const t = setup();
  await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("PROVISIONING_REQUIRED");
  const userId = await provision(t);
  expect(await alice(t).query(api.billing.account.application, {})).toEqual({ name: "Alice" });
  expect(await t.run((ctx) => hasPaidPro(ctx, userId, Date.now()))).toBe(true);

  await t.run((ctx) => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
  await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("ACCOUNT_UNAVAILABLE");
  expect(await t.run((ctx) => hasPaidPro(ctx, userId))).toBe(false);
});

test("public billing functions refuse before reaching Polar", async () => {
  const t = setup();
  await provision(t);
  const as = alice(t);
  const calls = [
    () => as.query(api.billing.catalog.products, {}),
    () => as.query(api.billing.account.syncStatus, {}),
    () => as.query(api.billing.withdrawals.purchases, {}),
    () => as.mutation(api.billing.withdrawals.request, { orderId: "order-a" }),
    () => as.action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" }),
    () => as.action(api.billing.polar.portal, { returnUrl: "/billing" }),
    () => as.action(api.billing.polar.changeSubscription, { operation: "cancel" }),
    () => as.action(api.billing.polar.recover, {}),
  ];
  for (const call of calls) await expect(call()).rejects.toThrow("BILLING_DISABLED");
  expect(createPolar).not.toHaveBeenCalled();
});

test("no billing job is scheduled", () => {
  const jobs = Object.values(crons.crons).map((job) => job.name);
  expect(jobs).not.toEqual([]);
  expect(jobs.filter((name) => name.startsWith("billing/"))).toEqual([]);
});

test("account cleanup skips Polar when it isn't configured", async () => {
  vi.useFakeTimers();
  const t = setup();
  const userId = await provision(t);
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const [request] = await t.query(internal.account.lifecycle.pending, {});
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(await alice(t).query(api.account.lifecycle.current, {}))
    .toMatchObject({ status: "pending", cancellationConfirmed: true, failure: false });

  // A billing row left from before billing was turned off ends with the account.
  await t.run(async (ctx) => {
    await ctx.db.patch("users", userId, { lifecycle: "deletion_requested" });
    await ctx.db.insert("billingAccounts", { customerId: "customer-a", externalId: `wt-test:${tokenIdentifier}`,
      userId, status: "active", model: "lifetime", cancelAtPeriodEnd: false, revision: 1 });
  });
  expect(await t.action(internal.billing.polar.cleanupAccount, { userId })).toEqual({ complete: true });
  expect(await t.query(internal.billing.state.get, { customerId: "customer-a" })).toMatchObject({ status: "ended" });
  expect(createPolar).not.toHaveBeenCalled();
});

test("account cleanup still asks Polar when it is configured", async () => {
  vi.stubEnv("POLAR_ACCESS_TOKEN", "sandbox-test"); vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
  const t = setup();
  const userId = await provision(t, "deletion_requested");
  await expect(t.action(internal.billing.polar.cleanupAccount, { userId })).rejects.toThrow();
  expect(createPolar).toHaveBeenCalled();
});

test("data export works for a user without billing data", async () => {
  const t = setup();
  await provision(t);
  expect(await alice(t).action(api.account.dataExport.download, {})).toEqual(expect.any(String));
});
