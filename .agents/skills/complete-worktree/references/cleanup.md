# Track and clean up task resources

Read this before starting persistent commands and again when completing a worktree. Cleanup covers the bootstrap stack (Next.js, local Convex and its watcher, Polar forwarding, and Tailscale proxies it created), test watchers, inspection/browser sessions, and other task-owned background commands and terminals, including those from earlier sessions.

## Bootstrap owns its own record

`pnpm bootstrap` writes this worktree's ownership record to `$(git rev-parse --path-format=absolute --git-path bootstrap-state.json)`: supervisor PID and start time, status, mode, ports, URLs, created and preserved Tailscale routes, and the log path (`--git-path bootstrap.log`). It lives in the worktree's Git admin directory, outside tracked source, and survives the session.

- `pnpm bootstrap:status` shows status, URLs, mode, PID, and log path; `--json` for scripts. A recorded PID that is gone or has a different start time is reported as `stale`.
- `pnpm bootstrap:wait [--timeout <seconds>]` exits 0 once ready and prints the log tail on failure. Use it after starting bootstrap in the background.
- `pnpm bootstrap:stop [--timeout <seconds>]` rechecks PID and start time, sends SIGINT to the supervisor only, then waits for exit and for this worktree's ports to be free. If it does not exit, it sends SIGTERM to the same verified supervisor once. Bootstrap's own shutdown stops Convex, Next, and Polar and removes only Tailscale routes that run created.

Do not copy bootstrap PIDs into another inventory. If `bootstrap:stop` reports a failure, read the log and the reported survivors; do not signal anything it did not verify.

## Record other task resources

Keep a small inventory for everything bootstrap does not own, at:

```bash
git rev-parse --path-format=absolute --git-path agent-session-resources.md
```

Record separately started commands (test watchers, extra servers), their owning terminal or tool session ID, sanitized launch command, and PID with start time; task-opened browser or inspection sessions and terminal panels; and before deleting a merged branch, the PR URL, confirmed merged head, merge commit, and branch/remote so interrupted cleanup can resume. Never record credentials, environment dumps, or commands containing secrets. Preserve entries from earlier sessions.

In a fresh session, check each recorded PID against its start time; PIDs are reused. A command name, path, port, or working directory alone is not proof of ownership. Discover candidates with read-only inspection and never turn search matches into kill targets. If ownership cannot be established, leave the resource untouched and report the blocker.

## Stop services

1. Finish checks and evidence capture.
2. Run `pnpm bootstrap:stop`. It works from any session and is equivalent to Ctrl+C in bootstrap's terminal. Confirm it reports the stack stopped and ports free; `pnpm bootstrap:status` should then show `stopped`.
3. Stop other task commands through their owning terminals or verified supervisors and wait for exit. For a manual fallback, establish the exact descendants belonging to that launch, recheck identity, and terminate gracefully before escalating only verified survivors after a bounded wait.
4. Never use `pkill`/`killall`, kill-by-search pipelines, port-based killing, or Tailscale-wide resets. Do not signal the agent/harness or unrelated/shared services. An occupied port held by an unrelated process is not permission to stop it.

## Close sessions and terminals

- Stop task-owned recordings and close task-opened inspection/browser sessions when the tool supports it. Preserve sessions owned by the maintainer or another task.
- Command sessions (for example Codex's `exec_command`) are not T3 terminal panels. Verify command exit separately from panel closure.
- End task-owned idle shells, then close panels opened for this task if a close operation is exposed. If none is exposed, panel closure is unsupported UI cleanup, not a blocker; mention it only for a known task-owned panel.
- Do not terminate the current agent/harness to close its own execution channel.

Continue cleaning independently verified resources if another item fails. Clean Git status does not require removing ignored `.convex`, `.next`, generated environment files, or the bootstrap state and log. Preserve the worktree directory and database. Delete the inventory after its items are verified complete; on a blocker, mark completed items and keep the unresolved ones.
