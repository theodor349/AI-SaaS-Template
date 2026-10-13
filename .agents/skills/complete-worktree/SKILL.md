---
name: complete-worktree
description: Complete existing changes in the current T3-assigned worktree by syncing main, creating or resuming one PR, handling CodeRabbit and CI, merging, deleting the task branch, and shutting down owned services and terminals. Use standalone or as the continuation of implement.
---

# Complete a worktree

Accept the current worktree's existing changes, an associated PR number or URL, or the continuation from [implement](../implement/SKILL.md). For example: `$complete-worktree` or `$complete-worktree PR #123`. No prior use of `implement` or session memory is required.

A maintainer request to run this workflow authorizes task commits, pushing, opening one PR, review commands and replies, merging after the gates below, deleting the task's local and remote branch, and shutting down its owned services and terminals. The continuation from `implement` carries the same authorization; do not ask again. Reading or editing this skill alone does not authorize these actions. Honor any explicit restriction such as keeping the PR open. Production deployment, removing the worktree directory or its database, and unrelated external actions are outside this workflow.

## 1. Recover the task and environment

- Read `AGENTS.md` and [resource tracking and cleanup](references/cleanup.md); recover the inventory first. Inspect `git status`, the branch, remotes, `git worktree list`, the diff, and task commits. Stay in the current T3-assigned worktree. Do not create a replacement worktree or switch to the main checkout. A checkout on `main` or without its assigned task branch is a setup blocker, except when resuming cleanup after an already confirmed merge and detach.
- Reconstruct scope from the maintainer's request, changes, issue, and associated PR. Standalone invocation includes existing changes that belong to this task, including uncommitted ones. Preserve unrelated work; ask only when ownership or intended behavior is ambiguous. Do not blindly commit all dirty files or discard them to achieve a clean status.
- Find the PR for this exact head repository and branch, with `main` as its base; verify any supplied PR matches. After a prior cleanup detached the worktree or deleted the branch, recover the PR, branch, and SHAs from the inventory. Reuse the PR instead of creating a duplicate. Register its full URL immediately with T3 Code's `link_pull_request` when available. If already merged, verify its recorded head against the local task commits and go directly to step 6; a closed unmerged PR or new commits after merge needs a maintainer decision.
- Confirm the remote hosting the PR's base repository and the remote hosting its head branch; they may differ. Examples use `origin/main` for the base. Fetch that remote's `main`, not a stale local `main`, and do not update the main checkout.
- Maintain the worktree's resource inventory, including services and terminals from earlier sessions whose task ownership can be established.

## 2. Verify, commit, and merge fresh main

1. Inspect the full task diff against the base. Run focused checks, then `pnpm test:unit` and `pnpm lint`, plus the relevant integration or E2E checks for backend/browser changes using this worktree's bootstrap environment. Existing results can be reused only for the same unchanged commit and environment. Capture and upload the required UI evidence. If standalone completion lacks a before image, recover the pre-change UI in this same worktree without losing task changes; do not invent evidence or silently omit it.
2. Commit scoped task changes with conventional commit titles. Unrelated dirty files that prevent safe syncing or branch cleanup are a blocker, not permission to stash or discard them.
3. Fetch the base remote's `main` again. Check ancestry with `git merge-base --is-ancestor origin/main HEAD`. Exit code 1 means a merge is needed; other errors are blockers. Merge the fetched ref into the task branch when needed. Resolve conflicts according to the task's behavior, inspect the resulting diff, and rerun required verification. Use a merge rather than rebase or force push.
4. Fetch once more before publication. If `main` advanced beyond the branch, repeat the merge and validation until the fetched tip is included. Record the incorporated `main` SHA and verified task head.

## 3. Publish or resume one PR

- Push the task branch and create one normal open PR against `main`, or update the existing task PR. Follow `AGENTS.md` for title, description, issue link, validation, evidence, and actual model/harness attribution. Keep descriptions aligned with the final change. With `gh`, write multiline bodies to a temporary file outside the worktree and pass `--body-file`.
- Register the full PR URL with T3 Code's `link_pull_request` immediately after creation. Before finishing, use `list_thread_pull_requests` and register any missing PR from this task. Report linking failures accurately.
- Record the PR head SHA and push time. Do not request a routine maintainer handoff; this workflow continues through merge unless a gate needs their intervention.

## 4. Handle review and checks

Read checks, submitted reviews, inline review comments/threads, and conversation comments. Fetch all pages; `gh pr view --comments` alone misses inline reviews. With `gh api`, useful surfaces are:

- `repos/{owner}/{repo}/pulls/{number}/reviews`
- `repos/{owner}/{repo}/pulls/{number}/comments`
- `repos/{owner}/{repo}/issues/{number}/comments`
- `repos/{owner}/{repo}/commits/{head_sha}/check-runs` and `/status`

Use review-thread queries for replies and resolution. Track processed comment IDs/update times and reviewed commits. Bot summaries can be edited in place; inspect updated comments as well as new ones.

### CodeRabbit gate

