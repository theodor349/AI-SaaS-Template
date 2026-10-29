import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

export const polarProductKeys = ["POLAR_PRODUCT_MONTHLY", "POLAR_PRODUCT_YEARLY", "POLAR_PRODUCT_LIFETIME"];
const providerNames = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET", "CLERK_JWT_ISSUER_DOMAIN",
  "POLAR_ACCESS_TOKEN", "POLAR_ORGANIZATION_ID", ...polarProductKeys,
  "LOG_SAMPLE_RATE_QUERY", "LOG_SAMPLE_RATE_MUTATION", "LOG_SAMPLE_RATE_ACTION",
];
// Pushed to the local Convex deployment. Must match the env declared in convex/convex.config.ts.
export const backendEnvKeys = [
  "WORKTREE_ID", "APP_URL", "CLERK_JWT_ISSUER_DOMAIN", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET",
  "POLAR_ACCESS_TOKEN", "POLAR_ENVIRONMENT", "POLAR_WEBHOOK_SECRET", "POLAR_ORGANIZATION_ID", ...polarProductKeys,
  "LOG_SAMPLE_RATE_QUERY", "LOG_SAMPLE_RATE_MUTATION", "LOG_SAMPLE_RATE_ACTION",
  // Never read from credentials, so local stacks send no email.
  "RESEND_API_KEY", "EMAIL_FROM", "OPERATOR_ALERT_EMAIL",
  // Read from this worktree's .env.bootstrap.local, so it can try the paused app.
  "MAINTENANCE_MODE",
];
const localBlocks = 12000;
const tailscaleBlocks = 5000;
export const portBlockHelp = `set BOOTSTRAP_PORT_BLOCK=<0-${localBlocks - 1}> in this worktree's .env.bootstrap.local to use a different port block`;

export function gitRoot(cwd = process.cwd()) {
  return realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim());
}

export function mainCheckoutRoot(root) {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
  return dirname(common);
}

const pathHash = (root) => createHash("sha256").update(root).digest("hex");

// The `billing` setting in the checkout's app.config.ts. Read as text because
// Node warns on every run when a script imports that TypeScript module.
export function billingEnabled(root) {
  const matches = [...readFileSync(join(root, "app.config.ts"), "utf8").matchAll(/^\s*billing:\s*(true|false)\s*,?\s*$/gm)];
  if (matches.length !== 1) throw new Error("app.config.ts must set `billing: true,` or `billing: false,` on a line of its own.");
  return matches[0][1] === "true";
}

export function worktreeId(root) {
  return `wt-${pathHash(root).slice(0, 12)}`;
}

// BOOTSTRAP_PORT_BLOCK comes only from the process or this worktree's own
// .env.bootstrap.local; a main-checkout value would move every worktree together.
export function portBlockOverride(root, inherited = process.env) {
  const value = inherited.BOOTSTRAP_PORT_BLOCK || readEnvironment(join(root, ".env.bootstrap.local")).BOOTSTRAP_PORT_BLOCK;
  if (!value) return undefined;
  const block = Number(value);
  if (!/^\d+$/.test(value) || block >= localBlocks) {
    throw new Error(`BOOTSTRAP_PORT_BLOCK must be an integer from 0 to ${localBlocks - 1}.`);
  }
  return block;
}

// Ports derive from the worktree path unless BOOTSTRAP_PORT_BLOCK selects another
// block. Every caller resolves the same override, so tests find the running stack.
export function worktreeConfig(root, { portBlock = portBlockOverride(root) } = {}) {
  const hash = pathHash(root);
  const override = portBlock !== undefined;
  const blocks = {
    local: override ? portBlock : Number.parseInt(hash.slice(0, 8), 16) % localBlocks,
    tailscale: override ? portBlock % tailscaleBlocks : Number.parseInt(hash.slice(8, 16), 16) % tailscaleBlocks,
    source: override ? "BOOTSTRAP_PORT_BLOCK" : "path",
  };
  const firstPort = 10000 + blocks.local * 3;
  const ports = { next: firstPort, convex: firstPort + 1, site: firstPort + 2 };
  const id = worktreeId(root);
  const appUrl = `http://127.0.0.1:${ports.next}`;
  return {
    root, id, portBlock: blocks, ports,
    env: {
      WORKTREE_ID: id,
      PORT: String(ports.next),
      APP_URL: appUrl,
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${ports.convex}`,
      NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${ports.site}`,
      POLAR_ENVIRONMENT: "sandbox",
      POLAR_WEBHOOK_URL: `http://127.0.0.1:${ports.site}/webhooks/polar`,
      // Enables the crash hooks E2E tests use to reach the error pages (lib/e2e-crash.ts).
      E2E_TEST_ROUTES: "1",
    },
  };
}

