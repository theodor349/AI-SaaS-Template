import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalMutation, internalQuery } from "./_generated/server";
import { accountForUser, externalCustomerId, productModel, requireUser } from "./lib/billing";
import schema from "./schema";
import { deliveryArgs, deliveryResult, processDelivery } from "./webhooks";

const subscription = v.object({ id: v.string(), productId: v.string(), status: v.string(),
  start: v.number(), end: v.number(), modifiedAt: v.number(), cancelAtPeriodEnd: v.boolean() });
const order = v.object({ id: v.string(), productId: v.string(), subscriptionId: v.optional(v.string()),
  paid: v.boolean(), fullyRefunded: v.boolean(), createdAt: v.number(), modifiedAt: v.number() });
export const snapshot = v.object({ customerId: v.string(), externalId: v.optional(v.string()),
  subscriptions: v.array(subscription), orders: v.array(order) });
const accountDoc = v.union(v.null(), schema.doc("billingAccounts"));

export const owned = internalQuery({
  args: {}, returns: v.object({ user: schema.doc("users"), account: accountDoc }),
  handler: async ctx => { const user = await requireUser(ctx); return { user, account: await accountForUser(ctx, user._id) }; },
});
export const get = internalQuery({
  args: { customerId: v.string() }, returns: accountDoc,
  handler: (ctx, { customerId }) => ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", customerId)).unique(),
});

export const enqueue = internalMutation({
  args: { customerId: v.string(), externalId: v.optional(v.string()) }, returns: v.id("billingAccounts"),
  handler: async (ctx, { customerId, externalId }) => {
    let row = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", customerId)).unique();
    if (row?.externalId && externalId && row.externalId !== externalId) throw new Error("Customer identity conflict");
    const id = row?._id ?? await ctx.db.insert("billingAccounts", { customerId, externalId,
      status: "awaiting_payment", cancelAtPeriodEnd: false, revision: 0, reconciledAt: 0,
      nextCheckAt: Date.now(), requestedVersion: 0, completedVersion: 0, leaseUntil: 0, attempts: 0 });
    row = await ctx.db.get("billingAccounts", id);
    if (!row) throw new Error("Account missing");
    await ctx.db.patch("billingAccounts", id, { externalId: externalId ?? row.externalId,
      requestedVersion: row.requestedVersion + 1, nextCheckAt: Date.now(), attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId });
    return id;
  },
});

// The signed webhook owns only a durable reconciliation request. Shared delivery
// processing commits that request and delivery success in the same transaction.
export const process = internalMutation({
  args: { ...deliveryArgs, customerId: v.string(), externalId: v.optional(v.string()), scoped: v.boolean() },
  returns: deliveryResult,
  handler: async (ctx, args): Promise<"success" | "duplicate" | "failure"> => {
    const existing = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", args.customerId)).unique();
    if (!args.scoped && !existing) return "success"; // Foreign worktree events never enter retries.
    const result = await processDelivery(ctx, { provider: args.provider, deliveryId: args.deliveryId, eventType: args.eventType }, internal.billingState.enqueue, { customerId: args.customerId, externalId: args.externalId });
    if (result === "success") {
      const account = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", args.customerId)).unique();
      if (account) await ctx.db.patch("billingAccounts", account._id, { lastDeliveryAt: Date.now() });
    }
    return result;
  },
});

export const claim = internalMutation({
  args: { customerId: v.string(), externalId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.externalId !== externalCustomerId(user.tokenIdentifier)) throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    const existing = await accountForUser(ctx, user._id);
    if (existing && existing.customerId !== args.customerId) throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    const account = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", args.customerId)).unique();
    if (!account || (account.userId && account.userId !== user._id) || (account.externalId && account.externalId !== args.externalId)) {
      throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    }
    await ctx.db.patch("billingAccounts", account._id, { userId: user._id, externalId: args.externalId });
    return null;
  },
});

