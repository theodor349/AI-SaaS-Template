import { v } from "convex/values";
import type { FunctionReference, OptionalRestArgs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

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
export async function processDelivery<Handler extends FunctionReference<"mutation", "internal">>(
  ctx: MutationCtx,
  delivery: { provider: "clerk" | "polar"; deliveryId: string; eventType: string },
  handler: Handler,
  ...args: OptionalRestArgs<Handler>
) {
  const existing = await ctx.db.query("webhookDeliveries")
    .withIndex("by_provider_and_deliveryId", (q) => q.eq("provider", delivery.provider).eq("deliveryId", delivery.deliveryId))
    .unique();
  if (existing?.status === "success") return "duplicate" as const;
  const now = Date.now();
  const attempts = (existing?.attempts ?? 0) + 1;
  let status: "success" | "failure" = "success";
  try {
    await ctx.runMutation(handler, ...args);
  } catch {
    status = "failure";
    console.error("Webhook processing failed", { ...delivery, attempts, code: "HANDLER_FAILED" });
  }
  const fields = {
    ...delivery, status, attempts, lastAttemptAt: now,
    expiresAt: now + DELIVERY_RETENTION_MS,
    failureCode: status === "failure" ? "HANDLER_FAILED" : undefined,
  };
  if (existing) await ctx.db.patch("webhookDeliveries", existing._id, fields);
  else await ctx.db.insert("webhookDeliveries", fields);
  if (status === "success" && existing) {
    console.info("Webhook retry recovered", { ...delivery, attempts });
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
        console.warn("Unresolved webhook delivery expired", {
          provider: row.provider, deliveryId: row.deliveryId, attempts: row.attempts,
        });
      }
      await ctx.db.delete("webhookDeliveries", row._id);
    }
    if (expired.length === 100) await ctx.scheduler.runAfter(0, internal.webhooks.prune, {});
    return null;
  },
});
