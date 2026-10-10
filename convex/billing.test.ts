/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { billingReturnUrl } from "./lib/billing";

const provider = vi.hoisted(() => ({
  customers: { get: vi.fn(), getExternal: vi.fn(), create: vi.fn() },
  products: { get: vi.fn() },
  checkouts: { list: vi.fn(), create: vi.fn() },
  customerSessions: { create: vi.fn() },
  subscriptions: { iterList: vi.fn(), get: vi.fn(), update: vi.fn(), revoke: vi.fn() },
  orders: { iterList: vi.fn() },
}));
vi.mock("@polar-sh/sdk/2026-10", async importOriginal => ({
  ...await importOriginal<typeof import("@polar-sh/sdk/2026-10")>(), createPolar: () => provider,
}));
const modules = import.meta.glob("./**/*.ts");
const secret = `whsec_${btoa("Polar signed fixture signing secret")}`;
const tokenIdentifier = "https://clerk.example|alice";
const externalId = `wt-test:${tokenIdentifier}`;
let subscriptions: ReturnType<typeof sub>[];
let orders: ReturnType<typeof order>[];
let customer: { id: string; external_id: string | null; metadata: { worktree_id: string } };
const start = Date.now() - 1000;
const end = Date.now() + 30 * 24 * 60 * 60_000;
function sub(product = "monthly", cancel = false) {
  return { id: "sub-a", customer_id: "customer-a", product_id: product, status: "active",
    current_period_start: new Date(start).toISOString(), current_period_end: new Date(end).toISOString(),
    created_at: new Date(start).toISOString(), modified_at: new Date().toISOString(), cancel_at_period_end: cancel };
}
function order(product = "monthly", id = "order-a", subscription: string | null = "sub-a") {
  return { id, customer_id: "customer-a", product_id: product, subscription_id: subscription,
    paid: true, status: "paid", net_amount: 1000, refunded_amount: 0,
    created_at: new Date(start + 10).toISOString(), modified_at: new Date().toISOString(), billing_reason: "subscription_create" };
}
async function* iterate<T>(items: T[]) { yield* items; }
function setup() { return convexTest(schema, modules); }
async function provision(t: ReturnType<typeof setup>, identity = tokenIdentifier) {
  return t.run(ctx => ctx.db.insert("users", { tokenIdentifier: identity, clerkId: identity.split("|")[1],
    email: "alice@example.com", firstName: "Alice", lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1 }));
}
function alice(t: ReturnType<typeof setup>) { return t.withIdentity({ tokenIdentifier, subject: "alice", name: "Alice" }); }
async function reconcile(t: ReturnType<typeof setup>) {
  await t.action(internal.polar.reconcileCustomer, { customerId: "customer-a" });
}
async function send(t: ReturnType<typeof setup>, type: string, data: unknown, id = `delivery-${type}`, valid = true) {
  const body = JSON.stringify({ type, timestamp: new Date().toISOString(), api_version: "2026-10-01", data });
  const date = new Date();
  return t.fetch("/webhooks/polar", { method: "POST", body, headers: {
    "webhook-id": id, "webhook-timestamp": String(Math.floor(date.getTime() / 1000)),
    "webhook-signature": valid ? new Webhook(secret).sign(id, date, body) : "v1,invalid",
  } });
}
async function link(t: ReturnType<typeof setup>) {
  await t.mutation(internal.billingState.enqueue, { customerId: "customer-a", externalId });
}
const state = (t: ReturnType<typeof setup>) => t.query(internal.billingState.get, { customerId: "customer-a" });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKTREE_ID", "wt-test"); vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "sandbox-test"); vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", secret); vi.stubEnv("POLAR_PRODUCT_MONTHLY", "monthly");
  vi.stubEnv("POLAR_PRODUCT_YEARLY", "yearly"); vi.stubEnv("POLAR_PRODUCT_LIFETIME", "lifetime");
  vi.stubEnv("POLAR_ORGANIZATION_ID", "");
  subscriptions = [sub()]; orders = [order()];
  customer = { id: "customer-a", external_id: externalId, metadata: { worktree_id: "wt-test" } };
  provider.customers.get.mockImplementation(async () => customer);
  provider.customers.getExternal.mockImplementation(async () => customer);
  provider.products.get.mockImplementation(async (id: string) => ({ id, name: id, is_archived: false,
    is_recurring: id !== "lifetime", recurring_interval: id === "monthly" ? "month" : id === "yearly" ? "year" : null,
    recurring_interval_count: id === "lifetime" ? null : 1,
    prices: [{ amount_type: "fixed", price_amount: 1000, price_currency: "usd", is_archived: false, tax_behavior: "exclusive" }] }));
  provider.subscriptions.iterList.mockImplementation(() => iterate(subscriptions));
  provider.orders.iterList.mockImplementation(() => iterate(orders));
  provider.subscriptions.get.mockImplementation(async (id: string) => subscriptions.find(s => s.id === id));
  provider.subscriptions.update.mockImplementation(async (id: string, body: { product_id?: string; cancel_at_period_end?: boolean }) => {
    const current = subscriptions.find(s => s.id === id)!;
    if (body.product_id) { current.product_id = body.product_id; orders.push({ ...order(body.product_id, `switch-${orders.length}`), billing_reason: "subscription_update" }); }
    if (body.cancel_at_period_end !== undefined) current.cancel_at_period_end = body.cancel_at_period_end;
    current.modified_at = new Date(Date.now() + orders.length).toISOString(); return current;
  });
  provider.subscriptions.revoke.mockImplementation(async (id: string) => { const current = subscriptions.find(s => s.id === id)!; current.status = "canceled"; return current; });
  provider.checkouts.list.mockResolvedValue({ items: [] });
  provider.checkouts.create.mockResolvedValue({ id: "checkout-a", url: "https://sandbox.polar.sh/checkout/test", expires_at: new Date(end).toISOString() });
  provider.customerSessions.create.mockResolvedValue({ customer_portal_url: "https://sandbox.polar.sh/portal/test" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

test("anonymous and unpaid callers cannot invoke paid queries, mutations, or actions; provisioning stays separate", async () => {
  const t = setup();
  await expect(t.query(api.billing.status, {})).rejects.toThrow("UNAUTHENTICATED");
  expect((await alice(t).query(api.billing.status, {})).readiness).toBe("provisioning");
  await provision(t);
  expect((await alice(t).query(api.billing.status, {})).state).toBe("awaiting_payment");
  for (const actor of [t, alice(t)]) {
    await expect(actor.query(api.billing.application, {})).rejects.toThrow();
    await expect(actor.mutation(api.myFunctions.addNumber, { value: 1 })).rejects.toThrow();
    await expect(actor.action(api.myFunctions.myAction, { first: 1, second: "x" })).rejects.toThrow();
  }
  await expect(t.action(api.polar.checkout, { model: "monthly", returnUrl: "/billing" })).rejects.toThrow("UNAUTHENTICATED");
  expect(await t.query(api.billing.products, {})).toEqual([]);
});

test("first payment, repeated plan switches, renewal, cancel and uncancel use confirmed owned subscription state", async () => {
  const t = setup(); await provision(t); await link(t);
  await send(t, "subscription.active", { ...sub(), customer }); await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "monthly", subscriptionId: "sub-a" });
  expect(await alice(t).query(api.billing.application, {})).toEqual({ name: "Alice" });
  for (const operation of ["yearly", "monthly", "yearly", "cancel", "reactivate", "cancel", "reactivate"] as const) {
    await alice(t).action(api.polar.changeSubscription, { operation });
    const row = await state(t);
    expect(row?.status).toBe("active");
    expect(row?.cancelAtPeriodEnd).toBe(operation === "cancel");
    if (operation === "monthly" || operation === "yearly") expect(row?.model).toBe(operation);
  }
  subscriptions[0].current_period_start = new Date(start + 500).toISOString();
  orders.push({ ...order("yearly", "renewal"), created_at: new Date(start + 600).toISOString(), billing_reason: "subscription_cycle" });
  await send(t, "order.paid", { ...orders.at(-1), customer }); await reconcile(t);
  expect(await state(t)).toMatchObject({ model: "yearly", status: "active", cancelAtPeriodEnd: false });
});

