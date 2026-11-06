import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";

// Stops the stack once the backend process has exited, or once a running backend
// has failed every health check for unavailableMs. The Convex CLI neither restarts
// nor exits with its backend, so a refused connection is the sign of an exit. A
// loaded machine or a large import can keep a live backend from answering for a
// long time, and a full listen queue makes connections time out, not get refused.
export async function superviseConvex(url, controller, { unavailableMs = 60_000, timeoutMs = 5000 } = {}) {
  const { signal } = controller;
  let unavailableSince;
  while (!signal.aborted) {
    const checkedAt = Date.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      unavailableSince = undefined;
    } catch (error) {
      if (signal.aborted) return;
      if (error.cause?.code === "ECONNREFUSED") {
        controller.abort(new Error(`Convex backend is unavailable at ${url}: nothing is listening, so its process has exited.`, { cause: error }));
        return;
      }
      unavailableSince ??= checkedAt;
      if (Date.now() - unavailableSince >= unavailableMs) {
        controller.abort(new Error(`Convex backend is unavailable at ${url}: ${error.message}`, { cause: error }));
        return;
      }
    }
    await delay(1000, undefined, { signal }).catch(() => {});
  }
}

export async function superviseNext(url, controller) {
  const { hostname, port } = new URL(url);
  const { signal } = controller;
  let unavailableSince;
  while (!signal.aborted) {
    try {
      // Check the listener, so compilation errors and slow pages do not stop development.
      await new Promise((resolveConnection, reject) => {
        const socket = createConnection({ host: hostname, port: Number(port), signal });
        socket.setTimeout(2000, () => socket.destroy(new Error("Connection timed out.")));
        socket.once("error", reject);
        socket.once("connect", () => { socket.destroy(); resolveConnection(); });
      });
      unavailableSince = undefined;
    } catch {
      if (signal.aborted) return;
      unavailableSince ??= Date.now();
      // Next briefly closes its listener when restarting after config changes.
      if (Date.now() - unavailableSince >= 5000) {
        controller.abort(new Error(`Next server is unavailable at ${url}.`));
        return;
      }
    }
    await delay(1000, undefined, { signal }).catch(() => {});
  }
}

