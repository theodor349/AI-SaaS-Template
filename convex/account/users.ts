import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { requireIdentity } from "../lib/auth";
import { clerkIssuer, clerkProfile, clerkTokenIdentifier, parseClerkProfile } from "./clerk";
import { fetchClerkUser } from "./clerkApi";
import { appError } from "../lib/errors";
import { action, internalMutation, internalQuery, query } from "../lib/functions";
import { getDisplayName } from "../lib/profile";
import { legalVersions } from "./legalVersions";
import { currentUserResult, getCurrentUser, readiness, userByClerkId, userByTokenIdentifier } from "../lib/users";

export const current = query({
  args: {}, returns: currentUserResult,
  handler: async (ctx) => readiness(await getCurrentUser(ctx)),
});

export const byClerkId = internalQuery({
  args: { clerkId: v.string() },
  returns: v.union(v.null(), v.id("users")),
  handler: async (ctx, { clerkId }) => (await userByClerkId(ctx, clerkId))?._id ?? null,
});

export const syncProfile = internalMutation({
  args: { profile: clerkProfile, eventAt: v.number() },
  returns: currentUserResult,
  handler: async (ctx, { profile, eventAt }) => {
    const user = await userByClerkId(ctx, profile.clerkId);
    // Records written while the configured issuer had a trailing slash carry a
    // key that no caller identity matches; repair it before any early return.
    const tokenIdentifier = clerkTokenIdentifier(profile.clerkId);
    if (user) ctx.log.setUser(user._id);
    if (user && user.tokenIdentifier !== tokenIdentifier) {
      ctx.log.decision("token_identifier", { result: "repaired" });
      await ctx.db.patch("users", user._id, { tokenIdentifier });
    }
    // A Clerk identity cannot be recreated after deletion; a newly registered
    // account has a new Clerk ID. Keep the tombstone even after account cleanup.
    if (user && user.lifecycle !== "active") {
      ctx.log.decision("profile", { result: "tombstone", lifecycle: user.lifecycle });
      return readiness(user);
    }
    if (user && (profile.updatedAt < user.profileUpdatedAt ||
        (profile.updatedAt === user.profileUpdatedAt && eventAt <= user.profileEventAt))) {
      ctx.log.decision("profile", { result: "stale" });
      return readiness(user);
    }
    const fields = {
      email: profile.email, displayName: getDisplayName(user?.profileEdited ? user : profile),
      profileUpdatedAt: profile.updatedAt, profileEventAt: eventAt,
    };
    if (user) {
      // Patch only profile fields; billing and application fields belong to their
      // domain handlers and must survive reconciliation and webhook updates.
      await ctx.db.patch("users", user._id, { ...fields, firstName: undefined, lastName: undefined });
      ctx.log.decision("profile", { result: "updated", edited: user.profileEdited ?? false });
      return readiness(await ctx.db.get("users", user._id));
    }
    // Creating an account accepts the current terms; the sign-up page says so.
    const id = await ctx.db.insert("users", {
      ...fields, clerkId: profile.clerkId, tokenIdentifier, lifecycle: "active",
      legalAcceptance: { ...legalVersions, acceptedAt: Date.now() },
    });
    ctx.log.setUser(id);
    ctx.log.decision("profile", { result: "created" });
    return readiness(await ctx.db.get("users", id));
  },
});

// Called after Convex authentication settles, or explicitly on recovery. Fetch
// trusted provider data instead of accepting profile fields or IDs from clients.
export const ensureCurrentUser = action({
  args: { refresh: v.optional(v.boolean()) }, returns: currentUserResult,
  handler: async (ctx, { refresh }): Promise<Infer<typeof currentUserResult>> => {
    const identity = await requireIdentity(ctx);
    if (identity.issuer !== clerkIssuer() ||
        identity.tokenIdentifier !== clerkTokenIdentifier(identity.subject)) {
      throw appError("UNAUTHENTICATED");
    }
    const current = await ctx.runQuery(internal.account.users.lookupCurrent, { tokenIdentifier: identity.tokenIdentifier });
    if (current.status === "ready") ctx.log.setUser(current.user.id);
    ctx.log.decision("lookup", { status: current.status, refresh: refresh ?? false });
    if (current.status === "deleting" || (current.status === "ready" && !refresh)) return current;
    await ctx.runMutation(internal.rateLimits.admit, { action: "clerkProfile" });
    // Provider errors can carry profile data, so only the failed step is logged.
    let step = "fetch";
    try {
      const data = await fetchClerkUser(identity.subject);
      step = "parse";
      const profile = parseClerkProfile(data);
      step = "identity";
      if (profile.clerkId !== identity.subject) throw new Error("Provider identity mismatch");
      step = "sync";
      const result = await ctx.runMutation(internal.account.users.syncProfile, { profile, eventAt: profile.updatedAt });
      if (result.status === "ready") ctx.log.setUser(result.user.id);
      return result;
    } catch {
      ctx.log.decision("provisioning", { result: "failed", step });
      throw appError("PROVISIONING_FAILED");
    }
  },
});

export const lookupCurrent = internalQuery({
  args: { tokenIdentifier: v.string() }, returns: currentUserResult,
  handler: async (ctx, { tokenIdentifier }) => readiness(await userByTokenIdentifier(ctx, tokenIdentifier)),
});
