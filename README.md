# AI SaaS Template

Next.js, Convex, Clerk, and Shadcn UI, using pnpm.

The goal of this template is to enable agents to develop and test new features in isolation and parallel. We therefore work using git worktrees through [T3 Code](https://github.com/pingdotgg/t3code). 

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
- `pnpm test:unit` (or `pnpm test`) - run bootstrap checks and fast Convex behavior tests.
- `pnpm test:integration` - exercise the running worktree's real local backend and frontend.
- `pnpm test:e2e` - test Clerk authentication, Convex identity, reactive UI writes, and persistence in Chromium.
- `pnpm inspect` - open the running worktree for manual browser inspection.
- `pnpm polar:trigger` - send a labeled Polar sandbox sample event to organization listeners.
- `pnpm dev` - start Convex and Next.js.
- `pnpm typecheck` - check TypeScript.
- `pnpm lint` - check TypeScript and run ESLint.
- `pnpm build` - build for production.
- `pnpm start` - serve the production build.
- `pnpm dlx shadcn@latest add <component>` - install a Shadcn component.
