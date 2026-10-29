import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { appConfig } from "../../app.config";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

test.skip(!appConfig.billing, "billing is off in app.config.ts");

test("a purchase can be withdrawn after a confirmation step", { tag: "@critical" }, async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user, "monthly");
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    const card = page.getByLabel("Withdraw from contract", { exact: true });
    await expect(card).toContainText("Monthly Pro, bought");
    await card.getByRole("button", { name: "Withdraw from contract" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Confirm your withdrawal" });
    await expect(dialog).toContainText("Monthly Pro");
    await expect(dialog).toContainText(`fixture-order-${user.id}-monthly`);
    await expect(dialog).toContainText(user.email);
    await captureEvidence(page, "withdrawal-confirmation");
    // Leaving the confirmation step withdraws nothing.
    await dialog.getByRole("button", { name: "Keep purchase" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Withdraw from contract" })).toBeEnabled();

    await card.getByRole("button", { name: "Withdraw from contract" }).click();
    await dialog.getByRole("button", { name: "Confirm withdrawal" }).click();
    await expect(card.getByText(/^Withdrawal received .+\. Your refund is being processed\.$/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Withdraw from contract" })).toHaveCount(0);
    await captureEvidence(page, "withdrawal-received");
    await page.reload();
    await expect(card.getByText(/^Withdrawal received /)).toBeVisible();
  } finally { await user.cleanup(); }
});
