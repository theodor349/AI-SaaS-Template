# Cookie consent and optional services

Anything that stores data in the browser or sends visitor data to a third party, other than what the app needs to work, runs only after the visitor agrees. The [service registry](../../lib/consent/services.ts) is the single source for that: the preferences dialog, the cookie table on `/cookies`, and the runner that loads and unloads services are all generated from it. A service that bypasses the registry, for example by initializing an SDK at import time or from `instrumentation-client.ts`, escapes the consent check and the cookie table at once. Load its code with a dynamic `import()` inside `load`, so visitors who decline never download it.

## The choice is read only in the browser

The choice is a first-party `consent` cookie holding the policy version, per-category choices, and the decision time; [cookie.ts](../../lib/consent/cookie.ts) parses and writes it. Reading it with `cookies()` on the server would make every page dynamic, so only the browser reads it, after hydration. Until then consent is unknown: services don't load, and the banner doesn't render. The banner is a fixed overlay, so showing it after hydration causes no layout shift.

The cookie is written from the browser, so Safari caps it at 7 days and asks Safari visitors again sooner than 12 months. Writing it from the server would avoid the cap, but a Server Function that sets a cookie re-renders the current route.

Bump `CONSENT_POLICY_VERSION` when users must agree again, for example on adding a category or a service that collects something new. A cookie from another version counts as no choice.

## Loading and withdrawal

[`ConsentServices`](../../components/consent/consent-services.tsx) syncs one module-level [runner](../../lib/consent/runner.ts) with the current choice, so remounts don't load a service twice. It runs each service's transitions in order: a withdrawal waits for a pending load, then calls `unload` and clears the first-party storage the service listed. Withdrawal takes effect without a reload, so `unload` must leave the service inert even though its code stays in memory.

Browser Sentry is the analytics example. While it runs, [`activeBrowserSentry`](../../lib/sentry/active.ts) exposes it to error boundaries, router-transition tracking, and logging flows; code elsewhere must go through it rather than importing `@sentry/nextjs`, which would bundle and run the SDK for every visitor. After withdrawal the closed client keeps its global handlers but drops events. [Shared options](../../lib/sentry/options.ts) carry the privacy settings, including scrubbing of emails and credentials.

Bootstrap's local stack points the DSN at a fake same-origin ingest route ([next.config.js](../../next.config.js)), which also receives server Sentry's events, so E2E tests observe envelopes without a Sentry project and worktrees never report to a real one.
