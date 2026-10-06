import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { parseEnv } from "node:util";
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

test("shutdown includes detached grandchildren and excludes unrelated agents", () => {
  const groups = descendantProcessGroups([10], `
    9 1 9
    10 9 10
    11 10 10
    20 11 20
    21 20 20
    30 21 30
    40 9 40
    41 40 40
  `);
  assert.deepEqual(groups, [10, 20, 30]);
});
