import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Webhook } from "svix";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../convex/_generated/api.js";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { testTokenIdentifier } from "../../scripts/test-identity.mjs";

const { config, env } = resolveLocalTestConfig();
// resolveLocalTestConfig has already verified this worktree's anonymous state.
// Admin access is confined to loopback verification, never application code.
const admin = new ConvexHttpClient(config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
admin.setAdminAuth(JSON.parse(readFileSync(join(config.root, ".convex/local/default/config.json"), "utf8")).adminKey);
const endpoint = `${config.env.NEXT_PUBLIC_CONVEX_SITE_URL}/webhooks/clerk`;
async function deliver(payload, id, valid = true) {
  const date = new Date();
  const body = JSON.stringify(payload);
  return fetch(endpoint, { method: "POST", body, signal: AbortSignal.timeout(15000), headers: {
    "svix-id": id, "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
    "svix-signature": valid ? new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET).sign(id, date, body) : "v1,invalid",
  } });
}

test("local Convex HTTP verifies signatures, handles concurrent deliveries, and rejects malformed profiles", async () => {
  const id = `${config.id}-${randomUUID()}`;
  const clerkId = `local-signed-test-${id}`;
  const event = { type: "user.created", timestamp: Date.now(), data: {
    id: clerkId, updated_at: Date.now(), first_name: null, last_name: null,
    primary_email_address_id: "primary", email_addresses: [{ id: "primary", email_address: "local@example.com" }],
  } };
  try {
    assert.equal((await deliver(event, id, false)).status, 400);
    assert.equal(await admin.query(internal.account.users.byClerkId, { clerkId }), null);
    const responses = await Promise.all(Array.from({ length: 4 }, () => deliver(event, id)));
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200]);
    // This indexed unique lookup fails if concurrent delivery created duplicates.
    const userId = await admin.query(internal.account.users.byClerkId, { clerkId });
    assert.ok(userId);
    const tokenIdentifier = testTokenIdentifier(env, clerkId);
    const current = await admin.query(internal.account.users.lookupCurrent, { tokenIdentifier });
    assert.equal(current.status, "ready");
    assert.equal(current.user.id, userId);
    assert.equal(current.user.email, "local@example.com");
    assert.equal((await deliver({ ...event, data: { ...event.data, primary_email_address_id: "missing" } }, `${id}-bad`)).status, 400);
    assert.equal((await deliver({ type: "session.created", timestamp: Date.now(), data: {} }, `${id}-ignored`)).status, 200);
  } finally {
    // Leave a lifecycle request for the future account processor rather than
    // deleting application records through an unauthenticated test backdoor.
    const response = await deliver({ type: "user.deleted", timestamp: Date.now(), data: { id: clerkId, deleted: true } }, `${id}-delete`);
    assert.equal(response.status, 200);
    assert.deepEqual(await admin.query(internal.account.users.lookupCurrent, {
      tokenIdentifier: testTokenIdentifier(env, clerkId),
    }), { status: "deleting" });
  }
});

test("local backend denies anonymous user APIs and arbitrary internal user lookup", async () => {
  const client = new ConvexHttpClient(config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  await assert.rejects(client.query(api.account.users.current, {}), /UNAUTHENTICATED/);
  await assert.rejects(client.action(api.account.users.ensureCurrentUser, {}), /UNAUTHENTICATED/);
  await assert.rejects(client.query("account/users:byClerkId", { clerkId: "somebody-else" }));
});
