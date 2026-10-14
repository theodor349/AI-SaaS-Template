import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitRoot, worktreeConfig } from "./bootstrap/config.mjs";
import { occupiedPorts } from "./bootstrap/network.mjs";
import { bootstrapPaths, inspectState, liveStatuses, readState } from "./bootstrap/state.mjs";

const usage = `pnpm db:reset --yes

Deletes this worktree's local Convex database and file storage. Bootstrap must be
stopped. config.json is kept so the next bootstrap reuses this worktree's
anonymous deployment identity and starts with an empty database.`;

// Everything in the deployment directory except its identity file is data.
// Symlinks are removed as links; their targets are never followed.
export function resetTargets(root) {
  const deploymentDir = join(root, ".convex/local/default");
  const targets = [];
  for (const directory of [join(root, ".convex"), join(root, ".convex/local"), deploymentDir]) {
    if (!existsSync(directory)) return targets.concat(watchFile(root));
    if (!lstatSync(directory).isDirectory()) throw new Error(`${relative(root, directory)} is not a directory; refusing to reset.`);
  }
  for (const entry of readdirSync(deploymentDir)) {
    if (entry !== "config.json") targets.push(join(deploymentDir, entry));
  }
  return targets.concat(watchFile(root));
}

function watchFile(root) {
  const file = join(root, ".env.convex-watch.local");
  return existsSync(file) ? [file] : [];
}

async function main(argv) {
  if (argv.includes("--help")) {
    console.log(usage);
    return;
  }
  for (const arg of argv) if (arg !== "--yes") throw new Error(`Unknown argument: ${arg}`);
  const root = gitRoot();
  const state = inspectState(readState(bootstrapPaths(root).state));
  if (liveStatuses.includes(state.status)) {
    throw new Error(`Bootstrap is ${state.status} in this worktree (pid ${state.pid}). Stop it with pnpm bootstrap:stop first.`);
  }
  const ports = { ...worktreeConfig(root).ports };
  for (const [service, port] of Object.entries(state.ports ?? {})) ports[`recorded ${service}`] = port;
  const occupied = await occupiedPorts(ports);
  if (occupied.length) {
    throw new Error(`This worktree's ports are in use (${occupied.join(", ")}). Stop the process using them before resetting.`);
  }
  const targets = resetTargets(root);
  for (const target of targets) {
    if (!resolve(target).startsWith(`${root}/`)) throw new Error(`Refusing to remove ${target} outside this worktree.`);
  }
  if (!targets.length) {
    console.log("No local Convex data to remove.");
    return;
  }
  if (!argv.includes("--yes")) {
    console.log(`Would remove:\n${targets.map(target => `  ${relative(root, target)}`).join("\n")}\nRun pnpm db:reset --yes to delete them.`);
    process.exitCode = 1;
    return;
  }
  for (const target of targets) {
    rmSync(target, { recursive: true, force: true });
    console.log(`Removed ${relative(root, target)}`);
  }
  console.log("Local Convex data reset. The next pnpm bootstrap starts with an empty database.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`db:reset: ${error.message}`);
    process.exitCode = 1;
  });
}
