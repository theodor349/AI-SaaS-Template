import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, realpathSync, statSync } from "node:fs";
import { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertPortsAvailable, descendantProcessGroups, environmentFile, signalProcessGroup, worktreeConfig } from "./bootstrap.mjs";
import { reclaimStaleRun } from "./bootstrap/reclaim.mjs";
import { readState } from "./bootstrap/state.mjs";

const realPs = execFileSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const processTable = () => execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" });

// Prepares a fresh repository, or a linked worktree of one, where the real
// bootstrap runs against stand-in pnpm and ps commands.
async function prepareFixture(t, { linked = false, typecheckError = false, tailscale = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), "bootstrap lifecycle with spaces "));
  let fixture = base;
  if (linked) {
    const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args]);
    git("init", "--quiet", join(base, "main"));
    git("-C", join(base, "main"), "commit", "--quiet", "--allow-empty", "-m", "Initial commit");
    fixture = join(base, "worktree");
    git("-C", join(base, "main"), "worktree", "add", "--quiet", "--detach", fixture);
  } else execFileSync("git", ["init", "--quiet", fixture]);
  const root = realpathSync(execFileSync("git", ["-C", fixture, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const config = worktreeConfig(root);
  await assertPortsAvailable(config.ports);
  await mkdir(join(fixture, "bin"));
  if (typecheckError) await writeFile(join(fixture, "typecheck-error"), "yes");
  for (const name of ["bootstrap.mjs", "bootstrap-output-guard.mjs", "bootstrap-control.mjs", "doctor.mjs"]) await copyFile(script(`./${name}`), join(fixture, name));
  await cp(script("./bootstrap"), join(fixture, "bootstrap"), { recursive: true });
  // Bootstrap reads the billing switch from the checkout it runs in. These runs sell plans.
  await writeFile(join(fixture, "app.config.ts"), "export const appConfig = {\n  billing: true,\n};\n");
  // A previous run's derived issuer must not block a different app's key override.
  await writeFile(join(fixture, ".env.local"), environmentFile({
    ...config.env,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("previous.clerk.accounts.dev$").toString("base64")}`,
    CLERK_SECRET_KEY: "sk_test_previous",
    CLERK_JWT_ISSUER_DOMAIN: "https://previous.clerk.accounts.dev",
  }), { mode: 0o600 });
  await writeFile(join(fixture, ".env.bootstrap.local"), [
    `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`,
    "CLERK_SECRET_KEY=sk_test_example", "POLAR_ACCESS_TOKEN=polar_oat_example",
    "POLAR_PRODUCT_MONTHLY=monthly", "POLAR_PRODUCT_YEARLY=yearly", "POLAR_PRODUCT_LIFETIME=lifetime",
  ].join("\n"), { mode: 0o600 });
  // Stand-ins preserve the failure shape: both wrapping CLIs survive Next's exit.
  await writeFile(join(fixture, "bin/pnpm"), `#!/usr/bin/env node
    const { spawn } = require("node:child_process");
    const { mkdirSync, writeFileSync } = require("node:fs");
    const { createServer } = require("node:http");
    const { basename } = require("node:path");
    const args = process.argv.slice(2);
    if (args[0] === "install") { console.log("Already up to date"); writeFileSync("installed", args.join(" ")); }
    else if (args.includes("--print-secret")) { console.log("whsec_example"); console.error("whsec_example"); }
    else if (args.includes("billing/polar:syncCatalog")) {
      if (!require("node:fs").existsSync(args[args.indexOf("--env-file") + 1])) process.exit(9);
      fetch(process.env.APP_URL).then(response => {
        if (!response.ok) process.exit(1);
        writeFileSync("catalog-synced", "ready");
      }).catch(() => process.exit(1));
    }
    else if (args.includes("set")) writeFileSync(".convex/local/default/env-set", "yes");
    else if (basename(process.argv[1]) === "polar") {
      console.log("Signing secret: whsec_example");
      console.error("Signing secret: whsec_example");
      writeFileSync("polar.pid", String(process.pid));
      setInterval(() => {}, 1000);
    } else if (args.includes("--until-success")) {
      console.log("Convex stand-in started");
      mkdirSync(".convex/local/default", { recursive: true });
      writeFileSync(".convex/local/default/config.json", JSON.stringify({ deploymentName: "anonymous-agent", adminKey: "example" }));
      createServer((req, res) => res.end("version")).listen(Number(process.env.PORT) + 1, "127.0.0.1");
      createServer((req, res) => res.writeHead(404).end()).listen(Number(process.env.PORT) + 2, "127.0.0.1");
      // The first push beats a later env upload, and the CLI may never retry it.
      if (!require("node:fs").existsSync(".convex/local/default/env-set")) console.error("CLERK_JWT_ISSUER_DOMAIN was not set.");
      // The real CLI keeps watching for a file change after a failed typecheck,
      // and prints the errors from a second tsc run.
      else if (require("node:fs").existsSync("typecheck-error")) {
        console.error(${JSON.stringify("✖ TypeScript typecheck via `tsc` failed.\n- Collecting TypeScript errors\n")});
        setTimeout(() => console.log(${JSON.stringify("convex/notes/notes.test.ts:42:55 - error TS2339: Property 'removedList' does not exist.\n\nFound 1 error.")}), 500);
      }
      else if (args[args.indexOf("--start") + 1].includes("next dev")) setTimeout(() => {
        const listener = spawn(process.execPath, ["-e", 'require("node:http").createServer((req, res) => res.end("app")).listen(Number(process.env.PORT), "127.0.0.1")'], { detached: true, stdio: "ignore" });
        writeFileSync("next.pid", String(listener.pid));
        writeFileSync("convex.pid", String(process.pid));
      }, 500);
    }
  `, { mode: 0o700 });
  // Bootstrap runs project CLIs from node_modules/.bin, so one stand-in serves pnpm, Convex, and Polar.
  await mkdir(join(fixture, "node_modules/.bin"), { recursive: true });
  for (const name of ["convex", "polar"]) await copyFile(join(fixture, "bin/pnpm"), join(fixture, "node_modules/.bin", name));
  // A Ctrl+C can interrupt ps itself during cleanup; retry before signalling descendants.
  await writeFile(join(fixture, "bin/ps"), `#!/usr/bin/env node
    const { existsSync, writeFileSync } = require("node:fs");
    const { execFileSync } = require("node:child_process");
    // Startup also records groups; interrupt only the inspection after the app is ready.
    const table = process.argv.includes("pid=,ppid=,pgid=") && existsSync("catalog-synced");
    if (table && existsSync("inspect-started") && !existsSync("inspect-interrupted")) {
      writeFileSync("inspect-interrupted", "yes");
      process.kill(process.pid, "SIGINT");
    } else {
      if (table) writeFileSync("inspect-started", "yes");
      process.stdout.write(execFileSync(${JSON.stringify(realPs)}, process.argv.slice(2)));
    }
  `, { mode: 0o700 });
  // Keeps its serve config in a file, and fails to remove a route while tailscale-off-fails exists.
  if (tailscale) await writeFile(join(fixture, "bin/tailscale"), `#!/usr/bin/env node
    const { existsSync, readFileSync, writeFileSync } = require("node:fs");
    const args = process.argv.slice(2);
    const serve = existsSync("tailscale-serve.json") ? JSON.parse(readFileSync("tailscale-serve.json", "utf8")) : { TCP: {}, Web: {} };
    const hostname = "agent.example.ts.net";
    if (args[0] === "status") console.log(JSON.stringify({ BackendState: "Running", Self: { DNSName: hostname + "." }, CertDomains: [hostname] }));
    else if (args[1] === "status") console.log(JSON.stringify(serve));
    else {
      const port = args.find((arg) => arg.startsWith("--https=")).split("=")[1];
      if (args.at(-1) !== "off") {
        serve.TCP[port] = { HTTPS: true };
        serve.Web[hostname + ":" + port] = { Handlers: { "/": { Proxy: args.at(-1) } } };
      } else {
        if (existsSync("tailscale-off-fails")) { console.error("tailscale timed out"); process.exit(1); }
        delete serve.TCP[port];
        delete serve.Web[hostname + ":" + port];
      }
      writeFileSync("tailscale-serve.json", JSON.stringify(serve));
    }
  `, { mode: 0o700 });
  const env = { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` };
  const gitPath = (name) => execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-path", name], { encoding: "utf8" }).trim();
  // Starters add process groups to signal and teardown steps before the fixture is removed.
  const fixtureState = { fixture, root, config, env, groups: [], teardown: [],
    statePath: gitPath("bootstrap-state.json"), logPath: gitPath("bootstrap.log") };
  t.after(async () => {
    for (const step of fixtureState.teardown) await step();
    for (const group of new Set(fixtureState.groups)) signalProcessGroup(group, "SIGKILL");
    // A test that fails before collecting its services' groups would leave them
    // running after the supervisor is killed, so stop whatever the state recorded.
    const recorded = readState(fixtureState.statePath);
    if (recorded) await reclaimStaleRun(recorded, { graceMs: 0 });
    await rm(base, { recursive: true, force: true });
  });
  return fixtureState;
}

async function startFixture(t) {
  const fixtureState = await prepareFixture(t);
  const { fixture, root, env } = fixtureState;
  const child = spawn(process.execPath, [join(root, "bootstrap.mjs"), "--local"], {
    cwd: fixture, detached: true, stdio: ["ignore", "pipe", "pipe"], env,
  });
  const closed = once(child, "close");
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  Object.assign(fixtureState, { child, closed, output: () => output });
  fixtureState.teardown.push(async () => {
    fixtureState.groups.push(...descendantProcessGroups([child.pid], processTable()));
    for (const group of new Set(fixtureState.groups)) signalProcessGroup(group, "SIGKILL");
    await closed;
  });
  const deadline = Date.now() + 5000;
  while ((!output.includes("Ready:") || !existsSync(join(fixture, "polar.pid"))) && child.exitCode === null && Date.now() < deadline) await delay(25);
  assert.ok(output.includes("Ready:"), output);
  fixtureState.groups = descendantProcessGroups([child.pid], processTable());
  return fixtureState;
}

// Launches "pnpm bootstrap --detach" from a shell that keeps running afterwards,
// like an agent's background task, so a test can kill that shell's process group.
async function startDetachedFixture(t, options) {
  const fixtureState = await prepareFixture(t, options);
  const { fixture, root, env } = fixtureState;
  const shell = spawn("sh", ["-c", '"$0" "$1" --detach "$2" && echo launcher-exited && sleep 60', process.execPath, join(root, "bootstrap.mjs"), options?.tailscale ? "--tailscale" : "--local"], {
    cwd: fixture, detached: true, stdio: ["ignore", "pipe", "pipe"], env,
  });
  const shellClosed = once(shell, "close");
  let output = "";
  for (const stream of [shell.stdout, shell.stderr]) stream.on("data", (chunk) => { output += chunk; });
  fixtureState.teardown.push(async () => {
    signalProcessGroup(shell.pid, "SIGKILL");
    await shellClosed;
  });
  const deadline = Date.now() + 5000;
  while (!output.includes("launcher-exited") && shell.exitCode === null && Date.now() < deadline) await delay(25);
  assert.match(output, /launcher-exited/, output);
  const started = JSON.parse(await readFile(fixtureState.statePath, "utf8"));
  // The supervisor leads its own process group, so teardown can reach it after the launcher exits.
  fixtureState.groups.push(started.pid);
  Object.assign(fixtureState, { shell, shellClosed, launcherOutput: () => output, supervisorPid: started.pid });
  return fixtureState;
}

function control(fixture, args, script = "bootstrap-control.mjs") {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(fixture.root, script), ...args], { cwd: fixture.root, env: fixture.env });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
    child.once("close", (code) => resolveRun({ code, output }));
  });
}

