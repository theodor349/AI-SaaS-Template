import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api.js";
import { resolveLocalTestConfig } from "./local-test-config.mjs";
import { testExternalCustomerId } from "./test-identity.mjs";

// Admin-only deterministic fixtures. No test endpoints or fake payments are
// exposed by the application. Synthetic records never create provider payments.
export function billingTestAdmin() {
  const local = resolveLocalTestConfig();
  const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  client.setAdminAuth(JSON.parse(readFileSync(join(local.config.root, ".convex/local/default/config.json"), "utf8")).adminKey);
  return { local, client };
}

/**
 * Waits for the customer's reconciliation lease, which a running sync may hold briefly.
 * @param {string} customerId
 * @returns {Promise<{ version: number }>}
 */
export async function leaseBillingFixture(customerId, client = billingTestAdmin().client) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const lease = await client.mutation(internal.billing.state.lease, { customerId });
    if (lease) return lease;
    await delay(100);
  }
  throw new Error("Could not lease this worktree's deterministic billing fixture");
}

/**
 * Publishes a provider snapshot through the same lease, apply, and finish steps
 * that reconciliation uses, so pages react exactly as they would to Polar.
 * @param {import("convex/values").Infer<typeof import("../convex/billing/state.js").snapshot>} snapshot
 */
export async function publishBillingSnapshot(snapshot, client = billingTestAdmin().client) {
  const lease = await leaseBillingFixture(snapshot.customerId, client);
  await client.mutation(internal.billing.state.apply, { version: lease.version, snapshot });
  await client.mutation(internal.billing.state.finish, { customerId: snapshot.customerId, version: lease.version, failed: false });
}

// `purchasedAt` backdates the order, which starts the withdrawal period.
export async function seedPaidTestUser(user, model = "lifetime", paid = true, { periodMs = 60 * 60_000, purchasedAt = Date.now() } = {}) {
  const { local, client } = billingTestAdmin();
  await client.mutation(internal.account.users.syncProfile, { profile: { clerkId: user.id, email: user.email,
    firstName: user.name, updatedAt: Date.now() }, eventAt: Date.now() });
  const customerId = `fixture-${local.config.id}-${user.id}`;
  const externalId = testExternalCustomerId(local, user.id);
  await client.mutation(internal.billing.state.enqueue, { customerId, externalId });
  const now = Date.now();
  const productId = local.env[`POLAR_PRODUCT_${model.toUpperCase()}`];
  if (!productId) throw new Error("Billing fixtures need configured sandbox products");
  const subscriptionId = `fixture-sub-${user.id}`;
  await publishBillingSnapshot({
    customerId, externalId,
    subscriptions: model === "lifetime" ? [] : [{ id: subscriptionId, productId, status: "active",
      start: now - 1000, end: now + periodMs, modifiedAt: now, cancelAtPeriodEnd: false, comped: false }],
    orders: [{ id: `fixture-order-${user.id}-${model}`, productId, ...(model === "lifetime" ? {} : { subscriptionId }),
      paid, nothingCharged: false, fullyRefunded: false, createdAt: purchasedAt, modifiedAt: now }],
  }, client);
  // Provider lookups for synthetic IDs cannot alter live sandbox resources;
  // paid expiry continues through its scheduled mutation.
  return { customerId, externalId, subscriptionId };
}
