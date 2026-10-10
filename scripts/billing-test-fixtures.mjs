import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api.js";
import { resolveLocalTestConfig } from "./local-test-config.mjs";

// Admin-only deterministic fixtures. No test endpoints or fake payments are
// exposed by the application. Synthetic records never create provider payments.
export function billingTestAdmin() {
  const local = resolveLocalTestConfig();
  const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  client.setAdminAuth(JSON.parse(readFileSync(join(local.config.root, ".convex/local/default/config.json"), "utf8")).adminKey);
  return { local, client };
}
export async function seedPaidTestUser(user, model = "lifetime", paid = true) {
  const { local, client } = billingTestAdmin();
  const tokenIdentifier = `${local.env.CLERK_JWT_ISSUER_DOMAIN}|${user.id}`;
  await client.mutation(internal.users.syncProfile, { profile: { clerkId: user.id, email: user.email,
    firstName: user.name, updatedAt: Date.now() }, eventAt: Date.now() });
  const customerId = `fixture-${local.config.id}-${user.id}`;
  const externalId = `${local.config.id}:${tokenIdentifier}`;
  await client.mutation(internal.billingState.enqueue, { customerId, externalId });
  let lease;
  for (let attempt = 0; attempt < 100 && !lease; attempt++) {
    lease = await client.mutation(internal.billingState.lease, { customerId });
    if (!lease) await delay(100);
  }
  if (!lease) throw new Error("Could not lease this worktree's deterministic billing fixture");
  const now = Date.now();
  const productId = local.env[`POLAR_PRODUCT_${model.toUpperCase()}`];
  if (!productId) throw new Error("Billing fixtures need configured sandbox products");
  const subscriptionId = `fixture-sub-${user.id}`;
  await client.mutation(internal.billingState.apply, { version: lease.version, snapshot: {
    customerId, externalId,
    subscriptions: model === "lifetime" ? [] : [{ id: subscriptionId, productId, status: "active",
      start: now - 1000, end: now + 60 * 60_000, modifiedAt: now, cancelAtPeriodEnd: false }],
    orders: [{ id: `fixture-order-${user.id}-${model}`, productId, ...(model === "lifetime" ? {} : { subscriptionId }),
      paid, fullyRefunded: false, createdAt: now, modifiedAt: now }],
  } });
  await client.mutation(internal.billingState.finish, { customerId, version: lease.version, failed: false });
  // Provider lookups for synthetic IDs cannot alter live sandbox resources;
  // paid expiry continues through its scheduled mutation.
  return { customerId, externalId, subscriptionId };
}
