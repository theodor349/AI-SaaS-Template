import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { appConfig } from "../../app.config";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";
import { acceptTerms } from "./legal.mjs";

const local = resolveLocalTestConfig();

for (const width of [390, 1280]) {
  test(`legal documents show company details and fit the screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/cookies", "Cookie Policy"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(`CVR ${appConfig.companyCvr}`).first()).toBeVisible();
      await expect(page.getByText(/\{\{|\}\}/)).toHaveCount(0);
      // Wide tables scroll inside their own container instead of widening the page.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await expect(page.getByRole("cell", { name: /__session/ })).toBeVisible();
  });
}

test("after a material change to the terms, a user keeps account and billing, and accepts before using the product", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user, "lifetime", true, { outdatedTerms: true });
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await expect(page.getByRole("button", { name: "Delete account" })).toBeEnabled();
    await page.goto("/billing");
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    await page.goto("/app");
    await expect(page.getByText("We’ve updated our terms")).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    await captureEvidence(page, "app-acceptance");
    await acceptTerms(page);
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept and continue" })).toHaveCount(0);
  } finally { await user.cleanup(); }
});
