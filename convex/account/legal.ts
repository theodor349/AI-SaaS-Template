import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { exportOne, exportTime } from "../lib/dataExport";
import { appError } from "../lib/errors";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "../lib/functions";
import { hasAcceptedCurrent, legalVersions } from "./legalVersions";
import { getCurrentUser, requireUser, userByClerkId } from "../lib/users";

// Whether the caller has accepted the current terms and privacy notice. Null
// while the account is provisioning or being deleted, when there is nothing to accept.
export const status = query({
  args: {},
  returns: v.union(v.null(), v.object({ accepted: v.boolean(), previouslyAccepted: v.boolean() })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user?.email || user.lifecycle !== "active") return null;
    return {
      accepted: hasAcceptedCurrent(user.legalAcceptance),
      previouslyAccepted: user.legalAcceptance !== undefined,
    };
  },
});

// Records acceptance of the versions currently published. Accepting again
// keeps the original time.
export const accept = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => record(ctx, await requireUser(ctx)),
});

// Test fixtures create users who have already accepted.
export const acceptForClerkUser = internalMutation({
  args: { clerkId: v.string() }, returns: v.null(),
  handler: async (ctx, { clerkId }) => {
    const user = await userByClerkId(ctx, clerkId);
    if (!user) throw appError("PROVISIONING_REQUIRED");
    ctx.log.setUser(user._id);
    return record(ctx, user);
  },
});

async function record(ctx: MutationCtx, user: Doc<"users">) {
  const previous = user.legalAcceptance;
  if (hasAcceptedCurrent(previous)) {
    ctx.log.decision("acceptance", { result: "already_accepted" });
    return null;
  }
  await ctx.db.patch("users", user._id, { legalAcceptance: { ...legalVersions, acceptedAt: Date.now() } });
  ctx.log.decision("acceptance", {
    result: previous ? "renewed" : "accepted", terms: legalVersions.terms, privacy: legalVersions.privacy,
  });
  return null;
}

// Purchases are made under the current terms, so checkout requires them.
export const requireAccepted = internalQuery({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!hasAcceptedCurrent(user.legalAcceptance)) throw appError("LEGAL_ACCEPTANCE_REQUIRED");
    return null;
  },
});

// Data export section: the document versions the user accepted, and when.
export const legalExport = {
  acceptance: exportOne(
    v.object({ termsVersion: v.number(), privacyVersion: v.number(), acceptedAt: v.string() }),
    async (_ctx, owner) => {
      const acceptance = owner.legalAcceptance;
      if (!acceptance) return null;
      return { termsVersion: acceptance.terms, privacyVersion: acceptance.privacy, acceptedAt: exportTime(acceptance.acceptedAt) };
    },
  ),
};
