import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PolarClientError, PolarNetworkError } from "@polar-sh/sdk";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { billingReturnUrl, externalCustomerId, externalIdTokenIdentifier, hasPaidPro } from "./lib";
import { retryAfter } from "../lib/errors";
import { modules } from "../test.setup";

const provider = vi.hoisted(() => ({
  customers: { get: vi.fn(), list: vi.fn(), create: vi.fn(), delete: vi.fn() },
  products: { get: vi.fn() },
  organizations: { get: vi.fn() },
  checkouts: { list: vi.fn(), create: vi.fn() },
  customerSessions: { create: vi.fn() },
  subscriptions: { list: vi.fn(), iterList: vi.fn(), get: vi.fn(), update: vi.fn(), revoke: vi.fn() },
  orders: { iterList: vi.fn() },
}));
vi.mock("@polar-sh/sdk/2026-10", async importOriginal => ({
  ...await importOriginal<typeof import("@polar-sh/sdk/2026-10")>(), createPolar: () => provider,
}));
const secret = `whsec_${btoa("Polar signed fixture signing secret")}`;
const tokenIdentifier = "https://clerk.example|alice";
const externalId = `wt-test:${tokenIdentifier}`;
let subscriptions: ReturnType<typeof sub>[];
let orders: ReturnType<typeof order>[];
type Customer = { id: string; external_id: string | null; metadata: { worktree_id: string } };
let customer: Customer;
let customerExists: boolean;
let customerDeleted: boolean;
// Other Polar customers that a search can also return.
let otherCustomers: Customer[];
const start = Date.now() - 1000;
const end = Date.now() + 30 * 24 * 60 * 60_000;
function sub(product = "monthly", cancel = false) {
  return { id: "sub-a", customer_id: "customer-a", product_id: product, status: "active",
    current_period_start: new Date(start).toISOString(), current_period_end: new Date(end).toISOString(),
    created_at: new Date(start).toISOString(), modified_at: new Date().toISOString(), cancel_at_period_end: cancel,
    pending_update: null as { product_id: string; applies_at: string } | null,
    discount: null as Discount | null };
}
type Discount = { type: string; duration: string; basis_points?: number; amount?: number };
function order(product = "monthly", id = "order-a", subscription: string | null = "sub-a") {
  return { id, customer_id: "customer-a", product_id: product, subscription_id: subscription,
    paid: true, status: "paid", subtotal_amount: 1000, discount_amount: 0, net_amount: 1000, refunded_amount: 0,
    created_at: new Date(start + 10).toISOString(), modified_at: new Date().toISOString(), billing_reason: "subscription_create" };
}
async function* iterate<T>(items: T[]) { yield* items; }
function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
function decisions(log: { mock: { calls: unknown[][] } }) {
  return log.mock.calls.flatMap(([line]) => (JSON.parse(String(line)) as { path: object[] }).path);
}
async function provision(t: ReturnType<typeof setup>, identity = tokenIdentifier) {
  return t.run(ctx => ctx.db.insert("users", { tokenIdentifier: identity, clerkId: identity.split("|")[1],
    email: "alice@example.com", displayName: "Alice", lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1}));
}
function alice(t: ReturnType<typeof setup>) { return t.withIdentity({ tokenIdentifier, subject: "alice", name: "Alice" }); }
async function reconcile(t: ReturnType<typeof setup>) {
  await t.action(internal.billing.polar.reconcileCustomer, { customerId: "customer-a" });
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
  await t.mutation(internal.billing.state.enqueue, { customerId: "customer-a", externalId });
}
const state = (t: ReturnType<typeof setup>) => t.query(internal.billing.state.get, { customerId: "customer-a" });
const sync = (t: ReturnType<typeof setup>) => t.query(internal.billing.state.getSync, { customerId: "customer-a" });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKTREE_ID", "wt-test"); vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "sandbox-test"); vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", secret); vi.stubEnv("POLAR_PRODUCT_MONTHLY", "monthly");
  vi.stubEnv("POLAR_PRODUCT_YEARLY", "yearly"); vi.stubEnv("POLAR_PRODUCT_LIFETIME", "lifetime");
  vi.stubEnv("POLAR_ORGANIZATION_ID", ""); vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example");
  subscriptions = [sub()]; orders = [order()];
  customer = { id: "customer-a", external_id: externalId, metadata: { worktree_id: "wt-test" } };
  // Polar answers 404 for a deleted customer.
  customerExists = true; customerDeleted = false; otherCustomers = [];
  const current = async () => {
    if (customerDeleted) throw new PolarClientError(404, { detail: "Not Found" });
    return customer;
  };
  provider.customers.get.mockImplementation(current);
  // Polar's search matches substrings, so it can return near matches too.
  provider.customers.list.mockImplementation(async ({ query, limit }: { query: string; limit: number }) => {
    const all = [...(customerExists && !customerDeleted ? [customer] : []), ...otherCustomers];
    const matching = all.filter(c => c.external_id?.includes(query));
    return { items: matching.slice(0, limit), pagination: { total_count: matching.length, max_page: Math.ceil(matching.length / limit) } };
  });
  provider.customers.create.mockImplementation(async (body: { external_id: string }) => {
    if (body.external_id === customer.external_id) {
      if (customerExists && !customerDeleted) {
        throw new PolarClientError(422, { detail: [{ loc: ["body", "external_id"], msg: "External ID already exists" }] });
      }
      customerExists = true; customerDeleted = false;
    }
    return customer;
  });
  provider.customers.delete.mockImplementation(async () => { customerDeleted = true; });
  provider.products.get.mockImplementation(async (id: string) => ({ id, name: id, is_archived: false, organization_id: "org-a",
    is_recurring: id !== "lifetime", recurring_interval: id === "monthly" ? "month" : id === "yearly" ? "year" : null,
    recurring_interval_count: id === "lifetime" ? null : 1,
    prices: [{ amount_type: "fixed", price_amount: 1000, price_currency: "usd", is_archived: false, tax_behavior: "exclusive" }] }));
  provider.subscriptions.iterList.mockImplementation(() => iterate(subscriptions));
  provider.subscriptions.list.mockImplementation(async (query: { status: string[]; cancel_at_period_end?: boolean; limit: number }) => {
    const outstanding = subscriptions.filter(s => query.status.includes(s.status) && (query.cancel_at_period_end === undefined || s.cancel_at_period_end === query.cancel_at_period_end));
    return { items: outstanding.slice(0, query.limit), pagination: { total_count: outstanding.length, max_page: Math.ceil(outstanding.length / query.limit) } };
  });
  provider.orders.iterList.mockImplementation(() => iterate(orders));
  provider.subscriptions.get.mockImplementation(async (id: string) => subscriptions.find(s => s.id === id));
  provider.subscriptions.update.mockImplementation(async (id: string, body: { product_id?: string; cancel_at_period_end?: boolean; proration_behavior?: string }) => {
    const current = subscriptions.find(s => s.id === id)!;
    if (body.product_id && body.proration_behavior === "next_period") {
      current.pending_update = { product_id: body.product_id, applies_at: current.current_period_end };
    } else if (body.product_id) {
      current.product_id = body.product_id;
      current.pending_update = null;
      orders.push({ ...order(body.product_id, `switch-${orders.length}`), billing_reason: "subscription_update" });
    }
    if (body.cancel_at_period_end !== undefined) current.cancel_at_period_end = body.cancel_at_period_end;
    current.modified_at = new Date(Math.max(Date.now() + orders.length, Date.parse(current.modified_at) + 1)).toISOString(); return current;
  });
  provider.subscriptions.revoke.mockImplementation(async (id: string) => { const current = subscriptions.find(s => s.id === id)!; current.status = "canceled"; return current; });
  provider.organizations.get.mockResolvedValue({ id: "org-a", default_tax_behavior: "exclusive" });
  provider.checkouts.list.mockResolvedValue({ items: [] });
  provider.checkouts.create.mockResolvedValue({ id: "checkout-a", url: "https://sandbox.polar.sh/checkout/test", expires_at: new Date(end).toISOString() });
  provider.customerSessions.create.mockResolvedValue({ customer_portal_url: "https://sandbox.polar.sh/portal/test" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

test("anonymous and unpaid callers cannot invoke paid application queries; provisioning stays separate", async () => {
  const t = setup();
  await expect(t.query(api.billing.account.status, {})).rejects.toThrow("UNAUTHENTICATED");
  expect((await alice(t).query(api.billing.account.status, {})).readiness).toBe("provisioning");
  await provision(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("awaiting_payment");
  for (const actor of [t, alice(t)]) {
    await expect(actor.query(api.billing.account.application, {})).rejects.toThrow();
  }
  await expect(t.action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" })).rejects.toThrow("UNAUTHENTICATED");
  expect(await t.query(api.billing.catalog.products, {})).toEqual([]);
});

test("hasPaidPro reports another user's paid access without throwing", async () => {
  const t = setup();
  const userId = await provision(t);
  const now = Date.now();
  const paid = () => t.run(ctx => hasPaidPro(ctx, userId, now));
  expect(await paid()).toBe(false);
  const accountId = await t.run(ctx => ctx.db.insert("billingAccounts", { customerId: "customer-a", userId,
    status: "active", paidThrough: now + 1000, cancelAtPeriodEnd: false, revision: 1 }));
  expect(await paid()).toBe(true);
  // Without `now`, as in a query, materialized expiry decides.
  await t.run(ctx => ctx.db.patch("billingAccounts", accountId, { paidThrough: now }));
  expect(await paid()).toBe(false);
  expect(await t.run(ctx => hasPaidPro(ctx, userId))).toBe(true);
  await t.run(ctx => ctx.db.patch("billingAccounts", accountId, { paidThrough: now + 1000, status: "ended" }));
  expect(await paid()).toBe(false);
  await t.run(ctx => ctx.db.patch("billingAccounts", accountId, { status: "active" }));
  await t.run(ctx => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
  expect(await paid()).toBe(false);
});

// Polar leaves a price's tax_behavior null when it follows the organization's
// default, so the catalog resolves it there for the pricing copy.
test.each([
  ["follow an inclusive organization default", null, "inclusive", "inclusive"],
  ["follow an exclusive organization default", null, "exclusive", "exclusive"],
  ["follow a location-based organization default", null, "location", "location"],
  ["set their own tax behavior", "exclusive", "inclusive", "exclusive"],
])("catalog prices that %s show that tax behavior", async (_label, priceTaxBehavior, organizationDefault, expected) => {
  const t = setup();
  const product = provider.products.get.getMockImplementation()!;
  provider.products.get.mockImplementation(async (id: string) => {
    const result = await product(id);
    return { ...result, prices: result.prices.map((price: object) => ({ ...price, tax_behavior: priceTaxBehavior })) };
  });
  provider.organizations.get.mockResolvedValue({ id: "org-a", default_tax_behavior: organizationDefault });
  await t.action(internal.billing.polar.syncCatalog, {});
  const products = await t.query(api.billing.catalog.products, {});
  expect(products.map(item => item.taxBehavior)).toEqual([expected, expected, expected]);
  expect(provider.organizations.get).toHaveBeenCalledTimes(priceTaxBehavior ? 0 : 1);
});

test.each(["cancel", "reactivate"] as const)("repeating %s confirms provider state without issuing a rejected update", async operation => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  subscriptions[0].cancel_at_period_end = operation === "cancel";
  subscriptions[0].modified_at = new Date(Date.now() + 1000).toISOString();
  provider.subscriptions.update.mockRejectedValue(new PolarClientError(operation === "cancel" ? 403 : 409, { detail: "Already in requested state" }));

  await reconcile(t);
  const before = await alice(t).query(api.billing.account.status, {});

  await alice(t).action(api.billing.polar.changeSubscription, { operation });

  expect(provider.subscriptions.update).not.toHaveBeenCalled();
  expect(await state(t)).toMatchObject({ status: "active", cancelAtPeriodEnd: operation === "cancel" });
  // The client confirms a change by a newer revision matching the request.
  const after = await alice(t).query(api.billing.account.status, {});
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.cancelAtPeriodEnd).toBe(operation === "cancel");
});

test("reconciling unchanged provider state leaves the published entitlement untouched", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const published = await state(t);
  vi.advanceTimersByTime(60_000);
  await reconcile(t);
  expect(await state(t)).toEqual(published);
  expect((await sync(t))?.reconciledAt).toBe(Date.now());
});

test("timed checks follow paid access instead of polling every account", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  expect((await sync(t))?.nextCheckAt).toBe(Date.now() + 24 * 60 * 60_000);
  subscriptions[0].status = "canceled";
  subscriptions[0].modified_at = new Date(Date.now() + 10).toISOString();
  await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
  expect((await sync(t))?.nextCheckAt).toBeUndefined();
});

test("the backfill gives legacy accounts sync rows without overwriting existing ones", async () => {
  const t = setup(); await link(t);
  const existing = await sync(t);
  await t.run(async ctx => {
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("billingAccounts", { customerId: `legacy-${i}`, status: "active", cancelAtPeriodEnd: false,
        revision: 1, failureCode: "RECONCILIATION_FAILED", attempts: 9, nextCheckAt: 0 });
    }
  });
  await t.mutation(internal.billing.state.backfillSync, { cursor: null });
  await t.finishInProgressScheduledFunctions();
  vi.runAllTimers();
  await t.finishInProgressScheduledFunctions();
  const rows = await t.run(ctx => ctx.db.query("billingSync").take(200));
  expect(rows).toHaveLength(121);
  expect(rows.filter(row => row.customerId === "customer-a").map(row => row._id)).toEqual([existing!._id]);
  expect(rows.find(row => row.customerId === "legacy-7")).toMatchObject({
    failureCode: "RECONCILIATION_FAILED", attempts: 9, nextCheckAt: Date.now(),
  });
});

