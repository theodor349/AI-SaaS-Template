import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
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

test("billing remains visible with safe pending controls at 1280px and 390px", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/billing");
    await expect(page.getByRole("button", { name: "Choose yearly" })).toBeVisible();
    const backend = await interceptWithFixedCatalog(page);

    // Scope to main: while a cold page streams in, the document can briefly hold
    // a second, hidden copy of the skeleton outside it.
    const status = page.getByRole("main").locator('[data-slot="card"][aria-label="Billing status"]');
    const plans = page.getByRole("main").locator('[aria-label="Paid plans"]');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      backend.holdResponses();
      await page.reload();
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
    }
  } finally {
    await user.cleanup();
  }
});
