import { clerk } from "@clerk/testing/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { appConfig } from "../../app.config";
import { E2E_CRASH_COOKIE } from "../../lib/e2e-crash";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();
const appUrl = local.config.env.APP_URL;

declare global {
  interface Window { illustrationAnimationStarts?: number }
}

function crash(context: BrowserContext, target: "page" | "layout") {
  return context.addCookies([{ name: E2E_CRASH_COOKIE, value: target, url: appUrl }]);
}

test("an unknown URL returns 404 in the site shell with a way home", async ({ page }) => {
  const response = await page.goto("/this-page-was-not-part-of-it");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle(`Page not found — ${appConfig.appName}`);
  await expect(page.getByText("404 · Page not found")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await captureEvidence(page, "not-found");
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(`${appUrl}/`);
});

test("the 404 page sends signed-in visitors to their dashboard", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    // Count every start of the illustration's animation from the server-rendered HTML on.
    await page.addInitScript(() => {
      document.addEventListener("animationstart", () => {
        window.illustrationAnimationStarts = (window.illustrationAnimationStarts ?? 0) + 1;
      }, true);
    });
    await page.goto("/this-page-was-not-part-of-it");
    // Clerk resolving the session after hydration must not remount the page and replay it.
    // The dashboard link renders with the resolved session; a remount would happen then.
    const dashboard = page.getByRole("link", { name: "Go to dashboard" });
    await expect(dashboard).toBeVisible();
    await page.locator("section > svg").evaluate((svg) => Promise.all(svg.getAnimations({ subtree: true }).map((a) => a.finished)));
    expect(await page.evaluate(() => window.illustrationAnimationStarts)).toBe(1);
    await dashboard.click();
    await expect(page).toHaveURL(/\/app$/);
  } finally {
    await user.cleanup();
  }
});

test("a page error shows the error page and Try again recovers", async ({ page, context }) => {
  await crash(context, "page");
  await page.goto("/e2e/crash");
  await expect(page.getByRole("heading", { name: "Something broke. Just a little." })).toBeVisible();
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: appConfig.supportEmail })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("internal detail");
  await captureEvidence(page, "page-error");

  await context.clearCookies({ name: E2E_CRASH_COOKIE });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "The crash test page recovered" })).toBeVisible();
});

test("a root layout error renders the global error page without the app shell", async ({ page, context }) => {
  await crash(context, "layout");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Something broke. Just a little." })).toBeVisible();
  await expect(page).toHaveTitle(`Something went wrong — ${appConfig.appName}`);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("internal detail");
  await captureEvidence(page, "global-error");

  await context.clearCookies({ name: E2E_CRASH_COOKIE });
  // Next's dev overlay covers the page after a root layout error; production has none.
  await page.getByRole("button", { name: "Try again" }).dispatchEvent("click");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});
