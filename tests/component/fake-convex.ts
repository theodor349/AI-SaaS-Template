import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";

// Stands in for convex/react in component tests:
//
//   vi.mock("convex/react", () => import("@/tests/component/fake-convex"));
//
// Tests set each query's result and answer each action or mutation. A query
// without a result is still loading, and a call nothing answers rejects.

type Callable = FunctionReference<"action" | "mutation">;

const queries = new Map<string, unknown>();
const handlers = new Map<string, (args: never) => unknown>();
const callers = new Map<string, (args?: unknown) => Promise<unknown>>();
const listeners = new Set<() => void>();
let version = 0;

export const auth = { isLoading: false, isAuthenticated: true, isRefreshing: false };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets the result every subscriber to `query` receives. Wrap in act() once rendered. */
export function setQuery<Query extends FunctionReference<"query">>(query: Query, value: FunctionReturnType<Query> | undefined) {
  queries.set(getFunctionName(query), value);
  version++;
  for (const listener of listeners) listener();
}

/** Answers every call to `fn`. Return a promise to settle the call later. */
export function onCall<Fn extends Callable>(fn: Fn, handler: (args: FunctionArgs<Fn>) => FunctionReturnType<Fn> | Promise<FunctionReturnType<Fn>>) {
  handlers.set(getFunctionName(fn), handler);
}

export function resetConvex() {
  queries.clear();
  handlers.clear();
  Object.assign(auth, { isLoading: false, isAuthenticated: true, isRefreshing: false });
}

export function useQuery<Query extends FunctionReference<"query">>(query: Query, args?: FunctionArgs<Query> | "skip") {
  useSyncExternalStore(subscribe, () => version);
  if (args === "skip") return undefined;
  return queries.get(getFunctionName(query)) as FunctionReturnType<Query> | undefined;
}

// Stable per function, like the real hooks, so effects that depend on a call don't rerun.
function useCall(fn: Callable) {
  const path = getFunctionName(fn);
  let call = callers.get(path);
  if (!call) {
    call = async (args) => {
      const handler = handlers.get(path);
      if (!handler) throw new Error(`No fake answers ${path}`);
      return handler(args as never);
    };
    callers.set(path, call);
  }
  return call;
}

export const useAction = useCall;
export const useMutation = useCall;

export function useConvexAuth() {
  return auth;
}

export function useConvex() {
  return { url: "https://convex.test" };
}
