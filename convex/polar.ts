import { createPolar, type models as PolarModels } from "@polar-sh/sdk/2026-10";
import { PolarClientError, PolarError, PolarNetworkError, PolarRateLimitError, PolarServerError } from "@polar-sh/sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import {
  billingReturnUrl,
  configuredProduct,
  externalCustomerId,
  isWorktreeExternalId,
  productModel,
  timestamp,
} from "./lib/billing";
import { billingModel, billingModels, recurringModel, type BillingModel } from "./lib/billingModel";
import { appError } from "./lib/errors";
import { action, internalAction, type ActionCtx } from "./lib/functions";

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
    if (!(error instanceof PolarClientError && error.statusCode === 404)) {
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

// Resolves the signed-in owner's provider customer, links it, and requests
// a reconciliation so local state catches up with the provider.
async function ownedCustomer(ctx: ActionCtx): Promise<{ p: Polar; customer: PolarModels.Customer }> {
  const { user, account } = await ctx.runQuery(internal.billingState.owned, {});
  ctx.log.setUser(user._id);
  const p = client();
  const externalId = externalCustomerId(user.tokenIdentifier);
  ctx.log.decision("customer", { source: account ? "linked" : "lookup_or_create" });
  const customer = account
    ? await retry(() => p.customers.get(account.customerId))
    : await findOrCreateCustomer(p, user.email!, externalId);
  ctx.log.setCustomer(customer.id);
  belongs(customer, externalId);
  await ctx.runMutation(internal.billingState.enqueue, { customerId: customer.id, externalId });
  await ctx.runMutation(internal.billingState.claim, { customerId: customer.id, externalId });
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
    for (const model of billingModels) {
      await ctx.runMutation(internal.billing.saveProduct, await validateProduct(p, model));
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
    await ctx.runQuery(internal.legal.requireAccepted, {});
    const { p, customer } = await ownedCustomer(ctx);
    const lease = await ctx.runMutation(internal.billingState.beginOperation, {});
    try {
      await reconcile(ctx, customer.id);
      const { account } = await ctx.runQuery(internal.billingState.owned, {});
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
        allow_trial: false,
        allow_discount_codes: false,
        metadata: { worktree_id: env.WORKTREE_ID },
        customer_metadata: { worktree_id: env.WORKTREE_ID },
        success_url: `${new URL(destination).origin}/billing?confirmation=pending`,
        return_url: destination,
      });
      ctx.log.decision("checkout", { result: "created" });
      return created.url;
    } finally {
      await ctx.runMutation(internal.billingState.endOperation, { lease });
    }
  }),
});

export const portal = action({
  args: { returnUrl: v.string() },
  returns: v.string(),
  handler: (ctx, { returnUrl }) => userFacing(ctx, async () => {
    const destination = billingReturnUrl(returnUrl);
    const { user, account } = await ctx.runQuery(internal.billingState.owned, {});
    ctx.log.setUser(user._id);
    if (!account) {
      throw appError("CUSTOMER_NOT_FOUND");
    }
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
    const { p, customer } = await ownedCustomer(ctx);
    const lease = await ctx.runMutation(internal.billingState.beginOperation, {});
    try {
      await reconcile(ctx, customer.id);
      const { account } = await ctx.runQuery(internal.billingState.owned, {});
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
      await ctx.runMutation(internal.billingState.enqueue, { customerId: customer.id });
      await reconcile(ctx, customer.id);
      await ctx.runMutation(internal.billingState.confirmChange, {
        customerId: customer.id,
        revision: account.revision,
      });
      return null;
    } finally {
      await ctx.runMutation(internal.billingState.endOperation, { lease });
    }
  }),
});

export const recover = action({
  args: {},
  returns: v.null(),
  handler: (ctx) => userFacing(ctx, async () => {
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
    const account = await ctx.runQuery(internal.billing.accountByUser, { userId });
    if (!account) {
      throw new Error("Billing account missing");
    }
    await ctx.runMutation(internal.billingState.requestRevocation, { userId, subscriptionId });
    await reconcile(ctx, account.customerId);
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
  };
}

function orderSnapshot(o: PolarModels.Order & { product_id: string }) {
  return {
    id: o.id,
    productId: o.product_id,
    subscriptionId: o.subscription_id ?? undefined,
    paid: o.paid && o.net_amount > 0,
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
  const lease = await ctx.runMutation(internal.billingState.lease, { customerId });
  if (!lease) {
    ctx.log.decision("reconciliation", { result: "skipped" });
    return;
  }
  let failed = false;
  let phase = "customer";
  try {
    const p = client();
    const customer = await retry(() => p.customers.get(customerId));
    belongs(customer, lease.account.externalId);
    phase = "history";
    const [subscriptions, orders] = await Promise.all([
      retry(() => bounded(p.subscriptions.iterList({ customer_id: customerId, limit: 100 }), 100)),
      retry(() => bounded(p.orders.iterList({ customer_id: customerId, limit: 100 }), 1000)),
    ]);
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
    const revoke: string[] = await ctx.runMutation(internal.billingState.apply, {
      version: lease.version,
      snapshot: {
        customerId,
        externalId: customer.external_id ?? undefined,
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
      await ctx.runMutation(internal.billingState.enqueue, { customerId });
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
  await ctx.runMutation(internal.billingState.finish, { customerId, version: lease.version, failed });
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
export const cleanupAccount = internalAction({
  args: { userId: v.id("users") },
  returns: v.object({ complete: v.boolean(), progress: v.optional(v.boolean()) }),
  handler: (ctx, { userId }) => withoutProviderDetails(ctx, async (): Promise<{ complete: boolean; progress?: boolean }> => {
    ctx.log.setUser(userId);
    const { user, account } = await ctx.runQuery(internal.billingState.cleanupContext, { userId });
    const p = client();
    const externalId = externalCustomerId(user.tokenIdentifier);
    let customer: PolarModels.Customer;
    try {
      customer = await retry(() => account ? p.customers.get(account.customerId) : p.customers.getExternal(externalId));
    } catch (error) {
      if (error instanceof PolarClientError && error.statusCode === 404 && !account) {
        ctx.log.decision("cleanup", { result: "no_customer" });
        return { complete: true };
      }
      throw error;
    }
    ctx.log.setCustomer(customer.id);
    belongs(customer, externalId);
    const cancelling = user.lifecycle === "active";
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
      await ctx.runMutation(internal.billingState.enqueue, { customerId: customer.id, externalId });
      await reconcile(ctx, customer.id);
    } else {
      // Provider truth, rather than bounded cached history, gates identity erasure.
      await ctx.runMutation(internal.billingState.confirmProviderCleanup, { userId });
    }
    return { complete: true };
  }),
});
