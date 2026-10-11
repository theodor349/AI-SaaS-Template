// NOTE: You can remove this file. Declaring the shape
// of the database is entirely optional in Convex.
// See https://docs.convex.dev/database/schemas.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema(
  {
    users: defineTable({
      tokenIdentifier: v.string(),
      clerkId: v.string(),
      email: v.optional(v.string()),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      profileEdited: v.optional(v.boolean()),
      profileUpdatedAt: v.number(),
      profileEventAt: v.number(),
      lifecycle: v.union(v.literal("active"), v.literal("deletion_requested"), v.literal("deleted")),
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
    billingAccounts: defineTable({
      customerId: v.string(), externalId: v.optional(v.string()), userId: v.optional(v.id("users")),
      status: v.union(v.literal("awaiting_payment"), v.literal("active"), v.literal("ended")),
      model: v.optional(v.union(v.literal("monthly"), v.literal("yearly"), v.literal("lifetime"))),
      subscriptionId: v.optional(v.string()), lifetimeOrderId: v.optional(v.string()),
      paidThrough: v.optional(v.number()), cancelAtPeriodEnd: v.boolean(),
      lastDeliveryAt: v.optional(v.number()),
      revision: v.number(), reconciledAt: v.number(), nextCheckAt: v.number(),
      requestedVersion: v.number(), completedVersion: v.number(),
      leaseUntil: v.number(), leaseVersion: v.optional(v.number()), attempts: v.number(), failureCode: v.optional(v.string()),
      operationLeaseUntil: v.optional(v.number()),
      checkoutId: v.optional(v.string()), checkoutUrl: v.optional(v.string()), checkoutExpiresAt: v.optional(v.number()),
    }).index("by_customerId", ["customerId"])
      .index("by_externalId", ["externalId"])
      .index("by_userId", ["userId"])
      .index("by_nextCheckAt", ["nextCheckAt"])
      .index("by_failureCode", ["failureCode"]),
    billingSubscriptions: defineTable({
      customerId: v.string(), subscriptionId: v.string(), productId: v.string(),
      superseded: v.boolean(), status: v.string(), paidThrough: v.number(),
      cancelAtPeriodEnd: v.boolean(), modifiedAt: v.number(), periodStart: v.number(),
    }).index("by_subscriptionId", ["subscriptionId"])
      .index("by_customerId", ["customerId"]),
    billingOrders: defineTable({
      customerId: v.string(), orderId: v.string(), productId: v.string(),
      subscriptionId: v.optional(v.string()), paid: v.boolean(), fullyRefunded: v.boolean(),
      createdAt: v.number(), modifiedAt: v.number(),
    }).index("by_orderId", ["orderId"])
      .index("by_customerId", ["customerId"]),
    billingProducts: defineTable({
      model: v.union(v.literal("monthly"), v.literal("yearly"), v.literal("lifetime")),
      productId: v.string(), name: v.string(), amount: v.number(), currency: v.string(),
      taxBehavior: v.string(), syncedAt: v.number(),
    }).index("by_model", ["model"]),

  },
  // If you ever get an error about schema mismatch
  // between your data and your schema, and you cannot
  // change the schema to match the current data in your database,
  // you can:
  //  1. Use the dashboard to delete tables or individual documents
  //     that are causing the error.
  //  2. Change this option to `false` and make changes to the data
  //     freely, ignoring the schema. Don't forget to change back to `true`!
  { schemaValidation: true }
);
