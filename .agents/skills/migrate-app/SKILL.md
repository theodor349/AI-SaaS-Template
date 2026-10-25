---
name: migrate-app
description: Plan and run the migration of an existing app, with its code, production data, users and paying customers, onto this template. Use whenever moving an app onto the template is discussed, planned, reviewed, rehearsed or cut over, including questions about carrying over an old app's Convex data, Clerk users, Polar customers or Vercel project.
---

# Migrate an app onto the template

Rekura was the first app moved onto this template, in October 2026. Its plan, runbook and tooling are in the Rekura repository (`theodor349/housekeeper`) at commit `590ba85^`:

- `docs/migration/ai-template-migration-plan.md`: the steps, the table mapping and the parity checklist
- `scripts/legacy-migration/RUNBOOK.md`: every cutover command, with key-guarded Convex helpers and the Clerk and Polar webhook helpers
- `scripts/legacy-migration/` and `convex/legacyMigration/`: export, transform, relink, `check` and `clerkResync`

Read them with `git show 590ba85^:<path>` in a Rekura checkout. Reuse the code where it fits, but follow this skill where they differ. Provider behavior that cost time is in [references/traps.md](references/traps.md). Read it before planning.

## Start with a brief from the maintainer

Each of these facts reached Rekura's agents late and caused rework or an incident. Ask for all of them before writing the plan:

1. **Who uses production.** How many active users, and are they strangers or people the maintainer knows? This sets how much downtime is acceptable and how much ceremony fits. Approving production writes one at a time made sense for no one when production held six family accounts.
2. **Who pays, and how.** Every product, price and plan in use, and whether anyone paid with a discount code, a 100% code, or got Pro by hand. Rekura's four paying customers had all used 100% codes, and the cutover found it.
3. **What the old app promised.** Pricing page claims such as "unlimited lists" rule out limits the template's patterns might suggest.
4. **Which features are app features.** The template owns accounts, billing, checkout, legal documents, data export and deletion. Port only the app's own features. Ask which old features to drop.
5. **The paid model.** Free tier or not, and whether shared data needs each member to pay.
6. **Users who can't be matched.** For example, rows without a Clerk account that haven't signed in for months: keep, recreate or drop.
7. **The rehearsal strategy.** Rehearse on the cloud dev deployment with a copy of production before production. Rekura's plan was rewritten twice because this came after the first draft.

Check provider settings before recommending a path that depends on them. Rekura's plan review recommended creating Clerk accounts by email, and production Clerk turned out to allow Google sign-in only.

## Shape of the work

- **Plan, then review it.** Commit the plan to a migration branch, with steps an orchestrator can hand to subagents and a parity checklist taken from the old app's features. Then have a separate agent try to break the plan before any code exists. For Rekura that review found six ways to lose data, including a rollback that couldn't work. Commit its fixes to the same branch.
- **Freeze `main`** until cutover. The migration branch replaces its tree, so a later commit on `main` is lost or brings old files back.
- **Replace the code with a merge that keeps both histories,** so later template syncs merge cleanly:

  ```bash
  git fetch template
  git switch <migration-branch>
  git merge -s ours --allow-unrelated-histories --no-commit template/main
  git read-tree -u --reset template/main
  git checkout HEAD -- <plan file>
  git commit -m "chore: replace <app> codebase with AI-SaaS-Template"
  ```

  Merge this commit without squashing, or the template parent is lost.
- **Build in parallel worktrees,** one PR per step into the migration branch. New features follow [$add-feature](../add-feature/SKILL.md). Every worktree seeds its local backend with transformed, real-shaped data, so the UI and tests run on what production will hold.
- **Remove each step's worktree when its PR merges.** The worktree's local backend in `.convex/` holds data from the real export. The orchestrator stops the step's stack with `pnpm bootstrap:stop` in that worktree, then runs `git worktree remove <path>`, which deletes the ignored `.convex/` with it. `$complete-worktree` leaves worktrees and databases in place. WeeklyReview's build left 21 worktrees behind, 14 GB with 16 local backends.
- **Review data, deletion and billing PRs independently** before merging them. Rekura's reviews caught a stale export that would have wiped recent changes, paying users who would lose their billing link, and erased users' order history coming back.
- **Keep one source of truth.** The plan and runbook in the repository hold the procedure. A handoff file for a fresh orchestrator holds only state, decisions and approvals. Rekura's three documents drifted into seven contradictions.
- **Hand off at phase boundaries.** A fresh orchestrator for build, rehearsal and production kept context small. Each handoff names the files to read first and the open questions.
- **Agree on approvals early.** Group approvals with a stop on any unexpected output, plus a write log with the undo for each write, worked for both the rehearsal and the production window.

