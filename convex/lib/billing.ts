import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { requireIdentity } from "./auth";

export const billingModel = v.union(v.literal("monthly"), v.literal("yearly"), v.literal("lifetime"));
export type BillingModel = "monthly" | "yearly" | "lifetime";
export const models: BillingModel[] = ["monthly", "yearly", "lifetime"];

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
  const incomplete = models.some((m) => !products[m]);
  const distinct = new Set(Object.values(products)).size === models.length;
  if (!id || incomplete || !distinct) {
    throw new ConvexError({ code: "BILLING_CONFIGURATION_REQUIRED" });
  }
  return id;
}

export function productModel(id: string) {
  return models.find((model) => configuredProduct(model) === id);
}

export function externalCustomerId(tokenIdentifier: string) {
  return `${env.WORKTREE_ID}:${tokenIdentifier}`;
}

export async function requireUser(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user?.email) {
    throw new ConvexError({ code: "PROVISIONING_REQUIRED" });
  }
  if (user.lifecycle !== "active") {
    throw new ConvexError({ code: "ACCOUNT_UNAVAILABLE" });
  }
  return user;
}

export async function accountForUser(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db.query("billingAccounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

export async function accountForCustomer(ctx: QueryCtx, customerId: string) {
  return ctx.db.query("billingAccounts")
    .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
    .unique();
}

export async function syncForCustomer(ctx: QueryCtx, customerId: string) {
  return ctx.db.query("billingSync")
    .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
    .unique();
}

// Paid queries use materialized expiry, maintained by a durable scheduled mutation.
// Mutations/actions also verify the deadline at execution time.
export async function requirePro(ctx: QueryCtx, now?: number) {
  const user = await requireUser(ctx);
  const account = await accountForUser(ctx, user._id);
  const expired = now !== undefined && account?.paidThrough !== undefined && account.paidThrough <= now;
  if (account?.status !== "active" || expired) {
    throw new ConvexError({ code: "PAID_ACCESS_REQUIRED" });
  }
  return user;
}

export function billingReturnUrl(value: string) {
  const origin = new URL(env.APP_URL).origin;
  if (/[\\\u0000- ]/.test(value)) {
    throw new ConvexError({ code: "INVALID_RETURN_URL" });
  }
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.pathname !== "/billing") {
    throw new ConvexError({ code: "INVALID_RETURN_URL" });
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
