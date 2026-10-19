import { createPolar, type models as PolarModels } from "@polar-sh/sdk/2026-10";
import { PolarClientError, PolarError, PolarNetworkError, PolarRateLimitError, PolarServerError } from "@polar-sh/sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env } from "../_generated/server";
import {
  billingReturnUrl,
  configuredProduct,
  externalCustomerId,
  isWorktreeExternalId,
  productModel,
  timestamp,
} from "./lib";
import { billingModel, billingModels, recurringModel, type BillingModel } from "./plans";
import { appError } from "../lib/errors";
import { getDisplayName } from "../lib/profile";
import { action, internalAction, type ActionCtx } from "../lib/functions";

type Polar = ReturnType<typeof createPolar>;

function client() {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_ENVIRONMENT) {
    throw appError("BILLING_CONFIGURATION_REQUIRED");
  }
  return createPolar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    environment: env.POLAR_ENVIRONMENT,
    organizationId: env.POLAR_ORGANIZATION_ID,
    timeout: 15,
  });
}

// Only retry reads and idempotent state-setting operations. Creating checkout or
// portal sessions is not retried: an ambiguous failure is recovered by listing.
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const transient = error instanceof PolarNetworkError || error instanceof PolarServerError ||
        error instanceof PolarRateLimitError;
      if (!transient || attempt >= 2) {
        throw error;
      }
      const delay = error instanceof PolarRateLimitError
        ? Math.max(1, error.retryAfter ?? 1) * 1000
        : 250 * 2 ** attempt;
      // Durable reconciliation follows longer backoff.
      if (delay > 5000) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Log fields that identify a provider failure without its response body,
// which can contain personal data.
function providerFailure(error: unknown) {
  const hasStatus = error instanceof PolarClientError || error instanceof PolarServerError;
  return {
    providerError: error instanceof PolarError ? error.name : "UnexpectedError",
    providerStatus: hasStatus ? error.statusCode : null,
  };
}

// Polar also answers 404 for a deleted customer.
function notFound(error: unknown) {
  return error instanceof PolarClientError && error.statusCode === 404;
}

async function userFacing<T>(ctx: ActionCtx, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    ctx.log.decision("provider", { result: "failed", code: "BILLING_REQUEST_FAILED", ...providerFailure(error) });
    throw appError("BILLING_REQUEST_FAILED");
  }
}

// Internal actions rethrow provider errors without their message, which would
// otherwise reach the event and can contain personal data.
async function withoutProviderDetails<T>(ctx: ActionCtx, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof PolarError)) {
      throw error;
    }
    ctx.log.decision("provider", { result: "failed", ...providerFailure(error) });
    throw new Error("Provider request failed");
  }
}

function belongs(customer: PolarModels.Customer, expected?: string) {
  const scoped = isWorktreeExternalId(customer.external_id) || customer.metadata.worktree_id === env.WORKTREE_ID;
  const otherIdentity = expected && customer.external_id !== expected;
  const otherOrganization = env.POLAR_ORGANIZATION_ID && customer.organization_id !== env.POLAR_ORGANIZATION_ID;
  if (!scoped || otherIdentity || otherOrganization) {
    throw appError("CUSTOMER_IDENTITY_CONFLICT");
  }
}

// Polar requires unique customer emails within an organization. Shared sandbox
// organizations need a separate alias per worktree, alongside the external ID.
function customerEmail(email: string) {
  if (env.POLAR_ENVIRONMENT !== "sandbox") {
    return email;
  }
  const separator = email.lastIndexOf("@");
  return `${email.slice(0, separator)}+${env.WORKTREE_ID}${email.slice(separator)}`;
}

async function findOrCreateCustomer(p: Polar, email: string, externalId: string) {
  try {
    return await retry(() => p.customers.getExternal(externalId));
  } catch (error) {
    if (!notFound(error)) {
      throw error;
    }
  }
  // Stable external ID makes a lost create response recoverable by lookup.
  try {
    return await p.customers.create({
      email: customerEmail(email),
      external_id: externalId,
      metadata: { worktree_id: env.WORKTREE_ID },
    });
  } catch (creationError) {
    try {
      return await retry(() => p.customers.getExternal(externalId));
    } catch {
      throw creationError;
    }
  }
}

