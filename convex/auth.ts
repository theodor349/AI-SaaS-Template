import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "./lib/auth";

// Authentication is independent of webhook provisioning. A future current-user
// query should return null for a missing record, never for a missing identity.
export const currentIdentity = query({
  args: {},
  returns: v.object({ tokenIdentifier: v.string(), name: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return { tokenIdentifier: identity.tokenIdentifier, name: identity.name ?? null };
  },
});
