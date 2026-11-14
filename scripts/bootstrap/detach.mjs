import { spawnSync } from "node:child_process";

// True when this user's systemd manager accepts transient scopes. Starting a
// throwaway scope tests exactly what --detach needs.
export function userSystemdAvailable() {
  const probe = spawnSync("systemd-run", ["--user", "--scope", "--quiet", "--collect", "--", "true"], { stdio: "ignore", timeout: 5000 });
  return probe.status === 0;
}

// The command --detach spawns to start the supervisor. Agent harnesses can run
// each turn in a systemd scope and stop it when the turn ends, which signals every
// process in its cgroup, including a supervisor in its own session. So on Linux
// with a user systemd manager, the supervisor starts in its own transient scope.
// systemd-run --scope execs the command, so the spawned PID is the supervisor's
// and the state file's PID checks still apply. The timestamp keeps a scope left
// by a crashed run from blocking the name.
export function detachedLaunch({ id, command, args, platform = process.platform, systemdAvailable = userSystemdAvailable, now = Date.now() }) {
  if (platform !== "linux" || !systemdAvailable()) return { command, args };
  const unit = `bootstrap-${id}-${now.toString(36)}.scope`;
  return { command: "systemd-run", args: ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, "--", command, ...args], unit };
}