// Counts internal Polar requests against the shared budget in rateLimits.ts.
async function spend(ctx: ActionCtx, requests: number) {
  await ctx.runMutation(internal.rateLimits.spendPolar, { requests });
}

// Resolves the signed-in owner's provider customer, links it, and requests
// a reconciliation so local state catches up with the provider.
async function ownedCustomer(ctx: ActionCtx): Promise<{ p: Polar; customer: PolarModels.Customer }> {
  const { user, account } = await ctx.runQuery(internal.billing.state.owned, {});
  ctx.log.setUser(user._id);
  const p = client();
  const externalId = externalCustomerId(user.tokenIdentifier);
  ctx.log.decision("customer", { source: account ? "linked" : "lookup_or_create" });
  const customer = account
    ? await retry(() => p.customers.get(account.customerId))
    : await findOrCreateCustomer(p, user.email!, externalId);
  ctx.log.setCustomer(customer.id);
  belongs(customer, externalId);
  await ctx.runMutation(internal.billing.state.enqueue, { customerId: customer.id, externalId });
  await ctx.runMutation(internal.billing.state.claim, { customerId: customer.id, externalId });
  return { p, customer };
}

async function validateProduct(p: Polar, model: BillingModel) {
  const product = await retry(() => p.products.get(configuredProduct(model)));
  const prices = product.prices.filter((x) => !x.is_archived);
  const price = prices[0];
  const interval = { monthly: "month", yearly: "year", lifetime: null }[model];
  const valid = !product.is_archived &&
    prices.length === 1 &&
    price.amount_type === "fixed" &&
    price.price_amount > 0 &&
    product.is_recurring === (model !== "lifetime") &&
    product.recurring_interval === interval &&
    (model === "lifetime" || product.recurring_interval_count === 1) &&
    (!env.POLAR_ORGANIZATION_ID || product.organization_id === env.POLAR_ORGANIZATION_ID);
  if (!valid || price.amount_type !== "fixed") {
    throw appError("BILLING_CONFIGURATION_REQUIRED");
  }
  return {
    model,
    productId: product.id,
    name: product.name,
    amount: price.price_amount,
    currency: price.price_currency,
    taxBehavior: price.tax_behavior ?? "provider",
    syncedAt: Date.now(),
  };
}

export const syncCatalog = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx) => withoutProviderDetails(ctx, async () => {
    const p = client();
    await spend(ctx, billingModels.length);
    for (const model of billingModels) {
      await ctx.runMutation(internal.billing.catalog.saveProduct, await validateProduct(p, model));
    }
    return null;
  }),
});

export const checkout = action({
  args: { model: billingModel, returnUrl: v.string() },
  returns: v.string(),
  handler: (ctx, { model, returnUrl }) => userFacing(ctx, async () => {
    ctx.log.set("model", model);
    const destination = billingReturnUrl(returnUrl);
    await ctx.runQuery(internal.account.legal.requireAccepted, {});
    await ctx.runMutation(internal.rateLimits.admit, { action: "checkout" });
    const lease = await ctx.runMutation(internal.billing.state.beginOperation, {});
    try {
      const { p, customer } = await ownedCustomer(ctx);
      await reconcile(ctx, customer.id);
      const { user, account } = await ctx.runQuery(internal.billing.state.owned, {});
      const recurringActive = account?.status === "active" && model !== "lifetime";
      if (account?.model === "lifetime" || recurringActive) {
        throw appError("USE_SUBSCRIPTION_MANAGEMENT");
      }
      const product = await validateProduct(p, model);
      // Recover ambiguous creates and repeated clicks without generating duplicate
      // purchase attempts. Provider checkout remains the source of expiry/status.
      const checkouts = await retry(() => p.checkouts.list({
        customer_id: customer.id,
        product_id: product.productId,
        limit: 100,
      }));
      const pending = checkouts.items.find((x) =>
        x.status === "open" && timestamp(x.expires_at) > Date.now() && x.metadata.worktree_id === env.WORKTREE_ID);
      if (pending) {
        ctx.log.decision("checkout", { result: "reused" });
        return pending.url;
      }
      const created = await p.checkouts.create({
        products: [product.productId],
        customer_id: customer.id,
        external_customer_id: customer.external_id,
        // Pre-fills the cardholder name.
        customer_name: getDisplayName(user) ?? null,
        allow_trial: false,
        allow_discount_codes: false,
        metadata: { worktree_id: env.WORKTREE_ID },
        customer_metadata: { worktree_id: env.WORKTREE_ID },
        // Billing waits for this plan's confirmation, then opens the product.
        success_url: `${new URL(destination).origin}/billing?confirmation=${model}`,
        return_url: destination,
      });
      ctx.log.decision("checkout", { result: "created" });
      return created.url;
    } finally {
      await ctx.runMutation(internal.billing.state.endOperation, { lease });
    }
  }),
});

