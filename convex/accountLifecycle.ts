import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { clerkTokenIdentifier } from "./lib/clerk";
import schema from "./schema";

// Issue #5 consumes pending requests, performs cleanup, and marks completion in
// its own durable processor. Retain the identity tombstone when removing PII.
export const requestClerkDeletion = internalMutation({
  args: { clerkId: v.string(), eventAt: v.number(), deliveryId: v.string() },
  returns: v.id("accountLifecycleRequests"),
  handler: async (ctx, { clerkId, eventAt, deliveryId }) => {
    const user = await ctx.db.query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId)).unique();
    const userId = user?._id ?? await ctx.db.insert("users", {
      clerkId, tokenIdentifier: clerkTokenIdentifier(clerkId), lifecycle: "deletion_requested",
      profileUpdatedAt: 0, profileEventAt: 0,
    });
    const request = await ctx.db.query("accountLifecycleRequests")
      .withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
    if (request) return request._id;
    // Deletion is terminal for this provider identity, regardless of delivery
    // order. Keep existing profile data until the account processor cleans up.
    await ctx.db.patch("users", userId, { lifecycle: "deletion_requested" });
    return await ctx.db.insert("accountLifecycleRequests", {
      userId, source: "clerk", sourceDeliveryId: deliveryId, requestedAt: eventAt, status: "pending",
    });
  },
});

export const pending = internalQuery({
  args: {}, returns: v.array(schema.doc("accountLifecycleRequests")),
  handler: async (ctx) => ctx.db.query("accountLifecycleRequests")
    .withIndex("by_status", (q) => q.eq("status", "pending")).take(100),
});
