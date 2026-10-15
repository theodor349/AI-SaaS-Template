import { setTimeout as delay } from "node:timers/promises";
import { processRows, processStart, processTable, signalProcessGroup } from "./processes.mjs";
import { readState, writeState } from "./state.mjs";
import { removeRecordedRoutes } from "./tailscale.mjs";

// A supervisor killed before its own shutdown (for example by SIGKILL) leaves its
// services and Tailscale routes behind. The state file records both, so they can be
// stopped without matching processes by name, path, or port. A group is signalled
// only while a recorded member is alive in it with its recorded start time; a
// process group ID cannot be reused while any member is alive.
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
  let routes = { removed: [], kept: [] };
  if (created.length) {
    try { routes = await removeRoutes(state.tailscale.hostname, created); }
    catch (error) { routes = { removed: [], kept: created, error: error.message }; }
  }
  return { stopped: owned.filter((group) => !survivors.includes(group)), survivors, routes };
}

// Reclaims a stale run, reports the result, and marks the state stopped once
// nothing it owned remains. Returns false when something needs attention.
export async function reclaim(stateFile, recorded, { log = console.log, warn = console.error, ...options } = {}) {
  log(`Bootstrap supervisor ${recorded.pid} exited without cleaning up; reclaiming the services and routes it recorded.`);
  const { stopped, survivors, routes } = await reclaimStaleRun(recorded, options);
  if (stopped.length) log(`Stopped ${stopped.length} leftover service process group${stopped.length === 1 ? "" : "s"}.`);
  if (routes.removed.length) log(`Removed Tailscale routes on ports ${routes.removed.map(({ port }) => port).join(", ")}.`);
  if (survivors.length) warn(`Process groups ${survivors.join(", ")} survived SIGKILL; inspect them before restarting.`);
  if (routes.error) warn(`Tailscale route cleanup failed: ${routes.error}. Check tailscale serve status.`);
  else if (routes.kept.length) warn(`Kept Tailscale routes on ports ${routes.kept.map(({ port }) => port).join(", ")}; they changed or have a listener.`);
  const ok = !survivors.length && !routes.error;
  const current = readState(stateFile);
  if (ok && current?.pid === recorded.pid && current.processStart === recorded.processStart) {
    writeState(stateFile, { ...current, status: "stopped", reclaimedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  return ok;
}