async function closedWithin(fixture, ms) {
  const timeout = new AbortController();
  try {
    const [code] = await Promise.race([fixture.closed, delay(ms, undefined, { signal: timeout.signal }).then(() => {
      throw new Error(`Bootstrap did not stop. ${fixture.output()}`);
    })]);
    return code;
  } finally {
    timeout.abort();
  }
}

test("killing only the Next listener shuts down Convex, the watcher, and Polar", { timeout: 20000 }, async (t) => {
  const fixture = await startFixture(t);
  const { root, config } = fixture;
  assert.ok(existsSync(join(root, "catalog-synced")), "Ready must include a catalog sync after initial app startup");
  assert.match(await readFile(join(root, "installed"), "utf8"), /--frozen-lockfile --prefer-offline/);
  const ready = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(ready.status, "ready");
  assert.equal(ready.pid, fixture.child.pid);
  assert.equal(ready.urls.app, config.env.APP_URL);
  assert.equal(statSync(fixture.statePath).mode & 0o777, 0o600);
  const nextPid = Number(await readFile(join(root, "next.pid"), "utf8"));
  const convexPid = Number(await readFile(join(root, "convex.pid"), "utf8"));
  const polarPid = Number(await readFile(join(root, "polar.pid"), "utf8"));
  process.kill(nextPid, "SIGKILL");
  assert.doesNotThrow(() => process.kill(convexPid, 0));
  assert.doesNotThrow(() => process.kill(polarPid, 0));
  const code = await closedWithin(fixture, 12000);
  const output = fixture.output();
  assert.equal(code, 1, output);
  assert.ok(existsSync(join(root, "inspect-interrupted")), "Cleanup survives interrupted process inspection");
  assert.match(output, /Next.*unavailable/);
  assert.doesNotMatch(output, /whsec_example|sk_test_example|polar_oat_example/);
  await assertPortsAvailable(config.ports);
  assert.equal(signalProcessGroup(nextPid, 0), false);
  assert.throws(() => process.kill(polarPid, 0), { code: "ESRCH" });
  const failed = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Next.*unavailable/);
  const log = await readFile(fixture.logPath, "utf8");
  assert.equal(statSync(fixture.logPath).mode & 0o777, 0o600);
  assert.match(log, /Convex stand-in started[\s\S]*Ready:[\s\S]*Next.*unavailable/);
  assert.doesNotMatch(log, /whsec_example|sk_test_example|polar_oat_example/);
  const wait = await control(fixture, ["wait", "--timeout", "1"]);
  assert.equal(wait.code, 1, wait.output);
  assert.match(wait.output, /failed[\s\S]*Last log lines/);
});

