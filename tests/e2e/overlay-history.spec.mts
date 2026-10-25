import { expect, test } from "@playwright/test";

test("history back closes a dialog and keeps the page, without leaving entries behind", async ({ page }) => {
  await page.goto("/");
  await page.goto("/cookies");
  const button = page.getByRole("button", { name: "Cookie Preferences" });
  const dialog = page.getByRole("dialog", { name: "Cookie Preferences" });

  await button.click();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/cookies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cookie Policy" })).toBeVisible();

  // A dialog closed in the page removes its entry, so one back leaves the page.
  await button.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save preferences" }).click();
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/cookies$/);
});

test("history back closes a popover and keeps the page", async ({ page }) => {
  await page.goto("/");
  await page.goto("/e2e/popover");
  const button = page.getByRole("button", { name: "Open popover" });
  const popover = page.getByRole("dialog", { name: "Test popover" });

  await button.click();
  await expect(popover).toBeVisible();
  await page.goBack();
  await expect(popover).toHaveCount(0);
  await expect(page).toHaveURL(/\/e2e\/popover$/);

  // A popover closed in the page removes its entry, so one back leaves the page.
  await button.click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});
