import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { api, internal } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { billingTestAdmin, leaseBillingFixture, publishBillingSnapshot, seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { adminQuery, adminMutation } from "../../scripts/billing-test-admin";
import { testExternalCustomerId } from "../../scripts/test-identity.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

test("selected plan opens checkout once after authentication; success URL alone cannot grant access", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const checkoutModels: string[] = [];
  const sync = await interceptConvexSync(page);
  sync.onAction<{ model: string }>("billing/polar:checkout", (call) => {
    checkoutModels.push(call.args.model);
    call.fail("Fixture checkout failure");
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
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toHaveCount(0);
    await page.goto("/billing?confirmation=lifetime&customer_session_token=fixture-session");
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing?confirmation=lifetime`);
    await expect(page.getByText(/Payment confirmation pending/)).toBeVisible();
    await expect(page.getByText("Your paid access is confirmed.")).toHaveCount(0);
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false }); client.setAuth(token!);
    await expect(client.query(api.billing.account.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await expect(client.query(api.billing.account.application, {})).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await captureEvidence(page, "confirmation-pending");
    // The trusted billing publication alone, not the success URL, confirms access,
    // and then opens the product.
    await seedPaidTestUser(user);
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/app`);
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
    await page.goto("/billing");
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    await captureEvidence(page, "lifetime-confirmed");
    await expect(page.getByRole("heading", { name: "Monthly", exact: true })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
  } finally { await user.cleanup(); }
});

test("lifetime access shows the purchase date and opens the customer portal", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let release: (() => void) | undefined;
  let requests = 0;
  const portalUrl = "https://sandbox.polar.sh/fixture-lifetime-portal";
  await page.route(portalUrl, route => route.fulfill({ contentType: "text/html", body: "<h1>Customer portal fixture</h1>" }));
  const sync = await interceptConvexSync(page);
  sync.onAction("billing/polar:portal", (call) => {
    requests++;
    release = () => call.succeed(portalUrl);
  });
  try {
    await seedPaidTestUser(user);
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    await expect(page.getByLabel("Purchased on", { exact: true })).toBeDisabled();
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
    client.setAuth(token!);
    const status = await client.query(api.billing.account.status, {});
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
    await captureEvidence(page, "lifetime-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureEvidence(page, "lifetime-mobile");
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
      const sync = await interceptConvexSync(page);
      sync.onAction(`billing/polar:${action}`, (call) => {
        requests++;
        // Keep the document mounted after a successful navigation response,
        // then reproduce the browser's cached-page lifecycle event below.
        call.succeed(`${local.config.env.APP_URL}/billing#navigation-${requests}`);
      });
      await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
      await page.goto("/billing");
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
    await captureEvidence(page, "billing-active");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureEvidence(page, "billing-summary-mobile");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
    const { client: admin } = billingTestAdmin();
    const account = (await adminQuery(admin, internal.billing.state.get, { customerId: fixture.customerId }))!;
    // A higher revision ending state is the same trusted publication used by
    // reconciliation. No browser-side success flags or mocked auth are involved.
    await publishBillingSnapshot({ customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId: local.env.POLAR_PRODUCT_MONTHLY!, status: "canceled",
        start: Date.now() - 1000, end: Date.now() - 1, modifiedAt: Date.now() + 1000, cancelAtPeriodEnd: false }], orders: [] });
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
    await client.action(api.billing.polar.recover, {});
    await expect(page.getByText("We couldn’t complete the billing request")).toHaveCount(0);
    const { client: admin } = billingTestAdmin();
    const userId = await adminQuery(admin, internal.account.users.byClerkId, { clerkId: user.id });
    const account = (await adminQuery(admin, internal.billing.account.accountByUser, { userId: userId! }))!;
    expect(account.externalId).toBe(testExternalCustomerId(local, user.id));
    expect(account.customerId).not.toBe(collisionCustomerId);
    const owned = await polar.customers.get(account.customerId);
    expect(owned.email).toBe(user.email.replace("@", `+${local.config.id}@`));
    expect((await polar.customers.get(collisionCustomerId)).external_id).toBe(collision.external_id);
    // Poll provider-delivery tracking through a bounded operational query.
    await expect.poll(async () => (await adminQuery(admin, internal.billing.account.deliveryStatus, { customerId: account.customerId })).delivered).toBe(true);
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
  const sync = await interceptConvexSync(page);
  sync.onAction("billing/polar:changeSubscription", (call) => {
    requests++;
    call.succeed(null);
  });
  try {
    const fixture = await seedPaidTestUser(user, "yearly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Switch to monthly" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("You will not be charged again until the end of your current one-year period.");
    await captureEvidence(page, "switch-monthly-confirmation");
    expect(requests).toBe(0);
    await dialog.getByRole("button", { name: "Keep current plan" }).click();
    await page.getByRole("button", { name: "Switch to monthly" }).click();
    await dialog.getByRole("button", { name: "Confirm switch" }).click();
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    const account = (await adminQuery(admin, internal.billing.state.get, { customerId: fixture.customerId }))!;
    const now = Date.now();
    await publishBillingSnapshot({
      customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId: local.env.POLAR_PRODUCT_YEARLY!, status: "active",
        start: now - 60_000, end: account.paidThrough!, modifiedAt: now + 1000, cancelAtPeriodEnd: false,
        scheduledChange: { model: "monthly", at: account.paidThrough! } }],
      orders: [{ id: `fixture-scheduled-${user.id}`, productId: local.env.POLAR_PRODUCT_YEARLY!,
        subscriptionId: fixture.subscriptionId, paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
    });
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Yearly Pro");
    await expect(page.getByLabel("Next plan", { exact: true })).toHaveValue(/^Monthly Pro from /);
    await expect(page.getByRole("button", { name: "Scheduled", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeEnabled();
    await page.setViewportSize({ width: 1280, height: 900 });
    await captureEvidence(page, "scheduled-plan");
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
    const sync = await interceptConvexSync(page);
    sync.onAction("billing/polar:changeSubscription", (call) => {
      switchRequests++;
      call.forward();
    });
    try {
      const fixture = await seedPaidTestUser(user, model);
      const account = (await adminQuery(admin, internal.billing.state.get, { customerId: fixture.customerId }))!;
      const now = Date.now();
      const productId = local.env[`POLAR_PRODUCT_${model.toUpperCase()}`]!;
      await publishBillingSnapshot({
        customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 1000,
          end: account.paidThrough!, modifiedAt: now, cancelAtPeriodEnd: true }],
        orders: [{ id: `fixture-canceled-${user.id}`, productId, subscriptionId: fixture.subscriptionId,
          paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
      });
      await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
      await page.goto(`/billing?plan=${target}`);
      await expect(page.getByRole("button", { name: "Renew subscription", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Renew", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: `Switch to ${target}` })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Get lifetime" })).toBeEnabled();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      const explanation = `Renew your subscription to switch to ${target}`;
      const trigger = page.getByRole("button", { name: `Switch to ${target}` });
      await expect(trigger).toHaveAccessibleDescription(explanation);
      await expect(page.getByText(explanation, { exact: true })).toBeVisible();
      await captureEvidence(page, `canceled-${model}-explanation`);
      await trigger.click({ force: true });
      await trigger.press("Enter");
      await trigger.press("Space");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(switchRequests).toBe(0);

      const renewedAt = Date.now();
      await publishBillingSnapshot({
        customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: renewedAt - 1000,
          end: account.paidThrough!, modifiedAt: renewedAt, cancelAtPeriodEnd: false }], orders: [],
      });
      await expect(page.getByRole("button", { name: `Switch to ${target}` })).toBeEnabled();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    } finally { await user.cleanup(); }
  });
}

test("billing retries show progress until a yearly payment is confirmed", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const { client: admin } = billingTestAdmin();
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/billing");
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Monthly Pro");

    const failedLease = await leaseBillingFixture(fixture.customerId);
    await adminMutation(admin, internal.billing.state.finish, { customerId: fixture.customerId, version: failedLease.version, failed: true });
    await expect(page.getByText("Confirming your billing details", { exact: true })).toBeVisible();
    await expect(page.getByText("We couldn’t update your billing details", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Monthly Pro");
    await captureEvidence(page, "after-retrying");

    const now = Date.now();
    const productId = local.env.POLAR_PRODUCT_YEARLY!;
    await publishBillingSnapshot({
      customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 1000,
        end: now + 365 * 24 * 60 * 60_000, modifiedAt: now, cancelAtPeriodEnd: false }],
      orders: [{ id: `fixture-confirmed-${user.id}`, productId, subscriptionId: fixture.subscriptionId,
        paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
    });
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Yearly Pro");
    await expect(page.getByText("Confirming your billing details", { exact: true })).toHaveCount(0);
    await expect(page.getByText("We couldn’t update your billing details", { exact: true })).toHaveCount(0);
    await captureEvidence(page, "after-confirmed");
  } finally {
    await user.cleanup();
  }
});

test("repeated switches and cancellation cycles confirm reactive state; failures clear obsolete expectations", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let release: (() => void) | undefined;
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
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
    const sync = await interceptConvexSync(page);
    sync.onAction<{ operation: string }>("billing/polar:changeSubscription", async (call) => {
      // The UI action result is deliberately separated from a trusted state
      // publication to prove the label never treats an action ACK as entitlement.
      if (failNext) {
        failNext = false;
        call.fail("Fixture provider failure");
        return;
      }
      const { operation } = call.args;
      if (operation === "monthly" || operation === "yearly") model = operation;
      else cancel = operation === "cancel";
      call.succeed(null);
      await new Promise<void>(resolve => { release = resolve; });
      const now = Date.now() + ++sequence * 100;
      const productId = local.env[`POLAR_PRODUCT_${model.toUpperCase()}`]!;
      await publishBillingSnapshot({
        customerId: fixture.customerId, externalId: fixture.externalId,
        subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 60_000,
          end: now + 60 * 60_000, modifiedAt: now, cancelAtPeriodEnd: cancel }],
        orders: [{ id: `fixture-switch-${user.id}-${sequence}`, productId, subscriptionId: fixture.subscriptionId,
          paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
      });
    });
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    const planCard = (plan: "monthly" | "yearly") => page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: plan === "monthly" ? "Monthly" : "Yearly", exact: true }) });
    await expect(planCard("monthly").getByRole("button", { name: "Current", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Switch to yearly" }).click();
    await captureEvidence(page, "switch-yearly-confirmation");
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

test("a confirmed switch stays settled when Pro later ends in the same page load", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let requests = 0;
  const sync = await interceptConvexSync(page);
  sync.onAction("billing/polar:changeSubscription", (call) => {
    requests++;
    call.succeed(null);
  });
  try {
    const fixture = await seedPaidTestUser(user, "monthly");
    await page.clock.install();
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    await page.getByRole("button", { name: "Switch to yearly" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm switch" }).click();
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toBeDisabled();
    await expect.poll(() => requests).toBe(1);

    const now = Date.now();
    const productId = local.env.POLAR_PRODUCT_YEARLY!;
    await publishBillingSnapshot({
      customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId, status: "active", start: now - 60_000,
        end: now + 365 * 24 * 60 * 60_000, modifiedAt: now + 1000, cancelAtPeriodEnd: false }],
      orders: [{ id: `fixture-switch-${user.id}`, productId, subscriptionId: fixture.subscriptionId,
        paid: true, fullyRefunded: false, createdAt: now, modifiedAt: now }],
    });
    await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("Yearly Pro");
    await expect(page.getByRole("button", { name: "Confirming plan…" })).toHaveCount(0);

    // Pro ends without a reload, as after a withdrawal. The confirmed switch no
    // longer matches this state and must not count as pending again. Pausing the
    // page clock keeps the 15-second unconfirmed timer from firing during the
    // checks, which would otherwise re-enable the buttons and hide the bug.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await publishBillingSnapshot({ customerId: fixture.customerId, externalId: fixture.externalId,
      subscriptions: [{ id: fixture.subscriptionId, productId, status: "canceled",
        start: now - 60_000, end: Date.now() - 1, modifiedAt: now + 2000, cancelAtPeriodEnd: false }], orders: [] });
    await expect(page.getByRole("heading", { name: "Restore Pro access" })).toBeVisible();
    const plans = ["Choose monthly", "Choose yearly", "Get lifetime"];
    for (const name of plans) await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Opening checkout…" })).toHaveCount(0);

    await page.clock.runFor(16_000);
    await expect(page.getByText("The change is still unconfirmed")).toHaveCount(0);
    for (const name of plans) await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    expect(requests).toBe(1);
  } finally { await user.cleanup(); }
});
