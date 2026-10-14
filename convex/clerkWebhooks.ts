import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { parseClerkEvent } from "./lib/clerk";
import { internalMutation } from "./lib/functions";
import { deliveryResult, processDelivery } from "./webhooks";

export const apply = internalMutation({
  args: { payload: v.string(), deliveryId: v.string() }, returns: v.null(),
  handler: async (ctx, { payload, deliveryId }) => {
    const data: unknown = JSON.parse(payload);
    const event = parseClerkEvent(data);
    ctx.log.decision("event", { kind: event.kind });
    if (event.kind === "profile") {
      await ctx.runMutation(internal.users.syncProfile, { profile: event.profile, eventAt: event.eventAt });
    } else if (event.kind === "deletion") {
      await ctx.runMutation(internal.accountLifecycle.requestClerkDeletion, {
        clerkId: event.clerkId, eventAt: event.eventAt, deliveryId,
      });
    }
    return null;
  },
});

export const process = internalMutation({
  args: { payload: v.string(), deliveryId: v.string(), eventType: v.string() },
  returns: deliveryResult,
  handler: async (ctx, args): Promise<Infer<typeof deliveryResult>> => processDelivery(ctx, {
    provider: "clerk", deliveryId: args.deliveryId, eventType: args.eventType,
  }, internal.clerkWebhooks.apply, { payload: args.payload, deliveryId: args.deliveryId }),
});