test("a signed success/order-created payload without paid provider state cannot grant access", async () => {
  const t = setup(); await provision(t); orders[0].paid = false; orders[0].status = "pending";
  expect((await send(t, "order.created", { ...orders[0], customer })).status).toBe(200);
  await reconcile(t);
  expect((await state(t))?.status).not.toBe("active");
  await expect(alice(t).query(api.billing.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
});

test("signature validation, wire validation, duplicates, missing associations and other worktrees are isolated", async () => {
  const t = setup();
  expect((await send(t, "customer.created", customer, "invalid", false)).status).toBe(400);
  expect((await send(t, "subscription.active", { id: "sub", customer_id: 3 }, "malformed")).status).toBe(400);
  expect((await send(t, "future.event", {}, "future")).status).toBe(200);
  const foreign = { ...customer, id: "foreign", external_id: "wt-other:issuer|alice", metadata: { worktree_id: "wt-other" } };
  expect((await send(t, "customer.created", foreign, "foreign")).status).toBe(200);
  expect((await send(t, "checkout.expired", { id: "abandoned", customer_id: null }, "abandoned")).status).toBe(200);
  expect(await t.run(ctx => ctx.db.query("billingAccounts").take(20))).toEqual([]);
  await Promise.all(Array.from({ length: 4 }, () => send(t, "customer.created", customer)));
  expect(await t.run(ctx => ctx.db.query("billingAccounts").take(20))).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query("webhookDeliveries").take(20))).toEqual([expect.objectContaining({ attempts: 1, status: "success" })]);
});

