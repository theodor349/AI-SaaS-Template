import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { testTokenIdentifier } from "../../scripts/test-identity.mjs";

// Retries a sandbox read until it passes, in case search trails writes.
async function eventually(read, done) {
  for (let attempt = 0; ; attempt++) {
    const value = await read();
    if (done(value) || attempt >= 10) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// The unit tests mock Polar, so this pins the provider behavior that
// customerByExternalId in convex/billing/polar.ts relies on.
test("Polar search finds a customer by an external ID holding the issuer URL, and stops after deletion", async () => {
  const local = resolveLocalTestConfig();
  const polar = createPolar({
    accessToken: local.env.POLAR_ACCESS_TOKEN, environment: "sandbox", organizationId: local.env.POLAR_ORGANIZATION_ID,
    timeout: 15,
  });
  // The fixture scope keeps this worktree's webhook handler from claiming the customer.
  const scope = `fixture-${local.config.id}`;
  const externalId = `${scope}:${testTokenIdentifier(local.env, `user_${randomUUID()}`)}`;
  // The app treats a search without an exact match as truncated when total_count
  // exceeds the page, so the total must count only matches.
  const search = async () => {
    const { items, pagination } = await polar.customers.list({ query: externalId, limit: 10 });
    const ids = items.filter((customer) => customer.external_id === externalId).map((customer) => customer.id);
    return { ids, total: pagination.total_count };
  };
  try {
    const customer = await polar.customers.create({
      email: `polar-search-${randomUUID()}+clerk_test@gmail.com`, external_id: externalId, metadata: { worktree_id: scope },
    });
    assert.deepEqual(await eventually(search, ({ ids }) => ids.length > 0), { ids: [customer.id], total: 1 });
    await polar.customers.delete(customer.id, { anonymize: true });
    // Cleanup retries rely on a deleted customer dropping out of search.
    assert.deepEqual(await eventually(search, ({ total }) => total === 0), { ids: [], total: 0 });
  } finally {
    // A lost create or delete response can leave the customer behind. Cleanup
    // failures must not hide the test's own error.
    const { ids } = await search().catch(() => ({ ids: [] }));
    for (const id of ids) {
      await polar.customers.delete(id, { anonymize: true }).catch(() => {});
    }
  }
});
