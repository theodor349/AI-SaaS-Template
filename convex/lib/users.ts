import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { requireIdentity } from "./auth";
import { appError } from "./errors";
import type { QueryCtx } from "./functions";
import { getDisplayName } from "./profile";

type DbCtx = Pick<QueryCtx, "db">;
type CallerCtx = Pick<QueryCtx, "auth" | "db" | "log">;

export const currentUserResult = v.union(
  v.object({ status: v.literal("provisioning") }),
  v.object({ status: v.literal("deleting") }),
  v.object({ status: v.literal("ready"), user: v.object({
    id: v.id("users"), email: v.string(),
    displayName: v.union(v.string(), v.null()),
  }) }),
);

export function userByTokenIdentifier(ctx: DbCtx, tokenIdentifier: string) {
  return ctx.db.query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

export function userByClerkId(ctx: DbCtx, clerkId: string) {
  return ctx.db.query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
}

// The caller's record, or null while it is still being provisioned. Every
// identity helper below resolves the user here, which adds it to the event.
export async function getCurrentUser(ctx: CallerCtx) {
  const identity = await requireIdentity(ctx);
  const user = await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (user) ctx.log.setUser(user._id);
  return user;
}

// Any provisioned caller, including one whose account is being deleted.
export async function requireOwner(ctx: CallerCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw appError("PROVISIONING_REQUIRED");
  return user;
}

// A provisioned caller whose account is active.
export async function requireUser(ctx: CallerCtx) {
  const user = await getCurrentUser(ctx);
  if (!user?.email) throw appError("PROVISIONING_REQUIRED");
  if (user.lifecycle !== "active") throw appError("ACCOUNT_UNAVAILABLE");
  return user;
}

// The client-facing account state. Authenticated absence is provisioning, never
// sign-out. It omits provider identifiers and makes no assertion about paid entitlement.
export function readiness(user: Doc<"users"> | null) {
  if (user && user.lifecycle !== "active") return { status: "deleting" as const };
  if (!user?.email) return { status: "provisioning" as const };
  return { status: "ready" as const, user: {
    id: user._id, email: user.email, displayName: getDisplayName(user) ?? null,
  } };
}
