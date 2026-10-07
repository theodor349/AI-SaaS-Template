# Project instructions

- Use pnpm for all package management and scripts.
- Always use Shadcn components when available. Install missing components with
  `pnpm dlx shadcn@latest add <component>` before building a custom alternative.
- Follow the existing Shadcn preset, theme tokens, and component patterns.
- After making changes, run `pnpm lint` and fix all errors.
- For worktree features, follow the testing workflow in `README.md`. Run
  `pnpm test:unit`; keep `pnpm bootstrap` running for `pnpm test:integration`,
  `pnpm test:e2e`, and `pnpm inspect`. Live tests target only this worktree's
  generated local Convex configuration. Do not use `pnpm dev` for isolation.
- Use disposable Clerk development test users and Polar sandbox resources
  labeled with `WORKTREE_ID`. Hosted credentials share resources; separate
  browser contexts are required for separate users on loopback URLs.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