test("polar listen exiting restarts webhook forwarding, keeps the stack, and reports the gap", { timeout: 20000 }, async (t) => {
  const fixture = await startFixture(t);
  const { root, config } = fixture;
  const polarPid = Number(await readFile(join(root, "polar.pid"), "utf8"));
  process.kill(polarPid, "SIGKILL");
  const deadline = Date.now() + 8000;
  let restarted;
  while (Date.now() < deadline) {
    restarted = Number(await readFile(join(root, "polar.pid"), "utf8"));
    const state = JSON.parse(await readFile(fixture.statePath, "utf8"));
    // A restarted stand-in truncates polar.pid before writing its PID, so a read can see 0.
    if (restarted > 0 && restarted !== polarPid && state.polarForwarding?.status === "running") break;
    await delay(50);
  }
  assert.notEqual(restarted, polarPid, fixture.output());
  assert.equal(fixture.child.exitCode, null, "The supervisor keeps running");
  const state = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(state.status, "ready");
  assert.equal(state.polarForwarding.restarts, 1);
  assert.equal(state.polarForwarding.missed.length, 1);
  assert.match(state.polarForwarding.missed[0].reason, /^signal SIGKILL/);
  assert.ok(state.services.some(({ pgid }) => pgid === restarted), "The restarted forwarder is recorded for reclaim");
  assert.ok(!state.services.some(({ pgid }) => pgid === polarPid), "The exited forwarder is no longer recorded");
  const status = await control(fixture, ["status"]);
  assert.match(status.output, /Polar forwarding: restarted once, last after signal SIGKILL[\s\S]*were not forwarded/);
  const log = await readFile(fixture.logPath, "utf8");
  assert.match(log, /Polar webhook forwarding stopped \(signal SIGKILL[\s\S]*Polar webhook forwarding restarted\. Webhooks Polar sent from/);
  assert.doesNotMatch(log + status.output, /whsec_example|sk_test_example|polar_oat_example/);
  const response = await fetch(config.env.APP_URL);
  assert.equal(response.status, 200);

  const stop = await control(fixture, ["stop", "--timeout", "10"]);
  assert.equal(stop.code, 0, `${stop.output}\n${fixture.output()}`);
  assert.throws(() => process.kill(restarted, 0), { code: "ESRCH" });
  await assertPortsAvailable(config.ports);
});

test("bootstrap:stop signals only the verified supervisor and waits for its services", { timeout: 20000 }, async (t) => {
  const fixture = await startFixture(t);
  const polarPid = Number(await readFile(join(fixture.root, "polar.pid"), "utf8"));
  const wait = await control(fixture, ["wait", "--timeout", "5"]);
  assert.equal(wait.code, 0, wait.output);
  assert.match(wait.output, new RegExp(`Ready: ${fixture.config.env.APP_URL}`));
  const status = await control(fixture, ["status", "--json"]);
  assert.equal(JSON.parse(status.output).status, "ready");
  const stop = await control(fixture, ["stop", "--timeout", "10"]);
  assert.equal(stop.code, 0, `${stop.output}\n${fixture.output()}`);
  assert.equal(await closedWithin(fixture, 1000), 0);
  assert.throws(() => process.kill(polarPid, 0), { code: "ESRCH" });
  await assertPortsAvailable(fixture.config.ports);
  assert.equal(JSON.parse(await readFile(fixture.statePath, "utf8")).status, "stopped");
  const again = await control(fixture, ["stop"]);
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /not running \(stopped\)/);
});

