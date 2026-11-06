import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { billingEnabled } from "../../scripts/bootstrap/config.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const { config } = resolveLocalTestConfig();
const client = new ConvexHttpClient(config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });

test("the running local backend rejects anonymous application calls", async () => {
  await assert.rejects(client.query(api.billing.account.application, {}), /UNAUTHENTICATED/);
  if (billingEnabled(config.root)) assert.equal((await client.query(api.billing.catalog.products, {})).length, 3);
  else await assert.rejects(client.query(api.billing.catalog.products, {}), /BILLING_DISABLED/);
});

test("the worktree frontend serves successfully", { timeout: 30000 }, async () => {
  const response = await fetch(config.env.APP_URL, { signal: AbortSignal.timeout(25000) });
  await response.body?.cancel();
  assert.equal(response.status, 200);
});

test("protected backend calls reject anonymous and invalid-token callers", async () => {
  await assert.rejects(client.query(api.account.users.current, {}), /UNAUTHENTICATED/);
  const invalid = new ConvexHttpClient(config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  invalid.setAuth("invalid-token");
  await assert.rejects(invalid.query(api.account.users.current, {}));
});

test("public pages and JSON/TXT/XML assets stay public while application routes require sign-in", { timeout: 60000 }, async () => {
  const publicDir = join(config.root, "public");
  await mkdir(publicDir, { recursive: true });
  const fixture = `auth-${randomUUID()}`;
  try {
    for (const extension of ["json", "txt", "xml"]) {
      const content = extension === "json" ? '{"public":true}' : extension === "xml" ? "<public>true</public>" : "public";
      await writeFile(join(publicDir, `${fixture}.${extension}`), content);
      const response = await fetch(`${config.env.APP_URL}/${fixture}.${extension}`);
      assert.equal(response.status, 200);
      assert.equal(response.redirected, false);
      assert.equal(await response.text(), content);
    }
    for (const path of ["/", "/sign-in", "/sign-up"]) {
      const response = await fetch(`${config.env.APP_URL}${path}`, { redirect: "manual" });
      await response.body?.cancel();
      assert.equal(response.status, 200, path);
    }
    // The proxy sends signed-out visitors to sign-in, with a relative Location for the app's own page.
    for (const path of ["/app", "/app?tab=profile", "/billing", "/checkout?plan=yearly", "/account"]) {
      const response = await fetch(`${config.env.APP_URL}${path}`, { redirect: "manual" });
      await response.body?.cancel();
      assert.equal(response.status, 307, path);
      const location = new URL(response.headers.get("location"), config.env.APP_URL);
      assert.equal(location.origin, new URL(config.env.APP_URL).origin);
      assert.equal(location.pathname, "/sign-in");
      assert.equal(location.searchParams.get("redirect_url"), `${config.env.APP_URL}${path}`);
    }
    const unsafe = await fetch(`${config.env.APP_URL}/sign-in?redirect_url=${encodeURIComponent("https://evil.example/app")}`, { redirect: "manual" });
    await unsafe.body?.cancel();
    assert.equal(unsafe.status, 307);
    assert.equal(new URL(unsafe.headers.get("location"), config.env.APP_URL).searchParams.has("redirect_url"), false);
    const safe = await fetch(`${config.env.APP_URL}/sign-in?redirect_url=${encodeURIComponent(`${config.env.APP_URL}/app?tab=profile`)}`, { redirect: "manual" });
    await safe.body?.cancel();
    assert.equal(safe.status, 200);
  } finally {
    await Promise.all(["json", "txt", "xml"].map((extension) => rm(join(publicDir, `${fixture}.${extension}`), { force: true })));
  }
});
