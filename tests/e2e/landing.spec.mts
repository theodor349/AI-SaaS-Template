import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { appConfig } from "../../app.config";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { api, internal } from "../../convex/_generated/api";
import { adminQuery } from "../../scripts/billing-test-admin";
import { billingTestAdmin, seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const { createClerkClient } = createRequire(import.meta.url)("@clerk/nextjs/server");
const local = resolveLocalTestConfig();

test("public plans lead to signup with the selected plan at 1280px and 390px", { tag: "@critical" }, async ({ page }) => {
  await setupClerkTestingToken({ page });
  const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL);
  const products = await client.query(api.billing.catalog.products, {});
  expect(products).toHaveLength(3);

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: `${appConfig.tagline}.` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose monthly" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureEvidence(page, `landing-${width}`);

    for (const product of products) {
      await page.goto("/");
      const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: new RegExp(`^${product.model}$`, "i") }) });
      const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency });
      await expect(card).toContainText(formatter.format(product.amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)));
      await card.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/sign-up\\?redirect_url=${encodeURIComponent(`/checkout?plan=${product.model}`)}$`));
      await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    }
  }
});

test("checkout shows progress after sign-in and for signed-in users, with explicit retries", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const checkoutModels: string[] = [];
  let release: (() => void) | undefined;
  await page.setViewportSize({ width: 390, height: 900 });
  await setupClerkTestingToken({ page });
  const sync = await interceptConvexSync(page);
  sync.onAction<{ model: string }>("billing/polar:checkout", (call) => {
    checkoutModels.push(call.args.model);
    release = () => call.fail("Fixture checkout failure");
  });
  try {
    await page.goto("/");
    await page.getByRole("link", { name: "Get lifetime" }).click();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    await clerk.signIn({ page, emailAddress: user.email });
    await expect(page.getByRole("heading", { name: "Redirecting to the payment page…" })).toBeVisible();
    await expect.poll(() => checkoutModels.length).toBe(1);
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/checkout`);
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toHaveCount(0);
    await captureEvidence(page, "checkout-pending-390");
    release!();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t open the payment page" })).toBeVisible();
    expect(checkoutModels).toEqual(["lifetime"]);
    await page.getByRole("button", { name: "Retry checkout" }).click();
    await expect(page.getByRole("heading", { name: "Redirecting to the payment page…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry checkout" })).toHaveCount(0);
    await expect.poll(() => checkoutModels.length).toBe(2);
    // Back from the provider can restore this page from cache mid-checkout. It
    // must offer checkout again instead of a pending state that never resolves.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.getByRole("button", { name: "Continue to checkout" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t open the payment page" })).toHaveCount(0);
    release!();
    await page.getByRole("button", { name: "Continue to checkout" }).click();
    await expect(page.getByRole("heading", { name: "Redirecting to the payment page…" })).toBeVisible();
    await expect.poll(() => checkoutModels.length).toBe(3);
    release!();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t open the payment page" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/#pricing`);
    await expect(page.getByRole("link", { name: "Get lifetime" })).toBeVisible();
    expect(checkoutModels).toEqual(["lifetime", "lifetime", "lifetime"]);
    await page.getByRole("link", { name: "Choose yearly" }).click();
    await expect(page.getByRole("heading", { name: "Redirecting to the payment page…" })).toBeVisible();
    await expect.poll(() => checkoutModels.length).toBe(4);
    expect(checkoutModels).toEqual(["lifetime", "lifetime", "lifetime", "yearly"]);
    release!();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t open the payment page" })).toBeVisible();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await user.cleanup();
  }
});