export const lease = internalMutation({
  args: { customerId: v.string() }, returns: v.union(v.null(), v.object({ version: v.number(), account: schema.doc("billingAccounts") })),
  handler: async (ctx, { customerId }) => {
    const account = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", customerId)).unique();
    if (!account || account.leaseUntil > Date.now()) return null;
    const version = account.requestedVersion + 1;
    await ctx.db.patch("billingAccounts", account._id, { requestedVersion: version, leaseVersion: version, leaseUntil: Date.now() + 120_000, nextCheckAt: Date.now() + 120_000 });
    return { version, account };
  },
});

export const apply = internalMutation({
  args: { snapshot, version: v.number() }, returns: v.array(v.string()),
  handler: async (ctx, { snapshot: state, version }) => {
    const account = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", state.customerId)).unique();
    if (!account || account.leaseVersion !== version || account.requestedVersion !== version) return [];
    if (account.externalId && state.externalId && account.externalId !== state.externalId) throw new Error("Customer identity conflict");
    const customerId = state.customerId;
    const user = account.userId ? await ctx.db.get("users", account.userId) : state.externalId?.startsWith(`${env.WORKTREE_ID}:`) ?
      await ctx.db.query("users").withIndex("by_tokenIdentifier", q => q.eq("tokenIdentifier", state.externalId!.slice(env.WORKTREE_ID.length + 1))).unique() : null;
    if (user) {
      const other = await accountForUser(ctx, user._id);
      if (other && other._id !== account._id) throw new Error("Customer identity conflict");
    }
    for (const item of state.orders) {
      const old = await ctx.db.query("billingOrders").withIndex("by_orderId", q => q.eq("orderId", item.id)).unique();
      if (old && old.customerId !== customerId) throw new Error("Order ownership conflict");
      if (old && old.modifiedAt > item.modifiedAt) continue;
      const fields = { customerId, orderId: item.id, productId: item.productId, subscriptionId: item.subscriptionId,
        paid: item.paid, fullyRefunded: item.fullyRefunded, createdAt: item.createdAt, modifiedAt: item.modifiedAt };
      if (old) await ctx.db.patch("billingOrders", old._id, fields); else await ctx.db.insert("billingOrders", fields);
    }
    const orders = await ctx.db.query("billingOrders").withIndex("by_customerId", q => q.eq("customerId", customerId)).take(1001);
    if (orders.length > 1000) throw new Error("Billing history needs archival");
    const lifetime = orders.filter(o => productModel(o.productId) === "lifetime" && o.paid && !o.fullyRefunded)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const deleting = user && user.lifecycle !== "active";
    const revoke: string[] = [];
    for (const item of state.subscriptions) {
      const old = await ctx.db.query("billingSubscriptions").withIndex("by_subscriptionId", q => q.eq("subscriptionId", item.id)).unique();
      if (old && old.customerId !== customerId) throw new Error("Subscription ownership conflict");
      if (!old && !productModel(item.productId) && !lifetime && !deleting) continue;
      if (old && old.modifiedAt > item.modifiedAt) continue;
      // A fully refunded current-period charge revokes that subscription. Older
      // period refunds and partial refunds don't remove a later paid period.
      const refunded = orders.some(o => o.subscriptionId === item.id && o.fullyRefunded && o.createdAt >= item.start);
      const superseded = old?.superseded || !!lifetime || !!deleting || refunded;
      const fields = { customerId, subscriptionId: item.id, productId: item.productId, status: item.status,
        paidThrough: item.end, cancelAtPeriodEnd: item.cancelAtPeriodEnd, modifiedAt: item.modifiedAt, periodStart: item.start, superseded };
      if (old) await ctx.db.patch("billingSubscriptions", old._id, fields); else await ctx.db.insert("billingSubscriptions", fields);
      if (superseded && ["active", "trialing", "past_due", "incomplete", "paused"].includes(item.status)) revoke.push(item.id);
    }
    const subscriptions = await ctx.db.query("billingSubscriptions").withIndex("by_customerId", q => q.eq("customerId", customerId)).take(101);
    if (subscriptions.length > 100) throw new Error("Billing history needs archival");
    const recurring = subscriptions.map(s => {
      const model = productModel(s.productId);
      if (!model || model === "lifetime" || s.superseded || s.status !== "active") return null;
      const currentPayment = orders.some(o => o.subscriptionId === s.subscriptionId && o.paid && !o.fullyRefunded && o.createdAt >= s.periodStart);
      // A zero-cost/prorated switch may move the provider period before a paid
      // update arrives. Preserve already purchased time, never extend it from an
      // unpaid renewal or a provider period change alone.
      const previousDeadline = account.subscriptionId === s.subscriptionId && account.status === "active" ? account.paidThrough : undefined;
      const confirmedPaidThrough = currentPayment ? s.paidThrough : previousDeadline === undefined ? 0 : Math.min(previousDeadline, s.paidThrough);
      return confirmedPaidThrough > Date.now() ? { ...s, confirmedPaidThrough } : null;
    }).filter(s => s !== null).sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    const active = !deleting && (!!lifetime || !!recurring);
    const model = active ? lifetime ? "lifetime" : recurring && productModel(recurring.productId) : undefined;
    const revision = account.revision + 1;
    const paidThrough = active && !lifetime ? recurring?.confirmedPaidThrough : undefined;
    await ctx.db.patch("billingAccounts", account._id, {
      externalId: state.externalId ?? account.externalId, userId: user?._id ?? account.userId,
      status: active ? "active" : account.reconciledAt || orders.some(o => o.paid) ? "ended" : "awaiting_payment",
      model, subscriptionId: active && !lifetime ? recurring?.subscriptionId : undefined,
      lifetimeOrderId: active ? lifetime?.orderId : undefined, paidThrough,
      cancelAtPeriodEnd: active && !lifetime ? recurring?.cancelAtPeriodEnd ?? false : false,
      revision, reconciledAt: Date.now(), completedVersion: version,
      // Retain the lease during external cleanup. Failed cleanup leaves a visible retry.
      nextCheckAt: Date.now() + (revoke.length ? 120_000 : 15 * 60_000), failureCode: revoke.length ? "RECURRING_CLEANUP_PENDING" : undefined,
    });
    if (paidThrough) await ctx.scheduler.runAt(paidThrough, internal.billingState.expire, { accountId: account._id, revision });
    return revoke;
  },
});