test("the sweep pages through every due account without a fixed ceiling", async () => {
  const t = setup();
  await t.run(async ctx => {
    for (let i = 0; i < 150; i++) {
      await ctx.db.insert("billingSync", { customerId: `due-${i}`, requestedVersion: 0, leaseUntil: 0, attempts: 0, nextCheckAt: Date.now() - 1 });
    }
    await ctx.db.insert("billingSync", { customerId: "idle", requestedVersion: 0, leaseUntil: 0, attempts: 0 });
  });
  const scheduled = () => t.run(ctx => ctx.db.system.query("_scheduled_functions").take(500));
  await t.mutation(internal.billing.state.sweep, {});
  let jobs = await scheduled();
  expect(jobs.filter(job => job.name.includes("reconcileCustomer"))).toHaveLength(100);
  expect(jobs.filter(job => job.name.includes("sweep"))).toHaveLength(1);
  await t.mutation(internal.billing.state.sweep, {});
  jobs = await scheduled();
  expect(jobs.filter(job => job.name.includes("reconcileCustomer"))).toHaveLength(150);
  expect(jobs.filter(job => job.name.includes("sweep"))).toHaveLength(1);
});

test("subscription changes confirm the direct provider read when the subscription list is stale", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const stale = { ...subscriptions[0] };
  provider.subscriptions.iterList.mockImplementation(() => iterate([stale]));

  await alice(t).action(api.billing.polar.changeSubscription, { operation: "cancel" });
  expect(await state(t)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });

  await alice(t).action(api.billing.polar.changeSubscription, { operation: "reactivate" });
  expect(await state(t)).toMatchObject({ status: "active", cancelAtPeriodEnd: false });

  await alice(t).action(api.billing.polar.changeSubscription, { operation: "yearly" });
  expect(await state(t)).toMatchObject({ status: "active", model: "yearly" });
});

