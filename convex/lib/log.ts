import { ConvexError, v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";

// One wide event per function invocation; see docs/internals/logging.md.
// Values are system IDs, codes, counts, and flags. Never log emails, names,
// Clerk IDs, token identifiers, IP addresses, payloads, or provider errors.
export type LogValue = string | number | boolean | null | undefined;
export type LogValues = Record<string, LogValue>;

export const flowValidator = v.object({ flowId: v.string(), sentryTraceId: v.optional(v.string()) });
export type Flow = Infer<typeof flowValidator>;

export type FunctionKind = "query" | "mutation" | "action";

// Errors always log; successes are sampled by function kind. Rates come from
// LOG_SAMPLE_RATE_{QUERY,MUTATION,ACTION}, between 0 and 1.
const defaultSampleRates: Record<FunctionKind, number> = { query: 0, mutation: 1, action: 1 };

// Starts a flow, or continues one from the browser or a calling function.
export function startFlow(flow?: Flow): Flow {
  if (flow && /^[\w-]{1,64}$/.test(flow.flowId)) return flow;
  return { flowId: crypto.randomUUID() };
}

export class RequestLog {
  private userId?: Id<"users">;
  private customerId?: string;
  private subscriptionId?: string;
  private readonly path: ({ decision: string } & LogValues)[] = [];
  private readonly attributes: LogValues = {};
  private failed = false;

  constructor(readonly flow: Flow, private readonly operation?: string) {}

  setUser(userId: Id<"users">) {
    this.userId = userId;
  }

  setCustomer(customerId: string) {
    this.customerId = customerId;
  }

  setSubscription(subscriptionId: string) {
    this.subscriptionId = subscriptionId;
  }

  // Records a branch the handler took and the values that decided it.
  decision(name: string, values: LogValues = {}) {
    this.path.push({ decision: name, ...values });
  }

  set(key: string, value: LogValue) {
    this.attributes[key] = value;
  }

  // The handler recovered, but the outcome is a failure worth alerting on.
  markAsError() {
    this.failed = true;
  }

  // Handled, but a human must act. Always logged as an error.
  adminAction(text: string) {
    this.set("adminAction", text);
    this.markAsError();
  }

  event(error?: unknown) {
    return {
      flowId: this.flow.flowId,
      sentryTraceId: this.flow.sentryTraceId,
      userId: this.userId,
      customerId: this.customerId,
      subscriptionId: this.subscriptionId,
      operation: this.operation,
      status: error !== undefined || this.failed ? "error" as const : "success" as const,
      error: error === undefined ? undefined : describeError(error),
      path: this.path,
      attributes: this.attributes,
    };
  }

  // Called once by the function builders when the handler finishes.
  emit(kind: FunctionKind, options: { alwaysLog?: boolean; error?: unknown } = {}) {
    const event = this.event(options.error);
    if (event.status === "error") {
      console.error(JSON.stringify(event));
    } else if (options.alwaysLog || Math.random() < sampleRate(kind)) {
      console.log(JSON.stringify(event));
    }
  }
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: "NonError", message: String(error) };
  const data: unknown = error instanceof ConvexError ? error.data : undefined;
  const code = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string"
    ? data.code : undefined;
  return { name: error.name, code, message: error.message, stack: error.stack };
}

function sampleRate(kind: FunctionKind) {
  const configured = {
    query: env.LOG_SAMPLE_RATE_QUERY,
    mutation: env.LOG_SAMPLE_RATE_MUTATION,
    action: env.LOG_SAMPLE_RATE_ACTION,
  }[kind];
  const rate = configured?.trim() ? Number(configured) : NaN;
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : defaultSampleRates[kind];
}
