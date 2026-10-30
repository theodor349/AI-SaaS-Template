---
name: sync-template
description: Bring new AI-SaaS-Template commits into an app built on the template by merging the template's main on the current task branch, resolving conflicts, and completing one PR. Use whenever the maintainer asks to sync an app with the template, update it from the template, or pull template fixes, rules or skills into it.
---

# Sync an app with the template

Run this in an app built on the template, such as Rekura (`theodor349/housekeeper`), not in the template itself. It brings every template commit the app lacks into one PR. For example: `$sync-template` or "bring the template's fixes into Rekura".

A maintainer request to sync authorizes the [complete-worktree](../complete-worktree/SKILL.md) workflow for the sync PR, with the merge method below. Reading or editing this skill does not.

## Why a merge

[migrate-app](../migrate-app/SKILL.md) creates the app with a merge whose second parent is the template commit it started from. `git merge-base` therefore finds the last template commit the app contains, and merging the template's `main` brings in exactly what came after it. Each sync merge moves that point forward.

Do not cherry-pick or port template commits into the app. The merge base stays where it was, and the next sync brings those commits again as conflicts.

Merge the sync PR with a merge commit, `gh pr merge --merge`. The `pr:gate` verdict line prints `--squash` when the repository allows it, so replace that flag with `--merge`. A squash or rebase merge drops the template parent, and the next sync replays every template commit since the app was created.

## 1. Find the sync point

- Work in the current T3-assigned worktree and task branch, as complete-worktree describes.
- `git remote get-url template` should print `https://github.com/theodor349/AI-SaaS-Template.git`. Add the remote if it is missing. A remote that points at a local checkout fetches that checkout's local `main`, which can be far behind GitHub. Rekura's was 14 PRs behind. Repoint it with `git remote set-url template https://github.com/theodor349/AI-SaaS-Template.git`. Every worktree of the app shares the remote.
- `git fetch --multiple origin template` and merge `origin/main` into the task branch if it is behind. Then `base=$(git merge-base HEAD template/main)`, and `git log --oneline --first-parent "$base..template/main"` lists the incoming template PRs. If the list is empty, report that the app is current and stop.
- The app's copy of this skill can be older than the template's. After the fetch, read `git show template/main:.agents/skills/sync-template/SKILL.md` and follow that version.
- No merge base means the app was created without the template parent. Find the template commit it started from in the replace commit's message or date, and confirm it with the maintainer. Record it without changing any file: `git merge -s ours --allow-unrelated-histories -m "chore: record template <sha> as synced" <sha>`.
- A fix that went from the app to the template, or was ported by hand, is in both histories as two different commits, and usually conflicts. List the incoming commits the app already has by subject:

  ```bash
  git log --no-merges --format=%s "$base..template/main" | sed 's/ (#[0-9]*)$//' |
    while IFS= read -r s; do git log -1 --no-merges --format="%h $s" -F --grep="$s" HEAD; done
  ```

  The template version is usually the later one, reworked in the template's review.

- Check the template's E2E result on `main`: `gh api "repos/theodor349/AI-SaaS-Template/commits/main/check-runs?check_name=E2E%20%2F%20Integration%20and%20E2E" --jq '.check_runs[].conclusion'`. The nightly run tests the newest commit with the `@critical` tests and the weekly run with the full suite, so a commit merged since then has no result yet; check its parent. A failure there comes into the app with the merge; fix it in the template as well.
- Skills this one links to, such as add-feature, may not exist in the app until the merge brings them. Read them from the template meanwhile: `git show template/main:.agents/skills/add-feature/SKILL.md`.

## 2. Merge and resolve

