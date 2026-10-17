import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appConfig } from "../../app.config";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { retryAfter } from "../lib/errors";
import schema from "../schema";
import { modules } from "../test.setup";

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
const issuer = "https://clerk.example";
const at = Date.UTC(2026, 0, 2, 3, 4, 5);
const iso = new Date(at).toISOString();

beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("WORKTREE_ID", "wt-test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

type Export = { app: string; formatVersion: number; exportedAt: string; sections: Record<string, Record<string, unknown>> };

// A user whose rows carry every internal field the export must leave out.
async function seed(t: ReturnType<typeof convexTest>, name: string,
  { lifecycle = "active", billing = true }: { lifecycle?: Doc<"users">["lifecycle"]; billing?: boolean } = {}) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: `${issuer}|${name}-clerk`, clerkId: `${name}-clerk`, email: `${name}@example.com`,
      displayName: `${name} name`, profileEdited: true, profileUpdatedAt: at, profileEventAt: at, lifecycle,
      legalAcceptance: { terms: 1, privacy: 1, acceptedAt: at },
    });
    await ctx.db.insert("accountLifecycleRequests", {
      userId, source: "user", sourceDeliveryId: `${name}-delivery`, requestedAt: at, status: "pending", deleteAfter: at,
      nextAttemptAt: at, leaseUntil: at, cancellationConfirmed: true, attempts: 3, failureCode: `${name}-failure`,
    });
    await ctx.db.insert("notes", { userId, title: `${name} note`, body: "Body", pinned: true, updatedAt: at });
    if (!billing) return userId;
    const customerId = `${name}-customer`;
    await ctx.db.insert("billingAccounts", {
      customerId, externalId: `wt-test:${issuer}|${name}-clerk`, userId, status: "active", model: "monthly",
      subscriptionId: `${name}-sub`, paidThrough: at, cancelAtPeriodEnd: false, scheduledChange: { model: "yearly", at },
      revision: 7, leaseUntil: at, failureCode: `${name}-failure`, checkoutId: `${name}-checkout`, checkoutUrl: `https://${name}.checkout`,
    });
    await ctx.db.insert("billingSync", { customerId, requestedVersion: 4, leaseUntil: at, attempts: 2, failureCode: `${name}-failure`, operationLeaseUntil: at });
    await ctx.db.insert("billingSubscriptions", {
      customerId, subscriptionId: `${name}-sub`, productId: "monthly", superseded: true, status: "active",
      paidThrough: at, cancelAtPeriodEnd: false, modifiedAt: at, periodStart: at,
    });
    await ctx.db.insert("billingOrders", {
      customerId, orderId: `${name}-order`, productId: "monthly", subscriptionId: `${name}-sub`,
      paid: true, fullyRefunded: false, createdAt: at, modifiedAt: at,
    });
    await ctx.db.insert("withdrawals", {
      userId, customerId, orderId: `${name}-order`, subscriptionId: `${name}-sub`, model: "monthly", purchasedAt: at,
      receivedAt: at, refundOrderIds: [`${name}-order`], status: "pending", receiptEmailId: `${name}-receipt`,
      nextAttemptAt: at, leaseUntil: at, attempts: 2, failureCode: `${name}-failure`,
    });
    return userId;
  });
}

async function download(t: ReturnType<typeof convexTest>, name: string) {
  return JSON.parse(await t.withIdentity({ issuer, subject: `${name}-clerk` }).action(api.account.dataExport.download, {})) as Export;
}

test("an export holds only the caller's data, in the documented shape", async () => {
  const t = setup();
  await seed(t, "alice");
  await seed(t, "bob");
  const exported = await download(t, "alice");

  expect(exported).toEqual({
    app: appConfig.appName,
    formatVersion: 1,
    exportedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    sections: {
      profile: { account: { email: "alice@example.com", displayName: "alice name", createdAt: expect.any(String) } },
      billing: {
        plan: {
          status: "active", model: "monthly", paidThrough: iso, cancelAtPeriodEnd: false,
          scheduledChange: { model: "yearly", at: iso }, subscriptionId: "alice-sub", lifetimeOrderId: null,
        },
        subscriptions: [{
          subscriptionId: "alice-sub", productId: "monthly", status: "active", periodStart: iso, paidThrough: iso,
          cancelAtPeriodEnd: false, scheduledChange: null, modifiedAt: iso,
        }],
        orders: [{
          orderId: "alice-order", productId: "monthly", subscriptionId: "alice-sub",
          paid: true, fullyRefunded: false, createdAt: iso, modifiedAt: iso,
        }],
      },
      accountLifecycle: { requests: [{ source: "user", status: "pending", requestedAt: iso, deleteAfter: iso }] },
      legal: { acceptance: { termsVersion: 1, privacyVersion: 1, acceptedAt: iso } },
      withdrawals: {
        requests: [{ orderId: "alice-order", model: "monthly", purchasedAt: iso, receivedAt: iso, status: "pending", refundedAt: null }],
      },
      notes: { notes: [{ title: "alice note", body: "Body", pinned: true, createdAt: expect.any(String), updatedAt: iso }] },
    },
  });
  const text = JSON.stringify(exported);
  for (const excluded of ["bob", "clerk", "customer", "delivery", "failure", "checkout", "wt-test", "receipt"]) {
    expect(text).not.toContain(excluded);
  }
});