test("a new visitor creates an account and reaches Polar sandbox checkout for the chosen plan", { tag: "@critical" }, async ({ page }) => {
  const email = `${local.config.id}-${randomUUID().slice(0, 8)}+clerk_test@gmail.com`;
  const clerkClient = createClerkClient({ secretKey: local.env.CLERK_SECRET_KEY });
  const polar = createPolar({ accessToken: local.env.POLAR_ACCESS_TOKEN, environment: "sandbox", organizationId: local.env.POLAR_ORGANIZATION_ID });
  const checkoutModels: string[] = [];
  let release: (() => void) | undefined;
  await setupClerkTestingToken({ page });
  const sync = await interceptConvexSync(page);
  sync.onAction<{ model: string }>("billing/polar:checkout", (call) => {
    checkoutModels.push(call.args.model);
    release = call.forward;
  });
  try {
    await page.goto("/");
    await page.getByRole("link", { name: "Choose yearly" }).click();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByLabel("Selected plan").getByRole("heading", { name: "Yearly Pro" })).toBeVisible();
    expect(checkoutModels).toEqual([]);
    await page.getByLabel("Email address", { exact: true }).fill(email);
    for (const [label, value] of [["First name", "Landing"], ["Last name", "Test"], ["Password", `Landing-${randomUUID()}!`]]) {
      const input = page.getByLabel(label, { exact: true });
      if (await input.isVisible()) await input.fill(value);
    }
    const verificationPrepared = page.waitForResponse(response =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/prepare_verification"));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    expect((await verificationPrepared).ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await page.getByRole("textbox", { name: "Enter verification code" }).fill("424242");
    await expect(page.getByRole("heading", { name: "Redirecting to the payment page…" })).toBeVisible();
    await expect.poll(() => checkoutModels.length).toBe(1);
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/checkout`);
    await captureEvidence(page, "checkout-pending-1280");
    release!();
    await expect(page).toHaveURL(/https:\/\/sandbox\.polar\.sh\/checkout\//);
    expect(checkoutModels).toEqual(["yearly"]);
    const users = await clerkClient.users.getUserList({ emailAddress: [email] });
    expect(users.data).toHaveLength(1);
    const { client: admin } = billingTestAdmin();
    const userId = await adminQuery(admin, internal.account.users.byClerkId, { clerkId: users.data[0].id });
    expect(userId).toBeTruthy();
    const account = await adminQuery(admin, internal.billing.account.accountByUser, { userId: userId! });
    expect(account).toBeTruthy();
    const checkouts = await polar.checkouts.list({ customer_id: account!.customerId, limit: 10 });
    expect(checkouts.items).toHaveLength(1);
    expect(checkouts.items[0].products.map(product => product.id)).toEqual([local.env.POLAR_PRODUCT_YEARLY]);
    // Returning without paying must leave this new account without Pro access.
    await page.goto(`${local.config.env.APP_URL}/app`);
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByText("Your paid access is confirmed.")).toHaveCount(0);
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    const users = await clerkClient.users.getUserList({ emailAddress: [email] });
    for (const user of users.data) await clerkClient.users.deleteUser(user.id);
  }
});

test("existing Pro users switch recurring plans and buy lifetime through billing", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const checkoutModels: string[] = [];
  const sync = await interceptConvexSync(page);
  sync.onAction<{ model: string }>("billing/polar:checkout", (call) => {
    checkoutModels.push(call.args.model);
    call.fail("Fixture checkout failure");
  });
  try {
    await seedPaidTestUser(user, "monthly");
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/");
    await page.getByRole("link", { name: "Switch to yearly" }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing?plan=yearly`);
    await expect(page.getByRole("alertdialog", { name: "Switch to yearly?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep current plan" }).click();
    await page.goto("/checkout?plan=yearly");
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing?plan=yearly`);
    await expect(page.getByRole("alertdialog", { name: "Switch to yearly?" })).toBeVisible();
    expect(checkoutModels).toEqual([]);
    await page.getByRole("button", { name: "Keep current plan" }).click();
    await page.goto("/");
    await page.getByRole("link", { name: "Get lifetime" }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    expect(checkoutModels).toEqual([]);
    await page.getByRole("button", { name: "Get lifetime" }).click();
    await expect(page.getByText("We couldn’t open checkout")).toBeVisible();
    expect(checkoutModels).toEqual(["lifetime"]);
  } finally { await page.unrouteAll({ behavior: "wait" }); await user.cleanup(); }
});

test("lifetime users see every plan's price on the landing page, with lifetime as their current plan", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user, "lifetime");
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/#pricing");
    const products = await new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL).query(api.billing.catalog.products, {});
    for (const product of products) {
      const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: new RegExp(`^${product.model}$`, "i") }) });
      const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency });
      await expect(card).toContainText(formatter.format(product.amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)));
      await expect(card.getByRole("button", { name: product.model === "lifetime" ? "Current" : "Included" })).toBeDisabled();
    }
    await expect(page.getByRole("link", { name: /^(Choose|Switch to|Get) / })).toHaveCount(0);
  } finally { await user.cleanup(); }
});

for (const transition of ["paid", "deleting", "manual"] as const) {
  test(`a pending checkout cannot override ${transition} navigation`, async ({ page }) => {
    const user = await createClerkTestUser(local);
    let completeCheckout: (() => void) | undefined;
    let destinationVisits = 0;
    const destination = `${local.config.env.APP_URL}/__stale-checkout`;
    const responseMarker = `Checkout race fixture delivered: ${transition}`;
    await setupClerkTestingToken({ page });
    await page.route(destination, route => {
      destinationVisits++;
      return route.fulfill({ contentType: "text/html", body: "<h1>Stale checkout destination</h1>" });
    });
    const sync = await interceptConvexSync(page);
    sync.onAction("billing/polar:checkout", (call) => {
      completeCheckout = () => call.succeed(destination, [`[LOG] ${responseMarker}`]);
    });
    try {
      await page.goto("/");
      await clerk.signIn({ page, emailAddress: user.email });
      await page.goto("/");
      await page.getByRole("link", { name: "Choose monthly" }).click();
      await expect(page.getByRole("heading", { name: "Redirecting to the payment page…" })).toBeVisible();
      await expect.poll(() => Boolean(completeCheckout)).toBe(true);

      if (transition === "paid") {
        await seedPaidTestUser(user);
        await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
        await expect(page.getByText("You have lifetime access.")).toBeVisible();
      } else if (transition === "deleting") {
        const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
        const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
        client.setAuth(token!);
        await client.mutation(api.account.lifecycle.requestDeletion, {});
        await expect(page).toHaveURL(`${local.config.env.APP_URL}/account`);
        await expect(page.getByText(/Deletion scheduled for/)).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Open profile menu" }).click();
        await page.getByRole("menuitem", { name: "Account", exact: true }).click();
        await expect(page).toHaveURL(`${local.config.env.APP_URL}/account`);
      }

      const responseReceived = page.waitForEvent("console", { predicate: message => message.text().includes(responseMarker) });
      completeCheckout!();
      // The SDK logs this marker while handling the delayed action response.
      // A browser round trip then lets its promise continuation finish.
      await responseReceived;
      await page.evaluate(() => Promise.resolve());
      await expect(page.getByRole("heading", { name: transition === "paid" ? "Billing" : "Account", exact: true })).toBeVisible();
      expect(destinationVisits).toBe(0);
    } finally { await user.cleanup(); }
  });
}