- Determine whether CodeRabbit review is enabled from effective repository/integration configuration and activity on this or recent PRs. Absence of `.coderabbit.yaml`, a comment, or a check does not prove it is disabled. Disabled automatic review alone does not mean CodeRabbit is unavailable. An explicit maintainer instruction that CodeRabbit is disabled is sufficient; unknown status is a blocker to report, not a reason to skip review.
- When enabled, require a completed review covering the current PR head. A walkthrough, summary, queued/in-progress check, skipped review, rate limit, or older reviewed commit does not satisfy the gate. Completed review with no actionable findings does. Check review commit IDs or reviewed-commit metadata together with completion status; timestamps alone are insufficient.
- Let automatic review start. If it does not start, request `@coderabbitai full review` for an initial full pass, or `@coderabbitai review` for subsequent changes after a completed full review. Use the integration's actual handle if different. Trigger once per unreviewed head, avoid duplicate requests while running, and follow retry-after notices. Do not install CodeRabbit, change repository settings, or upgrade its plan.
- Poll at modest intervals, such as 30–60 seconds. Stay quiet when nothing changes. Allow 30 minutes without review progress per head by default; respect a known later retry time when practical. A timeout, unavailable service, insufficient access, or persistent skip/rate limit is a blocker. Preserve the PR for resumption instead of merging without review.
- Consult the [official command reference](https://docs.coderabbit.ai/reference/review-commands) and [configuration reference](https://docs.coderabbit.ai/reference/configuration) if service behavior differs.

### Findings and CI

- Verify every actionable bot finding against the source and task. Fix real issues, add meaningful regression coverage where practical, and explain fixes in their threads. Reply to false positives or inapplicable suggestions with concrete source-backed reasons; do not mark unaddressed findings resolved.
- Address other bots and real CI failures within scope. External failures or scope decisions are blockers. Required human approvals and repository protections still apply; do not bypass them.
- Batch related fixes, rerun appropriate checks, commit, and push. Re-enter the review/check gates for the new head; approvals and green checks on an older head cannot satisfy them.

## 5. Confirm the final head and merge

Fetch `main` again after feedback. If it advanced, merge, verify, push, and return to review. Repeat until all these hold together:

- Task behavior and required local verification pass for the current commit.
- Local verified commit, remote task branch, and PR head match. Required CI checks pass for that head; pending is not green. Explain skipped/neutral checks if they replace required verification.
- CodeRabbit is confirmed disabled or its completed review covers that head, with every actionable finding fixed or answered with a reason. Other actionable bot findings are addressed too.
- A fresh fetch shows the latest observed remote `main` is an ancestor of the PR head, with no conflicts.
- The PR description and evidence reflect the final change, the worktree has no uncommitted changes, and repository merge requirements are satisfied.

Merge that verified head using the repository's allowed merge method and convention. With `gh`, pass the explicit PR URL and `--match-head-commit <verified-head>`; do not use `--admin` or bypass protections. Keep branch deletion separate from `gh pr merge --delete-branch`, which can try to switch a linked worktree to an already checked-out `main`. See the [GitHub CLI merge reference](https://cli.github.com/manual/gh_pr_merge).

If a merge queue is required, enter it and wait for GitHub to confirm the merge; queued or auto-merge-enabled is not merged. If the head changes or queue checks fail, reassess the gates. Allow 30 minutes without merge/queue progress by default, then report the specific blocker. Do not delete branches or declare completion while the PR remains unmerged.

Read the PR back from GitHub to confirm `MERGED`, its merged head, and merge commit. Save these with the branch name, head repository/remote, and incorporated `main` SHA in the resource inventory before cleanup. A rejected merge must be investigated; do not retry indefinitely or remove protections.

## 6. Shut down resources and delete the task branch

Execute [resource cleanup](references/cleanup.md), including its session and terminal-panel rules, even if a later branch-deletion step fails. Unverified process or service shutdown remains a cleanup blocker.

After confirmed merge, inspect status and refs again. If new uncommitted work appeared, preserve it and report a cleanup blocker before detaching or deleting branches. Delete only the task branch whose tip still equals the confirmed merged PR head. If local or remote refs advanced, preserve them and report the extra work. If GitHub already deleted the remote branch, verify its absence and continue. Otherwise delete on the head remote with an exact expected-SHA lease so a concurrent push cannot be lost. Never delete `main` or unrelated branches.

If the local branch is already absent, verify that and skip its deletion. Otherwise confirm it is not checked out in another worktree, then detach this worktree at the verified task head (`git switch --detach <verified-head>`) and delete the task branch. Do not switch to `main` or remove the worktree. Try ordinary branch deletion; after a squash/rebase merge, forced local deletion is allowed only when GitHub confirms that exact head was merged and the unchanged branch contains no extra work. Verify local/remote branch absence and clean Git status. Remove the resource inventory once required resource and branch cleanup is confirmed complete, as defined in the cleanup reference.

Report the merged PR link, behavior, verification and bot disposition, and whether branch deletion and resource shutdown succeeded. Do not describe a partial resource cleanup as complete. If blocked before merge, preserve the branch, PR, and changes; when ending the session, clean up owned resources per the cleanup reference, retaining unresolved resource inventory for resumption.
