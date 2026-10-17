import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();
const catalog = (["monthly", "yearly", "lifetime"] as const).map((model) => ({
  model, name: model, amount: 2000, currency: "USD", taxBehavior: "provider",
}));

// Keep real Clerk authentication and backend state. Substitute only display
// prices, so loading coverage does not depend on configured sandbox products.
async function interceptWithFixedCatalog(page: Page) {
  const sync = await interceptConvexSync(page);
  sync.replaceQueryResult("billing/catalog:products", catalog);
  return sync;
}

for (const width of [1280, 390]) {
  test(`billing remains visible with safe pending controls at ${width}px`, async ({ page }) => {
    const user = await createClerkTestUser(local);
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await clerk.signIn({ page, emailAddress: user.email });
      await page.goto("/billing");
      await expect(page.getByRole("button", { name: "Choose yearly" })).toBeVisible();

      const backend = await interceptWithFixedCatalog(page);
      backend.holdResponses();
      await page.reload();
      // Scope to main: while a cold page streams in, the document can briefly hold
      // a second, hidden copy of the skeleton outside it.
      const status = page.getByRole("main").locator('[data-slot="card"][aria-label="Billing status"]');
      const plans = page.getByRole("main").locator('[aria-label="Paid plans"]');
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
      await expect(status).toHaveAttribute("aria-busy", "true");
      await expect(plans).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "Check payment status" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Choose yearly" })).toHaveCount(0);
      await expect.poll(backend.pendingResponses).toBeGreaterThan(0);
      const statusBefore = await status.boundingBox();
      const plansBefore = await plans.boundingBox();
      await captureEvidence(page, `billing-loading-${width}`);
      backend.releaseResponses();

      await expect(status).not.toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "Choose yearly" })).toBeEnabled();
      const statusAfter = await status.boundingBox();
      const plansAfter = await plans.boundingBox();
      expect(statusBefore).not.toBeNull();
      expect(statusAfter).not.toBeNull();
      expect(plansBefore).not.toBeNull();
      expect(plansAfter).not.toBeNull();
      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(statusAfter![dimension]).toBeCloseTo(statusBefore![dimension], 0);
        expect(plansAfter![dimension]).toBeCloseTo(plansBefore![dimension], 0);
      }
      await captureEvidence(page, `billing-loaded-${width}`);
    } finally {
      await user.cleanup();
    }
  });
}

test("subscription controls remain usable while plan prices load independently", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user, "monthly");
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    const backend = await interceptWithFixedCatalog(page);
    backend.holdResponses("billing/catalog:products");
    await page.goto("/billing");
    await expect.poll(backend.pendingResponses).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeEnabled();
    await expect(page.locator('[aria-label="Plan prices"]')).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Switch to yearly" })).toHaveCount(0);
    backend.releaseResponses();
    await expect(page.getByRole("button", { name: "Switch to yearly" })).toBeVisible();
  } finally {
    await user.cleanup();
  }
});

test("checkout disables duplicate attempts until the request fails, then permits retry", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let release: (() => void) | undefined;
  let requests = 0;
  const sync = await interceptConvexSync(page);
  sync.onAction("billing/polar:checkout", (call) => {
    requests++;
    release = () => call.fail("Fixture checkout failure");
  });
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/billing");
    const checkout = page.getByRole("button", { name: "Choose monthly" });
    await expect(checkout).toBeEnabled();
    const before = await checkout.boundingBox();
    await checkout.click();
    const pending = page.getByRole("button", { name: "Opening checkout…" });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveAttribute("aria-busy", "true");
    expect(await pending.boundingBox()).toEqual(before);
    await pending.dispatchEvent("click");
    expect(requests).toBe(1);
    release!();
    await expect(page.getByText("We couldn’t open checkout")).toBeVisible();
    await expect(checkout).toBeEnabled();
    await checkout.click();
    await expect(pending).toBeDisabled();
    await expect.poll(() => requests).toBe(2);
    release!();
    await expect(checkout).toBeEnabled();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await user.cleanup();
  }
});
