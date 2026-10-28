import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();
const day = 24 * 60 * 60_000;

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

// Days back to a purchase whose 14th day is the coming Danish Saturday, so its
// period runs on past the weekend and ends days, not hours, from now.
function purchasedBeforeAWeekend() {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Copenhagen", weekday: "short" }).format(Date.now());
  const toSaturday = (6 - ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday) + 7) % 7;
  return Date.now() - (14 - toSaturday) * day;
}

test("the withdrawal control disappears when the period ends", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user, "lifetime", true, { purchasedAt: purchasedBeforeAWeekend() });
    await page.clock.install();
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email }); await page.goto("/billing");
    const card = page.getByLabel("Withdraw from contract", { exact: true });
    await expect(card.getByRole("button", { name: "Withdraw from contract" })).toBeVisible();
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
    client.setAuth(token!);
    const [purchase] = await client.query(api.billing.withdrawals.purchases, {});
    expect(purchase.withdrawUntil - Date.now()).toBeGreaterThan(day);

    await page.clock.fastForward(purchase.withdrawUntil - Date.now());
    await expect(card).toHaveCount(0);
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
  } finally { await user.cleanup(); }
});

// Its own test, so the page clock fast-forwarded above cannot break this sign-in.
test("the server refuses a late withdrawal", async ({ page }) => {
  const late = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(late, "lifetime", true, { purchasedAt: Date.now() - 30 * day });
    await page.goto("/"); await clerk.signIn({ page, emailAddress: late.email }); await page.goto("/billing");
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    await expect(page.getByLabel("Withdraw from contract", { exact: true })).toHaveCount(0);
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
    client.setAuth(token!);
    await expect(client.mutation(api.billing.withdrawals.request, { orderId: `fixture-order-${late.id}-lifetime` }))
      .rejects.toThrow("WITHDRAWAL_PERIOD_ENDED");
  } finally { await late.cleanup(); }
});
