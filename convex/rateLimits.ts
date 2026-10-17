import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v, type Infer } from "convex/values";
import { components } from "./_generated/api";
import { env } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import { appError } from "./lib/errors";
import { internalMutation } from "./lib/functions";
import { userByTokenIdentifier } from "./lib/users";

// Per-user buckets for signed-in actions that reach Polar or Clerk, or read all
// of the caller's data. Each allows a short burst, such as the paid-access
// expiry check in several tabs or a few checkout retries, then refills slowly.
const perUser = { kind: "token bucket", period: HOUR, capacity: 5 } as const;
const rateLimiter = new RateLimiter(components.rateLimiter, {
  checkout: { ...perUser, rate: 10 },
  changeSubscription: { ...perUser, rate: 10 },
  portal: { ...perUser, rate: 20 },
  recover: { ...perUser, rate: 10 },
  clerkProfile: { ...perUser, rate: 20 },
  dataExport: { ...perUser, rate: 6, capacity: 3 },
});

const limitedAction = v.union(
  v.literal("checkout"),
  v.literal("changeSubscription"),
  v.literal("portal"),
  v.literal("recover"),
  v.literal("clerkProfile"),
  v.literal("dataExport"),
);
type LimitedAction = Infer<typeof limitedAction>;

// Approximate Polar requests per user action, not counting reconciliation,
// which charges its own requests.
const polarRequests: Partial<Record<LimitedAction, number>> = {
  checkout: 5,
  changeSubscription: 5,
  portal: 3,
  recover: 2,
};

// The app's share, in requests, of the Polar organization's limit: 500 a minute
// in production and 100 in sandbox. Every Polar request counts, but user actions
// are admitted only while half of it remains, so webhook reconciliation and
// withdrawal refunds keep room when users are busy. Other worktrees sharing a
// sandbox organization spend the same provider limit unseen.
function polarBudget() {
  const rate = env.POLAR_ENVIRONMENT === "production" ? 400 : 80;
  return { kind: "token bucket", rate, period: MINUTE, capacity: rate } as const;
}

function rateLimited(retryAfter: number) {
  return appError("RATE_LIMITED", { retryAfter: Math.ceil(retryAfter) });
}

// Call before an action makes any provider request. Keyed by the caller's token
// identifier, which belongs to one user and, unlike the user ID, already exists
// while provisioning calls Clerk. A rejection throws RATE_LIMITED, and the
// rolled-back mutation consumes nothing.
export const admit = internalMutation({
  args: { action: limitedAction },
  returns: v.null(),
  handler: async (ctx, { action }) => {
    const identity = await requireIdentity(ctx);
    const user = await userByTokenIdentifier(ctx, identity.tokenIdentifier);
    if (user) ctx.log.setUser(user._id);
    const caller = await rateLimiter.limit(ctx, action, { key: identity.tokenIdentifier });
    if (!caller.ok) {
      ctx.log.decision("rate_limit", { result: "rejected", bucket: "user", action });
      throw rateLimited(caller.retryAfter);
    }
    const requests = polarRequests[action];
    if (requests) {
      const config = polarBudget();
      const room = await rateLimiter.check(ctx, "polar", { config, count: requests + config.capacity / 2 });
      if (!room.ok) {
        ctx.log.decision("rate_limit", { result: "rejected", bucket: "polar", action });
        throw rateLimited(room.retryAfter);
      }
      await rateLimiter.limit(ctx, "polar", { config, count: requests });
    }
    return null;
  },
});

// Counts internal Polar work (reconciliation, refunds, account cleanup, catalog
// sync) against the shared budget. It is never refused here; it backs off on
// Polar's own rate-limit responses instead.
export const spendPolar = internalMutation({
  args: { requests: v.number() },
  returns: v.null(),
  handler: async (ctx, { requests }) => {
    await rateLimiter.limit(ctx, "polar", { config: polarBudget(), count: requests, reserve: true });
    return null;
  },
});
