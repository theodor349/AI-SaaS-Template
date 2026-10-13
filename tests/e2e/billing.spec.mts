import { copyFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { api, internal } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { billingTestAdmin, seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

import { adminQuery, adminMutation } from "../../scripts/billing-test-admin";
const local = resolveLocalTestConfig();
async function leaseBillingFixture(customerId: string) {
  const { client: admin } = billingTestAdmin();
  let lease = await adminMutation(admin, internal.billingState.lease, { customerId });
  for (let attempt = 0; !lease && attempt < 100; attempt++) {
    await delay(100);
    lease = await adminMutation(admin, internal.billingState.lease, { customerId });
  }
  if (!lease) throw new Error("Fixture reconciliation lease unavailable");
  return lease;
}
test.beforeAll(async () => {
  await clerkSetup({ publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: local.env.CLERK_SECRET_KEY, dotenv: false });
});

test("selected plan opens checkout once after authentication; success URL alone cannot grant access", async ({ page, browser }) => {
  const user = await createClerkTestUser(local);
  const checkoutModels: string[] = [];
  await page.routeWebSocket(/\/sync$/, socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => {
      const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string; requestId: number; args: [{ model: string }] };
      if (frame.type !== "Action" || frame.udfPath !== "polar:checkout") { server.send(message); return; }
      checkoutModels.push(frame.args[0].model);
      socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, success: false,
        result: "Fixture checkout failure", logLines: [] }));
    });
  });
  try {
    await page.goto("/checkout?plan=yearly");
    await expect(page).toHaveURL(/\/sign-in\?/);
    await clerk.signIn({ page, emailAddress: user.email });
    await expect(page.getByText("We couldn’t open the payment page")).toBeVisible();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/checkout`);
    expect(checkoutModels).toEqual(["yearly"]);
    await page.reload();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/#pricing`);
    // Billing only confirms subscriber plan switches from its URL; it never starts checkout.
    await page.goto("/billing?plan=yearly");
    await expect(page.getByRole("button", { name: "Choose yearly" })).toBeEnabled();
    expect(checkoutModels).toEqual(["yearly"]);
    await page.goto("/app");
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
    await page.goto("/billing?confirmation=pending");
    await expect(page.getByText(/Payment confirmation pending/)).toBeVisible();
    await expect(page.getByText("Your paid access is confirmed.")).toHaveCount(0);
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false }); client.setAuth(token!);
    await expect(client.query(api.billing.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await expect(client.query(api.billing.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await page.screenshot({ path: "/tmp/issue4-confirmation-pending.png", fullPage: true });
    const recording = await browser.newContext({ baseURL: local.config.env.APP_URL,
      storageState: await page.context().storageState(), recordVideo: { dir: "/tmp/issue4-evidence-video", size: { width: 1280, height: 720 } } });
    try {
      const recordedPage = await recording.newPage();
      await recordedPage.goto("/billing?confirmation=pending");
      await expect(recordedPage.getByText(/Payment confirmation pending/)).toBeVisible();
      await seedPaidTestUser(user);
      await expect(recordedPage.getByText("You have lifetime access.")).toBeVisible();
      await recordedPage.screenshot({ path: "/tmp/issue4-lifetime-confirmed.png", fullPage: true });
      await recordedPage.waitForTimeout(500);
      const video = recordedPage.video()!;
      await recording.close();
      await copyFile(await video.path(), "/tmp/issue4-confirmation.webm");
    } finally { await recording.close(); }
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly", exact: true })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
  } finally { await user.cleanup(); }
});

test("lifetime access shows the purchase date and opens the customer portal", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let release: (() => void) | undefined;
  let requests = 0;
  const portalUrl = "https://sandbox.polar.sh/fixture-lifetime-portal";
  await page.route(portalUrl, route => route.fulfill({ contentType: "text/html", body: "<h1>Customer portal fixture</h1>" }));
  await page.routeWebSocket(/\/sync$/, socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(async message => {
      const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string; requestId: number };
      if (frame.type !== "Action" || frame.udfPath !== "polar:portal") { server.send(message); return; }
      requests++;
      await new Promise<void>(resolve => { release = resolve; });
      socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, success: true,
        result: portalUrl, logLines: [] }));
    });
  });
  try {
    await seedPaidTestUser(user);
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    await expect(page.getByLabel("Purchased on", { exact: true })).toBeDisabled();
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
    client.setAuth(token!);
    const status = await client.query(api.billing.status, {});
    expect(status.lifetimePurchasedAt).not.toBeNull();
    const purchaseDate = await page.evaluate(timestamp => new Date(timestamp!).toLocaleDateString(undefined, {
      day: "numeric", month: "long", year: "numeric",
    }), status.lifetimePurchasedAt);
    await expect(page.getByLabel("Purchased on", { exact: true })).toHaveValue(purchaseDate);
    await expect(page.getByLabel("Purchased on", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Lifetime Pro");
    await expect(page.getByRole("heading", { name: "Monthly", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeEnabled();
    await page.screenshot({ path: "/tmp/billing-lifetime-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/billing-lifetime-mobile.png", fullPage: true });
    await page.reload();
    await expect(page.getByLabel("Purchased on", { exact: true })).toHaveValue(purchaseDate);
    await page.getByRole("button", { name: "Customer portal" }).click();
    await expect(page.getByRole("button", { name: "Opening portal…" })).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    release!();
    await expect(page).toHaveURL(portalUrl);
  } finally { release?.(); await user.cleanup(); }
});

for (const action of ["checkout", "portal"] as const) {
  test(`${action} permits another request after a cached page is restored`, async ({ page }) => {
    const user = await createClerkTestUser(local);
    let requests = 0;
    try {
      if (action === "portal") await seedPaidTestUser(user);
      await page.routeWebSocket(/\/sync$/, socket => {
        const server = socket.connectToServer();
        server.onMessage(message => socket.send(message));
        socket.onMessage(message => {
          const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string; requestId: number };
          if (frame.type !== "Action" || frame.udfPath !== `polar:${action}`) { server.send(message); return; }
          requests++;
          // Keep the document mounted after a successful navigation response,
          // then reproduce the browser's cached-page lifecycle event below.
          socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, success: true,
            result: `${local.config.env.APP_URL}/billing#navigation-${requests}`, logLines: [] }));
        });
      });
      await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
      const label = action === "checkout" ? "Choose monthly" : "Customer portal";
      const progress = action === "checkout" ? "Opening checkout…" : "Opening portal…";
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(/#navigation-1$/);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
      await expect(page.getByRole("button", { name: progress, exact: true })).toBeDisabled();
      expect(requests).toBe(1);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled();
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(/#navigation-2$/);
      expect(requests).toBe(2);
    } finally { await user.cleanup(); }
  });
}

test("expiry removes paid pages reactively while billing and account controls remain accessible", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/billing");
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Monthly Pro");
    await expect(page.getByLabel("Plan", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Paid through", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Get lifetime" })).toBeVisible();
    await page.screenshot({ path: "/tmp/issue4-billing-active.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/billing-summary-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    const { client: admin } = billingTestAdmin();
    const account = (await adminQuery(admin, internal.billingState.get, { customerId: fixture.customerId }))!;
    // A higher revision ending state is the same trusted publication used by
    // reconciliation. No browser-side success flags or mocked auth are involved.
    const lease = await leaseBillingFixture(fixture.customerId);
    await adminMutation(admin, internal.billingState.apply, { version: lease.version,
      snapshot: { customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId: local.env.POLAR_PRODUCT_MONTHLY!, status: "canceled",
          start: Date.now() - 1000, end: Date.now() - 1, modifiedAt: Date.now() + 1000, cancelAtPeriodEnd: false }], orders: [] } });
    await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: lease.version, failed: false });
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("heading", { name: "Restore Pro access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
    expect(account.status).toBe("active");
  } finally { await user.cleanup(); }
});

