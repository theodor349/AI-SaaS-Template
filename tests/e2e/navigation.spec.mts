import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();

for (const width of [1280, 390]) {
  test(`profile navigation, public policies, and sign-out work at ${width}px`, async ({ page }) => {
    const user = await createClerkTestUser(local);
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await clerk.signIn({ page, emailAddress: user.email });
      await page.goto("/account");
      const trigger = page.getByRole("button", { name: "Open profile menu" });
      await expect(trigger).toBeVisible();
      await trigger.click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByText(user.email, { exact: true })).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const bar = await page.getByRole("navigation", { name: "Main navigation" }).boundingBox();
      if (width < 768) expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(bar!.y);
      // Clicking outside must reach the input without restoring avatar focus.
      const displayName = page.getByLabel("Display name", { exact: true });
      await expect(displayName).toBeEnabled();
      await displayName.click();
      await expect(menu).toHaveCount(0);
      await expect(displayName).toBeFocused();
      await expect(trigger).not.toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await page.getByRole("menuitem", { name: "Billing", exact: true }).click();
      await expect(page).toHaveURL(/\/billing$/);
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await trigger.click();
      await page.getByRole("menuitem", { name: "Cookie Preferences" }).click();
      const dialog = page.getByRole("dialog", { name: "Cookie Preferences" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("switch", { name: "Essential cookies" })).toBeChecked();
      await expect(dialog.getByRole("switch", { name: "Essential cookies" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      for (const label of ["Privacy Policy", "Terms of Service", "Cookie Policy"]) {
        await trigger.click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      }
      await trigger.click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(`${local.config.env.APP_URL}/`);
      await expect(trigger).toHaveCount(0);
      for (const [path, heading] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/cookies", "Cookie Policy"]]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "This page is a placeholder" })).toBeVisible();
      }
      const cookieButton = page.getByRole("button", { name: "Cookie Preferences" });
      await cookieButton.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(cookieButton).toBeFocused();
    } finally {
      await user.cleanup();
    }
  });
}

test("failed Convex authentication keeps Dashboard reachable without exposing protected content", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.loaded({ page });
    await page.evaluate(() => {
      let wrappedSession: string | undefined;
      window.Clerk.addListener(({ session }) => {
        if (!session || wrappedSession === session.id) return;
        wrappedSession = session.id;
        const getToken = session.getToken.bind(session);
        session.getToken = async (options) => {
          if (options?.template === "convex") return null;
          return getToken(options);
        };
      });
    });
    await clerk.signIn({ page, emailAddress: user.email });
    const recovery = page.getByRole("alert").filter({ hasText: "We couldn’t load your account" });
    await expect(recovery).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(recovery).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});
