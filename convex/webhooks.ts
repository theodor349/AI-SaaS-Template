import { v } from "convex/values";
import type { FunctionReference, OptionalRestArgs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./lib/functions";

export const deliveryArgs = {
  provider: v.union(v.literal("clerk"), v.literal("polar")),
  deliveryId: v.string(),
  eventType: v.string(),
};
export const deliveryResult = v.union(v.literal("success"), v.literal("duplicate"), v.literal("failure"));
export const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Call only from a mutation. The business handler runs as a subtransaction so
// failed writes roll back. Effects and success tracking commit together; a
// stopped transaction leaves neither effects nor a processing lock.
// External effects must use a durable outbox, with provider idempotency keys.
// The caller's event records the delivery and its outcome.
export async function processDelivery<Handler extends FunctionReference<"mutation", "internal">>(
  ctx: MutationCtx,
  delivery: { provider: "clerk" | "polar"; deliveryId: string; eventType: string },
  handler: Handler,
  ...args: OptionalRestArgs<Handler>
) {
  const existing = await ctx.db.query("webhookDeliveries")
    .withIndex("by_provider_and_deliveryId", (q) => q.eq("provider", delivery.provider).eq("deliveryId", delivery.deliveryId))
    .unique();
  ctx.log.set("provider", delivery.provider);
  ctx.log.set("deliveryId", delivery.deliveryId);
  ctx.log.set("eventType", delivery.eventType);
  if (existing?.status === "success") {
    ctx.log.decision("delivery", { result: "duplicate" });
    return "duplicate" as const;
  }
  const now = Date.now();
  const attempts = (existing?.attempts ?? 0) + 1;
  let status: "success" | "failure" = "success";
  try {
    await ctx.runMutation(handler, ...args);
  } catch {
    // The handler's own event, in the same flow, carries its error.
    status = "failure";
    ctx.log.decision("delivery", { result: "failure", attempts, code: "HANDLER_FAILED" });
    ctx.log.markAsError();
  }
  const fields = {
    ...delivery, status, attempts, lastAttemptAt: now,
    expiresAt: now + DELIVERY_RETENTION_MS,
    failureCode: status === "failure" ? "HANDLER_FAILED" : undefined,
  };
  if (existing) await ctx.db.patch("webhookDeliveries", existing._id, fields);
  else await ctx.db.insert("webhookDeliveries", fields);
  if (status === "success") {
    ctx.log.decision("delivery", { result: existing ? "recovered" : "success", attempts });
  }
  return status;
}

export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db.query("webhookDeliveries")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now())).take(100);
    for (const row of expired) {
      if (row.status === "failure") {
        ctx.log.decision("unresolved_delivery_expired", {
          provider: row.provider, deliveryId: row.deliveryId, attempts: row.attempts,
        });
        ctx.log.adminAction("Webhook deliveries expired without succeeding; check the provider's delivery history");
      }
      await ctx.db.delete("webhookDeliveries", row._id);
    }
    ctx.log.set("expired", expired.length);
    if (expired.length === 100) await ctx.scheduler.runAfter(0, internal.webhooks.prune, {});
    return null;
  },
});
