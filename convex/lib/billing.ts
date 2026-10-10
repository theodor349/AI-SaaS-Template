import { ConvexError, v } from "convex/values";
import { env, type QueryCtx } from "../_generated/server";
import { requireIdentity } from "./auth";

export const billingModel = v.union(v.literal("monthly"), v.literal("yearly"), v.literal("lifetime"));
export type BillingModel = "monthly" | "yearly" | "lifetime";
export const models: BillingModel[] = ["monthly", "yearly", "lifetime"];
export function configuredProduct(model: BillingModel) {
  const products = { monthly: env.POLAR_PRODUCT_MONTHLY, yearly: env.POLAR_PRODUCT_YEARLY, lifetime: env.POLAR_PRODUCT_LIFETIME };
  const id = products[model];
  if (!id || models.some(m => !products[m]) || new Set(Object.values(products)).size !== 3) {
    throw new ConvexError({ code: "BILLING_CONFIGURATION_REQUIRED" });
  }
  return id;
}
export function productModel(id: string) {
  return models.find(model => configuredProduct(model) === id);
}
export function externalCustomerId(tokenIdentifier: string) {
  return `${env.WORKTREE_ID}:${tokenIdentifier}`;
}
export async function requireUser(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.query("users").withIndex("by_tokenIdentifier", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user?.email) throw new ConvexError({ code: "PROVISIONING_REQUIRED" });
  if (user.lifecycle !== "active") throw new ConvexError({ code: "ACCOUNT_UNAVAILABLE" });
  return user;
}
export async function accountForUser(ctx: QueryCtx, userId: import("../_generated/dataModel").Id<"users">) {
  return ctx.db.query("billingAccounts").withIndex("by_userId", q => q.eq("userId", userId)).unique();
}
// Paid queries use materialized expiry, maintained by a durable scheduled mutation.
// Mutations/actions also verify the deadline at execution time.
export async function requirePro(ctx: QueryCtx, now?: number) {
  const user = await requireUser(ctx);
  const account = await accountForUser(ctx, user._id);
  if (account?.status !== "active" || (now !== undefined && account.paidThrough !== undefined && account.paidThrough <= now)) {
    throw new ConvexError({ code: "PAID_ACCESS_REQUIRED" });
  }
  return user;
}
export function billingReturnUrl(value: string) {
  const origin = new URL(env.APP_URL).origin;
  if (/[\\\u0000-\u0020]/.test(value)) throw new ConvexError({ code: "INVALID_RETURN_URL" });
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.pathname !== "/billing") {
    throw new ConvexError({ code: "INVALID_RETURN_URL" });
  }
  return url.toString();
}
export function timestamp(value: string) {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("Invalid provider timestamp");
  return result;
}