test("a canceled subscription requires reactivation before switching plans", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  subscriptions[0].cancel_at_period_end = true;
  await expect(alice(t).action(api.billing.polar.changeSubscription, { operation: "yearly" }))
    .rejects.toThrow("SUBSCRIPTION_REACTIVATION_REQUIRED");
  expect(provider.subscriptions.update).not.toHaveBeenCalled();
});

test("billing distinguishes automatic reconciliation retries from an exhausted failure", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (let attempt = 1; attempt <= 9; attempt++) {
    const lease = (await t.mutation(internal.billing.state.lease, { customerId: "customer-a" }))!;
    await t.mutation(internal.billing.state.finish, { customerId: "customer-a", version: lease.version, failed: true });
    expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
    expect(await alice(t).query(api.billing.account.syncStatus, {})).toEqual({
      failure: "RECONCILIATION_FAILED", retrying: attempt <= 8,
    });
  }
  await reconcile(t);
  expect(await alice(t).query(api.billing.account.syncStatus, {})).toEqual({ failure: null, retrying: false });
});

test("reconciliation failures retain paid access and log provider status without sensitive details", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  provider.subscriptions.get.mockRejectedValueOnce(new PolarClientError(404, { detail: "alice@example.com sensitive provider response" }));
  await reconcile(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
  expect((await alice(t).query(api.billing.account.syncStatus, {})).retrying).toBe(true);
  expect(decisions(logging)).toContainEqual({ decision: "reconciliation", result: "failed",
    code: "BILLING_RECONCILIATION_FAILED", phase: "managed_subscription", providerError: "PolarClientError", providerStatus: 404,
  });
  expect(JSON.stringify(logging.mock.calls)).not.toContain("alice@example.com");
  await reconcile(t);
  expect(await alice(t).query(api.billing.account.syncStatus, {})).toEqual({ failure: null, retrying: false });
});

test("first payment, repeated plan switches, renewal, cancel and uncancel use confirmed owned subscription state", async () => {
  const t = setup(); await provision(t); await link(t);
  await send(t, "subscription.active", { ...sub(), customer }); await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "monthly", subscriptionId: "sub-a" });
  expect(await alice(t).query(api.billing.account.application, {})).toEqual({ name: "Alice" });
  for (const operation of ["yearly", "monthly", "yearly", "cancel", "reactivate", "cancel", "reactivate"] as const) {
    // Space the changes out as a person would, within the per-user limit.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await alice(t).action(api.billing.polar.changeSubscription, { operation });
    if (subscriptions[0].pending_update) {
      // Apply the provider's scheduled product before exercising another cycle.
      subscriptions[0].product_id = subscriptions[0].pending_update.product_id;
      subscriptions[0].pending_update = null;
      subscriptions[0].modified_at = new Date(Date.now() + orders.length + 1).toISOString();
      await reconcile(t);
    }
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

test("monthly upgrades invoice now; yearly downgrades preserve paid time and apply only on renewal", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  await alice(t).action(api.billing.polar.changeSubscription, { operation: "yearly" });
  expect(provider.subscriptions.update).toHaveBeenLastCalledWith("sub-a", { product_id: "yearly", proration_behavior: "invoice" });
  const annualEnd = Date.now() + 365 * 24 * 60 * 60_000;
  subscriptions[0].current_period_end = new Date(annualEnd).toISOString();
  subscriptions[0].modified_at = new Date(Date.now() + 100).toISOString();
  await reconcile(t);
  const paidOrders = orders.length;
  await alice(t).action(api.billing.polar.changeSubscription, { operation: "monthly" });
  expect(provider.subscriptions.update).toHaveBeenLastCalledWith("sub-a", { product_id: "monthly", proration_behavior: "next_period" });
  expect(orders).toHaveLength(paidOrders);
  expect(await alice(t).query(api.billing.account.status, {})).toMatchObject({
    state: "active", model: "yearly", paidThrough: annualEnd,
    scheduledChange: { model: "monthly", at: annualEnd },
  });
  vi.useFakeTimers(); vi.setSystemTime(annualEnd + 1);
  subscriptions[0] = { ...sub("monthly"), current_period_start: new Date(annualEnd).toISOString(),
    current_period_end: new Date(annualEnd + 30 * 24 * 60 * 60_000).toISOString() };
  orders.push({ ...order("monthly", "monthly-renewal"), created_at: new Date(annualEnd + 1).toISOString() });
  await reconcile(t);
  expect(await alice(t).query(api.billing.account.status, {})).toMatchObject({
    state: "active", model: "monthly", scheduledChange: null,
  });
});

test("a signed success/order-created payload without paid provider state cannot grant access", async () => {
  const t = setup(); await provision(t); orders[0].paid = false; orders[0].status = "pending";
  expect((await send(t, "order.created", { ...orders[0], customer })).status).toBe(200);
  await reconcile(t);
  expect((await state(t))?.status).not.toBe("active");
  await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
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
    expect((await alice(t).query(api.billing.account.status, {})).lifetimePurchasedAt).toBe(Date.parse(lifetime.created_at));
    for (const event of ["subscription.active", "subscription.canceled", "subscription.uncanceled", "subscription.revoked", "order.paid"]) {
      if (subscriptions[0]) { subscriptions[0].status = event === "subscription.revoked" ? "canceled" : "active"; subscriptions[0].product_id = "yearly"; }
      orders.push({ ...order("yearly", `old-${event}`), billing_reason: "subscription_update" });
      await send(t, event, { id: "late", customer_id: customer.id, customer }, `late-${event}`); await reconcile(t);
      expect((await state(t))?.model).toBe("lifetime");
      expect((await alice(t).query(api.billing.account.status, {})).lifetimePurchasedAt).toBe(Date.parse(lifetime.created_at));
    }
    orders.push({ ...order("lifetime", "lifetime-second", null), created_at: new Date(Date.now() + 1).toISOString() });
    lifetime.refunded_amount = lifetime.net_amount; lifetime.modified_at = new Date(Date.now() + 100).toISOString();
    await send(t, "order.refunded", { ...lifetime, customer }); await reconcile(t);
    expect((await state(t))?.lifetimeOrderId).toBe("lifetime-second");
    expect((await alice(t).query(api.billing.account.status, {})).lifetimePurchasedAt).toBe(Date.parse(orders.at(-1)!.created_at));
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
  expect((await alice(t).query(api.billing.account.status, {})).lifetimePurchasedAt).toBeNull();
  expect((await state(t))?.subscriptionId).toBeUndefined();
  await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
  expect(await alice(t).action(api.billing.polar.portal, { returnUrl: "/billing" })).toContain("portal");
});