export const portal = action({
  args: { returnUrl: v.string() },
  returns: v.string(),
  handler: (ctx, { returnUrl }) => userFacing(ctx, async () => {
    const destination = billingReturnUrl(returnUrl);
    const { user, account } = await ctx.runQuery(internal.billing.state.owned, {});
    ctx.log.setUser(user._id);
    if (!account) {
      throw appError("CUSTOMER_NOT_FOUND");
    }
    await ctx.runMutation(internal.rateLimits.admit, { action: "portal" });
    const { p, customer } = await ownedCustomer(ctx);
    const session = await p.customerSessions.create({ customer_id: customer.id, return_url: destination });
    return session.customer_portal_url;
  }),
});

export const changeSubscription = action({
  args: { operation: v.union(v.literal("cancel"), v.literal("reactivate"), ...recurringModel.members) },
  returns: v.null(),
  handler: (ctx, { operation }) => userFacing(ctx, async () => {
    ctx.log.set("change", operation);
    await ctx.runMutation(internal.rateLimits.admit, { action: "changeSubscription" });
    const lease = await ctx.runMutation(internal.billing.state.beginOperation, {});
    try {
      const { p, customer } = await ownedCustomer(ctx);
      await reconcile(ctx, customer.id);
      const { account } = await ctx.runQuery(internal.billing.state.owned, {});
      const subscriptionId = account?.subscriptionId;
      if (!account || account.model === "lifetime" || !subscriptionId) {
        throw appError("SUBSCRIPTION_UNAVAILABLE");
      }
      ctx.log.setSubscription(subscriptionId);
      const sub = await retry(() => p.subscriptions.get(subscriptionId));
      const currentModel = productModel(sub.product_id);
      if (sub.customer_id !== customer.id || !currentModel || sub.status !== "active") {
        throw appError("SUBSCRIPTION_UNAVAILABLE");
      }
      if (operation === "monthly" || operation === "yearly") {
        if (sub.cancel_at_period_end) {
          throw appError("SUBSCRIPTION_REACTIVATION_REQUIRED");
        }
        const product = await validateProduct(p, operation);
        // Downgrades keep the paid year and switch at renewal; upgrades invoice now.
        const proration = currentModel === "yearly" && operation === "monthly" ? "next_period" : "invoice";
        ctx.log.decision("plan_change", { from: currentModel, to: operation, proration });
        await retry(() => p.subscriptions.update(sub.id, {
          product_id: product.productId,
          proration_behavior: proration,
        }));
      } else if (sub.cancel_at_period_end !== (operation === "cancel")) {
        ctx.log.decision("renewal", { cancelAtPeriodEnd: operation === "cancel" });
        await retry(() => p.subscriptions.update(sub.id, { cancel_at_period_end: operation === "cancel" }));
      } else {
        ctx.log.decision("renewal", { result: "unchanged" });
      }
      // The result is confirmed from provider state and paid orders, then published
      // reactively. A successful update alone cannot grant new paid entitlement.
      await ctx.runMutation(internal.billing.state.enqueue, { customerId: customer.id });
      await reconcile(ctx, customer.id);
      await ctx.runMutation(internal.billing.state.confirmChange, {
        customerId: customer.id,
        revision: account.revision,
      });
      return null;
    } finally {
      await ctx.runMutation(internal.billing.state.endOperation, { lease });
    }
  }),
});

export const recover = action({
  args: {},
  returns: v.null(),
  handler: (ctx) => userFacing(ctx, async () => {
    await ctx.runMutation(internal.rateLimits.admit, { action: "recover" });
    const { customer } = await ownedCustomer(ctx);
    await reconcile(ctx, customer.id);
    return null;
  }),
});

