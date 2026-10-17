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

const realPs = execFileSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const processTable = () => execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" });

// Starts the real bootstrap against stand-in pnpm and ps commands in a fresh repository.
async function startFixture(t) {
  const fixture = await mkdtemp(join(tmpdir(), "bootstrap lifecycle with spaces "));
  execFileSync("git", ["init", "--quiet", fixture]);
  const root = realpathSync(execFileSync("git", ["-C", fixture, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const config = worktreeConfig(root);
  await assertPortsAvailable(config.ports);
  await mkdir(join(fixture, "bin"));
  for (const name of ["bootstrap.mjs", "bootstrap-output-guard.mjs", "bootstrap-control.mjs", "doctor.mjs"]) await copyFile(script(`./${name}`), join(fixture, name));
  await cp(script("./bootstrap"), join(fixture, "bootstrap"), { recursive: true });
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
  const env = { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` };
  const child = spawn(process.execPath, [join(root, "bootstrap.mjs"), "--local"], {
    cwd: fixture, detached: true, stdio: ["ignore", "pipe", "pipe"], env,
  });
  const closed = once(child, "close");
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const gitPath = (name) => execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-path", name], { encoding: "utf8" }).trim();
  const fixtureState = { fixture, root, config, child, closed, env, output: () => output, groups: [],
    statePath: gitPath("bootstrap-state.json"), logPath: gitPath("bootstrap.log") };
  t.after(async () => {
    const current = descendantProcessGroups([child.pid], processTable());
    for (const group of new Set([...fixtureState.groups, ...current])) signalProcessGroup(group, "SIGKILL");
    await closed;
    await rm(fixture, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  while ((!output.includes("Ready:") || !existsSync(join(fixture, "polar.pid"))) && child.exitCode === null && Date.now() < deadline) await delay(25);
  assert.ok(output.includes("Ready:"), output);
  fixtureState.groups = descendantProcessGroups([child.pid], processTable());
  return fixtureState;
}

function control(fixture, args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(fixture.root, "bootstrap-control.mjs"), ...args], { cwd: fixture.root, env: fixture.env });
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
