import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { developmentCredentials, worktreeConfig } from "./bootstrap.mjs";

// Tests only use the generated local target, never inherited deployment selectors.
export function resolveLocalTestConfig(root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()) {
  const config = worktreeConfig(realpathSync(root));
  const file = join(config.root, ".env.local");
  const stateFile = join(config.root, ".convex/local/default/config.json");
  if (!existsSync(file) || !existsSync(stateFile)) {
    throw new Error("Local test configuration is missing. Start pnpm bootstrap in this worktree first.");
  }
  const env = parseEnv(readFileSync(file, "utf8"));
  for (const [key, expected] of Object.entries(config.env)) {
    if (env[key] !== expected) {
      throw new Error(`Local test configuration ${key} does not match this worktree. Start pnpm bootstrap here; cloud and other worktree targets are refused.`);
    }
  }
  if (env.CONVEX_DEPLOYMENT !== "local:anonymous-agent" ||
      JSON.parse(readFileSync(stateFile, "utf8")).deploymentName !== "anonymous-agent" ||
      ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"].some((key) => env[key])) {
    throw new Error("Local tests require bootstrap's isolated anonymous Convex deployment; cloud credentials are refused.");
  }
  return { config, env: developmentCredentials(env, false) };
}
