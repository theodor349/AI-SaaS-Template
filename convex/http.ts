import { webhooks as polarWebhooks } from "@polar-sh/sdk/2026-10";
import { normalizePolarEvent } from "./billing/polarWebhook";
import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import { parseClerkEvent } from "./account/clerk";
import { httpAction } from "./lib/functions";

// Each delivery attempt is its own flow and always logs one event with the
// provider's delivery ID. Payloads and verification errors are never logged.
const http = httpRouter();
http.route({
  path: "/webhooks/clerk", method: "POST",
  handler: httpAction(async (ctx, request) => {
    ctx.log.set("provider", "clerk");
    if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
      ctx.log.decision("configuration", { code: "MISSING_SIGNING_SECRET" });
      ctx.log.adminAction("Set CLERK_WEBHOOK_SIGNING_SECRET for this deployment");
      return new Response("Webhook unavailable", { status: 503 });
    }
    const payload = await request.text();
    const deliveryId = request.headers.get("svix-id");
    const signature = request.headers.get("svix-signature");
    const signedAt = request.headers.get("svix-timestamp");
    ctx.log.set("deliveryId", deliveryId);
    if (!deliveryId || !signature || !signedAt) {
      ctx.log.decision("verification", { result: "rejected", code: "INVALID_SIGNATURE" });
      return new Response("Invalid signature", { status: 400 });
    }
    try {
      new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET).verify(payload, {
        "svix-id": deliveryId, "svix-signature": signature, "svix-timestamp": signedAt,
      });
    } catch {
      ctx.log.decision("verification", { result: "rejected", code: "INVALID_SIGNATURE" });
      return new Response("Invalid signature", { status: 400 });
    }
    let event;
    try {
      const verified: unknown = JSON.parse(payload);
      event = parseClerkEvent(verified);
    } catch {
      ctx.log.decision("payload", { result: "rejected", code: "INVALID_PAYLOAD" });
      return new Response("Invalid payload", { status: 400 });
    }
    ctx.log.set("eventType", event.type);
    try {
      const result = await ctx.runMutation(internal.account.clerkWebhooks.process, { payload, deliveryId, eventType: event.type });
      ctx.log.decision("delivery", { result });
      return new Response(result === "failure" ? "Retry delivery" : "OK", { status: result === "failure" ? 503 : 200 });
    } catch {
      ctx.log.decision("delivery", { result: "failure", code: "TRANSACTION_FAILED" });
      ctx.log.markAsError();
      return new Response("Retry delivery", { status: 503 });
    }
  }, { alwaysLog: true }),
});

http.route({
  path: "/webhooks/polar", method: "POST",
  handler: httpAction(async (ctx, request) => {
    ctx.log.set("provider", "polar");
    if (!env.POLAR_WEBHOOK_SECRET) {
      ctx.log.decision("configuration", { code: "MISSING_SIGNING_SECRET" });
      ctx.log.adminAction("Set POLAR_WEBHOOK_SECRET for this deployment");
      return new Response("Webhook unavailable", { status: 503 });
    }
    const payload = await request.text();
    let event;
    const deliveryId = request.headers.get("webhook-id");
    ctx.log.set("deliveryId", deliveryId);
    if (!deliveryId) {
      ctx.log.decision("verification", { result: "rejected", code: "INVALID_SIGNATURE" });
      return new Response("Invalid signature", { status: 400 });
    }
    try {
      const verified: unknown = await polarWebhooks.validateEvent(payload, Object.fromEntries(request.headers), env.POLAR_WEBHOOK_SECRET);
      event = normalizePolarEvent(verified);
    } catch (error) {
      if (error instanceof polarWebhooks.PolarWebhookUnknownTypeError) {
        ctx.log.decision("event", { result: "ignored", reason: "unknown_type" });
        return new Response("Ignored", { status: 200 });
      }
      ctx.log.decision("verification", { result: "rejected", code: "INVALID_SIGNATURE_OR_PAYLOAD" });
      return new Response("Invalid signature or payload", { status: 400 });
    }
    ctx.log.set("eventType", event.type);
    if (!event.association) {
      ctx.log.decision("event", { result: "ignored", reason: "no_customer" });
      return new Response("Ignored", { status: 200 });
    }
    ctx.log.setCustomer(event.association.customerId);
    try {
      const result = await ctx.runMutation(internal.billing.state.process, {
        provider: "polar", deliveryId, eventType: event.type, ...event.association,
      });
      ctx.log.decision("delivery", { result });
      return new Response(result === "failure" ? "Retry delivery" : "OK", { status: result === "failure" ? 503 : 200 });
    } catch {
      ctx.log.decision("delivery", { result: "failure", code: "TRANSACTION_FAILED" });
      ctx.log.markAsError();
      return new Response("Retry delivery", { status: 503 });
    }
  }, { alwaysLog: true }),
});

export default http;
