import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { worktreeConfig, worktreeCredentials } from "./bootstrap/config.mjs";
import { assertPortsAvailable } from "./bootstrap/network.mjs";
import { bootstrapPaths, inspectState, liveStatuses, readState } from "./bootstrap/state.mjs";

const run = promisify(execFile);
const minimumGh = "2.99.0";
const icons = { ok: "✓", warn: "!", fail: "✗", skip: "-" };
const productModels = { POLAR_PRODUCT_MONTHLY: "monthly", POLAR_PRODUCT_YEARLY: "yearly", POLAR_PRODUCT_LIFETIME: "lifetime" };
// Read from the checkout being checked, not this file's location, so copies of the script work.
const readPackageJson = (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const result = (status) => (name, detail, fix) => ({ name, status, detail, ...(fix && status !== "ok" ? { fix } : {}) });
export const ok = result("ok");
export const warn = result("warn");
export const fail = result("fail");
export const skip = result("skip");

export function compareVersions(a, b) {
  const parse = version => String(version).replace(/^v/, "").split(/[.+-]/).slice(0, 3).map(Number);
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

// A warning, not a failure: a fresh worktree has no node_modules until bootstrap installs them.
export function dependencyCheck(root, packageJson) {
  const fix = "Run `pnpm install`; `pnpm bootstrap` also installs them.";
  if (!existsSync(join(root, "node_modules"))) return warn("Dependencies", "node_modules is missing; tests, lint, and scripts need it", fix);
  const missing = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })
    .filter(name => !existsSync(join(root, "node_modules", name, "package.json")));
  if (!missing.length) return ok("Dependencies", "installed");
  const listed = missing.length > 3 ? `${missing.slice(0, 3).join(", ")} and ${missing.length - 3} more` : missing.join(", ");
  return warn("Dependencies", `${listed} ${missing.length === 1 ? "is" : "are"} not installed`, fix);
}

// Newer majors usually work, so they warn; older majors fail.
export function nodeCheck(version = process.version, engines) {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  const required = Number(engines.match(/\d+/)?.[0]);
  const fix = `Install Node ${required} (see .node-version), e.g. \`fnm use\` or \`nvm use ${required}\`.`;
  if (major === required) return ok("Node", `${version} matches engines ${engines}`);
  if (major > required) return warn("Node", `${version} is newer than engines ${engines}; it may work, but CI and Vercel use ${required}`, fix);
  return fail("Node", `${version} is older than engines ${engines}`, fix);
}

export function pnpmCheck(version, packageManager) {
  const expected = packageManager.replace(/^pnpm@/, "").split("+")[0];
  const fix = `Run \`corepack enable\` so pnpm follows packageManager (pnpm@${expected}).`;
  if (!version) return fail("pnpm", "pnpm is not installed", fix);
  if (version === expected) return ok("pnpm", `${version} matches packageManager`);
  if (version.split(".")[0] === expected.split(".")[0]) return warn("pnpm", `${version} differs from packageManager ${expected}`, fix);
  return fail("pnpm", `${version} has a different major version than packageManager ${expected}`, fix);
}

export function ghVersionCheck(output, minimum = minimumGh) {
  const version = output?.match(/gh version (\d+\.\d+\.\d+)/)?.[1];
  if (!version) return warn("gh", "GitHub CLI is not installed; PR workflows need it", "Install it with `brew install gh`.");
  if (compareVersions(version, minimum) < 0) {
    return warn("gh", `${version} is older than ${minimum}, which PR evidence uploads (--attach) need`, "Run `brew upgrade gh`.");
  }
  return ok("gh", `${version}`);
}

