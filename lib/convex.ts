"use client";

import { useAction as useConvexAction, useMutation as useConvexMutation } from "convex/react";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";
import { useCallback } from "react";
import { activeBrowserSentry } from "@/lib/sentry/active";

// Use these instead of the convex/react hooks. Each call starts a flow that
// the backend's wide events, and any work they schedule, share; see
// docs/internals/logging.md. Queries don't carry flows. While browser Sentry
// runs, the flow also carries its trace ID.
function withFlow<Ref extends FunctionReference<"mutation" | "action">>([args]: OptionalRestArgs<Ref>) {
  const sentryTraceId = activeBrowserSentry()?.traceId();
  const flow = { flowId: crypto.randomUUID(), ...(sentryTraceId && { sentryTraceId }) };
  return [{ ...args, flow }] as OptionalRestArgs<Ref>;
}

export function useMutation<Mutation extends FunctionReference<"mutation">>(mutation: Mutation) {
  const run = useConvexMutation(mutation);
  return useCallback(
    (...args: OptionalRestArgs<Mutation>): Promise<FunctionReturnType<Mutation>> => run(...withFlow<Mutation>(args)),
    [run],
  );
}

export function useAction<Action extends FunctionReference<"action">>(action: Action) {
  const run = useConvexAction(action);
  return useCallback(
    (...args: OptionalRestArgs<Action>): Promise<FunctionReturnType<Action>> => run(...withFlow<Action>(args)),
    [run],
  );
}
