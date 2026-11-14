import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertIsolatedConvexState, backendEnvKeys, billingEnabled, childEnvironment, convexStateFile, gitRoot, mainCheckoutRoot,
  readEnvironment, saveEnvironment, worktreeConfig, worktreeCredentials,
} from "./bootstrap/config.mjs";
import { assertPortsAvailable, waitForServer } from "./bootstrap/network.mjs";
import { preflight } from "./doctor.mjs";
import { detachedLaunch } from "./bootstrap/detach.mjs";
import { createSupervisor, exitReason, superviseConvex, superviseNext, superviseWorktree, watchConvexPush } from "./bootstrap/processes.mjs";
import { reclaim } from "./bootstrap/reclaim.mjs";
import { bootstrapPaths, createStateRecorder, inspectState, liveStatuses, missedWebhooks, openLog, readState, reclaimableStatuses } from "./bootstrap/state.mjs";
import { chooseNetwork, cleanupProxies, readTailscaleStatus, serveWorktree, tailscaleConfig } from "./bootstrap/tailscale.mjs";

export {
  backendEnvKeys, childEnvironment, developmentCredentials, environmentFile, portBlockOverride, worktreeConfig, worktreeCredentials,
} from "./bootstrap/config.mjs";
export { assertPortsAvailable, waitForServer } from "./bootstrap/network.mjs";
export {
  darwinGroupMembers, descendantProcessGroups, signalProcessGroup, superviseConvex, superviseNext, superviseWorktree, watchConvexPush,
} from "./bootstrap/processes.mjs";

const usage = `pnpm bootstrap [--local | --tailscale] [--no-polar] [--detach] [--print]

Starts local Convex, Next.js, and Polar sandbox webhook forwarding for this worktree.
Uses private Tailscale HTTPS URLs when Tailscale is connected with HTTPS certificates,
and loopback URLs otherwise or when CI is set.

--local      Use loopback URLs without checking Tailscale.
--tailscale  Require Tailscale HTTPS URLs.
--no-polar   Start without billing credentials or webhook forwarding. Always
             on when app.config.ts sets billing: false.
--detach     Run in the background, detached from this terminal, and return once
             the run has started. On Linux with a systemd user manager it runs
             in its own scope, so ending an agent turn does not stop it. Output
             goes only to the log. Stop it with pnpm bootstrap:stop; it also
             stops when the worktree is removed.
--print      Print the effective configuration without changing anything.

BOOTSTRAP_PORT_BLOCK=<0-7499> in this worktree's .env.bootstrap.local (or the
environment) moves the worktree to another port block when its ports collide.
Use pnpm bootstrap:status, bootstrap:wait, and bootstrap:stop to control a run.`;

export function parseArguments(argv) {
  const known = ["--help", "--local", "--tailscale", "--no-polar", "--print", "--detach"];
  for (const arg of argv) {
    if (!known.includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    help: argv.includes("--help"),
    local: argv.includes("--local"),
    tailscale: argv.includes("--tailscale"),
    polar: !argv.includes("--no-polar"),
    print: argv.includes("--print"),
    detach: argv.includes("--detach"),
  };
}

function resolveNetwork(config, options) {
  const ci = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI.toLowerCase());
  const network = chooseNetwork({ ...options, ci, readStatus: readTailscaleStatus });
  return network.mode === "tailscale" ? { ...network, remote: tailscaleConfig(config, network.dnsName) } : network;
}

// A previous supervisor that died without its shutdown, or whose shutdown failed,
// left services or routes behind; reclaim them before this run replaces the state
// file that records them.
async function reclaimPreviousRun(stateFile) {
  const assertNotRunning = (current) => {
    if (liveStatuses.includes(current.status)) {
      throw new Error(`Bootstrap is already ${current.status} in this worktree (pid ${current.pid}). Use pnpm bootstrap:status or pnpm bootstrap:stop.`);
    }
  };
  const recorded = readState(stateFile);
  const current = inspectState(recorded);
  assertNotRunning(current);
  if (reclaimableStatuses.includes(current.status) && !(await reclaim(stateFile, recorded))) {
    // Another bootstrap may have claimed the state file meanwhile.
    assertNotRunning(inspectState(readState(stateFile)));
    throw new Error("The previous bootstrap left services or routes behind that could not be reclaimed.");
  }
}

