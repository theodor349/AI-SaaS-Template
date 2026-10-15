import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { waitDecision } from "./bootstrap-control.mjs";
import { groupMembers, processStart } from "./bootstrap/processes.mjs";
import { reclaim, reclaimStaleRun } from "./bootstrap/reclaim.mjs";
import { createStateRecorder, inspectState, isVerifiedSupervisor, readState, writeState } from "./bootstrap/state.mjs";
import { resetTargets } from "./db-reset.mjs";

const temporary = (t, name) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), name)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test("a live status is trusted only while the PID keeps its recorded start time", () => {
  const state = { version: 1, pid: 4242, processStart: "Tue Oct 13 10:00:00 2026", status: "ready" };
  assert.equal(inspectState(state, () => state.processStart).status, "ready");
  assert.deepEqual(inspectState(state, () => null), { ...state, status: "stale", recordedStatus: "ready" });
  assert.equal(inspectState(state, () => "Tue Oct 13 11:00:00 2026").status, "stale");
  assert.equal(inspectState({ ...state, status: "failed" }, () => null).status, "failed");
  assert.equal(inspectState(null).status, "absent");
  assert.equal(isVerifiedSupervisor(state, () => state.processStart), true);
  assert.equal(isVerifiedSupervisor(state, () => "Tue Oct 13 11:00:00 2026"), false);
  assert.equal(isVerifiedSupervisor({ ...state, pid: process.pid }, () => state.processStart), false);
  assert.equal(isVerifiedSupervisor({ ...state, pid: 1 }, () => state.processStart), false);
});

test("the state file is private, versioned, and never overwritten by another run", (t) => {
  const file = join(temporary(t, "bootstrap state "), "bootstrap-state.json");
  writeState(file, { version: 1, pid: 1234, status: "stopped" });
  const recorder = createStateRecorder(file, { worktreeId: "wt-example" });
  recorder.update({ status: "starting" });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const claimed = readState(file);
  assert.equal(claimed.pid, process.pid);
  assert.equal(claimed.processStart, processStart(process.pid));
  assert.equal(inspectState(claimed).status, "starting");
  recorder.update({ status: "failed", error: "Example failure." });
  assert.equal(readState(file).error, "Example failure.");
  writeState(file, { ...readState(file), pid: 1234, status: "starting" });
  recorder.update({ status: "stopped" });
  assert.equal(readState(file).pid, 1234);
  writeFileSync(file, JSON.stringify({ version: 2 }));
  assert.throws(() => readState(file), /Unsupported/);
});

test("wait reports this run's result at once but gives a just-launched run time to claim the state", () => {
  const startedAt = 1000;
  const old = { status: "stopped", pid: 1, updatedAt: "old" };
  const decide = (current, now, initial = old) => waitDecision({ current, initial, startedAt, now, timeoutMs: 300000, graceMs: 10000 });
  assert.equal(decide({ status: "ready" }, 1000), "ready");
  assert.equal(decide(old, 2000), "pending");
  assert.equal(decide(old, 11000), "failed");
  assert.equal(decide({ status: "absent" }, 2000, { status: "absent" }), "pending");
  assert.equal(decide({ status: "starting", pid: 2 }, 2000), "pending");
  assert.equal(decide({ status: "failed", pid: 2, updatedAt: "new" }, 2000), "failed");
  assert.equal(decide({ status: "stale", pid: 2, updatedAt: "new" }, 2000, { status: "starting", pid: 2, updatedAt: "new" }), "failed");
  assert.equal(decide({ status: "starting", pid: 2 }, 301000), "timeout");
});

test("db:reset removes database files and the watch env but keeps the deployment identity", (t) => {
  const root = temporary(t, "db reset ");
  const outside = temporary(t, "db reset outside ");
  const deployment = join(root, ".convex/local/default");
  mkdirSync(join(deployment, "convex_local_storage/files"), { recursive: true });
  for (const file of ["config.json", "convex_local_backend.sqlite3", "convex_local_backend.sqlite3-wal"]) writeFileSync(join(deployment, file), "data");
  writeFileSync(join(root, ".env.convex-watch.local"), "CONVEX_SELF_HOSTED_ADMIN_KEY=example\n");
  symlinkSync(outside, join(deployment, "linked"));
  assert.deepEqual(resetTargets(root).map(target => target.slice(root.length + 1)).sort(), [
    ".convex/local/default/convex_local_backend.sqlite3",
    ".convex/local/default/convex_local_backend.sqlite3-wal",
    ".convex/local/default/convex_local_storage",
    ".convex/local/default/linked",
    ".env.convex-watch.local",
  ]);
  assert.equal(readFileSync(join(deployment, "config.json"), "utf8"), "data");
  const linkedRoot = temporary(t, "db reset linked ");
  symlinkSync(join(root, ".convex"), join(linkedRoot, ".convex"));
  assert.throws(() => resetTargets(linkedRoot), /not a directory/);
});

test("reclaiming a stale run signals only groups that still contain a recorded member", async () => {
  // pid ppid pgid: group 200 is intact, 300's member restarted, 400's member moved, 500 is gone.
  const table = "201 1 200\n202 201 200\n301 1 300\n401 1 999\n";
  const starts = { 201: "start 201", 202: "start 202", 301: "restarted", 401: "start 401" };
  const services = [200, 300, 400, 500].map((pgid) => ({ pgid, members: [{ pid: pgid + 1, start: `start ${pgid + 1}` }] }));
  const live = new Set([200, 300, 999]);
  const signals = [];
  const signal = (group, name) => {
    if (name === 0) return live.has(group);
    signals.push([group, name]);
    if (name === "SIGTERM" || name === "SIGKILL") live.delete(group);
    return true;
  };
  const routes = [{ port: 51000, target: "http://127.0.0.1:20000" }];
  const result = await reclaimStaleRun({ services, tailscale: { hostname: "agent.example.ts.net", createdRoutes: routes } }, {
    table: async () => table, startOf: (pid) => starts[pid] ?? null, signal, graceMs: 100,
    removeRoutes: async (hostname, created) => ({ removed: created, kept: [] }),
  });
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(result, { stopped: [200], survivors: [], routes: { removed: routes, kept: [] } });
  assert.deepEqual(groupMembers([200, 300], table, (pid) => starts[pid] ?? null), [
    { pgid: 200, members: [{ pid: 201, start: "start 201" }, { pid: 202, start: "start 202" }] },
    { pgid: 300, members: [{ pid: 301, start: "restarted" }] },
  ]);
});

test("a reclaimed run is marked stopped only when nothing it owned remains", async (t) => {
  const file = join(temporary(t, "bootstrap reclaim "), "bootstrap-state.json");
  const recorded = { version: 1, pid: 4242, processStart: "gone", status: "ready", services: [{ pgid: 600, members: [{ pid: 601, start: "s" }] }] };
  const quiet = { log: () => {}, warn: () => {}, table: async () => "601 1 600\n", startOf: () => "s", graceMs: 50 };
  writeState(file, recorded);
  assert.equal(await reclaim(file, recorded, { ...quiet, signal: (group, name) => name !== 0 }), true);
  assert.equal(readState(file).status, "stopped");
  writeState(file, recorded);
  assert.equal(await reclaim(file, recorded, { ...quiet, signal: () => true }), false);
  assert.equal(readState(file).status, "ready");
});
