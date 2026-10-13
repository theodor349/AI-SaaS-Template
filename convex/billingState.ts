import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  accountForCustomer,
  accountForUser,
  externalCustomerId,
  productModel,
  requireUser,
  scheduledRetries,
  syncForCustomer,
} from "./lib/billing";
import {
  computeEntitlement,
  ended,
  entitlementOf,
  erasedEntitlement,
  nextScheduledCheck,
  sameEntitlement,
  sameValues,
  type Entitlement,
} from "./lib/entitlement";
import schema, { scheduledPlanChange } from "./schema";
import { deliveryArgs, deliveryResult, processDelivery } from "./webhooks";

const leaseMs = 120_000;
const sweepPage = 100;

const subscription = v.object({
  id: v.string(),
  productId: v.string(),
  status: v.string(),
  start: v.number(),
  end: v.number(),
  modifiedAt: v.number(),
  cancelAtPeriodEnd: v.boolean(),
  scheduledChange: v.optional(scheduledPlanChange),
});
const order = v.object({
  id: v.string(),
  productId: v.string(),
  subscriptionId: v.optional(v.string()),
  paid: v.boolean(),
  fullyRefunded: v.boolean(),
  createdAt: v.number(),
  modifiedAt: v.number(),
});
export const snapshot = v.object({
  customerId: v.string(),
  externalId: v.optional(v.string()),
  subscriptions: v.array(subscription),
  orders: v.array(order),
});
const accountDoc = v.union(v.null(), schema.doc("billingAccounts"));

export const owned = internalQuery({
  args: {},
  returns: v.object({ user: schema.doc("users"), account: accountDoc }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { user, account: await accountForUser(ctx, user._id) };
  },
});

export const get = internalQuery({
  args: { customerId: v.string() },
  returns: accountDoc,
  handler: (ctx, { customerId }) => accountForCustomer(ctx, customerId),
});

export const getSync = internalQuery({
  args: { customerId: v.string() },
  returns: v.union(v.null(), schema.doc("billingSync")),
  handler: (ctx, { customerId }) => syncForCustomer(ctx, customerId),
});

async function ensureSync(ctx: MutationCtx, customerId: string) {
  const existing = await syncForCustomer(ctx, customerId);
  if (existing) {
    return existing;
  }
  const id = await ctx.db.insert("billingSync", { customerId, requestedVersion: 0, leaseUntil: 0, attempts: 0 });
  const created = await ctx.db.get("billingSync", id);
  if (!created) {
    throw new Error("Billing sync missing");
  }
  return created;
}

// Records a newer reconciliation request. A running worker sees it in
// `finish` and runs again, so no request is lost while a lease is held.
async function requestReconciliation(ctx: MutationCtx, customerId: string) {
  const sync = await ensureSync(ctx, customerId);
  await ctx.db.patch("billingSync", sync._id, {
    requestedVersion: sync.requestedVersion + 1,
    nextCheckAt: Date.now() + leaseMs,
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId });
  return sync._id;
}

// Every publication gets a new revision and re-arms the expiry job.
async function writeEntitlement(ctx: MutationCtx, account: Doc<"billingAccounts">, entitlement: Entitlement) {
  const revision = account.revision + 1;
  await ctx.db.patch("billingAccounts", account._id, { ...entitlementOf(entitlement), revision });
  if (entitlement.paidThrough !== undefined) {
    await ctx.scheduler.runAt(entitlement.paidThrough, internal.billingState.expire, {
      accountId: account._id,
      revision,
    });
  }
}

// Publishes only real changes, so subscribers don't re-run on no-op passes.
async function publish(ctx: MutationCtx, account: Doc<"billingAccounts">, entitlement: Entitlement) {
  if (!sameEntitlement(entitlementOf(account), entitlement)) {
    await writeEntitlement(ctx, account, entitlement);
  }
}

async function linkIdentity(
  ctx: MutationCtx,
  account: Doc<"billingAccounts">,
  userId: Id<"users"> | undefined,
  externalId: string | undefined,
) {
  const link = { userId: userId ?? account.userId, externalId: externalId ?? account.externalId };
  if (link.userId !== account.userId || link.externalId !== account.externalId) {
    await ctx.db.patch("billingAccounts", account._id, link);
  }
}

