# AI SaaS Template

Next.js, Convex, Clerk, Polar, and Shadcn UI, using pnpm.

This template supports agents developing and testing features in parallel using Git worktrees through [T3 Code](https://github.com/pingdotgg/t3code).

## Development

1. In the main checkout, copy `.env.bootstrap.example` to `.env.bootstrap.local`
   and add Clerk development keys, a Polar sandbox organization access token,
   and the monthly, yearly, and lifetime sandbox product IDs. Linked worktrees
   inherit these settings; bootstrap syncs their prices before reporting `Ready:`.
2. Configure the Clerk application's `convex` JWT template following the
   [Convex Clerk setup](https://docs.convex.dev/auth/clerk).
3. In your worktree, run `pnpm bootstrap` in a persistent terminal. It installs
   missing dependencies and starts Next.js, local Convex, and Polar forwarding.
4. Wait for `Ready:` and open the printed app URL. Ctrl+C stops the stack.

Use `pnpm bootstrap --no-polar` when billing is outside the task; no Polar token
is needed. Agent guidance lives in [AGENTS.md](AGENTS.md).

## Commands

- `pnpm bootstrap` - run an isolated local environment for this worktree.
- `pnpm bootstrap --print` - print path-derived ports and URLs without starting services.
- `pnpm bootstrap --no-polar` - run Next.js and local Convex without billing.
- `pnpm bootstrap:tailscale` - run the worktree environment behind a private Tailscale HTTPS URL.
- `pnpm test:bootstrap` - test worktree configuration and startup safeguards.
- `pnpm test:unit` (or `pnpm test`) - run bootstrap checks and application tests.
- `pnpm test:app` - run application unit tests without starting dev-server fixtures.
- `pnpm test:integration` - check the running worktree's local backend and frontend.
- `pnpm test:e2e` - test sign-in and sign-out with Clerk and Convex in Chromium.
- `pnpm inspect` - open the running worktree for manual browser inspection.
- `pnpm polar:trigger` - send a labeled Polar sandbox sample event to organization listeners.
- `pnpm dev` - start Convex and Next.js using the regular deployment setup.
- `pnpm typecheck` - check TypeScript.
- `pnpm lint` - check TypeScript and run ESLint.
- `pnpm build` - build for production.
- `pnpm build:vercel` - run checks, build Next.js, and deploy Convex from Vercel.
- `pnpm start` - serve the production build.
- `pnpm dlx shadcn@latest add <component>` - install a Shadcn component.

## CI and hosted development

GitHub Actions runs unit tests and lint on every pull request and on pushes to
`main`. Only `main` deploys to Vercel and Convex. See
[deployment setup](docs/deployment.md) for the hosted environment, its checks,
and Clerk/Polar webhooks.