export const revoke = internalAction({
  args: { userId: v.id("users"), subscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, subscriptionId }) => {
    ctx.log.setUser(userId);
    ctx.log.setSubscription(subscriptionId);
    const account = await ctx.runQuery(internal.billing.account.accountByUser, { userId });
    if (!account) {
      throw new Error("Billing account missing");
    }
    await ctx.runMutation(internal.billing.state.requestRevocation, { userId, subscriptionId });
    await reconcile(ctx, account.customerId);
    return null;
  },
});

// Refunds every order of a withdrawn purchase in full, then stops its
// subscription. A refund Polar is still processing returns "waiting" rather
// than creating a second one, so a lost response never refunds twice.
async function refundWithdrawal(ctx: ActionCtx, withdrawal: Doc<"withdrawals">) {
  const p = client();
  let waiting = false;
  for (const orderId of withdrawal.refundOrderIds) {
    const order = await retry(() => p.orders.get(orderId));
    if (order.customer_id !== withdrawal.customerId) {
      throw new Error("Order ownership conflict");
    }
    if (order.refundable_amount <= 0) {
      continue;
    }
    const refunds = await retry(() => p.refunds.list({ order_id: orderId, limit: 100 }));
    if (refunds.items.some((refund) => refund.status === "pending")) {
      waiting = true;
      continue;
    }
    const refund = await p.refunds.create({
      order_id: orderId,
      amount: order.refundable_amount,
      reason: "customer_request",
      comment: "Withdrawal within the 14-day withdrawal period",
      metadata: { withdrawal_id: withdrawal._id, worktree_id: env.WORKTREE_ID },
    });
    ctx.log.decision("refund", { status: refund.status });
    if (refund.status === "failed" || refund.status === "canceled") {
      throw new Error("Refund not completed");
    }
    waiting ||= refund.status === "pending";
  }
  if (waiting) {
    return "waiting";
  }
  // Paid access ends with the refund, so renewal must not continue either.
  const subscriptionId = withdrawal.subscriptionId;
  if (subscriptionId) {
    ctx.log.setSubscription(subscriptionId);
    const sub = await retry(() => p.subscriptions.get(subscriptionId));
    if (sub.customer_id !== withdrawal.customerId) {
      throw new Error("Subscription ownership conflict");
    }
    if (sub.status !== "canceled") {
      await retry(() => p.subscriptions.revoke(subscriptionId));
    }
  }
  return "refunded";
}

export const withdraw = internalAction({
  args: { withdrawalId: v.id("withdrawals") },
  returns: v.null(),
  handler: async (ctx, { withdrawalId }) => {
    const claimed = await ctx.runMutation(internal.billing.withdrawals.claim, { withdrawalId });
    ctx.log.set("withdrawalId", withdrawalId);
    if (!claimed) {
      return null;
    }
    const { withdrawal, lease } = claimed;
    ctx.log.setUser(withdrawal.userId);
    ctx.log.setCustomer(withdrawal.customerId);
    let outcome: "refunded" | "waiting" | "failed";
    try {
      await spend(ctx, 2 * withdrawal.refundOrderIds.length + 2);
      outcome = await refundWithdrawal(ctx, withdrawal);
    } catch (error) {
      outcome = "failed";
      ctx.log.decision("refund", { result: "failed", code: "REFUND_FAILED", ...providerFailure(error) });
      ctx.log.markAsError();
    }
    await ctx.runMutation(internal.billing.withdrawals.finish, { withdrawalId, lease, outcome });
    return null;
  },
});

// Bound each provider read; overflow is a visible recoverable error, never a
// truncated snapshot which could silently lose an entitlement or unpaid cleanup.
async function bounded<T>(iterator: AsyncGenerator<T>, maximum: number) {
  const items: T[] = [];
  for await (const item of iterator) {
    if (items.length >= maximum) {
      throw new Error("Billing history needs archival");
    }
    items.push(item);
  }
  return items;
}

function modifiedAt(resource: { modified_at?: string | null; created_at: string }) {
  return timestamp(resource.modified_at ?? resource.created_at);
}

// Checkout doesn't accept discount codes, so only the operator can put a 100%
// forever discount on a subscription. That makes it a deliberate comp.
function comped({ discount }: PolarModels.Subscription) {
  return discount?.type === "percentage" && "basis_points" in discount &&
    discount.basis_points === 10000 && discount.duration === "forever";
}

