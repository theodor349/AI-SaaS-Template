# Hosted development deployment

A Vercel project deploys `main` to a Convex project's production deployment.
This is a shared development environment with disposable test data, Clerk
development keys, and Polar sandbox payments.

This repository's instance: Vercel project `ai-saas-template`
(`https://ai-saas-template-hazel.vercel.app`), Convex deployment
`kindhearted-bandicoot-875` (reference `cloud-dev`) in the `jes` team's
`ai-saas-template` project, and a Sentry project in Sentry's EU region
(`ingest.de.sentry.io`) whose DSN is set in Vercel. Downstream projects replace
these values.

## Vercel

Import the GitHub repository into Vercel, select Next.js with the repository root
as Root Directory, and set the Production Branch to `main`. Use Node.js 24.x,
matching `package.json` and CI. Build and install commands come from
[`vercel.json`](../vercel.json). Its Git configuration disables automatic
deployments for every other branch, including branches whose names contain `/`.
The project's Ignored Build Step also skips non-`main` branches, including older
branches that do not yet contain `vercel.json`.

Set these environment variables for **Production only**:

| Variable | Value |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | Production deployment key generated in Convex; grant `deployment:deploy` and write access to environment variables, which the build needs to [pause the app](#pausing-the-app). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Existing Clerk development publishable key (`pk_test_...`). |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key (`sk_test_...`). |
| `NEXT_PUBLIC_APP_URL` | The Vercel project's stable application URL. The build needs it to render the legal pages. |
| `NEXT_PUBLIC_AUTHENTICATED_DESTINATION` | `/app`, or the intended authenticated landing route. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional. The Sentry project's DSN. Without it, neither browser nor server Sentry loads. |
| `WORKTREE_ID` | `cloud-dev`, matching Convex below; becomes the Sentry `environment`. |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Optional share of page loads and navigations traced, between 0 and 1; defaults to 1. |
| `SENTRY_AUTH_TOKEN` | Optional. A Sentry organization auth token, for uploading source maps. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | The organization and project slugs the source maps belong to. Needed with `SENTRY_AUTH_TOKEN`. |
| `MAINTENANCE_MODE` | Optional. `1` pauses the app in this build; see [pausing the app](#pausing-the-app). Any other value fails the build. |
| `CSP_REPORT_ONLY` | Optional. `1` sends the Content Security Policy as report-only, so violations are reported (to Sentry, with a DSN) but not blocked; see [security headers](internals/security-headers.md). |

Next.js reports errors from server components, route handlers, Server Functions,
and `proxy.ts` through [`instrumentation.ts`](../instrumentation.ts). It reports errors
only; it doesn't trace server requests. Browser Sentry starts only after a visitor grants
analytics consent; see [consent](internals/consent.md). Both tag events with the
`environment` from `WORKTREE_ID` and the `release` from the Vercel Git SHA, which Vercel
exposes to the build automatically. They send no cookies, IP addresses, or user details,
and they scrub emails and credentials; see [the shared options](../lib/sentry/options.ts).

With `SENTRY_AUTH_TOKEN` set, the build uploads source maps for the release and
removes them from the deployment. Without it the build skips Sentry's build plugin.
A failed upload logs a warning and doesn't fail the deployment.

Leave `ALLOW_SEARCH_INDEXING` unset. Without it, `robots.txt` disallows every
page, so search engines skip this shared development deployment and worktrees.
Do not set `CONVEX_DEPLOYMENT` or copy a worktree's `.env.local` into Vercel.
`convex deploy` supplies `NEXT_PUBLIC_CONVEX_URL` to the Next.js build. Backend
secrets belong on Convex, not in browser variables or Depot CI; only the
E2E workflow below holds development credentials there.

`pnpm build:vercel` runs application unit tests and lint before invoking
`convex deploy --cmd 'pnpm exec next build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`.
Lint has already typechecked, so the build command skips `pnpm build`'s separate
`tsc` pass. Convex builds the frontend first and only pushes the backend after a
successful build. Vercel then publishes the frontend. This is not an atomic release across
both providers: if publication fails after Convex deploys, the previous frontend
continues running against the updated backend. Keep API/schema changes compatible
with that frontend; a Vercel rollback does not roll back Convex.

## Convex

On the Convex project's **production deployment**, set:

| Variable | Value |
| --- | --- |
| `WORKTREE_ID` | `cloud-dev`; keep this stable and distinct from local worktrees. |
| `APP_URL` | The same stable Vercel application URL. |
| `CLERK_JWT_ISSUER_DOMAIN` | Existing Clerk development Frontend API URL. |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Signing secret of the dedicated hosted Clerk webhook below. |
| `POLAR_ENVIRONMENT` | `sandbox`. |
| `POLAR_ACCESS_TOKEN` | A token for the existing Polar sandbox organization, including the `refunds:read` and `refunds:write` scopes for withdrawals. |
| `POLAR_ORGANIZATION_ID` | That sandbox organization's ID. |
| `POLAR_PRODUCT_MONTHLY` | Monthly fixed-price sandbox product ID. |
| `POLAR_PRODUCT_YEARLY` | Yearly fixed-price sandbox product ID. |
| `POLAR_PRODUCT_LIFETIME` | One-time fixed-price sandbox product ID. |
| `POLAR_WEBHOOK_SECRET` | Signing secret of the dedicated hosted Polar webhook below. |
| `LOG_SAMPLE_RATE_QUERY`, `LOG_SAMPLE_RATE_MUTATION`, `LOG_SAMPLE_RATE_ACTION` | Optional success-event sampling, between 0 and 1; see [logging](internals/logging.md#sampling-and-attention). |
| `RESEND_API_KEY` | A Resend API key with sending access. Required by law for withdrawal receipts; see [legal documents](internals/legal-documents.md#withdrawal-function). |
| `EMAIL_FROM` | The sender, e.g. `AI SaaS Template <receipts@example.com>`, on a domain verified in Resend. |
| `OPERATOR_ALERT_EMAIL` | Where operator alerts go, such as a user withdrawing more than once. This repository's hosted deployment uses `theodor@justenoughsolutions.com`; set your own operator's address. Without it, or without Resend, the event records an admin action instead. |

The three products must be distinct, unarchived, and have positive fixed prices;
the recurring products must use a single-month and single-year interval. Make each
price tax-inclusive, because prices shown to EU consumers must include VAT. Set it on
each price or as the organization's default tax behavior, which a price without its
own setting follows. The pricing cards say "Tax included" for tax-inclusive prices and
that tax is added at checkout otherwise. Reuse
the local sandbox products. If local credentials omit their IDs, select or create
the three products in the sandbox dashboard.

Enable Clerk's Convex integration or its `convex` JWT template (`aud=convex`).
Both frontends share Clerk accounts, so account edits/deletions affect both.
Billing customers and subscriptions are separated by the deployment namespace;
buying a sandbox subscription locally does not grant hosted access.

### Sentry for Convex functions

Convex functions report errors through Convex's built-in exception reporting, not a
Sentry SDK in the functions. It needs the Convex Pro plan. In the production deployment's
**Settings > Integrations**, add Sentry with the DSN of a separate Sentry project using the
Node.js platform. Convex tags its events with its own `environment` (`prod` for this
deployment), so a shared project would mix them with the Next.js `cloud-dev` events.
Filter the Convex logs by an event's `request_id` tag to find the function's wide
event and its `flowId`.

Convex sets Sentry's user ID to the caller's Clerk token identifier, which the
[logging rules](internals/logging.md#no-personal-data) keep out of logs. Add an
Advanced Data Scrubbing rule to that Sentry project: **Remove** **Anything** from
`$user`.

Local worktree deployments don't report to Sentry. Their errors stay in the structured
logs, which `pnpm bootstrap` writes to its log file.

## Hosted webhooks

Use the production deployment's **HTTP Actions URL**
(`https://<deployment>.convex.site`), not its `.convex.cloud` client URL:

- In the Clerk development instance, add `/webhooks/clerk` for `user.created`,
  `user.updated`, and `user.deleted`. Store this endpoint's signing secret on
  hosted Convex as `CLERK_WEBHOOK_SIGNING_SECRET`.
- In the Polar sandbox organization, add `/webhooks/polar` for customer,
  checkout, subscription, order, and refund lifecycle events. Store this
  endpoint's signing secret on hosted Convex as `POLAR_WEBHOOK_SECRET`.

Keep the local bootstrap's Polar forwarding separate. The hosted endpoint needs
to receive events even when no local environment is running. Shared sandbox
events reach multiple listeners; billing ignores customers from other deployment
namespaces. Changing shared products affects every environment using them.

## Pausing the app

Pause the app during a migration or any other change that must not race with
users' edits. While it is paused, the landing and legal pages stay up with their
plan buttons disabled. Sign-in, sign-up, checkout, and every signed-in page show
a maintenance notice at their usual address.

To pause, set `MAINTENANCE_MODE=1` in Vercel's Production environment and
redeploy `main`. To resume, remove it and redeploy. Next.js reads the variable at
build time, so each change needs a deployment.

After a successful build, `pnpm build:vercel` copies the value to the Convex
production deployment, or removes it there. While it is set, every public mutation
and action fails with the `MAINTENANCE_MODE` error code, including calls from tabs
opened before the paused frontend deployed. Queries, internal functions, crons,
and the Clerk and Polar webhooks keep running, so provider events aren't lost and
migrations can write. Start the migration once the paused deployment is live.

Vercel is the only switch. A value set by hand on Convex lasts until the next
deployment of `main` replaces it with Vercel's.

The app hides its sign-up form, but Clerk's hosted pages still accept new
accounts, and the Clerk webhook records them. If no account may be created at
all, also turn on restricted sign-up mode in Clerk.

To try the paused app in a worktree, add `MAINTENANCE_MODE=1` to that worktree's
own `.env.bootstrap.local` and restart bootstrap; the main checkout's file can't
pause other worktrees. Bootstrap sets or removes the variable on the local Convex
deployment to match.

## Checks and launch

[Depot CI](https://depot.dev/docs/ci/overview) runs the workflows in
[`.depot/workflows`](../.depot/workflows). The [CI workflow](../.depot/workflows/ci.yml)
runs `Lint and typecheck`, `Unit tests`, and `Next.js build` as steps of one
`Checks` job on every pull request, regardless of source or target branch. It does not run again after a merge: complete-worktree merges a pull
request only once it contains the latest `main`, so the merge commit holds the
tree CI already checked. There are no preview deployments, so `Next.js build` is
what catches a broken production build before Vercel does. It runs `next build`
with fake, well-formed placeholders for the browser variables read while building
and prerendering; the checks need no hosted credentials. Each step runs even when
an earlier one fails, so each reports its failures, and new pushes cancel outdated
runs. The checks share a job so dependencies install once. Integration and
browser tests need bootstrap services and run in the E2E workflow below.

The separate [E2E workflow](../.depot/workflows/e2e.yml) runs `pnpm test:integration`
and `pnpm test:e2e` against a local bootstrap stack. It runs nightly on `main`,
on manual dispatch, and on pull requests labeled `run-e2e`; the label keeps it from
spending the Clerk and Polar rate limits that local agents share. The nightly run
skips a commit that already passed. A failed nightly run shows as a failed check
on that `main` commit and in `depot ci run list --status failed`. It needs these
Depot CI secrets, using the same values as a local `.env.bootstrap.local`. Add
each one scoped to the repository, piping the value in so it stays out of shell
history: `printf '%s' "$VALUE" | depot ci secrets add NAME --repo owner/repo`.

| Secret | Value |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk development publishable key (`pk_test_...`). |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key (`sk_test_...`). |
| `POLAR_ACCESS_TOKEN` | Sandbox organization access token, including the `refunds:read` and `refunds:write` scopes. The discount-code test also needs `discounts:read` and `discounts:write` to create its own code, and skips without them. |
| `POLAR_ORGANIZATION_ID` | Optional; needed when the token can access several organizations. |
| `POLAR_PRODUCT_MONTHLY`, `POLAR_PRODUCT_YEARLY`, `POLAR_PRODUCT_LIFETIME` | The sandbox product IDs. |

Polar is required because the suites check the synced catalog, signed Polar
webhooks, and sandbox customers. Without the secrets, as on fork pull requests,
the workflow reports a notice and skips. Do not make it a required check, since
unlabeled pull requests never run it.

Jobs run on Depot's `depot-ubuntu-24.04` sandboxes, which are fresh for every
job and have no IPv6. Depot needs its Code Access GitHub app installed on the
repository; it reports each job back to GitHub as a check run named
`<workflow> / <job>`, such as `CI / Checks`. Require `CI / Checks` in a GitHub
branch ruleset for `main` if merges should be blocked on failures.

Vercel independently runs `pnpm test:app` and `pnpm lint` before deployment.
The dev-server fixtures in `test:bootstrap` run in Depot CI and locally:
Vercel's build worker does not reliably support the
fixture's loopback rewrite. Application test or lint failures still stop the
Vercel build before Convex deployment.

After the first deployment, verify hosted sign-in, a sandbox checkout returning
to the stable app URL, paid access, and delivery of both providers' webhooks.
Initialize the public product catalog after deploying to a fresh database:

```sh
pnpm exec convex run --deployment <team>:<project>:cloud-dev billing/polar:syncCatalog '{}'
```

The catalog is subsequently refreshed by the existing six-hour cron job.
Use test accounts and test cards. Before accepting real users/payments, configure
Clerk production and Polar production credentials, products, and webhook secrets;
plan the new Clerk user identities and billing associations rather than assuming
development data transfers. Clerk development accounts remain test accounts.
Set `ALLOW_SEARCH_INDEXING=true` only on that public production deployment, with
`NEXT_PUBLIC_APP_URL` as its public origin; both are read at build time.
That build also fails until `companyCvr` and `companyAddress` in `app.config.ts`
replace the template's example company details, which the legal pages publish.

Provider references: [Convex on Vercel](https://docs.convex.dev/production/hosting/vercel),
[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[Clerk environments](https://clerk.com/docs/guides/development/managing-environments),
[Polar sandbox](https://polar.sh/docs/integrate/sandbox).
