import { v } from "convex/values";

// The app's deployment environment, declared in convex.config.ts, which may
// only have a default export. scripts/bootstrap.mjs pushes exactly these keys
// to local deployments; scripts/convex-env.test.mjs keeps the lists in sync.
export const appEnv = {
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
  // Transactional email through Resend, such as withdrawal receipts. Local
  // worktrees leave both unset and send no email.
  RESEND_API_KEY: v.optional(v.string()),
  // The sender, e.g. `App name <receipts@example.com>`, on a domain verified in Resend.
  EMAIL_FROM: v.optional(v.string()),
  // Where operator alerts go, such as a user withdrawing more than once.
  OPERATOR_ALERT_EMAIL: v.optional(v.string()),
  // Success sampling for wide events, between 0 and 1; see lib/log.ts.
  LOG_SAMPLE_RATE_QUERY: v.optional(v.string()),
  LOG_SAMPLE_RATE_MUTATION: v.optional(v.string()),
  LOG_SAMPLE_RATE_ACTION: v.optional(v.string()),
};
