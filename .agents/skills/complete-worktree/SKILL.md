---
name: complete-worktree
description: Complete existing changes in the current T3-assigned worktree by syncing main, creating or resuming one PR, handling CI and review comments, merging, deleting the task branch, and shutting down owned services and terminals. Use standalone or as the continuation of implement.
---

# Complete a worktree

Accept the current worktree's existing changes, an associated PR number or URL, or the continuation from [implement](../implement/SKILL.md). For example: `$complete-worktree` or `$complete-worktree PR #123`. No prior use of `implement` or session memory is required.

A maintainer request to run this workflow authorizes task commits, pushing, opening one PR, review commands and replies, merging after the gates below, deleting the task's local and remote branch, shutting down its owned services and terminals, and removing its build output and temporary files after merge. The continuation from `implement`, which follows any implementation request, carries the same authorization; do not ask again. Reading or editing this skill alone does not authorize these actions. Honor any explicit restriction such as keeping the PR open. Production deployment, removing the worktree directory or its database, and unrelated external actions are outside this workflow.

## 1. Recover the task and environment

- Read `AGENTS.md` and [resource tracking and cleanup](references/cleanup.md); recover the inventory first. Inspect `git status`, the branch, remotes, `git worktree list`, the diff, and task commits. Stay in the current T3-assigned worktree. Do not create a replacement worktree or switch to the main checkout. A checkout on `main` or without its assigned task branch is a setup blocker, except when resuming cleanup after an already confirmed merge and detach.
- Reconstruct scope from the maintainer's request, changes, issue, and associated PR. Standalone invocation includes existing changes that belong to this task, including uncommitted ones. Preserve unrelated work; ask only when ownership or intended behavior is ambiguous. Do not blindly commit all dirty files or discard them to achieve a clean status.
- Find the PR for this exact head repository and branch, with `main` as its base; `pnpm pr:gate` with no argument resolves the current branch's PR, and with a number or URL verifies a supplied one. After a prior cleanup detached the worktree or deleted the branch, recover the PR, branch, and SHAs from the inventory. Reuse the PR instead of creating a duplicate. Register its full URL immediately with T3 Code's `link_pull_request` when available. If already merged, verify its recorded head against the local task commits and go directly to step 6; a closed unmerged PR or new commits after merge needs a maintainer decision.
- The base repository's remote and the head branch's remote may differ. Examples use `origin/main` for the base. Always fetch that remote's `main` rather than trusting a stale local `main`, and do not update the main checkout.
- Maintain the worktree's resource inventory, including services and terminals from earlier sessions whose task ownership can be established. Check this worktree's stack with `pnpm bootstrap:status`; a detached run from an earlier session is still this task's to stop.

## 2. Verify, commit, and merge fresh main

1. Inspect the full task diff against the base. Run focused checks, then `pnpm test:unit` and `pnpm lint`, plus the relevant integration or E2E checks for backend/browser changes against this worktree's bootstrap (start it with `pnpm bootstrap --detach` if it is not running; `pnpm bootstrap:wait` blocks until it is ready). Existing results can be reused only for the same unchanged commit and environment.
2. UI changes need before/after images, and motion or timing needs a short video. Capture with `pnpm capture <path...> --label before|after` (`--plan`, `--signed-out`, `--video <seconds>` as needed); files land outside the worktree in `$TMPDIR/pr-evidence/<worktreeId>/<label>`. If standalone completion lacks a before image, recover the pre-change UI in this same worktree without losing task changes; do not invent evidence or silently omit it.
3. Commit scoped task changes with conventional commit titles. Unrelated dirty files that prevent safe syncing or branch cleanup are a blocker, not permission to stash or discard them.
4. Fetch the base remote's `main` and check `git merge-base --is-ancestor origin/main HEAD`. Exit code 1 means a merge is needed; other errors are blockers. Merge the fetched ref into the task branch, resolve conflicts according to the task's behavior, inspect the result, and rerun required verification. Use a merge rather than rebase or force push. Repeat until a fresh fetch shows `main` included, and record the incorporated `main` SHA and verified head.

## 3. Publish or resume one PR

- Push the task branch and create one normal open PR against `main`, or update the existing task PR. Follow `AGENTS.md` for title, description, issue link, validation, evidence, and actual model/harness attribution. Write multiline bodies to a temporary file outside the worktree and pass `--body-file`.
- Upload UI evidence with `gh pr create|edit|comment --attach '<file>#<alt text>'` (gh 2.99.0 or newer). Never commit evidence or paste `pnpm review-link` sign-in links into the PR.
- Register the full PR URL with T3 Code's `link_pull_request` immediately after creation. Before finishing, use `list_thread_pull_requests` and register any missing PR from this task. Report linking failures accurately.
- Continue through merge without a routine maintainer handoff unless a gate needs their intervention or the merge is held for maintainer feedback.
- When `implement` held the merge for feedback, or the maintainer asked to see the change before it merges, say so in your report with exactly what you need, and keep handling CI and review comments in step 4 meanwhile. Share a `pnpm review-link` if they should inspect the running change. Apply requested changes, verify, and push; the gates restart for the new head. Merge only after the maintainer confirms.

