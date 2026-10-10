---
name: implement
description: Implement an issue, problem, or feature in the current T3-assigned worktree, merge current main before opening a PR, address CodeRabbit feedback, and hand the verified PR to the maintainer for review. Use when the maintainer requests this complete implementation-to-PR workflow.
---

# Implement through PR review

Accept a GitHub issue number or URL, a problem description, or a feature request. For example: `$implement issue #123` or `$implement let users rename their projects`.

Invoking this skill with a task authorizes implementation, commits, pushing the task branch, opening one PR, and posting review commands and replies on that PR. Do not ask for these permissions again. Reading this skill by itself does not authorize those actions. PR merge, production deployment, and unrelated external actions require their own authorization.

Complete the workflow before asking the maintainer to review. A blocker is an exception to report honestly, not a successful handoff.

## 1. Establish the task and worktree

- Read the applicable `AGENTS.md` and relevant skills. For an issue, read its body and discussion; identify the intended behavior and acceptance criteria. Resolve ordinary implementation choices yourself. Ask only about missing information that materially changes scope or behavior, while continuing independent work.
- T3 Code assigns the task's worktree before this skill starts. Work in that current worktree and on its assigned branch throughout the workflow. Do not create another worktree or move the task into a different checkout. Inspect `git status`, branch, remotes, and `git worktree list` to confirm the environment. If the current checkout is on `main` or has no assigned branch, report the setup blocker rather than creating a replacement worktree.
- Preserve existing maintainer changes. Never reset, clean, stash, switch, or remove another agent's worktree to make room. Do not include unrelated changes in commits. A dirty worktree that prevents safe task isolation is a blocker to resolve with the maintainer.
- Confirm which remote hosts the PR's base repository. Use its freshly fetched `main` for every sync below; examples use `origin/main`. Do not substitute a stale local `main` or update the main checkout.

## 2. Implement and verify

- Implement the requested behavior and inspect the complete diff against `main` for correctness and scope. Follow the project's architecture and validation instructions.
- Run focused verification, then `pnpm test:unit` and `pnpm lint`. For backend or browser flows, use this worktree's `pnpm bootstrap` environment and the relevant integration or E2E tests. Capture the required before/after images or motion video for UI changes and upload evidence to GitHub with supported tooling; keep PR-only artifacts outside tracked source.
- Commit only the task changes. Follow the repository's conventional commit format. Keep services you started available for any later checks and stop them through their owning terminal when finished.

## 3. Merge main before creating the PR

1. Fetch the base remote's `main` again after implementation. Check whether its tip is an ancestor of the task branch (`git merge-base --is-ancestor origin/main HEAD`). Exit code 1 means a merge is needed; other errors are blockers, not proof that the branch is current.
2. If needed, merge that ref into the task branch. Resolve conflicts in line with the intended behavior, inspect the resulting diff, and rerun required verification after the merge. Preserve branch history; use a merge rather than rebase or force push.
3. Fetch once more before publication. If `main` advanced beyond the branch, repeat the merge and validation until the fetched tip is included. Record the incorporated `main` SHA.
4. Push the task branch and open one PR against `main`, or reuse the PR already associated with this task branch when resuming. Use a normal open PR so bot review can run; do not request or assign the maintainer's review yet. Describe the problem, resulting behavior, validation, issue link, and required evidence. End the body with the actual model and harness used. With `gh`, put multiline bodies in a temporary file and pass `--body-file`.
5. If T3 Code exposes `link_pull_request`, register the full PR URL immediately after creation or when resuming work on it. Before finishing, use `list_thread_pull_requests` and register any missing PR from this task. Report linking failures accurately.

## 4. Wait for and handle bot feedback

Read the PR's checks, submitted reviews, inline review comments/threads, and conversation comments. Fetch all pages; `gh pr view --comments` alone does not include every inline review. With `gh api`, the relevant surfaces include:

