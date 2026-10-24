import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { billingModels, type BillingModel } from "./plans";
import { appError } from "../lib/errors";
import type { QueryCtx } from "../lib/functions";
import { requireUser } from "../lib/users";

// Failed reconciliations retry themselves this many times with backoff. Later
// retries come from the scheduled sweep and are no longer shown as retrying.
export const scheduledRetries = 8;

export function configuredProduct(model: BillingModel) {
  const products = {
    monthly: env.POLAR_PRODUCT_MONTHLY,
    yearly: env.POLAR_PRODUCT_YEARLY,
    lifetime: env.POLAR_PRODUCT_LIFETIME,
  };
  const id = products[model];
  const incomplete = billingModels.some((m) => !products[m]);
  const distinct = new Set(Object.values(products)).size === billingModels.length;
  if (!id || incomplete || !distinct) {
    throw appError("BILLING_CONFIGURATION_REQUIRED");
  }
  return id;
}

export function productModel(id: string) {
  return billingModels.find((model) => configuredProduct(model) === id);
}

// Polar customers are shared across worktrees, so their external ID scopes the
// application identity to this worktree: `${WORKTREE_ID}:${tokenIdentifier}`.
function externalIdPrefix() {
  return `${env.WORKTREE_ID}:`;
}

export function externalCustomerId(tokenIdentifier: string) {
  return `${externalIdPrefix()}${tokenIdentifier}`;
}

export function isWorktreeExternalId(externalId: string | null | undefined) {
  return externalId?.startsWith(externalIdPrefix()) === true;
}

// Made-up sandbox customers that scripts/billing-test-fixtures.mjs publishes
// straight into billing state for E2E tests, captures and review links. Polar
// has no such customer, so reconciliation leaves them as published.
export function isFixtureCustomer(customerId: string) {
  return env.POLAR_ENVIRONMENT === "sandbox" && customerId.startsWith(`fixture-${env.WORKTREE_ID}-`);
}

// The owner's tokenIdentifier, or null for another worktree's or a foreign ID.
export function externalIdTokenIdentifier(externalId: string | null | undefined) {
  return externalId && isWorktreeExternalId(externalId) ? externalId.slice(externalIdPrefix().length) : null;
}

export async function accountForUser(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("billingAccounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

export async function accountForCustomer(ctx: Pick<QueryCtx, "db">, customerId: string) {
  return ctx.db.query("billingAccounts")
    .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
    .unique();
}

export async function syncForCustomer(ctx: Pick<QueryCtx, "db">, customerId: string) {
  return ctx.db.query("billingSync")
    .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
    .unique();
}

export async function operationForUser(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("billingOperations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

// Paid queries use materialized expiry, maintained by a durable scheduled mutation.
// Mutations/actions also verify the deadline at execution time.
export async function requirePro(ctx: QueryCtx, now?: number) {
  const user = await requireUser(ctx);
  const account = await accountForUser(ctx, user._id);
  const expired = now !== undefined && account?.paidThrough !== undefined && account.paidThrough <= now;
  if (account?.status !== "active" || expired) {
    throw appError("PAID_ACCESS_REQUIRED");
  }
  return user;
}

export function billingReturnUrl(value: string) {
  const origin = new URL(env.APP_URL).origin;
  if (/[\\\u0000- ]/.test(value)) {
    throw appError("INVALID_RETURN_URL");
  }
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.pathname !== "/billing") {
    throw appError("INVALID_RETURN_URL");
  }
  return url.toString();
}

export function timestamp(value: string) {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new Error("Invalid provider timestamp");
  }
  return result;
}
