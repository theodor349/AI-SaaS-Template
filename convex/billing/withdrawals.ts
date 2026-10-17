import { v } from "convex/values";
import { appConfig } from "../../app.config";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { accountForCustomer, accountForUser, productModel, scheduledRetries } from "./lib";
import { billingModel, planLabels } from "./plans";
import { exportMany, exportTime } from "../lib/dataExport";
import { sendEmail } from "../lib/email";
import { appError } from "../lib/errors";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import { isLeased, leaseDeadline, retryDelay } from "../lib/retry";
import { getCurrentUser, requireUser } from "../lib/users";
import { legalTimeZone, purchases as purchasesOf, type Purchase } from "./withdrawalPeriod";
import schema from "../schema";

// How long to wait before checking a refund Polar is still processing.
const refundCheckDelay = 5 * 60_000;
// The most withdrawals a repeat-withdrawal alert lists.
const alertHistoryLimit = 100;

async function ownedPurchases(ctx: Pick<QueryCtx, "db">, customerId: string) {
  // Reconciliation keeps at most 1000 orders per customer.
  const orders = await ctx.db.query("billingOrders")
    .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
    .take(1000);
  return purchasesOf(orders, productModel);
}

function withdrawalForOrder(ctx: Pick<QueryCtx, "db">, orderId: string) {
  return ctx.db.query("withdrawals")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .unique();
}

// The billing page's purchases that can be or have been withdrawn. The client
// hides a purchase's control at `withdrawUntil`; `request` enforces it.
export const purchases = query({
  args: {},
  returns: v.array(v.object({
    orderId: v.string(),
    model: billingModel,
    purchasedAt: v.number(),
    withdrawUntil: v.number(),
    withdrawal: v.union(v.null(), v.object({
      status: v.union(v.literal("pending"), v.literal("refunded")),
      receivedAt: v.number(),
      refundedAt: v.union(v.number(), v.null()),
      failed: v.boolean(),
    })),
  })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const account = user?.lifecycle === "active" ? await accountForUser(ctx, user._id) : null;
    if (!user || !account) {
      return [];
    }
    const listed = await Promise.all((await ownedPurchases(ctx, account.customerId)).map(async (purchase) => {
      const found = await withdrawalForOrder(ctx, purchase.orderId);
      return { purchase, withdrawal: found?.userId === user._id ? found : null };
    }));
    return listed.flatMap(({ purchase, withdrawal }) => {
      if (!withdrawal && purchase.refundOrderIds.length === 0) {
        return [];
      }
      return [{
        orderId: purchase.orderId,
        model: purchase.model,
        purchasedAt: purchase.purchasedAt,
        withdrawUntil: purchase.withdrawUntil,
        withdrawal: withdrawal ? {
          status: withdrawal.status,
          receivedAt: withdrawal.receivedAt,
          refundedAt: withdrawal.refundedAt ?? null,
          failed: !!withdrawal.failureCode,
        } : null,
      }];
    });
  },
});

function danishDate(timestamp: number, time = false) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: legalTimeZone, dateStyle: "long", ...(time ? { timeStyle: "long" } : {}),
  }).format(timestamp);
}

// The acknowledgement on a durable medium that §20 a requires: what was
// withdrawn and when the withdrawal was received.
function receipt(email: string, purchase: Purchase, receivedAt: number) {
  const { appName, companyName, companyCvr, companyAddress, supportEmail } = appConfig;
  return {
    to: email,
    subject: `${appName}: we received your withdrawal`,
    replyTo: [supportEmail],
    text: [
      `We received your withdrawal from your ${appName} purchase on ${danishDate(receivedAt, true)}.`,
      "",
      `Purchase: ${planLabels[purchase.model]}`,
      `Order: ${purchase.orderId}`,
      `Purchased on: ${danishDate(purchase.purchasedAt)}`,
      `Account: ${email}`,
      `Withdrawal received: ${danishDate(receivedAt, true)}`,
      "",
      "We'll refund the full amount through Polar, our reseller, to your original payment method no later than " +
        `14 days after we received your withdrawal. Your ${appName} Pro access ends when the refund is made.`,
      "",
      `Keep this email as your receipt. If you have questions, reply to it or write to ${supportEmail}.`,
      "",
      `${companyName}, CVR ${companyCvr}, ${companyAddress}`,
    ].join("\n"),
  };
}

