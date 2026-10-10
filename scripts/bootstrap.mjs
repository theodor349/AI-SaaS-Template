import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync, chmodSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export function worktreeConfig(root) {
  const hash = createHash("sha256").update(root).digest("hex");
  // ponytail: finite port space can collide; fail on occupied ports rather than change URLs.
  const firstPort = 10000 + (Number.parseInt(hash.slice(0, 8), 16) % 12000) * 3;
  const id = `wt-${hash.slice(0, 12)}`;
  const ports = { next: firstPort, convex: firstPort + 1, site: firstPort + 2 };
  const appUrl = `http://127.0.0.1:${ports.next}`;
  return {
    root, id, ports,
    env: {
      WORKTREE_ID: id,
      PORT: String(ports.next),
      APP_URL: appUrl,
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${ports.convex}`,
      NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${ports.site}`,
      POLAR_ENVIRONMENT: "sandbox",
      POLAR_SUCCESS_URL: `${appUrl}/`,
      POLAR_WEBHOOK_URL: `http://127.0.0.1:${ports.site}/webhooks/polar`,
    },
  };
}

export function developmentCredentials(values, polar = true) {
  if (!values.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
      !values.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Clerk development keys are required in .env.bootstrap.local (pk_test_ and sk_test_).");
  }
  const domain = Buffer.from(values.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice(8), "base64")
    .toString("utf8").replace(/\$$/, "");
  if (!/^[a-z0-9.-]+\.accounts\.dev$/.test(domain)) {
    throw new Error("The Clerk development publishable key does not contain a valid accounts.dev domain.");
  }
  const issuer = `https://${domain}`;
  if (values.CLERK_JWT_ISSUER_DOMAIN && values.CLERK_JWT_ISSUER_DOMAIN.replace(/\/$/, "") !== issuer) {
    throw new Error("CLERK_JWT_ISSUER_DOMAIN must match the Clerk development publishable key.");
  }
  if (polar && !values.POLAR_ACCESS_TOKEN) {
    throw new Error("POLAR_ACCESS_TOKEN is required. Add a sandbox token to .env.bootstrap.local, or use --no-polar.");
  }
  if (values.CLERK_WEBHOOK_SIGNING_SECRET &&
      !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(values.CLERK_WEBHOOK_SIGNING_SECRET)) {
    throw new Error("CLERK_WEBHOOK_SIGNING_SECRET must be a Svix signing secret (whsec_...).");
  }
  // Local signed HTTP tests need a secret even without a public Clerk endpoint.
  // The generated value stays in this worktree and survives bootstrap restarts.
  return { ...values, CLERK_JWT_ISSUER_DOMAIN: issuer,
    CLERK_WEBHOOK_SIGNING_SECRET: values.CLERK_WEBHOOK_SIGNING_SECRET || `whsec_${randomBytes(32).toString("base64")}`,
  };
}

export function childEnvironment(config, credentials, inherited = process.env) {
  const env = {
    ...inherited, ...credentials, ...config.env,
    CONVEX_DEPLOYMENT: "local:anonymous-agent",
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_ALLOW_ANONYMOUS: "true",
  };
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"]) {
    delete env[key];
  }
  return env;
}

export function environmentFile(values) {
  return Object.entries(values).map(([name, value]) => {
    const text = String(value);
    const quote = ['"', "'", "`"].find((candidate) => !text.includes(candidate));
    const line = `${name}=${quote ? `${quote}${text}${quote}` : text}`;
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || parseEnv(line)[name] !== text) {
      throw new Error(`Cannot serialize environment variable ${name} without changing its value.`);
    }
    return line;
  }).join("\n") + "\n";
}

export async function assertPortsAvailable(ports) {
  for (const [service, port] of Object.entries(ports)) {
    const occupied = () => new Error(`${service} port ${port} is occupied. Stop the other process or use a different worktree path.`);
    // macOS can allow a loopback bind beside an existing wildcard listener.
    // Connect first so we cannot take over that listener's traffic.
    await new Promise((resolvePort, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(2000, () => socket.destroy(new Error(`Timed out checking ${service} port ${port}.`)));
      socket.once("connect", () => { socket.destroy(); reject(occupied()); });
      socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolvePort() : reject(error));
    });
    await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once("error", () => reject(occupied()));
      server.listen(port, "127.0.0.1", () => server.close(resolvePort));
    });
  }
}

export async function waitForServer(url, signal) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      signal.throwIfAborted();
    }
    await delay(250, undefined, { signal });
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

