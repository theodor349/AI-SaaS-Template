import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { gitRoot } from "./bootstrap/config.mjs";
import { occupiedPorts } from "./bootstrap/network.mjs";
import { processStart } from "./bootstrap/processes.mjs";
import { reclaim } from "./bootstrap/reclaim.mjs";
import { bootstrapPaths, describeForwarding, inspectState, isVerifiedSupervisor, liveStatuses, logTail, readCurrentState, readState, reclaimableStatuses } from "./bootstrap/state.mjs";

const usage = `pnpm bootstrap:status [--json]   Show this worktree's bootstrap status, URLs, and log path.
pnpm bootstrap:wait [--timeout <seconds>]   Wait until ready (default 300 seconds).
pnpm bootstrap:stop [--timeout <seconds>]   Stop this worktree's bootstrap and its services (default 30 seconds).

Status comes from the state file bootstrap writes in this worktree's Git directory.
A recorded PID whose process is gone or has a different start time is reported as stale.
Stopping a stale or failed run reclaims the services and Tailscale routes it recorded.`;

// A run that fails or stops while waiting is reported at once. A terminal state
// that predates "wait" may belong to an earlier run, so a bootstrap started just
// before it (for example "pnpm bootstrap --local &") gets time to claim the file.
export const newRunGraceMs = 10000;

const terminalStatuses = ["stopped", "failed", "stale", "absent"];

export function waitDecision({ current, initial, startedAt, now, timeoutMs, graceMs = newRunGraceMs }) {
  if (current.status === "ready") return "ready";
  if (terminalStatuses.includes(current.status)) {
    const changed = current.pid !== initial.pid || current.updatedAt !== initial.updatedAt || current.status !== initial.status;
    if (changed || now - startedAt >= Math.min(graceMs, timeoutMs)) return "failed";
  }
  return now - startedAt >= timeoutMs ? "timeout" : "pending";
}

function parseOptions(args) {
  const options = { json: false, timeout: undefined };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--json") options.json = true;
    else if (args[index] === "--timeout") {
      const value = Number(args[++index]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--timeout needs a positive number of seconds.");
      options.timeout = value;
    } else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

function describe(state, paths) {
  if (state.status === "absent") return `Bootstrap: not started in this worktree.\nState: ${paths.state}`;
  const recorded = state.status === "stale" ? ` (recorded ${state.recordedStatus}; pid ${state.pid} is no longer that bootstrap)` : ` (pid ${state.pid})`;
  const lines = [
    `Bootstrap: ${state.status}${recorded}`,
    `Worktree: ${state.worktreeId}  Mode: ${state.mode}  Polar: ${state.polar ? "on" : "off"}`,
    `App: ${state.urls.app}`, `Convex: ${state.urls.convex}`, `Site: ${state.urls.site}`,
  ];
  if (state.error) lines.push(`Error: ${state.error}`);
  if (state.proxyCleanupError) lines.push(state.proxyCleanupError, "Run pnpm bootstrap:stop to remove the routes it left behind.");
  lines.push(...describeForwarding(state.polarForwarding));
  if (state.status === "stale") lines.push("Run pnpm bootstrap:stop to reclaim the services and routes it recorded.");
  lines.push(`Log: ${state.log}`, `State: ${paths.state}`);
  return lines.join("\n");
}

function printFailure(state, paths) {
  console.error(describe(state, paths));
  const tail = state.log && logTail(state.log);
  if (tail) console.error(`\nLast log lines:\n${tail}`);
}

async function status(paths, options) {
  const state = readCurrentState(paths.state);
  console.log(options.json ? JSON.stringify({ ...state, statePath: paths.state }, null, 2) : describe(state, paths));
}

async function wait(paths, options) {
  const timeoutMs = (options.timeout ?? 300) * 1000;
  const startedAt = Date.now();
  const initial = readCurrentState(paths.state);
  for (;;) {
    const current = readCurrentState(paths.state);
    const decision = waitDecision({ current, initial, startedAt, now: Date.now(), timeoutMs });
    if (decision === "ready") {
      console.log(`Ready: ${current.urls.app}`);
      return;
    }
    if (decision !== "pending") {
      if (decision === "timeout") console.error(`Timed out after ${timeoutMs / 1000}s waiting for bootstrap to become ready.`);
      printFailure(current, paths);
      process.exitCode = 1;
      return;
    }
    await delay(500);
  }
}

async function waitForExit(state, deadline) {
  while (Date.now() < deadline) {
    if (processStart(state.pid) !== state.processStart) return true;
    await delay(100);
  }
  return processStart(state.pid) !== state.processStart;
}

async function waitForPorts(ports, deadline) {
  let occupied = await occupiedPorts(ports);
  while (occupied.length && Date.now() < deadline) {
    await delay(250);
    occupied = await occupiedPorts(ports);
  }
  return occupied;
}

// Signals only the recorded supervisor, after rechecking its PID and start time.
// Its own shutdown stops Convex, Next, Polar, and Tailscale routes it created. A
// run that ended without a verified shutdown is reclaimed from its state file.
async function stop(paths, options, root) {
  const timeoutMs = (options.timeout ?? 30) * 1000;
  const recorded = readState(paths.state);
  const state = inspectState(recorded);
  if (recorded && recorded.root !== root) throw new Error(`State file ${paths.state} belongs to ${recorded.root}; refusing to act on it.`);
  if (!liveStatuses.includes(state.status)) {
    if (reclaimableStatuses.includes(state.status)) {
      if (!(await reclaim(paths.state, recorded))) process.exitCode = 1;
    } else console.log(state.status === "absent" ? "Bootstrap is not running in this worktree." : `Bootstrap is not running (${state.status}).`);
    const occupied = state.ports ? await occupiedPorts(state.ports) : [];
    if (occupied.length) {
      console.error(`Ports still in use: ${occupied.join(", ")}. No verified bootstrap owns them, so nothing was signalled.`);
      process.exitCode = 1;
    }
    return;
  }
  let exited = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    if (!isVerifiedSupervisor(state)) {
      exited = true;
      break;
    }
    process.kill(state.pid, signal);
    console.log(`Sent ${signal} to bootstrap supervisor ${state.pid}; waiting for shutdown.`);
    if (await waitForExit(state, Date.now() + timeoutMs)) {
      exited = true;
      break;
    }
  }
  if (!exited) {
    console.error(`Bootstrap supervisor ${state.pid} did not exit after SIGINT and SIGTERM. Inspect ${state.log}; nothing else was signalled.`);
    process.exitCode = 1;
    return;
  }
  const occupied = await waitForPorts(state.ports, Date.now() + timeoutMs);
  const final = inspectState(readState(paths.state));
  if (final.status === "stopped" && !occupied.length) {
    console.log("Bootstrap stopped; this worktree's ports are free.");
    return;
  }
  if (final.status !== "stopped") printFailure(final, paths);
  if (occupied.length) console.error(`Ports still in use after shutdown: ${occupied.join(", ")}. They were not signalled.`);
  process.exitCode = 1;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help" || args.includes("--help")) {
    console.log(usage);
    return;
  }
  const commands = { status, wait, stop };
  if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command: ${command}`);
  const options = parseOptions(args);
  if (options.json && command !== "status") throw new Error("--json is only supported by status.");
  const root = gitRoot();
  await commands[command](bootstrapPaths(root), options, root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Bootstrap control: ${error.message}`);
    process.exitCode = 1;
  });
}