test("full current recurring refund revokes provider billing durably and failed cleanup stays retryable", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  orders[0].refunded_amount = 1000; orders[0].modified_at = new Date(Date.now() + 10).toISOString();
  provider.subscriptions.revoke.mockRejectedValueOnce(new Error("provider unavailable"));
  await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
  expect(await sync(t)).toMatchObject({ failureCode: "RECONCILIATION_FAILED", attempts: 1 });
  await reconcile(t);
  expect(provider.subscriptions.revoke).toHaveBeenCalledWith("sub-a");
  await reconcile(t);
  expect((await sync(t))?.failureCode).toBeUndefined();
  expect(subscriptions[0].status).toBe("canceled");
});

test("expiry works without webhooks and past-due payments do not grant indefinite grace", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const account = (await state(t))!;
  await t.run(ctx => ctx.db.patch("billingAccounts", account._id, { paidThrough: Date.now() - 1 }));
  await t.mutation(internal.billing.state.expire, { accountId: account._id, revision: account.revision });
  await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
  subscriptions[0].status = "past_due"; await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
});

test("customers and paid events before signup claim only stable external identity, never email", async () => {
  const t = setup(); await link(t); await reconcile(t);
  expect((await state(t))?.userId).toBeUndefined();
  await provision(t, "https://clerk.example|bob");
  const bob = t.withIdentity({ tokenIdentifier: "https://clerk.example|bob", subject: "bob" });
  expect((await bob.query(api.billing.account.status, {})).state).toBe("awaiting_payment");
  await expect(bob.action(api.billing.polar.recover, {})).rejects.toThrow("CUSTOMER_IDENTITY_CONFLICT");
  await provision(t); await reconcile(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
});

test("missing external IDs remain unclaimed until provider association is repaired", async () => {
  const t = setup(); await provision(t); customer.external_id = null;
  await send(t, "customer.created", customer); await reconcile(t);
  expect((await state(t))?.userId).toBeUndefined();
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("awaiting_payment");
  customer.external_id = externalId;
  await send(t, "customer.updated", customer); await reconcile(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
});

test("checkout accepts unpaid owners, validates products and return URLs, and portal works after expiry", async () => {
  const t = setup(); await provision(t); subscriptions = []; orders = [];
  for (const url of ["https://evil.example/billing", "//evil.example/billing", "/app", "\\evil", "/billing\n"]) {
    expect(() => billingReturnUrl(url)).toThrow();
  }
  await expect(alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "https://evil.example/billing" })).rejects.toThrow("INVALID_RETURN_URL");
  expect(await alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" })).toContain("checkout");
  expect(provider.checkouts.create).toHaveBeenCalledWith(expect.objectContaining({ products: ["monthly"], customer_id: "customer-a", allow_trial: false,
    allow_discount_codes: true,
    customer_name: "Alice", success_url: "http://127.0.0.1:3000/billing?confirmation=monthly" }));
  provider.checkouts.list.mockResolvedValue({ items: [{ status: "open", expires_at: new Date(end).toISOString(), url: "https://sandbox.polar.sh/recovered", metadata: { worktree_id: "wt-test" } }] });
  expect(await alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" })).toContain("recovered");
  expect(provider.checkouts.create).toHaveBeenCalledTimes(1);
  provider.products.get.mockResolvedValueOnce({ is_archived: true, prices: [] });
  await expect(alice(t).action(api.billing.polar.checkout, { model: "yearly", returnUrl: "/billing" })).rejects.toThrow("BILLING_CONFIGURATION_REQUIRED");
  expect(await alice(t).action(api.billing.polar.portal, { returnUrl: "/billing" })).toContain("portal");
});

test("sandbox checkout and recovery can create isolated customers when the sign-in email is already used", async () => {
  subscriptions = []; orders = []; customerExists = false;
  provider.customers.create.mockImplementation(async (body: { email: string }) => {
    if (body.email === "alice@example.com") {
      throw new PolarClientError(422, { detail: [{ loc: ["body", "email"], msg: "Email already exists" }] });
    }
    return customer;
  });

  for (const operation of ["checkout", "recover"] as const) {
    const t = setup(); await provision(t);
    if (operation === "checkout") {
      expect(await alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" })).toContain("checkout");
    } else {
      await alice(t).action(api.billing.polar.recover, {});
    }
    expect((await alice(t).query(api.billing.account.status, {})).state).toBe("awaiting_payment");
    expect(provider.customers.create).toHaveBeenLastCalledWith({
      email: "alice+wt-test@example.com", external_id: externalId, metadata: { worktree_id: "wt-test" },
    });
    expect((await state(t))?.externalId).toBe(externalId);
  }
});

test("separate sandbox worktrees use distinct emails for the same sign-in identity", async () => {
  subscriptions = []; orders = [];

  for (const worktree of ["wt-test", "wt-other"]) {
    vi.stubEnv("WORKTREE_ID", worktree);
    customer = { id: "customer-a", external_id: `${worktree}:${tokenIdentifier}`, metadata: { worktree_id: worktree } };
    customerExists = false;
    const t = setup(); await provision(t);
    await alice(t).action(api.billing.polar.recover, {});
    expect(provider.customers.create).toHaveBeenLastCalledWith({
      email: `alice+${worktree}@example.com`, external_id: customer.external_id, metadata: customer.metadata,
    });
    expect((await state(t))?.userId).toBeDefined();
  }
});

test("production customer creation preserves the sign-in email", async () => {
  vi.stubEnv("POLAR_ENVIRONMENT", "production");
  subscriptions = []; orders = []; customerExists = false;
  const t = setup(); await provision(t);
  await alice(t).action(api.billing.polar.recover, {});
  expect(provider.customers.create).toHaveBeenCalledWith({
    email: "alice@example.com", external_id: externalId, metadata: { worktree_id: "wt-test" },
  });
});

test("an ambiguous customer create is recovered by external identity", async () => {
  subscriptions = []; orders = []; customerExists = false;
  provider.customers.create.mockImplementationOnce(async () => {
    customerExists = true;
    throw new PolarNetworkError("response lost");
  });
  const t = setup(); await provision(t);
  await alice(t).action(api.billing.polar.recover, {});
  expect(provider.customers.list).toHaveBeenLastCalledWith({ query: externalId, limit: 10 });
  expect((await state(t))?.userId).toBeDefined();
});

// Imports such as a migration with --replace-all leave the Polar customer
// without its billingAccounts row, so these actions must find it again.
test.each(["checkout", "changeSubscription", "recover"] as const)("%s finds and links an existing customer whose billing account row is gone", async operation => {
  if (operation === "checkout") { subscriptions = []; orders = []; }
  const t = setup(); await provision(t);
  if (operation === "checkout") {
    expect(await alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" })).toContain("checkout");
    expect(provider.checkouts.create).toHaveBeenCalledWith(expect.objectContaining({ customer_id: "customer-a" }));
  } else if (operation === "changeSubscription") {
    await alice(t).action(api.billing.polar.changeSubscription, { operation: "cancel" });
    expect(subscriptions[0].cancel_at_period_end).toBe(true);
  } else {
    await alice(t).action(api.billing.polar.recover, {});
    expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
  }
  expect(provider.customers.create).not.toHaveBeenCalled();
  expect(await state(t)).toMatchObject({ customerId: "customer-a", externalId, userId: expect.anything() });
});

test("a customer search ignores near matches with a different external ID", async () => {
  subscriptions = []; orders = []; customerExists = false;
  otherCustomers = [{ id: "customer-near", external_id: `${externalId}2`, metadata: { worktree_id: "wt-test" } }];
  // Account deletion finds no customer and leaves the near match alone.
  const deleting = setup(); const userId = await provision(deleting);
  await deleting.run(ctx => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
  expect(await deleting.action(internal.billing.polar.cleanupAccount, { userId })).toEqual({ complete: true });
  expect(provider.subscriptions.list).not.toHaveBeenCalled();
  expect(provider.customers.delete).not.toHaveBeenCalled();

  // Recovery creates the user's own customer instead of linking the near match.
  const t = setup(); await provision(t);
  await alice(t).action(api.billing.polar.recover, {});
  expect(provider.customers.create).toHaveBeenCalledTimes(1);
  expect(await state(t)).toMatchObject({ customerId: "customer-a", externalId });
  expect(await t.run(ctx => ctx.db.query("billingAccounts").take(10))).toHaveLength(1);
});

test("a customer search fails rather than guess between duplicates or past a truncated page", async () => {
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  const near = (n: number) => ({ id: `customer-near-${n}`, external_id: `${externalId}${n}`, metadata: { worktree_id: "wt-test" } });
  const cases = [
    { others: [{ ...customer, id: "customer-duplicate" }], error: "Several customers share one external ID" },
    { others: Array.from({ length: 11 }, (_, n) => near(n)), error: "Customer search results truncated" },
  ];
  for (const { others, error } of cases) {
    // Truncation only matters when the exact match could be on a later page.
    customerExists = others.length === 1;
    otherCustomers = others;
    const t = setup(); const userId = await provision(t);
    await expect(alice(t).action(api.billing.polar.recover, {})).rejects.toThrow("BILLING_REQUEST_FAILED");
    await t.run(ctx => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
    await expect(t.action(internal.billing.polar.cleanupAccount, { userId })).rejects.toThrow(error);
  }
  expect(decisions(logging)).toContainEqual({ decision: "customer_search", result: "duplicates", matches: 2 });
  expect(decisions(logging)).toContainEqual({ decision: "customer_search", result: "truncated", total: 11 });
  expect(provider.customers.create).not.toHaveBeenCalled();
  expect(provider.customers.delete).not.toHaveBeenCalled();
});

test("failed customer creation retains the provider failure without logging email or credentials", async () => {
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  const validation = new PolarClientError(422, { detail: [{ loc: ["body", "email"], input: "alice@example.com" }] });
  customerExists = false;
  provider.customers.create.mockRejectedValueOnce(validation);
  const t = setup(); await provision(t);
  await expect(alice(t).action(api.billing.polar.recover, {})).rejects.toThrow("BILLING_REQUEST_FAILED");
  expect(decisions(logging)).toContainEqual({ decision: "provider", result: "failed",
    code: "BILLING_REQUEST_FAILED", providerError: validation.name, providerStatus: 422,
  });
  expect(JSON.stringify(logging.mock.calls)).not.toContain("alice@example.com");
  expect(await state(t)).toBeNull();
});

test("a superseded reconciliation cannot publish stale state and account deletion exposes retryable cleanup", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  const lease = (await t.mutation(internal.billing.state.lease, { customerId: "customer-a" }))!;
  await link(t);
  expect(await t.mutation(internal.billing.state.apply, { version: lease.version,
    snapshot: { customerId: "customer-a", externalId, subscriptions: [], orders: [] } })).toEqual([]);
  expect((await state(t))?.status).toBe("active");
  await t.mutation(internal.billing.state.finish, { customerId: "customer-a", version: lease.version, failed: false });
  await t.run(ctx => ctx.db.patch("users", userId, { lifecycle: "deletion_requested" }));
  expect(await t.action(internal.billing.polar.cleanupAccount, { userId })).toMatchObject({ complete: false });
  expect(await t.action(internal.billing.polar.cleanupAccount, { userId })).toEqual({ complete: true });
  await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("ACCOUNT_UNAVAILABLE");
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

test("pending commands serialize simultaneous checkout and subscription requests, then recover", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const lease = await alice(t).mutation(internal.billing.state.beginOperation, {});
  await expect(alice(t).action(api.billing.polar.checkout, { model: "lifetime", returnUrl: "/billing" })).rejects.toThrow("BILLING_OPERATION_PENDING");
  expect(provider.checkouts.create).not.toHaveBeenCalled();
  await alice(t).mutation(internal.billing.state.endOperation, { lease });
  expect(await alice(t).action(api.billing.polar.checkout, { model: "lifetime", returnUrl: "/billing" })).toContain("checkout");
});

test("revocation commands keep provider failures visible and ownership is enforced before scheduling", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  await expect(t.action(internal.billing.polar.revoke, { userId, subscriptionId: "someone-else" })).rejects.toThrow("ownership");
  provider.subscriptions.revoke.mockRejectedValueOnce(new Error("provider outage"));
  await t.action(internal.billing.polar.revoke, { userId, subscriptionId: "sub-a" });
  expect((await state(t))?.status).toBe("ended");
  expect((await sync(t))?.failureCode).toBe("RECONCILIATION_FAILED");
  await reconcile(t); await reconcile(t);
  expect(subscriptions[0].status).toBe("canceled");
  expect((await sync(t))?.failureCode).toBeUndefined();
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
  expect(await t.action(internal.billing.polar.cleanupAccount, { userId })).toMatchObject({ complete: false });
  expect(provider.subscriptions.revoke).toHaveBeenCalledWith("sub-a");
  expect(await t.action(internal.billing.polar.cleanupAccount, { userId })).toEqual({ complete: true });
  expect(provider.customers.delete).toHaveBeenCalledWith("customer-a", { anonymize: true });
});

test("an expired reconciliation worker cannot release its replacement's lease", async () => {
  const t = setup(); await link(t);
  const first = (await t.mutation(internal.billing.state.lease, { customerId: "customer-a" }))!;
  vi.advanceTimersByTime(120_001);
  // Avoid draining scheduled jobs: acquire the next transaction directly.
  const next = (await t.mutation(internal.billing.state.lease, { customerId: "customer-a" }))!;
  await t.mutation(internal.billing.state.finish, { customerId: "customer-a", version: first.version, failed: true });
  expect((await sync(t))?.leaseVersion).toBe(next.version);
  expect((await sync(t))?.leaseUntil).toBeGreaterThan(Date.now());
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

test.each([
  ["covered by a 100% discount code", 5000, 0],
  ["half covered by a discount code", 2500, 2500],
])("a lifetime order %s grants lifetime Pro", async (_, discount, net) => {
  const t = setup(); await provision(t); await link(t);
  subscriptions = [];
  orders = [{ ...order("lifetime", "lifetime", null), billing_reason: "purchase",
    subtotal_amount: 5000, discount_amount: discount, net_amount: net }];
  await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "lifetime", lifetimeOrderId: "lifetime" });
});

test.each([
  ["a 100% forever code", 1000, 0, { type: "percentage", basis_points: 10000, duration: "forever" }],
  ["a 100% one-time code", 1000, 0, { type: "percentage", basis_points: 10000, duration: "once" }],
  ["a 50% forever code", 500, 500, { type: "percentage", basis_points: 5000, duration: "forever" }],
])("a subscription bought at checkout with %s grants Pro through its period end", async (_, discount, net, code) => {
  const t = setup(); await provision(t); await link(t);
  subscriptions = [{ ...sub("monthly"), discount: code }];
  orders = [{ ...order("monthly"), discount_amount: discount, net_amount: net }];
  await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "monthly", subscriptionId: "sub-a", paidThrough: end });
});

test("an unpaid order with a discount grants nothing", async () => {
  const t = setup(); await provision(t); await link(t);
  subscriptions = [];
  orders = [{ ...order("lifetime", "lifetime", null), billing_reason: "purchase", paid: false, status: "pending",
    subtotal_amount: 5000, discount_amount: 2500, net_amount: 2500 }];
  await reconcile(t);
  expect((await state(t))?.status).not.toBe("active");
});

test("a lifetime order whose refund Polar reverses grants access again", async () => {
  const t = setup(); await provision(t); await link(t);
  subscriptions = [];
  const lifetime = { ...order("lifetime", "lifetime", null), billing_reason: "purchase" };
  orders = [lifetime];
  await reconcile(t);
  Object.assign(lifetime, { status: "refunded", refunded_amount: 1000, modified_at: new Date(Date.now() + 10).toISOString() });
  await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
  Object.assign(lifetime, { status: "paid", refunded_amount: 0, modified_at: new Date(Date.now() + 20).toISOString() });
  await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "lifetime", lifetimeOrderId: "lifetime" });
});

const fullForever: Discount = { type: "percentage", basis_points: 10000, duration: "forever" };
// A subscriber who started monthly with a discount code and then switched to
// yearly at no cost, so no order in the current period carries money or a discount.
function discountedYearly(discount: Discount | null) {
  subscriptions = [{ ...sub("yearly"), discount }];
  orders = [
    { ...order("monthly", "create"), created_at: new Date(start - 30 * 24 * 60 * 60_000).toISOString(),
      subtotal_amount: 500, discount_amount: 500, net_amount: 0 },
    { ...order("yearly", "switch"), billing_reason: "subscription_update",
      subtotal_amount: 0, discount_amount: 0, net_amount: 0 },
  ];
}

test("a subscription with a 100% forever discount grants Pro through its period end", async () => {
  const t = setup(); await provision(t); await link(t);
  discountedYearly(fullForever);
  await reconcile(t);
  expect(await state(t)).toMatchObject({ status: "active", model: "yearly", subscriptionId: "sub-a", paidThrough: end });
});

test.each([
  ["no discount", null],
  ["a 50% forever discount", { ...fullForever, basis_points: 5000 }],
  ["a 100% one-time discount", { ...fullForever, duration: "once" }],
  ["a forever fixed discount equal to the price", { type: "fixed", amount: 1000, duration: "forever" }],
])("a zero-cost switch on a subscription with %s grants no paid time", async (_, discount) => {
  const t = setup(); await provision(t); await link(t);
  discountedYearly(discount);
  await reconcile(t);
  expect((await state(t))?.status).not.toBe("active");
});

test("an invalid unclaimed external identity can be repaired; a claimed customer's identity cannot change", async () => {
  const t = setup(); await provision(t);
  customer.external_id = "invalid-legacy-id";
  await send(t, "customer.created", customer); await reconcile(t);
  expect((await state(t))?.userId).toBeUndefined();
  expect((await sync(t))?.failureCode).toBe("CUSTOMER_LINK_REQUIRED");
  customer.external_id = externalId;
  expect((await send(t, "customer.updated", customer, "repaired")).status).toBe(200);
  await reconcile(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
  customer.external_id = "wt-test:https://clerk.example|bob";
  expect((await send(t, "customer.updated", customer, "different-owner")).status).toBe(503);
  expect((await state(t))?.externalId).toBe(externalId);
});

test("repeated reconciliation of abandoned checkout remains awaiting payment until a confirmed purchase", async () => {
  const t = setup(); await provision(t); await link(t);
  subscriptions = []; orders = [];
  await reconcile(t); await reconcile(t); await reconcile(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("awaiting_payment");
  orders = [order("lifetime", "first-paid", null)]; await reconcile(t);
  expect((await alice(t).query(api.billing.account.status, {})).state).toBe("active");
});

async function deletionRequest(t: ReturnType<typeof setup>) {
  const [request] = await t.query(internal.account.lifecycle.pending, {});
  return request;
}
test.each(["monthly", "yearly"])("%s deletion cancels renewal without revocation, preserves paid time, and recovery does not uncancel billing", async model => {
  subscriptions = [sub(model)]; orders = [order(model)];
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t);
  expect(request.deleteAfter! - request.requestedAt).toBe(7 * 24 * 60 * 60_000);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(subscriptions[0].cancel_at_period_end).toBe(true);
  expect(provider.subscriptions.revoke).not.toHaveBeenCalled();
  expect(await state(t)).toMatchObject({ status: "active", cancelAtPeriodEnd: true, paidThrough: end });
  await expect(alice(t).query(api.billing.account.application, {})).resolves.toBeDefined();
  await expect(alice(t).action(api.billing.polar.changeSubscription, { operation: "reactivate" })).rejects.toThrow("DELETION_PENDING");
  await alice(t).mutation(api.account.lifecycle.recover, {});
  expect(subscriptions[0].cancel_at_period_end).toBe(true);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(provider.subscriptions.revoke).not.toHaveBeenCalled();
  await alice(t).action(api.billing.polar.changeSubscription, { operation: "reactivate" });
  expect(subscriptions[0].cancel_at_period_end).toBe(false);
});

test("seven day deadline commits deletion, confirms revocation before identity removal and erases PII", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  vi.stubEnv("CLERK_SECRET_KEY", "test-key");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  vi.setSystemTime(request.deleteAfter!);
  await expect(alice(t).mutation(api.account.lifecycle.recover, {})).rejects.toThrow("RECOVERY_UNAVAILABLE");
  // First pass revokes; a subsequent provider snapshot proves it ended.
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(provider.subscriptions.revoke).toHaveBeenCalledWith("sub-a");
  expect(fetchSpy).not.toHaveBeenCalled();
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  // Deleting the Polar customer frees its email for a new sign-up.
  expect(provider.customers.delete).toHaveBeenCalledWith("customer-a", { anonymize: true });
  expect(fetchSpy).toHaveBeenCalledWith("https://api.clerk.com/v1/users/alice", expect.objectContaining({ method: "DELETE" }));
  const user = await t.run(ctx => ctx.db.get("users", userId));
  expect((await alice(t).query(api.billing.account.status, {})).readiness).toBe("deleting");
  expect(user?.lifecycle).toBe("deleted"); expect(user?.email).toBeUndefined(); expect(user?.displayName).toBeUndefined(); expect(user?.firstName).toBeUndefined();
  expect((await t.query(internal.account.lifecycle.context, { requestId: request._id }))?.status).toBe("completed");
  expect(await t.run(ctx => ctx.db.query("billingOrders").take(10))).toEqual([]);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  // Delayed events for the deleted customer cannot resurrect entitlement,
  // restore erased history, or leave a reconciliation retrying.
  await link(t); await reconcile(t);
  expect((await state(t))?.status).toBe("ended");
  expect(await t.run(ctx => ctx.db.query("billingOrders").take(10))).toEqual([]);
  expect((await sync(t))?.failureCode).toBeUndefined();
});

test("a lost customer deletion response is retried as already deleted and still finishes erasure", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  vi.stubEnv("CLERK_SECRET_KEY", "test-key");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  subscriptions[0].status = "canceled";
  provider.customers.delete.mockImplementationOnce(async () => { customerDeleted = true; throw new Error("response lost"); });
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t); vi.setSystemTime(request.deleteAfter!);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(fetchSpy).not.toHaveBeenCalled();
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(provider.customers.delete).toHaveBeenCalledTimes(1);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect((await t.run(ctx => ctx.db.get("users", userId)))?.lifecycle).toBe("deleted");
});

