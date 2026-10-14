import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { waitDecision } from "./bootstrap-control.mjs";
import { processStart } from "./bootstrap/processes.mjs";
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
