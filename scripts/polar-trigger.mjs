import { execFile } from "node:child_process";
import { childEnvironment, developmentCredentials } from "./bootstrap.mjs";
import { resolveLocalTestConfig } from "./local-test-config.mjs";

try {
  const { config, env } = resolveLocalTestConfig();
  const credentials = developmentCredentials(env);
  const args = ["exec", "polar", "trigger", "customer.created",
    "--override", `data.metadata.worktree_id=${config.id}`,
    "--override", `data.name=Agent test ${config.id}`];
  if (credentials.POLAR_ORGANIZATION_ID) args.push("--org", credentials.POLAR_ORGANIZATION_ID);
  const result = await new Promise((resolve) => {
    execFile("pnpm", args, {
      cwd: config.root, env: childEnvironment(config, credentials), timeout: 45000,
    }, (error, stdout, stderr) => resolve({ error, output: stdout + stderr }));
  });
  // Never echo raw provider output, payloads, signing secrets, or token URLs.
  if (/Sent customer\.created/.test(result.output)) console.log(`Polar sandbox sample sent with worktree label ${config.id}.`);
  const destinations = [...new Set(result.output.match(/http:\/\/127\.0\.0\.1:\d+\/webhooks\/polar/g) ?? [])];
  for (const destination of destinations) console.log(`CLI reported forwarding: ${destination}`);
  const status = result.output.match(/Response\s+(\d{3})/)?.[1];
  if (status) console.log(`Delivery response: HTTP ${status}.`);
  console.log("Shared organization listeners can receive this event. CLI output alone cannot verify delivery to every worktree or billing isolation.");
  if (result.error) throw new Error("Polar sample delivery failed. Check sandbox credentials and the webhook handler. Raw provider diagnostics are suppressed.");
} catch (error) {
  console.error(`Polar trigger: ${error.message}`);
  process.exitCode = 1;
}
