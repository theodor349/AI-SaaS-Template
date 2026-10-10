import { createPolar, type models as PolarModels } from "@polar-sh/sdk/2026-10";
import { PolarClientError, PolarNetworkError, PolarServerError, PolarRateLimitError } from "@polar-sh/sdk";
import type { Doc } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, env, internalAction, type ActionCtx } from "./_generated/server";
import { billingModel, billingReturnUrl, configuredProduct, externalCustomerId, models, productModel, timestamp, type BillingModel } from "./lib/billing";

function client() {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_ENVIRONMENT) throw new ConvexError({ code: "BILLING_CONFIGURATION_REQUIRED" });
  return createPolar({ accessToken: env.POLAR_ACCESS_TOKEN, environment: env.POLAR_ENVIRONMENT,
    organizationId: env.POLAR_ORGANIZATION_ID, timeout: 15 });
}
// Only retry reads and idempotent state-setting operations. Creating checkout or
// portal sessions is not retried: an ambiguous failure is recovered by listing.
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      const transient = error instanceof PolarNetworkError || error instanceof PolarServerError || error instanceof PolarRateLimitError;
      if (!transient || attempt >= 2) throw error;
      const delay = error instanceof PolarRateLimitError ? Math.max(1, error.retryAfter ?? 1) * 1000 : 250 * 2 ** attempt;
      if (delay > 5000) throw error; // Durable reconciliation follows longer backoff.
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
async function userFacing<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof ConvexError) throw error;
    console.error("Polar operation failed", { code: "BILLING_REQUEST_FAILED" });
    throw new ConvexError({ code: "BILLING_REQUEST_FAILED" });
  }
}
function belongs(customer: PolarModels.Customer, expected?: string) {
  const scoped = customer.external_id?.startsWith(`${env.WORKTREE_ID}:`) || customer.metadata.worktree_id === env.WORKTREE_ID;
  if (!scoped || (expected && customer.external_id !== expected) || (env.POLAR_ORGANIZATION_ID && customer.organization_id !== env.POLAR_ORGANIZATION_ID)) {
    throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
  }
}
async function ownedCustomer(ctx: ActionCtx): Promise<{ p: ReturnType<typeof client>; customer: PolarModels.Customer; user: Doc<"users">; account: Doc<"billingAccounts"> | null }> {
  const { user, account } = await ctx.runQuery(internal.billingState.owned, {});
  const p = client(); const externalId = externalCustomerId(user.tokenIdentifier);
  let customer: PolarModels.Customer;
  if (account) customer = await retry(() => p.customers.get(account.customerId));
  else {
    try { customer = await retry(() => p.customers.getExternal(externalId)); }
    catch (error) {
      if (!(error instanceof PolarClientError && error.statusCode === 404)) throw error;
      // Stable external ID makes a lost create response recoverable by lookup.
      try { customer = await p.customers.create({ email: user.email!, external_id: externalId, metadata: { worktree_id: env.WORKTREE_ID } }); }
      catch { customer = await retry(() => p.customers.getExternal(externalId)); }
    }
  }
  belongs(customer, externalId);
  await ctx.runMutation(internal.billingState.enqueue, { customerId: customer.id, externalId });
  await ctx.runMutation(internal.billingState.claim, { customerId: customer.id, externalId });
  return { p, customer, user, account };
}
async function validateProduct(p: ReturnType<typeof client>, model: BillingModel) {
  const product = await retry(() => p.products.get(configuredProduct(model)));
  const price = product.prices.filter(x => !x.is_archived);
  if (product.is_archived || price.length !== 1 || price[0].amount_type !== "fixed" || price[0].price_amount <= 0 ||
    product.is_recurring !== (model !== "lifetime") || product.recurring_interval !== ({ monthly: "month", yearly: "year", lifetime: null }[model]) ||
    (model !== "lifetime" && product.recurring_interval_count !== 1) ||
    (env.POLAR_ORGANIZATION_ID && product.organization_id !== env.POLAR_ORGANIZATION_ID)) {
    throw new ConvexError({ code: "BILLING_CONFIGURATION_REQUIRED" });
  }
  const fixed = price[0];
  return { model, productId: product.id, name: product.name, amount: fixed.price_amount,
    currency: fixed.price_currency, taxBehavior: fixed.tax_behavior ?? "provider", syncedAt: Date.now() };
}
export const syncCatalog = internalAction({
  args: {}, returns: v.null(), handler: async ctx => {
    const p = client();
    for (const model of models) await ctx.runMutation(internal.billing.saveProduct, await validateProduct(p, model));
    return null;
  },
});

