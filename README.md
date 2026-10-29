# AI SaaS Template

Next.js, Convex, Clerk, Polar, and Shadcn UI, using pnpm.

This template supports agents developing and testing features in parallel using Git worktrees through [T3 Code](https://github.com/pingdotgg/t3code).

## Development

1. Set the product name, company, support email, and search and link preview details in
   [`app.config.ts`](app.config.ts), and replace the brand icon in [`app/icon.svg`](app/icon.svg).
   The favicons, link previews, and installed app icons are drawn from these two files.
2. In the main checkout, copy `.env.bootstrap.example` to `.env.bootstrap.local`
   and add Clerk development keys, a Polar sandbox organization access token,
   and the monthly, yearly, and lifetime sandbox product IDs. Linked worktrees
   inherit these settings; bootstrap syncs their prices before reporting `Ready:`.
   An app that launches free sets `billing: false` in `app.config.ts` and skips
   every Polar step (see [running without billing](docs/deployment.md#running-without-billing)).
3. Configure the Clerk application's `convex` JWT template following the
   [Convex Clerk setup](https://docs.convex.dev/auth/clerk). Under **User & authentication**,
   sign users in with an email verification code and Google, and turn off passwords.
   Give the Polar products tax-inclusive prices (see [deployment](docs/deployment.md#convex)).
4. In your worktree, run `pnpm setup:check` to check prerequisites, then `pnpm bootstrap`
   in a persistent terminal. It syncs dependencies and starts Next.js, local
   Convex, and Polar forwarding, using private Tailscale HTTPS URLs when
   Tailscale is connected.
5. Wait for `Ready:` (or run `pnpm bootstrap:wait`) and open the printed app URL.
   Ctrl+C or `pnpm bootstrap:stop` stops the stack.

Use `pnpm bootstrap --no-polar` when billing is outside the task; no Polar token
is needed. Agent guidance lives in [AGENTS.md](AGENTS.md).

## Commands

- `pnpm setup:check` - check prerequisites, credentials, Clerk/Polar setup, Tailscale, and gh.
- `pnpm bootstrap` - run an isolated local environment for this worktree (`--local`, `--tailscale`, `--no-polar`).
- `pnpm bootstrap --detach` - start it in the background, detached from the terminal; output goes to the log. It runs until `pnpm bootstrap:stop` or until the worktree is removed.
- `pnpm bootstrap --print` - print the effective ports, URLs, and network mode without starting services.
- `pnpm bootstrap:status` / `bootstrap:wait` / `bootstrap:stop` - inspect, wait for, or stop this worktree's bootstrap.
- `pnpm bootstrap:tailscale` - same as `pnpm bootstrap --tailscale`.
- `pnpm db:reset --yes` - clear this worktree's local Convex data while bootstrap is stopped.
- `pnpm test:bootstrap` - test worktree configuration, startup safeguards, and agent tooling.
- `pnpm test:unit` (or `pnpm test`) - run bootstrap checks and application tests.
- `pnpm test:app` - run application unit tests without starting dev-server fixtures.
- `pnpm test:integration` - check the running worktree's local backend and frontend.
- `pnpm test:e2e [spec...]` - run the browser suite, or the given specs, against the running worktree in Chromium.
- `pnpm test:e2e:critical` - run only the browser tests tagged `@critical`.
  `E2E_EVIDENCE=1 pnpm test:e2e <spec>` also saves screenshots and videos for PR evidence in `.playwright/results`.
- `pnpm inspect` - open the running worktree for manual browser inspection.
- `pnpm capture <path...>` - screenshot (and optionally record) pages for PR evidence, outside the worktree.
- `pnpm review-link` - print a single-use signed-in link for maintainer review.
- `pnpm clerk:sweep` - delete this worktree's leftover labeled Clerk test users (`--dry-run`, `--all-worktrees`).
- `pnpm pr:gate [PR]` - summarize a PR's merge gates: heads, main ancestry, mergeability, checks, open threads.
- `pnpm polar:trigger` - send a labeled Polar sandbox sample event to organization listeners.
- `pnpm dev` - start Convex and Next.js using the regular deployment setup.
- `pnpm typecheck` - check TypeScript.
- `pnpm lint` - check TypeScript and run ESLint.
- `pnpm build` - build for production.
- `pnpm build:vercel` - run checks, build Next.js, and deploy Convex from Vercel.
- `pnpm start` - serve the production build.
- `pnpm dlx shadcn@latest add <component>` - install a Shadcn component.

## CI and hosted development

Depot CI runs lint, unit tests, and the Next.js build on every pull request.
The E2E workflow runs the integration suite and the `@critical` E2E tests
against a local stack nightly on `main`, and the full E2E suite weekly on
`main`. Adding the `run-e2e` label to a pull request runs the full suite, and
later pushes to that pull request run the `@critical` tests. Only `main`
deploys to Vercel and Convex. See
[deployment setup](docs/deployment.md) for the hosted environment, its checks,
and Clerk/Polar webhooks.