export const enqueue = internalMutation({
  args: { customerId: v.string(), externalId: v.optional(v.string()) },
  returns: v.id("billingAccounts"),
  handler: async (ctx, { customerId, externalId }) => {
    const account = await accountForCustomer(ctx, customerId);
    // Signed/provider-verified repairs may fix an unclaimed legacy identity.
    // Once linked to an application owner, the association is immutable.
    if (account?.userId && account.externalId && externalId && account.externalId !== externalId) {
      throw new Error("Customer identity conflict");
    }
    if (account) {
      await linkIdentity(ctx, account, undefined, externalId);
      await requestReconciliation(ctx, customerId);
      return account._id;
    }
    const accountId = await ctx.db.insert("billingAccounts", {
      customerId,
      externalId,
      status: "awaiting_payment",
      cancelAtPeriodEnd: false,
      revision: 0,
    });
    await requestReconciliation(ctx, customerId);
    return accountId;
  },
});

// The signed webhook owns only a durable reconciliation request. Shared delivery
// processing commits that request and delivery success in the same transaction.
export const process = internalMutation({
  args: { ...deliveryArgs, customerId: v.string(), externalId: v.optional(v.string()), scoped: v.boolean() },
  returns: deliveryResult,
  handler: async (ctx, args): Promise<"success" | "duplicate" | "failure"> => {
    const existing = await accountForCustomer(ctx, args.customerId);
    // Foreign worktree events never enter retries.
    if (!args.scoped && !existing) {
      return "success";
    }
    const delivery = { provider: args.provider, deliveryId: args.deliveryId, eventType: args.eventType };
    const request = { customerId: args.customerId, externalId: args.externalId };
    const result = await processDelivery(ctx, delivery, internal.billingState.enqueue, request);
    if (result === "success") {
      const sync = await syncForCustomer(ctx, args.customerId);
      if (sync) {
        await ctx.db.patch("billingSync", sync._id, { lastDeliveryAt: Date.now() });
      }
    }
    return result;
  },
});

export const claim = internalMutation({
  args: { customerId: v.string(), externalId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.externalId !== externalCustomerId(user.tokenIdentifier)) {
      throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    }
    const existing = await accountForUser(ctx, user._id);
    if (existing && existing.customerId !== args.customerId) {
      throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    }
    const account = await accountForCustomer(ctx, args.customerId);
    const otherOwner = account?.userId && account.userId !== user._id;
    const otherIdentity = account?.externalId && account.externalId !== args.externalId;
    if (!account || otherOwner || otherIdentity) {
      throw new ConvexError({ code: "CUSTOMER_IDENTITY_CONFLICT" });
    }
    await linkIdentity(ctx, account, user._id, args.externalId);
    return null;
  },
});

export const lease = internalMutation({
  args: { customerId: v.string() },
  returns: v.union(v.null(), v.object({ version: v.number(), account: schema.doc("billingAccounts") })),
  handler: async (ctx, { customerId }) => {
    const account = await accountForCustomer(ctx, customerId);
    if (!account) {
      return null;
    }
    const sync = await ensureSync(ctx, customerId);
    const now = Date.now();
    if (sync.leaseUntil > now) {
      return null;
    }
    const version = sync.requestedVersion + 1;
    // The sweep retries a crashed worker once its lease expires.
    await ctx.db.patch("billingSync", sync._id, {
      requestedVersion: version,
      leaseVersion: version,
      leaseUntil: now + leaseMs,
      nextCheckAt: now + leaseMs,
    });
    return { version, account };
  },
});

type SnapshotSubscription = Infer<typeof subscription>;
type SnapshotOrder = Infer<typeof order>;

