import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";
import { parseClerkEvent } from "./lib/clerk";

const http = httpRouter();
http.route({
  path: "/webhooks/clerk", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
      console.error("Clerk webhook configuration missing", { code: "MISSING_SIGNING_SECRET" });
      return new Response("Webhook unavailable", { status: 503 });
    }
    const payload = await request.text();
    const deliveryId = request.headers.get("svix-id");
    const signature = request.headers.get("svix-signature");
    const signedAt = request.headers.get("svix-timestamp");
    if (!deliveryId || !signature || !signedAt) return new Response("Invalid signature", { status: 400 });
    try {
      new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET).verify(payload, {
        "svix-id": deliveryId, "svix-signature": signature, "svix-timestamp": signedAt,
      });
    } catch {
      console.warn("Clerk webhook verification rejected", { code: "INVALID_SIGNATURE" });
      return new Response("Invalid signature", { status: 400 });
    }
    let event;
    try {
      const verified: unknown = JSON.parse(payload);
      event = parseClerkEvent(verified);
    } catch {
      console.warn("Clerk webhook payload rejected", { deliveryId, code: "INVALID_PAYLOAD" });
      return new Response("Invalid payload", { status: 400 });
    }
    try {
      const result = await ctx.runMutation(internal.clerkWebhooks.process, { payload, deliveryId, eventType: event.type });
      return new Response(result === "failure" ? "Retry delivery" : "OK", { status: result === "failure" ? 503 : 200 });
    } catch {
      console.error("Clerk webhook transaction failed", { deliveryId, code: "TRANSACTION_FAILED" });
      return new Response("Retry delivery", { status: 503 });
    }
  }),
});

export default http;