export async function superviseConvex(url, controller) {
  const { signal } = controller;
  try {
    while (!signal.aborted) {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await delay(1000, undefined, { signal });
    }
  } catch (error) {
    if (!signal.aborted) controller.abort(new Error(`Convex backend is unavailable at ${url}: ${error.message}`, { cause: error }));
  }
}

export async function superviseNext(url, controller) {
  const { hostname, port } = new URL(url);
  const { signal } = controller;
  let unavailableSince;
  while (!signal.aborted) {
    try {
      // Check the listener, so compilation errors and slow pages do not stop development.
      await new Promise((resolveConnection, reject) => {
        const socket = createConnection({ host: hostname, port: Number(port), signal });
        socket.setTimeout(2000, () => socket.destroy(new Error("Connection timed out.")));
        socket.once("error", reject);
        socket.once("connect", () => { socket.destroy(); resolveConnection(); });
      });
      unavailableSince = undefined;
    } catch {
      if (signal.aborted) return;
      unavailableSince ??= Date.now();
      // Next briefly closes its listener when restarting after config changes.
      if (Date.now() - unavailableSince >= 5000) {
        controller.abort(new Error(`Next server is unavailable at ${url}.`));
        return;
      }
    }
    await delay(1000, undefined, { signal }).catch(() => {});
  }
}

export function descendantProcessGroups(pids, processTable) {
  const rows = processTable.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = new Set(pids);
  let previousSize;
  do {
    previousSize = descendants.size;
    for (const [pid, parent] of rows) {
      if (descendants.has(parent)) descendants.add(pid);
    }
  } while (descendants.size !== previousSize);
  return [...new Set([...pids, ...rows.filter(([pid]) => descendants.has(pid)).map(([, , group]) => group)])]
    .filter((group) => Number.isInteger(group) && group > 1);
}

export function signalProcessGroup(group, signal) {
  if (!Number.isInteger(group) || group <= 1) throw new Error(`Invalid process group ${group}.`);
  try {
    process.kill(process.platform === "win32" ? group : -group, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (process.platform === "darwin" && error.code === "EPERM") {
      // macOS returns EPERM for groups with only zombies. They need no signals.
      const rows = execFileSync("ps", ["-eo", "pgid=,stat="], { encoding: "utf8" }).trim().split("\n");
      const live = rows.some((row) => {
        const [id, state] = row.trim().split(/\s+/);
        return Number(id) === group && state && !state.startsWith("Z");
      });
      if (!live) return false;
    }
    throw error;
  }
}

function readEnvironment(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

function saveEnvironment(file, values) {
  writeFileSync(file, environmentFile(values), { mode: 0o600 });
  chmodSync(file, 0o600);
}

// A copied template's blank signing secret must not replace a persisted secret.
function credentialOverrides(values) {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) =>
    key !== "CLERK_WEBHOOK_SIGNING_SECRET" || value !== ""));
}

export function worktreeCredentials(root, mainRoot, polar = true, inherited = process.env) {
  const sharedKeys = readEnvironment(join(mainRoot, ".env.bootstrap.local"));
  // Existing development keys remain usable; never copy another checkout's URLs or cloud target.
  const mainKeys = readEnvironment(join(mainRoot, ".env.local"));
  if (mainKeys.WORKTREE_ID === worktreeConfig(realpathSync(mainRoot)).id) delete mainKeys.CLERK_JWT_ISSUER_DOMAIN;
  const providerNames = ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET", "CLERK_JWT_ISSUER_DOMAIN", "POLAR_ACCESS_TOKEN", "POLAR_ORGANIZATION_ID", "POLAR_PRODUCT_MONTHLY", "POLAR_PRODUCT_YEARLY", "POLAR_PRODUCT_LIFETIME"];
  // A main checkout's .env.local may contain its generated test signing secret.
  // Share signing secrets only from explicit bootstrap settings, not that file.
  const providerKeys = Object.fromEntries(Object.entries(mainKeys).filter(([key]) =>
    providerNames.includes(key) && key !== "CLERK_WEBHOOK_SIGNING_SECRET"));
  const localKeys = readEnvironment(join(root, ".env.local"));
  // Re-derive generated issuers after a worktree overrides its Clerk key pair.
  if (localKeys.WORKTREE_ID === worktreeConfig(root).id) delete localKeys.CLERK_JWT_ISSUER_DOMAIN;
  return developmentCredentials({
    ...providerKeys, ...sharedKeys, ...localKeys,
    ...credentialOverrides(readEnvironment(join(root, ".env.bootstrap.local"))),
    ...credentialOverrides(Object.fromEntries(Object.entries(inherited).filter(([key]) => providerNames.includes(key)))),
  }, polar);
}