// The owning user comes from the immutable link, or from a worktree-scoped
// external ID for a customer created before signup.
async function snapshotOwner(ctx: QueryCtx, account: Doc<"billingAccounts">, externalId: string | undefined) {
  if (account.userId) {
    return ctx.db.get("users", account.userId);
  }
  const prefix = `${env.WORKTREE_ID}:`;
  if (!externalId?.startsWith(prefix)) {
    return null;
  }
  const tokenIdentifier = externalId.slice(prefix.length);
  return ctx.db.query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

async function saveOrder(ctx: MutationCtx, customerId: string, item: SnapshotOrder) {
  const old = await ctx.db.query("billingOrders")
    .withIndex("by_orderId", (q) => q.eq("orderId", item.id))
    .unique();
  if (old && old.customerId !== customerId) {
    throw new Error("Order ownership conflict");
  }
  // A stale provider read never overwrites newer stored state.
  if (old && old.modifiedAt > item.modifiedAt) {
    return;
  }
  const fields = {
    customerId,
    orderId: item.id,
    productId: item.productId,
    subscriptionId: item.subscriptionId,
    paid: item.paid,
    fullyRefunded: item.fullyRefunded,
    createdAt: item.createdAt,
    modifiedAt: item.modifiedAt,
  };
  if (!old) {
    await ctx.db.insert("billingOrders", fields);
  } else if (!sameValues(old, fields)) {
    await ctx.db.patch("billingOrders", old._id, fields);
  }
}

function subscriptionSnapshot(item: SnapshotSubscription) {
  return {
    subscriptionId: item.id,
    productId: item.productId,
    status: item.status,
    periodStart: item.start,
    paidThrough: item.end,
    cancelAtPeriodEnd: item.cancelAtPeriodEnd,
    modifiedAt: item.modifiedAt,
    scheduledChange: item.scheduledChange,
  };
}

function renews(item: SnapshotSubscription) {
  return item.status !== "canceled" && item.status !== "unpaid" && !item.cancelAtPeriodEnd;
}

// Publishes a leased provider snapshot. Returns subscriptions the caller must
// revoke at the provider; the lease is kept until that cleanup finishes.
export const apply = internalMutation({
  args: { snapshot, version: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { snapshot: state, version }) => {
    const { customerId } = state;
    const account = await accountForCustomer(ctx, customerId);
    const sync = await syncForCustomer(ctx, customerId);
    // Only the newest leased request may publish; a newer request reruns.
    if (!account || !sync || sync.leaseVersion !== version || sync.requestedVersion !== version) {
      return [];
    }
    if (account.userId && account.externalId && state.externalId && account.externalId !== state.externalId) {
      throw new Error("Customer identity conflict");
    }
    const user = await snapshotOwner(ctx, account, state.externalId);
    if (user) {
      const other = await accountForUser(ctx, user._id);
      if (other && other._id !== account._id) {
        throw new Error("Customer identity conflict");
      }
    }
    await linkIdentity(ctx, account, user?._id, state.externalId);
    const snapshotSubscriptions = state.subscriptions.map(subscriptionSnapshot);
    const deletion = user
      ? await ctx.db.query("accountLifecycleRequests").withIndex("by_userId", (q) => q.eq("userId", user._id)).unique()
      : null;

    // Erased owners keep no history; only provider cleanup remains.
    if (user && (user.lifecycle === "deleted" || deletion?.erasing)) {
      const erased = erasedEntitlement(snapshotSubscriptions);
      await publish(ctx, account, erased.entitlement);
      return erased.revoke;
    }

    for (const item of state.orders) {
      await saveOrder(ctx, customerId, item);
    }
    const orders = await ctx.db.query("billingOrders")
      .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
      .take(1001);
    if (orders.length > 1000) {
      throw new Error("Billing history needs archival");
    }
    const stored = await ctx.db.query("billingSubscriptions")
      .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
      .take(101);
    if (stored.length > 100) {
      throw new Error("Billing history needs archival");
    }
    for (const item of state.subscriptions) {
      const existing = await ctx.db.query("billingSubscriptions")
        .withIndex("by_subscriptionId", (q) => q.eq("subscriptionId", item.id))
        .unique();
      if (existing && existing.customerId !== customerId) {
        throw new Error("Subscription ownership conflict");
      }
    }

    const deleting = !!user && user.lifecycle !== "active";
    // A portal/provider change during the deletion window must stop renewal again.
    if (deletion?.status === "pending" && !deleting && state.subscriptions.some(renews)) {
      await ctx.db.patch("accountLifecycleRequests", deletion._id, { cancellationConfirmed: false });
      await ctx.scheduler.runAfter(0, internal.accountLifecycle.process, { requestId: deletion._id });
    }

    const decision = computeEntitlement({
      previous: entitlementOf(account),
      orders,
      stored,
      snapshot: snapshotSubscriptions,
      deleting,
      now: Date.now(),
      modelOf: productModel,
    });
    for (const record of decision.changed) {
      const existing = stored.find((s) => s.subscriptionId === record.subscriptionId);
      if (existing) {
        await ctx.db.patch("billingSubscriptions", existing._id, record);
      } else {
        await ctx.db.insert("billingSubscriptions", { customerId, ...record });
      }
    }
    await publish(ctx, account, decision.entitlement);
    // Failed cleanup stays visible in recovery issues if the worker stops.
    if (decision.revoke.length) {
      await ctx.db.patch("billingSync", sync._id, { failureCode: "RECURRING_CLEANUP_PENDING" });
    }
    return decision.revoke;
  },
});

function retryDelay(attempts: number) {
  return Math.min(60 * 60_000, 1000 * 2 ** Math.min(attempts, 12));
}

export const finish = internalMutation({
  args: { customerId: v.string(), version: v.number(), failed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { customerId, version, failed }) => {
    const sync = await syncForCustomer(ctx, customerId);
    if (!sync || sync.leaseVersion !== version) {
      return null;
    }
    const account = await accountForCustomer(ctx, customerId);
    const now = Date.now();
    const attempts = failed ? sync.attempts + 1 : 0;
    const pending = sync.requestedVersion !== version;
    const delay = failed ? retryDelay(attempts) : 0;
    let nextCheckAt: number | undefined;
    if (failed) {
      nextCheckAt = now + delay;
    } else if (pending) {
      nextCheckAt = now + leaseMs;
    } else if (account) {
      const subscriptions = await ctx.db.query("billingSubscriptions")
        .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
        .take(100);
      nextCheckAt = nextScheduledCheck(entitlementOf(account), subscriptions, now);
    }
    let failureCode: string | undefined;
    if (failed) {
      failureCode = "RECONCILIATION_FAILED";
    } else if (!account?.userId) {
      failureCode = "CUSTOMER_LINK_REQUIRED";
    }
    await ctx.db.patch("billingSync", sync._id, {
      leaseUntil: 0,
      attempts,
      nextCheckAt,
      failureCode,
      reconciledAt: failed ? sync.reconciledAt : now,
    });
    if (failed) {
      console.error("Billing reconciliation requires recovery", { customerId, attempts });
    }
    // After the scheduled retries, the sweep keeps retrying at nextCheckAt.
    if (pending || (failed && attempts <= scheduledRetries)) {
      await ctx.scheduler.runAfter(delay, internal.polar.reconcileCustomer, { customerId });
    }
    return null;
  },
});

export const expire = internalMutation({
  args: { accountId: v.id("billingAccounts"), revision: v.number() },
  returns: v.null(),
  handler: async (ctx, { accountId, revision }) => {
    const row = await ctx.db.get("billingAccounts", accountId);
    if (!row || row.revision !== revision || row.paidThrough === undefined || row.paidThrough > Date.now()) {
      return null;
    }
    await writeEntitlement(ctx, row, ended);
    // A renewal may already be paid; the provider decides whether access resumes.
    await requestReconciliation(ctx, row.customerId);
    return null;
  },
});

// Starts reconciliation for every due account. Pages continue in the same
// sweep until caught up, so no fixed per-minute ceiling applies.
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query("billingSync")
      .withIndex("by_nextCheckAt", (q) => q.gte("nextCheckAt", 0).lte("nextCheckAt", now))
      .take(sweepPage);
    for (const row of due) {
      // Moving the check out of range lets the next page start after this one.
      await ctx.db.patch("billingSync", row._id, { nextCheckAt: now + leaseMs });
      await ctx.scheduler.runAfter(0, internal.polar.reconcileCustomer, { customerId: row.customerId });
    }
    if (due.length === sweepPage) {
      await ctx.scheduler.runAfter(0, internal.billingState.sweep, {});
    }
    return null;
  },
});