test("sandbox checkout and recovery work when another customer uses the sign-in email", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const polar = createPolar({ accessToken: local.env.POLAR_ACCESS_TOKEN, environment: "sandbox", organizationId: local.env.POLAR_ORGANIZATION_ID });
  const fixtureScope = `fixture-${local.config.id}`;
  let collisionCustomerId: string | undefined;
  try {
    // This customer represents a different worktree's existing customer. The
    // application must create its own customer rather than claim by email.
    const collision = await polar.customers.create({
      email: user.email, external_id: `${fixtureScope}:${user.id}`, metadata: { worktree_id: fixtureScope },
    });
    collisionCustomerId = collision.id;
    await page.goto("/billing"); await clerk.signIn({ page, emailAddress: user.email });
    await page.getByRole("button", { name: "Choose monthly" }).click();
    await expect(page).toHaveURL(/https:\/\/sandbox\.polar\.sh\/checkout\//);
    // Don't record provider pages, tokens, or payment details in PR artifacts.
    await page.goto(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeVisible();
    await expect(page.getByText("Your paid access is confirmed.")).toHaveCount(0);
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
    client.setAuth(token!);
    await client.action(api.polar.recover, {});
    await expect(page.getByText("We couldn’t complete the billing request")).toHaveCount(0);
    const { client: admin } = billingTestAdmin();
    const userId = await adminQuery(admin, internal.users.byClerkId, { clerkId: user.id });
    const account = (await adminQuery(admin, internal.billing.accountByUser, { userId: userId! }))!;
    expect(account.externalId).toBe(`${local.config.id}:${local.env.CLERK_JWT_ISSUER_DOMAIN}|${user.id}`);
    expect(account.customerId).not.toBe(collisionCustomerId);
    const owned = await polar.customers.get(account.customerId);
    expect(owned.email).toBe(user.email.replace("@", `+${local.config.id}@`));
    expect((await polar.customers.get(collisionCustomerId)).external_id).toBe(collision.external_id);
    // Poll provider-delivery tracking through a bounded operational query.
    await expect.poll(async () => (await adminQuery(admin, internal.billing.deliveryStatus, { customerId: account.customerId })).delivered).toBe(true);
  } finally {
    try {
      if (collisionCustomerId) await polar.customers.delete(collisionCustomerId);
    } finally {
      await user.cleanup();
    }
  }
});

test("yearly-to-monthly requires confirmation and shows the scheduled plan without changing paid access", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const { client: admin } = billingTestAdmin();
  let requests = 0;
  await page.routeWebSocket(/\/sync$/, socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => {
      const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string; requestId: number };
      if (frame.type !== "Action" || frame.udfPath !== "polar:changeSubscription") { server.send(message); return; }
      requests++;
      socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, success: true, result: null, logLines: [] }));
    });
  });
  try {
    const fixture = await seedPaidTestUser(user, "yearly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Switch to monthly" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("You will not be charged again until the end of your current one-year period.");
    await page.screenshot({ path: "/tmp/billing-switch-monthly-confirmation.png", fullPage: true });
    expect(requests).toBe(0);
    await dialog.getByRole("button", { name: "Keep current plan" }).click();
    await page.getByRole("button", { name: "Switch to monthly" }).click();
    await dialog.getByRole("button", { name: "Confirm switch" }).click();
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    const account = (await adminQuery(admin, internal.billingState.get, { customerId: fixture.customerId }))!;
    const lease = await leaseBillingFixture(fixture.customerId);
    const now = Date.now();
    await adminMutation(admin, internal.billingState.apply, { version: lease.version, snapshot: {
      customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId: local.env.POLAR_PRODUCT_YEARLY!, status: "active",
        start: now - 60_000, end: account.paidThrough!, modifiedAt: now + 1000, cancelAtPeriodEnd: false,
        scheduledChange: { model: "monthly", at: account.paidThrough! } }],
      orders: [{ id: `fixture-scheduled-${user.id}`, productId: local.env.POLAR_PRODUCT_YEARLY!,
        subscriptionId: fixture.subscriptionId, paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
    } });
    await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: lease.version, failed: false });
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Yearly Pro");
    await expect(page.getByLabel("Next plan", { exact: true })).toHaveValue(/^Monthly Pro from /);
    await expect(page.getByRole("button", { name: "Scheduled", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeEnabled();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "/tmp/billing-scheduled-plan.png", fullPage: true });
    await page.reload();
    await expect(page.getByLabel("Next plan", { exact: true })).toHaveValue(/^Monthly Pro from /);
    expect(requests).toBe(1);
  } finally { await user.cleanup(); }
});