// Starts the supervisor in its own session, and its own systemd scope where
// available, with output only in the log, so it outlives this command, its
// terminal, an agent's background task limit, and the end of the agent's turn. The
// mode resolved here is passed on, so the supervisor uses the URLs reported now.
// Returns once the new run has claimed the state file, so pnpm bootstrap:wait
// waits for this run rather than reading an earlier one's final state.
async function startDetached({ root, id, argv, network, paths, claimTimeoutMs = 60000 }) {
  await reclaimPreviousRun(paths.state);
  const args = [...argv.filter((arg) => !["--detach", "--local", "--tailscale"].includes(arg)), `--${network.mode}`];
  const launch = detachedLaunch({ id, command: process.execPath, args: [fileURLToPath(import.meta.url), ...args] });
  const child = spawn(launch.command, launch.args, { cwd: root, detached: true, stdio: "ignore" });
  let exit;
  child.once("error", (error) => { exit = `could not start: ${error.message}`; });
  child.once("exit", (code, signal) => { exit = signal ? `signal ${signal}` : `exit ${code}`; });
  const deadline = Date.now() + claimTimeoutMs;
  while (!child.pid || readState(paths.state)?.pid !== child.pid) {
    if (exit) throw new Error(`The detached bootstrap stopped before it started (${exit}). Run pnpm bootstrap without --detach to see why.`);
    if (Date.now() >= deadline) {
      // Not yet reaped, so the PID is still this child's.
      child.kill("SIGTERM");
      throw new Error(`The detached bootstrap did not start within ${claimTimeoutMs / 1000}s; it was stopped.`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  child.unref();
  console.log([
    launch.unit
      ? `Bootstrap is starting in the background (pid ${child.pid}) in the systemd user scope ${launch.unit}, so it keeps running after this terminal or agent turn ends.`
      : `Bootstrap is starting in the background (pid ${child.pid}), detached from this terminal.`,
    `Log: ${paths.log}`,
    "Run pnpm bootstrap:wait to wait until it is ready. Stop it with pnpm bootstrap:stop before you finish.",
  ].join("\n"));
}

// Child services must not inherit the terminal's signals or failed output streams.
function listenForStop(controller) {
  const stop = () => controller.abort(new Error("Bootstrap stopped."));
  const outputUnavailable = () => controller.abort(new Error("Bootstrap terminal output is unavailable."));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, stop);
  for (const stream of [process.stdout, process.stderr]) stream.on("error", outputUnavailable);
  return () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, stop);
    for (const stream of [process.stdout, process.stderr]) stream.removeListener("error", outputUnavailable);
  };
}