- `repos/{owner}/{repo}/pulls/{number}/reviews`
- `repos/{owner}/{repo}/pulls/{number}/comments`
- `repos/{owner}/{repo}/issues/{number}/comments`
- `repos/{owner}/{repo}/commits/{head_sha}/check-runs` and `/status`

Use review-thread queries when needed to follow replies and resolution. Keep the PR head SHA, push time, processed comment IDs/update times, and review coverage in session state. Bot summaries can be edited in place, so inspect updated comments as well as newly created ones.

### CodeRabbit gate

- Determine whether CodeRabbit review is enabled using repository configuration, accessible integration/settings information, and bot activity on this PR or recent PRs. No `.coderabbit.yaml`, no immediate comment, or no check alone does not prove it is disabled. An explicit maintainer instruction that it is disabled is sufficient. If the state remains unknown, report it as unknown rather than silently skipping review.
- When enabled, wait for a completed review covering the current PR head. A walkthrough, summary, queued/in-progress check, skipped review, rate-limit notice, or review of an older commit does not satisfy this gate. A completed review with no actionable findings does satisfy it. Check review commit IDs or the bot's reviewed-commit metadata together with completion status; do not rely on timestamps alone.
- Allow automatic review to start. If it does not start, or incremental review is disabled, post `@coderabbitai review` once for the unreviewed head. Use the integration's actual handle if different. Avoid duplicate triggers while review is running. Follow any retry-after notice instead of posting repeatedly. Do not change repository settings, install CodeRabbit, or upgrade its plan as part of this workflow.
- Poll at a modest interval, such as 30–60 seconds, without noisy progress messages when nothing changes. Allow 30 minutes without review progress per head by default; respect a known later retry time when practical. On a timeout, unavailable service, insufficient access, or persistent skip/rate limit, report the specific blocker and PR URL. Do not ask for a normal review or describe the PR as ready.
- CodeRabbit commands and review controls: [official command reference](https://docs.coderabbit.ai/reference/review-commands), [configuration reference](https://docs.coderabbit.ai/reference/configuration). Consult these if the service's behavior differs from the instructions above.

### Evaluate findings and checks

- Evaluate each actionable finding against the code and requested behavior. Implement relevant fixes, add meaningful regression coverage where practical, and explain the fix in its thread. For false positives or inapplicable suggestions, reply with a concrete, source-backed reason. Do not change code simply to satisfy a bot or mark an unaddressed finding as resolved.
- Review feedback from other bots too, and repair real CI failures within the task's scope. Report external failures or conflicts that need a maintainer decision as blockers.
- Batch related fixes, rerun the appropriate checks, commit, and push. Then wait for checks and CodeRabbit coverage of the new head. Earlier approvals and green checks cannot satisfy a changed head. Continue while findings or failures can be addressed within scope.

## 5. Sync main again and hand off

After feedback is addressed, fetch `main` again and check ancestry. If it advanced, merge it into the task branch, resolve conflicts, rerun verification, and push. Return to the bot-review gate for this new head. Repeat until all of these hold together:

- The requested behavior is implemented and required local verification passes.
- The PR head matches the verified local commit; required CI checks pass on that head. Pending checks are not green. Skipped or neutral checks need an explanation if they replace required verification.
- CodeRabbit is confirmed disabled, or its completed review covers that head and every actionable finding has a fix or a reasoned reply. Other actionable bot findings have also been addressed.
- A final fresh fetch shows the latest observed remote `main` is an ancestor of the PR head, with no merge conflicts. If the head changes, repeat validation and review rather than handing off stale results.
- The PR title, description, and evidence describe the final change, and the task worktree has no uncommitted task changes.

Then give the maintainer the PR link, a concise description of the behavior, verification results, CodeRabbit disposition (including any declined suggestions), and the incorporated `main` SHA. State that it is ready for their review and ask them to review it. Keep it open for the maintainer; do not merge or enable auto-merge.

If blocked, state what is complete, what prevented the remaining gate, and the precise input or external change needed. Preserve the branch, PR, and worktree so the workflow can resume.