test("lifetime first purchase and upgrade protect against every old recurring event and old lifetime refund", async () => {
  for (const initial of ["none", "monthly", "yearly", "cancelled"]) {
    const t = setup(); await provision(t); await link(t);
    if (initial === "none") { subscriptions = []; orders = []; }
    else { subscriptions = [sub(initial === "yearly" ? "yearly" : "monthly", initial === "cancelled")]; orders = [order(subscriptions[0].product_id)]; }
    await reconcile(t);
    const lifetime = { ...order("lifetime", "lifetime-first", null), billing_reason: "purchase" };
    orders.push(lifetime); await send(t, "order.paid", { ...lifetime, customer }); await reconcile(t);
    expect(await state(t)).toMatchObject({ status: "active", model: "lifetime", lifetimeOrderId: "lifetime-first" });
    for (const event of ["subscription.active", "subscription.canceled", "subscription.uncanceled", "subscription.revoked", "order.paid"]) {
      if (subscriptions[0]) { subscriptions[0].status = event === "subscription.revoked" ? "canceled" : "active"; subscriptions[0].product_id = "yearly"; }
      orders.push({ ...order("yearly", `old-${event}`), billing_reason: "subscription_update" });
      await send(t, event, { id: "late", customer_id: customer.id, customer }, `late-${event}`); await reconcile(t);
      expect((await state(t))?.model).toBe("lifetime");
    }
    orders.push({ ...order("lifetime", "lifetime-second", null), created_at: new Date(Date.now() + 1).toISOString() });
    lifetime.refunded_amount = lifetime.net_amount; lifetime.modified_at = new Date(Date.now() + 100).toISOString();
    await send(t, "order.refunded", { ...lifetime, customer }); await reconcile(t);
    expect((await state(t))?.lifetimeOrderId).toBe("lifetime-second");
  }
});

