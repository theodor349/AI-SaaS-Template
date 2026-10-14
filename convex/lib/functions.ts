import { customAction, customMutation, customQuery, type CustomCtx } from "convex-helpers/server/customFunctions";
import { getFunctionAddress, type FunctionReference, type Scheduler } from "convex/server";
import { v } from "convex/values";
import {
  action as rawAction,
  httpAction as rawHttpAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
  type ActionCtx as RawActionCtx,
  type MutationCtx as RawMutationCtx,
} from "../_generated/server";
import { flowValidator, RequestLog, startFlow, type Flow, type FunctionKind } from "./log";

// Every Convex function is registered through these builders, which emit one
// wide event per invocation (docs/internals/logging.md). Handlers record
// context on `ctx.log`. Optional per-function settings:
// - `operation` labels one flow step that spans several functions.
// - `alwaysLog` bypasses success sampling for low-volume, high-value functions.
type LogOptions = { operation?: string; alwaysLog?: boolean };

// Mutations and actions accept the caller's flow. Browser hooks in lib/convex.ts
// start one per user action; scheduled and nested calls below carry it on.
const flowArgs = { flow: v.optional(flowValidator) };

type Run = (reference: FunctionReference<"mutation" | "action", "public" | "internal">, ...rest: unknown[]) => Promise<unknown>;

// Component functions and function handles don't declare `flow`, so only app
// function references receive it.
function withFlow(reference: Parameters<Run>[0], [args, ...rest]: unknown[], flow: Flow) {
  if (getFunctionAddress(reference).name === undefined) return [args, ...rest];
  return [{ ...(args as object | undefined), flow }, ...rest];
}

function forwardFlow<T>(run: T, flow: Flow): T {
  const call = run as unknown as Run;
  const forwarded: Run = (reference, ...rest) => call(reference, ...withFlow(reference, rest, flow));
  return forwarded as unknown as T;
}

function flowScheduler(scheduler: Scheduler, flow: Flow): Scheduler {
  const schedule = scheduler as unknown as Record<"runAfter" | "runAt", (when: number | Date, ...call: Parameters<Run>) => Promise<unknown>>;
  return {
    runAfter: ((delay: number, reference: Parameters<Run>[0], ...rest: unknown[]) =>
      schedule.runAfter(delay, reference, ...withFlow(reference, rest, flow))) as Scheduler["runAfter"],
    runAt: ((timestamp: number | Date, reference: Parameters<Run>[0], ...rest: unknown[]) =>
      schedule.runAt(timestamp, reference, ...withFlow(reference, rest, flow))) as Scheduler["runAt"],
    cancel: (id) => scheduler.cancel(id),
  };
}

function mutationContext(ctx: RawMutationCtx, flow: Flow | undefined, { operation }: LogOptions) {
  const log = new RequestLog(startFlow(flow), operation);
  return {
    log,
    runMutation: forwardFlow(ctx.runMutation, log.flow),
    scheduler: flowScheduler(ctx.scheduler, log.flow),
  };
}

function actionContext(ctx: RawActionCtx, flow: Flow | undefined, { operation }: LogOptions) {
  const log = new RequestLog(startFlow(flow), operation);
  return {
    log,
    runMutation: forwardFlow(ctx.runMutation.bind(ctx), log.flow),
    runAction: forwardFlow(ctx.runAction.bind(ctx), log.flow),
    scheduler: flowScheduler(ctx.scheduler, log.flow),
  };
}

type Definition = LogOptions & { handler: (ctx: { log: RequestLog }, args: object) => unknown };

// Emits the event when the handler settles and rethrows the original error,
// so clients still receive typed `appError` codes.
function withEvents<Builder>(kind: FunctionKind, builder: Builder): Builder {
  const register = builder as unknown as (definition: Definition) => unknown;
  return ((definition: Definition) => register({
    ...definition,
    handler: async (ctx, args) => {
      try {
        const result = await definition.handler(ctx, args);
        ctx.log.emit(kind, { alwaysLog: definition.alwaysLog });
        return result;
      } catch (error) {
        ctx.log.emit(kind, { error });
        throw error;
      }
    },
  })) as Builder;
}

const queryLog = {
  args: {},
  input: (_ctx: object, _args: object, { operation }: LogOptions) =>
    ({ ctx: { log: new RequestLog(startFlow(), operation) }, args: {} }),
};
const mutationLog = {
  args: flowArgs,
  input: (ctx: RawMutationCtx, { flow }: { flow?: Flow }, options: LogOptions) =>
    ({ ctx: mutationContext(ctx, flow, options), args: {} }),
};
const actionLog = {
  args: flowArgs,
  input: (ctx: RawActionCtx, { flow }: { flow?: Flow }, options: LogOptions) =>
    ({ ctx: actionContext(ctx, flow, options), args: {} }),
};

export const query = withEvents("query", customQuery(rawQuery, queryLog));
export const internalQuery = withEvents("query", customQuery(rawInternalQuery, queryLog));
export const mutation = withEvents("mutation", customMutation(rawMutation, mutationLog));
export const internalMutation = withEvents("mutation", customMutation(rawInternalMutation, mutationLog));
export const action = withEvents("action", customAction(rawAction, actionLog));
export const internalAction = withEvents("action", customAction(rawInternalAction, actionLog));

export type QueryCtx = CustomCtx<typeof query>;
export type MutationCtx = CustomCtx<typeof mutation>;
export type ActionCtx = CustomCtx<typeof action>;

// Each request starts a new flow, such as one per webhook delivery. The event
// records the response status; success sampling follows actions.
export function httpAction(handler: (ctx: ActionCtx, request: Request) => Promise<Response>, options: LogOptions = {}) {
  return rawHttpAction(async (rawCtx, request) => {
    const ctx = { ...rawCtx, ...actionContext(rawCtx, undefined, options) };
    try {
      const response = await handler(ctx, request);
      ctx.log.set("responseStatus", response.status);
      ctx.log.emit("action", { alwaysLog: options.alwaysLog });
      return response;
    } catch (error) {
      ctx.log.emit("action", { error });
      throw error;
    }
  });
}
