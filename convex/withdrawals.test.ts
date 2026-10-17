/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { Resend } from "@convex-dev/resend";
import resendTest from "@convex-dev/resend/test";
import { convexTest } from "convex-test";
import { PolarServerError } from "@polar-sh/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { legalVersions } from "./lib/legal";
import { withdrawalDeadline } from "./lib/withdrawal";
import schema from "./schema";

const provider = vi.hoisted(() => ({
  customers: { get: vi.fn() },
  subscriptions: { iterList: vi.fn(), get: vi.fn(), revoke: vi.fn() },
  orders: { iterList: vi.fn(), get: vi.fn() },
  refunds: { list: vi.fn(), create: vi.fn() },
}));
vi.mock("@polar-sh/sdk/2026-10", async importOriginal => ({
  ...await importOriginal<typeof import("@polar-sh/sdk/2026-10")>(), createPolar: () => provider,
}));
const modules = import.meta.glob("./**/*.ts");
const issuer = "https://clerk.example";
const purchasedAt = Date.parse("2026-10-15T12:00:00Z");
const day = 24 * 60 * 60_000;

type ProviderOrder = ReturnType<typeof providerOrder>;
let orders: ProviderOrder[];
let subscriptions: ReturnType<typeof providerSubscription>[];

function providerOrder(model: string, id = "order-a") {
  return { id, customer_id: "customer-a", product_id: model, subscription_id: model === "lifetime" ? null : "sub-a",
    paid: true, status: "paid", net_amount: 1000, refunded_amount: 0, refundable_amount: 1000,
    created_at: new Date(purchasedAt).toISOString(), modified_at: new Date(purchasedAt).toISOString() };
}
function providerSubscription(model: string) {
  return { id: "sub-a", customer_id: "customer-a", product_id: model, status: "active", cancel_at_period_end: false,
    current_period_start: new Date(purchasedAt - 1000).toISOString(), current_period_end: new Date(purchasedAt + 30 * day).toISOString(),
    created_at: new Date(purchasedAt - 1000).toISOString(), modified_at: new Date(purchasedAt).toISOString(), pending_update: null };
}
async function* iterate<T>(items: T[]) { yield* items; }

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  resendTest.register(t);
  return t;
}
type Test = ReturnType<typeof setup>;
const as = (t: Test, name: string) => t.withIdentity({ issuer, subject: name });

async function provision(t: Test, name: string) {
  return t.run(ctx => ctx.db.insert("users", { tokenIdentifier: `${issuer}|${name}`, clerkId: name,
    email: `${name}@example.com`, lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
    legalAcceptance: { ...legalVersions, acceptedAt: 1 } }));
}
// Alice buys `model` through the same reconciliation that publishes real purchases.
async function purchase(t: Test, model: "monthly" | "yearly" | "lifetime") {
  orders = [providerOrder(model)];
  subscriptions = model === "lifetime" ? [] : [providerSubscription(model)];
  const userId = await provision(t, "alice");
  await t.mutation(internal.billingState.enqueue, { customerId: "customer-a", externalId: `wt-test:${issuer}|alice` });
  await t.action(internal.polar.reconcileCustomer, { customerId: "customer-a" });
  return userId;
}
const accountState = async (t: Test) => (await t.query(internal.billingState.get, { customerId: "customer-a" }))?.status;
// Alice buys another lifetime purchase, published by reconciliation.
async function purchaseAgain(t: Test, orderId: string) {
  orders.push(providerOrder("lifetime", orderId));
  await t.action(internal.polar.reconcileCustomer, { customerId: "customer-a" });
}
const adminActions = () => vi.mocked(console.error).mock.calls
  .map(([line]) => (JSON.parse(String(line)) as { attributes: { adminAction?: string } }).attributes.adminAction);
