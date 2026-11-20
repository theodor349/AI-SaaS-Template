import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { userSystemdAvailable } from "./bootstrap/detach.mjs";
import { headroomProblem, headroomSkipReason, readMachine, waitForHeadroom } from "./bootstrap/headroom.mjs";
import { exitCodeFor, scopedLaunch, sigkillHint, userManagerUnit } from "./heavy-command.mjs";

const gib = 1024 ** 3;
const agentScope = "/user.slice/user-1000.slice/user@1000.service/app.slice/app-t3code.slice/t3code-claude-81c887b0.scope";

test("headroom needs a load at most twice the CPUs and 3 GB available", () => {
  assert.equal(headroomProblem({ load: 16, cpus: 8, availableBytes: 3 * gib }), undefined);
  assert.match(headroomProblem({ load: 16.5, cpus: 8, availableBytes: 11 * gib }), /^load 16.5 is above 16 \(twice the 8 CPUs\)$/);
  assert.match(headroomProblem({ load: 1, cpus: 8, availableBytes: 2.5 * gib }), /^2.5 GB of memory is available, under 3.0 GB$/);
  assert.match(headroomProblem({ load: 20, cpus: 8, availableBytes: gib }), /load 20.0 .* and 1.0 GB/);
  // Without a memory reading, as off Linux, only the load counts.
  assert.equal(headroomProblem({ load: 1, cpus: 8 }), undefined);
});

test("memory comes from MemAvailable on Linux only", () => {
  const meminfo = () => "MemTotal:       15000000 kB\nMemAvailable:    2000000 kB\n";
  assert.equal(readMachine({ platform: "linux", meminfo }).availableBytes, 2_000_000 * 1024);
  assert.equal(readMachine({ platform: "darwin", meminfo }).availableBytes, undefined);
});

test("CI and SKIP_HEADROOM_CHECK skip the wait", () => {
  assert.equal(headroomSkipReason({ CI: "true" }), "CI is set");
  assert.equal(headroomSkipReason({ SKIP_HEADROOM_CHECK: "1" }), "SKIP_HEADROOM_CHECK is set");
  assert.equal(headroomSkipReason({ CI: "false", SKIP_HEADROOM_CHECK: "0" }), undefined);
});

// A clock that advances only when the wait sleeps.
function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms) => { now += ms; } };
}

test("a busy machine is waited out, with a line when waiting starts and each minute after", async () => {
  const readings = [{ load: 30, cpus: 8 }, { load: 30, cpus: 8 }, { load: 30, cpus: 8 }, { load: 30, cpus: 8 }, { load: 30, cpus: 8 }, { load: 4, cpus: 8 }];
  const waits = [];
  const time = clock();
  await waitForHeadroom({ label: "Test", env: {}, read: () => readings.shift(), onWait: (problem, times) => waits.push({ problem, times }), ...time });
  assert.equal(time.now(), 75_000);
  assert.equal(waits.length, 2);
  assert.match(waits[0].problem, /load 30.0/);
  assert.deepEqual(waits[0].times, { since: new Date(0).toISOString(), giveUpAt: new Date(15 * 60_000).toISOString() });
});

test("after 15 minutes without headroom the wait fails with the load and memory", async () => {
  await assert.rejects(
    waitForHeadroom({ label: "pnpm test:e2e", env: {}, read: () => ({ load: 30, cpus: 8, availableBytes: gib }), ...clock() }),
    /pnpm test:e2e gave up after 15 minutes without machine headroom: load 30.0 is above 16 \(twice the 8 CPUs\) and 1.0 GB of memory is available/,
  );
  const read = () => { throw new Error("CI never reads the machine"); };
  await waitForHeadroom({ label: "Test", env: { CI: "1" }, read });
});

test("the caller's unit is found only inside this user's manager", () => {
  assert.equal(userManagerUnit(`0::${agentScope}\n`, 1000), "t3code-claude-81c887b0.scope");
  assert.equal(userManagerUnit("0::/user.slice/user-1000.slice/session-3.scope\n", 1000), undefined);
  assert.equal(userManagerUnit("0::/user.slice/user-1000.slice/user@1000.service/app.slice\n", 1000), undefined);
});

test("heavy commands get their own scope on Linux with a user manager, bound to the caller's unit", () => {
  const base = { name: "test:e2e", command: "playwright", args: ["test"], platform: "linux", systemdAvailable: () => true, now: 36 ** 3 };
  const launch = scopedLaunch({ ...base, env: {}, cgroup: () => `0::${agentScope}\n` });
  assert.equal(launch.unit, "test-e2e-1000.scope");
  assert.deepEqual(launch.args, [
    "--user", "--scope", "--quiet", "--collect", "--unit=test-e2e-1000.scope",
    "--property", "BindsTo=t3code-claude-81c887b0.scope", "--property", "After=t3code-claude-81c887b0.scope",
    "--", "playwright", "test",
  ]);
  // Elsewhere the command runs as it is.
  for (const options of [{ env: { CI: "true" } }, { env: {}, platform: "darwin" }, { env: {}, systemdAvailable: () => false }]) {
    assert.deepEqual(scopedLaunch({ ...base, cgroup: () => `0::${agentScope}\n`, ...options }), { command: "playwright", args: ["test"] });
  }
});

test("a SIGKILL points at memory pressure, and signals become shell exit codes", () => {
  assert.match(sigkillHint("pnpm test:e2e", "test-e2e-1000.scope"), /Memory pressure is the likely cause.*journalctl -t systemd-oomd -g test-e2e-1000\.scope/);
  assert.equal(exitCodeFor({ code: 3, signal: null }), 3);
  assert.equal(exitCodeFor({ code: null, signal: "SIGKILL" }), 137);
  assert.equal(exitCodeFor({ code: null, signal: "SIGTERM" }), 143);
});

const wrapper = fileURLToPath(new URL("./heavy-command.mjs", import.meta.url));
const run = async (args, env = {}) => {
  const child = spawn(process.execPath, [wrapper, "--no-headroom", ...args], {
    env: { ...process.env, CI: "", npm_lifecycle_event: "heavy-test", ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "close");
  return { code, output };
};

test("the wrapped command's output and exit code pass through, in its own scope where systemd allows", async () => {
  const printCgroup = "console.log(require('node:fs').readFileSync('/proc/self/cgroup', 'utf8').trim()); process.exit(3)";
  const { code, output } = await run([process.execPath, "-e", printCgroup]);
  assert.equal(code, 3, output);
  if (process.platform === "linux" && userSystemdAvailable()) {
    assert.match(output, /\/heavy-test-[0-9a-z]+\.scope$/m);
    assert.notEqual(output.trim(), readFileSync("/proc/self/cgroup", "utf8").trim());
  }
});

test("a command killed with SIGKILL exits 137 with the memory pressure hint", async () => {
  const { code, output } = await run([process.execPath, "-e", "process.kill(process.pid, 'SIGKILL')"]);
  assert.equal(code, 137);
  assert.match(output, /pnpm heavy-test was killed with SIGKILL\. Memory pressure is the likely cause/);
});

test("SIGTERM to the wrapper alone stops the command", { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [wrapper, "--no-headroom", process.execPath, "-e", "console.log('started'); setInterval(() => {}, 1000)"], {
    env: { ...process.env, CI: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  await once(child.stdout, "data");
  child.kill("SIGTERM");
  const [code] = await once(child, "close");
  assert.equal(code, 143);
});