async function bootstrap() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("pnpm bootstrap [--no-polar] [--print]\n\nStarts local Convex, Next.js, and Polar sandbox webhook forwarding.\n--no-polar  Start without billing credentials or webhook forwarding.\n--print     Print path-derived configuration without changing anything.");
    return;
  }
  for (const arg of args) {
    if (!["--no-polar", "--print"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  const root = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  process.chdir(root);
  const config = worktreeConfig(root);
  if (args.includes("--print")) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  const polar = !args.includes("--no-polar");
  const commonGitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const mainRoot = dirname(commonGitDir);
  const localFile = join(root, ".env.local");
  const credentials = worktreeCredentials(root, mainRoot, polar);
  const env = childEnvironment(config, credentials);
  const fileEnv = childEnvironment(config, credentials, {});
  const stateFile = join(root, ".convex/local/default/config.json");
  if (existsSync(stateFile)) {
    if (JSON.parse(readFileSync(stateFile, "utf8")).deploymentName !== "anonymous-agent") {
      throw new Error("This checkout already has another local Convex deployment. Use a fresh worktree to keep its data intact.");
    }
  } else if (existsSync(join(process.env.HOME, ".convex/anonymous-convex-backend-state/anonymous-agent"))) {
    throw new Error("Legacy anonymous-agent Convex state exists outside this checkout. Migrate it before bootstrapping isolated worktrees.");
  }
  await assertPortsAvailable(config.ports);

  const controller = new AbortController();
  const children = [];
  let serviceGroups = [];
  let stopping = false;
  let configured = false;
  const supervision = [];
  const restoreLocalSelection = () => {
    // The self-hosted watcher removes this selector once during startup.
    if (configured && !readEnvironment(localFile).CONVEX_DEPLOYMENT) {
      appendFileSync(localFile, '\nCONVEX_DEPLOYMENT="local:anonymous-agent"\n');
    }
  };
  const signalHandler = () => controller.abort(new Error("Bootstrap stopped."));
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
  process.on("SIGHUP", signalHandler);

  function start(command, commandArgs, persistent = false, capture = false) {
    controller.signal.throwIfAborted();
    // Polar prints its signing secret during startup. Capture only --print-secret;
    // discard other Polar output, including stderr, to keep credentials private.
    const quiet = command === "pnpm" && commandArgs[0] === "exec" && commandArgs[1] === "polar";
    const child = spawn(command, commandArgs, {
      cwd: root, env, detached: process.platform !== "win32",
      stdio: ["ignore", capture ? "pipe" : quiet ? "ignore" : "inherit", quiet ? "ignore" : "inherit"],
    });
    let output = "";
    if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
    const done = new Promise((resolveChild) => {
      child.once("error", (error) => resolveChild({ error }));
      child.once("close", (code, signal) => resolveChild({ code, signal, output }));
    });
    children.push({ child, done, persistent });
    if (persistent) {
      void done.then(() => {
        if (!stopping) controller.abort(new Error(`${command} ${commandArgs.slice(0, 2).join(" ")} exited unexpectedly.`));
      });
    }
    return done;
  }

  async function run(commandArgs, capture = false) {
    const result = await start("pnpm", commandArgs, false, capture);
    controller.signal.throwIfAborted();
    if (result.error || result.code !== 0) {
      throw new Error(`pnpm ${commandArgs.slice(0, 3).join(" ")} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.code})`}.`);
    }
    return result.output;
  }

  try {
    if (!existsSync(join(root, "node_modules/convex")) || (polar && !existsSync(join(root, "node_modules/@polar-sh/cli")))) {
      await run(["install", "--frozen-lockfile"]);
    }
    if (polar) {
      const orgArgs = credentials.POLAR_ORGANIZATION_ID ? ["--org", credentials.POLAR_ORGANIZATION_ID] : [];
      const secret = (await run(["exec", "polar", "listen", "--print-secret", ...orgArgs], true)).trim();
      if (!secret || /\s/.test(secret)) throw new Error("Polar did not return a webhook signing secret. Check the sandbox token and CLI installation.");
      env.POLAR_WEBHOOK_SECRET = fileEnv.POLAR_WEBHOOK_SECRET = secret;
    }
    if (existsSync(localFile) && !existsSync(join(root, ".env.before-bootstrap.local"))) {
      writeFileSync(join(root, ".env.before-bootstrap.local"), readFileSync(localFile), { mode: 0o600 });
    }
    saveEnvironment(localFile, fileEnv);
    configured = true;
    const backendEnv = Object.fromEntries(Object.entries(fileEnv).filter(([key]) =>
      ["WORKTREE_ID", "APP_URL", "CLERK_JWT_ISSUER_DOMAIN", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET", "POLAR_ACCESS_TOKEN", "POLAR_ENVIRONMENT", "POLAR_WEBHOOK_SECRET", "POLAR_SUCCESS_URL", "POLAR_ORGANIZATION_ID", "POLAR_PRODUCT_MONTHLY", "POLAR_PRODUCT_YEARLY", "POLAR_PRODUCT_LIFETIME"].includes(key)));
    const backendEnvFile = join(root, ".env.convex.local");
    saveEnvironment(backendEnvFile, backendEnv);
    const watchEnvFile = join(root, ".env.convex-watch.local");
    const saveWatchEnvironment = () => {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      saveEnvironment(watchEnvFile, {
        CONVEX_SELF_HOSTED_URL: config.env.NEXT_PUBLIC_CONVEX_URL,
        CONVEX_SELF_HOSTED_ADMIN_KEY: state.adminKey,
      });
    };
    if (existsSync(stateFile)) saveWatchEnvironment();
    console.log(`Worktree: ${config.id}\nApp: ${config.env.APP_URL}\nConvex: ${config.env.NEXT_PUBLIC_CONVEX_URL}\nTarget: local-anonymous (database in this worktree's .convex directory)`);
    // Keep the backend alive while the nested watcher syncs code. This avoids the
    // anonymous CLI's extra dashboard server, whose port cannot be configured.
    const watchCommand = `pnpm exec convex dev --env-file .env.convex-watch.local --start "pnpm exec next dev --hostname 127.0.0.1 --port ${config.ports.next}"`;
    start("pnpm", ["exec", "convex", "dev", "--until-success", "--tail-logs", "disable", "--run-sh", watchCommand, "--local-cloud-port", String(config.ports.convex), "--local-site-port", String(config.ports.site)], true);
    const backendHealthUrl = `${config.env.NEXT_PUBLIC_CONVEX_URL}/version`;
    await waitForServer(backendHealthUrl, controller.signal);
    supervision.push(superviseConvex(backendHealthUrl, controller));
    saveWatchEnvironment();
    await run(["exec", "convex", "env", "set", "--from-file", backendEnvFile, "--force"]);
    if (polar) {
      const orgArgs = credentials.POLAR_ORGANIZATION_ID ? ["--org", credentials.POLAR_ORGANIZATION_ID] : [];
      start("pnpm", ["exec", "polar", "listen", config.env.POLAR_WEBHOOK_URL, ...orgArgs], true);
      console.log(`Polar sandbox webhooks: ${config.env.POLAR_WEBHOOK_URL}`);
    }
    // Next starts only after the initial Convex push, so its readiness also proves functions exist.
    await waitForServer(config.env.APP_URL, controller.signal);
    if (polar && ["POLAR_PRODUCT_MONTHLY", "POLAR_PRODUCT_YEARLY", "POLAR_PRODUCT_LIFETIME"].every(key => credentials[key])) {
      await run(["exec", "convex", "run", "--env-file", watchEnvFile, "polar:syncCatalog", "{}"]);
    }
    if (process.platform !== "win32") {
      serviceGroups = descendantProcessGroups(children.filter(({ persistent }) => persistent).map(({ child }) => child.pid),
        execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" }));
    }
    supervision.push(superviseNext(config.env.APP_URL, controller));
    restoreLocalSelection();
    console.log(`Ready: ${config.env.APP_URL} (Ctrl+C stops all services)`);
    await new Promise((resolveStop) => {
      if (controller.signal.aborted) resolveStop();
      else controller.signal.addEventListener("abort", resolveStop, { once: true });
    });
    if (controller.signal.reason?.message !== "Bootstrap stopped.") throw controller.signal.reason;
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    stopping = true;
    controller.abort(new Error("Bootstrap stopped."));
    await Promise.all(supervision);
    const pids = children.filter(({ child, persistent }) => child.pid && (persistent || (child.exitCode === null && child.signalCode === null))).map(({ child }) => child.pid);
    const groups = process.platform === "win32" ? pids : [...new Set([...serviceGroups, ...descendantProcessGroups(pids,
      execFileSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" }))])];
    const running = (group) => signalProcessGroup(group, 0);
    for (const group of groups) signalProcessGroup(group, "SIGTERM");
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && groups.some(running)) await delay(50);
    for (const group of groups) if (running(group)) signalProcessGroup(group, "SIGKILL");
    await Promise.all(children.map(({ done }) => done));
    restoreLocalSelection();
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
    process.removeListener("SIGHUP", signalHandler);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  bootstrap().catch((error) => {
    if (error.message !== "Bootstrap stopped.") {
      console.error(`Bootstrap: ${error.message}`);
      process.exitCode = 1;
    }
  });
}