// Polar sends no refund email of its own, so this tells the owner the
// withdrawal is complete.
function refundNotice(email: string, withdrawal: Doc<"withdrawals">, refundedAt: number) {
  const { appName, companyName, companyCvr, companyAddress, supportEmail } = appConfig;
  return {
    to: email,
    subject: `${appName}: your refund has been made`,
    replyTo: [supportEmail],
    text: [
      `We refunded your ${appName} purchase in full on ${danishDate(refundedAt, true)}, completing your withdrawal.`,
      "",
      `Purchase: ${planLabels[withdrawal.model]}`,
      `Order: ${withdrawal.orderId}`,
      `Withdrawal received: ${danishDate(withdrawal.receivedAt, true)}`,
      "",
      "The refund goes to your original payment method and can take a few business days to appear on your statement. " +
        `Your ${appName} Pro access has ended.`,
      "",
      `If you have questions, reply to this email or write to ${supportEmail}.`,
      "",
      `${companyName}, CVR ${companyCvr}, ${companyAddress}`,
    ].join("\n"),
  };
}

// Tells the operator a user withdrew again, identifying them only by user ID.
function repeatWithdrawalAlert(to: string, userId: Id<"users">, history: Doc<"withdrawals">[]) {
  const count = history.length < alertHistoryLimit ? `${history.length}` : `at least ${alertHistoryLimit}`;
  return {
    to,
    subject: `${appConfig.appName}: repeat withdrawal`,
    text: [
      `User ${userId} withdrew from a purchase again and has made ${count} withdrawals, newest first:`,
      ...history.flatMap((w) => [
        "",
        `Order: ${w.orderId}`,
        `Purchase: ${planLabels[w.model]}`,
        `Purchased on: ${danishDate(w.purchasedAt)}`,
        `Withdrawal received: ${danishDate(w.receivedAt, true)}`,
        `Status: ${w.status}`,
      ]),
      "",
      "The withdrawal was received as usual. Look the user up in the Convex dashboard to decide whether to act.",
    ].join("\n"),
  };
}

// Each purchase carries its own right of withdrawal, so buying, withdrawing,
// and buying again can't be refused; the operator is told instead. Detection is
// per account: a user who deletes their account and signs up again has a new
// ID, and erasure removes their settled withdrawals, so that isn't caught.
async function alertOnRepeatWithdrawal(ctx: MutationCtx, userId: Id<"users">, withdrawalId: Id<"withdrawals">) {
  const history = await ctx.db.query("withdrawals")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(alertHistoryLimit);
  if (history.length < 2) {
    return;
  }
  const alertEmailId = env.OPERATOR_ALERT_EMAIL
    ? await sendEmail(ctx, {
      ...repeatWithdrawalAlert(env.OPERATOR_ALERT_EMAIL, userId, history),
      idempotencyKey: `repeat-withdrawal-alert:${withdrawalId}`,
    })
    : null;
  ctx.log.decision("repeat_withdrawal", { withdrawals: history.length, alert: !!alertEmailId });
  if (!alertEmailId) {
    ctx.log.adminAction("The user withdrew again, but operator alerts aren't configured; review their withdrawals");
  }
}

