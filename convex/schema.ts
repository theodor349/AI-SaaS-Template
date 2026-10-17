import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { billingModel, recurringModel } from "./lib/billingModel";

export const scheduledPlanChange = v.object({
  model: recurringModel,
  at: v.number(),
});

export default defineSchema(
  {
    users: defineTable({
      tokenIdentifier: v.string(),
      clerkId: v.string(),
      email: v.optional(v.string()),
      displayName: v.optional(v.string()),
      // Accepted for existing profiles; new writes use displayName.
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      profileEdited: v.optional(v.boolean()),
      profileUpdatedAt: v.number(),
      profileEventAt: v.number(),
      lifecycle: v.union(v.literal("active"), v.literal("deletion_requested"), v.literal("deleted")),
      // The terms and privacy notice versions the user last accepted, and when.
      legalAcceptance: v.optional(v.object({ terms: v.number(), privacy: v.number(), acceptedAt: v.number() })),
    }).index("by_tokenIdentifier", ["tokenIdentifier"])
      .index("by_clerkId", ["clerkId"]),
    accountLifecycleRequests: defineTable({
      userId: v.id("users"),
      source: v.union(v.literal("clerk"), v.literal("user")),
      sourceDeliveryId: v.optional(v.string()),
      requestedAt: v.number(),
      status: v.union(v.literal("pending"), v.literal("cancelled"), v.literal("completed")),
      deleteAfter: v.optional(v.number()),
      nextAttemptAt: v.optional(v.number()),
      leaseUntil: v.optional(v.number()),
      cancellationConfirmed: v.optional(v.boolean()),
      erasing: v.optional(v.boolean()),
      attempts: v.optional(v.number()),
      failureCode: v.optional(v.string()),
    }).index("by_userId", ["userId"])
      .index("by_status", ["status"])
      .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"]),
    webhookDeliveries: defineTable({
      provider: v.union(v.literal("clerk"), v.literal("polar")),
      deliveryId: v.string(),
      eventType: v.string(),
      status: v.union(v.literal("success"), v.literal("failure")),
      attempts: v.number(),
      lastAttemptAt: v.number(),
      expiresAt: v.number(),
      failureCode: v.optional(v.string()),
    }).index("by_provider_and_deliveryId", ["provider", "deliveryId"])
      .index("by_expiresAt", ["expiresAt"]),
    // The customer link and published entitlement. Paid queries subscribe to
    // this row, so only entitlement changes may write it; sync bookkeeping
    // belongs in billingSync.
    billingAccounts: defineTable({
      customerId: v.string(),
      externalId: v.optional(v.string()),
      userId: v.optional(v.id("users")),
      status: v.union(v.literal("awaiting_payment"), v.literal("active"), v.literal("ended")),
      model: v.optional(billingModel),
      subscriptionId: v.optional(v.string()),
      lifetimeOrderId: v.optional(v.string()),
      paidThrough: v.optional(v.number()),
      cancelAtPeriodEnd: v.boolean(),
      scheduledChange: v.optional(scheduledPlanChange),
      revision: v.number(),
      // Retired fields, no longer written. Optional so existing documents validate.
      lastDeliveryAt: v.optional(v.number()),
      reconciledAt: v.optional(v.number()),
      nextCheckAt: v.optional(v.number()),
      requestedVersion: v.optional(v.number()),
      completedVersion: v.optional(v.number()),
      leaseUntil: v.optional(v.number()),
      leaseVersion: v.optional(v.number()),
      attempts: v.optional(v.number()),
      failureCode: v.optional(v.string()),
      operationLeaseUntil: v.optional(v.number()),
      checkoutId: v.optional(v.string()),
      checkoutUrl: v.optional(v.string()),
      checkoutExpiresAt: v.optional(v.number()),
    }).index("by_customerId", ["customerId"])
      .index("by_externalId", ["externalId"])
      .index("by_userId", ["userId"]),
    // Reconciliation job state, one per customer.
    billingSync: defineTable({
      customerId: v.string(),
      requestedVersion: v.number(),
      leaseVersion: v.optional(v.number()),
      leaseUntil: v.number(),
      attempts: v.number(),
      // Absent when no timed check is needed; webhooks and actions enqueue work.
      nextCheckAt: v.optional(v.number()),
      reconciledAt: v.optional(v.number()),
      failureCode: v.optional(v.string()),
      // Retired: the operation lock moved to billingOperations. Optional so
      // existing documents validate.
      operationLeaseUntil: v.optional(v.number()),
      lastDeliveryAt: v.optional(v.number()),
    }).index("by_customerId", ["customerId"])
      .index("by_nextCheckAt", ["nextCheckAt"])
      .index("by_failureCode", ["failureCode"]),
    // The billing operation lock, one per user. It is per user rather than per
    // customer so checkout can take it before a Polar customer exists.
    billingOperations: defineTable({
      userId: v.id("users"),
      leaseUntil: v.number(),
    }).index("by_userId", ["userId"]),
    billingSubscriptions: defineTable({
      customerId: v.string(), subscriptionId: v.string(), productId: v.string(),
      superseded: v.boolean(), status: v.string(), paidThrough: v.number(),
      cancelAtPeriodEnd: v.boolean(), modifiedAt: v.number(), periodStart: v.number(),
      scheduledChange: v.optional(scheduledPlanChange),
    }).index("by_subscriptionId", ["subscriptionId"])
      .index("by_customerId", ["customerId"]),
    billingOrders: defineTable({
      customerId: v.string(), orderId: v.string(), productId: v.string(),
      subscriptionId: v.optional(v.string()), paid: v.boolean(), fullyRefunded: v.boolean(),
      createdAt: v.number(), modifiedAt: v.number(),
    }).index("by_orderId", ["orderId"])
      .index("by_customerId", ["customerId"]),
    billingProducts: defineTable({
      model: billingModel,
      productId: v.string(), name: v.string(), amount: v.number(), currency: v.string(),
      taxBehavior: v.string(), syncedAt: v.number(),
    }).index("by_model", ["model"]),
    // Withdrawals under the 14-day right of withdrawal, one per purchase. The
    // refund job retries until Polar confirms every order is refunded.
    withdrawals: defineTable({
      userId: v.id("users"),
      customerId: v.string(),
      // The purchase's first paid order, which identifies it.
      orderId: v.string(),
      subscriptionId: v.optional(v.string()),
      model: billingModel,
      purchasedAt: v.number(),
      receivedAt: v.number(),
      // Every paid order the withdrawal refunds, fixed when it is received.
      refundOrderIds: v.array(v.string()),
      status: v.union(v.literal("pending"), v.literal("refunded")),
      refundedAt: v.optional(v.number()),
      // The receipt in the Resend component; absent when email isn't configured.
      receiptEmailId: v.optional(v.string()),
      // The refund-made email in the Resend component; absent likewise.
      refundEmailId: v.optional(v.string()),
      nextAttemptAt: v.optional(v.number()),
      leaseUntil: v.optional(v.number()),
      attempts: v.number(),
      failureCode: v.optional(v.string()),
    }).index("by_userId", ["userId"])
      .index("by_orderId", ["orderId"])
      .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
      .index("by_failureCode", ["failureCode"]),
    // Per-deployment state for flags declared in lib/featureFlags.ts. A flag
    // without a row uses its default; rows for removed flags are ignored.
    featureFlags: defineTable({
      key: v.string(),
      // On or off for everyone, ahead of the allowlist.
      override: v.optional(v.boolean()),
      // Users who get the flag without an override: the maintainer and a few
      // selected users, not a rollout.
      allowlist: v.optional(v.array(v.id("users"))),
    }).index("by_key", ["key"]),
  },
  { schemaValidation: true }
);
