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
      profileUpdatedAt: v.number(),
      profileEventAt: v.number(),
      lifecycle: v.union(v.literal("active"), v.literal("deletion_requested"), v.literal("deleted")),
    }).index("by_tokenIdentifier", ["tokenIdentifier"])
      .index("by_clerkId", ["clerkId"]),
    accountLifecycleRequests: defineTable({
      userId: v.id("users"),
      source: v.literal("clerk"),
      sourceDeliveryId: v.string(),
      requestedAt: v.number(),
      status: v.union(v.literal("pending"), v.literal("completed")),
    }).index("by_userId", ["userId"])
      .index("by_status", ["status"]),
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
    documents: defineTable({
      fieldOne: v.string(),
      fieldTwo: v.object({
        subFieldOne: v.array(v.number()),
      }),
    }),
    // This definition matches the example query and mutation code:
    numbers: defineTable({
      value: v.number(),
    }),
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
