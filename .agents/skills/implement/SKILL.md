---
name: implement
description: Implement a GitHub issue or feature description in the current T3-assigned worktree, then use complete-worktree to publish, review, merge, and clean up the task. Use when the maintainer requests the full implementation workflow.
---

# Implement a feature and complete its worktree

Accept a GitHub issue number or URL, a problem description, or a feature request. For example: `$implement issue #123` or `$implement let users rename their projects`.

Invoking this skill with a task authorizes implementation followed by the [complete-worktree](../complete-worktree/SKILL.md) workflow: task commits, pushing, one PR, review commands and replies, merging after verification and bot review, deleting the task branch, and shutting down the task's services and terminals. Do not ask for these permissions again. Reading or editing this skill does not invoke it or authorize publishing the current changes. Production deployment and unrelated external actions remain outside this authorization.

## Establish the task

- Read the applicable `AGENTS.md` and relevant skills. For an issue, read its body and discussion; identify the intended behavior and acceptance criteria. Resolve ordinary implementation choices yourself. Ask only about missing information that materially changes scope or behavior, while continuing independent work.
- T3 Code assigns the task's worktree before this skill starts. Work in that current worktree and on its assigned branch. Inspect `git status`, branch, remotes, and `git worktree list`. If the checkout is on `main` or has no assigned branch, report the setup blocker. Do not create another worktree or move the task into a different checkout.
- Preserve existing maintainer changes. Do not reset, clean, stash, switch, or remove another agent's worktree to make room. Keep unrelated changes out of task commits; resolve ambiguous ownership with the maintainer.
- Read [resource tracking and cleanup](../complete-worktree/references/cleanup.md) before starting persistent commands. Recover any existing task resource inventory and record new services and terminals as they are started so completion can clean up across sessions.

## Implement and verify

- Implement the requested behavior and inspect the complete task diff for correctness and scope. Follow the project's architecture and validation instructions.
- For UI changes, capture the pre-change screen before modifying it so the PR can include a real before image.
- Run focused verification, then `pnpm test:unit` and `pnpm lint`. For backend or browser flows, use this worktree's `pnpm bootstrap` environment and the relevant integration or E2E tests.
- Capture the required before/after images or motion video for UI changes. Keep PR-only artifacts outside tracked source and upload them to GitHub with supported tooling when preparing the PR.
- Commit only the task changes using the repository's conventional commit format. Keep services available for subsequent checks; completion owns their shutdown.

## Complete the worktree

Read and execute [complete-worktree](../complete-worktree/SKILL.md) in this same session. Pass along the task scope, issue, verified commit and check results, UI evidence, and resource inventory. This is an automatic continuation, not a handoff to the maintainer or a requirement to invoke a second command.

That skill owns syncing fresh `main`, PR publication, bot review and fixes, the final merge, branch deletion, and resource cleanup. Reuse verification for an unchanged commit; rerun it when code or a merge changes the result. Do not duplicate the PR workflow here.

Finish only when the PR is confirmed merged and cleanup is verified. If blocked, report the PR or branch, the unmet gate, and the precise input or external change needed. Preserve unmerged work and stop owned persistent services when ending the session as described in the cleanup reference.