// Withdraws the owner's purchase, identified by its first order, within the
// period. Repeating a received withdrawal does nothing.
export const request = mutation({
  args: { orderId: v.string() },
  returns: v.null(),
  alwaysLog: true,
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    const account = await accountForUser(ctx, user._id);
    if (!account) {
      throw appError("WITHDRAWAL_UNAVAILABLE");
    }
    ctx.log.setCustomer(account.customerId);
    const existing = await withdrawalForOrder(ctx, orderId);
    if (existing?.userId === user._id) {
      ctx.log.decision("request", { result: "already_received" });
      return null;
    }
    // Purchases come from the caller's own customer, so another user's order is never found.
    const purchase = (await ownedPurchases(ctx, account.customerId)).find((p) => p.orderId === orderId);
    if (existing || !purchase || purchase.refundOrderIds.length === 0) {
      ctx.log.decision("request", { result: "unavailable" });
      throw appError("WITHDRAWAL_UNAVAILABLE");
    }
    const receivedAt = Date.now();
    if (receivedAt >= purchase.withdrawUntil) {
      ctx.log.decision("request", { result: "period_ended" });
      throw appError("WITHDRAWAL_PERIOD_ENDED");
    }
    if (purchase.subscriptionId) ctx.log.setSubscription(purchase.subscriptionId);
    const withdrawalId = await ctx.db.insert("withdrawals", {
      userId: user._id,
      customerId: account.customerId,
      orderId,
      subscriptionId: purchase.subscriptionId,
      model: purchase.model,
      purchasedAt: purchase.purchasedAt,
      receivedAt,
      refundOrderIds: purchase.refundOrderIds,
      status: "pending",
      nextAttemptAt: receivedAt,
      leaseUntil: 0,
      attempts: 0,
    });
    ctx.log.set("withdrawalId", withdrawalId);
    const receiptEmailId = await sendEmail(ctx, {
      ...receipt(user.email!, purchase, receivedAt),
      idempotencyKey: `withdrawal-receipt:${withdrawalId}`,
    });
    if (receiptEmailId) {
      await ctx.db.patch("withdrawals", withdrawalId, { receiptEmailId });
    } else {
      ctx.log.adminAction("Email isn't configured, so the withdrawal receipt wasn't sent; send it from support");
    }
    ctx.log.decision("request", { result: "received", model: purchase.model, receipt: !!receiptEmailId });
    await alertOnRepeatWithdrawal(ctx, user._id, withdrawalId);
    await ctx.scheduler.runAfter(0, internal.billing.polar.withdraw, { withdrawalId });
    return null;
  },
});

export const claim = internalMutation({
  args: { withdrawalId: v.id("withdrawals") },
  returns: v.union(v.null(), v.object({ withdrawal: schema.doc("withdrawals"), lease: v.number() })),
  handler: async (ctx, { withdrawalId }) => {
    ctx.log.set("withdrawalId", withdrawalId);
    const withdrawal = await ctx.db.get("withdrawals", withdrawalId);
    if (!withdrawal || withdrawal.status !== "pending" || isLeased(withdrawal.leaseUntil)) {
      ctx.log.decision("claim", { result: "skipped", status: withdrawal?.status ?? null });
      return null;
    }
    ctx.log.setUser(withdrawal.userId);
    ctx.log.setCustomer(withdrawal.customerId);
    // The sweep retries a crashed worker once its lease expires.
    const lease = leaseDeadline();
    await ctx.db.patch("withdrawals", withdrawalId, { leaseUntil: lease, nextAttemptAt: lease });
    ctx.log.decision("claim", { result: "claimed", attempts: withdrawal.attempts });
    return { withdrawal, lease };
  },
});