test("lists larger than one page are exported in full and logged as counts only", async () => {
  const t = setup();
  await seed(t, "alice");
  await t.run(async (ctx) => {
    for (let i = 0; i < 250; i++) {
      await ctx.db.insert("billingOrders", {
        customerId: "alice-customer", orderId: `extra-${i}`, productId: "monthly",
        paid: true, fullyRefunded: false, createdAt: at + i, modifiedAt: at + i,
      });
    }
  });
  const orders = (await download(t, "alice")).sections.billing.orders as { orderId: string }[];
  expect(orders).toHaveLength(251);
  expect(new Set(orders.map((order) => order.orderId)).size).toBe(251);

  const lines = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
  const event = lines.map((line) => JSON.parse(line) as { attributes: Record<string, unknown> })
    .find((candidate) => "billing.orders" in candidate.attributes);
  expect(event?.attributes).toMatchObject({
    "profile.account": 1, "billing.plan": 1, "billing.subscriptions": 1, "billing.orders": 251, "accountLifecycle.requests": 1,
  });
  expect(lines.join("\n")).not.toContain("alice@example.com");
});

test.each([
  { state: "awaiting payment", lifecycle: "active" as const },
  { state: "finalizing deletion", lifecycle: "deletion_requested" as const },
])("a user who is $state can export", async ({ lifecycle }) => {
  const t = setup();
  const userId: Id<"users"> = await seed(t, "alice", { lifecycle, billing: false });
  await t.run((ctx) => ctx.db.insert("billingAccounts", { customerId: "alice-customer", userId, status: "awaiting_payment", cancelAtPeriodEnd: false, revision: 0 }));
  const { sections } = await download(t, "alice");
  expect(sections.billing).toEqual({
    plan: expect.objectContaining({ status: "awaiting_payment", model: null, paidThrough: null }),
    subscriptions: [], orders: [],
  });
  expect(sections.accountLifecycle.requests).toEqual([expect.objectContaining({ status: "pending" })]);
});

test("a user without billing exports an empty billing section", async () => {
  const t = setup();
  await seed(t, "alice", { billing: false });
  expect((await download(t, "alice")).sections.billing).toEqual({ plan: null, subscriptions: [], orders: [] });
});

test("an export over the size limit stops early with a typed error", async () => {
  const t = setup();
  await seed(t, "alice");
  // Twenty orders near the 1 MiB document limit pass the 12 MiB export limit.
  await t.run(async (ctx) => {
    for (let i = 0; i < 20; i++) {
      await ctx.db.insert("billingOrders", {
        customerId: "alice-customer", orderId: `large-${i}`, productId: "x".repeat(700_000),
        paid: true, fullyRefunded: false, createdAt: at, modifiedAt: at,
      });
    }
  });
  await expect(download(t, "alice")).rejects.toThrow("EXPORT_TOO_LARGE");
  const event = vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(String(line)) as { attributes: Record<string, unknown> })
    .find((candidate) => "bytes" in candidate.attributes);
  expect(event?.attributes.bytes).toBeGreaterThan(12 * 1024 * 1024);
  expect(event?.attributes).not.toHaveProperty("accountLifecycle.requests");
});

test("anonymous and unprovisioned callers cannot export", async () => {
  const t = setup();
  await expect(t.action(api.account.dataExport.download, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(t.withIdentity({ issuer, subject: "nobody" }).action(api.account.dataExport.download, {})).rejects.toThrow("PROVISIONING_REQUIRED");
});

test("repeated exports are rejected after a small burst", async () => {
  const t = setup();
  await seed(t, "alice");
  for (let call = 0; call < 3; call++) await download(t, "alice");

  const rejected = await download(t, "alice").catch((error: unknown) => error);

  expect(retryAfter(rejected)).toBeGreaterThan(0);
});
