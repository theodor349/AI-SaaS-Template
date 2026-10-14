import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compareVersions, convexTemplateCheck, fail, formatResults, ghVersionCheck, nodeCheck, ok, pnpmCheck, polarProductProblem, preflight, skip, summarize, tailscaleChecks, warn } from "./doctor.mjs";

test("versions compare numerically", () => {
  assert.equal(compareVersions("2.92.0", "2.99.0"), -1);
  assert.equal(compareVersions("2.100.0", "2.99.0"), 1);
  assert.equal(compareVersions("v24.1.0", "24.1.0"), 0);
});

test("Node newer than engines warns, older fails", () => {
  assert.equal(nodeCheck("v24.11.0", "24.x").status, "ok");
  assert.equal(nodeCheck("v25.6.1", "24.x").status, "warn");
  assert.equal(nodeCheck("v22.20.0", "24.x").status, "fail");
});

test("pnpm tolerates minor drift within the packageManager major", () => {
  assert.equal(pnpmCheck("10.12.4", "pnpm@10.12.4+sha512.abc").status, "ok");
  assert.equal(pnpmCheck("10.20.0", "pnpm@10.12.4").status, "warn");
  assert.equal(pnpmCheck("9.15.0", "pnpm@10.12.4").status, "fail");
  assert.equal(pnpmCheck(undefined, "pnpm@10.12.4").status, "fail");
});

test("gh below the --attach minimum warns with an upgrade", () => {
  const old = ghVersionCheck("gh version 2.92.0 (2026-04-28)\nhttps://github.com/cli/cli/releases/tag/v2.92.0\n");
  assert.equal(old.status, "warn");
  assert.match(old.fix, /brew upgrade gh/);
  assert.equal(ghVersionCheck("gh version 2.99.0 (2026-09-01)").status, "ok");
  assert.equal(ghVersionCheck(undefined).status, "warn");
});

test("Tailscale HTTPS needs a running MagicDNS name with a certificate domain", () => {
  const ready = { BackendState: "Running", Self: { DNSName: "Host.tail1.ts.net." }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: ["host.tail1.ts.net"] };
  assert.deepEqual(tailscaleChecks(ready).map(r => r.status), ["ok"]);
  const statuses = [undefined, { ...ready, BackendState: "Stopped" }, { ...ready, Self: { DNSName: "" } },
    { ...ready, CurrentTailnet: { MagicDNSEnabled: false } }, { ...ready, CertDomains: [] }, { ...ready, CertDomains: undefined }];
  for (const status of statuses) {
    const [result] = tailscaleChecks(status);
    assert.equal(result.status, "warn");
    assert.ok(result.fix);
  }
  assert.match(tailscaleChecks({ ...ready, CertDomains: [] })[0].fix, /HTTPS/);
});

test("Polar products follow the catalog rules bootstrap syncs", () => {
  const price = { is_archived: false, amount_type: "fixed", price_amount: 900, price_currency: "usd" };
  const monthly = { is_archived: false, organization_id: "org", prices: [price], is_recurring: true, recurring_interval: "month", recurring_interval_count: 1 };
  const lifetime = { ...monthly, is_recurring: false, recurring_interval: null, recurring_interval_count: null };
  assert.equal(polarProductProblem(monthly, "monthly", "org"), undefined);
  assert.equal(polarProductProblem(lifetime, "lifetime", "org"), undefined);
  assert.match(polarProductProblem({ ...monthly, is_archived: true }, "monthly", "org"), /archived/);
  assert.match(polarProductProblem(monthly, "monthly", "other"), /another organization/);
  assert.match(polarProductProblem({ ...monthly, prices: [{ ...price, amount_type: "custom" }] }, "monthly"), /fixed price/);
  assert.match(polarProductProblem({ ...monthly, prices: [price, { ...price, is_archived: true }, price] }, "monthly"), /2 active prices/);
  assert.equal(polarProductProblem({ ...monthly, prices: [price, { ...price, is_archived: true }] }, "monthly"), undefined);
  assert.match(polarProductProblem(monthly, "yearly"), /every 1 year/);
  assert.match(polarProductProblem(monthly, "lifetime"), /one-time/);
});

test("Clerk convex template must exist and target the convex audience", () => {
  const template = { name: "convex", claims: { aud: "convex" }, custom_signing_key: false };
  assert.equal(convexTemplateCheck([{ name: "other" }, template]).status, "ok");
  assert.equal(convexTemplateCheck([{ ...template, claims: { aud: ["convex", "x"] } }]).status, "ok");
  assert.equal(convexTemplateCheck([{ name: "other", claims: { aud: "convex" } }]).status, "fail");
  assert.match(convexTemplateCheck([{ ...template, claims: {} }]).detail, /aud/);
  assert.equal(convexTemplateCheck([{ ...template, custom_signing_key: true }]).status, "fail");
});

test("any failure sets the exit code; warnings and skips do not", () => {
  const passing = [ok("a", "fine"), warn("b", "hmm", "do x"), skip("c", "--offline")];
  assert.deepEqual(summarize(passing), { ok: 1, warn: 1, fail: 0, skip: 1, exitCode: 0 });
  assert.equal(summarize([...passing, fail("d", "broken", "do y")]).exitCode, 1);
  assert.equal(ok("a", "fine", "ignored").fix, undefined);
  const text = formatResults([...passing, fail("d", "broken", "do y")]);
  assert.match(text, /^✓ a: fine$/m);
  assert.match(text, /^✗ d: broken\n {4}do y$/m);
  assert.match(text, /1 failure, 1 warning, 1 skipped\.$/);
});

test("preflight reports missing shared settings without printing", (t) => {
  const main = mkdtempSync(join(tmpdir(), "doctor-main-"));
  const root = mkdtempSync(join(tmpdir(), "doctor-root-"));
  t.after(() => { rmSync(main, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const missing = preflight({ polar: false, root, mainRoot: main, env: {} });
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0], /\.env\.bootstrap\.local is missing\. Copy \.env\.bootstrap\.example/);

  // Credentials from the worktree still run, but new worktrees would not inherit them.
  const domain = Buffer.from("example.accounts.dev$").toString("base64");
  writeFileSync(join(root, ".env.bootstrap.local"), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_${domain}\nCLERK_SECRET_KEY=sk_test_x\n`);
  const local = preflight({ polar: false, root, mainRoot: main, env: {} });
  assert.deepEqual(local.errors, []);
  assert.ok(local.warnings.some(message => /new worktrees will not inherit/.test(message)));

  writeFileSync(join(main, ".env.bootstrap.local"), "");
  assert.deepEqual(preflight({ polar: false, root, mainRoot: main, env: {} }).errors, []);
});