for (const model of ["monthly", "yearly"] as const) {
  test(`canceled ${model} subscriptions block plan switching with an accessible renewal explanation`, async ({ page }) => {
    const user = await createClerkTestUser(local);
    const { client: admin } = billingTestAdmin();
    const target = model === "monthly" ? "yearly" : "monthly";
    let switchRequests = 0;
    await page.routeWebSocket(/\/sync$/, socket => {
      const server = socket.connectToServer();
      server.onMessage(message => socket.send(message));
      socket.onMessage(message => {
        const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string };
        if (frame.type === "Action" && frame.udfPath === "polar:changeSubscription") switchRequests++;
        server.send(message);
      });
    });
    try {
      const fixture = await seedPaidTestUser(user, model);
      const account = (await adminQuery(admin, internal.billingState.get, { customerId: fixture.customerId }))!;
      const lease = await leaseBillingFixture(fixture.customerId);
      const now = Date.now();
      const productId = local.env[`POLAR_PRODUCT_${model.toUpperCase()}`]!;
      await adminMutation(admin, internal.billingState.apply, { version: lease.version, snapshot: {
        customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 1000,
          end: account.paidThrough!, modifiedAt: now, cancelAtPeriodEnd: true }],
        orders: [{ id: `fixture-canceled-${user.id}`, productId, subscriptionId: fixture.subscriptionId,
          paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
      } });
      await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: lease.version, failed: false });
      await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
      await page.goto(`/billing?plan=${target}`);
      await expect(page.getByRole("button", { name: "Renew subscription", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Renew", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: `Switch to ${target}` })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Get lifetime" })).toBeEnabled();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      const explanation = `Renew your subscription to switch to ${target}`;
      const trigger = page.getByRole("button", { name: `Switch to ${target}` });
      await trigger.hover();
      await expect(page.getByRole("tooltip")).toHaveText(explanation);
      await page.screenshot({ path: `/tmp/billing-canceled-${model}-tooltip.png`, fullPage: true });
      await page.mouse.move(0, 0);
      await trigger.focus();
      await expect(page.getByRole("tooltip")).toHaveText(explanation);
      await trigger.click({ force: true });
      await trigger.press("Enter");
      await trigger.press("Space");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(switchRequests).toBe(0);

      const renewedLease = await leaseBillingFixture(fixture.customerId);
      const renewedAt = Date.now();
      await adminMutation(admin, internal.billingState.apply, { version: renewedLease.version, snapshot: {
        customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: renewedAt - 1000,
          end: account.paidThrough!, modifiedAt: renewedAt, cancelAtPeriodEnd: false }], orders: [],
      } });
      await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: renewedLease.version, failed: false });
      await expect(page.getByRole("button", { name: `Switch to ${target}` })).toBeEnabled();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    } finally { await user.cleanup(); }
  });
}