const withdrawalsOf = (t: Test, userId: Id<"users">) =>
  t.run(ctx => ctx.db.query("withdrawals").withIndex("by_userId", q => q.eq("userId", userId)).collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(purchasedAt + 60_000);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("WORKTREE_ID", "wt-test"); vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("POLAR_ACCESS_TOKEN", "sandbox-test"); vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
  vi.stubEnv("POLAR_PRODUCT_MONTHLY", "monthly"); vi.stubEnv("POLAR_PRODUCT_YEARLY", "yearly");
  vi.stubEnv("POLAR_PRODUCT_LIFETIME", "lifetime"); vi.stubEnv("POLAR_ORGANIZATION_ID", "");
  const customer = { id: "customer-a", external_id: `wt-test:${issuer}|alice`, metadata: { worktree_id: "wt-test" } };
  provider.customers.get.mockImplementation(async () => customer);
  provider.subscriptions.iterList.mockImplementation(() => iterate(subscriptions));
  provider.subscriptions.get.mockImplementation(async (id: string) => subscriptions.find(s => s.id === id));
  provider.subscriptions.revoke.mockImplementation(async (id: string) => {
    const sub = subscriptions.find(s => s.id === id)!;
    sub.status = "canceled"; sub.modified_at = new Date().toISOString();
    return sub;
  });
  provider.orders.iterList.mockImplementation(() => iterate(orders));
  provider.orders.get.mockImplementation(async (id: string) => orders.find(o => o.id === id));
  provider.refunds.list.mockResolvedValue({ items: [] });
  provider.refunds.create.mockImplementation(async ({ order_id, amount }: { order_id: string; amount: number }) => {
    const order = orders.find(o => o.id === order_id)!;
    Object.assign(order, { refunded_amount: order.refunded_amount + amount, refundable_amount: order.refundable_amount - amount,
      status: "refunded", modified_at: new Date().toISOString() });
    return { status: "succeeded" };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

test.each(["monthly", "yearly", "lifetime"] as const)("withdrawing %s refunds the order through Polar and ends paid access", async (model) => {
  const t = setup();
  const userId = await purchase(t, model);
  expect(await accountState(t)).toBe("active");
  expect(await as(t, "alice").query(api.withdrawals.purchases, {})).toEqual([{
    orderId: "order-a", model, purchasedAt, withdrawUntil: withdrawalDeadline(purchasedAt), withdrawal: null,
  }]);

  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  // Repeating a received withdrawal records nothing new.
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  const [received] = await withdrawalsOf(t, userId);
  expect(received).toMatchObject({ status: "pending", receivedAt: Date.now(), refundOrderIds: ["order-a"] });

  await t.action(internal.polar.withdraw, { withdrawalId: received._id });
  expect(provider.refunds.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    order_id: "order-a", amount: 1000, reason: "customer_request",
  }));
  expect(provider.subscriptions.revoke).toHaveBeenCalledTimes(model === "lifetime" ? 0 : 1);
  expect((await withdrawalsOf(t, userId))[0]).toMatchObject({ status: "refunded", refundedAt: Date.now() });

  await t.action(internal.polar.reconcileCustomer, { customerId: "customer-a" });
  expect(await accountState(t)).toBe("ended");
  expect((await as(t, "alice").query(api.withdrawals.purchases, {}))[0].withdrawal).toMatchObject({ status: "refunded" });
});

test("withdrawal is refused once the period has ended", async () => {
  const t = setup();
  const userId = await purchase(t, "monthly");
  vi.setSystemTime(withdrawalDeadline(purchasedAt));
  await expect(as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" })).rejects.toThrow("WITHDRAWAL_PERIOD_ENDED");
  expect(await withdrawalsOf(t, userId)).toEqual([]);

  vi.setSystemTime(withdrawalDeadline(purchasedAt) - 1);
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  expect(await withdrawalsOf(t, userId)).toHaveLength(1);
});

test("another user can neither see nor withdraw a purchase", async () => {
  const t = setup();
  const aliceId = await purchase(t, "lifetime");
  const bobId = await provision(t, "bob");
  await t.run(ctx => ctx.db.insert("billingAccounts", { customerId: "customer-b", userId: bobId, status: "awaiting_payment", cancelAtPeriodEnd: false, revision: 0 }));

  expect(await as(t, "bob").query(api.withdrawals.purchases, {})).toEqual([]);
  await expect(as(t, "bob").mutation(api.withdrawals.request, { orderId: "order-a" })).rejects.toThrow("WITHDRAWAL_UNAVAILABLE");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  // An existing withdrawal is not a way in either.
  await expect(as(t, "bob").mutation(api.withdrawals.request, { orderId: "order-a" })).rejects.toThrow("WITHDRAWAL_UNAVAILABLE");
  expect(await withdrawalsOf(t, bobId)).toEqual([]);
  expect(await withdrawalsOf(t, aliceId)).toHaveLength(1);
});

test("a failed refund is visible, retried, and never refunded twice", async () => {
  const t = setup();
  const userId = await purchase(t, "monthly");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  const [{ _id: withdrawalId }] = await withdrawalsOf(t, userId);

  provider.refunds.create.mockRejectedValueOnce(new PolarServerError(503, "Unavailable"));
  await t.action(internal.polar.withdraw, { withdrawalId });
  expect((await withdrawalsOf(t, userId))[0]).toMatchObject({ status: "pending", attempts: 1, failureCode: "REFUND_FAILED" });
  expect(provider.subscriptions.revoke).not.toHaveBeenCalled();
  expect((await as(t, "alice").query(api.withdrawals.purchases, {}))[0].withdrawal).toMatchObject({ status: "pending", failed: true });
  // Other healthy pending withdrawals don't hide it from support.
  await t.run(async ctx => {
    for (let i = 0; i < 150; i++) {
      await ctx.db.insert("withdrawals", { userId, customerId: "customer-a", orderId: `other-${i}`, model: "monthly",
        purchasedAt, receivedAt: purchasedAt, refundOrderIds: [], status: "pending", nextAttemptAt: 0, leaseUntil: 0, attempts: 0 });
    }
  });
  expect(await t.query(internal.withdrawals.recoveryIssues, {})).toEqual([expect.objectContaining({ _id: withdrawalId })]);

  // A refund Polar is still processing is waited for, not repeated.
  provider.refunds.list.mockResolvedValueOnce({ items: [{ status: "pending" }] });
  await t.action(internal.polar.withdraw, { withdrawalId });
  expect(provider.refunds.create).toHaveBeenCalledTimes(1);
  const waiting = (await withdrawalsOf(t, userId))[0];
  expect(waiting).toMatchObject({ status: "pending", attempts: 1 });
  expect(waiting.failureCode).toBeUndefined();

  await t.action(internal.polar.withdraw, { withdrawalId });
  expect(provider.refunds.create).toHaveBeenCalledTimes(2);
  expect((await withdrawalsOf(t, userId))[0]).toMatchObject({ status: "refunded" });
  expect(await t.query(internal.withdrawals.recoveryIssues, {})).toEqual([]);

  // A late duplicate run finds nothing left to refund.
  await t.action(internal.polar.withdraw, { withdrawalId });
  expect(provider.refunds.create).toHaveBeenCalledTimes(2);
});

test("the receipt is emailed with the withdrawal's content and time received", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("EMAIL_FROM", "App <receipts@example.com>");
  const t = setup();
  const userId = await purchase(t, "yearly");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  const [{ receiptEmailId }] = await withdrawalsOf(t, userId);
  const email = await t.run(ctx => ctx.runQuery(components.resend.lib.get, { emailId: receiptEmailId! }));
  expect(email).toMatchObject({ from: "App <receipts@example.com>", to: ["alice@example.com"] });
  expect(email?.text).toContain("Purchase: Yearly Pro");
  expect(email?.text).toContain("Order: order-a");
  expect(email?.text).toContain("Withdrawal received: 15 October 2026 at 14:01:00 CEST");
});

test("the owner is emailed once the refund is made", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("EMAIL_FROM", "App <receipts@example.com>");
  const t = setup();
  const userId = await purchase(t, "lifetime");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  const [received] = await withdrawalsOf(t, userId);
  expect(received.refundEmailId).toBeUndefined();
  await t.action(internal.polar.withdraw, { withdrawalId: received._id });
  const [{ refundEmailId }] = await withdrawalsOf(t, userId);
  const email = await t.run(ctx => ctx.runQuery(components.resend.lib.get, { emailId: refundEmailId! }));
  expect(email).toMatchObject({ to: ["alice@example.com"] });
  expect(email?.text).toContain("Purchase: Lifetime Pro");
  expect(email?.text).toContain("We refunded your");
});

