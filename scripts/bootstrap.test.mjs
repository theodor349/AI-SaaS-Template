import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import * as bootstrap from "./bootstrap.mjs";
import { billingEnabled } from "./bootstrap/config.mjs";
import { createSupervisor, exitReason } from "./bootstrap/processes.mjs";
import {
  assertPortsAvailable,
  childEnvironment,
  developmentCredentials,
  descendantProcessGroups,
  environmentFile,
  worktreeConfig,
  worktreeCredentials,
} from "./bootstrap.mjs";

const credentials = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`,
  CLERK_SECRET_KEY: "sk_test_example",
  POLAR_ACCESS_TOKEN: "polar_oat_example",
  POLAR_PRODUCT_MONTHLY: "monthly",
  POLAR_PRODUCT_YEARLY: "yearly",
  POLAR_PRODUCT_LIFETIME: "lifetime",
};

test("the full worktree path determines stable identifiers and disjoint port blocks", () => {
  const a = worktreeConfig("/tmp/first/feature");
  const b = worktreeConfig("/tmp/second/feature");
  assert.deepEqual(a, worktreeConfig("/tmp/first/feature"));
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^wt-[a-f0-9]{12}$/);
  assert.equal(new Set([...Object.values(a.ports), ...Object.values(b.ports)]).size, 6);
  for (const port of Object.values(a.ports)) {
    assert.ok(port >= 10000 && port < 46000);
  }
  assert.equal(a.env.NEXT_PUBLIC_APP_URL, `http://127.0.0.1:${a.ports.next}`);
  assert.equal(a.env.POLAR_WEBHOOK_URL, `http://127.0.0.1:${a.ports.site}/webhooks/polar`);
});

