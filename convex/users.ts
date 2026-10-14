import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import { clerkIssuer, clerkProfile, clerkTokenIdentifier, parseClerkProfile } from "./lib/clerk";
import { fetchClerkUser } from "./lib/clerkApi";
import { appError } from "./lib/errors";
import { getDisplayName } from "./lib/profile";
import { currentUserResult, getCurrentUser, readiness, userByClerkId, userByTokenIdentifier } from "./lib/users";

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
    if (user && user.tokenIdentifier !== tokenIdentifier) {
      await ctx.db.patch("users", user._id, { tokenIdentifier });
    }
    // A Clerk identity cannot be recreated after deletion; a newly registered
    // account has a new Clerk ID. Keep the tombstone even after account cleanup.
    if (user && user.lifecycle !== "active") return readiness(user);
    if (user && (profile.updatedAt < user.profileUpdatedAt ||
        (profile.updatedAt === user.profileUpdatedAt && eventAt <= user.profileEventAt))) {
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
      return readiness(await ctx.db.get("users", user._id));
    }
    const id = await ctx.db.insert("users", {
      ...fields, clerkId: profile.clerkId, tokenIdentifier, lifecycle: "active",
    });
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
    const current = await ctx.runQuery(internal.users.lookupCurrent, { tokenIdentifier: identity.tokenIdentifier });
    if (current.status === "deleting" || (current.status === "ready" && !refresh)) return current;
    try {
      const profile = parseClerkProfile(await fetchClerkUser(identity.subject));
      if (profile.clerkId !== identity.subject) throw new Error("Provider identity mismatch");
      return await ctx.runMutation(internal.users.syncProfile, { profile, eventAt: profile.updatedAt });
    } catch {
      console.error("User provisioning failed", { code: "PROVISIONING_FAILED" });
      throw appError("PROVISIONING_FAILED");
    }
  },
});

export const lookupCurrent = internalQuery({
  args: { tokenIdentifier: v.string() }, returns: currentUserResult,
  handler: async (ctx, { tokenIdentifier }) => readiness(await userByTokenIdentifier(ctx, tokenIdentifier)),
});