function subscriptionSnapshot(s: PolarModels.Subscription) {
  const pendingModel = s.pending_update?.product_id ? productModel(s.pending_update.product_id) : undefined;
  const scheduledChange = s.pending_update && pendingModel && pendingModel !== "lifetime"
    ? { model: pendingModel, at: timestamp(s.pending_update.applies_at) }
    : undefined;
  return {
    id: s.id,
    productId: s.product_id,
    status: s.status,
    start: timestamp(s.current_period_start),
    end: timestamp(s.current_period_end),
    modifiedAt: modifiedAt(s),
    cancelAtPeriodEnd: s.cancel_at_period_end,
    scheduledChange,
    comped: comped(s),
  };
}

function orderSnapshot(o: PolarModels.Order & { product_id: string }) {
  return {
    id: o.id,
    productId: o.product_id,
    subscriptionId: o.subscription_id ?? undefined,
    // Polar also marks zero-cost plan switches and free orders paid. A purchase
    // is one that charged money or redeemed a discount code, even a 100% one.
    paid: o.paid && (o.net_amount > 0 || o.discount_amount > 0),
    nothingCharged: o.net_amount <= 0,
    fullyRefunded: o.status === "refunded" || (o.net_amount > 0 && o.refunded_amount >= o.net_amount),
    createdAt: timestamp(o.created_at),
    modifiedAt: modifiedAt(o),
  };
}

function configuredOrder(o: PolarModels.Order): o is PolarModels.Order & { product_id: string } {
  return !!o.product_id && !!productModel(o.product_id);
}

// Reads current provider state for one customer and publishes it. Concurrent
// calls are serialized by the reconciliation lease; a skipped call's request
// is picked up when the running worker finishes.
async function reconcile(ctx: ActionCtx, customerId: string) {
  ctx.log.setCustomer(customerId);
  const lease = await ctx.runMutation(internal.billing.state.lease, { customerId });
  if (!lease) {
    ctx.log.decision("reconciliation", { result: "skipped" });
    return;
  }
  let failed = false;
  let phase = "customer";
  try {
    await spend(ctx, 4);
    const p = client();
    const customer = await retry(() => p.customers.get(customerId)).catch((error: unknown) => {
      if (notFound(error)) return null;
      throw error;
    });
    // Account deletion deletes the customer, and Polar delivers events for it
    // afterwards. A deleted customer has no live subscriptions to read.
    if (customer) {
      belongs(customer, lease.account.externalId);
    } else {
      ctx.log.decision("customer", { result: "deleted" });
    }
    phase = "history";
    const [subscriptions, orders] = customer
      ? await Promise.all([
        retry(() => bounded(p.subscriptions.iterList({ customer_id: customerId, limit: 100 }), 100)),
        retry(() => bounded(p.orders.iterList({ customer_id: customerId, limit: 100 }), 1000)),
      ])
      : [[], []];
    // Confirm the managed subscription directly: a list captured around an
    // update can still show the previous renewal flag or plan. Paid orders
    // remain required when publishing access from this refreshed snapshot.
    const managedIndex = subscriptions.findIndex((s) => s.id === lease.account.subscriptionId);
    if (managedIndex >= 0) {
      phase = "managed_subscription";
      const listed = subscriptions[managedIndex];
      const current = await retry(() => p.subscriptions.get(listed.id));
      if (current.customer_id !== customerId) {
        throw new Error("Subscription ownership conflict");
      }
      if (modifiedAt(current) >= modifiedAt(listed)) {
        subscriptions[managedIndex] = current;
      }
    }
    phase = "publish";
    const revoke: string[] = await ctx.runMutation(internal.billing.state.apply, {
      version: lease.version,
      snapshot: {
        customerId,
        externalId: customer ? customer.external_id ?? undefined : lease.account.externalId,
        subscriptions: subscriptions.map(subscriptionSnapshot),
        orders: orders.filter(configuredOrder).map(orderSnapshot),
      },
    });
    phase = "cleanup";
    for (const id of revoke) {
      const sub = await retry(() => p.subscriptions.get(id));
      if (sub.customer_id !== customerId) {
        throw new Error("Subscription ownership conflict");
      }
      if (sub.status !== "canceled") {
        await retry(() => p.subscriptions.revoke(id));
      }
    }
    // Cleanup has changed provider state; reconcile once again to confirm it.
    if (revoke.length) {
      await ctx.runMutation(internal.billing.state.enqueue, { customerId });
    }
    ctx.log.decision("reconciliation", {
      result: "published", subscriptions: subscriptions.length, orders: orders.length, revoked: revoke.length,
    });
  } catch (error) {
    failed = true;
    ctx.log.decision("reconciliation", {
      result: "failed",
      code: "BILLING_RECONCILIATION_FAILED",
      phase,
      ...providerFailure(error),
    });
    ctx.log.markAsError();
  }
  await ctx.runMutation(internal.billing.state.finish, { customerId, version: lease.version, failed });
}

