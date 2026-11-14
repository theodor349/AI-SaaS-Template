import assert from "node:assert/strict";
import test from "node:test";
import { worktreeConfig } from "./bootstrap.mjs";
import { plannedProxies, serveWorktree, tailscaleConfig } from "./bootstrap-tailscale.mjs";
import { chooseNetwork, removeRecordedRoutes } from "./bootstrap/tailscale.mjs";

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
  for (const port of Object.values(remote.ports)) assert.ok(port >= 61000 && port <= 65501);
  assert.notDeepEqual(remote.ports, tailscaleConfig(worktreeConfig("/tmp/another-worktree"), remote.hostname).ports);
  assert.equal(remote.env.APP_URL, `https://${authority(remote.ports.next)}`);
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

// The Tailscale ports derive from this test's worktree path, so a real check
// fails whenever another process on the machine holds one of them, such as a
// worktree stack that hashed to the same Tailscale port block.
const portsFree = async () => {};

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
  await assert.rejects(serveWorktree(local, remote, { command: fake.command, portsAvailable: portsFree }), /Serve setup failed/);
  assert.deepEqual(fake.state, existing);
});

test("cleanup keeps reused proxies and routes changed by someone else", async () => {
  const fake = fakeTailscale();
  const same = proxyState(remote.ports.site, `http://127.0.0.1:${local.ports.site}`);
  Object.assign(fake.state.TCP, same.TCP); Object.assign(fake.state.Web, same.Web);
  const cleanup = await serveWorktree(local, remote, { command: fake.command, portsAvailable: portsFree });
  fake.state.Web[authority(remote.ports.next)].Handlers["/"].Proxy = "http://127.0.0.1:9999";
  cleanup();
  assert.equal(fake.state.Web[authority(remote.ports.next)].Handlers["/"].Proxy, "http://127.0.0.1:9999");
  assert.ok(fake.state.Web[authority(remote.ports.site)]);
  assert.equal(fake.state.Web[authority(remote.ports.convex)], undefined);
  assert.deepEqual(fake.state.Web["agent.example.ts.net:443"], existing.Web["agent.example.ts.net:443"]);
});


test("failed rollback reports cleanup failure without masking the original startup error", async t => {
  const fake = fakeTailscale(remote.ports.convex);
  let setupFailed = false;
  const reported = t.mock.method(console, "error", () => {});
  const command = args => {
    if (setupFailed && args[1] === "status") throw new Error("Cleanup status timed out");
    try { return fake.command(args); }
    catch (error) { setupFailed = true; throw error; }
  };
  await assert.rejects(serveWorktree(local, remote, { command, portsAvailable: portsFree }), /Serve setup failed/);
  assert.match(reported.mock.calls[0].arguments[0], /Cleanup status timed out/);
});

test("failed rollback goes to the given report, and the routes it left stay recorded", async () => {
  const fake = fakeTailscale(remote.ports.convex);
  let setupFailed = false;
  const reports = [];
  const recorded = [];
  const command = args => {
    if (setupFailed && args[1] === "status") throw new Error("Cleanup status timed out");
    try { return fake.command(args); }
    catch (error) { setupFailed = true; throw error; }
  };
  await assert.rejects(serveWorktree(local, remote, {
    command, portsAvailable: portsFree, report: message => reports.push(message), onRoutes: ({ created }) => recorded.push(created.map(route => route.port)),
  }), /Serve setup failed/);
  assert.match(reports[0], /Tailscale cleanup failed: Cleanup status timed out/);
  assert.deepEqual(recorded.at(-1), [remote.ports.next]);
});

test("cleanup forgets the routes it removed or no longer owns", async () => {
  const fake = fakeTailscale();
  const recorded = [];
  const cleanup = await serveWorktree(local, remote, {
    command: fake.command, portsAvailable: portsFree, onRoutes: ({ created }) => recorded.push(created.map(route => route.port)),
  });
  assert.deepEqual(recorded.at(-1), [remote.ports.next, remote.ports.convex, remote.ports.site]);
  cleanup();
  assert.deepEqual(recorded.at(-1), []);
});

