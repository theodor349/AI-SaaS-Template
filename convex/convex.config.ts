import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    WORKTREE_ID: v.string(),
    APP_URL: v.string(),
    POLAR_ENVIRONMENT: v.optional(v.union(v.literal("sandbox"), v.literal("production"))),
    POLAR_ACCESS_TOKEN: v.optional(v.string()),
    POLAR_WEBHOOK_SECRET: v.optional(v.string()),
    POLAR_ORGANIZATION_ID: v.optional(v.string()),
    POLAR_PRODUCT_MONTHLY: v.optional(v.string()),
    POLAR_PRODUCT_YEARLY: v.optional(v.string()),
    POLAR_PRODUCT_LIFETIME: v.optional(v.string()),
    CLERK_JWT_ISSUER_DOMAIN: v.string(),
    CLERK_SECRET_KEY: v.optional(v.string()),
    CLERK_WEBHOOK_SIGNING_SECRET: v.optional(v.string()),
  },
});