// convex dev retries a push that failed on the network, but after a typecheck,
// bundling, or deployment error it waits for a file change, so the app never
// starts. Pass its output to write() until the app is ready. A failure line
// (✖ from the CLI, ✘ [ERROR] from esbuild) that no retry or new push follows
// within quietMs stops the stack; the error names that line, and the CLI's
// output above it in the log has the details. A spinner line such as
// "- Collecting TypeScript errors" means the CLI is still printing them.
export function watchConvexPush(controller, { quietMs = 2000 } = {}) {
  let partial = "";
  let lastLine = "";
  let failure;
  let timer;
  let stopped = false;
  const report = () => controller.abort(new Error(
    `convex dev could not push the Convex functions: ${failure} Fix the error shown in its output and start bootstrap again.`,
  ));
  return {
    write(chunk) {
      if (stopped) return;
      const lines = (partial + stripVTControlCharacters(chunk)).split("\n");
      partial = lines.pop();
      for (const line of lines.map((text) => text.trim())) {
        if (/retrying|Preparing Convex functions|Convex functions ready/.test(line)) failure = undefined;
        else if (!failure && /^(✖|✘ \[ERROR\])/.test(line)) failure = line.replace(/^(✖|✘ \[ERROR\])\s*/, "");
        if (line) lastLine = line;
      }
      clearTimeout(timer);
      if (failure && !lastLine.startsWith("- ")) timer = setTimeout(report, quietMs);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

// Stops the stack once any of paths is gone, such as when T3 Code removes the
// worktree. A detached bootstrap has no terminal to close, so this keeps it from
// outliving its worktree.
export async function superviseWorktree(paths, controller, { intervalMs = 2000 } = {}) {
  const { signal } = controller;
  while (!signal.aborted) {
    const missing = paths.find((path) => !existsSync(path));
    if (missing) {
      controller.abort(new Error(`Stopped because the worktree was removed (${missing} is missing).`));
      return;
    }
    await delay(intervalMs, undefined, { signal }).catch(() => {});
  }
}

// Rows of `ps -eo pid=,ppid=,pgid=` as [pid, ppid, pgid].
export function processRows(processTable) {
  return processTable.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
}

export function descendantProcessGroups(pids, processTable) {
  const rows = processRows(processTable);
  const descendants = new Set(pids);
  let previousSize;
  do {
    previousSize = descendants.size;
    for (const [pid, parent] of rows) {
      if (descendants.has(parent)) descendants.add(pid);
    }
  } while (descendants.size !== previousSize);
  return [...new Set([...pids, ...rows.filter(([pid]) => descendants.has(pid)).map(([, , group]) => group)])]
    .filter((group) => Number.isInteger(group) && group > 1);
}

// macOS returns EPERM for a group whose members are all zombies (Z) or exiting (E),
// e.g. a backend flushing its database after its CLI leader already exited.
export function darwinGroupMembers(group, processTable) {
  const states = processTable.trim().split("\n").map((row) => row.trim().split(/\s+/))
    .filter(([id, state]) => Number(id) === group && state).map(([, state]) => state);
  return {
    live: states.some((state) => !/[ZE]/.test(state)),
    exiting: states.some((state) => state.includes("E")),
  };
}

export function signalProcessGroup(group, signal) {
  if (!Number.isInteger(group) || group <= 1) throw new Error(`Invalid process group ${group}.`);
  try {
    process.kill(-group, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (process.platform === "darwin" && error.code === "EPERM") {
      const { live, exiting } = darwinGroupMembers(group, execFileSync("ps", ["-eo", "pgid=,stat="], { encoding: "utf8" }));
      // Exiting members need no signal but still count as running until they finish.
      if (!live) return signal === 0 && exiting;
    }
    throw error;
  }
}

// Start time distinguishes a live process from a later one that reused its PID.
export function processStart(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const start = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return start || null;
  } catch {
    return null;
  }
}

// Records each group's members with their start times, so a later command can
// tell these groups apart from new ones after their IDs are reused.
export function groupMembers(groups, processTable, startOf = processStart) {
  const rows = processRows(processTable);
  return groups.map((pgid) => ({
    pgid,
    members: rows.filter(([, , group]) => group === pgid).map(([pid]) => ({ pid, start: startOf(pid) })).filter(({ start }) => start),
  })).filter(({ members }) => members.length);
}

export async function processTable() {
  try { return execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" }); }
  catch (error) {
    // A terminal Ctrl+C can also interrupt the process inspection started during cleanup.
    if (!["SIGINT", "SIGTERM"].includes(error.signal)) throw error;
    await delay(50);
    return execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" });
  }
}

function writeIfOpen(stream, text) {
  if (stream && !stream.destroyed && stream.writable) stream.write(text);
}

// Replaces the values of secret-looking environment variables, which env may
// gain after a service starts, such as POLAR_WEBHOOK_SECRET.
export function redactSecrets(text, env) {
  return Object.entries(env)
    .filter(([key, value]) => /SECRET|TOKEN|KEY/.test(key) && typeof value === "string" && value.length >= 8)
    .reduce((result, [, value]) => result.replaceAll(value, "[redacted]"), text);
}

// Describes a service exit for the log: its exit code or signal and the last
// lines it wrote to stderr.
export function exitReason({ code, signal, error, errors = "" }) {
  const how = error ? `could not start: ${error.message}` : signal ? `signal ${signal}` : `exit ${code}`;
  const lastLines = stripVTControlCharacters(errors).split("\n").map((line) => line.trim()).filter(Boolean).slice(-2).join(" ");
  return lastLines ? `${how}: ${lastLines}` : how;
}

// Runs every service in its own process group so shutdown can reach detached
// grandchildren. A persistent service exiting aborts the whole stack, unless it
// was started with keep().
export function createSupervisor({ root, env, controller, log }) {
  const children = [];
  const supervision = [];
  let serviceGroups = [];
  let stopping = false;

  function start(command, args, { persistent = false, restarts = false, capture = false, terminal = true, onOutput } = {}) {
    controller.signal.throwIfAborted();
    // Polar prints its signing secret during startup. Capture only --print-secret
    // and discard its other stdout. Keep the end of its stderr, with secrets
    // redacted, so exitReason() can say why it stopped.
    const quiet = basename(command) === "polar";
    const child = spawn(command, args, {
      cwd: root, env, detached: true,
      stdio: ["ignore", quiet && !capture ? "ignore" : "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    if (capture) child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    if (quiet) child.stderr.setEncoding("utf8").on("data", (chunk) => { errors = (errors + chunk).slice(-4000); });
    if (!quiet) {
      // Tee to the terminal and the worktree log; keep logs free of colour codes.
      const streams = [...capture ? [] : [[child.stdout, process.stdout]], [child.stderr, process.stderr]];
      for (const [source, destination] of streams) {
        source.setEncoding("utf8").on("data", (chunk) => {
          if (terminal) writeIfOpen(destination, chunk);
          else output += chunk;
          writeIfOpen(log, stripVTControlCharacters(chunk));
          onOutput?.(chunk);
        });
      }
    }
    // A process that escaped its group can keep inherited pipes open after the
    // child exits; release them so shutdown and process exit do not wait on it.
    child.once("exit", () => setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, 2000).unref());
    const done = new Promise((resolveChild) => {
      // The CLI's update notice says nothing about why it stopped.
      const redacted = () => redactSecrets(errors, env).replace(/^.*(Update available|Run polar update).*$/gm, "");
      child.once("error", (error) => resolveChild({ error, output, errors: redacted() }));
      child.once("close", (code, signal) => resolveChild({ code, signal, output, errors: redacted() }));
    });
    children.push({ child, done, persistent });
    if (persistent && !restarts) {
      void done.then(() => {
        if (!stopping) controller.abort(new Error(`${basename(command)} ${args.slice(0, 2).join(" ")} exited unexpectedly.`));
      });
    }
    return done;
  }

  async function run(args, { command = "pnpm", ...options } = {}) {
    const result = await start(command, args, options);
    controller.signal.throwIfAborted();
    if (result.error || result.code !== 0) {
      if (options.terminal === false) writeIfOpen(process.stderr, result.output);
      const name = command === "pnpm" ? "pnpm" : basename(command);
      throw new Error(`${name} ${args.slice(0, 3).join(" ")} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.code})`}.`);
    }
    return result.output;
  }

  // Keeps a service running, restarting it after each exit instead of stopping
  // the stack. The delay before a restart grows with each exit that comes less
  // than stableMs after its start. onExit(exit, delayMs) runs before the delay
  // and onRestart() after the next start; an error from either stops the stack.
  // Shutdown ends the loop.
  async function keep(command, args, { onExit, onRestart, delaysMs = [1000, 5000, 15000, 30000], stableMs = 60_000, ...options } = {}) {
    let quickExits = 0;
    try {
      for (let restart = false; ; restart = true) {
        const startedAt = Date.now();
        const done = start(command, args, { ...options, persistent: true, restarts: true });
        if (restart) await onRestart?.();
        const exit = await done;
        if (stopping || controller.signal.aborted) return;
        // An exited group is no longer ours to signal, and its ID may be reused.
        const [{ child }] = children.splice(children.findIndex((entry) => entry.done === done), 1);
        serviceGroups = serviceGroups.filter((group) => group !== child.pid);
        quickExits = Date.now() - startedAt < stableMs ? quickExits + 1 : 1;
        const delayMs = delaysMs[Math.min(quickExits, delaysMs.length) - 1];
        await onExit?.(exit, delayMs);
        await delay(delayMs, undefined, { signal: controller.signal }).catch(() => {});
        if (stopping || controller.signal.aborted) return;
      }
    } catch (error) {
      if (!stopping && !controller.signal.aborted) controller.abort(error);
    }
  }

  return {
    start,
    run,
    keep,
    supervise(task) { supervision.push(task); },
    // Record groups while services are healthy; a crashed parent hides its descendants later.
    // Returns them with their members for the state file, which outlives a killed supervisor.
    async recordServiceGroups() {
      const table = await processTable();
      serviceGroups = descendantProcessGroups(children.filter(({ persistent }) => persistent).map(({ child }) => child.pid), table);
      return groupMembers(serviceGroups, table);
    },
    async stop() {
      stopping = true;
      controller.abort(new Error("Bootstrap stopped."));
      await Promise.all(supervision);
      const pids = children.filter(({ child, persistent }) => child.pid && (persistent || (child.exitCode === null && child.signalCode === null)))
        .map(({ child }) => child.pid);
      const groups = [...new Set([...serviceGroups, ...descendantProcessGroups(pids, await processTable())])];
      const running = (group) => signalProcessGroup(group, 0);
      for (const group of groups) signalProcessGroup(group, "SIGTERM");
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && groups.some(running)) await delay(50);
      for (const group of groups) if (running(group)) signalProcessGroup(group, "SIGKILL");
      await Promise.all(children.map(({ done }) => done));
    },
  };
}
