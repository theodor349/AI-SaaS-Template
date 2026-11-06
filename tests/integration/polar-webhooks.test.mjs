import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Webhook } from "svix";
import { internal } from "../../convex/_generated/api.js";
import { billingTestAdmin } from "../../scripts/billing-test-fixtures.mjs";
import { billingEnabled } from "../../scripts/bootstrap/config.mjs";

const { local, client: admin } = billingTestAdmin();
async function deliver(type, data, id, valid = true) {
  const body = JSON.stringify({ type, timestamp: new Date().toISOString(), api_version: "2026-10-01", data });
  const date = new Date();
  return fetch(local.config.env.POLAR_WEBHOOK_URL, { method: "POST", body, headers: {
    "webhook-id": id, "webhook-timestamp": String(Math.floor(date.getTime() / 1000)),
    "webhook-signature": valid ? new Webhook(local.env.POLAR_WEBHOOK_SECRET).sign(id, date, body) : "v1,invalid",
  } });
}

test("signed local Polar HTTP fixtures isolate foreign worktrees before creating delivery or billing records", { skip: !billingEnabled(process.cwd()) && "billing is off in app.config.ts" }, async () => {
  const id = randomUUID();
  const foreign = { id: `foreign-${id}`, external_id: "wt-other:issuer|somebody", metadata: { worktree_id: "wt-other" } };
  for (const type of ["customer.created", "subscription.active", "subscription.canceled", "subscription.uncanceled", "subscription.revoked", "order.paid", "order.refunded"]) {
    const data = type.startsWith("customer.") ? foreign : { id: `resource-${id}`, customer_id: foreign.id, customer: foreign };
    assert.equal((await deliver(type, data, `${id}-${type}`)).status, 200);
    assert.equal(await admin.query(internal.billing.state.get, { customerId: foreign.id }), null);
  }
  assert.equal((await deliver("customer.created", foreign, `${id}-invalid`, false)).status, 400);
  assert.equal((await deliver("subscription.active", { id: "x", customer_id: 3 }, `${id}-bad`)).status, 400);
  assert.equal((await deliver("checkout.expired", { id: "abandoned", customer_id: null }, `${id}-missing`)).status, 200);
});