export const reconcileCustomer = internalAction({
  args: { customerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { customerId }) => {
    await reconcile(ctx, customerId);
    return null;
  },
});

// Account cleanup must check the stable provider identity even if customer
// linkage or a creation webhook was missing. The caller retries false/throws.
// Final cleanup deletes the customer, which frees its email for a new sign-up.
export const cleanupAccount = internalAction({
  args: { userId: v.id("users") },
  returns: v.object({ complete: v.boolean(), progress: v.optional(v.boolean()) }),
  handler: (ctx, { userId }) => withoutProviderDetails(ctx, async (): Promise<{ complete: boolean; progress?: boolean }> => {
    ctx.log.setUser(userId);
    const { user, account } = await ctx.runQuery(internal.billing.state.cleanupContext, { userId });
    const p = client();
    await spend(ctx, 5);
    const externalId = externalCustomerId(user.tokenIdentifier);
    const cancelling = user.lifecycle === "active";
    let customer: PolarModels.Customer;
    try {
      customer = await retry(() => account ? p.customers.get(account.customerId) : p.customers.getExternal(externalId));
    } catch (error) {
      if (!notFound(error)) {
        throw error;
      }
      // Either there never was a customer, or an earlier attempt deleted it.
      ctx.log.decision("cleanup", { result: "no_customer" });
      if (account && !cancelling) {
        await ctx.runMutation(internal.billing.state.confirmProviderCleanup, { userId });
      }
      return { complete: true };
    }
    ctx.log.setCustomer(customer.id);
    belongs(customer, externalId);
    // Always take the first page of outstanding work. State-setting operations
    // remove records from this filter, so retries advance without unstable offsets.
    const outstanding = () => retry(() => p.subscriptions.list({
      customer_id: customer.id,
      limit: 10,
      status: ["active", "trialing", "past_due", "incomplete", "incomplete_expired", "paused"],
      ...(cancelling ? { cancel_at_period_end: false } : {}),
    }));
    const batch = await outstanding();
    for (const sub of batch.items) {
      if (sub.customer_id !== customer.id) {
        throw new Error("Subscription ownership conflict");
      }
      if (cancelling) {
        await retry(() => p.subscriptions.update(sub.id, { cancel_at_period_end: true }));
      } else {
        await retry(() => p.subscriptions.revoke(sub.id));
      }
      const confirmed = await retry(() => p.subscriptions.get(sub.id));
      const stopped = ["canceled", "unpaid"].includes(confirmed.status);
      const renewalOff = cancelling && confirmed.cancel_at_period_end;
      if (confirmed.customer_id !== customer.id || (!stopped && !renewalOff)) {
        throw new Error("Subscription cleanup not confirmed");
      }
    }
    const remaining = (await outstanding()).items.length;
    ctx.log.decision("cleanup", { mode: cancelling ? "stop_renewal" : "revoke", processed: batch.items.length, remaining });
    if (remaining || (!cancelling && batch.items.length)) {
      return { complete: false, progress: true };
    }
    if (cancelling) {
      await ctx.runMutation(internal.billing.state.enqueue, { customerId: customer.id, externalId });
      await reconcile(ctx, customer.id);
    } else {
      // Polar keeps the customer's orders and invoices, and anonymizing erases
      // the email and name on the customer itself.
      await retry(() => p.customers.delete(customer.id, { anonymize: true }));
      ctx.log.decision("cleanup", { result: "customer_deleted" });
      // Provider truth, rather than bounded cached history, gates identity erasure.
      await ctx.runMutation(internal.billing.state.confirmProviderCleanup, { userId });
    }
    return { complete: true };
  }),
});