test("bootstrap:stop reclaims the services of a supervisor killed without its shutdown", { timeout: 20000 }, async (t) => {
  const fixture = await startFixture(t);
  const polarPid = Number(await readFile(join(fixture.root, "polar.pid"), "utf8"));
  const recorded = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.ok(recorded.services.some(({ pgid }) => pgid === polarPid), "Polar's group is recorded while ready");
  process.kill(fixture.child.pid, "SIGKILL");
  await closedWithin(fixture, 2000);
  assert.doesNotThrow(() => process.kill(polarPid, 0));
  const status = await control(fixture, ["status"]);
  assert.match(status.output, /stale[\s\S]*bootstrap:stop to reclaim/);
  const stop = await control(fixture, ["stop", "--timeout", "10"]);
  assert.equal(stop.code, 0, stop.output);
  assert.match(stop.output, /reclaiming[\s\S]*Stopped \d+ leftover service process groups?/);
  assert.throws(() => process.kill(polarPid, 0), { code: "ESRCH" });
  await assertPortsAvailable(fixture.config.ports);
  const reclaimed = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(reclaimed.status, "stopped");
  assert.ok(reclaimed.reclaimedAt);
});

async function exitedWithin(pid, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return true; throw error; }
    await delay(50);
  }
  return false;
}

