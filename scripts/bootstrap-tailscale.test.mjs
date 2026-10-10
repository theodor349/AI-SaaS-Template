import assert from "node:assert/strict";
import test from "node:test";
import { worktreeConfig } from "./bootstrap.mjs";
import { plannedProxies, serveWorktree, tailscaleConfig } from "./bootstrap-tailscale.mjs";

const local = worktreeConfig("/tmp/tailscale-test-worktree");
const remote = tailscaleConfig(local, "agent.example.ts.net.");
const authority = port => `${remote.hostname}:${port}`;
const existing = { TCP: { 443: { HTTPS: true } }, Web: { "agent.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } } } } };
function proxyState(port, target) {
  return { TCP: { [port]: { HTTPS: true } }, Web: { [authority(port)]: { Handlers: { "/": { Proxy: target } } } } };
}

test("Tailscale URLs are stable, isolated from local listener ports, and retain local webhook forwarding", () => {
  assert.deepEqual(remote, tailscaleConfig(local, "agent.example.ts.net"));
  assert.equal(new Set([...Object.values(local.ports), ...Object.values(remote.ports)]).size, 6);
  for (const port of Object.values(remote.ports)) assert.ok(port >= 50000 && port < 65000);
  assert.notDeepEqual(remote.ports, tailscaleConfig(worktreeConfig("/tmp/another-worktree"), remote.hostname).ports);
  assert.equal(remote.env.APP_URL, `https://${authority(remote.ports.next)}`);
  assert.equal(remote.env.POLAR_SUCCESS_URL, `${remote.env.APP_URL}/`);
  assert.equal(remote.env.POLAR_WEBHOOK_URL, undefined);
  assert.throws(() => tailscaleConfig(local, "evil.example/path"), /MagicDNS/);
});

test("proxy planning preserves unrelated services and refuses collisions or Funnel", () => {
  assert.equal(plannedProxies(local, remote, existing).filter(p => p.create).length, 3);
  const port = remote.ports.next;
  const same = proxyState(port, `http://127.0.0.1:${local.ports.next}`);
  assert.equal(plannedProxies(local, remote, same)[0].create, false);
  assert.throws(() => plannedProxies(local, remote, proxyState(port, "http://127.0.0.1:9999")), /another service/);
  assert.throws(() => plannedProxies(local, remote, { ...same, AllowFunnel: { [authority(port)]: true } }), /Funnel/);
  same.Web[authority(port)].Handlers["/another"] = { Proxy: "http://127.0.0.1:8888" };
  assert.throws(() => plannedProxies(local, remote, same), /another service/);
});

function fakeTailscale(failPort) {
  const state = structuredClone(existing);
  const calls = [];
  return { state, calls, command: args => {
    calls.push(args);
    if (args[1] === "status") return JSON.stringify(state);
    const port = Number(args.find(arg => arg.startsWith("--https=")).split("=")[1]);
    if (args.at(-1) === "off") { delete state.TCP[port]; delete state.Web[authority(port)]; }
    else {
      if (port === failPort) throw new Error("Serve setup failed");
      Object.assign(state.TCP, proxyState(port, args.at(-1)).TCP);
      Object.assign(state.Web, proxyState(port, args.at(-1)).Web);
    }
    return "";
  } };
}

test("startup failure rolls back only proxies created by that run", async () => {
  const fake = fakeTailscale(remote.ports.convex);
  await assert.rejects(serveWorktree(local, remote, fake.command), /Serve setup failed/);
  assert.deepEqual(fake.state, existing);
});

test("cleanup keeps reused proxies and routes changed by someone else", async () => {
  const fake = fakeTailscale();
  const same = proxyState(remote.ports.site, `http://127.0.0.1:${local.ports.site}`);
  Object.assign(fake.state.TCP, same.TCP); Object.assign(fake.state.Web, same.Web);
  const cleanup = await serveWorktree(local, remote, fake.command);
  fake.state.Web[authority(remote.ports.next)].Handlers["/"].Proxy = "http://127.0.0.1:9999";
  cleanup();
  assert.equal(fake.state.Web[authority(remote.ports.next)].Handlers["/"].Proxy, "http://127.0.0.1:9999");
  assert.ok(fake.state.Web[authority(remote.ports.site)]);
  assert.equal(fake.state.Web[authority(remote.ports.convex)], undefined);
  assert.deepEqual(fake.state.Web["agent.example.ts.net:443"], existing.Web["agent.example.ts.net:443"]);
});
