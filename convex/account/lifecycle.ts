import { v } from "convex/values";
import { internal } from "../_generated/api";
import { accountForUser, operationForUser, syncForCustomer } from "../billing/lib";
import { clerkTokenIdentifier } from "./clerk";
import { exportMany, exportTime } from "../lib/dataExport";
import { deleteClerkUser } from "./clerkApi";
import { appError } from "../lib/errors";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { isLeased, leaseDeadline, retryDelay } from "../lib/retry";
import { requireOwner, userByClerkId } from "../lib/users";
import { eraseNotes } from "../notes/notes";
import schema from "../schema";

const recoveryWindow = 7 * 24 * 60 * 60_000;
export const current = query({
  args: {}, returns: v.union(v.null(), v.object({ status: v.union(v.literal("pending"), v.literal("cancelled"), v.literal("completed")),
    source: v.union(v.literal("user"), v.literal("clerk")), deleteAfter: v.union(v.number(), v.null()),
    finalizing: v.boolean(), cancellationConfirmed: v.boolean(), failure: v.boolean() })),
  handler: async ctx => {
    const user = await requireOwner(ctx);
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
    return request ? { status: request.status, source: request.source, deleteAfter: request.deleteAfter ?? null,
      finalizing: user.lifecycle !== "active", cancellationConfirmed: request.cancellationConfirmed ?? false, failure: !!request.failureCode } : null;
  },
});
export const requestDeletion = mutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const user = await requireOwner(ctx);
    if (user.lifecycle !== "active") throw appError("ACCOUNT_UNAVAILABLE");
    const old = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
    if (old?.status === "pending") {
      ctx.log.decision("request", { result: "already_pending" });
      return null;
    }
    const account = await accountForUser(ctx, user._id);
    if (account) ctx.log.setCustomer(account.customerId);
    if (isLeased((await operationForUser(ctx, user._id))?.leaseUntil)) {
      throw appError("BILLING_OPERATION_PENDING");
    }
    const now = Date.now();
    // Keep paid access recoverable; claim commits terminal lifecycle at the deadline.
    const fields = { userId: user._id, source: "user" as const, requestedAt: now, deleteAfter: now + recoveryWindow,
      status: "pending" as const, cancellationConfirmed: false, nextAttemptAt: now, leaseUntil: 0, attempts: 0, failureCode: undefined, sourceDeliveryId: undefined };
    const requestId = old ? old._id : await ctx.db.insert("accountLifecycleRequests", fields);
    if (old) await ctx.db.patch("accountLifecycleRequests", old._id, fields);
    ctx.log.set("requestId", requestId);
    ctx.log.decision("request", { result: old ? "renewed" : "created" });
    await ctx.scheduler.runAfter(0, internal.account.lifecycle.process, { requestId });
    return null;
  },
});
export const recover = mutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const user = await requireOwner(ctx);
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
    if (!request || request.status !== "pending" || request.source !== "user" || user.lifecycle !== "active" || (request.deleteAfter ?? 0) <= Date.now()) {
      throw appError("RECOVERY_UNAVAILABLE");
    }
    // A cancellation in flight must settle before recovery can allow reactivation.
    if (isLeased(request.leaseUntil)) throw appError("ACCOUNT_OPERATION_PENDING");
    await ctx.db.patch("accountLifecycleRequests", request._id, { status: "cancelled", nextAttemptAt: undefined, failureCode: undefined });
    return null;
  },
});
// A signed provider deletion supersedes the user window, even out of order.
export const requestClerkDeletion = internalMutation({
  args: { clerkId: v.string(), eventAt: v.number(), deliveryId: v.string() }, returns: v.id("accountLifecycleRequests"),
  handler: async (ctx, { clerkId, eventAt, deliveryId }) => {
    const user = await userByClerkId(ctx, clerkId);
    const userId = user?._id ?? await ctx.db.insert("users", { clerkId, tokenIdentifier: clerkTokenIdentifier(clerkId), lifecycle: "deletion_requested", profileUpdatedAt: 0, profileEventAt: 0 });
    ctx.log.setUser(userId);
    const request = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", userId)).unique();
    ctx.log.decision("request", { userExisted: !!user, previous: request?.status ?? null });
    if (request?.status === "completed") return request._id;
    await ctx.db.patch("users", userId, { lifecycle: "deletion_requested" });
    const fields = { userId, source: "clerk" as const, sourceDeliveryId: request?.sourceDeliveryId ?? deliveryId,
      requestedAt: request?.status === "pending" ? request.requestedAt : eventAt, status: "pending" as const, deleteAfter: Date.now(), nextAttemptAt: Date.now() };
    const requestId = request?._id ?? await ctx.db.insert("accountLifecycleRequests", fields);
    if (request) await ctx.db.patch("accountLifecycleRequests", requestId, fields);
    await ctx.scheduler.runAfter(0, internal.account.lifecycle.process, { requestId });
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
    ctx.log.set("requestId", requestId);
    if (!request || request.status !== "pending" || isLeased(request.leaseUntil)) {
      ctx.log.decision("claim", { result: "skipped", status: request?.status ?? null });
      return null;
    }
    ctx.log.setUser(request.userId);
    const user = await ctx.db.get("users", request.userId);
    if (!user) throw new Error("Lifecycle owner missing");
    const finalizing = request.source === "clerk" || (request.deleteAfter ?? 0) <= Date.now();
    const lease = leaseDeadline();
    await ctx.db.patch("accountLifecycleRequests", requestId, { leaseUntil: lease, nextAttemptAt: lease });
    if (finalizing && user.lifecycle === "active") await ctx.db.patch("users", user._id, { lifecycle: "deletion_requested" });
    ctx.log.decision("claim", { result: "claimed", source: request.source, finalizing, erasing: request.erasing ?? false });
    return { request, user, lease, finalizing };
  },
});
export const finishAttempt = internalMutation({
  args: { requestId: v.id("accountLifecycleRequests"), lease: v.number(), success: v.boolean(), finalizing: v.boolean() }, returns: v.null(),
  handler: async (ctx, { requestId, lease, success, finalizing }) => {
    const request = await ctx.db.get("accountLifecycleRequests", requestId);
    if (!request || request.status !== "pending" || request.leaseUntil !== lease) return null;
    const attempts = success ? 0 : (request.attempts ?? 0) + 1;
    ctx.log.setUser(request.userId);
    ctx.log.set("requestId", requestId);
    ctx.log.decision("attempt", { success, finalizing, attempts });
    const nextAttemptAt = success && !finalizing && request.source === "user" ? request.deleteAfter ?? Date.now() : Date.now() + retryDelay(attempts);
    await ctx.db.patch("accountLifecycleRequests", requestId, { leaseUntil: 0, attempts, nextAttemptAt,
      cancellationConfirmed: success, failureCode: success ? undefined : "ACCOUNT_CLEANUP_PENDING" });
    await ctx.scheduler.runAt(nextAttemptAt, internal.account.lifecycle.process, { requestId });
    return null;
  },
});
export const sweep = internalMutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const requests = await ctx.db.query("accountLifecycleRequests").withIndex("by_status_and_nextAttemptAt", q => q.eq("status", "pending").lte("nextAttemptAt", Date.now())).take(50);
    ctx.log.set("due", requests.length);
    for (const request of requests) {
      await ctx.db.patch("accountLifecycleRequests", request._id, { nextAttemptAt: leaseDeadline() });
      await ctx.scheduler.runAfter(0, internal.account.lifecycle.process, { requestId: request._id });
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
    await ctx.scheduler.runAfter(0, internal.account.lifecycle.process, { requestId });
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
      ctx.log.setCustomer(account.customerId);
      for (const table of ["billingOrders", "billingSubscriptions"] as const) {
        const rows = await ctx.db.query(table).withIndex("by_customerId", q => q.eq("customerId", account.customerId)).take(100);
        for (const row of rows) await ctx.db.delete(table, row._id);
        if (rows.length === 100) {
          ctx.log.decision("erase", { result: "batch", table });
          return false;
        }
      }
      const sync = await syncForCustomer(ctx, account.customerId);
      if (sync) {
        await ctx.db.delete("billingSync", sync._id);
      }
      await ctx.db.delete("billingAccounts", account._id);
    }
    const operation = await operationForUser(ctx, user._id);
    if (operation) await ctx.db.delete("billingOperations", operation._id);
    // A pending withdrawal's refund is still owed; its row goes once the refund is made.
    const withdrawals = await ctx.db.query("withdrawals").withIndex("by_userId", q => q.eq("userId", user._id)).take(100);
    const settled = withdrawals.filter(w => w.status !== "pending");
    for (const withdrawal of settled) await ctx.db.delete("withdrawals", withdrawal._id);
    if (withdrawals.length === 100 && settled.length) {
      ctx.log.decision("erase", { result: "batch", table: "withdrawals" });
      return false;
    }
    if (!await eraseNotes(ctx, user._id)) {
      ctx.log.decision("erase", { result: "batch", table: "notes" });
      return false;
    }
    await ctx.db.patch("users", user._id, { lifecycle: "deleted", email: undefined, displayName: undefined, firstName: undefined, lastName: undefined, profileEdited: undefined, legalAcceptance: undefined, profileUpdatedAt: 0, profileEventAt: 0 });
    await ctx.db.patch("accountLifecycleRequests", requestId, { status: "completed", sourceDeliveryId: undefined, nextAttemptAt: undefined, leaseUntil: undefined, failureCode: undefined, attempts: undefined });
    ctx.log.decision("erase", { result: "completed" });
    return true;
  },
});
export const process = internalAction({
  args: { requestId: v.id("accountLifecycleRequests") }, returns: v.null(), handler: async (ctx, { requestId }) => {
    const claimed = await ctx.runMutation(internal.account.lifecycle.claim, { requestId });
    ctx.log.set("requestId", requestId);
    if (!claimed) return null;
    ctx.log.setUser(claimed.user._id);
    let success = false;
    try {
      if (claimed.request.erasing) {
        const complete = await ctx.runMutation(internal.account.lifecycle.erase, { requestId, lease: claimed.lease });
        if (complete) return null;
        await ctx.runMutation(internal.account.lifecycle.continueProcessing, { requestId, lease: claimed.lease });
        return null;
      }
      const billing = await ctx.runAction(internal.billing.polar.cleanupAccount, { userId: claimed.user._id });
      ctx.log.decision("billing_cleanup", { complete: billing.complete, progress: billing.progress ?? false });
      if (billing.progress) {
        await ctx.runMutation(internal.account.lifecycle.continueProcessing, { requestId, lease: claimed.lease });
        return null;
      }
      success = billing.complete;
      if (success && claimed.finalizing) {
        const latest = await ctx.runQuery(internal.account.lifecycle.context, { requestId });
        if (latest?.source !== "clerk") {
          await deleteClerkUser(claimed.user.clerkId);
          ctx.log.decision("identity", { result: "deleted" });
        }
        const erasing = await ctx.runMutation(internal.account.lifecycle.beginErasure, { requestId, lease: claimed.lease });
        if (!erasing) return null;
        const complete = await ctx.runMutation(internal.account.lifecycle.erase, { requestId, lease: claimed.lease });
        if (complete) return null;
        await ctx.runMutation(internal.account.lifecycle.continueProcessing, { requestId, lease: claimed.lease });
        return null;
      }
    } catch {
      // Called functions in this flow log their own errors; this records the retry.
      success = false;
      ctx.log.decision("cleanup", { result: "failed", code: "ACCOUNT_CLEANUP_PENDING" });
      ctx.log.markAsError();
    }
    await ctx.runMutation(internal.account.lifecycle.finishAttempt, { requestId, lease: claimed.lease, success, finalizing: claimed.finalizing });
    return null;
  },
});
// Data export section. Retry, lease, and provider delivery bookkeeping stay internal.
export const accountLifecycleExport = {
  requests: exportMany(
    v.object({ source: v.union(v.literal("user"), v.literal("clerk")), status: v.union(v.literal("pending"), v.literal("cancelled"), v.literal("completed")),
      requestedAt: v.string(), deleteAfter: v.union(v.string(), v.null()) }),
    async (ctx, owner, paginationOpts) => {
      const result = await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", q => q.eq("userId", owner._id)).paginate(paginationOpts);
      return { ...result, page: result.page.map(request => ({ source: request.source, status: request.status,
        requestedAt: exportTime(request.requestedAt), deleteAfter: exportTime(request.deleteAfter) })) };
    },
  ),
};