test("provider failures retry without falsely confirming cancellation or completing deletion", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t);
  provider.subscriptions.update.mockRejectedValueOnce(new Error("provider unavailable"));
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(await alice(t).query(api.account.lifecycle.current, {})).toMatchObject({ failure: true, cancellationConfirmed: false, finalizing: false });
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(await alice(t).query(api.account.lifecycle.current, {})).toMatchObject({ failure: false, cancellationConfirmed: true });
  expect(provider.subscriptions.revoke).not.toHaveBeenCalled();
});

test("Clerk deletion supersedes the recovery window and never deletes the already-gone identity", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t);
  expect(await t.mutation(internal.account.lifecycle.requestClerkDeletion, { clerkId: "alice", eventAt: Date.now(), deliveryId: "gone" })).toBe(request._id);
  await expect(alice(t).mutation(api.account.lifecycle.recover, {})).rejects.toThrow("RECOVERY_UNAVAILABLE");
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(fetchSpy).not.toHaveBeenCalled();
  expect((await t.query(internal.account.lifecycle.context, { requestId: request._id }))?.status).toBe("completed");
});

test("expired, refunded and revoked recovery never grants paid access; lifetime closes only after the window", async () => {
  for (const model of ["awaiting", "expired", "refunded", "revoked", "cancelled", "lifetime"] as const) {
    const t = setup(); await provision(t); await link(t); customerDeleted = false;
    subscriptions = model === "awaiting" || model === "lifetime" ? [] : [sub("monthly", model === "cancelled")];
    orders = model === "awaiting" ? [] : [order(model === "lifetime" ? "lifetime" : "monthly", "order-a", model === "lifetime" ? null : "sub-a")];
    if (model === "refunded") { orders[0].status = "refunded"; orders[0].refunded_amount = 1000; }
    if (model === "revoked") subscriptions[0].status = "canceled";
    if (model === "expired") subscriptions[0].current_period_end = new Date(Date.now() - 1).toISOString();
    await reconcile(t);
    await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
    let request = await deletionRequest(t);
    await t.action(internal.account.lifecycle.process, { requestId: request._id });
    await alice(t).mutation(api.account.lifecycle.recover, {});
    const entitled = model === "cancelled" || model === "lifetime";
    expect((await state(t))?.status === "active").toBe(entitled);
    if (!entitled) await expect(alice(t).query(api.billing.account.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
    request = await deletionRequest(t);
    vi.stubEnv("CLERK_SECRET_KEY", "key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    vi.setSystemTime(request.deleteAfter!);
    for (let i = 0; i < 3; i++) await t.action(internal.account.lifecycle.process, { requestId: request._id });
    expect((await t.query(internal.account.lifecycle.context, { requestId: request._id }))?.status).toBe("completed");
  }
});

test("another owner cannot see, recover, or supply someone else's deletion id; leases prevent cancellation races", async () => {
  const t = setup(); await provision(t); await provision(t, "https://clerk.example|bob");
  const bob = t.withIdentity({ tokenIdentifier: "https://clerk.example|bob" });
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  expect(await bob.query(api.account.lifecycle.current, {})).toBeNull();
  await expect(bob.mutation(api.account.lifecycle.recover, {})).rejects.toThrow("RECOVERY_UNAVAILABLE");
  const request = await deletionRequest(t);
  await expect(bob.mutation(api.account.lifecycle.recover, { requestId: request._id } as never)).rejects.toThrow();
  const claim = await t.mutation(internal.account.lifecycle.claim, { requestId: request._id });
  expect(await t.mutation(internal.account.lifecycle.claim, { requestId: request._id })).toBeNull();
  await expect(alice(t).mutation(api.account.lifecycle.recover, {})).rejects.toThrow("ACCOUNT_OPERATION_PENDING");
  await t.mutation(internal.account.lifecycle.finishAttempt, { requestId: request._id, lease: claim!.lease, success: true, finalizing: false });
  await alice(t).mutation(api.account.lifecycle.recover, {});
  expect(await t.mutation(internal.account.lifecycle.claim, { requestId: request._id })).toBeNull();
});

test("display names validate and survive Clerk updates while email still synchronizes", async () => {
  const t = setup(); const userId = await provision(t);
  await alice(t).mutation(api.account.profile.save, { displayName: "  New name  " });
  expect(await t.run(ctx => ctx.db.get("users", userId))).toMatchObject({ displayName: "New name", profileEdited: true });
  for (const invalid of ["a".repeat(101), "bad\u0000name"]) await expect(alice(t).mutation(api.account.profile.save, { displayName: invalid })).rejects.toThrow("INVALID_NAME");
  await t.mutation(internal.account.users.syncProfile, { profile: { clerkId: "alice", email: "new@example.com", firstName: "Old Clerk name", lastName: "Surname", updatedAt: 100 }, eventAt: 100 });
  const user = await t.run(ctx => ctx.db.get("users", userId));
  expect(user?.email).toBe("new@example.com"); expect(user?.displayName).toBe("New name");
  const bobId = await provision(t, "https://clerk.example|bob");
  expect((await t.run(ctx => ctx.db.get("users", bobId)))?.displayName).toBe("Alice");
  await expect(t.mutation(api.account.profile.save, { displayName: "X" })).rejects.toThrow("UNAUTHENTICATED");
  await alice(t).mutation(api.account.profile.save, { displayName: "  " });
  await t.mutation(internal.account.users.syncProfile, { profile: { clerkId: "alice", email: "new@example.com", firstName: "Provider name", updatedAt: 200 }, eventAt: 200 });
  expect((await t.run(ctx => ctx.db.get("users", userId)))?.displayName).toBeUndefined();
});

test("identity cleanup failure retains PII and billing links until retry succeeds, without repeated revocation", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  vi.stubEnv("CLERK_SECRET_KEY", "test-key");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(new Response(null, { status: 404 }));
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t); vi.setSystemTime(request.deleteAfter!);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(await t.run(ctx => ctx.db.get("users", userId))).toMatchObject({ lifecycle: "deletion_requested", email: "alice@example.com" });
  expect(await state(t)).not.toBeNull();
  expect((await t.query(internal.account.lifecycle.context, { requestId: request._id }))?.status).toBe("pending");
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(provider.subscriptions.revoke).toHaveBeenCalledTimes(1);
  expect((await t.query(internal.account.lifecycle.context, { requestId: request._id }))?.status).toBe("completed");
});

test("a missing local owner gets a nonrecoverable Clerk tombstone; stalled leases can be reclaimed", async () => {
  const t = setup();
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example");
  const id = await t.mutation(internal.account.lifecycle.requestClerkDeletion, { clerkId: "alice", eventAt: Date.now(), deliveryId: "gone" });
  expect(await t.query(internal.account.users.lookupCurrent, { tokenIdentifier })).toEqual({ status: "deleting" });
  const first = await t.mutation(internal.account.lifecycle.claim, { requestId: id });
  vi.setSystemTime(first!.lease + 1);
  const second = await t.mutation(internal.account.lifecycle.claim, { requestId: id });
  expect(second?.lease).toBeGreaterThan(first!.lease);
  await t.mutation(internal.account.lifecycle.finishAttempt, { requestId: id, lease: first!.lease, success: true, finalizing: true });
  expect((await t.query(internal.account.lifecycle.context, { requestId: id }))?.leaseUntil).toBe(second!.lease);
});

test("batched erasure survives reconciliation without refilling history or repeating identity deletion", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  vi.stubEnv("CLERK_SECRET_KEY", "key");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  await t.run(async ctx => {
    for (let i = 0; i < 205; i++) await ctx.db.insert("billingOrders", { customerId: "customer-a", orderId: `history-${i}`, productId: "monthly", paid: true, fullyRefunded: false, createdAt: start - 100, modifiedAt: start - 100 });
  });
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t); vi.setSystemTime(request.deleteAfter!);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  const progress = await t.query(internal.account.lifecycle.context, { requestId: request._id });
  expect(progress).toMatchObject({ erasing: true, attempts: 0, leaseUntil: 0, nextAttemptAt: Date.now() });
  expect(progress?.failureCode).toBeUndefined();
  const remaining = await t.run(ctx => ctx.db.query("billingOrders").take(1000));
  await reconcile(t);
  expect(await t.run(ctx => ctx.db.query("billingOrders").take(1000))).toHaveLength(remaining.length);
  await t.action(internal.account.lifecycle.process, { requestId: request._id });
  const next = await t.query(internal.account.lifecycle.context, { requestId: request._id });
  expect(next).toMatchObject({ attempts: 0, leaseUntil: 0, nextAttemptAt: Date.now() });
  expect(next?.failureCode).toBeUndefined();
  for (let i = 0; i < 2; i++) await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect((await t.run(ctx => ctx.db.get("users", userId)))?.lifecycle).toBe("deleted");
  expect(await t.run(ctx => ctx.db.query("billingOrders").take(10))).toEqual([]);
});