test("a detached bootstrap outlives its launcher's process group and bootstrap:stop shuts it down", { timeout: 20000 }, async (t) => {
  const fixture = await startDetachedFixture(t);
  assert.match(fixture.launcherOutput(), /pnpm bootstrap:wait/);
  assert.notEqual(fixture.supervisorPid, fixture.shell.pid);
  // An agent harness ends a background task by killing its process group.
  process.kill(-fixture.shell.pid, "SIGKILL");
  await fixture.shellClosed;
  const wait = await control(fixture, ["wait", "--timeout", "10"]);
  assert.equal(wait.code, 0, `${wait.output}\n${await readFile(fixture.logPath, "utf8")}`);
  assert.match(wait.output, new RegExp(`Ready: ${fixture.config.env.APP_URL}`));
  const pgid = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(fixture.supervisorPid)], { encoding: "utf8" }).trim());
  assert.equal(pgid, fixture.supervisorPid, "The supervisor leads its own process group");
  const ready = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(ready.pid, fixture.supervisorPid);
  fixture.groups.push(...ready.services.map(({ pgid: group }) => group));
  const polarPid = Number(await readFile(join(fixture.root, "polar.pid"), "utf8"));
  assert.match(await readFile(fixture.logPath, "utf8"), /Convex stand-in started[\s\S]*Ready:/);
  const second = await control(fixture, ["--detach", "--local"], "bootstrap.mjs");
  assert.equal(second.code, 1, second.output);
  assert.match(second.output, new RegExp(`already ready in this worktree \\(pid ${fixture.supervisorPid}\\)`));

  const stop = await control(fixture, ["stop", "--timeout", "10"]);
  assert.equal(stop.code, 0, stop.output);
  assert.ok(await exitedWithin(fixture.supervisorPid, 1000), "The supervisor exited");
  assert.throws(() => process.kill(polarPid, 0), { code: "ESRCH" });
  await assertPortsAvailable(fixture.config.ports);
  assert.equal(JSON.parse(await readFile(fixture.statePath, "utf8")).status, "stopped");
});