## Step 0, before any code

- **Test the data path on a throwaway cloud deployment:** export, transform, the bridge deploy, import, the reverse bridge, and deploys and imports while paused. [Traps](references/traps.md#convex) has what to expect.
- **Audit both environments read-only.** Count users without a Clerk account, Clerk accounts without a user, shared Clerk ids and lowercased emails, broken references, assignments to non-members, pending deletion and export requests, and Polar customers by state. Decide a repair rule for every nonzero count now, so none first shows up in the window.
- **Replay billing.** For every production Polar customer, compute the template's entitlement from their real orders and subscriptions, read-only, and compare it with the old app's Pro state. Every difference needs an explanation before cutover. Confirm the configured products pass `validateProduct` in `convex/billing/polar.ts`, because entitlement only counts configured products.
- **Make sure cloud dev covers every case production has:** an active subscriber, a lifetime buyer, a former subscriber, a discount-code buyer, an unmatched user and a shared record. Create missing cases in the old dev app.
- **Collect credentials in one checklist.** For each one, give the exact name, the file it goes in, the environment, the URL to create it at, and the scopes. Derive the scopes from the API calls in the code and scripts that will use it, not from memory. Then verify each credential by running the read and dry-run calls of every script that uses it. Polar sandbox and production organizations can share a name, so check the organization id too.
- **Let CI run the integration and E2E suites.** Add the Actions secrets that `.github/workflows/e2e.yml` checks to the app's repository, from the same sandbox and dev credentials the worktrees use. Without them the suites skip and CI still reports green. The suites are expensive and share provider rate limits with local agents, so don't run them on every step PR. Add the `run-e2e` label only to a step PR that changes a flow the suites cover, such as sign-in, billing, checkout, account deletion or data export. Also run them at checkpoints: after the last build step merges, before the rehearsal, and before the window, with `gh workflow run e2e.yml --ref <migration-branch>`. WeeklyReview's 11 step PRs merged without either suite, and a spec that step 4 broke went unseen for almost 5 hours.

Keep exports, mapping files and transformed ZIPs in `$(git rev-parse --git-common-dir)/<migration>/`, which every worktree can read and git never tracks. Deploy keys go in a credentials file there, never in `.env.bootstrap.local`, because bootstrap copies that file's keys into every worktree.

## Rehearse on cloud dev

Run the whole production sequence against the cloud dev deployment, writing every command into a runbook as you go. Then roll back with the reverse bridge, and run it again until one run is clean from start to finish. Rekura's rehearsal caught four problems that would have hit production:

- the deploy trap with `CONVEX_DEPLOYMENT` set
- a deploy key missing an action the rollback needed
- missed cron jobs deleting users on unpause
- a rollback check that always reported "Different"

Before rehearsing, stop worktree tests from reaching cloud dev. Either give cloud dev its own Clerk dev instance, or disable its old webhooks at step 0. Rekura's first rehearsal aborted on 131 test users that other worktrees' tests had created through the shared Clerk dev instance.

## Production

1. **Prepare without downtime.** Set the new env names the old app doesn't read, create a scoped deploy key, and run a production dry run: a fresh export, the transform, then an import into a throwaway local backend and `check`. Also run every cutover script's dry run against production with the real credentials. Freeze the commit the window deploys.
2. **Drain the old app** right before the window. Pending deletions and other scheduled work run at once on unpause.
3. **The window:**
   1. Pause, then disable the old webhook endpoints.
   2. Export. The export is both the backup and the transform's input.
   3. Transform, and check that the ZIP's hash matches the dry run's.
   4. Bridge deploy, import, validated deploy.
   5. Merge into `main` and wait for the Vercel build.
   6. Unpause. Then run the aggregate backfills, `check`, `syncCatalog` and the billing relink.
   7. Create the new webhook endpoints, then run the Clerk resync.
   8. Verify, and the maintainer signs in and decides go or no-go.
4. **Rollback.** Restore the backend and data first with the reverse bridge, then `vercel promote` the previous production build. Unpause last.
5. **After go:**
   - Delete the old endpoints, the old env names and the migration keys.
   - Delete the exports, the backup, the plan and the migration tooling.
   - Revoke the migration tokens.
   - Open template PRs for anything generic the migration taught.
