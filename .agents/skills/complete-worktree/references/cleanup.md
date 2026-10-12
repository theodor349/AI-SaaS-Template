# Track and clean up task resources

Read this before starting persistent commands and again when completing a worktree. Cleanup covers bootstrap, Next.js, local Convex and its watcher, Polar forwarding, Tailscale proxies created by the task, test watchers, inspection/browser sessions, and other task-owned background commands and terminals, including those from earlier sessions.

## Keep recoverable ownership records

Use a per-worktree inventory outside tracked source. Resolve its path with:

```bash
git rev-parse --path-format=absolute --git-path agent-session-resources.md
```

In a linked worktree this lives in its own Git administrative directory, outside the worktree. Keep it small and update it as resources start and stop, preserving entries from earlier sessions. Record the worktree root/branch, owning session and terminal or tool session ID, sanitized launch command, supervisor PID and start time, observed child PIDs/process groups and start times, and resources such as ports or proxies created by that run. Do not record credentials, environment dumps, or commands containing secrets. Record pre-existing/reused proxies separately so they are preserved. Before deleting a merged branch, also record the PR URL, confirmed merged head, merge commit, and branch/remote so interrupted cleanup can resume without the branch.

Recover the inventory in a fresh session. Check current process identity against its recorded PID/start time; PIDs can be reused. Reconstruct missing ownership only from reliable launch/session records or a verified supervisor and its process ancestry. A command name, path, port, or working directory by itself is not proof. Discover candidate resources with read-only inspection; do not turn search matches into kill targets. If ownership or terminal control cannot be established, leave that resource untouched and report the exact cleanup blocker.

## Stop services through their owner

1. Finish checks and evidence capture. Stop `pnpm bootstrap` or `pnpm bootstrap:tailscale` with Ctrl+C in its original terminal. If a harness provides terminal input, send Ctrl+C to that recorded terminal/session. Wait for the supervisor to exit and its shutdown to finish. Do not kill only the Next listener, close the terminal first, or stop a shared provider daemon.
2. The shutdown in [bootstrap.mjs](../../../../scripts/bootstrap.mjs) terminates its owned child groups, including Convex, Next, and Polar. [bootstrap-tailscale.mjs](../../../../scripts/bootstrap-tailscale.mjs) also removes only proxies created by that run. Confirm completion rather than assuming Ctrl+C was enough. If an original terminal is inaccessible, a verified supervisor can receive SIGINT or SIGTERM by its exact PID to invoke the same shutdown path; check PID/start time immediately before signaling.
3. Stop separately started task commands through their owning terminals or verified supervisors. Wait for exit. For manual fallback, establish the exact descendants/groups belonging to that launch before signaling, recheck identity, and use graceful termination first. Escalate only for those verified survivors after a bounded wait. Never use broad `pkill`/`killall`, process-search pipelines that kill matches, port-based killing, or Tailscale-wide resets. Do not signal the agent/harness or unrelated/shared services.
4. Confirm the recorded supervisor and descendants have exited and task-owned listeners have stopped. Use `pnpm bootstrap --print` to obtain this worktree's local ports if needed; it starts nothing. Ports are a secondary check, not ownership evidence. For Tailscale, verify task-created routes are gone and pre-existing routes remain. An occupied port reused by an unrelated process is not permission to stop it.

The controlling supervisor may exit before a child. Keep the ownership record until both are confirmed gone. If graceful shutdown fails, inspect the bootstrap cleanup error and surviving verified resources; do not report shutdown as successful.

## Close sessions and terminals

- Stop task-owned recordings and close task-opened inspection/browser sessions when the available tool supports closure. Preserve sessions or tabs owned by the maintainer or another task.
- After commands exit, close every terminal opened for this task, including idle shells, using the available terminal/harness close operation. List again to verify. Sending `exit` to an owned shell can end its process but does not necessarily remove a terminal panel or window; verify each separately.
- A new session may not have access to an earlier session's terminal handles. Use available worktree/session terminal controls if exposed. Do not invent a close tool or claim closed windows when no API can confirm it. Report the specific remaining terminals and needed manual closure, keeping the inventory for resumption.
- Do not terminate the current agent/harness to close its own execution channel. Finish the final report normally and let the harness release that channel.

Continue cleaning independently verified resources if another item fails. Clean Git status does not require removing ignored `.convex`, `.next`, or generated environment files. Preserve the worktree directory and database. Delete the inventory only after all recorded task resources and branch-cleanup items are verified complete; on a blocker, mark completed items and retain the unresolved ones.
