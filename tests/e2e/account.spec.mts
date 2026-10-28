import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { api, internal } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { billingTestAdmin } from "../../scripts/billing-test-fixtures.mjs";
import { adminMutation, adminQuery } from "../../scripts/billing-test-admin";
import { testTokenIdentifier } from "../../scripts/test-identity.mjs";
import { openSandboxCheckout } from "./checkout.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

test("unpaid owners edit profiles, preserve drafts, request deletion and recover independently", { tag: "@critical" }, async ({ page, browser }) => {
  const alice = await createClerkTestUser(local);
  const bob = await createClerkTestUser(local);
  const otherContext = await browser.newContext({ baseURL: local.config.env.APP_URL });
  try {
    const other = await otherContext.newPage();
    for (const [target, user] of [[page, alice], [other, bob]] as const) {
      await target.goto("/"); await clerk.signIn({ page: target, emailAddress: user.email });
      await target.goto("/account");
      await expect(target.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
      await expect(target.getByRole("button", { name: "Open profile menu" })).toBeVisible();
    }
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(alice.name);
    await page.getByLabel("Display name", { exact: true }).fill("  Local name  ");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("button", { name: "Save profile" })).toBeEnabled();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Local name");
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Local name");
    await page.getByRole("button", { name: "Open profile menu" }).click();
    await expect(page.getByRole("menu").getByText("Local name", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByLabel("Display name", { exact: true }).fill("Unsaved edit");
    const { client: admin } = billingTestAdmin();
    await adminMutation(admin, internal.account.users.syncProfile, { profile: { clerkId: alice.id, email: alice.email, firstName: "Provider name", lastName: "Provider surname", updatedAt: Date.now() + 1000 }, eventAt: Date.now() + 1000 });
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Unsaved edit");
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Local name");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Request deletion", exact: true }).click();
    await expect(page.getByText(/Deletion scheduled for/)).toBeVisible();
    await captureEvidence(page, "deletion-pending");
    await expect(other.getByRole("button", { name: "Undo deletion" })).toHaveCount(0);
    const token = await other.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false }); client.setAuth(token!);
    expect(await client.query(api.account.lifecycle.current, {})).toBeNull();
    await expect(client.mutation(api.account.lifecycle.recover, {})).rejects.toThrow("RECOVERY_UNAVAILABLE");
    // A provider operation may hold the request briefly; retry the actual UI.
    await expect(async () => {
      await page.getByRole("button", { name: "Undo deletion" }).click();
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await captureEvidence(page, "deletion-recovered");
    await page.getByRole("button", { name: "Open profile menu" }).click();
    await page.getByRole("menuitem", { name: "Billing", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
    await page.getByRole("button", { name: "Open profile menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in|\/$/);
    await expect(other.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  } finally { await otherContext.close(); await Promise.all([alice.cleanup(), bob.cleanup()]); }
});


test("provider deletion supersedes an open user request and completes cleanup", { tag: "@critical" }, async ({ page }) => {
  const user = await createClerkTestUser(local);
  let removed = false;
  try {
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Request deletion", exact: true }).click();
    await expect(page.getByText(/Deletion scheduled for/)).toBeVisible();
    await user.cleanup(); removed = true;
    const { client: admin } = billingTestAdmin();
    // The local Clerk instance has no loopback delivery. Drive its trusted
    // deletion consumer after removing the actual worktree-labelled identity.
    const requestId = await adminMutation(admin, internal.account.lifecycle.requestClerkDeletion, { clerkId: user.id, eventAt: Date.now(), deliveryId: `e2e-${user.id}` });
    await expect.poll(async () => (await adminQuery(admin, internal.account.lifecycle.context, { requestId }))?.status).toBe("completed");
    expect(await adminQuery(admin, internal.account.users.lookupCurrent, { tokenIdentifier: testTokenIdentifier(local.env, user.id) })).toEqual({ status: "deleting" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo deletion" })).toHaveCount(0);
  } finally { if (!removed) await user.cleanup(); }
});

test("a deleted account's email can open checkout again on a new account", { tag: "@critical" }, async ({ page }) => {
  const first = await createClerkTestUser(local);
  const polar = createPolar({ accessToken: local.env.POLAR_ACCESS_TOKEN, environment: "sandbox", organizationId: local.env.POLAR_ORGANIZATION_ID });
  const { client: admin } = billingTestAdmin();
  const sync = await interceptConvexSync(page);
  let second: Awaited<ReturnType<typeof createClerkTestUser>> | undefined;
  let firstRemoved = false;
  try {
    // Opening checkout creates the first account's Polar customer.
    await page.goto("/billing"); await clerk.signIn({ page, emailAddress: first.email });
    await openSandboxCheckout(page, sync, "Choose monthly");
    await page.goto(`${local.config.env.APP_URL}/billing`);
    const userId = await adminQuery(admin, internal.account.users.byClerkId, { clerkId: first.id });
    const { customerId } = (await adminQuery(admin, internal.billing.account.accountByUser, { userId: userId! }))!;
    await clerk.signOut({ page });
    await first.cleanup(); firstRemoved = true;
    // The local Clerk instance has no loopback delivery, so drive its deletion consumer.
    const requestId = await adminMutation(admin, internal.account.lifecycle.requestClerkDeletion, { clerkId: first.id, eventAt: Date.now(), deliveryId: `e2e-${first.id}` });
    await expect.poll(async () => (await adminQuery(admin, internal.account.lifecycle.context, { requestId }))?.status).toBe("completed");
    await expect(polar.customers.get(customerId)).rejects.toMatchObject({ statusCode: 404 });
    // Polar allows one customer per email, so the new account's customer needs the old one gone.
    second = await createClerkTestUser(local, { email: first.email });
    await page.goto("/billing"); await clerk.signIn({ page, emailAddress: second.email });
    await openSandboxCheckout(page, sync, "Choose monthly");
  } finally {
    try {
      if (!firstRemoved) await first.cleanup();
    } finally {
      await second?.cleanup();
    }
  }
});
