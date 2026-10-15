import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_CRASH_COOKIE } from "../../lib/e2e-crash";
import { themeColors } from "../../lib/theme";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

declare global {
  interface Window { darkAtFirstPaint?: boolean }
}

// Records whether <html> was dark in the first frame that painted page content.
async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const check = () => {
      if (document.body?.childElementCount) window.darkAtFirstPaint = document.documentElement.classList.contains("dark");
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function expectTheme(page: Page, theme: "light" | "dark") {
  const html = page.locator("html");
  if (theme === "dark") await expect(html).toHaveClass(/\bdark\b/);
  else await expect(html).not.toHaveClass(/\bdark\b/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", themeColors[theme]);
}

async function expectPaintedFirstAs(page: Page, theme: "light" | "dark") {
  await expect.poll(() => page.evaluate(() => window.darkAtFirstPaint)).toBe(theme === "dark");
  await expectTheme(page, theme);
}

test("a chosen theme applies at once, persists without a flash, and System follows the OS", async ({ page, context }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await recordFirstPaint(page);
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    const theme = page.getByRole("radiogroup", { name: "Theme" });
    await expect(theme.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await expectTheme(page, "light");

    await theme.getByRole("radio", { name: "Dark" }).click();
    await expectTheme(page, "dark");
    await page.reload();
    await expectPaintedFirstAs(page, "dark");
    await expect(theme.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await captureEvidence(page, "account-dark");

    // Static legal pages and client navigation keep the choice too.
    await page.goto("/terms");
    await expectPaintedFirstAs(page, "dark");
    await page.goto("/cookies");
    await expectPaintedFirstAs(page, "dark");
    const themeStorage = page.getByRole("row").filter({ has: page.locator("code", { hasText: /^theme$/ }) });
    await expect(themeStorage).toContainText("Local storage");
    await expect(themeStorage.getByRole("cell").nth(2)).toHaveText("Essential");
    await page.goto("/");
    await expectPaintedFirstAs(page, "dark");
    await page.getByRole("button", { name: "Open profile menu" }).click();
    await page.getByRole("menuitem", { name: "Billing", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    await expectTheme(page, "dark");

    // A root layout crash loses the layout's script; the error page still turns dark.
    await context.addCookies([{ name: E2E_CRASH_COOKIE, value: "layout", url: local.config.env.APP_URL }]);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Something broke. Just a little." })).toBeVisible();
    await expectTheme(page, "dark");
    await context.clearCookies({ name: E2E_CRASH_COOKIE });

    await page.goto("/account");
    await theme.getByRole("radio", { name: "Light" }).click();
    await expectTheme(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "light");
    await page.reload();
    await expectPaintedFirstAs(page, "light");

    await theme.getByRole("radio", { name: "System" }).click();
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "light");
    await page.reload();
    await expectPaintedFirstAs(page, "light");
  } finally {
    await user.cleanup();
  }
});

test("a choice in one tab updates the other tabs", async ({ page, context }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    const other = await context.newPage();
    await other.goto("/terms");
    await expectTheme(other, "light");
    await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
    await expectTheme(other, "dark");
  } finally {
    await user.cleanup();
  }
});

test("a choice the browser refuses to store still applies and says it won't last", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
    });
    const theme = page.getByRole("radiogroup", { name: "Theme" });
    await theme.getByRole("radio", { name: "Dark" }).click();
    await expectTheme(page, "dark");
    await expect(theme.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("alert").filter({ hasText: "couldn’t save your choice" })).toBeVisible();
    await page.reload();
    await expectTheme(page, "light");
  } finally {
    await user.cleanup();
  }
});
