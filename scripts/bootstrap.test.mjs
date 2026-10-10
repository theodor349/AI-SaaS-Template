import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import * as bootstrap from "./bootstrap.mjs";
import {
  assertPortsAvailable,
  childEnvironment,
  developmentCredentials,
  descendantProcessGroups,
  environmentFile,
  worktreeConfig,
} from "./bootstrap.mjs";

const credentials = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`,
  CLERK_SECRET_KEY: "sk_test_example",
  POLAR_ACCESS_TOKEN: "polar_oat_example",
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
    PORT: "3000",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CONVEX_DEPLOYMENT, "local:anonymous-agent");
  assert.equal(env.CONVEX_AGENT_MODE, "anonymous");
  assert.equal(env.POLAR_ENVIRONMENT, "sandbox");
  assert.equal(env.PORT, String(config.ports.next));
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOYMENT_TOKEN"]) {
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

test("wildcard listeners are rejected on every service port", async (t) => {
  for (const host of ["0.0.0.0", "::"]) {
    for (const service of ["next", "convex", "site"]) {
      await t.test(`${service} on ${host}`, async () => {
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
    const monitoring = bootstrap.superviseConvex(url, controller);
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

test("an unhealthy or unresponsive backend aborts supervision", { timeout: 10000 }, async (t) => {
  for (const status of [503, null]) {
    await t.test(status ? "HTTP failure" : "request timeout", async () => {
      const server = createHttpServer((request, response) => {
        if (status) response.writeHead(status).end();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const controller = new AbortController();
      try {
        await bootstrap.superviseConvex(`http://127.0.0.1:${server.address().port}/version`, controller);
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

test("Clerk webhook secrets are validated and available without Polar forwarding", () => {
  const secret = `whsec_${Buffer.from("local test secret").toString("base64")}`;
  assert.equal(developmentCredentials({ ...credentials, CLERK_WEBHOOK_SIGNING_SECRET: secret }, false).CLERK_WEBHOOK_SIGNING_SECRET, secret);
  assert.match(developmentCredentials(credentials, false).CLERK_WEBHOOK_SIGNING_SECRET, /^whsec_/);
  assert.throws(() => developmentCredentials({ ...credentials, CLERK_WEBHOOK_SIGNING_SECRET: "bad secret" }, false), /Svix/);
});