test("full lifetime refund ends access, partial refund preserves it, and old subscription cannot restore it", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const lifetime = order("lifetime", "lifetime", null); orders.push(lifetime); await reconcile(t);
  lifetime.refunded_amount = 500; lifetime.modified_at = new Date(Date.now() + 10).toISOString(); await reconcile(t);
  expect((await state(t))?.model).toBe("lifetime");
  lifetime.refunded_amount = 1000; lifetime.modified_at = new Date(Date.now() + 20).toISOString();
  subscriptions[0].status = "active"; await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "ended", cancelAtPeriodEnd: false });
  expect((await state(t))?.subscriptionId).toBeUndefined();
  await expect(alice(t).query(api.billing.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
  expect(await alice(t).action(api.polar.portal, { returnUrl: "/billing" })).toContain("portal");
});

test("full current recurring refund revokes provider billing durably and failed cleanup stays retryable", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  orders[0].refunded_amount = 1000; orders[0].modified_at = new Date(Date.now() + 10).toISOString();
  provider.subscriptions.revoke.mockRejectedValueOnce(new Error("provider unavailable"));
  await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "ended", failureCode: "RECONCILIATION_FAILED", attempts: 1 });
  await reconcile(t);
  expect(provider.subscriptions.revoke).toHaveBeenCalledWith("sub-a");
  await reconcile(t);
  expect((await state(t))?.failureCode).toBeUndefined();
  expect(subscriptions[0].status).toBe("canceled");
});