test("Tailscale is used by default only with a running node and HTTPS certificates", () => {
  const running = { BackendState: "Running", Self: { DNSName: "Agent.Example.ts.net." }, CertDomains: ["agent.example.ts.net"] };
  const unused = () => { throw new Error("status must not be read"); };
  assert.deepEqual(chooseNetwork({ readStatus: () => running }), { mode: "tailscale", dnsName: "Agent.Example.ts.net." });
  assert.equal(chooseNetwork({ local: true, readStatus: unused }).mode, "local");
  assert.equal(chooseNetwork({ ci: true, readStatus: unused }).mode, "local");
  assert.equal(chooseNetwork({ ci: true, tailscale: true, readStatus: () => running }).mode, "tailscale");
  assert.throws(() => chooseNetwork({ local: true, tailscale: true, readStatus: unused }), /either/);
  for (const [status, reason] of [
    [null, /not installed/],
    [{ ...running, BackendState: "Stopped" }, /not connected/],
    [{ ...running, Self: {} }, /MagicDNS/],
    [{ ...running, CertDomains: null }, /HTTPS certificates/],
  ]) {
    const fallback = chooseNetwork({ readStatus: () => status });
    assert.equal(fallback.mode, "local");
    assert.match(fallback.note, reason);
    assert.doesNotMatch(fallback.note, /\n/);
    assert.throws(() => chooseNetwork({ tailscale: true, readStatus: () => status }), reason);
  }
});

test("a port block override moves Tailscale ports with the loopback ports", () => {
  const moved = worktreeConfig("/tmp/tailscale-test-worktree", { portBlock: 7 });
  assert.deepEqual(tailscaleConfig(moved, "agent.example.ts.net").ports, { next: 61021, convex: 61022, site: 61023 });
});

test("serving records created and preserved routes for the state file", async () => {
  const fake = fakeTailscale();
  const same = proxyState(remote.ports.site, `http://127.0.0.1:${local.ports.site}`);
  Object.assign(fake.state.TCP, same.TCP); Object.assign(fake.state.Web, same.Web);
  const checked = [];
  const cleanup = await serveWorktree(local, remote, { command: fake.command, portsAvailable: async ports => { checked.push(...Object.values(ports)); } });
  // Only ports this run will serve are checked; the reused route's port is in use by design.
  assert.deepEqual(checked, [remote.ports.next, remote.ports.convex]);
  assert.deepEqual(cleanup.created.map(route => route.port), [remote.ports.next, remote.ports.convex]);
  assert.deepEqual(cleanup.preserved, [{ port: remote.ports.site, target: `http://127.0.0.1:${local.ports.site}` }]);
});

test("a stale run's recorded routes are removed only while unchanged and unserved", async () => {
  const fake = fakeTailscale();
  const target = service => `http://127.0.0.1:${local.ports[service]}`;
  for (const service of ["next", "convex", "site"]) {
    const route = proxyState(remote.ports[service], target(service));
    Object.assign(fake.state.TCP, route.TCP); Object.assign(fake.state.Web, route.Web);
  }
  fake.state.Web[authority(remote.ports.convex)].Handlers["/"].Proxy = "http://127.0.0.1:9999";
  const recorded = ["next", "convex", "site"].map(service => ({ port: remote.ports[service], target: target(service) }));
  const gone = { port: 65001, target: "http://127.0.0.1:1" };
  const listening = async port => port === local.ports.site;
  const result = await removeRecordedRoutes(remote.hostname, [...recorded, gone], { command: fake.command, listening });
  assert.deepEqual(result, { removed: [recorded[0]], kept: [recorded[1]], blocked: [recorded[2]] });
  assert.equal(fake.state.Web[authority(remote.ports.next)], undefined);
  assert.ok(fake.state.Web[authority(remote.ports.convex)]);
  assert.ok(fake.state.Web[authority(remote.ports.site)]);
  assert.deepEqual(fake.state.Web["agent.example.ts.net:443"], existing.Web["agent.example.ts.net:443"]);
});
