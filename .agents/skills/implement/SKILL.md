---
name: implement
description: Implement a GitHub issue, bug fix, or feature in the current T3-assigned worktree, then use complete-worktree to publish, review, merge, and clean up the task. Use whenever the maintainer asks for something to be implemented, whether or not they name this skill.
---

# Implement a feature and complete its worktree

Accept a GitHub issue number or URL, a problem description, or a feature request. For example: `$implement issue #123`, `$implement let users rename their projects`, or simply "let users rename their projects". Questions, research, plans, and reviews are not implementation requests.

A maintainer request to implement something, with or without naming this skill, authorizes implementation followed by the [complete-worktree](../complete-worktree/SKILL.md) workflow: task commits, pushing, one PR, review commands and replies, merging after verification and bot review, deleting the task branch, and shutting down the task's services and terminals. Do not ask for these permissions again. Reading or editing this skill does not invoke it or authorize publishing the current changes. Production deployment and unrelated external actions remain outside this authorization.

## Establish the task

- Read the applicable `AGENTS.md` and relevant skills. For an issue, read its body and discussion; identify the intended behavior and acceptance criteria. Resolve ordinary implementation choices yourself. Ask only about missing information that materially changes scope or behavior, while continuing independent work.
- When the task is a GitHub issue, mark it as claimed with `gh issue edit <number> --add-label "in progress"` before starting work. If the repository lacks the label, create it with `gh label create "in progress" --color FBCA04 --description "An agent or maintainer is working on this"`. If the issue already carries the label and this session did not add it, look for an open PR or branch for it and confirm with the maintainer before duplicating the work. Remove the label with `--remove-label` if you stop without opening a PR; once a PR exists, its link shows the progress.
- T3 Code assigns the task's worktree before this skill starts. Work in that current worktree and on its assigned branch. Inspect `git status`, branch, remotes, and `git worktree list`. If the checkout is on `main` or has no assigned branch, report the setup blocker. Do not create another worktree or move the task into a different checkout.
- Preserve existing maintainer changes. Do not reset, clean, stash, switch, or remove another agent's worktree to make room. Keep unrelated changes out of task commits; resolve ambiguous ownership with the maintainer.
- Read [resource tracking and cleanup](../complete-worktree/references/cleanup.md) before starting persistent commands. Recover any existing task resource inventory and record new services and terminals as they are started so completion can clean up across sessions. `pnpm bootstrap` uses Tailscale mode when available; `pnpm bootstrap:status`, `bootstrap:wait`, and `bootstrap:stop` report, await, and stop this worktree's stack.

## Implement and verify

- Implement the requested behavior and inspect the complete task diff for correctness and scope. Follow the project's architecture and validation instructions.
- For UI changes, run `pnpm capture <path...> --label before` before modifying the screen so the PR can include a real before image. Add `--plan` or `--signed-out` for the relevant account state.
- Run focused verification, then `pnpm test:unit` and `pnpm lint`. For backend or browser flows, use this worktree's bootstrap environment and the relevant integration or E2E tests.
- Capture the after state with `pnpm capture <path...> --label after`, adding `--video <seconds>` for motion or timing. Captures stay outside the worktree under `$TMPDIR/pr-evidence/<worktreeId>/`; completion uploads them with `gh --attach` and removes them after the merge.
- When the maintainer wants to inspect the change, share a `pnpm review-link [--plan …] [--path …]` link: a single-use signed-in link over Tailscale. Never paste it into PRs, issues, or commits.
- Commit only the task changes using the repository's conventional commit format. Keep services available for subsequent checks; completion owns their shutdown.

## Decide whether the maintainer needs to weigh in

Always continue into completion, which opens the PR so CI and bot review run without waiting on the maintainer. Hold the merge for their feedback when:

- the maintainer asked to see the change before it merges;
- an open question about scope or behavior would change what ships;
- the result involves a visual or product choice they should judge rather than one the task already settles;
- a blocker needs their input or an external change.

Ordinary implementation choices, passing checks, and bot review findings are not reasons to hold. Skip the PR only when the maintainer asked you not to open one; then commit and report back.

## Complete the worktree

Read and execute [complete-worktree](../complete-worktree/SKILL.md) in this same session, passing along whether the merge is held for maintainer feedback and why. Pass along the task scope, issue, verified commit and check results, UI evidence, and resource inventory. This is an automatic continuation, not a handoff to the maintainer or a requirement to invoke a second command.

That skill owns syncing fresh `main`, PR publication, bot review and fixes, the final merge, branch deletion, and resource cleanup. Reuse verification for an unchanged commit; rerun it when code or a merge changes the result. Do not duplicate the PR workflow here.

Finish only when the PR is confirmed merged and cleanup is verified. If blocked, report the PR or branch, the unmet gate, and the precise input or external change needed. Preserve unmerged work and stop owned persistent services when ending the session as described in the cleanup reference.
