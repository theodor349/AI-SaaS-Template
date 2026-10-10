import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType, type OptionalRestArgs } from "convex/server";

// ConvexHttpClient's public signatures omit internal references even when the
// local test client has admin auth. Preserve validator-derived argument/results.
export function adminQuery<Q extends FunctionReference<"query", "internal">>(client: ConvexHttpClient, ref: Q, ...args: OptionalRestArgs<Q>): Promise<FunctionReturnType<Q>> {
  return client.query(makeFunctionReference<"query", FunctionArgs<Q>, FunctionReturnType<Q>>(getFunctionName(ref)), ...args);
}
export function adminMutation<M extends FunctionReference<"mutation", "internal">>(client: ConvexHttpClient, ref: M, ...args: OptionalRestArgs<M>): Promise<FunctionReturnType<M>> {
  return client.mutation(makeFunctionReference<"mutation", FunctionArgs<M>, FunctionReturnType<M>>(getFunctionName(ref)), ...args);
}
