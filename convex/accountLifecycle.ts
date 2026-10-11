import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import { accountForUser } from "./lib/billing";
import { clerkTokenIdentifier } from "./lib/clerk";
import schema from "./schema";

const recoveryWindow = 7 * 24 * 60 * 60_000;
async function owner(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.query("users").withIndex("by_tokenIdentifier", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "PROVISIONING_REQUIRED" });
  return user;
}
export const current = query({
  args: {}, returns: v.union(v.null(), v.object({ status: v.union(v.literal("pending"), v.literal("cancelled"), v.literal("completed")),
    source: v.union(v.literal("user"), v.literal("clerk")), deleteAfter: v.union(v.number(), v.null()),
    finalizing: v.boolean(), cancellationConfirmed: v.boolean(), failure: v.boolean() })),
  handler: async ctx => {
    const user = await owner(ctx);
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
    return request ? { status: request.status, source: request.source, deleteAfter: request.deleteAfter ?? null,
      finalizing: user.lifecycle !== "active", cancellationConfirmed: request.cancellationConfirmed ?? false, failure: !!request.failureCode } : null;
  },
});
export const requestDeletion = mutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const user = await owner(ctx);
    if (user.lifecycle !== "active") throw new ConvexError({ code: "ACCOUNT_UNAVAILABLE" });
    const old = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
    if (old?.status === "pending") return null;
    const account = await accountForUser(ctx, user._id);
    if ((account?.operationLeaseUntil ?? 0) > Date.now()) throw new ConvexError({ code: "BILLING_OPERATION_PENDING" });
    const now = Date.now();
    // Keep paid access recoverable; claim commits terminal lifecycle at the deadline.
    const fields = { userId: user._id, source: "user" as const, requestedAt: now, deleteAfter: now + recoveryWindow,
      status: "pending" as const, cancellationConfirmed: false, nextAttemptAt: now, leaseUntil: 0, attempts: 0, failureCode: undefined, sourceDeliveryId: undefined };
    const requestId = old ? old._id : await ctx.db.insert("accountLifecycleRequests", fields);
    if (old) await ctx.db.patch("accountLifecycleRequests", old._id, fields);
    await ctx.scheduler.runAfter(0, internal.accountLifecycle.process, { requestId });
    return null;
  },
});
export const recover = mutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const user = await owner(ctx);
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
    if (!request || request.status !== "pending" || request.source !== "user" || user.lifecycle !== "active" || (request.deleteAfter ?? 0) <= Date.now()) {
      throw new ConvexError({ code: "RECOVERY_UNAVAILABLE" });
    }
    // A cancellation in flight must settle before recovery can allow reactivation.
    if ((request.leaseUntil ?? 0) > Date.now()) throw new ConvexError({ code: "ACCOUNT_OPERATION_PENDING" });
    await ctx.db.patch("accountLifecycleRequests", request._id, { status: "cancelled", nextAttemptAt: undefined, failureCode: undefined });
    return null;
  },
});
// A signed provider deletion supersedes the user window, even out of order.
export const requestClerkDeletion = internalMutation({
  args: { clerkId: v.string(), eventAt: v.number(), deliveryId: v.string() }, returns: v.id("accountLifecycleRequests"),
  handler: async (ctx, { clerkId, eventAt, deliveryId }) => {
    const user = await ctx.db.query("users").withIndex("by_clerkId", q => q.eq("clerkId", clerkId)).unique();
    const userId = user?._id ?? await ctx.db.insert("users", { clerkId, tokenIdentifier: clerkTokenIdentifier(clerkId), lifecycle: "deletion_requested", profileUpdatedAt: 0, profileEventAt: 0 });
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", userId)).unique();
    if (request?.status === "completed") return request._id;
    await ctx.db.patch("users", userId, { lifecycle: "deletion_requested" });
    const fields = { userId, source: "clerk" as const, sourceDeliveryId: request?.sourceDeliveryId ?? deliveryId,
      requestedAt: request?.status === "pending" ? request.requestedAt : eventAt, status: "pending" as const, deleteAfter: Date.now(), nextAttemptAt: Date.now() };
    const requestId = request?._id ?? await ctx.db.insert("accountLifecycleRequests", fields);
    if (request) await ctx.db.patch("accountLifecycleRequests", requestId, fields);
    await ctx.scheduler.runAfter(0, internal.accountLifecycle.process, { requestId });
    return requestId;
  },
});
export const pending = internalQuery({
  args: {}, returns: v.array(schema.doc("accountLifecycleRequests")),
  handler: ctx => ctx.db.query("accountLifecycleRequests").withIndex("by_status", q => q.eq("status", "pending")).take(100),
});
export const claim = internalMutation({
  args: { requestId: v.id("accountLifecycleRequests") },
  returns: v.union(v.null(), v.object({ request: schema.doc("accountLifecycleRequests"), user: schema.doc("users"), lease: v.number(), finalizing: v.boolean() })),
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get("accountLifecycleRequests", requestId);
    if (!request || request.status !== "pending" || (request.leaseUntil ?? 0) > Date.now()) return null;
    const user = await ctx.db.get("users", request.userId);
    if (!user) throw new Error("Lifecycle owner missing");
    const finalizing = request.source === "clerk" || (request.deleteAfter ?? 0) <= Date.now();
    const lease = Date.now() + 120_000;
    await ctx.db.patch("accountLifecycleRequests", requestId, { leaseUntil: lease, nextAttemptAt: lease });
    if (finalizing && user.lifecycle === "active") await ctx.db.patch("users", user._id, { lifecycle: "deletion_requested" });
    return { request, user, lease, finalizing };
  },
});
export const finishAttempt = internalMutation({
  args: { requestId: v.id("accountLifecycleRequests"), lease: v.number(), success: v.boolean(), finalizing: v.boolean() }, returns: v.null(),
  handler: async (ctx, { requestId, lease, success, finalizing }) => {
    const request = await ctx.db.get("accountLifecycleRequests", requestId);
    if (!request || request.status !== "pending" || request.leaseUntil !== lease) return null;
    const attempts = success ? 0 : (request.attempts ?? 0) + 1;
    const nextAttemptAt = success && !finalizing && request.source === "user" ? request.deleteAfter ?? Date.now() : Date.now() + Math.min(60 * 60_000, 1000 * 2 ** Math.min(attempts, 12));
    await ctx.db.patch("accountLifecycleRequests", requestId, { leaseUntil: 0, attempts, nextAttemptAt,
      cancellationConfirmed: success, failureCode: success ? undefined : "ACCOUNT_CLEANUP_PENDING" });
    await ctx.scheduler.runAt(nextAttemptAt, internal.accountLifecycle.process, { requestId });
    return null;
  },
});
export const sweep = internalMutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const requests = await ctx.db.query("accountLifecycleRequests").withIndex("by_status_and_nextAttemptAt", q => q.eq("status", "pending").lte("nextAttemptAt", Date.now())).take(50);
    for (const request of requests) {
      await ctx.db.patch("accountLifecycleRequests", request._id, { nextAttemptAt: Date.now() + 120_000 });
      await ctx.scheduler.runAfter(0, internal.accountLifecycle.process, { requestId: request._id });
    }
    return null;
  },
});
export const context = internalQuery({
  args: { requestId: v.id("accountLifecycleRequests") }, returns: v.union(v.null(), schema.doc("accountLifecycleRequests")),
  handler: (ctx, { requestId }) => ctx.db.get("accountLifecycleRequests", requestId),
});
// Small batches remove cached billing history without exceeding transaction limits.
// Identity tombstones prevent delayed Clerk/Polar events resurrecting an account.
export const beginErasure = internalMutation({
  args: { requestId: v.id("accountLifecycleRequests"), lease: v.number() }, returns: v.boolean(),
  handler: async (ctx, { requestId, lease }) => {
    const request = await ctx.db.get("accountLifecycleRequests", requestId);
    if (!request || request.status !== "pending" || request.leaseUntil !== lease) return false;
    const user = await ctx.db.get("users", request.userId);
    if (!user || user.lifecycle === "active") throw new Error("Deletion not committed");
    // External cleanup is confirmed. Reconciliation must not refill cached history.
    await ctx.db.patch("accountLifecycleRequests", requestId, { erasing: true, attempts: 0, failureCode: undefined });
    return true;
  },
});
export const continueProcessing = internalMutation({
  args: { requestId: v.id("accountLifecycleRequests"), lease: v.number() }, returns: v.null(),
  handler: async (ctx, { requestId, lease }) => {
    const request = await ctx.db.get("accountLifecycleRequests", requestId);
    if (!request || request.status !== "pending" || request.leaseUntil !== lease) return null;
    // A successful batch is progress, including recovery from an earlier exception.
    await ctx.db.patch("accountLifecycleRequests", requestId, { leaseUntil: 0, nextAttemptAt: Date.now(), attempts: 0, failureCode: undefined });
    await ctx.scheduler.runAfter(0, internal.accountLifecycle.process, { requestId });
    return null;
  },
});
export const erase = internalMutation({
  args: { requestId: v.id("accountLifecycleRequests"), lease: v.number() }, returns: v.boolean(),
  handler: async (ctx, { requestId, lease }) => {
    const request = await ctx.db.get("accountLifecycleRequests", requestId);
    if (!request || request.status !== "pending" || request.leaseUntil !== lease || !request.erasing) return false;
    const user = await ctx.db.get("users", request.userId);
    if (!user || user.lifecycle === "active") throw new Error("Deletion not committed");
    const account = await accountForUser(ctx, user._id);
    if (account) {
      for (const table of ["billingOrders", "billingSubscriptions"] as const) {
        const rows = await ctx.db.query(table).withIndex("by_customerId", q => q.eq("customerId", account.customerId)).take(100);
        for (const row of rows) await ctx.db.delete(table, row._id);
        if (rows.length === 100) return false;
      }
      await ctx.db.delete("billingAccounts", account._id);
    }
    await ctx.db.patch("users", user._id, { lifecycle: "deleted", email: undefined, firstName: undefined, lastName: undefined, profileEdited: undefined, profileUpdatedAt: 0, profileEventAt: 0 });
    await ctx.db.patch("accountLifecycleRequests", requestId, { status: "completed", sourceDeliveryId: undefined, nextAttemptAt: undefined, leaseUntil: undefined, failureCode: undefined, attempts: undefined });
    return true;
  },
});
export const process = internalAction({
  args: { requestId: v.id("accountLifecycleRequests") }, returns: v.null(), handler: async (ctx, { requestId }) => {
    const claimed = await ctx.runMutation(internal.accountLifecycle.claim, { requestId });
    if (!claimed) return null;
    let success = false;
    try {
      if (claimed.request.erasing) {
        const complete = await ctx.runMutation(internal.accountLifecycle.erase, { requestId, lease: claimed.lease });
        if (complete) return null;
        await ctx.runMutation(internal.accountLifecycle.continueProcessing, { requestId, lease: claimed.lease });
        return null;
      }
      const billing = await ctx.runAction(internal.polar.cleanupAccount, { userId: claimed.user._id });
      if (billing.progress) {
        await ctx.runMutation(internal.accountLifecycle.continueProcessing, { requestId, lease: claimed.lease });
        return null;
      }
      success = billing.complete;
      if (success && claimed.finalizing) {
        const latest = await ctx.runQuery(internal.accountLifecycle.context, { requestId });
        if (latest?.source !== "clerk") {
          if (!env.CLERK_SECRET_KEY) throw new Error("Clerk configuration missing");
          const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(claimed.user.clerkId)}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` }, signal: AbortSignal.timeout(15000),
          });
          if (!response.ok && response.status !== 404) throw new Error("Identity deletion failed");
        }
        const erasing = await ctx.runMutation(internal.accountLifecycle.beginErasure, { requestId, lease: claimed.lease });
        if (!erasing) return null;
        const complete = await ctx.runMutation(internal.accountLifecycle.erase, { requestId, lease: claimed.lease });
        if (complete) return null;
        await ctx.runMutation(internal.accountLifecycle.continueProcessing, { requestId, lease: claimed.lease });
        return null;
      }
    } catch { success = false; }
    await ctx.runMutation(internal.accountLifecycle.finishAttempt, { requestId, lease: claimed.lease, success, finalizing: claimed.finalizing });
    return null;
  },
});
