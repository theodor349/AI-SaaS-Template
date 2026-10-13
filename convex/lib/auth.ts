import type { QueryCtx } from "../_generated/server";
import { appError } from "./errors";

// Use in queries, mutations, and actions; callers cannot choose their identity.
export async function requireIdentity(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw appError("UNAUTHENTICATED");
  return identity;
}
