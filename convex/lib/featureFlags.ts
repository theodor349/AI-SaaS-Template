import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "./errors";
import type { ActionCtx, QueryCtx } from "./functions";
import { userByTokenIdentifier } from "./users";

// Every feature flag, its value when the deployment stores no state for it,
// and what it gates. Removing a flag here turns each remaining use into a type
// error. docs/internals/feature-flags.md explains how to change a flag's state.
export const featureFlags = {
  exampleFeature: { default: false, description: "Template example. Replace it with your first real flag." },
} satisfies Record<string, { default: boolean; description: string }>;

export type FlagKey = keyof typeof featureFlags;
export const flagKeys = Object.keys(featureFlags) as FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.hasOwn(featureFlags, key);
}

export const flagEvaluation = v.object({
  enabled: v.boolean(),
  source: v.union(v.literal("default"), v.literal("override"), v.literal("allowlist")),
});
type FlagEvaluation = Infer<typeof flagEvaluation>;

type DbCtx = Pick<QueryCtx, "auth" | "db" | "log">;
type FlagCtx = DbCtx | Pick<ActionCtx, "runQuery" | "log">;

// A deployment-wide override applies to everyone, allowlisted users included.
// Without one, allowlisted users get the flag and everyone else the default.
export function evaluateFlag(key: FlagKey, row: Doc<"featureFlags"> | null, userId: Id<"users"> | null): FlagEvaluation {
  if (row?.override !== undefined) return { enabled: row.override, source: "override" };
  if (userId && row?.allowlist?.includes(userId)) return { enabled: true, source: "allowlist" };
  return { enabled: featureFlags[key].default, source: "default" };
}

export function flagRow(ctx: Pick<QueryCtx, "db">, key: FlagKey) {
  return ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", key)).unique();
}

// The caller's user ID, or null when signed out or not yet provisioned. Flags
// evaluate for signed-out callers too, so this never throws.
export async function flagUserId(ctx: DbCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (user) ctx.log.setUser(user._id);
  return user?._id ?? null;
}

// Use in queries, mutations, and actions. The decision records the flag's
// value and why it has it.
export async function isFlagEnabled(ctx: FlagCtx, key: FlagKey) {
  const { enabled, source }: FlagEvaluation = "db" in ctx
    ? evaluateFlag(key, await flagRow(ctx, key), await flagUserId(ctx))
    : await ctx.runQuery(internal.featureFlags.evaluate, { key });
  ctx.log.decision("feature_flag", { key, enabled, source });
  return enabled;
}

// Guards a backend function behind a flag. Hiding the UI does not stop a
// direct call, so every function a flag gates must check it here.
export async function requireFlag(ctx: FlagCtx, key: FlagKey) {
  if (!await isFlagEnabled(ctx, key)) throw appError("FEATURE_UNAVAILABLE");
}
