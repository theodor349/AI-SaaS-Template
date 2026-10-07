import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// Next's server export needs CommonJS when used directly by a Node script.
const { createClerkClient } = createRequire(import.meta.url)("@clerk/nextjs/server");

export async function createClerkTestUser({ config, env }) {
  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const email = `${config.id}-${randomUUID().slice(0, 8)}+clerk_test@example.com`;
  let user;
  try {
    user = await client.users.createUser({
      emailAddress: [email],
      firstName: config.id,
      lastName: "E2E",
      skipPasswordRequirement: true,
      publicMetadata: { WORKTREE_ID: config.id, purpose: "local-agent-test" },
    });
  } catch {
    throw new Error("Could not create the dedicated Clerk development test user. Check the worktree's Clerk credentials and instance's email/name settings.");
  }
  return {
    email,
    name: `${config.id} E2E`,
    async cleanup() {
      try {
        await client.users.deleteUser(user.id);
      } catch {
        throw new Error(`Clerk test-user cleanup failed. Remove only user ${user.id} (${email}) from the development instance.`);
      }
    },
  };
}
