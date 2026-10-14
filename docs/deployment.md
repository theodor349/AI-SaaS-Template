# Hosted development deployment

A Vercel project deploys `main` to a Convex project's production deployment.
This is a shared development environment with disposable test data, Clerk
development keys, and Polar sandbox payments.

This repository's instance: Vercel project `ai-saas-template`
(`https://ai-saas-template-hazel.vercel.app`), Convex deployment
`kindhearted-bandicoot-875` (reference `cloud-dev`) in the `jes` team's
`ai-saas-template` project. Downstream projects replace these values.

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
| `CONVEX_DEPLOY_KEY` | Production deployment key generated in Convex; grant `deployment:deploy`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Existing Clerk development publishable key (`pk_test_...`). |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key (`sk_test_...`). |
| `NEXT_PUBLIC_APP_URL` | The Vercel project's stable application URL. |
| `NEXT_PUBLIC_AUTHENTICATED_DESTINATION` | `/app`, or the intended authenticated landing route. |

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

On the Convex project's **production deployment**, set:

| Variable | Value |
| --- | --- |
| `WORKTREE_ID` | `cloud-dev`; keep this stable and distinct from local worktrees. |
| `APP_URL` | The same stable Vercel application URL. |
| `CLERK_JWT_ISSUER_DOMAIN` | Existing Clerk development Frontend API URL. |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Signing secret of the dedicated hosted Clerk webhook below. |
| `POLAR_ENVIRONMENT` | `sandbox`. |
| `POLAR_ACCESS_TOKEN` | A token for the existing Polar sandbox organization. |
| `POLAR_ORGANIZATION_ID` | That sandbox organization's ID. |
| `POLAR_PRODUCT_MONTHLY` | Monthly fixed-price sandbox product ID. |
| `POLAR_PRODUCT_YEARLY` | Yearly fixed-price sandbox product ID. |
| `POLAR_PRODUCT_LIFETIME` | One-time fixed-price sandbox product ID. |
| `POLAR_WEBHOOK_SECRET` | Signing secret of the dedicated hosted Polar webhook below. |

The three products must be distinct, unarchived, and have positive fixed prices;
the recurring products must use a single-month and single-year interval. Reuse
the local sandbox products. If local credentials omit their IDs, select or create
the three products in the sandbox dashboard.

Enable Clerk's Convex integration or its `convex` JWT template (`aud=convex`).
Both frontends share Clerk accounts, so account edits/deletions affect both.
Billing customers and subscriptions are separated by the deployment namespace;
buying a sandbox subscription locally does not grant hosted access.

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

## Checks and launch

GitHub Actions runs `Unit tests`, `Lint and typecheck`, and `Next.js build` on
every pull request, regardless of source or target branch, and on pushes to
`main`. There are no preview deployments, so `Next.js build` is what catches a
broken production build before Vercel does. It runs `next build` with fake,
well-formed placeholders for the browser variables read while building and
prerendering; the checks need no hosted credentials. They run independently so
each reports its failures, and new pushes cancel outdated runs. Integration and
browser tests need bootstrap services and run in the E2E workflow below.

The separate [E2E workflow](../.github/workflows/e2e.yml) runs `pnpm test:integration`
and `pnpm test:e2e` against a local bootstrap stack. It runs on pushes to `main`,
manual dispatch, and pull requests labeled `run-e2e`; the label keeps it from
spending the Clerk and Polar rate limits that local agents share. It needs these
GitHub Actions repository secrets, using the same values as a local
`.env.bootstrap.local`:

| Secret | Value |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk development publishable key (`pk_test_...`). |
| `CLERK_SECRET_KEY` | Matching Clerk development secret key (`sk_test_...`). |
| `POLAR_ACCESS_TOKEN` | Sandbox organization access token. |
| `POLAR_ORGANIZATION_ID` | Optional; needed when the token can access several organizations. |
| `POLAR_PRODUCT_MONTHLY`, `POLAR_PRODUCT_YEARLY`, `POLAR_PRODUCT_LIFETIME` | The sandbox product IDs. |

Polar is required because the suites check the synced catalog, signed Polar
webhooks, and sandbox customers. Without the secrets, as on fork pull requests,
the workflow reports a notice and skips. Do not make it a required check, since
unlabeled pull requests never run it.

Require the checks in a GitHub branch ruleset for `main` if merges should be
blocked on failures. Vercel independently runs `pnpm test:app` and `pnpm lint`
before deployment. The dev-server fixtures in `test:bootstrap` run in GitHub
Actions and locally: Vercel's build worker does not reliably support the
fixture's loopback rewrite. Application test or lint failures still stop the
Vercel build before Convex deployment.

After the first deployment, verify hosted sign-in, a sandbox checkout returning
to the stable app URL, paid access, and delivery of both providers' webhooks.
Initialize the public product catalog after deploying to a fresh database:

```sh
pnpm exec convex run --deployment <team>:<project>:cloud-dev polar:syncCatalog '{}'
```

The catalog is subsequently refreshed by the existing six-hour cron job.
Use test accounts and test cards. Before accepting real users/payments, configure
Clerk production and Polar production credentials, products, and webhook secrets;
plan the new Clerk user identities and billing associations rather than assuming
development data transfers. Clerk development accounts remain test accounts.

Provider references: [Convex on Vercel](https://docs.convex.dev/production/hosting/vercel),
[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[Clerk environments](https://clerk.com/docs/guides/development/managing-environments),
[Polar sandbox](https://polar.sh/docs/integrate/sandbox).
