import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { billingTestAdmin } from "../../scripts/billing-test-fixtures.mjs";
import { adminMutation, adminQuery } from "../../scripts/billing-test-admin";

const local = resolveLocalTestConfig();
test.beforeAll(async () => {
  await clerkSetup({ publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: local.env.CLERK_SECRET_KEY, dotenv: false });
});
test("unpaid owners edit profiles, preserve drafts, request deletion and recover independently", async ({ page, browser }) => {
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
    await page.screenshot({ path: "/tmp/issue5-evidence/profile-after.png", fullPage: true });
    await page.getByRole("button", { name: "Open profile menu" }).click();
    await expect(page.getByRole("menu").getByText("Local name", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByLabel("Display name", { exact: true }).fill("Unsaved edit");
    const { client: admin } = billingTestAdmin();
    await adminMutation(admin, internal.users.syncProfile, { profile: { clerkId: alice.id, email: alice.email, firstName: "Provider name", lastName: "Provider surname", updatedAt: Date.now() + 1000 }, eventAt: Date.now() + 1000 });
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Unsaved edit");
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Local name");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Request deletion", exact: true }).click();
    await expect(page.getByText(/Deletion scheduled for/)).toBeVisible();
    await page.screenshot({ path: "/tmp/issue5-evidence/deletion-pending.png", fullPage: true });
    await expect(other.getByRole("button", { name: "Undo deletion" })).toHaveCount(0);
    const token = await other.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false }); client.setAuth(token!);
    expect(await client.query(api.accountLifecycle.current, {})).toBeNull();
    await expect(client.mutation(api.accountLifecycle.recover, {})).rejects.toThrow("RECOVERY_UNAVAILABLE");
    // A provider operation may hold the request briefly; retry the actual UI.
    await expect(async () => {
      await page.getByRole("button", { name: "Undo deletion" }).click();
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
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


test("provider deletion supersedes an open user request and completes cleanup", async ({ page }) => {
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
    const requestId = await adminMutation(admin, internal.accountLifecycle.requestClerkDeletion, { clerkId: user.id, eventAt: Date.now(), deliveryId: `e2e-${user.id}` });
    await expect.poll(async () => (await adminQuery(admin, internal.accountLifecycle.context, { requestId }))?.status).toBe("completed");
    expect(await adminQuery(admin, internal.users.lookupCurrent, { tokenIdentifier: `${local.env.CLERK_JWT_ISSUER_DOMAIN}|${user.id}` })).toEqual({ status: "deleting" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo deletion" })).toHaveCount(0);
  } finally { if (!removed) await user.cleanup(); }
});


test("record the deletion request and recovery flow for review", async ({ browser }) => {
  const user = await createClerkTestUser(local);
  const context = await browser.newContext({ baseURL: local.config.env.APP_URL, recordVideo: { dir: "/tmp/issue5-evidence/video", size: { width: 1280, height: 720 } } });
  try {
    const page = await context.newPage();
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Request deletion", exact: true }).click();
    await expect(page.getByText(/Deletion scheduled for/)).toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: "Undo deletion" }).click();
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await page.screenshot({ path: "/tmp/issue5-evidence/deletion-recovered.png", fullPage: true });
    const video = page.video()!;
    await context.close();
    const { copyFile } = await import("node:fs/promises");
    await copyFile(await video.path(), "/tmp/issue5-evidence/deletion-recovery.webm");
  } finally { await context.close(); await user.cleanup(); }
});