// Records one refund attempt. "waiting" means Polar is still processing a
// refund; it is checked again without counting as a failure. The sweep starts
// the next attempt once `nextAttemptAt` passes.
export const finish = internalMutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    lease: v.number(),
    outcome: v.union(v.literal("refunded"), v.literal("waiting"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, { withdrawalId, lease, outcome }) => {
    ctx.log.set("withdrawalId", withdrawalId);
    const withdrawal = await ctx.db.get("withdrawals", withdrawalId);
    if (!withdrawal || withdrawal.status !== "pending" || withdrawal.leaseUntil !== lease) {
      ctx.log.decision("finish", { result: "stale_lease" });
      return null;
    }
    ctx.log.setUser(withdrawal.userId);
    ctx.log.setCustomer(withdrawal.customerId);
    const now = Date.now();
    if (outcome === "refunded") {
      await completeRefund(ctx, withdrawal, now);
      return null;
    }
    const attempts = outcome === "failed" ? withdrawal.attempts + 1 : withdrawal.attempts;
    const nextAttemptAt = now + (outcome === "failed" ? retryDelay(attempts) : refundCheckDelay);
    await ctx.db.patch("withdrawals", withdrawalId, {
      leaseUntil: 0, attempts, nextAttemptAt, failureCode: outcome === "failed" ? "REFUND_FAILED" : undefined,
    });
    ctx.log.decision("finish", { outcome, attempts });
    if (outcome === "failed") {
      ctx.log.markAsError();
    }
    if (attempts > scheduledRetries) {
      ctx.log.adminAction("A withdrawal refund keeps failing and is owed within 14 days; see billing/withdrawals:recoveryIssues");
    }
    return null;
  },
});

async function completeRefund(ctx: MutationCtx, withdrawal: Doc<"withdrawals">, now: number) {
  ctx.log.decision("finish", { outcome: "refunded" });
  // An erased owner keeps no withdrawal history once the owed refund is made.
  const owner = await ctx.db.get("users", withdrawal.userId);
  if (owner?.lifecycle === "deleted") {
    await ctx.db.delete("withdrawals", withdrawal._id);
    return;
  }
  const refundEmailId = owner?.email
    ? await sendEmail(ctx, { ...refundNotice(owner.email, withdrawal, now), idempotencyKey: `withdrawal-refunded:${withdrawal._id}` })
    : null;
  ctx.log.set("refundEmail", !!refundEmailId);
  await ctx.db.patch("withdrawals", withdrawal._id, {
    status: "refunded", refundedAt: now, leaseUntil: undefined, nextAttemptAt: undefined, attempts: 0, failureCode: undefined,
    refundEmailId: refundEmailId ?? undefined,
  });
  // Reconciliation publishes the refunded orders, which ends paid access.
  if (await accountForCustomer(ctx, withdrawal.customerId)) {
    await ctx.scheduler.runAfter(0, internal.billing.state.enqueue, { customerId: withdrawal.customerId });
  }
}

export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.db.query("withdrawals")
      .withIndex("by_status_and_nextAttemptAt", (q) => q.eq("status", "pending").lte("nextAttemptAt", Date.now()))
      .take(50);
    ctx.log.set("due", due.length);
    for (const withdrawal of due) {
      await ctx.db.patch("withdrawals", withdrawal._id, { nextAttemptAt: leaseDeadline() });
      await ctx.scheduler.runAfter(0, internal.billing.polar.withdraw, { withdrawalId: withdrawal._id });
    }
    return null;
  },
});

// Operational recovery surface for support: withdrawals whose refund is failing.
export const recoveryIssues = internalQuery({
  args: {},
  returns: v.array(schema.doc("withdrawals")),
  handler: (ctx) => ctx.db.query("withdrawals")
    .withIndex("by_failureCode", (q) => q.eq("failureCode", "REFUND_FAILED"))
    .take(100),
});

// Data export section. Retry and lease bookkeeping stay internal.
export const withdrawalsExport = {
  requests: exportMany(
    v.object({
      orderId: v.string(), model: billingModel, purchasedAt: v.string(), receivedAt: v.string(),
      status: v.union(v.literal("pending"), v.literal("refunded")), refundedAt: v.union(v.string(), v.null()),
    }),
    async (ctx, owner, paginationOpts) => {
      const result = await ctx.db.query("withdrawals")
        .withIndex("by_userId", (q) => q.eq("userId", owner._id))
        .paginate(paginationOpts);
      return { ...result, page: result.page.map((w) => ({
        orderId: w.orderId,
        model: w.model,
        purchasedAt: exportTime(w.purchasedAt),
        receivedAt: exportTime(w.receivedAt),
        status: w.status,
        refundedAt: exportTime(w.refundedAt),
      })) };
    },
  ),
};