test("a detached bootstrap reports a typecheck error from the first push without waiting for the app", { timeout: 20000 }, async (t) => {
  const fixture = await startDetachedFixture(t, { typecheckError: true });
  const started = Date.now();
  const wait = await control(fixture, ["wait", "--timeout", "15"]);
  assert.equal(wait.code, 1, wait.output);
  assert.ok(Date.now() - started < 10000, `bootstrap:wait took ${Date.now() - started}ms`);
  assert.match(wait.output, /Bootstrap: failed[\s\S]*Error: convex dev could not push the Convex functions: TypeScript typecheck via `tsc` failed\./);
  assert.match(wait.output, /Last log lines:[\s\S]*error TS2339: Property 'removedList'/);
  assert.ok(await exitedWithin(fixture.supervisorPid, 5000), "The supervisor stopped its services and exited");
  await assertPortsAvailable(fixture.config.ports);
  assert.equal(existsSync(join(fixture.root, "next.pid")), false);
});

test("a failed run records a Tailscale cleanup failure beside its own error, and later commands remove the routes", { timeout: 40000 }, async (t) => {
  const fixture = await startDetachedFixture(t, { typecheckError: true, tailscale: true });
  await writeFile(join(fixture.root, "tailscale-off-fails"), "yes");
  const routes = async () => Object.keys(JSON.parse(await readFile(join(fixture.root, "tailscale-serve.json"), "utf8")).TCP).length;
  const wait = await control(fixture, ["wait", "--timeout", "15"]);
  assert.equal(wait.code, 1, wait.output);
  assert.ok(await exitedWithin(fixture.supervisorPid, 5000), "The supervisor exited");

  const failed = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /could not push the Convex functions/);
  assert.match(failed.proxyCleanupError, /Tailscale cleanup failed.*tailscale serve/);
  assert.equal(failed.tailscale.createdRoutes.length, 3);
  assert.match(await readFile(fixture.logPath, "utf8"), /Tailscale cleanup failed/);
  assert.equal(await routes(), 3);
  assert.match((await control(fixture, ["status"])).output, /Tailscale cleanup failed[\s\S]*bootstrap:stop/);

  // While Tailscale still fails, the run stays failed so a later command retries.
  const blocked = await control(fixture, ["stop"]);
  assert.equal(blocked.code, 1, blocked.output);
  assert.equal(JSON.parse(await readFile(fixture.statePath, "utf8")).status, "failed");

  await rm(join(fixture.root, "tailscale-off-fails"));
  const stop = await control(fixture, ["stop"]);
  assert.equal(stop.code, 0, stop.output);
  assert.match(stop.output, /Removed Tailscale routes on ports/);
  assert.equal(await routes(), 0);
  const reclaimed = JSON.parse(await readFile(fixture.statePath, "utf8"));
  assert.equal(reclaimed.status, "stopped");
  assert.match(reclaimed.error, /could not push the Convex functions/);
  assert.equal(reclaimed.proxyCleanupError, undefined);
});

