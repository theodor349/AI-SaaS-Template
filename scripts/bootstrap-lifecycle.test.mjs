import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertPortsAvailable, descendantProcessGroups, environmentFile, signalProcessGroup, worktreeConfig } from "./bootstrap.mjs";

test("killing only the Next listener shuts down Convex, the watcher, and Polar", { timeout: 20000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), "bootstrap lifecycle with spaces "));
  let child;
  let closed;
  let output = "";
  let groups = [];
  try {
    execFileSync("git", ["init", "--quiet", fixture]);
    const root = realpathSync(execFileSync("git", ["-C", fixture, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
    const config = worktreeConfig(root);
    await assertPortsAvailable(config.ports);
    await mkdir(join(fixture, "node_modules/convex"), { recursive: true });
    await mkdir(join(fixture, "node_modules/@polar-sh/cli"), { recursive: true });
    await mkdir(join(fixture, "bin"));
    await copyFile(fileURLToPath(new URL("./bootstrap.mjs", import.meta.url)), join(fixture, "bootstrap.mjs"));
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
    ].join("\n"), { mode: 0o600 });
    // Stand-ins preserve the failure shape: both wrapping CLIs survive Next's exit.
    await writeFile(join(fixture, "bin/pnpm"), `#!/usr/bin/env node
      const { spawn } = require("node:child_process");
      const { mkdirSync, writeFileSync } = require("node:fs");
      const { createServer } = require("node:http");
      const args = process.argv.slice(2);
      if (args.includes("--print-secret")) { console.log("whsec_example"); console.error("whsec_example"); }
      else if (args.includes("set")) { /* env upload */ }
      else if (args.includes("polar")) {
        console.log("Signing secret: whsec_example");
        console.error("Signing secret: whsec_example");
        writeFileSync("polar.pid", String(process.pid));
        setInterval(() => {}, 1000);
      } else if (args.includes("--until-success")) {
        mkdirSync(".convex/local/default", { recursive: true });
        writeFileSync(".convex/local/default/config.json", JSON.stringify({ deploymentName: "anonymous-agent", adminKey: "example" }));
        createServer((req, res) => res.end("version")).listen(Number(process.env.PORT) + 1, "127.0.0.1");
        createServer((req, res) => res.writeHead(404).end()).listen(Number(process.env.PORT) + 2, "127.0.0.1");
        const listener = spawn(process.execPath, ["-e", 'require("node:http").createServer((req, res) => res.end("app")).listen(Number(process.env.PORT), "127.0.0.1")'], { detached: true, stdio: "ignore" });
        writeFileSync("next.pid", String(listener.pid));
        writeFileSync("convex.pid", String(process.pid));
      }
    `, { mode: 0o700 });
    child = spawn(process.execPath, [join(root, "bootstrap.mjs")], {
      cwd: fixture, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` },
    });
    closed = once(child, "close");
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
    const deadline = Date.now() + 5000;
    while ((!output.includes("Ready:") || !existsSync(join(fixture, "polar.pid"))) && child.exitCode === null && Date.now() < deadline) await delay(25);
    assert.ok(output.includes("Ready:"), output);
    groups = descendantProcessGroups([child.pid], execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" }));
    const nextPid = Number(await readFile(join(fixture, "next.pid"), "utf8"));
    const convexPid = Number(await readFile(join(fixture, "convex.pid"), "utf8"));
    const polarPid = Number(await readFile(join(fixture, "polar.pid"), "utf8"));
    process.kill(nextPid, "SIGKILL");
    assert.doesNotThrow(() => process.kill(convexPid, 0));
    assert.doesNotThrow(() => process.kill(polarPid, 0));
    const timeout = new AbortController();
    let code;
    try {
      [code] = await Promise.race([closed, delay(12000, undefined, { signal: timeout.signal }).then(() => { throw new Error(`Bootstrap did not stop after Next was killed. ${output}`); })]);
    } finally {
      timeout.abort();
    }
    assert.equal(code, 1, output);
    assert.match(output, /Next.*unavailable/);
    assert.doesNotMatch(output, /whsec_example|sk_test_example|polar_oat_example/);
    await assertPortsAvailable(config.ports);
    assert.equal(signalProcessGroup(nextPid, 0), false);
    assert.throws(() => process.kill(polarPid, 0), { code: "ESRCH" });
  } finally {
    if (child?.pid) {
      const current = descendantProcessGroups([child.pid], execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" }));
      for (const group of new Set([...groups, ...current])) signalProcessGroup(group, "SIGKILL");
      await closed;
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
