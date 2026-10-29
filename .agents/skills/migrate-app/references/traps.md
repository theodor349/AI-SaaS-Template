# Migration traps

What the providers did during Rekura's migration that their documentation doesn't make obvious. Each item cost time or nearly broke production.

## Convex

- **The data moves as an offline transform.** `npx convex export` writes a ZIP with one JSONL file per table. A script rewrites it into the template's shape, and `npx convex import --replace-all` loads it. The import keeps every `_id` and `_creationTime`, and `--replace-all` empties every table the ZIP doesn't contain. The same ZIP imports into a worktree's local backend, cloud dev and production, so what you test locally is what runs.
- **Write floats with a decimal point.** In a ZIP with `generated_schema.jsonl`, a JSON integer such as `0` imports as Int64 and fails a `v.float64()` field. Write `0.0`.
- **An import runs no mutations.** Aggregates and other derived state stay empty until an idempotent backfill runs. Run it after every import, in every environment.
- **Old data can't meet the new schema directly.** Convex validates existing documents on deploy and imported ones against the deployed schema. Use the bridge: deploy the new code with `defineSchema(..., { schemaValidation: false })`, import, then deploy the same code with validation on. That last deploy only succeeds if every document matches. The rollback runs the bridge in reverse: a branch of old `main` with validation off, the backup import, then old `main`.
- **Rolling back leaves the new components' tables behind.** They're empty, but they appear in a fresh export under `_components/`. A check that compares that export with the backup must accept extra `_components/` files without data rows.
- **Pausing stops functions, not deploys.** While paused, queries, mutations and actions fail and HTTP actions return 500, so webhooks fail too. Export, deploy and import still work, and none of them unpauses. Pause and unpause with `POST <deployment URL>/api/v1/pause_deployment` and `/unpause_deployment`, sending `Authorization: Convex <deploy key>`.
- **The template's maintenance mode doesn't cover the cutover.** An old app built on something else lacks it, so the cutover pauses the deployment instead. Once an app runs on the template, later data migrations can use [pausing the app](../../../../docs/deployment.md#pausing-the-app), which keeps webhooks and crons running.
- **Unpausing runs every cron that came due during the pause, at once.** On Rekura the old app's deletion cron would have deleted users the moment production unpaused. Drain pending work before the pause.
- **`npx convex deploy` with `CONVEX_DEPLOYMENT` set deploys to the project's production deployment.** `deploy` has no `--deployment` flag. Deploy only through a wrapper that unsets `CONVEX_DEPLOYMENT` and `CONVEX_URL`, sets `CONVEX_DEPLOY_KEY`, and refuses a key whose prefix isn't the intended deployment (`dev:<name>|` or `prod:<name>|`).
- **Deployment URLs include the region,** such as `https://<name>.eu-west-1.convex.cloud`. Without it the URL answers 404.
- **Create scoped deploy keys through the Management API.** Call `POST https://api.convex.dev/v1/deployments/<name>/create_deploy_key` with the CLI login's access token from `~/.convex/config.json`. Set `allowedActions` and `expiresAt`. A migration needed these actions:
  - `deployment:deploy`
  - `deployment:env:view` and `deployment:env:write`
  - `deployment:pause` and `deployment:unpause`
  - `deployment:backups:create`, `:view`, `:download` and `:import`
  - `deployment:functions:runInternalQueries`, `:runInternalMutations`, `:runInternalActions` and `:runTestQuery`
  - `deployment:data:view`

  An older CLI, such as the one an old app pins, reads table sizes before a deploy that drops indexes and needs `deployment:data:view`. Test the key with the rollback tree's own CLI (`convex data`) before the window. A key's actions can't change later, so a missing action means a new key.
- **The CLI can't delete projects.** Use the Management API.
- **Separate local resources from cloud ones.** The template's E2E tests, `pnpm capture` and `pnpm inspect` refuse any backend except the worktree's own. To run E2E on migrated data, import the transformed ZIP into a disposable worktree's local backend.

## Clerk

- **Every worktree shares the Clerk dev instance.** A cloud dev deployment with a webhook on that instance receives every test user the worktrees create and delete. Disable that webhook early or give cloud dev its own instance.
- **Clerk has no API for single webhook endpoints.** `POST https://api.clerk.com/v1/webhooks/svix_url` returns a Svix app portal link. Its `#key=` fragment is base64 JSON with `appId`, a `oneTimeToken` and the region. Exchange that token at `https://app.svix.com/api/<region>/api/v1/auth/one-time-token/exchange`, then call `/finalize`. The exchange returns a token for Svix's endpoint API (`/api/v1/app/<appId>/endpoint`), which can list, disable, create and delete endpoints. The exchange comes from Svix's portal page, not its documentation, so prove it with a `list` first. Never call `DELETE /v1/webhooks/svix`, which deletes every endpoint.
- **Sign-in doesn't refresh an existing user's profile.** Changes Clerk made while the webhooks were off need a resync that pages through every Clerk user and syncs each existing one. The template's `syncProfile` ignores a profile older than `profileUpdatedAt`, so the transform sets `profileUpdatedAt` and `profileEventAt` to `0.0`.
- **The resync must never create users.** An old app may have deleted a user's row but kept their Clerk account, so a Clerk account without a user can belong to someone who asked to be deleted. Report those ids for the maintainer.
- **`tokenIdentifier` is `<issuer>|<clerkId>`,** with the issuer of the target environment and no trailing slash. Pin each environment's issuer in the transform, and refuse inputs from the wrong one.
- **Creating a user by email needs the email attribute.** An instance that allows only OAuth sign-in rejects email-only users. Check the production instance's settings, not just dev's.

## Polar

- **A customer's `external_id` can't change once set.** Only deleting the customer clears it, and that cancels their subscriptions. Old customers keep the old app's ids, so the template needs a legacy exception that compares a linked account with its stored `externalId`. Rekura's is `ownedExternalId` in its `convex/billing/lib.ts`, documented in its `docs/internals/paid-access.md`.
- **Relink every customer, not only current payers.** Polar requires unique emails within an organization. A former subscriber whose old customer isn't linked can't check out at all: the template finds no customer for its own id, and creating one fails on the email.
- **Updating `metadata` replaces the whole object.** Read it first and send it back merged.
- **Entitlement only counts the configured products.** Keep the old product ids, and check them with `validateProduct` before cutover.
- **Discount codes change what "paid" means.** A 100% code produces orders that are paid with `net_amount` 0. The template counts those since its PR #95, but replay billing anyway. Any rule the old app applied that the template doesn't shows up only in the replay.
- **Sandbox and production organizations can share a name.** Tokens created on the wrong dashboard get 401 from the other API. Check the organization id.
- **Organization tokens can't create other tokens,** so the maintainer creates them. A relink that checks which organizations its token can reach needs `organizations:read`. Managing webhook endpoints needs `webhooks:read` and `webhooks:write`.
- **Editing an endpoint's URL keeps its old event list.** Create new endpoints with the events the template handles: customer, checkout, subscription, order and refund events.

## Vercel

- **An old `vercel.json` can deploy from any branch.** If its build runs `npx convex deploy`, a push to any branch that still carries it deploys that branch's backend to wherever the Preview deploy key points, which for Rekura was cloud dev. The template's `vercel.json` builds only `main`. Don't push old branches during the migration.
- **Each deployment snapshots its env.** Env changes reach the live site only with the next build, so they can be prepared before the window.
- **Vercel runs functions in `iad1`, Washington DC, unless `vercel.json` sets `regions`.** Folkbook, WeeklyReview and Rekura left it there with Convex in `aws-eu-west-1`, which added 80 to 100 ms to every server-rendered request. When preparing production, set `"regions"` to the Vercel region nearest the Convex deployment, such as `["dub1"]` for `aws-eu-west-1`, then check the `x-vercel-id` header of a server-rendered page, which names the function region second, as in `arn1::dub1::…`.
- **Roll back the frontend with `vercel promote <deployment>`.** It builds nothing and runs no `convex deploy`. Afterwards Vercel stops assigning the production domain to new builds until one is promoted again. A revert on `main` would rebuild the old `vercel.json`, so it comes only after the old data is restored.
- **Old Clerk redirect env names override the template's destination.** Remove `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `_SIGN_UP_URL`, `_SIGN_UP_FORCE_REDIRECT_URL` and `_SIGN_IN_FALLBACK_REDIRECT_URL`.
- **`APP_URL` and `NEXT_PUBLIC_APP_URL` must match the origin users land on.** Otherwise checkout returns are refused. Settle apex or `www` before the window.
- **The merge build runs inside the window.** `pnpm build:vercel` runs the unit tests and lint before `convex deploy` and `next build`. It took about three minutes for Rekura.

## Running the old app locally

- **Build old trees outside every checkout,** including `.git`. Inside one, Turbopack took the enclosing checkout as its workspace root and grew to 9 GB until the machine stalled.
- **Start old Clerk middleware on `--hostname localhost`.** Its absolute rewrite to `localhost` made a server started on `127.0.0.1` proxy to itself, and every page returned 500.
- **Don't print a dev server log raw.** A Polar checkout return writes `customer_session_token` into the request line. Redact query values.
