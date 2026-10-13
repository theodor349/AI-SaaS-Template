import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { accountForUser, billingModel, requirePro } from "./lib/billing";
import schema, { scheduledPlanChange } from "./schema";
import { requireIdentity } from "./lib/auth";
import { getDisplayName } from "./lib/profile";

export const status = query({
  args: {}, returns: v.object({ readiness: v.union(v.literal("provisioning"), v.literal("ready"), v.literal("deleting")),
    state: v.union(v.literal("awaiting_payment"), v.literal("active"), v.literal("ended")),
    model: v.union(billingModel, v.null()), paidThrough: v.union(v.number(), v.null()),
    lifetimePurchasedAt: v.union(v.number(), v.null()),
    cancelAtPeriodEnd: v.boolean(), hasCustomer: v.boolean(), revision: v.number(),
    scheduledChange: v.union(scheduledPlanChange, v.null()),
    reconciledAt: v.number(), failure: v.union(v.string(), v.null()), retrying: v.boolean() }),
  handler: async ctx => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db.query("users").withIndex("by_tokenIdentifier", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    const account = user ? await accountForUser(ctx, user._id) : null;
    const lifetimeOrder = account?.status === "active" && account.model === "lifetime" && account.lifetimeOrderId
      ? await ctx.db.query("billingOrders").withIndex("by_orderId", q => q.eq("orderId", account.lifetimeOrderId!)).unique()
      : null;
    return { readiness: user && user.lifecycle !== "active" ? "deleting" as const : !user?.email ? "provisioning" as const : "ready" as const,
      state: account?.status ?? "awaiting_payment" as const, model: account?.model ?? null,
      paidThrough: account?.paidThrough ?? null, cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      lifetimePurchasedAt: lifetimeOrder?.customerId === account?.customerId && lifetimeOrder?.paid && !lifetimeOrder.fullyRefunded
        ? lifetimeOrder.createdAt : null,
      scheduledChange: account?.status === "active" ? account.scheduledChange ?? null : null,
      hasCustomer: !!account, revision: account?.revision ?? 0, reconciledAt: account?.reconciledAt ?? 0,
      failure: account?.failureCode ?? null,
      retrying: account?.failureCode === "RECONCILIATION_FAILED" && account.attempts <= 8 };
  },
});
export const products = query({
  args: {}, returns: v.array(v.object({ model: billingModel, name: v.string(), amount: v.number(), currency: v.string(), taxBehavior: v.string() })),
  handler: async ctx => (await ctx.db.query("billingProducts").take(3)).map(({ model, name, amount, currency, taxBehavior }) => ({ model, name, amount, currency, taxBehavior })),
});
export const saveProduct = internalMutation({
  args: schema.tables.billingProducts.validator.fields, returns: v.null(), handler: async (ctx, product) => {
    const existing = await ctx.db.query("billingProducts").withIndex("by_model", q => q.eq("model", product.model)).unique();
    if (existing) await ctx.db.patch("billingProducts", existing._id, product); else await ctx.db.insert("billingProducts", product); return null;
  },
});
export const accountByUser = internalQuery({
  args: { userId: v.id("users") }, returns: v.union(schema.doc("billingAccounts"), v.null()),
  handler: (ctx, { userId }) => accountForUser(ctx, userId),
});
// Paid application data always uses this boundary, including direct API calls.
export const application = query({
  args: {}, returns: v.object({ name: v.string() }), handler: async ctx => {
    const user = await requirePro(ctx); return { name: getDisplayName(user) || "there" };
  },
});

export const deliveryStatus = internalQuery({
  args: { customerId: v.string() }, returns: v.object({ delivered: v.boolean() }),
  handler: async (ctx, { customerId }) => ({ delivered: !!(await ctx.db.query("billingAccounts")
    .withIndex("by_customerId", q => q.eq("customerId", customerId)).unique())?.lastDeliveryAt }),
});
// Operational recovery surface: bounded failures and unclaimed customers stay
// visible after immediate retries are exhausted; the sweep retries them hourly.
export const recoveryIssues = internalQuery({
  args: {}, returns: v.array(schema.doc("billingAccounts")), handler: async ctx => {
    const rows = await Promise.all(["RECONCILIATION_FAILED", "RECURRING_CLEANUP_PENDING", "CUSTOMER_LINK_REQUIRED"].map(code =>
      ctx.db.query("billingAccounts").withIndex("by_failureCode", q => q.eq("failureCode", code)).take(25)));
    return rows.flat();
  },
});
