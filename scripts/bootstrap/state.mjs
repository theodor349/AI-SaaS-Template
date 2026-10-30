import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, createWriteStream, fchmodSync, fstatSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { processStart } from "./processes.mjs";

// The state file is the ownership record for a running bootstrap. It lives in
// this worktree's Git admin directory, so it is per worktree and never tracked.
export const liveStatuses = ["starting", "ready", "stopping"];
// Runs that ended without a verified shutdown, so their record may name leftovers.
export const reclaimableStatuses = ["stale", "failed"];

export function bootstrapPaths(root) {
  const gitPath = (name) => execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-path", name], { cwd: root, encoding: "utf8" }).trim();
  return { state: gitPath("bootstrap-state.json"), log: gitPath("bootstrap.log") };
}

export function writeState(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export function readState(file) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let state;
  try { state = JSON.parse(text); }
  catch { throw new Error(`Bootstrap state file ${file} is unreadable. Remove it once no bootstrap is running in this worktree.`); }
  if (state.version !== 1) throw new Error(`Unsupported bootstrap state version in ${file}.`);
  return state;
}

// A live status is trusted only while the recorded PID still has the recorded start time.
export function inspectState(state, startOf = processStart) {
  if (!state) return { status: "absent" };
  if (liveStatuses.includes(state.status) && startOf(state.pid) !== state.processStart) {
    return { ...state, status: "stale", recordedStatus: state.status };
  }
  return state;
}

// A run can record its final status and exit between reading the file and
// checking its PID, so a stale result is checked again against a fresh read.
export function readCurrentState(file, startOf = processStart) {
  const current = inspectState(readState(file), startOf);
  return current.status === "stale" ? inspectState(readState(file), startOf) : current;
}

export function isVerifiedSupervisor(state, startOf = processStart) {
  return Number.isInteger(state?.pid) && state.pid > 1 && state.pid !== process.pid &&
    Boolean(state.processStart) && startOf(state.pid) === state.processStart;
}

// Records this process's lifecycle. Later writes never replace another run's state.
export function createStateRecorder(file, initial) {
  let state = { version: 1, pid: process.pid, processStart: processStart(process.pid), ...initial };
  let claimed = false;
  return {
    get current() { return state; },
    // The first update claims the file; callers check for a live owner before that.
    update(changes) {
      state = { ...state, ...changes, updatedAt: new Date().toISOString() };
      if (!state.error) delete state.error;
      if (!claimed) {
        writeState(file, state);
        claimed = true;
        return;
      }
      try {
        if (readState(file)?.pid === process.pid) writeState(file, state);
      } catch (error) {
        // Losing a status update must not interrupt service shutdown.
        console.error(`Bootstrap state update failed: ${error.message}`);
      }
    },
  };
}

// Explains a gap in Polar webhook forwarding, for the log and pnpm bootstrap:status.
export function missedWebhooks({ from, to }) {
  return `Webhooks Polar sent from ${from} to ${to} were not forwarded, and Polar does not resend them. ` +
    "A signed-in user's billing reconciles with Polar through api.billing.polar.recover.";
}

// Status lines for the polarForwarding state that bootstrap records after polar listen first exits.
export function describeForwarding(forwarding) {
  if (!forwarding) return [];
  const lines = [];
  if (forwarding.status === "restarting") lines.push(`Polar forwarding: down since ${forwarding.since} (${forwarding.reason}); restarting.`);
  const last = forwarding.missed.at(-1);
  if (last) {
    const times = forwarding.restarts === 1 ? "once" : `${forwarding.restarts} times`;
    lines.push(`Polar forwarding: restarted ${times}, last after ${last.reason}. ${missedWebhooks(last)}`);
  }
  return lines;
}

export function openLog(file) {
  // Truncate at each start; an existing log may have been created with a wider mode.
  const descriptor = openSync(file, "w", 0o600);
  fchmodSync(descriptor, 0o600);
  return createWriteStream(file, { fd: descriptor });
}

export function logTail(file, lines = 40) {
  let descriptor;
  try { descriptor = openSync(file, "r"); }
  catch { return ""; }
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, 64 * 1024);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString("utf8").split("\n").slice(-lines - 1).join("\n").trimEnd();
  } finally {
    closeSync(descriptor);
  }
}
