import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { action, env, internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireIdentity } from "./lib/auth";
import { clerkIssuer, clerkProfile, clerkTokenIdentifier, parseClerkProfile } from "./lib/clerk";
import { getDisplayName } from "./lib/profile";

export const currentUserResult = v.union(
  v.object({ status: v.literal("provisioning") }),
  v.object({ status: v.literal("deleting") }),
  v.object({ status: v.literal("ready"), user: v.object({
    id: v.id("users"), email: v.string(),
    displayName: v.union(v.string(), v.null()),
  }) }),
);

function readiness(user: Doc<"users"> | null) {
  if (user && user.lifecycle !== "active") return { status: "deleting" as const };
  if (!user?.email) return { status: "provisioning" as const };
  return { status: "ready" as const, user: {
    id: user._id, email: user.email, displayName: getDisplayName(user) ?? null,
  } };
}

// Authenticated absence is provisioning, never sign-out. This DTO deliberately
// omits provider identifiers and makes no assertion about paid entitlement.
export const current = query({
  args: {}, returns: currentUserResult,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return readiness(await ctx.db.query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique());
  },
});

export const byClerkId = internalQuery({
  args: { clerkId: v.string() },
  returns: v.union(v.null(), v.id("users")),
  handler: async (ctx, { clerkId }) => (await ctx.db.query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId)).unique())?._id ?? null,
});

export const syncProfile = internalMutation({
  args: { profile: clerkProfile, eventAt: v.number() },
  returns: currentUserResult,
  handler: async (ctx, { profile, eventAt }) => {
    const user = await ctx.db.query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", profile.clerkId)).unique();
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
      ...fields, clerkId: profile.clerkId, tokenIdentifier: clerkTokenIdentifier(profile.clerkId), lifecycle: "active",
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
      throw new ConvexError({ code: "UNAUTHENTICATED" });
    }
    const current = await ctx.runQuery(internal.users.lookupCurrent, { tokenIdentifier: identity.tokenIdentifier });
    if (current.status === "deleting" || (current.status === "ready" && !refresh)) return current;
    try {
      if (!env.CLERK_SECRET_KEY) throw new Error("Missing configuration");
      const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`, {
        headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(15000),
      });
      // A 404 can mean the Backend API key belongs to another Clerk instance.
      // Only signed deletion events may create terminal lifecycle requests.
      if (!response.ok) throw new Error("Provider request failed");
      const data: unknown = await response.json();
      const profile = parseClerkProfile(data);
      if (profile.clerkId !== identity.subject) throw new Error("Provider identity mismatch");
      return await ctx.runMutation(internal.users.syncProfile, { profile, eventAt: profile.updatedAt });
    } catch {
      console.error("User provisioning failed", { code: "PROVISIONING_FAILED" });
      throw new ConvexError({ code: "PROVISIONING_FAILED" });
    }
  },
});

export const lookupCurrent = internalQuery({
  args: { tokenIdentifier: v.string() }, returns: currentUserResult,
  handler: async (ctx, { tokenIdentifier }) => readiness(await ctx.db.query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier)).unique()),
});
