# AI SaaS Template

Next.js, Convex, Clerk, and Shadcn UI, using pnpm.

## Development

1. Run `pnpm install`.
2. Copy `.env.example` to `.env.local` and fill in your Clerk API keys.
3. Follow the [Convex Clerk setup](https://docs.convex.dev/auth/clerk) and set
   `CLERK_JWT_ISSUER_DOMAIN` on your Convex deployment.
4. Run `pnpm dev`. Convex will configure your deployment and write
   `NEXT_PUBLIC_CONVEX_URL` before starting Next.js.

## Commands

- `pnpm bootstrap` - run an isolated local environment for this worktree.
- `pnpm bootstrap --print` - print path-derived ports and URLs without starting services.
- `pnpm bootstrap --no-polar` - run Next.js and local Convex without billing.
- `pnpm test:bootstrap` - test worktree configuration and startup safeguards.
- `pnpm dev` - start Convex and Next.js.
- `pnpm typecheck` - check TypeScript.
- `pnpm lint` - check TypeScript and run ESLint.
- `pnpm build` - build for production.
- `pnpm start` - serve the production build.
- `pnpm dlx shadcn@latest add <component>` - install a Shadcn component.

## Agent worktrees

Use Node.js 22 or newer. In the main checkout, copy `.env.bootstrap.example` to
`.env.bootstrap.local` and add Clerk **development** keys and a Polar **sandbox**
organization access token. Then run `pnpm bootstrap` in any T3 Code worktree.
The script installs missing dependencies with `pnpm install --frozen-lockfile`.
Polar's CLI is included in the project's development dependencies.

Credentials are loaded from the main checkout's `.env.bootstrap.local`, with
overrides from the current worktree's `.env.local`, `.env.bootstrap.local`, and
provider variables in the process environment, in that order. Existing Clerk
development keys in the main checkout's `.env.local` also work as a fallback.
The Clerk JWT issuer is derived from the publishable key and set on local Convex;
configure Clerk's `convex` JWT template as in the regular development setup.

The canonical absolute worktree path determines a stable `WORKTREE_ID`, three
ports, app and Convex URLs, and Polar success/webhook URLs. Different paths can
hash to the same finite port block; an occupied port causes a clear startup error
instead of changing URLs. Moving a checkout changes its ID and ports.

Bootstrap writes private, ignored `.env.local`, `.env.convex.local`, and
`.env.convex-watch.local` files. It preserves the original `.env.local` once as
`.env.before-bootstrap.local`. Convex data stays in that checkout's `.convex`
directory, and Next.js output stays in `.next`. Ctrl+C or a service failure stops
the managed processes; local data remains available on the next run. Cloud Convex
deploy keys are removed from child environments, and Polar commands always use
the sandbox environment.

Polar events are forwarded to the worktree's Convex HTTP server at
`/webhooks/polar`; the billing feature must implement that endpoint with signature
verification using `POLAR_WEBHOOK_SECRET`. Until then, deliveries return 404.
Use `WORKTREE_ID` when creating test users, customers, and products to distinguish
them. Bootstrap does not create billing plans or test accounts.

Clerk settings and Polar organization data are shared when using shared
credentials. Polar forwards organization events, so separate worktree namespaces
alone do not isolate webhook deliveries. For strict isolation, supply a separate
Clerk development application and Polar sandbox organization in each worktree's
`.env.bootstrap.local`; otherwise handlers must ignore events belonging to other
worktrees. Those hosted credentials cannot be derived from a filesystem path.
Vercel access is only needed for hosted previews or deployment.

## Shadcn

Preset `b38VmX78S` is applied in `components.json` and `app/globals.css`.
`@shadcn/lint` is registered in `eslint.config.mjs`; no Shadcn rules are
currently enabled. Configure rules there using the
[available rules](https://github.com/shadcn-ui/lint#rules).

Agent instructions live in `AGENTS.md`. `CLAUDE.md` references that file.
