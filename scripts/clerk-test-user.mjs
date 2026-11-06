import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { parseTestUserEmail } from "./agent-cli.mjs";

// Next's server export needs CommonJS when used directly by a Node script.
const { createClerkClient } = createRequire(import.meta.url)("@clerk/nextjs/server");

// Purposes label every generated Clerk resource so pnpm clerk:sweep can find orphans.
export const TEST_USER_PURPOSES = ["local-agent-test", "maintainer-review"];

export function clerkBackend(env) {
  return createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
}

// Clerk's client sets no request timeout, and Node's fetch waits 300 seconds for
// response headers. Without a limit a lost answer outlasts the test, which then
// fails with a bare test timeout that names no step.
const PROVIDER_ATTEMPT_MS = 15_000;

function withinTime(promise, attemptMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Clerk did not answer within ${attemptMs} ms`), { timedOut: true })), attemptMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Parallel worktrees share the development instance's provider rate limits. A
// timed out call may still have taken effect, so only a call that's safe to repeat
// passes `idempotent` to be tried again.
export async function withProviderRetry(operation, { idempotent = false, attemptMs = PROVIDER_ATTEMPT_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withinTime(operation(), attemptMs);
    } catch (error) {
      if (attempt >= 3 || !(error.status === 429 || (idempotent && error.timedOut))) throw error;
      await delay(Math.min(10_000, Math.max(1000 * 2 ** attempt, (error.retryAfter ?? 0) * 1000)));
    }
  }
}

// A 404 means an earlier attempt deleted the user and its answer got lost.
export async function deleteClerkUser(client, userId, options = {}) {
  try {
    await withProviderRetry(() => client.users.deleteUser(userId), { idempotent: true, ...options });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

// Pass `email` to sign up again with the address of a deleted test user.
export async function createClerkTestUser({ config, env }, { purpose = "local-agent-test", email = /** @type {string | undefined} */ (undefined) } = {}) {
  if (!TEST_USER_PURPOSES.includes(purpose)) throw new Error(`Unknown Clerk test-user purpose: ${purpose}`);
  const client = clerkBackend(env);
  const label = `${config.id}-${randomUUID().slice(0, 8)}`;
  // Clerk recognizes +clerk_test; Polar also requires a domain with valid MX.
  email ??= `${label}+clerk_test@gmail.com`;
  const firstName = `Test ${randomUUID().slice(0, 8).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)))}`;
  let user;
  try {
    user = await withProviderRetry(() => client.users.createUser({
      emailAddress: [email],
      firstName,
      lastName: "Account",
      skipPasswordRequirement: true,
      publicMetadata: { WORKTREE_ID: config.id, purpose },
    }));
  } catch (error) {
    const codes = error.errors?.map((detail) => `${detail.code}: ${detail.meta?.paramName ?? "unknown field"}`).join(", ") ?? error.message;
    throw new Error(`Could not create the dedicated Clerk development test user (${codes}). Check the worktree's Clerk credentials and instance's email/name settings.`);
  }
  return {
    id: user.id,
    email,
    name: `${firstName} Account`,
    // Single-use credential for Clerk's ticket sign-in; never log it.
    async createSignInToken(expiresInSeconds) {
      const { token } = await withProviderRetry(() => client.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds }));
      return token;
    },
    async revokeSessions() {
      const sessions = await withProviderRetry(() => client.sessions.getSessionList({ userId: user.id, status: "active" }));
      await Promise.all(sessions.data.map((session) => withProviderRetry(() => client.sessions.revokeSession(session.id))));
    },
    async cleanup() {
      try {
        await deleteClerkUser(client, user.id);
      } catch (error) {
        throw new Error(`Clerk test-user cleanup failed (${error.message}). Remove only user ${user.id} (${email}) from the development instance.`);
      }
    },
  };
}

// An existing development user, such as one seeded with a large synthetic dataset.
// The caller never deletes it. Every address on the account must be a +clerk_test
// address, so a real account that also carries a test address is refused.
export async function findClerkTestUser({ env }, email, client = clerkBackend(env)) {
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Existing test users can only be used on the Clerk development instance.");
  parseTestUserEmail(email);
  const { data } = await withProviderRetry(() => client.users.getUserList({ emailAddress: [email] }));
  const matches = data.filter((user) => user.emailAddresses.some(({ emailAddress }) => emailAddress.toLowerCase() === email.toLowerCase()));
  if (matches.length !== 1) {
    throw new Error(matches.length ? `${matches.length} Clerk development users have the address ${email}.` : `No Clerk development user has the address ${email}.`);
  }
  const [user] = matches;
  if (!user.emailAddresses.every(({ emailAddress }) => /\+clerk_test@/i.test(emailAddress))) {
    throw new Error(`Clerk user ${user.id} also has an address without +clerk_test, so it is refused.`);
  }
  return {
    id: user.id,
    email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || email,
    // Ends only the session this run created; other sign-ins of the user stay.
    async revokeSession(sessionId) {
      try {
        await withProviderRetry(() => client.sessions.revokeSession(sessionId));
      } catch (error) {
        throw new Error(`Could not end session ${sessionId} of Clerk user ${user.id} (${error.message}); revoke it in the development instance.`);
      }
    },
  };
}