export const finish = internalMutation({
  args: { customerId: v.string(), version: v.number(), failed: v.boolean() }, returns: v.null(),
  handler: async (ctx, { customerId, version, failed }) => {
    const row = await ctx.db.query("billingAccounts").withIndex("by_customerId", q => q.eq("customerId", customerId)).unique();
    if (!row || row.leaseVersion !== version) return null;
    const attempts = failed ? row.attempts + 1 : 0;
    const pending = row.requestedVersion !== version;
    const delay = failed ? Math.min(60 * 60_000, 1000 * 2 ** Math.min(attempts, 12)) : pending ? 0 : 15 * 60_000;
    await ctx.db.patch("billingAccounts", row._id, { leaseUntil: 0, attempts,
      nextCheckAt: Date.now() + delay, failureCode: failed ? "RECONCILIATION_FAILED" : !row.userId ? "CUSTOMER_LINK_REQUIRED" : undefined });
    if (failed) console.error("Billing reconciliation requires recovery", { customerId, attempts });
    if (pending || (failed && attempts <= 8)) await ctx.scheduler.runAfter(delay, internal.polar.reconcileCustomer, { customerId });
    return null;
  },
});
export const expire = internalMutation({
  args: { accountId: v.id("billingAccounts"), revision: v.number() }, returns: v.null(),
  handler: async (ctx, { accountId, revision }) => {
    const row = await ctx.db.get("billingAccounts", accountId);
    if (row && row.revision === revision && row.paidThrough !== undefined && row.paidThrough <= Date.now()) {
      await ctx.db.patch("billingAccounts", accountId, { status: "ended", model: undefined, subscriptionId: undefined,
        paidThrough: undefined, cancelAtPeriodEnd: false, nextCheckAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId: row.customerId });
    }
    return null;
  },
});
export const sweep = internalMutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const rows = await ctx.db.query("billingAccounts").withIndex("by_nextCheckAt", q => q.lte("nextCheckAt", Date.now())).take(50);
    for (const row of rows) {
      await ctx.db.patch("billingAccounts", row._id, { nextCheckAt: Date.now() + 120_000 });
      await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId: row.customerId });
    }
    return null;
  },
});
export const saveCheckout = internalMutation({
  args: { customerId: v.string(), checkoutId: v.string(), checkoutUrl: v.string(), checkoutExpiresAt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx); const account = await accountForUser(ctx, user._id);
    if (!account || account.customerId !== args.customerId) throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    await ctx.db.patch("billingAccounts", account._id, args); return null;
  },
});
// Account lifecycle #5 can queue cleanup and poll until all resources are ended.
export const cleanup = internalMutation({
  args: { userId: v.id("users") }, returns: v.object({ complete: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user || user.lifecycle === "active") throw new Error("Deletion must be requested first");
    const account = await accountForUser(ctx, userId);
    if (!account) return { complete: true };
    const subs = await ctx.db.query("billingSubscriptions").withIndex("by_customerId", q => q.eq("customerId", account.customerId)).take(101);
    if (subs.length > 100) throw new Error("Billing history needs archival");
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", userId)).unique();
    const complete = account.status === "ended" && account.reconciledAt > 0 && account.reconciledAt >= (request?.requestedAt ?? 0) && !account.failureCode && subs.every(s => ["canceled", "unpaid"].includes(s.status));
    if (!complete) await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId: account.customerId });
    return { complete };
  },
});

