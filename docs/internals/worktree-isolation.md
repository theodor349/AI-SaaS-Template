# Worktree isolation

Each worktree gets its own ports, Convex database, and generated environment files, but the hosted providers are shared. Isolation in those providers comes from the worktree's `WORKTREE_ID`, which [bootstrap](../../scripts/bootstrap.mjs) derives from the checkout path. Two checkouts at the same path get the same ID, which is why the [E2E workflow](../../.github/workflows/e2e.yml) checks out into a per-run directory.

**Polar events reach every listener.** All worktrees, CI runs, and the hosted deployment use one Polar sandbox organization, and each `polar listen` receives that organization's events. A delivery reaching a handler says nothing about whose customer it is. Handlers must treat a resource as their own only when its external ID or metadata carries this `WORKTREE_ID` ([webhook association](../../convex/billing/polarWebhook.ts), [reconciliation](../../convex/billing/polar.ts)). Any new Polar resource the app creates needs the same tag. Polar's CLI also shares one delivery log across listeners, so `pnpm polar:trigger` can report another worktree's destination; check delivery at the handler.

**Browser cookies are shared across worktrees.** Local URLs all use `127.0.0.1`, and Tailscale URLs share the machine's hostname, differing only by port. Cookies are not port-scoped, so one browser profile signed into two worktrees mixes their Clerk sessions. Use a separate browser context or profile per worktree and per test user.

**Clerk is one development instance.** Users, organizations, and rate limits are shared by every worktree, CI, and the hosted development deployment. Test users carry `WORKTREE_ID` in their public metadata so cleanup removes only this worktree's users. Rate-limit errors usually come from other concurrent work, which is why CI runs E2E only on demand.

**Bootstrap's state file is the ownership record.** Stopping services goes through the supervisor that bootstrap recorded for this worktree, not through matching process names, paths, or ports. A busy port does not prove the process belongs to this worktree.