export function developmentCredentials(values, polar = true, settingsFile = "the main checkout's .env.bootstrap.local") {
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
  const missingProducts = polarProductKeys.filter(key => !values[key]);
  if (polar && missingProducts.length) {
    throw new Error([
      `Polar sandbox product IDs are missing: ${missingProducts.join(", ")}.`,
      `Add these lines to ${settingsFile}, which every worktree inherits:`,
      ...missingProducts.map(key => `  ${key}=<product ID>`),
      "Copy each ID from sandbox.polar.sh > Products: a monthly, a yearly, and a one-time fixed-price product.",
      "Or run pnpm bootstrap --no-polar to start without billing.",
    ].join("\n"));
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
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "TAILSCALE_HOSTNAME"]) {
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

export function readEnvironment(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

export function saveEnvironment(file, values) {
  writeFileSync(file, environmentFile(values), { mode: 0o600 });
  chmodSync(file, 0o600);
}

// Blank optional settings in a copied template keep inherited configuration.
// worktreeCredentials reads the worktree-only settings separately.
function credentialOverrides(values) {
  const inheritedWhenBlank = ["CLERK_WEBHOOK_SIGNING_SECRET", "POLAR_ORGANIZATION_ID", ...polarProductKeys];
  return Object.fromEntries(Object.entries(values).filter(([key, value]) =>
    !["BOOTSTRAP_PORT_BLOCK", "MAINTENANCE_MODE"].includes(key) && (!inheritedWhenBlank.includes(key) || value !== "")));
}

export function worktreeCredentials(root, mainRoot, polar = true, inherited = process.env) {
  const sharedKeys = readEnvironment(join(mainRoot, ".env.bootstrap.local"));
  // Existing development keys remain usable; never copy another checkout's URLs or cloud target.
  const mainKeys = readEnvironment(join(mainRoot, ".env.local"));
  if (mainKeys.WORKTREE_ID === worktreeId(realpathSync(mainRoot))) delete mainKeys.CLERK_JWT_ISSUER_DOMAIN;
  // A main checkout's .env.local may contain its generated test signing secret.
  // Share signing secrets only from explicit bootstrap settings, not that file.
  const providerKeys = Object.fromEntries(Object.entries(mainKeys).filter(([key]) =>
    providerNames.includes(key) && key !== "CLERK_WEBHOOK_SIGNING_SECRET"));
  const localKeys = readEnvironment(join(root, ".env.local"));
  const worktreeSettings = readEnvironment(join(root, ".env.bootstrap.local"));
  // Re-derive generated issuers after a worktree overrides its Clerk key pair.
  if (localKeys.WORKTREE_ID === worktreeId(root)) delete localKeys.CLERK_JWT_ISSUER_DOMAIN;
  return developmentCredentials({
    ...credentialOverrides(providerKeys), ...credentialOverrides(sharedKeys), ...credentialOverrides(localKeys),
    ...credentialOverrides(worktreeSettings),
    ...credentialOverrides(Object.fromEntries(Object.entries(inherited).filter(([key]) => providerNames.includes(key)))),
    // Pausing comes only from this worktree's .env.bootstrap.local: a main-checkout value
    // would pause every worktree, and the generated .env.local would keep it paused.
    ...(worktreeSettings.MAINTENANCE_MODE && { MAINTENANCE_MODE: worktreeSettings.MAINTENANCE_MODE }),
  }, polar, join(mainRoot, ".env.bootstrap.local"));
}

// Bootstrap owns one anonymous deployment per checkout, stored in its .convex directory.
export function convexStateFile(root) {
  return join(root, ".convex/local/default/config.json");
}

export function assertIsolatedConvexState(root, home = process.env.HOME) {
  const stateFile = convexStateFile(root);
  if (existsSync(stateFile)) {
    if (JSON.parse(readFileSync(stateFile, "utf8")).deploymentName !== "anonymous-agent") {
      throw new Error("This checkout already has another local Convex deployment. Use a fresh worktree to keep its data intact.");
    }
  } else if (existsSync(join(home, ".convex/anonymous-convex-backend-state/anonymous-agent"))) {
    throw new Error("Legacy anonymous-agent Convex state exists outside this checkout. Migrate it before bootstrapping isolated worktrees.");
  }
}
