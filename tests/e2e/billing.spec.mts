import { copyFile } from "node:fs/promises";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { billingTestAdmin, seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

import { adminQuery, adminMutation } from "../../scripts/billing-test-admin";
const local = resolveLocalTestConfig();
test.beforeAll(async () => {
  await clerkSetup({ publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: local.env.CLERK_SECRET_KEY, dotenv: false });
});

test("selected paid plan survives authentication; success URL alone leaves recoverable pending access", async ({ page, browser }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/billing?plan=yearly");
    await expect(page).toHaveURL(/\/sign-in\?/);
    await clerk.signIn({ page, emailAddress: user.email });
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing?plan=yearly`);
    await expect(page.getByRole("button", { name: "Continue with yearly" })).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
    await page.goto("/billing?confirmation=pending");
    await expect(page.getByText(/Payment confirmation pending/)).toBeVisible();
    await expect(page.getByText("Your paid access is confirmed.")).toHaveCount(0);
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false }); client.setAuth(token!);
    await expect(client.query(api.billing.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await expect(client.mutation(api.myFunctions.addNumber, { value: 1 })).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await page.screenshot({ path: "/tmp/issue4-confirmation-pending.png", fullPage: true });
    const recording = await browser.newContext({ baseURL: local.config.env.APP_URL,
      storageState: await page.context().storageState(), recordVideo: { dir: "/tmp/issue4-evidence-video", size: { width: 1280, height: 720 } } });
    try {
      const recordedPage = await recording.newPage();
      await recordedPage.goto("/billing?confirmation=pending");
      await expect(recordedPage.getByText(/Payment confirmation pending/)).toBeVisible();
      await seedPaidTestUser(user);
      await expect(recordedPage.getByText("Your paid access is confirmed.")).toBeVisible();
      await recordedPage.screenshot({ path: "/tmp/issue4-lifetime-confirmed.png", fullPage: true });
      await recordedPage.waitForTimeout(500);
      const video = recordedPage.video()!;
      await recording.close();
      await copyFile(await video.path(), "/tmp/issue4-confirmation.webm");
    } finally { await recording.close(); }
    await expect(page.getByText("Your paid access is confirmed.")).toBeVisible();
    await page.getByRole("link", { name: "Open application" }).click();
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
  } finally { await user.cleanup(); }
});

test("expiry removes paid pages reactively while billing and account controls remain accessible", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Monthly Pro" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to lifetime" })).toBeVisible();
    await page.screenshot({ path: "/tmp/issue4-billing-active.png", fullPage: true });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    const { client: admin } = billingTestAdmin();
    const account = (await adminQuery(admin, internal.billingState.get, { customerId: fixture.customerId }))!;
    // A higher revision ending state is the same trusted publication used by
    // reconciliation. No browser-side success flags or mocked auth are involved.
    const lease = (await adminMutation(admin, internal.billingState.lease, { customerId: fixture.customerId }))!;
    await adminMutation(admin, internal.billingState.apply, { version: lease.version,
      snapshot: { customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId: local.env.POLAR_PRODUCT_MONTHLY!, status: "canceled",
          start: Date.now() - 1000, end: Date.now() - 1, modifiedAt: Date.now() + 1000, cancelAtPeriodEnd: false }], orders: [] } });
    await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: lease.version, failed: false });
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("heading", { name: "Restore Pro access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    expect(account.status).toBe("active");
  } finally { await user.cleanup(); }
});

test("sandbox SDK creates an owned checkout without granting access and live customer delivery reaches this worktree", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/billing?plan=monthly"); await clerk.signIn({ page, emailAddress: user.email });
    await expect(page.getByRole("button", { name: "Continue with monthly" })).toBeVisible();
    await page.getByRole("button", { name: "Continue with monthly" }).click();
    await expect(page).toHaveURL(/https:\/\/sandbox\.polar\.sh\/checkout\//);
    // Don't record provider pages, tokens, or payment details in PR artifacts.
    await page.goto(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeVisible();
    await expect(page.getByText("Your paid access is confirmed.")).toHaveCount(0);
    const { client: admin } = billingTestAdmin();
    const userId = await adminQuery(admin, internal.users.byClerkId, { clerkId: user.id });
    const account = (await adminQuery(admin, internal.billing.accountByUser, { userId: userId! }))!;
    expect(account.externalId).toBe(`${local.config.id}:${local.env.CLERK_JWT_ISSUER_DOMAIN}|${user.id}`);
    // Poll provider-delivery tracking through a bounded operational query.
    await expect.poll(async () => (await adminQuery(admin, internal.billing.deliveryStatus, { customerId: account.customerId })).delivered).toBe(true);
  } finally { await user.cleanup(); }
});

test("repeated switches and cancellation cycles confirm reactive state; failures clear obsolete expectations", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const fixture = await seedPaidTestUser(user, "monthly");
  const { client: admin } = billingTestAdmin();
  let model: "monthly" | "yearly" = "monthly";
  let cancel = false;
  let failNext = false;
  let sequence = 0;
  let release: (() => void) | undefined;
  await page.routeWebSocket(/\/sync$/, socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(async message => {
      const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string; requestId: number; args: [{ operation: string }] };
      if (frame.type !== "Action" || frame.udfPath !== "polar:changeSubscription") { server.send(message); return; }
      // The UI action result is deliberately separated from a trusted state
      // publication to prove the label never treats an action ACK as entitlement.
      if (failNext) {
        failNext = false;
        socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, success: false, result: "Fixture provider failure", logLines: [] }));
        return;
      }
      const operation = frame.args[0].operation;
      if (operation === "monthly" || operation === "yearly") model = operation;
      else cancel = operation === "cancel";
      socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, success: true, result: null, logLines: [] }));
      await new Promise<void>(resolve => { release = resolve; });
      const lease = await adminMutation(admin, internal.billingState.lease, { customerId: fixture.customerId });
      if (!lease) throw new Error("Fixture reconciliation lease unavailable");
      const now = Date.now() + ++sequence * 100;
      const productId = local.env[`POLAR_PRODUCT_${model.toUpperCase()}`]!;
      await adminMutation(admin, internal.billingState.apply, { version: lease.version, snapshot: {
        customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 60_000,
          end: now + 60 * 60_000, modifiedAt: now, cancelAtPeriodEnd: cancel }],
        orders: [{ id: `fixture-switch-${user.id}-${sequence}`, productId, subscriptionId: fixture.subscriptionId,
          paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
      } });
      await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: lease.version, failed: false });
    });
  });
  try {
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    for (const target of ["yearly", "monthly", "yearly"] as const) {
      await page.getByRole("button", { name: `Switch to ${target}` }).click();
      await expect(page.getByText("Waiting for confirmed billing state…")).toBeVisible();
      release!();
      await expect(page.getByRole("heading", { name: target === "yearly" ? "Yearly Pro" : "Monthly Pro" })).toBeVisible();
      await expect(page.getByText("Billing change confirmed.")).toBeVisible();
    }
    for (const action of ["Cancel subscription", "Reactivate subscription", "Cancel subscription", "Reactivate subscription"]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(page.getByText("Waiting for confirmed billing state…")).toBeVisible(); release!();
      await expect(page.getByText("Billing change confirmed.")).toBeVisible();
    }
    failNext = true;
    await page.getByRole("button", { name: "Switch to monthly" }).click();
    await expect(page.getByText(/We couldn’t complete the billing request/)).toBeVisible();
    await expect(page.getByText("Waiting for confirmed billing state…")).toHaveCount(0);
    await expect(page.getByText("Billing change confirmed.")).toHaveCount(0);
    await page.getByRole("button", { name: "Switch to monthly" }).click();
    await expect(page.getByText("Waiting for confirmed billing state…")).toBeVisible(); release!();
    await expect(page.getByRole("heading", { name: "Monthly Pro" })).toBeVisible();
    await expect(page.getByText("Billing change confirmed.")).toBeVisible();
  } finally { release?.(); await page.unrouteAll({ behavior: "wait" }); await user.cleanup(); }
});