test("without email configured, the withdrawal is still received", async () => {
  const t = setup();
  const userId = await purchase(t, "monthly");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  const [withdrawal] = await withdrawalsOf(t, userId);
  expect(withdrawal.status).toBe("pending");
  expect(withdrawal.receiptEmailId).toBeUndefined();
});

test("a purchase shows its own withdrawal however many others the owner has", async () => {
  const t = setup();
  const userId = await purchase(t, "lifetime");
  await t.run(async ctx => {
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("withdrawals", { userId, customerId: "customer-a", orderId: `old-${i}`, model: "monthly",
        purchasedAt, receivedAt: purchasedAt, refundOrderIds: [], status: "refunded", attempts: 0 });
    }
  });
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  expect((await as(t, "alice").query(api.withdrawals.purchases, {}))[0].withdrawal).toMatchObject({ status: "pending" });
});

test("a repeat withdrawal emails the operator once, identifying the user only by ID", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("EMAIL_FROM", "App <receipts@example.com>");
  vi.stubEnv("OPERATOR_ALERT_EMAIL", "operator@example.com");
  const t = setup();
  const sent = vi.spyOn(Resend.prototype, "sendEmail");
  const alerts = async () => (await Promise.all(sent.mock.results.map(({ value }) =>
    t.run(async ctx => ctx.runQuery(components.resend.lib.get, { emailId: await value })))))
    .filter(email => email?.to.includes("operator@example.com"));
  const userId = await purchase(t, "lifetime");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  expect(await alerts()).toEqual([]);

  await purchaseAgain(t, "order-b");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-b" });
  // Repeating a received withdrawal sends no further alert.
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-b" });
  const [email, ...others] = await alerts();
  expect(others).toEqual([]);
  expect(email?.subject).toContain("repeat withdrawal");
  expect(email?.text).toContain(`User ${userId} withdrew from a purchase again and has made 2 withdrawals`);
  expect(email?.text).toContain("Order: order-a");
  expect(email?.text).toContain("Order: order-b");
  expect(email?.text).toContain("Purchase: Lifetime Pro");
  expect(email?.text).toContain("Status: pending");
  expect(email?.text).not.toContain("alice");
  expect(adminActions()).toEqual([]);

  await purchaseAgain(t, "order-c");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-c" });
  expect(await alerts()).toHaveLength(2);
});

test("without operator alerts configured, a repeat withdrawal is still received and asks for an admin", async () => {
  const t = setup();
  const userId = await purchase(t, "lifetime");
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-a" });
  await purchaseAgain(t, "order-b");
  vi.mocked(console.error).mockClear();
  await as(t, "alice").mutation(api.withdrawals.request, { orderId: "order-b" });
  expect((await withdrawalsOf(t, userId)).map(w => w.status)).toEqual(["pending", "pending"]);
  // Both the unsent receipt and the unsent alert reach the event.
  const [action] = adminActions();
  expect(action).toContain("withdrawal receipt wasn't sent");
  expect(action).toContain("operator alerts aren't configured");
});
