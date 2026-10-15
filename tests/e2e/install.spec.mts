import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appConfig } from "../../app.config";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

declare global {
  interface Window { installDialogs?: number }
}

// The application page requires Pro. The user signs in right after the account is
// created, so the session counts as the one sign-up created.
async function signUpPaidUser(page: Page) {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user);
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    return user;
  } catch (error) {
    await user.cleanup();
    throw error;
  }
}

// Chrome fires beforeinstallprompt once the app is installable; the test stands in for it.
async function becomeInstallable(page: Page) {
  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => { window.installDialogs = (window.installDialogs ?? 0) + 1; },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
}

async function openApplication(page: Page) {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
}

async function expectMenuOffersInstall(page: Page, offered: boolean) {
  await page.getByRole("button", { name: "Open profile menu" }).click();
  const item = page.getByRole("menuitem", { name: "Install app" });
  if (offered) await expect(item).toBeVisible();
  else await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
  if (!offered) await expect(item).toHaveCount(0);
  await page.keyboard.press("Escape");
}

const offer = (page: Page) => page.locator("[data-sonner-toast]").filter({ hasText: `Install ${appConfig.appName}` });

test("the install offer appears once after sign-up and the profile menu keeps offering install", async ({ page }) => {
  const user = await signUpPaidUser(page);
  try {
    await openApplication(page);
    await becomeInstallable(page);
    await expect(offer(page)).toBeVisible();
    await captureEvidence(page, "install-offer");
    await offer(page).getByRole("button", { name: "Close toast" }).click();
    await expect(offer(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    await becomeInstallable(page);
    await expectMenuOffersInstall(page, true);
    await expect(offer(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Open profile menu" }).click();
    await page.getByRole("menuitem", { name: "Install app" }).click();
    await expect.poll(() => page.evaluate(() => window.installDialogs)).toBe(1);
    // Each event allows one dialog, so the menu waits for the browser's next one.
    await expectMenuOffersInstall(page, false);
  } finally {
    await user.cleanup();
  }
});

test("installing from the profile menu while the offer shows closes the offer", async ({ page }) => {
  const user = await signUpPaidUser(page);
  try {
    await openApplication(page);
    await becomeInstallable(page);
    await expect(offer(page)).toBeVisible();
    await page.getByRole("button", { name: "Open profile menu" }).click();
    await page.getByRole("menuitem", { name: "Install app" }).click();
    await expect.poll(() => page.evaluate(() => window.installDialogs)).toBe(1);
    await expect(offer(page)).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});

test("installing from the offer opens the browser's dialog, and the installed app never offers", async ({ page, browser }) => {
  const user = await signUpPaidUser(page);
  try {
    await openApplication(page);
    await becomeInstallable(page);
    await offer(page).getByRole("button", { name: "Install app" }).click();
    await expect.poll(() => page.evaluate(() => window.installDialogs)).toBe(1);
    await expect(offer(page)).toHaveCount(0);

    // The same account in the installed app, before it ever answered the offer.
    const installed = await browser.newContext({ baseURL: local.config.env.APP_URL, storageState: await page.context().storageState() });
    try {
      await installed.addInitScript(() => {
        const matchMedia = window.matchMedia.bind(window);
        // A query that always matches stands in for standalone display mode.
        window.matchMedia = (query) => matchMedia(query === "(display-mode: standalone)" ? "(min-width: 0px)" : query);
        localStorage.removeItem("install-offer");
      });
      const standalone = await installed.newPage();
      await openApplication(standalone);
      await becomeInstallable(standalone);
      await expectMenuOffersInstall(standalone, false);
      await expect(offer(standalone)).toHaveCount(0);
    } finally {
      await installed.close();
    }
  } finally {
    await user.cleanup();
  }
});
