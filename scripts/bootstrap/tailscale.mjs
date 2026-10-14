import { execFileSync } from "node:child_process";
import { assertPortsAvailable } from "./network.mjs";

const magicDnsName = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/;

// Separate ports avoid conflicting with Convex's wildcard local listeners.
export function tailscaleConfig(config, dnsName) {
  const hostname = dnsName.replace(/\.$/, "").toLowerCase();
  if (!magicDnsName.test(hostname)) {
    throw new Error("Tailscale must provide this machine's MagicDNS .ts.net hostname.");
  }
  const first = 50000 + config.portBlock.tailscale * 3;
  const ports = { next: first, convex: first + 1, site: first + 2 };
  const url = key => `https://${hostname}:${ports[key]}`;
  return { hostname, ports, env: {
    APP_URL: url("next"), NEXT_PUBLIC_APP_URL: url("next"),
    NEXT_PUBLIC_CONVEX_URL: url("convex"), NEXT_PUBLIC_CONVEX_SITE_URL: url("site"),
    TAILSCALE_HOSTNAME: hostname,
  } };
}

export function readTailscaleStatus(command = args => execFileSync("tailscale", args, {
  encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
})) {
  try { return JSON.parse(command(["status", "--json"])); }
  catch (error) {
    // A stopped daemon can exit nonzero while still describing its state.
    try { return JSON.parse(error.stdout); } catch { return null; }
  }
}

function tailscaleUnavailableReason(status) {
  if (!status) return "Tailscale is not installed or not responding";
  if (status.BackendState !== "Running") return "Tailscale is not connected";
  const hostname = (status.Self?.DNSName ?? "").replace(/\.$/, "").toLowerCase();
  if (!magicDnsName.test(hostname)) return "Tailscale MagicDNS has no .ts.net hostname for this machine";
  const certDomains = (status.CertDomains ?? []).map(domain => domain.replace(/\.$/, "").toLowerCase());
  if (!certDomains.includes(hostname)) return "Tailscale HTTPS certificates are not enabled for this tailnet";
  return null;
}

// Chooses loopback or Tailscale URLs. readStatus runs only when the choice depends on it.
export function chooseNetwork({ local = false, tailscale = false, ci = false, readStatus }) {
  if (local && tailscale) throw new Error("Use either --local or --tailscale, not both.");
  if (local) return { mode: "local" };
  if (!tailscale && ci) return { mode: "local", note: "CI is set; using loopback URLs." };
  const status = readStatus();
  const reason = tailscaleUnavailableReason(status);
  if (!reason) return { mode: "tailscale", dnsName: status.Self.DNSName };
  if (tailscale) throw new Error(`${reason}. Enable MagicDNS and HTTPS certificates and connect this machine, or use --local.`);
  return { mode: "local", note: `${reason}; using loopback URLs. Pass --local to skip this check.` };
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

export function cleanupProxies(cleanup) {
  try { cleanup(); return true; }
  catch (error) { console.error(`Tailscale cleanup failed: ${error.message}`); return false; }
}

// Returns a cleanup function that removes only routes this run created.
// Its created/preserved lists are recorded in the bootstrap state file.
export async function serveWorktree(config, remote, command = args => execFileSync("tailscale", args, { encoding: "utf8", timeout: 15000 })) {
  const plans = plannedProxies(config, remote, JSON.parse(command(["serve", "status", "--json"])));
  await assertPortsAvailable(Object.fromEntries(plans.filter(p => p.create).map(p => [`tailscale-${p.port}`, p.port])));
  const created = [];
  const preserved = plans.filter(p => !p.create).map(({ port, target }) => ({ port, target }));
  const cleanup = () => {
    const current = JSON.parse(command(["serve", "status", "--json"]));
    for (const plan of [...created].reverse()) {
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
      if (!fresh.find(p => p.port === plan.port).create) {
        preserved.push({ port: plan.port, target: plan.target });
        continue;
      }
      command(["serve", "--bg", `--https=${plan.port}`, plan.target]);
      created.push({ port: plan.port, target: plan.target });
    }
  } catch (error) {
    cleanupProxies(cleanup);
    throw error;
  }
  return Object.assign(cleanup, { created, preserved });
}
