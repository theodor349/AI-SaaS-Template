import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// The scope name detachedLaunch() gives a detached supervisor.
const bootstrapScope = /^bootstrap-[A-Za-z0-9-]+\.scope$/;

// A recorded scope is one this module may sweep: a bootstrap scope whose cgroup
// path ends in that unit.
export function isBootstrapScope(scope) {
  return typeof scope?.unit === "string" && bootstrapScope.test(scope.unit) &&
    typeof scope.cgroup === "string" && scope.cgroup.startsWith("/") && basename(scope.cgroup) === scope.unit;
}

// The systemd scope this supervisor owns, when --detach started it in one. The
// launcher names the unit in BOOTSTRAP_SCOPE and this process checks that its own
// cgroup is that unit. Only then does the cgroup hold nothing but this run: a
// foreground bootstrap shares its cgroup with the terminal or agent that started it.
export function ownScope(unit, cgroupText) {
  if (!unit || !cgroupText) return undefined;
  const cgroup = cgroupText.split("\n").find((line) => line.startsWith("0::"))?.slice(3);
  const scope = { unit, cgroup };
  return isBootstrapScope(scope) ? scope : undefined;
}

export function readOwnCgroup() {
  try { return readFileSync("/proc/self/cgroup", "utf8"); }
  catch { return undefined; }
}

export function cgroupProcesses(cgroup) {
  try { return readFileSync(`/sys/fs/cgroup${cgroup}/cgroup.procs`, "utf8").split("\n").filter(Boolean).map(Number); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function signalProcess(pid, signal) {
  try { process.kill(pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

// Stops every process left in a bootstrap scope's cgroup except this one. A
// process a service started detached, such as the command the Convex CLI starts
// after its first push, can leave its process group and lose its parent, so the
// process table no longer leads to it. The cgroup still holds it.
export async function sweepScope(scope, {
  self = process.pid, processes = cgroupProcesses, signal = signalProcess, graceMs = 5000,
} = {}) {
  if (!isBootstrapScope(scope)) return { stopped: 0, survivors: [] };
  const remaining = () => processes(scope.cgroup).filter((pid) => pid !== self);
  const found = remaining();
  if (!found.length) return { stopped: 0, survivors: [] };
  for (const pid of found) signal(pid, "SIGTERM");
  let deadline = Date.now() + graceMs;
  while (Date.now() < deadline && remaining().length) await delay(50);
  for (const pid of remaining()) signal(pid, "SIGKILL");
  deadline = Date.now() + 1000;
  while (Date.now() < deadline && remaining().length) await delay(50);
  const survivors = remaining();
  return { stopped: found.length - survivors.length, survivors };
}