test("expiry works without webhooks and past-due payments do not grant indefinite grace", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const account = (await state(t))!;
  await t.run(ctx => ctx.db.patch("billingAccounts", account._id, { paidThrough: Date.now() - 1 }));
  await t.mutation(internal.billingState.expire, { accountId: account._id, revision: account.revision });
  await expect(alice(t).query(api.billing.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
  subscriptions[0].status = "past_due"; await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
  await expect(alice(t).mutation(api.myFunctions.addNumber, { value: 1 })).rejects.toThrow("PAID_ACCESS_REQUIRED");
});

test("customers and paid events before signup claim only stable external identity, never email", async () => {
  const t = setup(); await link(t); await reconcile(t);
  expect((await state(t))?.userId).toBeUndefined();
  await provision(t, "https://clerk.example|bob");
  const bob = t.withIdentity({ tokenIdentifier: "https://clerk.example|bob", subject: "bob" });
  expect((await bob.query(api.billing.status, {})).state).toBe("awaiting_payment");
  await expect(bob.action(api.polar.recover, {})).rejects.toThrow("CUSTOMER_IDENTITY_CONFLICT");
  await provision(t); await reconcile(t);
  expect((await alice(t).query(api.billing.status, {})).state).toBe("active");
});

test("missing external IDs remain unclaimed until provider association is repaired", async () => {
  const t = setup(); await provision(t); customer.external_id = null;
  await send(t, "customer.created", customer); await reconcile(t);
  expect((await state(t))?.userId).toBeUndefined();
  expect((await alice(t).query(api.billing.status, {})).state).toBe("awaiting_payment");
  customer.external_id = externalId;
  await send(t, "customer.updated", customer); await reconcile(t);
  expect((await alice(t).query(api.billing.status, {})).state).toBe("active");
});

test("checkout accepts unpaid owners, validates products and return URLs, and portal works after expiry", async () => {
  const t = setup(); await provision(t); subscriptions = []; orders = [];
  for (const url of ["https://evil.example/billing", "//evil.example/billing", "/app", "\\evil", "/billing\n"]) {
    expect(() => billingReturnUrl(url)).toThrow();
  }
  await expect(alice(t).action(api.polar.checkout, { model: "monthly", returnUrl: "https://evil.example/billing" })).rejects.toThrow("INVALID_RETURN_URL");
  expect(await alice(t).action(api.polar.checkout, { model: "monthly", returnUrl: "/billing" })).toContain("checkout");
  expect(provider.checkouts.create).toHaveBeenCalledWith(expect.objectContaining({ products: ["monthly"], customer_id: "customer-a", allow_trial: false }));
  provider.checkouts.list.mockResolvedValue({ items: [{ status: "open", expires_at: new Date(end).toISOString(), url: "https://sandbox.polar.sh/recovered", metadata: { worktree_id: "wt-test" } }] });
  expect(await alice(t).action(api.polar.checkout, { model: "monthly", returnUrl: "/billing" })).toContain("recovered");
  expect(provider.checkouts.create).toHaveBeenCalledTimes(1);
  provider.products.get.mockResolvedValueOnce({ is_archived: true, prices: [] });
  await expect(alice(t).action(api.polar.checkout, { model: "yearly", returnUrl: "/billing" })).rejects.toThrow("BILLING_CONFIGURATION_REQUIRED");
  expect(await alice(t).action(api.polar.portal, { returnUrl: "/billing" })).toContain("portal");
});

test("a superseded reconciliation cannot publish stale state and account deletion exposes retryable cleanup", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  const lease = (await t.mutation(internal.billingState.lease, { customerId: "customer-a" }))!;
  await link(t);
  expect(await t.mutation(internal.billingState.apply, { version: lease.version,
    snapshot: { customerId: "customer-a", externalId, subscriptions: [], orders: [] } })).toEqual([]);
  expect((await state(t))?.status).toBe("active");
  await t.mutation(internal.billingState.finish, { customerId: "customer-a", version: lease.version, failed: false });
  await t.run(ctx => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
  expect(await t.mutation(internal.billingState.cleanup, { userId })).toEqual({ complete: false });
  await reconcile(t); await reconcile(t);
  expect(await t.mutation(internal.billingState.cleanup, { userId })).toEqual({ complete: true });
  await expect(alice(t).query(api.billing.application, {})).rejects.toThrow("ACCOUNT_UNAVAILABLE");
});

test("signed cancellation, uncancellation, paid renewal and revocation reconcile current state despite delayed events", async () => {
  const t = setup(); await provision(t);
  for (const [type, status, cancel] of [
    ["subscription.active", "active", false], ["subscription.canceled", "active", true],
    ["subscription.uncanceled", "active", false], ["subscription.revoked", "canceled", false],
  ] as const) {
    subscriptions[0].status = status; subscriptions[0].cancel_at_period_end = cancel;
    subscriptions[0].modified_at = new Date(Date.now() + 100).toISOString();
    expect((await send(t, type, { ...subscriptions[0], customer })).status).toBe(200);
    await reconcile(t);
    expect((await state(t))?.status).toBe(status === "active" ? "active" : "ended");
    if (status === "active") expect((await state(t))?.cancelAtPeriodEnd).toBe(cancel);
  }
  // An old activation with a later delivery time still reads the revoked state.
  await send(t, "subscription.active", { ...sub(), customer }, "delayed-active"); await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
});

test("partial and previous-period recurring refunds preserve paid access while full current refunds stop billing", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  orders[0].refunded_amount = 500; orders[0].modified_at = new Date(Date.now() + 1).toISOString(); await reconcile(t);
  expect((await state(t))?.status).toBe("active");
  orders[0].refunded_amount = 1000; orders[0].created_at = new Date(start - 60_000).toISOString();
  orders[0].modified_at = new Date(Date.now() + 2).toISOString(); orders.push(order("monthly", "current-renewal")); await reconcile(t);
  expect((await state(t))?.status).toBe("active");
  expect(provider.subscriptions.revoke).not.toHaveBeenCalled();
});

test("pending commands serialize simultaneous checkout and subscription requests, then recover", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const lease = await alice(t).mutation(internal.billingState.beginOperation, {});
  await expect(alice(t).action(api.polar.checkout, { model: "lifetime", returnUrl: "/billing" })).rejects.toThrow("BILLING_OPERATION_PENDING");
  expect(provider.checkouts.create).not.toHaveBeenCalled();
  await alice(t).mutation(internal.billingState.endOperation, { lease });
  expect(await alice(t).action(api.polar.checkout, { model: "lifetime", returnUrl: "/billing" })).toContain("checkout");
});