function serviceEnvironment(config, credentials, browserEnv) {
  const env = { ...childEnvironment(config, credentials), ...browserEnv };
  const outputGuard = fileURLToPath(new URL("./bootstrap-output-guard.mjs", import.meta.url));
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(outputGuard)}`.trim();
  // Services write to a pipe so bootstrap can tee their output into the log.
  if (process.stdout.isTTY && env.FORCE_COLOR === undefined && env.NO_COLOR === undefined) env.FORCE_COLOR = "1";
  return env;
}

// convex dev pushes as soon as its backend is up. Without the environment, that push
// fails on CLERK_JWT_ISSUER_DOMAIN, and the CLI can miss an env change that lands
// before it starts watching, leaving the stack waiting forever. So a database that
// lacks this environment gets it from a short-lived backend before the real one starts.
async function setEnvironmentBeforePush({ root, env, controller, log, healthUrl, start, setEnvironment, onServices }) {
  const setupController = new AbortController();
  const forwardAbort = () => setupController.abort(controller.signal.reason);
  controller.signal.addEventListener("abort", forwardAbort, { once: true });
  const setup = createSupervisor({ root, env, controller: setupController, log });
  try {
    start(setup);
    onServices(await setup.recordServiceGroups());
    await waitForServer(healthUrl, setupController.signal);
    await setEnvironment(setup);
  } finally {
    controller.signal.removeEventListener("abort", forwardAbort);
    await setup.stop();
  }
}

// polar listen reconnects after its event stream drops, but exits when the
// reconnect gets an error response, such as a 503 while Polar's sandbox API
// restarts. That exit restarts the forwarder instead of stopping the stack.
// Polar does not resend webhooks a listener missed, so each gap goes to the log
// and to the state file, where pnpm bootstrap:status shows it.
function forwardPolarWebhooks({ supervisor, args, tool, say, onServices, onForwarding }) {
  let missed = [];
  let restarts = 0;
  let stopped;
  return supervisor.keep(tool("polar"), args, {
    onExit: async (exit, delayMs) => {
      stopped = { from: new Date().toISOString(), reason: exitReason(exit) };
      onForwarding({ status: "restarting", since: stopped.from, reason: stopped.reason, restarts, missed });
      say(`Bootstrap: Polar webhook forwarding stopped (${stopped.reason}). Restarting it in ${delayMs / 1000}s.`, process.stderr);
      onServices(await supervisor.recordServiceGroups());
    },
    onRestart: async () => {
      const to = new Date().toISOString();
      onServices(await supervisor.recordServiceGroups());
      // Keep the latest gaps; a forwarder that keeps failing would grow the state file.
      missed = [...missed, { ...stopped, to }].slice(-20);
      restarts += 1;
      onForwarding({ status: "running", restarts, missed });
      say(`Bootstrap: Polar webhook forwarding restarted. ${missedWebhooks(missed.at(-1))}`, process.stderr);
    },
  });
}

// Starts Convex, Next.js, and Polar under the supervisor, then waits until stopped.
// env is shared with the supervisor; the Polar secret added here reaches later services.
async function runServices({ root, config, credentials, polar, browserEnv, env, supervisor, controller, log, say, onServices, onForwarding, onReady }) {
  const fileEnv = { ...childEnvironment(config, credentials, {}), ...browserEnv };
  const localFile = join(root, ".env.local");
  const stateFile = convexStateFile(root);
  const watchEnvFile = join(root, ".env.convex-watch.local");
  const orgArgs = credentials.POLAR_ORGANIZATION_ID ? ["--org", credentials.POLAR_ORGANIZATION_ID] : [];
  // Project CLIs run from node_modules/.bin instead of `pnpm exec`. The standalone
  // pnpm executable embeds a Node runtime that reads `--env-file <path>` anywhere in
  // its own argv, so `pnpm exec convex run --env-file <absolute path>` exits 9 before
  // the CLI starts, and a relative path loads the admin key into every nested process.
  const tool = (name) => join(root, "node_modules/.bin", name);
  let configured = false;
  const convexPush = watchConvexPush(controller);
  const restoreLocalSelection = () => {
    // The self-hosted watcher removes this selector once during startup. A removed
    // worktree has no file left to restore.
    if (configured && existsSync(localFile) && !readEnvironment(localFile).CONVEX_DEPLOYMENT) {
      appendFileSync(localFile, '\nCONVEX_DEPLOYMENT="local:anonymous-agent"\n');
    }
  };
  const saveWatchEnvironment = () => saveEnvironment(watchEnvFile, {
    CONVEX_SELF_HOSTED_URL: config.env.NEXT_PUBLIC_CONVEX_URL,
    CONVEX_SELF_HOSTED_ADMIN_KEY: JSON.parse(readFileSync(stateFile, "utf8")).adminKey,
  });

  try {
    // Lockfile changes merged from main must reach this worktree; this is fast when current.
    await supervisor.run(["install", "--frozen-lockfile", "--prefer-offline"], { terminal: false });
    if (polar) {
      const secret = (await supervisor.run(["listen", "--print-secret", ...orgArgs], { command: tool("polar"), capture: true })).trim();
      if (!secret || /\s/.test(secret)) throw new Error("Polar did not return a webhook signing secret. Check the sandbox token and CLI installation.");
      env.POLAR_WEBHOOK_SECRET = fileEnv.POLAR_WEBHOOK_SECRET = secret;
    }
    if (existsSync(localFile) && !existsSync(join(root, ".env.before-bootstrap.local"))) {
      writeFileSync(join(root, ".env.before-bootstrap.local"), readFileSync(localFile), { mode: 0o600 });
    }
    saveEnvironment(localFile, fileEnv);
    configured = true;
    const backendEnvFile = join(root, ".env.convex.local");
    const backendEnv = Object.fromEntries(Object.entries(fileEnv).filter(([key]) => backendEnvKeys.includes(key)));
    saveEnvironment(backendEnvFile, backendEnv);
    if (existsSync(stateFile)) saveWatchEnvironment();
    say(`Worktree: ${config.id}\nApp: ${config.env.APP_URL}\nConvex: ${config.env.NEXT_PUBLIC_CONVEX_URL}\nTarget: local-anonymous (database in this worktree's .convex directory)`);

    // --local-cloud-port and --local-site-port are hidden CLI flags with no public
    // equivalent; recheck them when upgrading Convex.
    const hostArgs = (start, ...flags) => ["dev", "--until-success", "--tail-logs", "disable", ...flags, "--start", start,
      "--local-cloud-port", String(config.ports.convex), "--local-site-port", String(config.ports.site)];
    const backendHealthUrl = `${config.env.NEXT_PUBLIC_CONVEX_URL}/version`;
    // `env set` never unsets a variable, so turning maintenance mode off removes it.
    const setBackendEnvironment = async (runner) => {
      await runner.run(["env", "set", "--from-file", backendEnvFile, "--force"], { command: tool("convex") });
      if (!backendEnv.MAINTENANCE_MODE) await runner.run(["env", "remove", "MAINTENANCE_MODE"], { command: tool("convex") });
      // Without a token the backend treats Polar as unconfigured, even after a run that set one.
      if (!backendEnv.POLAR_ACCESS_TOKEN) await runner.run(["env", "remove", "POLAR_ACCESS_TOKEN"], { command: tool("convex") });
    };
    // Lives beside the database, so pnpm db:reset clears it with the environment it records.
    const appliedEnvFile = join(dirname(stateFile), "bootstrap-env.sha256");
    const envDigest = createHash("sha256").update(JSON.stringify(backendEnv)).digest("hex");
    const envApplied = existsSync(appliedEnvFile) && readFileSync(appliedEnvFile, "utf8") === envDigest;
    if (!envApplied) {
      say("Setting the Convex environment before the first push.");
      const idle = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1e9)"`;
      await setEnvironmentBeforePush({
        root, env, controller, log, healthUrl: backendHealthUrl,
        start: (setup) => setup.start(tool("convex"), hostArgs(idle, "--typecheck", "disable", "--codegen", "disable"), { persistent: true, terminal: false }),
        setEnvironment: setBackendEnvironment,
        onServices,
      });
      writeFileSync(appliedEnvFile, envDigest, { mode: 0o600 });
    }

    // Keep the backend alive while the nested watcher syncs code. This avoids the
    // anonymous CLI's extra dashboard server, whose port cannot be configured.
    // Its shell runs in the worktree root; relative tool paths avoid quoting the root.
    const watchCommand = `./node_modules/.bin/convex dev --env-file .env.convex-watch.local --start "./node_modules/.bin/next dev --hostname 127.0.0.1 --port ${config.ports.next}"`;
    // Each persistent service is recorded as it starts and again once its children
    // exist, so a supervisor killed during a readiness wait can still be reclaimed.
    supervisor.start(tool("convex"), hostArgs(watchCommand), { persistent: true, onOutput: convexPush.write });
    onServices(await supervisor.recordServiceGroups());
    await waitForServer(backendHealthUrl, controller.signal);
    onServices(await supervisor.recordServiceGroups());
    supervisor.supervise(superviseConvex(backendHealthUrl, controller));
    saveWatchEnvironment();
    if (envApplied) await setBackendEnvironment(supervisor);
    if (polar) {
      void forwardPolarWebhooks({ supervisor, args: ["listen", config.env.POLAR_WEBHOOK_URL, ...orgArgs], tool, say, onServices, onForwarding });
      onServices(await supervisor.recordServiceGroups());
      say(`Polar sandbox webhooks: ${config.env.POLAR_WEBHOOK_URL}`);
    }
    // Next starts only after the initial Convex push, so its readiness also proves functions exist.
    await waitForServer(config.env.APP_URL, controller.signal);
    // Push failures from here on happen during development and leave the stack running.
    convexPush.stop();
    if (polar) await supervisor.run(["run", "--env-file", watchEnvFile, "billing/polar:syncCatalog", "{}"], { command: tool("convex") });
    onServices(await supervisor.recordServiceGroups());
    supervisor.supervise(superviseNext(config.env.APP_URL, controller));
    // The local Convex CLI rewrites its browser URLs during initial setup.
    if (Object.keys(browserEnv).length) saveEnvironment(localFile, fileEnv);
    restoreLocalSelection();
    await onReady(env.APP_URL);
    await new Promise((resolveStop) => {
      if (controller.signal.aborted) resolveStop();
      else controller.signal.addEventListener("abort", resolveStop, { once: true });
    });
    if (controller.signal.reason?.message !== "Bootstrap stopped.") throw controller.signal.reason;
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    convexPush.stop();
    await supervisor.stop();
    restoreLocalSelection();
  }
}