export function tailscaleChecks(status) {
  const name = "Tailscale";
  const fix = "Tailscale mode needs this; bootstrap falls back to loopback URLs without it.";
  if (!status) return [warn(name, "not installed or the daemon is unavailable", `Install Tailscale and connect this machine. ${fix}`)];
  if (status.BackendState !== "Running") {
    return [warn(name, `not connected (state ${status.BackendState ?? "unknown"})`, `Connect with \`tailscale up\`. ${fix}`)];
  }
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "").toLowerCase() ?? "";
  if (status.CurrentTailnet?.MagicDNSEnabled === false || !/\.ts\.net$/.test(dnsName)) {
    return [warn(name, "connected, but MagicDNS has no .ts.net name for this machine", `Enable MagicDNS in the Tailscale admin console (DNS). ${fix}`)];
  }
  if (!status.CertDomains?.some(domain => domain.toLowerCase() === dnsName)) {
    return [warn(name, `${dnsName} has no HTTPS certificate domain`, `Enable HTTPS Certificates in the Tailscale admin console (DNS). ${fix}`)];
  }
  return [ok(name, `running with HTTPS at ${dnsName}`)];
}

// Mirrors the catalog rules in convex/billing/polar.ts validateProduct, which fail bootstrap's syncCatalog.
export function polarProductProblem(product, model, organizationId) {
  const prices = product.prices.filter(price => !price.is_archived);
  if (product.is_archived) return "is archived";
  if (organizationId && product.organization_id !== organizationId) return "belongs to another organization";
  if (prices.length !== 1) return `has ${prices.length} active prices; exactly one is required`;
  if (prices[0].amount_type !== "fixed" || !(prices[0].price_amount > 0)) return "needs a paid fixed price";
  const interval = { monthly: "month", yearly: "year", lifetime: null }[model];
  if (product.is_recurring !== (model !== "lifetime") || product.recurring_interval !== interval ||
      (model !== "lifetime" && product.recurring_interval_count !== 1)) {
    return model === "lifetime" ? "must be a one-time product" : `must recur every 1 ${interval}`;
  }
}

export function convexTemplateCheck(templates) {
  const name = "Clerk convex JWT template";
  const template = templates.find(item => item.name === "convex");
  const fix = "In the Clerk dashboard, add a JWT template from the Convex preset named `convex` (README step 2).";
  if (!template) return fail(name, "missing; Convex cannot authenticate signed-in users", fix);
  const audience = [template.claims?.aud].flat();
  if (!audience.includes("convex")) {
    return fail(name, "claims do not set aud to \"convex\", which convex/auth.config.js requires", "Set `\"aud\": \"convex\"` in the template's claims.");
  }
  if (template.custom_signing_key) {
    return fail(name, "uses a custom signing key; Convex verifies Clerk's JWKS", "Disable the custom signing key on the template.");
  }
  return ok(name, "present with aud \"convex\"");
}

export function summarize(results) {
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const { status } of results) counts[status]++;
  return { ...counts, exitCode: counts.fail ? 1 : 0 };
}

export function formatResults(results) {
  const lines = results.flatMap(({ name, status, detail, fix }) =>
    [`${icons[status]} ${name}: ${detail}`, ...(fix ? [`    ${fix}`] : [])]);
  const { warn: warnings, fail: failures, skip: skipped } = summarize(results);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  lines.push("", `${plural(failures, "failure")}, ${plural(warnings, "warning")}${skipped ? `, ${skipped} skipped` : ""}.`);
  return lines.join("\n");
}