test("revocation commands keep provider failures visible and ownership is enforced before scheduling", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  await expect(t.action(internal.polar.revoke, { userId, subscriptionId: "someone-else" })).rejects.toThrow("ownership");
  provider.subscriptions.revoke.mockRejectedValueOnce(new Error("provider outage"));
  await t.action(internal.polar.revoke, { userId, subscriptionId: "sub-a" });
  expect(await state(t)).toMatchObject({ status: "ended", failureCode: "RECONCILIATION_FAILED" });
  await reconcile(t); await reconcile(t);
  expect(subscriptions[0].status).toBe("canceled");
  expect((await state(t))?.failureCode).toBeUndefined();
});

test("two worktrees sharing a signed provider event can only enqueue their own stable customer identity", async () => {
  const first = setup(); const second = setup();
  expect((await send(first, "customer.created", customer)).status).toBe(200);
  vi.stubEnv("WORKTREE_ID", "wt-other");
  expect((await send(second, "customer.created", customer)).status).toBe(200);
  expect(await second.run(ctx => ctx.db.query("billingAccounts").take(10))).toEqual([]);
  const foreign = { id: "customer-other", external_id: "wt-other:issuer|alice", metadata: { worktree_id: "wt-other" } };
  expect((await send(second, "customer.created", foreign, "other")).status).toBe(200);
  vi.stubEnv("WORKTREE_ID", "wt-test");
  expect((await send(first, "customer.created", foreign, "other")).status).toBe(200);
  expect(await first.run(ctx => ctx.db.query("billingAccounts").take(10))).toEqual([expect.objectContaining({ customerId: "customer-a" })]);
  expect(await second.run(ctx => ctx.db.query("billingAccounts").take(10))).toEqual([expect.objectContaining({ customerId: "customer-other" })]);
});

test("account cleanup reconciles a customer even when its creation delivery or local linkage was missing", async () => {
  const t = setup(); const userId = await provision(t);
  await t.run(ctx => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
  expect(await t.action(internal.polar.cleanupAccount, { userId })).toEqual({ complete: false });
  expect(provider.subscriptions.revoke).toHaveBeenCalledWith("sub-a");
  expect(await t.action(internal.polar.cleanupAccount, { userId })).toEqual({ complete: true });
});

test("an expired reconciliation worker cannot release its replacement's lease", async () => {
  const t = setup(); await link(t);
  const first = (await t.mutation(internal.billingState.lease, { customerId: "customer-a" }))!;
  vi.advanceTimersByTime(120_001);
  // Avoid draining scheduled jobs: acquire the next transaction directly.
  const next = (await t.mutation(internal.billingState.lease, { customerId: "customer-a" }))!;
  await t.mutation(internal.billingState.finish, { customerId: "customer-a", version: first.version, failed: true });
  expect((await state(t))?.leaseVersion).toBe(next.version);
  expect((await state(t))?.leaseUntil).toBeGreaterThan(Date.now());
});

test("prorated plan changes preserve purchased time; unpaid renewal cannot extend it", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const original = (await state(t))!.paidThrough!;
  subscriptions[0].product_id = "yearly";
  subscriptions[0].current_period_start = new Date(Date.now() + 10).toISOString();
  subscriptions[0].current_period_end = new Date(original + 365 * 24 * 60 * 60_000).toISOString();
  orders.push({ ...order("yearly", "zero-update"), net_amount: 0, billing_reason: "subscription_update" });
  await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "yearly", paidThrough: original });
  orders.push({ ...order("yearly", "paid-update"), created_at: new Date(Date.now() + 20).toISOString(), billing_reason: "subscription_update" });
  await reconcile(t);
  expect((await state(t))!.paidThrough).toBeGreaterThan(original);
});

test("zero-price paid flags cannot grant a first recurring or lifetime entitlement", async () => {
  for (const model of ["monthly", "lifetime"]) {
    const t = setup(); await provision(t); await link(t);
    subscriptions = model === "monthly" ? [sub()] : [];
    orders = [{ ...order(model, "zero", model === "monthly" ? "sub-a" : null), net_amount: 0 }];
    await reconcile(t);
    expect((await state(t))?.status).not.toBe("active");
  }
});