## 4. Poll the gates and handle review

`pnpm pr:gate [PR] [--json]` is the polling primitive. It reads every page of checks, statuses, reviews, review threads, and comments for the PR's current head, fetches the base `main`, and evaluates the merge gates. Exit codes: `0` ready to merge, `1` waiting (checks pending or GitHub still updating), `2` action needed, `3` error (investigate; never treat it as green). The human output names each gate and lists failing checks, unresolved threads, and bot or human activity since the head was pushed; `--json` adds thread IDs and full details. Poll every 30–60 seconds and stay quiet while nothing changes.

### Reviews

Do not wait for review bots. Do not hold the PR for a bot's first round, request a review from a bot, or summon one that has not posted. Do not install bots or change their settings or plans. `pr:gate` has no review gate; once the other gates pass, continue to step 5 whether or not a bot has posted.

Handle the reviews and comments that are on the PR when you poll, from bots or humans, as described below. Unresolved review threads block the merge through the Threads gate.

### Findings and CI

- Verify every unresolved thread, and every actionable, nitpick, or outside-diff comment listed in a bot's review body, against the source and task. Fix real issues with meaningful regression coverage where practical and reply in the thread with the fix. Reply to false positives or inapplicable suggestions with a concrete source-backed reason. Resolve a thread only once it is fixed or answered.
- Read other bot and human comments in the activity list; some bots edit a summary comment in place instead of posting a new one. Fix real CI failures within scope; external failures and scope decisions are blockers. Required human approvals and repository protections still apply.
- Batch related fixes, rerun appropriate checks, commit, and push. The gates restart for the new head; human approvals do not carry over.

## 5. Merge the verified head

Merge only when `pnpm pr:gate` exits `0`, any maintainer hold from step 3 is released, and, for that same head, local verification passed and the PR description and evidence reflect the final change. Exit `0` means the local, remote, and PR heads match with no uncommitted changes, freshly fetched `main` is an ancestor, GitHub reports the PR mergeable, required checks pass (it says when it treats all checks as required), and no review thread is unresolved. You must also verify and answer every review and comment on the PR as described in step 4. Explain skipped or neutral checks if they replace required verification. If `main` advanced, merge it, verify, push, and return to step 4.

Use the merge command from its verdict line (`gh pr merge <url> --match-head-commit <head>`) with the repository's allowed merge method. Never pass `--admin` or bypass protections. Keep branch deletion out of `gh pr merge --delete-branch`, which can try to switch a linked worktree to an already checked-out `main`. A rejected merge must be investigated; do not retry indefinitely or remove protections.

If `pr:gate` reports a merge queue, enter it and wait for GitHub to confirm the merge; queued or auto-merge-enabled is not merged. Reassess the gates if the head changes or queue checks fail. Allow 30 minutes without merge or queue progress, then report the specific blocker.

Run `pnpm pr:gate <url>` again to confirm `MERGED` with its merge commit. Save the PR URL, merged head, merge commit, branch name, head remote, and incorporated `main` SHA in the resource inventory before cleanup.

After the merge, check the E2E run that the push to `main` starts (`gh run list --workflow e2e.yml --branch main --commit <merge commit> --limit 1`). If it fails, say so in your report, even when the failure isn't from your change.

## 6. Shut down resources and delete the task branch

Execute [resource cleanup](references/cleanup.md), including its session and terminal-panel rules and task-file removal, even if a later branch-deletion step fails. Unverified process or service shutdown remains a cleanup blocker.

After confirmed merge, inspect status and refs again. If new uncommitted work appeared, preserve it and report a cleanup blocker before detaching or deleting branches. Delete only the task branch whose tip still equals the confirmed merged PR head. If local or remote refs advanced, preserve them and report the extra work. If GitHub already deleted the remote branch, verify its absence and continue. Otherwise delete on the head remote with an exact expected-SHA lease so a concurrent push cannot be lost. Never delete `main` or unrelated branches.

If the local branch is already absent, verify that and skip its deletion. Otherwise confirm it is not checked out in another worktree, then detach this worktree at the verified task head (`git switch --detach <verified-head>`) and delete the task branch. Do not switch to `main` or remove the worktree. Try ordinary branch deletion; after a squash/rebase merge, forced local deletion is allowed only when GitHub confirms that exact head was merged and the unchanged branch contains no extra work. Verify local/remote branch absence and clean Git status. Remove the resource inventory once required resource and branch cleanup is confirmed complete, as defined in the cleanup reference.

Report the merged PR link, behavior, verification and review disposition, and whether branch deletion and resource shutdown succeeded. Do not describe a partial resource cleanup as complete. If blocked before merge, preserve the branch, PR, and changes; when ending the session, clean up owned resources per the cleanup reference, including `pnpm bootstrap:stop` unless the maintainer asked to keep the stack running or you shared a review link with them, and retain unresolved resource inventory for resumption.
