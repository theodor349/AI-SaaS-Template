import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertPortsAvailable, bootstrap, waitForServer, worktreeConfig } from "./bootstrap.mjs";

// Separate ports avoid conflicting with Convex's wildcard local listeners.
export function tailscaleConfig(config, dnsName) {
  const hostname = dnsName.replace(/\.$/, "").toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(hostname)) {
    throw new Error("Tailscale must provide this machine's MagicDNS .ts.net hostname.");
  }
  const hash = createHash("sha256").update(config.root).digest("hex");
  const first = 50000 + (Number.parseInt(hash.slice(8, 16), 16) % 5000) * 3;
  const ports = { next: first, convex: first + 1, site: first + 2 };
  const url = key => `https://${hostname}:${ports[key]}`;
  return { hostname, ports, env: {
    APP_URL: url("next"), NEXT_PUBLIC_APP_URL: url("next"),
    NEXT_PUBLIC_CONVEX_URL: url("convex"), NEXT_PUBLIC_CONVEX_SITE_URL: url("site"),
    POLAR_SUCCESS_URL: `${url("next")}/`, TAILSCALE_HOSTNAME: hostname,
  } };
}

// Refuse collisions, public Funnel routes, and changes to another worktree's proxy.
export function plannedProxies(config, remote, serve) {
  return Object.entries(remote.ports).map(([service, port]) => {
    const authority = `${remote.hostname}:${port}`;
    const target = `http://127.0.0.1:${config.ports[service]}`;
    const existing = serve.Web?.[authority];
    if (serve.AllowFunnel?.[authority]) throw new Error(`Tailscale port ${port} has public Funnel enabled; use a private unused port.`);
    if (serve.TCP?.[port] || existing) {
      if (serve.TCP?.[port]?.HTTPS !== true || !existing || Object.keys(existing.Handlers ?? {}).length !== 1 || existing.Handlers?.["/"]?.Proxy !== target) {
        throw new Error(`Tailscale port ${port} is already configured for another service. Its configuration was preserved.`);
      }
      return { port, target, create: false };
    }
    return { port, target, create: true };
  });
}

function cleanupProxies(cleanup) {
  try { cleanup(); return true; }
  catch (error) { console.error(`Tailscale cleanup failed: ${error.message}`); return false; }
}

export async function serveWorktree(config, remote, command = args => execFileSync("tailscale", args, { encoding: "utf8", timeout: 15000 })) {
  const plans = plannedProxies(config, remote, JSON.parse(command(["serve", "status", "--json"])));
  await assertPortsAvailable(Object.fromEntries(plans.filter(p => p.create).map(p => [`tailscale-${p.port}`, p.port])));
  const created = [];
  const cleanup = () => {
    const current = JSON.parse(command(["serve", "status", "--json"]));
    for (const plan of created.reverse()) {
      // Only remove routes we created that still point to our original target.
      const authority = `${remote.hostname}:${plan.port}`;
      if (!current.AllowFunnel?.[authority] && current.TCP?.[plan.port]?.HTTPS === true && current.Web?.[authority]?.Handlers?.["/"]?.Proxy === plan.target && Object.keys(current.Web[authority].Handlers).length === 1) {
        command(["serve", `--https=${plan.port}`, "off"]);
      }
    }
  };
  try {
    for (const plan of plans.filter(p => p.create)) {
      const fresh = plannedProxies(config, remote, JSON.parse(command(["serve", "status", "--json"])));
      if (!fresh.find(p => p.port === plan.port).create) continue;
      command(["serve", "--bg", `--https=${plan.port}`, plan.target]);
      created.push(plan);
    }
  } catch (error) {
    cleanupProxies(cleanup);
    throw error;
  }
  return cleanup;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("pnpm bootstrap:tailscale [--no-polar] [--print]\n\nStarts this worktree with private Tailscale HTTPS URLs. Requires Tailscale running with MagicDNS and HTTPS enabled. Stop any existing bootstrap in its owning terminal first. Ctrl+C stops the stack and removes only proxies created by this run. --print shows URLs without changing services.");
    return;
  }
  for (const arg of process.argv.slice(2)) {
    if (!["--no-polar", "--print"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  const root = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const config = worktreeConfig(root);
  let status;
  try { status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 15000 })); }
  catch { throw new Error("Tailscale is unavailable. Install it and connect this machine to your tailnet first."); }
  if (status.BackendState !== "Running") throw new Error("Tailscale is not connected. Connect it before starting the worktree.");
  const remote = tailscaleConfig(config, status.Self?.DNSName ?? "");
  if (process.argv.includes("--print")) { console.log(JSON.stringify({ ...config, tailscale: remote }, null, 2)); return; }
  await assertPortsAvailable(config.ports);
  const cleanup = await serveWorktree(config, remote);
  try {
    await bootstrap({ browserEnv: remote.env, onReady: async signal => {
      await waitForServer(remote.env.APP_URL, signal);
      await waitForServer(`${remote.env.NEXT_PUBLIC_CONVEX_URL}/version`, signal);
    } });
  } finally { if (!cleanupProxies(cleanup)) process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    if (error.message !== "Bootstrap stopped.") { console.error(`Tailscale bootstrap: ${error.message}`); process.exitCode = 1; }
  });
}
