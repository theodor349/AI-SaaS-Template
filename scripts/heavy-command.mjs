import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { constants } from "node:os";
import { basename } from "node:path";
import { userSystemdAvailable } from "./bootstrap/detach.mjs";
import { describeWait, waitForHeadroom } from "./bootstrap/headroom.mjs";

const usage = `node scripts/heavy-command.mjs [--no-headroom] <command> [args...]

Runs a memory-hungry command, such as Playwright or next build, for a package script.
It first waits until the machine has headroom (see scripts/bootstrap/headroom.mjs),
unless --no-headroom is given, CI is set, or SKIP_HEADROOM_CHECK=1 is set.
On Linux with a systemd user manager, and not in CI, the command runs in its own
transient scope, bound to the caller's unit, so systemd-oomd stopping it under
memory pressure does not take the calling terminal or agent with it.
Output and the exit code pass through.`;

const ciSet = (env) => Boolean(env.CI) && !["0", "false"].includes(env.CI.toLowerCase());

// The user manager's unit a process runs in, such as an agent turn's scope or a
// terminal's scope, read from its cgroup v2 path. Undefined outside the user
// manager, such as in an SSH session's scope, which the user manager can't bind to.
export function userManagerUnit(cgroupText, uid = process.getuid?.()) {
  const path = cgroupText.split("\n").find((line) => line.startsWith("0::"))?.slice(3);
  if (!path?.includes(`/user@${uid}.service/`)) return undefined;
  const unit = basename(path);
  return /\.(scope|service)$/.test(unit) ? unit : undefined;
}

// The command that starts command in its own scope where systemd allows it.
// systemd-run --scope execs the command, so its PID, output, and exit status are
// the command's. BindsTo stops the new scope when the caller's unit stops, as when
// a harness stops an agent turn's scope, so the run never outlives its caller.
export function scopedLaunch({
  name, command, args, env = process.env, platform = process.platform, systemdAvailable = userSystemdAvailable,
  cgroup = () => readFileSync("/proc/self/cgroup", "utf8"), uid = process.getuid?.(), now = Date.now(),
}) {
  if (platform !== "linux" || ciSet(env) || !systemdAvailable()) return { command, args };
  const unit = `${name.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "")}-${now.toString(36)}.scope`;
  let parent;
  try { parent = userManagerUnit(cgroup(), uid); } catch { parent = undefined; }
  const binding = parent ? ["--property", `BindsTo=${parent}`, "--property", `After=${parent}`] : [];
  return { command: "systemd-run", args: ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, ...binding, "--", command, ...args], unit };
}

// systemd-oomd stops a whole unit with SIGKILL when memory pressure stays high, so
// a SIGKILL without another explanation most likely came from it.
export function sigkillHint(label, unit) {
  const check = unit ? `journalctl -t systemd-oomd -g ${unit}` : "journalctl -t systemd-oomd --since -1h";
  return `${label} was killed with SIGKILL. Memory pressure is the likely cause: systemd-oomd stops a whole scope ` +
    `when memory pressure stays high, and the kernel's OOM killer also sends SIGKILL. Check with \`${check}\`.`;
}

export const exitCodeFor = ({ code, signal }) => code ?? 128 + (constants.signals[signal] ?? 0);

// Waits for headroom, runs the command, and resolves with its exit code.
// The child stays in this process's group, so a terminal's Ctrl+C or a harness
// killing the group reaches it directly. SIGTERM and SIGHUP sent only to this
// process, as when systemd stops the caller's scope, are passed on.
export async function runHeavy({ label, command, args, headroom = true, env = process.env }) {
  if (headroom) await waitForHeadroom({ label, env, onWait: (problem, times) => console.error(describeWait(label, problem, times)) });
  const launch = scopedLaunch({ name: label.replace(/^pnpm /, ""), command, args, env });
  const child = spawn(launch.command, launch.args, { stdio: "inherit", env });
  const forward = (signal) => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const ignore = () => {};
  process.on("SIGTERM", forward).on("SIGHUP", forward).on("SIGINT", ignore);
  try {
    const exit = await new Promise((resolveExit) => {
      child.once("error", (error) => resolveExit({ error }));
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    if (exit.error) {
      console.error(`${label}: could not start ${launch.command}: ${exit.error.message}`);
      return 1;
    }
    if (exit.signal === "SIGKILL") console.error(sigkillHint(label, launch.unit));
    return exitCodeFor(exit);
  } finally {
    process.off("SIGTERM", forward).off("SIGHUP", forward).off("SIGINT", ignore);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const headroom = args[0] !== "--no-headroom";
  if (!headroom) args.shift();
  if (!args.length || args[0] === "--help") {
    console.log(usage);
  } else {
    const label = process.env.npm_lifecycle_event ? `pnpm ${process.env.npm_lifecycle_event}` : args[0];
    runHeavy({ label, command: args[0], args: args.slice(1), headroom }).then(
      (code) => { process.exitCode = code; },
      (error) => { console.error(error.message); process.exitCode = 1; },
    );
  }
}
