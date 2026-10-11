import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { environmentFile, worktreeConfig } from "./bootstrap.mjs";
import { tailscaleConfig } from "./bootstrap-tailscale.mjs";
import { resolveLocalTestConfig } from "./local-test-config.mjs";

test("local tests reject missing, cloud, and mismatched targets without exposing credentials", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "local test config ")));
  try {
    assert.throws(() => resolveLocalTestConfig(root), /Start pnpm bootstrap/);
    mkdirSync(join(root, ".convex/local/default"), { recursive: true });
    writeFileSync(join(root, ".convex/local/default/config.json"), JSON.stringify({ deploymentName: "anonymous-agent" }));
    const values = {
      ...worktreeConfig(root).env,
      CONVEX_DEPLOYMENT: "local:anonymous-agent",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("local-tests.accounts.dev$").toString("base64")}`,
      CLERK_SECRET_KEY: "sk_test_private-placeholder",
      CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${Buffer.from("local test signing secret").toString("base64")}`,
    };
    const save = (changes = {}) => writeFileSync(join(root, ".env.local"), environmentFile({ ...values, ...changes }));
    save();
    assert.equal(resolveLocalTestConfig(root).config.id, values.WORKTREE_ID);
    const remote = tailscaleConfig(worktreeConfig(root), "agent.example.ts.net");
    save(remote.env);
    assert.equal(resolveLocalTestConfig(root).config.env.APP_URL, remote.env.APP_URL);
    save({ ...remote.env, NEXT_PUBLIC_CONVEX_URL: "https://agent.example.ts.net:12345" });
    assert.throws(() => resolveLocalTestConfig(root), /does not match/);
    for (const changes of [
      { APP_URL: "http://127.0.0.1:3000" },
      { NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud" },
      { CONVEX_DEPLOYMENT: "dev:cloud" },
      { CONVEX_DEPLOY_KEY: "private-cloud-placeholder" },
      { CLERK_SECRET_KEY: "sk_live_private-placeholder" },
      { CLERK_WEBHOOK_SIGNING_SECRET: "" },
      { CLERK_WEBHOOK_SIGNING_SECRET: "bad_private-placeholder" },
    ]) {
      save(changes);
      assert.throws(() => resolveLocalTestConfig(root), (error) => {
        assert.doesNotMatch(error.message, /private-placeholder|private-cloud-placeholder/);
        return true;
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