test("the next bootstrap removes the routes a failed run left behind", { timeout: 40000 }, async (t) => {
  const fixture = await startDetachedFixture(t, { typecheckError: true, tailscale: true });
  await writeFile(join(fixture.root, "tailscale-off-fails"), "yes");
  await control(fixture, ["wait", "--timeout", "15"]);
  assert.ok(await exitedWithin(fixture.supervisorPid, 5000), "The supervisor exited");
  const serveFile = join(fixture.root, "tailscale-serve.json");
  assert.equal(Object.keys(JSON.parse(await readFile(serveFile, "utf8")).TCP).length, 3);
  await rm(join(fixture.root, "tailscale-off-fails"));
  await rm(join(fixture.root, "typecheck-error"));

  const next = await control(fixture, ["--detach", "--local"], "bootstrap.mjs");
  assert.equal(next.code, 0, next.output);
  assert.match(next.output, /Removed Tailscale routes on ports/);
  assert.equal(Object.keys(JSON.parse(await readFile(serveFile, "utf8")).TCP).length, 0);
  const started = JSON.parse(await readFile(fixture.statePath, "utf8"));
  fixture.groups.push(started.pid);
  const wait = await control(fixture, ["wait", "--timeout", "10"]);
  assert.equal(wait.code, 0, wait.output);
  assert.equal((await control(fixture, ["stop", "--timeout", "10"])).code, 0);
});

test("a detached bootstrap stops its services when its worktree is removed", { timeout: 20000 }, async (t) => {
  const fixture = await startDetachedFixture(t, { linked: true });
  const wait = await control(fixture, ["wait", "--timeout", "10"]);
  assert.equal(wait.code, 0, wait.output);
  const ready = JSON.parse(await readFile(fixture.statePath, "utf8"));
  fixture.groups.push(...ready.services.map(({ pgid }) => pgid));
  const polarPid = Number(await readFile(join(fixture.root, "polar.pid"), "utf8"));
  const nextPid = Number(await readFile(join(fixture.root, "next.pid"), "utf8"));
  const mainRoot = join(fixture.root, "../main");
  execFileSync("git", ["-C", mainRoot, "worktree", "remove", "--force", fixture.root]);
  assert.equal(existsSync(fixture.statePath), false, "Removing the worktree also removes its Git admin directory");
  assert.ok(await exitedWithin(fixture.supervisorPid, 8000), "The supervisor noticed the removal and exited");
  assert.throws(() => process.kill(polarPid, 0), { code: "ESRCH" });
  assert.equal(signalProcessGroup(nextPid, 0), false);
  await assertPortsAvailable(fixture.config.ports);
});
