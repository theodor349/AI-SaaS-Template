import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  evaluateFlag, flagEvaluation, flagKeys, flagRow, flagUserId, isFlagKey, type FlagKey,
} from "./lib/featureFlags";
import { internalMutation, internalQuery, query, type MutationCtx } from "./lib/functions";

// Every flag's value for the caller, read by useFlag. One subscription serves
// all flags, and the result carries only the caller's values, never allowlists.
export const current = query({
  args: {}, returns: v.record(v.string(), v.boolean()),
  handler: async (ctx) => {
    const userId = await flagUserId(ctx);
    const values = await Promise.all(flagKeys.map(async (key) =>
      [key, evaluateFlag(key, await flagRow(ctx, key), userId).enabled] as const));
    return Object.fromEntries(values);
  },
});

// isFlagEnabled's evaluation for actions, which have no database access.
export const evaluate = internalQuery({
  args: { key: v.string() }, returns: flagEvaluation,
  handler: async (ctx, args) => {
    const key = knownFlag(args.key);
    return evaluateFlag(key, await flagRow(ctx, key), await flagUserId(ctx));
  },
});

// Flag state for maintainers, run from the CLI (docs/internals/feature-flags.md).
// `enabled: null` removes the override.
export const setOverride = internalMutation({
  args: { key: v.string(), enabled: v.union(v.boolean(), v.null()) }, returns: v.null(),
  handler: async (ctx, { key, enabled }) => {
    await updateFlag(ctx, knownFlag(key), (state) => ({ ...state, override: enabled ?? undefined }));
    return null;
  },
});

export const allowUser = internalMutation({
  args: { key: v.string(), userId: v.id("users") }, returns: v.null(),
  handler: async (ctx, { key, userId }) => {
    if (!await ctx.db.get("users", userId)) throw new Error(`No user ${userId}`);
    await updateFlag(ctx, knownFlag(key), (state) => ({
      ...state, allowlist: [...(state.allowlist ?? []).filter((id) => id !== userId), userId],
    }));
    return null;
  },
});

export const disallowUser = internalMutation({
  args: { key: v.string(), userId: v.id("users") }, returns: v.null(),
  handler: async (ctx, { key, userId }) => {
    await updateFlag(ctx, knownFlag(key), (state) => ({
      ...state, allowlist: state.allowlist?.filter((id) => id !== userId),
    }));
    return null;
  },
});

function knownFlag(key: string) {
  if (!isFlagKey(key)) throw new Error(`Unknown feature flag: ${key}`);
  return key;
}

type FlagState = { override?: boolean; allowlist?: Id<"users">[] };

// Writes the flag's next state, deleting the row once it matches the default.
async function updateFlag(ctx: MutationCtx, key: FlagKey, next: (state: FlagState) => FlagState) {
  const row = await flagRow(ctx, key);
  const { override, allowlist } = next({ override: row?.override, allowlist: row?.allowlist });
  const state = { override, allowlist: allowlist?.length ? allowlist : undefined };
  ctx.log.decision("feature_flag_state", { key, override, allowlisted: state.allowlist?.length ?? 0 });
  if (state.override === undefined && state.allowlist === undefined) {
    if (row) await ctx.db.delete("featureFlags", row._id);
  } else if (row) {
    await ctx.db.patch("featureFlags", row._id, state);
  } else {
    await ctx.db.insert("featureFlags", { key, ...state });
  }
}