test("deletion cancels and revokes every subscription across provider pages despite oversized cached history", async () => {
  const t = setup(); const userId = await provision(t); await link(t); await reconcile(t);
  subscriptions = Array.from({ length: 105 }, (_, i) => ({ ...sub(), id: `sub-${i}` }));
  await t.run(async ctx => {
    for (const s of subscriptions) await ctx.db.insert("billingSubscriptions", { customerId: customer.id, subscriptionId: s.id,
      productId: s.product_id, superseded: false, status: s.status, paidThrough: end, cancelAtPeriodEnd: false, modifiedAt: start, periodStart: start });
  });
  await alice(t).mutation(api.account.lifecycle.requestDeletion, {});
  const request = await deletionRequest(t);
  for (let i = 0; i < 11; i++) await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(subscriptions.every(s => s.cancel_at_period_end)).toBe(true);
  expect(provider.subscriptions.revoke).not.toHaveBeenCalled();
  expect(await alice(t).query(api.account.lifecycle.current, {})).toMatchObject({ cancellationConfirmed: true, failure: false });
  expect((await state(t))?.paidThrough).toBe(end);
  vi.stubEnv("CLERK_SECRET_KEY", "key");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  vi.setSystemTime(request.deleteAfter!);
  for (let i = 0; i < 11; i++) await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(subscriptions.every(s => s.status === "canceled")).toBe(true);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect((await t.query(internal.account.lifecycle.context, { requestId: request._id }))?.failureCode).toBeUndefined();
  for (let i = 0; i < 3; i++) await t.action(internal.account.lifecycle.process, { requestId: request._id });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect((await t.run(ctx => ctx.db.get("users", userId)))?.lifecycle).toBe("deleted");
  expect(await t.run(ctx => ctx.db.query("billingSubscriptions").take(200))).toEqual([]);
});