- `git merge --no-ff template/main -m "chore: sync with AI-SaaS-Template <short sha>"`. Resolve every conflict in this merge commit.
- Keep the app's side for what makes it this app: branding and `app.config.ts`, the app's domain code and pages, app copy, the landing page, the app's own sections of `AGENTS.md`, and deployment config and docs.
- Take the template's side for fixes in shared code (accounts, billing, data export and deletion, `components/ui`, `convex/lib`), rules in `AGENTS.md`, skills in `.agents/skills`, scripts, and test tooling. Where the app adapted shared code, keep the adaptation and apply the template's fix to it.
- When the app moved or deleted something the template changed, Git may suggest moving new template files into the app's renamed folder. Follow the app's structure, not Git's guess. Rekura replaced the template's `/app` page with `/lists`, and Git moved the template's new `/app` components, `welcome.tsx` and the Notes `note-*.tsx` files, into `lists/_components`. Files that belong only to a page the app deleted have no place in the app, so delete them in the merge commit.
- Do not resolve generated files by hand. Resolve `package.json`, then run `pnpm install` to rewrite `pnpm-lock.yaml`. Take either side of `convex/_generated`, then run `pnpm bootstrap --detach` and `pnpm bootstrap:wait`; bootstrap's `convex dev` regenerates it.
- Make follow-up changes the merge does not need, such as removing a template example, in separate commits after the merge, so a reviewer can tell resolution from new work. The exception is the deletions above, which the merge needs.

## 3. Decisions for the maintainer

List these in the PR description and hold the merge until the maintainer answers, as complete-worktree describes. Resolve everything else yourself.

- A template change to behavior users see where the app differs: the sign-up and onboarding flow, where signing in lands, pricing, or a new user-facing feature.
- A template example the app has no use for, such as the Notes reference feature: remove it with the steps in [add-feature](../add-feature/SKILL.md#remove-notes), or keep it.
- Legal documents and user emails. Combine both sides and quote each changed sentence. When the combined text differs from both sides, propose an `effective` date, such as the day the sync deploys, and ask.
- A template rule that contradicts an app rule in `AGENTS.md`, such as a free-tier pattern in an app without a free tier.
- Schema changes that need data work in production, such as a new required field or a table to clear.
- A template fix that conflicts with the app's version of the same fix, where the app's version has behavior the template's lacks.
- Data the app's version of a duplicated fix already wrote in production, which the template's version reads differently. Rekura's comp fix marked withdrawn orders `fullyRefunded`, while the template's also sets `withdrawn` and reconciliation keeps only those refunded.
- A template change that needs provider setup before it deploys, such as a new build step that writes Convex environment variables with the deploy key.

## 4. Verify and complete

- Run `pnpm test:unit`, `pnpm lint` and `pnpm build`. A sync touches shared backend and browser flows, so also run `pnpm test:integration` and `pnpm test:e2e:critical` against this worktree's bootstrap, plus the specs for areas the incoming template commits changed, using the area table in `AGENTS.md`. Leave the full suite to CI. Add whatever else the app's `AGENTS.md` asks for. Template UI changes that the app's users will see need before and after captures.
- PR E2E runs on Depot only with the `run-e2e` label, so add it to a sync PR. Every test cleanup spends from the local Polar budget, so a full run started soon after another can find it spent. The E2E checkout and recovery steps wait out one `RATE_LIMITED` rejection and retry, so a test that still fails with `RATE_LIMITED` hit the limit twice. Wait a minute for the budget to refill and rerun that test alone before treating it as a regression.
- For before captures, stop bootstrap, `git switch --detach origin/main` in this worktree, and start it again. If tests already wrote fields the old schema lacks, `convex dev` refuses the old schema; stop bootstrap and run `pnpm db:reset --yes` first. Switch back to the task branch and restart bootstrap afterwards.
- Continue into complete-worktree in this session. Title the PR `chore: sync with AI-SaaS-Template`. The description lists the incoming template PRs with links, how each conflicted area was resolved, and the open decisions. Pass along that the merge must use `--merge`.

## The other direction

An app fix that belongs in the template goes to the template as its own PR, never inside a sync. In a template worktree for that task, branch from the template's `main` (Rekura used `upstream/<topic>` branches), port the change by hand without the app's names, branding or domain code, and follow the template's `AGENTS.md`. When a later sync brings the template version back, resolve to it.