test("billing retries show progress until a yearly payment is confirmed", async ({ page, browser }) => {
  const user = await createClerkTestUser(local);
  const { client: admin } = billingTestAdmin();
  let recording;
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    recording = await browser.newContext({ baseURL: local.config.env.APP_URL,
      storageState: await page.context().storageState(),
      recordVideo: { dir: "/tmp/subscription-pr-evidence/video", size: { width: 1280, height: 800 } } });
    const recordedPage = await recording.newPage();
    await recordedPage.goto("/billing");
    await expect(recordedPage.getByLabel("Plan", { exact: true })).toHaveValue("Monthly Pro");

    const failedLease = await leaseBillingFixture(fixture.customerId);
    await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: failedLease.version, failed: true });
    await expect(recordedPage.getByText("Confirming your billing details", { exact: true })).toBeVisible();
    await expect(recordedPage.getByText("We couldn’t update your billing details", { exact: true })).toHaveCount(0);
    await expect(recordedPage.getByLabel("Plan", { exact: true })).toHaveValue("Monthly Pro");
    await recordedPage.screenshot({ path: "/tmp/subscription-pr-evidence/after-retrying.png", fullPage: true });
    await delay(700); // Let the short PR recording show the pending state.

    const lease = await leaseBillingFixture(fixture.customerId);
    const now = Date.now();
    const productId = local.env.POLAR_PRODUCT_YEARLY!;
    await adminMutation(admin, internal.billingState.apply, { version: lease.version, snapshot: {
      customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 1000,
        end: now + 365 * 24 * 60 * 60_000, modifiedAt: now, cancelAtPeriodEnd: false }],
      orders: [{ id: `fixture-confirmed-${user.id}`, productId, subscriptionId: fixture.subscriptionId,
        paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
    } });
    await adminMutation(admin, internal.billingState.finish, { customerId: fixture.customerId, version: lease.version, failed: false });
    await expect(recordedPage.getByLabel("Plan", { exact: true })).toHaveValue("Yearly Pro");
    await expect(recordedPage.getByText("Confirming your billing details", { exact: true })).toHaveCount(0);
    await expect(recordedPage.getByText("We couldn’t update your billing details", { exact: true })).toHaveCount(0);
    await recordedPage.screenshot({ path: "/tmp/subscription-pr-evidence/after-confirmed.png", fullPage: true });
    await delay(700);
    const video = recordedPage.video();
    await recording.close();
    recording = undefined;
    await copyFile(await video!.path(), "/tmp/subscription-pr-evidence/billing-confirmation.webm");
  } finally {
    await recording?.close();
    await user.cleanup();
  }
});