test("development credentials derive the Clerk issuer and reject live keys", () => {
  assert.equal(developmentCredentials(credentials).CLERK_JWT_ISSUER_DOMAIN, "https://example.clerk.accounts.dev");
  assert.throws(() => developmentCredentials({ ...credentials, CLERK_SECRET_KEY: "sk_live_secret" }), /development/);
  assert.throws(() => developmentCredentials({ ...credentials, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_secret" }), /development/);
  assert.throws(() => developmentCredentials({ ...credentials, CLERK_JWT_ISSUER_DOMAIN: "https://wrong.accounts.dev" }), /match/);
  assert.throws(() => developmentCredentials({ ...credentials, POLAR_ACCESS_TOKEN: "" }), /POLAR_ACCESS_TOKEN/);
  assert.doesNotThrow(() => developmentCredentials({ ...credentials, POLAR_ACCESS_TOKEN: "" }, false));
});

test("billing startup requires every plan while --no-polar works without products", () => {
  const incomplete = { ...credentials, POLAR_PRODUCT_YEARLY: "" };
  assert.throws(() => developmentCredentials(incomplete), /^ {2}POLAR_PRODUCT_YEARLY=<product ID>$/m);
  assert.doesNotThrow(() => developmentCredentials(incomplete, false));
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "bootstrap products ")));
  try {
    const { POLAR_PRODUCT_MONTHLY: _monthly, ...withoutMonthly } = credentials;
    writeFileSync(join(fixture, ".env.bootstrap.local"), environmentFile(withoutMonthly));
    // The error names the exact file to edit, not just a description of it.
    assert.throws(() => worktreeCredentials(fixture, fixture, true, {}), (error) =>
      error.message.includes(`Add these lines to ${join(fixture, ".env.bootstrap.local")}`) &&
      /^ {2}POLAR_PRODUCT_MONTHLY=<product ID>$/m.test(error.message) && !error.message.includes("POLAR_PRODUCT_YEARLY"));
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("the billing switch is read from the checkout's app.config.ts", () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "bootstrap billing ")));
  const config = (line) => writeFileSync(join(fixture, "app.config.ts"),
    `export type AppConfig = {\n  // billing: false hides pricing\n  billing: boolean;\n};\nexport const appConfig = {\n  appName: "Example",\n${line}\n};\n`);
  try {
    config("  billing: false,");
    assert.equal(billingEnabled(fixture), false);
    config("  billing: true");
    assert.equal(billingEnabled(fixture), true);
    config("  billing: process.env.BILLING === \"1\",");
    assert.throws(() => billingEnabled(fixture), /must set `billing: true,` or `billing: false,`/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("worktrees inherit shared Polar plans through blank templates and preserve explicit overrides", () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "bootstrap billing ")));
  const mainRoot = join(fixture, "main");
  const worktreeRoot = join(fixture, "feature");
  mkdirSync(mainRoot);
  mkdirSync(worktreeRoot);
  const products = {
    POLAR_PRODUCT_MONTHLY: "shared-monthly",
    POLAR_PRODUCT_YEARLY: "shared-yearly",
    POLAR_PRODUCT_LIFETIME: "shared-lifetime",
    POLAR_ORGANIZATION_ID: "shared-org",
  };
  try {
    writeFileSync(join(mainRoot, ".env.bootstrap.local"), environmentFile({ ...credentials, ...products }));
    const blanks = Object.fromEntries(Object.keys(products).map(key => [key, ""]));
    writeFileSync(join(worktreeRoot, ".env.local"), environmentFile(blanks));
    writeFileSync(join(worktreeRoot, ".env.bootstrap.local"), environmentFile(blanks));
    const inherited = worktreeCredentials(worktreeRoot, mainRoot, true, blanks);
    for (const [key, value] of Object.entries(products)) assert.equal(inherited[key], value);
    writeFileSync(join(worktreeRoot, ".env.bootstrap.local"), environmentFile({ ...blanks, POLAR_PRODUCT_YEARLY: "worktree-yearly" }));
    assert.equal(worktreeCredentials(worktreeRoot, mainRoot, true, {}).POLAR_PRODUCT_YEARLY, "worktree-yearly");
    assert.equal(worktreeCredentials(worktreeRoot, mainRoot, true, { POLAR_PRODUCT_YEARLY: "shell-yearly" }).POLAR_PRODUCT_YEARLY, "shell-yearly");
    assert.equal(parseEnv(readFileSync(join(mainRoot, ".env.bootstrap.local"), "utf8")).POLAR_PRODUCT_YEARLY, products.POLAR_PRODUCT_YEARLY);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("child processes cannot inherit a cloud deployment or production Polar environment", () => {
  const config = worktreeConfig("/tmp/feature");
  const env = childEnvironment(config, developmentCredentials(credentials), {
    PATH: "/bin",
    CONVEX_DEPLOY_KEY: "prod:secret",
    CONVEX_DEPLOYMENT: "prod:other",
    CONVEX_SELF_HOSTED_URL: "https://other.example",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "secret",
    CONVEX_DEPLOYMENT_TOKEN: "secret",
    POLAR_ENVIRONMENT: "production",
    TAILSCALE_HOSTNAME: "stale.example.ts.net",
    PORT: "3000",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CONVEX_DEPLOYMENT, "local:anonymous-agent");
  assert.equal(env.CONVEX_AGENT_MODE, "anonymous");
  assert.equal(env.POLAR_ENVIRONMENT, "sandbox");
  assert.equal(env.PORT, String(config.ports.next));
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOYMENT_TOKEN", "TAILSCALE_HOSTNAME"]) {
    assert.equal(env[key], undefined);
  }
});

test("generated env files round-trip quoted secrets without expanding shell syntax", () => {
  const env = { TOKEN: "value # with $() and `backticks`", MULTILINE: "one\ntwo", QUOTE: "it's quoted", JSON: '{"value":"example"}' };
  assert.deepEqual({ ...parseEnv(environmentFile(env)) }, env);
});

test("an occupied port fails instead of choosing a different worktree URL", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(assertPortsAvailable({ next: server.address().port }), /occupied/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

// Some CI sandboxes, such as Depot's, have no IPv6 and refuse to listen on "::".
async function ipv6Available() {
  const server = createServer();
  try {
    server.listen(0, "::");
    await once(server, "listening");
  } catch {
    return false;
  }
  server.close();
  await once(server, "close");
  return true;
}

test("wildcard listeners are rejected on every service port", async (t) => {
  const ipv6 = await ipv6Available();
  for (const host of ["0.0.0.0", "::"]) {
    for (const service of ["next", "convex", "site"]) {
      await t.test(`${service} on ${host}`, { skip: host === "::" && !ipv6 && "IPv6 is unavailable" }, async () => {
        const server = createServer((socket) => socket.end());
        server.listen(0, host);
        await once(server, "listening");
        const port = server.address().port;
        try {
          await assert.rejects(assertPortsAvailable({ [service]: port }), new RegExp(`${service} port ${port} is occupied`));
          assert.equal(server.listening, true);
        } finally {
          server.close();
          await once(server, "close");
        }
        await assertPortsAvailable({ [service]: port });
      });
    }
  }
});

test("readiness waits for a successful HTTP response", async () => {
  let status = 503;
  const server = createHttpServer((request, response) => {
    response.writeHead(status).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  let ready = false;
  try {
    const pending = bootstrap.waitForServer(`http://127.0.0.1:${server.address().port}/`, controller.signal)
      .then(() => { ready = true; });
    await once(server, "request");
    assert.equal(ready, false);
    status = 200;
    await pending;
    assert.equal(ready, true);
  } finally {
    controller.abort();
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

test("a Convex backend crash aborts supervision even when its CLI remains alive", { timeout: 10000 }, async () => {
  const server = createHttpServer((request, response) => response.end("version"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/version`;
  const controller = new AbortController();
  try {
    const monitoring = bootstrap.superviseConvex(url, controller, { unavailableMs: 0 });
    await delay(100);
    assert.equal(controller.signal.aborted, false);
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    await monitoring;
    assert.equal(controller.signal.aborted, true);
    assert.match(controller.signal.reason.message, /Convex backend.*unavailable/);
  } finally {
    controller.abort();
    if (server.listening) {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    }
  }
});

test("stopping active backend supervision preserves the shutdown reason", async () => {
  const server = createHttpServer((request, response) => response.end("version"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  const reason = new Error("Bootstrap stopped.");
  try {
    const monitoring = bootstrap.superviseConvex(`http://127.0.0.1:${server.address().port}/version`, controller);
    await once(server, "request");
    controller.abort(reason);
    await monitoring;
    assert.equal(controller.signal.reason, reason);
  } finally {
    controller.abort();
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

test("a backend that stays unhealthy or unresponsive aborts supervision", { timeout: 10000 }, async (t) => {
  for (const status of [503, null]) {
    await t.test(status ? "HTTP failure" : "request timeout", async () => {
      const server = createHttpServer((request, response) => {
        if (status) response.writeHead(status).end();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const controller = new AbortController();
      try {
        const started = Date.now();
        await bootstrap.superviseConvex(`http://127.0.0.1:${server.address().port}/version`, controller, { unavailableMs: 1500, timeoutMs: 500 });
        assert.ok(Date.now() - started >= 1500);
        assert.equal(controller.signal.aborted, true);
        assert.match(controller.signal.reason.message, /Convex backend.*unavailable/);
      } finally {
        controller.abort();
        server.closeAllConnections();
        server.close();
        await once(server, "close");
      }
    });
  }
});

test("a backend that answers within 5 seconds on a loaded machine passes its health check", { timeout: 10000 }, async () => {
  let requests = 0;
  const server = createHttpServer((request, response) => {
    if (++requests === 1) setTimeout(() => response.end("version"), 3000);
    else response.end("version");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  const monitoring = bootstrap.superviseConvex(`http://127.0.0.1:${server.address().port}/version`, controller, { unavailableMs: 0 });
  try {
    await delay(4500);
    assert.equal(controller.signal.aborted, false);
    assert.equal(requests, 2);
  } finally {
    controller.abort();
    await monitoring;
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

test("a running backend that keeps failing its health checks stops the stack only after 60 seconds", { timeout: 15000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const server = createHttpServer((request, response) => response.writeHead(503).end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  const monitoring = bootstrap.superviseConvex(`http://127.0.0.1:${server.address().port}/version`, controller);
  try {
    await once(server, "request");
    t.mock.timers.tick(59_000);
    await once(server, "request");
    await delay(100);
    assert.equal(controller.signal.aborted, false);
    t.mock.timers.tick(1000);
    await monitoring;
    assert.match(controller.signal.reason.message, /Convex backend.*unavailable.*HTTP 503/);
  } finally {
    controller.abort();
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

test("an exited backend stops the stack at once, without waiting out the window", { timeout: 10000 }, async () => {
  const server = createHttpServer((request, response) => response.end("version"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/version`;
  const controller = new AbortController();
  const monitoring = bootstrap.superviseConvex(url, controller);
  await once(server, "request");
  server.closeAllConnections();
  server.close();
  await once(server, "close");
  const stoppedAfter = Date.now();
  await monitoring;
  assert.ok(Date.now() - stoppedAfter < 5000);
  assert.match(controller.signal.reason.message, /Convex backend.*unavailable.*nothing is listening/);
});

test("one slow backend health check does not stop supervision", { timeout: 10000 }, async () => {
  let requests = 0;
  const server = createHttpServer((request, response) => {
    // The first check outlasts its timeout, as /version can while a large import loads.
    if (++requests === 1) setTimeout(() => response.end("version"), 1500);
    else response.end("version");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  const monitoring = bootstrap.superviseConvex(`http://127.0.0.1:${server.address().port}/version`, controller, { timeoutMs: 1000 });
  try {
    // The slow check times out after 1 second and the next one starts a second later.
    await delay(2500);
    assert.equal(controller.signal.aborted, false);
    assert.equal(requests, 2);
  } finally {
    controller.abort();
    await monitoring;
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

test("Next monitoring allows brief listener restarts and stops cleanly on shutdown", { timeout: 10000 }, async () => {
  const server = createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const controller = new AbortController();
  const reason = new Error("Bootstrap stopped.");
  const monitoring = bootstrap.superviseNext(`http://127.0.0.1:${port}`, controller);
  try {
    await once(server, "connection");
    server.close();
    await once(server, "close");
    await delay(1500);
    assert.equal(controller.signal.aborted, false);
    server.listen(port, "127.0.0.1");
    await once(server, "connection");
    controller.abort(reason);
    await monitoring;
    assert.equal(controller.signal.reason, reason);
  } finally {
    controller.abort(reason);
    await monitoring;
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
  }
});

test("removing the worktree or its Git admin directory stops a running bootstrap", async (t) => {
  for (const removed of ["worktree", "admin"]) {
    await t.test(removed, async () => {
      const fixture = mkdtempSync(join(tmpdir(), "bootstrap worktree watch "));
      const paths = [join(fixture, "worktree/.git"), join(fixture, "admin")];
      mkdirSync(join(fixture, "worktree"));
      writeFileSync(paths[0], "gitdir: ../admin\n");
      mkdirSync(paths[1]);
      const controller = new AbortController();
      try {
        const watching = bootstrap.superviseWorktree(paths, controller, { intervalMs: 10 });
        await delay(50);
        assert.equal(controller.signal.aborted, false);
        rmSync(removed === "worktree" ? join(fixture, "worktree") : paths[1], { recursive: true });
        await watching;
        assert.equal(controller.signal.aborted, true);
        assert.match(controller.signal.reason.message, /worktree was removed/);
      } finally {
        controller.abort();
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
});

test("worktree watching ends with the shutdown reason when bootstrap stops", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "bootstrap worktree watch "));
  const controller = new AbortController();
  const reason = new Error("Bootstrap stopped.");
  try {
    const watching = bootstrap.superviseWorktree([fixture], controller, { intervalMs: 60000 });
    controller.abort(reason);
    await watching;
    assert.equal(controller.signal.reason, reason);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Output captured from convex dev 1.47 in this template, as bootstrap's pipe receives it.
const typecheckFailure = [
  "- Preparing Convex functions...\n\n",
  "\u001b[31m✖\u001b[39m TypeScript typecheck via `tsc` failed.\n",
  "\u001b[90mTo ignore failing typecheck, use `--typecheck=disable`.\u001b[39m\n",
  "- Collecting TypeScript errors\n\n",
];
const typecheckErrors = [
  "convex/notes/notes.test.ts:42:55 - error TS2339: Property 'removedList' does not exist on type '{ list: ... }'.\n\n",
  "42   const { page } = await caller.query(api.notes.notes.removedList, { paginationOpts: firstPage });\n",
  "                                                         ~~~~~~~~~~~\n\nFound 1 error in convex/notes/notes.test.ts",
  ":42\n\n",
];
const bundleFailure = [
  "- Preparing Convex functions...\n\n",
  "✘ [ERROR] Could not resolve \"./doesNotExist\"\n\n    convex/notes/notes.ts:1:7:\n      1 │ import \"./doesNotExist\";\n",
];

function pushWatch(quietMs = 50) {
  const controller = new AbortController();
  return { controller, watch: bootstrap.watchConvexPush(controller, { quietMs }) };
}

test("a typecheck error stops startup once convex dev has printed the errors and waits for a change", async () => {
  const { controller, watch } = pushWatch();
  for (const chunk of typecheckFailure) watch.write(chunk);
  // convex dev prints the errors only after a second tsc run.
  await delay(150);
  assert.equal(controller.signal.aborted, false);
  for (const chunk of typecheckErrors) watch.write(chunk);
  await once(controller.signal, "abort");
  assert.equal(controller.signal.reason.message,
    "convex dev could not push the Convex functions: TypeScript typecheck via `tsc` failed. Fix the error shown in its output and start bootstrap again.");
});

test("a bundling error stops startup with esbuild's message", async () => {
  const { controller, watch } = pushWatch();
  for (const chunk of bundleFailure) watch.write(chunk);
  await once(controller.signal, "abort");
  assert.match(controller.signal.reason.message, /could not push the Convex functions: Could not resolve "\.\/doesNotExist" Fix/);
});

test("push failures convex dev retries by itself and successful pushes do not stop startup", async () => {
  const { controller, watch } = pushWatch();
  watch.write("- Preparing Convex functions...\n\n");
  watch.write("✖ Schema or environment variables changed during push\nFailed due to network error, retrying in 500ms...\n");
  watch.write("- Preparing Convex functions...\n\n✔ 08:13:03 Convex functions ready! (1.2s)\n");
  await delay(150);
  assert.equal(controller.signal.aborted, false);
});

test("push watching ignores failures after it is stopped", async () => {
  const { controller, watch } = pushWatch();
  for (const chunk of bundleFailure) watch.write(chunk);
  watch.stop();
  await delay(150);
  assert.equal(controller.signal.aborted, false);
});

test("--detach is accepted alongside the network and Polar options", () => {
  assert.deepEqual(bootstrap.parseArguments(["--detach", "--local", "--no-polar"]), {
    help: false, local: true, tailscale: false, polar: false, print: false, detach: true,
  });
  assert.equal(bootstrap.parseArguments([]).detach, false);
  assert.throws(() => bootstrap.parseArguments(["--detached"]), /Unknown argument: --detached/);
});

test("shutdown includes detached grandchildren and excludes unrelated agents", () => {
  const groups = descendantProcessGroups([10], `
    9 1 9
    10 9 10
    11 10 10
    20 11 20
    21 20 20
    22 20 0
    30 21 30
    40 9 40
    41 40 40
  `);
  assert.deepEqual(groups, [10, 20, 30]);
});

test("process group signalling ignores missing groups and rejects special group IDs", (t) => {
  t.mock.method(process, "kill", () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
  assert.equal(bootstrap.signalProcessGroup(2147483647, "SIGTERM"), false);
  for (const group of [0, 1, -1, NaN]) assert.throws(() => bootstrap.signalProcessGroup(group, "SIGTERM"), /Invalid process group/);
});

test("macOS zombie-only groups cannot interrupt cleanup, while live permission errors still fail", { skip: process.platform !== "darwin" }, (t) => {
  const error = Object.assign(new Error("permission denied"), { code: "EPERM" });
  t.mock.method(process, "kill", () => { throw error; });
  // A vanished group has no live members, just like a group containing only zombies.
  assert.equal(bootstrap.signalProcessGroup(2147483647, 0), false);
  assert.equal(bootstrap.signalProcessGroup(2147483647, "SIGTERM"), false);
  const ownGroup = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim());
  assert.throws(() => bootstrap.signalProcessGroup(ownGroup, "SIGTERM"), (actual) => actual === error);
});

test("macOS groups with only exiting members need no signal but still count as running", () => {
  // A local Convex backend can keep exiting after its CLI leader became a zombie.
  const exiting = "4242 Z\n4242 ?E\n99 S";
  assert.deepEqual(bootstrap.darwinGroupMembers(4242, exiting), { live: false, exiting: true });
  assert.deepEqual(bootstrap.darwinGroupMembers(4242, "4242 Z\n99 S"), { live: false, exiting: false });
  assert.deepEqual(bootstrap.darwinGroupMembers(4242, "4242 Ss\n4242 ?E"), { live: true, exiting: true });
});

test("Clerk webhook secrets are validated and available without Polar forwarding", () => {
  const secret = `whsec_${Buffer.from("local test secret").toString("base64")}`;
  assert.equal(developmentCredentials({ ...credentials, CLERK_WEBHOOK_SIGNING_SECRET: secret }, false).CLERK_WEBHOOK_SIGNING_SECRET, secret);
  assert.match(developmentCredentials(credentials, false).CLERK_WEBHOOK_SIGNING_SECRET, /^whsec_/);
  assert.throws(() => developmentCredentials({ ...credentials, CLERK_WEBHOOK_SIGNING_SECRET: "bad secret" }, false), /Svix/);
});


test("generated Clerk signing secrets stay local while explicit overrides can be shared", () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "bootstrap credentials ")));
  const mainRoot = join(fixture, "main");
  const firstRoot = join(fixture, "first");
  const secondRoot = join(fixture, "second");
  for (const root of [mainRoot, firstRoot, secondRoot]) mkdirSync(root);
  const savedSecret = `whsec_${Buffer.from("main checkout generated secret").toString("base64")}`;
  const explicitSecret = `whsec_${Buffer.from("explicit development webhook secret").toString("base64")}`;
  const overrideSecret = `whsec_${Buffer.from("worktree override webhook secret").toString("base64")}`;
  try {
    writeFileSync(join(mainRoot, ".env.local"), environmentFile({
      ...credentials, ...worktreeConfig(mainRoot).env,
      CLERK_WEBHOOK_SIGNING_SECRET: savedSecret,
    }));
    const first = worktreeCredentials(firstRoot, mainRoot, false, {});
    const second = worktreeCredentials(secondRoot, mainRoot, false, {});
    assert.notEqual(first.CLERK_WEBHOOK_SIGNING_SECRET, savedSecret);
    assert.notEqual(second.CLERK_WEBHOOK_SIGNING_SECRET, first.CLERK_WEBHOOK_SIGNING_SECRET);
    // Saving the generated credentials is how bootstrap persists restart state.
    writeFileSync(join(firstRoot, ".env.local"), environmentFile({ ...first, ...worktreeConfig(firstRoot).env }));
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, {}).CLERK_WEBHOOK_SIGNING_SECRET, first.CLERK_WEBHOOK_SIGNING_SECRET);
    writeFileSync(join(mainRoot, ".env.bootstrap.local"), environmentFile({ CLERK_WEBHOOK_SIGNING_SECRET: explicitSecret }));
    assert.equal(worktreeCredentials(secondRoot, mainRoot, false, {}).CLERK_WEBHOOK_SIGNING_SECRET, explicitSecret);
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, {}).CLERK_WEBHOOK_SIGNING_SECRET, first.CLERK_WEBHOOK_SIGNING_SECRET);
    const copiedTemplate = { ...parseEnv(readFileSync(new URL("../.env.bootstrap.example", import.meta.url), "utf8")), ...credentials };
    assert.equal(copiedTemplate.CLERK_WEBHOOK_SIGNING_SECRET, "");
    writeFileSync(join(firstRoot, ".env.bootstrap.local"), environmentFile(copiedTemplate));
    writeFileSync(join(secondRoot, ".env.bootstrap.local"), environmentFile(copiedTemplate));
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, {}).CLERK_WEBHOOK_SIGNING_SECRET, first.CLERK_WEBHOOK_SIGNING_SECRET);
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, { CLERK_WEBHOOK_SIGNING_SECRET: "" }).CLERK_WEBHOOK_SIGNING_SECRET, first.CLERK_WEBHOOK_SIGNING_SECRET);
    assert.equal(worktreeCredentials(secondRoot, mainRoot, false, {}).CLERK_WEBHOOK_SIGNING_SECRET, explicitSecret);
    writeFileSync(join(firstRoot, ".env.bootstrap.local"), environmentFile({ CLERK_WEBHOOK_SIGNING_SECRET: overrideSecret }));
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, {}).CLERK_WEBHOOK_SIGNING_SECRET, overrideSecret);
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, { CLERK_WEBHOOK_SIGNING_SECRET: "" }).CLERK_WEBHOOK_SIGNING_SECRET, overrideSecret);
    assert.equal(worktreeCredentials(firstRoot, mainRoot, false, { CLERK_WEBHOOK_SIGNING_SECRET: explicitSecret }).CLERK_WEBHOOK_SIGNING_SECRET, explicitSecret);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("only the worktree's own settings pause it, and removing the setting resumes it", () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "bootstrap maintenance ")));
  const mainRoot = join(fixture, "main");
  const worktreeRoot = join(fixture, "worktree");
  for (const root of [mainRoot, worktreeRoot]) mkdirSync(root);
  try {
    writeFileSync(join(mainRoot, ".env.bootstrap.local"), environmentFile({ ...credentials, MAINTENANCE_MODE: "1" }));
    assert.equal(worktreeCredentials(worktreeRoot, mainRoot, false, {}).MAINTENANCE_MODE, undefined);
    writeFileSync(join(worktreeRoot, ".env.bootstrap.local"), environmentFile({ MAINTENANCE_MODE: "1" }));
    const paused = worktreeCredentials(worktreeRoot, mainRoot, false, {});
    assert.equal(paused.MAINTENANCE_MODE, "1");
    // The generated .env.local from the paused run must not keep the worktree paused.
    writeFileSync(join(worktreeRoot, ".env.local"), environmentFile({ ...paused, ...worktreeConfig(worktreeRoot).env }));
    rmSync(join(worktreeRoot, ".env.bootstrap.local"));
    assert.equal(worktreeCredentials(worktreeRoot, mainRoot, false, {}).MAINTENANCE_MODE, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("BOOTSTRAP_PORT_BLOCK moves loopback and Tailscale ports without changing the worktree identity", () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "bootstrap ports ")));
  const mainRoot = join(fixture, "main");
  const worktreeRoot = join(fixture, "feature");
  mkdirSync(mainRoot);
  mkdirSync(worktreeRoot);
  try {
    const derived = worktreeConfig(worktreeRoot, { portBlock: undefined });
    assert.equal(bootstrap.portBlockOverride(worktreeRoot, {}), undefined);
    // A main-checkout value would move every linked worktree onto the same ports.
    writeFileSync(join(mainRoot, ".env.bootstrap.local"), environmentFile({ ...credentials, BOOTSTRAP_PORT_BLOCK: "9" }));
    assert.equal(bootstrap.portBlockOverride(worktreeRoot, {}), undefined);
    assert.equal(worktreeCredentials(worktreeRoot, mainRoot, true, {}).BOOTSTRAP_PORT_BLOCK, undefined);
    writeFileSync(join(worktreeRoot, ".env.bootstrap.local"), environmentFile({ BOOTSTRAP_PORT_BLOCK: "7" }));
    assert.equal(bootstrap.portBlockOverride(worktreeRoot, {}), 7);
    assert.equal(bootstrap.portBlockOverride(worktreeRoot, { BOOTSTRAP_PORT_BLOCK: "11" }), 11);
    const moved = worktreeConfig(worktreeRoot, { portBlock: 7 });
    assert.deepEqual(moved.ports, { next: 10021, convex: 10022, site: 10023 });
    assert.equal(moved.id, derived.id);
    assert.equal(moved.env.APP_URL, "http://127.0.0.1:10021");
    assert.equal(worktreeConfig(worktreeRoot, { portBlock: 5007 }).portBlock.tailscale, 7);
    for (const value of ["-1", "12000", "1.5", "next"]) {
      assert.throws(() => bootstrap.portBlockOverride(worktreeRoot, { BOOTSTRAP_PORT_BLOCK: value }), /0 to 11999/);
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("an occupied port explains how to choose another port block", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(assertPortsAvailable({ next: server.address().port }), /BOOTSTRAP_PORT_BLOCK=<0-11999>.*\.env\.bootstrap\.local/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

// A stand-in named polar, so the supervisor treats its output as Polar's. Each
// run appends its PID to runs and writes the secret to stderr. Runs listed in
// failingRuns exit with code 1; the others keep running.
function polarStandIn(t, { failingRuns }) {
  const dir = mkdtempSync(join(tmpdir(), "bootstrap supervisor "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const command = join(dir, "polar");
  writeFileSync(command, `#!/usr/bin/env node
    const { appendFileSync, existsSync, readFileSync } = require("node:fs");
    const runs = ${JSON.stringify(join(dir, "runs"))};
    appendFileSync(runs, process.pid + "\\n");
    const run = readFileSync(runs, "utf8").trim().split("\\n").length;
    console.error("▲ Update available v2.0.1 → v3.0.0\\n  Run polar update to install it");
    console.error("Signing secret: " + process.env.POLAR_WEBHOOK_SECRET);
    if (${JSON.stringify(failingRuns)}.includes(run)) {
      console.error("✖ Event stream error (503)\\n    The Polar API may be having issues, try again shortly.");
      process.exitCode = 1;
    } else setInterval(() => {}, 1000);
  `, { mode: 0o700 });
  const runs = () => {
    try { return readFileSync(join(dir, "runs"), "utf8").trim().split("\n").filter(Boolean).map(Number); }
    catch { return []; }
  };
  return { dir, command, runs };
}

// Stops the supervisor after the test even when an assertion fails, so no
// stand-in outlives it and keeps the test process running.
function testSupervisor(t, dir) {
  const controller = new AbortController();
  const env = { ...process.env, POLAR_WEBHOOK_SECRET: "whsec_supervisor_example" };
  const supervisor = createSupervisor({ root: dir, env, controller, log: null });
  let stopped;
  const stop = () => (stopped ??= supervisor.stop());
  t.after(stop);
  return { controller, supervisor, stop };
}

async function waitForRuns(polar, count) {
  const deadline = Date.now() + 5000;
  while (polar.runs().length < count && Date.now() < deadline) await delay(25);
  return polar.runs();
}

test("a kept service that exits is restarted without stopping the stack, and its stderr explains why", { timeout: 10000 }, async (t) => {
  const polar = polarStandIn(t, { failingRuns: [1] });
  const { controller, supervisor, stop } = testSupervisor(t, polar.dir);
  const exits = [];
  let restarted;
  const restart = new Promise((resolveRestart) => { restarted = resolveRestart; });
  const kept = supervisor.keep(polar.command, ["listen"], {
    delaysMs: [100],
    onExit: (exit, delayMs) => { exits.push({ reason: exitReason(exit), delayMs }); },
    onRestart: async () => restarted(await supervisor.recordServiceGroups()),
  });
  const groups = await restart;
  assert.equal(controller.signal.aborted, false);
  assert.deepEqual(exits, [{
    reason: "exit 1: ✖ Event stream error (503) The Polar API may be having issues, try again shortly.",
    delayMs: 100,
  }]);
  // The restarted stand-in records its PID once Node has started it.
  const [first, second] = await waitForRuns(polar, 2);
  assert.deepEqual(groups.map(({ pgid }) => pgid), [second], "Only the running restart is recorded");
  assert.throws(() => process.kill(first, 0), { code: "ESRCH" });
  await stop();
  await kept;
  assert.throws(() => process.kill(second, 0), { code: "ESRCH" });
  assert.equal(polar.runs().length, 2);
});

// Records the restart delays of a stand-in that fails its first five runs.
async function restartDelays(t, stableMs) {
  const polar = polarStandIn(t, { failingRuns: [1, 2, 3, 4, 5] });
  const { supervisor, stop } = testSupervisor(t, polar.dir);
  const delays = [];
  let errors = "";
  const kept = supervisor.keep(polar.command, ["listen"], {
    delaysMs: [10, 20, 30], stableMs,
    onExit: (exit, delayMs) => {
      delays.push(delayMs);
      errors = exit.errors;
    },
  });
  await waitForRuns(polar, 6);
  await stop();
  await kept;
  return { delays, errors };
}

test("a kept service's restart delay grows with each quick exit and resets after a stable run", { timeout: 10000 }, async (t) => {
  const quick = await restartDelays(t, 60_000);
  assert.deepEqual(quick.delays, [10, 20, 30, 30, 30]);
  // Lines before the error can hold Polar's secret; it never leaves the supervisor.
  assert.match(quick.errors, /Signing secret: \[redacted\]/);
  assert.doesNotMatch(quick.errors, /whsec_supervisor_example|Update available|polar update/);
  assert.deepEqual((await restartDelays(t, 0)).delays, [10, 10, 10, 10, 10]);
});

test("stopping during a kept service's restart delay starts nothing more", { timeout: 10000 }, async (t) => {
  const polar = polarStandIn(t, { failingRuns: [1] });
  const { supervisor, stop } = testSupervisor(t, polar.dir);
  let exited;
  const exit = new Promise((resolveExit) => { exited = resolveExit; });
  const kept = supervisor.keep(polar.command, ["listen"], { delaysMs: [5000], onExit: () => exited() });
  await exit;
  await stop();
  await kept;
  assert.equal(polar.runs().length, 1);
});