test("external customer IDs resolve to an owner only within this worktree", () => {
  expect(externalCustomerId(tokenIdentifier)).toBe(externalId);
  expect(externalIdTokenIdentifier(externalId)).toBe(tokenIdentifier);
  expect(externalIdTokenIdentifier(`wt-other:${tokenIdentifier}`)).toBeNull();
  expect(externalIdTokenIdentifier(`wt-test-2:${tokenIdentifier}`)).toBeNull();
  expect(externalIdTokenIdentifier(undefined)).toBeNull();
});

const providerCalls = () => Object.values(provider).flatMap(Object.values)
  .reduce((total, mock: { mock: { calls: unknown[] } }) => total + mock.mock.calls.length, 0);

test("a user calling recover in a loop is rejected after a small burst, without provider requests", async () => {
  const t = setup(); await provision(t); await link(t); await reconcile(t);
  for (let call = 0; call < 5; call++) await alice(t).action(api.billing.polar.recover, {});
  vi.clearAllMocks();

  const rejected = await alice(t).action(api.billing.polar.recover, {}).catch((error: unknown) => error);

  expect(retryAfter(rejected)).toBeGreaterThan(0);
  expect(providerCalls()).toBe(0);
  vi.setSystemTime(Date.now() + retryAfter(rejected)!);
  await alice(t).action(api.billing.polar.recover, {});
  expect(provider.customers.get).toHaveBeenCalled();
});

