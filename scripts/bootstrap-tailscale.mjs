import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrap } from "./bootstrap.mjs";

// pnpm bootstrap:tailscale is pnpm bootstrap --tailscale; it fails instead of
// falling back to loopback URLs when Tailscale HTTPS is unavailable.
export { plannedProxies, serveWorktree, tailscaleConfig } from "./bootstrap/tailscale.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  bootstrap({ argv: ["--tailscale", ...process.argv.slice(2)] }).catch((error) => {
    if (!error.reported && !process.stderr.destroyed) console.error(`Tailscale bootstrap: ${error.message}`);
    process.exitCode = 1;
  });
}
