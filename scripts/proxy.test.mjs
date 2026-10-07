import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("Next routes Clerk-style rewrites on the original loopback host", { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = await mkdtemp(join(tmpdir(), "bootstrap-proxy-"));
  let child;
  let closed;
  let output = "";
  try {
    await mkdir(join(fixture, "app"));
    await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "junction");
    await copyFile(join(root, "next.config.js"), join(fixture, "next.config.js"));
    await writeFile(join(fixture, "package.json"), '{"private":true}');
    await writeFile(join(fixture, "app/route.js"), `
      export function GET(request) {
        return new Response(new URL(request.url).searchParams.get("marker"));
      }
    `);
    // Clerk passes auth headers to rendering by rewriting to the request URL.
    // Exercise that behavior without hosted credentials or authentication calls.
    await writeFile(join(fixture, "proxy.js"), `
      import { NextResponse } from "next/server";
      export function proxy(request) {
        return NextResponse.rewrite(new URL(request.url));
      }
    `);
    const portServer = createServer();
    portServer.listen(0, "127.0.0.1");
    await once(portServer, "listening");
    const port = portServer.address().port;
    portServer.close();
    await once(portServer, "close");
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", fixture,
      "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    closed = once(child, "close");
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
    const deadline = Date.now() + 30000;
    while (!output.includes("Ready") && child.exitCode === null && Date.now() < deadline) await delay(50);
    assert.ok(output.includes("Ready"), output);
    const response = await fetch(`http://127.0.0.1:${port}/?marker=worktree`, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, output);
    assert.equal(await response.text(), "worktree");
    assert.doesNotMatch(output, /Failed to proxy/);
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const kill = (signal) => process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal);
      kill("SIGTERM");
      const timeout = new AbortController();
      await Promise.race([closed, delay(5000, undefined, { signal: timeout.signal }).catch(() => {})]);
      timeout.abort();
      if (child.exitCode === null && child.signalCode === null) kill("SIGKILL");
      await closed;
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