test.each([
  ["checkout", (t: ReturnType<typeof setup>) => alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" })],
  ["changeSubscription", (t: ReturnType<typeof setup>) => alice(t).action(api.billing.polar.changeSubscription, { operation: "cancel" })],
] as const)("%s takes the operation lease before any provider request", async (name, call) => {
  const t = setup(); await provision(t);
  if (name === "changeSubscription") { await link(t); await reconcile(t); }
  await alice(t).mutation(internal.billing.state.beginOperation, {});
  vi.clearAllMocks();

  await expect(call(t)).rejects.toThrow("BILLING_OPERATION_PENDING");
  expect(providerCalls()).toBe(0);
});

test("user actions leave half of the Polar budget to reconciliation and refunds", async () => {
  const t = setup(); await provision(t); await link(t);
  // Sandbox allows 80 requests a minute. Internal work leaves 41, under the 2
  // a recovery needs plus the 40 kept for internal work.
  await reconcile(t);
  await t.mutation(internal.rateLimits.spendPolar, { requests: 35 });
  vi.clearAllMocks();

  const rejected = await alice(t).action(api.billing.polar.recover, {}).catch((error: unknown) => error);
  expect(retryAfter(rejected)).toBeGreaterThan(0);
  expect(providerCalls()).toBe(0);

  // Internal work is counted but never refused.
  await link(t); await reconcile(t);
  expect(provider.customers.get).toHaveBeenCalled();

  vi.setSystemTime(Date.now() + 60_000);
  await alice(t).action(api.billing.polar.recover, {});
});

// scripts/billing-test-fixtures.mjs publishes made-up customers that Polar
// doesn't have. Their failed reconciliations and retries used up the shared
// Polar budget until E2E checkouts were rate limited.
test("sandbox fixture customers skip reconciliation and leave the Polar budget to checkout", async () => {
  const t = setup(); await provision(t);
  subscriptions = []; orders = [];
  for (let i = 0; i < 30; i++) {
    await t.mutation(internal.billing.state.enqueue, { customerId: `fixture-wt-test-user_${i}` });
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(providerCalls()).toBe(0);

  await expect(alice(t).action(api.billing.polar.checkout, { model: "monthly", returnUrl: "/billing" }))
    .resolves.toBe("https://sandbox.polar.sh/checkout/test");
});

test("a fixture customer keeps the reconciliation failure a test set", async () => {
  const t = setup();
  const customerId = "fixture-wt-test-user_failed";
  await t.mutation(internal.billing.state.enqueue, { customerId });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const lease = (await t.mutation(internal.billing.state.lease, { customerId }))!;
  await t.mutation(internal.billing.state.finish, { customerId, version: lease.version, failed: true });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.billing.state.getSync, { customerId }))
    .toMatchObject({ failureCode: "RECONCILIATION_FAILED", attempts: 1 });
});

test.each([
  ["production", "wt-test"],
  ["sandbox", "wt-other"],
])("%s reconciles a fixture-shaped customer of worktree %s with Polar", async (environment, worktree) => {
  vi.stubEnv("POLAR_ENVIRONMENT", environment);
  const t = setup();
  const customerId = `fixture-${worktree}-user_a`;
  await t.mutation(internal.billing.state.enqueue, { customerId });
  await t.action(internal.billing.polar.reconcileCustomer, { customerId });
  expect(provider.customers.get).toHaveBeenCalledWith(customerId);
});