export async function bootstrap({ argv = process.argv.slice(2) } = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage);
    return;
  }
  const root = gitRoot();
  process.chdir(root);
  // An app that doesn't sell plans never needs Polar, as if run with --no-polar.
  const billing = billingEnabled(root);
  if (!billing) options.polar = false;
  const config = worktreeConfig(root);
  const network = resolveNetwork(config, options);
  if (options.print) {
    console.log(JSON.stringify({ ...config, mode: network.mode, ...network.remote && { tailscale: network.remote } }, null, 2));
    return;
  }
  const paths = bootstrapPaths(root);
  if (options.detach) {
    if (network.note) console.log(network.note);
    await startDetached({ root, id: config.id, argv, network, paths });
    return;
  }
  await reclaimPreviousRun(paths.state);
  const remote = network.remote;
  const urls = (env) => ({ app: env.APP_URL, convex: env.NEXT_PUBLIC_CONVEX_URL, site: env.NEXT_PUBLIC_CONVEX_SITE_URL });
  const log = openLog(paths.log);
  const state = createStateRecorder(paths.state, {
    worktreeId: config.id, root, mode: network.mode, polar: options.polar, ports: config.ports,
    urls: urls({ ...config.env, ...remote?.env }), log: paths.log,
  });
  state.update({ status: "starting" });
  const say = (message, stream = process.stdout) => {
    if (!stream.destroyed && stream.writable) stream.write(`${message}\n`);
    if (log.writable) log.write(`${message}\n`);
  };
  if (network.note) say(network.note);

  const controller = new AbortController();
  const removeStopListeners = listenForStop(controller);
  controller.signal.addEventListener("abort", () => state.update({ status: "stopping" }), { once: true });
  // .git is a file in a linked worktree and a directory in the main checkout; the
  // state file's directory is the worktree's Git admin directory.
  const watchingWorktree = superviseWorktree([join(root, ".git"), dirname(paths.state)], controller);
  let failure;
  let cleanup;
  // A detached run has no terminal, so this also goes to the log and the state file.
  let proxyCleanupError;
  const reportProxyCleanup = (message) => {
    proxyCleanupError = message;
    say(message, process.stderr);
  };
  try {
    const mainRoot = mainCheckoutRoot(root);
    const checks = preflight({ polar: options.polar, root, mainRoot });
    for (const warning of checks.warnings) say(`Warning: ${warning}`, process.stderr);
    if (checks.errors.length) throw new Error(`${checks.errors.join(" ")} Run pnpm setup:check for details.`);
    const credentials = worktreeCredentials(root, mainRoot, options.polar);
    // Its local backend also gets no Polar token, like a deployment without Polar.
    if (!billing) for (const key of Object.keys(credentials)) if (key.startsWith("POLAR_")) delete credentials[key];
    assertIsolatedConvexState(root);
    await assertPortsAvailable(config.ports);
    controller.signal.throwIfAborted();
    if (remote) {
      cleanup = await serveWorktree(config, remote, {
        report: reportProxyCleanup,
        onRoutes: ({ created, preserved }) => state.update({ tailscale: {
          hostname: remote.hostname, ports: remote.ports, createdRoutes: created, preservedRoutes: preserved,
        } }),
      });
    }
    const browserEnv = remote?.env ?? {};
    const env = serviceEnvironment(config, credentials, browserEnv);
    const supervisor = createSupervisor({ root, env, controller, log });
    await runServices({
      root, config, credentials, polar: options.polar, browserEnv, env, supervisor, controller, log, say,
      // Recorded so a later bootstrap or bootstrap:stop can reclaim them if this process is killed.
      onServices: (services) => state.update({ services }),
      onForwarding: (polarForwarding) => state.update({ polarForwarding }),
      onReady: async (appUrl) => {
        if (remote) {
          await waitForServer(remote.env.APP_URL, controller.signal);
          await waitForServer(`${remote.env.NEXT_PUBLIC_CONVEX_URL}/version`, controller.signal);
        }
        state.update({ status: "ready" });
        say(`Ready: ${appUrl} (Ctrl+C or pnpm bootstrap:stop stops all services)`);
      },
    });
  } catch (error) {
    if (error.message !== "Bootstrap stopped.") failure = error;
  } finally {
    controller.abort(new Error("Bootstrap stopped."));
    await watchingWorktree;
    if (cleanup && !cleanupProxies(cleanup, reportProxyCleanup)) failure ??= new Error("Tailscale proxy cleanup failed; check tailscale serve status.");
    state.update({ status: failure ? "failed" : "stopped", error: failure?.message, proxyCleanupError });
    if (failure) say(`Bootstrap: ${failure.message}`, process.stderr);
    await new Promise((resolveLog) => log.end(resolveLog));
    removeStopListeners();
  }
  if (failure) throw Object.assign(failure, { reported: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  bootstrap().catch((error) => {
    if (!error.reported && !process.stderr.destroyed) console.error(`Bootstrap: ${error.message}`);
    process.exitCode = 1;
  });
}
