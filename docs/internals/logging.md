# Backend logging

Every Convex function emits one JSON **wide event** when its handler finishes: successes through `console.log`, errors through `console.error`. The event carries correlation IDs, the system IDs the handler resolved, the ordered decisions it took, and its outcome. [`RequestLog`](../../convex/lib/log.ts) defines the shape. Handlers add to it through `ctx.log`. They don't call `console.*` directly. Convex's own function-execution logs supply the function path and duration. Events have no timing fields because `Date.now()` is frozen inside queries and mutations.

The [builders](../../convex/lib/functions.ts) wrap `convex/_generated/server`, and [client hooks](../../lib/convex.ts) wrap `useMutation` and `useAction` from `convex/react`. ESLint rejects the raw versions anywhere else, so an unlogged function or a call without a flow fails `pnpm lint`. The builders rethrow the original error after logging it. Clients still receive the typed `appError`, and `hasErrorCode` still works.

## No personal data

Events hold system IDs, codes, counts, and flags. `userId` is always a Convex `users._id`. Never log emails, names, Clerk IDs, token identifiers (including Polar external IDs, which embed them), IP addresses, webhook payloads, or provider secrets. Arguments are never logged automatically, so this rule binds what handlers pass to `ctx.log`.

Error messages and stacks *are* logged, so code must not throw errors that carry personal data. Provider SDK errors do: Polar's include the response body. Polar code records `providerFailure` (error name and HTTP status) and throws a generic error in its place. Clerk provisioning logs only the step that failed. Wrap any new provider the same way. [`logging.test.ts`](../../convex/logging.test.ts) checks a fixture user's personal data never reaches an event. Extend it when a new flow handles personal data.

## Sampling and attention

Errors always log. Successes are sampled per function kind with `LOG_SAMPLE_RATE_QUERY`, `LOG_SAMPLE_RATE_MUTATION`, and `LOG_SAMPLE_RATE_ACTION`. The defaults are 0 for queries, because reactive queries re-run constantly, and 1 for mutations and actions. HTTP actions sample as actions. The webhook routes set `alwaysLog`, which other low-volume, high-value functions may also use.

`ctx.log.markAsError()` reports a failure the handler recovered from, such as a reconciliation that will retry. `ctx.log.adminAction(text)` also marks the event as an error, for outcomes a human must resolve, such as an unclaimed Polar customer. Both bypass sampling, so alerting can filter on `status` and `attributes.adminAction`.

## Flows

`flowId` links every event caused by one user action. The client hooks generate it in the browser and pass it as the optional `flow` argument, which the builders add to every mutation and action. Inside a flow, the builders' `ctx.runMutation`, `ctx.runAction`, and `ctx.scheduler` pass the same `flow` to app functions. A scheduled reconciliation, a retry it schedules, and the provider calls it makes therefore share the browser's `flowId`. Component functions and function handles don't declare `flow`, so they don't receive it. Queries never carry a flow.

Crons, webhook deliveries, and calls without a flow start a new one. Each webhook delivery attempt is its own flow and records the provider's delivery ID. `sentryTraceId` travels with the flow when the visitor has granted analytics consent and browser Sentry is running; the client hooks read it from [`activeBrowserSentry`](../../lib/sentry/active.ts).
