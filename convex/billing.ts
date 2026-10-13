import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { accountForUser, requirePro, scheduledRetries, syncForCustomer } from "./lib/billing";
import { billingModel } from "./lib/billingModel";
import { getDisplayName } from "./lib/profile";
import { getCurrentUser, readiness } from "./lib/users";
import schema, { scheduledPlanChange } from "./schema";

async function lifetimePurchasedAt(ctx: QueryCtx, account: Doc<"billingAccounts"> | null) {
  if (account?.status !== "active" || account.model !== "lifetime" || !account.lifetimeOrderId) {
    return null;
  }
  const orderId = account.lifetimeOrderId;
  const order = await ctx.db.query("billingOrders")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .unique();
  if (!order || order.customerId !== account.customerId || !order.paid || order.fullyRefunded) {
    return null;
  }
  return order.createdAt;
}

// The published entitlement. Every paid page subscribes to this query, so it
// reads only the entitlement row and never reconciliation bookkeeping.
export const status = query({
  args: {},
  returns: v.object({
    readiness: v.union(v.literal("provisioning"), v.literal("ready"), v.literal("deleting")),
    state: v.union(v.literal("awaiting_payment"), v.literal("active"), v.literal("ended")),
    model: v.union(billingModel, v.null()),
    paidThrough: v.union(v.number(), v.null()),
    lifetimePurchasedAt: v.union(v.number(), v.null()),
    cancelAtPeriodEnd: v.boolean(),
    hasCustomer: v.boolean(),
    revision: v.number(),
    scheduledChange: v.union(scheduledPlanChange, v.null()),
  }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const account = user ? await accountForUser(ctx, user._id) : null;
    return {
      readiness: readiness(user).status,
      state: account?.status ?? "awaiting_payment",
      model: account?.model ?? null,
      paidThrough: account?.paidThrough ?? null,
      lifetimePurchasedAt: await lifetimePurchasedAt(ctx, account),
      cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      hasCustomer: !!account,
      revision: account?.revision ?? 0,
      scheduledChange: account?.status === "active" ? account.scheduledChange ?? null : null,
    };
  },
});

// Reconciliation problems for the billing page. Kept apart from `status` so
// sync bookkeeping only re-runs this query.
export const syncStatus = query({
  args: {},
  returns: v.object({ failure: v.union(v.string(), v.null()), retrying: v.boolean() }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const account = user ? await accountForUser(ctx, user._id) : null;
    const sync = account ? await syncForCustomer(ctx, account.customerId) : null;
    if (!sync?.failureCode) {
      return { failure: null, retrying: false };
    }
    const retrying = sync.failureCode === "RECONCILIATION_FAILED" && sync.attempts <= scheduledRetries;
    return { failure: sync.failureCode, retrying };
  },
});

export const products = query({
  args: {},
  returns: v.array(v.object({
    model: billingModel,
    name: v.string(),
    amount: v.number(),
    currency: v.string(),
    taxBehavior: v.string(),
  })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("billingProducts").take(3);
    return rows.map(({ model, name, amount, currency, taxBehavior }) => ({
      model,
      name,
      amount,
      currency,
      taxBehavior,
    }));
  },
});

export const saveProduct = internalMutation({
  args: schema.tables.billingProducts.validator.fields,
  returns: v.null(),
  handler: async (ctx, product) => {
    const existing = await ctx.db.query("billingProducts")
      .withIndex("by_model", (q) => q.eq("model", product.model))
      .unique();
    if (existing) {
      await ctx.db.patch("billingProducts", existing._id, product);
    } else {
      await ctx.db.insert("billingProducts", product);
    }
    return null;
  },
});

export const accountByUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(schema.doc("billingAccounts"), v.null()),
  handler: (ctx, { userId }) => accountForUser(ctx, userId),
});

// Paid application data always uses this boundary, including direct API calls.
export const application = query({
  args: {},
  returns: v.object({ name: v.string() }),
  handler: async (ctx) => {
    const user = await requirePro(ctx);
    return { name: getDisplayName(user) || "there" };
  },
});

export const deliveryStatus = internalQuery({
  args: { customerId: v.string() },
  returns: v.object({ delivered: v.boolean() }),
  handler: async (ctx, { customerId }) => {
    const sync = await syncForCustomer(ctx, customerId);
    return { delivered: !!sync?.lastDeliveryAt };
  },
});

// Operational recovery surface. Failures stay listed after scheduled retries
// are exhausted while the sweep keeps retrying them hourly; unclaimed customers
// stay listed until a provider event or their owner links them.
export const recoveryIssues = internalQuery({
  args: {},
  returns: v.array(schema.doc("billingSync")),
  handler: async (ctx) => {
    const codes = ["RECONCILIATION_FAILED", "RECURRING_CLEANUP_PENDING", "CUSTOMER_LINK_REQUIRED"];
    const rows = await Promise.all(codes.map((code) => ctx.db.query("billingSync")
      .withIndex("by_failureCode", (q) => q.eq("failureCode", code))
      .take(25)));
    return rows.flat();
  },
});