// Called only after provider pages confirm that no live subscriptions remain.
export const confirmProviderCleanup = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user || user.lifecycle === "active") {
      throw new Error("Deletion must be committed first");
    }
    const account = await accountForUser(ctx, userId) ?? await ctx.db.query("billingAccounts")
      .withIndex("by_externalId", (q) => q.eq("externalId", externalCustomerId(user.tokenIdentifier)))
      .unique();
    if (!account) {
      return null;
    }
    if (account.userId && account.userId !== userId) {
      throw new Error("Customer identity conflict");
    }
    await linkIdentity(ctx, account, userId, undefined);
    await publish(ctx, account, ended);
    const sync = await syncForCustomer(ctx, account.customerId);
    if (sync?.failureCode) {
      await ctx.db.patch("billingSync", sync._id, { failureCode: undefined, reconciledAt: Date.now() });
    }
    return null;
  },
});

// An operation lease serializes checkout creation and subscription commands.
// Lost checkout responses recover by listing provider sessions after the lease.
export const beginOperation = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const account = await accountForUser(ctx, user._id);
    if (!account) {
      throw new ConvexError({ code: "CUSTOMER_NOT_FOUND" });
    }
    const sync = await ensureSync(ctx, account.customerId);
    if ((sync.operationLeaseUntil ?? 0) > Date.now()) {
      throw new ConvexError({ code: "BILLING_OPERATION_PENDING" });
    }
    const deletion = await ctx.db.query("accountLifecycleRequests")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (deletion?.status === "pending") {
      throw new ConvexError({ code: "DELETION_PENDING" });
    }
    const lease = Date.now() + leaseMs;
    await ctx.db.patch("billingSync", sync._id, { operationLeaseUntil: lease });
    return lease;
  },
});