export const checkout = action({
  args: { model: billingModel, returnUrl: v.string() }, returns: v.string(),
  handler: (ctx, { model, returnUrl }) => userFacing(async () => {
    const destination = billingReturnUrl(returnUrl);
    const { p, customer } = await ownedCustomer(ctx);
    const lease = await ctx.runMutation(internal.billingState.beginOperation, {});
    try {
      await ctx.runAction(internal.polar.reconcileCustomer, { customerId: customer.id });
      const current = await ctx.runQuery(internal.billingState.owned, {});
      if (current.account?.model === "lifetime" || (current.account?.status === "active" && model !== "lifetime")) {
        throw new ConvexError({ code: "USE_SUBSCRIPTION_MANAGEMENT" });
      }
      const product = await validateProduct(p, model);
      // Recover ambiguous creates and repeated clicks without generating duplicate
      // purchase attempts. Provider checkout remains the source of expiry/status.
      const checkouts = await retry(() => p.checkouts.list({ customer_id: customer.id, product_id: product.productId, limit: 100 }));
      const pending = checkouts.items.find(x => x.status === "open" && timestamp(x.expires_at) > Date.now() && x.metadata.worktree_id === env.WORKTREE_ID);
      if (pending) return pending.url;
      const checkout = await p.checkouts.create({ products: [product.productId], customer_id: customer.id,
        external_customer_id: customer.external_id, allow_trial: false, allow_discount_codes: false,
        metadata: { worktree_id: env.WORKTREE_ID }, customer_metadata: { worktree_id: env.WORKTREE_ID },
        success_url: `${new URL(destination).origin}/billing?confirmation=pending`, return_url: destination });
      await ctx.runMutation(internal.billingState.saveCheckout, { customerId: customer.id, checkoutId: checkout.id,
        checkoutUrl: checkout.url, checkoutExpiresAt: timestamp(checkout.expires_at) });
      return checkout.url;
    } finally { await ctx.runMutation(internal.billingState.endOperation, { lease }); }
  }),
});
export const portal = action({
  args: { returnUrl: v.string() }, returns: v.string(), handler: (ctx, { returnUrl }) => userFacing(async () => {
    const destination = billingReturnUrl(returnUrl);
    const { account } = await ctx.runQuery(internal.billingState.owned, {});
    if (!account) throw new ConvexError({ code: "CUSTOMER_NOT_FOUND" });
    const { p, customer } = await ownedCustomer(ctx);
    return (await p.customerSessions.create({ customer_id: customer.id, return_url: destination })).customer_portal_url;
  }),
});
export const changeSubscription = action({
  args: { operation: v.union(v.literal("cancel"), v.literal("reactivate"), v.literal("monthly"), v.literal("yearly")) },
  returns: v.null(), handler: (ctx, { operation }) => userFacing(async () => {
    const { p, customer } = await ownedCustomer(ctx);
    const lease = await ctx.runMutation(internal.billingState.beginOperation, {});
    try {
      await ctx.runAction(internal.polar.reconcileCustomer, { customerId: customer.id });
      const { account } = await ctx.runQuery(internal.billingState.owned, {});
      if (account?.model === "lifetime" || !account?.subscriptionId) throw new ConvexError({ code: "SUBSCRIPTION_UNAVAILABLE" });
      const sub = await retry(() => p.subscriptions.get(account.subscriptionId!));
      if (sub.customer_id !== customer.id || !productModel(sub.product_id) || sub.status !== "active") {
        throw new ConvexError({ code: "SUBSCRIPTION_UNAVAILABLE" });
      }
      if (operation === "monthly" || operation === "yearly") {
        const product = await validateProduct(p, operation);
        await retry(() => p.subscriptions.update(sub.id, { product_id: product.productId, proration_behavior: "invoice" }));
      } else await retry(() => p.subscriptions.update(sub.id, { cancel_at_period_end: operation === "cancel" }));
      // The result is confirmed from provider state and paid orders, then published
      // reactively. A successful update alone cannot grant new paid entitlement.
      await ctx.runMutation(internal.billingState.enqueue, { customerId: customer.id });
      await ctx.runAction(internal.polar.reconcileCustomer, { customerId: customer.id });
      return null;
    } finally { await ctx.runMutation(internal.billingState.endOperation, { lease }); }
  }),
});
export const recover = action({
  args: {}, returns: v.null(), handler: ctx => userFacing(async () => {
    const { customer } = await ownedCustomer(ctx);
    await ctx.runAction(internal.polar.reconcileCustomer, { customerId: customer.id }); return null;
  }),
});