function checkoutRoots() {
  const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
  return { root: realpathSync(git(["rev-parse", "--show-toplevel"])),
    mainRoot: dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"])) };
}

// Main checkout settings are what new worktrees inherit; credentials elsewhere only cover this one.
function settingsCheck(root, mainRoot, polar, env = process.env) {
  const file = join(mainRoot, ".env.bootstrap.local");
  const fix = `Copy .env.bootstrap.example to ${file} and add Clerk development keys${polar ? " and Polar sandbox settings" : ""}.`;
  if (existsSync(file)) return { check: ok("Shared settings", `${file} exists`) };
  try {
    const credentials = worktreeCredentials(root, mainRoot, polar, env);
    return { credentials, check: warn("Shared settings", `${file} is missing; this worktree resolves credentials elsewhere, but new worktrees will not inherit them`, fix) };
  } catch (error) {
    return { error, check: fail("Shared settings", `${file} is missing`, fix) };
  }
}

// Fast and offline for bootstrap to run before it starts services.
export function preflight({ polar = true, root, mainRoot, env = process.env } = {}) {
  if (!root || !mainRoot) ({ root, mainRoot } = checkoutRoots());
  const warnings = [];
  const errors = [];
  const engines = existsSync(join(root, "package.json")) ? readPackageJson(root).engines?.node : undefined;
  const checks = [...engines ? [nodeCheck(process.version, engines)] : [], settingsCheck(root, mainRoot, polar, env).check];
  for (const { status, detail, fix, name } of checks) {
    const message = `${name}: ${detail}.${fix ? ` ${fix}` : ""}`;
    if (status === "warn") warnings.push(message);
    if (status === "fail") errors.push(message);
  }
  return { warnings, errors };
}

function credentialChecks(root, mainRoot) {
  const settings = settingsCheck(root, mainRoot, false);
  const results = [settings.check];
  let credentials;
  try { credentials = settings.credentials ?? worktreeCredentials(root, mainRoot, false); }
  catch (error) {
    results.push(fail("Clerk keys", error.message, "Fix the Clerk development keys in the main checkout's .env.bootstrap.local."));
    return { results };
  }
  results.push(ok("Clerk keys", `pk_test_… and sk_test_… for ${new URL(credentials.CLERK_JWT_ISSUER_DOMAIN).host}`));
  const polarFix = "Billing stays off until set; `pnpm bootstrap --no-polar` works meanwhile.";
  results.push(credentials.POLAR_ACCESS_TOKEN
    ? ok("Polar token", "POLAR_ACCESS_TOKEN is set")
    : warn("Polar token", "POLAR_ACCESS_TOKEN is not set", `Create an organization access token at sandbox.polar.sh and add it to .env.bootstrap.local. ${polarFix}`));
  const missing = Object.keys(productModels).filter(key => !credentials[key]);
  results.push(missing.length
    ? warn("Polar products", `${missing.join(", ")} not set`, `Add the sandbox product IDs to .env.bootstrap.local. ${polarFix}`)
    : ok("Polar products", "monthly, yearly, and lifetime product IDs are set"));
  return { results, credentials };
}

async function clerkChecks(credentials) {
  const request = async path => {
    const response = await fetch(`https://api.clerk.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${credentials.CLERK_SECRET_KEY}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    return response.json();
  };
  let templates, domains;
  try { [templates, domains] = await Promise.all([request("jwt_templates"), request("domains")]); }
  catch (error) {
    const rejected = [401, 403].includes(error.status);
    return [fail("Clerk API", rejected ? "CLERK_SECRET_KEY was rejected" : `request failed (${error.message})`,
      rejected ? "Copy the development instance's secret key from the Clerk dashboard (API keys)." : "Check the network connection, or use --offline.")];
  }
  const frontends = (domains.data ?? []).map(domain => `https://${domain.frontend_api_url.replace(/^https:\/\//, "")}`);
  const pair = frontends.includes(credentials.CLERK_JWT_ISSUER_DOMAIN)
    ? ok("Clerk API", "secret key accepted and matches the publishable key's instance")
    : fail("Clerk API", "the secret key belongs to a different Clerk instance than the publishable key", "Copy both keys from the same Clerk development instance.");
  return [pair, convexTemplateCheck(Array.isArray(templates) ? templates : templates.data ?? [])];
}

// Withdrawals refund through Polar. A refund for an order that doesn't exist
// is rejected for a missing scope (403) before the order is looked up.
async function polarRefundsCheck(polar) {
  const name = "Polar refunds";
  const fix = "Create the organization access token with the refunds:read and refunds:write scopes.";
  try {
    await polar.refunds.list({ limit: 1 });
    await polar.refunds.create({ order_id: "00000000-0000-0000-0000-000000000000", amount: 1, reason: "customer_request" });
  } catch (error) {
    if (error.statusCode === 403) return warn(name, "the token can't create refunds, so withdrawals can't be refunded", fix);
    if (![404, 422].includes(error.statusCode)) return warn(name, `request failed (${error.statusCode ?? error.message})`, fix);
  }
  return ok(name, "the token can create refunds");
}

async function polarChecks(credentials) {
  if (!credentials?.POLAR_ACCESS_TOKEN) return [skip("Polar API", "no POLAR_ACCESS_TOKEN")];
  let createPolar;
  try { ({ createPolar } = await import("@polar-sh/sdk/2026-10")); }
  catch { return [skip("Polar API", "@polar-sh/sdk is not installed")]; }
  const polar = createPolar({ accessToken: credentials.POLAR_ACCESS_TOKEN, environment: "sandbox", timeout: 15 });
  const tokenFix = "Create an organization access token at sandbox.polar.sh (not polar.sh).";
  let organizations;
  try { organizations = (await polar.organizations.list({ limit: 100 })).items; }
  catch (error) {
    const rejected = [401, 403].includes(error.statusCode);
    return [fail("Polar API", rejected ? "the sandbox rejected POLAR_ACCESS_TOKEN" : `request failed (${error.statusCode ?? error.message})`,
      rejected ? tokenFix : "Check the network connection, or use --offline.")];
  }
  const configured = credentials.POLAR_ORGANIZATION_ID;
  const organization = configured ? organizations.find(item => item.id === configured) : organizations.length === 1 && organizations[0];
  if (!organization) {
    const detail = configured ? "POLAR_ORGANIZATION_ID is not accessible with this token"
      : organizations.length ? `the token can access ${organizations.length} organizations` : "the token cannot access any organization";
    const fix = configured || !organizations.length ? tokenFix : "Set POLAR_ORGANIZATION_ID in .env.bootstrap.local.";
    return [fail("Polar organization", detail, fix)];
  }
  const results = [ok("Polar organization", `token accepted for "${organization.name}"`), await polarRefundsCheck(polar)];
  await Promise.all(Object.entries(productModels).map(async ([key, model]) => {
    if (!credentials[key]) return;
    const name = `Polar ${model} product`;
    const fix = `Point ${key} at an active ${model === "lifetime" ? "one-time" : `${model} recurring`} product with one paid fixed price in the sandbox organization.`;
    try {
      const product = await polar.products.get(credentials[key]);
      const problem = polarProductProblem(product, model, organization.id);
      const price = product.prices.find(item => !item.is_archived);
      results.push(problem ? fail(name, `"${product.name}" ${problem}`, fix)
        : ok(name, `"${product.name}" at ${(price.price_amount / 100).toFixed(2)} ${price.price_currency.toUpperCase()}`));
    } catch (error) {
      results.push(fail(name, [404, 422].includes(error.statusCode) ? `${key} was not found in the sandbox` : `request failed (${error.statusCode ?? error.message})`, fix));
    }
  }));
  const order = Object.values(productModels).map(model => `Polar ${model} product`);
  return results.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

async function command(file, args) {
  try { return (await run(file, args, { encoding: "utf8", timeout: 15000 })).stdout; }
  catch { return undefined; }
}

async function pnpmVersion() {
  const agent = process.env.npm_config_user_agent?.match(/pnpm\/(\d+\.\d+\.\d+)/)?.[1];
  return agent ?? (await command("pnpm", ["--version"]))?.trim();
}

async function ghChecks(offline) {
  const version = ghVersionCheck(await command("gh", ["--version"]));
  if (version.detail.includes("not installed")) return [version];
  // `gh auth token` only reads stored credentials; its output is discarded.
  const authenticated = offline ? await command("gh", ["auth", "token", "--hostname", "github.com"]) !== undefined
    : await command("gh", ["auth", "status", "--hostname", "github.com"]) !== undefined;
  return [version, authenticated ? ok("gh auth", `signed in to github.com${offline ? " (token present)" : ""}`)
    : fail("gh auth", "not signed in to github.com", "Run `gh auth login`.")];
}

async function playwrightCheck() {
  const fix = "Run `pnpm exec playwright install chromium`.";
  try {
    const { chromium } = await import("@playwright/test");
    return existsSync(chromium.executablePath()) ? ok("Playwright Chromium", "installed")
      : warn("Playwright Chromium", "browser is not installed; E2E tests and pnpm inspect need it", fix);
  } catch { return warn("Playwright Chromium", "@playwright/test is not installed", "Run `pnpm install`."); }
}

async function portChecks(config) {
  const run = inspectState(readState(bootstrapPaths(config.root).state));
  const owned = liveStatuses.includes(run.status) && Object.values(run.ports ?? {}).length > 0;
  return Promise.all(Object.entries(config.ports).map(async ([service, port]) => {
    try { await assertPortsAvailable({ [service]: port }); return ok(`Port ${port}`, `${service} is free`); }
    catch {
      if (owned && run.ports[service] === port) return ok(`Port ${port}`, `${service} is served by this worktree's bootstrap (${run.status}, pid ${run.pid})`);
      return warn(`Port ${port}`, `${service} port is in use by something other than this worktree's recorded bootstrap`,
        "Check pnpm bootstrap:status; if another process owns it, set BOOTSTRAP_PORT_BLOCK in this worktree's .env.bootstrap.local.");
    }
  }));
}

export async function doctor({ offline = false } = {}) {
  const { root, mainRoot } = checkoutRoots();
  const packageJson = readPackageJson(root);
  const config = worktreeConfig(root);
  const { results: credentialResults, credentials } = credentialChecks(root, mainRoot);
  const network = (checks) => offline ? undefined : checks();
  const [pnpm, clerk, polar, tailscale, gh, playwright, ports] = await Promise.all([
    pnpmVersion(),
    credentials ? network(() => clerkChecks(credentials)) : [skip("Clerk API", "Clerk keys do not resolve")],
    network(() => polarChecks(credentials)),
    command("tailscale", ["status", "--json"]).then(output => {
      try { return tailscaleChecks(JSON.parse(output)); } catch { return tailscaleChecks(); }
    }),
    ghChecks(offline), playwrightCheck(), portChecks(config),
  ]);
  const offlineSkip = name => offline ? [skip(name, "--offline")] : [];
  return { root, worktree: config.id, results: [
    nodeCheck(process.version, packageJson.engines.node), pnpmCheck(pnpm, packageJson.packageManager),
    dependencyCheck(root, packageJson), ...credentialResults,
    ...(clerk ?? offlineSkip("Clerk API")), ...(polar ?? offlineSkip("Polar API")),
    // Sentry is optional and hosted-only; bootstrap points local stacks at a fake ingest route.
    ok("Sentry", "optional; this worktree reports to its fake local endpoint. Hosted setup: docs/deployment.md"),
    ...tailscale, ...gh, playwright, ...ports,
  ] };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("pnpm setup:check [--offline] [--json]\n\nChecks tools, shared credentials, provider setup, and this worktree's ports.\n--offline  Skip Clerk, Polar, and GitHub network checks.\n--json     Print machine-readable results.");
    return;
  }
  for (const arg of args) if (!["--offline", "--json"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  const report = await doctor({ offline: args.includes("--offline") });
  const summary = summarize(report.results);
  if (args.includes("--json")) console.log(JSON.stringify({ ...report, summary }, null, 2));
  else console.log(`Doctor: ${report.worktree} (${report.root})\n\n${formatResults(report.results)}`);
  process.exitCode = summary.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Doctor: ${error.message}`); process.exitCode = 1; });
}
