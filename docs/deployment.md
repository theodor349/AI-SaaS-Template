# Hosted development deployment

A Vercel project deploys `main` to a Convex project's production deployment.
This is a shared development environment with disposable test data, Clerk
development keys, and Polar sandbox payments.

This repository's instance: Vercel project `ai-saas-template`
(`https://ai-saas-template-hazel.vercel.app`), Convex deployment
`kindhearted-bandicoot-875` (reference `cloud-dev`) in the `jes` team's
`ai-saas-template` project, and a Sentry project in Sentry's EU region
(`ingest.de.sentry.io`) whose DSN is set in Vercel. Downstream projects replace
these values. `kindhearted-bandicoot-875` is in Convex's US region, even though the
privacy policy it serves lists Convex in the EU. It holds only test data, so it
stays there.

## Vercel

Import the GitHub repository into Vercel, select Next.js with the repository root
as Root Directory, and set the Production Branch to `main`. Use Node.js 24.x,
matching `package.json` and CI. Build and install commands come from
[`vercel.json`](../vercel.json). Its Git configuration disables automatic
deployments for every other branch, including branches whose names contain `/`.
Its Ignored Build Step,
[`scripts/vercel-ignore-build.mjs`](../scripts/vercel-ignore-build.mjs), also skips
non-`main` branches, and skips `main` commits that change only docs, agent files,
CI, tests, or dev scripts since the last successful deployment. Each kept
deployment's functions count toward Vercel's function storage limit, which is
10 GB on Hobby, so skipped builds also save storage. A redeploy, or any case where
Vercel doesn't report the last deployed commit, always builds. Set the project's
own Ignored Build Step to `test "$VERCEL_GIT_COMMIT_REF" != main` so older branches
that do not yet contain `vercel.json` are skipped too.

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
secrets belong on Convex, not in browser variables or GitHub Actions; only the
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

The privacy policy lists Convex as storing data in the EU, because most production
deployments run in Convex's EU region (Ireland). Before you create a new production
deployment, ask Theodor which region it goes in. If it isn't the EU, change the
Convex entry in [`lib/legal/subprocessors.ts`](../lib/legal/subprocessors.ts) to
match.