// An operation lease serializes checkout creation and subscription commands.
// Lost checkout responses recover by listing provider sessions after the lease.
export const beginOperation = internalMutation({
  args: {}, returns: v.number(), handler: async ctx => {
    const user = await requireUser(ctx); const account = await accountForUser(ctx, user._id);
    if (!account) throw new ConvexError({ code: "CUSTOMER_NOT_FOUND" });
    if ((account.operationLeaseUntil ?? 0) > Date.now()) throw new ConvexError({ code: "BILLING_OPERATION_PENDING" });
    const lease = Date.now() + 120_000;
    await ctx.db.patch("billingAccounts", account._id, { operationLeaseUntil: lease }); return lease;
  },
});
export const endOperation = internalMutation({
  args: { lease: v.number() }, returns: v.null(), handler: async (ctx, { lease }) => {
    const user = await requireUser(ctx); const account = await accountForUser(ctx, user._id);
    if (account?.operationLeaseUntil === lease) await ctx.db.patch("billingAccounts", account._id, { operationLeaseUntil: undefined });
    return null;
  },
});
export const requestRevocation = internalMutation({
  args: { userId: v.id("users"), subscriptionId: v.string() }, returns: v.null(),
  handler: async (ctx, { userId, subscriptionId }) => {
    const account = await accountForUser(ctx, userId);
    const subscription = await ctx.db.query("billingSubscriptions").withIndex("by_subscriptionId", q => q.eq("subscriptionId", subscriptionId)).unique();
    if (!account || !subscription || subscription.customerId !== account.customerId) throw new Error("Subscription ownership conflict");
    await ctx.db.patch("billingSubscriptions", subscription._id, { superseded: true });
    if (account.subscriptionId === subscriptionId) await ctx.db.patch("billingAccounts", account._id, {
      status: "ended", model: undefined, subscriptionId: undefined, paidThrough: undefined, cancelAtPeriodEnd: false });
    await ctx.db.patch("billingAccounts", account._id, { nextCheckAt: Date.now(), failureCode: "RECURRING_CLEANUP_PENDING" });
    await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId: account.customerId });
    return null;
  },
});

export const cleanupContext = internalQuery({
  args: { userId: v.id("users") }, returns: v.object({ user: schema.doc("users"), account: accountDoc }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user || user.lifecycle === "active") throw new Error("Deletion must be requested first");
    const account = await accountForUser(ctx, userId) ?? await ctx.db.query("billingAccounts")
      .withIndex("by_externalId", q => q.eq("externalId", externalCustomerId(user.tokenIdentifier))).unique();
    return { user, account };
  },
});
