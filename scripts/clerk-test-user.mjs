import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

// Next's server export needs CommonJS when used directly by a Node script.
const { createClerkClient } = createRequire(import.meta.url)("@clerk/nextjs/server");

// Parallel worktrees share the development instance's provider rate limits.
async function withProviderRetry(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || error.status !== 429) throw error;
      await delay(Math.min(10_000, Math.max(1000 * 2 ** attempt, (error.retryAfter ?? 0) * 1000)));
    }
  }
}

export async function createClerkTestUser({ config, env }) {
  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const label = `${config.id}-${randomUUID().slice(0, 8)}`;
  const email = `${label}+clerk_test@example.com`;
  let user;
  try {
    user = await withProviderRetry(() => client.users.createUser({
      emailAddress: [email],
      firstName: label,
      lastName: "E2E",
      skipPasswordRequirement: true,
      publicMetadata: { WORKTREE_ID: config.id, purpose: "local-agent-test" },
    }));
  } catch (error) {
    const codes = error.errors?.map((detail) => `${detail.code}: ${detail.meta?.paramName ?? "unknown field"}`).join(", ") ?? "unknown";
    throw new Error(`Could not create the dedicated Clerk development test user (${codes}). Check the worktree's Clerk credentials and instance's email/name settings.`);
  }
  return {
    id: user.id,
    email,
    name: `${label} E2E`,
    async revokeSessions() {
      const sessions = await client.sessions.getSessionList({ userId: user.id, status: "active" });
      await Promise.all(sessions.data.map((session) => client.sessions.revokeSession(session.id)));
    },
    async cleanup() {
      try {
        await withProviderRetry(() => client.users.deleteUser(user.id));
      } catch {
        throw new Error(`Clerk test-user cleanup failed. Remove only user ${user.id} (${email}) from the development instance.`);
      }
    },
  };
}

export async function createClerkTestOrganization({ config, env }, userId) {
  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  let organization;
  try {
    organization = await withProviderRetry(() => client.organizations.createOrganization({
      name: `${config.id}-${randomUUID().slice(0, 8)}-E2E`,
      createdBy: userId,
      privateMetadata: { WORKTREE_ID: config.id, purpose: "local-agent-test" },
    }));
  } catch (error) {
    if (error.errors?.some((detail) => detail.code === "organization_not_enabled_in_instance")) return null;
    const codes = error.errors?.map((detail) => detail.code).join(", ") ?? "unknown";
    throw new Error(`Could not create the dedicated Clerk development test organization (${codes}). Check organization support in the development instance.`);
  }
  return {
    id: organization.id,
    async setRole(role) {
      await client.organizations.updateOrganizationMembership({ organizationId: organization.id, userId, role });
    },
    async cleanup() {
      await withProviderRetry(() => client.organizations.deleteOrganization(organization.id));
    },
  };
}
