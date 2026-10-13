// Test copies of the identity formats from convex/lib/clerk.ts (clerkTokenIdentifier)
// and convex/lib/billing.ts (externalCustomerId). Node scripts cannot import those
// Convex modules, so change these together with them.

/** Convex's `issuer|subject` identity key for a Clerk user in this worktree. */
export function testTokenIdentifier(env, clerkId) {
  return `${env.CLERK_JWT_ISSUER_DOMAIN.replace(/\/+$/, "")}|${clerkId}`;
}

/** The Polar external customer ID, scoped to this worktree. */
export function testExternalCustomerId({ config, env }, clerkId) {
  return `${config.id}:${testTokenIdentifier(env, clerkId)}`;
}