export const endOperation = internalMutation({
  args: { lease: v.number() },
  returns: v.null(),
  handler: async (ctx, { lease }) => {
    const user = await requireUser(ctx);
    const account = await accountForUser(ctx, user._id);
    const sync = account ? await syncForCustomer(ctx, account.customerId) : null;
    if (sync?.operationLeaseUntil === lease) {
      await ctx.db.patch("billingSync", sync._id, { operationLeaseUntil: undefined });
    }
    return null;
  },
});

// Clients confirm an explicit subscription change by waiting for a newer
// revision that matches the request. When the provider already matched, or
// another worker publishes later, bump the revision so the request still settles.
export const confirmChange = internalMutation({
  args: { customerId: v.string(), revision: v.number() },
  returns: v.null(),
  handler: async (ctx, { customerId, revision }) => {
    const account = await accountForCustomer(ctx, customerId);
    if (account && account.revision === revision) {
      await writeEntitlement(ctx, account, entitlementOf(account));
    }
    return null;
  },
});

export const requestRevocation = internalMutation({
  args: { userId: v.id("users"), subscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, subscriptionId }) => {
    const account = await accountForUser(ctx, userId);
    const subscription = await ctx.db.query("billingSubscriptions")
      .withIndex("by_subscriptionId", (q) => q.eq("subscriptionId", subscriptionId))
      .unique();
    if (!account || !subscription || subscription.customerId !== account.customerId) {
      throw new Error("Subscription ownership conflict");
    }
    await ctx.db.patch("billingSubscriptions", subscription._id, { superseded: true });
    if (account.subscriptionId === subscriptionId) {
      await publish(ctx, account, ended);
    }
    const syncId = await requestReconciliation(ctx, account.customerId);
    await ctx.db.patch("billingSync", syncId, { failureCode: "RECURRING_CLEANUP_PENDING" });
    return null;
  },
});

export const cleanupContext = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({ user: schema.doc("users"), account: accountDoc }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) {
      throw new Error("User missing");
    }
    const request = await ctx.db.query("accountLifecycleRequests")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (user.lifecycle === "active" && request?.status !== "pending") {
      throw new Error("Deletion must be requested first");
    }
    const account = await accountForUser(ctx, userId) ?? await ctx.db.query("billingAccounts")
      .withIndex("by_externalId", (q) => q.eq("externalId", externalCustomerId(user.tokenIdentifier)))
      .unique();
    return { user, account };
  },
});