test("repeated switches and cancellation cycles confirm reactive state; failures clear obsolete expectations", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let release: (() => void) | undefined;
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
    const { client: admin } = billingTestAdmin();
    let model: "monthly" | "yearly" = "monthly";
    let cancel = false;
    let failNext = false;
    let sequence = 0;
    async function confirmSwitch(target: "monthly" | "yearly") {
      await page.getByRole("button", { name: `Switch to ${target}` }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(target === "yearly" ? "charged immediately" : "end of your current one-year period");
      await dialog.getByRole("button", { name: "Confirm switch" }).click();
    }
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
        const lease = await leaseBillingFixture(fixture.customerId);
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
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    const planCard = (plan: "monthly" | "yearly") => page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: plan === "monthly" ? "Monthly" : "Yearly", exact: true }) });
    await expect(planCard("monthly").getByRole("button", { name: "Current", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Switch to yearly" }).click();
    await page.screenshot({ path: "/tmp/billing-switch-yearly-confirmation.png", fullPage: true });
    await page.getByRole("button", { name: "Keep current plan" }).click();
    expect(sequence).toBe(0);
    expect(release).toBeUndefined();
    for (const target of ["yearly", "monthly", "yearly"] as const) {
      await confirmSwitch(target);
      await expect(page.getByRole("button", { name: "Confirming plan…" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Get lifetime" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeDisabled();
      await expect(planCard(target === "monthly" ? "yearly" : "monthly").getByRole("button", { name: "Current", exact: true })).toBeDisabled();
      release!();
      await expect(page.getByLabel("Plan", { exact: true })).toHaveValue(target === "yearly" ? "Yearly Pro" : "Monthly Pro");
      await expect(planCard(target).getByRole("button", { name: "Current", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: `Switch to ${target === "yearly" ? "monthly" : "yearly"}` })).toBeEnabled();
    }
    for (const action of ["Cancel subscription", "Renew", "Cancel subscription", "Renew subscription"]) {
      const previousSequence = sequence;
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(page.getByRole("button", { name: "Confirming renewal…" })).toHaveCount(action === "Cancel subscription" ? 1 : 2);
      await expect(page.getByRole("button", { name: "Confirming renewal…" }).first()).toBeDisabled();
      await expect(page.getByRole("button", { name: "Confirming renewal…" }).last()).toBeDisabled();
      await expect(page.getByRole("button", { name: "Get lifetime" })).toBeDisabled();
      release!();
      const nextAction = action === "Cancel subscription" ? "Renew subscription" : "Cancel subscription";
      await expect(page.getByRole("button", { name: nextAction, exact: true })).toBeEnabled();
      expect(sequence).toBe(previousSequence + 1);
      const dateLabel = action === "Cancel subscription" ? "Access ends" : "Paid through";
      await expect(page.getByLabel(dateLabel, { exact: true })).toBeDisabled();
    }
    failNext = true;
    await confirmSwitch("monthly");
    await expect(page.getByText(/We couldn’t complete the billing request/)).toBeVisible();
    await confirmSwitch("monthly");
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toBeDisabled(); release!();
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Monthly Pro");
    await expect(page.getByRole("button", { name: "Switch to yearly" })).toBeEnabled();

    // An action acknowledgement must not erase an unconfirmed change or its
    // timeout warning. Only the trusted state publication resolves it.
    await confirmSwitch("yearly");
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toBeDisabled();
    const warning = page.getByRole("alert").filter({ hasText: "The change is still unconfirmed" });
    await expect(warning).toBeVisible();
    release!();
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Yearly Pro");
    await expect(warning).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Switch to monthly" })).toBeEnabled();
  } finally { release?.(); await page.unrouteAll({ behavior: "wait" }); await user.cleanup(); }
});