On the Convex project's **production deployment**, set the variables below. An
app [without billing](#running-without-billing) leaves out every `POLAR_*` one.

| Variable | Value |
| --- | --- |
| `WORKTREE_ID` | `cloud-dev`; keep this stable and distinct from local worktrees. |
| `APP_URL` | The same stable Vercel application URL. |
| `CLERK_JWT_ISSUER_DOMAIN` | Existing Clerk development Frontend API URL. |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Signing secret of the dedicated hosted Clerk webhook below. |
| `POLAR_ENVIRONMENT` | `sandbox`. |
| `POLAR_ACCESS_TOKEN` | The production app token from [Polar tokens](#polar-tokens), created in the existing Polar sandbox organization. |
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

In each Sentry project, both the Next.js one and the Convex one, turn on Prevent
Storing of IP Addresses:
`sentry api --method PUT projects/<org>/<slug>/ --data '{"scrubIPAddresses":true}'`.
CSP reports come straight from the browser, so without it Sentry stores the
visitor's IP.

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

## Polar tokens

An app needs up to three Polar organization access tokens. Organization tokens
can't create other tokens, so the maintainer creates each one: on the
organization's **Settings > Access Tokens** page, choose **Create token**, give it
a name, pick the expiry and select the scopes. The page is
`https://sandbox.polar.sh/dashboard/<organization>/settings/access-tokens` in the
sandbox and `https://polar.sh/dashboard/<organization>/settings/access-tokens` in
production. Sandbox and production organizations can share a name, so check the
organization ID before using a token.

Each token's scopes below are grouped one resource to a line, sorted
alphabetically, so you can find each one in Polar's scope list.

### Sandbox development token

Create it in the sandbox organization. It goes in the main checkout's
`.env.bootstrap.local` as `POLAR_ACCESS_TOKEN`, and the same value goes in the
`POLAR_ACCESS_TOKEN` [GitHub Actions secret](#checks-and-launch). Choose 365 days, and
renew it in both places.

- `checkouts:read`, `checkouts:write`
- `customer_sessions:write`
- `customers:read`, `customers:write`
- `discounts:read`, `discounts:write`
- `orders:read`
- `organizations:read`
- `products:read`, `products:write`
- `refunds:read`, `refunds:write`
- `subscriptions:read`, `subscriptions:write`
- `webhooks:read`, `webhooks:write`

### Production app token

Create it in the production organization. A deployment that runs on the sandbox,
like this repository's `cloud-dev`, gets its own token from the sandbox
organization instead. It goes in the Convex production deployment's
`POLAR_ACCESS_TOKEN`. Choose no expiration: an expired token stops checkout, the
customer portal and withdrawal refunds until someone replaces it.

- `checkouts:read`, `checkouts:write`
- `customer_sessions:write`
- `customers:read`, `customers:write`
- `orders:read`
- `organizations:read`
- `products:read`
- `refunds:read`, `refunds:write`
- `subscriptions:read`, `subscriptions:write`

### Production setup token

Create it in the production organization for setting up products, discount codes
and the webhook endpoint. It goes in a credentials file under
`$(git rev-parse --git-common-dir)`, such as a migration's `credentials.env`, as
`POLAR_PRODUCTION_SETUP_TOKEN`, never on Convex or in `.env.bootstrap.local`.
Choose 7 days, or 30 days when a migration needs it until cutover, and revoke it
once setup is done.

- `discounts:read`, `discounts:write`
- `organizations:read`
- `products:read`, `products:write`
- `webhooks:read`, `webhooks:write`

Relinking an old app's customers also needs `customers:read` and
`customers:write`. Setting the organization's default tax behavior through the
API needs `organizations:write`.

### Where the scopes come from

The production app token's scopes match the calls in
[`convex/billing/polar.ts`](../convex/billing/polar.ts): customers, checkouts,
customer portal sessions, subscription changes, orders and refunds for
withdrawals, and the products and organization that `syncCatalog` reads. The
sandbox token adds what worktrees and CI use: `webhooks:read` and `webhooks:write`
for bootstrap's `polar listen` and `pnpm polar:trigger`, `discounts:read` and
`discounts:write` for the discount-code E2E test, which skips without them, and
`products:write` to create the sandbox products through the API. When code starts calling another Polar endpoint, add its scope here.

## Running without billing

`billing: false` in [`app.config.ts`](../app.config.ts) launches the app free for
everyone, with no Polar account. Every signed-in user passes the paid-access
checks. Pricing, the Billing page and menu item, checkout, and the payment,
withdrawal, and Polar parts of the terms and privacy policy disappear. Signed-in
visitors to `/billing` and `/checkout` get a 404, because the app has nothing
there; signed-out ones get the usual sign-in redirect first. Public billing
functions fail with `BILLING_DISABLED`, and the billing cron jobs aren't
registered.

Leave every `POLAR_*` variable unset on Convex, and skip the Polar webhook, the
Polar tokens, and the Polar GitHub Actions secrets. Bootstrap runs as with `--no-polar` and
gives the local backend no Polar token, `pnpm setup:check` skips Polar, and the
integration and E2E suites skip their billing tests. Account deletion skips its
Polar cleanup while Polar isn't configured. The privacy policy then lists neither
Polar nor Resend, because the template only emails withdrawal receipts. When the
app sends other email, remove `billing: true` from Resend in
[`lib/legal/subprocessors.ts`](../lib/legal/subprocessors.ts).

To start selling, set `billing: true` and set up Polar as this page describes: the
Convex variables, the hosted webhook, the tokens, the GitHub Actions secrets, and one
`syncCatalog` run. The terms and privacy policy gain their payment sections, so
bump both versions and tell users before the change applies.

Turn billing off only before anyone has paid. In an app that has sold plans, Polar
keeps renewing subscriptions and a pending withdrawal still owes a refund, so cancel
the subscriptions and finish the refunds in Polar first.

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

GitHub Actions runs the workflows in [`.github/workflows`](../.github/workflows).
The [CI workflow](../.github/workflows/ci.yml)
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

The separate [E2E workflow](../.github/workflows/e2e.yml) runs `pnpm test:integration`
and the browser tests against a local bootstrap stack. The nightly run on `main`
covers only the tests tagged `@critical` and skips a commit that already passed.
On Sundays (UTC) the nightly runs the full suite instead. Manual dispatch runs
the full suite unless it picks `critical`; picking `nightly` repeats the nightly
run's choice. The nightly starts from ulm rather than GitHub's `schedule`
trigger, as [the CI runner](#the-ci-runner) describes. Pull requests run E2E
only with the `run-e2e` or `run-e2e-full` label, so they don't spend the Clerk
and Polar rate limits that local agents share. With `run-e2e`, every run, from
adding the label to each later push, runs the critical tests plus the specs that
[`tests/e2e/spec-map.json`](../tests/e2e/spec-map.json) maps to the files the
pull request changes against `main`. A change to a shared file, such as a
provider, the Convex schema, the lockfile or a bootstrap script, runs the full
suite, and so does runtime code that no rule in the map covers. Docs and agent
files add nothing beyond the critical tests. The `Select E2E tests` step in the
job log lists the selection and what caused it. `run-e2e-full` runs the full
suite on every run instead. A push cancels the run still in progress and tests
the new commit. A failed nightly run shows as a failed check
on that `main` commit and in `gh run list --workflow e2e.yml --status failure`.
Nightly runs are named `Nightly E2E`, so
`gh run list --workflow E2E --json displayTitle,conclusion,createdAt` tells them
apart from pull request and other manual runs. The workflow needs these GitHub Actions secrets, using the same values as a local
`.env.bootstrap.local`. Add each one to the repository, piping the value in so it
stays out of shell history: `printf '%s' "$VALUE" | gh secret set NAME --repo owner/repo`.

| Secret | Value |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk development publishable key (`pk_test_...`). |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key (`sk_test_...`). |
| `POLAR_ACCESS_TOKEN` | The sandbox development token from [Polar tokens](#polar-tokens). |
| `POLAR_ORGANIZATION_ID` | Optional; needed when the token can access several organizations. |
| `POLAR_PRODUCT_MONTHLY`, `POLAR_PRODUCT_YEARLY`, `POLAR_PRODUCT_LIFETIME` | The sandbox product IDs. |

Polar is required because the suites check the synced catalog, signed Polar
webhooks, and sandbox customers. An app [without billing](#running-without-billing)
needs only the Clerk secrets. Without the secrets, as on fork pull requests,
the workflow reports a notice and skips. Do not make it a required check, since
unlabeled pull requests never run it.

GitHub names each job's check run after the job, such as `Checks`. Require
`Checks` from GitHub Actions in a GitHub branch ruleset for `main` if merges
should be blocked on failures.

Vercel independently runs `pnpm test:app` and `pnpm lint` before deployment.
The dev-server fixtures in `test:bootstrap` run in CI and locally:
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

## The CI runner

The E2E workflow runs on a self-hosted runner on ulm, labeled `self-hosted` and
`ulm`, so its long runs use no GitHub Actions minutes. The `Checks` job runs on a
GitHub-hosted runner instead. It takes a few minutes per pull request, and on the
same runner it waited behind every running E2E suite, because a runner takes one
job at a time. GitHub registers self-hosted runners per repository for personal
accounts, so each repository has its own runner in `~/actions-runner/<repo>`, run
by the systemd user service `actions-runner@<repo>`.

Jobs run as the `ulm` user and can read its files, including the CLI logins in
its home directory. Register a runner only for a private repository whose pull
requests come from the maintainers and their agents, and leave the repository's
"Run workflows from fork pull requests" setting off, as GitHub does by default.
The runner keeps its workspace and caches between jobs, so the E2E job checks
out into a per-run directory and removes it, with its credentials file and local
database, when it ends. The runners for all repositories share the `ulm` home
directory, where concurrent installs into `pnpm/action-setup`'s default
`~/setup-pnpm` failed with `ENOTEMPTY`, so each job installs pnpm into its
runner's temporary directory, which the runner clears between jobs. Installing Chromium's system libraries takes sudo, which
jobs don't have, so a maintainer installed them on ulm once with
`sudo pnpm exec playwright install-deps chromium`.

To give a new app a runner, unpack the runner into its directory, register it,
and start its service:

```sh
repo=<repo>
mkdir ~/actions-runner/$repo
tar xzf ~/actions-runner/_dist/actions-runner-linux-x64-*.tar.gz -C ~/actions-runner/$repo
token=$(gh api -X POST repos/theodor349/$repo/actions/runners/registration-token --jq .token)
~/actions-runner/$repo/config.sh --unattended --url https://github.com/theodor349/$repo \
  --token "$token" --name ulm-$repo --labels ulm
systemctl --user enable --now actions-runner@$repo
```

The service is `~/.config/systemd/user/actions-runner@.service`. It copies the
runner's own systemd template, which needs root to install, and runs
`%h/actions-runner/%i/bin/runsvc.sh` with `Restart=always`. The runner updates
itself when GitHub releases a new version. Lingering is on for `ulm`, so the
services start at boot without a login. To see whether a repository's runner is
online, run `gh api repos/theodor349/<repo>/actions/runners`.

GitHub started `schedule` runs five to six hours late in late 2026, and the app
health check at 02:00 UTC reads that night's E2E result. So the nightly starts
from the `nightly-e2e.timer` systemd user unit on ulm instead. At 00:00 UTC it
runs `gh workflow run E2E --repo theodor349/<repo> --ref main -f suite=nightly`
for each repository in its list. fleet-management's `SETUP.md` describes the
unit. When you give a new app a runner, also add the app to that timer's
repository list, or its nightly never runs.