export const revoke = internalAction({
  args: { userId: v.id("users"), subscriptionId: v.string() }, returns: v.null(),
  handler: async (ctx, { userId, subscriptionId }) => {
    const account = await ctx.runQuery(internal.billing.accountByUser, { userId });
    if (!account) throw new Error("Billing account missing");
    await ctx.runMutation(internal.billingState.requestRevocation, { userId, subscriptionId });
    await ctx.runAction(internal.polar.reconcileCustomer, { customerId: account.customerId });
    return null;
  },
});
// Bound each provider read; overflow is a visible recoverable error, never a
// truncated snapshot which could silently lose an entitlement or unpaid cleanup.
async function bounded<T>(iterator: AsyncGenerator<T>, maximum: number) {
  const items: T[] = [];
  for await (const item of iterator) { if (items.length >= maximum) throw new Error("Billing history needs archival"); items.push(item); }
  return items;
}
export const reconcileCustomer = internalAction({
  args: { customerId: v.string() }, returns: v.null(), handler: async (ctx, { customerId }) => {
    const lease = await ctx.runMutation(internal.billingState.lease, { customerId });
    if (!lease) return null;
    let failed = false;
    try {
      const p = client(); const customer = await retry(() => p.customers.get(customerId));
      belongs(customer, lease.account.externalId);
      const [subscriptions, orders] = await Promise.all([
        retry(() => bounded(p.subscriptions.iterList({ customer_id: customerId, limit: 100 }), 100)),
        retry(() => bounded(p.orders.iterList({ customer_id: customerId, limit: 100 }), 1000)),
      ]);
      const revoke: string[] = await ctx.runMutation(internal.billingState.apply, { version: lease.version, snapshot: {
        customerId, externalId: customer.external_id ?? undefined,
        subscriptions: subscriptions.map(s => ({ id: s.id, productId: s.product_id,
          status: s.status, start: timestamp(s.current_period_start), end: timestamp(s.current_period_end),
          modifiedAt: timestamp(s.modified_at ?? s.created_at), cancelAtPeriodEnd: s.cancel_at_period_end })),
        orders: orders.filter(o => o.product_id && productModel(o.product_id)).map(o => ({ id: o.id, productId: o.product_id!,
          subscriptionId: o.subscription_id ?? undefined, paid: o.paid && o.net_amount > 0,
          fullyRefunded: o.status === "refunded" || (o.net_amount > 0 && o.refunded_amount >= o.net_amount),
          createdAt: timestamp(o.created_at), modifiedAt: timestamp(o.modified_at ?? o.created_at) })),
      } });
      for (const id of revoke) {
        const sub = await retry(() => p.subscriptions.get(id));
        if (sub.customer_id !== customerId) throw new Error("Subscription ownership conflict");
        if (sub.status !== "canceled") await retry(() => p.subscriptions.revoke(id));
      }
      // Cleanup has changed provider state; reconcile once again to confirm it.
      if (revoke.length) await ctx.runMutation(internal.billingState.enqueue, { customerId });
    } catch { failed = true; }
    await ctx.runMutation(internal.billingState.finish, { customerId, version: lease.version, failed });
    return null;
  },
});

// Account cleanup must check the stable provider identity even if customer
// linkage or a creation webhook was missing. The caller retries false/throws.
export const cleanupAccount = internalAction({
  args: { userId: v.id("users") }, returns: v.object({ complete: v.boolean(), progress: v.optional(v.boolean()) }),
  handler: async (ctx, { userId }): Promise<{ complete: boolean; progress?: boolean }> => {
    const { user, account } = await ctx.runQuery(internal.billingState.cleanupContext, { userId });
    const p = client(); const externalId = externalCustomerId(user.tokenIdentifier);
    let customer: PolarModels.Customer;
    try { customer = await retry(() => account ? p.customers.get(account.customerId) : p.customers.getExternal(externalId)); }
    catch (error) {
      if (error instanceof PolarClientError && error.statusCode === 404 && !account) return { complete: true };
      throw error;
    }
    belongs(customer, externalId);
    const cancelling = user.lifecycle === "active";
    // Always take the first page of outstanding work. State-setting operations
    // remove records from this filter, so retries advance without unstable offsets.
    const outstanding = () => retry(() => p.subscriptions.list({ customer_id: customer.id, limit: 10,
      status: ["active", "trialing", "past_due", "incomplete", "incomplete_expired", "paused"],
      ...(cancelling ? { cancel_at_period_end: false } : {}) }));
    const batch = await outstanding();
    for (const sub of batch.items) {
      if (sub.customer_id !== customer.id) throw new Error("Subscription ownership conflict");
      if (cancelling) await retry(() => p.subscriptions.update(sub.id, { cancel_at_period_end: true }));
      else await retry(() => p.subscriptions.revoke(sub.id));
      const confirmed = await retry(() => p.subscriptions.get(sub.id));
      if (confirmed.customer_id !== customer.id || (!["canceled", "unpaid"].includes(confirmed.status) && (!cancelling || !confirmed.cancel_at_period_end))) {
        throw new Error("Subscription cleanup not confirmed");
      }
    }
    if ((await outstanding()).items.length || (!cancelling && batch.items.length)) return { complete: false, progress: true };
    if (cancelling) {
      await ctx.runMutation(internal.billingState.enqueue, { customerId: customer.id, externalId });
      await ctx.runAction(internal.polar.reconcileCustomer, { customerId: customer.id });
    } else {
      // Provider truth, rather than bounded cached history, gates identity erasure.
      await ctx.runMutation(internal.billingState.confirmProviderCleanup, { userId });
    }
    return { complete: true };
  },
});
