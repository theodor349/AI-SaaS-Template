import { setTimeout as delay } from "node:timers/promises";
import { processRows, processStart, processTable, signalProcessGroup } from "./processes.mjs";
import { readState, writeState } from "./state.mjs";
import { removeRecordedRoutes } from "./tailscale.mjs";

// A supervisor killed before its own shutdown (for example by SIGKILL) leaves its
// services and Tailscale routes behind. The state file records both, so they can be
// stopped without matching processes by name, path, or port. A group is signalled
// only while a recorded member is alive in it with its recorded start time; a
// process group ID cannot be reused while any member is alive. A failed run gets
// the same treatment, because its shutdown can fail partway, such as a Tailscale
// command timing out on a loaded machine.
export async function reclaimStaleRun(state, {
  table = processTable, startOf = processStart, signal = signalProcessGroup, removeRoutes = removeRecordedRoutes, graceMs = 5000,
} = {}) {
  const rows = processRows(await table());
  const owned = (state.services ?? []).filter(({ pgid, members }) => members.some(({ pid, start }) =>
    rows.some(([id, , group]) => id === pid && group === pgid) && startOf(pid) === start)).map(({ pgid }) => pgid);
  const running = (group) => signal(group, 0);
  for (const group of owned) signal(group, "SIGTERM");
  let deadline = Date.now() + graceMs;
  while (Date.now() < deadline && owned.some(running)) await delay(50);
  for (const group of owned) if (running(group)) signal(group, "SIGKILL");
  deadline = Date.now() + 1000;
  while (Date.now() < deadline && owned.some(running)) await delay(50);
  const survivors = owned.filter(running);

  // Routes go after the services, so their targets no longer count as listening.
  const created = state.tailscale?.createdRoutes ?? [];
  let routes = { removed: [], kept: [], blocked: [] };
  if (created.length) {
    try { routes = await removeRoutes(state.tailscale.hostname, created); }
    catch (error) { routes = { removed: [], kept: [], blocked: created, error: error.message }; }
  }
  return { stopped: owned.filter((group) => !survivors.includes(group)), survivors, routes };
}

// Reclaims a stale or failed run, reports the result, and marks the state stopped
// once nothing it owned remains, keeping a failed run's error. Returns false when
// something needs attention, which leaves the status as it was so a later command
// retries.
export async function reclaim(stateFile, recorded, { log = console.log, warn = console.error, ...options } = {}) {
  log(recorded.status === "failed"
    ? "Bootstrap is not running (failed); removing any services and routes it left behind."
    : `Bootstrap supervisor ${recorded.pid} exited without cleaning up; reclaiming the services and routes it recorded.`);
  const { stopped, survivors, routes } = await reclaimStaleRun(recorded, options);
  if (stopped.length) log(`Stopped ${stopped.length} leftover service process group${stopped.length === 1 ? "" : "s"}.`);
  if (routes.removed.length) log(`Removed Tailscale routes on ports ${routes.removed.map(({ port }) => port).join(", ")}.`);
  if (survivors.length) warn(`Process groups ${survivors.join(", ")} survived SIGKILL; inspect them before restarting.`);
  if (routes.error) warn(`Tailscale route cleanup failed: ${routes.error}. Check tailscale serve status.`);
  else if (routes.blocked.length) warn(`Tailscale routes on ports ${routes.blocked.map(({ port }) => port).join(", ")} still point to this worktree, but something listens on their targets. Stop it, then rerun pnpm bootstrap:stop.`);
  if (routes.kept.length) log(`Kept Tailscale routes on ports ${routes.kept.map(({ port }) => port).join(", ")}; they now point elsewhere.`);
  const current = readState(stateFile);
  if (current?.pid !== recorded.pid || current.processStart !== recorded.processStart) {
    warn("The bootstrap state file changed during reclamation; check pnpm bootstrap:status.");
    return false;
  }
  const ok = !survivors.length && !routes.error && !routes.blocked.length;
  if (ok) writeState(stateFile, { ...current, status: "stopped", proxyCleanupError: undefined, reclaimedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return ok;
}
